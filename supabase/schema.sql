-- ============================================================
-- Daequip Configurator — Normalized Supabase Schema
-- Run this in the Supabase SQL editor.
--
-- Replaces the old simple schema (categories + category_data)
-- with 15 normalized tables + 2 RPC functions.
-- ============================================================

-- ── Drop old simple schema ──────────────────────────────────
drop table if exists category_data cascade;
drop table if exists categories cascade;

-- ============================================================
-- TABLES
-- ============================================================

-- 1. WORKSPACES (was "categories")
create table workspaces (
  id                text        primary key,
  label             text        not null,
  icon              text        not null default '📁',
  file              text,                             -- legacy GitHub file path
  sort_order        integer     not null default 0,
  active_class_id   text,                             -- UI state: selected tab
  selected_part_id  text,                             -- UI state: selected part
  active_right_tab  text        not null default 'parts',
  state_version     bigint      not null default 0,   -- bumped on every save; used for optimistic locking
  last_content_hash text,                             -- sha256 of the last saved state; used for version dedup
  updated_at        timestamptz not null default now()
);

-- Additive migration for existing deployments (no-op on fresh installs)
alter table workspaces add column if not exists state_version     bigint not null default 0;
alter table workspaces add column if not exists last_content_hash text;

create index idx_workspaces_sort on workspaces (sort_order);

-- 2. PRODUCT_CLASSES (tabs within a workspace)
create table product_classes (
  id            text        primary key,
  workspace_id  text        not null references workspaces(id) on delete cascade,
  name          text        not null,
  sort_order    integer     not null default 0,
  updated_at    timestamptz not null default now()
);

create index idx_pc_workspace on product_classes (workspace_id, sort_order);

-- 3. MASTER_VARIABLES (variable definitions)
create table master_variables (
  id                bigint      generated always as identity primary key,
  product_class_id  text        not null references product_classes(id) on delete cascade,
  key               text        not null,
  label             text        not null,
  vals              text[]      not null default '{}',
  sort_order        integer     not null default 0,
  unique (product_class_id, key)
);

create index idx_mv_pc on master_variables (product_class_id, sort_order);

-- 4. CONTEXT_VALUES (current selected value per variable)
create table context_values (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  variable_key      text    not null,
  value             text    not null default '',
  primary key (product_class_id, variable_key)
);

-- 5. PARTS (component tree)
create table parts (
  id                text    not null,
  product_class_id  text    not null references product_classes(id) on delete cascade,
  name              text    not null,
  midx              text,
  level             integer not null default 0,
  enabled           boolean not null default true,
  type              text,                             -- 'group' for header rows, NULL for regular parts
  sort_order        integer not null default 0,
  primary key (product_class_id, id)
);

-- 6. PROPERTIES (column definitions)
create table properties (
  id                text    not null,
  product_class_id  text    not null references product_classes(id) on delete cascade,
  name              text    not null,
  sort_order        integer not null default 0,
  primary key (product_class_id, id)
);

-- 7. RULES (template per part x property)
create table rules (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  part_id           text    not null,
  property_id       text    not null,
  template          text    not null default '',
  primary key (product_class_id, part_id, property_id)
);

create index idx_rules_pc on rules (product_class_id);

-- 8. FILE_NAME_RULES (template per part for Inventor export)
create table file_name_rules (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  part_id           text    not null,
  template          text    not null default '',
  primary key (product_class_id, part_id)
);

-- 9. HIDDEN_PROPS (toggled-off columns)
create table hidden_props (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  property_id       text    not null,
  primary key (product_class_id, property_id)
);

-- 10. INVENTOR_MAPS (iProperty mapping, stored as jsonb bag)
create table inventor_maps (
  product_class_id    text    primary key references product_classes(id) on delete cascade,
  file_name_prop_id   text,
  mapping             jsonb   not null default '{}'
);

-- 11. INVENTOR_BASE_FOLDERS
create table inventor_base_folders (
  product_class_id  text    primary key references product_classes(id) on delete cascade,
  folder_path       text    not null default ''
);

