/* ============================================================
   CATEGORIES.JS — Multi-category home screen, lazy loading,
                   per-category state isolation
   ============================================================
   Adding a new category requires zero code changes:
     1. Add an entry to data/categories.json
     2. Drop the category's JSON data file
   The nav bar updates automatically.
   ============================================================ */

'use strict';

/* ── Globals ──────────────────────────────────────────────
   These live on window so every other module can read them. */
window._categories      = [];   // array loaded from categories.json
window._categoryStates  = {};   // { categoryId → State snapshot }
window._categoryDirty   = {};   // { categoryId → bool } unpublished changes
window._activeCategory  = null; // { id, label, file, icon }
window._appScreen       = 'home'; // 'home' | 'workspace'
window._categoriesDirty = false;  // true when categories.json needs pushing

const _CAT_CONFIG = 'data/categories.json';

/* ── Default empty state for a brand-new category ─────── */
function _defaultCategoryState(cat) {
  const tabId = cat.id + '_1';
  return {
    productClasses:    [{ id: tabId, name: 'Tab 1' }],
    activeClassId:     tabId,
    selectedPartId:    null,
    activeRightTab:    'parts',
    master:            { [tabId]: [] },
    context:           { [tabId]: {} },
    parts:             { [tabId]: [] },
    props:             { [tabId]: [] },
    rules:             { [tabId]: {} },
    hiddenProps:       { [tabId]: [] },
    lockedTabs:        {},
    lockedSections:    {},
    inventorMaps:      {},
    fileNameOverrides: {},
    exportSelections:  {}
  };
}

/* ── Capture current State as a plain snapshot ─────────── */
function _captureState() {
  const { dirty, ...s } = State;
  return JSON.parse(JSON.stringify(s));
}

/* ── Apply a snapshot into the live State object ──────── */
function _applySnapshot(snapshot) {
  Object.keys(State).forEach(k => delete State[k]);
  Object.assign(State, JSON.parse(JSON.stringify(snapshot)));
  window._unlockedTabs     = new Set();
  window._unlockedSections = new Set();
  migrateState();
  State.dirty = false;
}

/* ── Topbar button visibility ─────────────────────────── */
function _setBtnVisibility(inWorkspace) {
  const _s = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  };
  _s('btnHome',           inWorkspace);
  _s('btnNewTab',         inWorkspace);
  _s('btnSave',           inWorkspace);
  _s('btnExportInventor', inWorkspace);
  _s('btnPublish',        true);         // always visible
  _s('btnHistory',        true);         // always visible
}

/* ── Init: load categories.json, show home screen ─────── */
async function initCategories() {
  window._appScreen = 'home';
  document.getElementById('mainContainer').style.display = 'none';
  document.getElementById('homeScreen').style.display    = '';
  _setBtnVisibility(false);

  try {
    const r = await fetch(_CAT_CONFIG + '?t=' + Date.now());
    if (!r.ok) throw new Error('not found');
    window._categories = await r.json();
  } catch(_) {
    // Fallback: treat the existing buckets file as the sole category
    window._categories = [
      { id: 'buckets', label: 'Buckets', file: 'data/buckets_1.json', icon: '🪣' }
    ];
  }

  renderHomeScreen();
}

