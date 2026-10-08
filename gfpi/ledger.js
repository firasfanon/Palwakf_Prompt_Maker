'use strict';

const { sha256OfValue, GENESIS_HASH } = require('./canon');
const D = require('./decisions');

/**
 * Append-only, hash-chained decision ledger.
 * Entry: {seq, item_id, from, to, actor_type, actor_id, at, value, value_sha256, rationale, gate, evidence[],
 *         prev_entry_sha256, entry_sha256}
 * Rules enforced here (design sections 16/25):
 *  - only transitions in the table, only by the allowed actor type;
 *  - USER_CONFIRMED binds the EXACT displayed value (value_sha256 must equal the hash of the value shown);
 *  - an AI_PROVIDER actor can only propose (AI_RECOMMENDED_PENDING_APPROVAL), never confirm;
 *  - changing an upstream value, or reopening a resolved item, makes dependents STALE (SYSTEM_RULE entries).
 * `at` is always supplied by the caller (no hidden clock).
 */

function createLedger(projectId) { return { project_id: projectId, entries: [] }; }

function entryHash(e) {
  const c = {};
  Object.keys(e).forEach((k) => { if (k !== 'entry_sha256') c[k] = e[k]; });
  return sha256OfValue(c);
}

function headHash(ledger) {
  const n = ledger.entries.length;
  return n ? ledger.entries[n - 1].entry_sha256 : GENESIS_HASH;
}

function verifyEntries(entries) {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.seq !== i + 1) return { valid: false, broken_at: i + 1, reason: 'seq' };
    if (e.prev_entry_sha256 !== prev) return { valid: false, broken_at: i + 1, reason: 'prev_entry_sha256' };
    if (entryHash(e) !== e.entry_sha256) return { valid: false, broken_at: i + 1, reason: 'entry_sha256' };
    if (e.value !== null && e.value !== undefined && sha256OfValue(e.value) !== e.value_sha256) return { valid: false, broken_at: i + 1, reason: 'value_sha256' };
    if (!D.transitionAllowed(e.from, e.to, e.actor_type)) return { valid: false, broken_at: i + 1, reason: 'transition' };
    prev = e.entry_sha256;
  }
  return { valid: true, broken_at: null, reason: null };
}

function verifyLedger(ledger) { return verifyEntries(ledger.entries); }

/** Longest prefix that verifies (crash recovery / tamper containment). */
function recoverPrefix(entries) {
  let lo = 0;
  for (let n = 1; n <= entries.length; n++) {
    if (verifyEntries(entries.slice(0, n)).valid) lo = n; else break;
  }
  return entries.slice(0, lo);
}

function foldLedger(ledger) {
  const items = {};
  ledger.entries.forEach((e) => {
    const cur = items[e.item_id] || { state: 'UNASKED', value: null, value_sha256: null };
    const next = { state: e.to, value: cur.value, value_sha256: cur.value_sha256, last_seq: e.seq, last_actor_type: e.actor_type, rationale: cur.rationale || null, gate: cur.gate || null };
    if (e.value !== null && e.value !== undefined) { next.value = e.value; next.value_sha256 = e.value_sha256; }
    if (e.rationale) next.rationale = e.rationale;
    if (e.gate) next.gate = e.gate;
    if (e.to === 'ASKED') { next.gate = null; }
    items[e.item_id] = next;
  });
  return items;
}

function isValuedState(s) { return s === 'USER_CONFIRMED' || s === 'USER_EDITED' || s === 'NOT_APPLICABLE_WITH_RATIONALE' || s === 'ANSWERED' || s === 'AI_RECOMMENDED_PENDING_APPROVAL'; }

function pushEntry(entries, f) {
  const e = {
    seq: entries.length + 1, item_id: f.item_id, from: f.from, to: f.to, actor_type: f.actor_type, actor_id: f.actor_id, at: f.at,
    value: f.value === undefined ? null : f.value, value_sha256: f.value === undefined || f.value === null ? null : sha256OfValue(f.value),
    rationale: f.rationale || null, gate: f.gate || null, evidence: f.evidence || [],
    prev_entry_sha256: entries.length ? entries[entries.length - 1].entry_sha256 : GENESIS_HASH,
  };
  e.entry_sha256 = entryHash(e);
  entries.push(e);
}

