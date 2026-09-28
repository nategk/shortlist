// Postgres connection + schema. Works with Neon (Vercel's Postgres), or any
// Postgres via DATABASE_URL. The schema is created on first use, so a fresh
// deploy needs no migration step.
import pg from "pg";

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
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
`;

let ready = null;
export function ensureSchema() {
  if (!ready) ready = db().query(SCHEMA).catch(e => { ready = null; throw e; });
  return ready;
}
