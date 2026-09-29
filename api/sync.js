// Airtable sync, full pass: make sure the Airtable webhook exists and is
// refreshed (Airtable expires them after 7 days), then reconcile every
// table both ways (lib/sync.js).
//   GET  /api/sync   Vercel Cron (daily, vercel.json): Authorization: Bearer $CRON_SECRET
//   POST /api/sync   by hand:  Authorization: Bearer $ADMIN_TOKEN
import { timingSafeEqual } from "node:crypto";
import { ensureWebhook, syncAll } from "../lib/sync.js";
import { json, fail, requireAdmin } from "../lib/http.js";

function isCron(request) {
  const secret = process.env.CRON_SECRET || "";
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return secret.length >= 16 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

async function run() {
  const webhook = await ensureWebhook().catch(e => ({ ok: false, error: e.message }));
  const sync = await syncAll();
  return json({ ok: !!sync.ok, webhook, sync }, sync.ok ? 200 : 503);
}

export async function GET(request) {
  try {
    if (!isCron(request)) requireAdmin(request);
    return await run();
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request) {
  try {
    requireAdmin(request);
    return await run();
  } catch (e) {
    return fail(e);
  }
}
