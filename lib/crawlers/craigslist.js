// Craigslist crawler, any category (housing, furniture, bikes…). Uses the
// JSON search API the site's own pages call (coordinates included), then
// fetches detail pages only for the candidates worth a closer look.
//
// Source config (sources.config):
//   { "area": "newyork", "category": "apa",        // apa = apartments, fua = furniture, bia = bikes…
//     "minPrice": 3500, "maxPrice": 5500, "minBedrooms": 1, "query": "…",
//     "searches": [{ "postal": "10023", "radius": 1 }, { "query": "herman miller aeron" }, …] }
// Each entry in `searches` is one API call; its fields override the top-level
// query/postal. Results are merged by posting id.
const UA = { "user-agent": "Mozilla/5.0 (compatible; Shortlist crawler)" };

export class Blocked extends Error {}

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, redirect: "follow" });
  if (res.status === 403 || res.status === 429) throw new Blocked(`Craigslist refused (HTTP ${res.status})`);
  return res;
}

export async function discover(config) {
  const c = { area: "newyork", category: "apa", ...config };
  const byId = new Map();
  for (const s of c.searches || [{}]) {
    const q = new URLSearchParams({ cc: "US", lang: "en", searchPath: c.category, batch: "3-0-360-0-0" });
    if (c.minPrice) q.set("min_price", c.minPrice);
    if (c.maxPrice) q.set("max_price", c.maxPrice);
    if (c.minBedrooms) q.set("min_bedrooms", c.minBedrooms);
    const postal = s.postal || c.postal;
    if (postal) { q.set("postal", postal); q.set("search_distance", s.radius || c.radius || 1); }
    const query = s.query || c.query;
    if (query) q.set("query", query);
    const res = await get("https://sapi.craigslist.org/web/v8/postings/search/full?" + q, { headers: { referer: `https://${c.area}.craigslist.org/` } });
    if (!res.ok) throw new Error(`Craigslist search failed (HTTP ${res.status})`);
    const data = (await res.json()).data || {};
    const dc = data.decode || {};
    for (const x of data.items || []) {
      const pid = String((dc.minPostingId || 0) + x[0]);
      // "<location>:<description>[:<neighborhood>]~lat~lon", indexes into decode.
      const parts = String(x[4] || "").split("~");
      const idx = parts[0].split(":");
      const lat = Number(parts[1]), lon = Number(parts[2]);
      const li = idx.length > 1 ? Number(idx[1]) : null;
      const tagged = n => (x.find(e => Array.isArray(e) && e[0] === n) || [])[1];
      const title = x.slice(7).find(e => typeof e === "string") || "";
      byId.set(pid, {
        key: "cl-" + pid, pid, slug: tagged(6) || "", code: tagged(13) || "", title, price: x[3] > 0 ? x[3] : x[3] === 0 ? 0 : null,
        location: (li !== null && (dc.locationDescriptions || [])[li]) || "",
        subarea: ((dc.locations || [])[Number(idx[0])] || [])[2] || "",
        lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null,
      });
    }
  }
  return [...byId.values()];
}

const strip = s => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
const squash = s => strip(s).replace(/\s+/g, " ").trim();

// Posting attributes: "condition: good", "make / manufacturer: Herman Miller",
// "1BR / 1Ba"… Newer pages pair <span class="labl"> with <span class="valu">;
// older ones put each attribute in one <span class="attr">.
export function attributes(html) {
  const pairs = [...html.matchAll(/<span class="labl">([\s\S]*?)<\/span>\s*<span class="valu">([\s\S]*?)<\/span>/g)]
    .map(m => [squash(m[1]).replace(/:$/, ""), squash(m[2])]).filter(([k, v]) => k && v);
  if (pairs.length) return pairs.map(([k, v]) => `${k}: ${v}`);
  return [...html.matchAll(/<(?:span|div) class="attr[^"]*">([\s\S]*?)<\/(?:span|div)>/g)].map(m => squash(m[1])).filter(Boolean);
}

// Postings live at www.craigslist.org/view/d/<slug>/<code>; the older
// <area>/<subarea>/<category>/d/<slug>/<id>.html form is the fallback.
export function postingUrl(cand, config) {
  if (cand.code) return `https://www.craigslist.org/view/d/${cand.slug}/${cand.code}`;
  const c = { area: "newyork", subarea: "mnh", category: "apa", ...config };
  return `https://${c.area}.craigslist.org/${cand.subarea || c.subarea}/${c.category}/d/${cand.slug}/${cand.pid}.html`;
}

export async function details(cand, config) {
  const res = await get(postingUrl(cand, config));
  if (res.status === 404 || res.status === 410) return null; // taken down
  if (!res.ok) throw new Error(`Craigslist listing failed (HTTP ${res.status})`);
  const t = await res.text();
  const body = (t.match(/<section id="postingbody">([\s\S]*?)<\/section>/) || [])[1] || "";
  const description = strip(body.replace(/<div class="print-information[\s\S]*?<\/div>\s*<\/div>/, "").replace(/<div class="print-information[\s\S]*?<\/div>/, ""))
    .replace("QR Code Link to This Post", "").replace(/\n{3,}/g, "\n\n").trim();
  const attrs = attributes(t);
  const geo = t.match(/data-latitude="([\d.-]+)" data-longitude="([\d.-]+)" data-accuracy="(\d+)"/);
  const addr = strip((t.match(/<h2 class="street-address">([\s\S]*?)<\/h2>/) || [])[1] || "").trim();
  const ids = [];
  for (const m of t.matchAll(/https:\/\/images\.craigslist\.org\/([A-Za-z0-9_]+?)_(?:50x50c|600x450|1200x900)\.jpg/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  return {
    url: res.url,
    title: cand.title,
    price: cand.price,
    location: [addr, cand.location].filter(Boolean).join(" · "),
    description: [description, attrs.length ? "Details: " + attrs.join(" · ") : ""].filter(Boolean).join("\n\n"),
    photos: ids.map(id => ({ id: "cl-" + id, url: `https://images.craigslist.org/${id}_1200x900.jpg` })),
    raw: { lat: geo ? Number(geo[1]) : cand.lat, lon: geo ? Number(geo[2]) : cand.lon, mapAccuracy: geo ? Number(geo[3]) : null, attributes: attrs },
  };
}

// Is the post still up? Deleted and expired posts answer 404/410, or a page
// that says so.
export async function alive(listing) {
  if (!/craigslist\.org\//.test(listing.url || "")) return null;
  const res = await get(listing.url);
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) return null;
  const t = await res.text();
  if (/This posting has (been deleted|expired)|has been flagged for removal/i.test(t)) return false;
  return /<section id="postingbody">/.test(t) ? true : null;
}
