/* ============================================================
   ACTIONS.JS — User-Initiated Data Mutations
   ============================================================ */

'use strict';

/* ── Dirty flag ──────────────────────────────────────────── */
function markDirty() {
  State.dirty = true;
  // scheduleAutosave is defined in io.js (loads after this file — resolved at runtime)
  if (typeof scheduleAutosave === 'function') scheduleAutosave();
  if (typeof _updateDirtyIndicator === 'function') _updateDirtyIndicator();
}

/* ── Context selector ────────────────────────────────────── */
window.handleContextSelect = (key, val) => {
  if (val !== '__NEW__') {
    // Empty string = user chose "— select —" to clear their selection
    if (val === '') {
      delete getActiveContext()[key];
    } else {
      getActiveContext()[key] = val;
    }

    // Auto-derive CLASS_NO from CLASS — extract digits only (e.g. HE300 → 300)
    if (key === 'CLASS') {
      const digits = val.replace(/[^0-9]/g, '');
      const master = getActiveMaster();
      const classNoVar = master.find(m => m.key === 'CLASS_NO');
      if (classNoVar && digits) {
        // Add digit value to CLASS_NO options if not already present
        if (!classNoVar.vals.includes(digits)) classNoVar.vals.push(digits);
        getActiveContext()['CLASS_NO'] = digits;
      }
    }

    markDirty();
    renderAll();
    return;
  }

  // Adding a new value mutates Config — block if Config is locked
  if (!_guardSection('config')) {
    renderAll();
    return;
  }

  const masterVar = getActiveMaster().find(m => m.key === key);
  if (!masterVar) { renderAll(); return; }

  // Replace the dropdown with an inline text input directly in the left panel
  const sel = document.querySelector(`[data-ctx-key="${key}"]`);
  if (!sel) { renderAll(); return; }

  const comboDiv = sel.closest('.combo');
  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'combo';
  input.placeholder = 'New value, press Enter…';
  input.style.cssText = 'width:100%;box-sizing:border-box;';
  comboDiv.replaceWith(input);
  input.focus();

  const saveEdit = () => {
    const raw = input.value.trim();
    if (raw) {
      const newValue = normalizeChipVal(raw);
      if (!masterVar.vals.includes(newValue)) masterVar.vals.push(newValue);
      getActiveContext()[key] = newValue;
      // Run the same CLASS → CLASS_NO auto-derivation as the non-new path
      if (key === 'CLASS') {
        const digits = newValue.replace(/[^0-9]/g, '');
        const classNoVar = getActiveMaster().find(m => m.key === 'CLASS_NO');
        if (classNoVar && digits) {
          if (!classNoVar.vals.includes(digits)) classNoVar.vals.push(digits);
          getActiveContext()['CLASS_NO'] = digits;
        }
      }
      markDirty();
    }
    renderAll();
  };

  input.onblur    = saveEdit;
  input.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); renderAll(); }
  };
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
    if (newLevel > 4) {
      _showToast('Cannot nest deeper — maximum 4 levels of nesting allowed.');
      return;
    }

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

  parts.splice(insertAt, 0, { id: newId, name: 'New Part', midx: null, level: newLevel, enabled: true });
  State.selectedPartId = newId;
  markDirty();
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

window.addGroup = () => {
  const parts = getActiveParts();
  const newId = 'g' + Date.now();
  parts.push({ id: newId, name: 'Group', type: 'group', level: 0, enabled: true });
  State.selectedPartId = newId;
  markDirty();
  renderAll();
  setTimeout(() => {
    const el = document.getElementById(`part-name-${newId}`);
    if (!el) return;
    const input = document.createElement('input');
    input.value = 'Group'; input.className = 'combo';
    input.style.cssText = 'flex:1;font-size:13px';
    el.replaceWith(input); input.focus(); input.select();
    const save = () => {
      const val = input.value.trim();
      const part = getActiveParts().find(p => p.id === newId);
      if (part && val) part.name = val;
      renderAll();
    };
    input.onblur = save;
    input.onkeydown = e => {
      if (e.key === 'Enter') { input.onblur = null; save(); }
      if (e.key === 'Escape') {
        input.onblur = null;
        State.parts[State.activeClassId] = getActiveParts().filter(p => p.id !== newId);
        State.selectedPartId = null;
        renderAll();
      }
    };
  }, 50);
};

