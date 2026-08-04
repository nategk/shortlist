#!/usr/bin/env python3
"""Append one garage/parking listing to garages.csv safely (computes next id from
the live file at call time) and regenerates gallery.html.

Usage: fill in whichever fields you know; unknowns should be passed as "unconfirmed".
Run with --help for all fields.
"""
import argparse
import csv
import subprocess
import sys
from datetime import date
from pathlib import Path

DIR = Path(__file__).parent
CSV_PATH = DIR / "garages.csv"

FIELDS = [
    "id", "date_found", "source", "url", "photo_url", "neighborhood", "address",
    "monthly_price", "spot_type", "height_clearance", "ev_charging",
    "contract_length", "fit_score", "status", "notes",
]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", required=True, help="e.g. streeteasy-parking, craigslist, manual")
    p.add_argument("--url", required=True)
    p.add_argument("--photo-url", default="")
    p.add_argument("--neighborhood", default="")
    p.add_argument("--address", default="unspecified")
    p.add_argument("--monthly-price", required=True)
    p.add_argument("--spot-type", default="unconfirmed", help="self-park / valet / attended")
    p.add_argument("--height-clearance", default="unconfirmed")
    p.add_argument("--ev-charging", default="unconfirmed")
    p.add_argument("--contract-length", default="unconfirmed")
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
        "monthly_price": args.monthly_price,
        "spot_type": args.spot_type,
        "height_clearance": args.height_clearance,
        "ev_charging": args.ev_charging,
        "contract_length": args.contract_length,
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

    print(f"Added id {next_id}: {args.address or args.neighborhood} (${args.monthly_price}/mo)")
    subprocess.run([sys.executable, str(DIR / "generate_gallery.py")], check=True)

if __name__ == "__main__":
    main()
