// POST /api/admin/import   (Authorization: Bearer $ADMIN_TOKEN)
//   body: a snapshot {searches, listings, sources}  -> upsert it
//   no body / ?seed=demo                              -> load app/demo/west-side-1br.json
//   ?keepTriage=1   keep existing status/notes/features for listings already in the DB
//   ?photos=0       skip copying photos into Vercel Blob
// This is how data gets into Postgres: the first migration, and later the
// scraper/ingest pushing new listings.
import * as postgres from "../../lib/postgres.js";
import { demoSnapshot } from "../../lib/backend.js";
import { copyPhotosToBlob } from "../../lib/photos.js";
import { json, fail, requireAdmin } from "../../lib/http.js";

export async function POST(request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    let snap = null;
    const text = await request.text();
    if (text.trim()) snap = JSON.parse(text);
    if (!snap || url.searchParams.get("seed") === "demo") snap = await demoSnapshot();

    const photos = url.searchParams.get("photos") === "0"
      ? { enabled: false, copied: 0, failed: 0 }
      : await copyPhotosToBlob(snap.listings || []);
    const counts = await postgres.importSnapshot(snap, { overwriteTriage: url.searchParams.get("keepTriage") !== "1" });
    return json({ ok: true, imported: counts, photos });
  } catch (e) {
    return fail(e);
  }
}
