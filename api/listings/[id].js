// PATCH /api/listings/:id  { status?, notes?, features?, rank?, threadAdd?, threadRemove? }
// -> triage write. rank: 1..999 or null (unranked); the app renumbers the
// others itself. threadAdd: [{id, at, text}] application notes to add (or
// replace, by id); threadRemove: [id] to delete.
// Open to anyone with the link (by choice: nothing here is private), so it
// only accepts these fields, bounded in size.
import * as postgres from "../../lib/postgres.js";
import { pushAfterWrite } from "../../lib/sync.js";
import { json, fail } from "../../lib/http.js";
import { cleanEntry } from "../../app/js/model.js";

export async function PATCH(request) {
  try {
    const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop());
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON." }, 400); }
    const patch = {};
    if (typeof body.status === "string") patch.status = body.status.slice(0, 100);
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 10000);
    if (Array.isArray(body.features)) patch.features = body.features.filter(f => typeof f === "string").slice(0, 50).map(f => f.slice(0, 60));
    if (body.rank === null || (Number.isInteger(body.rank) && body.rank >= 1 && body.rank <= 999)) patch.rank = body.rank;
    if (Array.isArray(body.threadAdd)) {
      const add = body.threadAdd.slice(0, 50).map(cleanEntry);
      if (add.some(e => !e)) return json({ error: "threadAdd entries need an id, a date (at) and text." }, 400);
      patch.threadAdd = add;
    }
    if (Array.isArray(body.threadRemove)) patch.threadRemove = body.threadRemove.filter(x => typeof x === "string").slice(0, 50);
    if (!Object.keys(patch).length) return json({ error: "Nothing to update: send status, notes, features, rank, threadAdd and/or threadRemove." }, 400);
    const found = await postgres.updateListing(id, patch);
    if (!found) return json({ error: "No listing with id " + id }, 404);
    await pushAfterWrite({ listings: [id] });
    return json({ ok: true, id, ...patch });
  } catch (e) {
    return fail(e);
  }
}
