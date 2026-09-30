# Architecture

Shortlist is a triage board for any big decision: an apartment, a bike, a
car. The code is generic. Everything specific to one search (what you want,
the scoring rubric, the statuses, which numbers matter, the listings and
their photos) lives in **your database**, not in this repo.

There are exactly four places data lives:

| Store | Holds | Role |
|---|---|---|
| **Neon Postgres** | searches, listings, sources, sync state | Source of truth. Everything reads and writes here. |
| **Vercel Blob** | listing photos | Permanent copies (source sites delete photos when a post comes down). Neon stores the Blob URLs. |
| **Device cache** | IndexedDB snapshot + outbox; service-worker photo cache | Instant, offline-first app on each device. Rebuilt from Neon at any time. |
| **Airtable** | the same three tables | A synced mirror you can also edit in: any field changed in Airtable flows back to Neon. |

Nothing else holds data: no SQLite, no JSON seeds, no generated galleries.
`test/fixtures/west-side.json` is a frozen test fixture, never synced.

```
browser (any device)                          Vercel                                     Airtable
┌──────────────────────────┐        ┌─────────────────────────────────────────┐        ┌─────────────┐
│ app/  UI + offline store  │ ─────► │ api/snapshot        read everything      │        │ Searches    │
│       + service worker    │  /api  │ api/listings/:id    PATCH triage  ─┐     │ ─push─►│ Sources     │
│ (IndexedDB, photo cache)  │ ◄───── │ api/searches/:id    PATCH criteria ┤     │        │ Listings    │
└──────────────────────────┘        │ api/crawl           new listings ──┤     │        └──────┬──────┘
                                    │ api/admin/import    (ADMIN_TOKEN) ─┘     │               │ webhook ping
                                    │        │ every write → lib/sync.js ──────┼───────────────┤
                                    │        ▼                                 │               ▼
                                    │  Neon Postgres · Blob (photos)           │ ◄──── api/airtable/webhook
                                    │  api/sync (daily cron: refresh webhook,  │        (signed; reads changes
                                    │            full two-way reconcile)       │         since its cursor)
                                    └─────────────────────────────────────────┘
```

Secrets (database URL, Blob token, admin token, Airtable token, cron
secret) live only in Vercel environment variables. The browser only knows
`/api`.

Inside the browser app:

```
┌──────────────────────────── app/ (static, no build step) ────────────────────────────┐
│  ui.js / main.js      renders cards, tabs, sources; routes clicks to store writes     │
│        │ reads                                  │ writes (status, notes, features)    │
│        ▼                                        ▼                                     │
│  store.js   IndexedDB cache ◄── pull ──┐   outbox queue ── flush when online ──┐      │
│             (renders instantly,        │   (edits apply locally at once,        │      │
│              works offline)            │    retried with backoff)               │      │
│                                        │                                        ▼      │
│  adapters/api.js      this deployment's /api                                          │
│  sw.js      service worker: app shell + every photo cached by a stable id             │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## Pieces

| Path | Role |
|---|---|
| `app/js/model.js` | The data model every layer shares, plus parsers/serializers for the text-based search config (statuses, card metrics, features, links). |
| `app/js/adapters/api.js` | Talks to this deployment's `/api`. |
| `app/js/store.js` | Offline-first store: IndexedDB snapshot, outbox of pending edits, background pull/flush. |
| `app/js/ui.js`, `main.js` | Rendering and event wiring. Never talks to a database directly. |
| `app/sw.js` | Service worker. App shell is stale-while-revalidate; photos are fetched through `./photo/<id>?src=…` and cached under the stable id. After each sync the app asks it to download every photo. |
| `api/` | Vercel functions (Web `Request`/`Response` handlers per HTTP method). |
| `lib/postgres.js`, `lib/db.js` | The model ↔ Neon tables (schema in `db.js`, created/upgraded on first use). |
| `lib/photos.js` | Copies photos into Blob. |
| `lib/sync.js`, `lib/airtable.js` | Neon ↔ Airtable sync, and the Airtable REST client. |
| `lib/crawl.js`, `lib/crawlers/`, `lib/score.js` | Crawling and Claude scoring. |
| `scripts/dev.mjs`, `scripts/remote.mjs`, `test/` | Local stand-in for Vercel; terminal access to a live deployment; tests against a local Postgres and an in-memory Airtable. |

## Data model

```
Search   id, name, lookingFor, budget, area, timing, state,
         criteria, contactTemplate,
         statuses: [{label, group}]   group ∈ review | shortlist | active | done | archived
         metrics:  [{field, label, unit, good, ok}]
         features: [{label, points}]
