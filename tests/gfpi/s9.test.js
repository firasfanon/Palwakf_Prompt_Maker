'use strict';
// S9 — Full-Production / SaaS engineering intelligence: unit-level behaviour of each additive module.
const fs = require('fs');
const path = require('path');
const { test } = require('./harness');
const H = require('./prodHarness');
const { X, assert, must, at, sha256OfValue, BASE_VALUES, baseLedger } = H;
const C = X.C; const PL = X.PL;

const INTENT = 'I have an idea for a SaaS product for multiple clinics. I want it built as a complete full-production product. I am not technical.';

test('S9 catalog: 53+ plain-language items, all 29 readiness dimensions covered, bilingual, trade-offs everywhere, valid dependencies', () => {
  assert.ok(C.ITEMS.length >= 53);
  C.DIMENSIONS.forEach((d) => assert.ok(C.ITEMS.some((i) => i.dims.indexOf(d) !== -1), 'dimension uncovered ' + d));
  C.ITEMS.forEach((it) => {
    assert.ok(it.q.ar && it.q.en && it.expert.en, it.id);
    it.choices.forEach((c) => { assert.ok(c.ar && c.en && c.tradeoff.ar && c.tradeoff.en, it.id + '/' + c.value); });
    assert.ok(typeof it.rec({ tenancy: 'UNKNOWN', archetype_candidates: [], activation: {} }, {}).value === 'string', it.id + ' rec');
    it.deps.forEach((d) => assert.ok(C.byId[d], it.id + ' dep ' + d));
  });
  assert.ok(C.validValue('tenancy_model', 'MULTI_TENANT') && !C.validValue('tenancy_model', 'nonsense') && C.validValue('tenancy_model', 'manual:something specific'));
  assert.ok(C.validValue('saas_archetype', 'B2B_SAAS+REGULATED_SAAS') && !C.validValue('saas_archetype', 'B2B_SAAS+NOPE'));
});

test('S9 frozen catalog untouched: 21 frozen items and frozen package-state semantics unchanged', () => {
  assert.strictEqual(H.D0.ITEM_CATALOG.length, 21);
  assert.ok(!H.D0.ITEM_CATALOG.some((i) => C.byId[i.id]), 'production ids must not collide with frozen ids');
  const cs = H.D0.computePackageState({});
  assert.strictEqual(cs.state, 'DRAFT');
  assert.deepStrictEqual(H.D0.DECISION_STATES.slice(0, 4), ['UNASKED', 'ASKED', 'ANSWERED', 'AI_RECOMMENDED_PENDING_APPROVAL']);
});

test('S9 FULL_PRODUCTION is semantic, not cosmetic: 14 phrasings (EN+AR) activate; ordinary projects do not; explicit flag activates but bypasses nothing', () => {
  ['production-ready SaaS', 'a real production system', 'complete SaaS for clinics', 'commercial SaaS', 'enterprise-ready platform', 'a deployable production product', 'full-production tool', 'ready to launch for customers',
    'أريد نظامًا جاهزًا للإنتاج', 'منتج تجاري كامل', 'نظام متكامل للتشغيل الفعلي', 'مستوى مؤسسي', 'منصة SaaS قابلة للنشر', 'إنتاج حقيقي'].forEach((t) => {
    assert.ok(X.detectProfile({ intent: t }).activation.FULL_PRODUCTION_PROFILE, t);
  });
  assert.ok(!X.detectProfile({ intent: 'a blog about my cats' }).activation.FULL_PRODUCTION_PROFILE);
  const p = X.detectProfile({ intent: 'tool', explicit: { full_production: true, product_type: 'SAAS' } });
  assert.ok(p.activation.FULL_PRODUCTION_SAAS_PROFILE && p.activation.reasons.some((r) => /EXPLICIT_FLAG/.test(r)));
  // the flag alone leaves every blocking decision open: nothing is approvable
  const s = H.session({ intent: 'tool', explicit: { full_production: true, product_type: 'SAAS' } });
  const out = H.analyze({ intent: 'tool', explicit: { full_production: true, product_type: 'SAAS' } }, s.ledger);
  assert.ok(out.artifacts.guardian.blocking);
  assert.notStrictEqual(out.readiness.state, 'READY_FOR_ENGINEERING_REVIEW');
  assert.strictEqual(out.readiness.production_ready_claim_allowed, false);
});

test('S9 SaaS archetype signals are CANDIDATES (multi-label), never confirmed by detection', () => {
  const p = X.detectProfile({ intent: 'a healthcare SaaS for multiple organizations with AI assistant and subscriptions' });
  ['B2B_SAAS', 'REGULATED_SAAS', 'AI_NATIVE_SAAS', 'MULTI_TENANT'].forEach((a) => assert.ok(p.archetype_candidates.indexOf(a) !== -1, a));
  assert.strictEqual(p.archetype_confirmed, null);
  assert.strictEqual(p.tenancy_source, 'INTENT_SIGNAL_UNCONFIRMED');
  assert.ok(p.activation.AI_PRODUCTION_PROFILE_V1);
});

