/* ============================================================
   GITHUB.JS — GitHub-backed publish & history
   ============================================================
   Lets the team push the config JSON directly to GitHub from
   the browser. Changes go live for everyone as soon as they
   reload the tool.

   Storage:
     gh_pat       — GitHub Personal Access Token (sessionStorage: cleared
                    when the tab closes, so XSS / shared-device risk is
                    bounded by the current session)
     gh_pin_hash  — PBKDF2 hash of the PIN (localStorage, hashed-only)
   ============================================================ */

'use strict';

const _GH_OWNER    = 'varunlanga-glitch';
const _GH_REPO     = 'daequip-config-tool';
const _GH_CAT_PATH = 'data/categories.json';

// Dynamic helpers — resolves to the active category's file at call time
const _ghCatFilePath = () => window._activeCategory?.file || 'data/buckets_1.json';
const _ghCatFileApi  = () => `https://api.github.com/repos/${_GH_OWNER}/${_GH_REPO}/contents/${_ghCatFilePath()}`;
const _ghCatCfgApi   = () => `https://api.github.com/repos/${_GH_OWNER}/${_GH_REPO}/contents/${_GH_CAT_PATH}`;

const _TOKEN_KEY = 'gh_pat';
const _PIN_KEY   = 'gh_pin_hash';

/* ── PIN helpers (PBKDF2 with salt; falls back to legacy SHA-256) ── */
async function _pbkdf2HexGh(pin, saltHex) {
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

async function _hashPin(pin) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex   = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'v2:' + saltHex + ':' + await _pbkdf2HexGh(pin, saltHex);
}

async function _checkPin(pin) {
  const stored = localStorage.getItem(_PIN_KEY);
  if (!stored) return false;
  if (stored.startsWith('v2:')) {
    const parts = stored.split(':');
    return parts[2] === await _pbkdf2HexGh(pin, parts[1]);
  }
  // Legacy: plain SHA-256
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  const legacyHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return stored === legacyHash;
}

/* ── GitHub API helpers ───────────────────────────────── */
async function _ghFetch(method, url, token, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    const text = await r.text();
    let msg = `GitHub API ${r.status}`;
    try { msg = JSON.parse(text).message || msg; } catch(_) {}
    throw new Error(msg);
  }
  return r.json();
}

async function _ghGetFile(token, apiUrl) {
  return _ghFetch('GET', apiUrl || _ghCatFileApi(), token);
}

async function _ghPushFile(token, content, sha, message, apiUrl) {
  // btoa with UTF-8 safety
  const encoded = btoa(unescape(encodeURIComponent(content)));
  return _ghFetch('PUT', apiUrl || _ghCatFileApi(), token, { message, content: encoded, sha });
}

