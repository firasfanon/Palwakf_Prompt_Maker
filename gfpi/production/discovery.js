'use strict';

/**
 * Discovery orchestration (additive): activation, asking, deterministic recommendations, explainability and plain-language rendering.
 * Everything here is deterministic and works with NO provider. Recommendations are written as AI_RECOMMENDED_PENDING_APPROVAL
 * by actor SYSTEM_RULE with an explanation record as evidence; only a USER actor can ever confirm them.
 */

const C = require('./catalog');
const PL = require('./prodLedger');
const { detectProfile } = require('./profile');
const F = require('./factory');
const { sha256OfValue } = require('../canon');

const RESOLVED = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];

/** Seven-question explanation for one recommendation (spec section 25). */
function explain(item, P, states, extra) {
  const rec = item.rec(P, states);
  const factory = extra && extra.factoryStatus ? extra.factoryStatus : 'SEE_FactorySupportReportV1';
  return {
    what: rec.value, why: rec.why, caused_by_requirements: rec.caused, alternatives: item.choices.filter((c) => c.value !== rec.value).map((c) => ({ value: c.value, label: c, tradeoff: c.tradeoff })),
    tradeoffs: (item.choices.find((c) => c.value === rec.value) || {}).tradeoff || null, if_chosen_differently: item.choices.filter((c) => c.value !== rec.value).map((c) => ({ value: c.value, effect: c.tradeoff, downstream_decisions_affected: C.dependentsOf(item.id) })),
    factory_able_to_execute: factory, human_confirmation_required: true,
  };
}

function ledgerStates(ledger) { return PL.foldLedger(ledger); }

/** Ask every item that is applicable (YES) and not yet asked. Returns {ledger, asked:[ids]}. */
function syncAsked(ledger, P, at, catalog) {
  let l = ledger; const asked = []; const S = ledgerStates(l);
  C.ITEMS.forEach((it) => {
    const st = (S[it.id] && S[it.id].state) || 'UNASKED';
    if (st !== 'UNASKED') return;
    if (C.applicability(it, P, S).applicable !== 'YES') return;
    const r = PL.appendProdEvent(l, { item_id: it.id, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'production-discovery-v1', at }, catalog || C.catalog);
    if (r.ok) { l = r.ledger; asked.push(it.id); }
  });
  return { ledger: l, asked };
}

/** Starts (or re-evaluates) discovery from raw intent. */
function startDiscovery(p) {
  let l = p.ledger || PL.createProdLedger(p.project_id);
  const P = detectProfile({ intent: p.intent, explicit: p.explicit, itemStates: ledgerStates(l), baseStates: p.baseStates });
  if (!P.activation.FULL_PRODUCTION_PROFILE) return { profile: P, ledger: l, asked: [] };
  const r = syncAsked(l, P, p.at);
  return { profile: P, ledger: r.ledger, asked: r.asked };
}

/** Writes deterministic recommendations for every item still only ASKED. Never touches user-answered items. */
function recommendAll(ledger, P, at, opts) {
  let l = ledger; const written = [];
  const S0 = ledgerStates(l); const cat = C.catalog;
  C.ITEMS.forEach((it) => {
    const S = ledgerStates(l); const st = (S[it.id] && S[it.id].state) || 'UNASKED';
    if (st !== 'ASKED') return;
    const P2 = detectProfile({ intent: opts && opts.intent, explicit: opts && opts.explicit, itemStates: S, baseStates: opts && opts.baseStates });
    const ex = explain(it, P2, S, opts);
    const r = PL.appendProdEvent(l, { item_id: it.id, to: 'AI_RECOMMENDED_PENDING_APPROVAL', actor_type: 'SYSTEM_RULE', actor_id: 'production-recommender-v1', at, value: ex.what, evidence: [{ kind: 'EXPLANATION', explanation_sha256: sha256OfValue(ex), why: ex.why, caused_by: ex.caused_by_requirements }] }, cat);
    if (r.ok) { l = r.ledger; written.push(it.id); }
  });
  void S0;
  return { ledger: l, recommended: written };
}

