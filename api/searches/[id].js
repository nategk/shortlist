// PATCH /api/searches/:id  { criteria?, contactTemplate?, lookingFor?, budget?, area?, timing?,
//                            features?: [{label, points}], home? }
// Edits a search's text fields from the UI. Open like triage.
// `home` (the home / delivery location) is geocoded here and set on every
// search in the same collection; the reply carries what it resolved to.
import * as postgres from "../../lib/postgres.js";
import { locate } from "../../lib/geo.js";
import { pushAfterWrite } from "../../lib/sync.js";
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
    if (typeof body.home === "string") {
      patch.home = body.home.replace(/\s+/g, " ").trim().slice(0, 300);
      patch.homeGeo = patch.home ? await locate({ location: patch.home }) : null;
    }
    if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);
    const found = await postgres.updateSearch(id, patch);
    if (!found) return json({ error: "No search with id " + id }, 404);
    await pushAfterWrite({ searches: [id] });
    return json({ ok: true, id, ...("home" in patch ? { homeGeo: patch.homeGeo } : {}) });
  } catch (e) {
    return fail(e);
  }
}
