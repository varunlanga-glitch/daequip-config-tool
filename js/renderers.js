/* ============================================================
   RENDERERS.JS — DOM Rendering
   ============================================================ */

'use strict';

function renderAll() {
  renderTabs();

  // If active tab is locked, show overlay and skip content render
  if (isTabLocked(State.activeClassId)) {
    renderRightPanelTabs();
    _renderLockedOverlay();
    return;
  }

  _clearLockedOverlay();
  renderContext();
  renderColumnFilter();
  renderGrid();
  renderPartList();
  renderRightPanelTabs();
  if (State.activeRightTab === 'rules')  renderRuleList();
  if (State.activeRightTab === 'config') renderConfigList();
}

function _renderLockedOverlay() {
  // Clear main panels
  document.getElementById('contextBody').innerHTML  = '';
  document.getElementById('columnFilterBar').innerHTML = '';
  document.getElementById('columnFilterBar').style.display = 'none';
  document.getElementById('gridHead').innerHTML = '';
  document.getElementById('gridBody').innerHTML = '';
  document.getElementById('tab-parts').innerHTML  = '';
  document.getElementById('tab-rules').innerHTML  = '';
  document.getElementById('tab-config').innerHTML = '';

  // Show lock overlay in center panel
  let overlay = document.getElementById('lockOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lockOverlay';
    overlay.className = 'lock-overlay';
    const centerBody = document.querySelector('.panel.center .panel-body');
    if (centerBody) centerBody.appendChild(overlay);
  }
  const name = State.productClasses.find(c => c.id === State.activeClassId)?.name || '';
  overlay.innerHTML = `
    <div class="lock-overlay-content">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">${name} is locked</div>
      <p class="lock-desc">This tab is protected by a PIN.</p>
      <button class="btn primary" onclick="unlockTab('${State.activeClassId}', null)">Unlock</button>
    </div>`;
}

function _clearLockedOverlay() {
  const overlay = document.getElementById('lockOverlay');
  if (overlay) overlay.remove();
}

/* ── Right-panel section tab buttons with lock icons ─────── */
function renderRightPanelTabs() {
  const sections = ['parts', 'rules', 'config'];
  sections.forEach(section => {
    const btn = document.querySelector(`.rtab[data-rtab="${section}"]`);
    if (!btn) return;

    // Remove any existing lock icon we added before
    const existing = btn.querySelector('.section-lock-icon');
    if (existing) existing.remove();

    if (section === 'parts') return; // Parts section is not lockable

    const hasLock  = !!(State.lockedSections || {})[`${State.activeClassId}:${section}`];
    const locked   = isSectionLocked(section);

    const icon = document.createElement('span');
    icon.className = 'section-lock-icon';
    icon.title     = hasLock ? (locked ? 'Unlock section' : 'Remove lock') : 'Lock section';
    icon.textContent = hasLock ? (locked ? '🔒' : '🔓') : '🔐';
    icon.onclick = e => {
      e.stopPropagation();
      if (!hasLock)   lockSection(section);
      else if (locked) unlockSection(section, null);
      else             removeSectionLock(section);
    };
    btn.appendChild(icon);
  });
}

