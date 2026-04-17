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
    // Group separators reset all counters so each group starts fresh at 01
    if (p.type === 'group') { results.push(''); counters.length = 0; prefixes.length = 0; return; }

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

// Tiny recursive-descent parser for +,-,*,/,parentheses. No Function()/eval.
// Accepts numbers (including decimals), returns a finite number or null.
function _parseMathExpr(src) {
  let i = 0;
  const peek = () => src[i];
  const skip = () => { while (i < src.length && src[i] === ' ') i++; };

  function parseNumber() {
    skip();
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (i === start) return NaN;
    const n = parseFloat(src.slice(start, i));
    return isNaN(n) ? NaN : n;
  }
  function parseFactor() {
    skip();
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      skip();
      if (peek() !== ')') return NaN;
      i++;
      return v;
    }
    if (peek() === '-') { i++; return -parseFactor(); }
    if (peek() === '+') { i++; return  parseFactor(); }
    return parseNumber();
  }
  function parseTerm() {
    let v = parseFactor();
    while (true) {
      skip();
      const c = peek();
      if (c !== '*' && c !== '/') break;
      i++;
      const rhs = parseFactor();
      if (c === '*') v = v * rhs;
      else {
        if (rhs === 0) return NaN;
        v = v / rhs;
      }
    }
    return v;
  }
  function parseExpr() {
    let v = parseTerm();
    while (true) {
      skip();
      const c = peek();
      if (c !== '+' && c !== '-') break;
      i++;
      v = (c === '+') ? v + parseTerm() : v - parseTerm();
    }
    return v;
  }

  const v = parseExpr();
  skip();
  if (i !== src.length || !isFinite(v)) return null;
  return v;
}

function _safeMathEval(expr) {
  // Strip unit suffixes from numbers (e.g. "100MM" → "100", "5IN" → "5")
  // This allows (PIN_OD/25.4) to work even when PIN_OD = "100MM"
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*[a-zA-Z]+/g, '$1');
  // Allow-list: digits, basic operators, dots, spaces, parens. Exponents (1e10),
  // unicode, identifiers are all rejected.
  if (!/^[\d\s+\-*/.()]+$/.test(expr)) return null;
  const result = _parseMathExpr(expr);
  if (typeof result === 'number' && isFinite(result)) {
    // Round to 3 decimal places, round-half-up, strip trailing zeros
    const rounded = Math.round(result * 1000) / 1000;
    return parseFloat(rounded.toFixed(3)).toString();
  }
  return null;
}

