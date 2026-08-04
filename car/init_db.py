#!/usr/bin/env python3
"""One-time (idempotent) setup: create listings.db from schema.sql and seed
sources_status with the candidate sources to test. Safe to re-run."""
import sqlite3
from pathlib import Path

DIR = Path(__file__).parent
DB_PATH = DIR / "listings.db"
SCHEMA_PATH = DIR / "schema.sql"

SEED_SOURCES = [
    ("craigslist", "untested", "", "", "untested", "-", "NYC + Rockland/lower Hudson Valley bikes categories."),
    ("facebook_marketplace", "untested", "", "", "untested", "-", "Requires login; likely to need manual paste-in workflow."),
    ("ebay", "untested", "", "", "untested", "-", "Local pickup filter for NYC/Nyack area."),
    ("theproscloset", "untested", "", "", "untested", "-", "Used high-end bike marketplace, inspects/certifies bikes."),
    ("bikeexchange", "untested", "", "", "untested", "-", "Marketplace + classifieds."),
    ("pinkbike", "untested", "", "", "untested", "-", "Buy/sell classifieds, more MTB-leaning but has road/gravel."),
]


def main():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        for row in SEED_SOURCES:
            conn.execute(
                "INSERT OR IGNORE INTO sources_status "
                "(source, automatable, last_attempt, last_success, status, method, notes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                row,
            )
        conn.commit()
    print(f"Initialized {DB_PATH}")


if __name__ == "__main__":
    main()
