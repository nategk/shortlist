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
      statuses: r.statuses, metrics: r.metrics,
    })),
    listings: l.rows.map(r => ({
      id: r.id, searchIds: r.search_id ? [r.search_id] : [], title: r.title, price: num(r.price), score: r.score,
      status: r.status, notes: r.notes, url: r.url, location: r.location, description: r.description,
      summary: r.summary, source: r.source, photos: r.photos.map(p => ({ id: p.id, url: p.url })), fields: r.fields,
      updatedAt: r.updated_at,
    })),
    sources: src.rows.map(r => ({
      id: r.id, searchIds: r.search_id ? [r.search_id] : [], name: r.name, access: r.access, links: r.links,
      method: r.method, lastChecked: r.last_checked, notes: r.notes,
    })),
  };
}

// Only status and notes are writable from the public UI.
export async function updateListing(id, patch) {
  await ensureSchema();
  const r = await db().query(
    `update listings set
       status = coalesce($2, status),
       notes = coalesce($3, notes),
       updated_at = now()
     where id = $1 returning id`,
    [id, patch.status ?? null, patch.notes ?? null],
  );
  return r.rowCount > 0;
}

// Upsert a whole snapshot (admin import). Listings keep their existing
// status/notes unless the snapshot's triage should win (overwriteTriage).
export async function importSnapshot(snap, { overwriteTriage = true } = {}) {
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("begin");
    for (const s of snap.searches || []) {
      await client.query(
        `insert into searches (id, name, looking_for, budget, area, timing, state, criteria, contact_template, statuses, metrics)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (id) do update set name=$2, looking_for=$3, budget=$4, area=$5, timing=$6, state=$7,
           criteria=$8, contact_template=$9, statuses=$10, metrics=$11, updated_at=now()`,
        [s.id, s.name, s.lookingFor || "", s.budget || "", s.area || "", s.timing || "", s.state || "Active",
         s.criteria || "", s.contactTemplate || "", JSON.stringify(s.statuses || []), JSON.stringify(s.metrics || [])],
      );
    }
    for (const l of snap.listings || []) {
      await client.query(
        `insert into listings (id, search_id, title, price, score, status, notes, url, location, description, summary, source, photos, fields)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (id) do update set search_id=$2, title=$3, price=$4, score=$5,
           status = case when $15 then $6 else listings.status end,
           notes = case when $15 then $7 else listings.notes end,
           url=$8, location=$9, description=$10, summary=$11, source=$12, photos=$13, fields=$14, updated_at=now()`,
        [l.id, (l.searchIds || [])[0] || null, l.title || "", l.price ?? null, l.score ?? null, l.status || "",
         l.notes || "", l.url || "", l.location || "", l.description || "", l.summary || "", l.source || "",
         JSON.stringify(l.photos || []), JSON.stringify(l.fields || {}), overwriteTriage],
      );
    }
    for (const s of snap.sources || []) {
      await client.query(
        `insert into sources (id, search_id, name, access, links, method, last_checked, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set search_id=$2, name=$3, access=$4, links=$5, method=$6, last_checked=$7, notes=$8, updated_at=now()`,
        [s.id, (s.searchIds || [])[0] || null, s.name || "", s.access || "", JSON.stringify(s.links || []),
         s.method || "", s.lastChecked || "", s.notes || ""],
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
