// Listings Project crawler: pages through a city's category listings. Each
// listing page carries price, availability and neighborhood as text.
//
// Source config: { "city": "new-york-city", "categories": ["rentals", "sublets"], "maxPages": 15 }
const UA = { "user-agent": "Mozilla/5.0 (compatible; Shortlist crawler)" };
const BASE = "https://www.listingsproject.com";

export class Blocked extends Error {}

async function text(url) {
  const res = await fetch(url, { headers: UA });
  if (res.status === 403 || res.status === 429) throw new Blocked(`Listings Project refused (HTTP ${res.status})`);
  if (!res.ok) return "";
  return res.text();
}

const clean = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function parallel(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Discovery fetches each unseen listing page too, because the category pages
// don't reliably show price/neighborhood. `seen` keeps this cheap after the
// first run.
export async function discover(config, seen = new Set()) {
  const c = { city: "new-york-city", categories: ["rentals", "sublets"], maxPages: 15, ...config };
  const links = new Set();
  for (const cat of c.categories) {
    for (let page = 1; page <= c.maxPages; page++) {
      const h = await text(`${BASE}/real-estate/${c.city}/${cat}?page=${page}`);
      const found = [...h.matchAll(/href="(\/listings\/[^"#?]+)"/g)].map(m => m[1]);
      const before = links.size;
      found.forEach(l => links.add(l));
      if (!found.length || links.size === before) break;
    }
  }
  const fresh = [...links].filter(l => !seen.has("lp-" + l));
  const pages = await parallel(fresh, 6, async l => {
    const s = clean(await text(BASE + l));
    const m = s.match(/(\$[\d,]+\/\w+) (Available .*?) Neighborhood (.*?) Transportation /);
    const title = (s.match(/^(.*?) \| Listings Project/) || [])[1] || l.split("/").pop();
    if (!m) return { key: "lp-" + l, path: l, title, skip: true };
    const priceNum = Number(m[1].replace(/[^\d]/g, ""));
    const perMonth = /month/.test(m[1]);
    const after = s.slice(s.indexOf(m[0]) + m[0].length);
    const end = after.indexOf("Contact Name");
    return {
      key: "lp-" + l, path: l, title, price: perMonth ? priceNum : null, priceText: m[1],
      location: m[3], availability: m[2], transport: after.slice(0, 300),
      body: after.slice(0, end > 0 ? end : 3000).slice(0, 3000),
    };
  });
  return { candidates: pages.filter(p => !p.skip), seenKeys: [...links].map(l => "lp-" + l) };
}

export async function details(cand) {
  const h = await text(BASE + cand.path);
  const photos = [...new Set([...h.matchAll(/https:\/\/[^"' ]+?\.(?:jpe?g|png|webp)/gi)].map(m => m[0]))]
    .filter(u => /cloudfront|amazonaws|listingsproject|imgix/.test(u)).slice(0, 20)
    .map((url, i) => ({ id: "lp-" + cand.path.split("/").pop() + "-" + i, url }));
  return {
    url: BASE + cand.path,
    title: cand.title,
    price: cand.price,
    location: cand.location,
    description: [cand.priceText, cand.availability, cand.body, cand.transport ? "Transportation: " + cand.transport : ""].filter(Boolean).join("\n\n"),
    photos,
    raw: { availability: cand.availability },
  };
}
