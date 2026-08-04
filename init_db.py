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
either path with --criteria-file/--offer-file.
"""
import argparse
import sqlite3
from datetime import date
from pathlib import Path

DIR = Path(__file__).parent
DB_PATH = DIR / "listings.db"
SCHEMA_PATH = DIR / "schema.sql"
CONFIG_DIR = DIR / "config"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--object", default="", help="what you're searching for, e.g. 'carbon gravel bike, 58cm'")
    p.add_argument("--budget", default="")
    p.add_argument("--search-area", default="")
    p.add_argument("--ship-to", default="", help="optional ship-to address")
    p.add_argument("--fulfillment", default="", help="e.g. 'local pickup only', 'ships nationwide', 'either'")
    p.add_argument("--criteria-file", default="", help="defaults to config/criteria.md if present")
    p.add_argument("--offer-file", default="", help="defaults to config/offer_template.md if present")
    args = p.parse_args()

    criteria_path = Path(args.criteria_file) if args.criteria_file else CONFIG_DIR / "criteria.md"
    offer_path = Path(args.offer_file) if args.offer_file else CONFIG_DIR / "offer_template.md"
    criteria_md = criteria_path.read_text(encoding="utf-8") if criteria_path.exists() else ""
    offer_template_md = offer_path.read_text(encoding="utf-8") if offer_path.exists() else ""

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
        conn.commit()
    print(f"Initialized {DB_PATH}")


if __name__ == "__main__":
    main()
