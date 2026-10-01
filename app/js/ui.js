// Rendering. Pure functions of (state, view) -> HTML strings, plus the few
// helpers the event handlers in main.js need. Nothing here talks to a
// database; writes go through the store.
import { GROUPS, DEFAULT_STATUSES, groupOf, rateMetric, fit, rankable } from "./model.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 16px line icons (Lucide shapes), drawn in currentColor.
const svg = d => `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  pin: svg('<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'),
  lease: svg('<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  route: svg('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),
  fit: svg('<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>'),
  open: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  train: svg('<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M18 22l-2-3M8 15h.01M16 15h.01"/>'),
  amenity: svg('<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>'),
  prev: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  thread: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  trash: svg('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
};
// Nearest subway lines: fields.Subways is "1 0.15 · 2 0.15 · B 0.46" (line,
// miles to its nearest entrance), up to 5. Lines at the same distance share
// one group, like a station sign: ①②③ 0.15 · Ⓑ Ⓒ 0.46. Distances take the
// colors of the search's subway metric thresholds.
const LINE_COLOR = { 1: "#EE352E", 2: "#EE352E", 3: "#EE352E", 4: "#00933C", 5: "#00933C", 6: "#00933C", 7: "#B933AD",
  A: "#0039A6", C: "#0039A6", E: "#0039A6", B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319", G: "#6CBE45",
  J: "#996633", Z: "#996633", L: "#A7A9AC", N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A", S: "#808183" };
function subways(search, l) {
  const entries = String((l.fields || {}).Subways || "").split("·").map(x => x.trim().split(/\s+/)).filter(x => x.length === 2 && !isNaN(Number(x[1])));
  if (!entries.length) return "";
  const metric = (search && search.metrics || []).find(m => /subway/i.test(m.field));
  const groups = [];
  for (const [line, mi] of entries.slice(0, 5)) {
    const last = groups[groups.length - 1];
    if (last && last.mi === mi) last.lines.push(line); else groups.push({ mi, lines: [line] });
  }
  const html = groups.map(g => `<span class="subway">${g.lines.map(x =>
    `<i class="bullet${LINE_COLOR[x] === "#FCCC0A" ? " dark" : ""}" style="background:${LINE_COLOR[x] || "#808183"}">${esc(x)}</i>`).join("")}<span class="v ${metric ? rateMetric(metric, Number(g.mi)) : ""}">${esc(g.mi)}<span class="u">mi</span></span></span>`).join("");
  return row("subways", ICON.train, html, "Nearest subway lines, miles to the closest entrance: " + entries.map(([a, b]) => a + " " + b).join(", "));
}

// One metadata row: icon, then a single line of content (ellipsis).
const row = (cls, icon, html, title = "") => `<div class="row ${cls}"${title ? ` title="${esc(title)}"` : ""}>${icon}<span class="t">${html}</span></div>`;

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

// A title that opens with the address ("267 W 70th St #6E — jumbo corner
// 1BR") shows just its description; the address, unit included, moves to
// the location line so it isn't said twice.
function split(l) {
  const title = String(l.title || "");
  const i = title.indexOf(" — ");
  if (i < 0) return { title, street: "" };
  const head = title.slice(0, i), rest = title.slice(i + 3).trim();
  const addr = address(l);
  // Only when the head is the address (maybe with a unit and a building
  // name in parentheses), not a description that happens to have a dash.
  if (!addr || !rest || !/^\d+\s|\(\s*\d+\s/.test(head)) return { title, street: "" };
  const unit = (head.match(/#\S+/) || [""])[0];
  return { title: rest.charAt(0).toUpperCase() + rest.slice(1), street: unit ? addr + " " + unit : addr };
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
function place(l, streetWithUnit) {
  const f = l.fields || {}, addr = address(l);
  const [first, ...rest] = String(l.location || "").split(" · ");
  const hood = f.Neighborhood || (rest.length ? first : "");
  const street = streetWithUnit || addr || (rest.length ? rest.join(" · ") : first);
  if (!hood && !street && !f.Building) return "";
  const site = /^https?:\/\//.test(f["Building site"] || "") ? f["Building site"] : "";
  const parts = [];
  if (hood) parts.push(`<span class="hood">${esc(hood)}</span>`);
  if (f.Building) parts.push(site ? `<a class="bldg" href="${esc(site)}" target="_blank" rel="noopener">${esc(f.Building)}</a>` : `<span class="bldg">${esc(f.Building)}</span>`);
  if (street) parts.push(`<a class="map" href="${esc(mapsUrl(l, addr))}" target="_blank" rel="noopener" title="Open in Google Maps">${esc(street)}</a>`);
  return row("loc", ICON.pin, parts.join(" · "), [hood, f.Building, street].filter(Boolean).join(" · "));
}

// Lease on one line: "Move in Oct 1 to Apr 30, 2027 · 7 months", from
// fields Move-in, Move-out and Term (months). fields.Lease (type, renewal,
// furnished) is in the tooltip.
function lease(l) {
  const f = l.fields || {};
  const move = String(f["Move-in"] || "").trim(), out = String(f["Move-out"] || "").trim();
  const months = Number(f["Term (months)"]) || 0, terms = String(f.Lease || "").trim();
  if (!move && !out && !months) return "";
  const text = [
    [move && `<b>${esc(move)}</b>`, out && `${move ? "to" : "Until"} <b>${esc(out)}</b>`].filter(Boolean).join(" "),
    months && `${months} month${months === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
  return row("lease", ICON.lease, text, [move && "Move in " + move, out && "to " + out, months && months + " months", terms].filter(Boolean).join(" · "));
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
  return `<div class="contact" title="${esc([name, info].filter(Boolean).join(" · "))}">${ICON.user}<span class="t">${name ? `<b>${esc(name)}</b>` : ""}${name && parts.length ? " · " : ""}${parts.join(" · ")}</span></div>`;
}

