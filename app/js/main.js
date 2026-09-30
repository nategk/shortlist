// App wiring: pick the adapter from the saved connection, open its offline
// store, render, and route UI events to store writes.
import { ADAPTERS, loadConnection, saveConnection, createAdapter, connectionKey } from "./adapters/index.js";
import { Store } from "./store.js";
import { fit, parseFeatures, featuresText } from "./model.js";
import * as ui from "./ui.js";

const $ = s => document.querySelector(s);
const pref = {
  get(k, d) { try { return localStorage.getItem("shortlist." + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("shortlist." + k, v); } catch (e) {} },
};

let conn = null;
let adapter = null;
let store = null;
let view = { searchId: pref.get("search", ""), tab: pref.get("tab", "all") };
let warmedKey = "";
const expanded = new Set();   // cards whose summary/description is open

async function boot() {
  if (!conn) { conn = await loadConnection(); adapter = createAdapter(conn); }
  store = await new Store(adapter, "shortlist:" + connectionKey(conn)).open();
  store.subscribe(render);
  render();
  store.pull().then(() => store.flush());
}

function currentSearch(state) {
  const active = state.searches.filter(s => s.state !== "Done");
  return state.searches.find(s => s.id === view.searchId) || active[0] || state.searches[0] || null;
}

function listingsFor(state, search) {
  if (!search) return state.listings;
  return state.listings.filter(l => !l.searchIds || !l.searchIds.length || l.searchIds.includes(search.id));
}

function render() {
  const { state, status } = store;
  const search = currentSearch(state);
  const d = adapter.describe();
  const listings = listingsFor(state, search);

  // Data source pill: always visible so it's clear where edits are going.
  $("#source-name").textContent = d.name;
  $("#source-kind").textContent = d.kind + (d.writable ? "" : " · read-only");
  $("#source-dot").className = "dot " + (status.syncing ? "busy" : status.error ? "bad" : !status.online ? "warn" : status.lastPulled ? "ok" : "");

  // Search header
  if (search) {
    $("#title-wrap").innerHTML = state.searches.length > 1
      ? `<select class="search-picker" id="search-picker" aria-label="Search">${state.searches.map(s => `<option value="${ui.esc(s.id)}"${s.id === search.id ? " selected" : ""}>${ui.esc(s.name)}</option>`).join("")}</select>`
      : ui.esc(search.name);
    document.title = search.name + " · Shortlist";
  } else {
    $("#title-wrap").textContent = store.hasData ? "Listings" : status.syncing ? "Loading…" : "No searches yet";
  }

  // Sync line
  const pending = state.outbox.length;
  const bits = [];
  if (status.syncing) bits.push("Syncing…");
  else if (status.lastPulled) bits.push("Updated " + ui.ago(status.lastPulled));
  if (!status.online) bits.push("offline, changes save on this device");
  if (pending) bits.push(pending + " change" + (pending === 1 ? "" : "s") + (!d.writable ? " kept on this device (read-only source)" : " waiting to upload"));
  if (status.error && !status.readOnly) bits.push(status.error);
  $("#sync").textContent = bits.join(" · ");
  $("#sync").classList.toggle("err", !!status.error && !status.readOnly);

  // Tabs + cards
  const tab = view.tab;
  $("#tabs").innerHTML = ui.tabs(search, listings, tab);
  const shown = listings
    .filter(l => ui.inTab(search, l, tab))
    .map(l => [l, fit(search, l).total ?? -1])
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
  const pendingIds = new Set(state.outbox.map(o => o.id));
  preserveDraft(() => {
    $("#grid").innerHTML = shown.length
      ? shown.map(l => ui.card(search, l, pendingIds, expanded)).join("")
      : `<div class="empty">${store.hasData ? "Nothing in this tab." : status.error ? "Couldn't load: " + ui.esc(status.error) : "Loading listings…"}</div>`;
  });
  fitSummaries();

  // Criteria, contact template and sources live in the sheet, opened from the database group.
  if (search) {
    fillDoc("#criteria", search.criteria);
    fillDoc("#contact", search.contactTemplate);
    fillDoc("#features", featuresText(search.features));
  }
  $("#run-crawl").hidden = !(search && adapter.crawl && d.writable);
  const srcs = state.sources.filter(s => !search || !s.searchIds.length || s.searchIds.includes(search.id));
  $("#sources").innerHTML = ui.sources(srcs);
  $("#open-criteria").hidden = !search;
  $("#open-contact").hidden = !search;
  $("#open-sources").hidden = !srcs.length;
  if (!search && $("#sheet").open) $("#sheet").close();

  warmPhotos(listings);
}

// Editable text areas: refresh from data unless the user has unsaved edits.
function fillDoc(sel, value) {
  const el = $(sel);
  if (el.dataset.dirty === "1") return;
  if (el.value !== (value || "")) el.value = value || "";
}

// Re-rendering must not eat a note the user is typing.
function preserveDraft(fn) {
  const el = document.activeElement;
  const draft = el && el.matches && el.matches("textarea[data-notes]") ? { id: el.id, value: el.value, pos: el.selectionStart } : null;
  fn();
  if (draft) {
    const t = document.getElementById(draft.id);
    if (t) { t.value = draft.value; t.focus(); t.setSelectionRange(draft.pos, draft.pos); }
  }
}

// Ask the service worker to download every photo for offline use (once per
// set of photos).
// Clamp each closed summary to the whole lines that fit in the space left,
// ending in an ellipsis; tapping it opens the rest.
function fitSummaries() {
  for (const text of document.querySelectorAll(".card .text:not(.open)")) {
    const summary = text.querySelector(".summary");
    if (!summary) continue;
    const line = parseFloat(getComputedStyle(summary).lineHeight) || 20;
    const lines = String(Math.max(1, Math.min(8, Math.floor(text.clientHeight / line))));
    summary.style.webkitLineClamp = lines;
    summary.style.lineClamp = lines;
  }
}

addEventListener("resize", () => { if (store) fitSummaries(); });
// Line heights settle once the web font loads; measure again then.
if (document.fonts) document.fonts.ready.then(() => { if (store) fitSummaries(); });

function warmPhotos(listings) {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return;
  const photos = listings.flatMap(l => l.photos || []).filter(p => p.id && p.url);
  const key = photos.map(p => p.id).join(",");
  if (!photos.length || key === warmedKey) return;
  warmedKey = key;
  sw.postMessage({ type: "warm-photos", photos });
}

// ---- events ----
document.addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (tab) { view.tab = tab.dataset.tab; pref.set("tab", view.tab); render(); return; }
  const chip = e.target.closest("button[data-feature]");
  if (chip) {
    const id = chip.closest(".card").dataset.id;
    const l = store.state.listings.find(x => x.id === id);
    const label = chip.dataset.feature;
    const now = (l.features || []).filter(x => x.toLowerCase() !== label.toLowerCase());
    if (chip.getAttribute("aria-pressed") !== "true") now.push(label);
    store.update(id, { features: now });
    return;
  }
  const photo = e.target.closest("button[data-photo]");
  if (photo) { openLightbox(photo.closest(".card"), Number(photo.dataset.photo)); return; }
  // Carousel arrows: step one photo; swiping still works.
  const step = e.target.closest("button[data-slide]");
  if (step) {
    const slides = step.parentElement.querySelector(".slides");
    slides.scrollBy({ left: Number(step.dataset.slide) * slides.clientWidth, behavior: "smooth" });
    return;
  }
  const more = e.target.closest("[data-expand]");
  if (more && !e.target.closest("a")) {
    const id = more.closest(".card").dataset.id;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
    return;
  }
  if (e.target.closest("#source-pill")) { openSettings(); return; }
  const sheetBtn = e.target.closest("[data-sheet]");
  if (sheetBtn) { openSheet(sheetBtn.dataset.sheet); return; }
});
// Photo carousel position: "3 / 12".
document.addEventListener("scroll", e => {
  const el = e.target;
  if (!el.classList || !el.classList.contains("slides")) return;
  const i = Math.round(el.scrollLeft / el.clientWidth), n = el.children.length;
  const count = el.parentElement.querySelector(".count");
  if (count) count.textContent = `${i + 1} / ${n} ⇆`;
  // Hides the prev/next arrow at either end.
  el.parentElement.dataset.pos = i <= 0 ? "start" : i >= n - 1 ? "end" : "mid";
}, true);
// ---- lightbox: full-screen photo carousel, opened by tapping a photo ----
$("#lb-close").innerHTML = ui.ICON.close;
$(".lb-prev").innerHTML = ui.ICON.prev;
$(".lb-next").innerHTML = ui.ICON.next;
function openLightbox(card, index) {
  const imgs = [...card.querySelectorAll(".slides img")];
  $("#lb-slides").innerHTML = imgs.map(img =>
    `<div class="lb-slide"><img src="${ui.esc(img.currentSrc || img.src)}" data-fallback="${ui.esc(img.dataset.fallback || "")}" alt=""></div>`).join("");
  $("#lightbox").showModal();
  const el = $("#lb-slides");
  el.scrollTo({ left: index * el.clientWidth, behavior: "instant" });
  lightboxPos();
}
function lightboxPos() {
  const el = $("#lb-slides"), n = el.children.length;
  const i = Math.round(el.scrollLeft / (el.clientWidth || 1));
  $("#lb-count").textContent = n > 1 ? `${i + 1} / ${n}` : "";
  $("#lightbox").dataset.pos = n < 2 ? "only" : i <= 0 ? "start" : i >= n - 1 ? "end" : "mid";
}
const lbStep = d => { const el = $("#lb-slides"); el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" }); };
$("#lb-slides").addEventListener("scroll", lightboxPos);
$("#lb-close").addEventListener("click", () => $("#lightbox").close());
for (const b of document.querySelectorAll("[data-lb]")) b.addEventListener("click", () => lbStep(Number(b.dataset.lb)));
$("#lightbox").addEventListener("keydown", e => {
  if (e.key === "ArrowRight") { e.preventDefault(); lbStep(1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); lbStep(-1); }
});
// Tapping the dark area around a photo closes it.
$("#lightbox").addEventListener("click", e => { if (e.target.classList.contains("lb-slide")) $("#lightbox").close(); });
$("#lightbox").addEventListener("close", () => { $("#lb-slides").innerHTML = ""; });
addEventListener("resize", () => { if ($("#lightbox").open) lightboxPos(); });

// Keyboard: Enter / Space on the summary opens or closes it.
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-expand]")) { e.preventDefault(); e.target.click(); }
});
document.addEventListener("change", e => {
  if (e.target.matches("select[data-status]")) store.update(e.target.closest(".card").dataset.id, { status: e.target.value });
  if (e.target.id === "search-picker") { view.searchId = e.target.value; pref.set("search", view.searchId); render(); }
});
const noteTimers = {};
document.addEventListener("input", e => {
  if (!e.target.matches("textarea[data-notes]")) return;
  const el = e.target, id = el.closest(".card").dataset.id;
  clearTimeout(noteTimers[id]);
  noteTimers[id] = setTimeout(() => store.update(id, { notes: el.value }), 700);
});
// Fall back to the remote photo if the cached route fails.
document.addEventListener("error", e => {
  const img = e.target;
  if (img.tagName === "IMG" && img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
}, true);
$("#copy-contact").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#contact").value); $("#copy-contact").textContent = "Copied"; }
  catch (e) { $("#contact").select(); }
});

