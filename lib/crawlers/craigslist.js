// Craigslist housing crawler. Uses the JSON search API the site's own pages
// call (coordinates included), then fetches detail pages only for the
// candidates worth a closer look.
//
// Source config (sources.config):
//   { "area": "newyork", "subarea": "mnh", "category": "apa",
//     "minPrice": 3500, "maxPrice": 5500, "minBedrooms": 1,
//     "searches": [{ "postal": "10023", "radius": 1 }, ...] }
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
    if (s.postal) { q.set("postal", s.postal); q.set("search_distance", s.radius || 1); }
    if (s.query) q.set("query", s.query);
    const res = await get("https://sapi.craigslist.org/web/v8/postings/search/full?" + q, { headers: { referer: `https://${c.area}.craigslist.org/` } });
    if (!res.ok) throw new Error(`Craigslist search failed (HTTP ${res.status})`);
    const data = (await res.json()).data || {};
    const dc = data.decode || {};
    for (const x of data.items || []) {
      const pid = String((dc.minPostingId || 0) + x[0]);
      const parts = String(x[4] || "").split("~");
      const lat = Number(parts[1]), lon = Number(parts[2]);
      const li = parts[0].includes(":") ? Number(parts[0].split(":").pop()) : null;
      const slug = (x.find(e => Array.isArray(e) && e[0] === 6) || [])[1] || "";
      const title = x.slice(7).find(e => typeof e === "string") || "";
      byId.set(pid, {
        key: "cl-" + pid, pid, slug, title, price: x[3],
        location: (li !== null && (dc.locationDescriptions || [])[li]) || "",
        lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null,
      });
    }
  }
  return [...byId.values()];
}

const strip = s => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

export async function details(cand, config) {
  const c = { area: "newyork", subarea: "mnh", category: "apa", ...config };
  const res = await get(`https://${c.area}.craigslist.org/${c.subarea}/${c.category}/d/${cand.slug}/${cand.pid}.html`);
  if (res.status === 404 || res.status === 410) return null; // taken down
  if (!res.ok) throw new Error(`Craigslist listing failed (HTTP ${res.status})`);
  const t = await res.text();
  const body = (t.match(/<section id="postingbody">([\s\S]*?)<\/section>/) || [])[1] || "";
  const description = strip(body.replace(/<div class="print-information[\s\S]*?<\/div>/, "")).replace("QR Code Link to This Post", "").replace(/\n{3,}/g, "\n\n").trim();
  const attrs = [...t.matchAll(/<(?:span|div) class="attr[^"]*">([\s\S]*?)<\/(?:span|div)>/g)]
    .map(m => strip(m[1]).replace(/\s+/g, " ").trim()).filter(Boolean);
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
