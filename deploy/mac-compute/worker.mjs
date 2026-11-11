#!/usr/bin/env node
/**
 * NutriAI Mac compute worker.
 *
 * Long-polls the NutriAI server for AI jobs, answers each one with headless
 * Claude Code (`claude -p`), and posts the result back. The server cannot
 * reach this Mac, so every connection is outbound from here — nothing listens
 * on a port and no router change is needed.
 *
 * No dependencies: plain Node 18+. Started and kept alive by launchd (see
 * install.sh); run it by hand with the same environment to debug:
 *
 *   set -a; . ~/.nutriai-compute/config.env; set +a; node worker.mjs
 *
 * What a job may do is fixed here, not by the job: Claude runs with no
 * built-in tools (or web search alone when the job asks for it), none of this
 * Mac's MCP servers, user settings, hooks, skills or CLAUDE.md, in an empty
 * directory. The app's own tools, when a job carries them, are only listed to
 * Claude — the calls it makes are sent back for the server to run. The text a
 * job contains comes from app users, so nothing it says can be allowed to
 * touch this machine.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';

const SERVER = (process.env.NUTRIAI_SERVER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.NUTRIAI_COMPUTE_TOKEN || '';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const CONCURRENCY = Math.min(6, Math.max(1, Number(process.env.NUTRIAI_CONCURRENCY) || 2));
const MODELS = {
  // Rewording a result that already exists: cheapest model that does it well.
  fast: process.env.NUTRIAI_MODEL_FAST || 'haiku',
  // Estimating or looking up a number that ends up in someone's diary.
  accurate: process.env.NUTRIAI_MODEL_ACCURATE || 'sonnet',
};
const WORKDIR = join(homedir(), '.nutriai-compute', 'work');
const MCP_STUB = join(dirname(fileURLToPath(import.meta.url)), 'mcp-tools.mjs');

if (!SERVER || TOKEN.length < 16) {
  console.error('NUTRIAI_SERVER_URL and NUTRIAI_COMPUTE_TOKEN (16+ chars) are required.');
  // Exit 0 would make launchd think this was deliberate; a failure exit plus
  // the plist's ThrottleInterval retries without spinning.
  process.exit(78);
}
mkdirSync(WORKDIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, timeoutMs) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const TOOL_PREFIX = 'mcp__app__';

/** Runs one job through `claude -p` and resolves with its answer. */
function runClaude(job) {
  return new Promise((resolve, reject) => {
    const model = MODELS[job.tier] || MODELS.accurate;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      '--system-prompt', job.system,
      // Exactly the built-in tools the job is allowed, and nobody to approve
      // any other.
      '--tools', job.webSearch ? 'WebSearch' : '',
      '--permission-prompts', 'none',
      // Nothing of this Mac's own Claude setup leaks into a job.
      '--strict-mcp-config',
      '--setting-sources', '',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--no-chrome',
    ];
    const allowed = [];
    if (job.webSearch) allowed.push('WebSearch');
    if (job.schema) args.push('--json-schema', JSON.stringify(job.schema));
    if (job.effort) args.push('--effort', job.effort);

    // A Coach step: offer the app's tools through the stand-in server, which
    // lists them and runs none (see mcp-tools.mjs).
    let toolsFile = null;
    if (job.tools?.length) {
      toolsFile = join(WORKDIR, `tools-${job.id}.json`);
      writeFileSync(toolsFile, JSON.stringify(job.tools));
      args.push(
        '--mcp-config',
        JSON.stringify({
          mcpServers: { app: { command: process.execPath, args: [MCP_STUB, toolsFile] } },
        })
      );
      allowed.push('mcp__app');
    }
    if (allowed.length) args.push('--allowedTools', allowed.join(','));

    const child = spawn(CLAUDE, args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'] });

    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (toolsFile) rmSync(toolsFile, { force: true });
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`claude timed out after ${job.timeoutMs}ms`)),
      job.timeoutMs
    );

    let usedModel = model;
    let callsMessageId = null;
    const toolCalls = [];
    const optimistic = new Set((job.tools ?? []).filter((t) => t.optimistic).map((t) => t.name));
    let replying = false;

    const onEvent = (event) => {
      if (event.type === 'system' && event.subtype === 'init' && event.model) {
        usedModel = event.model;
        return;
      }

      if (event.type === 'assistant') {
        const id = event.message?.id;
        const blocks = event.message?.content ?? [];
        const calls = blocks.filter((b) => b.type === 'tool_use' && b.name?.startsWith(TOOL_PREFIX));

        if (callsMessageId && id !== callsMessageId) {
          // One step is one message's worth of calls. What Claude says next is
          // normally a reaction to results it has not really seen, so the step
          // ends here and the server runs the calls for real.
          //
          // The exception is a step made only of plain saves, which were
          // acknowledged as done: there Claude is allowed to go on and write
          // the confirmation, and it is kept if it makes no further calls.
          if (!replying && toolCalls.every((c) => optimistic.has(c.name))) replying = true;
          if (!replying || calls.length > 0) finish(null, { toolCalls, model: usedModel });
          return;
        }
        for (const block of calls) {
          callsMessageId = id;
          toolCalls.push({ name: block.name.slice(TOOL_PREFIX.length), args: block.input ?? {} });
        }
        return;
      }

      if (event.type !== 'result') return;
      if (toolCalls.length > 0) {
        const text = replying && event.subtype === 'success' && typeof event.result === 'string'
          ? event.result
          : undefined;
        finish(null, { toolCalls, text, model: usedModel });
      } else if (event.is_error || event.subtype !== 'success') {
        finish(new Error(`claude failed (${event.subtype}): ${String(event.result ?? '').slice(0, 300)}`));
      } else if (job.schema && event.structured_output === undefined) {
        finish(new Error('claude returned no structured output'));
      } else {
        finish(null, {
          structured: event.structured_output,
          text: typeof event.result === 'string' ? event.result : undefined,
          model: usedModel,
        });
      }
    };

    let buffer = '';
    let err = '';
    // Decode as text up front: a multi-byte character split across two chunks
    // would otherwise corrupt the line it sits in.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          // Not an event line; nothing to act on.
        }
      }
    });
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-2000);
    });
    child.on('error', (e) => finish(e));
    child.on('close', (code) =>
      finish(new Error(`claude exited ${code} with no result: ${err.slice(-300)}`))
    );
    // A killed child closes its pipes; that is not worth a crash.
    child.stdin.on('error', () => {});

    const content = job.content.map((b) =>
      b.type === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } }
        : { type: 'text', text: b.text }
    );
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
  });
}

