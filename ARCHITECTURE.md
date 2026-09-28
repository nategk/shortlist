# Architecture

Shortlist is a triage board for any big decision: an apartment, a bike, a
car. The code is generic. Everything specific to one search (what you want,
the scoring rubric, the statuses, which numbers matter, the listings and
their photos) lives in **your database**, not in this repo.

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
│  adapters/  airtable.js · json.js · (yours) ── same 3-method contract ──────────────   │
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
| `app/demo/*.json` | A snapshot in the model's own shape, used by the JSON adapter. A fresh clone opens on this, with no account. |
| `*.py`, `searches/`, `templates/` | The older Python engine (scraping notes, SQLite, static galleries). Still works; the app doesn't depend on it. |

## Data model

```
Search   id, name, lookingFor, budget, area, timing, state,
         criteria, contactTemplate,
         statuses: [{label, group}]   group ∈ review | shortlist | active | done | archived
         metrics:  [{field, label, unit, good, ok}]
Listing  id, searchIds[], title, price, score, status, notes, url, location,
         description, summary, source, photos: [{id, url}], fields: {raw…}
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

## Adding a new search

Add a row to Searches (statuses, metrics, criteria), add its Sources, and
link new Listings to it. No code changes. The header's search picker
appears once there's more than one.
