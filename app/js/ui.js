// Rendering. Pure functions of (state, view) -> HTML strings, plus the few
// helpers the event handlers in main.js need. Nothing here talks to a
// database; writes go through the store.
import { GROUPS, DEFAULT_STATUSES, groupOf, rateMetric, fit } from "./model.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = n => (typeof n === "number" ? "$" + n.toLocaleString("en-US") : "");

// Photos go through the service worker (./photo/<id>) once it controls the
// page, so they're cached under a stable id and work offline.
export function photoSrc(p) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller && p.id) {
    return "photo/" + encodeURIComponent(p.id) + "?src=" + encodeURIComponent(p.url);
  }
  return p.url;
}

export function statusesFor(search) { return (search && search.statuses && search.statuses.length) ? search.statuses : DEFAULT_STATUSES; }

// "All" leaves out archived listings; they only show under their own tab,
// set apart at the end.
export function inTab(search, l, tab) {
  const group = groupOf(search, l.status);
  return tab === "all" ? group !== "archived" : group === tab;
}

export function tabs(search, listings, current) {
  const counts = { all: 0 };
  for (const g of GROUPS) counts[g.key] = 0;
  for (const l of listings) counts[groupOf(search, l.status)]++;
  counts.all = listings.length - counts.archived;
  const button = g =>
    `<button class="tab" type="button" data-tab="${g.key}" aria-pressed="${g.key === current}">${esc(g.label)}<span class="n">${counts[g.key]}</span></button>`;
  const open = [{ key: "all", label: "All" }, ...GROUPS.filter(g => g.key !== "archived" && (counts[g.key] > 0 || g.key === "review" || g.key === "shortlist"))];
  const archived = GROUPS.find(g => g.key === "archived");
  return open.map(button).join("")
    + (counts.archived > 0 || current === "archived" ? `<span class="tab-sep" aria-hidden="true"></span>${button(archived)}` : "");
}

function metricValue(listing, m) {
  const v = listing.fields ? listing.fields[m.field] : undefined;
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return v.name ?? "";
  return String(v);
}

// Street address for the map link: fields.Address, else the start of a title
// like "267 W 70th St #6E — …" or "VIA 57 West (625 W 57th) — …".
function address(l) {
  const f = l.fields || {};
  if (f.Address) return String(f.Address);
  const head = String(l.title || "").split(" — ")[0];
  const paren = (head.match(/\(([^)]*\d[^)]*)\)/) || [])[1];
  const a = (paren || head.replace(/\(.*?\)/g, "")).replace(/#\S+/g, "").trim();
  return /^\d+\s+\S/.test(a) ? a : "";
}

