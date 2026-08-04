#!/usr/bin/env python3
"""Regenerate gallery.html from listings.csv + garages.csv. Run after any edit to either."""
import csv
import html
from pathlib import Path

DIR = Path(__file__).parent
CSV_PATH = DIR / "listings.csv"
SOURCES_PATH = DIR / "sources_status.csv"
CRITERIA_PATH = DIR / "criteria.md"
OUTREACH_PATH = DIR / "outreach_templates.md"
GARAGE_CSV_PATH = DIR / "garages.csv"
GARAGE_CRITERIA_PATH = DIR / "garage_criteria.md"
OUT_PATH = DIR / "gallery.html"

# Active pipeline, roughly in order, then archive statuses at the end. Shared by both tabs.
STATUS_ORDER = [
    "new", "flagged", "contacted", "replied", "live_conv",
    "tour_scheduled", "toured", "applied", "offer", "signed",
    "no_go", "rejected", "expired",
]

STATUS_LABELS = {
    "new": "New", "flagged": "Flagged for Contact",
    "contacted": "Contacted", "replied": "Replied", "live_conv": "Live Conversation",
    "tour_scheduled": "Tour Scheduled", "toured": "Toured", "applied": "Applied",
    "offer": "Offer", "signed": "Signed",
    "no_go": "No-Go (we passed)", "rejected": "Rejected (they passed)", "expired": "Expired/Rented",
}

STATUS_COLORS = {
    "new": "#2563eb", "flagged": "#db2777",
    "contacted": "#0891b2", "replied": "#0d9488", "live_conv": "#8b5cf6",
    "tour_scheduled": "#ca8a04", "toured": "#ca8a04", "applied": "#ea580c",
    "offer": "#16a34a", "signed": "#16a34a",
    "no_go": "#6b7280", "rejected": "#dc2626", "expired": "#6b7280",
}

# Legacy values from before the 2026-07-27 status rename/cleanup, mapped forward
# so old rows/links still render sensibly until they're resaved.
STATUS_ALIASES = {"want_to_contact": "flagged", "passed": "no_go", "reviewing": "new"}

ARCHIVE_STATUSES = {"no_go", "rejected", "expired"}

SOURCE_STATUS_COLORS = {
    "working": "#16a34a", "partial": "#ca8a04", "blocked": "#dc2626", "untested": "#6b7280",
}

BUCKET_LABELS = {
    "monthly": ("Monthly/standard lease (own place, ≤$3.5k, move-in Sept 1 or Nov 1, month-to-month ideal / 6mo max)", 1),
    "sublet": ("Sublet (fallback/bridge option - no fixed date target)", 2),
    "other": ("Doesn't fit current target (kept for reference)", 3),
}
BUCKET_SHORT = {"monthly": "Monthly", "sublet": "Sublet", "other": "Other"}


def normalize_status(status):
    status = status or "new"
    return STATUS_ALIASES.get(status, status)


def score_color(score):
    try:
        s = int(score)
    except (TypeError, ValueError):
        return "#6b7280"
    if s >= 7:
        return "#16a34a"
    if s >= 5:
        return "#ca8a04"
    return "#dc2626"


def status_select(row_id, status, tab):
    opts = []
    for s in STATUS_ORDER:
        sel = " selected" if s == status else ""
        opts.append(f'<option value="{s}"{sel}>{html.escape(STATUS_LABELS[s])}</option>')
    return (
        f'<select class="status-select" data-id="{row_id}" '
        f'onchange="updateStatus(\'{row_id}\', this.value, \'{tab}\')">{"".join(opts)}</select>'
    )


