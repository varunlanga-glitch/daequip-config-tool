/* ============================================================
   ACTIONS.JS — User-Initiated Data Mutations
   ============================================================ */

'use strict';

/* ── Context selector ────────────────────────────────────── */
window.handleContextSelect = (key, val) => {
  if (val !== '__NEW__') {
    getActiveContext()[key] = val;
    renderAll();
    return;
  }

  const masterVar = getActiveMaster().find(m => m.key === key);
  const tempId    = 'temp_' + Date.now();

  masterVar.vals.push(tempId);
  getActiveContext()[key] = tempId;
  switchRightTab('config');

  setTimeout(() => {
    const configContainer = document.getElementById('tab-config');
    configContainer.querySelectorAll('.rule-item').forEach(item => {
      const labelSpan = item.querySelector('[data-edit="configLabel"]');
      if (labelSpan?.dataset.id !== key) return;

      item.querySelectorAll('.chip').forEach(chip => {
        const text = chip.childNodes[0]?.textContent?.trim();
        if (text !== tempId) return;

        const input = document.createElement('input');
        input.value       = '';
        input.placeholder = 'Enter value...';
        input.style.cssText = 'width:100px;padding:2px 6px;border:1px solid var(--accent);border-radius:4px;font-size:11px;outline:none';
        chip.childNodes[0].replaceWith(input);
        input.focus();

        const saveEdit = () => {
          const newValue = input.value.trim();
          if (newValue) {
            const idx = masterVar.vals.indexOf(tempId);
            if (idx !== -1) masterVar.vals[idx] = newValue;
            if (getActiveContext()[key] === tempId) getActiveContext()[key] = newValue;
          } else {
            masterVar.vals = masterVar.vals.filter(v => v !== tempId);
            getActiveContext()[key] = masterVar.vals[0] || '';
          }
          renderAll();
        };

        input.onblur    = saveEdit;
        input.onkeydown = e => {
          if (e.key === 'Enter')  { e.preventDefault(); saveEdit(); }
          if (e.key === 'Escape') {
            e.preventDefault();
            masterVar.vals = masterVar.vals.filter(v => v !== tempId);
            getActiveContext()[key] = masterVar.vals[0] || '';
            renderAll();
          }
        };
      });
    });
  }, 50);
};

/* ── Parts ───────────────────────────────────────────────── */
window.addPart = (type = 'component') => {
  const parts = getActiveParts();
  const newId = 'p' + Date.now();
  let newLevel  = 0;
  let insertAt  = parts.length;  // default: append

  if (type === 'subcomponent' && State.selectedPartId) {
    // Add as a child of the currently selected part
    const selIdx   = parts.findIndex(p => p.id === State.selectedPartId);
    const selLevel = selIdx >= 0 ? (parts[selIdx].level || 0) : 0;
    newLevel = selLevel + 1;

    // Insert after the last descendant of the selected part
    insertAt = selIdx + 1;
    for (let j = selIdx + 1; j < parts.length; j++) {
      if ((parts[j].level || 0) > selLevel) insertAt = j + 1;
      else break;
    }
  } else if (type === 'subcomponent' && parts.length > 0) {
    // Fallback: no selection — append as child of last top-level part
    newLevel = 1;
  }

  parts.splice(insertAt, 0, { id: newId, name: 'New Part', midx: null, level: newLevel });
  State.selectedPartId = newId;
  renderAll();

  setTimeout(() => {
    const nameElement = document.getElementById(`part-name-${newId}`);
    if (!nameElement) return;

    const input = document.createElement('input');
    input.value         = 'New Part';
    input.className     = 'combo';
    input.style.cssText = 'flex:1;font-size:13px';
    nameElement.replaceWith(input);
    input.focus();
    input.select();

    const saveEdit = () => {
      const val = input.value.trim();
      if (val) {
        const part = getActiveParts().find(p => p.id === newId);
        if (part) part.name = val;
      }
      renderAll();
    };

    input.onblur    = saveEdit;
    input.onkeydown = e => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') {
        State.parts[State.activeClassId] = getActiveParts().filter(p => p.id !== newId);
        State.selectedPartId = null;
        renderAll();
      }
    };
  }, 50);
};

window.deletePart = id => {
  const part = getActiveParts().find(p => p.id === id);
  showConfirm(
    'Delete Part',
    `Delete "${part?.name || 'this part'}"?`,
    () => {
      State.parts[State.activeClassId] = getActiveParts().filter(p => p.id !== id);
      if (State.selectedPartId === id) State.selectedPartId = null;
      renderAll();
    }
  );
};

/* ── Indent / Outdent (multi-level) ──────────────────────── */
/**
 * Increases a part's nesting level by 1 (makes it a child of the part above).
 * Cannot indent the first part or go deeper than level 4.
 */
window.indentPart = id => {
  const parts = getActiveParts();
  const idx   = parts.findIndex(p => p.id === id);
  if (idx <= 0) return;

  const part       = parts[idx];
  const currentLvl = part.level || 0;
  if (currentLvl >= 4) return;  // reasonable max depth

  // The part above must exist at level <= currentLvl for indenting to make sense
  const above = parts[idx - 1];
  if (!above || (above.level || 0) < currentLvl) return;

  part.level = currentLvl + 1;
  part.midx  = null;
  renderAll();
};