/* ── Column visibility filter bar ────────────────────────── */
function renderColumnFilter() {
  const bar = document.getElementById('columnFilterBar');
  if (!bar) return;
  bar.innerHTML = '';
  const props  = getActiveProps();
  const hidden = getHiddenProps();
  if (!props.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const lbl = document.createElement('span');
  lbl.className = 'filter-label'; lbl.textContent = 'COLUMNS:';
  bar.appendChild(lbl);
  props.forEach(p => {
    const isHidden = hidden.includes(p.id);
    const pill = document.createElement('button');
    pill.className = 'col-pill ' + (isHidden ? 'col-pill-off' : 'col-pill-on');
    pill.textContent = p.name;
    pill.title = isHidden ? 'Click to show column' : 'Click to hide column';
    pill.onclick = () => togglePropVisibility(p.id);
    bar.appendChild(pill);
  });
}

/* ── Product-class tab bar ───────────────────────────────── */
function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  State.productClasses.forEach(c => {
    const locked   = isTabLocked(c.id);
    const hasLock  = !!(State.lockedTabs || {})[c.id];
    const isActive = c.id === State.activeClassId;

    const div = document.createElement('div');
    div.className = `tab ${isActive ? 'active' : ''} ${locked ? 'tab-locked' : ''}`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = c.name;
    div.appendChild(nameSpan);

    // Lock/unlock icon
    const lockBtn = document.createElement('span');
    lockBtn.className = 'tab-action lock';
    lockBtn.title     = hasLock ? (locked ? 'Unlock tab' : 'Remove lock') : 'Lock tab with PIN';
    lockBtn.innerHTML = hasLock ? (locked ? '🔒' : '🔓') : '🔐';
    lockBtn.onclick   = e => {
      e.stopPropagation();
      if (!hasLock) {
        lockTab(c.id);
      } else if (locked) {
        unlockTab(c.id, null);
      } else {
        removeTabLock(c.id);
      }
    };
    div.appendChild(lockBtn);

    // Clone button (only if not locked)
    if (!locked) {
      const cloneBtn = document.createElement('span');
      cloneBtn.innerHTML = '⎘';
      cloneBtn.title = 'Clone this tab';
      cloneBtn.className = 'tab-action clone';
      cloneBtn.onclick = e => { e.stopPropagation(); cloneTab(c.id); };
      div.appendChild(cloneBtn);
    }

    // Close button (only when >1 tab and not locked)
    if (State.productClasses.length > 1 && !locked) {
      const closeBtn = document.createElement('span');
      closeBtn.innerHTML = '&times;';
      closeBtn.className = 'tab-action close';
      closeBtn.onclick = e => { e.stopPropagation(); deleteTab(c.id); };
      div.appendChild(closeBtn);
    }

    div.onclick = e => {
      if (e.target === div || e.target === nameSpan) {
        if (locked) {
          unlockTab(c.id, null);
          return;
        }
        State.activeClassId  = c.id;
        State.selectedPartId = null;
        renderAll();
      }
    };

    container.appendChild(div);
  });

  // Center header: editable tab name
  const productNameEl = document.getElementById('productName');
  const activeCls = State.productClasses.find(c => c.id === State.activeClassId);
  productNameEl.textContent = activeCls?.name || '---';
  productNameEl.title = 'Click to rename this tab';
}

/* ── Context panel (left) ────────────────────────────────── */
function renderContext() {
  const body = document.getElementById('contextBody');
  body.innerHTML = '';

  getActiveMaster().forEach(m => {
    const div = document.createElement('div');
    div.className = 'field';

    const sortedVals = [...m.vals].sort((a, b) => a.localeCompare(b));
    const options = sortedVals
      .map(v => `<option value="${v}" ${getActiveContext()[m.key] === v ? 'selected' : ''}>${v}</option>`)
      .join('');

    div.innerHTML = `
      <div class="label"><span>${m.label}</span></div>
      <div class="combo">
        <select onchange="handleContextSelect('${m.key}', this.value)">
          ${options}
          <option value="__NEW__">+ Add New...</option>
        </select>
      </div>`;
    body.appendChild(div);
  });
}

/* ── Centre grid (IDX column hidden) ────────────────────── */
/* ── Session column-width memory (survives renderGrid rebuilds) ── */
const _colWidths = {};   // keyed by colKey string → width in px

function renderGrid() {
  const head      = document.getElementById('gridHead');
  const body      = document.getElementById('gridBody');
  const visProps  = getVisibleProps();          // only visible columns
  const parts     = getActiveParts();
  const idxList   = calculateIndices();

  head.innerHTML = '';

  const makeHeaderCell = (text, cls, colKey) => {
    const th = document.createElement('th');
    th.className        = cls;
    th.dataset.colKey   = colKey;
    th.textContent      = text;
    if (_colWidths[colKey]) th.style.width = _colWidths[colKey] + 'px';
    const handle = document.createElement('div');
    handle.className = 'col-resizer';
    th.appendChild(handle);
    return th;
  };

  // Data columns only — Part column removed
  visProps.forEach(p => head.appendChild(makeHeaderCell(p.name, 'col-prop', p.id)));

  body.innerHTML = '';
  parts.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (p.id === State.selectedPartId) tr.classList.add('selected');
    if ((p.level || 0) > 0) tr.classList.add('row-child');

    // Data cells only — no row-header th
    const rules = getActiveRules()[p.id] || {};

    visProps.forEach(pr => {
      const val = resolveRule(rules[pr.id], p.id);
      const td  = document.createElement('td');
      td.className = 'data-cell';
      td.title     = val;

      const textSpan = document.createElement('span');
      textSpan.className   = 'cell-text';
      textSpan.textContent = val;
      td.appendChild(textSpan);

      if (val) {
        // Char-count badge — appears on row hover, left of copy button
        const charBadge = document.createElement('span');
        charBadge.className   = 'cell-char-badge';
        charBadge.textContent = val.length;
        charBadge.title       = val.length + ' character' + (val.length !== 1 ? 's' : '');
        td.appendChild(charBadge);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'cell-copy-btn';
        copyBtn.title     = 'Copy';
        copyBtn.setAttribute('aria-label', 'Copy value');
        copyBtn.innerHTML = _copyIcon();
        copyBtn.addEventListener('click', e => {
          e.stopPropagation();
          navigator.clipboard.writeText(val).then(() => {
            copyBtn.innerHTML = _checkIcon();
            copyBtn.classList.add('cell-copy-btn--ok');
            setTimeout(() => {
              copyBtn.innerHTML = _copyIcon();
              copyBtn.classList.remove('cell-copy-btn--ok');
            }, 1400);
          });
        });
        td.appendChild(copyBtn);
      }

      tr.appendChild(td);
    });

    tr.onclick = () => { State.selectedPartId = p.id; renderAll(); };
    body.appendChild(tr);
  });

  initColumnResizers();
}

