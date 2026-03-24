/* ============================================================
   SUPABASE.JS — Supabase REST client (no npm required)
   ============================================================
   Talks to a normalized Supabase schema via three RPC functions:
     • load_workspace    — returns full workspace state as JSON
     • save_workspace    — distributes state across 15 tables
     • save_categories   — upserts workspace metadata

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
  var r = await fetch(_SB_URL + '/rest/v1' + path, {
    method:  opts.method  || 'GET',
    headers: _sbHeaders(opts.headers || {}),
    body:    opts.body    || undefined
  });
  if (r.status === 204) return null;
  var text = await r.text();
  if (!r.ok) {
    var msg = 'Supabase ' + r.status;
    try { msg = JSON.parse(text).message || msg; } catch(_) {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

/* ── Categories (workspace list) ─────────────────────────────── */

/**
 * Load all workspaces sorted by sort_order.
 * Returns null if the table is empty (first run).
 */
async function sbLoadCategories() {
  var rows = await _sbFetch('/workspaces?select=id,label,icon,file&order=sort_order');
  if (!rows || !rows.length) return null;
  return rows;
}

/**
 * Upsert workspace metadata and remove deleted entries.
 * Uses the save_categories RPC to preserve UI state columns.
 * @param {Array} categories  — window._categories
 */
async function sbSaveCategories(categories) {
  await _sbFetch('/rpc/save_categories', {
    method: 'POST',
    body:   JSON.stringify({ p_categories: categories })
  });
}

/* ── Category data (full workspace state) ────────────────────── */

/**
 * Load a workspace by calling the load_workspace RPC.
 * Returns the full State object or null if the workspace has no data.
 * @param {string} catId
 */
async function sbLoadCategoryData(catId) {
  var result = await _sbFetch('/rpc/load_workspace', {
    method: 'POST',
    body:   JSON.stringify({ p_workspace_id: catId })
  });
  return result;
}

/**
 * Save the full State blob by calling the save_workspace RPC.
 * The function distributes the data across all normalized tables.
 * @param {string} catId
 * @param {object} stateObj  — current State
 */
async function sbSaveCategoryData(catId, stateObj) {
  var saveState = Object.assign({}, stateObj);
  delete saveState.dirty;
  await _sbFetch('/rpc/save_workspace', {
    method: 'POST',
    body:   JSON.stringify({ p_workspace_id: catId, p_state: saveState })
  });
}
