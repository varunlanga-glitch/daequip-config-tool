/* ============================================================
   UI.JS — UI Interactions (Dialogs, Inline Edit, Resizers)
   ============================================================ */

'use strict';

/* ── Confirmation dialog ─────────────────────────────────── */
function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';

  const box = document.createElement('div');
  box.className = 'confirm-box';
  box.innerHTML = `
    <div class="confirm-title">${title}</div>
    <div class="confirm-message">${message}</div>
    <div class="confirm-buttons">
      <button class="btn btn-cancel">Cancel</button>
      <button class="btn btn-confirm">Delete</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  box.querySelector('.btn-cancel').onclick  = close;
  box.querySelector('.btn-confirm').onclick = () => { onConfirm(); close(); };
  overlay.onclick = e => { if (e.target === overlay) close(); };
  setTimeout(() => box.querySelector('.btn-confirm').focus(), 10);
}

/* ── Prompt dialog ───────────────────────────────────────── */
function showPrompt(title, message, defaultValue, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';

  const box = document.createElement('div');
  box.className = 'confirm-box';
  box.innerHTML = `
    <div class="confirm-title">${title}</div>
    <div class="confirm-message">${message}</div>
    <input type="text" class="combo" value="${defaultValue}" style="margin-bottom:16px">
    <div class="confirm-buttons">
      <button class="btn btn-cancel">Cancel</button>
      <button class="btn btn-confirm" style="background:var(--accent);border-color:var(--accent);color:white">Save</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = box.querySelector('input');
  const close = () => overlay.remove();
  const save  = () => {
    const value = input.value.trim();
    if (value) { onConfirm(value); close(); }
  };

  box.querySelector('.btn-cancel').onclick  = close;
  box.querySelector('.btn-confirm').onclick = save;
  input.onkeydown = e => {
    if (e.key === 'Enter')  save();
    if (e.key === 'Escape') close();
  };
  overlay.onclick = e => { if (e.target === overlay) close(); };
  setTimeout(() => { input.focus(); input.select(); }, 10);
}

/* ── Right-panel tab switching ───────────────────────────── */
function switchRightTab(tabName) {
  State.activeRightTab = tabName;

  document.querySelectorAll('.rtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rtab === tabName);
  });

  document.getElementById('tab-parts').style.display  = tabName === 'parts'  ? 'block' : 'none';
  document.getElementById('tab-rules').style.display  = tabName === 'rules'  ? 'block' : 'none';
  document.getElementById('tab-config').style.display = tabName === 'config' ? 'block' : 'none';

  renderRightPanelTabs();
  if (tabName === 'rules')  renderRuleList();
  if (tabName === 'config') renderConfigList();
}

/* ── Center header: click-to-rename active tab ───────────── */
function startProductNameEdit() {
  const el = document.getElementById('productName');
  if (!el || el.querySelector('input')) return;   // already editing

  const currentName = State.productClasses.find(c => c.id === State.activeClassId)?.name || '';

  const input = document.createElement('input');
  input.value     = currentName;
  input.className = 'product-name-input';
  el.textContent  = '';
  el.appendChild(input);
  input.focus();
  input.select();

  const save = () => {
    const val = input.value.trim();
    renameActiveTab(val || currentName);
  };

  input.onblur    = save;
  input.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); renderAll(); }
  };
}

document.getElementById('productName').addEventListener('click', startProductNameEdit);

/* ── Inline double-click editing ─────────────────────────── */
/* configLabel delegates to _startConfigLabelEdit (actions.js) which reads  */
/* the raw label from State — prevents the repeating "(KEY)" bug.           */
document.body.addEventListener('dblclick', e => {
  const el = e.target.closest('[data-edit]');
  if (!el) return;

  const type = el.dataset.edit;
  const id   = el.dataset.id;   // capture BEFORE replaceWith removes el from DOM

  if (type === 'className') return;

  // Delegate config label edits: _startConfigLabelEdit handles key derivation
  if (type === 'configLabel') {
    _startConfigLabelEdit(el, id);
    return;
  }

  // Generic handler for partName, partIdx, propName
  const currentText = el.textContent.trim();
  const input = document.createElement('input');
  input.value     = currentText;
  input.className = 'combo';
  el.replaceWith(input);
  input.focus();
  input.select();

  const saveEdit = () => {
    const val = input.value.trim();
    if (val) {
      if (type === 'partName') { const p = getActiveParts().find(p => p.id === id); if (p) p.name = val; }
      if (type === 'partIdx')  { const p = getActiveParts().find(p => p.id === id); if (p) p.midx = val; }
      if (type === 'propName') { const p = getActiveProps().find(p => p.id === id);  if (p) p.name = val; }
    }
    renderAll();
  };

  input.onblur    = saveEdit;
  input.onkeydown = e => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') renderAll();
  };
});

