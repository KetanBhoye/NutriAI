import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './client';
import * as entriesApi from './entries';
import * as goalsApi from './goals';
import type { CreateEntryInput } from './entries';
import type { GoalPlanInput } from './goals';
import type { FoodEntry, MealType } from '../types';

/**
 * Durable queue for the writes a user would hate to lose.
 *
 * Reads are cached (src/cache.ts), but writes used to go straight out and be
 * rolled back with an alert whenever the network was unavailable — so logging
 * a meal in a lift or on the Underground simply lost it. Writes now land here
 * first and drain when connectivity returns.
 *
 * Covers food entries, weigh-ins/steps and the plan itself. The weigh-in is the
 * one that matters most: it can't be reconstructed later (you can remember what
 * you ate; you cannot remember what the scale said), and the whole adaptive
 * plan is fitted to those readings.
 *
 * Mirrors the web app's queue: oldest-first, **stop at the first failure** so
 * ordering holds, and drop 4xx rather than retrying forever behind a write the
 * server will never accept.
 */

const QUEUE_KEY = 'nutriai.pending.v2';

export type EntryPatch = Partial<
  Pick<FoodEntry, 'food_name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'meal_type' | 'quantity' | 'unit'>
>;

export interface ActivityInput {
  activity_date: string;
  weight_kg?: number | null;
  steps?: number | null;
  exercise_minutes?: number | null;
  exercise_type?: string | null;
  /** Net energy above resting — see `src/exercise.ts`. */
  exercise_kcal?: number | null;
}

type QueuedOp =
  | { id: string; kind: 'create'; tempId: string; body: CreateEntryInput }
  | { id: string; kind: 'update'; entryId: string; changes: EntryPatch }
  | { id: string; kind: 'delete'; entryId: string }
  | { id: string; kind: 'activity'; body: ActivityInput }
  | { id: string; kind: 'goals'; body: GoalPlanInput };

/** Which parts of the app a queued write belongs to, for reporting failures. */
export type OpKind = QueuedOp['kind'];

/** Local ids for rows that haven't reached the server yet. */
export function isPendingId(id: string): boolean {
  return id.startsWith('tmp-');
}

export function newPendingId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── persistence ───────────────────────────────────────────────────────────

async function read(): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

async function write(ops: QueuedOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // Nothing useful to do; the in-memory optimistic row still shows.
  }
  notify(ops.length);
}

// ── subscribers ───────────────────────────────────────────────────────────

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let pending = 0;

function notify(count: number): void {
  pending = count;
  for (const l of listeners) l(count);
}

export function subscribePending(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
}

/**
 * Writes the server refused. Dropping a 4xx is right — retrying can't fix it —
 * but doing it silently meant a rejected edit just reappeared with its old
 * values on the next refresh, looking like the app had ignored the save.
 */
type RejectionListener = (kind: OpKind, message: string) => void;
const rejectionListeners = new Set<{ kinds: OpKind[]; listener: RejectionListener }>();

/**
 * Subscribes to refusals of the given kinds. The queue is shared across
 * screens, so each states what it can speak for — Today shouldn't announce a
 * rejected plan save, and the Plan tab shouldn't announce a rejected meal.
 */
export function subscribeRejections(kinds: OpKind[], listener: RejectionListener): () => void {
  const entry = { kinds, listener };
  rejectionListeners.add(entry);
  return () => rejectionListeners.delete(entry);
}

function notifyRejected(kind: OpKind, message: string): void {
  for (const { kinds, listener } of rejectionListeners) {
    if (kinds.includes(kind)) listener(kind, message);
  }
}

export async function refreshPendingCount(): Promise<void> {
  notify((await read()).length);
}

// ── enqueueing ────────────────────────────────────────────────────────────