async function _ghGetHistory() {
  const url = `https://api.github.com/repos/${_GH_OWNER}/${_GH_REPO}/commits?path=${_ghCatFilePath()}&per_page=10`;
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

async function _ghGetFileAtRef(ref) {
  const r = await fetch(`${_ghCatFileApi()}?ref=${ref}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  return decodeURIComponent(escape(atob(data.content)));
}

/* ── Simple toast notification ────────────────────────── */
function _ghToast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'gh-toast' + (isError ? ' gh-toast-error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('gh-toast-visible'));
  setTimeout(() => {
    el.classList.remove('gh-toast-visible');
    setTimeout(() => el.remove(), 400);
  }, 3500);
}

/* ── Setup modal (first-time: token + PIN) ────────────── */
function _openSetupModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:2000';
  overlay.innerHTML = `
    <div class="confirm-box gh-modal">
      <div class="confirm-title">☁ GitHub Publish Setup</div>
      <p class="gh-setup-hint">
        Enter your GitHub token once — it's stored only in this browser.
        Your PIN protects against accidental publishes.
      </p>
      <div class="gh-form">
        <label class="gh-label">GitHub Personal Access Token</label>
        <input id="ghSetupToken" type="password" class="combo gh-input"
          placeholder="github_pat_…" autocomplete="off" spellcheck="false">
        <label class="gh-label">Set a PIN (digits only)</label>
        <input id="ghSetupPin" type="password" inputmode="numeric" maxlength="8"
          class="combo gh-input gh-pin-input" placeholder="e.g. 1234" autocomplete="new-password">
        <input id="ghSetupPin2" type="password" inputmode="numeric" maxlength="8"
          class="combo gh-input gh-pin-input" placeholder="Confirm PIN" autocomplete="new-password">
        <div id="ghSetupErr" class="gh-error"></div>
      </div>
      <div class="confirm-buttons">
        <button class="btn btn-cancel" id="ghSetupCancel">Cancel</button>
        <button class="btn btn-confirm" id="ghSetupSave">Save &amp; Continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const err  = overlay.querySelector('#ghSetupErr');
  const save = overlay.querySelector('#ghSetupSave');

  overlay.querySelector('#ghSetupCancel').onclick = () => overlay.remove();
  save.onclick = async () => {
    const token = overlay.querySelector('#ghSetupToken').value.trim();
    const pin   = overlay.querySelector('#ghSetupPin').value;
    const pin2  = overlay.querySelector('#ghSetupPin2').value;

    if (!token)       { err.textContent = 'Token is required.'; return; }
    if (!pin)         { err.textContent = 'PIN is required.'; return; }
    if (pin !== pin2) { err.textContent = 'PINs do not match.'; return; }
    if (!/^\d+$/.test(pin)) { err.textContent = 'PIN must be digits only.'; return; }

    save.disabled = true;
    err.style.color = 'var(--muted)';
    err.textContent = 'Verifying token…';

    try {
      // Verify against the categories config (always exists) or fallback file
      const verifyApi = `https://api.github.com/repos/${_GH_OWNER}/${_GH_REPO}/contents/data/categories.json`;
      await _ghGetFile(token, verifyApi);
    } catch(e) {
      err.style.color = '#e74c3c';
      err.textContent = 'Token check failed — ensure it has Contents: Read & Write.';
      save.disabled = false;
      return;
    }

    sessionStorage.setItem(_TOKEN_KEY, token);
    localStorage.setItem(_PIN_KEY, await _hashPin(pin));
    window._ghSessionToken = token;
    overlay.remove();
    onDone(token);
  };
}

/* ── PIN entry modal ──────────────────────────────────── */
function _openPinModal(actionLabel, onCorrect) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:2000';
  overlay.innerHTML = `
    <div class="confirm-box gh-modal" style="max-width:300px">
      <div class="confirm-title gh-pin-modal-title"></div>
      <div class="gh-form" style="align-items:center">
        <input id="ghPinIn" type="password" inputmode="numeric" maxlength="8"
          class="combo gh-input gh-pin-input gh-pin-large"
          placeholder="••••" autocomplete="off">
        <div id="ghPinErr" class="gh-error" style="text-align:center"></div>
      </div>
      <div class="confirm-buttons">
        <button class="btn btn-cancel" id="ghPinCancel">Cancel</button>
        <button class="btn btn-confirm" id="ghPinOk">Unlock</button>
        <button class="btn gh-reset-btn" id="ghPinReset" title="Reset token &amp; PIN">Reset</button>
      </div>
    </div>`;
  overlay.querySelector('.gh-pin-modal-title').textContent = actionLabel;
  document.body.appendChild(overlay);

  const inp  = overlay.querySelector('#ghPinIn');
  const err  = overlay.querySelector('#ghPinErr');
  inp.focus();

  const tryPin = async () => {
    const pin = inp.value;
    if (!pin) { err.textContent = 'Enter your PIN.'; return; }
    if (await _checkPin(pin)) {
      overlay.remove();
      onCorrect();
    } else {
      err.textContent = 'Incorrect PIN.';
      inp.value = '';
      inp.focus();
    }
  };

  inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryPin(); });
  overlay.querySelector('#ghPinOk').onclick     = tryPin;
  overlay.querySelector('#ghPinCancel').onclick = () => overlay.remove();
  overlay.querySelector('#ghPinReset').onclick  = () => {
    sessionStorage.removeItem(_TOKEN_KEY);
    localStorage.removeItem(_PIN_KEY);
    window._ghSessionToken = null;
    overlay.remove();
    openPublishModal();
  };
}