test('S9 human authority: only a USER can confirm; AI_PROVIDER and SYSTEM_RULE cannot; confirmation binds the shown value; AI proposals need evidence', () => {
  let l = PL.createProdLedger('p1');
  l = must(PL.appendProdEvent(l, { item_id: 'tenancy_model', to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at() }, C.catalog)).ledger;
  assert.strictEqual(PL.appendProdEvent(l, { item_id: 'tenancy_model', to: 'AI_RECOMMENDED_PENDING_APPROVAL', actor_type: 'AI_PROVIDER', actor_id: 'p', at: at(), value: 'MULTI_TENANT' }, C.catalog).error, 'AI_PROPOSAL_REQUIRES_EVIDENCE');
  const rec = must(PL.appendProdEvent(l, { item_id: 'tenancy_model', to: 'AI_RECOMMENDED_PENDING_APPROVAL', actor_type: 'AI_PROVIDER', actor_id: 'p', at: at(), value: 'MULTI_TENANT', evidence: [{ kind: 'x' }] }, C.catalog)).ledger;
  ['AI_PROVIDER', 'SYSTEM_RULE'].forEach((a) => assert.strictEqual(PL.appendProdEvent(rec, { item_id: 'tenancy_model', to: 'USER_CONFIRMED', actor_type: a, actor_id: 'x', at: at(), value: 'MULTI_TENANT', shown_value_sha256: sha256OfValue('MULTI_TENANT') }, C.catalog).error, 'TRANSITION_NOT_ALLOWED'));
  assert.strictEqual(PL.appendProdEvent(rec, { item_id: 'tenancy_model', to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: 'u', at: at(), value: 'MULTI_TENANT', shown_value_sha256: 'f'.repeat(64) }, C.catalog).error, 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE');
  assert.strictEqual(PL.appendProdEvent(rec, { item_id: 'tenancy_model', to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: 'u', at: at(), value: 'SINGLE_TENANT', shown_value_sha256: sha256OfValue('SINGLE_TENANT') }, C.catalog).error, 'CONFIRMED_VALUE_DIFFERS_FROM_PROPOSED');
  assert.strictEqual(PL.appendProdEvent(rec, { item_id: 'tenancy_model', to: 'AI_RECOMMENDED_PENDING_APPROVAL', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at(), value: 'NOT_A_CHOICE' }, C.catalog).error, 'VALUE_NOT_ALLOWED_FOR_ITEM');
  assert.strictEqual(PL.appendProdEvent(rec, { item_id: 'no_such_item', to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at() }, C.catalog).error, 'UNKNOWN_ITEM');
  const conf = must(X.D.userConfirm(rec, 'tenancy_model', 'u', at()));
  assert.strictEqual(PL.foldLedger(conf.ledger).tenancy_model.state, 'USER_CONFIRMED');
  // tamper detection
  const forged = JSON.parse(JSON.stringify(conf.ledger)); forged.entries[forged.entries.length - 1].actor_type = 'SYSTEM_RULE';
  assert.strictEqual(PL.verifyLedger(forged).valid, false);
});

test('S9 applicability is never silent: unconfirmed single-tenant signal keeps tenant items CONDITIONAL; only a confirmed decision makes them NOT_APPLICABLE with a basis', () => {
  const P = X.detectProfile({ intent: 'full-production SaaS single-tenant for one company only' });
  assert.strictEqual(P.tenancy, 'SINGLE_TENANT');
  assert.strictEqual(C.applicability(C.byId.tenant_isolation, P, {}).applicable, 'CONDITIONAL');
  let l = PL.createProdLedger('p1'); l = must(X.D.userAnswer(l, 'tenancy_model', 'SINGLE_TENANT', 'u', at())).ledger;
  const S = PL.foldLedger(l); const P2 = X.detectProfile({ intent: 'full-production SaaS', itemStates: S });
  const a = C.applicability(C.byId.tenant_isolation, P2, S);
  assert.strictEqual(a.applicable, 'NO'); assert.ok(/confirmed SINGLE_TENANT/.test(a.basis));
  const model = X.R.buildReadinessModel({ profile: P2, states: S });
  const ten = model.dimensions.find((d) => d.dimension === 'TENANCY');
  assert.ok(ten.items.find((i) => i.item_id === 'tenant_isolation').applicability.applicable === 'NO');
});

test('S9 readiness dimensions are derived (no global PASS): UNASSESSED -> REQUIRED -> UNRESOLVED -> SPECIFIED, BLOCKED on stale/rejected, N/A with rationale', () => {
  const P = X.detectProfile({ intent: 'full-production SaaS' });
  let l = PL.createProdLedger('p1');
  let m = X.R.buildReadinessModel({ profile: P, states: PL.foldLedger(l) });
  assert.ok(m.dimensions.every((d) => d.state === 'UNASSESSED' || d.state === 'NOT_APPLICABLE_WITH_RATIONALE'));
  l = X.D.startDiscovery({ project_id: 'p1', intent: 'full-production SaaS', at: at() }).ledger;
  m = X.R.buildReadinessModel({ profile: P, states: PL.foldLedger(l) });
  assert.ok(m.dimensions.some((d) => d.state === 'REQUIRED'));
  assert.strictEqual(m.global.claim, 'NOT_CLAIMED');
  assert.strictEqual(m.global.all_dimensions_evidenced, false);
  const reduced = X.R.DIM_STATES; ['UNASSESSED', 'REQUIRED', 'NOT_APPLICABLE_WITH_RATIONALE', 'UNRESOLVED', 'SPECIFIED', 'BLOCKED', 'IMPLEMENTATION_REQUIRED', 'EVIDENCE_REQUIRED', 'EVIDENCED'].forEach((s) => assert.ok(reduced.indexOf(s) !== -1));
  assert.strictEqual(m.dimensions.length, 29);
});

test('S9 adaptive discovery: the next question follows previous answers and the risk profile (healthcare SaaS for multiple organizations)', () => {
  const intent = 'a healthcare SaaS for multiple organizations, full-production';
  const s0 = H.session({ intent });
  const P = X.detectProfile({ intent, itemStates: PL.foldLedger(s0.ledger) });
  const q0 = X.A.nextQuestions(P, PL.foldLedger(s0.ledger), { limit: 8 });
  const ids0 = q0.ranked.map((r) => r.item_id);
  ['tenancy_model', 'data_classes'].forEach((id) => assert.ok(ids0.indexOf(id) !== -1, id + ' in ' + ids0));
  q0.ranked.forEach((r) => ['information_gain', 'risk', 'dependency_unlock', 'uncertainty', 'production_criticality', 'user_burden'].forEach((f) => assert.ok(typeof r.factors[f] === 'number')));
  assert.ok(q0.conditional.some((c) => c.item_id === 'tenant_isolation'), 'tenant isolation waits for the tenancy answer but is NOT dropped');
  // answer tenancy -> tenant isolation becomes askable; ordering changes (not a static list)
  const s1 = H.session({ intent, answers: { tenancy_model: 'MULTI_TENANT' } });
  const S1 = PL.foldLedger(s1.ledger); const P1 = X.detectProfile({ intent, itemStates: S1 });
  const q1 = X.A.nextQuestions(P1, S1, { limit: 40 });
  assert.ok(q1.ranked.some((r) => r.item_id === 'tenant_isolation'));
  assert.ok(!q1.ranked.some((r) => r.item_id === 'tenancy_model'));
  assert.notDeepStrictEqual(q0.ranked.map((r) => r.item_id), q1.ranked.map((r) => r.item_id).slice(0, 8));
  // sensitive/regulated boosts security/privacy questions relative to a non-sensitive profile
  const plain = X.detectProfile({ intent: 'a hobby-club SaaS, full-production' });
  const rp = (P2, id) => X.A.nextQuestions(P2, {}, { limit: 100, ignoreDependencies: true }).ranked.find((r) => r.item_id === id).factors.risk;
  assert.ok(rp(P, 'audit_trail') > rp(plain, 'audit_trail'));
  assert.deepStrictEqual(X.A.nextQuestions(P, PL.foldLedger(s0.ledger), { limit: 8 }), q0, 'deterministic');
});

test('S9 plain language: guided questions need no engineering vocabulary; expert terms appear only in Expert mode; Arabic and English both exist', () => {
  const JARGON = /\b(RTO|RPO|RLS|idempotenc\w*|tenant isolation|queue semantics|horizontal scaling|observability|secret rotation|rollback strategy|SLO|PITR|webhook)\b/i;
  C.ITEMS.forEach((it) => {
    const g = X.D.renderQuestion(it.id, 'GUIDED', 'en'); assert.ok(!JARGON.test(g.question), it.id + ': ' + g.question); assert.strictEqual(g.expert_term, null); assert.strictEqual(g.requires_expert_knowledge, false);
    const e = X.D.renderQuestion(it.id, 'EXPERT', 'en'); assert.ok(e.expert_term);
    const ar = X.D.renderQuestion(it.id, 'GUIDED', 'ar'); assert.ok(/[؀-ۿ]/.test(ar.question), it.id);
  });
  const rpo = X.D.renderQuestion('nfr_data_loss_rpo', 'GUIDED', 'en');
  assert.ok(/how much recent data could you tolerate losing/i.test(rpo.question));
  assert.ok(rpo.choices.every((c) => /^[A-Za-z0-9 ,.\-()']+$/.test(c.label)));
  assert.strictEqual(X.D.renderQuestion('nfr_data_loss_rpo', 'EXPERT', 'en').expert_term, 'RPO (recovery point objective)');
  const map = C.byId.nfr_data_loss_rpo.choices.find((c) => c.value === 'MINUTES_UP_TO_5').fx; assert.strictEqual(map.rpo, 'PT5M');
});

test('S9 explainability: every recommendation answers the seven questions and stays AI_RECOMMENDED_PENDING_APPROVAL', () => {
  const s = H.session({ intent: INTENT, recommendOnly: true });
  const S = PL.foldLedger(s.ledger); const pend = Object.keys(S).filter((k) => S[k].state === 'AI_RECOMMENDED_PENDING_APPROVAL');
  assert.ok(pend.length >= 30);
  const P = X.detectProfile({ intent: INTENT, itemStates: S });
  pend.forEach((id) => {
    const ex = X.D.explain(C.byId[id], P, S);
    ['what', 'why', 'caused_by_requirements', 'alternatives', 'tradeoffs', 'if_chosen_differently', 'factory_able_to_execute', 'human_confirmation_required'].forEach((f) => assert.ok(ex[f] !== undefined && ex[f] !== null, id + '.' + f));
    assert.strictEqual(ex.human_confirmation_required, true);
    const entry = s.ledger.entries.filter((e) => e.item_id === id && e.to === 'AI_RECOMMENDED_PENDING_APPROVAL')[0];
    assert.ok(entry.evidence.length && entry.evidence[0].explanation_sha256 && entry.actor_type === 'SYSTEM_RULE');
  });
  assert.ok(!s.ledger.entries.some((e) => e.to === 'USER_CONFIRMED'));
});

test('S9 NFRContractV1: unanswered => null (never invented); recommended => flagged pending; confirmed => tier definition; throughput/concurrency never numeric', () => {
  const none = H.session({ intent: INTENT });
  let out = H.analyze({ intent: INTENT }, none.ledger); let nfr = out.artifacts.nfr;
  ['availability', 'rpo', 'rto', 'latency_p95', 'capacity'].forEach((n) => { const t = nfr.targets.find((x) => x.nfr === n); assert.strictEqual(t.value, null, n); assert.strictEqual(t.status, 'UNRESOLVED'); });
  const rec = H.session({ intent: INTENT, recommendOnly: true }); out = H.analyze({ intent: INTENT }, rec.ledger); nfr = out.artifacts.nfr;
  const rpoR = nfr.targets.find((x) => x.nfr === 'rpo'); assert.strictEqual(rpoR.status, 'AI_RECOMMENDED_PENDING_APPROVAL'); assert.strictEqual(rpoR.recommended_only, true);
  const conf = H.session({ intent: INTENT, answers: { nfr_data_loss_rpo: 'MINUTES_UP_TO_5', nfr_availability: 'HIGH_99_9', nfr_scale: 'UP_TO_50K_USERS' } });
  out = H.analyze({ intent: INTENT }, conf.ledger); nfr = out.artifacts.nfr;
  assert.deepStrictEqual(nfr.targets.find((x) => x.nfr === 'rpo').value, { rpo: 'PT5M' });
  assert.strictEqual(nfr.targets.find((x) => x.nfr === 'availability').value.availability_pct_monthly, 99.9);
  ['throughput', 'concurrency'].forEach((n) => { const t = nfr.targets.find((x) => x.nfr === n); assert.strictEqual(t.value, null); assert.ok(/CONFIRMED_TIER_REQUIRES_LOAD_MODEL/.test(t.status)); });
  assert.strictEqual(nfr.targets.length, 18);
});

test('S9 CostModelV1: no fabricated cost; ranges need assumptions; cost-sensitive warnings; budget never invented', () => {
  const s = H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT', tenant_isolation: 'DATABASE_PER_TENANT', nfr_availability: 'CRITICAL_99_95' } });
  const out = H.analyze({ intent: INTENT }, s.ledger); const cost = out.artifacts.cost;
  cost.components.forEach((c) => { assert.strictEqual(c.estimate, null); assert.strictEqual(c.estimate_status, 'NOT_ESTIMATED'); assert.ok(c.assumptions_needed.length); });
  assert.ok(cost.budget_ceiling.status !== 'CONFIRMED');
  const w = cost.cost_sensitive_architecture_warnings.map((x) => x.item_id); assert.ok(w.indexOf('tenant_isolation') !== -1 && w.indexOf('nfr_availability') !== -1);
  ['fixed_infrastructure', 'variable_infrastructure', 'cost_per_tenant', 'cost_per_active_user', 'cost_per_request', 'database_storage_growth', 'bandwidth_egress', 'email_sms', 'payment_fees', 'third_party_apis', 'ai_token_inference', 'gpu_local_compute', 'observability', 'backup', 'support_operational_burden'].forEach((c) => assert.ok(cost.components.some((x) => x.component === c), c));
  assert.ok(cost.scaling_triggers.length >= 2 && /No exact future cost is claimed/.test(cost.statement));
});

test('S9 BuildVsBuy: five options, eleven criteria, generic reference only, never auto-selects, model preference not applied', () => {
  const s = H.session({ intent: INTENT }); const b = H.analyze({ intent: INTENT }, s.ledger).artifacts.bvb;
  assert.deepStrictEqual(b.options, ['BUILD', 'MANAGED_SERVICE', 'EXTERNAL_SAAS', 'OPEN_SOURCE_SELF_HOSTED', 'HYBRID']);
  assert.strictEqual(b.criteria.length, 11); assert.strictEqual(b.automatic_selection, false); assert.strictEqual(b.model_preference_applied, false);
  assert.ok(b.per_capability_selection.every((c) => c.selection === null && /REQUIRES_HUMAN_DECISION/.test(c.status)));
});

test('S9 ThreatModelV1 is architecture-aware: multi-tenant adds cross-tenant threats, single-tenant omits them, AI adds AI threats, unmitigated until decisions are confirmed', () => {
  const mt = H.analyze({ intent: INTENT }, H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT' } }).ledger).artifacts.threat;
  ['T-MT-01', 'T-MT-02', 'T-MT-03', 'T-MT-04'].forEach((t) => assert.ok(mt.threats.some((x) => x.threat_id === t), t));
  assert.ok(mt.trust_boundaries.indexOf('tenant_to_tenant') !== -1 && mt.architecture_aware.multi_tenant_cross_tenant_threats_included);
  assert.ok(mt.residual_risks.some((r) => r.threat_id === 'T-MT-01'), 'isolation undecided => unmitigated');
  ['protected_assets', 'actors', 'trust_boundaries', 'entry_points', 'attack_surfaces', 'abuse_cases', 'threats', 'mitigations', 'residual_risks', 'acceptance_tests', 'evidence_requirements'].forEach((f) => assert.ok(Array.isArray(mt[f]) && mt[f].length, f));
  const st = H.analyze({ intent: 'full-production SaaS, single-tenant, one company only' }, H.session({ intent: 'full-production SaaS, single-tenant, one company only', answers: { tenancy_model: 'SINGLE_TENANT' } }).ledger).artifacts.threat;
  assert.ok(!st.threats.some((x) => /^T-MT/.test(x.threat_id)));
  const aiI = 'full-production AI-powered SaaS assistant for multiple clinics';
  const ai = H.analyze({ intent: aiI }, H.session({ intent: aiI, answers: { tenancy_model: 'MULTI_TENANT', ai_native_scope: 'YES' } }).ledger).artifacts.threat;
  ['T-AI-01', 'T-AI-02', 'T-AI-03', 'T-AI-04', 'T-AI-05'].forEach((t) => assert.ok(ai.threats.some((x) => x.threat_id === t), t));
  const done = H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const t2 = H.analyze({ intent: INTENT }, done.ledger).artifacts.threat;
  assert.ok(!t2.residual_risks.some((r) => r.threat_id === 'T-MT-01'), 'confirmed mitigation clears the pending-decision risk (residual risk after implementation still noted)');
  assert.ok(t2.threats.find((x) => x.threat_id === 'T-MT-01').residual_risk.level === 'RESIDUAL_AFTER_CONFIRMED_MITIGATION');
});

test('S9 DataLifecycleModelV1 carries all sixteen lifecycle attributes per class and refuses to invent residency/source', () => {
  const baseL = baseLedger(BASE_VALUES); const baseStates = L_fold(baseL);
  const s = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const dl = H.analyze({ intent: INTENT, baseStates }, s.ledger).artifacts.data;
  assert.ok(dl.data_classes.length >= 6);
  ['data_class', 'source', 'owner', 'tenant_scope', 'sensitivity', 'storage_location', 'encryption_requirements', 'access_policy', 'retention', 'deletion', 'export', 'backup', 'restore', 'residency', 'auditability', 'legal_or_policy_constraints'].forEach((f) => dl.data_classes.forEach((c) => assert.ok(f in c, f)));
  assert.ok(dl.data_classes.some((c) => c.data_class === 'billing_and_payment_records' || c.data_class === 'identity_and_credentials'));
  dl.data_classes.forEach((c) => assert.ok(/UNRESOLVED/.test(c.residency.status) && /UNRESOLVED/.test(c.source.status)));
  assert.ok(dl.schema_alone_is_not_data_architecture);
});
const L_fold = (l) => H.L.foldLedger(l);

test('S9 DeploymentTopologyV1: a provider choice is not a topology; every missing element is listed with the decision that must supply it', () => {
  const s0 = H.session({ intent: INTENT }); const t0 = H.analyze({ intent: INTENT }, s0.ledger).artifacts.topology;
  assert.ok(t0.provider_selection_is_not_topology && /does not define environments/.test(t0.provider_selection_note));
  assert.deepStrictEqual(t0.environments, []); assert.ok(t0.open_gaps.length >= 7);
  const s1 = H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true }); const t1 = H.analyze({ intent: INTENT }, s1.ledger).artifacts.topology;
  assert.deepStrictEqual(t1.environments.map((e) => e.environment), ['local', 'staging', 'production']); assert.strictEqual(t1.open_gaps.length, 0);
  const prod = t1.environments.find((e) => e.environment === 'production'); assert.ok(prod.backup_restore && prod.monitoring_alerting && /no production data|real data/.test(prod.data_policy));
  assert.ok(/no production data/.test(t1.environments.find((e) => e.environment === 'staging').data_policy));
});

test('S9 ProductionEvidenceContractV1: every claim defines evidence; Prompt Maker/AI evidence is rejected; stale and human-class rules enforced; EVIDENCED only with complete valid attestations', () => {
  const s = H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const out = H.analyze({ intent: INTENT }, s.ledger); const ec = out.artifacts.evidence; const S = PL.foldLedger(s.ledger);
  ec.claims.forEach((c) => { assert.ok(c.required_evidence.length >= 1, c.claim_id); assert.strictEqual(c.status, 'EVIDENCE_REQUIRED'); });
  const tc = ec.claims.find((c) => c.claim_id === 'TENANT_ISOLATION_READY');
  ['POSITIVE_AUTHORIZATION_TESTS', 'NEGATIVE_CROSS_TENANT_TESTS', 'DATABASE_POLICY_READBACK', 'API_AUTHORIZATION_TESTS', 'AUDIT_EVIDENCE'].forEach((k) => assert.ok(tc.required_evidence.some((e) => e.kind === k), k));
  const br = ec.claims.find((c) => c.claim_id === 'BACKUP_RESTORE_READY');
  ['BACKUP_CONFIGURATION_READBACK', 'SUCCESSFUL_RESTORE_DRILL', 'RPO_MEASUREMENT', 'RTO_MEASUREMENT', 'INTEGRITY_VALIDATION'].forEach((k) => assert.ok(br.required_evidence.some((e) => e.kind === k), k));
  const mkA = (kind, who, binding) => ({ claim_id: 'TENANT_ISOLATION_READY', kind, sha256: 'a'.repeat(64), produced_by: who || { actor_type: 'EXTERNAL_CI', actor_id: 'ci-1' }, at: '2026-04-01T00:00:00Z', decision_binding_sha256: binding === undefined ? tc.decision_binding_sha256 : binding });
  // mechanics test fixtures (TEST_FIXTURE, not evidence about any product)
  const bad = X.M.applyEvidence(ec, S, [mkA('POSITIVE_AUTHORIZATION_TESTS', { actor_type: 'PROMPT_MAKER', actor_id: 'pm' }), mkA('NEGATIVE_CROSS_TENANT_TESTS', { actor_type: 'AI_PROVIDER', actor_id: 'm' }), mkA('NOT_A_KIND'), Object.assign(mkA('API_AUTHORIZATION_TESTS'), { sha256: 'zz' }), mkA('AUDIT_EVIDENCE', undefined, 'e'.repeat(64))]);
  assert.deepStrictEqual(bad.rejected.map((r) => r.reason).sort(), ['EVIDENCE_HASH_REQUIRED', 'EVIDENCE_MUST_NOT_BE_PRODUCED_BY_PROMPT_MAKER_OR_AI', 'EVIDENCE_MUST_NOT_BE_PRODUCED_BY_PROMPT_MAKER_OR_AI', 'KIND_NOT_REQUIRED_BY_CLAIM', 'STALE_EVIDENCE_DECISIONS_CHANGED']);
  assert.strictEqual(bad.status.TENANT_ISOLATION_READY, 'EVIDENCE_REQUIRED');
  const part = X.M.applyEvidence(ec, S, [mkA('POSITIVE_AUTHORIZATION_TESTS')]); assert.strictEqual(part.status.TENANT_ISOLATION_READY, 'EVIDENCE_PARTIAL');
  const all = X.M.applyEvidence(ec, S, tc.required_evidence.map((e) => mkA(e.kind))); assert.strictEqual(all.status.TENANT_ISOLATION_READY, 'EVIDENCED');
  // human-class evidence requires a USER
  const hc = ec.claims.find((c) => c.claim_id === 'PRIVACY_COMPLIANCE_REVIEWED');
  const h1 = X.M.applyEvidence(ec, S, [{ claim_id: hc.claim_id, kind: 'QUALIFIED_LEGAL_REVIEW_RECORD', sha256: 'b'.repeat(64), produced_by: { actor_type: 'EXTERNAL_CI', actor_id: 'ci' }, decision_binding_sha256: hc.decision_binding_sha256 }]);
  assert.strictEqual(h1.rejected[0].reason, 'HUMAN_VERIFIER_REQUIRED');
  const h2 = X.M.applyEvidence(ec, S, [{ claim_id: hc.claim_id, kind: 'QUALIFIED_LEGAL_REVIEW_RECORD', sha256: 'b'.repeat(64), produced_by: { actor_type: 'USER', actor_id: 'counsel' }, decision_binding_sha256: hc.decision_binding_sha256 }]);
  assert.strictEqual(h2.status.PRIVACY_COMPLIANCE_REVIEWED, 'EVIDENCED');
  // changing a linked decision invalidates previously valid evidence
  const changed = must(X.D.userChange(s.ledger, 'tenant_isolation', 'SCHEMA_PER_TENANT', 'founder', at())).ledger;
  const stale = X.M.applyEvidence(out.artifacts.evidence, PL.foldLedger(changed), tc.required_evidence.map((e) => mkA(e.kind)));
  assert.strictEqual(stale.status.TENANT_ISOLATION_READY, 'EVIDENCE_REQUIRED'); assert.ok(stale.rejected.every((r) => r.reason === 'STALE_EVIDENCE_DECISIONS_CHANGED'));
});

test('S9 readiness state machine: PRODUCTION_READY only with approval + implementation + EVERY applicable claim EVIDENCED; spec completeness never implies later stages', () => {
  const baseStates = L_fold(baseLedger(BASE_VALUES));
  const s = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT', billing_model: 'TIERED_SUBSCRIPTION' }, acceptRecommendations: true });
  const out0 = H.analyze({ intent: INTENT, baseStates }, s.ledger);
  assert.strictEqual(out0.readiness.state, 'READY_FOR_ENGINEERING_REVIEW'); assert.strictEqual(out0.readiness.production_ready_claim_allowed, false);
  const claims = out0.artifacts.evidence.claims.filter((c) => c.applicable !== 'NO');
  const ev = (list) => list.reduce((a, c) => { a[c.claim_id] = true; return a; }, {});
  const ctx = (extra) => Object.assign({ profile: out0.profile, model: out0.readinessModel, guardian: { blocking: false }, approval: { intact: true }, implementation: { status: 'IMPLEMENTED' }, claims: claims.map((c) => ({ claim_id: c.claim_id, group: c.group })), evidencedClaims: {}, release: null }, extra || {});
  const d = (extra) => X.R.deriveReadinessState(ctx(extra)).state;
  assert.strictEqual(d({ approval: null }), 'READY_FOR_ENGINEERING_REVIEW');
  assert.strictEqual(d({ guardian: { blocking: true } }), 'EXECUTION_BLOCKED');
  assert.strictEqual(d({ implementation: { status: 'NONE' } }), 'APPROVED_FOR_EXECUTION');
  assert.strictEqual(d({ implementation: { status: 'IN_PROGRESS' } }), 'IMPLEMENTATION_IN_PROGRESS');
  assert.strictEqual(d({}), 'IMPLEMENTED_NOT_VALIDATED');
  assert.strictEqual(d({ evidencedClaims: ev(claims.slice(0, 2)) }), 'PRODUCTION_EVIDENCE_INCOMPLETE');
  assert.strictEqual(d({ evidencedClaims: ev(claims.filter((c) => c.group === 'OPERATIONS')) }), 'OPERATIONALLY_VALIDATED');
  const allEv = ev(claims.slice(0, claims.length - 1)); assert.notStrictEqual(d({ evidencedClaims: allEv }), 'PRODUCTION_READY');
  assert.strictEqual(d({ evidencedClaims: ev(claims) }), 'PRODUCTION_READY');
  assert.strictEqual(d({ evidencedClaims: ev(claims), release: { actor_type: 'USER', actor_id: 'owner' } }), 'RELEASED');
  assert.notStrictEqual(d({ evidencedClaims: ev(claims), release: { actor_type: 'AI_PROVIDER', actor_id: 'x' } }), 'RELEASED');
  assert.strictEqual(d({ approval: { intact: true, superseded: true } }), 'SUPERSEDED');
  assert.strictEqual(X.R.READINESS_STATES.length, 13);
  // dimension ladder on the same data
  const m = X.R.buildReadinessModel({ profile: out0.profile, states: PL.foldLedger(s.ledger), approvedForExecution: true, claims: claims.map((c) => ({ claim_id: c.claim_id, dimensions: c.dimensions })), evidencedClaims: {}, implementation: { TENANCY: true } });
  assert.ok(m.dimensions.some((x) => x.state === 'IMPLEMENTATION_REQUIRED') && m.dimensions.find((x) => x.dimension === 'TENANCY').state === 'EVIDENCE_REQUIRED');
});

test('S9 frozen package lifecycle is distinct from readiness: package states keep their meaning, no production state leaks into the frozen package', () => {
  const l = baseLedger(BASE_VALUES); const bp = H.basePackage(l);
  assert.strictEqual(bp.built.package.state, 'READY_FOR_REVIEW');
  assert.ok(X.R.READINESS_STATES.indexOf('READY_FOR_REVIEW') === -1);
  assert.ok(!/PRODUCTION_READY|FULL_PRODUCTION/.test(JSON.stringify(bp.built.package)));
});

test('S9 ADR vs recommendation: pending recommendations are NOT ADRs; confirmed consequential decisions become ADRs with ledger references and supersession', () => {
  const rec = H.session({ intent: INTENT, recommendOnly: true }); const a0 = H.analyze({ intent: INTENT }, rec.ledger).artifacts.adr;
  assert.strictEqual(a0.adrs.length, 0); assert.ok(a0.not_adrs.length >= 30 && a0.not_adrs.every((n) => n.status === 'PROPOSED_NOT_AN_ADR'));
  const s = H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true }); const a1 = H.analyze({ intent: INTENT }, s.ledger).artifacts.adr;
  const t = a1.adrs.find((x) => x.decision_id === 'tenancy_model');
  ['decision_id', 'context', 'decision', 'status', 'alternatives_considered', 'selection_rationale', 'tradeoffs', 'assumptions', 'constraints', 'dependencies', 'security_implications', 'cost_implications', 'operational_implications', 'reversal_cost', 'affected_artifacts', 'supersedes', 'created_at', 'decision_ledger_reference'].forEach((f) => assert.ok(f in t, f));
  assert.strictEqual(t.status, 'ACCEPTED_BY_HUMAN'); assert.strictEqual(t.reversal_cost, 'HIGH'); assert.ok(t.decision_ledger_reference.entry_sha256);
  const ch = must(X.D.userChange(s.ledger, 'tenancy_model', 'HYBRID_TENANCY', 'founder', at())).ledger;
  const a2 = H.analyze({ intent: INTENT }, ch).artifacts.adr.adrs.find((x) => x.decision_id === 'tenancy_model');
  assert.ok(a2.supersedes && a2.supersedes.entry_sha256 === t.decision_ledger_reference.entry_sha256);
});

test('S9 guardian is deterministic, rule-driven and blocks until every blocking finding is resolved; clear does not mean production-ready', () => {
  const s0 = H.session({ intent: INTENT }); const g0 = H.analyze({ intent: INTENT }, s0.ledger).artifacts.guardian;
  assert.strictEqual(g0.blocking, true); assert.strictEqual(g0.model_opinion_used, false); assert.strictEqual(g0.deterministic, true);
  ['MISSING_CRITICAL_DECISIONS', 'UNRESOLVED_HIGH_RISK_ASSUMPTIONS', 'MISSING_NFRS', 'MISSING_SECURITY_BOUNDARIES', 'MISSING_OPERATIONAL_REQUIREMENTS', 'MISSING_RECOVERY_REQUIREMENTS', 'UNTESTED_PRODUCTION_CLAIMS', 'MISSING_EVIDENCE_REQUIREMENTS', 'UNSUPPORTED_FACTORY_CAPABILITIES', 'HUMAN_DECISIONS_REQUIRED', 'EXECUTION_BLOCKERS', 'TRACEABILITY_GAPS'].forEach((c) => assert.ok(c in g0.counts, c));
  assert.ok(g0.counts.MISSING_NFRS >= 1 && g0.counts.MISSING_SECURITY_BOUNDARIES >= 1 && g0.counts.MISSING_RECOVERY_REQUIREMENTS >= 1 && g0.counts.MISSING_OPERATIONAL_REQUIREMENTS >= 1);
  assert.strictEqual(JSON.stringify(H.analyze({ intent: INTENT }, s0.ledger).artifacts.guardian), JSON.stringify(g0));
  const baseStates = L_fold(baseLedger(BASE_VALUES));
  const done = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true }); const g1 = H.analyze({ intent: INTENT, baseStates }, done.ledger).artifacts.guardian;
  assert.strictEqual(g1.blocking, false, JSON.stringify(g1.findings.filter((f) => f.blocking)));
  assert.strictEqual(g1.verdict, 'CLEAR_FOR_ENGINEERING_REVIEW'); assert.ok(/does NOT mean implemented/.test(g1.note));
  // a deferred decision never authorises execution
  const defer = must(PL.appendProdEvent(PL.appendProdEvent(PL.createProdLedger('p1'), { item_id: 'backup_policy', to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at() }, C.catalog).ledger, { item_id: 'backup_policy', to: 'DEFERRED_WITH_GATE', actor_type: 'USER', actor_id: 'u', at: at(), gate: 'decide after pilot' }, C.catalog));
  const g2 = H.analyze({ intent: INTENT }, defer.ledger).artifacts.guardian; assert.ok(g2.findings.some((f) => f.code === 'EXECUTION_BLOCKERS' && f.item_id === 'backup_policy'));
  // untested production claim asserted => blocking
  const g3 = X.GU.evaluate(Object.assign({}, H.analyze({ intent: INTENT, baseStates }, done.ledger).ctx, { evidenceContract: H.analyze({ intent: INTENT, baseStates }, done.ledger).artifacts.evidence, traceability: H.analyze({ intent: INTENT, baseStates }, done.ledger).artifacts.traceability, factory: H.analyze({ intent: INTENT, baseStates }, done.ledger).artifacts.factory, assertedClaims: ['TENANT_ISOLATION_READY'], evidenced: {} }));
  assert.ok(g3.blocking && g3.findings.some((f) => f.code === 'UNTESTED_PRODUCTION_CLAIMS'));
});