Listing  id, searchIds[], title, price, score, status, notes, url, location,
         description, summary, source, photos: [{id, url}], fields: {raw…},
         features: [label]
Source   id, searchIds[], name, access, links: [{label, url}], method, lastChecked, notes
```

The search decides how its listings look:
- **Statuses**: the tabs (To review / Shortlist / In progress / Done / Passed)
  come from each status's group; each card's status menu lists them all.
  An apartment hunt can say "Lease signed"; a bike search can say "Bought".
- **Card metrics**: any listing field can become a metric tile. Numbers get
  green / amber / red from the search's own thresholds (lower is better when
  `good < ok`). The West Side hunt shows Greenway and Subway distance; a bike
  search might show frame size and weight.
- **Features that matter**: attributes worth a bonus (the West Side hunt:
  garage, gym, hot tub, sauna, cold plunge, outdoor space; +3 each), edited in the app as
  `Label | points` lines. Cards show them as chips, lit when the listing
  has one; tapping a chip toggles it. The fit score shown and sorted on is
  `score` (the criteria's rubric) plus the lit features' points. Crawls ask
  Claude which features a new listing has.

## Airtable sync

`lib/sync.js` keeps an Airtable base in step with Neon, both ways.

**Pairing.** Every Neon row stores its Airtable record id (`airtable_id`);
every Airtable record carries the Neon id in its **Live ID** field. Either
one pairs a record, so a base can be linked to an existing Neon database.

**Merge, per field.** Each Neon row also stores `sync_base`: the value of
every synced Airtable field the last time both sides agreed. On each sync,
for every field:

| Neon vs base | Airtable vs base | Result |
|---|---|---|
| changed | same | Neon → Airtable |
| same | changed | Airtable → Neon |
| changed | changed | the newer record wins (Airtable **Last modified** vs Neon `updated_at`) |
| never synced | | Neon wins, unless Neon has no value (then Airtable fills it in) |

Values are compared in one normalized form per Airtable field type
(selects match choices case-insensitively, text ignores trailing
whitespace, numbers are numbers), so formatting never reads as an edit, and
our own writes echoing back through the webhook are no-ops.

**Records.** A record added in Airtable becomes a Neon row (id
`at-<record id>`, or its Live ID if it has one; listings need a Search link
unless there's only one search) and gets its Live ID stamped. A record
deleted in Airtable is deleted in Neon, except searches (that would cascade
to their listings; it's reported instead). A full sync that finds more than
30% of linked records missing deletes nothing and reports it: that's a
wrong base or a bad read, not an edit.

**Photos.** Neon keeps Blob URLs; Airtable gets them as attachments whose
filename is the photo id. Photos attached in Airtable are copied into Blob
(`at-<attachment id>`) and written back under that name.

**Field mapping.** Tables and fields are named in `MAP` in `lib/sync.js`:

- **Searches**: Name, Looking for, Budget, Area, Timing, State, Criteria,
  Contact template, Statuses (`Label: group` per line), Card metrics
  (`field | label | unit | good | ok` per line), Features (`Label | +3` per
  line), Live ID, Last modified.
- **Sources**: Name, Search (link), Access, Search links (`Label | url` per
  line), Method, Last checked, Notes, Crawler, Last run and Last result
  (Neon → Airtable only), Live ID, Last modified.
- **Listings**: Listing (title), Search (link), Price, Fit score, Status,
  Notes, URL, Location, Description, Summary, Source, Features, Photos,
  Live ID, Last modified, and **every other editable column** as a
  search-specific field (`listing.fields[column]`: Neighborhood, Greenway
  (mi), Move-in…). Add a column in Airtable and it syncs; card metrics can
  name it.

Missing fields are skipped and listed in the sync status. Computed columns
(formulas, rollups, Last modified) are never written.

**When it runs.**
1. After every Neon write (triage, criteria edits, crawls, imports), for
   just those rows. The write returns after the push; if Airtable is down
   the ids stay queued for the next run.
2. On every change in Airtable: Airtable pings `POST /api/airtable/webhook`
   (signed with the webhook's MAC secret, kept in Neon), and the sync reads
   the changed record ids since its saved cursor and reconciles them.
3. Daily cron `GET /api/sync` (`vercel.json`): refreshes the webhook (Airtable
   expires API webhooks after 7 days), re-enables its notifications if
   Airtable paused them after failed deliveries, recreates it if it's
   gone, then runs a full reconcile. A missed ping is caught here. Run it by
   hand with `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" …/api/sync`.

