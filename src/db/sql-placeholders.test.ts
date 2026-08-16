import { describe, expect, it } from 'vitest';
import { toPositionalParams } from './sql-placeholders.js';

const rewrite = (sql: string) => toPositionalParams(sql).text;

describe('the ordinary case', () => {
  it('numbers placeholders from one, in order', () => {
    expect(rewrite('SELECT * FROM users WHERE id = ? AND email = ?')).toBe(
      'SELECT * FROM users WHERE id = $1 AND email = $2'
    );
  });

  it('reports how many it substituted', () => {
    // The adapter compares this against the bind count, so an arity mismatch
    // surfaces as a clear error instead of a Postgres "bind message supplies
    // N parameters" further down.
    expect(toPositionalParams('INSERT INTO t (a, b, c) VALUES (?, ?, ?)').count).toBe(3);
  });

  it('leaves a query with no placeholders exactly as it was', () => {
    const sql = 'SELECT COUNT(*) FROM food_entries';
    expect(rewrite(sql)).toBe(sql);
  });
});

describe('question marks that are not placeholders', () => {
  // This is the whole reason the module exists. Each of these would be
  // corrupted by a naive global replace, and the corruption is silent.

  it('ignores one inside a string literal', () => {
    expect(rewrite("SELECT * FROM notes WHERE body = 'why?' AND id = ?")).toBe(
      "SELECT * FROM notes WHERE body = 'why?' AND id = $1"
    );
  });

  it('keeps counting correctly after a literal that contains one', () => {
    // The danger is not just the stray '?' — it is that mis-handling it
    // shifts every subsequent number, so the query still runs and returns
    // the wrong rows.
    const { text, count } = toPositionalParams(
      "SELECT * FROM t WHERE a = ? AND note = 'huh?' AND b = ?"
    );
    expect(text).toBe("SELECT * FROM t WHERE a = $1 AND note = 'huh?' AND b = $2");
    expect(count).toBe(2);
  });

  it('handles an escaped quote inside a literal', () => {
    expect(rewrite("SELECT * FROM t WHERE a = 'it''s a ? mark' AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = 'it''s a ? mark' AND b = $1"
    );
  });

  it('ignores one inside a quoted identifier', () => {
    expect(rewrite('SELECT "weird?col" FROM t WHERE id = ?')).toBe(
      'SELECT "weird?col" FROM t WHERE id = $1'
    );
  });

  it('ignores one inside a line comment', () => {
    expect(rewrite('SELECT 1 -- is this a ? placeholder\nWHERE id = ?')).toBe(
      'SELECT 1 -- is this a ? placeholder\nWHERE id = $1'
    );
  });

  it('ignores one inside a block comment, including a nested one', () => {
    expect(rewrite('SELECT 1 /* a ? /* nested ? */ still comment */ WHERE id = ?')).toBe(
      'SELECT 1 /* a ? /* nested ? */ still comment */ WHERE id = $1'
    );
  });

  it('ignores one inside a dollar-quoted body', () => {
    expect(rewrite("SELECT $tag$ a ? body $tag$ WHERE id = ?")).toBe(
      "SELECT $tag$ a ? body $tag$ WHERE id = $1"
    );
  });

  it('leaves jsonb operators alone', () => {
    // `?`, `?|` and `?&` are jsonb key-existence operators. Rewriting the
    // first character of `?|` produces valid-looking SQL with wrong meaning.
    expect(rewrite("SELECT * FROM t WHERE payload ?| array['a'] AND id = ?")).toBe(
      "SELECT * FROM t WHERE payload ?| array['a'] AND id = $1"
    );
    expect(rewrite("SELECT * FROM t WHERE payload ?& array['a']")).toBe(
      "SELECT * FROM t WHERE payload ?& array['a']"
    );
  });
});

describe('things that already look like Postgres', () => {
  it('does not mistake $1 for a dollar-quote tag', () => {
    expect(rewrite('SELECT * FROM t WHERE a = $1 AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $1'
    );
    // Note the collision above is expected and is exactly why callers must not
    // mix styles; the adapter only ever receives `?`-style SQL.
  });

  it('leaves a cast alone', () => {
    expect(rewrite("SELECT expires_at::timestamptz FROM s WHERE id = ?")).toBe(
      "SELECT expires_at::timestamptz FROM s WHERE id = $1"
    );
  });
});

describe('malformed input', () => {
  it('does not hang or throw on an unterminated literal', () => {
    // Postgres should be the one to report the syntax error, with its own
    // position information — swallowing it here would make it harder to find.
    expect(() => rewrite("SELECT * FROM t WHERE a = 'unterminated ?")).not.toThrow();
  });

  it('does not hang on an unterminated block comment', () => {
    expect(() => rewrite('SELECT 1 /* never closed ?')).not.toThrow();
  });
});

describe('the real queries in this codebase', () => {
  it('handles the session lookup', () => {
    const { text, count } = toPositionalParams(
      "SELECT s.user_id FROM web_sessions s WHERE s.session_id = ? AND datetime(s.expires_at) > datetime('now')"
    );
    expect(count).toBe(1);
    expect(text).toContain('s.session_id = $1');
    // The `'now'` literal must survive untouched.
    expect(text).toContain("datetime('now')");
  });

  it('handles a multi-column upsert', () => {
    const { count } = toPositionalParams(
      `INSERT INTO daily_activity (id, user_id, activity_date, steps, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, activity_date) DO UPDATE SET
         steps = CASE WHEN excluded.source = 'apple_health' AND source = 'manual'
                 THEN steps ELSE COALESCE(excluded.steps, steps) END`
    );
    expect(count).toBe(5);
  });
});

describe('CURRENT_TIMESTAMP substitution', () => {
  // 24 call sites write CURRENT_TIMESTAMP into TEXT columns. Postgres refuses
  // (text <- timestamptz), and its own rendering would not match the format
  // already stored in the database anyway.
  it('rewrites it to an expression yielding SQLite-format UTC', () => {
    const out = rewrite('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    expect(out).toContain("to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
    expect(out).toContain('id = $1');
    expect(out).not.toContain('CURRENT_TIMESTAMP');
  });

  it('rewrites every occurrence in a multi-column insert', () => {
    const out = rewrite(
      'INSERT INTO users (id, created_at, updated_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    expect(out).not.toContain('CURRENT_TIMESTAMP');
    expect(out.match(/to_char/g)).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    expect(rewrite('SELECT current_timestamp')).toContain('to_char');
  });

  it('only matches whole words', () => {
    // A column called `current_timestamp_utc` must survive intact; a partial
    // rewrite would produce valid SQL naming a column that does not exist.
    const sql = 'SELECT current_timestamp_utc, my_current_timestamp FROM t';
    expect(rewrite(sql)).toBe(sql);
  });

  it('leaves one inside a string literal alone', () => {
    expect(rewrite("SELECT 'CURRENT_TIMESTAMP' AS label")).toBe(
      "SELECT 'CURRENT_TIMESTAMP' AS label"
    );
  });

  it('leaves CURRENT_DATE alone', () => {
    // It targets real `date` columns, where Postgres' own value is correct.
    expect(rewrite('SELECT * FROM t WHERE d = CURRENT_DATE')).toBe(
      'SELECT * FROM t WHERE d = CURRENT_DATE'
    );
  });

  it('does not disturb placeholder numbering', () => {
    const { text, count } = toPositionalParams(
      'UPDATE t SET a = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    expect(count).toBe(2);
    expect(text).toContain('a = $1');
    expect(text).toContain('id = $2');
  });
});
