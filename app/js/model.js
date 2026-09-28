// The app's data model. Adapters translate their database into these shapes;
// everything above the adapters (store, UI) only ever sees these.
//
// Search   { id, name, lookingFor, budget, area, timing, state, criteria,
//            contactTemplate, statuses: [{label, group}], metrics: [Metric],
//            features: [Feature] }
// Listing  { id, searchIds: [id], title, price, score, status, notes, url,
//            location, description, summary, source,
//            photos: [{id, url}], fields: {raw field name: value},
//            features: [label] }  (which of the search's features it has)
// Source   { id, searchIds: [id], name, access, links: [{label, url}],
//            method, lastChecked, notes }
// Metric   { field, label, unit, good, ok }  (good/ok null for text fields)
// Feature  { label, points }  something that matters (e.g. an amenity); a
//          listing that has it shows it on its card and gets the points
//          added to its fit score.

// Status groups drive the tabs and the quick actions on each card.
export const GROUPS = [
  { key: "review", label: "To review" },
  { key: "shortlist", label: "Shortlist" },
  { key: "active", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "archived", label: "Passed" },
];

export const DEFAULT_STATUSES = [
  { label: "New", group: "review" },
  { label: "Shortlist", group: "shortlist" },
  { label: "Contacted", group: "active" },
  { label: "Replied", group: "active" },
  { label: "Viewing booked", group: "active" },
  { label: "Decided", group: "done" },
  { label: "Passed", group: "archived" },
  { label: "Gone", group: "archived" },
];

const GROUP_KEYS = new Set(GROUPS.map(g => g.key));

// "Label: group" per line. Unknown groups fall back to "active".
export function parseStatuses(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(.+?)\s*:\s*(\w+)\s*$/);
    if (!m) continue;
    out.push({ label: m[1], group: GROUP_KEYS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : "active" });
  }
  return out.length ? out : DEFAULT_STATUSES;
}

// "field | label | unit | good | ok" per line.
export function parseMetrics(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const parts = line.split("|").map(s => s.trim());
    if (!parts[0]) continue;
    const num = s => (s === undefined || s === "" || isNaN(Number(s)) ? null : Number(s));
    out.push({ field: parts[0], label: parts[1] || parts[0], unit: parts[2] || "", good: num(parts[3]), ok: num(parts[4]) });
  }
  return out;
}

// "Label | https://..." per line; a bare URL gets a generic label.
export function parseLinks(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const parts = line.split("|").map(s => s.trim());
    const url = parts.find(p => /^https?:\/\//.test(p));
    if (!url) continue;
    out.push({ label: parts[0] && parts[0] !== url ? parts[0] : "Search", url });
  }
  return out;
}

// ok / warn / bad for a numeric metric, "" when there is nothing to judge.
export function rateMetric(metric, value) {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (metric.good === null || metric.ok === null || isNaN(n)) return "";
  const lowerIsBetter = metric.good <= metric.ok;
  if (lowerIsBetter) return n <= metric.good ? "ok" : n <= metric.ok ? "warn" : "bad";
  return n >= metric.good ? "ok" : n >= metric.ok ? "warn" : "bad";
}

export function groupOf(search, status) {
  const s = (search?.statuses || DEFAULT_STATUSES).find(x => x.label === status);
  return s ? s.group : "review";
}

// "Label | points" per line (points default to 3).
export function parseFeatures(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const [label, pts] = line.split("|").map(s => s.trim());
    if (!label || out.some(f => f.label.toLowerCase() === label.toLowerCase())) continue;
    const n = Number(String(pts ?? "").replace(/[^\d.-]/g, ""));
    out.push({ label: label.slice(0, 60), points: pts && isFinite(n) ? n : 3 });
  }
  return out;
}

export const featuresText = features => (features || []).map(f => `${f.label} | ${f.points > 0 ? "+" : ""}${f.points}`).join("\n");

// The search's features this listing has, and the fit score with their
// points added. listing.score stays the base score (the criteria's rubric).
export function fit(search, listing) {
  const has = new Set((listing.features || []).map(s => String(s).toLowerCase()));
  const matched = (search?.features || []).filter(f => has.has(f.label.toLowerCase()));
  const boost = matched.reduce((n, f) => n + (Number(f.points) || 0), 0);
  const base = listing.score ?? null;
  return { base, boost, matched, total: base === null ? null : base + boost };
}