-- 12. FILE_NAME_OVERRIDES (manual filename per part)
create table file_name_overrides (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  part_id           text    not null,
  filename          text    not null default '',
  primary key (product_class_id, part_id)
);

-- 13. EXPORT_SELECTIONS (per-part export config, props flags as jsonb)
create table export_selections (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  part_id           text    not null,
  rename            boolean not null default false,
  props             jsonb   not null default '{}',
  primary key (product_class_id, part_id)
);

-- 14. LOCKED_TABS
create table locked_tabs (
  product_class_id  text    primary key references product_classes(id) on delete cascade,
  pin_hash          text    not null
);

-- 15. LOCKED_SECTIONS
create table locked_sections (
  product_class_id  text    not null references product_classes(id) on delete cascade,
  section_name      text    not null,
  pin_hash          text    not null,
  primary key (product_class_id, section_name)
);


-- ============================================================
-- ROW-LEVEL SECURITY
--
-- The app uses the Supabase publishable (anon) key in the browser.
-- To prevent arbitrary CRUD via /rest/v1/<table>, we:
--   1. Enable RLS on every table
--   2. Create NO anon policies → direct table access is denied
--   3. Revoke direct grants from anon
--   4. Allow anon to EXECUTE the RPC functions (grants are at the
--      end of this file, after every RPC is defined).
-- Net: the only way anon can touch data is through a scoped RPC.
-- Every RPC is SECURITY DEFINER so it can read/write internally.
-- ============================================================
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'workspaces','product_classes','master_variables','context_values',
      'parts','properties','rules','file_name_rules','hidden_props',
      'inventor_maps','inventor_base_folders','file_name_overrides',
      'export_selections','locked_tabs','locked_sections'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    -- Drop any legacy wide-open policies that may exist from earlier deploys
    execute format('drop policy if exists "anon_select_%1$s" on %1$I', t);
    execute format('drop policy if exists "anon_insert_%1$s" on %1$I', t);
    execute format('drop policy if exists "anon_update_%1$s" on %1$I', t);
    execute format('drop policy if exists "anon_delete_%1$s" on %1$I', t);
    -- Revoke any direct grants the anon role may have picked up
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;


-- ============================================================
-- AUTO-TOUCH updated_at
-- ============================================================
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_workspaces_updated
  before update on workspaces for each row execute function touch_updated_at();
create trigger trg_product_classes_updated
  before update on product_classes for each row execute function touch_updated_at();


