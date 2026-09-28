// Adapter registry. To add a database type (Supabase, Google Sheets, Notion,
// a REST API...), write a module exporting FIELDS_FOR_SETTINGS and
// create(config) -> { kind, describe(), pull(), pushListing(id, patch) }
// and register it here. See ARCHITECTURE.md for the contract.
import * as api from "./api.js";
import * as airtable from "./airtable.js";
import * as json from "./json.js";

export const ADAPTERS = {
  api: { label: "This site's database (hosted)", module: api },
  airtable: { label: "Airtable (direct, token on this device)", module: airtable },
  json: { label: "JSON snapshot (read-only)", module: json },
};

const KEY = "shortlist.connection";
const DEMO = { adapter: "json", url: "demo/west-side-1br.json" };

// Saved choice first. Otherwise use the hosted API when this site has one
// (a Vercel deploy), and fall back to the demo snapshot (static hosting,
// local file server).
export async function loadConnection() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && ADAPTERS[c.adapter]) return c;
  } catch (e) {}
  return (await api.detect()) ? { adapter: "api" } : { ...DEMO };
}

export function saveConnection(conn) {
  try { localStorage.setItem(KEY, JSON.stringify(conn)); } catch (e) {}
}

export function createAdapter(conn) {
  return ADAPTERS[conn.adapter].module.create(conn);
}

// Stable id for the cache: switching databases never mixes their data.
export function connectionKey(conn) {
  return conn.adapter + ":" + (conn.baseId || conn.url || conn.base || location.host);
}
