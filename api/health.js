// GET /api/health -> which backend this deployment uses (shown in the UI's
// data-source pill). Never returns secrets.
import { backend } from "../lib/backend.js";
import { json, fail } from "../lib/http.js";

export async function GET() {
  try {
    return json({ ok: true, ...backend().describe() });
  } catch (e) {
    return fail(e);
  }
}
