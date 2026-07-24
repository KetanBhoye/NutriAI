import { getGoogleAccessToken } from '../llm/google-auth.js';
import {
  addEntryHandler,
  listEntriesHandler,
  updateEntryHandler,
  deleteEntryHandler,
  getUserPreferencesHandler,
  setUserPreferencesHandler,
  getProfile,
  updateProfile,
  getProfileHistory,
  addBodyMeasurementHandler,
  listBodyMeasurementsHandler,
  listProgressPhotosHandler,
  compareProgressHandler,
} from '../../tools/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const DATE = { type: 'STRING', description: 'YYYY-MM-DD; omit for today' } as const;

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
    run: (_a, u, e) => getUserPreferencesHandler({ include_full_text: false } as never, u, e),
    declaration: {
      name: 'get_user_preferences',
      description: "Get the user's daily goals (calories, protein, carbs, fat) — use to reason about how much is left for the day.",
      parameters: { type: 'OBJECT', properties: {} },
    },
  },
  set_user_preferences: {
    run: (a, u, e) => setUserPreferencesHandler(a as never, u, e),
    declaration: {
      name: 'set_user_preferences',
      description: 'Change the daily goals. Only pass the fields the user wants to change.',
      parameters: {
        type: 'OBJECT',
        properties: {
          display_name: { type: 'STRING' },
          daily_calorie_goal: { type: 'INTEGER' },
          daily_protein_goal_g: { type: 'NUMBER' },
          daily_carbs_goal_g: { type: 'NUMBER' },
          daily_fat_goal_g: { type: 'NUMBER' },
        },
      },
    },
  },
  get_profile: {
    run: (_a, u, e) => getProfile({}, u, e),
    declaration: {
      name: 'get_profile',
      description: 'Get the user profile with height, age, gender, activity level and calculated BMR/TDEE.',
      parameters: { type: 'OBJECT', properties: {} },
    },
  },
  update_profile: {
    run: (a, u, e) => updateProfile(a as never, u, e),
    declaration: {
      name: 'update_profile',
      description:
        'Update profile and current body stats. Use for a quick weight update ("I weigh 71.2 now") or setting height/age/gender/activity. Only pass changed fields.',
      parameters: {
        type: 'OBJECT',
        properties: {
          height_cm: { type: 'NUMBER' },
          age: { type: 'INTEGER' },
          gender: { type: 'STRING', enum: ['male', 'female'] },
          activity_level: {
            type: 'STRING',
            enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
          },
          weight_kg: { type: 'NUMBER' },
          muscle_mass_kg: { type: 'NUMBER' },
          body_fat_percentage: { type: 'NUMBER' },
        },
      },
    },
  },
  get_profile_history: {
    run: (a, u, e) => getProfileHistory(a as never, u, e),
    declaration: {
      name: 'get_profile_history',
      description: 'Get historical weight / body-composition tracking, optionally within a date range.',
      parameters: {
        type: 'OBJECT',
        properties: { start_date: DATE, end_date: DATE, limit: { type: 'INTEGER' } },
      },
    },
  },
  add_body_measurement: {
    run: (a, u, e) => addBodyMeasurementHandler(a as never, u, e),
    declaration: {
      name: 'add_body_measurement',
      description:
        'Record a body-composition measurement (e.g. from a smart-scale reading). Use for a full scale entry; for just weight, update_profile is simpler.',
      parameters: {
        type: 'OBJECT',
        properties: {
          recorded_date: DATE,
          body_weight_kg: { type: 'NUMBER' },
          body_fat_ratio_pct: { type: 'NUMBER' },
          muscle_mass_kg: { type: 'NUMBER' },
          body_mass_index: { type: 'NUMBER' },
          basal_metabolic_rate_kcal: { type: 'NUMBER' },
          visceral_fat_pct: { type: 'NUMBER' },
          protein_mass_kg: { type: 'NUMBER' },
          notes: { type: 'STRING' },
        },
      },
    },
  },
  list_body_measurements: {
    run: (a, u, e) => listBodyMeasurementsHandler(a as never, u, e),
    declaration: {
      name: 'list_body_measurements',
      description: 'List past body-composition measurements for progress tracking.',
      parameters: {
        type: 'OBJECT',
        properties: { start_date: DATE, end_date: DATE, limit: { type: 'INTEGER' } },
      },
    },
  },
  compare_progress: {
    run: (a, u, e) => compareProgressHandler(a as never, u, e),
    declaration: {
      name: 'compare_progress',
      description: 'Compare body measurements between two dates to summarise change.',
      parameters: {
        type: 'OBJECT',
        properties: { from_date: DATE, to_date: DATE },
        required: ['from_date', 'to_date'],
      },
    },
  },
  list_progress_photos: {
    run: (a, u, e) => listProgressPhotosHandler(a as never, u, e),
    declaration: {
      name: 'list_progress_photos',
      description: 'List stored progress-photo references by date/pose.',
      parameters: {
        type: 'OBJECT',
        properties: {
          start_date: DATE,
          end_date: DATE,
          pose_type: { type: 'STRING', enum: ['front', 'back', 'left_side', 'right_side', 'other'] },
        },
      },
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
  return `You are the user's personal nutrition and fitness coach inside their tracking app. You act on their data with tools: log and correct food entries, read/change daily goals, update their profile and weight, record and review body-composition measurements, and compare progress.

Today is ${today}.

When the user describes food they ate, log it with add_entry (one call per item), working out realistic calories and macros. This user eats mostly Indian home-cooked food. Prefer their known foods and values when they match:
${knownFoods}

For questions about their data ("how much protein left?", "what did I weigh last week?", "am I on track?"), call the relevant read tools (list_entries, get_user_preferences, get_profile, list_body_measurements, compare_progress) and answer from the results — never guess.

A quick weight mention ("I'm 71.2 today") → update_profile with weight_kg. A full scale reading → add_body_measurement. Changing a target ("bump protein to 160") → set_user_preferences with only that field.

Be brief and direct. After acting, confirm what you did in one or two sentences. Never invent an id — always get it from list_entries before update/delete.`;
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

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: config.systemPrompt }] },
        contents: config.contents,
        tools: [{ functionDeclarations: Object.values(TOOLS).map((t) => t.declaration) }],
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
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
  console.log('[coach] minting token…');
  const token = await getGoogleAccessToken(opts.credentialJson);
  console.log('[coach] token ok, starting loop');

  const contents: GeminiContent[] = [
    ...opts.history.slice(-MAX_HISTORY),
    { role: 'user', parts: [{ text: opts.message }] },
  ];
  const actions: string[] = [];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    console.log(`[coach] step ${step}: calling vertex (${contents.length} turns)`);
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
    console.log(`[coach] step ${step}: ${calls.length} tool call(s): ${calls.map((c) => c.functionCall.name).join(',') || '(final text)'}`);
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
          console.log(`[coach] executing ${name}…`);
          const result = await tool.run(args, opts.userId, opts.env);
          text = result.content?.[0]?.type === 'text' ? (result.content[0] as { text: string }).text : 'ok';
          actions.push(name);
          console.log(`[coach] ${name} done`);
        } catch (error) {
          text = `Tool ${name} failed: ${error instanceof Error ? error.message : 'error'}`;
          console.log(`[coach] ${name} failed: ${text}`);
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
