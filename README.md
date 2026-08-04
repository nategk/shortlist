# Shortlist

Track and score candidates for any big purchase decision — an apartment, a
bike, a car, whatever's next — against your own criteria, in one gallery
board per project.

This repo is a generic engine. It has no idea what you're shopping for.

## The app (this repo)

- `add_listing.py` — CLI to add one candidate, score it, and regenerate the
  gallery.
- `generate_gallery.py` — builds `gallery.html`, a sortable visual board of
  every candidate by fit score and status.
- `serve.py` — small local server so the gallery's web UI can save edits
  (status changes, notes, project settings, criteria/offer text) back to
  the database.
- `init_db.py` / `schema.sql` — creates `listings.db` (SQLite): a
  `listings` table (the candidates), a `sources_status` table (which
  listing sites are scrapable vs. bot-walled), and a singleton `project`
  row holding everything about *this* search — what you're looking for,
  budget, search area, optional ship-to address, fulfillment, and the
  scoring rubric / outreach message text (edited live from the gallery's
  Project Settings / Scoring Criteria / Contact-Offer Template panels).
- `photo_cache.py` — downloads a listing's photo locally so the gallery
  doesn't depend on the source site's (often expiring) image URL.

Everything for one project lives in that one `listings.db` file — no
separate criteria/config files to keep in sync.

Candidates move through a status pipeline (`new` → `flagged` → `contacted`
→ ... → `purchased`, or archived as `no_go` / `rejected` / `sold_elsewhere`
/ `scam_suspected`), sorted by fit score.

## Starting a project

A "project" is just a folder with its own `listings.db`, running its own
copy of the scripts above. Nothing here tracks or cares what you're
shopping for — that all lives in your project's database, not the app.

1. Make a folder (e.g. `~/car-search/`) and copy in the app scripts above.
2. Run `python3 init_db.py --object "..." --budget "..." --search-area "..."`
   (all optional/fillable-later — see `python3 init_db.py --help`).
3. Fill in `templates/criteria.md` and `templates/offer_template.md`
   (copy them out, edit the brackets), then either pass them to `init_db.py`
   via `--criteria-file` / `--offer-file`, or paste the text into the
   gallery's Scoring Criteria / Contact-Offer Template panels after the
   fact. `templates/reference_spec.md` and `templates/target_list.md` are
   just working notes — keep them alongside the project folder, no need to
   load them into the db.
4. Start adding candidates with `add_listing.py`.

**Never commit a project's `listings.db` to a public repo** — budget,
contact info, and physical/personal measurements live in it.

## templates/

Generic starting points — no object-specific content, since criteria are
inherently personal (your budget, your fit, your location):

- `criteria.md`, `reference_spec.md`, `target_list.md`, `offer_template.md`

`templates/examples/` is different: source-scraping research isn't
personal, just factual (which sites are bot-walled, which have clean
structured data), so real worked examples are published as-is:

- `sources_status_bikes.csv`, `sources_status_apartments.csv`

## Local, unpublished projects on this machine

`bikes/`, `apartment/`, and `car/` exist locally in this same parent
directory but are git-ignored — they're real, personal, in-progress
searches (some predating this repo, still on their own slightly-diverged
copies of the engine, including apartment's older CSV-based version), not
part of the published app.
