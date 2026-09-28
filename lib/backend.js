// Picks the server-side backend from environment variables:
//   SHORTLIST_BACKEND=postgres|airtable|json   (optional; inferred otherwise)
//   DATABASE_URL / POSTGRES_URL                 -> postgres (default when set)
//   AIRTABLE_TOKEN + AIRTABLE_BASE_ID           -> airtable
//   neither                                     -> json demo (read-only)
// Secrets live only in these env vars; the browser only ever sees /api.
import { readFile } from "node:fs/promises";
import * as postgres from "./postgres.js";
import { databaseUrl } from "./db.js";
import { create as createAirtable } from "../app/js/adapters/airtable.js";

const DEMO_FILE = new URL("../app/demo/west-side-1br.json", import.meta.url);

function choose() {
  const explicit = (process.env.SHORTLIST_BACKEND || "").toLowerCase();
  if (explicit) return explicit;
  if (databaseUrl()) return "postgres";
  if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID) return "airtable";
  return "json";
}

function airtable() {
  const a = createAirtable({ baseId: process.env.AIRTABLE_BASE_ID, token: process.env.AIRTABLE_TOKEN });
  return {
    describe: () => ({ backend: "airtable", kind: "Airtable", name: "Base " + process.env.AIRTABLE_BASE_ID, detail: process.env.AIRTABLE_BASE_ID, writable: true }),
    snapshot: () => a.pull(),
    updateListing: async (id, patch) => { await a.pushListing(id, patch); return true; },
  };
}

function json() {
  return {
    describe: () => ({ backend: "json", kind: "Demo snapshot", name: "west-side-1br.json", detail: "read-only", writable: false }),
    snapshot: async () => JSON.parse(await readFile(DEMO_FILE, "utf8")),
    updateListing: async () => { const e = new Error("The demo backend is read-only."); e.status = 405; throw e; },
  };
}

export function backend() {
  const kind = choose();
  if (kind === "postgres") return postgres;
  if (kind === "airtable") return airtable();
  return json();
}

export async function demoSnapshot() {
  return JSON.parse(await readFile(DEMO_FILE, "utf8"));
}
