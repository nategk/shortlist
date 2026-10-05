// POST /api/crawl  { searchId } -> crawl every source of that search that has
// a crawler, score new listings with Claude, re-check open listings are still
// up, record per-source status. Public like triage; limited to one run per
// search per 10 minutes.
//
// GET /api/crawl   Vercel Cron (daily, vercel.json): Authorization: Bearer $CRON_SECRET
//   (or ADMIN_TOKEN by hand). Crawls every active search that has a crawler,
//   each in its own invocation (POST to this endpoint) so each gets the full
//   time limit. The cron only runs where DAILY_CRAWL=1 is set, so a
//   deployment opts in to daily crawling (and its Claude costs).
import { crawlSearch } from "../lib/crawl.js";
import { searchesToCrawl } from "../lib/postgres.js";
import { pushAfterWrite } from "../lib/sync.js";
import { databaseUrl } from "../lib/db.js";
import { json, fail, requireAdmin, isCron } from "../lib/http.js";

export async function POST(request) {
  try {
    if (!databaseUrl()) return json({ error: "Crawling needs the Postgres backend (set DATABASE_URL)." }, 501);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (!body.searchId || typeof body.searchId !== "string") return json({ error: "Send { searchId }." }, 400);
    const { changed, ...out } = await crawlSearch(body.searchId);
    const airtable = await pushAfterWrite(changed);
    return json({ ok: true, ...out, airtable });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request) {
  try {
    const cron = isCron(request);
    if (!cron) requireAdmin(request);
    if (cron && process.env.DAILY_CRAWL !== "1") return json({ ok: true, skipped: "Daily crawl is off: set DAILY_CRAWL=1 to turn it on." });
    if (!databaseUrl()) return json({ error: "Crawling needs the Postgres backend (set DATABASE_URL)." }, 501);
    const self = new URL("/api/crawl", request.url);
    const ids = await searchesToCrawl();
    const runs = await Promise.all(ids.map(async searchId => {
      try {
        const res = await fetch(self, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ searchId }) });
        const out = await res.json().catch(() => ({}));
        return { searchId, status: res.status, added: out.added ?? 0, gone: out.availability?.gone ?? 0, error: out.error };
      } catch (e) {
        return { searchId, status: 0, error: String(e.message || e) };
      }
    }));
    return json({ ok: runs.every(r => r.status === 200 || r.status === 429), runs });
  } catch (e) {
    return fail(e);
  }
}
