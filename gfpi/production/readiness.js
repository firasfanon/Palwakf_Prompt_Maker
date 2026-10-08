'use strict';

/**
 * ProductionReadinessModelV1 + the Full-Production readiness state machine (additive).
 * - Dimension states are DERIVED from decision states; the global state is DERIVED from dimension states + external facts.
 * - PRODUCTION_READY cannot be produced from specification alone: it requires an intact approval, an implementation
 *   attestation and EVIDENCED status for EVERY applicable claim. Prompt Maker never creates those facts.
 * - These states are DISTINCT from (and never rewrite) the frozen package lifecycle (DRAFT / REVIEWABLE_WITH_DEFERRED_ITEMS /
 *   BLOCKED_FOR_EXECUTION / READY_FOR_REVIEW).
 */

const C = require('./catalog');
const RESOLVED = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];
const BAD = ['USER_REJECTED', 'CONTRADICTED', 'STALE'];
const DIM_STATES = ['UNASSESSED', 'REQUIRED', 'NOT_APPLICABLE_WITH_RATIONALE', 'UNRESOLVED', 'SPECIFIED', 'BLOCKED', 'IMPLEMENTATION_REQUIRED', 'EVIDENCE_REQUIRED', 'EVIDENCED'];
const READINESS_STATES = ['DISCOVERY_INCOMPLETE', 'SPECIFICATION_INCOMPLETE', 'SPECIFICATION_COMPLETE', 'EXECUTION_BLOCKED', 'READY_FOR_ENGINEERING_REVIEW', 'APPROVED_FOR_EXECUTION', 'IMPLEMENTATION_IN_PROGRESS',
  'IMPLEMENTED_NOT_VALIDATED', 'OPERATIONALLY_VALIDATED', 'PRODUCTION_EVIDENCE_INCOMPLETE', 'PRODUCTION_READY', 'RELEASED', 'SUPERSEDED'];

const stateOf = (states, id) => (states[id] && states[id].state) || 'UNASKED';

/** ctx: {profile, states, approvedForExecution:boolean, implementation:{[dimension]:true}|null, evidencedClaims:{[claimId]:true}, claims:[{claim_id, dimensions[]}]} */
function buildReadinessModel(ctx) {
  const P = ctx.profile; const states = ctx.states;
  if (!P.activation.FULL_PRODUCTION_PROFILE) return { artifact_type: 'ProductionReadinessModelV1', activated: false, dimensions: [], global: { state: 'NOT_ACTIVATED', claim: 'NOT_CLAIMED' } };
  const dims = C.DIMENSIONS.map((dim) => {
    const items = C.ITEMS.filter((it) => it.dims.indexOf(dim) !== -1).map((it) => ({ item_id: it.id, state: stateOf(states, it.id), applicability: C.applicability(it, P, states) }));
    const live = items.filter((i) => i.applicability.applicable !== 'NO');
    if (!live.length) return { dimension: dim, state: 'NOT_APPLICABLE_WITH_RATIONALE', rationale: items.map((i) => i.item_id + ': ' + i.applicability.basis).join('; '), items, missing: [] };
    const sts = live.map((i) => i.state);
    const missing = live.filter((i) => RESOLVED.indexOf(i.state) === -1).map((i) => i.item_id);
    let state;
    if (sts.some((s) => BAD.indexOf(s) !== -1)) state = 'BLOCKED';
    else if (live.every((i) => i.state === 'UNASKED')) state = 'UNASSESSED';
    else if (missing.length === 0 && live.every((i) => i.applicability.applicable === 'YES')) state = 'SPECIFIED';
    else if (missing.length === 0) state = 'UNRESOLVED';
    else if (live.every((i) => ['UNASKED', 'ASKED'].indexOf(i.state) !== -1)) state = 'REQUIRED';
    else state = 'UNRESOLVED';
    if (state === 'SPECIFIED') {
      const claimIds = (ctx.claims || []).filter((c) => c.dimensions.indexOf(dim) !== -1).map((c) => c.claim_id);
      const allEvidenced = claimIds.length > 0 && claimIds.every((id) => ctx.evidencedClaims && ctx.evidencedClaims[id]);
      if (allEvidenced && ctx.implementation && ctx.implementation[dim]) state = 'EVIDENCED';
      else if (ctx.implementation && ctx.implementation[dim]) state = 'EVIDENCE_REQUIRED';
      else if (ctx.approvedForExecution) state = 'IMPLEMENTATION_REQUIRED';
    }
    return { dimension: dim, state, items, missing };
  });
  const count = {}; DIM_STATES.forEach((s) => { count[s] = 0; }); dims.forEach((d) => { count[d.state]++; });
  return { artifact_type: 'ProductionReadinessModelV1', activated: true, dimensions: dims, counts: count,
    global: { derived_from: 'dimension states only', all_dimensions_evidenced: dims.every((d) => d.state === 'EVIDENCED' || d.state === 'NOT_APPLICABLE_WITH_RATIONALE'), claim: 'NOT_CLAIMED' } };
}