/**
 * appendEvent(ledger, ev) -> {ok, ledger, added:[seq...]} | {ok:false, error}
 * ev: {item_id, to, actor_type, actor_id, at, value?, shown_value_sha256?, rationale?, gate?, evidence?}
 * `shown_value_sha256` (required for USER_CONFIRMED/USER_EDITED) is the hash of the value the UI actually displayed.
 */
function appendEvent(ledger, ev) {
  const item = D.CATALOG_BY_ID[ev.item_id];
  if (!item) return { ok: false, error: 'UNKNOWN_ITEM' };
  if (D.ACTOR_TYPES.indexOf(ev.actor_type) === -1) return { ok: false, error: 'BAD_ACTOR_TYPE' };
  if (!ev.at || typeof ev.at !== 'string') return { ok: false, error: 'MISSING_TIMESTAMP' };
  if (ev.actor_type === 'USER' && (!ev.actor_id || typeof ev.actor_id !== 'string')) return { ok: false, error: 'MISSING_ACTOR_ID' };
  const states = foldLedger(ledger);
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

  const entries = ledger.entries.slice();
  const added = [];
  pushEntry(entries, { item_id: ev.item_id, from, to: ev.to, actor_type: ev.actor_type, actor_id: ev.actor_id || 'system', at: ev.at, value, rationale: ev.rationale, gate: ev.gate, evidence: ev.evidence });
  added.push(entries.length);

  // Invalidation cascade.
  const newHash = value === undefined || value === null ? cur.value_sha256 : sha256OfValue(value);
  const reopened = ev.to === 'ASKED' && D.RESOLVED_STATES.indexOf(from) !== -1;
  const valueChanged = isValuedState(ev.to) && cur.value_sha256 && newHash !== cur.value_sha256 && ev.to !== 'USER_CONFIRMED';
  const confirmedDiffers = ev.to === 'USER_CONFIRMED' && cur.value_sha256 && newHash !== cur.value_sha256; // blocked above, defensive
  if (reopened || valueChanged || confirmedDiffers) {
    const folded = foldLedger({ entries });
    D.transitiveDependents(ev.item_id).forEach((dep) => {
      const st = folded[dep];
      if (!st) return;
      if (isValuedState(st.state)) {
        pushEntry(entries, { item_id: dep, from: st.state, to: 'STALE', actor_type: 'SYSTEM_RULE', actor_id: 'invalidation', at: ev.at, evidence: [{ kind: 'UPSTREAM_CHANGED', item_id: ev.item_id, seq: added[0] }] });
        added.push(entries.length);
      }
    });
  }
  return { ok: true, ledger: { project_id: ledger.project_id, entries }, added };
}

function toJsonl(ledger) { return ledger.entries.map((e) => JSON.stringify(e)).join('\n') + (ledger.entries.length ? '\n' : ''); }

/** Parse JSONL; tolerate (and report) a torn final line from a crash. Never trusts what fails verification. */
function fromJsonl(text, projectId) {
  const lines = String(text).split('\n');
  const entries = [];
  let tornTail = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    try { entries.push(JSON.parse(lines[i])); } catch (e) {
      if (i === lines.length - 1 || lines.slice(i + 1).every((l) => l === '')) { tornTail = true; break; }
      return { ok: false, error: 'CORRUPT_LINE', line: i + 1 };
    }
  }
  const v = verifyEntries(entries);
  if (!v.valid) return { ok: false, error: 'LEDGER_VERIFICATION_FAILED', broken_at: v.broken_at, reason: v.reason, recoverable_entries: recoverPrefix(entries).length };
  return { ok: true, ledger: { project_id: projectId, entries }, torn_tail_discarded: tornTail };
}

module.exports = { createLedger, appendEvent, verifyLedger, verifyEntries, recoverPrefix, foldLedger, headHash, entryHash, toJsonl, fromJsonl };
