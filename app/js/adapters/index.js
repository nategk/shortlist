// Adapter registry. The app talks to one database: this deployment's /api
// (Neon Postgres, photos in Vercel Blob), cached on the device by store.js.
// Airtable is kept in sync on the server (lib/sync.js), never from the
// browser. An adapter module exports FIELDS_FOR_SETTINGS and
// create(config) -> { kind, describe(), pull(), pushListing(id, patch) }.
import * as api from "./api.js";

export const ADAPTERS = {
  api: { label: "This site's database (hosted)", module: api },
};

const KEY = "shortlist.connection";

export async function loadConnection() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && ADAPTERS[c.adapter]) return c;
  } catch (e) {}
  return { adapter: "api" };
}

export function saveConnection(conn) {
  try { localStorage.setItem(KEY, JSON.stringify(conn)); } catch (e) {}
}

export function createAdapter(conn) {
  return ADAPTERS[conn.adapter].module.create(conn);
}

// Stable id for the cache: switching databases never mixes their data.
export function connectionKey(conn) {
  return conn.adapter + ":" + (conn.base || location.host);
}
