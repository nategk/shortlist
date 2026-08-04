# Contact / Offer Template (Template)

Copy into your project folder (e.g. `car/offer_template.md`). Live
template — edit directly, through the gallery's "Contact/Offer Template"
panel, or by asking Claude to update it. Keep it current as real replies
come in.

## Current template

Hi, I'm interested in the [ITEM] you have listed. Could you tell me a bit
more:

- [Verification question — proof of ownership/purchase, title status, VIN
  match, serial number, etc.]
- [Condition/history question — service history, damage, wear]
- [Price flexibility question]

I'm [logistics — location, availability window] and can [pickup/payment
method]. Let me know what works.

Thanks,
[Your name]

**Parts that adjust per listing:**
- [Whatever's specific to that candidate]

## What's working / notes from real replies
(update as replies come in)

## How to use
1. Copy the template, fill in the bracketed parts.
2. Send it.
3. Update the listing's status per the pipeline in `criteria.md`
   (`flagged` → `contacted` once sent → `replied` once they respond →
   `negotiating` once there's real back-and-forth).
4. If a reply pressures urgency, asks for payment/deposit before a viewing,
   or the seller can't produce proof of ownership, treat it as a scam risk
   and move to `scam_suspected` regardless of how the listing scored.

---
*Worked example: `bikes/offer_template.md` (local, gitignored) is the real,
currently-in-use version of this file.*