// Your rank: a tiny "#" menu beside the fit score on shortlisted / in-progress
// cards. rankCount: how many listings in the search are ranked.
function rankMenu(l, group, rankCount) {
  if (!rankable(group)) return "";
  const ranked = l.rank != null;
  const n = ranked ? rankCount : rankCount + 1;
  const opts = (ranked ? `<option value="">Unrank</option>` : `<option value="" selected>#</option>`)
    + Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${l.rank === i + 1 ? " selected" : ""}>#${i + 1}</option>`).join("");
  return `<label class="rank${ranked ? " on" : ""}" title="${ranked ? "Your rank: change or unrank" : "Rank it"}"><select data-rank aria-label="Your rank">${opts}</select></label>`;
}

export function card(search, l, pendingIds, expanded = new Set(), rankCount = 0) {
  const statuses = statusesFor(search);
  const group = groupOf(search, l.status);
  const photos = l.photos || [];
  // Distances on one line; a unit they all share is said once, at the end.
  const hasSubways = !!String((l.fields || {}).Subways || "").trim();
  const shown = (search && search.metrics || []).filter(m => !(hasSubways && /subway/i.test(m.field)))
    .map(m => ({ m, v: metricValue(l, m) })).filter(x => x.v);
  const oneUnit = shown.length > 1 && shown.every(x => x.m.unit && x.m.unit === shown[0].m.unit) ? shown[0].m.unit : "";
  const metrics = shown.map(({ m, v }, i) => {
    return `<span class="metric"><span class="k">${esc(m.label)}</span> <span class="v ${rateMetric(m, v)}">${esc(v)}${m.unit ? `<span class="u">${esc(m.unit)}</span>` : ""}</span></span>`;
  }).join("");
  // Features that matter: the ones this listing has are lit and add points;
  // tap a chip to mark it present or not (e.g. after a viewing).
  const f = fit(search, l);
  const has = new Set(f.matched.map(x => x.label));
  const features = (search && search.features || []).slice().sort((a, b) => a.label.localeCompare(b.label)).map(x =>
    `<button class="chip${has.has(x.label) ? " on" : ""}" type="button" data-feature="${esc(x.label)}" aria-pressed="${has.has(x.label)}" title="${has.has(x.label) ? "Has it" : "Not known to have it"}${x.points ? ` (${x.points > 0 ? "+" : ""}${x.points} fit)` : ""}: tap to toggle">${esc(x.label)}</button>`
  ).join("");
  const scoreTitle = f.boost ? `${f.base} on the criteria ${f.boost > 0 ? "+" : "−"} ${Math.abs(f.boost)} for ${f.matched.map(x => x.label).join(", ")}` : "Fit score on the criteria";
  const opts = statuses.map(s => `<option${s.label === l.status ? " selected" : ""}>${esc(s.label)}</option>`).join("")
    + (l.status && !statuses.some(s => s.label === l.status) ? `<option selected>${esc(l.status)}</option>` : "");
  const open = expanded.has(l.id);
  const long = (l.summary || "").length > 120 || !!l.description;
  const price = l.price !== null && l.price !== undefined ? `<span class="price">${money(l.price)}</span>` : "";
  const name = split(l);
  return `<article class="card${group === "archived" ? " archived" : ""}" data-id="${esc(l.id)}">
  <div class="photo${photos.length ? "" : " nophoto"}"${photos.length > 1 ? ' data-pos="start"' : ""}>
    ${photos.length
      ? `<div class="slides">${photos.map((p, i) => `<button class="slide" type="button" data-photo="${i}" aria-label="View photo ${i + 1} of ${photos.length} full screen"><img src="${esc(photoSrc(p))}" data-fallback="${esc(p.url)}" alt=""${i ? ' loading="lazy"' : ""}></button>`).join("")}</div>`
      : `<span class="nophoto-label">No photos saved</span>`}
    <div class="tl">
      ${f.total !== null ? `<span class="score" title="${esc(scoreTitle)}">${ICON.fit}${esc(f.total)}<span class="visually-hidden"> fit score</span></span>` : ""}
      ${rankMenu(l, group, rankCount)}
    </div>
    <label class="status g-${group}" title="Status"><select id="st-${esc(l.id)}" data-status aria-label="Status">${opts}</select></label>
    ${pendingIds.has(l.id) ? `<span class="pending" title="Saved on this device, waiting to upload">● not synced</span>` : ""}
    ${price}
    ${photos.length > 1 ? `<button class="nav prev" type="button" data-slide="-1" aria-label="Previous photo">${ICON.prev}</button><button class="nav next" type="button" data-slide="1" aria-label="Next photo">${ICON.next}</button>` : ""}
    ${photos.length > 1 ? `<span class="count" aria-label="${photos.length} photos, swipe for more">1 / ${photos.length}</span>` : ""}
  </div>
  <div class="body">
    <h3 class="title" title="${esc(l.title)}">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(name.title)}<span class="open" aria-label="Open listing${l.source ? " on " + esc(l.source) : ""}">${ICON.open}</span></a>` : esc(name.title)}</h3>
    <div class="meta">
      ${place(l, name.street)}
      ${lease(l)}
      ${metrics ? row("metrics", ICON.route, metrics, oneUnit ? "Distances in " + ({ mi: "miles", km: "kilometers" }[oneUnit] || oneUnit) : "") : ""}
      ${subways(search, l)}
      ${features ? `<div class="row amenities">${ICON.amenity}<span class="t chips" aria-label="Features that matter">${features}</span></div>` : ""}
    </div>
    <div class="text${open ? " open" : ""}"${long ? ` data-expand role="button" tabindex="0" aria-expanded="${open}" title="${open ? "Tap to collapse" : "Tap to read the full listing"}"` : ""}>
      ${l.summary ? `<p class="summary">${esc(l.summary)}</p>` : ""}
      ${open && l.description ? `<p class="desc">${esc(l.description)}</p>` : ""}
    </div>
    <div class="foot">
      <div class="reach">
        ${contact(l)}
        <textarea id="nt-${esc(l.id)}" data-notes rows="3" aria-label="Your notes" placeholder="Your notes: called broker, viewing Tue 6pm…">${esc(l.notes)}</textarea>
      </div>
      ${threadButton(l)}
    </div>
  </div>
