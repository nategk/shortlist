# Buying Criteria (Template)

Copy this file into your project folder (e.g. `car/criteria.md`) and fill in
the specifics for that search. This is the live, editable source of truth
that scoring reads from — edit it directly, through the gallery's "Scoring
Criteria" panel, or by asking Claude to update it.

## Context
[Why you're searching, timeline/urgency, where you'll end up using it.]

## Budget
- $[X] — amazing
- $[Y] — great
- $[Z] — ok
- $[Z]+ — case-by-case, needs to be exceptional to justify

## Type / Must-Match Category
[What kind of thing you're buying — model family, category, key specs that
define "in scope" at all.]
- See `target_list.md` for specific models/units to watch for — not a strict
  allow-list, just where to look first.

## Fit / Sizing
[If this category has a "does this fit me" dimension, see `reference_spec.md`
for your baseline measurements and a reference item to compare candidates
against. Skip this section if not relevant.]

## Location / Pickup
1. [Best case — e.g. same city, specific neighborhood priority]
2. [Acceptable — e.g. short trip, train/taxi accessible]
3. [Last resort — e.g. requires a rental car / longer trip]

## Must-Haves
- [Anything that's an automatic hard pass if missing — e.g. proof of
  ownership, a specific certification, a safety feature.]

## Deal-Breakers / Red Flags
- [Hard rejects specific to this category]
- Reused-template scam listings (identical price/description phrasing across
  different sellers/listings) — flag and score low, don't just note it.
- Price far below comparable market value for the same item — treat as a red
  flag, not a deal.

## Scoring Rubric (100 pts + modifiers)

| Category | Weight | What to look for |
|---|---|---|
| [Core quality dimension] | 30 | [Most important factor for this category] |
| Fit | 20 | [Correct size/spec per `reference_spec.md`] |
| Versatility / practicality | 15 | [Everyday usefulness, flexibility] |
| [Performance dimension] | 10 | [...] |
| Future-proofing | 10 | [Parts availability, standards, longevity] |
| Components / feature set | 5 | [...] |
| [Secondary quality dimension] | 5 | [...] |
| Condition | 5 | [Wear, maintenance history, cosmetic damage] |

### Modifiers
Bonuses: [e.g. +2 for a premium spec upgrade, +1 fresh consumables]
Penalties: [e.g. -3 wrong size, -5 undisclosed structural damage]

## Status flow

Active pipeline, roughly in order:

`new` → `flagged` (worth contacting) → `contacted` → `replied` →
`negotiating` → `viewing_scheduled` → `viewed` → `offer_made` → `purchased`

Archive statuses — picking any of these moves the listing out of the active
board into the collapsed Archived section of the gallery:

`no_go` (you passed), `rejected` (seller passed / sold to someone else),
`sold_elsewhere`, `scam_suspected`

## Sort order
Primary board sorted by `fit_score` descending.

---
*Worked example: this repo's `bikes/` project uses this exact shape for its
real (local, gitignored) `criteria.md` — the structure above is genericized
straight from it.*