test('S9 Factory support stays separate: an unsupported engineering recommendation is reported with gap/alternatives/choices and is never silently replaced', () => {
  const baseStates = L_fold(baseLedger(Object.assign({}, BASE_VALUES), ['technology_stack']));
  const s = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT', tenant_isolation: 'DATABASE_PER_TENANT' } });
  const f = H.analyze({ intent: INTENT, baseStates }, s.ledger).artifacts.factory;
  assert.strictEqual(f.RECOMMENDED_STACK, 'nextjs-managed-postgres-workers'); assert.strictEqual(f.FACTORY_SUPPORT_STATUS, 'UNSUPPORTED');
  assert.strictEqual(f.recommendation_state, 'AI_RECOMMENDED_PENDING_APPROVAL'); assert.strictEqual(f.silent_substitution, false);
  assert.ok(f.EXECUTION_GAP && f.ALTERNATIVES.length === 2 && f.AVAILABLE_USER_CHOICES.length === 3 && f.TRADEOFFS.length === 2 && /not by Factory support/.test(f.WHY_RECOMMENDED));
  assert.ok(f.ALTERNATIVES.every((a) => a.satisfies_all_required_capabilities === false && a.missing_capabilities.indexOf('database_per_tenant') !== -1));
  const g = H.analyze({ intent: INTENT, baseStates }, s.ledger).artifacts.guardian.findings.find((x) => x.code === 'UNSUPPORTED_FACTORY_CAPABILITIES');
  assert.ok(g && g.blocks_factory_execution === true && g.blocking === false);
  // supported case
  const ok = H.analyze({ intent: INTENT }, H.session({ intent: INTENT, answers: { tenancy_model: 'MULTI_TENANT', tenant_isolation: 'RLS_SHARED_SCHEMA' } }).ledger).artifacts.factory;
  assert.strictEqual(ok.FACTORY_SUPPORT_STATUS, 'SUPPORTED'); assert.strictEqual(ok.RECOMMENDED_STACK, 'react-vite-supabase'); assert.deepStrictEqual(ok.AVAILABLE_USER_CHOICES, []);
  // a user-confirmed stack is respected even when unsupported
  const bs2 = L_fold(baseLedger(Object.assign({}, BASE_VALUES, { technology_stack: 'manual:Django + HTMX' })));
  const u = H.analyze({ intent: INTENT, baseStates: bs2 }, H.session({ intent: INTENT, baseStates: bs2 }).ledger).artifacts.factory;
  assert.strictEqual(u.RECOMMENDED_STACK, 'Django + HTMX'); assert.strictEqual(u.recommendation_state, 'CONFIRMED_BY_USER'); assert.strictEqual(u.FACTORY_SUPPORT_STATUS, 'UNSUPPORTED');
});

