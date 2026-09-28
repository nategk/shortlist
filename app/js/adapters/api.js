// Hosted adapter: talks to this deployment's own /api (Vercel functions),
// which hold the database credentials. The default whenever the app is
// served by a host that has the API.
export const FIELDS_FOR_SETTINGS = [
  { key: "base", label: "API base URL (blank = this site)", placeholder: "https://your-app.vercel.app", required: false },
];

const INFO_KEY = "shortlist.apiInfo";

export function create(config) {
  const base = (config.base || "").replace(/\/$/, "");
  let info = null;
  try { info = JSON.parse(localStorage.getItem(INFO_KEY) || "null"); } catch (e) {}

  async function call(path, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try { res = await fetch(base + "/api/" + path, { ...init, signal: ctrl.signal, headers: { "content-type": "application/json" } }); }
    catch (e) { throw new Error(e.name === "AbortError" ? "The server didn't respond in 20s; will retry." : "Couldn't reach the server."); }
    finally { clearTimeout(timer); }
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((body && body.error) || "Server error (HTTP " + res.status + ")");
      err.status = res.status;
      if (res.status === 405) err.readOnly = true;
      throw err;
    }
    return body;
  }

  return {
    kind: "api",
    describe() {
      const i = info || { kind: "Hosted database", name: base ? new URL(base).host : location.host, writable: true };
      return { kind: i.kind, name: i.name, detail: i.detail || "", writable: i.writable !== false, url: base || location.origin };
    },
    async pull() {
      const snap = await call("snapshot");
      if (snap.source) {
        info = snap.source;
        try { localStorage.setItem(INFO_KEY, JSON.stringify(info)); } catch (e) {}
      }
      return { searches: snap.searches || [], listings: snap.listings || [], sources: snap.sources || [] };
    },
    async pushListing(id, patch) {
      await call("listings/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
    },
    async pushSearch(id, patch) {
      await call("searches/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
    },
    // Crawls can take a few minutes; runs server-side and reports per source.
    async crawl(searchId) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300000);
      try {
        const res = await fetch(base + "/api/crawl", { method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ searchId }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Crawl failed (HTTP " + res.status + ")");
        return body;
      } catch (e) {
        throw new Error(e.name === "AbortError" ? "The crawl is taking longer than 5 minutes; check back shortly." : e.message);
      } finally { clearTimeout(timer); }
    },
  };
}

// True when this site has a Shortlist API next to it.
export async function detect() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("api/health", { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return false;
    const j = await res.json();
    return !!(j && j.ok);
  } catch (e) {
    return false;
  }
}
