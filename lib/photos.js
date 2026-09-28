// Copies listing photos into Vercel Blob so they outlive the source site
// (Craigslist deletes photos when a post comes down). Needs
// BLOB_READ_WRITE_TOKEN, which Vercel sets when a Blob store is connected.
// Without it, photos keep their original URLs.
import { put } from "@vercel/blob";

const isBlob = url => /\.blob\.vercel-storage\.com\//.test(url);

export async function copyPhotosToBlob(listings, { concurrency = 6 } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { copied: 0, skipped: 0, failed: 0, enabled: false };
  const jobs = [];
  for (const l of listings) {
    for (const p of l.photos || []) {
      if (!p.url || isBlob(p.url)) continue;
      jobs.push({ l, p });
    }
  }
  let copied = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { l, p } = jobs[i++];
      try {
        const res = await fetch(p.url, { headers: { "user-agent": "Mozilla/5.0 (Shortlist photo import)" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const type = res.headers.get("content-type") || "image/jpeg";
        const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
        const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
        const blob = await put(`photos/${safe(l.id)}/${safe(p.id)}.${ext}`, Buffer.from(await res.arrayBuffer()), {
          access: "public", contentType: type, addRandomSuffix: false, allowOverwrite: true,
        });
        p.original = p.original || p.url;
        p.url = blob.url;
        copied++;
      } catch (e) {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { copied, skipped: 0, failed, enabled: true };
}