const opId = () => `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export async function enqueueCreate(tempId: string, body: CreateEntryInput): Promise<void> {
  const ops = await read();
  ops.push({ id: opId(), kind: 'create', tempId, body });
  await write(ops);
}

/**
 * Editing a row whose create is still queued must rewrite that create rather
 * than PATCH an id the server has never seen — otherwise the original values
 * would sync and silently overwrite the edit.
 */
export async function enqueueUpdate(entryId: string, changes: EntryPatch): Promise<void> {
  const ops = await read();

  if (isPendingId(entryId)) {
    const create = ops.find((o) => o.kind === 'create' && o.tempId === entryId);
    if (create && create.kind === 'create') {
      Object.assign(create.body, stripUndefined(changes));
      await write(ops);
      return;
    }
  }

  ops.push({ id: opId(), kind: 'update', entryId, changes });
  await write(ops);
}

/** Deleting a still-queued create just drops it — nothing was ever sent. */
export async function enqueueDelete(entryId: string): Promise<void> {
  let ops = await read();

  if (isPendingId(entryId)) {
    ops = ops.filter((o) => !(o.kind === 'create' && o.tempId === entryId));
    await write(ops);
    return;
  }

  ops.push({ id: opId(), kind: 'delete', entryId });
  await write(ops);
}

/**
 * Queues a weigh-in / step count, merging into a pending one for the same day.
 *
 * The endpoint upserts per day, so two queued writes for one date would mean
 * the second overwriting the first's fields with nulls — log a weight, then
 * steps, and the weight would vanish on sync. Merging keeps both, and only
 * fields that were actually supplied are carried.
 */
export async function enqueueActivity(input: ActivityInput): Promise<void> {
  const ops = await read();
  const pendingForDay = ops.find(
    (o): o is Extract<QueuedOp, { kind: 'activity' }> =>
      o.kind === 'activity' && o.body.activity_date === input.activity_date
  );

  if (pendingForDay) {
    Object.assign(pendingForDay.body, stripNullish(input));
    await write(ops);
    return;
  }

  ops.push({ id: opId(), kind: 'activity', body: input });
  await write(ops);
}

/**
 * Queues a plan save. Only the newest survives — an older pending plan is not
 * a change anyone still wants, and replaying both would briefly restore the one
 * the user already moved on from.
 */
export async function enqueueGoals(plan: GoalPlanInput): Promise<void> {
  const ops = (await read()).filter((o) => o.kind !== 'goals');
  ops.push({ id: opId(), kind: 'goals', body: plan });
  await write(ops);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** As above, but null also means "not supplied" — see `enqueueActivity`. */
function stripNullish<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;
}

// ── draining ──────────────────────────────────────────────────────────────

let flushing = false;

/**
 * Sends queued writes oldest-first. Returns the number that synced.
 * Safe to call often — concurrent calls collapse into the one in flight.
 */
export async function flush(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let synced = 0;

  try {
    let ops = await read();

    while (ops.length > 0) {
      const next = ops[0]!;
      try {
        if (next.kind === 'create') {
          await entriesApi.createEntry(next.body);
        } else if (next.kind === 'update') {
          await entriesApi.updateEntry(next.entryId, next.changes);
        } else if (next.kind === 'delete') {
          await entriesApi.deleteEntry(next.entryId);
        } else if (next.kind === 'activity') {
          await goalsApi.logActivity(next.body);
        } else {
          await goalsApi.saveGoals(next.body);
        }
        ops = ops.slice(1);
        await write(ops);
        synced += 1;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        // 4xx will never succeed on retry (and a 404 delete is already the
        // outcome we wanted) — drop it rather than wedging the queue, but say
        // so: the row is about to snap back to the server's version.
        if (status >= 400 && status < 500) {
          ops = ops.slice(1);
          await write(ops);
          if (!(next.kind === 'delete' && status === 404)) {
            notifyRejected(next.kind, e instanceof ApiError ? e.message : 'The server rejected that change.');
          }
          continue;
        }
        // Network or 5xx: stop here so ordering is preserved, try again later.
        break;
      }
    }
  } finally {
    flushing = false;
  }

  return synced;
}

/** Meal type helper kept here so callers don't import the queue's op shapes. */
export type { MealType };