/** Human action helpers (the ONLY way a decision becomes confirmed). */
function userConfirm(ledger, itemId, actorId, at) {
  const S = ledgerStates(ledger); const cur = S[itemId];
  if (!cur || !cur.value) return { ok: false, error: 'NOTHING_TO_CONFIRM' };
  return PL.appendProdEvent(ledger, { item_id: itemId, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: actorId, at, value: cur.value, shown_value_sha256: sha256OfValue(cur.value) }, C.catalog);
}
function userAnswer(ledger, itemId, value, actorId, at) {
  let l = ledger; const S = ledgerStates(l); const st = (S[itemId] && S[itemId].state) || 'UNASKED';
  if (st === 'UNASKED') { const a = PL.appendProdEvent(l, { item_id: itemId, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'production-discovery-v1', at }, C.catalog); if (!a.ok) return a; l = a.ledger; }
  const st2 = ledgerStates(l)[itemId].state;
  if (st2 === 'AI_RECOMMENDED_PENDING_APPROVAL') return PL.appendProdEvent(l, { item_id: itemId, to: 'USER_EDITED', actor_type: 'USER', actor_id: actorId, at, value, shown_value_sha256: sha256OfValue(value) }, C.catalog);
  const a = PL.appendProdEvent(l, { item_id: itemId, to: 'ANSWERED', actor_type: 'USER', actor_id: actorId, at, value }, C.catalog); if (!a.ok) return a;
  return PL.appendProdEvent(a.ledger, { item_id: itemId, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: actorId, at, value, shown_value_sha256: sha256OfValue(value) }, C.catalog);
}
function userNotApplicable(ledger, itemId, rationale, actorId, at) {
  const S = ledgerStates(ledger); const st = (S[itemId] && S[itemId].state) || 'UNASKED'; let l = ledger;
  if (st === 'UNASKED') { const a = PL.appendProdEvent(l, { item_id: itemId, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'production-discovery-v1', at }, C.catalog); if (!a.ok) return a; l = a.ledger; }
  return PL.appendProdEvent(l, { item_id: itemId, to: 'NOT_APPLICABLE_WITH_RATIONALE', actor_type: 'USER', actor_id: actorId, at, value: 'NOT_APPLICABLE', rationale }, C.catalog);
}


/** Human changes an already-resolved decision: reopen (cascades STALE to dependents) then answer and confirm. */
function userChange(ledger, itemId, value, actorId, at) {
  const S = ledgerStates(ledger); const cur = S[itemId];
  if (!cur || RESOLVED.indexOf(cur.state) === -1) return userAnswer(ledger, itemId, value, actorId, at);
  const r = PL.appendProdEvent(ledger, { item_id: itemId, to: 'ASKED', actor_type: 'USER', actor_id: actorId, at }, C.catalog); if (!r.ok) return r;
  const a = PL.appendProdEvent(r.ledger, { item_id: itemId, to: 'ANSWERED', actor_type: 'USER', actor_id: actorId, at, value }, C.catalog); if (!a.ok) return a;
  return PL.appendProdEvent(a.ledger, { item_id: itemId, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: actorId, at, value, shown_value_sha256: sha256OfValue(value) }, C.catalog);
}

/** Plain-language rendering. GUIDED/ASSISTED never require expert vocabulary; EXPERT adds the engineering term. */
function renderQuestion(itemId, mode, lang) {
  const it = C.byId[itemId]; const L = lang === 'en' ? 'en' : 'ar';
  return { item_id: itemId, mode, question: it.q[L], expert_term: mode === 'EXPERT' ? it.expert[L] : null, choices: it.choices.map((c) => ({ value: c.value, label: c[L], tradeoff: c.tradeoff[L] })), allows_manual: true, requires_expert_knowledge: false, na_allowed: it.na_allowed };
}

module.exports = { explain, syncAsked, startDiscovery, recommendAll, userConfirm, userAnswer, userNotApplicable, userChange, renderQuestion, ledgerStates, RESOLVED, factoryRequirements: F.requiredCapabilities };
