// Search edits + a full crawl against a real Postgres, with the listing sites
// mocked (global fetch) and no ANTHROPIC_API_KEY (unscored path).
//   DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";

const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
delete process.env.ANTHROPIC_API_KEY;
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || "test-admin-token-123456";
const req = (path, init = {}) => new Request("http://localhost" + path, init);
let api, db, realFetch;

before(async () => {
  if (skip) return;
  ({ db } = await import("../lib/db.js"));
  await db().query("drop table if exists listings, sources, searches cascade");
  api = {
    importer: await import("../api/admin/import.js"),
    snapshot: await import("../api/snapshot.js"),
    search: await import("../api/searches/[id].js"),
    crawl: await import("../api/crawl.js"),
  };
  await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN } }));
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

test("crawl adds new listings, skips known ones, records source status", { skip }, async () => {
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.startsWith("https://sapi.craigslist.org")) {
      return Response.json({ data: { decode: { minPostingId: 7000000000, locationDescriptions: ["Upper West Side"] },
        items: [
          [1, 0, 1, 4200, "1:0~40.7870~-73.9790", "x", [13, "a"], "Sunny 1BR on W 82nd", [6, "sunny-1br-w82"]],
          // same title as an existing listing -> skipped without a fetch
          [2, 0, 1, 4850, "1:0~40.7781~-73.9843", "x", [13, "b"], "267 W 70th St #6E — jumbo corner 1BR, prewar elevator bldg", [6, "dupe"]],
        ] } });
    }
    if (url.includes("/sunny-1br-w82/7000000001.html")) {
      return new Response(`<html><section id="postingbody">Big 1BR, elevator, near the 1 train.</section>
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
    assert.match(cl.lastResult, /2 found · 1 new · 1 worth a look · 1 added/);

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
