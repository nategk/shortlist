// Airtable sync, full pass: make sure the Airtable webhook exists and is
// refreshed (Airtable expires them after 7 days), then reconcile every
// table both ways (lib/sync.js).
//   GET  /api/sync   Vercel Cron (daily, vercel.json): Authorization: Bearer $CRON_SECRET
//   POST /api/sync   by hand:  Authorization: Bearer $ADMIN_TOKEN
import { ensureWebhook, syncAll } from "../lib/sync.js";
import { json, fail, requireAdmin, isCron } from "../lib/http.js";

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
