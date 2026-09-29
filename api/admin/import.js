// POST /api/admin/import   (Authorization: Bearer $ADMIN_TOKEN)
//   body: a snapshot {searches, listings, sources}  -> upsert it into Neon
//   ?keepTriage=1   keep existing status/notes/features for listings already in the DB
//   ?photos=0       skip copying photos into Vercel Blob
// Then syncs Airtable (when configured). `node scripts/remote.mjs push` uses this.
import * as postgres from "../../lib/postgres.js";
import { copyPhotosToBlob } from "../../lib/photos.js";
import { syncAll } from "../../lib/sync.js";
import { json, fail, requireAdmin } from "../../lib/http.js";

export async function POST(request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const text = await request.text();
    if (!text.trim()) return json({ error: "Send a snapshot {searches, listings, sources} as the body." }, 400);
    const snap = JSON.parse(text);

    const photos = url.searchParams.get("photos") === "0"
      ? { enabled: false, copied: 0, failed: 0 }
      : await copyPhotosToBlob(snap.listings || []);
    const counts = await postgres.importSnapshot(snap, { overwriteTriage: url.searchParams.get("keepTriage") !== "1" });
    const airtable = await syncAll({ deadline: Date.now() + 120000 }).catch(e => ({ ok: false, error: e.message }));
    return json({ ok: true, imported: counts, photos, airtable });
  } catch (e) {
    return fail(e);
  }
}