/* ── Home screen renderer ─────────────────────────────── */
function renderHomeScreen() {
  const screen = document.getElementById('homeScreen');
  if (!screen) return;

  // Keep layout correct
  screen.style.display = '';
  document.getElementById('mainContainer').style.display = 'none';
  _setBtnVisibility(false);

  // App title in the tabs slot
  const tabsEl = document.getElementById('tabs');
  if (tabsEl) {
    tabsEl.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'app-title';
    title.textContent = 'Configurator Pro';
    tabsEl.appendChild(title);
  }

  screen.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'home-heading';
  heading.textContent = 'Select a workspace';
  screen.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'home-list';

  window._categories.forEach(cat => {
    const cached    = window._categoryStates[cat.id];
    const tabCount  = cached ? (cached.productClasses || []).length : null;
    const partCount = cached
      ? Object.values(cached.parts || {}).reduce((n, a) => n + a.length, 0)
      : null;
    const hasDirty  = !!(window._categoryDirty[cat.id]);

    const row = document.createElement('div');
    row.className = 'home-row';
    row.tabIndex  = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open ${cat.label} workspace`);

    // Name (editable inline on rename)
    const nameEl = document.createElement('div');
    nameEl.className = 'home-row-name';
    nameEl.textContent = cat.label;
    row.appendChild(nameEl);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'home-row-spacer';
    row.appendChild(spacer);

    // Meta: tab/part counts
    const metaEl = document.createElement('div');
    metaEl.className = 'home-row-meta';
    if (tabCount !== null) {
      metaEl.textContent =
        `${tabCount} tab${tabCount !== 1 ? 's' : ''} · ` +
        `${partCount} part${partCount !== 1 ? 's' : ''}`;
    } else {
      metaEl.textContent = 'Not yet loaded';
      metaEl.classList.add('home-row-meta-unloaded');
    }
    row.appendChild(metaEl);

    // Unsaved-changes dot
    if (hasDirty) {
      const dot = document.createElement('span');
      dot.className = 'home-row-dirty';
      dot.title = 'Unpublished changes';
      dot.textContent = '●';
      row.appendChild(dot);
    }

    // Actions (visible on hover)
    const actions = document.createElement('div');
    actions.className = 'home-row-actions';

    const renBtn = document.createElement('button');
    renBtn.className = 'btn home-row-btn';
    renBtn.title = 'Rename';
    renBtn.textContent = 'Rename';
    renBtn.onclick = e => { e.stopPropagation(); _renameCategory(cat, nameEl); };
    actions.appendChild(renBtn);

    if (window._categories.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn home-row-btn home-row-delete-btn';
      delBtn.title = 'Remove from nav (data file on GitHub is not deleted)';
      delBtn.innerHTML = '&times;';
      delBtn.onclick = e => { e.stopPropagation(); _deleteCategory(cat); };
      actions.appendChild(delBtn);
    }

    row.appendChild(actions);

    row.onclick   = () => enterCategory(cat);
    row.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterCategory(cat); }
    };

    list.appendChild(row);
  });

  // + Add new category row
  const addRow = document.createElement('div');
  addRow.className = 'home-row home-row-add';
  addRow.tabIndex  = 0;
  addRow.setAttribute('role', 'button');
  addRow.innerHTML = '<span class="home-row-add-label">+ Add new category</span>';
  addRow.onclick   = _addCategoryPrompt;
  addRow.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _addCategoryPrompt(); }
  };
  list.appendChild(addRow);

  screen.appendChild(list);
}

/* ── Enter a category workspace ────────────────────────── */
async function enterCategory(cat) {
  const loadEl = document.getElementById('loadingIndicator');

  if (window._categoryStates[cat.id]) {
    // Already in memory — instant switch
    _applySnapshot(window._categoryStates[cat.id]);
  } else {
    // Show loading state in workspace
    document.getElementById('homeScreen').style.display    = 'none';
    document.getElementById('mainContainer').style.display = '';
    _setBtnVisibility(true);
    if (loadEl) loadEl.style.display = '';

    try {
      const r = await fetch(cat.file + '?t=' + Date.now());
      if (r.ok) {
        _applySnapshot(await r.json());
      } else {
        _applySnapshot(_defaultCategoryState(cat));
      }
    } catch(_) {
      _applySnapshot(_defaultCategoryState(cat));
    }

    if (loadEl) loadEl.style.display = 'none';

    // Cache it
    window._categoryStates[cat.id] = _captureState();
  }

  window._activeCategory = cat;
  window._appScreen      = 'workspace';

  document.getElementById('homeScreen').style.display    = 'none';
  document.getElementById('mainContainer').style.display = '';
  _setBtnVisibility(true);

  renderAll();

  // Show per-category autosave banner if applicable
  if (localStorage.getItem(_autosaveKey())) {
    _showAutosaveBanner();
  }
}

/* ── Return to home screen ─────────────────────────────── */
function goHome() {
  if (window._activeCategory) {
    // Save current state back to the cache
    window._categoryStates[window._activeCategory.id] = _captureState();
    window._categoryDirty[window._activeCategory.id]  = !!State.dirty;
  }

  window._activeCategory = null;
  window._appScreen      = 'home';

  document.getElementById('mainContainer').style.display = 'none';
  document.getElementById('homeScreen').style.display    = '';

  renderHomeScreen();
}

/* ── Rename a category (inline in the card) ────────────── */
function _renameCategory(cat, nameEl) {
  const input = document.createElement('input');
  input.value     = cat.label;
  input.className = 'combo home-card-rename-input';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const save = () => {
    const val = input.value.trim();
    if (val && val !== cat.label) {
      cat.label = val;
      // Also rename the first tab inside the cached state if it matches
      const cached = window._categoryStates[cat.id];
      if (cached && cached.productClasses?.length === 1 &&
          cached.productClasses[0].name === cat.label) {
        // intentionally leave tab name as-is — user controls tabs independently
      }
      window._categoriesDirty = true;
    }
    renderHomeScreen();
  };

  input.onblur    = save;
  input.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { renderHomeScreen(); }
  };
}

/* ── Delete a category from the nav ────────────────────── */
function _deleteCategory(cat) {
  if (window._categories.length <= 1) return;
  showConfirm(
    `Remove "${cat.label}"?`,
    'This removes it from the nav. The data file on GitHub is not deleted.',
    () => {
      window._categories = window._categories.filter(c => c.id !== cat.id);
      delete window._categoryStates[cat.id];
      delete window._categoryDirty[cat.id];
      window._categoriesDirty = true;
      renderHomeScreen();
    }
  );
}

/* ── Add a new category ────────────────────────────────── */
function _addCategoryPrompt() {
  showPrompt('New Category', 'Enter a name:', 'New Category', label => {
    const id  = 'cat_' + Date.now();
    const cat = { id, label, file: `data/${id}.json`, icon: '📁' };
    window._categories.push(cat);
    window._categoryStates[cat.id] = _defaultCategoryState(cat);
    window._categoriesDirty = true;
    enterCategory(cat);
  });
}