/* ── Right panel: Parts list ─────────────────────────────── */
function renderPartList() {
  const container = document.getElementById('tab-parts');
  container.innerHTML = `
    <div class="tree-controls">
      <button class="btn primary" onclick="addPart('component')" title="Add main component">+ Component</button>
      <button class="btn" onclick="addPart('subcomponent')" title="Add sub-component" style="background:rgba(43,108,176,0.04)">+ Sub-Component</button>
    </div>
    <div class="parts-hint">Drag to reorder &nbsp;·&nbsp; Use <kbd>⇥</kbd> <kbd>⇤</kbd> to indent/outdent</div>`;

  const listWrap = document.createElement('div');
  listWrap.id = 'partsList';
  container.appendChild(listWrap);

  const idxList = calculateIndices();

  getActiveParts().forEach((p, i) => {
    const lvl = p.level || 0;
    const div = document.createElement('div');
    div.className = 'tree-item' +
      (p.id === State.selectedPartId ? ' selected' : '') +
      (lvl > 0 ? ' tree-item-child' : '');
    div.style.marginLeft = lvl > 0 ? (lvl * 22) + 'px' : '';
    div.draggable = true;
    div.dataset.partId    = p.id;
    div.dataset.partIdx   = String(i);
    div.dataset.partLevel = String(lvl);

    // Drag handle
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '&#8942;&#8942;';
    dragHandle.title = 'Drag to reorder · drag far right to nest under a part';

    const idxBadge = document.createElement('span');
    idxBadge.className    = 'idx-badge';
    idxBadge.dataset.edit = 'partIdx';
    idxBadge.dataset.id   = p.id;
    idxBadge.textContent  = p.midx && lvl === 0 ? p.midx : idxList[i];

    const nodeName = document.createElement('span');
    nodeName.className    = 'node-name';
    nodeName.dataset.edit = 'partName';
    nodeName.dataset.id   = p.id;
    nodeName.textContent  = p.name;
    nodeName.id           = `part-name-${p.id}`;

    // Indent / outdent buttons
    const indentWrap = document.createElement('div');
    indentWrap.className = 'indent-btns';

    const outdentBtn = document.createElement('button');
    outdentBtn.className = 'btn indent-btn';
    outdentBtn.title = 'Promote one level up';
    outdentBtn.innerHTML = '&#8676;';
    outdentBtn.style.display = lvl > 0 ? '' : 'none';
    outdentBtn.onclick = e => { e.stopPropagation(); outdentPart(p.id); };

    const indentBtn = document.createElement('button');
    indentBtn.className = 'btn indent-btn';
    indentBtn.title = 'Nest one level deeper';
    indentBtn.innerHTML = '&#8677;';
    // Can indent if: not the first item, and the item above is at level >= this level
    const aboveLvl = i > 0 ? (getActiveParts()[i-1].level || 0) : -1;
    indentBtn.style.display = (i > 0 && lvl <= aboveLvl && lvl < 4) ? '' : 'none';
    indentBtn.onclick = e => { e.stopPropagation(); indentPart(p.id); };

    indentWrap.appendChild(outdentBtn);
    indentWrap.appendChild(indentBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete part';
    delBtn.onclick = e => { e.stopPropagation(); deletePart(p.id); };

    div.appendChild(dragHandle);
    div.appendChild(idxBadge);
    div.appendChild(nodeName);
    div.appendChild(indentWrap);
    div.appendChild(delBtn);

    div.onclick = e => {
      if (!e.target.dataset.edit && !e.target.closest('button')) {
        State.selectedPartId = p.id;
        renderAll();
      }
    };

    listWrap.appendChild(div);
  });

  // Wire up drag & drop after DOM is built
  initPartsDragDrop();
}

/* ── Section lock overlay (Rules / Config) ───────────────── */
function _renderSectionLockOverlay(container, section) {
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  container.innerHTML = `
    <div class="section-lock-overlay">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">${label} is locked</div>
      <p class="lock-desc">Enter the PIN to access this section.</p>
      <button class="btn primary" onclick="unlockSection('${section}', null)">Unlock</button>
    </div>`;
}

/* ── Right panel: Config list ────────────────────────────── */
function renderConfigList() {
  const container = document.getElementById('tab-config');

  if (isSectionLocked('config')) {
    _renderSectionLockOverlay(container, 'config');
    return;
  }

  container.innerHTML = `
    <div class="tree-controls">
      <button class="btn primary" onclick="addVariable()">+ New Variable</button>
    </div>`;

  getActiveMaster().forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'rule-item';

    const header = document.createElement('div');
    header.className = 'rule-header';

    // Label wrap: editable label text + read-only key badge (separate DOM nodes)
    const labelWrap = document.createElement('div');
    labelWrap.className = 'config-label-wrap';

    const labelSpan = document.createElement('span');
    labelSpan.className    = 'config-label-text';
    labelSpan.dataset.edit = 'configLabel';
    labelSpan.dataset.id   = m.key;
    labelSpan.textContent  = m.label;   // label only — key badge is separate

    const keyBadge = document.createElement('span');
    keyBadge.className   = 'config-key-badge';
    keyBadge.textContent = m.key;

    labelWrap.appendChild(labelSpan);
    labelWrap.appendChild(keyBadge);

    const btnContainer = _makeReorderDeleteButtons(
      () => moveItem(getActiveMaster(), i, -1),
      () => moveItem(getActiveMaster(), i,  1),
      () => deleteVariable(m.key)
    );

    header.appendChild(labelWrap);
    header.appendChild(btnContainer);

    const chipsDiv = document.createElement('div');
    chipsDiv.className = 'chips-wrap';
    m.vals.forEach(v => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.appendChild(document.createTextNode(v + ' '));
      const closeSpan = document.createElement('span');
      closeSpan.className = 'close';
      closeSpan.innerHTML = '&times;';
      closeSpan.onclick   = () => removeChip(m.key, v);
      chip.appendChild(closeSpan);
      chipsDiv.appendChild(chip);
    });

    // Add-values row: supports comma-separated input
    const addRow = document.createElement('div');
    addRow.className = 'chip-add-row';
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'chip-input';
    input.placeholder = '+ Add value(s)… comma-separate for multiple';
    const addBtn = document.createElement('button');
    addBtn.className   = 'btn';
    addBtn.textContent = 'Add';
    const doAdd = () => {
      if (!input.value.trim()) return;
      addChips(m.key, input.value);
      input.value = '';
      input.focus();
    };
    addBtn.onclick  = doAdd;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
    addRow.appendChild(input);
    addRow.appendChild(addBtn);

    div.appendChild(header);
    div.appendChild(chipsDiv);
    div.appendChild(addRow);
    container.appendChild(div);
  });
}

