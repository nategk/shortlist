// Crawler registry. A crawler exports:
//   discover(config, seen:Set) -> candidates[] | { candidates, seenKeys }
//     candidate: { key, title, price, location, ... } (key is stable per item)
//   details(candidate, config) -> { url, title, price, location, description, photos, raw } | null
//   Blocked: an Error subclass thrown when the site refuses automated access
// Sources opt in by setting sources.crawler to one of these names.
import * as craigslist from "./craigslist.js";
import * as listingsproject from "./listingsproject.js";

export const CRAWLERS = { craigslist, listingsproject };