</article>`;
}

// Application notes: a button on the card opens the thread.
function threadButton(l) {
  const t = l.thread || [], last = t[t.length - 1];
  const label = t.length ? `${t.length} update${t.length === 1 ? "" : "s"} · ${shortDate(last.at)}` : "Start a thread";
  return `<button class="thread-btn${t.length ? " has" : ""}" type="button" data-thread aria-label="Application notes: ${esc(label)}">${ICON.thread}<span class="k">Application</span><span class="t">${t.length ? esc(firstLine(last.text)) : ""}</span><span class="n">${esc(label)}</span></button>`;
}
const firstLine = s => String(s || "").split("\n").find(x => x.trim()) || "";
const shortDate = at => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// The thread itself (inside the dialog): oldest first, grouped by day.
// Links, emails and phone numbers are tappable.
export function thread(l) {
  const t = (l && l.thread) || [];
  if (!t.length) return `<p class="thread-empty">Paste emails, application links, what's due and what you're waiting on. Everything stays on this listing, in order.</p>`;
  let day = "";
  return t.map(e => {
    const d = new Date(e.at), dayLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const head = dayLabel !== day ? `<div class="thread-day">${esc(dayLabel)}</div>` : "";
    day = dayLabel;
    return `${head}<div class="msg" data-entry="${esc(e.id)}"><div class="msg-text">${linkify(e.text)}</div>
      <div class="msg-meta"><time datetime="${esc(e.at)}">${esc(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</time>
      <button class="msg-del" type="button" data-entry-del="${esc(e.id)}" aria-label="Delete this update">${ICON.trash}</button></div></div>`;
  }).join("");
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|[\w.+-]+@[\w-]+\.[\w.-]*\w|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, m =>
    /^http/.test(m) ? `<a href="${m}" target="_blank" rel="noopener">${m.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}${m.length > 56 ? "…" : ""}</a>`
      : m.includes("@") ? `<a href="mailto:${m}">${m}</a>`
      : `<a href="tel:${m.replace(/[^\d]/g, "")}">${m}</a>`);
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
