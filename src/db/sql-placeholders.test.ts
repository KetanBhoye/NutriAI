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
