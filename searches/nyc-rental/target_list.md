# Target List — where to look first

Working notes, not loaded into the db.

## Zones (from criteria)
| Zone | Streets | Greenway access | Subway |
|---|---|---|---|
| Lincoln Square | W 59–72, west of CPW | Riverside Park South / Riverside Blvd, 0.1–0.3 mi from WEA | 1 at 66th & 72nd; A/B/C/D at 59th; B/C at 72nd |
| Lower/mid UWS | W 72–96, west of CPW | Riverside Park, ~0.1–0.3 mi from West End / Riverside Dr | 1/2/3 at 72, 96; 1 at 79, 86 |
| Chelsea | W 14–30, west of 6th | Hudson River Park, ~0.2 mi from 10th Ave, ~0.5 from 7th | A/C/E/L 14th & 8th; C/E 23rd; 1 at 18, 23, 28 |

Sweet spot for both constraints: **West End Ave / Broadway between W 66th and
W 86th** (1 train every few blocks, Riverside Park a block or two west) and
**Chelsea between 8th and 10th Ave near W 14th / W 23rd** (A/C/E stations,
Hudson River Park 2–3 short blocks west).

Weak spots: Riverside Blvd towers (W 59–70) are right on the greenway but
0.3–0.5 mi from any subway; Central Park West is on the subway but ~0.6+ mi
from the greenway; West Chelsea (10th–11th Ave, W 20s) is on the greenway but
far from trains until the 7 at 34th.

## Saved searches (public links)
Also linked from the gallery's Sources strip. Source of truth:
`config/sources_status.csv` (`search_url`).

Automated (checked 2026-09-27):
- Craigslist, 1BR+, $3.5–5.5k, by zip + radius:
  [Lincoln Sq 10023](https://www.craigslist.org/search/city/new-york-ny?cat=apa&min_bedrooms=1&min_price=3500&max_price=5500&postal=10023&radius=1) ·
  [UWS 70s–80s 10024](https://www.craigslist.org/search/city/new-york-ny?cat=apa&min_bedrooms=1&min_price=3500&max_price=5500&postal=10024&radius=1) ·
  [UWS 90s 10025](https://www.craigslist.org/search/city/new-york-ny?cat=apa&min_bedrooms=1&min_price=3500&max_price=5500&postal=10025&radius=0.8) ·
  [Chelsea 10011](https://www.craigslist.org/search/city/new-york-ny?cat=apa&min_bedrooms=1&min_price=3500&max_price=5500&postal=10011&radius=1) ·
  [W Chelsea 10001](https://www.craigslist.org/search/city/new-york-ny?cat=apa&min_bedrooms=1&min_price=3500&max_price=5500&postal=10001&radius=0.6)
- Listings Project (no URL filters; scan for Manhattan):
  [rentals](https://www.listingsproject.com/real-estate/new-york-city/rentals) ·
  [sublets](https://www.listingsproject.com/real-estate/new-york-city/sublets)

Manual — bot-walled, check by hand with filters $3,500–$5,500, 1+ bed,
move-in by Oct 15, then add anything good with `add_listing.py`:
- LeaseBreak (lease takeovers, good for mid-cycle starts):
  [leasebreak.com](https://www.leasebreak.com/) — filter Manhattan >
  Lincoln Square / Upper West Side / Chelsea
- StreetEasy (deepest inventory):
  [Lincoln Sq](https://streeteasy.com/for-rent/lincoln-square) ·
  [UWS](https://streeteasy.com/for-rent/upper-west-side) ·
  [Chelsea](https://streeteasy.com/for-rent/chelsea)
- Zillow: [UWS](https://www.zillow.com/upper-west-side-new-york-ny/rentals/) ·
  [Chelsea](https://www.zillow.com/chelsea-new-york-ny/rentals/)
- Zumper: [UWS](https://www.zumper.com/apartments-for-rent/new-york-ny/upper-west-side) ·
  [Chelsea](https://www.zumper.com/apartments-for-rent/new-york-ny/chelsea)

## Notes
- 2026-09-27 pass: Listings Project (216 listings) had no in-zone
  1BRs; LeaseBreak is Cloudflare-walled. Craigslist had only ~9 unique in-zone 1BRs at $3.5–5.5k;
  mid-UWS (W 72–96) was nearly empty. Expect StreetEasy to carry most of the
  real options this late in the cycle.