/* ── Right-panel tab button wiring ───────────────────────── */
document.querySelectorAll('.rtab').forEach(btn => {
  btn.addEventListener('click', () => switchRightTab(btn.dataset.rtab));
});

/* ── Panel drag-to-resize (left & right panels) ──────────── */
function initResizers() {
  const resizer1   = document.getElementById('resizer1');
  const resizer2   = document.getElementById('resizer2');
  const leftPanel  = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');

  let isResizing     = false;
  let currentResizer = null;
  let startX         = 0;
  let startWidth     = 0;

  const startResize = (resizer, panel) => e => {
    isResizing     = true;
    currentResizer = resizer;
    startX         = e.clientX;
    startWidth     = panel.offsetWidth;
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  resizer1.addEventListener('mousedown', startResize(resizer1, leftPanel));
  resizer2.addEventListener('mousedown', startResize(resizer2, rightPanel));

  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    if (currentResizer === resizer1) {
      const w = startWidth + (e.clientX - startX);
      if (w >= 200 && w <= 600) leftPanel.style.width = w + 'px';
    } else if (currentResizer === resizer2) {
      const w = startWidth - (e.clientX - startX);
      if (w >= 300 && w <= 800) rightPanel.style.width = w + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isResizing     = false;
    currentResizer = null;
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });
}

initResizers();

/* ── Table column drag-to-resize ─────────────────────────── */
function initColumnResizers() {
  document.querySelectorAll('#gridHead .col-resizer').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const th     = handle.parentElement;
      const startX = e.clientX;
      const startW = th.offsetWidth;
      handle.classList.add('active');

      const onMove = e => {
        const newW = Math.max(60, startW + (e.clientX - startX));
        th.style.width = newW + 'px';
      };
      const onUp = () => {
        handle.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        // Persist width for session duration
        const colKey = th.dataset.colKey;
        if (colKey) _colWidths[colKey] = th.offsetWidth;
      };

      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

/* ── Parts list drag-and-drop resequencing + nest-on-drag-right ─ */
let _dragSrcId   = null;
let _dragStartX  = 0;       // clientX where drag began
let _dropTarget  = null;
let _dropBefore  = true;
let _nestMode    = false;   // true when user is dragging far right → nest intent

const NEST_THRESHOLD = 65;  // px of rightward drift to trigger nest mode

function initPartsDragDrop() {
  const items = document.querySelectorAll('#partsList .tree-item');
  if (!items.length) return;

  items.forEach(item => {
    item.addEventListener('dragstart', e => {
      _dragSrcId  = item.dataset.partId;
      _dragStartX = e.clientX;
      _nestMode   = false;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragSrcId);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      _clearDropIndicator();
      _dragSrcId  = null;
      _dropTarget = null;
      _nestMode   = false;
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!_dragSrcId || item.dataset.partId === _dragSrcId) return;

      // Detect nest intent: significant rightward horizontal movement
      const driftX  = e.clientX - _dragStartX;
      _nestMode     = driftX > NEST_THRESHOLD;

      const rect  = item.getBoundingClientRect();
      const midY  = rect.top + rect.height / 2;
      _dropBefore = e.clientY < midY;

      _clearDropIndicator();
      _dropTarget = item;

      if (_nestMode) {
        item.classList.add('drop-nest');
        e.dataTransfer.dropEffect = 'move';
      } else {
        item.classList.add(_dropBefore ? 'drop-before' : 'drop-after');
        e.dataTransfer.dropEffect = 'move';
      }
    });

    item.addEventListener('dragleave', e => {
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove('drop-before', 'drop-after', 'drop-nest');
      }
    });

    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!_dragSrcId) return;

      const targetId = item.dataset.partId;
      if (targetId === _dragSrcId) return;

      if (_nestMode) {
        // Nest the dragged part as a child of the target
        _clearDropIndicator();
        nestPart(_dragSrcId, targetId);
      } else {
        // Normal reorder
        const parts = getActiveParts();
        const ids   = parts.map(p => p.id);
        const srcI  = ids.indexOf(_dragSrcId);
        const tgtI  = ids.indexOf(targetId);
        if (srcI === -1 || tgtI === -1) return;

        const [moved] = ids.splice(srcI, 1);
        let insertAt  = ids.indexOf(targetId);
        if (!_dropBefore) insertAt++;
        ids.splice(insertAt, 0, moved);

        _clearDropIndicator();
        reorderParts(ids);
      }
    });
  });
}

function _clearDropIndicator() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-nest').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'drop-nest');
  });
}
