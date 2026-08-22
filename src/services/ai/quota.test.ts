import { describe, expect, it, vi } from 'vitest';
import { checkQuota, limitsFor, planFor, DAILY_PROJECT_CEILING_USD } from './quota.js';
import { costOf, GROUNDED_PER_QUERY, INPUT_PER_M, OUTPUT_PER_M } from './pricing.js';

/**
 * A fake DB that answers the three aggregate queries quota.ts asks, so the
 * decision logic can be tested without a database. The point of these tests is
 * the *order* and *precedence* of the checks, which is where the money is.
 */
function fakeDb(opts: {
  projectCost?: number;
  dayCalls?: number;
  monthCalls?: number;
  plan?: string | null;
  /** Admin-set spend caps for this user, if any. */
  capDailyUsd?: number | null;
  capMonthlyUsd?: number | null;
  /** What the user has spent across all features, for the cap checks. */
  spentDayUsd?: number;
  spentMonthUsd?: number;
}) {
  return {
    prepare(sql: string) {
      const isProject = sql.includes('FROM ai_usage WHERE created_at');
      const isPlan = sql.includes('SELECT plan FROM users');
      const isCaps = sql.includes('FROM user_ai_limits');
      // The spend-cap windows ask across every feature; the plan windows name
      // one. That is the only difference in the SQL, and it is what tells the
      // two apart here.
      const isPerFeature = sql.includes('AND feature = ?');
      let bound: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          bound = args;
          return this;
        },
        async first() {
          if (isPlan) return { plan: opts.plan ?? 'free' };
          if (isCaps) {
            return {
              daily_usd: opts.capDailyUsd ?? null,
              monthly_usd: opts.capMonthlyUsd ?? null,
            };
          }
          if (isProject) return { calls: 0, cost: opts.projectCost ?? 0, grounded: 0 };

          // Day and month windows run the same SQL and differ only in the
          // timestamp they bind, so that is what tells them apart — counting
          // calls instead made the answers depend on which checks ran first.
          const since = String(bound[1] ?? '');
          const isMonthWindow = Date.now() - Date.parse(`${since.replace(' ', 'T')}Z`) > 36 * 3600_000;

          if (!isPerFeature) {
            return {
              calls: 0,
              cost: isMonthWindow ? (opts.spentMonthUsd ?? 0) : (opts.spentDayUsd ?? 0),
              grounded: 0,
            };
          }
          return {
            calls: isMonthWindow ? (opts.monthCalls ?? 0) : (opts.dayCalls ?? 0),
            cost: 0,
            grounded: 0,
          };
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { changes: 0, meta: { changes: 0 } };
        },
      };
    },
    async exec() {},
  } as never;
}

describe('the project ceiling', () => {
  it('stops everyone once the daily budget is spent', async () => {
    // The only control that bounds the actual bill. Per-user limits assume the
    // problem is one user; this one covers a bug calling in a loop.
    const d = await checkQuota(fakeDb({ projectCost: DAILY_PROJECT_CEILING_USD }), 'u', 'free', 'coach');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('project_budget');
  });

  it('stops Pro users too', async () => {
    // Being a paying customer is not a reason to keep spending past the cap.
    const d = await checkQuota(fakeDb({ projectCost: DAILY_PROJECT_CEILING_USD + 1 }), 'u', 'pro', 'coach');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('project_budget');
  });

  it('is checked before per-user limits, so the reason is not misleading', async () => {
    // A user told "you've used your daily allowance" when the truth is a
    // project-wide halt would go and buy Pro and still be blocked.
    const d = await checkQuota(
      fakeDb({ projectCost: DAILY_PROJECT_CEILING_USD, dayCalls: 999 }),
      'u',
      'free',
      'coach'
    );
    expect(d.reason).toBe('project_budget');
  });

  it('allows normal traffic below the ceiling', async () => {
    expect((await checkQuota(fakeDb({ projectCost: 1 }), 'u', 'free', 'coach')).allowed).toBe(true);
  });
});

describe('per-user windows', () => {
  it('refuses once the daily cap is reached', async () => {
    const limit = limitsFor('free', 'coach').perDay;
    const d = await checkQuota(fakeDb({ dayCalls: limit }), 'u', 'free', 'coach');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily');
  });

  it('allows the call that sits exactly one below the cap', async () => {
    const limit = limitsFor('free', 'coach').perDay;
    expect((await checkQuota(fakeDb({ dayCalls: limit - 1 }), 'u', 'free', 'coach')).allowed).toBe(
      true
    );
  });

  it('refuses on the monthly cap even when today is quiet', async () => {
    // The reason both windows exist: a daily cap alone puts no bound on the
    // month, and someone at 9 calls a day for 30 days is not "within limits".
    const month = limitsFor('free', 'coach').perMonth;
    const d = await checkQuota(fakeDb({ dayCalls: 0, monthCalls: month }), 'u', 'free', 'coach');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('monthly');
  });

  it('gives Pro users more headroom than free on every feature', async () => {
    for (const f of ['parse', 'photo', 'coach', 'suggest', 'weekly'] as const) {
      expect(limitsFor('pro', f).perDay).toBeGreaterThan(limitsFor('free', f).perDay);
    }
  });
});