async function handle(job) {
  const started = Date.now();
  let payload;
  try {
    const result = await runClaude(job);
    const { toolCalls, ...rest } = result;
    payload = { id: job.id, ok: true, ...rest, tool_calls: toolCalls, ms: Date.now() - started };
    const kind = job.tools ? '+tools' : job.webSearch ? '+search' : '';
    log(`job ${job.id.slice(0, 8)} ${job.tier}${kind} ok ${payload.ms}ms ${result.model}`);
  } catch (error) {
    payload = { id: job.id, ok: false, error: String(error?.message || error).slice(0, 480) };
    log(`job ${job.id.slice(0, 8)} FAILED ${Date.now() - started}ms: ${payload.error}`);
  }
  // One retry: losing an answer that took 30s to a network blip is the
  // expensive kind of failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { accepted } = await post('/api/compute/result', payload, 20_000);
      // The request gave up waiting, or the server restarted underneath it.
      if (!accepted) log(`job ${job.id.slice(0, 8)} answered too late: nobody was waiting`);
      return;
    } catch (error) {
      if (attempt === 1) log(`could not deliver ${job.id.slice(0, 8)}: ${error.message}`);
      else await sleep(1000);
    }
  }
}

let stopping = false;
let wasEnabled = null;
let lastProblem = null;

async function loop(n) {
  let backoff = 2000;
  while (!stopping) {
    try {
      const { enabled, job } = await post(
        '/api/compute/claim',
        { wait_ms: 20_000, worker: { host: hostname(), version: VERSION, models: MODELS } },
        35_000
      );
      backoff = 2000;
      lastProblem = null;
      if (enabled !== wasEnabled) {
        wasEnabled = enabled;
        log(enabled ? 'connected: taking jobs' : 'connected: switched off in the admin console, idling');
      }
      if (job) await handle(job);
    } catch (error) {
      if (stopping) break;
      // Server deploying, Wi-Fi down, Mac just woke: all look like this, and
      // all fix themselves. Back off so a long outage is not a busy loop.
      // Said once per outage, not once per retry: a server that is down
      // overnight should not write a thousand identical lines.
      if (n === 0 && lastProblem !== error.message) {
        lastProblem = error.message;
        log(`server unreachable (${error.message}); retrying with backoff`);
      }
      wasEnabled = null;
      await sleep(backoff);
      backoff = Math.min(60_000, backoff * 2);
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    log('stopping');
    setTimeout(() => process.exit(0), 300);
  });
}

log(`NutriAI compute worker ${VERSION} -> ${SERVER} (${CONCURRENCY} parallel, fast=${MODELS.fast}, accurate=${MODELS.accurate})`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => loop(n)));
