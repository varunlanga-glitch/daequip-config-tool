/* ============================================================
   AUDIT.JS — Configuration health reports
   ============================================================
   Two reports, both powered by Supabase RPCs:

   1. Completeness  — parts that are missing at least one rule,
                      grouped by product class.
   2. Stale vars    — master variables whose key never appears
                      in any rule or file-name-rule template.
   ============================================================ */

'use strict';

/* ── Entry point ─────────────────────────────────────────────── */
async function openAuditModal() {
  if (!window._activeCategory) return;
  const catId = window._activeCategory.id;

  // Build shell immediately so the user sees the modal open
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:2000';
  overlay.innerHTML = `
    <div class="confirm-box gh-modal gh-history-box audit-modal">
      <div class="confirm-title">
        ⚠ Config Health — ${escapeHtml(window._activeCategory.label)}
      </div>
      <div class="audit-tabs">
        <button class="audit-tab audit-tab-active" id="auditTabComplete">
          Completeness
        </button>
        <button class="audit-tab" id="auditTabStale">
          Stale Variables
        </button>
      </div>
      <div id="auditBody" class="audit-body">
        <div class="gh-hist-loading">Loading…</div>
      </div>
      <div class="confirm-buttons" style="border-top:1px solid var(--stroke)">
        <button class="btn btn-cancel" id="auditClose">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#auditClose').onclick = () => overlay.remove();

  // Fetch both reports in parallel
  let completeness, staleVars;
  try {
    [completeness, staleVars] = await Promise.all([
      _sbFetch('/rpc/get_completeness_report', {
        method: 'POST',
        body: JSON.stringify({ p_workspace_id: catId })
      }),
      _sbFetch('/rpc/get_stale_variables', {
        method: 'POST',
        body: JSON.stringify({ p_workspace_id: catId })
      })
    ]);
  } catch (e) {
    overlay.querySelector('#auditBody').innerHTML =
      '<div class="gh-hist-loading" style="color:#e74c3c">Failed to load: ' +
      escapeHtml(e.message) + '</div>';
    return;
  }

  // Update badge counts on tabs
  const cCount = (completeness || []).length;
  const sCount = (staleVars   || []).length;
  overlay.querySelector('#auditTabComplete').textContent =
    'Completeness' + (cCount ? ' (' + cCount + ')' : '');
  overlay.querySelector('#auditTabStale').textContent =
    'Stale Variables' + (sCount ? ' (' + sCount + ')' : '');

  // Tab switching
  let activePanel = 'complete';
  const body = overlay.querySelector('#auditBody');

  const renderComplete = () => _renderCompleteness(body, completeness, overlay);
  const renderStale    = () => _renderStaleVars(body, staleVars, overlay, catId);

  overlay.querySelector('#auditTabComplete').onclick = () => {
    activePanel = 'complete';
    overlay.querySelector('#auditTabComplete').classList.add('audit-tab-active');
    overlay.querySelector('#auditTabStale').classList.remove('audit-tab-active');
    renderComplete();
  };
  overlay.querySelector('#auditTabStale').onclick = () => {
    activePanel = 'stale';
    overlay.querySelector('#auditTabStale').classList.add('audit-tab-active');
    overlay.querySelector('#auditTabComplete').classList.remove('audit-tab-active');
    renderStale();
  };

  renderComplete();
}

/* ── Completeness panel ──────────────────────────────────────── */
function _renderCompleteness(body, items, overlay) {
  body.innerHTML = '';

  if (!items || !items.length) {
    body.innerHTML = '<div class="audit-empty">✅ All enabled parts have complete rule coverage.</div>';
    return;
  }

  // Group by class
  const byClass = {};
  items.forEach(item => {
    if (!byClass[item.class_id]) byClass[item.class_id] = { name: item.class_name, items: [] };
    byClass[item.class_id].items.push(item);
  });

  Object.values(byClass).forEach(group => {
    const section = document.createElement('div');
    section.className = 'audit-section';

    const heading = document.createElement('div');
    heading.className = 'audit-section-heading';
    heading.textContent = group.name + ' — ' + group.items.length +
      ' part' + (group.items.length !== 1 ? 's' : '') + ' incomplete';
    section.appendChild(heading);

    group.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'audit-row';

      const left = document.createElement('div');
      left.className = 'audit-row-left';

      const name = document.createElement('span');
      name.className = 'audit-row-name';
      name.textContent = item.part_name;
      left.appendChild(name);

      const pills = document.createElement('span');
      pills.className = 'audit-row-pills';
      (item.missing_props || []).forEach(prop => {
        const pill = document.createElement('span');
        pill.className = 'audit-pill';
        pill.textContent = prop;
        pills.appendChild(pill);
      });
      left.appendChild(pills);

      const jumpBtn = document.createElement('button');
      jumpBtn.className = 'btn audit-jump-btn';
      jumpBtn.textContent = '→ Jump';
      jumpBtn.title = 'Navigate to this part in the grid';
      jumpBtn.onclick = () => {
        overlay.remove();
        // Switch to the right product class and select the part
        State.activeClassId  = item.class_id;
        State.selectedPartId = item.part_id;
        renderAll();
      };

      row.appendChild(left);
      row.appendChild(jumpBtn);
      section.appendChild(row);
    });

    body.appendChild(section);
  });
}

/* ── Stale variables panel ───────────────────────────────────── */
function _renderStaleVars(body, items, overlay, catId) {
  body.innerHTML = '';

  if (!items || !items.length) {
    body.innerHTML = '<div class="audit-empty">✅ All master variables are referenced in at least one rule.</div>';
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'audit-intro';
  intro.textContent =
    'These variables exist in the master filter list but are never referenced ' +
    'in any rule formula or file name template. They may be leftovers from earlier work.';
  body.appendChild(intro);

  // Group by class
  const byClass = {};
  items.forEach(item => {
    if (!byClass[item.class_id]) byClass[item.class_id] = { name: item.class_name, items: [] };
    byClass[item.class_id].items.push(item);
  });

  Object.values(byClass).forEach(group => {
    const section = document.createElement('div');
    section.className = 'audit-section';

    const heading = document.createElement('div');
    heading.className = 'audit-section-heading';
    heading.textContent = group.name;
    section.appendChild(heading);

    group.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'audit-row';

      const left = document.createElement('div');
      left.className = 'audit-row-left';

      const key = document.createElement('span');
      key.className = 'audit-row-name';
      key.textContent = item.key;
      left.appendChild(key);

      const label = document.createElement('span');
      label.className = 'audit-row-meta';
      label.textContent = item.label + '  (' + (item.vals || []).slice(0, 4).join(', ') +
        ((item.vals || []).length > 4 ? '…' : '') + ')';
      left.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn audit-remove-btn';
      removeBtn.textContent = '✕ Remove';
      removeBtn.title = 'Delete this variable from the master list';
      removeBtn.onclick = () => {
        showConfirm(
          'Remove "' + item.key + '"?',
          'This removes it from the master filter list for ' + group.name +
          '. Any existing formulas that reference it (if any) will be unaffected.',
          () => {
            // Remove from in-memory State and autosave
            const master = State.master[item.class_id];
            if (master) {
              const idx = master.findIndex(v => v.key === item.key);
              if (idx !== -1) master.splice(idx, 1);
            }
            markDirty();
            sbAutoSave(catId, State);

            // Remove row from UI
            row.remove();

            // If section is now empty, remove it too
            if (section.querySelectorAll('.audit-row').length === 0) {
              section.remove();
            }
            if (body.querySelectorAll('.audit-row').length === 0) {
              body.innerHTML = '<div class="audit-empty">✅ All master variables are referenced in at least one rule.</div>';
            }
          }
        );
      };

      row.appendChild(left);
      row.appendChild(removeBtn);
      section.appendChild(row);
    });

    body.appendChild(section);
  });
}