function resolveRule(template, partId) {
  if (!template) return '';
  const parts   = getActiveParts();
  const idxList = calculateIndices();
  const pIdx    = parts.findIndex(p => p.id === partId);
  const part    = parts[pIdx];
  if (!part) return '';

  // EMPTY_MARK is emitted in place of any variable that resolved to no value.
  // Separators dropped iff the segment they border has no real content (only
  // whitespace + EMPTY_MARKs). Literal text is therefore always preserved.
  const EMPTY_MARK = '\uE010';
  const orEmpty = v => (v === '' || v == null) ? EMPTY_MARK : v;

  const idx = idxList[pIdx];
  let s = template
    .replace(/\bIDX\b/g,  () => orEmpty(String(idx)))
    .replace(/\bNAME\b/g, () => orEmpty(part.name || ''));

  // Replace conditional separator tokens with private-use placeholders so they
  // survive variable substitution intact and can be cleaned up at the end.
  // {[-]}   → conditional hyphen separator      → "-"
  // {[X]}   → conditional X separator           → "X"
  // {[ - ]} → conditional spaced hyphen         → " - "
  // {[ X ]} → conditional spaced X separator    → " X "
  const SEP_HYPHEN        = '\uE001';
  const SEP_X             = '\uE002';
  const SEP_HYPHEN_SPACED = '\uE003';
  const SEP_X_SPACED      = '\uE004';
  s = s.replace(/\{\[ - \]\}/g, SEP_HYPHEN_SPACED)
       .replace(/\{\[ X \]\}/g, SEP_X_SPACED)
       .replace(/\{\[-\]\}/g,   SEP_HYPHEN)
       .replace(/\{\[X\]\}/g,   SEP_X);

  const ctx = getActiveContext();

  // Evaluate conditionals BEFORE variable substitution so {VAR?output} is
  // processed while VAR is still a key name, not its substituted value.
  // {VAR=value:output}   → shows output if VAR equals value, else blank
  // {VAR?output}         → shows output if VAR is set (non-blank, not "—select—"), else blank
  // {VAR1,VAR2?output}   → shows output only if ALL listed vars are set (AND condition)
  // {VAR1|VAR2?output}   → shows output if ANY listed var is set (OR condition)
  const BLANK_VALUES = ['', '—select—', '-- select --', '--select--'];
  const isSet = key => !BLANK_VALUES.includes((ctx[key.trim()] || '').trim());
  s = s.replace(/\{([^{}=?:]+)=([^{}:]+):([^{}]*)\}/g, (match, varName, expected, output) => {
    const val = (ctx[varName.trim()] || '').trim();
    return val === expected.trim() ? orEmpty(output) : EMPTY_MARK;
  });
  s = s.replace(/\{([^{}=?:]+)\?([^{}]*)\}/g, (match, varNames, output) => {
    const ok = varNames.includes('|')
      ? varNames.split('|').some(isSet)
      : varNames.split(',').every(isSet);
    return ok ? orEmpty(output) : EMPTY_MARK;
  });

  // {VAR#N:suffix}     → zero-pad integer to N digits and append suffix
  // {VAR#N.D:suffix}   → zero-pad to N integer digits with D decimal places and suffix
  // {VAR#N}            → zero-pad integer to N digits, no suffix
  // {VAR#N.D}          → zero-pad to N integer digits with D decimal places, no suffix
  // Returns '' when VAR is unset. Returns a visible error sentinel when the
  // value is non-numeric so the user sees the problem instead of silently
  // getting mangled output (e.g. "3.75IN" used to become "375").
  const _formatNumeric = (varName, width, decimals, suffix) => {
    const raw = (ctx[varName.trim()] || '').trim();
    if (!raw) return EMPTY_MARK;
    // The whole value must be numeric — partial matches like "3.75IN" used
    // to silently mangle into "375" or "3"; now we surface them as errors.
    // Note: we deliberately do NOT include the var key in the sentinel
    // because the later variable-substitution pass would otherwise rewrite
    // it into the value and produce a confusing message.
    const m = raw.match(/^-?\d+(?:\.\d+)?$/);
    if (!m) return `‹non-numeric "${raw}"›`;
    const num = parseFloat(m[0]);
    const w   = parseInt(width, 10);
    let formatted;
    if (decimals != null) {
      const d = parseInt(decimals, 10);
      const fixed = num.toFixed(d);
      const [intPart, fracPart] = fixed.split('.');
      formatted = intPart.padStart(w, '0') + (d > 0 ? '.' + fracPart : '');
    } else {
      formatted = String(Math.trunc(num)).padStart(w, '0');
    }
    return formatted + (suffix || '');
  };
  // {VAR#N.D:suffix} (with optional decimals + suffix). Must run before the
  // shorter variants so it claims the more-specific syntax first.
  s = s.replace(/\{([^{}#?=:]+)#(\d+)(?:\.(\d+))?:([^{}]*)\}/g,
    (_match, varName, width, decimals, suffix) =>
      _formatNumeric(varName, width, decimals, suffix));
  // {VAR#N.D} or {VAR#N} (no suffix)
  s = s.replace(/\{([^{}#?=:]+)#(\d+)(?:\.(\d+))?\}/g,
    (_match, varName, width, decimals) =>
      _formatNumeric(varName, width, decimals, ''));

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
      // If the context value is empty, drop a marker so the conditional sep
      // pass knows the slot was a variable that resolved to nothing.
      s = s.replace(regex, (_, unit) => ctx[key] ? ctx[key] + unit : EMPTY_MARK);
    });

  // Evaluate math expressions wrapped in parentheses, e.g. (70/25.4) → "2.7559"
  s = s.replace(/\(([^()]*)\)/g, (match, inner) => {
    const val = _safeMathEval(inner.trim());
    return val !== null ? val : match;
  });

  // Resolve conditional separator placeholders.
  // Split the string into segments at every sep placeholder. A segment is
  // "empty" if it contains only whitespace and EMPTY_MARK chars (i.e. every
  // variable in it resolved to nothing). We then walk segments left-to-right
  // and emit each non-empty segment, joining consecutive non-empty segments
  // with the first sep that originally separated them. Empty segments are
  // skipped, and any sep adjacent only to empty segments disappears.
  const SEP_CHAR = { '\uE001': '-', '\uE002': 'X', '\uE003': ' - ', '\uE004': ' X ' };
  const SEP_GLOBAL = /[\uE001\uE002\uE003\uE004]/g;
  const segments = [];
  const sepBetween = [];
  let lastIdx = 0;
  let mSep;
  while ((mSep = SEP_GLOBAL.exec(s)) !== null) {
    segments.push(s.slice(lastIdx, mSep.index));
    sepBetween.push(mSep[0]);
    lastIdx = mSep.index + 1;
  }
  segments.push(s.slice(lastIdx));
  const isEmptySeg = seg => /^[\s\uE010]*$/.test(seg);
  const stripMarks = seg => seg.replace(/\uE010/g, '');
  let out = '';
  let lastKept = -1;
  for (let i = 0; i < segments.length; i++) {
    if (isEmptySeg(segments[i])) continue;
    if (lastKept >= 0) out += SEP_CHAR[sepBetween[lastKept]] || '';
    out += stripMarks(segments[i]);
    lastKept = i;
  }
  s = out;

  // Strip leading/trailing " - " separators that arise when the first or last
  // field in a prefix-separator chain is absent.
  s = s.replace(/^\s*-\s+/, '').replace(/\s+-\s*$/, '').trim();

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

/* ------------------------------------------------------------------
 * Rule lint / strict-resolve check
 *
 * After resolveRule() finishes, any leftover `{...}` brace token or
 * `‹non-numeric›` sentinel means the template did not parse cleanly.
 * lintResolved() returns the list of offending fragments so the UI
 * can show a red badge and block Save/Publish.
 *
 * suggestFix() does a tiny "did-you-mean" lookup: if the offending
 * token contains digits that match a known context value, propose
 * the corresponding {KEY#N:SUFFIX} rewrite.
 * ------------------------------------------------------------------ */
function lintResolved(resolvedValue) {
  if (!resolvedValue) return [];
  const errors = [];
  const braceTokens = resolvedValue.match(/\{[^{}]*\}/g);
  if (braceTokens) braceTokens.forEach(t => errors.push({ kind: 'unparsed', text: t }));
  const sentinels = resolvedValue.match(/‹[^›]*›/g);
  if (sentinels) sentinels.forEach(t => errors.push({ kind: 'value', text: t }));
  return errors;
}
window.lintResolved = lintResolved;

function suggestFix(brokenToken) {
  // brokenToken like "{75#3MM}" — try to map "75" back to a context key.
  const inner = brokenToken.replace(/^\{|\}$/g, '');
  const m = inner.match(/^(\d+(?:\.\d+)?)#(\d+)([A-Za-z]+)$/);
  if (!m) return null;
  const [, val, width, suffix] = m;
  const ctx = (typeof getActiveContext === 'function') ? getActiveContext() : {};
  const matchKey = Object.keys(ctx).find(k => (ctx[k] || '').toString().trim() === val);
  if (!matchKey) return null;
  return `{${matchKey}#${width}:${suffix}}`;
}
window.suggestFix = suggestFix;

/**
 * Walk every rule in the active class and return true if any resolved
 * value contains a lint error. Used by the Save/Publish gate.
 */
function hasRuleErrors() {
  try {
    const parts = (typeof getActiveParts === 'function') ? getActiveParts() : [];
    const props = (typeof getActiveProps === 'function') ? getActiveProps() : [];
    const rules = (typeof getActiveRules === 'function') ? getActiveRules() : {};
    const fn    = (typeof getActiveFileNameRules === 'function') ? getActiveFileNameRules() : {};
    for (const p of parts) {
      if (p.enabled === false) continue;
      const fnTpl = fn[p.id];
      if (fnTpl && lintResolved(resolveRule(fnTpl, p.id)).length) return true;
      const partRules = rules[p.id] || {};
      for (const pr of props) {
        const tpl = partRules[pr.id];
        if (tpl && lintResolved(resolveRule(tpl, p.id)).length) return true;
      }
    }
  } catch (e) { /* fail open — never block save on a lint crash */ }
  return false;
}
window.hasRuleErrors = hasRuleErrors;

/* ------------------------------------------------------------------
 * Template ⇄ token-array (chip-row editor support)
 *
 * The chip-row editor lets non-coders compose templates by dropping
 * typed bubbles instead of typing DSL by hand. Storage stays as the
 * canonical DSL string — these helpers just translate.
 * ------------------------------------------------------------------ */

// Token shapes:
//   {type:'literal', text}
//   {type:'var',  key, pad?:int, decimals?:int, suffix?:string}
//   {type:'sep',  char:'-'|'X'|' - '|' X '}
//   {type:'cond', vars:[keys], op:'and'|'or', show:string}
//   {type:'eq',   key, value, show}
//   {type:'idx'} | {type:'name'} | {type:'math', expr}

function _tryMatchToken(s, i, knownKeys) {
  // Returns { token, length } or null
  const rest = s.slice(i);
  const prevCh = i > 0 ? s[i - 1] : '';

  // Conditional separator chips
  const sepMap = {
    '{[ - ]}': ' - ',
    '{[ X ]}': ' X ',
    '{[-]}'  : '-',
    '{[X]}'  : 'X',
  };
  for (const [pat, ch] of Object.entries(sepMap)) {
    if (rest.startsWith(pat)) return { token: { type: 'sep', char: ch }, length: pat.length };
  }

  // {VAR#N(.D)?(:suffix)?}
  let m = rest.match(/^\{([A-Z0-9_]+)#(\d+)(?:\.(\d+))?(?::([^{}]*))?\}/);
  if (m) {
    return {
      token: {
        type: 'var',
        key: m[1],
        pad: parseInt(m[2], 10),
        decimals: m[3] != null ? parseInt(m[3], 10) : null,
        suffix: m[4] || '',
      },
      length: m[0].length,
    };
  }

  // {VAR=value:show}
  m = rest.match(/^\{([A-Z0-9_]+)=([^{}:]+):([^{}]*)\}/);
  if (m) return { token: { type: 'eq', key: m[1], value: m[2], show: m[3] }, length: m[0].length };

  // {VAR(,VAR|...|VAR)?show}
  m = rest.match(/^\{([A-Z0-9_,|]+)\?([^{}]*)\}/);
  if (m) {
    const op = m[1].includes('|') ? 'or' : 'and';
    const vars = m[1].split(/[,|]/);
    return { token: { type: 'cond', vars, op, show: m[2] }, length: m[0].length };
  }

  // {VAR}
  m = rest.match(/^\{([A-Z0-9_]+)\}/);
  if (m) return { token: { type: 'var', key: m[1], pad: null, decimals: null, suffix: '' }, length: m[0].length };

  // (math expr)
  m = rest.match(/^\(([^()]+)\)/);
  if (m && /^[A-Z0-9_+\-*/.\s]+$/.test(m[1])) {
    return { token: { type: 'math', expr: m[1] }, length: m[0].length };
  }

  // Bare IDX / NAME identifiers (not inside braces). Require a left word
  // boundary so we don't mis-match the middle of a longer identifier.
  if (!/[A-Za-z0-9_]/.test(prevCh)) {
    m = rest.match(/^IDX\b/);
    if (m) return { token: { type: 'idx' }, length: 3 };
    m = rest.match(/^NAME\b/);
    if (m) return { token: { type: 'name' }, length: 4 };
  }

  // Bare VAR identifiers (unbraced keys). This is how the existing data
  // actually stores templates — the engine's variable-substitution pass
  // rewrites them at resolve time. The parser must recognise them too,
  // otherwise they appear as giant unclickable literal chips in the
  // chip row. We only match against the caller's knownKeys set so we
  // don't accidentally classify random uppercase words as variables.
  // A left word boundary (prev char not in [A-Za-z0-9_]) mirrors the
  // engine's own negative lookbehind at runtime.
  if (knownKeys && knownKeys.size && !/[A-Za-z0-9_]/.test(prevCh)) {
    const idMatch = rest.match(/^([A-Z][A-Z0-9_]*)\b/);
    if (idMatch && knownKeys.has(idMatch[1])) {
      return {
        token: { type: 'var', key: idMatch[1], pad: null, decimals: null, suffix: '', _bare: true },
        length: idMatch[1].length,
      };
    }
  }

  return null;
}

function parseTemplate(str, knownKeys) {
  if (!str) return [];
  // Accept an Array or a Set; coerce to Set for fast lookups.
  const keys = knownKeys
    ? (knownKeys instanceof Set ? knownKeys : new Set(knownKeys))
    : null;
  const tokens = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { tokens.push({ type: 'literal', text: buf }); buf = ''; } };
  while (i < str.length) {
    const hit = _tryMatchToken(str, i, keys);
    if (hit) { flush(); tokens.push(hit.token); i += hit.length; }
    else { buf += str[i]; i++; }
  }
  flush();
  return tokens;
}
window.parseTemplate = parseTemplate;

function serialiseTokens(tokens) {
  if (!Array.isArray(tokens)) return '';
  return tokens.map(t => {
    switch (t.type) {
      case 'literal': return t.text || '';
      case 'idx':     return 'IDX';
      case 'name':    return 'NAME';
      case 'math':    return '(' + t.expr + ')';
      case 'sep': {
        const map = { '-': '{[-]}', 'X': '{[X]}', ' - ': '{[ - ]}', ' X ': '{[ X ]}' };
        return map[t.char] || '{[-]}';
      }
      case 'var': {
        // Bare-key variables (from existing unbraced templates) round-trip
        // as the plain key name so loading+saving is a no-op. As soon as
        // the user adds padding, decimals, suffix, or converts to
        // conditional, the token loses _bare and gets proper braces.
        const isBare = t._bare && t.pad == null && !t.suffix && t.decimals == null;
        if (isBare) return t.key;
        if (t.pad == null && !t.suffix && t.decimals == null) return '{' + t.key + '}';
        let inner = t.key + '#' + (t.pad || 0);
        if (t.decimals != null) inner += '.' + t.decimals;
        if (t.suffix) inner += ':' + t.suffix;
        return '{' + inner + '}';
      }
      case 'eq':   return '{' + t.key + '=' + t.value + ':' + (t.show || '') + '}';
      case 'cond': {
        const sep = t.op === 'or' ? '|' : ',';
        return '{' + (t.vars || []).join(sep) + '?' + (t.show || '') + '}';
      }
      default: return '';
    }
  }).join('');
}
window.serialiseTokens = serialiseTokens;

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
