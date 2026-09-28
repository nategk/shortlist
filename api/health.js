// GET /api/health -> which backend this deployment uses (shown in the UI's
// data-source pill), plus which setup pieces are present. Reports only
// yes/no, never values.
import { backend } from "../lib/backend.js";
import { databaseUrl, blobToken } from "../lib/db.js";
import { json, fail } from "../lib/http.js";

export async function GET() {
  try {
    return json({
      ok: true,
      ...backend().describe(),
      setup: {
        database: !!databaseUrl(),
        photoStorage: !!blobToken(),
        adminToken: (process.env.ADMIN_TOKEN || "").length >= 16,
        airtable: !!(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
