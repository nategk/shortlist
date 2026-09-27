#!/usr/bin/env python3
"""Regenerate gallery.html from listings.db. Run after any edit to the DB."""
import html
import sqlite3

from project_dir import PROJECT_DIR

DB_PATH = PROJECT_DIR / "listings.db"
OUT_PATH = PROJECT_DIR / "gallery.html"

EMPTY_PROJECT = {
    "object": "", "budget": "", "search_area": "", "ship_to_address": "",
    "fulfillment": "", "criteria_md": "", "offer_template_md": "",
}

# Active pipeline, roughly in order, then archive statuses at the end.
STATUS_ORDER = [
    "new", "flagged", "contacted", "replied", "negotiating",
    "viewing_scheduled", "viewed", "offer_made", "purchased",
    "no_go", "rejected", "sold_elsewhere", "scam_suspected",
]

STATUS_LABELS = {
    "new": "New", "flagged": "Flagged for Contact",
    "contacted": "Contacted", "replied": "Replied", "negotiating": "Negotiating",
    "viewing_scheduled": "Viewing Scheduled", "viewed": "Viewed",
    "offer_made": "Offer Made", "purchased": "Purchased",
    "no_go": "No-Go (we passed)", "rejected": "Rejected (seller passed)",
    "sold_elsewhere": "Sold Elsewhere", "scam_suspected": "Scam Suspected",
}

STATUS_COLORS = {
    "new": "#2563eb", "flagged": "#db2777",
    "contacted": "#0891b2", "replied": "#0d9488", "negotiating": "#8b5cf6",
    "viewing_scheduled": "#ca8a04", "viewed": "#ca8a04",
    "offer_made": "#ea580c", "purchased": "#16a34a",
    "no_go": "#6b7280", "rejected": "#dc2626",
    "sold_elsewhere": "#6b7280", "scam_suspected": "#991b1b",
}

ARCHIVE_STATUSES = {"no_go", "rejected", "sold_elsewhere", "scam_suspected"}

SOURCE_STATUS_COLORS = {
    "working": "#16a34a", "partial": "#ca8a04", "blocked": "#dc2626", "untested": "#6b7280",
}


def normalize_status(status):
    return status or "new"


def score_color(score):
    try:
        s = int(score)
    except (TypeError, ValueError):
        return "#6b7280"
    if s >= 80:
        return "#16a34a"
    if s >= 60:
        return "#ca8a04"
    return "#dc2626"


def status_select(row_id, status):
    opts = []
    for s in STATUS_ORDER:
        sel = " selected" if s == status else ""
        opts.append(f'<option value="{s}"{sel}>{html.escape(STATUS_LABELS[s])}</option>')
    return (
        f'<select class="status-select" data-id="{row_id}" '
        f'onchange="updateStatus(\'{row_id}\', this.value)">{"".join(opts)}</select>'
    )


def card(row):
    row_id = html.escape(str(row["id"]))
    photo = html.escape(row["photo_url"] or "")
    url = html.escape(row["url"] or "")
    title = html.escape(row["title"] or "untitled listing")
    price = html.escape(row["price"] or "?")
    score = row["fit_score"]
    score_disp = html.escape(str(score) if score is not None else "?")
    status = normalize_status(row["status"])
    source = html.escape(row["source"] or "")
    location = html.escape(row["location"] or "")
    condition = html.escape(row["condition"] or "")
    variant = html.escape(row["variant"] or "")
    key_specs = html.escape(row["key_specs"] or "")
    notes = html.escape(row["notes"] or "")
    status_color = STATUS_COLORS.get(status, "#6b7280")
    sc_color = score_color(score)
    img_html = (
        f'<img src="{photo}" alt="{title}" loading="lazy" onerror="this.style.display=\'none\'">'
        if photo else '<div class="noimg">no photo</div>'
    )
    return f"""
    <div class="card" data-status="{status}" data-id="{row_id}">
      <div class="swipe-label swipe-label-pass">Pass</div>
      <div class="swipe-label swipe-label-follow">Follow up</div>
      <a class="thumb-link" href="{url}" target="_blank" rel="noopener noreferrer">
        <div class="thumb">{img_html}
          <span class="score" style="background:{sc_color}">{score_disp}</span>
        </div>
      </a>
      <div class="body">
        <div class="top-row">
          <span class="price">${price}</span>
          <span class="status-badge" style="background:{status_color}">{html.escape(STATUS_LABELS.get(status, status))}</span>
        </div>
        <div class="title">{title}</div>
        <div class="meta">{location} &middot; {variant} &middot; {source} &middot; {condition}</div>
        <div class="specs">{key_specs}</div>
        <textarea class="notes-edit" id="notes-{row_id}" spellcheck="false">{notes}</textarea>
        <div class="card-actions">
          <button class="notes-save-btn" onclick="saveNotes('{row_id}')">Save note</button>
          {status_select(row_id, status)}
        </div>
        <span class="save-indicator" id="save-{row_id}"></span>
        <a class="viewlink" href="{url}" target="_blank" rel="noopener noreferrer">View original listing &rarr;</a>
      </div>
    </div>"""


