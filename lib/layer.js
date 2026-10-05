// Extension points for a layer: a separate deployment built on this engine
// (e.g. a furniture hunt) that adds its own crawlers and post-scoring steps
// without forking the engine. A layer registers before any handler runs,
// usually from a one-line API wrapper:
//
//   import "../layer.js";                       // calls registerCrawler / registerEnricher
//   export * from "../vendor/shortlist/api/crawl.js";
//
// Crawler contract (see lib/crawlers/index.js):
//   discover(config, seen:Set) -> candidates[] | { candidates, seenKeys }
//   details(candidate, config) -> { url, title, price, location, description, photos, raw } | null
//   alive(listing) -> true | false | null   optional; false = the post is gone (sold, taken down)
//   Blocked: Error subclass thrown when the site refuses automated access
//
// Enricher contract: async ({ search, listing, details }) -> void. Runs after
// scoring, before photos are copied to Blob and the listing is saved; it may
// add photos (e.g. { id, url, label: "Official" }) and set listing.fields.
// A throwing enricher is skipped; the listing is saved without it.
const crawlers = {};
const enrichers = [];

export function registerCrawler(name, mod) {
  if (typeof mod?.discover !== "function" || typeof mod?.details !== "function") throw new Error(`Crawler "${name}" needs discover() and details()`);
  crawlers[name] = mod;
}

export function registerEnricher(name, fn) {
  if (typeof fn !== "function") throw new Error(`Enricher "${name}" must be a function`);
  const i = enrichers.findIndex(e => e.name === name);
  if (i >= 0) enrichers[i] = { name, fn }; else enrichers.push({ name, fn });
}

export const getCrawlers = () => crawlers;
export const getEnrichers = () => enrichers;
