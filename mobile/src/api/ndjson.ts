/**
 * Reading a newline-delimited JSON response as it arrives.
 *
 * React Native's `fetch` resolves only once the whole body is in hand — there
 * is no `ReadableStream` on the response — so it cannot report progress from a
 * request that takes a minute. `XMLHttpRequest` can: RN fires `onprogress` as
 * bytes land and exposes everything received so far in `responseText`.
 *
 * That is the entire trick, and it comes with one rule: `responseText` is
 * cumulative, not a delta. Reading it as a chunk would replay every earlier
 * line on every event, so this tracks how much has already been consumed.
 *
 * A partial trailing line is normal — a chunk boundary can fall mid-object —
 * so only complete lines are parsed, and the remainder waits for more bytes.
 */

export interface NdjsonOptions<T> {
  url: string;
  body: unknown;
  cookie: string | null;
  timeoutMs: number;
  onLine: (value: T) => void;
}

export class NdjsonError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Splits whatever has arrived into complete lines, returning the parsed ones
 * and the index to resume from. Exported for its own tests: this is where the
 * cumulative-buffer bug would live, and it is invisible from the UI.
 */
export function completeLines(text: string, consumed: number): { values: unknown[]; consumed: number } {
  const values: unknown[] = [];
  let cursor = consumed;

  for (;;) {
    const newline = text.indexOf('\n', cursor);
    if (newline === -1) break;

    const line = text.slice(cursor, newline).trim();
    cursor = newline + 1;
    if (!line) continue;

    try {
      values.push(JSON.parse(line));
    } catch {
      // A malformed line is skipped rather than thrown: losing one progress
      // update must never take down a turn that is otherwise fine.
    }
  }

  return { values, consumed: cursor };
}

/**
 * Resolves when the response ends. Every complete line is handed to `onLine`
 * as it arrives, including the last — the caller decides which line is the
 * result.
 */
export function readNdjson<T>(opts: NdjsonOptions<T>): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let consumed = 0;
    let settled = false;

    const fail = (status: number, message: string) => {
      if (settled) return;
      settled = true;
      reject(new NdjsonError(status, message));
    };

    const drain = () => {
      const { values, consumed: next } = completeLines(xhr.responseText ?? '', consumed);
      consumed = next;
      for (const value of values) opts.onLine(value as T);
    };

    xhr.open('POST', opts.url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/x-ndjson');
    if (opts.cookie) xhr.setRequestHeader('Cookie', opts.cookie);
    xhr.timeout = opts.timeoutMs;

    xhr.onprogress = () => {
      // Headers are available from HEADERS_RECEIVED onward; a non-2xx body is
      // an error payload, not progress, so leave it for onload to report.
      if (xhr.status >= 200 && xhr.status < 300) drain();
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(xhr.status, `Request failed (${xhr.status})`);
        return;
      }
      drain();
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    xhr.onerror = () => fail(0, 'Network error — check your connection.');
    xhr.ontimeout = () => fail(0, 'The coach took too long to answer.');

    xhr.send(JSON.stringify(opts.body));
  });
}