def card(row, tab="apartments"):
    row_id = html.escape(row.get("id", "") or "")
    dom_id = f"{tab}-{row_id}"
    photo = html.escape(row.get("photo_url", "") or "")
    url = html.escape(row.get("url", "") or "")
    address = html.escape(row.get("address", "") or "unspecified address")
    neighborhood = html.escape(row.get("neighborhood", "") or "")
    price = html.escape(row.get("price", "") or "?")
    score = html.escape(row.get("fit_score", "") or "?")
    status = normalize_status(row.get("status"))
    source = html.escape(row.get("source", "") or "")
    bucket = html.escape(BUCKET_SHORT.get(row.get("bucket", "other") or "other", "Other"))
    notes = html.escape(row.get("notes", "") or "")
    bedrooms = html.escape(row.get("bedrooms", "") or "")
    in_unit_wd = html.escape(row.get("in_unit_wd", "") or "")
    dishwasher = html.escape(row.get("dishwasher", "") or "")
    ac = html.escape(row.get("ac", "") or "")
    status_color = STATUS_COLORS.get(status, "#6b7280")
    sc_color = score_color(score)
    img_html = (
        f'<img src="{photo}" alt="{address}" loading="lazy" onerror="this.style.display=\'none\'">'
        if photo else '<div class="noimg">no photo</div>'
    )
    return f"""
    <div class="card" data-status="{status}">
      <a class="thumb-link" href="{url}" target="_blank" rel="noopener noreferrer">
        <div class="thumb">{img_html}
          <span class="score" style="background:{sc_color}">{score}/10</span>
        </div>
      </a>
      <div class="body">
        <div class="top-row">
          <span class="price">${price}/mo</span>
          <span class="status-badge" style="background:{status_color}">{html.escape(STATUS_LABELS.get(status, status))}</span>
        </div>
        <div class="address">{address}</div>
        <div class="neighborhood">{neighborhood} &middot; {bedrooms}BR &middot; {source} &middot; {bucket}</div>
        <div class="amenities">AC: {ac} &middot; In-unit W/D: {in_unit_wd} &middot; Dishwasher: {dishwasher}</div>
        <textarea class="notes-edit" id="notes-{dom_id}" spellcheck="false">{notes}</textarea>
        <div class="card-actions">
          <button class="notes-save-btn" onclick="saveNotes('{row_id}', '{tab}')">Save note</button>
          {status_select(row_id, status, tab)}
        </div>
        <span class="save-indicator" id="save-{dom_id}"></span>
        <a class="viewlink" href="{url}" target="_blank" rel="noopener noreferrer">View original listing &rarr;</a>
      </div>
    </div>"""


def garage_card(row, tab="garage"):
    row_id = html.escape(row.get("id", "") or "")
    dom_id = f"{tab}-{row_id}"
    photo = html.escape(row.get("photo_url", "") or "")
    url = html.escape(row.get("url", "") or "")
    address = html.escape(row.get("address", "") or "unspecified address")
    neighborhood = html.escape(row.get("neighborhood", "") or "")
    price = html.escape(row.get("monthly_price", "") or "?")
    score = html.escape(row.get("fit_score", "") or "?")
    status = normalize_status(row.get("status"))
    source = html.escape(row.get("source", "") or "")
    notes = html.escape(row.get("notes", "") or "")
    spot_type = html.escape(row.get("spot_type", "") or "unconfirmed")
    height_clearance = html.escape(row.get("height_clearance", "") or "unconfirmed")
    ev_charging = html.escape(row.get("ev_charging", "") or "unconfirmed")
    contract_length = html.escape(row.get("contract_length", "") or "unconfirmed")
    status_color = STATUS_COLORS.get(status, "#6b7280")
    sc_color = score_color(score)
    img_html = (
        f'<img src="{photo}" alt="{address}" loading="lazy" onerror="this.style.display=\'none\'">'
        if photo else '<div class="noimg">no photo</div>'
    )
    return f"""
    <div class="card" data-status="{status}">
      <a class="thumb-link" href="{url}" target="_blank" rel="noopener noreferrer">
        <div class="thumb">{img_html}
          <span class="score" style="background:{sc_color}">{score}/10</span>
        </div>
      </a>
      <div class="body">
        <div class="top-row">
          <span class="price">${price}/mo</span>
          <span class="status-badge" style="background:{status_color}">{html.escape(STATUS_LABELS.get(status, status))}</span>
        </div>
        <div class="address">{address}</div>
        <div class="neighborhood">{neighborhood} &middot; {source}</div>
        <div class="amenities">Spot: {spot_type} &middot; Clearance: {height_clearance} &middot; EV: {ev_charging} &middot; Term: {contract_length}</div>
        <textarea class="notes-edit" id="notes-{dom_id}" spellcheck="false">{notes}</textarea>
        <div class="card-actions">
          <button class="notes-save-btn" onclick="saveNotes('{row_id}', '{tab}')">Save note</button>
          {status_select(row_id, status, tab)}
        </div>
        <span class="save-indicator" id="save-{dom_id}"></span>
        <a class="viewlink" href="{url}" target="_blank" rel="noopener noreferrer">View original listing &rarr;</a>
      </div>
    </div>"""


