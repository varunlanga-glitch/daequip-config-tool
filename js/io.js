/* ============================================================
   IO.JS — Persistence & Export
   ============================================================ */

'use strict';

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

  let csv = 'IDX,Part Name,' + props.map(p => `"${p.name}"`).join(',') + '\n';
  parts.forEach((p, i) => {
    const rules = getActiveRules()[p.id] || {};
    const row = [
      idxList[i],
      `"${p.name}"`,
      ...props.map(pr => `"${resolveRule(rules[pr.id], p.id)}"`)
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

/* ── Autosave to localStorage ────────────────────────────── */
let _autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    if (!State.dirty) return;
    try {
      const { dirty, ...saveState } = State;
      localStorage.setItem(_autosaveKey(), JSON.stringify({
        timestamp: Date.now(),
        state: saveState
      }));
    } catch(e) { /* storage full — silently skip */ }
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
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Toolbar button wiring ───────────────────────────────── */
document.getElementById('btnSave').addEventListener('click',           saveCheckpoint);
document.getElementById('btnExportInventor').addEventListener('click', exportInventor);
document.getElementById('btnNewTab').addEventListener('click',         newTab);
document.getElementById('btnPublish').addEventListener('click',        () => openPublishModal());
document.getElementById('btnHistory').addEventListener('click',        () => openHistoryModal());
document.getElementById('btnHome').addEventListener('click',           () => goHome());

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
      `<span class="imap-review-partname">${p.name}</span>` +
      `<span class="imap-review-newname" title="Current: ${currentName}">${generatedName}</span>`;
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
        <td class="imap-col-name">${p.name}</td>
        <td>
          <select class="imap-select" data-pid="${p.id}">${opts}
            ${isCustom ? `<option value="${current}" selected>${current}</option>` : ''}
          </select>
          <input class="imap-custom" data-pid="${p.id}" placeholder="Custom iProperty name"
            style="display:${isCustom ? 'inline-block' : 'none'}" value="${isCustom ? current : ''}">
        </td>
      </tr>`;
  }).join('');

  // ── File name linking — part name → linked actual file ──
  const fileRows = parts.map(p => {
    const generated = resolveFileNameRule(p.id) || p.name;
    const linked   = overrides[p.id] || '';
    const hasLink  = !!linked;
    return `<tr data-partid="${p.id}">
      <td class="imap-col-name" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${generated}">${generated}</td>
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
      <button class="btn" id="imapBtnPreview">👁 Preview CSV</button>
      <button class="btn btn-confirm" id="imapBtnExport" disabled>⬇ Download Files</button>
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
      // Enable Download only on Review tab
      const exportBtn = document.getElementById('imapBtnExport');
      if (exportBtn) exportBtn.disabled = tab.dataset.itab !== 'review';
    };
  });

  // ── Custom iProperty input toggle ──
  box.querySelectorAll('.imap-select').forEach(sel => {
    const pid = sel.dataset.pid;
    const ci  = box.querySelector(`.imap-custom[data-pid="${pid}"]`);
    sel.onchange = () => { ci.style.display = sel.value === '__custom__' ? 'inline-block' : 'none'; };
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
        if (window.showOpenFilePicker) {
          const [fh] = await window.showOpenFilePicker({
            types: [{ description: 'Inventor Files', accept: { 'application/octet-stream': ['.ipt','.iam','.idw'] } }],
            multiple: false
          });
          name = fh.name.replace(/\.[^.]+$/, '');
        } else {
          await new Promise(res => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.ipt,.iam,.idw';
            inp.onchange = () => { name = inp.files[0]?.name.replace(/\.[^.]+$/, '') || ''; res(); };
            inp.click();
          });
        }
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

  box.querySelector('#imapBtnPreview').onclick = () => {
    const { mapping } = collectMap();
    const exportSel = (State.exportSelections || {})[State.activeClassId] || {};
    const csv = _buildInventorCSV(mapping, exportSel);
    const w = window.open('', '_blank');
    w.document.write(`<pre style="font-family:monospace;font-size:12px;padding:20px">${csv.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`);
  };

  box.querySelector('#imapBtnExport').onclick = () => {
    const { mapping } = collectMap();
    map.mapping = mapping;

    const exportSel = (State.exportSelections || {})[State.activeClassId] || {};
    const csv = _buildInventorCSV(mapping, exportSel);
    const ilogic = _buildILogicScript();

    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5);
    const className = State.productClasses.find(c => c.id === State.activeClassId)?.name || 'export';
    _downloadBlob(csv,     'text/csv',   `${className}-inventor-${timestamp}.csv`);
    _downloadBlob(ilogic,  'text/plain', `ConfiguratorPro-SetIProperties.iLogicVb`);
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
    ...otherProps.map(p => `"${mapping[p.id]}"`)
  ].join(',');

  const rows = parts.map(p => {
    const generatedName = resolveFileNameRule(p.id) || p.name;
    const currentName   = overrides[p.id] || generatedName;
    const partSel       = sel[p.id] || { rename: true, props: {} };

    // If rename is unchecked, NewFileName === FileName → iLogic rename branch is a no-op
    const newFileName = partSel.rename !== false ? generatedName : currentName;

    const cells = [
      `"${currentName}"`,   // FileName — what to match in Inventor
      `"${newFileName}"`,   // NewFileName — rename target (same as current when unchecked)
      ...otherProps.map(pr => {
        if (partSel.props[pr.id] === false) return '""'; // unchecked → empty, iLogic skips
        const partRules = getActiveRules()[p.id] || {};
        const val = resolveRule(partRules[pr.id], p.id);
        return `"${val || '-'}"`;
      })
    ];
    return cells.join(',');
  });

  return [header, ...rows].join('\n');
}

