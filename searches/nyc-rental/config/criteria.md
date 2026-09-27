# NYC Rental Criteria — West Side, Oct 1 2026 move-in

Live scoring rubric for `searches/nyc-rental/`. After `init_db.py` seeds it
into the db, edit it from the gallery's Scoring Criteria panel (or edit this
file and re-seed a fresh db).

## Context
Lease starting **October 1, 2026** (acceptable window: available now through
~Oct 15). Bike is the primary way around town, so the Hudson River Greenway /
West Side Highway path is the spine of daily life; the subway is the backup
for weather and late nights.

## Budget
- $3,500–$4,500 — great
- $4,500–$5,000 — good
- $5,000–$5,500 — ok, needs to earn it
- $5,500+ — out of range unless exceptional (and no fee)

NYC FARE Act (in force since June 2025): a broker hired by the landlord can't
charge the tenant a fee. Treat "tenant pays broker fee" on a landlord listing
as a flag, not a cost of doing business.

## Unit
- **1 bedroom minimum.** A true 1BR — separate, windowed bedroom with a door.
- Junior 1BR / "flex 1" / alcove studio / convertible = not a 1BR; hard pass
  unless it's clearly a real wall-and-door bedroom.
- Studios are out.

## Location (must-have)
Target zones, in no particular order:
1. **Lincoln Square** — W 59th–W 72nd, west of Central Park West.
2. **Lower/mid UWS** — W 72nd–W ~96th, west of Central Park West.
3. **Chelsea** — W 14th–W 30th, west of 6th Ave.

Two hard constraints on top of the zone:
- **Close to the West Side Highway / Hudson River Greenway.** Measured as
  straight-line distance to the greenway corridor.
- **Within a couple of blocks of a subway entrance.** ~0.15 mi or less is
  ideal; beyond ~0.25 mi fails the must-have.

## Deal-breakers / red flags
- Move-in later than ~Oct 15.
- Outside the three zones (Hell's Kitchen / Hudson Yards / West Village are
  near-misses: note them, don't score them up).
- "Model pictures represent finishes" — photos aren't the actual unit.
- The same agent template reused across listings with contradictory details
  (e.g. a West 28th St pin whose copy describes NoMad) — flag and score low.
- Rent far below comparable market for the block — treat as a scam signal.
- Any request for a deposit/application money before a viewing.

## Scoring rubric (100 pts + modifiers)

| Category | Weight | What earns the points |
|---|---|---|
| Greenway / WSH proximity | 25 | ≤0.30 mi: 25 · ≤0.50: 20 · ≤0.75: 12 · farther: 5 |
| Subway within ~2 blocks | 20 | ≤0.12 mi: 20 · ≤0.20: 16 · ≤0.25: 10 · farther: 3 |
| Price | 15 | ≤$4,500: 15 · ≤$5,000: 12 · ≤$5,500: 8 |
| True 1BR | 15 | Real 1BR: 15 · jr/flex: 6 · studio: 0 (hard pass) |
| Oct 1 move-in | 10 | Available now/Oct 1: 10 · unconfirmed: 6 · by Oct 15: 6 · later: 0 |
| Building | 10 | Elevator, laundry, doorman/package handling, bike storage |
| Light & character | 5 | Exposure, ceilings, prewar detail, architecture that's actually good |

### Modifiers
- +3 washer/dryer in unit
- +2 bike room / bike storage explicitly offered
- +2 no fee / tenant-friendly move-in costs (first + security only)
- −3 walk-up above 2nd floor (daily bike carry)
- −5 must-have miss: subway farther than ~0.25 mi
- −5 must-have miss: greenway farther than ~0.75 mi
- −5 model photos / unverified unit
- −10 inconsistent reused-template listing
- −20 outside the Oct 1 move-in window

## Status flow
`new` → `flagged` (worth contacting) → `contacted` → `replied` →
`negotiating` → `viewing_scheduled` → `viewed` → `offer_made` → `purchased`
(= lease signed)

Archive: `no_go`, `rejected`, `sold_elsewhere` (rented), `scam_suspected`

## Sort order
Board sorted by `fit_score` descending.
