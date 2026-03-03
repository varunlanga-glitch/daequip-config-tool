/* ============================================================
   STATE.JS - Application State & Active-Class Accessors
   ============================================================ */

'use strict';

let State = {
  productClasses: [{ id: "buckets", name: "Buckets" }],
  activeClassId:  "buckets",
  selectedPartId: null,
  activeRightTab: "parts",

  master:      { buckets: [] },
  context:     { buckets: {} },
  parts:       { buckets: [] },
  props:       { buckets: [] },
  rules:       { buckets: {} },
  hiddenProps: { buckets: [] }
};

const getActiveParts   = () => State.parts[State.activeClassId]   || [];
const getActiveProps   = () => State.props[State.activeClassId]   || [];
const getActiveContext = () => State.context[State.activeClassId] || {};
const getActiveMaster  = () => State.master[State.activeClassId]  || [];

const getActiveRules = () => {
  if (!State.rules[State.activeClassId]) State.rules[State.activeClassId] = {};
  return State.rules[State.activeClassId];
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
