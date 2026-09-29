// GET /api/snapshot -> { source, searches, listings, sources } in the app's
// model shape. Public by design (nothing here is private).
import * as postgres from "../lib/postgres.js";
import { json, fail } from "../lib/http.js";

export async function GET() {
  try {
    return json({ source: postgres.describe(), ...(await postgres.snapshot()) });
  } catch (e) {
    return fail(e);
  }
}
