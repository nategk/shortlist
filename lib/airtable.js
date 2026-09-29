// Server-side Airtable REST client for the sync (lib/sync.js). Credentials
// come only from env vars and never reach the browser:
//   AIRTABLE_TOKEN    personal access token with data.records:read,
//                     data.records:write, schema.bases:read, webhook:manage
//                     on this one base
//   AIRTABLE_BASE_ID  appXXXXXXXXXXXXXX
const API = "https://api.airtable.com/v0/";
const GAP_MS = Number(process.env.AIRTABLE_MIN_GAP_MS ?? 220); // Airtable allows 5 requests/second per base

export function airtableConfig() {
  const token = process.env.AIRTABLE_TOKEN || "", baseId = process.env.AIRTABLE_BASE_ID || "";
  return token && baseId ? { token, baseId } : null;
}

export function client({ token, baseId }, { fetch: fetchImpl = globalThis.fetch } = {}) {
  let last = 0;
  async function request(path, init = {}) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetchImpl(API + path, {
        ...init, signal: ctrl.signal,
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      });
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "Airtable didn't respond in 30s." : "Couldn't reach Airtable (" + e.message + ").");
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type || j.error)) || msg; } catch (e) {}
      const err = new Error("Airtable " + res.status + ": " + (typeof msg === "string" ? msg : JSON.stringify(msg)));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  const base = encodeURIComponent(baseId);
  const table = t => base + "/" + encodeURIComponent(t);
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  return {
    baseId,

    // [{id, name, fields: [{id, name, type, options}]}]
    async tables() {
      return (await request("meta/bases/" + base + "/tables")).tables;
    },

    async listAll(tableId) {
      const out = [];
      let offset = "";
      do {
        const j = await request(table(tableId) + "?pageSize=100" + (offset ? "&offset=" + encodeURIComponent(offset) : ""));
        out.push(...j.records);
        offset = j.offset || "";
      } while (offset);
      return out;
    },

    // Records by id; ids that no longer exist are simply missing.
    async getMany(tableId, ids) {
      const out = [];
      for (const group of chunks([...new Set(ids)], 50)) {
        const formula = "OR(" + group.map(id => `RECORD_ID()='${id.replace(/[^A-Za-z0-9]/g, "")}'`).join(",") + ")";
        let offset = "";
        do {
          const j = await request(table(tableId) + "?pageSize=100&filterByFormula=" + encodeURIComponent(formula) + (offset ? "&offset=" + encodeURIComponent(offset) : ""));
          out.push(...j.records);
          offset = j.offset || "";
        } while (offset);
      }
      return out;
    },

    // records: [{fields}] -> created records, in order
    async create(tableId, records) {
      const out = [];
      for (const group of chunks(records, 10)) {
        const j = await request(table(tableId), { method: "POST", body: JSON.stringify({ records: group, typecast: true }) });
        out.push(...j.records);
      }
      return out;
    },

    // records: [{id, fields}]
    async update(tableId, records) {
      const out = [];
      for (const group of chunks(records, 10)) {
        const j = await request(table(tableId), { method: "PATCH", body: JSON.stringify({ records: group, typecast: true }) });
        out.push(...j.records);
      }
      return out;
    },

    // ---- webhooks ----
    createWebhook(notificationUrl) {
      return request("bases/" + base + "/webhooks", {
        method: "POST",
        body: JSON.stringify({ notificationUrl, specification: { options: { filters: { dataTypes: ["tableData"] } } } }),
      });
    },
    listWebhooks() { return request("bases/" + base + "/webhooks"); },
    refreshWebhook(id) { return request("bases/" + base + "/webhooks/" + id + "/refresh", { method: "POST" }); },
    enableNotifications(id) {
      return request("bases/" + base + "/webhooks/" + id + "/enableNotifications", { method: "POST", body: JSON.stringify({ enable: true }) });
    },
    deleteWebhook(id) { return request("bases/" + base + "/webhooks/" + id, { method: "DELETE" }); },
    payloads(id, cursor) { return request("bases/" + base + "/webhooks/" + id + "/payloads?cursor=" + cursor); },
  };
}
