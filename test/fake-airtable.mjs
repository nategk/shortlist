// In-memory Airtable base behind a fetch() stand-in: enough of the REST,
// meta and webhooks APIs for lib/sync.js. Records are keyed by field name,
// like the real API's default response.
export function fakeAirtable(baseId, tables) {
  let seq = 0;
  const nextId = p => p + String(++seq).padStart(14, "0");
  const db = {};
  for (const t of tables) {
    t.id = t.id || nextId("tbl");
    t.fields = t.fields.map(f => ({ id: nextId("fld"), options: {}, ...f }));
    db[t.id] = { table: t, records: new Map() };
  }
  const byName = name => Object.values(db).find(x => x.table.name === name || x.table.id === name);
  const hooks = new Map();
  const payloads = [];
  const calls = [];

  function writeFields(t, rec, fields, typecast) {
    for (const [name, v] of Object.entries(fields)) {
      const f = t.fields.find(x => x.name === name);
      if (!f) { const e = new Error("UNKNOWN_FIELD_NAME " + name); e.status = 422; throw e; }
      if (["lastModifiedTime", "formula"].includes(f.type)) { const e = new Error("computed " + name); e.status = 422; throw e; }
      const empty = v === null || v === "" || v === false || (Array.isArray(v) && !v.length);
      if (empty) { delete rec.fields[name]; continue; }
      if (f.type === "multipleAttachments") {
        const old = rec.fields[name] || [];
        rec.fields[name] = v.map(a => a.id ? old.find(o => o.id === a.id) : { id: nextId("att"), url: a.url, filename: a.filename || "file" }).filter(Boolean);
      } else if (f.type === "singleSelect" || f.type === "multipleSelects") {
        const vals = [].concat(v);
        for (const name2 of vals) {
          const choices = f.options.choices = f.options.choices || [];
          if (!choices.some(c => c.name === name2)) {
            if (!typecast) { const e = new Error("INVALID_MULTIPLE_CHOICE_OPTIONS"); e.status = 422; throw e; }
            choices.push({ id: nextId("sel"), name: name2 });
          }
        }
        rec.fields[name] = v;
      } else rec.fields[name] = v;
    }
    const mod = t.fields.find(f => f.type === "lastModifiedTime");
    if (mod) rec.fields[mod.name] = new Date(Date.now() + 1000).toISOString();   // "after" Neon's write
  }

  const api = {
    calls, hooks, payloads,
    table: name => byName(name).table,
    records: name => [...byName(name).records.values()],
    find: (name, liveId) => api.records(name).find(r => r.fields["Live ID"] === liveId),
    // Edits made "in the Airtable UI": change fields, stamp Last modified,
    // and queue a webhook payload.
    edit(name, recId, fields, { at = Date.now() + 5000 } = {}) {
      const x = byName(name), rec = x.records.get(recId);
      writeFields(x.table, rec, fields, true);
      const mod = x.table.fields.find(f => f.type === "lastModifiedTime");
      if (mod) rec.fields[mod.name] = new Date(at).toISOString();
      payloads.push({ changedTablesById: { [x.table.id]: { changedRecordsById: { [recId]: {} } } } });
    },
    add(name, fields) {
      const x = byName(name), rec = { id: nextId("rec"), createdTime: new Date().toISOString(), fields: {} };
      writeFields(x.table, rec, fields, true);
      x.records.set(rec.id, rec);
      payloads.push({ changedTablesById: { [x.table.id]: { createdRecordsById: { [rec.id]: {} } } } });
      return rec;
    },
    remove(name, recId) {
      const x = byName(name);
      x.records.delete(recId);
      payloads.push({ changedTablesById: { [x.table.id]: { destroyedRecordIds: [recId] } } });
    },

    async fetch(url, init = {}) {
      const u = new URL(url);
      const method = init.method || "GET";
      const path = decodeURIComponent(u.pathname.replace(/^\/v0\//, ""));
      calls.push(method + " " + path);
      const body = init.body ? JSON.parse(init.body) : null;
      const ok = data => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      const err = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });
      try {
        if (path === `meta/bases/${baseId}/tables`) return ok({ tables: tables.map(t => ({ id: t.id, name: t.name, fields: t.fields })) });
        const hookPath = path.match(new RegExp(`^bases/${baseId}/webhooks(?:/([^/]+))?(?:/(\\w+))?$`));
        if (hookPath) {
          const [, id, action] = hookPath;
          if (!id && method === "POST") {
            const h = { id: nextId("ach"), macSecretBase64: Buffer.from("secret-" + seq).toString("base64"), areNotificationsEnabled: true,
              notificationUrl: body.notificationUrl, expirationTime: new Date(Date.now() + 7 * 864e5).toISOString() };
            hooks.set(h.id, h);
            return ok({ id: h.id, macSecretBase64: h.macSecretBase64, expirationTime: h.expirationTime });
          }
          if (!id) return ok({ webhooks: [...hooks.values()] });
          if (!hooks.has(id)) return err(404, "NOT_FOUND");
          if (method === "DELETE") { hooks.delete(id); return new Response(null, { status: 204 }); }
          if (action === "refresh") return ok({ expirationTime: new Date(Date.now() + 7 * 864e5).toISOString() });
          if (action === "enableNotifications") { hooks.get(id).areNotificationsEnabled = true; return ok({}); }
          if (action === "payloads") {
            const cursor = Number(u.searchParams.get("cursor") || 1);
            return ok({ payloads: payloads.slice(cursor - 1), cursor: payloads.length + 1, mightHaveMore: false });
          }
        }
        const m = path.match(new RegExp(`^${baseId}/(.+)$`));
        const x = m && byName(m[1]);
        if (!x) return err(404, "NOT_FOUND");
        if (method === "GET") {
          let recs = [...x.records.values()];
          const f = u.searchParams.get("filterByFormula");
          if (f) { const ids = [...f.matchAll(/RECORD_ID\(\)='(\w+)'/g)].map(y => y[1]); recs = recs.filter(r => ids.includes(r.id)); }
          const off = Number(u.searchParams.get("offset") || 0), size = Number(u.searchParams.get("pageSize") || 100);
          const page = recs.slice(off, off + size);
          return ok({ records: structuredClone(page), ...(off + size < recs.length ? { offset: String(off + size) } : {}) });
        }
        if (method === "POST") {
          const out = body.records.map(r => {
            const rec = { id: nextId("rec"), createdTime: new Date().toISOString(), fields: {} };
            writeFields(x.table, rec, r.fields, body.typecast);
            x.records.set(rec.id, rec);
            return structuredClone(rec);
          });
          return ok({ records: out });
        }
        if (method === "PATCH") {
          const out = body.records.map(r => {
            const rec = x.records.get(r.id);
            if (!rec) throw Object.assign(new Error("ROW_DOES_NOT_EXIST"), { status: 422 });
            writeFields(x.table, rec, r.fields, body.typecast);
            return structuredClone(rec);
          });
          return ok({ records: out });
        }
        return err(405, "method");
      } catch (e) {
        return err(e.status || 500, e.message);
      }
    },
  };
  return api;
}

