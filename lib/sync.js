// Two-way sync between Neon (the source of truth) and an Airtable base.
//
// Pairing: each Neon row stores its Airtable record id (airtable_id); each
// Airtable record carries the Neon id in its "Live ID" field. Either pairs.
//
// Merge, per field, against sync_base (the last value both sides agreed on):
//   only Neon changed      -> write it to Airtable
//   only Airtable changed  -> write it to Neon
//   both changed           -> the newer record wins (Airtable "Last modified"
//                             vs Neon updated_at)
//   never synced           -> Neon wins, unless Neon has no value
// A record created in Airtable is created in Neon; a record deleted in
// Airtable is deleted in Neon (guarded against mass deletes). Photos live in
// Vercel Blob; Airtable gets them as attachments named by photo id, and
// photos added in Airtable are copied into Blob.
//
// Runs: after every Neon write (pushAfterWrite), on Airtable webhook pings
// (processWebhook), and as a full reconcile from the daily cron (syncAll).
import * as pg from "./postgres.js";
import { client, airtableConfig } from "./airtable.js";
import { copyPhotosToBlob } from "./photos.js";
import { parseStatuses, parseMetrics, parseLinks, parseFeatures,
  statusesText, metricsText, linksText, featuresText } from "../app/js/model.js";

// Airtable table and field names per kind. Fields missing from the base are
// skipped (and reported in the sync status).
export const MAP = {
  searches: {
    table: "Searches",
    fields: { name: "Name", lookingFor: "Looking for", budget: "Budget", area: "Area", timing: "Timing",
      state: "State", criteria: "Criteria", contactTemplate: "Contact template", statuses: "Statuses",
      metrics: "Card metrics", features: "Features", collection: "Collection", id: "Live ID" },
  },
  sources: {
    table: "Sources",
    fields: { name: "Name", search: "Search", access: "Access", links: "Search links", method: "Method",
      lastChecked: "Last checked", notes: "Notes", crawler: "Crawler", lastRunAt: "Last run",
      lastResult: "Last result", id: "Live ID" },
    pushOnly: ["lastRunAt", "lastResult"],
  },
  listings: {
    table: "Listings",
    fields: { title: "Listing", search: "Search", price: "Price", score: "Fit score", status: "Status",
      notes: "Notes", url: "URL", location: "Location", description: "Description", summary: "Summary",
      source: "Source", features: "Features", photos: "Photos", rank: "Rank", id: "Live ID" },
    // Any other editable Airtable column maps to listing.fields[column name].
    extraFields: true,
  },
};
export const ORDER = ["searches", "sources", "listings"];
const MODIFIED = "Last modified";
const COMPUTED = new Set(["formula", "rollup", "multipleLookupValues", "count", "createdTime", "lastModifiedTime",
  "autoNumber", "button", "createdBy", "lastModifiedBy", "externalSyncSource", "aiText"]);
const LEASE = "airtable.lease", PENDING = "airtable.pending", STATUS = "airtable.status", HOOK = "airtable.webhook";

// ---- values ----

const isEmpty = v => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// One comparable form per Airtable field type. Both sides are normalized
// through this before comparing, so formatting noise never reads as an edit.
export function norm(field, v) {
  if (isEmpty(v)) return null;
  switch (field.type) {
    case "number": case "currency": case "percent": case "rating": case "duration": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox": return v ? true : null;
    case "singleSelect": return choice(field, typeof v === "object" ? v.name : String(v));
    case "multipleSelects": {
      const out = [...new Set(v.map(x => choice(field, typeof x === "object" ? x.name : String(x))))].sort();
      return out.length ? out : null;
    }
    case "multipleRecordLinks": return v.map(x => (typeof x === "object" ? x.id : x)).sort();
    case "multipleAttachments": return v.map(a => a.filename);
    case "dateTime": { const d = new Date(v); return isNaN(d) ? null : new Date(Math.floor(d / 1000) * 1000).toISOString(); }
    default: {
      const s = (typeof v === "string" ? v : String(v)).replace(/\r\n/g, "\n").trimEnd();
      return s || null;
    }
  }
}

