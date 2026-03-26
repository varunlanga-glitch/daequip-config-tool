/* ============================================================
   IO.JS — Persistence & Export
   ============================================================ */

'use strict';

/** Wrap a value for CSV: escape internal quotes and surround with double-quotes. */
const _csvQ = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

/* ── Save checkpoint ─────────────────────────────────────── */
function saveCheckpoint() {
  const defaultName =
    State.productClasses.find(c => c.id === State.activeClassId)?.name || 'configurator';

  showPrompt('Save Checkpoint', 'Enter filename:', defaultName, fileName => {
    const safeName = fileName.replace(/[^a-z0-9_-]/gi, '_');
    // Exclude internal flags from the saved snapshot
    const { dirty, ...saveState } = State;
    _downloadBlob(JSON.stringify(saveState, null, 2), 'application/json', `${safeName}.json`);
    State.dirty = false;
    localStorage.removeItem(_autosaveKey());
    _updateDirtyIndicator();
  });
}

/* ── CSV export ──────────────────────────────────────────── */
function exportCSV() {
  const props       = getActiveProps();
  const allParts    = getActiveParts();
  const allIdxList  = calculateIndices();
  // Exclude disabled parts from the export (they're hidden in the grid too)
  const parts   = [];
  const idxList = [];
  allParts.forEach((p, i) => {
    if (p.enabled !== false) { parts.push(p); idxList.push(allIdxList[i]); }
  });

  let csv = 'IDX,Part Name,' + props.map(p => _csvQ(p.name)).join(',') + '\n';
  parts.forEach((p, i) => {
    const rules = getActiveRules()[p.id] || {};
    const row = [
      idxList[i],
      _csvQ(p.name),
      ...props.map(pr => _csvQ(resolveRule(rules[pr.id], p.id)))
    ];
    csv += row.join(',') + '\n';
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const className = State.productClasses.find(c => c.id === State.activeClassId)?.name || 'export';
  _downloadBlob(csv, 'text/csv', `${className}-export-${timestamp}.csv`);
}

/* ── Dirty indicator ─────────────────────────────────────── */
function _updateDirtyIndicator() {
  const btn = document.getElementById('btnSave');
  if (btn) btn.classList.toggle('btn-dirty', !!State.dirty);
}

/* ── Per-category autosave key ───────────────────────────── */
function _autosaveKey() {
  return 'cat_autosave_' + (window._activeCategory?.id || 'main');
}

/* ── Autosave to localStorage + Supabase ─────────────────────── */
let _autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    if (!State.dirty) return;
    const { dirty, ...saveState } = State;
    // 1. Always write to localStorage as the fast local fallback
    try {
      localStorage.setItem(_autosaveKey(), JSON.stringify({
        timestamp: Date.now(),
        state: saveState
      }));
    } catch(e) { /* storage full — silently skip */ }
    // 2. Also push to Supabase (no version snapshot — just keeps DB current)
    if (window._activeCategory?.id) {
      sbAutoSave(window._activeCategory.id, saveState);
    }
  }, 2000);
}

function _showAutosaveBanner() {
  if (document.getElementById('autosaveBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'autosaveBanner';
  banner.className = 'autosave-banner';
  banner.innerHTML = `
    <span>⚠ You have unsaved changes from a previous session.</span>
    <button class="btn btn-autosave-restore" id="btnAutosaveRestore">Restore</button>
    <button class="btn btn-autosave-discard" id="btnAutosaveDiscard">Discard</button>`;
  document.querySelector('.app').insertBefore(banner, document.querySelector('.main'));

  document.getElementById('btnAutosaveRestore').onclick = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(_autosaveKey()));
      if (saved?.state) {
        Object.keys(State).forEach(k => delete State[k]);
        Object.assign(State, saved.state);
        window._unlockedTabs     = new Set();
        window._unlockedSections = new Set();
        migrateState();
        State.dirty = true;
        renderAll();
        _updateDirtyIndicator();
      }
    } catch(e) {}
    localStorage.removeItem(_autosaveKey());
    banner.remove();
  };

  document.getElementById('btnAutosaveDiscard').onclick = () => {
    localStorage.removeItem(_autosaveKey());
    banner.remove();
  };
}

/* ── Data migration ──────────────────────────────────────── */
/**
 * Converts legacy data conventions to the current model:
 * - Parts with a midx containing "-" are child parts; set level=1 and clear midx.
 * - Ensures every part has a `level` property (defaults to 0).
 */
function migrateState() {
  // Ensure lock fields exist (added in v10 — old saves won't have them)
  if (!State.lockedTabs)        State.lockedTabs        = {};
  if (!State.lockedSections)   State.lockedSections    = {};
  if (!State.hiddenProps)      State.hiddenProps        = { buckets: [] };
  if (!State.fileNameRules)     State.fileNameRules     = {};
  if (!State.fileNameOverrides) State.fileNameOverrides = {};
  if (!State.exportSelections)  State.exportSelections  = {};
  // Normalize all stored numeric vals: pad/round to 3 decimal places
  Object.keys(State.master || {}).forEach(classId => {
    (State.master[classId] || []).forEach(m => {
      const isDecimalVar = m.vals.some(v => typeof v === 'string' && /\./.test(v));
      m.vals = m.vals.map(v => {
        if (typeof v !== 'string') return v;
        const normalized = window.normalizeChipVal(v);
        return (isDecimalVar && /^-?\d+$/.test(normalized))
          ? parseFloat(normalized).toFixed(3)
          : normalized;
      });
    });
  });

  // Migrate timestamp-suffixed variable keys (e.g. MY_VAR_1773958139276 → MY_VAR).
  // Old code used Date.now() for collision suffixes; new code uses _2/_3 etc.
  const _TS_SUFFIX = /_\d{10,}$/;
  Object.keys(State.master || {}).forEach(classId => {
    const master = State.master[classId] || [];
    master.forEach(m => {
      const isTimestampSuffix = _TS_SUFFIX.test(m.key);
      const isRawVar = /^VAR\d{10,}$/.test(m.key);
      if (!isTimestampSuffix && !isRawVar) return;

      const base = isRawVar
        ? (m.label || '').toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
        : m.key.replace(_TS_SUFFIX, '');
      if (!base) return;

      let finalKey = base, s = 2;
      while (master.some(x => x !== m && x.key === finalKey)) finalKey = base + '_' + s++;
      if (finalKey === m.key) return;

      const oldKey = m.key;
      m.key = finalKey;

      // Migrate context value
      const ctx = State.context[classId] || {};
      if (ctx[oldKey] !== undefined) { ctx[finalKey] = ctx[oldKey]; delete ctx[oldKey]; }

      // Migrate rule templates
      const esc = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re  = new RegExp(`\\b${esc}\\b`, 'g');
      Object.values(State.rules[classId] || {}).forEach(partRules =>
        Object.keys(partRules).forEach(pid => {
          if (typeof partRules[pid] === 'string') partRules[pid] = partRules[pid].replace(re, finalKey);
        })
      );
      const fnR = (State.fileNameRules || {})[classId] || {};
      Object.keys(fnR).forEach(pid => {
        if (typeof fnR[pid] === 'string') fnR[pid] = fnR[pid].replace(re, finalKey);
      });
    });
  });

  Object.keys(State.parts || {}).forEach(classId => {
    (State.parts[classId] || []).forEach(p => {
      if (p.level === undefined) {
        if (p.midx && p.midx.includes('-')) {
          p.level = 1;
          p.midx  = null;    // let calculateIndices() auto-derive sub-index
        } else {
          p.level = 0;
        }
      }
      // v11: all parts default to enabled
      if (p.enabled === undefined) p.enabled = true;
    });
  });
}

/* ── Seed data loader ────────────────────────────────────── */
function loadSeedData(url) {
  fetch(url + '?t=' + Date.now())
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      Object.assign(State, data);
      migrateState();
      State.dirty = false;
      renderAll();
      _finishLoad();
    })
    .catch(() => {
      // Seed file unavailable — use default State from state.js.
      State.dirty = false;
      renderAll();
      _finishLoad();
    });
}

