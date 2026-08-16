import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The durable write queue.
 *
 * Everything here exists because a write was once lost: meals logged with no
 * signal, an edit the server refused that silently reverted, a weigh-in that
 * can't be reconstructed from memory. The API modules are mocked so each test
 * can decide exactly how the network behaves.
 */

const createEntry = vi.fn();
const updateEntry = vi.fn();
const deleteEntry = vi.fn();
const logActivity = vi.fn();
const saveGoals = vi.fn();

vi.mock('./entries', () => ({
  createEntry: (...args: unknown[]) => createEntry(...args),
  updateEntry: (...args: unknown[]) => updateEntry(...args),
  deleteEntry: (...args: unknown[]) => deleteEntry(...args),
}));

vi.mock('./goals', () => ({
  logActivity: (...args: unknown[]) => logActivity(...args),
  saveGoals: (...args: unknown[]) => saveGoals(...args),
}));

// Static, not dynamic: `vi.mock` is hoisted above these, so the queue still
// picks up the mocked API modules.
import { ApiError } from './client';
import {
  enqueueActivity,
  enqueueCreate,
  enqueueDelete,
  enqueueGoals,
  enqueueUpdate,
  flush,
  isPendingId,
  newPendingId,
  refreshPendingCount,
  subscribePending,
  subscribeRejections,
} from './queue';

const meal = (name: string) => ({ food_name: name, calories: 300, meal_type: 'lunch' as const });
const plan = (calories: number) => ({
  start_weight_kg: 70,
  start_date: '2026-07-01',
  goal_weight_kg: 68,
  target_date: '2026-08-30',
  tolerance_kg: 0.3,
  daily_step_goal: 10000,
  weekly_training_days: 4,
  daily_calorie_goal: calories,
});

/** A rejection the server would never accept on retry. */
const rejects = (status: number) => vi.fn().mockRejectedValue(new ApiError(status, 'nope'));
/** A connection failure — worth retrying later. `status` 0 is what the client
 *  uses when the request never reached a server. */
const offline = () => vi.fn().mockRejectedValue(new ApiError(0, 'network'));

beforeEach(() => {
  vi.clearAllMocks();
  createEntry.mockResolvedValue({ success: true });
  updateEntry.mockResolvedValue({ success: true });
  deleteEntry.mockResolvedValue({ success: true });
  logActivity.mockResolvedValue({ ok: true });
  saveGoals.mockResolvedValue({ ok: true });
});

describe('pending ids', () => {
  it('marks rows that have never reached the server', () => {
    expect(isPendingId(newPendingId())).toBe(true);
    expect(isPendingId('9f0c1d2e-real-id')).toBe(false);
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPendingId()));
    expect(ids.size).toBe(50);
  });
});

