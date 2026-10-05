// Search edits + a full crawl against a real Postgres, with the listing sites
// mocked (global fetch) and no ANTHROPIC_API_KEY (unscored path).
//   TEST_DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test npm test
import { skip, fixture } from "./env.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";

const req = (path, init = {}) => new Request("http://localhost" + path, init);
let api, db, realFetch;

before(async () => {
  if (skip) return;
  ({ db } = await import("../lib/db.js"));
  await db().query("drop table if exists listings, sources, searches, sync_state cascade");
  api = {
    importer: await import("../api/admin/import.js"),
    snapshot: await import("../api/snapshot.js"),
    search: await import("../api/searches/[id].js"),
    listing: await import("../api/listings/[id].js"),
    crawl: await import("../api/crawl.js"),
  };
  await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN }, body: await fixture() }));
  // Only Craigslist crawls in this test.
  await db().query("update sources set crawler = '' where crawler <> 'craigslist'");
  realFetch = globalThis.fetch;
});

const snap = async () => (await api.snapshot.GET(req("/api/snapshot"))).json();

test("PATCH /api/searches/:id saves criteria", { skip }, async () => {
  const r = await api.search.PATCH(req("/api/searches/search-west-side", { method: "PATCH", body: JSON.stringify({ criteria: "Above 60th only.", id: "x" }) }));
  assert.equal(r.status, 200);
  assert.equal((await snap()).searches[0].criteria, "Above 60th only.");
  assert.equal((await api.search.PATCH(req("/api/searches/nope", { method: "PATCH", body: JSON.stringify({ criteria: "x" }) }))).status, 404);
});

test("features: seeded, editable on the search, toggled on a listing", { skip }, async () => {
  let s = await snap();
  assert.deepEqual(s.searches[0].features.map(f => f.label), ["Garage", "Gym", "Hot tub", "Sauna", "Cold plunge", "Outdoor space"]);
  assert.deepEqual(s.listings.find(l => l.id === "listing-lb-400679").features, ["Gym", "Garage", "Outdoor space"]);

  const r = await api.search.PATCH(req("/api/searches/search-west-side", { method: "PATCH",
    body: JSON.stringify({ features: [{ label: " Sauna ", points: "5" }, { label: "" }, { label: "Roof", points: 999 }] }) }));
  assert.equal(r.status, 200);
  s = await snap();
  assert.deepEqual(s.searches[0].features, [{ label: "Sauna", points: 5 }, { label: "Roof", points: 50 }]);

  const lr = await api.listing.PATCH(req("/api/listings/listing-1", { method: "PATCH", body: JSON.stringify({ features: ["Sauna", 7] }) }));
  assert.equal(lr.status, 200);
  assert.deepEqual((await snap()).listings.find(l => l.id === "listing-1").features, ["Sauna"]);
});

test("crawl adds new listings, skips known ones, records source status", { skip }, async () => {
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.startsWith("https://sapi.craigslist.org")) {
      return Response.json({ data: { decode: { minPostingId: 7000000000, locationDescriptions: ["Upper West Side"] },
        items: [
          [1, 0, 1, 4200, "1:0~40.7870~-73.9790", "x", [13, "a"], "Sunny 1BR on W 82nd", [6, "sunny-1br-w82"]],
          // same title as an existing listing -> skipped without a fetch
          // repost of the W 82nd unit under a new title -> fetched, then skipped by body text
          [3, 0, 1, 4200, "1:0~40.7870~-73.9790", "x", [13, "c"], "GORGEOUS 1BR W 82nd no fee", [6, "gorgeous-w82"]],
          [2, 0, 1, 4850, "1:0~40.7781~-73.9843", "x", [13, "b"], "267 W 70th St #6E — jumbo corner 1BR, prewar elevator bldg", [6, "dupe"]],
        ] } });
    }
    if (url === "https://www.craigslist.org/view/d/sunny-1br-w82/a" || url === "https://www.craigslist.org/view/d/gorgeous-w82/c") {
      return new Response(`<html><section id="postingbody">Big 1BR, elevator, near the 1 train. Sunny, quiet, renovated kitchen and bath, laundry in the building, pets ok.</section>
        <div id="map" data-latitude="40.7870" data-longitude="-73.9790" data-accuracy="10"></div>
        <img src="https://images.craigslist.org/00a0a_abc_600x450.jpg"></html>`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  try {
    const r = await api.crawl.POST(req("/api/crawl", { method: "POST", body: JSON.stringify({ searchId: "search-west-side" }) }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.added, 1);
    assert.equal(body.scored, false);
    const s = await snap();
    const added = s.listings.find(l => l.id === "crawl-cl-7000000001");
    assert.ok(added, "new listing saved");
    assert.equal(added.status, "New");
    assert.equal(added.price, 4200);
    assert.equal(added.photos.length, 1);
    assert.match(added.description, /Big 1BR/);
    const cl = s.sources.find(x => x.crawler === "craigslist");
    assert.equal(cl.lastStatus, "ok");
    assert.match(cl.lastResult, /3 found · 2 new · 2 worth a look · 1 added · 1 repost skipped/);

    // Rate limit: a second crawl right away is refused.
    const again = await api.crawl.POST(req("/api/crawl", { method: "POST", body: JSON.stringify({ searchId: "search-west-side" }) }));
    assert.equal(again.status, 429);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a blocked site is recorded as blocked, not a crash", { skip }, async () => {
  await db().query("update searches set last_crawl_at = null");
  globalThis.fetch = async () => new Response("no", { status: 403 });
  try {
    const r = await api.crawl.POST(req("/api/crawl", { method: "POST", body: JSON.stringify({ searchId: "search-west-side" }) }));
    assert.equal(r.status, 200);
    const cl = (await snap()).sources.find(x => x.crawler === "craigslist");
    assert.equal(cl.lastStatus, "blocked");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("photos still on their source site are found and can be swapped for Blob copies", { skip }, async () => {
  const pg = await import("../lib/postgres.js");
  // The seed was imported with photos=0, so its photos still point at source sites.
  const outside = await pg.listingsWithOutsidePhotos("search-west-side");
  const l = outside.find(x => x.id === "listing-1");
  assert.ok(l && l.photos.length, "listing-1 needs importing");
  const blob = "https://abc.public.blob.vercel-storage.com/photos/listing-1/";
  await pg.setListingPhotos("listing-1", l.photos.map(p => ({ ...p, original: p.url, url: blob + p.id + ".jpg" })));
  assert.ok(!(await pg.listingsWithOutsidePhotos("search-west-side")).some(x => x.id === "listing-1"));
  const saved = (await snap()).listings.find(x => x.id === "listing-1");
  assert.ok(saved.photos.every(p => p.url.startsWith(blob)));
});

test("a crawl without a Blob store says photos weren't saved", { skip }, async () => {
  await db().query("update searches set last_crawl_at = null");
  globalThis.fetch = async () => new Response("no", { status: 403 });
  try {
    const body = await (await api.crawl.POST(req("/api/crawl", { method: "POST", body: JSON.stringify({ searchId: "search-west-side" }) }))).json();
    assert.deepEqual(body.photos, { enabled: false, copied: 0, failed: 0, left: 0 });
  } finally {
    globalThis.fetch = realFetch;
  }
});