-- ============================================================
-- RPC: load_workspace(p_workspace_id)
-- Returns the full workspace state as a single JSON object
-- matching the exact shape the frontend expects.
-- Returns NULL if the workspace does not exist.
-- ============================================================
create or replace function load_workspace(p_workspace_id text)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case when w.id is null then null else
    jsonb_build_object(
      'activeClassId',  w.active_class_id,
      'selectedPartId', w.selected_part_id,
      'activeRightTab', coalesce(w.active_right_tab, 'parts'),
      'stateVersion',   w.state_version,

      'productClasses', coalesce((
        select jsonb_agg(jsonb_build_object('id', pc.id, 'name', pc.name) order by pc.sort_order)
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '[]'::jsonb),

      'master', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_agg(
            jsonb_build_object('key', mv.key, 'label', mv.label, 'vals', to_jsonb(mv.vals))
            order by mv.sort_order)
          from master_variables mv where mv.product_class_id = pc.id
        ), '[]'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'context', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_object_agg(cv.variable_key, cv.value)
          from context_values cv where cv.product_class_id = pc.id
        ), '{}'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'parts', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'midx', p.midx,
            'level', p.level, 'enabled', p.enabled, 'type', p.type
          ) order by p.sort_order)
          from parts p where p.product_class_id = pc.id
        ), '[]'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'props', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.sort_order)
          from properties pr where pr.product_class_id = pc.id
        ), '[]'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'rules', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_object_agg(sub.part_id, sub.prop_map)
          from (
            select r.part_id, jsonb_object_agg(r.property_id, r.template) as prop_map
            from rules r where r.product_class_id = pc.id
            group by r.part_id
          ) sub
        ), '{}'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'hiddenProps', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_agg(hp.property_id)
          from hidden_props hp where hp.product_class_id = pc.id
        ), '[]'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'fileNameRules', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_object_agg(fnr.part_id, fnr.template)
          from file_name_rules fnr where fnr.product_class_id = pc.id
        ), '{}'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'inventorBaseFolders', coalesce((
        select jsonb_object_agg(ibf.product_class_id, ibf.folder_path)
        from inventor_base_folders ibf
        join product_classes pc on pc.id = ibf.product_class_id
        where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'inventorMaps', coalesce((
        select jsonb_object_agg(im.product_class_id,
          jsonb_build_object('fileNamePropId', im.file_name_prop_id, 'mapping', im.mapping))
        from inventor_maps im
        join product_classes pc on pc.id = im.product_class_id
        where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'fileNameOverrides', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_object_agg(fno.part_id, fno.filename)
          from file_name_overrides fno where fno.product_class_id = pc.id
        ), '{}'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'exportSelections', coalesce((
        select jsonb_object_agg(pc.id, coalesce((
          select jsonb_object_agg(es.part_id,
            jsonb_build_object('rename', es.rename, 'props', es.props))
          from export_selections es where es.product_class_id = pc.id
        ), '{}'::jsonb))
        from product_classes pc where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'lockedTabs', coalesce((
        select jsonb_object_agg(lt.product_class_id, lt.pin_hash)
        from locked_tabs lt
        join product_classes pc on pc.id = lt.product_class_id
        where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb),

      'lockedSections', coalesce((
        select jsonb_object_agg(
          ls.product_class_id || ':' || ls.section_name, ls.pin_hash)
        from locked_sections ls
        join product_classes pc on pc.id = ls.product_class_id
        where pc.workspace_id = p_workspace_id
      ), '{}'::jsonb)
    )
  end
  from (select 1) _
  left join workspaces w on w.id = p_workspace_id;
$$;


-- ============================================================
-- RPC: save_workspace(p_workspace_id, p_state, p_expected_version)
-- Accepts the full State JSON blob and distributes it across
-- all normalized tables in a single transaction.
--
-- Optimistic locking: when p_expected_version is provided and not
-- null, the current state_version must match or the save raises
-- 'workspace_version_conflict'. Pass null to bypass (used by first
-- save and by the legacy two-arg signature below).
--
-- Returns the new state_version after the save.
-- ============================================================
create or replace function save_workspace(
  p_workspace_id     text,
  p_state            jsonb,
  p_expected_version bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pc            jsonb;
  pc_id         text;
  pc_idx        int;
  arr_item      jsonb;
  arr_idx       int;
  rec           record;
  inner_rec     record;
  current_ver   bigint;
  new_ver       bigint;
begin
  -- Optimistic-lock check: if the caller supplied the version they last read,
  -- make sure nobody else has saved in between.
  if p_expected_version is not null then
    select state_version into current_ver
      from workspaces where id = p_workspace_id for update;
    if current_ver is not null and current_ver <> p_expected_version then
      raise exception 'workspace_version_conflict'
        using errcode = 'P0001',
              detail  = format('expected=%s, current=%s', p_expected_version, current_ver);
    end if;
  end if;

  -- Upsert the workspace row (preserve label/icon if already set)
  insert into workspaces (id, label, active_class_id, selected_part_id, active_right_tab, state_version)
  values (
    p_workspace_id,
    p_workspace_id,                                    -- placeholder label
    p_state->>'activeClassId',
    p_state->>'selectedPartId',
    coalesce(p_state->>'activeRightTab', 'parts'),
    1
  )
  on conflict (id) do update set
    active_class_id  = excluded.active_class_id,
    selected_part_id = excluded.selected_part_id,
    active_right_tab = excluded.active_right_tab,
    state_version    = workspaces.state_version + 1,
    updated_at       = now()
  returning state_version into new_ver;

  -- Wipe all product classes for this workspace (CASCADE clears everything)
  delete from product_classes where workspace_id = p_workspace_id;

  -- Iterate over each product class in the state
  pc_idx := 0;
  for pc in select value from jsonb_array_elements(
              coalesce(p_state->'productClasses', '[]'::jsonb))
  loop
    pc_id := pc->>'id';

    insert into product_classes (id, workspace_id, name, sort_order)
    values (pc_id, p_workspace_id, pc->>'name', pc_idx);
    pc_idx := pc_idx + 1;

    -- ── Master variables ──
    arr_idx := 0;
    for arr_item in select value from jsonb_array_elements(
                      coalesce(p_state->'master'->pc_id, '[]'::jsonb))
    loop
      insert into master_variables (product_class_id, key, label, vals, sort_order)
      values (
        pc_id,
        arr_item->>'key',
        arr_item->>'label',
        array(select jsonb_array_elements_text(coalesce(arr_item->'vals', '[]'::jsonb))),
        arr_idx
      );
      arr_idx := arr_idx + 1;
    end loop;

    -- ── Context values ──
    for rec in select * from jsonb_each_text(
                 coalesce(p_state->'context'->pc_id, '{}'::jsonb))
    loop
      insert into context_values (product_class_id, variable_key, value)
      values (pc_id, rec.key, rec.value);
    end loop;

    -- ── Parts ──
    arr_idx := 0;
    for arr_item in select value from jsonb_array_elements(
                      coalesce(p_state->'parts'->pc_id, '[]'::jsonb))
    loop
      insert into parts (id, product_class_id, name, midx, level, enabled, type, sort_order)
      values (
        arr_item->>'id', pc_id, arr_item->>'name', arr_item->>'midx',
        coalesce((arr_item->>'level')::int, 0),
        coalesce((arr_item->>'enabled')::bool, true),
        nullif(arr_item->>'type', ''),
        arr_idx
      );
      arr_idx := arr_idx + 1;
    end loop;

    -- ── Properties ──
    arr_idx := 0;
    for arr_item in select value from jsonb_array_elements(
                      coalesce(p_state->'props'->pc_id, '[]'::jsonb))
    loop
      insert into properties (id, product_class_id, name, sort_order)
      values (arr_item->>'id', pc_id, arr_item->>'name', arr_idx);
      arr_idx := arr_idx + 1;
    end loop;

    -- ── Rules: { partId: { propId: template } } ──
    for rec in select * from jsonb_each(
                 coalesce(p_state->'rules'->pc_id, '{}'::jsonb))
    loop
      -- rec.key = partId, rec.value = { propId: template }
      for inner_rec in select * from jsonb_each_text(rec.value)
      loop
        insert into rules (product_class_id, part_id, property_id, template)
        values (pc_id, rec.key, inner_rec.key, inner_rec.value);
      end loop;
    end loop;

    -- ── File name rules: { partId: template } ──
    for rec in select * from jsonb_each_text(
                 coalesce(p_state->'fileNameRules'->pc_id, '{}'::jsonb))
    loop
      insert into file_name_rules (product_class_id, part_id, template)
      values (pc_id, rec.key, rec.value);
    end loop;

    -- ── Hidden props: [ propId, ... ] ──
    for rec in select value from jsonb_array_elements_text(
                 coalesce(p_state->'hiddenProps'->pc_id, '[]'::jsonb))
    loop
      insert into hidden_props (product_class_id, property_id)
      values (pc_id, rec.value);
    end loop;

    -- ── Inventor maps: { fileNamePropId, mapping } ──
    if p_state->'inventorMaps'->pc_id is not null
       and jsonb_typeof(p_state->'inventorMaps'->pc_id) = 'object'
       and p_state->'inventorMaps'->pc_id != '{}'::jsonb
    then
      insert into inventor_maps (product_class_id, file_name_prop_id, mapping)
      values (
        pc_id,
        p_state->'inventorMaps'->pc_id->>'fileNamePropId',
        coalesce(p_state->'inventorMaps'->pc_id->'mapping', '{}'::jsonb)
      );
    end if;

    -- ── Inventor base folders ──
    if p_state->'inventorBaseFolders'->>pc_id is not null then
      insert into inventor_base_folders (product_class_id, folder_path)
      values (pc_id, p_state->'inventorBaseFolders'->>pc_id);
    end if;

    -- ── File name overrides: { partId: filename } ──
    for rec in select * from jsonb_each_text(
                 coalesce(p_state->'fileNameOverrides'->pc_id, '{}'::jsonb))
    loop
      insert into file_name_overrides (product_class_id, part_id, filename)
      values (pc_id, rec.key, rec.value);
    end loop;

    -- ── Export selections: { partId: { rename, props } } ──
    for rec in select * from jsonb_each(
                 coalesce(p_state->'exportSelections'->pc_id, '{}'::jsonb))
    loop
      insert into export_selections (product_class_id, part_id, rename, props)
      values (
        pc_id, rec.key,
        coalesce((rec.value->>'rename')::bool, false),
        coalesce(rec.value->'props', '{}'::jsonb)
      );
    end loop;

    -- ── Locked tabs ──
    if p_state->'lockedTabs'->>pc_id is not null then
      insert into locked_tabs (product_class_id, pin_hash)
      values (pc_id, p_state->'lockedTabs'->>pc_id);
    end if;

  end loop;  -- product classes

  -- ── Locked sections: { "pcId:sectionName": pinHash } ──
  for rec in select * from jsonb_each_text(
               coalesce(p_state->'lockedSections', '{}'::jsonb))
  loop
    if position(':' in rec.key) > 0 then
      insert into locked_sections (product_class_id, section_name, pin_hash)
      values (split_part(rec.key, ':', 1), substring(rec.key from position(':' in rec.key) + 1), rec.value)
      on conflict do nothing;
    end if;
  end loop;

  return new_ver;
end;
$$;


-- ============================================================
-- RPC: save_categories(p_categories)
-- Upserts workspace rows from the categories list and removes
-- any workspaces not in the new list. Only updates metadata
-- columns (label, icon, file, sort_order) — preserves UI state.
-- ============================================================
create or replace function save_categories(p_categories jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cat     jsonb;
  cat_idx int;
  cat_ids text[] := '{}';
begin
  cat_idx := 0;
  for cat in select value from jsonb_array_elements(p_categories)
  loop
    cat_ids := cat_ids || (cat->>'id');

    insert into workspaces (id, label, icon, file, sort_order)
    values (
      cat->>'id',
      cat->>'label',
      coalesce(cat->>'icon', '📁'),
      cat->>'file',
      cat_idx
    )
    on conflict (id) do update set
      label      = excluded.label,
      icon       = excluded.icon,
      file       = excluded.file,
      sort_order = excluded.sort_order,
      updated_at = now();

    cat_idx := cat_idx + 1;
  end loop;

  -- Remove workspaces not in the new list (cascade-deletes all child data)
  if array_length(cat_ids, 1) > 0 then
    delete from workspaces where id != all(cat_ids);
  end if;
end;
$$;


-- ============================================================
-- RPC: get_completeness_report(p_workspace_id)
-- Returns parts missing at least one rule. Excludes group/header
-- rows (type = 'group') and disabled parts.
-- Returns: [ { class_id, class_name, part_id, part_name,
--              missing_props text[] } ]
-- ============================================================
create or replace function get_completeness_report(p_workspace_id text)
returns table (
  class_id      text,
  class_name    text,
  part_id       text,
  part_name     text,
  missing_props text[]
)
language sql stable
security definer
set search_path = public
as $$
  select
    pc.id                                        as class_id,
    pc.name                                      as class_name,
    p.id                                         as part_id,
    p.name                                       as part_name,
    array_agg(pr.name order by pr.sort_order)    as missing_props
  from product_classes pc
  join parts       p  on p.product_class_id  = pc.id
  join properties  pr on pr.product_class_id = pc.id
  left join rules  r  on  r.product_class_id = pc.id
                      and r.part_id          = p.id
                      and r.property_id      = pr.id
  where pc.workspace_id      = p_workspace_id
    and p.enabled            = true
    and p.type is distinct from 'group'
    and (r.template is null or r.template = '')
  group by pc.id, pc.name, p.id, p.name, p.sort_order
  order by pc.id, p.sort_order;
$$;


-- ============================================================
-- RPC: get_stale_variables(p_workspace_id)
-- Returns master variables never referenced in any rule formula
-- or file name template within the workspace.
-- Returns: [ { class_id, class_name, key, label, vals } ]
-- ============================================================
create or replace function get_stale_variables(p_workspace_id text)
returns table (
  class_id   text,
  class_name text,
  key        text,
  label      text,
  vals       text[]
)
language sql stable
security definer
set search_path = public
as $$
  select
    pc.id    as class_id,
    pc.name  as class_name,
    mv.key,
    mv.label,
    mv.vals
  from product_classes  pc
  join master_variables mv on mv.product_class_id = pc.id
  where pc.workspace_id = p_workspace_id
    and not exists (
      select 1 from rules r
      where r.product_class_id = pc.id
        and r.template like '%' || mv.key || '%'
    )
    and not exists (
      select 1 from file_name_rules fnr
      where fnr.product_class_id = pc.id
        and fnr.template like '%' || mv.key || '%'
    )
  order by pc.id, mv.sort_order;
$$;


-- ============================================================
-- VERSION HISTORY
-- Snapshots of save_workspace payloads, used by the History modal.
-- ============================================================
create table if not exists workspace_versions (
  id            bigint      generated always as identity primary key,
  workspace_id  text        not null references workspaces(id) on delete cascade,
  snapshot      jsonb       not null,
  content_hash  text,                                -- sha256 of snapshot; used for dedup
  message       text        not null default '',
  committed_by  text        not null default 'anonymous',
  pinned        boolean     not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_wv_workspace_time on workspace_versions (workspace_id, created_at desc);

alter table workspace_versions enable row level security;
revoke all on workspace_versions from anon;

-- ============================================================
-- RPC: create_version(p_workspace_id, p_message, p_committed_by)
-- Snapshots the current workspace state into workspace_versions.
-- Skips the write when the state hasn't changed since the last
-- snapshot (content-hash dedup). Returns the new version id, or
-- NULL if the snapshot was deduped.
-- ============================================================
create or replace function create_version(
  p_workspace_id  text,
  p_message       text default '',
  p_committed_by  text default 'anonymous'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  snap      jsonb;
  hash_hex  text;
  last_hash text;
  new_id    bigint;
begin
  snap := load_workspace(p_workspace_id);
  if snap is null then
    return null;
  end if;

  hash_hex := encode(digest(snap::text, 'sha256'), 'hex');

  select last_content_hash into last_hash
    from workspaces where id = p_workspace_id;

  if last_hash is not null and last_hash = hash_hex then
    return null;                                         -- no change → skip
  end if;

  insert into workspace_versions (workspace_id, snapshot, content_hash, message, committed_by)
  values (p_workspace_id, snap, hash_hex, coalesce(p_message, ''), coalesce(p_committed_by, 'anonymous'))
  returning id into new_id;

  update workspaces set last_content_hash = hash_hex where id = p_workspace_id;

  return new_id;
end;
$$;

-- ============================================================
-- RPC: list_versions(p_workspace_id, p_limit, p_offset)
-- Returns recent version metadata newest-first with pagination support.
-- ============================================================
create or replace function list_versions(
  p_workspace_id text,
  p_limit        int default 50,
  p_offset       int default 0
)
returns table (
  id            bigint,
  message       text,
  committed_by  text,
  created_at    timestamptz,
  pinned        boolean
)
language sql stable
security definer
set search_path = public
as $$
  select id, message, committed_by, created_at, pinned
    from workspace_versions
   where workspace_id = p_workspace_id
   order by created_at desc
   limit  greatest(coalesce(p_limit, 50), 1)
   offset greatest(coalesce(p_offset, 0),  0);
$$;

-- ============================================================
-- RPC: get_version(p_version_id)
-- Returns the full snapshot for a single version.
-- ============================================================
create or replace function get_version(p_version_id bigint)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select snapshot from workspace_versions where id = p_version_id;
$$;

-- ============================================================
-- RPC: restore_version(p_version_id, p_committed_by)
-- Restores a historical snapshot into the live tables and records
-- the restore as a new version entry. Returns the new version id.
-- ============================================================
create or replace function restore_version(p_version_id bigint, p_committed_by text default 'anonymous')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id  text;
  snap   jsonb;
begin
  select workspace_id, snapshot into ws_id, snap
    from workspace_versions where id = p_version_id;
  if ws_id is null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  -- Bypass optimistic locking on restore (admin action)
  perform save_workspace(ws_id, snap, null);

  return create_version(ws_id, 'Restored from version ' || p_version_id, p_committed_by);
end;
$$;

-- ============================================================
-- RPC: pin_version(p_version_id, p_pinned)
-- Pins/unpins a version so pruning leaves it alone.
-- ============================================================
create or replace function pin_version(p_version_id bigint, p_pinned boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  update workspace_versions set pinned = p_pinned where id = p_version_id;
$$;

-- ============================================================
-- RPC: sb_list_categories()
-- Replaces the anon /workspaces?select=… direct SELECT that the
-- frontend used before RLS was tightened.
-- ============================================================
create or replace function sb_list_categories()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', w.id, 'label', w.label, 'icon', w.icon,
      'file', w.file, 'updated_at', w.updated_at
    ) order by w.sort_order),
    '[]'::jsonb
  )
  from workspaces w;
$$;

-- ============================================================
-- RPC: sb_workspace_updated_at(p_workspace_id)
-- Replaces the anon /workspaces?select=updated_at&id=eq direct
-- SELECT used by the remote-change poller.
-- ============================================================
create or replace function sb_workspace_updated_at(p_workspace_id text)
returns timestamptz
language sql stable
security definer
set search_path = public
as $$
  select updated_at from workspaces where id = p_workspace_id;
$$;

-- ============================================================
-- GRANTS — must come last so every function already exists.
-- ============================================================
revoke all on function load_workspace(text)                     from public;
revoke all on function save_workspace(text, jsonb, bigint)      from public;
revoke all on function save_categories(jsonb)                   from public;
revoke all on function get_completeness_report(text)            from public;
revoke all on function get_stale_variables(text)                from public;
revoke all on function create_version(text, text, text)         from public;
revoke all on function list_versions(text, int, int)            from public;
revoke all on function get_version(bigint)                      from public;
revoke all on function restore_version(bigint, text)            from public;
revoke all on function pin_version(bigint, boolean)             from public;
revoke all on function sb_list_categories()                     from public;
revoke all on function sb_workspace_updated_at(text)            from public;

grant execute on function load_workspace(text)                  to anon;
grant execute on function save_workspace(text, jsonb, bigint)   to anon;
grant execute on function save_categories(jsonb)                to anon;
grant execute on function get_completeness_report(text)         to anon;
grant execute on function get_stale_variables(text)             to anon;
grant execute on function create_version(text, text, text)      to anon;
grant execute on function list_versions(text, int, int)         to anon;
grant execute on function get_version(bigint)                   to anon;
grant execute on function restore_version(bigint, text)         to anon;
grant execute on function pin_version(bigint, boolean)          to anon;
grant execute on function sb_list_categories()                  to anon;
grant execute on function sb_workspace_updated_at(text)         to anon;