// Match an existing select option case-insensitively, so "Craigslist" and
// "craigslist" are the same value rather than an edit or a new option.
function choice(field, name) {
  const hit = (field.options?.choices || []).find(c => c.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.name : name;
}

// Neon model -> {field name: normalized value} for the fields this table has.
export function neonValues(kind, m, t, ctx) {
  const spec = MAP[kind], out = {};
  const put = (name, v) => { const f = t.byName.get(name); if (f) out[name] = norm(f, v); };
  const F = spec.fields;
  const searchLink = () => {
    const at = ctx.searchAirtableId.get((m.searchIds || [])[0]);
    return at ? [at] : null;
  };
  for (const [key, name] of Object.entries(F)) {
    if (!t.byName.has(name)) continue;
    let v;
    if (key === "id") v = m.id;
    else if (key === "search") v = searchLink();
    else if (kind === "searches" && key === "statuses") v = statusesText(m.statuses);
    else if (kind === "searches" && key === "metrics") v = metricsText(m.metrics);
    else if (kind === "searches" && key === "features") v = featuresText(m.features);
    else if (kind === "sources" && key === "links") v = linksText(m.links);
    else if (key === "photos") v = (m.photos || []).map(p => ({ filename: p.id }));
    else v = m[key];
    put(name, v);
  }
  if (spec.extraFields) for (const f of t.extra) put(f.name, (m.fields || {})[f.name]);
  return out;
}

export function airValues(kind, rec, t) {
  const out = {};
  for (const f of t.synced) out[f.name] = norm(f, rec.fields[f.name]);
  return out;
}

// Normalized Airtable values -> a model patch for Neon.
function toModelPatch(kind, air, m, t, ctx) {
  const F = MAP[kind].fields, patch = {};
  const byName = Object.fromEntries(Object.entries(F).map(([k, n]) => [n, k]));
  for (const [name, v] of Object.entries(air)) {
    const key = byName[name];
    if (key === "id" || key === "photos") continue;
    if (key === "search") {
      const id = v && ctx.searchNeonId.get(v[0]);
      if (id || !v) patch.searchId = id || null;
    } else if (!key) {
      patch.fields = patch.fields || { ...((m && m.fields) || {}) };
      if (v === null) delete patch.fields[name]; else patch.fields[name] = v;
    } else if (kind === "searches" && key === "statuses") patch.statuses = parseStatuses(v || "");
    else if (kind === "searches" && key === "metrics") patch.metrics = parseMetrics(v || "");
    else if (kind === "searches" && key === "features") patch.features = parseFeatures(v || "");
    else if (kind === "searches" && key === "state") patch.state = v || "Active";
    else if (kind === "sources" && key === "links") patch.links = parseLinks(v || "");
    else if (key === "features") patch.features = v || [];
    else if (key === "score" || key === "rank") patch[key] = v === null ? null : Math.round(v);
    else if (key === "price") patch.price = v;
    else patch[key] = v ?? "";
  }
  return patch;
}

// Normalized value -> what the Airtable API accepts.
function toWrite(field, v, photos, rec) {
  if (field.type === "multipleAttachments") {
    const have = new Map(((rec && rec.fields[field.name]) || []).map(a => [a.filename, a.id]));
    return (photos || []).map(p => (have.has(p.id) ? { id: have.get(p.id) } : { url: p.url, filename: p.id }));
  }
  if (v === null) return field.type === "checkbox" ? false : /^multiple/.test(field.type) ? [] : null;
  return v;
}

// ---- the merge (pure) ----

export function mergeFields({ neon, air, base, neonTime, airTime, pushOnly = [] }) {
  const toAir = {}, toNeon = {}, next = {};
  for (const f of new Set([...Object.keys(neon), ...Object.keys(air)])) {
    const n = neon[f] ?? null, a = air[f] ?? null;
    if (same(n, a)) { next[f] = n; continue; }
    const hasBase = Object.prototype.hasOwnProperty.call(base, f);
    const neonChanged = !hasBase || !same(n, base[f]);
    const airChanged = hasBase && !same(a, base[f]);
    // Never synced and empty in Neon: Airtable fills it in (first link keeps
    // Airtable-only data instead of wiping it).
    const fill = !hasBase && n === null;
    const airWins = !pushOnly.includes(f) && (fill || (airChanged && (!neonChanged || airTime > neonTime)));
    if (airWins) { toNeon[f] = a; next[f] = a; } else { toAir[f] = n; next[f] = n; }
  }
  return { toAir, toNeon, base: next };
}

// ---- schema ----

let schemaCache = null;
async function loadSchema(at) {
  if (schemaCache && schemaCache.at > Date.now() - 5 * 60 * 1000 && schemaCache.baseId === at.baseId) return schemaCache.tables;
  const all = await at.tables();
  const tables = {}, missing = [];
  for (const kind of ORDER) {
    const spec = MAP[kind];
    const raw = all.find(x => x.name === spec.table);
    if (!raw) { missing.push(spec.table); continue; }
    const byName = new Map(raw.fields.map(f => [f.name, f]));
    const mapped = new Set(Object.values(spec.fields));
    for (const name of mapped) if (!byName.has(name)) missing.push(spec.table + "." + name);
    const writable = raw.fields.filter(f => !COMPUTED.has(f.type));
    const extra = spec.extraFields ? writable.filter(f => !mapped.has(f.name)) : [];
    const synced = writable.filter(f => mapped.has(f.name)).concat(extra);
    tables[kind] = { id: raw.id, byName, extra, synced, pushOnly: (spec.pushOnly || []).map(k => spec.fields[k]).concat(spec.fields.id),
      hasModified: byName.get(MODIFIED)?.type === "lastModifiedTime" };
  }
  schemaCache = { at: Date.now(), baseId: at.baseId, tables: { ...tables, missing } };
  return schemaCache.tables;
}

// ---- reconcile ----

// ids: null for a full reconcile, or {kind: [neon or airtable ids]}.
async function reconcile(at, ids = null, { deadline = Infinity } = {}) {
  const schema = await loadSchema(at);
  const ctx = { searchAirtableId: new Map(), searchNeonId: new Map() };
  const tally = { toAirtable: 0, toNeon: 0, created: 0, imported: 0, deleted: 0, skipped: [] };
  const linkSearches = rows => {
    for (const r of rows) if (r.airtableId) { ctx.searchAirtableId.set(r.model.id, r.airtableId); ctx.searchNeonId.set(r.airtableId, r.model.id); }
  };
  linkSearches(await pg.syncRows("searches"));

  for (const kind of ORDER) {
    const t = schema[kind];
    if (!t || (ids && !(ids[kind] || []).length)) continue;
    if (Date.now() > deadline) { tally.skipped.push(kind + ": out of time"); continue; }
    const want = ids ? ids[kind] : null;
    const rows = await pg.syncRows(kind, want);
    const recs = want
      ? await at.getMany(t.id, [...want.filter(x => /^rec/.test(x)), ...rows.map(r => r.airtableId).filter(Boolean)])
      : await at.listAll(t.id);
    const recById = new Map(recs.map(r => [r.id, r]));
    const liveId = t.byName.has(MAP[kind].fields.id) ? r => r.fields[MAP[kind].fields.id] : () => "";
    const recByLive = new Map(recs.filter(r => liveId(r)).map(r => [liveId(r), r]));
    const paired = new Set();
    const creates = [], updates = [], deletes = [];

    for (const row of rows) {
      const m = row.model;
      const rec = (row.airtableId && recById.get(row.airtableId)) || recByLive.get(m.id);
      if (!rec) {
        if (row.airtableId && kind === "searches") tally.skipped.push(`search ${m.id}: deleted in Airtable; delete it in Neon by hand (it cascades to its listings)`);
        else if (row.airtableId) deletes.push(row);     // it was paired: deleted in Airtable
        else creates.push(row);                         // new in Neon
        continue;
      }
      paired.add(rec.id);
      const neon = neonValues(kind, m, t, ctx);
      const air = airValues(kind, rec, t);
      const airTime = t.hasModified ? Date.parse(rec.fields[MODIFIED] || "") || 0 : 0;
      const r = mergeFields({ neon, air, base: row.airtableId === rec.id ? row.base : {}, neonTime: row.updatedAt, airTime, pushOnly: t.pushOnly });
      updates.push({ row, rec, ...r });
    }

    // Airtable records with no Neon row: created (or restored) in Airtable.
    const imports = recs.filter(r => !paired.has(r.id) && (!want || want.includes(r.id) || want.includes(liveId(r))));

    // Guard: a full reconcile that would delete many rows is more likely a
    // wrong base/table or a failed listing than real deletes.
    const linked = rows.filter(r => r.airtableId).length;
    if (!ids && deletes.length > Math.max(3, linked * 0.3)) {
      tally.skipped.push(`${kind}: ${deletes.length} of ${linked} linked records missing in Airtable; not deleting`);
      deletes.length = 0;
    }

    // Neon -> Airtable, and Airtable -> Neon, per record.
    const airWrites = [];
    for (const u of updates) {
      const m = u.row.model;
      if (Object.keys(u.toNeon).length) {
        const patch = toModelPatch(kind, u.toNeon, m, t, ctx);
        const photoField = MAP[kind].fields.photos;
        if (photoField && photoField in u.toNeon) {
          // Photos changed in Airtable: keep ours by id, copy new ones to Blob,
          // then write the set back so every attachment is named by photo id.
          const byId = new Map((m.photos || []).map(p => [p.id, p]));
          const photos = (u.rec.fields[photoField] || []).map(a => byId.get(a.filename) || { id: "at-" + a.id, url: a.url });
          await copyPhotosToBlob([{ id: m.id, photos }]);
          patch.photos = photos;
          m.photos = photos;
          u.toAir[photoField] = u.base[photoField] = photos.map(p => p.id);
        }
        await pg.applyPatch(kind, m.id, patch);
        tally.toNeon++;
      }
      if (Object.keys(u.toAir).length) {
        const fields = {};
        for (const [name, v] of Object.entries(u.toAir)) fields[name] = toWrite(t.byName.get(name), v, m.photos, u.rec);
        airWrites.push({ row: u.row, rec: u.rec, fields, base: u.base });
      } else if (!same(u.base, u.row.base) || u.row.airtableId !== u.rec.id) {
        await pg.setSyncLink(kind, m.id, u.rec.id, u.base);
      }
    }
    if (airWrites.length) {
      await at.update(t.id, airWrites.map(w => ({ id: w.rec.id, fields: w.fields })));
      for (const w of airWrites) await pg.setSyncLink(kind, w.row.model.id, w.rec.id, w.base);
      tally.toAirtable += airWrites.length;
    }

    // New in Neon -> create in Airtable.
    if (creates.length) {
      const bodies = creates.map(row => {
        const neon = neonValues(kind, row.model, t, ctx), fields = {};
        for (const [name, v] of Object.entries(neon)) if (v !== null) fields[name] = toWrite(t.byName.get(name), v, row.model.photos, null);
        return { row, fields, base: neon };
      });
      const made = await at.create(t.id, bodies.map(b => ({ fields: b.fields })));
      for (let i = 0; i < made.length; i++) await pg.setSyncLink(kind, bodies[i].row.model.id, made[i].id, bodies[i].base);
      tally.created += made.length;
      if (kind === "searches") linkSearches(bodies.map((b, i) => ({ model: b.row.model, airtableId: made[i].id })));
    }

    // New in Airtable -> create in Neon, then stamp its Live ID.
    const stamp = [];
    for (const rec of imports) {
      const air = airValues(kind, rec, t);
      const id = liveId(rec) || "at-" + rec.id;
      const patch = toModelPatch(kind, air, null, t, ctx);
      if (kind !== "searches" && !patch.searchId) {
        const only = [...ctx.searchNeonId.values()];
        if (only.length === 1) patch.searchId = only[0];
        else { tally.skipped.push(`${kind} ${rec.id}: link it to a search`); continue; }
      }
      const photoField = MAP[kind].fields.photos;
      if (photoField && rec.fields[photoField]) {
        patch.photos = rec.fields[photoField].map(a => ({ id: "at-" + a.id, url: a.url }));
        await copyPhotosToBlob([{ id, photos: patch.photos }]);
      }
      await pg.createRow(kind, id, patch);
      const [row] = await pg.syncRows(kind, [id]);
      const base = neonValues(kind, row.model, t, ctx);
      await pg.setSyncLink(kind, id, rec.id, base);
      const fields = {};
      for (const name of [MAP[kind].fields.id, photoField].filter(n => n && t.byName.has(n))) fields[name] = toWrite(t.byName.get(name), base[name], row.model.photos, rec);
      stamp.push({ id: rec.id, fields });
      if (kind === "searches") linkSearches([{ model: row.model, airtableId: rec.id }]);
      tally.imported++;
    }
    if (stamp.length) await at.update(t.id, stamp);

    for (const row of deletes) { await pg.deleteRow(kind, row.model.id); tally.deleted++; }
  }
  if (schema.missing.length) tally.missingFields = schema.missing;
  return tally;
}

// ---- entry points ----

async function withLease(fn, { waitMs = 0 } = {}) {
  const until = Date.now() + waitMs;
  while (!(await pg.claimLease(LEASE, 280000))) {
    if (Date.now() > until) return null;
    await new Promise(r => setTimeout(r, 500));
  }
  try { return await fn(); } finally { await pg.releaseLease(LEASE); }
}

async function record(kind, tally, error) {
  const prev = (await pg.getState(STATUS)) || {};
  const now = new Date().toISOString();
  await pg.setState(STATUS, {
    ...prev, lastSyncAt: now, ...(kind === "full" && !error ? { lastFullSyncAt: now } : {}),
    lastError: error ? String(error.message || error).slice(0, 500) : "", lastErrorAt: error ? now : prev.lastErrorAt || "",
    last: tally || prev.last || null,
  });
}

function mergeIds(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = [...new Set([...(out[k] || []), ...v])];
  return out;
}

async function drainPending(at) {
  for (let i = 0; i < 5; i++) {
    const pending = await pg.getState(PENDING);
    if (!pending || !Object.values(pending).some(v => v.length)) return;
    await pg.setState(PENDING, {});
    await reconcile(at, pending);
  }
}

// Full two-way reconcile of every table.
export async function syncAll({ deadline = Date.now() + 240000 } = {}) {
  const cfg = airtableConfig();
  if (!cfg) return { ok: false, error: "Airtable isn't configured (AIRTABLE_TOKEN, AIRTABLE_BASE_ID)." };
  const at = client(cfg);
  const out = await withLease(async () => {
    try {
      const tally = await reconcile(at, null, { deadline });
      await drainPending(at);
      await record("full", tally);
      return { ok: true, ...tally };
    } catch (e) {
      await record("full", null, e);
      throw e;
    }
  }, { waitMs: 20000 });
  return out || { ok: false, error: "Another sync is running; try again shortly." };
}

// After a Neon write: sync just those rows. Never throws; a failure is
// recorded and the next webhook/cron run catches up.
export async function pushAfterWrite(ids) {
  const cfg = airtableConfig();
  if (!cfg) return { ok: false, skipped: "not configured" };
  try {
    await pg.setState(PENDING, mergeIds((await pg.getState(PENDING)) || {}, ids));
    const at = client(cfg);
    const out = await withLease(async () => {
      try { await drainPending(at); await record("push", null); return { ok: true }; }
      catch (e) { await record("push", null, e); return { ok: false, error: e.message }; }
    }, { waitMs: 8000 });
    return out || { ok: true, queued: true };
  } catch (e) {
    console.error("Airtable push failed:", e);
    return { ok: false, error: e.message };
  }
}

// ---- webhooks ----

export function webhookUrl() {
  const host = process.env.SHORTLIST_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "");
  return host ? host.replace(/\/$/, "") + "/api/airtable/webhook" : "";
}

