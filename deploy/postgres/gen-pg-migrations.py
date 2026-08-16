#!/usr/bin/env python3
"""Translate the portable (SQLite) migrations into Postgres DDL.

Run once; the output is committed and reviewed as ordinary source. This exists
so the translation is reproducible and the diff is auditable, not because the
files are meant to stay generated.
"""
import re
import pathlib

SRC = pathlib.Path("migrations/portable")
DST = pathlib.Path("migrations/postgres")

# SQLite's CURRENT_TIMESTAMP renders 'YYYY-MM-DD HH:MM:SS' in UTC. Postgres'
# renders '2026-08-17 01:34:27.123456+05:30' and is timestamptz, which will not
# even assign to a TEXT column. Matching SQLite's exact format keeps the copied
# rows and the newly written rows comparable as plain strings, which is what
# every query in this codebase does.
UTC_NOW_TEXT = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"

HEADER = """-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.
"""


def translate(sql: str) -> str:
    # `PRAGMA` is SQLite-only. Postgres enforces foreign keys unconditionally.
    sql = re.sub(r"^PRAGMA[^;]*;\n?", "", sql, flags=re.MULTILINE)

    # SQLite REAL is a 64-bit float. Postgres REAL is 32-bit, so mapping it
    # literally would quietly round every weight and macro.
    sql = re.sub(r"\bREAL\b", "double precision", sql)

    # TEXT columns defaulting to a timestamp need an explicit, format-matched
    # expression (see UTC_NOW_TEXT above).
    sql = re.sub(
        r"\bTEXT(\s+NOT\s+NULL)?\s+DEFAULT\s+CURRENT_TIMESTAMP\b",
        lambda m: f"TEXT{m.group(1) or ''} DEFAULT {UTC_NOW_TEXT}",
        sql,
    )

    return HEADER + "\n" + sql.lstrip("\n")


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for path in sorted(SRC.glob("*.sql")):
        out = DST / path.name
        out.write_text(translate(path.read_text()))
        print(f"{path} -> {out}")


if __name__ == "__main__":
    main()
