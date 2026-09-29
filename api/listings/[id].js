// PATCH /api/listings/:id  { status?, notes?, features? } -> triage write.
// Open to anyone with the link (by choice: nothing here is private), so it
// only accepts these fields, bounded in size.
import * as postgres from "../../lib/postgres.js";
import { pushAfterWrite } from "../../lib/sync.js";
import { json, fail } from "../../lib/http.js";

export async function PATCH(request) {
  try {
    const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop());
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON." }, 400); }
    const patch = {};
    if (typeof body.status === "string") patch.status = body.status.slice(0, 100);
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 10000);
    if (Array.isArray(body.features)) patch.features = body.features.filter(f => typeof f === "string").slice(0, 50).map(f => f.slice(0, 60));
    if (!Object.keys(patch).length) return json({ error: "Nothing to update: send status, notes and/or features." }, 400);
    const found = await postgres.updateListing(id, patch);
    if (!found) return json({ error: "No listing with id " + id }, 404);
    await pushAfterWrite({ listings: [id] });
    return json({ ok: true, id, ...patch });
  } catch (e) {
    return fail(e);
  }
}
