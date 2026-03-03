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
    _downloadBlob(JSON.stringify(State, null, 2), 'application/json', `${safeName}.json`);
    _downloadBlob(generateHTMLBackup(), 'text/html', `${safeName}_backup.html`);
  });
}

/* ── Load checkpoint ─────────────────────────────────────── */
function loadCheckpoint() {
  document.getElementById('fileInput').click();
}

document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = event => {
    try {
      const loaded = JSON.parse(event.target.result);
      showConfirm(
        'Load Checkpoint',
        'Load this checkpoint? Current data will be replaced.',
        () => {
          // Mutate State in-place — cannot reassign a binding from another script scope
          Object.keys(State).forEach(k => delete State[k]);
          Object.assign(State, loaded);
          migrateState();
          renderAll();
        }
      );
    } catch (err) {
      showConfirm('Error', 'Error loading file: ' + err.message, () => {});
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ── CSV export ──────────────────────────────────────────── */
function exportCSV() {
  const props   = getActiveProps();
  const parts   = getActiveParts();
  const idxList = calculateIndices();

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

/* ── HTML backup generator ───────────────────────────────── */
function generateHTMLBackup() {
  const stateScript = `
<script id="saved-state">
(function(){
  var savedState=${JSON.stringify(State)};
  if(typeof State!=='undefined'){
    Object.keys(State).forEach(k => delete State[k]);
    Object.assign(State,savedState);
    if(typeof renderAll==='function') renderAll();
  }
})();
<\/script>`;
  return document.documentElement.outerHTML.replace('</body>', stateScript + '\n</body>');
}

/* ── Data migration ──────────────────────────────────────── */
/**
 * Converts legacy data conventions to the current model:
 * - Parts with a midx containing "-" are child parts; set level=1 and clear midx.
 * - Ensures every part has a `level` property (defaults to 0).
 */
function migrateState() {
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
    });
  });
}

/* ── Seed data loader ────────────────────────────────────── */
function loadSeedData(url) {
  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      Object.assign(State, data);
      migrateState();
      renderAll();
    })
    .catch(() => {
      // Seed file unavailable — use default State from state.js.
      renderAll();
    });
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
document.getElementById('btnSave').addEventListener('click',   saveCheckpoint);
document.getElementById('btnLoad').addEventListener('click',   loadCheckpoint);
document.getElementById('btnExport').addEventListener('click', exportCSV);
document.getElementById('btnNewTab').addEventListener('click', newTab);