// Create the base's webhook if missing, else refresh it (they expire after
// 7 days) and re-enable notifications Airtable may have paused after
// failed deliveries. Called by the daily cron.
export async function ensureWebhook() {
  const cfg = airtableConfig();
  const url = webhookUrl();
  if (!cfg || !url) return { ok: false, error: !cfg ? "Airtable isn't configured." : "Set SHORTLIST_URL so Airtable knows where to call." };
  const at = client(cfg);
  let hook = await pg.getState(HOOK);
  const existing = hook && hook.baseId === cfg.baseId && hook.notificationUrl === url
    ? ((await at.listWebhooks()).webhooks || []).find(w => w.id === hook.id) : null;
  if (!existing) {
    if (hook && hook.id && hook.baseId === cfg.baseId) await at.deleteWebhook(hook.id).catch(() => {});
    const made = await at.createWebhook(url);
    hook = { id: made.id, macSecretBase64: made.macSecretBase64, cursor: 1, baseId: cfg.baseId, notificationUrl: url, expirationTime: made.expirationTime };
    await pg.setState(HOOK, hook);
    return { ok: true, created: true, expirationTime: hook.expirationTime };
  }
  const r = await at.refreshWebhook(hook.id);
  if (!existing.areNotificationsEnabled) await at.enableNotifications(hook.id);
  await pg.setState(HOOK, { ...hook, expirationTime: r.expirationTime });
  return { ok: true, refreshed: true, expirationTime: r.expirationTime, reenabled: !existing.areNotificationsEnabled };
}

