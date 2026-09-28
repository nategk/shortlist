// PATCH /api/listings/:id  { status?, notes? } -> triage write.
// Open to anyone with the link (by choice: nothing here is private), so it
// only accepts these two fields, bounded in size.
import { backend } from "../../lib/backend.js";
import { json, fail } from "../../lib/http.js";

export async function PATCH(request) {
  try {
    const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop());
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON." }, 400); }
    const patch = {};
    if (typeof body.status === "string") patch.status = body.status.slice(0, 100);
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 10000);
    if (!Object.keys(patch).length) return json({ error: "Nothing to update: send status and/or notes." }, 400);
    const found = await backend().updateListing(id, patch);
    return found ? json({ ok: true, id, ...patch }) : json({ error: "No listing with id " + id }, 404);
  } catch (e) {
    return fail(e);
  }
}