// Criteria (with its bonus features) and the contact template: edit, then
// Save (saved on this device at once, uploaded in the background like triage).
for (const [sels, btn, hint, label, patchOf] of [
  [["#criteria", "#features"], "#save-criteria", "#criteria-hint", "Criteria", () => ({ criteria: $("#criteria").value, features: parseFeatures($("#features").value) })],
  [["#contact"], "#save-contact", "#contact-hint", "Template", () => ({ contactTemplate: $("#contact").value })],
]) {
  for (const sel of sels) $(sel).addEventListener("input", () => { $(sel).dataset.dirty = "1"; $(btn).disabled = false; $(hint).textContent = "Unsaved changes"; });
  $(btn).addEventListener("click", async () => {
    const search = currentSearch(store.state);
    if (!search) return;
    const patch = patchOf();
    await store.update(search.id, patch, "search");
    if (patch.features) $("#features").value = featuresText(patch.features);
    for (const sel of sels) $(sel).dataset.dirty = "";
    $(btn).disabled = true;
    $(hint).textContent = label + " saved" + (navigator.onLine ? "" : " on this device; uploads when you're back online");
  });
}

// Crawl: runs on the server (a few minutes at most), then pulls fresh data.
$("#run-crawl").addEventListener("click", async () => {
  const search = currentSearch(store.state);
  if (!search || !adapter.crawl) return;
  const btn = $("#run-crawl"), hint = $("#crawl-hint");
  btn.disabled = true; btn.textContent = "Crawling…";
  hint.textContent = "Checking sources and scoring new listings. This can take a few minutes.";
  try {
    const r = await adapter.crawl(search.id);
    hint.textContent = r.added
      ? `${r.added} new listing${r.added === 1 ? "" : "s"} added to To review${r.scored ? "" : " (unscored)"}.`
      : "No new listings this time.";
    const p = r.photos;
    if (p && !p.enabled) hint.textContent += " Photos not saved: connect a Vercel Blob store.";
    else if (p && (p.copied || p.failed || p.left)) {
      hint.textContent += ` ${p.copied} photo${p.copied === 1 ? "" : "s"} saved to Blob` +
        (p.failed ? `, ${p.failed} couldn't be fetched` : "") + (p.left ? `, ${p.left} left for next run` : "") + ".";
    }
    if (r.added) { view.tab = "review"; pref.set("tab", "review"); }
  } catch (e) {
    hint.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Run crawl";
    await store.pull();
  }
});

