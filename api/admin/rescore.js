// POST /api/admin/rescore  (Authorization: Bearer $ADMIN_TOKEN)
//   { searchId, all?: true, after?: "<id>" }
// Scores a search's listings again in place (lib/crawl.js rescoreSearch):
// unscored ones by default, every one with all. Returns { rescored, more,
// after }; while more is true, call again with that `after`.
import { rescoreSearch } from "../../lib/crawl.js";
import { pushAfterWrite } from "../../lib/sync.js";
import { json, fail, requireAdmin } from "../../lib/http.js";

export async function POST(request) {
  try {
    requireAdmin(request);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (!body.searchId || typeof body.searchId !== "string") return json({ error: "Send { searchId }." }, 400);
    const { changed, ...out } = await rescoreSearch(body.searchId, { all: !!body.all, after: typeof body.after === "string" ? body.after : "" });
    const airtable = await pushAfterWrite(changed);
    return json({ ok: true, ...out, airtable });
  } catch (e) {
    return fail(e);
  }
}
