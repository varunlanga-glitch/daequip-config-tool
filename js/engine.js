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

function _safeMathEval(expr) {
  // Strip unit suffixes from numbers (e.g. "100MM" → "100", "5IN" → "5")
  // This allows (PIN_OD/25.4) to work even when PIN_OD = "100MM"
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*[a-zA-Z]+/g, '$1');
  // Only allow digits, operators, dots, spaces — no identifiers that could escape
  if (!/^[\d\s+\-*/.]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result === 'number' && isFinite(result)) {
      // Round to 3 decimal places, round-half-up (≥0.0005 rounds away from zero),
      // then strip trailing zeros via parseFloat
      const rounded = Math.round(result * 1000) / 1000;
      return parseFloat(rounded.toFixed(3)).toString();
    }
  } catch (e) { /* ignore */ }
  return null;
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

  // Evaluate conditionals BEFORE variable substitution so {VAR?output} is
  // processed while VAR is still a key name, not its substituted value.
  // {VAR=value:output} → shows output if VAR equals value, else blank
  // {VAR?output}       → shows output if VAR is set (non-blank, not "—select—"), else blank
  const BLANK_VALUES = ['', '—select—', '-- select --', '--select--'];
  s = s.replace(/\{([^{}=?:]+)=([^{}:]+):([^{}]*)\}/g, (match, varName, expected, output) => {
    const val = (ctx[varName.trim()] || '').trim();
    return val === expected.trim() ? output : '';
  });
  s = s.replace(/\{([^{}=?:]+)\?([^{}]*)\}/g, (match, varName, output) => {
    const val = (ctx[varName.trim()] || '').trim();
    return BLANK_VALUES.includes(val) ? '' : output;
  });

  // Sort longest-first so a shorter key (e.g. PIN_OD) doesn't match inside
  // a longer one (e.g. PIN_OD_MAX) before it gets its own chance to substitute.
  Object.keys(ctx)
    .sort((a, b) => b.length - a.length)
    .forEach(key => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Allow an optional alpha-only unit suffix immediately after the key
      // (e.g. PIN_ODmm → 45mm) but stop if the next char is _ which would
      // indicate a longer identifier (PIN_OD_MAX).
      // Negative lookbehind (?<![a-zA-Z_]) lets digits sit directly before a
      // variable (e.g. 0PIN_OD → 045) while still rejecting a leading letter
      // that would mean a longer name (MPIN_OD must not match PIN_OD).
      const regex = new RegExp(`(?<![a-zA-Z_])${escaped}([a-zA-Z]*)\\b`, 'g');
      s = s.replace(regex, (_, unit) => (ctx[key] || '') + unit);
    });

  // Evaluate math expressions wrapped in parentheses, e.g. (70/25.4) → "2.7559"
  s = s.replace(/\(([^()]*)\)/g, (match, inner) => {
    const val = _safeMathEval(inner.trim());
    return val !== null ? val : match;
  });

  return s;
}

/**
 * Resolves the file name rule template for a given part.
 * Returns the generated string, or '' if no template is set.
 */
function resolveFileNameRule(partId) {
  const fnRules = getActiveFileNameRules();
  const template = fnRules[partId] || '';
  return template ? resolveRule(template, partId) : '';
}
window.resolveFileNameRule = resolveFileNameRule;

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
