#!/usr/bin/env node
/**
 * A stand-in MCP server: it shows Claude the NutriAI app's tools and runs none
 * of them.
 *
 * The real tools act on a user's food diary and live on the server. Claude only
 * needs to *ask* for them properly — with real names and typed arguments — so
 * this lists the definitions it is given and acknowledges each call. The worker
 * reads the calls Claude made off its output stream and sends them to the
 * server, which is the only thing that ever executes one.
 *
 *   node mcp-tools.mjs <tools.json>
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tools = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // a notification: nothing to answer
  const ok = (result) => send({ jsonrpc: '2.0', id: msg.id, result });

  switch (msg.method) {
    case 'initialize':
      ok({
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nutriai-app', version: '1.0.0' },
      });
      break;
    case 'tools/list':
      ok({ tools: tools.map(({ optimistic, ...tool }) => tool) });
      break;
    case 'tools/call': {
      // A plain save is acknowledged as done, so Claude can write the user's
      // confirmation in the same run; the server shows that confirmation only
      // if the real call then succeeds. Everything else has a result Claude
      // needs to see first, so it is told to stop and wait.
      const optimistic = tools.find((t) => t.name === msg.params?.name)?.optimistic;
      ok({
        content: [
          {
            type: 'text',
            text: optimistic
              ? 'Saved.'
              : 'Queued. The app runs this call now and shows you its result in the next step. Stop here: make no call that depends on this result, and write no reply yet.',
          },
        ],
      });
      break;
    }
    case 'ping':
      ok({});
      break;
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
