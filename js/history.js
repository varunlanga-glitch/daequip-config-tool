/* ============================================================
   HISTORY.JS — Fine-grained change log
   ============================================================
   Provides:
     • getCurrentUser()      — lightweight localStorage identity
     • logChange(...)        — fire-and-forget write to change_log
     • renderChangeLogTab()  — renders the Changes tab inside
                               the existing History modal
   ============================================================ */

'use strict';

/* ── Identity ────────────────────────────────────────────────── */

function getCurrentUser() {
  return localStorage.getItem('daequip_user') || null;
}

function _setCurrentUser(name) {
  if (name && name.trim()) {
    localStorage.setItem('daequip_user', name.trim());
  }
}

/* ── Core log function (fire-and-forget) ─────────────────────── */

function logChange(classId, entityType, partId, partName, propId, propName, oldVal, newVal) {
  const workspaceId = window._activeCategory?.id;
  if (!workspaceId) return;
  if (oldVal === newVal) return;

  const user = getCurrentUser();

  _sbFetch('/rpc/log_change', {
    method: 'POST',
    body: JSON.stringify({
      p_workspace_id:     workspaceId,
      p_product_class_id: classId      || null,
      p_entity_type:      entityType   || 'rule',
      p_part_id:          partId       || null,
      p_part_name:        partName     || null,
      p_property_id:      propId       || null,
      p_property_name:    propName     || null,
      p_old_value:        oldVal != null ? String(oldVal) : null,
      p_new_value:        newVal != null ? String(newVal) : null,
      p_changed_by:       user         || 'anonymous'
    })
  }).catch(e => console.warn('logChange failed (non-fatal):', e.message));
}

/* ── Changes tab renderer ────────────────────────────────────── */

async function renderChangeLogTab(container, catId) {
  container.innerHTML = '<div class="gh-hist-loading">Loading changes…</div>';

  // Identity bar
  const identityBar = document.createElement('div');
  identityBar.className = 'hist-identity-bar';
  const user = getCurrentUser();
  identityBar.innerHTML =
    'Logging as: <strong id="histIdentityName">' +
    escapeHtml(user || '(not set)') +
    '</strong> &nbsp;<button class="btn hist-identity-edit-btn" id="histIdentityEdit">Edit</button>';
  container.innerHTML = '';
  container.appendChild(identityBar);

  document.getElementById('histIdentityEdit').onclick = () => {
    const current = getCurrentUser() || '';
    const name = prompt('Your name (shown in change history):', current);
    if (name !== null) {
      _setCurrentUser(name);
      const nameEl = document.getElementById('histIdentityName');
      if (nameEl) nameEl.textContent = name.trim() || '(not set)';
    }
  };

  const listEl = document.createElement('div');
  listEl.className = 'gh-hist-list';
  listEl.style.cssText = 'flex:1;overflow-y:auto';
  listEl.innerHTML = '<div class="gh-hist-loading">Loading…</div>';
  container.appendChild(listEl);

  try {
    const items = await _sbFetch('/rpc/get_change_log', {
      method: 'POST',
      body: JSON.stringify({ p_workspace_id: catId, p_limit: 200 })
    });

    if (!items || !items.length) {
      listEl.innerHTML =
        '<div class="gh-hist-loading">No changes recorded yet.<br>' +
        'Changes to rules and parts will appear here as you work.</div>';
      return;
    }

    listEl.innerHTML = '';
    let lastDate = null;

    items.forEach(item => {
      const d       = new Date(item.ts);
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

      if (dateStr !== lastDate) {
        const sep = document.createElement('div');
        sep.className   = 'gh-hist-date-group';
        sep.textContent = dateStr;
        listEl.appendChild(sep);
        lastDate = dateStr;
      }

      const row = document.createElement('div');
      row.className = 'gh-hist-row';

      const info = document.createElement('div');
      info.className = 'gh-hist-info';

      // ── Description ──
      const msgSpan = document.createElement('span');
      msgSpan.className = 'gh-hist-msg';

      if (item.entity_type === 'rule') {
        msgSpan.textContent =
          (item.part_name || item.part_id || '?') + ' › ' +
          (item.property_name || item.property_id || '?');
      } else if (item.entity_type === 'file_name_rule') {
        msgSpan.textContent = (item.part_name || item.part_id || '?') + ' › File Name Rule';
      } else if (item.entity_type === 'part_enabled') {
        msgSpan.textContent =
          (item.new_value === 'true' ? 'Enabled' : 'Disabled') + ': ' +
          (item.part_name || item.part_id || '?');
      } else if (item.entity_type === 'part_name') {
        msgSpan.textContent = 'Renamed: ' + (item.old_value || '?') + ' → ' + (item.new_value || '?');
      } else {
        msgSpan.textContent = item.entity_type + (item.part_name ? ' · ' + item.part_name : '');
      }

      // ── Old → new diff (rule changes only) ──
      if ((item.entity_type === 'rule' || item.entity_type === 'file_name_rule') &&
          (item.old_value !== null || item.new_value !== null)) {
        const diff = document.createElement('span');
        diff.className = 'gh-hist-change-diff';
        diff.innerHTML =
          '<span class="diff-old">' + escapeHtml(item.old_value || '(empty)') + '</span>' +
          ' → ' +
          '<span class="diff-new">' + escapeHtml(item.new_value || '(empty)') + '</span>';
        info.appendChild(msgSpan);
        info.appendChild(diff);
      } else {
        info.appendChild(msgSpan);
      }

      // ── Metadata line ──
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const who     = item.changed_by || 'anonymous';
      const cls     = item.product_class_id
        ? (State.productClasses?.find(c => c.id === item.product_class_id)?.name || item.product_class_id)
        : '';

      const metaSpan = document.createElement('span');
      metaSpan.className = 'gh-hist-meta';
      metaSpan.textContent = timeStr + (cls ? ' · ' + cls : '') + ' · ' + who;

      info.appendChild(metaSpan);
      row.appendChild(info);
      listEl.appendChild(row);
    });
  } catch (e) {
    listEl.innerHTML =
      '<div class="gh-hist-loading" style="color:#e74c3c">Error: ' +
      escapeHtml(e.message) + '</div>';
  }
}
