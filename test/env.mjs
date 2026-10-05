// Imported first by every DB test. Tests drop and recreate tables, so they
// only ever run against TEST_DATABASE_URL, never the deployment's
// DATABASE_URL, and with every production credential removed from the env.
//   TEST_DATABASE_URL=postgres://shortlist:dev@localhost/shortlist_test npm test
const url = process.env.TEST_DATABASE_URL || "";
for (const k of Object.keys(process.env)) {
  if (/(DATABASE_URL|POSTGRES_URL|READ_WRITE_TOKEN)$/.test(k) || /^(AIRTABLE_|BLOB_|ANTHROPIC_API_KEY|CRON_SECRET|SHORTLIST_URL)/.test(k)) delete process.env[k];
}
if (url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  throw new Error("TEST_DATABASE_URL must point at localhost (tests drop tables). Set ALLOW_REMOTE_TEST_DB=1 to override.");
}
if (url) process.env.DATABASE_URL = url;
process.env.ADMIN_TOKEN = "test-admin-token-123456";
process.env.AIRTABLE_MIN_GAP_MS = "0";
process.env.GEOCODER = "off";   // no live geocoding in tests (test/geo.test.mjs mocks it)
export const skip = !url && "TEST_DATABASE_URL not set";
export const ADMIN = process.env.ADMIN_TOKEN;
export const fixture = () => import("node:fs/promises").then(fs => fs.readFile(new URL("./fixtures/west-side.json", import.meta.url), "utf8"));
