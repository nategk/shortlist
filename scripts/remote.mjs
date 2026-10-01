// Work on a deployed Shortlist's database from a terminal.
//   node scripts/remote.mjs pull [file]    save the live snapshot (public read)
//   node scripts/remote.mjs push <file>    upsert a snapshot, keeping triage
//                                          (status/notes/features) as it is live
//   node scripts/remote.mjs set <listingId> status=Contacted [notes=...]
//                                          triage one listing (open endpoint)
//   node scripts/remote.mjs post <listingId> <text | @file> [--at ISO]
//                                          add an application note to its thread
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
} else if (cmd === "set" && file) {
  const patch = {};
  for (const arg of process.argv.slice(4)) {
    const i = arg.indexOf("=");
    const key = arg.slice(0, i), value = arg.slice(i + 1);
    if (key === "status" || key === "notes") patch[key] = value;
    else if (key === "features") patch.features = value ? value.split(",").map(f => f.trim()) : [];
    else { console.error("Unknown field: " + arg); process.exit(1); }
  }
  const res = await fetch(base + "/api/listings/" + encodeURIComponent(file), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
} else if (cmd === "post" && file && process.argv[4]) {
  const arg = process.argv[4], i = process.argv.indexOf("--at");
  const text = arg.startsWith("@") ? await readFile(arg.slice(1), "utf8") : arg;
  const at = i > 0 ? new Date(process.argv[i + 1]).toISOString() : new Date().toISOString();
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at, text };
  const res = await fetch(base + "/api/listings/" + encodeURIComponent(file), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadAdd: [entry] }),
  });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
} else {
  console.error("Usage: node scripts/remote.mjs pull [file] | push <file> | set <id> field=value... | post <id> <text|@file> [--at ISO]");
  process.exit(1);
}
