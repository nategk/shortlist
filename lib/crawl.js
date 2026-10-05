// One crawl of a search: for each of its sources with a crawler, discover
// new items, let Claude screen them against the search's criteria, fetch and
// score the keepers, and save them as new listings. Each source's outcome is
// recorded (ok / blocked / error + a one-line result) for the UI.
//
// The second half of that pipeline (score, enrich, copy photos, save) is
// shared with intake (lib/intake.js), where a browser or phone supplies the
// items instead of a crawler.
import * as pg from "./postgres.js";
import { CRAWLERS } from "./crawlers/index.js";
import { getEnrichers } from "./layer.js";
import { screen, score, scoringEnabled } from "./score.js";
import { copyPhotosToBlob, isBlob } from "./photos.js";
import { blobToken } from "./db.js";
import { groupOf } from "../app/js/model.js";

const MIN_GAP_MS = 10 * 60 * 1000;   // one crawl per search per 10 minutes (the endpoint is public)
const KEEP_PER_SOURCE = 12;          // most listings fetched + scored per source per run
const SEEN_CAP = 4000;
const ALIVE_PER_RUN = 40;            // open listings re-checked per run ("still listed?")

export const safeId = s => String(s).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 120);

export async function parallel(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// What one run carries: the search's context, photo tallies and the ids the
// Airtable sync should push afterwards.
export async function startRun(searchId) {
  const ctx = await pg.crawlContext(searchId);
  if (!ctx) { const e = new Error("No search with id " + searchId); e.status = 404; throw e; }
  return {
    ctx, searchId,
    newStatus: (ctx.search.statuses || []).find(s => s.group === "review")?.label || "New",
    photos: { enabled: !!blobToken(), copied: 0, failed: 0, left: 0 },
    changed: { listings: [], sources: [] },
  };
}

const tally = (run, r) => { run.photos.copied += r.copied; run.photos.failed += r.failed; run.photos.left += r.skipped; };

// Score one fetched item, run the layer's enrichers, copy its photos to Blob
// and save it. Returns "added", "known" (already on the board), "repost" (same
// body text as a listing on the board) or "duplicate" (lost an insert race).
export async function addListing(run, sourceName, key, d) {
  const { ctx } = run;
  if (d.url && ctx.knownUrls.has(d.url)) return "known";
  const body = pg.bodyKey(d.description);
  if (body && ctx.knownBodies.has(body)) return "repost";
  if (body) ctx.knownBodies.add(body);
  const s = scoringEnabled() ? await score(ctx.search, d).catch(() => null) : null;
  const listing = {
    id: "crawl-" + safeId(key), searchId: run.searchId, status: run.newStatus, url: d.url || "", source: sourceName,
    title: s?.title || d.title, price: d.price ?? null, score: s?.score ?? null,
    location: s?.location || d.location, description: d.description,
    summary: s?.summary || (scoringEnabled() ? "Scoring failed; review by hand." : "Not scored (no ANTHROPIC_API_KEY)."),
    photos: d.photos || [], features: s?.features || [], fields: { ...(s?.fields || {}), ...(d.raw?.lat ? { lat: d.raw.lat, lon: d.raw.lon } : {}) },
  };
  for (const { name, fn } of getEnrichers()) {
    try { await fn({ search: ctx.search, listing, details: d }); } catch (e) { console.error(`enricher ${name}:`, e.message || e); }
  }
  tally(run, await copyPhotosToBlob([listing]).catch(() => ({ copied: 0, failed: listing.photos.length, skipped: 0 })));
  if (!(await pg.insertListing(listing))) return "duplicate";
  if (d.url) ctx.knownUrls.add(d.url);
  run.changed.listings.push(listing.id);
  return "added";
}

export async function crawlSearch(searchId, { deadline = Date.now() + 270_000 } = {}) {
  const run = await startRun(searchId);
  const { ctx } = run;
  if (!ctx.sources.length) { const e = new Error("This search has no sources with a crawler set."); e.status = 400; throw e; }
  if (!(await pg.claimCrawl(searchId, MIN_GAP_MS))) {
    const e = new Error("A crawl ran in the last 10 minutes. Try again shortly."); e.status = 429; throw e;
  }
  const results = [];
  run.changed.sources = ctx.sources.map(s => s.id);

  for (const src of ctx.sources) {
    const crawler = CRAWLERS[src.crawler];
    if (!crawler) { await pg.recordSourceRun(src.id, { status: "error", result: `Unknown crawler "${src.crawler}"` }); continue; }
    const seen = new Set(src.seen || []);
    try {
      const found = await crawler.discover(src.config || {}, seen);
      const candidates = Array.isArray(found) ? found : found.candidates;
      const fresh = candidates.filter(c => !seen.has(c.key) && !ctx.knownTitles.has(pg.normTitle(c.title)));
      const keepKeys = new Set(scoringEnabled()
        ? await screen(ctx.search, fresh, KEEP_PER_SOURCE, ctx.board)
        : fresh.slice(0, KEEP_PER_SOURCE).map(c => c.key));
      const kept = fresh.filter(c => keepKeys.has(c.key));

      let added = 0, gone = 0, unfinished = 0, reposts = 0;
      const processed = new Set(fresh.filter(c => !keepKeys.has(c.key)).map(c => c.key));
      await parallel(kept, 3, async c => {
        if (Date.now() > deadline) { unfinished++; return; }
        const d = await crawler.details(c, src.config || {}).catch(() => null);
        processed.add(c.key);
        if (!d) { gone++; return; }
        const r = await addListing(run, src.name, c.key, d);
        if (r === "added") added++; else if (r === "repost") reposts++;
      });

      const seenNext = [...new Set([...(found.seenKeys || []), ...seen, ...processed])].slice(-SEEN_CAP);
      const result = `${candidates.length} found · ${fresh.length} new · ${kept.length} worth a look · ${added} added` +
        (reposts ? ` · ${reposts} repost${reposts === 1 ? "" : "s"} skipped` : "") + (gone ? ` · ${gone} already gone` : "") + (unfinished ? ` · ${unfinished} left for next run` : "");
      await pg.recordSourceRun(src.id, { status: "ok", result, seen: seenNext });
      results.push({ source: src.name, status: "ok", result, added });
    } catch (e) {
      const status = e instanceof crawler.Blocked ? "blocked" : "error";
      const result = String(e.message || e).slice(0, 300);
      await pg.recordSourceRun(src.id, { status, result });
      results.push({ source: src.name, status, result, added: 0 });
    }
  }

  const availability = await checkAvailability(run, deadline).catch(e => ({ checked: 0, gone: 0, error: e.message }));
  await backfillPhotos(run, deadline);
  return { scored: scoringEnabled(), results, photos: run.photos, availability, added: results.reduce((n, r) => n + r.added, 0), changed: run.changed };
}

// Items sell. Open listings (to review, shortlisted, in progress) from a
// source whose crawler can tell are re-checked, oldest check first; a post
// that's gone moves to the search's "Sold" / "Gone" status. Needs such a
// status in the archived group; without one nothing is checked.
export async function checkAvailability(run, deadline) {
  const { ctx } = run;
  const goneStatus = (ctx.search.statuses || []).find(s => s.group === "archived" && /sold|gone|taken|unavailable/i.test(s.label))?.label;
  const bySource = new Map(ctx.sources.map(s => [s.name, CRAWLERS[s.crawler]]).filter(([, c]) => typeof c?.alive === "function"));
  if (!goneStatus || !bySource.size) return { checked: 0, gone: 0 };
  const open = (await pg.listingsToRecheck(run.searchId, [...bySource.keys()], ALIVE_PER_RUN * 3))
    .filter(l => ["review", "shortlist", "active"].includes(groupOf(ctx.search, l.status))).slice(0, ALIVE_PER_RUN);
  let checked = 0, gone = 0;
  await parallel(open, 4, async l => {
    if (Date.now() > deadline) return;
    const up = await bySource.get(l.source).alive(l).catch(() => null);
    if (up === null) return;
    checked++;
    await pg.markChecked(l.id, up ? null : goneStatus);
    if (!up) { gone++; run.changed.listings.push(l.id); }
  });
  return { checked, gone, status: goneStatus };
}

// Every run also imports any photo on the board still hosted by its source
// site (a failed copy, an import made without Blob), since those sites take
// photos down. Whatever doesn't fit before the deadline goes next run.
export async function backfillPhotos(run, deadline) {
  if (!run.photos.enabled) return;
  for (const l of await pg.listingsWithOutsidePhotos(run.searchId).catch(() => [])) {
    if (Date.now() > deadline) { run.photos.left += l.photos.filter(p => !isBlob(p.url)).length; continue; }
    const r = await copyPhotosToBlob([l], { deadline }).catch(() => null);
    if (!r) continue;
    tally(run, r);
    if (r.copied) { await pg.setListingPhotos(l.id, l.photos); run.changed.listings.push(l.id); }
  }
}