/* ── Token-only re-entry modal (PIN already known) ────── */
function _openTokenOnlyModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:2000';
  overlay.innerHTML = `
    <div class="confirm-box gh-modal">
      <div class="confirm-title">☁ Re-enter GitHub Token</div>
      <p class="gh-setup-hint">
        Your token was cleared (browser data reset). Re-enter it once —
        your PIN is still saved, so you won't need to change it.
      </p>
      <div class="gh-form">
        <label class="gh-label">GitHub Personal Access Token</label>
        <input id="ghRetokenInput" type="password" class="combo gh-input"
          placeholder="github_pat_…" autocomplete="off" spellcheck="false">
        <div id="ghRetokenErr" class="gh-error"></div>
      </div>
      <div class="confirm-buttons">
        <button class="btn btn-cancel" id="ghRetokenCancel">Cancel</button>
        <button class="btn gh-reset-btn" id="ghRetokenFull" title="Reset everything and re-run full setup">Full Reset</button>
        <button class="btn btn-confirm" id="ghRetokenSave">Save &amp; Continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const err  = overlay.querySelector('#ghRetokenErr');
  const save = overlay.querySelector('#ghRetokenSave');
  overlay.querySelector('#ghRetokenInput').focus();

  overlay.querySelector('#ghRetokenCancel').onclick = () => overlay.remove();
  overlay.querySelector('#ghRetokenFull').onclick = () => {
    sessionStorage.removeItem(_TOKEN_KEY);
    localStorage.removeItem(_PIN_KEY);
    overlay.remove();
    _openSetupModal(onDone);
  };

  save.onclick = async () => {
    const token = overlay.querySelector('#ghRetokenInput').value.trim();
    if (!token) { err.textContent = 'Token is required.'; return; }
    save.disabled = true;
    err.style.color = 'var(--muted)';
    err.textContent = 'Verifying token…';
    try {
      const verifyApi = `https://api.github.com/repos/${_GH_OWNER}/${_GH_REPO}/contents/data/categories.json`;
      await _ghGetFile(token, verifyApi);
    } catch(e) {
      err.style.color = '#e74c3c';
      err.textContent = 'Token check failed — ensure it has Contents: Read & Write.';
      save.disabled = false;
      return;
    }
    sessionStorage.setItem(_TOKEN_KEY, token);
    window._ghSessionToken = token;
    overlay.remove();
    onDone(token);
  };
}

/* ── Auth gate: setup if needed, otherwise PIN ────────── */
function _withAuth(label, onToken) {
  // Use session-cached token as fallback when localStorage was cleared mid-session
  const storedToken = sessionStorage.getItem(_TOKEN_KEY) || window._ghSessionToken || null;
  const hasPin      = !!localStorage.getItem(_PIN_KEY);
  const hasToken    = !!storedToken;

  const done = token => {
    if (token) window._ghSessionToken = token;
    onToken(token);
  };

  if (!hasToken && !hasPin) {
    // First time or fully cleared — full setup
    _openSetupModal(done);
  } else if (!hasToken && hasPin) {
    // Token was cleared but PIN hash survived — just re-ask for token
    _openTokenOnlyModal(done);
  } else if (hasToken && !hasPin) {
    // Unusual: token exists but no PIN — full reset to keep them in sync
    sessionStorage.removeItem(_TOKEN_KEY);
    window._ghSessionToken = null;
    _openSetupModal(done);
  } else {
    _openPinModal(label, () => done(storedToken));
  }
}

/* ── PIN-gate for destructive actions (delete tab/workspace) ── */
window._requireDeletePin = function(label, onApproved) {
  const hasPin = !!localStorage.getItem(_PIN_KEY);
  if (!hasPin) { onApproved(); return; }
  _openPinModal(label, onApproved);
};

