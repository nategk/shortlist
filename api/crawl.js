// POST /api/crawl  { searchId } -> crawl every source of that search that has
// a crawler, score new listings with Claude, record per-source status.
// Public like triage; limited to one run per search per 10 minutes.
import { crawlSearch } from "../lib/crawl.js";
import { databaseUrl } from "../lib/db.js";
import { json, fail } from "../lib/http.js";

export async function POST(request) {
  try {
    if (!databaseUrl()) return json({ error: "Crawling needs the Postgres backend (set DATABASE_URL)." }, 501);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (!body.searchId || typeof body.searchId !== "string") return json({ error: "Send { searchId }." }, 400);
    return json({ ok: true, ...(await crawlSearch(body.searchId)) });
  } catch (e) {
    return fail(e);
  }
}
