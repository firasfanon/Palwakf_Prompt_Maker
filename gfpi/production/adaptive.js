'use strict';

/**
 * Adaptive discovery (additive, deterministic, NO_PROVIDER-safe). The next question is chosen from the CURRENT decision
 * state and the active profile — not from a fixed list — using six explicit, inspectable factors:
 *   INFORMATION_GAIN   how many still-open downstream decisions / uncovered readiness dimensions this answer unlocks
 *   RISK               criticality of the item, boosted for sensitive/regulated/payment/multi-tenant profiles
 *   DEPENDENCY         whether upstream decisions are ready (an item with unresolved upstream is deferred, not dropped)
 *   UNCERTAINTY        nothing known (1.0) > stale/contradicted (1.0) > only a pending recommendation (0.5) > resolved (0)
 *   PRODUCTION_CRITICALITY  execution-blocking weight
 *   USER_BURDEN        subtracted (cheap questions first when scores tie)
 * The score is a ranking aid only; it never confirms, skips or auto-answers anything.
 */

const C = require('./catalog');
const RESOLVED = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];
const W = { info: 0.30, risk: 0.25, dep: 0.15, unc: 0.15, crit: 0.15, burden: 0.10 };
const r4 = (x) => Math.round(x * 10000) / 10000;

function stateOf(states, id) { return (states[id] && states[id].state) || 'UNASKED'; }

function uncertainty(st) {
  if (RESOLVED.indexOf(st) !== -1) return 0;
  if (st === 'AI_RECOMMENDED_PENDING_APPROVAL') return 0.5;
  return 1;
}

function riskBoost(item, P) {
  let b = 1;
  const d = item.dims;
  if (P.sensitive && (d.indexOf('SECURITY') !== -1 || d.indexOf('PRIVACY') !== -1 || d.indexOf('DATA') !== -1 || d.indexOf('COMPLIANCE') !== -1)) b += 0.25;
  if (P.regulated && (d.indexOf('COMPLIANCE') !== -1 || d.indexOf('PRIVACY') !== -1 || item.id === 'audit_trail' || item.id === 'retention_deletion')) b += 0.2;
  if (P.payments && (d.indexOf('BILLING') !== -1 || d.indexOf('RELIABILITY') !== -1)) b += 0.15;
  if (P.tenancy !== 'SINGLE_TENANT' && (d.indexOf('TENANCY') !== -1 || item.id === 'tenant_isolation')) b += 0.2;
  return b;
}

/** Returns {ranked:[{item_id, score, factors, question, expert_term, applicability}], deferred:[...], conditional:[...]} */
function nextQuestions(P, states, opts) {
  const o = opts || {}; const lang = o.lang === 'en' ? 'en' : 'ar'; const limit = o.limit || 5;
  const covered = {};
  C.ITEMS.forEach((it) => { if (RESOLVED.indexOf(stateOf(states, it.id)) !== -1) it.dims.forEach((d) => { covered[d] = true; }); });
  const ranked = []; const deferred = []; const conditional = [];
  C.ITEMS.forEach((it) => {
    const app = C.applicability(it, P, states);
    if (app.applicable === 'NO') return;
    const st = stateOf(states, it.id);
    if (RESOLVED.indexOf(st) !== -1) return;
    const unresolvedUp = it.deps.filter((d) => {
      const a = C.applicability(C.byId[d], P, states);
      return a.applicable !== 'NO' && RESOLVED.indexOf(stateOf(states, d)) === -1 && stateOf(states, d) !== 'AI_RECOMMENDED_PENDING_APPROVAL';
    });
    if (app.applicable === 'CONDITIONAL') { conditional.push({ item_id: it.id, basis: app.basis }); return; }
    if (unresolvedUp.length && !o.ignoreDependencies) { deferred.push({ item_id: it.id, waiting_for: unresolvedUp }); return; }
    const open = C.dependentsOf(it.id).filter((d) => RESOLVED.indexOf(stateOf(states, d)) === -1 && C.applicability(C.byId[d], P, states).applicable !== 'NO');
    const newDims = it.dims.filter((d) => !covered[d]).length / Math.max(1, it.dims.length);
    const info = Math.min(1, open.length / 8) * 0.7 + newDims * 0.3;
    const risk = Math.min(1.5, (it.crit / 5) * riskBoost(it, P)) / 1.5;
    const dep = Math.min(1, open.length / 6);
    const unc = uncertainty(st);
    const crit = it.crit / 5;
    const burden = it.burden / 3;
    const score = W.info * info + W.risk * risk + W.dep * dep + W.unc * unc + W.crit * crit - W.burden * burden;
    ranked.push({ item_id: it.id, score: r4(score), factors: { information_gain: r4(info), risk: r4(risk), dependency_unlock: r4(dep), uncertainty: r4(unc), production_criticality: r4(crit), user_burden: r4(burden) },
      question: it.q[lang], expert_term: it.expert[lang], applicability: app.applicable, state: st });
  });
  ranked.sort((a, b) => b.score - a.score || (a.item_id < b.item_id ? -1 : 1));
  return { weights: W, ranked: ranked.slice(0, limit), all_ranked_count: ranked.length, deferred, conditional };
}

module.exports = { nextQuestions, WEIGHTS: W };
