#!/usr/bin/env python3
"""One-time (idempotent) setup: create listings.db from schema.sql and seed
the singleton project row. Safe to re-run - INSERT OR IGNORE means it never
overwrites a project row that already exists.

Fill in whatever you know now; anything left blank can be filled in later
via the gallery's Project Settings panel. If a config/criteria.md or
config/offer_template.md exists next to this script (your filled-in copies
of templates/criteria.md / templates/offer_template.md), it's read
automatically - config/ is where personal instructions the app reads live,
as opposed to the public, generic templates/ this repo ships. Override
either path with --criteria-file/--offer-file. A config/sources_status.csv
(same columns as templates/sources_status.csv) seeds the sources_status
table the same way.

Set SHORTLIST_PROJECT to create the db in a project folder other than the
one this script sits in (see project_dir.py).
"""
import argparse
import csv
import sqlite3
from datetime import date
from pathlib import Path

from project_dir import APP_DIR, PROJECT_DIR

DB_PATH = PROJECT_DIR / "listings.db"
SCHEMA_PATH = APP_DIR / "schema.sql"
CONFIG_DIR = PROJECT_DIR / "config"
SOURCES_COLUMNS = ("source", "automatable", "last_attempt", "last_success", "status", "method", "notes")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--object", default="", help="what you're searching for, e.g. 'carbon gravel bike, 58cm'")
    p.add_argument("--budget", default="")
    p.add_argument("--search-area", default="")
    p.add_argument("--ship-to", default="", help="optional ship-to address")
    p.add_argument("--fulfillment", default="", help="e.g. 'local pickup only', 'ships nationwide', 'either'")
    p.add_argument("--criteria-file", default="", help="defaults to config/criteria.md if present")
    p.add_argument("--offer-file", default="", help="defaults to config/offer_template.md if present")
    p.add_argument("--sources-file", default="", help="defaults to config/sources_status.csv if present")
    args = p.parse_args()

    criteria_path = Path(args.criteria_file) if args.criteria_file else CONFIG_DIR / "criteria.md"
    offer_path = Path(args.offer_file) if args.offer_file else CONFIG_DIR / "offer_template.md"
    criteria_md = criteria_path.read_text(encoding="utf-8") if criteria_path.exists() else ""
    offer_template_md = offer_path.read_text(encoding="utf-8") if offer_path.exists() else ""
    sources_path = Path(args.sources_file) if args.sources_file else CONFIG_DIR / "sources_status.csv"
    sources = []
    if sources_path.exists():
        with sources_path.open(newline="", encoding="utf-8") as f:
            sources = [tuple(r.get(c, "") or "" for c in SOURCES_COLUMNS) for r in csv.DictReader(f)]

    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.execute(
            "INSERT OR IGNORE INTO project "
            "(id, object, budget, search_area, ship_to_address, fulfillment, "
            " criteria_md, offer_template_md, created_date) "
            "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                args.object, args.budget, args.search_area, args.ship_to, args.fulfillment,
                criteria_md, offer_template_md, date.today().isoformat(),
            ),
        )
        conn.executemany(
            f"INSERT OR IGNORE INTO sources_status ({', '.join(SOURCES_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in SOURCES_COLUMNS)})",
            sources,
        )
        conn.commit()
    print(f"Initialized {DB_PATH}")


if __name__ == "__main__":
    main()
