// Geocoding: a search's home / delivery location, and where each listing is.
// Google's Geocoding API when GOOGLE_MAPS_API_KEY is set (best for cross
// streets), else OpenStreetMap's Nominatim (free, one request a second).
// Answers are cached in geo_cache, misses included.
//
// Every result says how precise it is, so a card can say "0.4 mi" vs
// "~2 mi (neighborhood)":
//   exact pin · approx. pin · address · cross streets · street ·
//   neighborhood · area · zip · city
import { db, ensureSchema } from "./db.js";

const UA = "Shortlist/1 (personal listing board; https://github.com/nategk/shortlist)";
const NEAR_KM = 60;   // results are biased to this box around home
const STREETISH = /&| and | at |\bst\b|\bave\b|street|avenue|blvd|boulevard|road|\brd\b|place|\bpl\b|drive|\bdr\b|lane|\bln\b|broadway|parkway|\bpkwy\b|way\b/i;

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || "";
export const provider = () => (googleKey() ? "google" : "nominatim");

// Nominatim allows one request per second per app.
let nextSlot = 0;
async function nominatimTurn() {
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Math.max(Date.now(), nextSlot) + 1100;
  if (wait) await new Promise(r => setTimeout(r, wait));
}

const box = near => {
  const dLat = NEAR_KM / 111, dLon = NEAR_KM / (111 * Math.cos((near.lat * Math.PI) / 180));
  return { s: near.lat - dLat, n: near.lat + dLat, w: near.lon - dLon, e: near.lon + dLon };
};

function nominatimFidelity(r) {
  const t = String(r.addresstype || r.type || "");
  if (/^(house|building|amenity|shop|office|tourism|leisure|craft)$/.test(t)) return "address";
  if (t === "road") return "street";
  if (/^(neighbourhood|suburb|quarter|hamlet|isolated_dwelling|residential)$/.test(t)) return "neighborhood";
  if (/^(city_district|borough|district|county)$/.test(t)) return "area";
  if (t === "postcode") return "zip";
  if (/^(city|town|village|municipality)$/.test(t)) return "city";
  const rank = Number(r.place_rank) || 0;
  return rank >= 28 ? "address" : rank >= 26 ? "street" : rank >= 20 ? "neighborhood" : rank >= 17 ? "area" : "city";
}

function googleFidelity(r) {
  const t = new Set(r.types || []);
  if (t.has("street_address") || t.has("premise") || t.has("subpremise") || t.has("establishment")) return "address";
  if (t.has("intersection")) return "cross streets";
  if (t.has("route")) return "street";
  if (t.has("neighborhood") || [...t].some(x => x.startsWith("sublocality"))) return "neighborhood";
  if (t.has("postal_code")) return "zip";
  if (t.has("administrative_area_level_2")) return "area";
  return "city";
}

async function lookup(q, near) {
  if (googleKey()) {
    const p = new URLSearchParams({ address: q, key: googleKey() });
    if (near) { const b = box(near); p.set("bounds", `${b.s},${b.w}|${b.n},${b.e}`); }
    const res = await fetch("https://maps.googleapis.com/maps/api/geocode/json?" + p, { signal: AbortSignal.timeout(10_000) });
    const data = await res.json();
    const r = (data.results || [])[0];
    if (!r) return null;
    return { lat: r.geometry.location.lat, lon: r.geometry.location.lng, label: r.formatted_address, fidelity: googleFidelity(r) };
  }
  await nominatimTurn();
  // Nominatim reads "W 72nd St and Riverside Dr" as an intersection, not "&".
  // A bare place name ("Midtown West", "Astoria") means the neighborhood or
  // town near home, not a building or a namesake across the country: such
  // queries stay inside the home box and prefer place results.
  const bare = !/\d/.test(q) && !STREETISH.test(q);
  const p = new URLSearchParams({ q: q.replace(/\s*&\s*/g, " and "), format: "jsonv2", limit: bare ? "5" : "1" });
  if (near) { const b = box(near); p.set("viewbox", `${b.w},${b.n},${b.e},${b.s}`); p.set("bounded", bare ? "1" : "0"); }
  const res = await fetch("https://nominatim.openstreetmap.org/search?" + p, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Nominatim HTTP " + res.status);
  const list = await res.json();
  const place = bare && list.find(x => /^(neighbourhood|suburb|quarter|city_district|borough|city|town|village|hamlet|postcode)$/.test(x.addresstype));
  const r = place || list[0];
  if (!r) return null;
  // A name that only matched a building is still just a rough area.
  const fidelity = bare && !place ? "area" : nominatimFidelity(r);
  return { lat: Number(r.lat), lon: Number(r.lon), label: r.display_name, fidelity };
}

// One place name -> {lat, lon, label, fidelity} or null. Cached.
export async function geocode(query, { near = null } = {}) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 2 || process.env.GEOCODER === "off") return null;
  await ensureSchema();
  const key = [provider(), near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : "", q.toLowerCase()].join("|");
  const hit = await db().query("select result from geo_cache where q = $1", [key]);
  if (hit.rows.length) return hit.rows[0].result;
  let result = null;
  try { result = await lookup(q, near); } catch (e) { return null; }   // errors aren't cached; misses are
  await db().query("insert into geo_cache (q, result) values ($1, $2) on conflict (q) do update set result = $2", [key, JSON.stringify(result)]);
  return result;
}

// The most precise place a listing gives. A map pin from the source wins
// (Craigslist's data-accuracy: <= 10 is the exact spot); otherwise the
// location text is tried part by part, most specific first ("Upper West
// Side · W 82nd St & Broadway" -> the cross streets, then the whole, then
// the neighborhood), and the first hit is kept.
export async function locate({ lat, lon, accuracy, location } = {}, { near = null, maxLookups = 4 } = {}) {
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
    return { lat, lon, fidelity: accuracy != null && accuracy <= 10 ? "exact pin" : "approx. pin" };
  }
  const text = String(location || "").trim();
  if (!text) return null;
  const parts = text.split(/\s*[·|]\s*/).map(s => s.trim()).filter(Boolean);
  const specific = p => (/\d/.test(p) ? 2 : 0) + (/&| and | at |\bst\b|\bave\b|street|avenue|blvd|road|\brd\b|place|\bpl\b/i.test(p) ? 1 : 0);
  // "W 72nd St & Riverside Dr, New York" -> also "W 72nd St, New York": not
  // every geocoder finds intersections, and the street is the next best.
  const corner = p => {
    const [head, ...tail] = p.split(","), m = head.split(/\s*(?:&|\band\b|\bat\b)\s*/i);
    return m.length === 2 && m[0] ? [p, [m[0], ...tail].join(",").trim()] : [p];
  };
  const tries = [...new Set([...parts.filter(p => specific(p) > 0).sort((a, b) => specific(b) - specific(a)).flatMap(corner), text, ...parts.reverse()])];
  for (const q of tries.slice(0, maxLookups)) {
    const r = await geocode(q, { near });
    if (r) return /&| and | at /i.test(q) && r.fidelity === "street" ? { ...r, fidelity: "cross streets" } : r;
  }
  return null;
}
