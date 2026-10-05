// Layer extension points (lib/layer.js), intake (api/intake), the
// availability re-check and the daily-crawl cron gate, against a real
// Postgres with no ANTHROPIC_API_KEY (unscored path).
//   TEST_DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test npm test
import { skip, ADMIN } from "./env.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { attributes, postingUrl } from "../lib/crawlers/craigslist.js";

const req = (path, init = {}) => new Request("http://localhost" + path, init);
const auth = { authorization: "Bearer " + ADMIN };
let api, db;

const SEARCH = {
  id: "search-desk", name: "Standing desk", criteria: "Solid frame, 25-50in height range.",
  statuses: [{ label: "New", group: "review" }, { label: "Shortlist", group: "shortlist" }, { label: "Bought", group: "done" },
    { label: "Passed", group: "archived" }, { label: "Sold", group: "archived" }],
  metrics: [{ field: "Product page", label: "Product page", unit: "", good: null, ok: null }],
};

before(async () => {
  if (skip) return;
  ({ db } = await import("../lib/db.js"));
  await db().query("drop table if exists listings, sources, searches, sync_state cascade");
  const layer = await import("../lib/layer.js");
  layer.registerCrawler("fakesite", {
    Blocked: class extends Error {},
    discover: async () => [{ key: "fk-1", title: "Uplift V2 desk" }, { key: "fk-2", title: "Jarvis bamboo desk" }],
    details: async c => ({ url: "https://fake.example/" + c.key, title: c.title, price: 400, location: "Brooklyn",
      description: "Desk " + c.key + " in great shape, barely used, from a smoke-free home, pickup only, frame and top included.",
      photos: [{ id: c.key + "-0", url: "https://fake.example/" + c.key + ".jpg" }], raw: {} }),
    alive: async l => !l.url.endsWith("/dead"),
  });
  layer.registerEnricher("official", async ({ listing, details }) => {
    if (!/Uplift/.test(details.title)) return;
    listing.photos.push({ id: "official-uplift", url: "https://maker.example/uplift.jpg", label: "Official" });
    listing.fields["Product page"] = "https://maker.example/uplift-v2";
  });
  layer.registerEnricher("broken", async () => { throw new Error("boom"); });
  api = {
    importer: await import("../api/admin/import.js"),
    snapshot: await import("../api/snapshot.js"),
    crawl: await import("../api/crawl.js"),
    intake: await import("../api/intake.js"),
  };
  const snap = {
    searches: [SEARCH],
    sources: [{ id: "src-fake", searchIds: ["search-desk"], name: "Fake site", crawler: "fakesite" },
      { id: "desk-fb", searchIds: ["search-desk"], name: "Facebook Marketplace", access: "Manual" }],
    listings: [
      { id: "l-dead", searchIds: ["search-desk"], title: "Old desk", status: "Shortlist", source: "Fake site", url: "https://fake.example/dead" },
      { id: "l-up", searchIds: ["search-desk"], title: "Other desk", status: "New", source: "Fake site", url: "https://fake.example/up" },
      { id: "l-passed", searchIds: ["search-desk"], title: "Passed desk", status: "Passed", source: "Fake site", url: "https://fake.example/dead" },
    ],
  };
  const r = await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: auth, body: JSON.stringify(snap) }));
  assert.equal(r.status, 200);
});

const snap = async () => (await api.snapshot.GET(req("/api/snapshot"))).json();

test("craigslist: new attribute markup and posting URLs", () => {
  const html = `<div class="attrgroup"><div class="attr condition"><span class="labl">condition:</span>
    <span class="valu"> <a href="x">excellent</a></span></div><div class="attr"><span class="labl">make / manufacturer:</span><span class="valu">Herman Miller</span></div></div>`;
  assert.deepEqual(attributes(html), ["condition: excellent", "make / manufacturer: Herman Miller"]);
  assert.deepEqual(attributes(`<span class="attr important">1BR / 1Ba</span>`), ["1BR / 1Ba"]);
  assert.equal(postingUrl({ slug: "a-desk", code: "XyZ", pid: "1" }), "https://www.craigslist.org/view/d/a-desk/XyZ");
  assert.equal(postingUrl({ slug: "a-desk", pid: "7", subarea: "brk" }, { category: "fuo" }), "https://newyork.craigslist.org/brk/fuo/d/a-desk/7.html");
});

