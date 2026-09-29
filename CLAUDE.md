# Working on Shortlist

## Shipping changes
- Small changes (UI tweaks, copy, styling, small fixes): merge to `main`
  and push without asking. Open a PR from the working branch and merge it
  right away, so there's a record. Run `node --check` on touched JS (and
  `npm test` when `TEST_DATABASE_URL` is available) first.
- Larger changes (schema/API changes, sync logic, anything that touches
  data or credentials, multi-file refactors): open a PR and ask before
  merging.
- `main` deploys to Vercel. Bump `SHELL` in `app/sw.js` when app files
  change so installed copies pick up the new version.

## Live data
The live board's data is in its database, not this repo. Use
`scripts/remote.mjs` (`SHORTLIST_URL`, `ADMIN_TOKEN`) to triage or update
listings; changes mirror to Airtable.
