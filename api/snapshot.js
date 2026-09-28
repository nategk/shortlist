// GET /api/snapshot -> { source, searches, listings, sources } in the app's
// model shape. Public by design (nothing here is private).
import { backend } from "../lib/backend.js";
import { json, fail } from "../lib/http.js";

export async function GET() {
  try {
    const b = backend();
    const snap = await b.snapshot();
    return json({ source: b.describe(), ...snap });
  } catch (e) {
    return fail(e);
  }
}