/**
 * Decreases a part's nesting level by 1 (promotes it one level up).
 * Cannot outdent a top-level part.
 */
window.outdentPart = id => {
  const part = getActiveParts().find(p => p.id === id);
  if (!part || (part.level || 0) === 0) return;

  part.level = (part.level || 0) - 1;
  part.midx  = null;
  renderAll();
};

/**
 * Moves `srcId` to be a child of `targetId` (drag-to-nest).
 * Places the source part immediately after target's last existing child.
 */
window.nestPart = (srcId, targetId) => {
  if (srcId === targetId) return;
  const parts  = getActiveParts();
  const srcIdx = parts.findIndex(p => p.id === srcId);
  const tgtIdx = parts.findIndex(p => p.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  const src    = parts[srcIdx];
  const target = parts[tgtIdx];
  const newLvl = (target.level || 0) + 1;

  // Remove source from its current position
  parts.splice(srcIdx, 1);

  // Re-find target after removal
  const newTgtIdx = parts.findIndex(p => p.id === targetId);

  // Find insertion point: after target's last existing child
  let insertAt = newTgtIdx + 1;
  for (let j = newTgtIdx + 1; j < parts.length; j++) {
    if ((parts[j].level || 0) > (target.level || 0)) insertAt = j + 1;
    else break;
  }

  src.level = newLvl;
  src.midx  = null;
  parts.splice(insertAt, 0, src);
  renderAll();
};
window.reorderParts = orderedIds => {
  const parts   = getActiveParts();
  const byId    = Object.fromEntries(parts.map(p => [p.id, p]));
  State.parts[State.activeClassId] = orderedIds.map(id => byId[id]).filter(Boolean);
  renderAll();
};

/* ── Context variables ───────────────────────────────────── */
window.addVariable = () => {
  const newKey   = 'VAR' + Date.now();
  const newLabel = 'New Variable';
  getActiveMaster().push({ key: newKey, label: newLabel, vals: [] });
  switchRightTab('config');

  setTimeout(() => {
    const configContainer = document.getElementById('tab-config');
    const ruleItems = configContainer.querySelectorAll('.rule-item');
    const lastItem  = ruleItems[ruleItems.length - 1];
    if (!lastItem) return;
    const labelSpan = lastItem.querySelector('[data-edit="configLabel"]');
    if (!labelSpan || labelSpan.dataset.id !== newKey) return;
    _startConfigLabelEdit(labelSpan, newKey);
  }, 50);
};

window.deleteVariable = k => {
  const master = getActiveMaster().find(m => m.key === k);
  showConfirm(
    'Delete Variable',
    `Delete "${master?.label || k}"? This will remove it from the context.`,
    () => {
      State.master[State.activeClassId] = getActiveMaster().filter(m => m.key !== k);
      delete getActiveContext()[k];
      renderAll();
    }
  );
};

/**
 * Rename a variable label AND derive a new key from it.
 * oldKey: the key BEFORE rename (used to find the record).
 * newLabel: user-supplied human label.
 */
window.renameVariable = (oldKey, newLabel) => {
  if (!newLabel) return;
  const master = getActiveMaster().find(m => m.key === oldKey);
  if (!master) return;

  const newKey = newLabel.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
  const collision = getActiveMaster().some(m => m.key === newKey && m.key !== oldKey);
  const finalKey  = collision ? newKey + '_' + Date.now() : newKey;

  master.label = newLabel;

  if (finalKey !== oldKey) {
    master.key = finalKey;
    // Migrate context value
    const ctx = getActiveContext();
    if (ctx[oldKey] !== undefined) {
      ctx[finalKey] = ctx[oldKey];
      delete ctx[oldKey];
    }
    // Migrate rule templates that reference the old token
    Object.values(getActiveRules()).forEach(partRules => {
      Object.keys(partRules).forEach(propId => {
        if (typeof partRules[propId] === 'string') {
          partRules[propId] = partRules[propId].replace(
            new RegExp(`\\b${oldKey}\\b`, 'g'), finalKey
          );
        }
      });
    });
  }
  renderAll();
};

/**
 * Shared inline-edit handler for configLabel spans.
 * Reads the raw label from the span text (NOT innerText which might include
 * the key badge), opens an input, and on save calls renameVariable.
 * Must be defined here (actions.js) so both dblclick (ui.js) and
 * addVariable (actions.js) can call it.
 */
function _startConfigLabelEdit(labelSpan, currentKey) {
  const currentLabel = labelSpan.textContent.trim();
  const input = document.createElement('input');
  input.value = currentLabel;
  input.className = 'combo';
  input.style.cssText = 'font-size:12px;font-weight:bold;padding:3px 6px;width:160px';
  labelSpan.replaceWith(input);
  input.focus(); input.select();
  const save = () => {
    const val = input.value.trim();
    renameVariable(currentKey, val || currentLabel);
  };
  input.onblur    = save;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); renderAll(); }
  };
}

