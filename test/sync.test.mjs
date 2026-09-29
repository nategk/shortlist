// Neon <-> Airtable sync (lib/sync.js) against a real Postgres and an
// in-memory Airtable (test/fake-airtable.mjs).
//   TEST_DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test npm test
import { skip, ADMIN, fixture } from "./env.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeAirtable, BASE_TABLES } from "./fake-airtable.mjs";

const BASE = "appTEST0000000001";
const req = (path, init = {}) => new Request("http://localhost" + path, init);
let at, sync, pg, db, api, realFetch;

before(async () => {
  if (skip) return;
  ({ db } = await import("../lib/db.js"));
  await db().query("drop table if exists listings, sources, searches, sync_state cascade");
  pg = await import("../lib/postgres.js");
  api = {
    importer: await import("../api/admin/import.js"),
    listing: await import("../api/listings/[id].js"),
    sync: await import("../api/sync.js"),
    webhook: await import("../api/airtable/webhook.js"),
  };
  await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer " + ADMIN }, body: await fixture() }));

  at = fakeAirtable(BASE, BASE_TABLES());
  // An Airtable-only column on a record that Neon already has (by Live ID):
  // the first sync must keep it, not wipe it.
  at.add("Listings", { Listing: "old title", "Live ID": "listing-1", Unit: "6E, corner, 2 exposures", Status: "Shortlist" });
  at.payloads.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => String(url).startsWith("https://api.airtable.com/") ? at.fetch(url, init) : realFetch(url, init);
  process.env.AIRTABLE_TOKEN = "patTEST";
  process.env.AIRTABLE_BASE_ID = BASE;
  process.env.SHORTLIST_URL = "https://shortlist.example";
  sync = await import("../lib/sync.js");
});
after(() => { if (realFetch) globalThis.fetch = realFetch; });

const neon = async id => (await pg.snapshot()).listings.find(l => l.id === id);
const syncNow = async () => {
  const r = await api.sync.POST(req("/api/sync", { method: "POST", headers: { authorization: "Bearer " + ADMIN } }));
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return body;
};

test("first sync mirrors Neon into Airtable and registers the webhook", { skip }, async () => {
  const body = await syncNow();
  assert.equal(body.webhook.created, true);
  assert.equal(at.hooks.size, 1);
  assert.equal([...at.hooks.values()][0].notificationUrl, "https://shortlist.example/api/airtable/webhook");
  const snap = await pg.snapshot();
  assert.equal(at.records("Searches").length, snap.searches.length);
  assert.equal(at.records("Sources").length, snap.sources.length);
  assert.equal(at.records("Listings").length, snap.listings.length);

  const rec = at.find("Listings", "listing-1");
  const l = snap.listings.find(x => x.id === "listing-1");
  assert.equal(rec.fields.Listing, l.title, "Neon wins on first link");
  assert.equal(rec.fields.Unit, "6E, corner, 2 exposures", "Airtable-only data survives the first link");
  assert.equal((await neon("listing-1")).fields.Unit, "6E, corner, 2 exposures", "and is pulled into Neon");
  assert.equal(rec.fields["Greenway (mi)"], l.fields["Greenway (mi)"]);
  assert.deepEqual(rec.fields.Photos.map(p => p.filename), l.photos.map(p => p.id));
  assert.deepEqual(rec.fields.Search, [at.find("Searches", snap.searches[0].id).id]);
  assert.equal(at.find("Sources", "source-craigslist").fields.Search[0], at.find("Searches", snap.searches[0].id).id);
  assert.match(at.find("Searches", snap.searches[0].id).fields.Statuses, /^New: review\n/);
});

test("a second sync changes nothing", { skip }, async () => {
  at.calls.length = 0;
  const body = await syncNow();
  assert.deepEqual([body.sync.toAirtable, body.sync.toNeon, body.sync.created, body.sync.imported, body.sync.deleted], [0, 0, 0, 0, 0]);
  assert.ok(!at.calls.some(c => /^(PATCH|POST) appTEST/.test(c)), at.calls.join("\n"));
});

test("a triage edit in the app is pushed to Airtable right away", { skip }, async () => {
  const r = await api.listing.PATCH(req("/api/listings/listing-2", { method: "PATCH", body: JSON.stringify({ status: "Contacted", notes: "Called Ramón", features: ["Gym"] }) }));
  assert.equal(r.status, 200);
  const rec = at.find("Listings", "listing-2");
  assert.equal(rec.fields.Status, "Contacted");
  assert.equal(rec.fields.Notes, "Called Ramón");
  assert.deepEqual(rec.fields.Features, ["Gym"]);
});

async function ping() {
  const hook = [...at.hooks.values()][0];
  const body = JSON.stringify({ base: { id: BASE }, webhook: { id: hook.id }, timestamp: new Date().toISOString() });
  const mac = "hmac-sha256=" + createHmac("sha256", Buffer.from(hook.macSecretBase64, "base64")).update(body).digest("hex");
  const r = await api.webhook.POST(req("/api/airtable/webhook", { method: "POST", headers: { "x-airtable-content-mac": mac }, body }));
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  return out;
}