def board(rows):
    rows = sorted(rows, key=lambda r: -(r["fit_score"] or 0))
    cards_html = "\n".join(card(r) for r in rows)
    return f"""
  <div class="bucket-section">
    <div class="sub">{len(rows)} active listings &middot; sorted by fit score</div>
    <div class="grid">{cards_html}</div>
  </div>
"""


def archive_section(rows):
    if not rows:
        return ""
    rows = sorted(rows, key=lambda r: -(r["fit_score"] or 0))
    cards_html = "\n".join(card(r) for r in rows)
    return f"""
  <details class="archive-panel">
    <summary>Archived ({len(rows)}) &middot; no-go / rejected / sold elsewhere / scam suspected</summary>
    <div class="grid" style="margin-top:14px;">{cards_html}</div>
  </details>
"""


def sources_panel(conn):
    srows = conn.execute("SELECT * FROM sources_status ORDER BY source").fetchall()
    if not srows:
        return ""
    chips = []
    for r in srows:
        status = r["status"] or "untested"
        color = SOURCE_STATUS_COLORS.get(status, "#6b7280")
        source = html.escape(r["source"])
        last_success = html.escape(r["last_success"] or "never")
        title = html.escape(r["notes"] or "")
        chips.append(
            f'<span class="source-chip" title="{title}">'
            f'<span class="dot" style="background:{color}"></span>'
            f'{source} <span class="chip-sub">({status}, last success {last_success})</span></span>'
        )
    return f'<div class="sources-panel"><span class="sources-label">Sources:</span> {"".join(chips)}</div>'


def editable_panel(panel_id, title, text, endpoint):
    escaped = html.escape(text or "")
    return f"""
  <details class="editable-panel">
    <summary>{title} (click to reveal &amp; edit)</summary>
    <div class="editable-body">
      <textarea id="{panel_id}-text" spellcheck="false">{escaped}</textarea>
      <div class="editable-actions">
        <button onclick="saveEditable('{panel_id}', '{endpoint}')">Save</button>
        <span id="{panel_id}-status"></span>
      </div>
      <div class="editable-hint">Saving writes straight to the project's local database and regenerates this page. Only works when this page is loaded from the serve.py URL (not a local file:// open) — if Save fails, that's why.</div>
    </div>
  </details>
"""


def project_settings_panel(project):
    fields = [
        ("object", "Searching for"),
        ("budget", "Budget"),
        ("search_area", "Search area"),
        ("ship_to_address", "Ship to (optional)"),
        ("fulfillment", "Fulfillment"),
    ]
    rows_html = "\n".join(
        f'<div class="settings-row"><label for="proj-{key}">{label}</label>'
        f'<input id="proj-{key}" value="{html.escape(project[key] or "")}"></div>'
        for key, label in fields
    )
    return f"""
  <details class="editable-panel">
    <summary>Project Settings (click to reveal &amp; edit)</summary>
    <div class="editable-body">
      <div class="settings-grid">{rows_html}</div>
      <div class="editable-actions">
        <button onclick="saveProjectSettings()">Save</button>
        <span id="project-settings-status"></span>
      </div>
    </div>
  </details>
"""


def status_summary(rows):
    counts = {}
    for r in rows:
        s = normalize_status(r["status"])
        counts[s] = counts.get(s, 0) + 1
    chips = ['<button class="status-chip status-chip-all active" data-status="" onclick="filterByStatus(\'\')">All</button>']
    for s in STATUS_ORDER:
        if counts.get(s):
            color = STATUS_COLORS.get(s, "#6b7280")
            chips.append(
                f'<button class="status-chip" data-status="{s}" style="background:{color}" '
                f'onclick="filterByStatus(\'{s}\')">{html.escape(STATUS_LABELS[s])}: {counts[s]}</button>'
            )
    return f'<div class="status-summary">{"".join(chips)}</div>'