function _finishLoad() {
  // Remove loading indicator
  const indicator = document.getElementById('loadingIndicator');
  if (indicator) indicator.remove();
  // Update dirty indicator (should be clean after load)
  _updateDirtyIndicator();
  // Show autosave restore banner if a previous session was interrupted
  if (localStorage.getItem(_autosaveKey())) _showAutosaveBanner();
}

/* ── Internal download helper ────────────────────────────── */
function _downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Save via the File System Access API (native "Save As" dialog).
 * The browser remembers the last directory, so once the user navigates to the
 * base folder the first time, subsequent exports default there automatically.
 * Falls back to _downloadBlob on browsers that don't support the API.
 */
let _lastDirHandle = null;   // remembered across exports within a session
async function _saveWithPicker(content, mimeType, suggestedName) {
  if (!window.showSaveFilePicker) { _downloadBlob(content, mimeType, suggestedName); return; }
  try {
    const ext  = suggestedName.split('.').pop();
    const opts = {
      suggestedName,
      types: [{ description: ext.toUpperCase() + ' file', accept: { [mimeType]: ['.' + ext] } }],
    };
    if (_lastDirHandle) opts.startIn = _lastDirHandle;
    const fileHandle = await window.showSaveFilePicker(opts);
    // Remember the parent directory for next time
    _lastDirHandle = fileHandle;
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (e) {
    if (e.name === 'AbortError') return;  // user cancelled — do nothing
    _downloadBlob(content, mimeType, suggestedName);  // fallback
  }
}

/* ── Toolbar button wiring ───────────────────────────────── */
document.getElementById('btnSave').addEventListener('click',           saveCheckpoint);
document.getElementById('btnExportInventor').addEventListener('click', exportInventor);
document.getElementById('btnNewTab').addEventListener('click',         newTab);
document.getElementById('btnPublish').addEventListener('click',        () => openPublishModal());
document.getElementById('btnHistory').addEventListener('click',        () => openHistoryModal());
document.getElementById('btnHome').addEventListener('click',           () => goHome());
{ const el = document.getElementById('btnAudit'); if (el) el.addEventListener('click', () => openAuditModal()); }

/* ── Keyboard shortcuts ──────────────────────────────────── */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCheckpoint();
  }
});

/* ── Unsaved-changes warning on close/refresh ────────────── */
window.addEventListener('beforeunload', e => {
  if (State.dirty) {
    e.preventDefault();
    e.returnValue = '';   // triggers browser's "Leave site?" dialog
  }
});


/* ── Inventor iProperties export ─────────────────────────── */
// Custom iProperties that must exist on every Daequip template file so that
// embedded rules like "iProperty Check" never fail with "Cannot find property X".
// Embedded in the exported CSV as "# RequiredProps=..." and read by the iLogic
// script at runtime — change this list here, re-export, no script re-download needed.
const INVENTOR_REQUIRED_PROPS = [
  'Class', 'Hook-Up', 'Size',
  'Features 1', 'Features 2',
  'Specs 1', 'Specs 2',
  'Machine', 'Process', 'Legacy',
];

// Standard Inventor iProperty fields (Summary + Custom tabs)
const INVENTOR_IPROP_OPTIONS = [
  '(skip — do not export)',
  // Summary tab
  'Title', 'Subject', 'Author', 'Manager', 'Company', 'Category',
  'Keywords', 'Description', 'Hyperlink Base',
  // Project tab
  'Part Number', 'Stock Number', 'Description', 'Revision Number',
  'Project', 'Designer', 'Engineer', 'Authority', 'Cost Center',
  'Estimated Cost', 'Creation Date', 'Vendor', 'Web Link',
  // Status tab
  'Checked By', 'Date Checked', 'Eng Approved By', 'Eng Approved Date',
  'Mfg Approved By', 'Mfg Approved Date',
  // Custom tab — common engineering properties
  'Class', 'Hook-Up', 'Size', 'Features 1', 'Features 2',
  'Specs 1', 'Specs 2', 'Machine', 'Process', 'Legacy',
  '(type custom name...)'
];

function _getInventorMap() {
  if (!State.inventorMaps) State.inventorMaps = {};
  if (!State.inventorMaps[State.activeClassId]) {
    // Generated filename always comes from the part name (p.name) — no dedicated column.
    const map = { mapping: {} };
    getActiveProps().forEach(p => {
      const name = p.name.toLowerCase();
      // Auto-match obvious names
      const AUTO = {
        'description': 'Description', 'class': 'Class', 'hook-up': 'Hook-Up',
        'hookup': 'Hook-Up', 'size': 'Size', 'features 1': 'Features 1',
        'features 2': 'Features 2', 'specs 1': 'Specs 1', 'specs 2': 'Specs 2',
        'machine': 'Machine', 'process': 'Process',
        'part number': 'Part Number', 'stock number': 'Stock Number',
      };
      map.mapping[p.id] = AUTO[name] || '';
    });
    State.inventorMaps[State.activeClassId] = map;
  }
  return State.inventorMaps[State.activeClassId];
}
window.getInventorMap = _getInventorMap;

function _getInventorBaseFolder() {
  if (!State.inventorBaseFolders) return '';
  return State.inventorBaseFolders[State.activeClassId] || '';
}
function _setInventorBaseFolder(path) {
  if (!State.inventorBaseFolders) State.inventorBaseFolders = {};
  State.inventorBaseFolders[State.activeClassId] = path;
}

/* ── Export selections: per-part, per-property checkbox state ── */
function _getExportSelections(parts, mappedPropIds) {
  if (!State.exportSelections) State.exportSelections = {};
  if (!State.exportSelections[State.activeClassId]) State.exportSelections[State.activeClassId] = {};
  const sel = State.exportSelections[State.activeClassId];
  parts.forEach(p => {
    if (!sel[p.id]) sel[p.id] = { rename: true, props: {} };
    mappedPropIds.forEach(pid => {
      if (sel[p.id].props[pid] === undefined) sel[p.id].props[pid] = true;
    });
  });
  return sel;
}

function _syncColAllCheckbox(wrap, col, parts, sel) {
  const colCb = wrap.querySelector(`.imap-col-all[data-col="${col}"]`);
  if (!colCb) return;
  const values = parts.map(p => {
    const ps = sel[p.id] || { rename: true, props: {} };
    return col === '__rename__' ? ps.rename !== false : ps.props[col] !== false;
  });
  const allChecked  = values.every(Boolean);
  const noneChecked = values.every(v => !v);
  colCb.checked       = allChecked;
  colCb.indeterminate = !allChecked && !noneChecked;
}

function _wireReviewCheckboxes(wrap, parts, sel, mappedProps) {
  const updateBadge = () => {
    let checked = 0, total = 0;
    parts.forEach(p => {
      const ps = sel[p.id] || { rename: true, props: {} };
      total++; checked += ps.rename !== false ? 1 : 0;
      mappedProps.forEach(mp => { total++; checked += ps.props[mp.id] !== false ? 1 : 0; });
    });
    const badge = document.getElementById('imapReviewCount');
    if (badge) badge.textContent = checked + '/' + total;
  };

  wrap.querySelectorAll('.imap-row-cb').forEach(cb => {
    cb.onchange = () => {
      const { partid, col } = cb.dataset;
      if (!sel[partid]) sel[partid] = { rename: true, props: {} };
      if (col === '__rename__') { sel[partid].rename = cb.checked; }
      else                      { sel[partid].props[col] = cb.checked; }
      _syncColAllCheckbox(wrap, col, parts, sel);
      updateBadge();
    };
  });

  wrap.querySelectorAll('.imap-col-all').forEach(colCb => {
    colCb.onchange = () => {
      const col = colCb.dataset.col;
      wrap.querySelectorAll(`.imap-row-cb[data-col="${col}"]`).forEach(rowCb => {
        rowCb.checked = colCb.checked;
        const { partid } = rowCb.dataset;
        if (!sel[partid]) sel[partid] = { rename: true, props: {} };
        if (col === '__rename__') { sel[partid].rename = colCb.checked; }
        else                      { sel[partid].props[col] = colCb.checked; }
      });
      updateBadge();
    };
  });
}

