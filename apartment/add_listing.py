#!/usr/bin/env python3
"""Append one listing to listings.csv safely (computes next id from the live file
at call time, so two writers close together don't collide) and regenerates gallery.html.

Usage: fill in whichever fields you know; unknowns should be passed as "unconfirmed"
(amenities) or left as "" (everything else). Run with --help for all fields.
"""
import argparse
import csv
import subprocess
import sys
from datetime import date
from pathlib import Path

DIR = Path(__file__).parent
CSV_PATH = DIR / "listings.csv"

FIELDS = [
    "id", "date_found", "source", "url", "photo_url", "neighborhood", "address",
    "price", "term_start", "term_end", "term_length", "bedrooms", "sqft",
    "ac", "in_unit_wd", "dishwasher", "near_west_side_hwy_or_uws",
    "near_brooklyn_trains", "near_central_park", "bucket", "fit_score",
    "status", "notes",
]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", required=True, help="e.g. streeteasy, zillow, manual, craigslist")
    p.add_argument("--url", required=True)
    p.add_argument("--photo-url", default="")
    p.add_argument("--neighborhood", default="")
    p.add_argument("--address", default="unspecified")
    p.add_argument("--price", required=True)
    p.add_argument("--term-start", default="")
    p.add_argument("--term-end", default="")
    p.add_argument("--term-length", default="unspecified")
    p.add_argument("--bedrooms", default="")
    p.add_argument("--sqft", default="")
    p.add_argument("--ac", default="unconfirmed")
    p.add_argument("--in-unit-wd", default="unconfirmed")
    p.add_argument("--dishwasher", default="unconfirmed")
    p.add_argument("--near-west-side-hwy-or-uws", default="unconfirmed")
    p.add_argument("--near-brooklyn-trains", default="unconfirmed")
    p.add_argument("--near-central-park", default="unconfirmed")
    p.add_argument("--bucket", required=True, choices=["monthly", "sublet", "other"])
    p.add_argument("--fit-score", required=True, type=int, choices=range(1, 11))
    p.add_argument("--status", default="new")
    p.add_argument("--notes", default="")
    p.add_argument("--dry-run", action="store_true", help="print the row without writing")
    args = p.parse_args()

    if CSV_PATH.exists():
        with open(CSV_PATH, newline="") as f:
            existing = list(csv.DictReader(f))
    else:
        existing = []

    for r in existing:
        if r["url"] == args.url:
            print(f"SKIPPED: url already tracked as id {r['id']} (status={r['status']})", file=sys.stderr)
            sys.exit(1)

    next_id = max([int(r["id"]) for r in existing], default=0) + 1

    row = {
        "id": str(next_id),
        "date_found": date.today().isoformat(),
        "source": args.source,
        "url": args.url,
        "photo_url": args.photo_url,
        "neighborhood": args.neighborhood,
        "address": args.address,
        "price": args.price,
        "term_start": args.term_start,
        "term_end": args.term_end,
        "term_length": args.term_length,
        "bedrooms": args.bedrooms,
        "sqft": args.sqft,
        "ac": args.ac,
        "in_unit_wd": args.in_unit_wd,
        "dishwasher": args.dishwasher,
        "near_west_side_hwy_or_uws": args.near_west_side_hwy_or_uws,
        "near_brooklyn_trains": args.near_brooklyn_trains,
        "near_central_park": args.near_central_park,
        "bucket": args.bucket,
        "fit_score": str(args.fit_score),
        "status": args.status,
        "notes": args.notes,
    }

    if args.dry_run:
        print(row)
        return

    write_header = not CSV_PATH.exists()
    with open(CSV_PATH, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerow(row)

    print(f"Added id {next_id}: {args.address or args.neighborhood} (${args.price}, bucket={args.bucket})")
    subprocess.run([sys.executable, str(DIR / "generate_gallery.py")], check=True)

if __name__ == "__main__":
    main()
