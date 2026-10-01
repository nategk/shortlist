// Postgres backend: the app's model <-> the tables in lib/db.js.
import { db, ensureSchema, databaseUrl } from "./db.js";
import { applyThread } from "../app/js/model.js";

export function describe() {
  let host = "";
  try { host = new URL(databaseUrl()).hostname; } catch (e) {}
  const kind = /neon\.tech$/.test(host) ? "Postgres (Neon)" : "Postgres";
  let name = "";
  try { name = new URL(databaseUrl()).pathname.replace(/^\//, ""); } catch (e) {}
  return { backend: "postgres", kind, name: name || "database", detail: host, writable: true };
}

const num = v => (v === null || v === undefined ? null : Number(v));

const toSearch = r => ({
  id: r.id, name: r.name, lookingFor: r.looking_for, budget: r.budget, area: r.area, timing: r.timing,
  state: r.state, criteria: r.criteria, contactTemplate: r.contact_template,
  statuses: r.statuses, metrics: r.metrics, features: r.features, lastCrawlAt: r.last_crawl_at,
});
const toListing = r => ({
  id: r.id, searchIds: r.search_id ? [r.search_id] : [], title: r.title, price: num(r.price), score: r.score,
  status: r.status, notes: r.notes, url: r.url, location: r.location, description: r.description,
  summary: r.summary, source: r.source, photos: r.photos.map(p => ({ id: p.id, url: p.url })), fields: r.fields,
  features: r.features, rank: r.rank ?? null, thread: r.thread || [], updatedAt: r.updated_at,
});
const toSource = r => ({
  id: r.id, searchIds: r.search_id ? [r.search_id] : [], name: r.name, access: r.access, links: r.links,
  method: r.method, lastChecked: r.last_checked, notes: r.notes,
  crawler: r.crawler, lastRunAt: r.last_run_at, lastStatus: r.last_status, lastResult: r.last_result,
});

export async function snapshot() {
  await ensureSchema();
  const q = db();
  const [s, l, src] = await Promise.all([
    q.query("select * from searches order by created_at"),
    q.query("select * from listings order by score desc nulls last, created_at"),
    q.query("select * from sources order by name"),
  ]);
  return { searches: s.rows.map(toSearch), listings: l.rows.map(toListing), sources: src.rows.map(toSource) };
}

// Only status, notes, features, rank and the application thread are
// writable from the public UI. Thread entries are added / removed by id
// inside a row lock, so concurrent posts from two devices both land.
export async function updateListing(id, patch) {
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("begin");
    let thread = null;
    if (patch.threadAdd || patch.threadRemove) {
      const cur = await client.query("select thread from listings where id = $1 for update", [id]);
      if (cur.rows[0]) thread = JSON.stringify(applyThread(cur.rows[0].thread, patch.threadAdd, patch.threadRemove));
    }
    const r = await client.query(
      `update listings set
         status = coalesce($2, status),
         notes = coalesce($3, notes),
         features = coalesce($4::jsonb, features),
         rank = case when $5 then $6 else rank end,
         thread = coalesce($7::jsonb, thread),
         updated_at = now()
       where id = $1 returning id`,
      [id, patch.status ?? null, patch.notes ?? null, patch.features ? JSON.stringify(patch.features) : null,
       "rank" in patch, patch.rank ?? null, thread],
    );
    await client.query("commit");
    return r.rowCount > 0;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Search text fields editable from the UI (criteria etc.). Open like triage.
const SEARCH_FIELDS = { criteria: "criteria", contactTemplate: "contact_template", lookingFor: "looking_for",
  budget: "budget", area: "area", timing: "timing" };

export async function updateSearch(id, patch) {
  await ensureSchema();
  const sets = [], vals = [id];
  for (const [k, col] of Object.entries(SEARCH_FIELDS)) {
    if (typeof patch[k] === "string") { vals.push(patch[k]); sets.push(`${col} = $${vals.length}`); }
  }
  if (Array.isArray(patch.features)) { vals.push(JSON.stringify(patch.features)); sets.push(`features = $${vals.length}`); }
  if (!sets.length) return true;
  const r = await db().query(`update searches set ${sets.join(", ")}, updated_at = now() where id = $1 returning id`, vals);
  return r.rowCount > 0;
}

// ---- crawling ----

export async function crawlContext(searchId) {
  await ensureSchema();
  const q = db();
  const s = (await q.query("select * from searches where id = $1", [searchId])).rows[0];
  if (!s) return null;
  const sources = (await q.query("select * from sources where search_id = $1 and crawler <> '' order by name", [searchId])).rows;
  const known = (await q.query("select url, title, price, location, description from listings where search_id = $1", [searchId])).rows;
  return {
    search: { id: s.id, name: s.name, lookingFor: s.looking_for, budget: s.budget, area: s.area, timing: s.timing,
      criteria: s.criteria, statuses: s.statuses, metrics: s.metrics, features: s.features, lastCrawlAt: s.last_crawl_at },
    sources: sources.map(r => ({ id: r.id, name: r.name, crawler: r.crawler, config: r.config, seen: r.seen })),
    knownUrls: new Set(known.map(r => r.url).filter(Boolean)),
    knownTitles: new Set(known.map(r => normTitle(r.title))),
    knownBodies: new Set(known.map(r => bodyKey(r.description)).filter(Boolean)),
    board: known.map(r => ({ title: r.title, price: num(r.price), location: r.location })),
  };
}

export const normTitle = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Reposts (new post id, reworded title) usually keep the same body text.
export const bodyKey = d => {
  const k = String(d || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 300);
  return k.length >= 80 ? k : "";
};

// Claims the crawl slot: returns false when another crawl ran within minGapMs.
export async function claimCrawl(searchId, minGapMs) {
  const r = await db().query(
    `update searches set last_crawl_at = now()
     where id = $1 and (last_crawl_at is null or last_crawl_at < now() - ($2::text || ' milliseconds')::interval)
     returning id`, [searchId, String(minGapMs)]);
  return r.rowCount > 0;
}

export async function recordSourceRun(id, { status, result, seen }) {
  await db().query(
    `update sources set last_run_at = now(), last_status = $2, last_result = $3,
       seen = coalesce($4::jsonb, seen), last_checked = to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD'),
       updated_at = now()
     where id = $1`, [id, status, result, seen ? JSON.stringify(seen) : null]);
}

export async function insertListing(l) {
  const r = await db().query(
    `insert into listings (id, search_id, title, price, score, status, notes, url, location, description, summary, source, photos, fields, features)
     values ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do nothing returning id`,
    [l.id, l.searchId, l.title, l.price ?? null, l.score ?? null, l.status, l.url, l.location || "",
     l.description || "", l.summary || "", l.source || "", JSON.stringify(l.photos || []), JSON.stringify(l.fields || {}),
     JSON.stringify(l.features || [])]);
  return r.rowCount > 0;
}

// Listings in a search with any photo not yet in Vercel Blob.
export async function listingsWithOutsidePhotos(searchId) {
  const r = await db().query(
    `select id, photos from listings where search_id = $1 and exists
       (select 1 from jsonb_array_elements(photos) p where p->>'url' not like '%.blob.vercel-storage.com/%')
     order by created_at desc`, [searchId]);
  return r.rows;
}

export async function setListingPhotos(id, photos) {
  await db().query("update listings set photos = $2, updated_at = now() where id = $1", [id, JSON.stringify(photos)]);
}

// Upsert a whole snapshot (admin import). Listings keep their existing
// status/notes/features/rank/thread unless the snapshot's triage should win
// (overwriteTriage); features are filled in where a listing has none yet.
export async function importSnapshot(snap, { overwriteTriage = true } = {}) {
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("begin");
    for (const s of snap.searches || []) {
      await client.query(
        `insert into searches (id, name, looking_for, budget, area, timing, state, criteria, contact_template, statuses, metrics, features)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set name=$2, looking_for=$3, budget=$4, area=$5, timing=$6, state=$7,
           criteria=$8, contact_template=$9, statuses=$10, metrics=$11, features=$12, updated_at=now()`,
        [s.id, s.name, s.lookingFor || "", s.budget || "", s.area || "", s.timing || "", s.state || "Active",
         s.criteria || "", s.contactTemplate || "", JSON.stringify(s.statuses || []), JSON.stringify(s.metrics || []),
         JSON.stringify(s.features || [])],
      );
    }
    for (const l of snap.listings || []) {
      await client.query(
        `insert into listings (id, search_id, title, price, score, status, notes, url, location, description, summary, source, photos, fields, features, rank, thread)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16,$17,$18)
         on conflict (id) do update set search_id=$2, title=$3, price=$4, score=$5,
           status = case when $15 then $6 else listings.status end,
           notes = case when $15 then $7 else listings.notes end,
           url=$8, location=$9, description=$10, summary=$11, source=$12, photos=$13, fields=$14, features = case when $15 or listings.features = '[]'::jsonb then $16 else listings.features end,
           rank = case when $15 then $17 else listings.rank end,
           thread = case when $15 then $18 else listings.thread end, updated_at=now()`,
        [l.id, (l.searchIds || [])[0] || null, l.title || "", l.price ?? null, l.score ?? null, l.status || "",
         l.notes || "", l.url || "", l.location || "", l.description || "", l.summary || "", l.source || "",
         JSON.stringify(l.photos || []), JSON.stringify(l.fields || {}), overwriteTriage, JSON.stringify(l.features || []),
         Number.isInteger(l.rank) ? l.rank : null, JSON.stringify(Array.isArray(l.thread) ? l.thread : [])],
      );
    }
    for (const s of snap.sources || []) {
      await client.query(
        `insert into sources (id, search_id, name, access, links, method, last_checked, notes, crawler, config)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set search_id=$2, name=$3, access=$4, links=$5, method=$6, last_checked=$7, notes=$8,
           crawler=$9, config=$10, updated_at=now()`,
        [s.id, (s.searchIds || [])[0] || null, s.name || "", s.access || "", JSON.stringify(s.links || []),
         s.method || "", s.lastChecked || "", s.notes || "", s.crawler || "", JSON.stringify(s.config || {})],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return { searches: (snap.searches || []).length, listings: (snap.listings || []).length, sources: (snap.sources || []).length };
}

// ---- Airtable sync (lib/sync.js) ----

export const KINDS = {
  searches: { table: "searches", model: toSearch },
  sources: { table: "sources", model: toSource },
  listings: { table: "listings", model: toListing },
};

// Rows with what the sync needs besides the model: the paired Airtable
// record, the merge base, and when the row last changed. ids = null: all.
export async function syncRows(kind, ids = null) {
  await ensureSchema();
  const { table, model } = KINDS[kind];
  const r = ids
    ? await db().query(`select * from ${table} where id = any($1) or airtable_id = any($1)`, [ids])
    : await db().query(`select * from ${table} order by created_at`);
  return r.rows.map(row => ({
    model: model(row), airtableId: row.airtable_id, base: row.sync_base || {},
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  }));
}

export async function setSyncLink(kind, id, airtableId, base) {
  await db().query(`update ${KINDS[kind].table} set airtable_id = $2, sync_base = $3 where id = $1`,
    [id, airtableId, JSON.stringify(base)]);
}

// Model-key patch -> columns. Everything the Airtable side can change.
const COLUMNS = {
  searches: { name: "name", lookingFor: "looking_for", budget: "budget", area: "area", timing: "timing", state: "state",
    criteria: "criteria", contactTemplate: "contact_template", statuses: "statuses:json", metrics: "metrics:json", features: "features:json" },
  sources: { searchId: "search_id", name: "name", access: "access", links: "links:json", method: "method",
    lastChecked: "last_checked", notes: "notes", crawler: "crawler" },
  listings: { searchId: "search_id", title: "title", price: "price", score: "score", status: "status", notes: "notes",
    url: "url", location: "location", description: "description", summary: "summary", source: "source",
    photos: "photos:json", features: "features:json", fields: "fields:json", rank: "rank" },
};

function assignments(kind, patch, vals) {
  const sets = [];
  for (const [k, spec] of Object.entries(COLUMNS[kind])) {
    if (!(k in patch)) continue;
    const [col, type] = spec.split(":");
    vals.push(type === "json" ? JSON.stringify(patch[k]) : patch[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  return sets;
}

export async function applyPatch(kind, id, patch) {
  const vals = [id];
  const sets = assignments(kind, patch, vals);
  if (!sets.length) return;
  await db().query(`update ${KINDS[kind].table} set ${sets.join(", ")}, updated_at = now() where id = $1`, vals);
}

// A row first created in Airtable. Columns not in the patch get defaults.
export async function createRow(kind, id, patch) {
  const vals = [id];
  const cols = ["id"];
  for (const [k, spec] of Object.entries(COLUMNS[kind])) {
    if (!(k in patch)) continue;
    const [col, type] = spec.split(":");
    vals.push(type === "json" ? JSON.stringify(patch[k]) : patch[k]);
    cols.push(col);
  }
  if (kind === "searches" && !("name" in patch)) { cols.push("name"); vals.push("Untitled search"); }
  await db().query(`insert into ${KINDS[kind].table} (${cols.join(", ")}) values (${cols.map((_, i) => "$" + (i + 1)).join(", ")})
    on conflict (id) do nothing`, vals);
}

export async function deleteRow(kind, id) {
  await db().query(`delete from ${KINDS[kind].table} where id = $1`, [id]);
}

export async function getState(key) {
  await ensureSchema();
  const r = await db().query("select value from sync_state where key = $1", [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

export async function setState(key, value) {
  await db().query(
    `insert into sync_state (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = $2, updated_at = now()`, [key, JSON.stringify(value)]);
}

// A lease so only one sync runs at a time across function instances
// (session advisory locks don't survive Neon's transaction pooler).
export async function claimLease(key, ms) {
  await ensureSchema();
  const r = await db().query(
    `insert into sync_state (key, value, updated_at) values ($1, jsonb_build_object('until', (extract(epoch from now()) * 1000 + $2)::bigint), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where (sync_state.value->>'until')::bigint < extract(epoch from now()) * 1000
     returning key`, [key, ms]);
  return r.rowCount > 0;
}

export async function releaseLease(key) {
  await db().query("delete from sync_state where key = $1", [key]);
}