// ---- criteria / contact / sources sheet ----
function openSheet(which) {
  for (const b of document.querySelectorAll(".sheet-tab")) b.setAttribute("aria-pressed", String(b.dataset.sheet === which));
  for (const name of ["criteria", "contact", "sources"]) $("#sheet-" + name).hidden = which !== name;
  if (!$("#sheet").open) $("#sheet").showModal();
}
// Tap outside the sheet to close it.
$("#sheet").addEventListener("click", e => { if (e.target === $("#sheet")) $("#sheet").close(); });

// ---- settings ----
function openSettings() {
  const sel = $("#set-adapter");
  sel.innerHTML = Object.entries(ADAPTERS).map(([k, a]) => `<option value="${k}"${k === conn.adapter ? " selected" : ""}>${ui.esc(a.label)}</option>`).join("");
  fillFields(conn.adapter);
  $("#settings").showModal();
}
function fillFields(kind) {
  const fields = ADAPTERS[kind].module.FIELDS_FOR_SETTINGS;
  $("#set-fields").innerHTML = fields.map(f => `<label>${ui.esc(f.label)}
    <input id="set-${f.key}" name="${f.key}" ${f.secret ? 'type="password" autocomplete="off"' : ""} placeholder="${ui.esc(f.placeholder || "")}" value="${ui.esc(kind === conn.adapter ? conn[f.key] || "" : "")}" ${f.required ? "required" : ""}></label>`).join("");
  $("#set-hint").textContent = {
    api: "Uses the database this site is deployed with (mirrored to Airtable on the server). Its credentials stay on the server; nothing to enter here.",
  }[kind] || "";
}
$("#set-adapter").addEventListener("change", e => fillFields(e.target.value));
$("#settings-form").addEventListener("submit", async e => {
  if (e.submitter && e.submitter.value !== "save") return;
  const kind = $("#set-adapter").value;
  const next = { adapter: kind };
  for (const f of ADAPTERS[kind].module.FIELDS_FOR_SETTINGS) next[f.key] = $("#set-" + f.key).value.trim();
  conn = next;
  saveConnection(conn);
  adapter = createAdapter(conn);
  warmedKey = "";
  await boot();
});
$("#set-clear").addEventListener("click", async () => {
  if (store.state.outbox.length && !confirmInline()) return;
  await store.destroy();
  $("#settings").close();
  await boot();
});
// The viewer can't show confirm(); refuse to drop unsynced edits instead.
function confirmInline() {
  $("#set-hint").textContent = "There are edits that haven't uploaded yet. Reconnect and let them sync before clearing.";
  return false;
}

if ("serviceWorker" in navigator) {
  // The shell is served stale-while-revalidate, so a deploy shows up only
  // after a reload. When a new worker takes over a page an older one was
  // controlling, reload once — but not mid-typing; wait until the field
  // loses focus or the tab is hidden.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const typing = () => { const el = document.activeElement; return !!el && /^(TEXTAREA|INPUT|SELECT)$/.test(el.tagName); };
  const reloadWhenIdle = () => {
    if (reloading) return;
    if (!typing()) { reloading = true; location.reload(); return; }
    document.addEventListener("focusout", () => setTimeout(reloadWhenIdle, 0), { once: true });
    document.addEventListener("visibilitychange", reloadWhenIdle, { once: true });
  };
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    warmedKey = ""; if (store) render();
    if (hadController) reloadWhenIdle();
  });
}

boot();