describe('features a plan does not include', () => {
  it('tells a free user grounded lookup is a Pro feature, not that they ran out', async () => {
    // Different message on purpose: "you've used your allowance" implies
    // waiting will help, and for this it never will.
    const d = await checkQuota(fakeDb({}), 'u', 'free', 'grounded');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('plan');
    expect(d.message).toMatch(/Pro/);
  });

  it('allows it for Pro', async () => {
    expect((await checkQuota(fakeDb({}), 'u', 'pro', 'grounded')).allowed).toBe(true);
  });
});

describe('what the user is told', () => {
  it('never blames them or sounds like an error', async () => {
    const decisions = [
      await checkQuota(fakeDb({ projectCost: DAILY_PROJECT_CEILING_USD }), 'u', 'free', 'coach'),
      await checkQuota(fakeDb({ dayCalls: 999 }), 'u', 'free', 'coach'),
      await checkQuota(fakeDb({}), 'u', 'free', 'grounded'),
    ];
    for (const d of decisions) {
      expect(d.message).toBeTruthy();
      const text = d.message!.toLowerCase();
      for (const word of ['error', 'failed', 'denied', 'forbidden', 'abuse']) {
        expect(text).not.toContain(word);
      }
    }
  });

  it('reassures that logging still works when AI is capped', async () => {
    // The whole "degrade, never refuse" rule in one assertion: a tracker that
    // appears broken at 4pm is a tracker people delete.
    const d = await checkQuota(fakeDb({ projectCost: DAILY_PROJECT_CEILING_USD }), 'u', 'free', 'coach');
    expect(d.message).toMatch(/logging still works/i);
  });
});

describe('plan resolution', () => {
  it('reads pro from the user row', async () => {
    expect(await planFor(fakeDb({ plan: 'pro' }), 'u')).toBe('pro');
  });

  it('treats anything unrecognised as free', async () => {
    expect(await planFor(fakeDb({ plan: 'enterprise' }), 'u')).toBe('free');
    expect(await planFor(fakeDb({ plan: null }), 'u')).toBe('free');
  });

  it('fails closed to free when the column is missing', async () => {
    // Before the migration lands. Handing out Pro limits by accident is the
    // one failure mode here that costs money.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            throw new Error('no such column: plan');
          },
        };
      },
    } as never;
    expect(await planFor(broken, 'u')).toBe('free');
    vi.restoreAllMocks();
  });
});

describe('pricing', () => {
  it('prices tokens at the published rates', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, groundedQueries: 0 })).toBeCloseTo(
      INPUT_PER_M,
      6
    );
    expect(costOf({ inputTokens: 0, outputTokens: 1_000_000, groundedQueries: 0 })).toBeCloseTo(
      OUTPUT_PER_M,
      6
    );
  });

  it('makes one grounded query cost more than a whole coach turn', () => {
    // The fact the whole design rests on: ~17x. If this ever stops being true
    // the Free/Pro split should be revisited.
    const coachTurn = costOf({ inputTokens: 2000, outputTokens: 500, groundedQueries: 0 });
    expect(GROUNDED_PER_QUERY / coachTurn).toBeGreaterThan(10);
  });

  it('does not apply the free grounding allowance per call', () => {
    // Applying it here would make a row's cost depend on the order rows were
    // written, so historical totals would not reproduce. It belongs in the
    // project-level check.
    expect(costOf({ inputTokens: 0, outputTokens: 0, groundedQueries: 1 })).toBe(
      GROUNDED_PER_QUERY
    );
  });
});

describe('per-user spend caps', () => {
  it('lets a user through while they are under their cap', async () => {
    const d = await checkQuota(
      fakeDb({ capMonthlyUsd: 2, spentMonthUsd: 1.2 }),
      'u',
      'pro',
      'coach'
    );

    expect(d.allowed).toBe(true);
  });

  it('refuses once the monthly spend cap is reached', async () => {
    const d = await checkQuota(
      fakeDb({ capMonthlyUsd: 2, spentMonthUsd: 2 }),
      'u',
      'pro',
      'coach'
    );

    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('user_budget');
  });

  it('refuses on the daily cap even when the month is fine', async () => {
    const d = await checkQuota(
      fakeDb({ capDailyUsd: 0.5, spentDayUsd: 0.6, capMonthlyUsd: 100, spentMonthUsd: 1 }),
      'u',
      'pro',
      'coach'
    );

    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('user_budget');
  });

  it('caps spending however it is spent, not per feature', async () => {
    // The point of a money cap: a user who has spent their allowance on
    // grounded lookups cannot carry on through the photo parser.
    const d = await checkQuota(
      fakeDb({ capMonthlyUsd: 1, spentMonthUsd: 1 }),
      'u',
      'pro',
      'photo'
    );

    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('user_budget');
  });

  it('applies no cap when an admin has not set one', async () => {
    const d = await checkQuota(fakeDb({ spentMonthUsd: 999 }), 'u', 'pro', 'coach');

    expect(d.allowed).toBe(true);
  });

  it('tells the user plainly, without blaming them', async () => {
    const d = await checkQuota(fakeDb({ capMonthlyUsd: 1, spentMonthUsd: 1 }), 'u', 'pro', 'coach');

    expect(d.message).toMatch(/allowance/i);
    expect(d.message).not.toMatch(/error|denied|forbidden/i);
  });
});
