/* ============================================================
   RENDERERS.JS — DOM Rendering
   ============================================================ */

'use strict';

function renderAll() {
  if (typeof _updateDirtyIndicator === 'function') _updateDirtyIndicator();

  // Home screen — delegate entirely to categories.js
  if (window._appScreen !== 'workspace') {
    if (typeof renderHomeScreen === 'function') renderHomeScreen();
    return;
  }

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
  overlay.innerHTML = '';
  const content = document.createElement('div');
  content.className = 'lock-overlay-content';
  const lockIcon = document.createElement('div');
  lockIcon.className = 'lock-icon';
  lockIcon.textContent = '🔒';
  const lockTitle = document.createElement('div');
  lockTitle.className = 'lock-title';
  lockTitle.textContent = name + ' is locked';
  const lockDesc = document.createElement('p');
  lockDesc.className = 'lock-desc';
  lockDesc.textContent = 'This tab is protected by a PIN.';
  const unlockBtn = document.createElement('button');
  unlockBtn.className = 'btn primary';
  unlockBtn.textContent = 'Unlock';
  unlockBtn.onclick = () => unlockTab(State.activeClassId, null);
  content.appendChild(lockIcon);
  content.appendChild(lockTitle);
  content.appendChild(lockDesc);
  content.appendChild(unlockBtn);
  overlay.appendChild(content);
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
    pill.title          = isHidden ? 'Click to show column' : 'Click to hide column';
    pill.dataset.propId = p.id;
    pill.onclick = () => togglePropVisibility(p.id);
    bar.appendChild(pill);
  });
}