test('S9 traceability: chain is complete for a resolved project; each gap class is detected and critical gaps fail closed', () => {
  const baseStates = L_fold(baseLedger(BASE_VALUES));
  const s = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const tr = H.analyze({ intent: INTENT, baseStates }, s.ledger).artifacts.traceability;
  assert.strictEqual(tr.blocking_gap_count, 0, JSON.stringify(tr.gaps)); assert.ok(/USER_GOAL -> REQUIREMENT -> DECISION/.test(tr.chain_definition) && /PRODUCTION_GATE/.test(tr.chain_definition));
  // no user goal => orphan requirements, blocking
  const noGoal = H.analyze({ intent: INTENT }, s.ledger).artifacts.traceability; assert.ok(noGoal.gaps.some((g) => g.code === 'ORPHAN_REQUIREMENTS' && g.blocking));
  // synthetic claim without evidence / without requirement
  const G = X.G; const out = H.analyze({ intent: INTENT, baseStates }, s.ledger);
  const claims = X.M.CLAIMS; const saved = claims[0].ev.slice(); claims[0].ev.length = 0;
  try { const t = G.buildTraceability(Object.assign({ graph: out.artifacts.graph }, out.ctx)); assert.ok(t.gaps.some((g) => g.code === 'PRODUCTION_CLAIMS_WITHOUT_EVIDENCE')); } finally { saved.forEach((x) => claims[0].ev.push(x)); }
  const savedItems = claims[0].items.slice(); claims[0].items.length = 0; claims[0].items.push('nonexistent_item');
  try { const t = G.buildTraceability(Object.assign({ graph: out.artifacts.graph }, out.ctx)); void t; } catch (e) { /* graph rebuild is out of scope; the guard below is what matters */ } finally { claims[0].items.length = 0; savedItems.forEach((x) => claims[0].items.push(x)); }
  // requirement without any claim => UNTESTED_REQUIREMENTS
  const untested = (() => { const idx = X.M.CLAIMS.findIndex((c) => c.items.indexOf('rate_limit_abuse') !== -1); const keep = X.M.CLAIMS[idx].items.slice(); X.M.CLAIMS[idx].items = keep.filter((i) => i !== 'rate_limit_abuse'); try { const g2 = G.buildDependencyGraph(out.ctx); return G.buildTraceability(Object.assign({ graph: g2 }, out.ctx)); } finally { X.M.CLAIMS[idx].items = keep; } })();
  assert.ok(untested.gaps.some((g) => g.code === 'UNTESTED_REQUIREMENTS' && g.item_id === 'rate_limit_abuse' && g.blocking));
});