export async function webhookSecret() {
  const hook = await pg.getState(HOOK);
  return hook ? { id: hook.id, secret: Buffer.from(hook.macSecretBase64, "base64") } : null;
}

// A ping says "something changed"; read the payloads since our cursor,
// reconcile the records they name, then advance the cursor.
export async function processWebhook() {
  const cfg = airtableConfig();
  if (!cfg) return { ok: false, error: "Airtable isn't configured." };
  const at = client(cfg);
  const out = await withLease(async () => {
    const hook = await pg.getState(HOOK);
    if (!hook) return { ok: false, error: "No webhook registered." };
    const schema = await loadSchema(at);
    const kindOf = Object.fromEntries(ORDER.filter(k => schema[k]).map(k => [schema[k].id, k]));
    let cursor = hook.cursor || 1, ids = {}, more = true, n = 0;
    try {
      while (more && n++ < 20) {
        const j = await at.payloads(hook.id, cursor);
        for (const p of j.payloads || []) {
          for (const [tid, ch] of Object.entries(p.changedTablesById || {})) {
            const kind = kindOf[tid];
            if (!kind) continue;
            const touched = [...Object.keys(ch.changedRecordsById || {}), ...Object.keys(ch.createdRecordsById || {}), ...(ch.destroyedRecordIds || [])];
            ids = mergeIds(ids, { [kind]: touched });
          }
        }
        cursor = j.cursor;
        more = j.mightHaveMore;
      }
      const tally = Object.keys(ids).length ? await reconcile(at, ids) : null;
      await drainPending(at);
      await pg.setState(HOOK, { ...hook, cursor });
      await record("webhook", tally);
      return { ok: true, records: Object.values(ids).reduce((a, v) => a + v.length, 0), ...(tally || {}) };
    } catch (e) {
      await record("webhook", null, e);
      throw e;
    }
  }, { waitMs: 20000 });
  return out || { ok: true, busy: true };
}

export async function status() {
  const [s, hook] = await Promise.all([pg.getState(STATUS), pg.getState(HOOK)]);
  return { configured: !!airtableConfig(), ...(s || {}), webhook: hook ? { expirationTime: hook.expirationTime, cursor: hook.cursor } : null };
}
