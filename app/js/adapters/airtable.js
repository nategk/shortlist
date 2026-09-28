// Airtable adapter. Reads three tables (Searches, Listings, Sources) with the
// REST API and writes status/notes back to Listings. Table and field names are
// the defaults below; override any of them in the connection settings.
//
// The token is a personal access token entered on this device and kept in
// its localStorage. Scope it to data.records:read + data.records:write on
// this one base.
import { parseStatuses, parseMetrics, parseLinks, parseFeatures, featuresText } from "../model.js";

export const DEFAULTS = {
  tables: { searches: "Searches", listings: "Listings", sources: "Sources" },
  fields: {
    search: {
      name: "Name", lookingFor: "Looking for", budget: "Budget", area: "Area", timing: "Timing",
      state: "State", criteria: "Criteria", contactTemplate: "Contact template",
      statuses: "Statuses", metrics: "Card metrics", features: "Features",
    },
    listing: {
      title: "Listing", search: "Search", price: "Price", score: "Fit score", status: "Status",
      notes: "Notes", url: "URL", location: "Location", description: "Description",
      summary: "Summary", source: "Source", photos: "Photos", features: "Features",
    },
    source: {
      name: "Name", search: "Search", access: "Access", links: "Search links",
      method: "Method", lastChecked: "Last checked", notes: "Notes",
    },
  },
};

export const FIELDS_FOR_SETTINGS = [
  { key: "baseId", label: "Base ID", placeholder: "appXXXXXXXXXXXXXX", required: true },
  { key: "token", label: "Personal access token", placeholder: "pat…", secret: true, required: true },
];

export function create(config) {
  const base = config.baseId;
  const tables = { ...DEFAULTS.tables, ...(config.tables || {}) };
  const F = DEFAULTS.fields;
  const api = "https://api.airtable.com/v0/" + encodeURIComponent(base) + "/";
  const headers = { Authorization: "Bearer " + config.token, "Content-Type": "application/json" };

  async function request(path, init = {}) {
    // A stalled connection (captive wifi, plane) must not leave the app
    // "Syncing…" forever; the store retries on the next pull/flush.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try { res = await fetch(api + path, { ...init, headers, signal: ctrl.signal }); }
    catch (e) { throw new Error(e.name === "AbortError" ? "Airtable didn't respond in 20s; will retry." : "Couldn't reach Airtable (" + e.message + ")."); }
    finally { clearTimeout(timer); }
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type || j.error)) || msg; } catch (e) {}
      const err = new Error(res.status === 401 || res.status === 403
        ? "Airtable refused the token (" + msg + "). Check the token's scopes and base access."
        : res.status === 404 ? "Airtable couldn't find that base or table (" + msg + ")." : "Airtable error: " + msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function all(table) {
    const out = [];
    let offset = "";
    do {
      const j = await request(encodeURIComponent(table) + "?pageSize=100" + (offset ? "&offset=" + offset : ""));
      out.push(...j.records);
      offset = j.offset || "";
    } while (offset);
    return out;
  }

  const str = v => (v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.name ?? "") : String(v));
  const num = v => (typeof v === "number" ? v : v === undefined || v === null || v === "" ? null : Number(v));

  return {
    kind: "airtable",
    describe() {
      return { kind: "Airtable", name: "Base " + base, detail: base, writable: true, url: "https://airtable.com/" + base };
    },

    async pull() {
      const [s, l, src] = await Promise.all([all(tables.searches), all(tables.listings), all(tables.sources).catch(() => [])]);
      const searches = s.map(r => {
        const f = r.fields;
        return {
          id: r.id, name: str(f[F.search.name]) || "Untitled search", lookingFor: str(f[F.search.lookingFor]),
          budget: str(f[F.search.budget]), area: str(f[F.search.area]), timing: str(f[F.search.timing]),
          state: str(f[F.search.state]) || "Active", criteria: str(f[F.search.criteria]),
          contactTemplate: str(f[F.search.contactTemplate]),
          statuses: parseStatuses(f[F.search.statuses]), metrics: parseMetrics(f[F.search.metrics]),
          features: parseFeatures(f[F.search.features]),
        };
      });
      const listings = l.map(r => {
        const f = r.fields;
        return {
          id: r.id, searchIds: f[F.listing.search] || [], title: str(f[F.listing.title]) || "Untitled listing",
          price: num(f[F.listing.price]), score: num(f[F.listing.score]), status: str(f[F.listing.status]),
          notes: str(f[F.listing.notes]), url: str(f[F.listing.url]), location: str(f[F.listing.location]),
          description: str(f[F.listing.description]), summary: str(f[F.listing.summary]),
          source: str(f[F.listing.source]),
          photos: (f[F.listing.photos] || []).map(a => ({ id: a.id, url: (a.thumbnails && a.thumbnails.large && a.thumbnails.large.url) || a.url })),
          fields: f, features: Array.isArray(f[F.listing.features]) ? f[F.listing.features] : [],
        };
      });
      const sources = src.map(r => {
        const f = r.fields;
        return {
          id: r.id, searchIds: f[F.source.search] || [], name: str(f[F.source.name]), access: str(f[F.source.access]),
          links: parseLinks(f[F.source.links]), method: str(f[F.source.method]),
          lastChecked: str(f[F.source.lastChecked]), notes: str(f[F.source.notes]),
        };
      });
      return { searches, listings, sources };
    },

    async pushSearch(id, patch) {
      const fields = {};
      if ("criteria" in patch) fields[F.search.criteria] = patch.criteria;
      if ("contactTemplate" in patch) fields[F.search.contactTemplate] = patch.contactTemplate;
      if ("features" in patch) fields[F.search.features] = featuresText(patch.features);
      await request(encodeURIComponent(tables.searches), {
        method: "PATCH",
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
      });
    },

    // patch uses model keys (status, notes, features); only those are written.
    async pushListing(id, patch) {
      const fields = {};
      if ("status" in patch) fields[F.listing.status] = patch.status;
      if ("notes" in patch) fields[F.listing.notes] = patch.notes;
      if ("features" in patch) fields[F.listing.features] = patch.features;
      await request(encodeURIComponent(tables.listings), {
        method: "PATCH",
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
      });
    },
  };
}
