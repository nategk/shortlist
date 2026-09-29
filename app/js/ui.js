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
export function firstInGroup(search, group) { const s = statusesFor(search).find(x => x.group === group); return s ? s.label : null; }

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

export function card(search, l, pendingIds) {
  const statuses = statusesFor(search);
  const group = groupOf(search, l.status);
  const shortlist = firstInGroup(search, "shortlist");
  const review = firstInGroup(search, "review");
  const pass = firstInGroup(search, "archived");
  const [cover, ...rest] = l.photos || [];
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
  const quick = group === "shortlist"
    ? (review ? `<button class="btn" type="button" data-set="${esc(review)}">Unshortlist</button>` : "")
    : (shortlist ? `<button class="btn primary" type="button" data-set="${esc(shortlist)}">Shortlist</button>` : "");
  return `<article class="card${group === "archived" ? " archived" : ""}" data-id="${esc(l.id)}">
  <a class="photo${cover ? "" : " nophoto"}" href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Open listing">
    ${cover ? `<img src="${esc(photoSrc(cover))}" data-fallback="${esc(cover.url)}" alt="">` : `<span class="nophoto-label">No photos saved · open listing ↗</span>`}
    ${f.total !== null ? `<span class="score" title="${esc(scoreTitle)}">${esc(f.total)} fit${f.boost ? ` <span class="boost">${f.boost > 0 ? "+" : "−"}${esc(Math.abs(f.boost))}</span>` : ""}</span>` : ""}
    ${l.status ? `<span class="pill g-${group}">${esc(l.status)}</span>` : ""}
    ${pendingIds.has(l.id) ? `<span class="pending" title="Saved on this device, waiting to upload">● not synced</span>` : ""}
  </a>
  <div class="body">
    ${l.price !== null && l.price !== undefined ? `<div class="price">${money(l.price)}</div>` : ""}
    <h3 class="title">${esc(l.title)}</h3>
    ${l.location ? `<p class="loc">${esc(l.location)}</p>` : ""}
    ${metrics ? `<div class="metrics">${metrics}</div>` : ""}
    ${features ? `<div class="chips" aria-label="Features that matter">${features}</div>` : ""}
    ${l.summary ? `<p class="summary">${esc(l.summary)}</p>` : ""}
    ${rest.length ? `<div class="strip">${rest.map(p => `<img src="${esc(photoSrc(p))}" data-fallback="${esc(p.url)}" alt="" loading="lazy">`).join("")}</div>` : ""}
    ${l.description ? `<details class="more"><summary>Full listing description</summary><p>${esc(l.description)}</p></details>` : ""}
    <div class="actions">
      ${quick}
      ${pass && group !== "archived" ? `<button class="btn pass" type="button" data-set="${esc(pass)}">Pass</button>` : ""}
      <select id="st-${esc(l.id)}" data-status aria-label="Status">${opts}</select>
    </div>
    <label class="label" for="nt-${esc(l.id)}">Your notes</label>
    <textarea id="nt-${esc(l.id)}" data-notes placeholder="Called broker, viewing Tue 6pm…">${esc(l.notes)}</textarea>
    ${l.url ? `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">Open listing${l.source ? " on " + esc(l.source) : ""} ↗</a><span class="url">${esc(l.url)}</span>` : ""}
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