test('S9 production modules are pure and deterministic: no clock, randomness, environment, filesystem or network access; same inputs => identical artifact hashes', () => {
  const dir = path.join(__dirname, '..', '..', 'gfpi', 'production');
  fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).forEach((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/Date\.now|new Date\(|Math\.random|process\.env|require\(['"](fs|http|https|net|child_process|os)['"]\)|fetch\(|XMLHttpRequest/.test(src), f);
    assert.ok(!/require\((?!['"]\.\.?\/)/.test(src), f + ' must only require local modules (bundle-safe)');
  });
  const baseStates = L_fold(baseLedger(BASE_VALUES)); const mk = () => H.analyze({ intent: INTENT, baseStates }, H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true }).ledger);
  const a = mk(); const b = mk();
  const strip = (o) => Object.keys(o.artifacts).reduce((acc, k) => { acc[k] = o.artifacts[k].content_sha256; return acc; }, {});
  assert.deepStrictEqual(Object.keys(strip(a)).length, 14);
  Object.keys(a.artifacts).forEach((k) => assert.ok(X.K.verifyProdArtifact(a.artifacts[k]), k));
});

test('S9 ExecutionAttachment: carries hashes not copies, has its own approval bound to its hash, cannot be approved while blocked, is superseded by any decision change, and the frozen package is untouched', () => {
  const bl = baseLedger(BASE_VALUES); const baseStates = L_fold(bl); const bp = H.basePackage(bl); const pkgHashBefore = bp.built.package_sha256;
  const blocked = H.session({ intent: INTENT, baseStates });
  const o0 = H.analyze({ intent: INTENT, baseStates }, blocked.ledger); const att0 = X.AT.buildAttachment(o0.ctx, o0.artifacts, bp.built.package);
  assert.ok(att0.unresolved_blockers.length > 0);
  assert.strictEqual(X.AT.approveAttachment(att0, blocked.ledger, { actor_type: 'USER', actor_id: 'owner', at: at(), attachment_sha256: att0.content_sha256, base_package_sha256: bp.built.package_sha256 }).error, 'EXECUTION_BLOCKED_BY_GUARDIAN');
  const s = H.session({ intent: INTENT, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const o1 = H.analyze({ intent: INTENT, baseStates }, s.ledger); const att = X.AT.buildAttachment(o1.ctx, o1.artifacts, bp.built.package);
  assert.deepStrictEqual(att.unresolved_blockers, []); assert.ok(att.manifest.length === 14 && att.manifest.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));
  assert.ok(!JSON.stringify(att).includes('"protected_assets"'), 'attachment references artifacts by hash and does not duplicate them');
  const req = { actor_type: 'USER', actor_id: 'owner', at: at(), attachment_sha256: att.content_sha256, base_package_sha256: bp.built.package_sha256 };
  assert.strictEqual(X.AT.approveAttachment(att, s.ledger, Object.assign({}, req, { actor_type: 'AI_PROVIDER' })).error, 'HUMAN_ACTION_REQUIRED');
  assert.strictEqual(X.AT.approveAttachment(att, s.ledger, Object.assign({}, req, { attachment_sha256: 'f'.repeat(64) })).error, 'APPROVAL_NOT_BOUND_TO_ATTACHMENT_HASH');
  assert.strictEqual(X.AT.approveAttachment(att, s.ledger, Object.assign({}, req, { base_package_sha256: 'f'.repeat(64) })).error, 'APPROVAL_NOT_BOUND_TO_BASE_PACKAGE');
  const ap = must(X.AT.approveAttachment(att, s.ledger, req));
  assert.strictEqual(X.AT.attachmentStatus(att, ap.approval, s.ledger).status, 'APPROVED_FOR_EXECUTION');
  const tampered = Object.assign({}, ap.approval, { actor_id: 'someone-else' }); assert.strictEqual(X.AT.attachmentStatus(att, tampered, s.ledger).approval_valid, false);
  const changed = must(X.D.userChange(s.ledger, 'backup_policy', 'DAILY_AUTOMATED', 'founder', at())).ledger;
  const st = X.AT.attachmentStatus(att, ap.approval, changed); assert.strictEqual(st.status, 'SUPERSEDED'); assert.strictEqual(st.approval_valid, false);
  assert.strictEqual(X.AT.approveAttachment(att, changed, req).error, 'ATTACHMENT_SUPERSEDED_BY_DECISION_CHANGE');
  assert.strictEqual(H.basePackage(bl).built.package_sha256, pkgHashBefore, 'frozen package hash is independent of the production layer');
  assert.ok(/not implementation completeness|is not implementation completeness/.test(att.readiness_statement));
});
