// Listings Project photo extraction, against markup trimmed from a live page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listingPhotos } from "../lib/crawlers/listingsproject.js";

const page = `
<img class="headerLogo" alt="Listings Project logo" src="https://d3k4q8wq6fyj8w.cloudfront.net/packs/static/images/logo-teal-9dd61efddb3bc7e057c0.svg" />
<img class="listing_image" src="https://listing-photos.b-cdn.net/listing_photos/NLfg/gJ6TUo-IMG_4689.JPG?height=410" />
<img class="listing_image" src="https://listing-photos.b-cdn.net/listing_photos/NLfg/jI_O_R-IMG_3349.png?height=410" />
<img class="listing_image" src="https://listing-photos.b-cdn.net/listing_photos/NLfg/gJ6TUo-IMG_4689.JPG?height=410" />
<img style="display: block; width: 100%" src="https://listing-photos.b-cdn.net/listing_photos/b3uK/7-0O2k-IMG_7802.jpeg?aspect_ratio=3:2&amp;width=540" />
<img class="block mx-auto mb-4" style="width: 48px" src="https://d3k4q8wq6fyj8w.cloudfront.net/assets/browse-582d.png" />
<img alt="Listings Project logo" style="width: 199px" src="https://d3k4q8wq6fyj8w.cloudfront.net/packs/static/images/logo-white-97f6.png" />`;

test("listingPhotos keeps only the listing's gallery, full size, deduped", () => {
  assert.deepEqual(listingPhotos(page), [
    "https://listing-photos.b-cdn.net/listing_photos/NLfg/gJ6TUo-IMG_4689.JPG",
    "https://listing-photos.b-cdn.net/listing_photos/NLfg/jI_O_R-IMG_3349.png",
  ]);
});