SCRIPT = """
  <script>
    function getEditToken() {
      let t = localStorage.getItem('editToken');
      if (!t) {
        t = window.prompt('Edit token (shown in the serve.py terminal output) - needed once per browser to save changes:');
        if (t) localStorage.setItem('editToken', t.trim());
      }
      return t || '';
    }
    function saveEditable(panelId, endpoint) {
      const text = document.getElementById(panelId + '-text').value;
      const status = document.getElementById(panelId + '-status');
      status.textContent = 'Saving...';
      fetch(endpoint, { method: 'POST', headers: { 'X-Edit-Token': getEditToken() }, body: text })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { status.textContent = 'Saved - reloading...'; setTimeout(() => location.reload(), 600); })
        .catch(e => { status.textContent = 'Save failed: ' + e.message; if (e.message.includes('401')) localStorage.removeItem('editToken'); });
    }
    function saveProjectSettings() {
      const fields = ['object', 'budget', 'search_area', 'ship_to_address', 'fulfillment'];
      const payload = {};
      fields.forEach(f => { payload[f] = document.getElementById('proj-' + f).value; });
      const status = document.getElementById('project-settings-status');
      status.textContent = 'Saving...';
      fetch('/api/save-project-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Edit-Token': getEditToken() },
        body: JSON.stringify(payload)
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { status.textContent = 'Saved - reloading...'; setTimeout(() => location.reload(), 600); })
        .catch(e => { status.textContent = 'Save failed: ' + e.message; if (e.message.includes('401')) localStorage.removeItem('editToken'); });
    }
    function updateStatus(id, status) {
      const indicator = document.getElementById('save-' + id);
      indicator.textContent = 'Saving...';
      fetch('/api/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Edit-Token': getEditToken() },
        body: JSON.stringify({ id: id, status: status })
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { indicator.textContent = 'Saved - reloading...'; setTimeout(() => location.reload(), 400); })
        .catch(e => { indicator.textContent = 'Save failed: ' + e.message; if (e.message.includes('401')) localStorage.removeItem('editToken'); });
    }
    function saveNotes(id) {
      const notes = document.getElementById('notes-' + id).value;
      const indicator = document.getElementById('save-' + id);
      indicator.textContent = 'Saving...';
      fetch('/api/update-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Edit-Token': getEditToken() },
        body: JSON.stringify({ id: id, notes: notes })
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(() => { indicator.textContent = 'Saved'; setTimeout(() => { indicator.textContent = ''; }, 1500); })
        .catch(e => { indicator.textContent = 'Save failed: ' + e.message; if (e.message.includes('401')) localStorage.removeItem('editToken'); });
    }
    function initSwipe() {
      var SWIPE_THRESHOLD = 100;
      document.querySelectorAll('.grid .card').forEach(function(card) {
        if (card.dataset.swipeInit) return;
        card.dataset.swipeInit = '1';
        var startX = 0, startY = 0, dx = 0, dragging = false, active = false;
        var passLabel = card.querySelector('.swipe-label-pass');
        var followLabel = card.querySelector('.swipe-label-follow');

        card.addEventListener('touchstart', function(e) {
          if (e.target.closest('textarea, select, button, a, input')) { active = false; return; }
          var t = e.touches[0];
          startX = t.clientX; startY = t.clientY; dx = 0; dragging = false; active = true;
        }, { passive: true });

        card.addEventListener('touchmove', function(e) {
          if (!active) return;
          var t = e.touches[0];
          var moveX = t.clientX - startX, moveY = t.clientY - startY;
          if (!dragging) {
            if (Math.abs(moveX) > 10 && Math.abs(moveX) > Math.abs(moveY)) {
              dragging = true;
            } else if (Math.abs(moveY) > 10) {
              active = false;
              return;
            } else {
              return;
            }
          }
          dx = moveX;
          e.preventDefault();
          card.style.transition = 'none';
          card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 20) + 'deg)';
          var op = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
          if (dx < 0) { passLabel.style.opacity = op; followLabel.style.opacity = 0; }
          else { followLabel.style.opacity = op; passLabel.style.opacity = 0; }
        }, { passive: false });

        card.addEventListener('touchend', function() {
          if (!active || !dragging) { active = false; return; }
          active = false;
          card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
          if (dx > SWIPE_THRESHOLD) {
            card.style.transform = 'translateX(700px) rotate(20deg)';
            card.style.opacity = '0';
            setTimeout(function() { updateStatus(card.dataset.id, 'flagged'); }, 150);
          } else if (dx < -SWIPE_THRESHOLD) {
            card.style.transform = 'translateX(-700px) rotate(-20deg)';
            card.style.opacity = '0';
            setTimeout(function() { updateStatus(card.dataset.id, 'no_go'); }, 150);
          } else {
            card.style.transform = '';
            passLabel.style.opacity = 0;
            followLabel.style.opacity = 0;
          }
        });
      });
    }
    initSwipe();

    function filterByStatus(status) {
      document.querySelectorAll('.status-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.status === status);
      });
      document.querySelectorAll('.grid').forEach(grid => {
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


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM listings").fetchall()
    project_row = conn.execute("SELECT * FROM project WHERE id = 1").fetchone()
    project = dict(project_row) if project_row else dict(EMPTY_PROJECT)

    active_rows = [r for r in rows if normalize_status(r["status"]) not in ARCHIVE_STATUSES]
    archived_rows = [r for r in rows if normalize_status(r["status"]) in ARCHIVE_STATUSES]

    board_html = board(active_rows)
    archive_html = archive_section(archived_rows)

    page_title = html.escape(project["object"]) if project["object"] else "Shortlist"
    meta_bits = [
        f"Budget: {html.escape(project['budget'])}" if project["budget"] else "",
        f"Search area: {html.escape(project['search_area'])}" if project["search_area"] else "",
        f"Fulfillment: {html.escape(project['fulfillment'])}" if project["fulfillment"] else "",
        f"Ship to: {html.escape(project['ship_to_address'])}" if project["ship_to_address"] else "",
    ]
    project_meta_line = " &middot; ".join(b for b in meta_bits if b)

    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{page_title}</title>
<style>
  body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .sub {{ color: #71717a; font-size: 13px; margin-bottom: 16px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }}
  .card {{ position: relative; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.12); touch-action: pan-y; }}
  .card:hover {{ box-shadow: 0 4px 12px rgba(0,0,0,.15); }}
  .swipe-label {{ position: absolute; top: 14px; z-index: 5; padding: 6px 14px; border-radius: 8px; font-weight: 800; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; opacity: 0; pointer-events: none; border: 3px solid; background: rgba(255,255,255,.92); }}
  .swipe-label-pass {{ left: 14px; color: #dc2626; border-color: #dc2626; transform: rotate(-8deg); }}
  .swipe-label-follow {{ right: 14px; color: #16a34a; border-color: #16a34a; transform: rotate(8deg); }}
  .mobile-swipe-hint {{ display: none; }}
  .thumb-link {{ display: block; text-decoration: none; color: inherit; }}
  .thumb {{ position: relative; background: #d4d4d8; height: 170px; }}
  .thumb img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  .noimg {{ display: flex; align-items: center; justify-content: center; height: 100%; color: #a1a1aa; font-size: 13px; }}
  .score {{ position: absolute; top: 8px; right: 8px; color: #fff; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 20px; }}
  .body {{ padding: 12px 14px 14px; }}
  .top-row {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }}
  .price {{ font-size: 17px; font-weight: 700; }}
  .status-badge {{ color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }}
  .title {{ font-size: 14px; font-weight: 600; }}
  .meta {{ font-size: 12px; color: #52525b; margin-top: 2px; }}
  .specs {{ font-size: 11px; color: #71717a; margin-top: 6px; }}
  .notes-edit {{ width: 100%; box-sizing: border-box; font-size: 12px; color: #3f3f46; margin-top: 8px; line-height: 1.4; min-height: 5.5em; padding: 6px 8px; border: 1px solid #e4e4e7; border-radius: 6px; font-family: inherit; resize: vertical; }}
  .viewlink {{ display: block; font-size: 12px; color: #2563eb; font-weight: 600; margin-top: 10px; text-decoration: none; }}
  .card-actions {{ margin-top: 8px; display: flex; align-items: center; gap: 8px; }}
  .notes-save-btn {{ font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #d4d4d8; background: #f4f4f5; cursor: pointer; white-space: nowrap; }}
  .notes-save-btn:hover {{ background: #e4e4e7; }}
  .status-select {{ font-size: 12px; padding: 4px 6px; border-radius: 6px; border: 1px solid #d4d4d8; flex: 1; }}
  .save-indicator {{ font-size: 11px; color: #a1a1aa; }}
  .sources-panel {{ background: #fff; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: #3f3f46; }}
  .sources-label {{ font-weight: 700; margin-right: 6px; }}
  .source-chip {{ display: inline-flex; align-items: center; margin-right: 14px; cursor: default; }}
  .source-chip .dot {{ width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; display: inline-block; }}
  .chip-sub {{ color: #a1a1aa; margin-left: 4px; }}
  .status-summary {{ margin-bottom: 20px; }}
  .status-chip {{ display: inline-block; color: #fff; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; margin-right: 8px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .03em; border: none; cursor: pointer; font-family: inherit; opacity: .55; }}
  .status-chip.active {{ opacity: 1; box-shadow: 0 0 0 2px #18181b; }}
  .status-chip-all {{ background: #18181b; }}
  .editable-panel, .archive-panel {{ background: #fff; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }}
  .editable-panel summary, .archive-panel summary {{ cursor: pointer; font-weight: 700; }}
  .editable-body {{ margin-top: 10px; }}
  .editable-body textarea {{ width: 100%; height: 360px; box-sizing: border-box; font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5; padding: 10px; border: 1px solid #d4d4d8; border-radius: 6px; }}
  .editable-actions {{ margin-top: 8px; display: flex; align-items: center; gap: 10px; }}
  .editable-actions button {{ background: #2563eb; color: #fff; border: none; padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }}
  .editable-actions button:hover {{ background: #1d4ed8; }}
  .editable-panel span[id$="-status"] {{ font-size: 12px; color: #71717a; }}
  .editable-hint {{ font-size: 11px; color: #a1a1aa; margin-top: 6px; }}
  .archive-panel {{ margin-top: 28px; }}
  .project-meta {{ color: #52525b; font-size: 13px; margin-bottom: 14px; }}
  .settings-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }}
  .settings-row {{ display: flex; flex-direction: column; gap: 4px; }}
  .settings-row label {{ font-size: 11px; color: #71717a; font-weight: 600; }}
  .settings-row input {{ font-size: 13px; padding: 6px 8px; border: 1px solid #d4d4d8; border-radius: 6px; font-family: inherit; }}

  @media (max-width: 640px) {{
    body {{ padding: 12px; }}
    h1 {{ font-size: 18px; }}
    .grid {{ grid-template-columns: 1fr; gap: 12px; }}
    .thumb {{ height: 200px; }}
    .top-row {{ flex-wrap: wrap; }}
    .card-actions {{ flex-wrap: wrap; }}
    .status-select {{ flex: 1 1 100%; font-size: 14px; padding: 8px; }}
    .notes-save-btn {{ font-size: 13px; padding: 6px 12px; }}
    .notes-edit {{ font-size: 14px; }}
    .source-chip {{ display: inline-flex; margin-right: 10px; margin-bottom: 4px; }}
    .sources-panel {{ overflow-x: auto; white-space: nowrap; }}
    .editable-body textarea {{ height: 240px; font-size: 13px; }}
    .mobile-swipe-hint {{ display: block; }}
  }}
</style></head>
<body>
  <h1>{page_title}</h1>
  {f'<div class="project-meta">{project_meta_line}</div>' if project_meta_line else ''}
  <div class="sub">{len(rows)} listings tracked total &middot; sorted by fit score &middot; change status from the dropdown on any card &middot; click a photo to open the original listing<span class="mobile-swipe-hint">&middot; swipe a card right to flag for follow-up, left to pass</span></div>
  {project_settings_panel(project)}
  {editable_panel('criteria', 'Scoring Criteria', project['criteria_md'], '/api/save-criteria')}
  {editable_panel('offer', 'Contact/Offer Template', project['offer_template_md'], '/api/save-outreach')}
  {sources_panel(conn)}
  {status_summary(active_rows)}
  {board_html}
  {archive_html}
  {SCRIPT}
</body></html>"""
    OUT_PATH.write_text(doc, encoding="utf-8")
    conn.close()
    print(f"Wrote {OUT_PATH} with {len(rows)} listings ({len(archived_rows)} archived)")


if __name__ == "__main__":
    main()