function _buildILogicScript() {
  return `' ============================================================
' Inventor iLogic Rule — Set iProperties & Rename Files
' Generated by Configurator Pro
'
' UNIVERSAL SCRIPT — add this to Inventor once, reuse forever.
' Only the CSV file changes between projects.
'
' WORKFLOW:
'   1. In iLogic Browser > External Rules > add this file > right-click > Run
'   2. Browse to the CSV exported from Configurator Pro
'   3. Browse to the base folder containing your placeholder .ipt/.iam files
'   4. Script finds all files recursively, processes them automatically
'   5. No need to open files manually — script opens, updates, renames and closes each one
'
' Vault users: ensure files are Checked Out before running.
' ============================================================

Imports System.Collections.Generic
Imports System.Windows.Forms
Imports System.IO

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

Sub Main()
    ' ── 1. Pick CSV ──────────────────────────────────────────
    Dim csvDlg As New OpenFileDialog()
    csvDlg.Title  = "Step 1 of 2 — Select Configurator Pro CSV"
    csvDlg.Filter = "CSV Files (*.csv)|*.csv|All Files (*.*)|*.*"
    If csvDlg.ShowDialog() <> DialogResult.OK Then MsgBox("Cancelled.") : Exit Sub
    Dim csvPath As String = csvDlg.FileName

    ' ── 2. Pick base folder ───────────────────────────────────
    Dim folderDlg As New FolderBrowserDialog()
    folderDlg.Description   = "Step 2 of 2 — Select the base folder containing your placeholder Inventor files"
    folderDlg.ShowNewFolderButton = False
    If folderDlg.ShowDialog() <> DialogResult.OK Then MsgBox("Cancelled.") : Exit Sub
    Dim baseFolder As String = folderDlg.SelectedPath

    ' ── 3. Parse CSV ─────────────────────────────────────────
    Dim allLines() As String = File.ReadAllLines(csvPath)
    If allLines.Length < 2 Then MsgBox("CSV appears empty.") : Exit Sub

    Dim headers() As String = SplitCSVRow(allLines(0))
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
    For i As Integer = 1 To allLines.Length - 1
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
        Dim noExt As String = Path.GetFileNameWithoutExtension(fname)
        If Not csvRows.ContainsKey(noExt) Then csvRows(noExt) = props
    Next

    ' ── 4. Scan folder recursively for .ipt and .iam files ───
    Dim allFiles() As String = Directory.GetFiles(baseFolder, "*.*", SearchOption.AllDirectories)
    Dim matchedFiles As New List(Of String)()
    For Each f As String In allFiles
        Dim ext As String = Path.GetExtension(f).ToLowerInvariant()
        If ext <> ".ipt" AndAlso ext <> ".iam" Then Continue For
        Dim nameNoExt As String = Path.GetFileNameWithoutExtension(f)
        If csvRows.ContainsKey(nameNoExt) OrElse csvRows.ContainsKey(nameNoExt.ToUpperInvariant()) Then
            matchedFiles.Add(f)
        End If
    Next

    If matchedFiles.Count = 0 Then
        MsgBox("No matching files found in:" & vbNewLine & baseFolder & vbNewLine & vbNewLine & _
               "Make sure the placeholder filenames in the CSV match the files in the folder.")
        Exit Sub
    End If

    ' ── 5. Diagnostic popup ──────────────────────────────────
    Dim diagText As String = "Found " & matchedFiles.Count & " matching file(s) to process:" & vbNewLine & vbNewLine
    For Each f As String In matchedFiles
        Dim nameNoExt As String = Path.GetFileNameWithoutExtension(f)
        Dim dict As Dictionary(Of String, String) = Nothing
        If csvRows.ContainsKey(nameNoExt) Then dict = csvRows(nameNoExt)
        Dim newName As String = If(dict IsNot Nothing AndAlso dict.ContainsKey("NewFileName"), dict("NewFileName"), "")
        Dim arrow As String = If(newName <> "" AndAlso Not newName.Equals(nameNoExt, StringComparison.OrdinalIgnoreCase), "  =>  " & newName, "  (no rename)")
        diagText &= "  " & nameNoExt & arrow & vbNewLine
    Next
    diagText &= vbNewLine & "Each file will be opened, iProperties written, renamed, then closed." & vbNewLine
    diagText &= "Blank property values will be written as ""-""." & vbNewLine & vbNewLine
    diagText &= "WARNING: Vault users — ensure files are Checked Out first." & vbNewLine & vbNewLine
    diagText &= "Proceed?"

    Dim diagResult As MsgBoxResult = MsgBox(diagText, MsgBoxStyle.YesNo, "Confirm — Process " & matchedFiles.Count & " File(s)")
    If diagResult = MsgBoxResult.No Then Exit Sub

    ' ── 6. Process each file ─────────────────────────────────
    Dim updated As Integer = 0
    Dim skipped As Integer = 0
    Dim errors  As New List(Of String)()

    For Each filePath As String In matchedFiles
        Dim nameNoExt As String = Path.GetFileNameWithoutExtension(filePath)
        Dim docExt    As String = Path.GetExtension(filePath).ToLowerInvariant()
        Dim dict As Dictionary(Of String, String) = Nothing
        If csvRows.ContainsKey(nameNoExt) Then
            dict = csvRows(nameNoExt)
        ElseIf csvRows.ContainsKey(nameNoExt.ToUpperInvariant()) Then
            dict = csvRows(nameNoExt.ToUpperInvariant())
        End If
        If dict Is Nothing Then skipped += 1 : Continue For

        Dim doc As Inventor.Document = Nothing
        Try
            ' Open the file (invisible open for speed, then activate for iLogic)
            doc = ThisApplication.Documents.Open(filePath, True)
            doc.Activate()

            ' ── Write iProperties from CSV columns ───────────
            For Each kvp In dict
                If kvp.Key.Equals("FileName",    StringComparison.OrdinalIgnoreCase) Then Continue For
                If kvp.Key.Equals("NewFileName", StringComparison.OrdinalIgnoreCase) Then Continue For
                Dim tab As String = BuiltInProps.GetTab(kvp.Key)
                Try
                    iProperties.Value(tab, kvp.Key) = kvp.Value
                Catch
                    ' Skip properties that fail silently
                End Try
            Next

            ' ── Rename: SaveAs to new name in same folder ────
            Dim newBaseName As String = ""
            If dict.ContainsKey("NewFileName") Then newBaseName = dict("NewFileName")
            If newBaseName <> "" AndAlso newBaseName <> "-" Then
                Dim folder  As String = Path.GetDirectoryName(filePath)
                Dim newPath As String = Path.Combine(folder, newBaseName & docExt)
                If String.Compare(newPath, filePath, StringComparison.OrdinalIgnoreCase) <> 0 Then
                    doc.SaveAs(newPath, False)
                Else
                    doc.Save2(False)
                End If
            Else
                doc.Save2(False)
            End If

            doc.Close(True)
            updated += 1

        Catch ex As Exception
            If doc IsNot Nothing Then
                Try : doc.Close(False) : Catch : End Try
            End If
            errors.Add(nameNoExt & " — " & ex.Message)
            Dim res As MsgBoxResult = MsgBox("Error processing: " & nameNoExt & vbNewLine & vbNewLine & _
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
