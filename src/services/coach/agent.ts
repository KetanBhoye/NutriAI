import { getGoogleAccessToken } from '../llm/google-auth.js';
import {
  addEntryHandler,
  listEntriesHandler,
  updateEntryHandler,
  deleteEntryHandler,
  getUserPreferencesHandler,
} from '../../tools/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * The in-app Coach: a Gemini (Vertex AI) function-calling agent that acts on
 * the user's data through the SAME tool handlers the MCP server exposes. So the
 * app's assistant reaches the toolset directly — no Claude connector in the
 * loop — while every action still runs through the one audited implementation.
 */

type ToolFn = (args: Record<string, unknown>, userId: string, env: unknown) => Promise<CallToolResult>;

/** MCP tools surfaced to the agent, with their Gemini function declarations. */
const TOOLS: Record<string, { declaration: unknown; run: ToolFn }> = {
  add_entry: {
    run: (a, u, e) => addEntryHandler(a as never, u, e),
    declaration: {
      name: 'add_entry',
      description:
        'Log ONE food the user ate. You compute the calories and macros for the amount eaten, using the known foods listed in the system prompt and general nutrition knowledge (this user eats mostly Indian home cooking). Call once per distinct food; several calls in one turn are fine.',
      parameters: {
        type: 'OBJECT',
        properties: {
          food_name: { type: 'STRING', description: 'Name including quantity, e.g. "Chapati (2)"' },
          calories: { type: 'INTEGER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
          meal_type: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          entry_date: { type: 'STRING', description: 'YYYY-MM-DD; omit for today' },
        },
        required: ['food_name', 'calories', 'meal_type'],
      },
    },
  },
  list_entries: {
    run: (a, u, e) => listEntriesHandler({ ...(a as object), limit: 50 } as never, u, e),
    declaration: {
      name: 'list_entries',
      description:
        "List the user's food entries for a date (default today), with each entry's id and the daily totals. Use before deleting or updating, and to answer questions about what they ate or how much is left.",
      parameters: { type: 'OBJECT', properties: { date: { type: 'STRING', description: 'YYYY-MM-DD; omit for today' } } },
    },
  },
  update_entry: {
    run: (a, u, e) => updateEntryHandler(a as never, u, e),
    declaration: {
      name: 'update_entry',
      description: 'Correct an existing entry. Get its id from list_entries first.',
      parameters: {
        type: 'OBJECT',
        properties: {
          entry_id: { type: 'STRING' },
          food_name: { type: 'STRING' },
          calories: { type: 'INTEGER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
          meal_type: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        },
        required: ['entry_id'],
      },
    },
  },
  delete_entry: {
    run: (a, u, e) => deleteEntryHandler(a as never, u, e),
    declaration: {
      name: 'delete_entry',
      description: 'Delete a food entry by id (get ids from list_entries).',
      parameters: { type: 'OBJECT', properties: { entry_id: { type: 'STRING' } }, required: ['entry_id'] },
    },
  },
  get_user_preferences: {
    run: (_a, u, e) => getUserPreferencesHandler({} as never, u, e),
    declaration: {
      name: 'get_user_preferences',
      description: "Get the user's daily goals (calories, protein, carbs, fat) and profile — use to reason about how much is left for the day.",
      parameters: { type: 'OBJECT', properties: {} },
    },
  },
};

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface CoachTurn {
  reply: string;
  actions: string[];
  history: GeminiContent[];
}

const MAX_STEPS = 6;
const MAX_HISTORY = 24;

function buildSystemPrompt(today: string, knownFoods: string): string {
  return `You are the user's personal nutrition coach inside their food-tracking app. You can act on their log using tools — logging food, listing/correcting entries, and reading their goals.

Today is ${today}.

When the user describes food they ate, log it with add_entry (one call per item), working out realistic calories and macros. This user eats mostly Indian home-cooked food. Prefer their known foods and values when they match:
${knownFoods}

For questions about their day ("how much protein left?", "what did I have?"), call list_entries and get_user_preferences, then answer from the results — don't guess.

Be brief and direct. After logging, confirm what you recorded and the running total in one or two sentences. Never invent an entry id — always get it from list_entries before update/delete.`;
}

async function callVertex(config: {
  token: string;
  project: string;
  location: string;
  model: string;
  systemPrompt: string;
  contents: GeminiContent[];
}): Promise<GeminiContent> {
  const url =
    `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.project}` +
    `/locations/${config.location}/publishers/google/models/${encodeURIComponent(config.model)}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: config.systemPrompt }] },
      contents: config.contents,
      tools: [{ functionDeclarations: Object.values(TOOLS).map((t) => t.declaration) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Vertex chat failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { candidates?: Array<{ content?: GeminiContent }> };
  const content = data.candidates?.[0]?.content;
  if (!content) throw new Error('Vertex returned no content');
  return { role: 'model', parts: content.parts ?? [] };
}

/**
 * Runs one user turn: sends the message, executes any tool calls Gemini makes
 * against the user's data, and loops until it produces a final reply.
 */
export async function runCoachTurn(opts: {
  message: string;
  history: GeminiContent[];
  userId: string;
  env: unknown;
  knownFoods: string;
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}): Promise<CoachTurn> {
  const today = new Date().toLocaleDateString('en-CA');
  const systemPrompt = buildSystemPrompt(today, opts.knownFoods || '(none yet)');
  const token = await getGoogleAccessToken(opts.credentialJson);

  const contents: GeminiContent[] = [
    ...opts.history.slice(-MAX_HISTORY),
    { role: 'user', parts: [{ text: opts.message }] },
  ];
  const actions: string[] = [];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const modelTurn = await callVertex({
      token,
      project: opts.project,
      location: opts.location,
      model: opts.model,
      systemPrompt,
      contents,
    });
    contents.push(modelTurn);

    const calls = modelTurn.parts.filter((p): p is Required<Pick<GeminiPart, 'functionCall'>> =>
      Boolean(p.functionCall)
    );
    if (calls.length === 0) {
      const reply = modelTurn.parts
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      return { reply: reply || 'Done.', actions, history: contents };
    }

    // Execute every tool call in this turn, then feed all results back together.
    const responseParts: GeminiPart[] = [];
    for (const call of calls) {
      const name = call.functionCall.name;
      const args = call.functionCall.args ?? {};
      const tool = TOOLS[name];
      let text: string;
      if (!tool) {
        text = `Unknown tool: ${name}`;
      } else {
        try {
          const result = await tool.run(args, opts.userId, opts.env);
          text = result.content?.[0]?.type === 'text' ? (result.content[0] as { text: string }).text : 'ok';
          actions.push(name);
        } catch (error) {
          text = `Tool ${name} failed: ${error instanceof Error ? error.message : 'error'}`;
        }
      }
      responseParts.push({ functionResponse: { name, response: { output: text } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  // Hit the step cap — return a graceful message rather than looping forever.
  return {
    reply: "I did part of that but got stuck mid-way. Check your Today tab and tell me what's still needed.",
    actions,
    history: contents,
  };
}