test("the webhook rejects unsigned pings", { skip }, async () => {
  const r = await api.webhook.POST(req("/api/airtable/webhook", { method: "POST", headers: { "x-airtable-content-mac": "hmac-sha256=00" }, body: "{}" }));
  assert.equal(r.status, 401);
});

test("any field edited in Airtable flows back to Neon on the webhook ping", { skip }, async () => {
  const rec = at.find("Listings", "listing-5");
  at.edit("Listings", rec.id, { Status: "Viewing booked", "Fit score": 81, Location: "West End Ave at W 61st", "Move-in": "Oct 1", Unit: "12C" });
  const out = await ping();
  assert.equal(out.toNeon, 1);
  const l = await neon("listing-5");
  assert.equal(l.status, "Viewing booked");
  assert.equal(l.score, 81);
  assert.equal(l.location, "West End Ave at W 61st");
  assert.equal(l.fields["Move-in"], "Oct 1");
  assert.equal(l.fields.Unit, "12C");
  // Our own writes come back as payloads too; replaying them is a no-op.
  assert.equal((await ping()).toNeon ?? 0, 0);
});

test("search text edited in Airtable reaches Neon, parsed", { skip }, async () => {
  const snap = await pg.snapshot();
  const rec = at.find("Searches", snap.searches[0].id);
  at.edit("Searches", rec.id, { Features: "Garage | +3\nRoof deck | +5", Budget: "$3,500–$5,000/mo" });
  await ping();
  const s = (await pg.snapshot()).searches[0];
  assert.equal(s.budget, "$3,500–$5,000/mo");
  assert.deepEqual(s.features, [{ label: "Garage", points: 3 }, { label: "Roof deck", points: 5 }]);
});

test("both sides edited: each field goes to the newer edit; untouched fields merge", { skip }, async () => {
  const rec = at.find("Listings", "listing-4");
  await pg.applyPatch("listings", "listing-4", { notes: "neon note", status: "Shortlist" });      // Neon now
  at.edit("Listings", rec.id, { Notes: "airtable note", Summary: "rewritten in Airtable" }, { at: Date.now() - 60000 }); // older
  await ping();
  const l = await neon("listing-4");
  assert.equal(l.notes, "neon note", "Neon's edit was newer");
  assert.equal(l.summary, "rewritten in Airtable", "only Airtable changed this field");
  const after = at.find("Listings", "listing-4");
  assert.equal(after.fields.Notes, "neon note");
  assert.equal(after.fields.Status, "Shortlist");
});

test("a row added in Airtable becomes a Neon listing and gets its Live ID", { skip }, async () => {
  const search = at.records("Searches")[0];
  const rec = at.add("Listings", { Listing: "Hand-added: 300 W 72nd 4B", Status: "New", Price: 4400, Search: [search.id],
    Photos: [{ url: "https://example.com/a.jpg", filename: "IMG_1.jpg" }] });
  await ping();
  const id = "at-" + rec.id;
  const l = await neon(id);
  assert.ok(l, "created in Neon");
  assert.equal(l.title, "Hand-added: 300 W 72nd 4B");
  assert.equal(l.price, 4400);
  assert.equal(l.photos.length, 1);
  const stamped = at.records("Listings").find(r => r.id === rec.id);
  assert.equal(stamped.fields["Live ID"], id);
  assert.deepEqual(stamped.fields.Photos.map(p => p.filename), l.photos.map(p => p.id), "attachments renamed to photo ids");
  at.calls.length = 0;
  await syncNow();
  assert.ok(!at.calls.some(c => /^(PATCH|POST) appTEST\/Listings/.test(c)), "and it's stable afterwards");
});

test("a row deleted in Airtable is deleted in Neon", { skip }, async () => {
  const rec = at.find("Listings", "listing-8");
  at.remove("Listings", rec.id);
  await ping();
  assert.equal(await neon("listing-8"), undefined);
});

test("a full sync won't mass-delete when most records vanish", { skip }, async () => {
  const before = (await pg.snapshot()).listings.length;
  for (const r of at.records("Listings").slice(0, 8)) at.remove("Listings", r.id);
  const body = await syncNow();
  assert.equal((await pg.snapshot()).listings.length, before, "nothing deleted");
  assert.ok(body.sync.skipped.some(s => /not deleting/.test(s)), JSON.stringify(body.sync.skipped));
});

test("health reports sync status without secrets", { skip }, async () => {
  const health = await import("../api/health.js");
  const body = await (await health.GET(req("/api/health"))).json();
  assert.equal(body.airtableSync.configured, true);
  assert.ok(body.airtableSync.lastFullSyncAt);
  assert.ok(body.airtableSync.webhook.expirationTime);
  assert.ok(!JSON.stringify(body).includes("macSecret") && !JSON.stringify(body).includes("patTEST"));
});
