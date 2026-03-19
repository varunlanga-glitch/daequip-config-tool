/* ============================================================
   STATE.JS - Application State & Active-Class Accessors
   ============================================================ */

'use strict';

let State = {
  productClasses: [{ id: "buckets", name: "Buckets" }],
  activeClassId:  "buckets",
  selectedPartId: null,
  activeRightTab: "parts",
  dirty:          false,   // true when in-memory state differs from last save/load

  master:      { buckets: [] },
  context:     { buckets: {} },
  parts:       { buckets: [] },
  props:       { buckets: [] },
  rules:       { buckets: {} },
  hiddenProps: { buckets: [] },
  lockedTabs:       {},   // tabId → SHA-256 hash of PIN (hex string)
  lockedSections:   {},   // "tabId:rules" or "tabId:config" → SHA-256 hash
  fileNameRules:     {},  // tabId → { partId: templateString } — dedicated file name rule
  inventorMaps:     {},   // tabId → { propId: iPropertyName, fileNamePropId: 'id' }
  fileNameOverrides: {},  // tabId → { partId: actualFilename (no ext) }
  exportSelections:  {}   // tabId → { partId: { rename: bool, props: { propId: bool } } }
};

const getActiveParts   = () => State.parts[State.activeClassId]   || [];
const getActiveProps   = () => State.props[State.activeClassId]   || [];
const getActiveContext = () => State.context[State.activeClassId] || {};
const getActiveMaster  = () => State.master[State.activeClassId]  || [];

const getActiveRules = () => {
  if (!State.rules[State.activeClassId]) State.rules[State.activeClassId] = {};
  return State.rules[State.activeClassId];
};

const getActiveFileNameRules = () => {
  if (!State.fileNameRules) State.fileNameRules = {};
  if (!State.fileNameRules[State.activeClassId]) State.fileNameRules[State.activeClassId] = {};
  return State.fileNameRules[State.activeClassId];
};

const getHiddenProps = () => {
  if (!State.hiddenProps) State.hiddenProps = {};
  if (!State.hiddenProps[State.activeClassId]) State.hiddenProps[State.activeClassId] = [];
  return State.hiddenProps[State.activeClassId];
};

const getVisibleProps = () => {
  const hidden = getHiddenProps();
  return getActiveProps().filter(p => !hidden.includes(p.id));
};