One sync runs at a time (a lease row in `sync_state`). `GET /api/health`
shows the last sync, last error and webhook expiry.

**Setup (env vars):** `AIRTABLE_TOKEN` (a personal access token with
`data.records:read`, `data.records:write`, `schema.bases:read` and
`webhook:manage`, limited to the base), `AIRTABLE_BASE_ID`, `CRON_SECRET`
(16+ chars; Vercel sends it with cron calls) and `SHORTLIST_URL` (the
public URL Airtable should call; defaults to the production domain).

## Device sync

1. Open: render straight from IndexedDB (instant, offline-safe).
2. Pull in the background when the page opens, returns to the foreground
   after a minute, or reconnects. Pending edits are replayed on top of the
   fresh snapshot, so a pull never undoes them.
3. Edit: the change is applied and saved locally at once, then queued. The
   queue flushes after a short pause, one upload per listing with the
   latest values, retrying with backoff on failure. Cards with unsent edits
   show "not synced".

## Crawling

**Run crawl** (Sources panel) calls `POST /api/crawl {searchId}`. For each
source with a `crawler` (`lib/crawlers/`: `craigslist`, `listingsproject`):

1. `discover(config)` lists current items; anything already seen (per-source
   `seen` ids) or already a listing is dropped.
2. Claude screens all new candidates in one call against the search's
   criteria (`lib/score.js`), keeping at most 12 per source.
3. Keepers get their full page fetched (`details`), then one Claude call
   each for fit score, card summary, and the search's card-metric values.
4. Photos are copied to Blob; the listing is saved with the search's first
   "review" status.
5. The source records `last_run_at`, `last_status` (ok / blocked / error) and
   a one-line result, shown in the UI.
6. Any photo on the search's board not yet in Blob (a failed copy, an import
   made without Blob) is copied now; what doesn't fit before the deadline is
   retried next run. The UI reports saved / failed / left.

One crawl per search per 10 minutes (the endpoint is public). Scoring needs
`ANTHROPIC_API_KEY`; without it listings are added unscored. Sites that
refuse automated access are recorded as `blocked`, never worked around.

Criteria, features and the contact template are editable in the UI
(`PATCH /api/searches/:id`), queued offline like triage.

## Working on a live deployment

`node scripts/remote.mjs set <id> status=… [notes=…]` triages one listing
through the open `PATCH /api/listings/:id`.
`node scripts/remote.mjs pull snap.json` saves the live snapshot (public);
edit it, then `node scripts/remote.mjs push snap.json` upserts it through
`/api/admin/import?keepTriage=1`, so status, notes and features set in the
app survive. Needs `SHORTLIST_URL` and, for push, `ADMIN_TOKEN`.

## Adding a new search

Add a row to Searches in Airtable (statuses, metrics, criteria), add its
Sources, and link Listings to it; the sync brings them into Neon. Or POST a
snapshot to `/api/admin/import`. No code changes. The header's search picker
appears once there's more than one.

## Tests

`TEST_DATABASE_URL=postgres://…@localhost/… npm test`. Tests drop and
recreate tables, so they only run against `TEST_DATABASE_URL` (localhost
unless `ALLOW_REMOTE_TEST_DB=1`), and `test/env.mjs` strips every production
credential (`DATABASE_URL`, Blob, Airtable, Anthropic) from the environment
first. Airtable is an in-memory fake (`test/fake-airtable.mjs`).
