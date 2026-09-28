// Integration test: the real /api handlers against a real Postgres.
//   DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test ADMIN_TOKEN=... npm test
// Skips when DATABASE_URL isn't set.
import { test, before } from "node:test";
import assert from "node:assert/strict";

const ADMIN = process.env.ADMIN_TOKEN || "test-admin-token-123456";
process.env.ADMIN_TOKEN = ADMIN;
const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";

const req = (path, init = {}) => new Request("http://localhost" + path, init);
let api;

before(async () => {
  if (skip) return;
  const { db } = await import("../lib/db.js");
  await db().query("drop table if exists listings, sources, searches cascade");
  api = {
    health: await import("../api/health.js"),
    snapshot: await import("../api/snapshot.js"),
    listing: await import("../api/listings/[id].js"),
    importer: await import("../api/admin/import.js"),
  };
});

test("import requires the admin token", { skip }, async () => {
  const r = await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST" }));
  assert.equal(r.status, 401);
  const wrong = await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer nope" } }));
  assert.equal(wrong.status, 401);
});

test("seed import creates the schema and loads the demo search", { skip }, async () => {
  const r = await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer " + ADMIN } }));
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  const { demoSnapshot } = await import("../lib/backend.js");
  const demo = await demoSnapshot();
  assert.deepEqual(body.imported, { searches: demo.searches.length, listings: demo.listings.length, sources: demo.sources.length });
});

test("health reports postgres without leaking the connection string", { skip }, async () => {
  const body = await (await api.health.GET(req("/api/health"))).json();
  assert.equal(body.backend, "postgres");
  assert.ok(!JSON.stringify(body).includes("dev@"), "password must not appear");
});

test("snapshot returns the model shape", { skip }, async () => {
  const snap = await (await api.snapshot.GET(req("/api/snapshot"))).json();
  assert.equal(snap.searches[0].name, "West Side 1BR Hunt");
  assert.equal(snap.searches[0].statuses.find(s => s.label === "Shortlist").group, "shortlist");
  const top = snap.listings[0];
  assert.equal(top.score, 92);
  assert.equal(top.status, "Shortlist");
  assert.equal(typeof top.price, "number");
  assert.ok(top.photos.length > 1);
  assert.equal(top.fields["Greenway (mi)"], 0.29);
  assert.deepEqual(top.searchIds, [snap.searches[0].id]);
  assert.ok(snap.sources.some(s => s.links.length));
});

test("PATCH writes status and notes, and only those", { skip }, async () => {
  const r = await api.listing.PATCH(req("/api/listings/listing-5", {
    method: "PATCH", body: JSON.stringify({ status: "Contacted", notes: "Viewing Tue 6pm", price: 1 }),
  }));
  assert.equal(r.status, 200);
  const snap = await (await api.snapshot.GET(req("/api/snapshot"))).json();
  const l = snap.listings.find(x => x.id === "listing-5");
  assert.equal(l.status, "Contacted");
  assert.equal(l.notes, "Viewing Tue 6pm");
  assert.equal(l.price, 4500, "price is not writable");
});

test("PATCH rejects junk and unknown ids", { skip }, async () => {
  assert.equal((await api.listing.PATCH(req("/api/listings/listing-5", { method: "PATCH", body: "{}" }))).status, 400);
  assert.equal((await api.listing.PATCH(req("/api/listings/listing-5", { method: "PATCH", body: "not json" }))).status, 400);
  assert.equal((await api.listing.PATCH(req("/api/listings/nope", { method: "PATCH", body: JSON.stringify({ status: "New" }) }))).status, 404);
});

test("re-import with keepTriage preserves edits", { skip }, async () => {
  await api.importer.POST(req("/api/admin/import?photos=0&keepTriage=1", { method: "POST", headers: { authorization: "Bearer " + ADMIN } }));
  const snap = await (await api.snapshot.GET(req("/api/snapshot"))).json();
  assert.equal(snap.listings.find(x => x.id === "listing-5").status, "Contacted");
});
