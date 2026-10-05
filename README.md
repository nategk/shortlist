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
   POST a snapshot JSON body (`{searches, listings, sources}`, the shape
   `/api/snapshot` returns); photos are copied into Blob. Or connect
   Airtable (below) and let the first sync bring your base in.

6. **Optional, for crawl scoring**: add `ANTHROPIC_API_KEY` (a key from
   console.anthropic.com) so new listings found by **Run crawl** get scored
   by Claude against the search's criteria. Without it, crawls still add
   listings, unscored.

7. **Optional, daily crawl**: set `DAILY_CRAWL=1` (and `CRON_SECRET`) to crawl
   every active search once a day and mark sold or taken-down posts.

Open `https://YOUR-APP.vercel.app` on any device. The pill in the header
shows which database is live.

To edit the live data from a terminal: `SHORTLIST_URL=… node scripts/remote.mjs set <id> status=…` for one listing, or `pull snap.json`,
edit, then `ADMIN_TOKEN=… node scripts/remote.mjs push snap.json` (keeps triage).

**Access model:** the site and triage (status, notes, feature chips) are open to anyone
with the link; nothing else is writable from the browser. Database, Blob
and admin credentials exist only as Vercel environment variables.

### Run locally

```sh
npm install
DATABASE_URL=postgres://user:pass@localhost/shortlist npm run dev   # local Postgres
TEST_DATABASE_URL=postgres://user:pass@localhost/shortlist_test npm test
```

Tests drop tables, so they only use `TEST_DATABASE_URL` (localhost) and
ignore the deployment's credentials.

### Airtable (optional, two-way)

Keep an Airtable base in step with the app: every change in the app shows
up in Airtable within seconds, and any field you edit in Airtable (or a row
you add or delete there) flows back. Setup:

1. Create a personal access token at
   [airtable.com/create/tokens](https://airtable.com/create/tokens) with
   scopes `data.records:read`, `data.records:write`, `schema.bases:read`,
   `webhook:manage`, limited to your base.
2. In Vercel, add `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID` (`app…`) and
   `CRON_SECRET` (any 16+ character string), then redeploy.
3. Run the first sync (it also registers the Airtable webhook):
   ```sh
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR-APP.vercel.app/api/sync
   ```
   After that a daily cron keeps the webhook alive and reconciles
   everything as a safety net.

The base needs Searches, Sources and Listings tables with the fields listed
in [ARCHITECTURE.md](ARCHITECTURE.md#airtable-sync) (a **Live ID** text
field and a **Last modified** field on each). Any extra column on Listings
syncs as a search-specific field.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layers, the data model and
how the sync merges edits.
