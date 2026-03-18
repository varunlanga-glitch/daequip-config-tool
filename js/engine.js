/* ============================================================
   ENGINE.JS — Core Business Logic
   ============================================================ */

'use strict';

/**
 * Calculates display indices for all parts (unlimited depth).
 * level 0 → "01", "02" …
 * level 1 → "01-01", "01-02" …
 * level 2 → "01-01-01", "01-01-02" …
 */
function calculateIndices() {
  const parts    = getActiveParts();
  const results  = [];
  const counters = [];   // counters[level] = running count at that depth
  const prefixes = [];   // prefixes[level] = full index string of the last part at that level

  parts.forEach(p => {
    // Disabled parts get no index and don't consume a counter slot
    if (p.enabled === false) { results.push(''); return; }

    const level = Math.max(0, p.level || 0);

    // Ensure arrays are long enough
    while (counters.length <= level) counters.push(0);
    while (prefixes.length <= level) prefixes.push('');

    // Reset all counters deeper than this level (new parent means fresh children)
    for (let l = level + 1; l < counters.length; l++) counters[l] = 0;

    // Manual midx override — only honoured for top-level parts
    if (level === 0 && p.midx) {
      const n = parseInt(p.midx, 10);
      if (!isNaN(n)) counters[0] = n;
      prefixes[0] = p.midx;
      results.push(p.midx);
      return;
    }

    counters[level]++;
    const num = String(counters[level]).padStart(2, '0');
    const idx = level === 0 ? num : (prefixes[level - 1] || '00') + '-' + num;
    prefixes[level] = idx;
    results.push(idx);
  });

  return results;
}

function resolveRule(template, partId) {
  if (!template) return '';
  const parts   = getActiveParts();
  const idxList = calculateIndices();
  const pIdx    = parts.findIndex(p => p.id === partId);
  const part    = parts[pIdx];
  if (!part) return '';

  const idx = idxList[pIdx];
  let s = template
    .replace(/\bIDX\b/g,  idx)
    .replace(/\bNAME\b/g, part.name);

  const ctx = getActiveContext();
  Object.keys(ctx).forEach(key => {
    const regex = new RegExp(`\\b${key}\\b`, 'g');
    s = s.replace(regex, ctx[key] || '');
  });

  return s;
}

function moveItem(arr, index, dir) {
  if (index + dir < 0 || index + dir >= arr.length) return;
  [arr[index], arr[index + dir]] = [arr[index + dir], arr[index]];
  renderAll();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
