#!/usr/bin/env python3
"""Serves this directory like http.server, plus:
  POST /api/save-criteria         - overwrites criteria.md with the request body
  POST /api/save-outreach         - overwrites outreach_templates.md with the request body
  POST /api/save-garage-criteria  - overwrites garage_criteria.md with the request body
  POST /api/update-status         - {"id": "...", "status": "...", "list": "apartments"|"garage"}
  POST /api/update-notes          - {"id": "...", "notes": "...", "list": "apartments"|"garage"}
"list" defaults to "apartments" if omitted (back-compat). All regenerate gallery.html after writing.

Usage: python3 serve.py [bind_ip] [port]   (defaults: 127.0.0.1 8090)
"""
import csv
import json
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIR = Path(__file__).parent

FILE_SAVE_ENDPOINTS = {
    "/api/save-criteria": DIR / "criteria.md",
    "/api/save-outreach": DIR / "outreach_templates.md",
    "/api/save-garage-criteria": DIR / "garage_criteria.md",
}

# "list" value -> CSV path
LIST_CSV_PATHS = {
    "apartments": DIR / "listings.csv",
    "garage": DIR / "garages.csv",
}

# endpoint -> CSV column it updates
ROW_UPDATE_ENDPOINTS = {
    "/api/update-status": "status",
    "/api/update-notes": "notes",
}


def regenerate_gallery():
    subprocess.run([sys.executable, str(DIR / "generate_gallery.py")], check=True, cwd=DIR)


def update_row_field(csv_path, row_id, field, value):
    """Returns (ok, error_message). error_message is None on success."""
    if not csv_path.exists():
        return False, f"{csv_path.name} not found"
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    found = False
    for r in rows:
        if r["id"] == row_id:
            r[field] = value
            found = True
            break

    if not found:
        return False, f"no listing with id {row_id} in {csv_path.name}"

    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return True, None


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
                row_id, value = str(payload["id"]), payload[field]
                list_name = payload.get("list", "apartments")
            except (ValueError, KeyError):
                self._respond(400, f"expected JSON body {{id, {field}, list?}}")
                return

            csv_path = LIST_CSV_PATHS.get(list_name)
            if csv_path is None:
                self._respond(400, f"unknown list '{list_name}'")
                return

            ok, err = update_row_field(csv_path, row_id, field, value)
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
    bind = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8090
    import os
    os.chdir(DIR)
    server = ThreadingHTTPServer((bind, port), Handler)
    print(f"Serving {DIR} on http://{bind}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
