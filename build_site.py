#!/usr/bin/env python3
"""Build the public static site (GitHub Pages) from every project under
searches/: a read-only gallery per search at _site/<name>/, its cached
photos alongside, and an index page linking them. Run locally to preview
(`python3 build_site.py && python3 -m http.server -d _site`); CI runs it on
every push to main (.github/workflows/pages.yml)."""
import html
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

APP_DIR = Path(__file__).parent
SEARCHES = APP_DIR / "searches"
SITE = APP_DIR / "_site"


def main():
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    entries = []
    for proj in sorted(p for p in SEARCHES.iterdir() if (p / "listings.db").exists()):
        out = SITE / proj.name
        env = {**os.environ, "SHORTLIST_PROJECT": str(proj)}
        subprocess.run(
            [sys.executable, str(APP_DIR / "generate_gallery.py"), "--read-only", "--out", str(out / "index.html")],
            check=True, env=env,
        )
        if (proj / "photos").is_dir():
            shutil.copytree(proj / "photos", out / "photos")
        with sqlite3.connect(proj / "listings.db") as conn:
            obj = (conn.execute("SELECT object FROM project WHERE id = 1").fetchone() or [""])[0]
            count = conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
        entries.append((proj.name, obj or proj.name, count))

    items = "\n".join(
        f'<li><a href="{html.escape(name)}/">{html.escape(title)}</a> <span>{count} listings</span></li>'
        for name, title, count in entries
    )
    (SITE / "index.html").write_text(f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shortlist</title>
<style>
  body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; background: #f4f4f5; color: #18181b; margin: 0; padding: 32px 16px; }}
  main {{ max-width: 640px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 16px; }}
  ul {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }}
  li {{ background: #fff; border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }}
  a {{ color: #2563eb; font-weight: 600; text-decoration: none; }}
  span {{ color: #71717a; font-size: 13px; }}
</style></head>
<body><main><h1>Shortlist</h1><ul>
{items}
</ul></main></body></html>
""", encoding="utf-8")
    # Pages serves files as-is; skip Jekyll processing.
    (SITE / ".nojekyll").write_text("")
    print(f"Built {SITE} with {len(entries)} search(es)")


if __name__ == "__main__":
    main()
