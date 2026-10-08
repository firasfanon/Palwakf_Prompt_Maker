'use strict';

/**
 * ProductionCompletenessGuardianV1 — deterministic, rule-driven. It asks: "what would a competent product/architecture/
 * security/SRE/QA/DevOps team require that this user did not know to ask?" and BLOCKS an execution-ready state while any
 * execution-blocking finding exists. It never relies on model opinion.
 */

const C = require('./catalog');
const K = require('./common');
const M = require('./models');
const RESOLVED = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];

const CATEGORY_BY_ITEM = (it) => {
  if (it.id.indexOf('nfr_') === 0) return 'MISSING_NFRS';
  if (['backup_policy', 'restore_drill', 'continuity_dr'].indexOf(it.id) !== -1) return 'MISSING_RECOVERY_REQUIREMENTS';
  if (['tenant_isolation', 'identity_method', 'authorization_model', 'audit_trail', 'security_threat_assumptions', 'secrets_key_management', 'rate_limit_abuse', 'ai_injection_exfiltration', 'ai_tool_permissions', 'ai_pii_policy', 'privacy_compliance'].indexOf(it.id) !== -1) return 'MISSING_SECURITY_BOUNDARIES';
  if (['observability', 'incident_response', 'deployment_envs', 'deployment_ownership', 'domain_tls', 'ci_cd', 'migration_rollback', 'support_admin_surface', 'notifications_policy', 'background_jobs_policy', 'integrations_resilience', 'payment_failure_policy', 'provisioning_failure_policy'].indexOf(it.id) !== -1) return 'MISSING_OPERATIONAL_REQUIREMENTS';
  return 'MISSING_CRITICAL_DECISIONS';
};

