#!/usr/bin/env python3
"""Insert one listing into listings.db and regenerate gallery.html.

id is assigned by SQLite's INTEGER PRIMARY KEY AUTOINCREMENT at insert time,
so there's no read-modify-write race between two writers computing "next id"
from a stale read.

Usage: fill in whichever fields you know; leave the rest as "" (default).
Run with --help for all fields.
"""
import argparse
import sqlite3
import subprocess
import sys
from datetime import date

from photo_cache import cache_photo
from project_dir import APP_DIR, PROJECT_DIR

DB_PATH = PROJECT_DIR / "listings.db"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", required=True, help="e.g. craigslist, facebook_marketplace, ebay, manual")
    p.add_argument("--url", required=True)
    p.add_argument("--photo-url", default="")
    p.add_argument("--title", default="")
    p.add_argument("--price", default="")
    p.add_argument("--location", default="")
    p.add_argument("--condition", default="")
    p.add_argument("--variant", default="", help="size, trim, or model variant, whatever's relevant to this category")
    p.add_argument("--key-specs", default="")
    p.add_argument("--fit-score", required=True, type=int, help="0-100+ per criteria.md rubric, modifiers included")
    p.add_argument("--status", default="new")
    p.add_argument("--notes", default="")
    p.add_argument("--dry-run", action="store_true", help="print the row without writing")
    args = p.parse_args()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        existing = conn.execute("SELECT id, status FROM listings WHERE url = ?", (args.url,)).fetchone()
        if existing:
            print(f"SKIPPED: url already tracked as id {existing['id']} (status={existing['status']})", file=sys.stderr)
            sys.exit(1)

        row = {
            "date_found": date.today().isoformat(),
            "source": args.source,
            "url": args.url,
            "photo_url": args.photo_url,
            "title": args.title,
            "price": args.price,
            "location": args.location,
            "condition": args.condition,
            "variant": args.variant,
            "key_specs": args.key_specs,
            "fit_score": args.fit_score,
            "status": args.status,
            "notes": args.notes,
        }

        if args.dry_run:
            print(row)
            return

        cur = conn.execute(
            "INSERT INTO listings "
            "(date_found, source, url, photo_url, title, price, location, condition, "
            " variant, key_specs, fit_score, status, notes) "
            "VALUES (:date_found, :source, :url, :photo_url, :title, :price, :location, "
            " :condition, :variant, :key_specs, :fit_score, :status, :notes)",
            row,
        )
        conn.commit()
        new_id = cur.lastrowid

        if args.photo_url:
            cached = cache_photo(args.photo_url, new_id)
            if cached:
                conn.execute("UPDATE listings SET photo_url = ? WHERE id = ?", (cached, new_id))
                conn.commit()

    print(f"Added id {new_id}: {args.title or args.url} (${args.price}, fit_score={args.fit_score})")
    subprocess.run([sys.executable, str(APP_DIR / "generate_gallery.py")], check=True)


if __name__ == "__main__":
    main()
