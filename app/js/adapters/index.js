// Adapter registry. To add a database type (Supabase, Google Sheets, Notion,
// a REST API...), write a module exporting FIELDS_FOR_SETTINGS and
// create(config) -> { kind, describe(), pull(), pushListing(id, patch) }
// and register it here. See ARCHITECTURE.md for the contract.
import * as airtable from "./airtable.js";
import * as json from "./json.js";

export const ADAPTERS = {
  airtable: { label: "Airtable", module: airtable },
  json: { label: "JSON snapshot (read-only)", module: json },
};

const KEY = "shortlist.connection";
export const DEFAULT_CONNECTION = { adapter: "json", url: "demo/west-side-1br.json" };

export function loadConnection() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && ADAPTERS[c.adapter]) return c;
  } catch (e) {}
  return { ...DEFAULT_CONNECTION };
}

export function saveConnection(conn) {
  try { localStorage.setItem(KEY, JSON.stringify(conn)); } catch (e) {}
}

export function createAdapter(conn) {
  return ADAPTERS[conn.adapter].module.create(conn);
}

// Stable id for the cache: switching databases never mixes their data.
export function connectionKey(conn) {
  return conn.adapter + ":" + (conn.baseId || conn.url || "");
}
