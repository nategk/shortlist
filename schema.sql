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
    variant     TEXT DEFAULT '',
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

-- Singleton row (id always 1) holding this project's identity and config -
-- what you're searching for, where, and the scoring/outreach text that used
-- to live in separate criteria.md / offer_template.md files. Everything for
-- one project lives in this one db file.
CREATE TABLE IF NOT EXISTS project (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    object            TEXT DEFAULT '',  -- what you're searching for, e.g. "carbon gravel bike, 58cm"
    budget            TEXT DEFAULT '',
    search_area       TEXT DEFAULT '',  -- geographic scope, e.g. "Manhattan, 50mi radius"
    ship_to_address   TEXT DEFAULT '',  -- optional; blank if local-pickup-only
    fulfillment       TEXT DEFAULT '',  -- e.g. "local pickup only", "ships nationwide", "either"
    criteria_md       TEXT DEFAULT '',  -- scoring rubric, must-haves, status flow (was criteria.md)
    offer_template_md TEXT DEFAULT '',  -- contact/offer message (was offer_template.md)
    created_date      TEXT NOT NULL
);