// The live base's shape (plus a couple of Airtable-only columns).
export const BASE_TABLES = () => [
  { name: "Searches", fields: [
    { name: "Name", type: "singleLineText" }, { name: "Looking for", type: "singleLineText" },
    { name: "Budget", type: "singleLineText" }, { name: "Area", type: "singleLineText" },
    { name: "Timing", type: "singleLineText" }, { name: "State", type: "singleSelect", options: { choices: [{ name: "Active" }] } },
    { name: "Criteria", type: "multilineText" }, { name: "Contact template", type: "multilineText" },
    { name: "Statuses", type: "multilineText" }, { name: "Card metrics", type: "multilineText" },
    { name: "Features", type: "multilineText" }, { name: "Live ID", type: "singleLineText" },
    { name: "Last modified", type: "lastModifiedTime" },
  ] },
  { name: "Sources", fields: [
    { name: "Name", type: "singleLineText" }, { name: "Search", type: "multipleRecordLinks" },
    { name: "Access", type: "singleSelect", options: { choices: [] } }, { name: "Search links", type: "multilineText" },
    { name: "Method", type: "singleLineText" }, { name: "Last checked", type: "date" }, { name: "Notes", type: "multilineText" },
    { name: "Crawler", type: "singleLineText" }, { name: "Last run", type: "dateTime" }, { name: "Last result", type: "singleLineText" },
    { name: "Live ID", type: "singleLineText" }, { name: "Last modified", type: "lastModifiedTime" },
  ] },
  { name: "Listings", fields: [
    { name: "Listing", type: "singleLineText" }, { name: "Photos", type: "multipleAttachments" },
    { name: "Status", type: "singleSelect", options: { choices: [] } }, { name: "Price", type: "currency" },
    { name: "Fit score", type: "number" }, { name: "Neighborhood", type: "singleSelect", options: { choices: [] } },
    { name: "Location", type: "singleLineText" }, { name: "Greenway (mi)", type: "number" }, { name: "Subway (mi)", type: "number" },
    { name: "Subway line", type: "singleLineText" }, { name: "Move-in", type: "singleLineText" },
    { name: "Unit", type: "multilineText" }, { name: "Summary", type: "multilineText" }, { name: "Notes", type: "multilineText" },
    { name: "URL", type: "url" }, { name: "Source", type: "singleSelect", options: { choices: [{ name: "craigslist" }] } },
    { name: "Description", type: "multilineText" }, { name: "Search", type: "multipleRecordLinks" },
    { name: "Features", type: "multipleSelects", options: { choices: [] } }, { name: "Live ID", type: "singleLineText" },
    { name: "Last modified", type: "lastModifiedTime" }, { name: "Price per mi", type: "formula" },
  ] },
];
