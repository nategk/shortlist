// Work on a deployed Shortlist's database from a terminal.
//   node scripts/remote.mjs pull [file]    save the live snapshot (public read)
//   node scripts/remote.mjs push <file>    upsert a snapshot, keeping triage
//                                          (status/notes/features) as it is live
// Env: SHORTLIST_URL (e.g. https://your-app.vercel.app), ADMIN_TOKEN for push.
import { readFile, writeFile } from "node:fs/promises";

const [cmd, file] = process.argv.slice(2);
const base = (process.env.SHORTLIST_URL || "").replace(/\/$/, "");
if (!base) { console.error("Set SHORTLIST_URL."); process.exit(1); }

if (cmd === "pull") {
  const res = await fetch(base + "/api/snapshot");
  if (!res.ok) { console.error("HTTP " + res.status); process.exit(1); }
  const text = JSON.stringify(await res.json(), null, 1) + "\n";
  if (file) await writeFile(file, text); else process.stdout.write(text);
} else if (cmd === "push" && file) {
  if (!process.env.ADMIN_TOKEN) { console.error("Set ADMIN_TOKEN."); process.exit(1); }
  const res = await fetch(base + "/api/admin/import?keepTriage=1", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.ADMIN_TOKEN, "content-type": "application/json" },
    body: await readFile(file, "utf8"),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
} else {
  console.error("Usage: node scripts/remote.mjs pull [file] | push <file>");
  process.exit(1);
}
