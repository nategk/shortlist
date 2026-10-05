// Crawler registry. The engine's own crawlers are registered here; a layer
// adds more with registerCrawler (lib/layer.js, which documents the
// contract). Sources opt in by setting sources.crawler to one of the names.
import { registerCrawler, getCrawlers } from "../layer.js";
import * as craigslist from "./craigslist.js";
import * as listingsproject from "./listingsproject.js";

registerCrawler("craigslist", craigslist);
registerCrawler("listingsproject", listingsproject);

export const CRAWLERS = getCrawlers();