test("a layer's crawler and enrichers run in the crawl; gone posts are marked sold", { skip }, async () => {
  const r = await api.crawl.POST(req("/api/crawl", { method: "POST", body: JSON.stringify({ searchId: "search-desk" }) }));
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.added, 2);
  const s = await snap();
  const uplift = s.listings.find(l => l.id === "crawl-fk-1");
  assert.deepEqual(uplift.photos.map(p => p.label || ""), ["", "Official"], "official image last, labeled");
  assert.equal(uplift.fields["Product page"], "https://maker.example/uplift-v2");
  assert.equal(s.listings.find(l => l.id === "crawl-fk-2").photos.length, 1, "a throwing enricher doesn't stop the save");

  assert.equal(body.availability.status, "Sold");
  assert.equal(s.listings.find(l => l.id === "l-dead").status, "Sold");
  assert.equal(s.listings.find(l => l.id === "l-up").status, "New");
  assert.equal(s.listings.find(l => l.id === "l-passed").status, "Passed", "archived listings aren't re-checked");
});

test("intake: admin only, screens then adds, skips what it has seen", { skip }, async () => {
  const post = (body, headers = auth) => api.intake.POST(req("/api/intake", { method: "POST", headers, body: JSON.stringify(body) }));
  assert.equal((await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "screen", candidates: [{ key: "fb-1" }] }, {})).status, 401);
  assert.equal((await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "nope" })).status, 400);
  assert.equal((await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "screen", candidates: [{ title: "no key" }] })).status, 400);
  assert.equal((await post({ searchId: "nope", source: "Facebook Marketplace", step: "screen", candidates: [{ key: "x" }] })).status, 404);

  const candidates = [
    { key: "fb-1", title: "Herman Miller Aeron size B", price: "$450", location: "Park Slope", url: "https://www.facebook.com/marketplace/item/1/" },
    { key: "fb-2", title: "Uplift V2 desk", price: 300, url: "https://fake.example/fk-1-already" },
  ];
  let r = await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "screen", candidates });
  let body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.deepEqual(body.keep, ["fb-1"], "a title already on the board is dropped");

  r = await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "add", items: [{
    key: "fb-1", url: "https://www.facebook.com/marketplace/item/1/", title: "Herman Miller Aeron size B", price: "$450",
    location: "Park Slope", description: "Fully loaded Aeron, size B, graphite, lumbar pad, all levers work. Pickup in Park Slope.",
    photos: ["https://scontent.example/1.jpg", { url: "https://scontent.example/2.jpg" }, "javascript:alert(1)"] }] });
  body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.added, 1);
  const s = await snap();
  const aeron = s.listings.find(l => l.id === "crawl-fb-1");
  assert.equal(aeron.price, 450);
  assert.equal(aeron.source, "Facebook Marketplace");
  assert.equal(aeron.photos.length, 2);
  assert.equal(s.sources.filter(x => x.name === "Facebook Marketplace").length, 1, "intake files under the existing source");
  const src = s.sources.find(x => x.name === "Facebook Marketplace");
  assert.equal(src.id, "desk-fb");
  assert.match(src.lastResult, /1 sent · 1 added/);

  // Sent again: already on the board, and a re-screen doesn't offer it.
  body = await (await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "add", items: [{ key: "fb-1", url: "https://www.facebook.com/marketplace/item/1/", title: "x" }] })).json();
  assert.equal(body.added, 0);
  assert.equal(body.known, 1);
  body = await (await post({ searchId: "search-desk", source: "Facebook Marketplace", step: "screen", candidates })).json();
  assert.deepEqual(body.keep, []);
});

test("daily crawl: cron runs only where DAILY_CRAWL=1; by hand needs the admin token", { skip }, async () => {
  process.env.CRON_SECRET = "cron-secret-1234567890";
  try {
    assert.equal((await api.crawl.GET(req("/api/crawl"))).status, 401);
    const off = await (await api.crawl.GET(req("/api/crawl", { headers: { authorization: "Bearer cron-secret-1234567890" } }))).json();
    assert.match(off.skipped, /DAILY_CRAWL/);
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push([String(url), JSON.parse(init.body).searchId]); return Response.json({ ok: true, added: 3 }); };
    try {
      const on = await (await api.crawl.GET(req("/api/crawl", { headers: auth }))).json();
      assert.deepEqual(calls, [["http://localhost/api/crawl", "search-desk"]]);
      assert.deepEqual(on.runs, [{ searchId: "search-desk", status: 200, added: 3, gone: 0 }]);
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    delete process.env.CRON_SECRET;
  }
});
