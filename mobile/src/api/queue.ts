import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './client';
import * as entriesApi from './entries';
import type { CreateEntryInput } from './entries';
import type { FoodEntry, MealType } from '../types';

/**
 * Durable queue for food-log writes.
 *
 * Reads are cached (src/cache.ts), but writes used to go straight out and be
 * rolled back with an alert whenever the network was unavailable — so logging
 * a meal in a lift or on the Underground simply lost it. Writes now land here
 * first and drain when connectivity returns.
 *
 * Mirrors the web app's queue: oldest-first, **stop at the first failure** so
 * ordering holds, and drop 4xx rather than retrying forever behind a write the
 * server will never accept.
 */

const QUEUE_KEY = 'nutriai.pending.v2';

export type EntryPatch = Partial<
  Pick<FoodEntry, 'food_name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'meal_type' | 'quantity' | 'unit'>
>;

type QueuedOp =
  | { id: string; kind: 'create'; tempId: string; body: CreateEntryInput }
  | { id: string; kind: 'update'; entryId: string; changes: EntryPatch }
  | { id: string; kind: 'delete'; entryId: string };

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

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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
        } else {
          await entriesApi.deleteEntry(next.entryId);
        }
        ops = ops.slice(1);
        await write(ops);
        synced += 1;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        // 4xx will never succeed on retry (and a 404 delete is already the
        // outcome we wanted) — drop it rather than wedging the queue.
        if (status >= 400 && status < 500) {
          ops = ops.slice(1);
          await write(ops);
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
