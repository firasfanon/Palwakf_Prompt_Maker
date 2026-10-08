'use strict';

/**
 * Production decision ledger (additive; GFPI-V1 post-baseline amendment).
 *
 * Same hash-chain entry format, same state machine (gfpi/decisions TRANSITIONS) and same verification as the frozen
 * decision ledger (gfpi/ledger.js), but bound to the PRODUCTION item catalog instead of the 21 frozen ITEM_CATALOG
 * items. The frozen ledger and its catalog are not modified: package-state semantics of the frozen package are unchanged.
 *
 * Invariants preserved:
 *  - AI_RECOMMENDED_PENDING_APPROVAL != USER_CONFIRMED (only a USER actor can confirm; confirmation binds the shown value hash);
 *  - an AI_PROVIDER actor can only propose, and must cite evidence;
 *  - changing/reopening an upstream decision makes resolved dependents STALE (SYSTEM_RULE entries);
 *  - `at` is always supplied by the caller (no hidden clock).
 */

const { sha256OfValue, GENESIS_HASH } = require('../canon');
const D = require('../decisions');
const L = require('../ledger');

function createProdLedger(projectId) { return { project_id: projectId, entries: [], kind: 'PRODUCTION_DECISION_LEDGER' }; }

const isValued = (s) => ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE', 'ANSWERED', 'AI_RECOMMENDED_PENDING_APPROVAL'].indexOf(s) !== -1;

function push(entries, f) {
  const e = {
    seq: entries.length + 1, item_id: f.item_id, from: f.from, to: f.to, actor_type: f.actor_type, actor_id: f.actor_id, at: f.at,
    value: f.value === undefined ? null : f.value, value_sha256: f.value === undefined || f.value === null ? null : sha256OfValue(f.value),
    rationale: f.rationale || null, gate: f.gate || null, evidence: f.evidence || [],
    prev_entry_sha256: entries.length ? entries[entries.length - 1].entry_sha256 : GENESIS_HASH,
  };
  e.entry_sha256 = L.entryHash(e);
  entries.push(e);
}

/** catalog: {byId:{id:{na_allowed, depends_on[]}}} from production/catalog. */
function appendProdEvent(ledger, ev, catalog) {
  const item = catalog.byId[ev.item_id];
  if (!item) return { ok: false, error: 'UNKNOWN_ITEM' };
  if (D.ACTOR_TYPES.indexOf(ev.actor_type) === -1) return { ok: false, error: 'BAD_ACTOR_TYPE' };
  if (!ev.at || typeof ev.at !== 'string') return { ok: false, error: 'MISSING_TIMESTAMP' };
  if (ev.actor_type === 'USER' && (!ev.actor_id || typeof ev.actor_id !== 'string')) return { ok: false, error: 'MISSING_ACTOR_ID' };
  const states = L.foldLedger(ledger);
  const cur = states[ev.item_id] || { state: 'UNASKED', value: null, value_sha256: null };
  const from = cur.state;
  if (!D.transitionAllowed(from, ev.to, ev.actor_type)) return { ok: false, error: 'TRANSITION_NOT_ALLOWED', detail: from + ' -> ' + ev.to + ' by ' + ev.actor_type };
  let value = ev.value;
  if (ev.to === 'USER_CONFIRMED') {
    if (value === undefined || value === null) value = cur.value;
    if (value === null || value === undefined) return { ok: false, error: 'NOTHING_TO_CONFIRM' };
    const h = sha256OfValue(value);
    if (ev.shown_value_sha256 !== h) return { ok: false, error: 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE' };
    if (cur.value_sha256 && cur.value_sha256 !== h) return { ok: false, error: 'CONFIRMED_VALUE_DIFFERS_FROM_PROPOSED' };
  }
  if (ev.to === 'USER_EDITED') {
    if (value === undefined || value === null) return { ok: false, error: 'EDIT_REQUIRES_VALUE' };
    if (ev.shown_value_sha256 !== sha256OfValue(value)) return { ok: false, error: 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE' };
  }
  if ((ev.to === 'ANSWERED' || ev.to === 'AI_RECOMMENDED_PENDING_APPROVAL') && (value === undefined || value === null)) return { ok: false, error: 'VALUE_REQUIRED' };
  if (ev.to === 'NOT_APPLICABLE_WITH_RATIONALE') {
    if (!item.na_allowed) return { ok: false, error: 'NA_NOT_ALLOWED_FOR_ITEM' };
    if (!ev.rationale || !String(ev.rationale).trim()) return { ok: false, error: 'RATIONALE_REQUIRED' };
  }
  if (ev.to === 'DEFERRED_WITH_GATE' && (!ev.gate || !String(ev.gate).trim())) return { ok: false, error: 'GATE_REQUIRED' };
  if (ev.actor_type === 'AI_PROVIDER' && !(ev.evidence && ev.evidence.length)) return { ok: false, error: 'AI_PROPOSAL_REQUIRES_EVIDENCE' };
  if (ev.to === 'AI_RECOMMENDED_PENDING_APPROVAL' && catalog.validValue && !catalog.validValue(ev.item_id, value)) return { ok: false, error: 'VALUE_NOT_ALLOWED_FOR_ITEM' };
  if ((ev.to === 'ANSWERED' || ev.to === 'USER_EDITED') && catalog.validValue && !catalog.validValue(ev.item_id, value)) return { ok: false, error: 'VALUE_NOT_ALLOWED_FOR_ITEM' };

  const entries = ledger.entries.slice(); const added = [];
  push(entries, { item_id: ev.item_id, from, to: ev.to, actor_type: ev.actor_type, actor_id: ev.actor_id || 'system', at: ev.at, value, rationale: ev.rationale, gate: ev.gate, evidence: ev.evidence });
  added.push(entries.length);
  const newHash = value === undefined || value === null ? cur.value_sha256 : sha256OfValue(value);
  const reopened = ev.to === 'ASKED' && D.RESOLVED_STATES.indexOf(from) !== -1;
  const valueChanged = isValued(ev.to) && cur.value_sha256 && newHash !== cur.value_sha256 && ev.to !== 'USER_CONFIRMED';
  if (reopened || valueChanged) {
    const folded = L.foldLedger({ entries });
    (catalog.dependentsOf(ev.item_id)).forEach((dep) => {
      const st = folded[dep];
      if (st && isValued(st.state)) {
        push(entries, { item_id: dep, from: st.state, to: 'STALE', actor_type: 'SYSTEM_RULE', actor_id: 'invalidation', at: ev.at, evidence: [{ kind: 'UPSTREAM_CHANGED', item_id: ev.item_id, seq: added[0] }] });
        added.push(entries.length);
      }
    });
  }
  return { ok: true, ledger: { project_id: ledger.project_id, entries, kind: ledger.kind }, added };
}

module.exports = { createProdLedger, appendProdEvent, foldLedger: L.foldLedger, verifyLedger: L.verifyLedger, headHash: L.headHash };
