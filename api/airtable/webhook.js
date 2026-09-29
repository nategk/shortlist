// POST /api/airtable/webhook: Airtable's change notification. The ping is
// signed with the webhook's MAC secret (kept in Neon) and carries no data;
// lib/sync.js reads the changes since its cursor and syncs those records.
import { createHmac, timingSafeEqual } from "node:crypto";
import { processWebhook, webhookSecret } from "../../lib/sync.js";
import { json, fail } from "../../lib/http.js";

export async function POST(request) {
  try {
    const body = Buffer.from(await request.arrayBuffer());
    const hook = await webhookSecret();
    if (!hook) return json({ error: "No webhook registered." }, 404);
    const expected = "hmac-sha256=" + createHmac("sha256", hook.secret).update(body).digest("hex");
    const got = request.headers.get("x-airtable-content-mac") || "";
    if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
      return json({ error: "Bad signature." }, 401);
    }
    let ping = {};
    try { ping = JSON.parse(body.toString("utf8")); } catch (e) {}
    if (ping.webhook && ping.webhook.id && ping.webhook.id !== hook.id) return json({ ok: true, ignored: "unknown webhook" });
    return json(await processWebhook());
  } catch (e) {
    return fail(e);
  }
}