function _renderReviewTab(parts, mapping, overrides) {
  const mappedProps = getActiveProps().filter(p => mapping[p.id]);
  const mappedPropIds = mappedProps.map(p => p.id);
  const sel = _getExportSelections(parts, mappedPropIds);

  const wrap = document.getElementById('imapReviewWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Badge
  let checked = 0, total = 0;
  parts.forEach(p => {
    const ps = sel[p.id] || { rename: true, props: {} };
    total++; checked += ps.rename !== false ? 1 : 0;
    mappedProps.forEach(mp => { total++; checked += ps.props[mp.id] !== false ? 1 : 0; });
  });
  const badge = document.getElementById('imapReviewCount');
  if (badge) badge.textContent = checked + '/' + total;

  // Build table
  const table = document.createElement('table');
  table.className = 'imap-review-table';

  // THEAD
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const cornerTh = document.createElement('th');
  cornerTh.className = 'imap-review-corner';
  cornerTh.textContent = 'Part / New Name';
  headerRow.appendChild(cornerTh);

  // Rename column header
  const renameTh = document.createElement('th');
  renameTh.className = 'imap-review-colhead';
  const renameAllCb = document.createElement('input');
  renameAllCb.type = 'checkbox'; renameAllCb.className = 'imap-col-all'; renameAllCb.dataset.col = '__rename__';
  renameAllCb.checked = parts.every(p => (sel[p.id] || {}).rename !== false);
  renameTh.appendChild(renameAllCb);
  const renameSpan = document.createElement('span'); renameSpan.textContent = 'Rename File?';
  renameTh.appendChild(renameSpan);
  headerRow.appendChild(renameTh);

  // iProperty column headers
  mappedProps.forEach(mp => {
    const th = document.createElement('th');
    th.className = 'imap-review-colhead';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox'; allCb.className = 'imap-col-all'; allCb.dataset.col = mp.id;
    allCb.checked = parts.every(p => (sel[p.id] || { props: {} }).props[mp.id] !== false);
    th.appendChild(allCb);
    const lbl = document.createElement('span'); lbl.textContent = mapping[mp.id]; lbl.title = mp.name;
    th.appendChild(lbl);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // TBODY
  const tbody = document.createElement('tbody');
  parts.forEach(p => {
    const generatedName = resolveFileNameRule(p.id) || p.name;
    const currentName   = overrides[p.id] || generatedName;
    const partSel = sel[p.id] || { rename: true, props: {} };

    const tr = document.createElement('tr');
    tr.dataset.partid = p.id;

    // Row header
    const rowHead = document.createElement('td');
    rowHead.className = 'imap-review-rowhead';
    rowHead.innerHTML =
      `<span class="imap-review-partname">${escapeHtml(p.name)}</span>` +
      `<span class="imap-review-newname" title="Current: ${escapeHtml(currentName)}">${escapeHtml(generatedName)}</span>`;
    tr.appendChild(rowHead);

    // Rename cell
    const renameTd = document.createElement('td');
    renameTd.className = 'imap-review-cell';
    const renameCb = document.createElement('input');
    renameCb.type = 'checkbox'; renameCb.className = 'imap-row-cb';
    renameCb.dataset.partid = p.id; renameCb.dataset.col = '__rename__';
    renameCb.checked = partSel.rename !== false;
    renameTd.appendChild(renameCb);
    tr.appendChild(renameTd);

    // iProperty cells
    mappedProps.forEach(mp => {
      const td = document.createElement('td');
      td.className = 'imap-review-cell';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'imap-row-cb';
      cb.dataset.partid = p.id; cb.dataset.col = mp.id;
      cb.checked = partSel.props[mp.id] !== false;
      td.appendChild(cb);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const scrollDiv = document.createElement('div');
  scrollDiv.className = 'imap-review-scroll';
  scrollDiv.appendChild(table);
  wrap.appendChild(scrollDiv);

  _wireReviewCheckboxes(wrap, parts, sel, mappedProps);
}

function exportInventor() {
  const map    = _getInventorMap();
  const props  = getActiveProps();
  const parts  = getActiveParts().filter(p => p.enabled !== false);

  // Per-part file overrides: partId → actual filename (no ext), set via file picker
  if (!State.fileNameOverrides) State.fileNameOverrides = {};
  if (!State.fileNameOverrides[State.activeClassId]) State.fileNameOverrides[State.activeClassId] = {};
  const overrides = State.fileNameOverrides[State.activeClassId];

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:1000';

  const box = document.createElement('div');
  box.className = 'confirm-box inventor-map-box';

  // ── iProperty column mapping ──
  const propRows = props.map(p => {
    const current  = map.mapping[p.id] || '';
    const opts = INVENTOR_IPROP_OPTIONS.map(o =>
      `<option value="${o === '(type custom name...)' ? '__custom__' : o}"${current === o ? ' selected' : ''}>${o}</option>`
    ).join('');
    const isCustom = current && !INVENTOR_IPROP_OPTIONS.includes(current) && current !== '(skip — do not export)';
    return `
      <tr data-pid="${p.id}">
        <td class="imap-col-name">${escapeHtml(p.name)}</td>
        <td>
          <select class="imap-select" data-pid="${p.id}">${opts}
            ${isCustom ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>` : ''}
          </select>
          <input class="imap-custom" data-pid="${p.id}" placeholder="Custom iProperty name"
            style="display:${isCustom ? 'inline-block' : 'none'}" value="${isCustom ? escapeHtml(current) : ''}">
        </td>
      </tr>`;
  }).join('');

  // ── File name linking — part name → linked actual file ──
  const fileRows = parts.map(p => {
    const generated = resolveFileNameRule(p.id) || p.name;
    const linked   = overrides[p.id] || '';
    const hasLink  = !!linked;
    return `<tr data-partid="${p.id}">
      <td class="imap-col-name" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(generated)}">${escapeHtml(generated)}</td>
      <td>
        <div class="imap-file-link-cell">
          <span class="imap-linked-name ${hasLink ? 'imap-linked-name--set' : ''}" data-partid="${p.id}">${hasLink ? linked : 'not linked'}</span>
          <button class="btn imap-browse-btn" data-partid="${p.id}">📂 Browse</button>
          ${hasLink ? `<button class="btn imap-clear-btn" data-partid="${p.id}">✕</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="confirm-title">🔩 Export for Inventor iProperties</div>

    <div class="imap-tabs">
      <button class="imap-tab active" data-itab="files">File Name Linking <span class="imap-link-count" id="imapLinkCount">${Object.keys(overrides).length}/${parts.length}</span></button>
      <button class="imap-tab" data-itab="props">iProperty Mapping</button>
      <button class="imap-tab" data-itab="review">Review &amp; Export <span class="imap-review-count" id="imapReviewCount"></span></button>
    </div>

    <div class="imap-tab-panel" id="itab-files">
      <p class="imap-filename-hint" style="margin:10px 20px 6px">
        Link each generated filename to its actual <code>.ipt</code> file on disk.
        The script will use the <strong>actual filename</strong> (not the generated one) to match
        the open document in Inventor — useful when the file was named differently.
      </p>
      <div class="imap-basefolder-row">
        <label class="imap-basefolder-label" for="imapBaseFolder">Base Folder <span class="imap-basefolder-hint">(optional — embedded in the CSV so the iLogic script finds your files automatically. Leave blank to be prompted at runtime.)</span></label>
        <input id="imapBaseFolder" class="imap-basefolder-input" type="text" placeholder="e.g.  C:\\Daequip\\PN-120MM" value="${(_getInventorBaseFolder()||'').replace(/"/g,'&quot;')}">
      </div>
      <div style="flex:1;overflow:auto;padding:0 20px 10px">
        <table class="imap-table" id="imapFileTable" style="table-layout:fixed;width:100%">
          <thead><tr><th style="width:45%">Generated Name</th><th style="width:55%">Linked Inventor File</th></tr></thead>
          <tbody>${fileRows}</tbody>
        </table>
      </div>
    </div>

    <div class="imap-tab-panel" id="itab-props" style="display:none">
      <p class="imap-filename-hint" style="margin:10px 20px 6px">
        Map each configurator column to its Inventor iProperty. The <strong>File Name</strong> column is used automatically to match documents.
      </p>
      <div style="flex:1;overflow:auto;padding:0 20px 10px">
        <table class="imap-table">
          <thead><tr><th>Configurator Column</th><th>→ Inventor iProperty</th></tr></thead>
          <tbody>${propRows}</tbody>
        </table>
      </div>
    </div>

    <div class="imap-tab-panel" id="itab-review" style="display:none">
      <p class="imap-filename-hint" style="margin:10px 20px 6px">
        Uncheck anything you don't want touched. <strong>Rename File?</strong> controls whether the file gets renamed in Inventor. Uncheck an iProperty to leave it as-is.
      </p>
      <div id="imapReviewWrap"></div>
    </div>

    <div class="confirm-buttons imap-footer">
      <button class="btn btn-cancel">Cancel</button>
      <button class="btn" id="imapBtnStyleRule" title="Download a standalone iLogic rule to embed in your template files — updates &amp; purges styles silently on open">⬇ Style Updater Rule</button>
      <button class="btn" id="imapBtnILogic" title="Download the iLogic script — add it to Inventor once as an External Rule and reuse it forever. The base folder path travels with the CSV, so the script never needs to change.">⬇ iLogic Script</button>
      <button class="btn" id="imapBtnPreview">👁 Preview CSV</button>
      <button class="btn btn-confirm" id="imapBtnExport" data-reviewed="${((State.exportSelections||{})[State.activeClassId]||{})._reviewed ? '1' : '0'}">⬇ Export CSV</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // ── Tab switching ──
  box.querySelectorAll('.imap-tab').forEach(tab => {
    tab.onclick = () => {
      // If switching to Review, collect current mapping first
      if (tab.dataset.itab === 'review') {
        const { mapping } = collectMap();
        map.mapping = mapping;
        _renderReviewTab(parts, mapping, overrides);
      }
      box.querySelectorAll('.imap-tab').forEach(t => t.classList.remove('active'));
      box.querySelectorAll('.imap-tab-panel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      document.getElementById('itab-' + tab.dataset.itab).style.display = '';
      // Mark Download as reviewed once the Review tab has been visited; persist so it survives dialog close
      const exportBtn = document.getElementById('imapBtnExport');
      if (exportBtn && tab.dataset.itab === 'review') {
        exportBtn.dataset.reviewed = '1';
        exportBtn.classList.remove('btn-locked');
        if (!State.exportSelections) State.exportSelections = {};
        if (!State.exportSelections[State.activeClassId]) State.exportSelections[State.activeClassId] = {};
        State.exportSelections[State.activeClassId]._reviewed = true;
      }
    };
  });

  // ── Custom iProperty input toggle; reset review flag on mapping change ──
  const _clearReviewed = () => {
    const btn = document.getElementById('imapBtnExport');
    if (btn) btn.dataset.reviewed = '0';
    if ((State.exportSelections || {})[State.activeClassId])
      State.exportSelections[State.activeClassId]._reviewed = false;
  };
  box.querySelectorAll('.imap-select').forEach(sel => {
    const pid = sel.dataset.pid;
    const ci  = box.querySelector(`.imap-custom[data-pid="${pid}"]`);
    sel.onchange = () => {
      ci.style.display = sel.value === '__custom__' ? 'inline-block' : 'none';
      _clearReviewed();
    };
  });
  box.querySelectorAll('.imap-custom').forEach(inp => {
    inp.oninput = () => _clearReviewed();
  });

  // ── File browse buttons ──
  const updateLinkCount = () => {
    const el = document.getElementById('imapLinkCount');
    if (el) el.textContent = Object.keys(overrides).length + '/' + parts.length;
  };

  box.querySelectorAll('.imap-browse-btn').forEach(btn => {
    btn.onclick = async () => {
      const partId = btn.dataset.partid;
      try {
        let name = '';
        await new Promise(res => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.ipt,.iam,.idw,.dwg,.ipn';
          inp.onchange = () => { name = inp.files[0]?.name.replace(/\.[^.]+$/, '') || ''; res(); };
          inp.oncancel = () => res();
          document.body.appendChild(inp);
          inp.click();
          document.body.removeChild(inp);
        });
        if (!name) return;
        overrides[partId] = name;
        // Update the row UI
        const row   = box.querySelector(`tr[data-partid="${partId}"]`);
        const label = row.querySelector('.imap-linked-name');
        label.innerHTML = name;
        label.classList.add('imap-linked-name--set');
        // Add clear button if not present
        if (!row.querySelector('.imap-clear-btn')) {
          const clr = document.createElement('button');
          clr.className = 'btn imap-clear-btn';
          clr.dataset.partid = partId;
          clr.title = 'Clear link';
          clr.style.cssText = 'margin-left:4px;opacity:0.6';
          clr.textContent = '✕';
          clr.onclick = () => _clearFileLink(partId, row, overrides, updateLinkCount);
          row.querySelector('.imap-file-link-cell').appendChild(clr);
        }
        updateLinkCount();
      } catch(e) { if (e.name !== 'AbortError') console.error(e); }
    };
  });

  box.querySelectorAll('.imap-clear-btn').forEach(btn => {
    btn.onclick = () => _clearFileLink(btn.dataset.partid,
      box.querySelector(`tr[data-partid="${btn.dataset.partid}"]`), overrides, updateLinkCount);
  });

  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  box.querySelector('.btn-cancel').onclick = close;
  box.querySelector('#imapBtnStyleRule').onclick = () =>
    _saveWithPicker(_buildStyleUpdaterRule(), 'text/plain', 'Daequip-UpdateStyles.iLogicVb');

  box.querySelector('#imapBtnILogic').onclick = () =>
    _saveWithPicker(_buildILogicScript(), 'text/plain', 'ConfiguratorPro-SetIProperties.iLogicVb');

  const collectMap = () => {
    const m = {};
    box.querySelectorAll('.imap-select').forEach(sel => {
      const pid = sel.dataset.pid;
      let val = sel.value;
      if (val === '__custom__') { val = box.querySelector(`.imap-custom[data-pid="${pid}"]`)?.value?.trim() || ''; }
      if (val && val !== '(skip — do not export)') m[pid] = val;
    });
    return { mapping: m };
  };

  // Persist base folder on every keystroke
  box.querySelector('#imapBaseFolder').oninput = e => _setInventorBaseFolder(e.target.value.trim());

  box.querySelector('#imapBtnPreview').onclick = () => {
    const { mapping } = collectMap();
    const exportSel = (State.exportSelections || {})[State.activeClassId] || {};
    const csv = _buildInventorCSV(mapping, exportSel);
    const w = window.open('', '_blank');
    w.document.write(`<pre style="font-family:monospace;font-size:12px;padding:20px">${csv.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`);
  };

  box.querySelector('#imapBtnExport').onclick = () => {
    const exportBtn = document.getElementById('imapBtnExport');
    if (exportBtn?.dataset.reviewed !== '1') {
      // Guide user to Review tab first
      const reviewTab = box.querySelector('.imap-tab[data-itab="review"]');
      if (reviewTab) reviewTab.click();
      // Flash a hint banner
      let hint = box.querySelector('.imap-review-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'imap-review-hint';
        hint.textContent = 'Please review and confirm which files and properties to export, then click Download.';
        const wrap = document.getElementById('imapReviewWrap');
        wrap?.parentElement?.insertBefore(hint, wrap);
      }
      hint.style.display = 'block';
      setTimeout(() => { if (hint) hint.style.display = 'none'; }, 4000);
      return;
    }

    const { mapping } = collectMap();
    map.mapping = mapping;

    const exportSel = (State.exportSelections || {})[State.activeClassId] || {};
    const csv = _buildInventorCSV(mapping, exportSel);

    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5);
    const className = State.productClasses.find(c => c.id === State.activeClassId)?.name || 'export';
    _saveWithPicker(csv, 'text/csv', `${className}-inventor-${timestamp}.csv`);
    close();
  };
}

function _clearFileLink(partId, row, overrides, updateLinkCount) {
  delete overrides[partId];
  const label = row.querySelector('.imap-linked-name');
  label.innerHTML = '<span style="color:#aaa;font-style:italic">not linked</span>';
  label.classList.remove('imap-linked-name--set');
  const clr = row.querySelector('.imap-clear-btn');
  if (clr) clr.remove();
  updateLinkCount();
}

function _buildInventorCSV(mapping, selections) {
  const parts   = getActiveParts().filter(p => p.enabled !== false);
  const props   = getActiveProps();
  const otherProps = props.filter(p => mapping[p.id]);
  const overrides  = ((State.fileNameOverrides || {})[State.activeClassId]) || {};
  const sel = selections || {};

  const header = [
    '"FileName"',       // current/placeholder filename — used to match open document
    '"NewFileName"',    // generated target name — document will be renamed to this
    ...otherProps.map(p => _csvQ(mapping[p.id]))
  ].join(',');

  const rows = parts.map(p => {
    const generatedName = resolveFileNameRule(p.id) || p.name;
    const currentName   = overrides[p.id] || generatedName;
    const partSel       = sel[p.id] || { rename: true, props: {} };

    // If rename is unchecked, NewFileName === FileName → iLogic rename branch is a no-op
    const newFileName = partSel.rename !== false ? generatedName : currentName;

    const cells = [
      _csvQ(currentName),   // FileName — what to match in Inventor
      _csvQ(newFileName),   // NewFileName — rename target (same as current when unchecked)
      ...otherProps.map(pr => {
        if (partSel.props[pr.id] === false) return '""'; // unchecked → empty, iLogic skips
        const partRules = getActiveRules()[p.id] || {};
        const val = resolveRule(partRules[pr.id], p.id);
        return _csvQ(val || '-');
      })
    ];
    return cells.join(',');
  });

  const lines = [header, ...rows];
  // Metadata lines prepended in reverse order (last unshift = first line in file)
  const baseFolder = (_getInventorBaseFolder() || '').trim();
  if (baseFolder) lines.unshift(`# BaseFolder=${baseFolder}`);
  lines.unshift(`# RequiredProps=${INVENTOR_REQUIRED_PROPS.join(',')}`);
  return lines.join('\n');
}

function _buildILogicScript() {
  return `' ============================================================
' Inventor iLogic Rule — Set iProperties & Rename Files
' Generated by Configurator Pro
'
' UNIVERSAL SCRIPT — add this to Inventor once, reuse forever.
' Only the CSV file changes between exports.
'
' WORKFLOW:
'   1. In iLogic Browser > External Rules > add this file > right-click > Run
'   2. Browse to the CSV exported from Configurator Pro
'   3. If the CSV contains a Base Folder path the script uses it automatically.
'      Otherwise you will be prompted to pick the folder.
'   4. Script finds all .ipt, .iam, .dwg, .idw, and .ipn files recursively
'   5. No need to open files manually — script opens, updates, renames and closes each one
'
' Vault users: ensure files are Checked Out before running.
' ============================================================

Imports System.Collections.Generic
Imports System.Runtime.InteropServices
Imports System.Threading
Imports System.Windows.Forms

Module BuiltInProps
    Public ReadOnly SummaryProps As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase) From {
        "Title", "Subject", "Author", "Manager", "Company", "Category", "Keywords", "Hyperlink Base"
    }
    Public ReadOnly ProjectProps As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase) From {
        "Description", "Part Number", "Stock Number", "Revision Number", "Project",
        "Designer", "Engineer", "Authority", "Cost Center", "Estimated Cost",
        "Creation Date", "Vendor", "Web Link"
    }
    Public ReadOnly StatusProps As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase) From {
        "Checked By", "Date Checked", "Eng Approved By", "Eng Approved Date",
        "Mfg Approved By", "Mfg Approved Date"
    }
    Public Function GetTab(propName As String) As String
        If SummaryProps.Contains(propName) Then Return "Summary"
        If ProjectProps.Contains(propName) Then Return "Project"
        If StatusProps.Contains(propName)  Then Return "Status"
        Return "Custom"
    End Function
End Module

' ── Auto-dismiss iLogic rule error dialogs ────────────────────────────────────
' When documents are opened programmatically from within an iLogic script,
' embedded auto-run rules fire with iLogicVb.Document pointing to the OUTER
' script's context, not the newly opened document.  Rules like "Sort Parts-List"
' then fail trying to cast that (wrong) document to DrawingDocument.
' ThisApplication.SilentOperation does NOT suppress iLogic engine error dialogs.
' This module spawns a background thread that finds and clicks OK on any such
' dialog every 200 ms so the batch does not stall waiting for user input.
Module DialogDismisser
    <DllImport("user32.dll", SetLastError:=True, CharSet:=CharSet.Unicode)>
    Private Function FindWindowEx(hWndParent As IntPtr, hWndChildAfter As IntPtr, lpszClass As String, lpszWindow As String) As IntPtr
    End Function

    <DllImport("user32.dll", SetLastError:=True, CharSet:=CharSet.Unicode)>
    Private Function GetWindowText(hWnd As IntPtr, lpString As System.Text.StringBuilder, nMaxCount As Integer) As Integer
    End Function

    <DllImport("user32.dll", SetLastError:=True)>
    Private Function SendMessage(hWnd As IntPtr, Msg As UInteger, wParam As IntPtr, lParam As IntPtr) As IntPtr
    End Function

    Private Const BM_CLICK As UInteger = &HF5
    Private _running As Boolean = False

    ''' <summary>
    ''' Recursively search all descendants of <paramref name="parent"/> for a window
    ''' whose title exactly matches <paramref name="text"/>, regardless of window class.
    ''' FindWindowEx with a literal "Button" class silently misses Inventor dialogs that
    ''' use custom WPF / DevExpress controls instead of the standard Win32 Button class.
    ''' </summary>
    Private Function FindChildByText(parent As IntPtr, text As String) As IntPtr
        Dim child As IntPtr = IntPtr.Zero
        Do
            child = FindWindowEx(parent, child, Nothing, Nothing)
            If child = IntPtr.Zero Then Exit Do
            Dim sb As New System.Text.StringBuilder(256)
            GetWindowText(child, sb, 256)
            If sb.ToString().Trim() = text Then Return child
            Dim deep As IntPtr = FindChildByText(child, text)
            If deep <> IntPtr.Zero Then Return deep
        Loop
        Return IntPtr.Zero
    End Function

    Public Sub Start()
        _running = True
        Dim t As New Thread(AddressOf PollLoop)
        t.IsBackground = True
        t.Start()
    End Sub

    Public Sub [Stop]()
        _running = False
    End Sub

    Private Sub PollLoop()
        Do While _running
            Thread.Sleep(200)
            Try
                Dim prev As IntPtr = IntPtr.Zero
                Do
                    ' Pass Nothing for class so we enumerate ALL top-level windows.
                    ' Inventor renders "Update Styles" / "Purge Styles" with a custom
                    ' window class, not the standard #32770 dialog class, so filtering
                    ' by "#32770" silently skips them.
                    Dim hwnd As IntPtr = FindWindowEx(IntPtr.Zero, prev, Nothing, Nothing)
                    If hwnd = IntPtr.Zero Then Exit Do
                    prev = hwnd
                    Dim sb As New System.Text.StringBuilder(512)
                    GetWindowText(hwnd, sb, 512)
                    Dim title As String = sb.ToString()
                    ' Auto-dismiss iLogic engine error dialogs ("Error on line N in rule: …")
                    If title.StartsWith("Error on line") Then
                        Dim hwndOk As IntPtr = FindChildByText(hwnd, "OK")
                        If hwndOk <> IntPtr.Zero Then
                            SendMessage(hwndOk, BM_CLICK, IntPtr.Zero, IntPtr.Zero)
                        End If
                    End If
                Loop
            Catch
            End Try
        Loop
    End Sub
End Module

Sub Main()
    ' ── 1. Pick CSV ──────────────────────────────────────────
    Dim csvDlg As New OpenFileDialog()
    csvDlg.Title  = "Select Configurator Pro CSV"
    csvDlg.Filter = "CSV Files (*.csv)|*.csv|All Files (*.*)|*.*"
    If csvDlg.ShowDialog() <> DialogResult.OK Then MsgBox("Cancelled.") : Exit Sub
    Dim csvPath As String = csvDlg.FileName

    ' ── 2. Read CSV & extract metadata lines ─────────────────
    Dim allLines() As String = System.IO.File.ReadAllLines(csvPath)
    If allLines.Length < 1 Then MsgBox("CSV appears empty.") : Exit Sub

    Dim dataStart As Integer = 0
    Dim baseFolder As String = ""
    Dim requiredProps As String() = {"Class", "Hook-Up", "Size", "Features 1", "Features 2", "Specs 1", "Specs 2", "Machine", "Process", "Legacy"}

    ' Scan leading "# Key=Value" lines; stop at the header row
    Do While dataStart < allLines.Length AndAlso allLines(dataStart).StartsWith("#")
        Dim meta As String = allLines(dataStart)
        If meta.StartsWith("# BaseFolder=") Then
            baseFolder = meta.Substring(13).Trim()
        ElseIf meta.StartsWith("# RequiredProps=") Then
            Dim rp As String() = meta.Substring(16).Split(","c)
            For i As Integer = 0 To rp.Length - 1 : rp(i) = rp(i).Trim() : Next
            requiredProps = rp
        End If
        dataStart += 1
    Loop

    ' Fall back to folder dialog if CSV has no path or the path no longer exists
    If baseFolder = "" OrElse Not System.IO.Directory.Exists(baseFolder) Then
        Dim folderDlg As New FolderBrowserDialog()
        folderDlg.Description        = "Select the base folder containing your placeholder Inventor files"
        folderDlg.ShowNewFolderButton = False
        If folderDlg.ShowDialog() <> DialogResult.OK Then MsgBox("Cancelled.") : Exit Sub
        baseFolder = folderDlg.SelectedPath
    End If

    If allLines.Length < dataStart + 2 Then MsgBox("CSV appears empty.") : Exit Sub

    ' ── 3. Parse CSV ─────────────────────────────────────────
    Dim headers() As String = SplitCSVRow(allLines(dataStart))
    Dim colIndex As New Dictionary(Of String, Integer)(StringComparer.OrdinalIgnoreCase)
    For i As Integer = 0 To headers.Length - 1
        Dim h As String = headers(i).Trim(Chr(34)).Trim()
        If h <> "" Then colIndex(h) = i
    Next

    If Not colIndex.ContainsKey("FileName") Then
        MsgBox("CSV is missing a 'FileName' column. Please re-export from Configurator Pro.")
        Exit Sub
    End If
    If Not colIndex.ContainsKey("NewFileName") Then
        MsgBox("CSV is missing a 'NewFileName' column. Please re-export from Configurator Pro.")
        Exit Sub
    End If

    ' Build lookup: placeholder name (no ext, uppercase) -> row data
    Dim csvRows As New Dictionary(Of String, Dictionary(Of String, String))(StringComparer.OrdinalIgnoreCase)
    For i As Integer = dataStart + 1 To allLines.Length - 1
        Dim row() As String = SplitCSVRow(allLines(i))
        Dim fname As String = ""
        If colIndex("FileName") < row.Length Then fname = row(colIndex("FileName")).Trim(Chr(34)).Trim()
        If fname = "" Then Continue For
        Dim props As New Dictionary(Of String, String)(StringComparer.OrdinalIgnoreCase)
        For Each kvp In colIndex
            Dim cellVal As String = ""
            If kvp.Value < row.Length Then cellVal = row(kvp.Value).Trim(Chr(34))
            props(kvp.Key) = If(cellVal = "", "-", cellVal)
        Next
        csvRows(fname) = props
        Dim noExt As String = System.IO.Path.GetFileNameWithoutExtension(fname)
        If Not csvRows.ContainsKey(noExt) Then csvRows(noExt) = props
    Next

    ' ── 4. Scan folder recursively for Inventor files ────────
    ' Match .ipt, .iam (primary) plus related .dwg, .idw, .ipn files
    Dim inventorExts As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase) From {
        ".ipt", ".iam", ".dwg", ".idw", ".ipn"
    }
    Dim allFiles() As String = System.IO.Directory.GetFiles(baseFolder, "*.*", System.IO.SearchOption.AllDirectories)
    ' Collect all candidates first, then deduplicate: keep the shallowest (shortest)
    ' path for each (filename + extension) pair so that files in OldVersions or
    ' other archive subdirectories never shadow the primary copy.
    Dim bestPath As New Dictionary(Of String, String)(StringComparer.OrdinalIgnoreCase)
    For Each f As String In allFiles
        Dim ext As String = System.IO.Path.GetExtension(f).ToLowerInvariant()
        If Not inventorExts.Contains(ext) Then Continue For
        Dim nameNoExt As String = System.IO.Path.GetFileNameWithoutExtension(f)
        If Not (csvRows.ContainsKey(nameNoExt) OrElse csvRows.ContainsKey(nameNoExt.ToUpperInvariant())) Then Continue For
        Dim fileKey As String = nameNoExt.ToUpperInvariant() & ext
        Dim existing As String = Nothing
        If bestPath.TryGetValue(fileKey, existing) Then
            If f.Length < existing.Length Then bestPath(fileKey) = f
        Else
            bestPath.Add(fileKey, f)
        End If
    Next
    Dim matchedFiles As New List(Of String)(bestPath.Values)

    If matchedFiles.Count = 0 Then
        MsgBox("No matching files found in:" & vbNewLine & baseFolder & vbNewLine & vbNewLine & _
               "Make sure the placeholder filenames in the CSV match the files in the folder.")
        Exit Sub
    End If

    ' ── 5. Diagnostic popup ──────────────────────────────────
    Dim diagText As String = "Found " & matchedFiles.Count & " matching file(s) to process:" & vbNewLine & vbNewLine
    For Each f As String In matchedFiles
        Dim nameNoExt As String = System.IO.Path.GetFileNameWithoutExtension(f)
        Dim fExt As String = System.IO.Path.GetExtension(f).ToLowerInvariant()
        Dim dict As Dictionary(Of String, String) = Nothing
        If csvRows.ContainsKey(nameNoExt) Then dict = csvRows(nameNoExt)
        Dim newName As String = If(dict IsNot Nothing AndAlso dict.ContainsKey("NewFileName"), dict("NewFileName"), "")
        Dim arrow As String = If(newName <> "" AndAlso Not newName.Equals(nameNoExt, StringComparison.OrdinalIgnoreCase), "  =>  " & newName & fExt, "  (no rename)")
        diagText &= "  " & nameNoExt & fExt & arrow & vbNewLine
    Next
    diagText &= vbNewLine & "Each file will be opened, iProperties written, renamed, then closed." & vbNewLine
    diagText &= "Includes related .dwg, .idw, and .ipn files." & vbNewLine
    diagText &= "Properties with no value in the CSV (""-"") will be left unchanged." & vbNewLine & vbNewLine
    diagText &= "WARNING: Vault users — ensure files are Checked Out first." & vbNewLine & vbNewLine
    diagText &= "Proceed?"

    Dim diagResult As MsgBoxResult = MsgBox(diagText, MsgBoxStyle.YesNo, "Confirm — Process " & matchedFiles.Count & " File(s)")
    If diagResult = MsgBoxResult.No Then Exit Sub

    ' ── 6. Process each file ─────────────────────────────────
    Dim updated As Integer = 0
    Dim skipped As Integer = 0
    Dim errors  As New List(Of String)()

    ' Suppress iLogic embedded-rule error dialogs during batch processing.
    DialogDismisser.Start()
    Try

    For Each filePath As String In matchedFiles
        Dim nameNoExt As String = System.IO.Path.GetFileNameWithoutExtension(filePath)
        Dim docExt    As String = System.IO.Path.GetExtension(filePath).ToLowerInvariant()
        Dim dict As Dictionary(Of String, String) = Nothing
        If csvRows.ContainsKey(nameNoExt) Then
            dict = csvRows(nameNoExt)
        ElseIf csvRows.ContainsKey(nameNoExt.ToUpperInvariant()) Then
            dict = csvRows(nameNoExt.ToUpperInvariant())
        End If
        If dict Is Nothing Then skipped += 1 : Continue For

        Dim doc As Inventor.Document = Nothing
        Try
            ' Suppress all Inventor/iLogic error dialogs while we work on this file.
            ' This prevents "iProperty Check" or other embedded rules from showing
            ' error popups when the file is opened before we've created missing properties.
            ThisApplication.SilentOperation = True

            doc = ThisApplication.Documents.Open(filePath, True)

            ' ── STEP A: Proactively create ALL required Custom iProperties ──
            ' We create every property from the RequiredProps CSV metadata list
            ' BEFORE any save fires, so embedded rules like "iProperty Check" never
            ' fail with "Cannot find a property named X".
            Dim customPropSet As PropertySet = Nothing
            Try : customPropSet = doc.PropertySets.Item("Inventor User Defined Properties") : Catch : End Try

            If customPropSet IsNot Nothing Then
                ' Build a set of existing custom property names (case-insensitive)
                Dim existingCustom As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase)
                For Each existProp As [Property] In customPropSet
                    existingCustom.Add(existProp.DisplayName)
                Next

                ' 1. Ensure every required Daequip custom property exists (value "-" if new)
                For Each reqName As String In requiredProps
                    If Not existingCustom.Contains(reqName) Then
                        Try : customPropSet.Add("-", reqName) : Catch : End Try
                        existingCustom.Add(reqName)
                    End If
                Next

                ' 2. Also pre-create any additional custom props coming from the CSV
                For Each kvp In dict
                    If kvp.Key.Equals("FileName",    StringComparison.OrdinalIgnoreCase) Then Continue For
                    If kvp.Key.Equals("NewFileName", StringComparison.OrdinalIgnoreCase) Then Continue For
                    If BuiltInProps.GetTab(kvp.Key) <> "Custom" Then Continue For
                    If Not existingCustom.Contains(kvp.Key) Then
                        Dim initVal As String = If(kvp.Value.Trim() = "", "-", kvp.Value.Trim())
                        Try : customPropSet.Add(initVal, kvp.Key) : Catch : End Try
                        existingCustom.Add(kvp.Key)
                    End If
                Next
            End If

            ' ── STEP B: Write all iProperty values ───────────
            ' We avoid iProperties.Value() (which targets the active doc) and write
            ' directly to doc.PropertySets.
            '
            ' For custom properties: look only in the user-defined PropertySet.
            ' For built-in properties: search ALL PropertySets by both DisplayName and
            ' Name — Inventor stores properties like "Description" in "Design Tracking
            ' Properties" while others live in "Inventor Summary Information" etc., and
            ' the set that contains each property can vary by file type and Inventor
            ' version. Searching all sets avoids having to hard-code the mapping.
            For Each kvp In dict
                If kvp.Key.Equals("FileName",    StringComparison.OrdinalIgnoreCase) Then Continue For
                If kvp.Key.Equals("NewFileName", StringComparison.OrdinalIgnoreCase) Then Continue For

                Dim cellValue As String = kvp.Value.Trim()
                If cellValue = "" Then Continue For   ' unchecked in review — skip
                If cellValue = "-" Then Continue For  ' no value — preserve existing property

                Dim tab As String = BuiltInProps.GetTab(kvp.Key)
                If tab = "Custom" Then
                    ' Custom properties — look only in the user-defined PropertySet.
                    If customPropSet IsNot Nothing Then
                        Try
                            For Each p As [Property] In customPropSet
                                If p.DisplayName.Equals(kvp.Key, StringComparison.OrdinalIgnoreCase) Then
                                    p.Value = cellValue : Exit For
                                End If
                            Next
                        Catch : End Try
                    End If
                Else
                    ' Built-in property — scan every PropertySet except the custom one,
                    ' matching on DisplayName first, then internal Name as a fallback.
                    Dim written As Boolean = False
                    For Each ps As PropertySet In doc.PropertySets
                        If written Then Exit For
                        If ps Is customPropSet Then Continue For  ' skip user-defined set
                        Try
                            For Each p As [Property] In ps
                                If p.DisplayName.Equals(kvp.Key, StringComparison.OrdinalIgnoreCase) OrElse
                                   p.Name.Equals(kvp.Key, StringComparison.OrdinalIgnoreCase) Then
                                    p.Value = cellValue
                                    written = True
                                    Exit For
                                End If
                            Next
                        Catch : End Try
                    Next
                End If
            Next

            ' ── STEP C: Save / SaveAs ────────────────────────
            Dim newBaseName As String = ""
            If dict.ContainsKey("NewFileName") Then newBaseName = dict("NewFileName")
            If newBaseName <> "" AndAlso newBaseName <> "-" Then
                Dim folder  As String = System.IO.Path.GetDirectoryName(filePath)
                Dim newPath As String = System.IO.Path.Combine(folder, newBaseName & docExt)
                If String.Compare(newPath, filePath, StringComparison.OrdinalIgnoreCase) <> 0 Then
                    doc.SaveAs(newPath, False)
                Else
                    doc.Save2(False)
                End If
            Else
                doc.Save2(False)
            End If

            doc.Close(True)
            ThisApplication.SilentOperation = False
            updated += 1

        Catch ex As Exception
            ThisApplication.SilentOperation = False
            If doc IsNot Nothing Then
                Try : doc.Close(False) : Catch : End Try
            End If
            errors.Add(nameNoExt & docExt & " — " & ex.Message)
            Dim res As MsgBoxResult = MsgBox("Error processing: " & nameNoExt & docExt & vbNewLine & vbNewLine & _
                "Error: " & ex.Message & vbNewLine & vbNewLine & _
                "Possible causes:" & vbNewLine & _
                "  • File is checked into Vault — check it out first" & vbNewLine & _
                "  • Target filename already exists on disk" & vbNewLine & _
                "  • File is read-only" & vbNewLine & vbNewLine & _
                "Skip this file and continue?", MsgBoxStyle.YesNo, "Error")
            If res = MsgBoxResult.No Then Exit For
            skipped += 1
        End Try
    Next

    Finally
        DialogDismisser.Stop()
    End Try

    ' ── 7. Summary ───────────────────────────────────────────
    Dim summary As String = "Complete!" & vbNewLine & vbNewLine & _
        "  Processed & renamed : " & updated & vbNewLine & _
        "  Skipped / errors    : " & skipped
    If errors.Count > 0 Then
        summary &= vbNewLine & vbNewLine & "Errors:" & vbNewLine
        For Each e As String In errors
            summary &= "  • " & e & vbNewLine
        Next
    End If
    MsgBox(summary, MsgBoxStyle.Information, "Done")
End Sub

Function SplitCSVRow(line As String) As String()
    Dim result As New List(Of String)
    Dim inQuote As Boolean = False
    Dim current As New System.Text.StringBuilder()
    For Each c As Char In line
        If c = Chr(34) Then
            inQuote = Not inQuote
        ElseIf c = ","c AndAlso Not inQuote Then
            result.Add(current.ToString())
            current.Clear()
        Else
            current.Append(c)
        End If
    Next
    result.Add(current.ToString())
    Return result.ToArray()
End Function
`
}

function _buildStyleUpdaterRule() {
  return `' ============================================================
' Inventor iLogic Rule — Update & Purge Styles
' Generated by Configurator Pro
'
' SETUP (do this once per template file):
'   1. Open the template .ipt / .iam / .dwg in Inventor
'   2. iLogic Browser > External Rules > add this file
'   3. Right-click the rule > Properties > set Trigger: "Open Document"
'   4. Save the template
'
'   The rule fires silently every time the file opens.
'   You can also run it manually: right-click the rule > Run
' ============================================================

Imports System.Threading
Imports System.Runtime.InteropServices
Imports System.Text

' ── Background thread: auto-click style dialogs ──────────
' Wrapped in a Module so DllImport attributes and Private members
' are valid (iLogic treats top-level code as a namespace scope).
Module StyleDismisser
    <DllImport("user32.dll", SetLastError:=True, CharSet:=CharSet.Unicode)>
    Private Function FindWindowEx(hWndParent As IntPtr, hWndChildAfter As IntPtr, lpszClass As String, lpszWindow As String) As IntPtr
    End Function

    <DllImport("user32.dll", SetLastError:=True, CharSet:=CharSet.Unicode)>
    Private Function GetWindowText(hWnd As IntPtr, lpString As StringBuilder, nMaxCount As Integer) As Integer
    End Function

    <DllImport("user32.dll", SetLastError:=True)>
    Private Function SendMessage(hWnd As IntPtr, Msg As UInteger, wParam As IntPtr, lParam As IntPtr) As IntPtr
    End Function

    Private Const BM_CLICK As UInteger = &HF5
    Private _running As Boolean = False

    ' Recursively search all child windows for one whose title matches text.
    ' Uses FindWindowEx enumeration instead of EnumChildWindows+delegate so
    ' no delegate type declaration is needed at namespace scope.
    Private Function FindChildByText(parent As IntPtr, text As String) As IntPtr
        Dim child As IntPtr = IntPtr.Zero
        Do
            child = FindWindowEx(parent, child, Nothing, Nothing)
            If child = IntPtr.Zero Then Exit Do
            Dim sb As New StringBuilder(256)
            GetWindowText(child, sb, 256)
            If sb.ToString().Trim().Equals(text, StringComparison.OrdinalIgnoreCase) Then Return child
            Dim deep As IntPtr = FindChildByText(child, text)
            If deep <> IntPtr.Zero Then Return deep
        Loop
        Return IntPtr.Zero
    End Function

    Private Function FindTopWindow(title As String) As IntPtr
        Dim hwnd As IntPtr = IntPtr.Zero
        hwnd = FindWindowEx(IntPtr.Zero, IntPtr.Zero, Nothing, title)
        Return hwnd
    End Function

    Public Sub Start()
        _running = True
        Dim t As New Thread(AddressOf PollLoop)
        t.IsBackground = True
        t.Start()
    End Sub

    Public Sub [Stop]()
        _running = False
    End Sub

    Private Sub PollLoop()
        Dim deadline As DateTime = DateTime.Now.AddSeconds(20)
        Do While _running AndAlso DateTime.Now < deadline
            Thread.Sleep(250)
            ' "Update Styles" — click Yes to All, then OK
            Dim hw As IntPtr = FindTopWindow("Update Styles")
            If hw <> IntPtr.Zero Then
                Dim btnYes As IntPtr = FindChildByText(hw, "Yes to All")
                If btnYes <> IntPtr.Zero Then
                    SendMessage(btnYes, BM_CLICK, IntPtr.Zero, IntPtr.Zero)
                    Thread.Sleep(300)
                End If
                Dim btnOk As IntPtr = FindChildByText(hw, "OK")
                If btnOk <> IntPtr.Zero Then SendMessage(btnOk, BM_CLICK, IntPtr.Zero, IntPtr.Zero)
            End If
            ' "Purge Styles" — click Purge All (or OK)
            hw = FindTopWindow("Purge Styles")
            If hw <> IntPtr.Zero Then
                Dim btnAll As IntPtr = FindChildByText(hw, "Purge All")
                If btnAll <> IntPtr.Zero Then
                    SendMessage(btnAll, BM_CLICK, IntPtr.Zero, IntPtr.Zero)
                Else
                    Dim btnOk As IntPtr = FindChildByText(hw, "OK")
                    If btnOk <> IntPtr.Zero Then SendMessage(btnOk, BM_CLICK, IntPtr.Zero, IntPtr.Zero)
                End If
            End If
        Loop
    End Sub
End Module

' ── Main ─────────────────────────────────────────────────
Sub Main()
    Dim doc As Inventor.Document = ThisDoc.Document
    Dim ext As String = System.IO.Path.GetExtension(doc.FullFileName).ToLowerInvariant()

    If ext = ".ipt" OrElse ext = ".iam" Then
        ' PartDocument / AssemblyDocument — StylesManager exposes UpdateStyles().
        ' That method shows an interactive dialog regardless of SilentOperation,
        ' so a background thread watches for it and clicks through automatically.
        Dim styMgr As Object = Nothing
        If ext = ".ipt" Then
            Try : styMgr = DirectCast(doc, PartDocument).StylesManager : Catch : End Try
        Else
            Try : styMgr = DirectCast(doc, AssemblyDocument).StylesManager : Catch : End Try
        End If
        If styMgr IsNot Nothing Then
            Dim typedDoc As Object = Nothing
            If ext = ".ipt" Then
                typedDoc = DirectCast(doc, PartDocument)
            Else
                typedDoc = DirectCast(doc, AssemblyDocument)
            End If
            StyleDismisser.Start()
            Try : styMgr.UpdateStyles() : Catch : End Try
            ' ── Lighting diagnostic ──────────────────────────────────────────
            Dim diagLines As New System.Collections.Generic.List(Of String)
            diagLines.Add("Before purge — active: " & typedDoc.ActiveLightingStyle.Name)
            Try
                Dim targetStyle As Object = Nothing
                For Each ls As Object In typedDoc.LightingStyles
                    diagLines.Add("  style: " & ls.Name & " loc=" & ls.StyleLocation)
                    If ls.Name.Equals("Default Lights", StringComparison.OrdinalIgnoreCase) Then
                        targetStyle = ls : Exit For
                    End If
                Next
                If targetStyle Is Nothing Then
                    diagLines.Add("DEFAULT LIGHTS NOT FOUND")
                Else
                    diagLines.Add("Found loc=" & targetStyle.StyleLocation)
                    Dim convertErr As String = ""
                    Try
                        targetStyle = targetStyle.ConvertToLocal()
                        diagLines.Add("ConvertToLocal OK, new loc=" & targetStyle.StyleLocation)
                    Catch ex As Exception
                        convertErr = ex.Message
                        diagLines.Add("ConvertToLocal threw: " & convertErr)
                    End Try
                    Try
                        typedDoc.ActiveLightingStyle = targetStyle
                        diagLines.Add("Assign OK — active now: " & typedDoc.ActiveLightingStyle.Name)
                    Catch ex As Exception
                        diagLines.Add("Assign threw: " & ex.Message)
                    End Try
                End If
            Catch ex As Exception
                diagLines.Add("Outer error: " & ex.Message)
            End Try
            MsgBox(String.Join(vbNewLine, diagLines.ToArray()))
            Try : styMgr.PurgeStyles(True) : Catch : End Try
            StyleDismisser.Stop()
        End If

    ElseIf ext = ".dwg" OrElse ext = ".idw" Then
        ' DrawingDocument — DrawingStylesManager has no UpdateStyles() or PurgeStyles().
        ' The correct API is to call UpdateFromGlobal() on each style in the Styles
        ' collection, then delete any style whose InUse property is False.
        Dim styMgr As Object = Nothing
        Try : styMgr = DirectCast(doc, DrawingDocument).StylesManager : Catch : End Try
        If styMgr IsNot Nothing Then
            ' Pass 1: update every style from the global library
            Try
                For Each s As Object In styMgr.Styles
                    Try : s.UpdateFromGlobal() : Catch : End Try
                Next
            Catch : End Try
            ' Pass 2: collect then delete unused styles (two-pass avoids mutating
            ' the collection while iterating it)
            Dim toDelete As New System.Collections.Generic.List(Of Object)
            Try
                For Each s As Object In styMgr.Styles
                    Try
                        If Not s.InUse Then toDelete.Add(s)
                    Catch : End Try
                Next
            Catch : End Try
            For Each s As Object In toDelete
                Try : s.Delete() : Catch : End Try
            Next
        End If
    End If
End Sub
`
}