window.addChip = (k, v) => {
  if (!v?.trim()) return;
  const master = getActiveMaster().find(m => m.key === k);
  if (master && !master.vals.includes(v.trim())) {
    master.vals.push(v.trim());
    renderAll();
  }
};

/* Comma-separated batch add */
window.addChips = (k, rawValue) => {
  if (!rawValue?.trim()) return;
  const master = getActiveMaster().find(m => m.key === k);
  if (!master) return;
  const values = rawValue.split(',').map(v => v.trim()).filter(v => v && !master.vals.includes(v));
  if (values.length) { master.vals.push(...values); renderAll(); }
};

window.removeChip = (k, v) => {
  const m = getActiveMaster().find(x => x.key === k);
  if (m) { m.vals = m.vals.filter(x => x !== v); renderAll(); }
};

/* ── Properties (columns) ────────────────────────────────── */
window.addProp = () => {
  const newProp = { id: 'f' + Date.now(), name: 'New Column' };
  getActiveProps().push(newProp);
  // Ensure new column starts visible
  const hidden = getHiddenProps();
  const hi = hidden.indexOf(newProp.id);
  if (hi !== -1) hidden.splice(hi, 1);
  renderAll();
};

window.togglePropVisibility = id => {
  const hidden = getHiddenProps();
  const idx = hidden.indexOf(id);
  if (idx === -1) hidden.push(id);
  else hidden.splice(idx, 1);
  renderAll();
};

window.deleteProp = id => {
  const prop = getActiveProps().find(p => p.id === id);
  showConfirm(
    'Delete Property Column',
    `Delete "${prop?.name || 'this column'}"? This will remove it from all parts.`,
    () => {
      State.props[State.activeClassId] = getActiveProps().filter(p => p.id !== id);
      Object.keys(getActiveRules()).forEach(partId => {
        delete getActiveRules()[partId][id];
      });
      renderAll();
    }
  );
};

/* ── Rule update ─────────────────────────────────────────── */
function updateRule(partId, propId, value) {
  const activeRules = getActiveRules();
  if (!activeRules[partId]) activeRules[partId] = {};
  activeRules[partId][propId] = value;
  renderGrid();
  if (event && event.target) {
    let el = event.target.nextElementSibling;
    if (el && el.classList.contains('token-palette')) el = el.nextElementSibling;
    if (el && el.classList.contains('rule-preview')) el.textContent = resolveRule(value, partId);
  }
}

/* ── Tabs (product classes) ──────────────────────────────── */
window.newTab = () => {
  const id   = 'tab' + Date.now();
  const name = 'New Tab';
  State.productClasses.push({ id, name });
  State.master[id]      = [];
  State.context[id]     = {};
  State.parts[id]       = [];
  State.props[id]       = [];
  State.rules[id]       = {};
  State.hiddenProps[id] = [];
  State.activeClassId   = id;
  State.selectedPartId  = null;
  renderAll();
  setTimeout(() => startProductNameEdit(), 50);
};

window.cloneTab = sourceId => {
  const sourceTab = State.productClasses.find(c => c.id === sourceId);
  if (!sourceTab) return;
  const newId   = 'tab' + Date.now();
  const newName = sourceTab.name + ' (Copy)';
  State.productClasses.push({ id: newId, name: newName });
  State.master[newId]      = JSON.parse(JSON.stringify(State.master[sourceId]  || []));
  State.context[newId]     = JSON.parse(JSON.stringify(State.context[sourceId] || {}));
  State.parts[newId]       = JSON.parse(JSON.stringify(State.parts[sourceId]   || []));
  State.props[newId]       = JSON.parse(JSON.stringify(State.props[sourceId]   || []));
  State.rules[newId]       = JSON.parse(JSON.stringify(State.rules[sourceId]   || {}));
  State.hiddenProps[newId] = JSON.parse(JSON.stringify((State.hiddenProps || {})[sourceId] || []));
  State.activeClassId  = newId;
  State.selectedPartId = null;
  renderAll();
  setTimeout(() => startProductNameEdit(), 50);
};

window.deleteTab = id => {
  if (State.productClasses.length <= 1) {
    showConfirm('Cannot Delete', 'You must have at least one tab.', () => {});
    return;
  }
  const tabName = State.productClasses.find(c => c.id === id)?.name;
  showConfirm(
    'Delete Tab',
    `Delete tab "${tabName}"? All data in this tab will be lost.`,
    () => {
      State.productClasses = State.productClasses.filter(c => c.id !== id);
      delete State.master[id];
      delete State.context[id];
      delete State.parts[id];
      delete State.props[id];
      delete State.rules[id];
      if (State.hiddenProps) delete State.hiddenProps[id];
      if (State.activeClassId === id) {
        State.activeClassId  = State.productClasses[0].id;
        State.selectedPartId = null;
      }
      renderAll();
    }
  );
};

/**
 * Renames the currently active tab.
 * Called from ui.js when the user edits the center header.
 */
window.renameActiveTab = newName => {
  const cls = State.productClasses.find(c => c.id === State.activeClassId);
  if (cls && newName) { cls.name = newName; renderAll(); }
};