/**
 * ctx: {profile, model, guardian:{blocking:boolean}|null, approval:{intact:boolean, superseded:boolean}|null,
 *       implementation:{status:'NONE'|'IN_PROGRESS'|'IMPLEMENTED'}, claims:[{claim_id, group:'OPERATIONS'|'PRODUCT'}], evidencedClaims:{}, release:{actor_type, actor_id}|null}
 */
function deriveReadinessState(ctx) {
  const P = ctx.profile; const m = ctx.model;
  if (!P.activation.FULL_PRODUCTION_PROFILE) return { state: 'NOT_ACTIVATED', reasons: ['FULL_PRODUCTION_PROFILE not active'], production_ready_claim_allowed: false };
  const reasons = [];
  if (ctx.approval && ctx.approval.superseded) return { state: 'SUPERSEDED', reasons: ['approval is bound to an older production decision set'], production_ready_claim_allowed: false };
  const d = m.dimensions.filter((x) => x.state !== 'NOT_APPLICABLE_WITH_RATIONALE');
  const specStates = ['SPECIFIED', 'IMPLEMENTATION_REQUIRED', 'EVIDENCE_REQUIRED', 'EVIDENCED'];
  if (d.some((x) => x.state === 'UNASSESSED') || d.some((x) => x.items.some((i) => i.applicability.applicable === 'YES' && i.state === 'UNASKED'))) return { state: 'DISCOVERY_INCOMPLETE', reasons: ['some applicable decisions have not even been asked'], production_ready_claim_allowed: false };
  if (!d.every((x) => specStates.indexOf(x.state) !== -1)) return { state: 'SPECIFICATION_INCOMPLETE', reasons: d.filter((x) => specStates.indexOf(x.state) === -1).map((x) => x.dimension + ':' + x.state), production_ready_claim_allowed: false };
  if (!ctx.guardian) return { state: 'SPECIFICATION_COMPLETE', reasons: ['completeness guardian not yet evaluated'], production_ready_claim_allowed: false };
  if (ctx.guardian.blocking) return { state: 'EXECUTION_BLOCKED', reasons: ['completeness guardian has execution-blocking findings'], production_ready_claim_allowed: false };
  if (!ctx.approval || !ctx.approval.intact) return { state: 'READY_FOR_ENGINEERING_REVIEW', reasons: ['specification complete, guardian clear, no intact approval'], production_ready_claim_allowed: false };
  const impl = (ctx.implementation && ctx.implementation.status) || 'NONE';
  if (impl === 'NONE') return { state: 'APPROVED_FOR_EXECUTION', reasons: ['approved; no implementation attested'], production_ready_claim_allowed: false };
  if (impl === 'IN_PROGRESS') return { state: 'IMPLEMENTATION_IN_PROGRESS', reasons: [], production_ready_claim_allowed: false };
  const claims = ctx.claims || []; const ev = ctx.evidencedClaims || {};
  const done = claims.filter((c) => ev[c.claim_id]);
  if (!done.length) return { state: 'IMPLEMENTED_NOT_VALIDATED', reasons: ['implementation attested but no claim has evidence'], production_ready_claim_allowed: false };
  const missing = claims.filter((c) => !ev[c.claim_id]);
  if (!missing.length) {
    if (ctx.release && ctx.release.actor_type === 'USER' && ctx.release.actor_id) return { state: 'RELEASED', reasons: ['human release decision recorded'], production_ready_claim_allowed: true };
    return { state: 'PRODUCTION_READY', reasons: ['every applicable claim is EVIDENCED'], production_ready_claim_allowed: true };
  }
  const ops = claims.filter((c) => c.group === 'OPERATIONS');
  if (ops.length && ops.every((c) => ev[c.claim_id])) return { state: 'OPERATIONALLY_VALIDATED', reasons: ['operational claims evidenced; ' + missing.length + ' claim(s) still lack evidence'], production_ready_claim_allowed: false };
  void reasons;
  return { state: 'PRODUCTION_EVIDENCE_INCOMPLETE', reasons: missing.map((c) => c.claim_id + ' lacks evidence'), production_ready_claim_allowed: false };
}

module.exports = { DIM_STATES, READINESS_STATES, buildReadinessModel, deriveReadinessState };
