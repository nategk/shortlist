// Postgres backend: the app's model <-> the tables in lib/db.js.
import { db, ensureSchema, databaseUrl } from "./db.js";

export function describe() {
  let host = "";
  try { host = new URL(databaseUrl()).hostname; } catch (e) {}
  const kind = /neon\.tech$/.test(host) ? "Postgres (Neon)" : "Postgres";
  let name = "";
  try { name = new URL(databaseUrl()).pathname.replace(/^\//, ""); } catch (e) {}
  return { backend: "postgres", kind, name: name || "database", detail: host, writable: true };
}

const num = v => (v === null || v === undefined ? null : Number(v));

export async function snapshot() {
  await ensureSchema();
  const q = db();
  const [s, l, src] = await Promise.all([
    q.query("select * from searches order by created_at"),
    q.query("select * from listings order by score desc nulls last, created_at"),
    q.query("select * from sources order by name"),
  ]);
  return {
    searches: s.rows.map(r => ({
      id: r.id, name: r.name, lookingFor: r.looking_for, budget: r.budget, area: r.area, timing: r.timing,
      state: r.state, criteria: r.criteria, contactTemplate: r.contact_template,
      statuses: r.statuses, metrics: r.metrics, features: r.features, lastCrawlAt: r.last_crawl_at,
    })),
    listings: l.rows.map(r => ({
      id: r.id, searchIds: r.search_id ? [r.search_id] : [], title: r.title, price: num(r.price), score: r.score,
      status: r.status, notes: r.notes, url: r.url, location: r.location, description: r.description,
      summary: r.summary, source: r.source, photos: r.photos.map(p => ({ id: p.id, url: p.url })), fields: r.fields,
      features: r.features, updatedAt: r.updated_at,
    })),
    sources: src.rows.map(r => ({
      id: r.id, searchIds: r.search_id ? [r.search_id] : [], name: r.name, access: r.access, links: r.links,
      method: r.method, lastChecked: r.last_checked, notes: r.notes,
      crawler: r.crawler, lastRunAt: r.last_run_at, lastStatus: r.last_status, lastResult: r.last_result,
    })),
  };
}

// Only status, notes and features are writable from the public UI.
export async function updateListing(id, patch) {
  await ensureSchema();
  const r = await db().query(
    `update listings set
       status = coalesce($2, status),
       notes = coalesce($3, notes),
       features = coalesce($4::jsonb, features),
       updated_at = now()
     where id = $1 returning id`,
    [id, patch.status ?? null, patch.notes ?? null, patch.features ? JSON.stringify(patch.features) : null],
  );
  return r.rowCount > 0;
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
// status/notes/features unless the snapshot's triage should win
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
        `insert into listings (id, search_id, title, price, score, status, notes, url, location, description, summary, source, photos, fields, features)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16)
         on conflict (id) do update set search_id=$2, title=$3, price=$4, score=$5,
           status = case when $15 then $6 else listings.status end,
           notes = case when $15 then $7 else listings.notes end,
           url=$8, location=$9, description=$10, summary=$11, source=$12, photos=$13, fields=$14, features = case when $15 or listings.features = '[]'::jsonb then $16 else listings.features end, updated_at=now()`,
        [l.id, (l.searchIds || [])[0] || null, l.title || "", l.price ?? null, l.score ?? null, l.status || "",
         l.notes || "", l.url || "", l.location || "", l.description || "", l.summary || "", l.source || "",
         JSON.stringify(l.photos || []), JSON.stringify(l.fields || {}), overwriteTriage, JSON.stringify(l.features || [])],
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