window.convertToGroup = id => {
  const part = getActiveParts().find(p => p.id === id);
  if (!part) return;
  part.type    = 'group';
  part.level   = 0;
  part.midx    = null;
  part.enabled = true;
  markDirty();
  renderAll();
};

window.convertToPart = id => {
  const part = getActiveParts().find(p => p.id === id);
  if (!part) return;
  delete part.type;
  markDirty();
  renderAll();
};

window.deletePart = id => {
  const part = getActiveParts().find(p => p.id === id);
  showConfirm(
    'Delete Part',
    `Delete "${part?.name || 'this part'}"?`,
    () => {
      State.parts[State.activeClassId] = getActiveParts().filter(p => p.id !== id);
      if (State.selectedPartId === id) State.selectedPartId = null;
      // Clean up orphaned rule entries for the deleted part
      const rules = getActiveRules();
      if (rules[id]) delete rules[id];
      const fnRules = getActiveFileNameRules();
      if (fnRules[id]) delete fnRules[id];
      markDirty();
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
  if (parts[idx]?.type === 'group') return;

  const part       = parts[idx];
  const currentLvl = part.level || 0;
  if (currentLvl >= 4) {
    _showToast('Maximum nesting depth (4 levels) reached.');
    return;
  }

  // The part above must exist at level >= currentLvl for indenting to make sense
  const above = parts[idx - 1];
  if (!above || (above.level || 0) < currentLvl) {
    _showToast('Cannot indent — no valid parent above this part.');
    return;
  }

  part.level = currentLvl + 1;
  part.midx  = null;
  markDirty();
  renderAll();
};

/**
 * Decreases a part's nesting level by 1 (promotes it one level up).
 * Cannot outdent a top-level part.
 */
window.outdentPart = id => {
  const part = getActiveParts().find(p => p.id === id);
  if (!part || part.type === 'group' || (part.level || 0) === 0) return;

  part.level = (part.level || 0) - 1;
  part.midx  = null;
  markDirty();
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

  if (newLvl > 4) {
    _showToast('Cannot nest deeper — maximum 4 levels of nesting allowed.');
    return;
  }

  // Prevent nesting a parent under one of its own descendants
  const srcLevel = src.level || 0;
  for (let j = srcIdx + 1; j < parts.length; j++) {
    if ((parts[j].level || 0) <= srcLevel) break;
    if (parts[j].id === targetId) {
      showConfirm('Cannot Nest', 'Cannot move a part inside one of its own sub-components.', () => {});
      return;
    }
  }

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
  markDirty();
  renderAll();
};
window.reorderParts = orderedIds => {
  const parts   = getActiveParts();
  const byId    = Object.fromEntries(parts.map(p => [p.id, p]));
  State.parts[State.activeClassId] = orderedIds.map(id => byId[id]).filter(Boolean);
  markDirty();
  renderAll();
};

/** Duplicate a single part (and its rules) immediately below the original. */
window.duplicatePart = id => {
  const parts  = getActiveParts();
  const srcIdx = parts.findIndex(p => p.id === id);
  if (srcIdx === -1) return;
  const src   = parts[srcIdx];
  const newId = 'p' + Date.now();
  const newPart = { ...src, id: newId, name: src.name + ' (Copy)', midx: null };
  // Copy all rules for this part
  const activeRules = getActiveRules();
  if (activeRules[id]) activeRules[newId] = JSON.parse(JSON.stringify(activeRules[id]));
  // Insert after the last descendant of the source
  let insertAt = srcIdx + 1;
  for (let j = srcIdx + 1; j < parts.length; j++) {
    if ((parts[j].level || 0) > (src.level || 0)) insertAt = j + 1;
    else break;
  }
  parts.splice(insertAt, 0, newPart);
  State.selectedPartId = newId;
  markDirty();
  renderAll();
};

/** Toggle a part's enabled state — disabled parts are hidden from the grid but kept in the tree. */
window.togglePartEnabled = id => {
  const part = getActiveParts().find(p => p.id === id);
  if (!part) return;
  const wasEnabled = part.enabled !== false;
  part.enabled = part.enabled === false;  // false → true, true/undefined → false
  if (typeof logChange === 'function') {
    logChange(State.activeClassId, 'part_enabled', id, part.name, null, null, String(wasEnabled), String(part.enabled));
  }
  markDirty();
  renderAll();
};

/* ── Context variables ───────────────────────────────────── */
window.addVariable = () => {
  if (!_guardSection('config')) return;
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
  if (!_guardSection('config')) return;
  const master = getActiveMaster().find(m => m.key === k);

  // Count how many rule templates reference this key so the user knows the impact
  const kEscaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kRegex   = new RegExp(`\\b${kEscaped}\\b`);
  let refCount = 0;
  Object.values(getActiveRules()).forEach(partRules =>
    Object.values(partRules).forEach(formula => { if (kRegex.test(formula)) refCount++; })
  );
  Object.values(getActiveFileNameRules()).forEach(formula => {
    if (kRegex.test(formula)) refCount++;
  });

  const refNote = refCount > 0
    ? ` It is referenced in ${refCount} rule formula${refCount !== 1 ? 's' : ''} — those references will become blank.`
    : '';

  showConfirm(
    'Delete Variable',
    `Delete "${master?.label || k}"?${refNote}`,
    () => {
      State.master[State.activeClassId] = getActiveMaster().filter(m => m.key !== k);
      delete getActiveContext()[k];
      // Clear stale tokens from every rule template
      const clearToken = formula =>
        typeof formula === 'string' ? formula.replace(new RegExp(`\\b${kEscaped}\\b`, 'g'), '') : formula;
      Object.values(getActiveRules()).forEach(partRules => {
        Object.keys(partRules).forEach(pid => { partRules[pid] = clearToken(partRules[pid]); });
      });
      const fnRules = getActiveFileNameRules();
      Object.keys(fnRules).forEach(pid => { fnRules[pid] = clearToken(fnRules[pid]); });
      markDirty();
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
  if (!_guardSection('config')) return;
  if (!newLabel) return;
  const master = getActiveMaster().find(m => m.key === oldKey);
  if (!master) return;

  const newKey = newLabel.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
  if (!newKey) {
    showConfirm('Invalid Name', 'Label must contain at least one letter or number.', () => {});
    return;
  }
  let finalKey = newKey;
  let suffix = 2;
  while (getActiveMaster().some(m => m.key === finalKey && m.key !== oldKey)) {
    finalKey = newKey + '_' + suffix++;
  }

  master.label = newLabel;

  if (finalKey !== oldKey) {
    master.key = finalKey;
    // Migrate context value
    const ctx = getActiveContext();
    if (ctx[oldKey] !== undefined) {
      ctx[finalKey] = ctx[oldKey];
      delete ctx[oldKey];
    }
    // Migrate iProperty rule templates that reference the old token
    Object.values(getActiveRules()).forEach(partRules => {
      Object.keys(partRules).forEach(propId => {
        if (typeof partRules[propId] === 'string') {
          partRules[propId] = partRules[propId].replace(
            new RegExp(`\\b${oldKey}\\b`, 'g'), finalKey
          );
        }
      });
    });
    // Migrate file name rule templates that reference the old token
    const fnRules = getActiveFileNameRules();
    Object.keys(fnRules).forEach(partId => {
      if (typeof fnRules[partId] === 'string') {
        fnRules[partId] = fnRules[partId].replace(
          new RegExp(`\\b${oldKey}\\b`, 'g'), finalKey
        );
      }
    });
  }
  markDirty();
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
  if (!_guardSection('config')) return;
  if (!v?.trim()) return;
  const master = getActiveMaster().find(m => m.key === k);
  if (master && !master.vals.includes(v.trim())) {
    master.vals.push(v.trim());
    markDirty();
    renderAll();
  }
};

/* Comma-separated batch add */
// Normalize a numeric string: prepend 0 to bare decimals (.25 → 0.25),
// then format any decimal number to exactly 3 decimal places.
window.normalizeChipVal = s => {
  let v = s.replace(/^(-?)\.(\d)/, '$10.$2');   // .25 → 0.25
  if (/^-?\d+\.\d*$/.test(v)) v = parseFloat(v).toFixed(3);
  return v;
};

window.addChips = (k, rawValue) => {
  if (!_guardSection('config')) return;
  if (!rawValue?.trim()) return;
  const master = getActiveMaster().find(m => m.key === k);
  if (!master) return;
  const isDecimalVar = master.vals.some(v => /\./.test(v));
  const values = rawValue.split(',').map(v => {
    const normalized = normalizeChipVal(v.trim());
    return (isDecimalVar && /^-?\d+$/.test(normalized))
      ? parseFloat(normalized).toFixed(3)
      : normalized;
  }).filter(v => v && !master.vals.includes(v));
  if (values.length) { master.vals.push(...values); markDirty(); renderAll(); }
};

/* Numeric range generator */
window.addChipsRange = (k, start, end, step) => {
  if (!_guardSection('config')) return;
  const master = getActiveMaster().find(m => m.key === k);
  if (!master || step <= 0 || start > end) return;

  // Detect decimal places from step, capped at 3
  const stepStr  = step.toString();
  const rawDecimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
  const decimals = Math.min(rawDecimals, 3);

  // Integer arithmetic prevents floating-point drift (e.g. 0.1 + 0.2 ≠ 0.3)
  const factor = Math.pow(10, Math.max(rawDecimals, decimals));
  const iStart = Math.round(start * factor);
  const iEnd   = Math.round(end   * factor);
  const iStep  = Math.round(step  * factor);

  const estimatedCount = iStep > 0 ? Math.floor((iEnd - iStart) / iStep) + 1 : 0;

  const doAdd = () => {
    const values = [];
    for (let v = iStart; v <= iEnd; v += iStep) {
      const raw = (v / factor).toString();
      const formatted = decimals > 0 ? parseFloat(raw).toFixed(3) : normalizeChipVal(raw);
      if (!master.vals.includes(formatted)) values.push(formatted);
    }
    if (values.length) { master.vals.push(...values); markDirty(); renderAll(); }
  };

  if (estimatedCount > 500) {
    showConfirm(
      'Large Range',
      `This will add up to ${estimatedCount.toLocaleString()} values. Continue?`,
      doAdd
    );
  } else {
    doAdd();
  }
};

window.removeChip = (k, v) => {
  if (!_guardSection('config')) return;
  const m = getActiveMaster().find(x => x.key === k);
  if (m) { m.vals = m.vals.filter(x => x !== v); markDirty(); renderAll(); }
};

/* ── Properties (columns) ────────────────────────────────── */
window.addProp = () => {
  if (!_guardSection('rules')) return;
  const newProp = { id: 'f' + Date.now(), name: 'New Column' };
  getActiveProps().push(newProp);
  // Ensure new column starts visible
  const hidden = getHiddenProps();
  const hi = hidden.indexOf(newProp.id);
  if (hi !== -1) hidden.splice(hi, 1);

  // Auto-select first part so the rule items appear in the right panel
  if (!State.selectedPartId) {
    const first = getActiveParts().find(p => p.enabled !== false);
    if (first) State.selectedPartId = first.id;
  }

  markDirty();
  renderAll();

  setTimeout(() => {
    // ── Preferred: inline-edit name in the rule item (right panel) ──
    const nameEl = document.querySelector(`[data-edit="propName"][data-id="${newProp.id}"]`);
    if (nameEl) {
      const input = document.createElement('input');
      input.value     = nameEl.textContent.trim();
      input.className = nameEl.className;
      input.style.cssText = 'font-weight:bold;font-size:inherit;min-width:80px;width:100%;box-sizing:border-box';
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commitName = () => {
        const val = input.value.trim();
        if (val) { const p = getActiveProps().find(p => p.id === newProp.id); if (p) p.name = val; }
        markDirty();
      };

      const goToTextarea = () => {
        renderAll();
        setTimeout(() => {
          document.querySelector(`textarea[data-prop-id="${newProp.id}"]`)?.focus();
        }, 30);
      };

      input.onblur    = () => { commitName(); renderAll(); };
      input.onkeydown = e => {
        if (e.key === 'Escape') { renderAll(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          input.onblur = null;
          commitName();
          goToTextarea();
        }
      };
      return;
    }

    // ── Fallback: pill in COLUMNS bar (no parts at all) ──
    const pill = document.querySelector(`[data-prop-id="${newProp.id}"]`);
    if (!pill) return;
    const input = document.createElement('input');
    input.value       = pill.textContent.trim();
    input.placeholder = 'Column name…';
    input.style.cssText = pill.style.cssText;
    input.className     = pill.className;
    input.style.width   = '110px';
    input.style.cursor  = 'text';
    pill.replaceWith(input);
    input.focus();
    input.select();
    const saveEdit = () => {
      const val = input.value.trim();
      if (val) { const p = getActiveProps().find(p => p.id === newProp.id); if (p) p.name = val; }
      renderAll();
    };
    input.onblur    = saveEdit;
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); input.onblur = null; saveEdit(); }
      if (e.key === 'Escape') renderAll();
    };
  }, 50);
};

window.togglePropVisibility = id => {
  if (!_guardSection('rules')) return;
  const hidden = getHiddenProps();
  const idx = hidden.indexOf(id);
  if (idx === -1) hidden.push(id);
  else hidden.splice(idx, 1);
  markDirty();
  renderAll();
};

window.deleteProp = id => {
  if (!_guardSection('rules')) return;
  const prop = getActiveProps().find(p => p.id === id);
  showConfirm(
    'Delete Property Column',
    `Delete "${prop?.name || 'this column'}"? This will remove it from all parts.`,
    () => {
      State.props[State.activeClassId] = getActiveProps().filter(p => p.id !== id);
      Object.keys(getActiveRules()).forEach(partId => {
        delete getActiveRules()[partId][id];
      });
      markDirty();
      renderAll();
    }
  );
};

/* ── File name rule update ───────────────────────────────── */
window.updateFileNameRule = function(partId, value) {
  if (!_guardSection('rules')) return;
  const fnRules = getActiveFileNameRules();
  fnRules[partId] = value;
  markDirty();
  renderGrid();
};

/* ── Rule update ─────────────────────────────────────────── */
function updateRule(partId, propId, value) {
  if (!_guardSection('rules')) return;
  const activeRules = getActiveRules();
  if (!activeRules[partId]) activeRules[partId] = {};
  activeRules[partId][propId] = value;
  markDirty();
  renderGrid();
}

/**
 * Directly sets a rule formula to a literal string value.
 * Used by the file-picker cell action — bypasses the rules section lock
 * since the user is acting on the grid cell, not the rules panel.
 */
window.setRuleLiteral = (partId, propId, literalValue) => {
  const activeRules = getActiveRules();
  if (!activeRules[partId]) activeRules[partId] = {};
  const oldValue = activeRules[partId][propId] || '';
  activeRules[partId][propId] = literalValue;
  if (typeof logChange === 'function' && oldValue !== literalValue) {
    const partName = getActiveParts().find(p => p.id === partId)?.name || partId;
    const propName = getActiveProps().find(p => p.id === propId)?.name || propId;
    logChange(State.activeClassId, 'rule', partId, partName, propId, propName, oldValue, literalValue);
  }
  markDirty();
  renderAll();
};

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
  if (!State.fileNameRules) State.fileNameRules = {};
  State.fileNameRules[id] = {};
  if (!State.inventorMaps)       State.inventorMaps       = {};
  State.inventorMaps[id]       = {};
  if (!State.exportSelections)   State.exportSelections   = {};
  State.exportSelections[id]   = {};
  if (!State.fileNameOverrides)  State.fileNameOverrides  = {};
  State.fileNameOverrides[id]  = {};
  if (!State.inventorBaseFolders) State.inventorBaseFolders = {};
  State.inventorBaseFolders[id] = '';
  // New tabs start unlocked — no lock entries needed
  if (!State.lockedTabs)     State.lockedTabs     = {};
  if (!State.lockedSections) State.lockedSections = {};
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
  State.master[newId]      = JSON.parse(JSON.stringify(State.master[sourceId]       || []));
  State.context[newId]     = JSON.parse(JSON.stringify(State.context[sourceId]      || {}));
  State.parts[newId]       = JSON.parse(JSON.stringify(State.parts[sourceId]        || []));
  State.props[newId]       = JSON.parse(JSON.stringify(State.props[sourceId]        || []));
  State.rules[newId]       = JSON.parse(JSON.stringify(State.rules[sourceId]        || {}));
  if (!State.fileNameRules) State.fileNameRules = {};
  State.fileNameRules[newId] = JSON.parse(JSON.stringify((State.fileNameRules || {})[sourceId] || {}));
  State.hiddenProps[newId] = JSON.parse(JSON.stringify((State.hiddenProps || {})[sourceId] || []));
  if (!State.inventorMaps)    State.inventorMaps    = {};
  State.inventorMaps[newId]    = JSON.parse(JSON.stringify((State.inventorMaps    || {})[sourceId] || {}));
  if (!State.exportSelections) State.exportSelections = {};
  State.exportSelections[newId] = JSON.parse(JSON.stringify((State.exportSelections || {})[sourceId] || {}));
  if (!State.fileNameOverrides)   State.fileNameOverrides   = {};
  State.fileNameOverrides[newId]   = JSON.parse(JSON.stringify((State.fileNameOverrides   || {})[sourceId] || {}));
  if (!State.inventorBaseFolders) State.inventorBaseFolders = {};
  State.inventorBaseFolders[newId] = (State.inventorBaseFolders[sourceId] || '');
  // Clones are always unlocked — never inherit the source tab's locks
  if (!State.lockedTabs)     State.lockedTabs     = {};
  if (!State.lockedSections) State.lockedSections = {};
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
  const doDelete = () => showConfirm(
    'Delete Tab',
    `Delete tab "${tabName}"? All data in this tab will be lost.`,
    () => {
      State.productClasses = State.productClasses.filter(c => c.id !== id);
      delete State.master[id];
      delete State.context[id];
      delete State.parts[id];
      delete State.props[id];
      delete State.rules[id];
      if (State.hiddenProps)        delete State.hiddenProps[id];
      if (State.fileNameRules)      delete State.fileNameRules[id];
      if (State.inventorMaps)       delete State.inventorMaps[id];
      if (State.exportSelections)   delete State.exportSelections[id];
      if (State.fileNameOverrides)  delete State.fileNameOverrides[id];
      if (State.inventorBaseFolders) delete State.inventorBaseFolders[id];
      // Clean up lock data for deleted tab
      if (State.lockedTabs)     delete State.lockedTabs[id];
      if (State.lockedSections) {
        delete State.lockedSections[id + ':rules'];
        delete State.lockedSections[id + ':config'];
      }
      if (window._unlockedTabs)     window._unlockedTabs.delete(id);
      if (window._unlockedSections) {
        window._unlockedSections.delete(id + ':rules');
        window._unlockedSections.delete(id + ':config');
      }
      if (State.activeClassId === id) {
        State.activeClassId  = State.productClasses[0].id;
        State.selectedPartId = null;
      }
      renderAll();
    }
  );
  if (typeof window._requireDeletePin === 'function') {
    window._requireDeletePin(`Delete Tab "${tabName}"`, doDelete);
  } else {
    doDelete();
  }
};

/**
 * Renames the currently active tab.
 * Called from ui.js when the user edits the center header.
 */
window.renameActiveTab = newName => {
  const cls = State.productClasses.find(c => c.id === State.activeClassId);
  if (cls && newName) { cls.name = newName; markDirty(); renderAll(); }
};

/* ── Tab password lock ───────────────────────────────────── */

async function _sha256hex(text) {  // kept for legacy hash migration
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _pbkdf2Hex(pin, saltHex) {
  const keyMat = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMat, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _hashPinV2(pin) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex   = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'v2:' + saltHex + ':' + await _pbkdf2Hex(pin, saltHex);
}

async function _verifyPinLocal(pin, stored) {
  if (!stored) return false;
  if (stored.startsWith('v2:')) {
    const parts = stored.split(':');
    return parts[2] === await _pbkdf2Hex(pin, parts[1]);
  }
  return stored === await _sha256hex(pin); // legacy
}

/**
 * Lock the active tab with a PIN. Prompts twice to confirm.
 */
window.lockTab = id => {
  showPrompt('Set PIN', 'Enter a PIN to lock this tab:', '', pin1 => {
    if (!pin1) return;
    showPrompt('Confirm PIN', 'Re-enter PIN to confirm:', '', async pin2 => {
      if (pin1 !== pin2) {
        showConfirm('PIN Mismatch', 'PINs did not match. Tab not locked.', () => {});
        return;
      }
      if (!State.lockedTabs) State.lockedTabs = {};
      State.lockedTabs[id] = await _hashPinV2(pin1);
      // Track unlocked session state (in-memory only, not persisted)
      if (!window._unlockedTabs) window._unlockedTabs = new Set();
      window._unlockedTabs.delete(id);
      renderAll();
    });
  });
};

/**
 * Unlock a tab by verifying the PIN. Unlocked state is session-only (not saved).
 */
window.unlockTab = (id, onSuccess) => {
  showPrompt('Unlock Tab', 'Enter PIN to unlock:', '', async pin => {
    if (!pin) return;
    if (await _verifyPinLocal(pin, (State.lockedTabs || {})[id])) {
      if (!window._unlockedTabs) window._unlockedTabs = new Set();
      window._unlockedTabs.add(id);
      if (onSuccess) onSuccess();
      renderAll();
    } else {
      showConfirm('Wrong PIN', 'Incorrect PIN. Try again.', () => {});
    }
  });
};

window.removeTabLock = id => {
  showPrompt('Remove Lock', 'Enter current PIN to remove lock:', '', async pin => {
    if (!pin) return;
    if (await _verifyPinLocal(pin, (State.lockedTabs || {})[id])) {
      delete State.lockedTabs[id];
      if (window._unlockedTabs) window._unlockedTabs.delete(id);
      renderAll();
    } else {
      showConfirm('Wrong PIN', 'Incorrect PIN.', () => {});
    }
  });
};

/** Returns true if tab is locked AND not currently unlocked for this session */
window.isTabLocked = id => {
  if (!(State.lockedTabs || {})[id]) return false;
  if (window._unlockedTabs && window._unlockedTabs.has(id)) return false;
  return true;
};

/* ── Section password lock (Rules / Config per tab) ─────── */

const _sectionKey = (section) => `${State.activeClassId}:${section}`;

window.lockSection = section => {
  showPrompt(`Lock ${section} — Set PIN`, 'Enter a PIN to lock this section:', '', pin1 => {
    if (!pin1) return;
    showPrompt(`Lock ${section} — Confirm PIN`, 'Re-enter PIN to confirm:', '', async pin2 => {
      if (pin1 !== pin2) {
        showConfirm('PIN Mismatch', 'PINs did not match. Section not locked.', () => {});
        return;
      }
      if (!State.lockedSections) State.lockedSections = {};
      State.lockedSections[_sectionKey(section)] = await _hashPinV2(pin1);
      if (!window._unlockedSections) window._unlockedSections = new Set();
      window._unlockedSections.delete(_sectionKey(section));
      renderAll();
    });
  });
};

window.unlockSection = (section, onSuccess) => {
  showPrompt(`Unlock ${section}`, 'Enter PIN to unlock:', '', async pin => {
    if (!pin) return;
    if (await _verifyPinLocal(pin, (State.lockedSections || {})[_sectionKey(section)])) {
      if (!window._unlockedSections) window._unlockedSections = new Set();
      window._unlockedSections.add(_sectionKey(section));
      if (onSuccess) onSuccess();
      renderAll();
    } else {
      showConfirm('Wrong PIN', 'Incorrect PIN. Try again.', () => {});
    }
  });
};

window.removeSectionLock = section => {
  showPrompt(`Remove ${section} Lock`, 'Enter current PIN to remove lock:', '', async pin => {
    if (!pin) return;
    if (await _verifyPinLocal(pin, (State.lockedSections || {})[_sectionKey(section)])) {
      delete State.lockedSections[_sectionKey(section)];
      if (window._unlockedSections) window._unlockedSections.delete(_sectionKey(section));
      renderAll();
    } else {
      showConfirm('Wrong PIN', 'Incorrect PIN.', () => {});
    }
  });
};

window.isSectionLocked = section => {
  const key = _sectionKey(section);
  if (!(State.lockedSections || {})[key]) return false;
  if (window._unlockedSections && window._unlockedSections.has(key)) return false;
  return true;
};

/**
 * Call at the top of any action that mutates a locked section.
 * Returns true if allowed (not locked, or already unlocked).
 * Returns false and shows unlock prompt if locked.
 */
function _guardSection(section) {
  if (!isSectionLocked(section)) return true;
  unlockSection(section, null);
  return false;
}
