/**
 * Rewrites SQLite's positional `?` placeholders into Postgres `$1..$n`.
 *
 * Every repository in this codebase writes `?`, and there are far too many
 * call sites to convert by hand — so the translation happens here, once, and
 * the rest of the app stays dialect-agnostic.
 *
 * The reason this is its own module rather than three lines inside the adapter
 * is that a naive `query.replace(/\?/g, ...)` is *silently* wrong: a question
 * mark inside a string literal (`WHERE note = 'why?'`) or inside a comment is
 * not a placeholder, and rewriting it corrupts the query in a way that either
 * throws a confusing bind-count error or — worse — runs and returns the wrong
 * rows. So this walks the string and tracks what it is inside of.
 *
 * Postgres syntax that must be left alone:
 *   - `$$ … $$` dollar-quoted bodies (and `$tag$ … $tag$`)
 *   - `::jsonb` casts, which are colons, not placeholders, but sit next to them
 *   - `??`/`?|`/`?&` jsonb operators — see below
 */

/**
 * jsonb operators that begin with `?` and must not be treated as placeholders.
 * We do not use jsonb yet, but the migration is heading towards it, and a
 * `?|` silently rewritten to `$1|` is a bug that would be very hard to read.
 */
const JSONB_OPERATOR_SUFFIXES = new Set(['?', '|', '&']);

/**
 * Postgres' `CURRENT_TIMESTAMP` is a `timestamptz` and will not assign to the
 * TEXT columns this schema uses — 24 call sites write it into `created_at` /
 * `updated_at`. Rather than edit all 24, it is substituted here for an
 * expression that yields SQLite's exact rendering (`YYYY-MM-DD HH:MM:SS`, UTC),
 * so rows written through either driver stay byte-comparable. See db/time.ts.
 *
 * `CURRENT_DATE` is deliberately left alone: it targets real `date` columns,
 * where Postgres' own value is already correct.
 */
const PG_UTC_TIMESTAMP_TEXT = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

export interface RewrittenQuery {
  text: string;
  /** How many placeholders were substituted; used to sanity-check bind arity. */
  count: number;
}

export function toPositionalParams(query: string): RewrittenQuery {
  let out = '';
  let count = 0;
  let i = 0;

  while (i < query.length) {
    const char = query[i];
    const next = query[i + 1];

    // --- Single-quoted string literal: '…', with '' as an escaped quote. ---
    if (char === "'") {
      const end = scanQuoted(query, i, "'");
      out += query.slice(i, end);
      i = end;
      continue;
    }

    // --- Double-quoted identifier: "…", with "" as an escaped quote. ---
    if (char === '"') {
      const end = scanQuoted(query, i, '"');
      out += query.slice(i, end);
      i = end;
      continue;
    }

    // --- Line comment: -- … end of line ---
    if (char === '-' && next === '-') {
      const newline = query.indexOf('\n', i);
      const end = newline === -1 ? query.length : newline;
      out += query.slice(i, end);
      i = end;
      continue;
    }

    // --- Block comment: /* … */, which nests in Postgres. ---
    if (char === '/' && next === '*') {
      const end = scanBlockComment(query, i);
      out += query.slice(i, end);
      i = end;
      continue;
    }

    // --- Dollar-quoted body: $$ … $$ or $tag$ … $tag$ ---
    if (char === '$') {
      const tag = matchDollarTag(query, i);
      if (tag) {
        const close = query.indexOf(tag, i + tag.length);
        const end = close === -1 ? query.length : close + tag.length;
        out += query.slice(i, end);
        i = end;
        continue;
      }
    }

    // --- CURRENT_TIMESTAMP, but only as a whole word. ---
    if ((char === 'C' || char === 'c') && matchesKeyword(query, i, 'CURRENT_TIMESTAMP')) {
      out += PG_UTC_TIMESTAMP_TEXT;
      i += 'CURRENT_TIMESTAMP'.length;
      continue;
    }

    // --- An actual placeholder. ---
    if (char === '?') {
      // `??`, `?|`, `?&` are jsonb operators, not placeholders.
      if (next !== undefined && JSONB_OPERATOR_SUFFIXES.has(next)) {
        out += char + next;
        i += 2;
        continue;
      }
      count += 1;
      out += `$${count}`;
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  return { text: out, count };
}

/**
 * Whole-word, case-insensitive keyword match. The word-boundary check matters:
 * a column named `current_timestamp_utc` must not be partially rewritten.
 */
function matchesKeyword(query: string, start: number, keyword: string): boolean {
  const slice = query.slice(start, start + keyword.length);
  if (slice.toUpperCase() !== keyword) return false;
  const before = start > 0 ? query[start - 1] : '';
  const after = query[start + keyword.length] ?? '';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(char: string): boolean {
  return char !== '' && /[A-Za-z0-9_]/.test(char);
}

/**
 * Returns the index just past the closing quote. A doubled quote ('' or "")
 * is an escaped quote and does not close the literal.
 */
function scanQuoted(query: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < query.length) {
    if (query[i] === quote) {
      if (query[i + 1] === quote) {
        i += 2; // Escaped quote — keep going.
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  // Unterminated literal. Hand the rest back untouched and let Postgres
  // produce the syntax error; inventing one here would only obscure it.
  return query.length;
}

/** Returns the index just past the matching close marker, honouring nesting. */
function scanBlockComment(query: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < query.length) {
    if (query[i] === '/' && query[i + 1] === '*') {
      depth += 1;
      i += 2;
      continue;
    }
    if (query[i] === '*' && query[i + 1] === '/') {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return query.length;
}

/**
 * If a dollar-quote tag opens at `start`, returns it (e.g. `$$` or `$fn$`).
 * Returns null for `$1`, which is an already-positional parameter.
 */
function matchDollarTag(query: string, start: number): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(query.slice(start));
  return match ? match[0] : null;
}
