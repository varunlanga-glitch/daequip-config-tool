/* ============================================================
   SUPABASE.JS — Supabase REST client (no npm required)
   ============================================================
   Provides read/write access to two tables:
     • categories    — workspace list (mirrors data/categories.json)
     • category_data — per-workspace JSON blob

   All functions are async and throw on hard errors.
   Callers should catch and fall back to GitHub/static files.
   ============================================================ */

'use strict';

const _SB_URL = 'https://cduivsioupjytthaosgx.supabase.co';
const _SB_KEY = 'sb_publishable_NONIyKO7mTs535VewUwk8Q_TBEV0bxd';

function _sbHeaders(extra) {
  return Object.assign({
    'apikey':        _SB_KEY,
    'Authorization': 'Bearer ' + _SB_KEY,
    'Content-Type':  'application/json'
  }, extra || {});
}

async function _sbFetch(path, opts) {
  opts = opts || {};
  const r = await fetch(_SB_URL + '/rest/v1' + path, {
    method:  opts.method  || 'GET',
    headers: _sbHeaders(opts.headers || {}),
    body:    opts.body    || undefined
  });
  if (r.status === 204) return null;
  const text = await r.text();
  if (!r.ok) {
    let msg = 'Supabase ' + r.status;
    try { msg = JSON.parse(text).message || msg; } catch(_) {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

/* ── Categories ─────────────────────────────────────────────── */

/**
 * Load all categories sorted by sort_order.
 * Returns null if the table is empty (first run).
 */
async function sbLoadCategories() {
  const rows = await _sbFetch('/categories?order=sort_order');
  if (!rows || !rows.length) return null;
  return rows.map(r => ({ id: r.id, label: r.label, file: r.file, icon: r.icon }));
}

/**
 * Upsert the full categories array to Supabase.
 * @param {Array} categories  — window._categories
 */
async function sbSaveCategories(categories) {
  const rows = categories.map(function(c, i) {
    return {
      id:         c.id,
      label:      c.label,
      icon:       c.icon || '📁',
      file:       c.file,
      sort_order: i,
      updated_at: new Date().toISOString()
    };
  });
  await _sbFetch('/categories?on_conflict=id', {
    method:  'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body:    JSON.stringify(rows)
  });
}

/* ── Category data ───────────────────────────────────────────── */

/**
 * Load the JSON blob for a single category.
 * Returns null if no row exists yet for this category.
 * @param {string} catId
 */
async function sbLoadCategoryData(catId) {
  const rows = await _sbFetch('/category_data?id=eq.' + encodeURIComponent(catId));
  if (!rows || !rows.length) return null;
  return rows[0].data;
}

/**
 * Upsert the full State blob for a category.
 * The `dirty` flag is stripped before saving.
 * @param {string} catId
 * @param {object} stateObj  — current State
 */
async function sbSaveCategoryData(catId, stateObj) {
  const saveState = Object.assign({}, stateObj);
  delete saveState.dirty;
  await _sbFetch('/category_data?on_conflict=id', {
    method:  'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body:    JSON.stringify({
      id:         catId,
      data:       saveState,
      updated_at: new Date().toISOString()
    })
  });
}