/* ── Right panel: Rules list ─────────────────────────────── */
function renderRuleList() {
  const container = document.getElementById('tab-rules');

  if (isSectionLocked('rules')) {
    _renderSectionLockOverlay(container, 'rules');
    return;
  }

  container.innerHTML = `
    <div class="tree-controls">
      <button class="btn primary" onclick="addProp()">+ Add Property Column</button>
    </div>`;

  if (!State.selectedPartId) {
    container.innerHTML += "<div class='small' style='padding:20px'>Select a part from the Parts tab.</div>";
    return;
  }

  const activeRules = getActiveRules();
  if (!activeRules[State.selectedPartId]) activeRules[State.selectedPartId] = {};
  const rules = activeRules[State.selectedPartId];

  getActiveProps().forEach(pr => {
    const div = document.createElement('div');
    div.className = 'rule-item';

    const header = document.createElement('div');
    header.className = 'rule-header';

    // Label wrap with visibility dot
    const labelWrap = document.createElement('div');
    labelWrap.className = 'rule-label-wrap';

    const isHidden = getHiddenProps().includes(pr.id);
    const visBtn = document.createElement('button');
    visBtn.className = 'col-vis-btn ' + (isHidden ? 'col-vis-hidden' : 'col-vis-shown');
    visBtn.title     = isHidden ? 'Column hidden — click to show in grid' : 'Column visible — click to hide';
    visBtn.onclick   = e => { e.stopPropagation(); togglePropVisibility(pr.id); };

    const labelSpan = document.createElement('span');
    labelSpan.className        = 'small';
    labelSpan.style.fontWeight = 'bold';
    labelSpan.dataset.edit     = 'propName';
    labelSpan.dataset.id       = pr.id;
    labelSpan.textContent      = pr.name;

    labelWrap.appendChild(visBtn);
    labelWrap.appendChild(labelSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.innerHTML = '&times;';
    delBtn.onclick   = e => { e.stopPropagation(); deleteProp(pr.id); };

    header.appendChild(labelWrap);
    header.appendChild(delBtn);

    const currentRule = rules[pr.id] || '';

    const resolvedVal = resolveRule(currentRule, State.selectedPartId);

    const textarea = document.createElement('textarea');
    textarea.className = 'rule-textarea';
    textarea.value   = currentRule;

    const preview = document.createElement('div');
    preview.className = 'rule-preview';

    const previewText = document.createElement('span');
    previewText.className   = 'rule-preview-text';
    previewText.textContent = resolvedVal;

    const previewCount = document.createElement('span');
    previewCount.className   = 'rule-preview-count';
    previewCount.textContent = resolvedVal.length;
    previewCount.title       = resolvedVal.length + ' characters';

    preview.appendChild(previewText);
    if (resolvedVal) preview.appendChild(previewCount);

    textarea.oninput = function () {
      updateRule(State.selectedPartId, pr.id, this.value);
      // Update preview text + count live
      let el = this.nextElementSibling;
      if (el && el.classList.contains('token-palette')) el = el.nextElementSibling;
      if (el && el.classList.contains('rule-preview')) {
        const txt = el.querySelector('.rule-preview-text');
        const cnt = el.querySelector('.rule-preview-count');
        const resolved = resolveRule(this.value, State.selectedPartId);
        if (txt) txt.textContent = resolved;
        if (cnt) { cnt.textContent = resolved.length; cnt.style.display = resolved ? '' : 'none'; }
        else if (resolved) {
          const newCnt = document.createElement('span');
          newCnt.className = 'rule-preview-count';
          newCnt.textContent = resolved.length;
          el.appendChild(newCnt);
        }
      }
    };

    const palette = document.createElement('div');
    palette.className = 'token-palette';

    // Wire autocomplete between textarea and palette
    _wireTokenAutocomplete(textarea, palette, pr.id);

    div.appendChild(header);
    div.appendChild(textarea);
    div.appendChild(palette);
    div.appendChild(preview);
    container.appendChild(div);
  });
}

/* ── Internal: shared reorder+delete button group ────────── */
function _makeReorderDeleteButtons(onUp, onDown, onDelete) {
  const c = document.createElement('div');
  c.style.cssText = 'display:flex;gap:2px';

  const up = document.createElement('button');
  up.className = 'btn'; up.textContent = '▲';
  up.onclick   = e => { e.stopPropagation(); onUp(); };

  const dn = document.createElement('button');
  dn.className = 'btn'; dn.textContent = '▼';
  dn.onclick   = e => { e.stopPropagation(); onDown(); };

  const del = document.createElement('button');
  del.className = 'btn danger'; del.innerHTML = '&times;';
  del.onclick   = e => { e.stopPropagation(); onDelete(); };

  c.appendChild(up);
  c.appendChild(dn);
  c.appendChild(del);
  return c;
}

/* ── Token autocomplete for rule textareas ───────────────── */
/**
 * Wires up a live token suggestion palette below each rule textarea.
 *
 * Behaviour:
 *   Focus  → show full palette: unused tokens first, already-used dimmed
 *   Input  → filter to tokens whose key starts with the word at the cursor
 *   Click  → insert / replace the partial word with the full token key
 *   Blur   → hide palette (150 ms delay so clicks register first)
 *   Escape → hide palette, keep cursor in textarea
 *
 * Tokens:
 *   Built-in : IDX (part index), NAME (part name)
 *   Dynamic  : every key in the active master variable list
 */
function _wireTokenAutocomplete(textarea, palette, propId) {

  /* Returns all available token descriptors */
  const getTokens = () => {
    const builtins = [
      { key: 'IDX',  label: 'IDX',  desc: 'Auto-calculated part index' },
      { key: 'NAME', label: 'NAME', desc: 'Part name' },
    ];
    const dynamic = getActiveMaster().map(m => ({
      key:   m.key,
      label: m.label,
      desc:  m.key,
    }));
    return [...builtins, ...dynamic];
  };

  /* The partial UPPERCASE word the user is typing up to the cursor */
  const getCurrentWord = () => {
    const pos  = textarea.selectionStart;
    const text = textarea.value.substring(0, pos);
    const m    = text.match(/[A-Za-z0-9_]*$/);
    return m ? m[0].toUpperCase() : '';
  };

  /* Replace the current partial word with `token` then update live preview */
  const insertToken = token => {
    const pos    = textarea.selectionStart;
    const before = textarea.value.substring(0, pos);
    const after  = textarea.value.substring(pos);
    const word   = getCurrentWord();
    const newBefore = before.substring(0, before.length - word.length) + token;
    textarea.value  = newBefore + after;
    const newPos    = newBefore.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    renderPalette('');
  };

  /* True when the token key appears as a whole word in the current formula */
  const isUsed = (formula, key) =>
    new RegExp('\\b' + key + '\\b').test(formula);

  /* Build / refresh the palette DOM for the given prefix filter */
  const renderPalette = prefix => {
    palette.innerHTML = '';
    const tokens  = getTokens();
    const formula = textarea.value;
    const upper   = prefix.toUpperCase();

    /* Split into: matches-prefix vs rest (only shown when no active prefix) */
    const matching = tokens.filter(t => t.key.startsWith(upper));
    const rest     = prefix ? [] : tokens.filter(t => !t.key.startsWith(upper));

    /* Sort each group: unused first, then already-in-formula */
    const sort = arr => [
      ...arr.filter(t => !isUsed(formula, t.key)),
      ...arr.filter(t =>  isUsed(formula, t.key)),
    ];

    const ordered = [...sort(matching), ...sort(rest)];

    if (ordered.length === 0) { palette.style.display = 'none'; return; }
    palette.style.display = 'flex';

    ordered.forEach(t => {
      const used     = isUsed(formula, t.key);
      const inMatch  = t.key.startsWith(upper);
      const isDimmed = !inMatch && !prefix;

      const btn = document.createElement('button');
      btn.className = 'token-pill' +
        (used    ? ' token-used' : ' token-new') +
        (isDimmed ? ' token-dim' : '');
      btn.title = t.label + (used ? ' — already used' : ' — click to insert');

      if (prefix && inMatch) {
        /* Highlight the typed portion */
        const hi  = document.createElement('mark');
        hi.className   = 'token-match';
        hi.textContent = t.key.substring(0, upper.length);
        btn.appendChild(hi);
        btn.appendChild(document.createTextNode(t.key.substring(upper.length)));
      } else {
        btn.textContent = t.key;
      }

      /* Sub-label for dynamic variables (human name) */
      if (t.label !== t.key) {
        const sub = document.createElement('span');
        sub.className   = 'token-sub';
        sub.textContent = t.label;
        btn.appendChild(sub);
      }

      /* Mousedown so the click fires before textarea blur */
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        insertToken(t.key);
      });

      palette.appendChild(btn);
    });
  };

  /* ── Wire events ── */
  let blurTimer = null;

  textarea.addEventListener('focus', () => {
    clearTimeout(blurTimer);
    renderPalette(getCurrentWord());
  });

  textarea.addEventListener('input', () => {
    renderPalette(getCurrentWord());
  });

  /* Cursor move (arrows) can change the current word */
  textarea.addEventListener('keyup', e => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
      renderPalette(getCurrentWord());
    }
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') { palette.style.display = 'none'; }
  });

  textarea.addEventListener('blur', () => {
    blurTimer = setTimeout(() => { palette.style.display = 'none'; }, 150);
  });
}

/* ── SVG icon helpers for copy button ───────────────────── */
function _copyIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}
function _checkIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}