function mapsUrl(l, addr) {
  const f = l.fields || {};
  // No address: the saved pin, else the cross streets from the location note.
  const near = String(l.location || "").split(" · ").pop().replace(/\(.*?\)|~/g, "").trim();
  const q = addr ? addr + ", New York, NY" : f.lat != null && f.lon != null ? `${f.lat},${f.lon}` : near + ", New York, NY";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

// One line: neighborhood · building (linked to its site when known) ·
// address (linked to Google Maps). Without an address, the location note's
// cross streets stand in for it.
function place(l) {
  const f = l.fields || {}, addr = address(l);
  const [first, ...rest] = String(l.location || "").split(" · ");
  const hood = f.Neighborhood || (rest.length ? first : "");
  const street = addr || (rest.length ? rest.join(" · ") : first);
  if (!hood && !street && !f.Building) return "";
  const site = /^https?:\/\//.test(f["Building site"] || "") ? f["Building site"] : "";
  const parts = [];
  if (hood) parts.push(`<span class="hood">${esc(hood)}</span>`);
  if (f.Building) parts.push(site ? `<a class="bldg" href="${esc(site)}" target="_blank" rel="noopener">${esc(f.Building)} ↗</a>` : `<span class="bldg">${esc(f.Building)}</span>`);
  if (street) parts.push(`<a class="map" href="${esc(mapsUrl(l, addr))}" target="_blank" rel="noopener" title="Open in Google Maps">${esc(street)}</a>`);
  return `<p class="loc" title="${esc([hood, f.Building, street].filter(Boolean).join(" · "))}">${parts.join(" · ")}</p>`;
}

// Lease terms on one line: move-in first, then fields.Lease (term, type,
// renewal, furnished).
function lease(l) {
  const f = l.fields || {};
  const move = String(f["Move-in"] || "").trim(), terms = String(f.Lease || "").trim();
  if (!move && !terms) return "";
  const text = [move && `Move-in <b>${esc(move)}</b>`, terms && esc(terms)].filter(Boolean).join(" · ");
  return `<p class="lease" title="${esc([move && "Move-in " + move, terms].filter(Boolean).join(" · "))}">${text}</p>`;
}

// Who to reach: fields.Contact (a name) and fields["Contact info"] (phones,
// emails or links separated by "·", "," or ";"), each tappable.
function contact(l) {
  const f = l.fields || {};
  const name = String(f.Contact || "").trim(), info = String(f["Contact info"] || "").trim();
  if (!name && !info) return "";
  const parts = info.split(/\s*[·,;]\s*/).filter(Boolean).map(x =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? `<a href="mailto:${esc(x)}">${esc(x)}</a>`
      : /^\+?[\d\s().-]{7,}$/.test(x) ? `<a href="tel:${esc(x.replace(/[^\d+]/g, ""))}">${esc(x)}</a>`
      : /^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank" rel="noopener">${esc(x.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40))} ↗</a>`
      : esc(x));
  return `<span class="contact" title="${esc([name, info].filter(Boolean).join(" · "))}">${name ? `<b>${esc(name)}</b>` : ""}${name && parts.length ? " · " : ""}${parts.join(" · ")}</span>`;
}

export function card(search, l, pendingIds, expanded = new Set()) {
  const statuses = statusesFor(search);
  const group = groupOf(search, l.status);
  const photos = l.photos || [];
  const metrics = (search && search.metrics || []).map(m => {
    const v = metricValue(l, m);
    if (!v) return "";
    const cls = rateMetric(m, v);
    return `<div class="metric"><span class="k">${esc(m.label)}</span><span class="v ${cls}">${esc(v)}${m.unit ? " " + esc(m.unit) : ""}</span></div>`;
  }).join("");
  // Features that matter: the ones this listing has are lit and add points;
  // tap a chip to mark it present or not (e.g. after a viewing).
  const f = fit(search, l);
  const has = new Set(f.matched.map(x => x.label));
  const features = (search && search.features || []).map(x =>
    `<button class="chip${has.has(x.label) ? " on" : ""}" type="button" data-feature="${esc(x.label)}" aria-pressed="${has.has(x.label)}" title="${has.has(x.label) ? "Has it" : "Not known to have it"}: tap to toggle">${has.has(x.label) ? "✓ " : ""}${esc(x.label)}${has.has(x.label) && x.points ? ` <span class="pts">${x.points > 0 ? "+" : ""}${esc(x.points)}</span>` : ""}</button>`
  ).join("");
  const scoreTitle = f.boost ? `${f.base} on the criteria ${f.boost > 0 ? "+" : "−"} ${Math.abs(f.boost)} for ${f.matched.map(x => x.label).join(", ")}` : "Fit score on the criteria";
  const opts = statuses.map(s => `<option${s.label === l.status ? " selected" : ""}>${esc(s.label)}</option>`).join("")
    + (l.status && !statuses.some(s => s.label === l.status) ? `<option selected>${esc(l.status)}</option>` : "");
  const open = expanded.has(l.id);
  const long = (l.summary || "").length > 150 || !!l.description;
  const price = l.price !== null && l.price !== undefined ? `<span class="price">${money(l.price)}</span>` : "";
  return `<article class="card${group === "archived" ? " archived" : ""}" data-id="${esc(l.id)}">
  <div class="photo${photos.length ? "" : " nophoto"}"${photos.length > 1 ? ' data-pos="start"' : ""}>
    ${photos.length
      ? `<div class="slides">${photos.map((p, i) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Open listing"><img src="${esc(photoSrc(p))}" data-fallback="${esc(p.url)}" alt=""${i ? ' loading="lazy"' : ""}></a>`).join("")}</div>`
      : `<a class="nophoto-label" href="${esc(l.url)}" target="_blank" rel="noopener">No photos saved · open listing ↗</a>`}
    ${f.total !== null ? `<span class="score" title="${esc(scoreTitle)}">${esc(f.total)} fit${f.boost ? ` <span class="boost">${f.boost > 0 ? "+" : "−"}${esc(Math.abs(f.boost))}</span>` : ""}</span>` : ""}
    ${l.status ? `<span class="pill g-${group}">${esc(l.status)}</span>` : ""}
    ${pendingIds.has(l.id) ? `<span class="pending" title="Saved on this device, waiting to upload">● not synced</span>` : ""}
    ${price}
    ${photos.length > 1 ? `<button class="nav prev" type="button" data-slide="-1" aria-label="Previous photo">‹</button><button class="nav next" type="button" data-slide="1" aria-label="Next photo">›</button>` : ""}
    ${photos.length > 1 ? `<span class="count" aria-label="${photos.length} photos, swipe for more">1 / ${photos.length} ⇆</span>` : ""}
  </div>
  <div class="body">
    <h3 class="title" title="${esc(l.title)}">${esc(l.title)}</h3>
    ${place(l)}
    ${lease(l)}
    ${metrics ? `<div class="metrics">${metrics}</div>` : ""}
    ${features ? `<div class="chips" aria-label="Features that matter">${features}</div>` : ""}
    <div class="text${open ? " open" : ""}">
      ${l.summary ? `<p class="summary">${esc(l.summary)}</p>` : ""}
      ${open && l.description ? `<p class="desc">${esc(l.description)}</p>` : ""}
      ${long ? `<button class="more-btn" type="button" data-expand aria-expanded="${open}">${open ? "Less ▴" : l.description ? "More + full listing ▾" : "More ▾"}</button>` : ""}
    </div>
    <div class="foot">
      <div class="actions">
        <select id="st-${esc(l.id)}" data-status aria-label="Status">${opts}</select>
      </div>
      <div class="reach">
        ${contact(l)}
        <textarea id="nt-${esc(l.id)}" data-notes rows="3" aria-label="Your notes" placeholder="Your notes: called broker, viewing Tue 6pm…">${esc(l.notes)}</textarea>
      </div>
      ${l.url ? `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}">Open listing${l.source ? " on " + esc(l.source) : ""} ↗ <span class="url">${esc(l.url.replace(/^https?:\/\/(www\.)?/, ""))}</span></a>` : ""}
    </div>
  </div>
</article>`;
}

export function sources(list) {
  return list.map(s => {
    // Crawled sources show their last run; the rest show how they're accessed.
    const run = s.crawler && s.lastRunAt;
    const cls = run ? (s.lastStatus === "ok" ? "ok" : s.lastStatus === "blocked" ? "warn" : "bad")
      : /auto/i.test(s.access) ? "ok" : /partial/i.test(s.access) ? "warn" : /manual|blocked/i.test(s.access) ? "bad" : "";
    const meta = s.crawler
      ? (run ? `crawled ${ago(new Date(s.lastRunAt).getTime())} · ${esc(s.lastStatus)}` : "crawler ready · not run yet")
      : `${esc(s.access || "manual")}${s.lastChecked ? " · checked " + esc(s.lastChecked) : ""}`;
    const links = s.links.map(k => `<a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.label)} ↗</a>`).join("");
    return `<li><span class="name"><i class="dot ${cls}"></i>${esc(s.name)} <span class="meta">${meta}</span></span>
      <span class="links">${links || '<span class="meta">no saved search</span>'}</span>
      ${run && s.lastResult ? `<span class="result${s.lastStatus === "ok" ? "" : " bad"}">${esc(s.lastResult)}</span>` : ""}</li>`;
  }).join("");
}

export function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(ts).toLocaleDateString();
}
