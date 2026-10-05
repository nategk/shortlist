// Postgres connection + schema. Works with Neon (Vercel's Postgres), or any
// Postgres via DATABASE_URL. The schema is created on first use, so a fresh
// deploy needs no migration step.
import pg from "pg";

// Vercel's storage integrations let you pick a prefix when connecting
// (e.g. STORAGE_DATABASE_URL), so accept any *DATABASE_URL / *POSTGRES_URL,
// preferring the pooled URL.
export function findEnv(pattern, avoid = /UNPOOLED|NON_POOLING/) {
  const keys = Object.keys(process.env).filter(k => pattern.test(k) && process.env[k]);
  keys.sort((a, b) => (avoid.test(a) - avoid.test(b)) || a.length - b.length);
  return keys[0] ? process.env[keys[0]] : "";
}

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || findEnv(/(DATABASE_URL|POSTGRES_URL)$/);
}

export function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || findEnv(/READ_WRITE_TOKEN$/);
}

let pool = null;
export function db() {
  if (!pool) {
    const url = databaseUrl();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // One connection per function instance; Neon's pooled URL handles fan-out.
    pool = new pg.Pool({ connectionString: url, max: 1, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export const SCHEMA = `
create table if not exists searches (
  id text primary key,
  name text not null,
  looking_for text not null default '',
  budget text not null default '',
  area text not null default '',
  timing text not null default '',
  state text not null default 'Active',
  criteria text not null default '',
  contact_template text not null default '',
  statuses jsonb not null default '[]',   -- [{label, group}]
  metrics jsonb not null default '[]',    -- [{field, label, unit, good, ok}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists listings (
  id text primary key,
  search_id text references searches(id) on delete cascade,
  title text not null default '',
  price numeric,
  score integer,
  status text not null default '',
  notes text not null default '',
  url text not null default '',
  location text not null default '',
  description text not null default '',
  summary text not null default '',
  source text not null default '',
  photos jsonb not null default '[]',     -- [{id, url, original}]
  fields jsonb not null default '{}',     -- search-specific values (card metrics etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_search_idx on listings(search_id);
create table if not exists sources (
  id text primary key,
  search_id text references searches(id) on delete cascade,
  name text not null default '',
  access text not null default '',
  links jsonb not null default '[]',      -- [{label, url}]
  method text not null default '',
  last_checked text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);
-- Crawling (added after the first release; ADD COLUMN IF NOT EXISTS keeps
-- older databases upgrading in place).
alter table sources add column if not exists crawler text not null default '';        -- lib/crawlers/<name>.js
alter table sources add column if not exists config jsonb not null default '{}';      -- crawler settings
alter table sources add column if not exists seen jsonb not null default '[]';        -- item ids already looked at
alter table sources add column if not exists last_run_at timestamptz;
alter table sources add column if not exists last_status text not null default '';   -- ok | blocked | error
alter table sources add column if not exists last_result text not null default '';
alter table searches add column if not exists last_crawl_at timestamptz;
-- Features that matter (e.g. amenities): [{label, points}] on the search,
-- and the labels a listing has.
alter table searches add column if not exists features jsonb not null default '[]';
alter table listings add column if not exists features jsonb not null default '[]';
-- Airtable sync (lib/sync.js): the paired Airtable record, and the last
-- value per Airtable field that both sides agreed on (the merge base).
alter table searches add column if not exists airtable_id text;
alter table searches add column if not exists sync_base jsonb not null default '{}';
alter table sources add column if not exists airtable_id text;
alter table sources add column if not exists sync_base jsonb not null default '{}';
alter table sources add column if not exists created_at timestamptz not null default now();
alter table listings add column if not exists airtable_id text;
alter table listings add column if not exists sync_base jsonb not null default '{}';
create unique index if not exists searches_airtable_idx on searches(airtable_id);
create unique index if not exists sources_airtable_idx on sources(airtable_id);
create unique index if not exists listings_airtable_idx on listings(airtable_id);
-- Your own order among shortlisted / in-progress listings: 1, 2, 3...;
-- null = unranked.
alter table listings add column if not exists rank integer;
-- When a crawl last checked the listing's post is still up (lib/crawl.js).
alter table listings add column if not exists checked_at timestamptz;
-- Where things get picked up or delivered to (lib/geo.js), and the board a
-- search belongs to: searches sharing a collection are one board, one tab
-- per search, and share the home location.
alter table searches add column if not exists home text not null default '';
alter table searches add column if not exists home_geo jsonb;
alter table searches add column if not exists collection text not null default '';
-- Geocoder answers, so a neighborhood or address is looked up once.
create table if not exists geo_cache (
  q text primary key,
  result jsonb,
  created_at timestamptz not null default now()
);
create table if not exists sync_state (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
`;

let ready = null;
export function ensureSchema() {
  if (!ready) ready = db().query(SCHEMA).catch(e => { ready = null; throw e; });
  return ready;
}
