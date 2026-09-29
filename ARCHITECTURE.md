# Architecture

Shortlist is a triage board for any big decision: an apartment, a bike, a
car. The code is generic. Everything specific to one search (what you want,
the scoring rubric, the statuses, which numbers matter, the listings and
their photos) lives in **your database**, not in this repo.

It deploys as one Vercel project:

```
browser (any device)                         Vercel
┌─────────────────────────┐        ┌──────────────────────────────────────────┐
│ app/  UI + offline store │ ─────► │ api/health     which backend is live     │
│       + service worker   │  /api  │ api/snapshot   read everything           │
│  (IndexedDB, photo cache)│ ◄───── │ api/listings/:id  PATCH status / notes   │
└─────────────────────────┘        │ api/admin/import  (ADMIN_TOKEN) load data│
                                   │        │ lib/backend.js picks by env      │
                                   │        ▼                                  │
                                   │  Postgres (Neon) · Blob (photos)          │
                                   │  or Airtable · or JSON demo               │
                                   └──────────────────────────────────────────┘
```

Secrets (database URL, Blob token, admin token, Airtable token) live only
in Vercel environment variables. The browser only knows `/api`.

Inside the browser app:

```
┌──────────────────────────── app/ (static, no build step) ────────────────────────────┐
│                                                                                       │
│  ui.js / main.js      renders cards, tabs, sources; routes clicks to store writes     │
│        │ reads                                  │ writes (status, notes)              │
│        ▼                                        ▼                                     │
│  store.js   IndexedDB cache ◄── pull ──┐   outbox queue ── flush when online ──┐      │
│             (renders instantly,        │   (edits apply locally at once,        │      │
│              works offline)            │    retried with backoff)               │      │
│                                        │                                        ▼      │
│  adapters/  api.js (default) · airtable.js · json.js ── same 3-method contract ─────   │
│                                                                                       │
│  sw.js      service worker: app shell + every photo cached by a stable id             │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                 Your database: Searches · Listings · Sources (+ photos)
```

## Pieces

| Path | Role |
|---|---|
| `app/js/model.js` | The data model every layer shares, plus parsers for the text-based search config (statuses, card metrics, links). |
| `app/js/adapters/` | One module per database type. Translates that database to and from the model. |
| `app/js/store.js` | Offline-first store: IndexedDB snapshot, outbox of pending edits, background pull/flush. One database per connection, so switching sources never mixes data. |
| `app/js/ui.js`, `main.js` | Rendering and event wiring. Never talks to a database directly. |
| `app/sw.js` | Service worker. App shell is stale-while-revalidate; photos are fetched through `./photo/<id>?src=…` and cached under the stable id, so they survive expiring signed URLs and work offline. After each sync the app asks it to download every photo. |
| `app/demo/*.json` | A snapshot in the model's own shape: the demo backend, and the default seed for `/api/admin/import`. |
| `api/` | Vercel functions (Web `Request`/`Response` handlers per HTTP method). |
| `lib/backend.js` | Chooses the server backend from env vars; `lib/postgres.js` maps the model to tables (schema in `lib/db.js`, created on first use); `lib/photos.js` copies photos into Blob on import. |
| `scripts/dev.mjs`, `test/` | Local stand-in for Vercel, and API tests against a real Postgres. |
| `*.py`, `searches/`, `templates/` | The older Python engine (scraping notes, SQLite, static galleries). Still works; the app doesn't depend on it. |

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
  come from each status's group, and the card's Shortlist / Pass buttons set
  the first status in that group. An apartment hunt can say "Lease signed";
  a bike search can say "Bought".
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

## Adapter contract

```js
export const FIELDS_FOR_SETTINGS = [{ key, label, placeholder, secret?, required? }];
export function create(config) {
  return {
    kind: "mydb",
    describe(),            // -> { kind, name, detail, writable, url } shown in the header pill
    async pull(),          // -> { searches, listings, sources } in the model shape
    async pushListing(id, patch),   // patch: { status?, notes? }; throw to retry later
  };
}
```

Register it in `app/js/adapters/index.js`. The store handles caching,
offline, retries and ordering; an adapter only maps shapes and makes calls.

## Airtable schema (first adapter)

Three tables. Names are the defaults in `adapters/airtable.js`; override
them there.

- **Searches**: Name, Looking for, Budget, Area, Timing, State (Active /
  Paused / Done), Criteria, Contact template, Statuses (`Label: group` per
  line), Card metrics (`field | label | unit | good | ok` per line).
- **Listings**: Listing (title), Search (link), Status (single select whose
  choices match the search's Statuses), Price, Fit score, Notes, URL,
  Location, Description, Summary, Source, Photos (attachments), plus any
  search-specific fields the Card metrics name.
- **Sources**: Name, Search (link), Access (Automated / Partial / Manual
  only / Untested), Search links (`Label | url` per line), Method, Last
  checked, Notes.

Auth: a personal access token entered in the app's Data source dialog. It
stays in that browser's storage and is only sent to `api.airtable.com`.
Scope it to `data.records:read` + `data.records:write` on one base. Never
commit it.

## Sync behaviour

1. Open: render straight from IndexedDB (instant, offline-safe).
2. Pull in the background when the page opens, returns to the foreground
   after a minute, or reconnects. Pending edits are replayed on top of the
   fresh snapshot, so a pull never undoes them.
3. Edit: the change is applied and saved locally at once, then queued. The
   queue flushes after a short pause, one upload per listing with the
   latest values, retrying with backoff on failure. Cards with unsent edits
   show "not synced".
4. Read-only sources (JSON) keep edits on the device.

Conflicts are last-writer-wins per field, which is fine for one person
triaging on a couple of devices.

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

Add a row to Searches (statuses, metrics, criteria), add its Sources, and
link new Listings to it. No code changes. The header's search picker
appears once there's more than one.
