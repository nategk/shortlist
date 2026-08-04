#!/usr/bin/env python3
"""Serves this directory like http.server, plus:
  POST /api/save-criteria   - overwrites criteria.md with the request body
  POST /api/save-outreach   - overwrites offer_template.md with the request body
  POST /api/update-status   - {"id": "...", "status": "..."} updates one listing's status
  POST /api/update-notes    - {"id": "...", "notes": "..."} updates one listing's notes
All regenerate gallery.html after writing.

Binds to your Tailscale interface IP by default (detected at runtime via
`tailscale ip -4`), so the gallery is reachable from any of your Tailscale
devices but not the open internet. Never binds to 0.0.0.0 unless you pass it
explicitly as bind_ip.

Usage: python3 serve.py [bind_ip] [port]   (default port: 8091)
"""
import json
import secrets
import subprocess
import sqlite3
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIR = Path(__file__).parent
DB_PATH = DIR / "listings.db"
TOKEN_PATH = DIR / ".edit_token"


def get_or_create_edit_token():
    """A shared secret required on every POST (edit) request. GET (viewing) is
    never gated - this only matters once the server is reachable off the
    tailnet (e.g. via Tailscale Funnel), so a leaked link can be viewed but
    not used to edit data."""
    if TOKEN_PATH.exists():
        return TOKEN_PATH.read_text(encoding="utf-8").strip()
    token = secrets.token_urlsafe(24)
    TOKEN_PATH.write_text(token, encoding="utf-8")
    return token


EDIT_TOKEN = get_or_create_edit_token()

FILE_SAVE_ENDPOINTS = {
    "/api/save-criteria": DIR / "criteria.md",
    "/api/save-outreach": DIR / "offer_template.md",
}

# endpoint -> listings column it updates
ROW_UPDATE_ENDPOINTS = {
    "/api/update-status": "status",
    "/api/update-notes": "notes",
}


def regenerate_gallery():
    subprocess.run([sys.executable, str(DIR / "generate_gallery.py")], check=True, cwd=DIR)


def update_row_field(row_id, field, value):
    """Returns (ok, error_message). error_message is None on success."""
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(f"UPDATE listings SET {field} = ? WHERE id = ?", (value, row_id))
        conn.commit()
        if cur.rowcount == 0:
            return False, f"no listing with id {row_id}"
    return True, None


def detect_tailscale_ip():
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5, check=True)
        ip = out.stdout.strip().splitlines()[0]
        return ip or None
    except (subprocess.CalledProcessError, FileNotFoundError, IndexError, subprocess.TimeoutExpired):
        return None


class Handler(SimpleHTTPRequestHandler):
    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length).decode("utf-8")

    def _respond(self, code, text):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(text.encode())

    def do_POST(self):
        if self.headers.get("X-Edit-Token") != EDIT_TOKEN:
            self._respond(401, "missing or invalid edit token")
            return

        if self.path in FILE_SAVE_ENDPOINTS:
            target = FILE_SAVE_ENDPOINTS[self.path]
            body = self._read_body()
            if not body.strip():
                self._respond(400, "empty body, refusing to save")
                return
            target.write_text(body, encoding="utf-8")
            try:
                regenerate_gallery()
            except subprocess.CalledProcessError as e:
                self._respond(500, f"saved {target.name} but gallery regen failed: {e}")
                return
            self._respond(200, "saved")

        elif self.path in ROW_UPDATE_ENDPOINTS:
            field = ROW_UPDATE_ENDPOINTS[self.path]
            try:
                payload = json.loads(self._read_body())
                row_id, value = int(payload["id"]), payload[field]
            except (ValueError, KeyError, TypeError):
                self._respond(400, f"expected JSON body {{id, {field}}}")
                return

            ok, err = update_row_field(row_id, field, value)
            if not ok:
                code = 404 if "no listing" in (err or "") else 500
                self._respond(code, err)
                return

            try:
                regenerate_gallery()
            except subprocess.CalledProcessError as e:
                self._respond(500, f"updated {field} but gallery regen failed: {e}")
                return
            self._respond(200, "saved")

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; errors still surface via send_response codes


def main():
    import os

    if len(sys.argv) > 1:
        bind = sys.argv[1]
    else:
        bind = detect_tailscale_ip()
        if not bind:
            print(
                "Could not detect a Tailscale IP (is `tailscale` installed and up?). "
                "Pass a bind IP explicitly, e.g. `python3 serve.py 127.0.0.1` for localhost-only.",
                file=sys.stderr,
            )
            sys.exit(1)

    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8091
    os.chdir(DIR)
    server = ThreadingHTTPServer((bind, port), Handler)
    print(f"Serving {DIR} on http://{bind}:{port} (GET static files, POST /api/save-criteria, /api/save-outreach, /api/update-status, /api/update-notes)")
    print(f"Edit token (needed to save changes, not to view): {EDIT_TOKEN}")
    server.serve_forever()


if __name__ == "__main__":
    main()
