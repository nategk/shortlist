# Shortlist

Track and score candidates for any big purchase decision — an apartment, a
bike, a car, whatever's next — against your own criteria.

This repo is a generic engine. It has no idea what you're shopping for:
each search (criteria, statuses, listings, photos, sources) lives in your
own database.

## The app

A fast, offline-first triage board you open from any device. It's a Vercel
app: static UI (`app/`) + small API functions (`api/`) + Postgres. Edits
apply instantly, save offline, and sync in the background; every photo is
cached on the device and stored permanently in Vercel Blob.

### Deploy your own (about 5 minutes)

1. **Import the repo** at [vercel.com/new](https://vercel.com/new) (sign in
   with GitHub, pick your fork). Keep the defaults; there's no build step.
2. **Add storage**: in the project, Storage → Create → **Neon (Postgres)**,
   then Storage → Create → **Blob**. Connect both to the project. This sets
   `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` for you.
3. **Set an admin token**: Settings → Environment Variables →
   `ADMIN_TOKEN` = any long random string (16+ characters). It's only needed
   to import data; keep it private.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions see the new
   variables.
5. **Load data**, from your own terminal:
   ```sh
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR-APP.vercel.app/api/admin/import
   ```
   With no body this loads the bundled demo search (and copies its photos
   into Blob). POST a snapshot JSON body (`{searches, listings, sources}`) to
   load your own.

6. **Optional, for crawl scoring**: add `ANTHROPIC_API_KEY` (a key from
   console.anthropic.com) so new listings found by **Run crawl** get scored
   by Claude against the search's criteria. Without it, crawls still add
   listings, unscored.

Open `https://YOUR-APP.vercel.app` on any device. The pill in the header
shows which database is live.

To edit the live data from a terminal: `SHORTLIST_URL=… node scripts/remote.mjs pull snap.json`,
edit, then `ADMIN_TOKEN=… node scripts/remote.mjs push snap.json` (keeps triage).

**Access model:** the site and triage (status, notes, feature chips) are open to anyone
with the link; nothing else is writable from the browser. Database, Blob
and admin credentials exist only as Vercel environment variables.

### Run locally

```sh
npm install
npm run dev                                   # demo data, read-only
DATABASE_URL=postgres://user:pass@localhost/shortlist npm run dev   # real Postgres
npm test                                      # API tests (need DATABASE_URL)
```

### Other databases

The server picks its backend from env vars: Postgres when `DATABASE_URL`
is set, or Airtable with `AIRTABLE_TOKEN` + `AIRTABLE_BASE_ID`
(`SHORTLIST_BACKEND` forces one). The browser can also connect to Airtable
directly, or to a JSON snapshot, from the data-source dialog.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layers, the data model, the
Airtable schema and how to add an adapter for another database.

## Python engine (older, still works)

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
- `project_dir.py` — resolves which project folder the scripts read and
  write. Defaults to the scripts' own folder; set `SHORTLIST_PROJECT` to
  point them at a project elsewhere (e.g. one under `searches/`).

Everything for one project lives in that one `listings.db` file — no
separate criteria/config files to keep in sync.

Candidates move through a status pipeline (`new` → `flagged` → `contacted`
→ ... → `purchased`, or archived as `no_go` / `rejected` / `sold_elsewhere`
/ `scam_suspected`), sorted by fit score.

## Starting a project

A "project" is just a folder with its own `listings.db`, running its own
copy of the scripts above. Nothing here tracks or cares what you're
shopping for — that all lives in your project's `config/` and database,
not the app.

Two folders, two audiences:
- **`templates/`** (this repo, public) — generic, empty-of-content starting
  points. What you copy *from*.
- **`config/`** (your project folder, private, git-ignored) — your filled-in
  personal instructions: sizing, preferred make/model/color, budget, the
  actual scoring rubric. What the app reads.

1. Make a folder (e.g. `~/car-search/`) and copy in the app scripts above —
   or, to keep the project next to the code, make `searches/<name>/` in this
   repo and `export SHORTLIST_PROJECT=searches/<name>` before running the
   scripts from the repo root.
2. Run `python3 init_db.py --object "..." --budget "..." --search-area "..."`
   (all optional/fillable-later — see `python3 init_db.py --help`). A
   `config/sources_status.csv` is seeded into the sources table too.
3. Make a `config/` folder in your project. Copy `templates/criteria.md` and
   `templates/offer_template.md` into it and fill in the brackets —
   `init_db.py` reads `config/criteria.md` / `config/offer_template.md`
   automatically and seeds them into the database (after that, edit them
   live from the gallery's Scoring Criteria / Contact-Offer Template
   panels instead). Copy `templates/reference_spec.md` and
   `templates/target_list.md` into `config/` too — those stay as permanent
   working notes, never loaded into the db.
4. Start adding candidates with `add_listing.py`.

**Never commit a project's `config/` or `listings.db` to a public repo** —
budget, contact info, and physical/personal measurements live in them.

## templates/

Generic starting points — no object-specific content, since criteria are
inherently personal (your budget, your fit, your location). Copy these into
your project's `config/` folder and fill in the brackets:

- `criteria.md`, `reference_spec.md`, `target_list.md`, `offer_template.md`

`templates/examples/` is different: source-scraping research isn't
personal, just factual (which sites are bot-walled, which have clean
structured data), so real worked examples are published as-is:

- `sources_status_bikes.csv`, `sources_status_apartments.csv`

## Public site (GitHub Pages)

`build_site.py` copies `app/` to the site root and renders a read-only
legacy gallery for every `searches/<name>/` under `/galleries/`.
`.github/workflows/pages.yml` runs it on every push to `main`.

## searches/

Projects kept alongside the code, run via `SHORTLIST_PROJECT`:

- `searches/nyc-rental/` — 1BR rental, Oct 1 2026 move-in, Lincoln Square /
  UWS / Chelsea near the Hudson River Greenway. Committed deliberately —
  criteria, listings db and gallery are public.

## Local, unpublished projects on this machine

`bikes/`, `apartment/`, and `car/` exist locally in this same parent
directory but are git-ignored — they're real, personal, in-progress
searches (some predating this repo, still on their own slightly-diverged
copies of the engine, including apartment's older CSV-based version), not
part of the published app.
