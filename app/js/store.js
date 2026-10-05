// Offline-first store. The UI renders from IndexedDB immediately; the adapter
// is only ever called in the background:
//   pull  - refresh the snapshot, keeping any edits still waiting to upload
//   push  - edits land locally at once and go into an outbox that flushes
//           (coalesced per listing) whenever we're online
// Each connection gets its own database, so switching sources never mixes data.

const DB_VERSION = 1;
const STALE_MS = 60 * 1000;

function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["searches", "listings", "sources"]) db.createObjectStore(s, { keyPath: "id" });
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const result = fn(t);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getMeta(db, key) {
  return new Promise(resolve => {
    const r = db.transaction("meta").objectStore("meta").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}

export class Store {
  constructor(adapter, dbName) {
    this.adapter = adapter;
    this.dbName = dbName;
    this.state = { searches: [], listings: [], sources: [], outbox: [] };
    this.status = { syncing: false, lastPulled: null, error: "", online: navigator.onLine, readOnly: false };
    this.listeners = new Set();
    this.flushTimer = null;
    this.backoff = 2000;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.state, this.status); }

  async open() {
    this.db = await openDb(this.dbName);
    const [searches, listings, sources, outbox, lastPulled] = await Promise.all([
      getAll(this.db, "searches"), getAll(this.db, "listings"), getAll(this.db, "sources"),
      getAll(this.db, "outbox"), getMeta(this.db, "lastPulled"),
    ]);
    this.state = { searches, listings, sources, outbox };
    this.status.lastPulled = lastPulled || null;
    this.emit();

    addEventListener("online", () => { this.status.online = true; this.emit(); this.flush(); this.pull(); });
    addEventListener("offline", () => { this.status.online = false; this.emit(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isStale()) this.pull();
    });
    return this;
  }

  isStale() { return !this.status.lastPulled || Date.now() - this.status.lastPulled > STALE_MS; }
  get hasData() { return this.state.listings.length > 0 || this.state.searches.length > 0; }

  // Overlay edits that haven't uploaded yet so a pull never undoes them.
  withPending(rows, kind = "listing") {
    const pending = new Map();
    for (const op of this.state.outbox) if ((op.kind || "listing") === kind) pending.set(op.id, { ...(pending.get(op.id) || {}), ...op.patch });
    return rows.map(r => (pending.has(r.id) ? { ...r, ...pending.get(r.id) } : r));
  }

  async pull() {
    if (this.status.syncing || !navigator.onLine) return;
    this.status.syncing = true; this.status.error = ""; this.emit();
    try {
      const snap = await this.adapter.pull();
      snap.listings = this.withPending(snap.listings, "listing");
      snap.searches = this.withPending(snap.searches, "search");
      await tx(this.db, ["searches", "listings", "sources", "meta"], "readwrite", t => {
        for (const s of ["searches", "listings", "sources"]) {
          const os = t.objectStore(s);
          os.clear();
          for (const row of snap[s]) os.put(row);
        }
        t.objectStore("meta").put(Date.now(), "lastPulled");
      });
      this.state = { ...snap, outbox: this.state.outbox };
      this.status.lastPulled = Date.now();
    } catch (e) {
      this.status.error = e.message || String(e);
    } finally {
      this.status.syncing = false;
      this.emit();
    }
  }

  // Instant local write + queued upload. kind: "listing" (status, notes) or
  // "search" (criteria, contact template...).
  async update(id, patch, kind = "listing") {
    const store = kind === "search" ? "searches" : "listings";
    this.state[store] = this.state[store].map(r => (r.id === id ? { ...r, ...patch } : r));
    const op = { kind, id, patch, at: Date.now() };
    await tx(this.db, [store, "outbox"], "readwrite", t => {
      const row = this.state[store].find(r => r.id === id);
      if (row) t.objectStore(store).put(row);
      t.objectStore("outbox").add(op);
    });
    this.state.outbox = await getAll(this.db, "outbox");
    this.emit();
    this.scheduleFlush(600);
  }

  scheduleFlush(ms) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), ms);
  }

  async flush() {
    if (this.flushing || !navigator.onLine || !this.state.outbox.length) return;
    if (!this.adapter.describe().writable) { this.status.readOnly = true; return; }
    this.flushing = true;
    const ops = [...this.state.outbox];
    const byKey = new Map();   // "kind:id" -> merged patch (latest wins)
    for (const op of ops) { const k = (op.kind || "listing") + ":" + op.id; byKey.set(k, { ...(byKey.get(k) || {}), ...op.patch }); }
    const done = [];
    let failed = null;
    for (const [key, patch] of byKey) {
      const [kind, ...rest] = key.split(":"), id = rest.join(":");
      try {
        if (kind === "search") await this.adapter.pushSearch(id, patch);
        else await this.adapter.pushListing(id, patch);
        done.push(...ops.filter(o => (o.kind || "listing") === kind && o.id === id).map(o => o.seq));
      } catch (e) {
        if (e.readOnly) { this.status.readOnly = true; break; }
        failed = e;
        break;
      }
    }
    if (done.length) {
      await tx(this.db, ["outbox"], "readwrite", t => { for (const seq of done) t.objectStore("outbox").delete(seq); });
      this.state.outbox = await getAll(this.db, "outbox");
    }
    // A new home location is found on the server; pull to get it.
    const relocated = ops.some(o => o.kind === "search" && "home" in (o.patch || {}) && done.includes(o.seq));
    this.flushing = false;
    if (relocated && !failed) setTimeout(() => this.pull(), 0);
    if (failed) {
      this.status.error = failed.message || String(failed);
      this.scheduleFlush(this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60000);
    } else {
      this.backoff = 2000;
      if (!this.status.readOnly) this.status.error = "";
    }
    this.emit();
  }

  async destroy() {
    try { this.db && this.db.close(); } catch (e) {}
    await new Promise(r => { const q = indexedDB.deleteDatabase(this.dbName); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  }
}