def section(bucket_key, rows):
    label, _ = BUCKET_LABELS.get(bucket_key, (bucket_key, 9))
    rows = sorted(rows, key=lambda r: -int(r.get("fit_score") or 0))
    cards_html = "\n".join(card(r, "apartments") for r in rows)
    return f"""
  <div class="bucket-section">
    <h2>{label}</h2>
    <div class="sub">{len(rows)} listings</div>
    <div class="grid">{cards_html}</div>
  </div>
"""


def archive_section(rows, tab, render_card):
    if not rows:
        return ""
    rows = sorted(rows, key=lambda r: -int(r.get("fit_score") or 0))
    cards_html = "\n".join(render_card(r, tab) for r in rows)
    return f"""
  <details class="archive-panel">
    <summary>Archived ({len(rows)}) &middot; no-go / rejected / expired</summary>
    <div class="grid" style="margin-top:14px;">{cards_html}</div>
  </details>
"""


def sources_panel():
    if not SOURCES_PATH.exists():
        return ""
    with open(SOURCES_PATH, newline="") as f:
        srows = list(csv.DictReader(f))
    chips = []
    for r in srows:
        status = r.get("status", "untested") or "untested"
        color = SOURCE_STATUS_COLORS.get(status, "#6b7280")
        source = html.escape(r.get("source", ""))
        last_success = html.escape(r.get("last_success", "") or "never")
        title = html.escape(r.get("notes", ""))
        chips.append(
            f'<span class="source-chip" title="{title}">'
            f'<span class="dot" style="background:{color}"></span>'
            f'{source} <span class="chip-sub">({status}, last success {last_success})</span></span>'
        )
    return f'<div class="sources-panel"><span class="sources-label">Sources:</span> {"".join(chips)}</div>'


def editable_panel(panel_id, title, path, endpoint):
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    escaped = html.escape(text)
    return f"""
  <details class="editable-panel">
    <summary>{title} (click to reveal &amp; edit)</summary>
    <div class="editable-body">
      <textarea id="{panel_id}-text" spellcheck="false">{escaped}</textarea>
      <div class="editable-actions">
        <button onclick="saveEditable('{panel_id}', '{endpoint}')">Save</button>
        <span id="{panel_id}-status"></span>
      </div>
      <div class="editable-hint">Saving writes straight to {path.name} and regenerates this page. Only works when this page is loaded from the serve.py URL (not a local file:// open) — if Save fails, that's why.</div>
    </div>
  </details>
"""


def status_summary(rows, tab):
    counts = {}
    for r in rows:
        s = normalize_status(r.get("status"))
        counts[s] = counts.get(s, 0) + 1
    chips = [f'<button class="status-chip status-chip-all active" data-status="" onclick="filterByStatus(\'\', \'{tab}\')">All</button>']
    for s in STATUS_ORDER:
        if counts.get(s):
            color = STATUS_COLORS.get(s, "#6b7280")
            chips.append(
                f'<button class="status-chip" data-status="{s}" style="background:{color}" '
                f'onclick="filterByStatus(\'{s}\', \'{tab}\')">{html.escape(STATUS_LABELS[s])}: {counts[s]}</button>'
            )
    return f'<div class="status-summary">{"".join(chips)}</div>'


