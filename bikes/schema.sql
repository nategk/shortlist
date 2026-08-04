-- Schema for listings.db. Applied once at setup time (see init_db.py);
-- kept here as the readable source of truth for the DB structure.

CREATE TABLE IF NOT EXISTS listings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date_found  TEXT NOT NULL,
    source      TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    photo_url   TEXT DEFAULT '',
    title       TEXT DEFAULT '',
    price       TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    condition   TEXT DEFAULT '',
    size_frame  TEXT DEFAULT '',
    key_specs   TEXT DEFAULT '',
    fit_score   INTEGER,
    status      TEXT NOT NULL DEFAULT 'new',
    notes       TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sources_status (
    source        TEXT PRIMARY KEY,
    automatable   TEXT DEFAULT 'untested',
    last_attempt  TEXT DEFAULT '',
    last_success  TEXT DEFAULT '',
    status        TEXT DEFAULT 'untested',
    method        TEXT DEFAULT '',
    notes         TEXT DEFAULT ''
);