/* ── Product-class tab bar (dropdown) ───────────────────── */
function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  const activeCls = State.productClasses.find(c => c.id === State.activeClassId);
  const locked    = isTabLocked(State.activeClassId);
  const hasLock   = !!(State.lockedTabs || {})[State.activeClassId];

  // Dropdown select (alpha-sorted display; underlying array order unchanged)
  const select = document.createElement('select');
  select.className = 'tab-select';
  [...State.productClasses]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (isTabLocked(c.id) ? ' 🔒' : '');
      opt.selected = c.id === State.activeClassId;
      select.appendChild(opt);
    });
  select.onchange = () => {
    const chosen = State.productClasses.find(c => c.id === select.value);
    if (!chosen) return;
    if (isTabLocked(chosen.id)) {
      select.value = State.activeClassId; // revert visual selection
      unlockTab(chosen.id, () => {
        State.activeClassId  = chosen.id;
        State.selectedPartId = null;
        renderAll();
      });
      return;
    }
    State.activeClassId  = chosen.id;
    State.selectedPartId = null;
    renderAll();
  };
  container.appendChild(select);

  // Rename button (active unlocked tab only)
  if (!locked) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn tab-act-btn';
    editBtn.title = 'Rename tab';
    editBtn.textContent = '✏️';
    editBtn.onclick = () => startProductNameEdit();
    container.appendChild(editBtn);
  }

  // Lock/unlock button
  const lockBtn = document.createElement('button');
  lockBtn.className = 'btn tab-act-btn';
  lockBtn.title   = hasLock ? (locked ? 'Unlock tab' : 'Remove lock') : 'Lock tab with PIN';
  lockBtn.textContent = hasLock ? (locked ? '🔒' : '🔓') : '🔐';
  lockBtn.onclick = () => {
    if (!hasLock)    lockTab(State.activeClassId);
    else if (locked) unlockTab(State.activeClassId, null);
    else             removeTabLock(State.activeClassId);
  };
  container.appendChild(lockBtn);

  // Clone button (active unlocked tab only)
  if (!locked) {
    const cloneBtn = document.createElement('button');
    cloneBtn.className = 'btn tab-act-btn';
    cloneBtn.title = 'Duplicate tab';
    cloneBtn.innerHTML = _duplicateIcon(13);
    cloneBtn.onclick = () => cloneTab(State.activeClassId);
    container.appendChild(cloneBtn);
  }

  // Delete button (only when >1 tab and not locked)
  if (State.productClasses.length > 1 && !locked) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn tab-act-btn tab-act-del';
    delBtn.title = 'Delete tab';
    delBtn.textContent = '✕';
    delBtn.onclick = () => deleteTab(State.activeClassId);
    container.appendChild(delBtn);
  }

  // Center header
  const productNameEl = document.getElementById('productName');
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

    const sortedVals = [...m.vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let currentVal = getActiveContext()[m.key] || '';

    // Label row
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.innerHTML = `<span>${m.label}</span>`;

    // Searchable combobox
    const comboWrap = document.createElement('div');
    comboWrap.className = 'combo combo-searchable';

    const input = document.createElement('input');
    input.type         = 'text';
    input.className    = 'combo-input';
    input.value        = currentVal;
    input.placeholder  = '— select —';
    input.autocomplete = 'off';
    input.spellcheck   = false;
    input.dataset.ctxKey = m.key;

    const dropdown = document.createElement('div');
    dropdown.className    = 'combo-dropdown';
    dropdown.style.display = 'none';

    let focusedIdx = -1;

    const getOptions = () => [...dropdown.querySelectorAll('.combo-option')];

    const renderDropdown = (filter = '') => {
      dropdown.innerHTML = '';
      focusedIdx = -1;
      const f = filter.trim().toLowerCase();

      // "— clear —" only if something is selected
      if (currentVal) {
        const clearOpt = document.createElement('div');
        clearOpt.className   = 'combo-option combo-option-clear';
        clearOpt.textContent = '— clear selection —';
        clearOpt.onmousedown = e => { e.preventDefault(); pick(''); };
        dropdown.appendChild(clearOpt);
      }

      const matches = f ? sortedVals.filter(v => v.toLowerCase().includes(f)) : sortedVals;
      matches.forEach(v => {
        const opt = document.createElement('div');
        opt.className   = 'combo-option' + (v === currentVal ? ' combo-option-selected' : '');
        opt.textContent = v;
        opt.dataset.val = v;
        opt.onmousedown = e => { e.preventDefault(); pick(v); };
        dropdown.appendChild(opt);
      });

      // Scroll current selection into view
      const sel = dropdown.querySelector('.combo-option-selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });

      const addOpt = document.createElement('div');
      addOpt.className   = 'combo-option combo-option-add';
      addOpt.textContent = '+ Add New…';
      addOpt.onmousedown = e => { e.preventDefault(); handleContextSelect(m.key, '__NEW__'); dropdown.style.display = 'none'; };
      dropdown.appendChild(addOpt);
    };

    const pick = v => {
      currentVal = v;
      input.value = v;
      dropdown.style.display = 'none';
      handleContextSelect(m.key, v);
    };

    input.onfocus = () => {
      input.select();
      dropdown.style.display = '';   // make visible first so scrollIntoView has layout
      renderDropdown('');
    };
    input.oninput = () => {
      renderDropdown(input.value);
      dropdown.style.display = '';
    };
    input.onblur = () => setTimeout(() => {
      dropdown.style.display = 'none';
      const typed = input.value.trim();
      const newValue = typed ? normalizeChipVal(typed) : '';
      if (typed && typed !== currentVal && !sortedVals.includes(typed) && !m.vals.includes(newValue)) {
        // Typed a genuinely new value and blurred — save it instead of reverting
        m.vals.push(newValue);
        handleContextSelect(m.key, newValue);
      } else if (typed && typed !== currentVal && m.vals.includes(newValue)) {
        // Typed value normalizes to an existing value — select it
        handleContextSelect(m.key, newValue);
      } else {
        input.value = currentVal;  // revert partial/unchanged text
      }
    }, 160);

    input.onkeydown = e => {
      const opts = getOptions().filter(o => !o.classList.contains('combo-option-clear') && !o.classList.contains('combo-option-add'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusedIdx = Math.min(focusedIdx + 1, opts.length - 1);
        opts.forEach((o, i) => o.classList.toggle('combo-focused', i === focusedIdx));
        opts[focusedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusedIdx = Math.max(focusedIdx - 1, 0);
        opts.forEach((o, i) => o.classList.toggle('combo-focused', i === focusedIdx));
        opts[focusedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focused = dropdown.querySelector('.combo-focused');
        if (focused) {
          focused.dispatchEvent(new MouseEvent('mousedown'));
        } else {
          const typed = input.value.trim();
          if (sortedVals.includes(typed)) {
            // Exact match — select it directly
            pick(typed);
          } else if (opts.length === 1) {
            // Single filtered result — select it
            opts[0].dispatchEvent(new MouseEvent('mousedown'));
          } else if (typed) {
            // Genuinely new value — add it directly without the two-step flow
            const newValue = normalizeChipVal(typed);
            if (!m.vals.includes(newValue)) m.vals.push(newValue);
            dropdown.style.display = 'none';
            handleContextSelect(m.key, newValue);
          }
        }
      } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        input.value = currentVal;
        input.blur();
      }
    };

    comboWrap.appendChild(input);
    comboWrap.appendChild(dropdown);
    div.appendChild(labelDiv);
    div.appendChild(comboWrap);
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

  // File Name sticky first column + data columns
  const partTh = makeHeaderCell('File Name', 'col-part-name col-filename-header', '__part__');
  head.appendChild(partTh);
  visProps.forEach(p => head.appendChild(makeHeaderCell(p.name, 'col-prop', p.id)));

  body.innerHTML = '';
  parts.forEach((p, i) => {
    if (p.enabled === false) return;  // disabled parts hidden from grid

    const tr = document.createElement('tr');
    if (p.id === State.selectedPartId) tr.classList.add('selected');
    if ((p.level || 0) > 0) tr.classList.add('row-child');

    // Sticky File Name cell (replaces Part column)
    const fnVal  = resolveFileNameRule(p.id);
    const nameTd = document.createElement('td');
    nameTd.className = 'data-cell col-part-name-cell col-filename-cell' + ((p.level || 0) > 0 ? ' name-cell-child' : '');
    nameTd.title     = fnVal;
    const nameWrap = document.createElement('div');
    nameWrap.className = 'name-cell';
    const fnSpan = document.createElement('span');
    fnSpan.className   = 'cell-text';
    fnSpan.textContent = fnVal;
    nameWrap.appendChild(fnSpan);
    nameTd.appendChild(nameWrap);
    tr.appendChild(nameTd);

    // Data cells only — no row-header th
    const rules = getActiveRules()[p.id] || {};

    // Pre-resolve all values so separator columns can inspect their neighbours
    const resolvedVals = {};
    visProps.forEach(pr2 => { resolvedVals[pr2.id] = resolveRule(rules[pr2.id], p.id); });

    visProps.forEach(pr => {
      const val = resolvedVals[pr.id];
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
    const isDisabled = p.enabled === false;
    const div = document.createElement('div');
    div.className = 'tree-item' +
      (p.id === State.selectedPartId ? ' selected' : '') +
      (lvl > 0 ? ' tree-item-child' : '') +
      (isDisabled ? ' tree-item-disabled' : '');
    div.style.marginLeft = lvl > 0 ? (lvl * 22) + 'px' : '';
    div.draggable = !isDisabled;
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
    nodeName.textContent  = resolveFileNameRule(p.id) || p.name;
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

    // Enable/disable toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn part-toggle-btn' + (isDisabled ? ' part-toggle-off' : ' part-toggle-on');
    toggleBtn.innerHTML = isDisabled ? _eyeClosedIcon() : _eyeOpenIcon();
    toggleBtn.title = isDisabled ? 'Part disabled — click to include in assembly' : 'Part enabled — click to exclude from assembly';
    toggleBtn.onclick = e => { e.stopPropagation(); togglePartEnabled(p.id); };

    // Duplicate button
    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn part-dup-btn';
    dupBtn.innerHTML = _duplicateIcon(11);
    dupBtn.title = 'Duplicate part';
    dupBtn.onclick = e => { e.stopPropagation(); duplicatePart(p.id); };

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
    div.appendChild(toggleBtn);
    div.appendChild(dupBtn);
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

    const CHIP_COLLAPSE = 14;   // show this many chips before collapsing
    const chipsDiv = document.createElement('div');
    chipsDiv.className = 'chips-wrap';
    const sortedChipVals = [...m.vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sortedChipVals.forEach((v, vi) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      if (m.vals.length > CHIP_COLLAPSE && vi >= CHIP_COLLAPSE) chip.classList.add('chip-hidden');
      chip.appendChild(document.createTextNode(v + ' '));
      const closeSpan = document.createElement('span');
      closeSpan.className = 'close';
      closeSpan.innerHTML = '&times;';
      closeSpan.onclick   = () => removeChip(m.key, v);
      chip.appendChild(closeSpan);
      chipsDiv.appendChild(chip);
    });

    // Collapse toggle (only when list is long)
    let chipsExpanded = false;
    const chipToggle = document.createElement('button');
    if (m.vals.length > CHIP_COLLAPSE) {
      chipToggle.className   = 'btn chip-toggle-btn';
      chipToggle.textContent = `Show all ${m.vals.length} ▾`;
      chipToggle.onclick = () => {
        chipsExpanded = !chipsExpanded;
        chipsDiv.querySelectorAll('.chip-hidden').forEach(c => c.style.display = chipsExpanded ? '' : 'none');
        chipToggle.textContent = chipsExpanded ? 'Show less ▴' : `Show all ${m.vals.length} ▾`;
      };
      // Start collapsed
      chipsDiv.querySelectorAll('.chip-hidden').forEach(c => c.style.display = 'none');
    }

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

    // Range generator button
    const rangeBtn = document.createElement('button');
    rangeBtn.className   = 'btn chip-range-btn';
    rangeBtn.textContent = 'Range…';
    rangeBtn.title       = 'Generate a sequence of numbers (e.g. 10 to 15 in steps of 0.125)';
    addRow.appendChild(rangeBtn);

    // Inline range panel (hidden by default)
    const rangePanel = document.createElement('div');
    rangePanel.className    = 'chip-range-panel';
    rangePanel.style.display = 'none';
    rangePanel.innerHTML = `
      <label class="rng-label">From
        <input type="number" class="chip-range-input rng-start" step="any" placeholder="e.g. 10">
      </label>
      <label class="rng-label">To
        <input type="number" class="chip-range-input rng-end" step="any" placeholder="e.g. 15">
      </label>
      <label class="rng-label">Step
        <input type="number" class="chip-range-input rng-step" step="any" placeholder="e.g. 0.125">
        <span class="chip-range-presets">
          <button class="btn chip-range-preset" data-v="0.031" title="1/32 inch">1/32</button>
          <button class="btn chip-range-preset" data-v="0.063" title="1/16 inch">1/16</button>
          <button class="btn chip-range-preset" data-v="0.125" title="1/8 inch">1/8</button>
          <button class="btn chip-range-preset" data-v="0.250" title="1/4 inch">1/4</button>
          <button class="btn chip-range-preset" data-v="0.500" title="1/2 inch">1/2</button>
          <button class="btn chip-range-preset" data-v="1" title="1 inch">1</button>
        </span>
      </label>
      <div class="chip-range-preview"></div>
      <button class="btn primary chip-range-generate">Generate</button>`;

    rangeBtn.onclick = () => {
      const open = rangePanel.style.display !== 'none';
      rangePanel.style.display = open ? 'none' : '';
      if (!open) rangePanel.querySelector('.rng-start').focus();
    };

    rangePanel.querySelectorAll('.chip-range-preset').forEach(p => {
      p.onclick = () => {
        rangePanel.querySelector('.rng-step').value = p.dataset.v;
        updateRangePreview();
      };
    });

    const updateRangePreview = () => {
      const start = parseFloat(rangePanel.querySelector('.rng-start').value);
      const end   = parseFloat(rangePanel.querySelector('.rng-end').value);
      const step  = parseFloat(rangePanel.querySelector('.rng-step').value);
      const prev  = rangePanel.querySelector('.chip-range-preview');
      if (isNaN(start) || isNaN(end) || isNaN(step) || step <= 0 || start > end) {
        prev.textContent = '';
        return;
      }
      const count = Math.floor(Math.round((end - start) / step)) + 1;
      prev.textContent = `→ ${count} value${count !== 1 ? 's' : ''} will be added`;
    };
    rangePanel.querySelectorAll('.chip-range-input').forEach(i => i.addEventListener('input', updateRangePreview));

    rangePanel.querySelector('.chip-range-generate').onclick = () => {
      const start = parseFloat(rangePanel.querySelector('.rng-start').value);
      const end   = parseFloat(rangePanel.querySelector('.rng-end').value);
      const step  = parseFloat(rangePanel.querySelector('.rng-step').value);
      if (isNaN(start) || isNaN(end) || isNaN(step) || step <= 0 || start > end) return;
      addChipsRange(m.key, start, end, step);
      rangePanel.style.display = 'none';
    };

    div.appendChild(header);
    div.appendChild(chipsDiv);
    if (m.vals.length > CHIP_COLLAPSE) div.appendChild(chipToggle);
    div.appendChild(addRow);
    div.appendChild(rangePanel);
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
    const parts = getActiveParts().filter(p => p.enabled !== false);
    const props = getActiveProps();
    if (!parts.length || !props.length) {
      container.innerHTML += "<div class='small' style='padding:20px'>Select a part from the Parts tab.</div>";
      return;
    }
    const idxList = calculateIndices();
    const allParts = getActiveParts();
    const rows = parts.map(p => {
      const globalIdx = allParts.findIndex(ap => ap.id === p.id);
      const idx = idxList[globalIdx] || '';
      const rules = getActiveRules()[p.id] || {};
      const cells = props.map(pr => {
        const val = resolveRule(rules[pr.id], p.id);
        return `<td class="rules-summary-cell" title="${escapeHtml(val)}">${escapeHtml(val)}</td>`;
      }).join('');
      return `<tr class="rules-summary-row" onclick="State.selectedPartId='${p.id}';renderAll();">
        <td class="rules-summary-part"><span class="idx-badge" style="margin-right:5px">${idx}</span>${escapeHtml(p.name)}</td>
        ${cells}
      </tr>`;
    }).join('');
    const heads = props.map(pr => `<th>${escapeHtml(pr.name)}</th>`).join('');
    container.innerHTML += `
      <div style="overflow:auto;margin-top:8px">
        <table class="rules-summary-table">
          <thead><tr><th>Part</th>${heads}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="small" style="padding:8px 4px;color:#aaa">Click a row to edit its rules.</p>
      </div>`;
    return;
  }

  // Guard: disabled parts (component headers) are hidden from the output grid.
  // Editing their rules produces a correct preview but nothing ever shows in the
  // grid, which is confusing.  Show a clear message instead.
  const _selPart = getActiveParts().find(p => p.id === State.selectedPartId);
  if (_selPart && _selPart.enabled === false) {
    container.innerHTML = '<div class="small" style="padding:16px;color:#aaa;line-height:1.5">' +
      '<strong style="color:#888">Component header selected.</strong><br>' +
      'This row is hidden from the output grid, so rules set here will not appear in any column.<br>' +
      'Select a leaf part row to edit its rules.</div>';
    return;
  }

  const activeRules = getActiveRules();
  if (!activeRules[State.selectedPartId]) activeRules[State.selectedPartId] = {};
  const rules = activeRules[State.selectedPartId];

  // ── File Name rule (special, always-present, no delete button) ──
  {
    const fnRules     = getActiveFileNameRules();
    const currentFn   = fnRules[State.selectedPartId] || '';
    const resolvedFn  = resolveFileNameRule(State.selectedPartId);

    const div = document.createElement('div');
    div.className = 'rule-item rule-item--filename';

    const header = document.createElement('div');
    header.className = 'rule-header';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'rule-label-wrap';

    const labelSpan = document.createElement('span');
    labelSpan.className   = 'small';
    labelSpan.style.fontWeight = 'bold';
    labelSpan.textContent = 'File Name';

    const hint = document.createElement('span');
    hint.className   = 'rule-label-hint';
    hint.textContent = 'Inventor file name — used for Export';

    labelWrap.appendChild(labelSpan);
    labelWrap.appendChild(hint);
    header.appendChild(labelWrap);

    const textarea = document.createElement('textarea');
    textarea.className      = 'rule-textarea';
    textarea.value          = currentFn;
    textarea.placeholder    = 'e.g. PN-PIN_ODMM-PIN_LENGTH_IN-01-01';
    textarea.dataset.propId = '__filename__';

    const INVALID_FN_CHARS = /[/\\:*?"<>|]/g;
    const _fnWarn = fn => fn && INVALID_FN_CHARS.test(fn)
      ? ' ⚠ contains invalid filename characters' : '';

    const preview = document.createElement('div');
    preview.className = 'rule-preview';

    const previewText = document.createElement('span');
    previewText.className   = 'rule-preview-text';
    previewText.textContent = resolvedFn;

    const previewCount = document.createElement('span');
    previewCount.className   = 'rule-preview-count';
    previewCount.textContent = resolvedFn.length;
    previewCount.title       = resolvedFn.length + ' characters';

    const warnBadge = document.createElement('span');
    warnBadge.className = 'fn-warn-badge';
    warnBadge.title     = 'Characters like / \\ : * ? " < > | are not allowed in Windows filenames';
    warnBadge.textContent = _fnWarn(resolvedFn);

    const errBadge = document.createElement('span');
    errBadge.className = 'rule-preview-error';
    _updateRuleErrBadge(errBadge, resolvedFn);

    preview.appendChild(previewText);
    if (resolvedFn) preview.appendChild(previewCount);
    preview.appendChild(warnBadge);
    preview.appendChild(errBadge);

    const chipsDisplay = document.createElement('div');
    chipsDisplay.className = 'rule-chips-display';
    _renderRuleChips(chipsDisplay, currentFn, textarea);

    textarea.oninput = function() {
      updateFileNameRule(State.selectedPartId, this.value);
      const resolved = resolveFileNameRule(State.selectedPartId);
      const txt = preview.querySelector('.rule-preview-text');
      const cnt = preview.querySelector('.rule-preview-count');
      const wrn = preview.querySelector('.fn-warn-badge');
      const err = preview.querySelector('.rule-preview-error');
      if (txt) txt.textContent = resolved;
      if (cnt) { cnt.textContent = resolved.length; cnt.style.display = resolved ? '' : 'none'; }
      else if (resolved) {
        const newCnt = document.createElement('span');
        newCnt.className = 'rule-preview-count';
        newCnt.textContent = resolved.length;
        preview.insertBefore(newCnt, wrn);
      }
      if (wrn) wrn.textContent = _fnWarn(resolved);
      if (err) _updateRuleErrBadge(err, resolved);
      _renderRuleChips(chipsDisplay, this.value, textarea);
    };

    const palette = document.createElement('div');
    palette.className = 'token-palette';
    _wireTokenAutocomplete(textarea, palette, '__filename__');

    div.appendChild(header);
    div.appendChild(chipsDisplay);
    div.appendChild(textarea);
    div.appendChild(palette);
    div.appendChild(preview);
    container.appendChild(div);
  }

  getActiveProps().forEach(pr => {
    const div = document.createElement('div');
    div.className = 'rule-item';

    const header = document.createElement('div');
    header.className = 'rule-header';

    // Label wrap — visibility is controlled solely by the column filter bar
    const labelWrap = document.createElement('div');
    labelWrap.className = 'rule-label-wrap';

    const labelSpan = document.createElement('span');
    labelSpan.className        = 'small';
    labelSpan.style.fontWeight = 'bold';
    labelSpan.dataset.edit     = 'propName';
    labelSpan.dataset.id       = pr.id;
    labelSpan.textContent      = pr.name;

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
    textarea.className    = 'rule-textarea';
    textarea.value        = currentRule;
    textarea.dataset.propId = pr.id;

    const preview = document.createElement('div');
    preview.className = 'rule-preview';

    const previewText = document.createElement('span');
    previewText.className   = 'rule-preview-text';
    previewText.textContent = resolvedVal;

    const previewCount = document.createElement('span');
    previewCount.className   = 'rule-preview-count';
    previewCount.textContent = resolvedVal.length;
    previewCount.title       = resolvedVal.length + ' characters';

    const errBadge = document.createElement('span');
    errBadge.className = 'rule-preview-error';
    _updateRuleErrBadge(errBadge, resolvedVal);

    preview.appendChild(previewText);
    if (resolvedVal) preview.appendChild(previewCount);
    preview.appendChild(errBadge);

    const chipsDisplay = document.createElement('div');
    chipsDisplay.className = 'rule-chips-display';
    _renderRuleChips(chipsDisplay, currentRule, textarea);

    textarea.oninput = function () {
      updateRule(State.selectedPartId, pr.id, this.value);
      // Update preview text + count live
      let el = this.nextElementSibling;
      if (el && el.classList.contains('token-palette')) el = el.nextElementSibling;
      if (el && el.classList.contains('rule-preview')) {
        const txt = el.querySelector('.rule-preview-text');
        const cnt = el.querySelector('.rule-preview-count');
        const err = el.querySelector('.rule-preview-error');
        const resolved = resolveRule(this.value, State.selectedPartId);
        if (txt) txt.textContent = resolved;
        if (cnt) { cnt.textContent = resolved.length; cnt.style.display = resolved ? '' : 'none'; }
        else if (resolved) {
          const newCnt = document.createElement('span');
          newCnt.className = 'rule-preview-count';
          newCnt.textContent = resolved.length;
          el.appendChild(newCnt);
        }
        if (err) _updateRuleErrBadge(err, resolved);
      }
      _renderRuleChips(chipsDisplay, this.value, textarea);
    };

    const palette = document.createElement('div');
    palette.className = 'token-palette';

    // Wire autocomplete between textarea and palette
    _wireTokenAutocomplete(textarea, palette, pr.id);

    div.appendChild(header);
    div.appendChild(chipsDisplay);
    div.appendChild(textarea);
    div.appendChild(palette);
    div.appendChild(preview);
    container.appendChild(div);
  });
}

/* ── Rule preview error badge ─────────────────────────────────
 * Shows a red ⚠ next to the resolved preview when the engine
 * left behind unparsed brace tokens or non-numeric value
 * sentinels. Tooltip suggests a fix when possible.
 */
function _updateRuleErrBadge(el, resolved) {
  const errors = (typeof lintResolved === 'function') ? lintResolved(resolved) : [];
  if (!errors.length) {
    el.textContent = '';
    el.style.display = 'none';
    el.removeAttribute('title');
    return;
  }
  el.style.display = '';
  el.textContent = '⚠ ' + errors.length;
  const lines = errors.map(e => {
    if (e.kind === 'unparsed') {
      const fix = (typeof suggestFix === 'function') ? suggestFix(e.text) : null;
      return fix
        ? `Unrecognised token ${e.text}\n  did you mean ${fix} ?`
        : `Unrecognised token ${e.text}`;
    }
    return e.text;
  });
  el.title = lines.join('\n\n');
}

/* ── Read-only chip preview of a template ─────────────────────
 * Renders parsed tokens as coloured pills above the textarea.
 * Variable chips are clickable: clicking opens the format
 * popover, which rewrites the textarea with canonical syntax
 * the engine is guaranteed to understand.
 */
function _renderRuleChips(container, template, textarea) {
  container.innerHTML = '';
  if (!template || typeof parseTemplate !== 'function') {
    container.style.display = 'none';
    return;
  }
  const tokens = parseTemplate(template);
  if (!tokens.length) { container.style.display = 'none'; return; }
  container.style.display = 'flex';

  // Re-serialise to detect orphan literal segments left over by the parser.
  // Anything that round-trips identically is fully understood; anything else
  // is shown as a warning chip so the user can spot the malformed bit.
  let cursor = 0;
  tokens.forEach((tok, idx) => {
    const serialised = (typeof serialiseTokens === 'function')
      ? serialiseTokens([tok]) : '';
    const start = template.indexOf(serialised, cursor);
    const end   = start >= 0 ? start + serialised.length : cursor;

    const chip = document.createElement('span');
    chip.className = 'chip rule-chip rule-chip--' + tok.type;

    if (tok.type === 'literal') {
      // Detect literal segments that look like a half-typed brace token
      // (e.g. "{NOMINAL_PIN_OD_MM#3MM}") and flag them.
      if (/[{}]/.test(tok.text)) chip.classList.add('rule-chip--warn');
      chip.textContent = tok.text;
      chip.title = 'Literal text';
    } else if (tok.type === 'var') {
      const fmt = [];
      if (tok.pad) fmt.push('pad ' + tok.pad);
      if (tok.decimals != null) fmt.push(tok.decimals + ' dec');
      if (tok.suffix) fmt.push(tok.suffix);
      chip.textContent = tok.key + (fmt.length ? ' · ' + fmt.join(' ') : '');
      chip.title = 'Click to edit format';
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', e => {
        e.stopPropagation();
        _openVarFormatPopover(tok, chip, fixed => {
          // Replace the original token's slice in the textarea with the new
          // canonical serialised form, then fire input to refresh everything.
          if (start < 0) return;
          const newSer = serialiseTokens([fixed]);
          textarea.value = template.slice(0, start) + newSer + template.slice(end);
          textarea.dispatchEvent(new Event('input'));
        });
      });
    } else if (tok.type === 'sep') {
      // Show the actual character(s) so users see exactly what will render.
      // Quotes are kept so spaces in ' - ' / ' X ' are visible.
      chip.textContent = 'sep ' + JSON.stringify(tok.char);
      chip.title = 'Click to change separator style';
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', e => {
        e.stopPropagation();
        _openSepFormatPopover(tok, chip, fixed => {
          if (start < 0) return;
          const newSer = serialiseTokens([fixed]);
          textarea.value = template.slice(0, start) + newSer + template.slice(end);
          textarea.dispatchEvent(new Event('input'));
        });
      });
    } else if (tok.type === 'cond') {
      chip.textContent = 'if ' + tok.vars.join(' ' + tok.op + ' ') + ' → ' + tok.show;
      chip.title = 'Conditional output';
    } else if (tok.type === 'eq') {
      chip.textContent = tok.key + '=' + tok.value + ' → ' + tok.show;
      chip.title = 'Equality conditional';
    } else if (tok.type === 'idx') {
      chip.textContent = 'IDX';
      chip.title = 'Auto part index';
    } else if (tok.type === 'name') {
      chip.textContent = 'NAME';
      chip.title = 'Part name';
    } else if (tok.type === 'math') {
      chip.textContent = '(' + tok.expr + ')';
      chip.title = 'Math expression';
    }
    container.appendChild(chip);
    if (start >= 0) cursor = end;
  });
}

/* ── Variable-format popover ──────────────────────────────────
 * Lets users set Pad / Decimals / Suffix on a variable chip.
 * Always emits the canonical {VAR#N(.D)?(:SUFFIX)?} form so the
 * engine can never see the malformed {VAR#NSUFFIX} shape that
 * caused the recurring "three-digit formatting" bug.
 */
function _openVarFormatPopover(token, anchorEl, onApply, onConditionalSwitch) {
  const existing = document.getElementById('var-fmt-popover');
  if (existing) existing.remove();

  const pop = document.createElement('div');
  pop.id = 'var-fmt-popover';
  pop.className = 'cond-popover';

  const title = document.createElement('div');
  title.className = 'cond-popover-title';
  title.innerHTML = 'Format <strong>' + escapeHtml(token.key) + '</strong>';
  pop.appendChild(title);

  const mkRow = (label, input) => {
    const row = document.createElement('label');
    row.className = 'var-fmt-row';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  };

  const padInput = document.createElement('input');
  padInput.type = 'number';
  padInput.min  = '0';
  padInput.placeholder = 'none';
  padInput.value = token.pad || '';

  const decInput = document.createElement('input');
  decInput.type = 'number';
  decInput.min  = '0';
  decInput.placeholder = 'none';
  decInput.value = token.decimals != null ? token.decimals : '';

  const sufInput = document.createElement('input');
  sufInput.type = 'text';
  sufInput.placeholder = 'e.g. MM';
  sufInput.value = token.suffix || '';

  pop.appendChild(mkRow('Pad to digits',  padInput));
  pop.appendChild(mkRow('Decimal places', decInput));
  pop.appendChild(mkRow('Suffix',         sufInput));

  const previewEl = document.createElement('div');
  previewEl.className = 'cond-popover-preview';
  pop.appendChild(previewEl);

  const buildToken = () => ({
    type: 'var',
    key: token.key,
    pad: padInput.value ? parseInt(padInput.value, 10) : null,
    decimals: decInput.value !== '' ? parseInt(decInput.value, 10) : null,
    suffix: sufInput.value || '',
  });

  const updatePreview = () => {
    const t   = buildToken();
    const tpl = serialiseTokens([t]);
    const res = (typeof resolveRule === 'function')
      ? resolveRule(tpl, State.selectedPartId) : '';
    previewEl.textContent = (res ? '→ ' + res : '(blank)') + '   ' + tpl;
  };
  [padInput, decInput, sufInput].forEach(i => i.addEventListener('input', updatePreview));
  updatePreview();

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn primary cond-popover-insert';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    onApply(buildToken());
    pop.remove();
  });
  pop.appendChild(applyBtn);

  if (typeof onConditionalSwitch === 'function') {
    const altLink = document.createElement('a');
    altLink.href = '#';
    altLink.className = 'var-fmt-alt';
    altLink.textContent = 'Use as conditional instead';
    altLink.addEventListener('mousedown', e => {
      e.preventDefault();
      pop.remove();
      onConditionalSwitch();
    });
    pop.appendChild(altLink);
  }

  document.body.appendChild(pop);
  const rect = anchorEl.getBoundingClientRect();
  const popW = 280, popH = pop.offsetHeight;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (left < 8) left = 8;
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const top = spaceBelow >= popH ? rect.bottom + 6 : Math.max(8, rect.top - popH - 6);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';
  padInput.focus();
  padInput.select();

  const dismiss = ev => {
    if (!pop.contains(ev.target) && ev.target !== anchorEl) {
      pop.remove();
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

/* ── Separator-format popover ─────────────────────────────────
 * Lets users choose separator character (- or X) and whether it
 * should have a space on both sides, then applies the canonical
 * DSL token: {[-]}, {[ - ]}, {[X]}, or {[ X ]}.
 */
function _openSepFormatPopover(token, anchorEl, onApply) {
  const existing = document.getElementById('sep-fmt-popover');
  if (existing) existing.remove();

  const pop = document.createElement('div');
  pop.id = 'sep-fmt-popover';
  pop.className = 'cond-popover';

  const title = document.createElement('div');
  title.className = 'cond-popover-title';
  title.textContent = 'Separator';
  pop.appendChild(title);

  // Derive initial state from current token.char
  // '-' or ' - ' → hyphen; 'X' or ' X ' → cross
  const curChar    = token.char || '-';
  const initHyphen = !curChar.includes('X');
  const initSpaced = curChar.includes(' ');

  // Character radio group
  const charRow = document.createElement('div');
  charRow.className = 'var-fmt-row';
  const charLbl = document.createElement('span');
  charLbl.textContent = 'Character';
  charRow.appendChild(charLbl);

  const radios = document.createElement('div');
  radios.style.cssText = 'display:flex;gap:10px;align-items:center';

  const mkRadio = (value, label, checked) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;cursor:pointer;font-size:12px';
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'sep-char'; r.value = value; r.checked = checked;
    wrap.appendChild(r);
    wrap.appendChild(document.createTextNode(label));
    return { wrap, radio: r };
  };

  const { wrap: wrapH, radio: radioH } = mkRadio('-', '—  hyphen', initHyphen);
  const { wrap: wrapX, radio: radioX } = mkRadio('X', '✕  cross', !initHyphen);
  radios.appendChild(wrapH);
  radios.appendChild(wrapX);
  charRow.appendChild(radios);
  pop.appendChild(charRow);

  // Spaced checkbox
  const spaceRow = document.createElement('label');
  spaceRow.className = 'var-fmt-row';
  spaceRow.style.cursor = 'pointer';
  const spaceLbl = document.createElement('span');
  spaceLbl.textContent = 'Space on both sides';
  const spaceChk = document.createElement('input');
  spaceChk.type = 'checkbox'; spaceChk.checked = initSpaced;
  spaceRow.appendChild(spaceLbl);
  spaceRow.appendChild(spaceChk);
  pop.appendChild(spaceRow);

  // Live preview
  const previewEl = document.createElement('div');
  previewEl.className = 'cond-popover-preview';
  const buildToken = () => {
    const ch     = radioH.checked ? '-' : 'X';
    const spaced = spaceChk.checked;
    const char   = spaced ? ` ${ch} ` : ch;
    return { type: 'sep', char };
  };
  const updatePreview = () => {
    const tok = buildToken();
    const dsl = serialiseTokens([tok]);
    const rendered = tok.char;
    previewEl.textContent = `→ "${rendered}"  (${dsl})`;
  };
  [radioH, radioX, spaceChk].forEach(el => el.addEventListener('change', updatePreview));
  updatePreview();
  pop.appendChild(previewEl);

  // Apply button
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn primary cond-popover-insert';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    onApply(buildToken());
    pop.remove();
  });
  pop.appendChild(applyBtn);

  // Position
  document.body.appendChild(pop);
  const rect  = anchorEl.getBoundingClientRect();
  const popW  = 260;
  const popH  = pop.offsetHeight;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (left < 8) left = 8;
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const top = spaceBelow >= popH ? rect.bottom + 6 : Math.max(8, rect.top - popH - 6);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  const dismiss = ev => {
    if (!pop.contains(ev.target) && ev.target !== anchorEl) {
      pop.remove();
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
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
      { key: 'IDX',        label: 'IDX',          desc: 'Auto-calculated part index' },
      { key: 'NAME',       label: 'NAME',          desc: 'Part name' },
      // Separator tokens — always shown, open the sep-format popover on click.
      { key: 'SEP_HYPHEN', label: '–  Separator  -', desc: 'sep', _isSep: true, _char: '-' },
      { key: 'SEP_X',      label: '✕  Separator  X', desc: 'sep', _isSep: true, _char: 'X' },
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

  /* Open the conditional builder popover for the given token */
  const openConditionalBuilder = (key, label, ifBtnEl) => {
    // Remove any existing popover
    const existing = document.getElementById('cond-popover');
    if (existing) existing.remove();

    const pop = document.createElement('div');
    pop.id = 'cond-popover';
    pop.className = 'cond-popover';

    // Title
    const title = document.createElement('div');
    title.className = 'cond-popover-title';
    title.innerHTML = 'When <strong>' + escapeHtml(label) + '</strong> is set, show:';
    pop.appendChild(title);

    // Output text input — pre-filled with the variable's own key as the default output
    const outputInput = document.createElement('input');
    outputInput.type = 'text';
    outputInput.className = 'cond-popover-input';
    outputInput.value = key;
    pop.appendChild(outputInput);

    // Live preview
    const previewEl = document.createElement('div');
    previewEl.className = 'cond-popover-preview';
    const updatePreview = () => {
      const draftTemplate = '{' + key + '?' + outputInput.value + '}';
      const resolved = resolveRule(draftTemplate, State.selectedPartId);
      previewEl.textContent = resolved ? '→ ' + resolved : '(blank when not set)';
    };
    outputInput.addEventListener('input', updatePreview);
    updatePreview();
    pop.appendChild(previewEl);

    // Insert button
    const insertBtn = document.createElement('button');
    insertBtn.className = 'btn primary cond-popover-insert';
    insertBtn.textContent = 'Insert';
    insertBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      const snippet = '{' + key + '?' + outputInput.value + '}';
      const pos    = textarea.selectionStart;
      const before = textarea.value.substring(0, pos);
      const after  = textarea.value.substring(pos);
      const word   = getCurrentWord();
      const newVal = before.substring(0, before.length - word.length) + snippet + after;
      textarea.value = newVal;
      const newPos = before.length - word.length + snippet.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.dispatchEvent(new Event('input'));
      pop.remove();
      textarea.focus();
      palette.style.display = 'none';
    });
    pop.appendChild(insertBtn);

    // Position near the if-button, flipping above if it would overflow the viewport
    document.body.appendChild(pop);
    const rect   = ifBtnEl.getBoundingClientRect();
    const popW   = 280;
    const popH   = pop.offsetHeight;
    let left = rect.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (left < 8) left = 8;
    // Flip above the button when not enough space below
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= popH
      ? rect.bottom + 6
      : Math.max(8, rect.top - popH - 6);
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';

    outputInput.focus();
    outputInput.select();

    // Dismiss on outside click
    const dismiss = ev => {
      if (!pop.contains(ev.target) && ev.target !== ifBtnEl) {
        pop.remove();
        document.removeEventListener('mousedown', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
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

    // Separators are always pinned at the top and excluded from the
    // used/unused sort and the prefix filter (they're not typed as words).
    const sepTokens  = tokens.filter(t => t._isSep);
    const restTokens = tokens.filter(t => !t._isSep);

    /* Split into: matches-prefix vs rest (only shown when no active prefix) */
    const matching = restTokens.filter(t => t.key.startsWith(upper));
    const rest     = prefix ? [] : restTokens.filter(t => !t.key.startsWith(upper));

    /* Sort each group: unused first, then already-in-formula */
    const sort = arr => [
      ...arr.filter(t => !isUsed(formula, t.key)),
      ...arr.filter(t =>  isUsed(formula, t.key)),
    ];

    const ordered = [...sepTokens, ...sort(matching), ...sort(rest)];

    if (ordered.length === 0) { palette.style.display = 'none'; return; }
    palette.style.display = 'flex';

    ordered.forEach(t => {
      const isSep    = !!t._isSep;
      const used     = !isSep && isUsed(formula, t.key);
      const inMatch  = isSep || t.key.startsWith(upper);
      const isDimmed = !inMatch && !prefix;

      const btn = document.createElement('button');
      btn.className = 'token-pill' +
        (isSep           ? ' token-sep-btn'  :
         used            ? ' token-used'      : ' token-new') +
        (isDimmed        ? ' token-dim'       : '');

      if (isSep) {
        btn.title = t.label + ' — click to insert';
        btn.textContent = t.label;
      } else if (prefix && inMatch) {
        btn.title = t.label + (used ? ' — already used' : ' — click to insert');
        /* Highlight the typed portion */
        const hi  = document.createElement('mark');
        hi.className   = 'token-match';
        hi.textContent = t.key.substring(0, upper.length);
        btn.appendChild(hi);
        btn.appendChild(document.createTextNode(t.key.substring(upper.length)));
      } else {
        btn.title = t.label + (used ? ' — already used' : ' — click to insert');
        btn.textContent = t.key;
      }

      /* Sub-label for dynamic variables (human name differs from key) */
      if (!isSep && t.label !== t.key) {
        const sub = document.createElement('span');
        sub.className   = 'token-sub';
        sub.textContent = t.label;
        btn.appendChild(sub);
      }

      /* Mousedown so the click fires before textarea blur */
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        if (isSep) {
          // Separators open the sep-format popover; result is inserted directly.
          _openSepFormatPopover(
            { type: 'sep', char: t._char },
            btn,
            tok => {
              insertToken(serialiseTokens([tok]));
              palette.style.display = 'none';
            }
          );
        } else {
          // All other tokens (IDX, NAME, dynamic vars) insert directly.
          // The user can click the resulting chip to open the format / conditional
          // popover — no forced pop-up on insert.
          insertToken(t.key);
        }
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

/* ── SVG icon helpers ────────────────────────────────────── */
function _copyIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}
function _checkIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}
/** Overlapping-squares duplicate icon (Figma/VS Code style). Size in px. */
function _duplicateIcon(size) {
  const s = size || 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}
/** Eye open — part is enabled and visible. */
function _eyeOpenIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}
/** Eye closed / slashed — part is disabled. */
function _eyeClosedIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}