SCRIPT = """
  <script>
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === 'tab-' + tab));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    }
    function saveEditable(panelId, endpoint) {
      const text = document.getElementById(panelId + '-text').value;
      const status = document.getElementById(panelId + '-status');
      status.textContent = 'Saving...';
      fetch(endpoint, { method: 'POST', body: text })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { status.textContent = 'Saved - reloading...'; setTimeout(() => location.reload(), 600); })
        .catch(e => { status.textContent = 'Save failed: ' + e.message; });
    }
    function updateStatus(id, status, tab) {
      const indicator = document.getElementById('save-' + tab + '-' + id);
      indicator.textContent = 'Saving...';
      fetch('/api/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, status: status, list: tab })
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { indicator.textContent = 'Saved - reloading...'; setTimeout(() => location.reload(), 400); })
        .catch(e => { indicator.textContent = 'Save failed: ' + e.message; });
    }
    function saveNotes(id, tab) {
      const notes = document.getElementById('notes-' + tab + '-' + id).value;
      const indicator = document.getElementById('save-' + tab + '-' + id);
      indicator.textContent = 'Saving...';
      fetch('/api/update-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, notes: notes, list: tab })
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { indicator.textContent = 'Saved'; setTimeout(() => { indicator.textContent = ''; }, 1500); })
        .catch(e => { indicator.textContent = 'Save failed: ' + e.message; });
    }
    function filterByStatus(status, tab) {
      const container = document.getElementById('tab-' + tab);
      if (!container) return;
      container.querySelectorAll('.status-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.status === status);
      });
      container.querySelectorAll('.grid').forEach(grid => {
        let visibleCount = 0;
        grid.querySelectorAll('.card').forEach(card => {
          const match = !status || card.dataset.status === status;
          card.style.display = match ? '' : 'none';
          if (match) visibleCount++;
        });
        const section = grid.closest('.bucket-section') || grid.closest('.archive-panel');
        if (section) {
          const sub = section.querySelector('.sub, summary');
          if (sub && sub.dataset.baseLabel === undefined) sub.dataset.baseLabel = sub.textContent;
          if (sub) sub.textContent = status ? (visibleCount + ' listings match filter') : sub.dataset.baseLabel;
        }
      });
    }
  </script>
"""

CSS = """
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 2px; }
  .sub { color: #71717a; font-size: 13px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .card { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.15); }
  .thumb-link { display: block; text-decoration: none; color: inherit; }
  .thumb { position: relative; background: #d4d4d8; height: 170px; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .noimg { display: flex; align-items: center; justify-content: center; height: 100%; color: #a1a1aa; font-size: 13px; }
  .score { position: absolute; top: 8px; right: 8px; color: #fff; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 20px; }
  .body { padding: 12px 14px 14px; }
  .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
  .price { font-size: 17px; font-weight: 700; }
  .status-badge { color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
  .address { font-size: 14px; font-weight: 600; }
  .neighborhood { font-size: 12px; color: #52525b; margin-top: 2px; }
  .amenities { font-size: 11px; color: #71717a; margin-top: 6px; }
  .notes-edit { width: 100%; box-sizing: border-box; font-size: 12px; color: #3f3f46; margin-top: 8px; line-height: 1.4; min-height: 5.5em; padding: 6px 8px; border: 1px solid #e4e4e7; border-radius: 6px; font-family: inherit; resize: vertical; }
  .viewlink { display: block; font-size: 12px; color: #2563eb; font-weight: 600; margin-top: 10px; text-decoration: none; }
  .card-actions { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
  .notes-save-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #d4d4d8; background: #f4f4f5; cursor: pointer; white-space: nowrap; }
  .notes-save-btn:hover { background: #e4e4e7; }
  .status-select { font-size: 12px; padding: 4px 6px; border-radius: 6px; border: 1px solid #d4d4d8; flex: 1; }
  .save-indicator { font-size: 11px; color: #a1a1aa; }
  .sources-panel { background: #fff; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: #3f3f46; }
  .sources-label { font-weight: 700; margin-right: 6px; }
  .source-chip { display: inline-flex; align-items: center; margin-right: 14px; cursor: default; }
  .source-chip .dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; display: inline-block; }
  .chip-sub { color: #a1a1aa; margin-left: 4px; }
  .status-summary { margin-bottom: 20px; }
  .status-chip { display: inline-block; color: #fff; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; margin-right: 8px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .03em; border: none; cursor: pointer; font-family: inherit; opacity: .55; }
  .status-chip.active { opacity: 1; box-shadow: 0 0 0 2px #18181b; }
  .status-chip-all { background: #18181b; }
  .editable-panel, .archive-panel { background: #fff; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
  .editable-panel summary, .archive-panel summary { cursor: pointer; font-weight: 700; }
  .editable-body { margin-top: 10px; }
  .editable-body textarea { width: 100%; height: 360px; box-sizing: border-box; font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5; padding: 10px; border: 1px solid #d4d4d8; border-radius: 6px; }
  .editable-actions { margin-top: 8px; display: flex; align-items: center; gap: 10px; }
  .editable-actions button { background: #2563eb; color: #fff; border: none; padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .editable-actions button:hover { background: #1d4ed8; }
  .editable-panel span[id$="-status"] { font-size: 12px; color: #71717a; }
  .editable-hint { font-size: 11px; color: #a1a1aa; margin-top: 6px; }
  .archive-panel { margin-top: 28px; }
  .tab-bar { margin-bottom: 18px; }
  .tab-btn { font-size: 14px; font-weight: 600; padding: 8px 18px; border-radius: 8px; border: 1px solid #d4d4d8; background: #fff; cursor: pointer; margin-right: 8px; color: #52525b; }
  .tab-btn.active { background: #18181b; color: #fff; border-color: #18181b; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
"""


