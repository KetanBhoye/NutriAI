# Postgres migrations

`0001`–`0008` are generated from `migrations/portable` by
`deploy/postgres/gen-pg-migrations.py`, then reviewed by hand. `0009` onwards are
Postgres-only and are **not** generated — the script never deletes files, but do
not expect it to recreate them either.

Which directory runs is chosen by `DB_DRIVER` (see `src/db/open.ts`). Production
runs SQLite from `migrations/portable`; the `dev` environment runs Postgres.

## What the translation changes, and why

**`PRAGMA foreign_keys = ON` is dropped.** SQLite needs it per-connection;
Postgres enforces foreign keys unconditionally.

**`REAL` becomes `double precision`.** SQLite's `REAL` is a 64-bit float.
Postgres' `REAL` is 32-bit, so a literal mapping would silently round every
weight and macro in the database.

**`TEXT ... DEFAULT CURRENT_TIMESTAMP` becomes an explicit `to_char(...)`.**
Two reasons. Postgres' `CURRENT_TIMESTAMP` is a `timestamptz` and will not
assign to a `TEXT` column at all; and even cast, it renders
`2026-08-17 01:34:27.123456+00`, which does not match the
`2026-08-17 01:34:27` already stored in every row. The app compares these as
plain strings, so the formats have to agree.

The same substitution is applied at runtime to the 24 statements that write
`CURRENT_TIMESTAMP` from application code — see `src/db/sql-placeholders.ts`.

**`CURRENT_DATE` is left alone.** It targets real `date` columns, where
Postgres' own value is already correct.

**Integer booleans stay integers.** `is_admin`, `is_active` and `verified` are
`INTEGER` holding 0/1. Postgres would happily take `boolean`, but the driver
would then return `true`/`false` where the app expects 0/1.

## Things that are not in the DDL but matter

- **`date` columns are parsed back to strings** by a type parser in
  `src/db/pg-adapter.ts`. By default `pg` returns a JS `Date`, which breaks
  `entry_date.split('-')` and shifts the day for anyone west of UTC.
- **Expiry comparisons bind an ISO string** rather than using `datetime()`.
  See `src/db/time.ts` — the two stored timestamp formats do not sort against
  each other, and getting it wrong keeps expired sessions alive.
- **`ON CONFLICT DO UPDATE` must qualify the existing row** (`daily_activity.steps`,
  not `steps`). Postgres calls a bare name ambiguous; SQLite accepts it.

## Regenerating

```bash
python3 deploy/postgres/gen-pg-migrations.py
```

Then re-run the verification below. Do not hand-edit `0001`–`0008`; change the
portable file or the generator.

## Verifying a change

```bash
# 1. Schema applies to an empty database, via the app itself
dropdb --if-exists nutriai_dev && createdb nutriai_dev
DB_DRIVER=postgres DATABASE_URL=postgresql://localhost/nutriai_dev \
  ADMIN_API_KEY=devkey123 PORT=8799 pnpm start

# 2. Real data loads
node deploy/postgres/sqlite-to-postgres.mjs backups/<latest>.db postgresql://localhost/nutriai_dev

# 3. Responses match SQLite byte for byte
#    Boot the same code on the same backup with DB_DRIVER=sqlite on another
#    port and diff the JSON. This is what caught the date(), ambiguous-column
#    and Date-object bugs; a "returns 200" check would not have.
```
