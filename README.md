# Shortlist

Track and score candidates for any big purchase decision — an apartment, a
bike, a car, whatever's next — against your own criteria, in one gallery
board per project.

## How it works

Each subfolder is one independent shortlist for one purchase decision
(`bikes/`, `apartment/`, `car/`, ...). Every project follows the same shape:

- `criteria.md` — the scoring rubric for this search (budget, must-haves,
  weighted categories, status flow). **Not tracked in git** — lives locally
  only, since it's personal (budget, location, contact info).
- `listings.db` / `listings.csv` — the candidate database. **Not tracked.**
- `add_listing.py` — CLI to add one candidate, score it against
  `criteria.md`, and regenerate the gallery.
- `generate_gallery.py` — builds `gallery.html`, a sortable visual board of
  every candidate by fit score and status.
- `serve.py` — small local server so the gallery's web UI can save edits
  (status changes, notes, criteria updates) back to disk.
- `sources_status.csv` — which listing sites are actually scrapable vs.
  bot-blocked, and how, so repeat searches don't re-discover the same dead
  ends.

Candidates move through a status pipeline (`new` → `flagged` → `contacted`
→ ... → `purchased`, or archived as `no_go` / `rejected` / `sold_elsewhere`),
sorted by fit score.

## Why the data isn't in this repo

This repo is the app, not the search. Each project's real data — your
budget, criteria, contact templates, and candidate database — is personal
and stays local-only (see `.gitignore`). Clone this repo, then set up your
own `criteria.md` and an empty database per project you want to run.

## Projects

- `bikes/` — SQLite-backed
- `apartment/` — CSV-backed
- `car/` — SQLite-backed, scaffolded but not yet configured (needs budget
  and must-haves in `criteria.md`)

`bikes/` and `apartment/` currently use different storage (SQLite vs. CSV)
and haven't been unified into one shared engine yet — that's a planned
follow-up rather than a blocker to using either one today.
