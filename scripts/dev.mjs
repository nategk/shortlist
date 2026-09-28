// Local stand-in for `vercel dev`: serves app/ as static files and routes
// /api/* to the same function modules Vercel runs (Web Request/Response
// handlers exported per HTTP method). No Vercel account needed.
//
//   DATABASE_URL=postgres://user:pass@localhost/shortlist npm run dev
//   (no DATABASE_URL -> read-only demo backend)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "app");
const PORT = Number(process.env.PORT || 8000);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

// /api/listings/abc -> api/listings/[id].js
async function resolveApi(pathname) {
  const parts = pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const exact = join(ROOT, "api", ...parts) + ".js";
  try { await stat(exact); return exact; } catch (e) {}
  const dynamic = join(ROOT, "api", ...parts.slice(0, -1), "[id].js");
  try { await stat(dynamic); return dynamic; } catch (e) {}
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  try {
    if (url.pathname.startsWith("/api/")) {
      const file = await resolveApi(url.pathname);
      const mod = file && await import(pathToFileURL(file).href);
      const handler = mod && mod[req.method];
      if (!handler) { res.writeHead(file ? 405 : 404).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let path = normalize(join(APP, decodeURIComponent(url.pathname)));
    if (!path.startsWith(APP)) { res.writeHead(403).end(); return; }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
    console.error(e);
    res.writeHead(500).end("Server error");
  }
}).listen(PORT, () => console.log(`Shortlist dev server on http://localhost:${PORT} (${process.env.DATABASE_URL ? "postgres" : "demo backend"})`));
