# NYC rental search — Oct 1, 2026

A Shortlist project: 1BR+, $3,500–$5,500, Lincoln Square / lower-mid UWS /
Chelsea, close to the West Side Highway greenway and a couple of blocks from
the subway. Rubric in `config/criteria.md`.

Run the engine against this folder from the repo root:

```sh
export SHORTLIST_PROJECT=searches/nyc-rental
python3 init_db.py --object "..." ...    # one-time; seeds config/ into listings.db
python3 add_listing.py --source craigslist --url ... --fit-score 80 ...
python3 generate_gallery.py              # -> searches/nyc-rental/gallery.html
python3 serve.py 127.0.0.1               # edit statuses/notes from the gallery
```

## Triage in Airtable

Status and notes are triaged in Airtable (base `NYC Rental Shortlist`,
`appknc5zHh2CKAJw3`, table `Listings` `tblrxY7CBYUGXBJYc`). The card view is
the **Apartment Triage** interface → **Listings** page (gallery, tabs for
All / To review / Shortlist / In progress / Passed; each card links to the listing). Each record carries
`Shortlist ID` = the row id in `listings.db`, which is how the two sync.
Airtable status names map to the db like this: New=new, Shortlist=flagged,
Contacted, Replied, Viewing booked=viewing_scheduled, Viewed,
Applied=offer_made, Lease signed=purchased, Passed=no_go, Landlord
passed=rejected, Rented=sold_elsewhere, Scam suspected=scam_suspected.
