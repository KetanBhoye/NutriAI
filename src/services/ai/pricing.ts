/**
 * What a model call costs, in one place.
 *
 * These are Vertex list prices for gemini-2.5-flash. They are duplicated from
 * services/admin/usage.ts on purpose for now — that module estimates the whole
 * project's spend from Cloud Monitoring, this one prices a single call before
 * it is written to `ai_usage`. Keep them in step when rates change.
 */

/** USD per million input tokens. */
export const INPUT_PER_M = 0.3;

/** USD per million output tokens. */
export const OUTPUT_PER_M = 2.5;

/**
 * USD per grounded prompt, after the free daily allowance.
 *
 * This is the number that matters. At $0.035 a call it is roughly seventeen
 * coach turns, and it is the only line item that can produce a surprising bill
 * — which is why `grounded_queries` is metered separately from tokens and why
 * the shared food repo exists to avoid paying it twice for the same food.
 */
export const GROUNDED_PER_QUERY = 0.035;

/**
 * Gemini 2.5 models get 1,500 grounded prompts a day free across the project.
 * Charging from the first call overstates the bill at small scale; ignoring the
 * allowance entirely understates it at large scale. The budget check applies it
 * project-wide rather than per user, which is how Google bills it.
 */
export const GROUNDED_FREE_PER_DAY = 1500;

export interface CallCost {
  inputTokens: number;
  outputTokens: number;
  groundedQueries: number;
}

/**
 * The marginal cost of one call, ignoring the free grounding allowance —
 * applying that here would make each row's cost depend on the order rows were
 * written, which makes historical totals unreproducible. The allowance is
 * applied once, at the project level, in budget.ts.
 */
export function costOf({ inputTokens, outputTokens, groundedQueries }: CallCost): number {
  return (
    (inputTokens / 1_000_000) * INPUT_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_PER_M +
    groundedQueries * GROUNDED_PER_QUERY
  );
}
