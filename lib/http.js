import { timingSafeEqual } from "node:crypto";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function fail(e) {
  const status = e.status || 500;
  // Don't leak connection strings or stack traces to the public.
  const message = status >= 500 ? "Server error: " + String(e.message || e).replace(/postgres(ql)?:\/\/\S+/g, "[db]") : e.message;
  if (status >= 500) console.error(e);
  return json({ error: message }, status);
}

// Admin endpoints require ADMIN_TOKEN as a Bearer token. If it isn't set,
// admin endpoints are disabled entirely.
export function requireAdmin(request) {
  const expected = process.env.ADMIN_TOKEN || "";
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const ok = expected.length >= 16 && got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) {
    const e = new Error(expected ? "Unauthorized." : "Admin endpoints are disabled: set ADMIN_TOKEN (16+ chars) in the Vercel project's environment variables.");
    e.status = 401;
    throw e;
  }
}

// Vercel Cron calls carry Authorization: Bearer $CRON_SECRET.
export function isCron(request) {
  const secret = process.env.CRON_SECRET || "";
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return secret.length >= 16 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}
