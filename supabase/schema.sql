-- ============================================================
-- Daequip Configurator — Supabase Schema
-- Run this once in the Supabase SQL editor.
-- ============================================================

-- ── Categories table (mirrors data/categories.json) ──────────
create table if not exists categories (
  id          text        primary key,
  label       text        not null,
  icon        text,
  file        text,                         -- kept for reference / GitHub fallback path
  sort_order  integer     default 0,
  updated_at  timestamptz default now()
);

-- ── Category data table (one row per workspace, full JSON blob) ──
create table if not exists category_data (
  id          text        primary key,      -- matches categories.id
  data        jsonb       not null,
  updated_at  timestamptz default now()
);

-- ── Row-Level Security ────────────────────────────────────────
alter table categories    enable row level security;
alter table category_data enable row level security;

-- Allow the anon (publishable) key to read and write both tables.
-- The existing PIN-gate in the app is the access control layer.
create policy "anon_select_categories"
  on categories for select to anon using (true);

create policy "anon_insert_categories"
  on categories for insert to anon with check (true);

create policy "anon_update_categories"
  on categories for update to anon using (true) with check (true);

create policy "anon_select_category_data"
  on category_data for select to anon using (true);

create policy "anon_insert_category_data"
  on category_data for insert to anon with check (true);

create policy "anon_update_category_data"
  on category_data for update to anon using (true) with check (true);
