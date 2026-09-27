"""Resolves where a project's data lives (listings.db, gallery.html, photos/,
config/). Defaults to the folder these scripts sit in, so the original
"copy the scripts into your project folder" setup keeps working. Set
SHORTLIST_PROJECT to point the scripts at a project folder elsewhere instead,
e.g. `SHORTLIST_PROJECT=searches/nyc-rental python3 add_listing.py ...`."""
import os
from pathlib import Path

APP_DIR = Path(__file__).parent
PROJECT_DIR = Path(os.environ.get("SHORTLIST_PROJECT") or APP_DIR).resolve()
# Pin the resolved absolute path so child processes (gallery regeneration)
# land on the same project even when they run from a different cwd.
os.environ["SHORTLIST_PROJECT"] = str(PROJECT_DIR)
