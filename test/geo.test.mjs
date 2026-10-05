// Geocoding (lib/geo.js) with Nominatim mocked, the shared home location,
// and the distance / board helpers the cards use.
import { skip } from "./env.mjs";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { miles, distance, directionsUrl, boards } from "../app/js/model.js";

const req = (path, init = {}) => new Request("http://localhost" + path, init);
let db, geo, api, realFetch, calls;

before(async () => {
  if (skip) return;
  ({ db } = await import("../lib/db.js"));
  await db().query("drop table if exists listings, sources, searches, sync_state, geo_cache cascade");
  geo = await import("../lib/geo.js");
  api = { importer: await import("../api/admin/import.js"), search: await import("../api/searches/[id].js"), snapshot: await import("../api/snapshot.js") };
  realFetch = globalThis.fetch;
});

// Nominatim stand-in: a few known places, nothing else.
const PLACES = {
  "w 72nd st and riverside dr, new york, ny": { lat: "40.7804", lon: "-73.9858", addresstype: "road", display_name: "W 72nd St, Manhattan" },
  "park slope": { lat: "40.6710", lon: "-73.9814", addresstype: "neighbourhood", display_name: "Park Slope, Brooklyn" },
  "123 berry st": { lat: "40.7196", lon: "-73.9577", addresstype: "building", display_name: "123 Berry St, Brooklyn" },
};
function mockNominatim() {
  calls = [];
  globalThis.fetch = async url => {
    const q = new URL(String(url)).searchParams.get("q").toLowerCase();
    calls.push(q);
    return Response.json(PLACES[q] ? [PLACES[q]] : []);
  };
}

test("geocode: fidelity from the result type, cached, misses cached too", { skip }, async () => {
  process.env.GEOCODER = "";
  mockNominatim();
  try {
    const a = await geo.geocode("Park Slope");
    assert.equal(a.fidelity, "neighborhood");
    assert.equal(a.lat, 40.671);
    await geo.geocode("Park Slope");
    assert.equal(await geo.geocode("Nowhere Ville"), null);
    await geo.geocode("Nowhere Ville");
    assert.deepEqual(calls, ["park slope", "nowhere ville"], "each asked once");
  } finally {
    globalThis.fetch = realFetch; process.env.GEOCODER = "off";
  }
});

test("locate: a pin wins; else the most specific part of the location", { skip }, async () => {
  process.env.GEOCODER = "";
  mockNominatim();
  try {
    assert.deepEqual(await geo.locate({ lat: 40.7, lon: -73.9, accuracy: 5, location: "Park Slope" }), { lat: 40.7, lon: -73.9, fidelity: "exact pin" });
    assert.equal((await geo.locate({ lat: 40.7, lon: -73.9, accuracy: 22 })).fidelity, "approx. pin");
    const r = await geo.locate({ location: "Williamsburg · 123 Berry St" });
    assert.equal(r.fidelity, "address");
    assert.equal(calls[0], "123 berry st", "the address is tried before the neighborhood");
    assert.equal((await geo.locate({ location: "Park Slope" })).fidelity, "neighborhood");
    assert.equal(await geo.locate({ location: "" }), null);
  } finally {
    globalThis.fetch = realFetch; process.env.GEOCODER = "off";
  }
});

test("home location: geocoded on save and shared by the whole collection", { skip }, async () => {
  const snap = { searches: [
    { id: "bed", name: "Bed frame", collection: "New York" },
    { id: "desk", name: "Standing desk", collection: "New York" },
    { id: "other", name: "Bike", collection: "Boulder" },
  ] };
  await api.importer.POST(req("/api/admin/import?photos=0", { method: "POST", headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN }, body: JSON.stringify(snap) }));
  process.env.GEOCODER = "";
  mockNominatim();
  try {
    const r = await api.search.PATCH(req("/api/searches/bed", { method: "PATCH", body: JSON.stringify({ home: "  W 72nd St & Riverside Dr,  New York, NY " }) }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.homeGeo.lat, 40.7804);
  } finally {
    globalThis.fetch = realFetch; process.env.GEOCODER = "off";
  }
  const s = await (await api.snapshot.GET(req("/api/snapshot"))).json();
  const by = Object.fromEntries(s.searches.map(x => [x.id, x]));
  assert.equal(by.bed.home, "W 72nd St & Riverside Dr, New York, NY");
  assert.equal(by.desk.home, by.bed.home, "same board, same home");
  assert.equal(by.desk.homeGeo.lat, 40.7804);
  assert.equal(by.other.home, "", "another board keeps its own");
  assert.equal(by.bed.collection, "New York");
});

test("distance, directions and boards", () => {
  const home = { lat: 40.7804, lon: -73.9858 };
  assert.ok(Math.abs(miles(home, { lat: 40.671, lon: -73.9814 }) - 7.56) < 0.05);
  const search = { home: "W 72nd St, New York", homeGeo: home };
  const d = distance(search, { fields: { lat: 40.671, lon: -73.9814, located: "neighborhood" } });
  assert.equal(d.precise, false);
  assert.equal(distance(search, { fields: { lat: 40.671, lon: -73.9814, located: "exact pin" } }).precise, true);
  assert.equal(distance(search, { fields: {} }), null);
  assert.equal(distance({}, { fields: { lat: 1, lon: 1 } }), null);
  assert.match(directionsUrl(search, { fields: { lat: 40.671, lon: -73.9814 } }), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&travelmode=bicycling&origin=W%2072nd/);
  assert.deepEqual(boards([{ id: "a", collection: "NY" }, { id: "x", name: "Lone" }, { id: "b", collection: "NY" }])
    .map(b => [b.name, b.searches.map(s => s.id)]), [["NY", ["a", "b"]], ["Lone", ["x"]]]);
});
