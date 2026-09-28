// PATCH /api/searches/:id  { criteria?, contactTemplate?, lookingFor?, budget?, area?, timing?,
//                            features?: [{label, points}] }
// Edits a search's text fields from the UI. Open like triage.
import { backend } from "../../lib/backend.js";
import { json, fail } from "../../lib/http.js";

const FIELDS = ["criteria", "contactTemplate", "lookingFor", "budget", "area", "timing"];

export async function PATCH(request) {
  try {
    const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop());
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON." }, 400); }
    const patch = {};
    for (const f of FIELDS) if (typeof body[f] === "string") patch[f] = body[f].slice(0, f === "criteria" || f === "contactTemplate" ? 50000 : 500);
    if (Array.isArray(body.features)) {
      patch.features = body.features
        .filter(f => f && typeof f.label === "string" && f.label.trim())
        .slice(0, 50)
        .map(f => ({ label: f.label.trim().slice(0, 60), points: Math.max(-50, Math.min(50, Number(f.points) || 0)) }));
    }
    if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);
    const b = backend();
    if (!b.updateSearch) return json({ error: "This backend can't edit searches." }, 405);
    const found = await b.updateSearch(id, patch);
    return found ? json({ ok: true, id }) : json({ error: "No search with id " + id }, 404);
  } catch (e) {
    return fail(e);
  }
}
