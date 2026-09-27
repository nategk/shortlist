"""Download a remote listing photo to photos/<id>.<ext> so the gallery no
longer depends on the source site's URL. Facebook CDN URLs in particular
carry a signed, time-limited token (the oe= param) that expires a while
after it's copied, so caching immediately at add-time is the only fix."""
import urllib.request

from project_dir import PROJECT_DIR

PHOTOS_DIR = PROJECT_DIR / "photos"


def cache_photo(url, listing_id):
    """Returns the relative local path on success, or None on failure/empty url."""
    if not url or not url.startswith("http"):
        return url or ""

    ext = ".jpg"
    path_part = url.split("?")[0].lower()
    for candidate in (".png", ".webp", ".jpeg", ".jpg"):
        if path_part.endswith(candidate):
            ext = candidate
            break

    PHOTOS_DIR.mkdir(exist_ok=True)
    dest = PHOTOS_DIR / f"{listing_id}{ext}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
        dest.write_bytes(data)
        return f"photos/{dest.name}"
    except Exception as e:
        print(f"WARNING: could not cache photo for id {listing_id}: {e}")
        return None