/* ── Publish modal ────────────────────────────────────── */
function openPublishModal() {
  // Guard: if no category is open (home screen), only allow publishing categories.json
  // (never publish workspace data when _activeCategory is null — it defaults to buckets_1.json
  //  and would overwrite Buckets with whatever state was last in memory)
  if (!window._activeCategory) {
    if (!window._categoriesDirty) {
      alert('No workspace is open. Open a workspace first, then publish from within it.');
      return;
    }
    // Only push categories.json
    _withAuth('🔒 Enter PIN to Publish', async token => {
      try {
        const catsContent = JSON.stringify(window._categories, null, 2);
        let catsMeta;
        try { catsMeta = await _ghGetFile(token, _ghCatCfgApi()); } catch(_) { catsMeta = { sha: undefined }; }
        await _ghPushFile(token, catsContent, catsMeta.sha, 'Update categories', _ghCatCfgApi());

        // Dual-write to Supabase (non-fatal)
        try { await sbSaveCategories(window._categories); } catch(sbErr) {
          console.warn('Supabase categories sync failed:', sbErr.message);
        }

        window._categoriesDirty = false;
        _ghToast('✓ categories.json published.');
      } catch(e) {
        _ghToast('Publish failed: ' + e.message);
      }
    });
    return;
  }

  const catLabel = window._activeCategory?.label || 'config';
  const pushCats = !!window._categoriesDirty;

  // Block publish when any rule has an unresolved token / non-numeric value.
  // The same garbage would otherwise go live for everyone, and the recurring
  // "three-digit formatting" bug is exactly this shape.
  if (typeof hasRuleErrors === 'function' && hasRuleErrors()) {
    if (!confirm(
      'Some rule templates contain unresolved tokens or non-numeric values.\n\n' +
      'Publishing now would push broken filenames / descriptions to everyone.\n\n' +
      'Open the Rules tab — entries with a red ⚠ badge are the problem.\n\n' +
      'Publish anyway?')) {
      return;
    }
  }

  _withAuth('🔒 Enter PIN to Publish', token => {
    const { dirty, ...saveState } = State;
    const content = JSON.stringify(saveState, null, 2);

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'z-index:2000';
    overlay.innerHTML = `
      <div class="confirm-box gh-modal" style="max-width:400px">
        <div class="confirm-title">☁ Publish to GitHub</div>
        <div class="gh-form">
          <label class="gh-label">Commit message</label>
          <input id="ghCommitMsg" class="combo gh-input"
            value="Update ${catLabel} config" autocomplete="off">
          ${pushCats ? '<div class="gh-status" style="color:var(--muted)">categories.json will also be updated</div>' : ''}
          <div id="ghPublishStatus" class="gh-status"></div>
        </div>
        <div class="confirm-buttons">
          <button class="btn btn-cancel" id="ghPubCancel">Cancel</button>
          <button class="btn btn-confirm" id="ghPubBtn">⬆ Publish</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ghCommitMsg').select();

    const status = overlay.querySelector('#ghPublishStatus');
    const pubBtn = overlay.querySelector('#ghPubBtn');

    overlay.querySelector('#ghPubCancel').onclick = () => overlay.remove();

    pubBtn.onclick = async () => {
      const msg = overlay.querySelector('#ghCommitMsg').value.trim() || `Update ${catLabel} config`;
      pubBtn.disabled = true;
      status.className = 'gh-status';
      status.textContent = 'Pushing category data…';

      try {
        // 1. Push current category data to GitHub
        let meta;
        try {
          meta = await _ghGetFile(token);
        } catch(e) {
          if (e.message === 'Not Found') {
            meta = { sha: undefined };
          } else {
            throw e;
          }
        }
        await _ghPushFile(token, content, meta.sha, msg);

        // 1b. Dual-write category data to Supabase + create version (non-fatal)
        status.textContent = 'Syncing to Supabase…';
        try {
          await sbSaveCategoryData(window._activeCategory.id, State, msg, getCurrentUser() || 'publish');
        } catch(sbErr) {
          console.warn('Supabase category sync failed:', sbErr.message);
        }

        // 2. Push categories.json to GitHub if the list has changed
        if (window._categoriesDirty) {
          status.textContent = 'Updating categories.json…';
          const catsContent = JSON.stringify(window._categories, null, 2);
          let catsMeta;
          try {
            catsMeta = await _ghGetFile(token, _ghCatCfgApi());
          } catch(_) {
            catsMeta = { sha: undefined };
          }
          await _ghPushFile(token, catsContent, catsMeta.sha, msg + ' [categories]', _ghCatCfgApi());

          // 2b. Dual-write categories to Supabase (non-fatal)
          try {
            await sbSaveCategories(window._categories);
          } catch(sbErr) {
            console.warn('Supabase categories sync failed:', sbErr.message);
          }

          window._categoriesDirty = false;
        }

        State.dirty = false;
        if (window._activeCategory) {
          window._categoryDirty[window._activeCategory.id] = false;
        }
        _updateDirtyIndicator();

        status.className = 'gh-status gh-status-ok';
        status.textContent = '✓ Published! Changes are now live for everyone.';
        pubBtn.textContent = 'Done';
        pubBtn.disabled = false;
        pubBtn.onclick = () => overlay.remove();
      } catch(e) {
        status.className = 'gh-status gh-status-err';
        status.textContent = 'Error: ' + e.message;
        pubBtn.disabled = false;
      }
    };
  });
}

/* ── History modal ────────────────────────────────────── */
function openHistoryModal() {
  if (!window._activeCategory) {
    alert('Open a workspace first to view its version history.');
    return;
  }
  const catId = window._activeCategory.id;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.style.cssText = 'z-index:2000';
  overlay.innerHTML = `
    <div class="confirm-box gh-modal gh-history-box">
      <div class="confirm-title">🕐 History</div>
      <div class="audit-tabs">
        <button class="audit-tab audit-tab-active" id="histTabVersions">Versions</button>
        <button class="audit-tab" id="histTabChanges">Changes</button>
      </div>
      <div id="ghHistVersionsPanel" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
        <div id="ghHistList" class="gh-hist-list">
          <div class="gh-hist-loading">Loading history…</div>
        </div>
      </div>
      <div id="ghHistChangesPanel" style="display:none;flex-direction:column;flex:1;overflow:hidden"></div>
      <div class="confirm-buttons" style="border-top:1px solid var(--stroke)">
        <button class="btn btn-cancel" id="ghHistClose">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#ghHistClose').onclick = () => overlay.remove();

  const versionsPanel = overlay.querySelector('#ghHistVersionsPanel');
  const changesPanel  = overlay.querySelector('#ghHistChangesPanel');
  let changesLoaded   = false;

  overlay.querySelector('#histTabVersions').onclick = () => {
    overlay.querySelector('#histTabVersions').classList.add('audit-tab-active');
    overlay.querySelector('#histTabChanges').classList.remove('audit-tab-active');
    versionsPanel.style.display = 'flex';
    changesPanel.style.display  = 'none';
  };
  overlay.querySelector('#histTabChanges').onclick = () => {
    overlay.querySelector('#histTabChanges').classList.add('audit-tab-active');
    overlay.querySelector('#histTabVersions').classList.remove('audit-tab-active');
    versionsPanel.style.display = 'none';
    changesPanel.style.display  = 'flex';
    if (!changesLoaded) {
      changesLoaded = true;
      renderChangeLogTab(changesPanel, catId);
    }
  };

  const listEl = overlay.querySelector('#ghHistList');

  sbListVersions(catId, 50).then(versions => {
    if (!versions || !versions.length) {
      listEl.innerHTML = '<div class="gh-hist-loading">No versions saved yet.</div>';
      return;
    }
    listEl.innerHTML = '';
    versions.forEach((v, i) => {
      const d       = new Date(v.created_at);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const msg     = v.message || '(no message)';
      const author  = v.committed_by || 'anonymous';
      const isLatest = i === 0;

      const row = document.createElement('div');
      row.className = 'gh-hist-row';

      const info = document.createElement('div');
      info.className = 'gh-hist-info';

      const msgSpan = document.createElement('span');
      msgSpan.className = 'gh-hist-msg';
      msgSpan.title = msg;
      if (isLatest) msgSpan.appendChild(document.createTextNode('⭐ '));
      msgSpan.appendChild(document.createTextNode(msg));

      const metaSpan = document.createElement('span');
      metaSpan.className = 'gh-hist-meta';
      metaSpan.innerHTML = escapeHtml(dateStr) + ' &nbsp;·&nbsp; ' + escapeHtml(author) + ' &nbsp;·&nbsp; <code>#' + escapeHtml(String(v.id)) + '</code>';

      info.appendChild(msgSpan);
      info.appendChild(metaSpan);
      row.appendChild(info);

      // Pin / unpin button (all rows except the live version)
      if (!isLatest) {
        const pinBtn = document.createElement('button');
        pinBtn.className   = 'btn gh-hist-pin-btn' + (v.pinned ? ' gh-hist-pin-active' : '');
        pinBtn.title       = v.pinned ? 'Unpin (will be pruned eventually)' : 'Pin (keep forever)';
        pinBtn.textContent = v.pinned ? '📌' : '📍';
        pinBtn.onclick = async () => {
          try {
            await sbPinVersion(v.id, !v.pinned);
            v.pinned           = !v.pinned;
            pinBtn.classList.toggle('gh-hist-pin-active', v.pinned);
            pinBtn.title       = v.pinned ? 'Unpin (will be pruned eventually)' : 'Pin (keep forever)';
            pinBtn.textContent = v.pinned ? '📌' : '📍';
          } catch(e) { _ghToast('Pin failed: ' + e.message, true); }
        };
        row.appendChild(pinBtn);
      }

      if (isLatest) {
        const badge = document.createElement('span');
        badge.className = 'gh-hist-current';
        badge.textContent = 'Live';
        row.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn gh-hist-load-btn';
        btn.textContent = '⏪ Restore';
        btn.onclick = () => {
          _openPinModal('🔒 Enter PIN to Restore', async () => {
            overlay.remove();

            const spinner = document.createElement('div');
            spinner.className = 'confirm-overlay';
            spinner.style.cssText = 'z-index:2100';
            const spinnerBox = document.createElement('div');
            spinnerBox.className = 'confirm-box gh-modal';
            spinnerBox.style.cssText = 'max-width:280px;text-align:center;padding:28px 20px';
            const spinnerMsg = document.createElement('div');
            spinnerMsg.style.cssText = 'font-size:15px;margin-bottom:8px';
            spinnerMsg.textContent = 'Restoring version…';
            const spinnerMeta = document.createElement('div');
            spinnerMeta.style.cssText = 'font-size:12px;color:var(--muted)';
            spinnerMeta.textContent = '#' + v.id + ' — ' + msg;
            spinnerBox.appendChild(spinnerMsg);
            spinnerBox.appendChild(spinnerMeta);
            spinner.appendChild(spinnerBox);
            document.body.appendChild(spinner);

            try {
              // Restore normalized tables in Supabase
              await sbRestoreVersion(v.id, 'restore');

              // Reload the restored state into memory
              const restoredState = await sbLoadCategoryData(catId);
              if (restoredState) {
                Object.keys(State).forEach(k => delete State[k]);
                Object.assign(State, restoredState);
                window._unlockedTabs     = new Set();
                window._unlockedSections = new Set();
                migrateState();
                State.dirty = false;
                renderAll();
                _updateDirtyIndicator();
              }

              spinner.remove();
              _ghToast('✓ Restored to version #' + v.id + ' successfully.');
            } catch(e) {
              spinner.remove();
              _ghToast('Restore failed: ' + e.message, true);
            }
          });
        };
        row.appendChild(btn);
      }

      listEl.appendChild(row);
    });
  }).catch(e => {
    const errEl = document.createElement('div');
    errEl.className = 'gh-hist-loading';
    errEl.style.color = '#e74c3c';
    errEl.textContent = 'Error loading history: ' + e.message;
    listEl.innerHTML = '';
    listEl.appendChild(errEl);
  });
}
