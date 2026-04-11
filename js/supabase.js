/* ============================================================
   SUPABASE.JS — Supabase REST client (no npm required)
   ============================================================
   Talks to a normalized Supabase schema via RPCs:
     • load_workspace    — returns full workspace state as JSON
     • save_workspace    — distributes state across 15 tables
     • save_categories   — upserts workspace metadata
     • create_version    — snapshots state into version history
     • list_versions     — returns version history metadata (+ pinned)
     • get_version       — returns a single version snapshot
     • restore_version   — restores a snapshot into live tables
     • pin_version       — pins/unpins a version from pruning

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
 * Distributes data across all normalized tables and creates a version snapshot.
 * @param {string} catId
 * @param {object} stateObj      — current State
 * @param {string} [message]     — commit message recorded in the version
 * @param {string} [committedBy] — author label
 */
async function sbSaveCategoryData(catId, stateObj, message, committedBy) {
  var saveState = Object.assign({}, stateObj);
  delete saveState.dirty;
  await _sbFetch('/rpc/save_workspace', {
    method: 'POST',
    body:   JSON.stringify({ p_workspace_id: catId, p_state: saveState })
  });
  // Non-fatal: snapshot the save as a version entry
  try {
    await _sbFetch('/rpc/create_version', {
      method: 'POST',
      body:   JSON.stringify({
        p_workspace_id:  catId,
        p_message:       message      || '',
        p_committed_by:  committedBy  || 'anonymous'
      })
    });
  } catch (e) {
    console.warn('sbSaveCategoryData: version snapshot failed (non-fatal)', e);
  }
}

/**
 * Silently persist the current state to Supabase without creating a version.
 * Used by autosave — keeps the DB current without polluting version history.
 * Non-throwing: errors are logged and swallowed.
 * @param {string} catId
 * @param {object} stateObj — current State
 */
async function sbAutoSave(catId, stateObj, onError) {
  if (!catId) return;
  try {
    var saveState = Object.assign({}, stateObj);
    delete saveState.dirty;
    await _sbFetch('/rpc/save_workspace', {
      method: 'POST',
      body:   JSON.stringify({ p_workspace_id: catId, p_state: saveState })
    });
  } catch (e) {
    console.warn('sbAutoSave failed (non-fatal):', e.message);
    if (typeof onError === 'function') onError(e);
  }
}

/* ── Version history ─────────────────────────────────────────── */

/**
 * Returns version history metadata for a workspace (newest first).
 * Each entry: { id, message, committed_by, created_at, pinned }
 * @param {string} catId
 * @param {number} [limit=50]
 */
async function sbListVersions(catId, limit) {
  return await _sbFetch('/rpc/list_versions', {
    method: 'POST',
    body:   JSON.stringify({ p_workspace_id: catId, p_limit: limit || 50 })
  });
}

/**
 * Returns the full State snapshot for a specific version.
 * @param {number} versionId
 */
async function sbGetVersion(versionId) {
  return await _sbFetch('/rpc/get_version', {
    method: 'POST',
    body:   JSON.stringify({ p_version_id: versionId })
  });
}

/**
 * Restores a historical snapshot into the live normalized tables
 * and records the restore as a new version entry.
 * Returns the new version id.
 * @param {number} versionId
 * @param {string} [committedBy]
 */
async function sbRestoreVersion(versionId, committedBy) {
  return await _sbFetch('/rpc/restore_version', {
    method: 'POST',
    body:   JSON.stringify({
      p_version_id:   versionId,
      p_committed_by: committedBy || 'anonymous'
    })
  });
}

/**
 * Pin or unpin a version so it survives automatic pruning.
 * @param {number}  versionId
 * @param {boolean} [pinned=true]
 */
async function sbPinVersion(versionId, pinned) {
  await _sbFetch('/rpc/pin_version', {
    method: 'POST',
    body:   JSON.stringify({
      p_version_id: versionId,
      p_pinned:     pinned !== false
    })
  });
}

/* ── Remote-change watcher ───────────────────────────────────── */

/**
 * Polls the workspace's updated_at every 30 s.
 * Calls onRemoteChange() if the timestamp advances beyond our last known save.
 * Returns a stop() function to cancel polling.
 *
 * @param {string}   catId
 * @param {Function} onRemoteChange  — called with no args when a remote save is detected
 */
function sbWatchWorkspace(catId, onRemoteChange) {
  // Seed with current time so we don't immediately fire on startup
  var lastKnown = new Date().toISOString();
  var stopped   = false;

  async function poll() {
    if (stopped) return;
    try {
      var rows = await _sbFetch(
        '/workspaces?select=updated_at&id=eq.' + encodeURIComponent(catId)
      );
      if (rows && rows[0]) {
        var remote = rows[0].updated_at;
        if (remote > lastKnown) {
          lastKnown = remote;
          onRemoteChange();
        }
      }
    } catch (_) { /* silently ignore network errors */ }
    if (!stopped) setTimeout(poll, 30000);
  }

  // First poll after 30 s so we don't race with the initial load
  setTimeout(poll, 30000);

  return function stop() { stopped = true; };
}