def load_rows(path):
    if not path.exists():
        return []
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["status"] = normalize_status(r.get("status"))
    return rows


def apartments_tab():
    rows = load_rows(CSV_PATH)
    active_rows = [r for r in rows if r["status"] not in ARCHIVE_STATUSES]
    archived_rows = [r for r in rows if r["status"] in ARCHIVE_STATUSES]

    by_bucket = {}
    for r in active_rows:
        by_bucket.setdefault(r.get("bucket", "other") or "other", []).append(r)

    order = sorted(by_bucket.keys(), key=lambda k: BUCKET_LABELS.get(k, (k, 9))[1])
    sections_html = "\n".join(section(k, by_bucket[k]) for k in order)
    archive_html = archive_section(archived_rows, "apartments", card)

    body = f"""
  <div class="sub">{len(rows)} listings tracked total &middot; grouped by target bucket, sorted by fit score within each &middot; change status from the dropdown on any card &middot; click a photo to open the original listing</div>
  {editable_panel('criteria', 'Scoring Criteria', CRITERIA_PATH, '/api/save-criteria')}
  {editable_panel('outreach', 'Outreach Template', OUTREACH_PATH, '/api/save-outreach')}
  {sources_panel()}
  {status_summary(active_rows, 'apartments')}
  {sections_html}
  {archive_html}
"""
    return body, len(rows)


def garage_tab():
    rows = load_rows(GARAGE_CSV_PATH)
    active_rows = [r for r in rows if r["status"] not in ARCHIVE_STATUSES]
    archived_rows = [r for r in rows if r["status"] in ARCHIVE_STATUSES]
    active_rows_sorted = sorted(active_rows, key=lambda r: -int(r.get("fit_score") or 0))
    cards_html = "\n".join(garage_card(r, "garage") for r in active_rows_sorted)
    archive_html = archive_section(archived_rows, "garage", garage_card)

    body = f"""
  <div class="sub">{len(rows)} garage spots tracked &middot; sorted by fit score &middot; change status from the dropdown on any card &middot; click a photo to open the original listing</div>
  {editable_panel('garage-criteria', 'Garage Search Criteria', GARAGE_CRITERIA_PATH, '/api/save-garage-criteria')}
  {status_summary(active_rows, 'garage')}
  <div class="bucket-section">
    <h2>UWS Garage/Parking Spots</h2>
    <div class="sub">{len(active_rows_sorted)} listings</div>
    <div class="grid">{cards_html}</div>
  </div>
  {archive_html}
"""
    return body, len(rows)


def main():
    apt_body, apt_count = apartments_tab()
    garage_body, garage_count = garage_tab()

    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Apartment Search Tracker</title>
<style>{CSS}</style></head>
<body>
  <h1>Apartment Search Tracker</h1>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="apartments" onclick="showTab('apartments')">Apartments ({apt_count})</button>
    <button class="tab-btn" data-tab="garage" onclick="showTab('garage')">Garage Parking ({garage_count})</button>
  </div>
  <div id="tab-apartments" class="tab-content active">{apt_body}</div>
  <div id="tab-garage" class="tab-content">{garage_body}</div>
  {SCRIPT}
</body></html>"""
    OUT_PATH.write_text(doc, encoding="utf-8")
    print(f"Wrote {OUT_PATH}: {apt_count} apartment listings, {garage_count} garage listings")


if __name__ == "__main__":
    main()