describe('flush', () => {
  it('sends queued writes oldest first', async () => {
    const order: string[] = [];
    createEntry.mockImplementation(async (body: { food_name: string }) => {
      order.push(body.food_name);
    });

    await enqueueCreate(newPendingId(), meal('porridge'));
    await enqueueCreate(newPendingId(), meal('dal'));

    expect(await flush()).toBe(2);
    expect(order).toEqual(['porridge', 'dal']);
  });

  it('empties the queue on success', async () => {
    await enqueueCreate(newPendingId(), meal('porridge'));
    await flush();
    expect(await flush()).toBe(0);
  });

  it('keeps a write that failed on the network, and retries it later', async () => {
    createEntry.mockImplementationOnce(offline());

    await enqueueCreate(newPendingId(), meal('porridge'));
    expect(await flush()).toBe(0);

    // Still queued — this is the whole point of the thing.
    expect(await flush()).toBe(1);
    expect(createEntry).toHaveBeenCalledTimes(2);
  });

  it('stops at the first network failure so ordering holds', async () => {
    createEntry.mockImplementationOnce(offline());

    await enqueueCreate(newPendingId(), meal('porridge'));
    await enqueueCreate(newPendingId(), meal('dal'));
    await flush();

    // The second must not overtake the first.
    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it('drops a write the server refuses rather than wedging the queue', async () => {
    updateEntry.mockImplementation(rejects(400));

    await enqueueUpdate('entry-1', { calories: 500 });
    await enqueueCreate(newPendingId(), meal('dal'));
    await flush();

    // The 4xx is gone and the meal behind it still went out.
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(await flush()).toBe(0);
  });

  it('reports a refused write to subscribers of that kind', async () => {
    updateEntry.mockImplementation(rejects(400));
    const heard: string[] = [];
    const unsub = subscribeRejections(['create', 'update', 'delete'], (kind) => heard.push(kind));

    await enqueueUpdate('entry-1', { calories: 500 });
    await flush();
    unsub();

    // Silence here is what made an edit look like it had saved and then revert.
    expect(heard).toEqual(['update']);
  });

  it('only tells subscribers about the kinds they asked for', async () => {
    saveGoals.mockImplementation(rejects(400));
    const today: string[] = [];
    const planTab: string[] = [];
    const unsubToday = subscribeRejections(['create', 'update', 'delete'], (k) => today.push(k));
    const unsubPlan = subscribeRejections(['activity', 'goals'], (k) => planTab.push(k));

    await enqueueGoals(plan(1800));
    await flush();
    unsubToday();
    unsubPlan();

    expect(today).toEqual([]);
    expect(planTab).toEqual(['goals']);
  });

  it('says nothing about a delete the server has already lost', async () => {
    deleteEntry.mockImplementation(rejects(404));
    const heard: string[] = [];
    const unsub = subscribeRejections(['create', 'update', 'delete'], (kind) => heard.push(kind));

    await enqueueDelete('entry-1');
    await flush();
    unsub();

    // A 404 on delete is the outcome the user wanted anyway.
    expect(heard).toEqual([]);
  });

  it('joins a flush already in flight instead of reporting nothing synced', async () => {
    /**
     * This used to return 0 to the second caller, and that 0 caused a real
     * bug: Today flushes on mount and on foreground, so a weigh-in saved in
     * that window saw `synced === 0`, told the user "saved on this device —
     * it'll sync when you're back online", and skipped its reload. The weight
     * had reached the server; the screen just never re-read it, so the number
     * looked stuck. A caller must be able to tell "someone else is sending"
     * from "nothing was sent".
     */
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    createEntry.mockImplementationOnce(() => inFlight);

    await enqueueCreate(newPendingId(), meal('porridge'));
    const first = flush();
    // Let the first flush reach the request before the second one starts.
    await Promise.resolve();
    const second = flush();

    release();

    // Both callers learn the truth...
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    // ...and the write still went out exactly once.
    expect(createEntry).toHaveBeenCalledTimes(1);
  });
});

describe('entry edits made before the create has synced', () => {
  it('rewrites the queued create instead of patching an unknown id', async () => {
    const tempId = newPendingId();
    await enqueueCreate(tempId, meal('porridge'));
    await enqueueUpdate(tempId, { calories: 450 });
    await flush();

    // One request, carrying the edit — patching a tmp- id would 404, and the
    // original calories would have synced over the top of the edit.
    expect(updateEntry).not.toHaveBeenCalled();
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(createEntry.mock.calls[0]![0]).toMatchObject({ food_name: 'porridge', calories: 450 });
  });

  it('ignores undefined fields when merging into the create', async () => {
    const tempId = newPendingId();
    await enqueueCreate(tempId, { ...meal('porridge'), protein_g: 12 });
    await enqueueUpdate(tempId, { calories: 450, protein_g: undefined });
    await flush();

    expect(createEntry.mock.calls[0]![0]).toMatchObject({ protein_g: 12, calories: 450 });
  });

  it('drops the create entirely when the row is deleted before it syncs', async () => {
    const tempId = newPendingId();
    await enqueueCreate(tempId, meal('porridge'));
    await enqueueDelete(tempId);

    expect(await flush()).toBe(0);
    expect(createEntry).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });
});

describe('weigh-ins and steps', () => {
  it('queues an activity write', async () => {
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4, steps: null });
    await flush();

    expect(logActivity).toHaveBeenCalledWith({
      activity_date: '2026-07-17',
      weight_kg: 69.4,
      steps: null,
    });
  });

  it('merges a second write for the same day instead of overwriting it', async () => {
    // Log a weight, then steps, both offline. The endpoint upserts per day, so
    // sending two writes would blank the weight with the second one's null.
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4, steps: null });
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: null, steps: 8200 });

    expect(await flush()).toBe(1);
    expect(logActivity).toHaveBeenCalledWith({
      activity_date: '2026-07-17',
      weight_kg: 69.4,
      steps: 8200,
    });
  });

  it('lets a corrected reading win for the same day', async () => {
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4 });
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.9 });
    await flush();

    expect(logActivity).toHaveBeenCalledWith({ activity_date: '2026-07-17', weight_kg: 69.9 });
  });

  it('keeps different days apart', async () => {
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4 });
    await enqueueActivity({ activity_date: '2026-07-18', weight_kg: 69.2 });

    expect(await flush()).toBe(2);
  });

  it('survives being offline, which is the reason it is queued at all', async () => {
    logActivity.mockImplementationOnce(offline());

    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4 });
    expect(await flush()).toBe(0);
    expect(await flush()).toBe(1);
  });
});

describe('plan saves', () => {
  it('queues a plan write', async () => {
    await enqueueGoals(plan(1800));
    await flush();

    expect(saveGoals).toHaveBeenCalledTimes(1);
    expect(saveGoals.mock.calls[0]![0]).toMatchObject({ daily_calorie_goal: 1800 });
  });

  it('keeps only the newest plan', async () => {
    // Replaying an older plan would briefly restore targets the user has
    // already moved on from.
    await enqueueGoals(plan(1800));
    await enqueueGoals(plan(1750));

    expect(await flush()).toBe(1);
    expect(saveGoals.mock.calls[0]![0]).toMatchObject({ daily_calorie_goal: 1750 });
  });

  it('does not disturb other queued writes', async () => {
    await enqueueCreate(newPendingId(), meal('dal'));
    await enqueueGoals(plan(1800));
    await enqueueGoals(plan(1750));

    expect(await flush()).toBe(2);
    expect(createEntry).toHaveBeenCalledTimes(1);
  });
});

describe('pending count', () => {
  it('tracks what is still waiting, including across a restart', async () => {
    const seen: number[] = [];
    const unsub = subscribePending((n) => seen.push(n));

    await enqueueCreate(newPendingId(), meal('porridge'));
    await enqueueActivity({ activity_date: '2026-07-17', weight_kg: 69.4 });
    await flush();

    // Storage outlives the process, so a fresh subscriber must be able to
    // recover the count rather than reporting zero.
    await refreshPendingCount();
    unsub();

    expect(seen[0]).toBe(0);
    expect(Math.max(...seen)).toBe(2);
    expect(seen[seen.length - 1]).toBe(0);
  });
});