function evaluate(ctx) {
  const P = ctx.profile; const S = ctx.states; const findings = [];
  const add = (f) => findings.push(Object.assign({ blocking: true }, f));
  C.ITEMS.forEach((it) => {
    const app = C.applicability(it, P, S);
    if (app.applicable === 'NO') return;
    const st = (S[it.id] && S[it.id].state) || 'UNASKED';
    if (RESOLVED.indexOf(st) !== -1) return;
    const blocking = it.crit >= 3 || app.applicable === 'CONDITIONAL';
    if (st === 'AI_RECOMMENDED_PENDING_APPROVAL') {
      add({ code: 'HUMAN_DECISIONS_REQUIRED', category: 'HUMAN_DECISIONS_REQUIRED', item_id: it.id, state: st, blocking, message_en: 'A recommendation exists for "' + it.id + '" but no human has confirmed it.', message_ar: 'توجد توصية للبند "' + it.id + '" لكن لم يؤكدها إنسان.', remedy: 'Confirm, edit or reject the recommendation.' });
    } else if (st === 'DEFERRED_WITH_GATE') {
      add({ code: 'EXECUTION_BLOCKERS', category: 'EXECUTION_BLOCKERS', item_id: it.id, state: st, blocking, message_en: 'Deferred decisions do not authorise execution.', message_ar: 'القرار المؤجل لا يجيز التنفيذ.', remedy: 'Resolve the decision or keep execution blocked.' });
    } else {
      add({ code: CATEGORY_BY_ITEM(it), category: CATEGORY_BY_ITEM(it), item_id: it.id, state: st, blocking, applicability: app.applicable, message_en: 'Required production decision "' + it.id + '" is unresolved (' + st + ').', message_ar: 'قرار إنتاجي مطلوب غير محسوم: ' + it.id + ' (' + st + ').', remedy: 'Ask and resolve this decision.' });
    }
  });
  // high-risk assumptions that were answered but leave the claim unprovable
  const v = (id) => K.view(S, id);
  if ((P.sensitive || P.regulated) && v('privacy_compliance').value === 'LEGAL_REVIEW_REQUIRED_REGIME_UNKNOWN') add({ code: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', category: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', item_id: 'privacy_compliance', blocking: false, message_en: 'Sensitive/regulated data with the applicable regime still unknown: a qualified legal review is required before any compliance claim.', message_ar: 'بيانات حساسة/منظَّمة والنظام القانوني غير معروف: يلزم مراجعة قانونية مؤهلة قبل أي ادعاء امتثال.', remedy: 'Obtain legal review; record it as evidence.' });
  if (v('cost_budget').value === 'UNKNOWN_ESTIMATE_REQUIRED') add({ code: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', category: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', item_id: 'cost_budget', blocking: false, message_en: 'No cost ceiling: economics are unvalidated.', message_ar: 'لا سقف للتكلفة: الجدوى الاقتصادية غير مثبتة.', remedy: 'Provide a ceiling or accept an estimate with assumptions.' });
  C.ITEMS.forEach((it) => {
    if (it.crit < 4 || RESOLVED.indexOf((S[it.id] && S[it.id].state) || 'UNASKED') === -1) return;
    const upstreamOnlyRecommended = it.deps.filter((d) => (S[d] && S[d].state) === 'AI_RECOMMENDED_PENDING_APPROVAL');
    if (upstreamOnlyRecommended.length) add({ code: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', category: 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', item_id: it.id, blocking: true, message_en: 'A confirmed decision rests on upstream decisions that are only recommendations: ' + upstreamOnlyRecommended.join(', '), message_ar: 'قرار مؤكد مبني على قرارات سابقة لم تُؤكَّد: ' + upstreamOnlyRecommended.join(', '), remedy: 'Confirm the upstream decisions.' });
  });
  // claims & traceability
  ctx.evidenceContract.claims.filter((c) => c.applicable !== 'NO').forEach((c) => { if (!c.required_evidence.length) add({ code: 'MISSING_EVIDENCE_REQUIREMENTS', category: 'MISSING_EVIDENCE_REQUIREMENTS', claim_id: c.claim_id, message_en: 'Claim has no evidence requirement.', message_ar: 'ادعاء بلا متطلب دليل.', remedy: 'Define evidence.' }); });
  (ctx.assertedClaims || []).forEach((cid) => { if (!(ctx.evidenced && ctx.evidenced[cid])) add({ code: 'UNTESTED_PRODUCTION_CLAIMS', category: 'UNTESTED_PRODUCTION_CLAIMS', claim_id: cid, message_en: 'The claim "' + cid + '" is asserted without complete evidence.', message_ar: 'ادعاء "' + cid + '" دون دليل كامل.', remedy: 'Withdraw the claim or supply the evidence.' }); });
  ctx.traceability.gaps.forEach((g) => add({ code: 'TRACEABILITY_GAPS', category: 'TRACEABILITY_GAPS', detail: g, blocking: g.blocking, message_en: 'Traceability gap: ' + g.code, message_ar: 'فجوة تتبع: ' + g.code, remedy: 'Add the missing link.' }));
  if (ctx.factory.FACTORY_SUPPORT_STATUS === 'UNSUPPORTED') add({ code: 'UNSUPPORTED_FACTORY_CAPABILITIES', category: 'UNSUPPORTED_FACTORY_CAPABILITIES', blocking: false, blocks_factory_execution: true, message_en: 'Recommended stack is not supported by the Factory (execution gap).', message_ar: 'التقنية الموصى بها غير مدعومة في المصنع (فجوة تنفيذ).', remedy: 'Choose one of AVAILABLE_USER_CHOICES.' });
  const CATS = ['MISSING_CRITICAL_DECISIONS', 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', 'MISSING_NFRS', 'MISSING_SECURITY_BOUNDARIES', 'MISSING_OPERATIONAL_REQUIREMENTS', 'MISSING_RECOVERY_REQUIREMENTS', 'UNTESTED_PRODUCTION_CLAIMS', 'MISSING_EVIDENCE_REQUIREMENTS', 'UNSUPPORTED_FACTORY_CAPABILITIES', 'HUMAN_DECISIONS_REQUIRED', 'EXECUTION_BLOCKERS', 'TRACEABILITY_GAPS'];
  const counts = {}; CATS.forEach((c) => { counts[c] = 0; }); findings.forEach((f) => { counts[f.category] = (counts[f.category] || 0) + 1; });
  const blocking = findings.some((f) => f.blocking);
  return K.makeProdArtifact('ProductionCompletenessGuardianV1', { artifact_id: ctx.project_id + ':ProductionCompletenessGuardianV1:' + ctx.head.slice(0, 12), project_id: ctx.project_id, created_at: ctx.created_at, producer: ctx.producer, references: [], fields: {
    categories: CATS, counts, findings, blocking, blocking_count: findings.filter((f) => f.blocking).length,
    verdict: blocking ? 'EXECUTION_BLOCKED' : 'CLEAR_FOR_ENGINEERING_REVIEW', deterministic: true, model_opinion_used: false,
    note: 'Clear means the specification has no known gaps; it does NOT mean implemented, validated or production-ready.' } });
}

module.exports = { evaluate };
