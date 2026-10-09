'use strict';
// S10 — Mandatory scenarios 26-30 (Full-Production / SaaS amendment). Humans are SIMULATED test actors.
const { test } = require('./harness');
const H = require('./prodHarness');
const { X, assert, must, at, BASE_VALUES, baseLedger } = H;
const PL = X.PL; const C = X.C;
const fold = (l) => H.L.foldLedger(l);

test('S10 scenario 26 (journey) founder idea becomes a reviewable, hash-bound execution attachment without engineering vocabulary', () => {
  const intent = 'I have an idea for a SaaS product for multiple clinics. I want it full-production. Ask me what you need and recommend the rest.';
  const bl = baseLedger(BASE_VALUES); const baseStates = fold(bl); const bp = H.basePackage(bl);
  // founder answers only plain questions; says "I don't know" to the rest
  const plain = { tenancy_model: 'MULTI_TENANT', billing_model: 'TIERED_SUBSCRIPTION', data_classes: 'HEALTH_AND_PERSONAL' };
  const s1 = H.session({ intent, baseStates, answers: plain });
  const o1 = H.analyze({ intent, baseStates }, s1.ledger);
  assert.ok(o1.profile.activation.FULL_PRODUCTION_SAAS_PROFILE);
  assert.strictEqual(o1.artifacts.guardian.blocking, true, 'unknowns remain => blocked');
  const q = X.A.nextQuestions(o1.profile, fold1(s1), { limit: 5 }).ranked;
  q.forEach((r) => assert.strictEqual(X.D.renderQuestion(r.item_id, 'GUIDED', 'en').requires_expert_knowledge, false));
  // "I don't know" => recommendations pending, then the founder confirms each
  const s2 = H.session({ intent, baseStates, answers: plain, acceptRecommendations: true });
  const o2 = H.analyze({ intent, baseStates }, s2.ledger);
  assert.strictEqual(o2.artifacts.guardian.blocking, false, JSON.stringify(o2.artifacts.guardian.findings.filter((f) => f.blocking)));
  assert.strictEqual(o2.readiness.state, 'READY_FOR_ENGINEERING_REVIEW');
  const att = X.AT.buildAttachment(o2.ctx, o2.artifacts, bp.built.package);
  const ap = must(X.AT.approveAttachment(att, s2.ledger, { actor_type: 'USER', actor_id: 'owner', at: at(), attachment_sha256: att.content_sha256, base_package_sha256: bp.built.package_sha256 }));
  assert.strictEqual(X.AT.attachmentStatus(att, ap.approval, s2.ledger).status, 'APPROVED_FOR_EXECUTION');
  // approval is NOT production readiness
  assert.strictEqual(o2.readiness.production_ready_claim_allowed, false);
  assert.ok(o2.artifacts.evidence.claims.every((c) => c.status === 'EVIDENCE_REQUIRED'));
});
function fold1(s) { return PL.foldLedger(s.ledger); }

test('S10 scenario 27 adversarial minimal input: "Build me a full-production multi-tenant SaaS. Choose everything for me."', () => {
  const intent = 'Build me a full-production multi-tenant SaaS. Choose everything for me.';
  const s = H.session({ intent, recommendOnly: true });
  const o = H.analyze({ intent }, s.ledger);
  // NO_FAKE_USER_CONFIRMATION
  assert.ok(!s.ledger.entries.some((e) => e.to === 'USER_CONFIRMED' || e.to === 'USER_EDITED'));
  assert.ok(Object.values(PL.foldLedger(s.ledger)).every((v) => v.state !== 'USER_CONFIRMED'));
  // NO_SILENT_REQUIREMENT_OMISSION: every catalog item is either asked/recommended, conditional, or N/A with a basis
  const P = o.profile; const S = PL.foldLedger(s.ledger);
  C.ITEMS.forEach((it) => { const a = C.applicability(it, P, S); assert.ok(a.applicable === 'YES' || a.applicable === 'CONDITIONAL' || (a.applicable === 'NO' && a.basis), it.id); });
  assert.ok(o.artifacts.traceability.gaps.length >= 0);
  // NO_SILENT_STACK_SUBSTITUTION
  assert.strictEqual(o.artifacts.factory.silent_substitution, false);
  assert.strictEqual(o.artifacts.factory.recommendation_state, 'AI_RECOMMENDED_PENDING_APPROVAL');
  // NO_PREMATURE_PRODUCTION_READY / EXECUTION_APPROVAL
  assert.strictEqual(o.readiness.production_ready_claim_allowed, false);
  assert.strictEqual(o.artifacts.guardian.blocking, true);
  const att = X.AT.buildAttachment(o.ctx, o.artifacts, H.basePackage(baseLedger(BASE_VALUES)).built.package);
  assert.strictEqual(X.AT.approveAttachment(att, s.ledger, { actor_type: 'USER', actor_id: 'o', at: at(), attachment_sha256: att.content_sha256, base_package_sha256: 'x' }).error !== undefined, true);
  // critical unknowns are surfaced
  assert.ok(o.artifacts.guardian.counts.MISSING_CRITICAL_DECISIONS >= 5 && o.artifacts.guardian.counts.HUMAN_DECISIONS_REQUIRED >= 30);
  // every recommendation is explainable
  Object.keys(S).filter((k) => S[k].state === 'AI_RECOMMENDED_PENDING_APPROVAL').forEach((id) => assert.ok(X.D.explain(C.byId[id], P, S).why));
});

test('S10 scenario 28 change impact: SINGLE_TENANT -> MULTI_TENANT invalidates dependents, approval, evidence; stale items are re-asked, none silently kept', () => {
  const intent = 'full-production SaaS for one clinic group';
  const bl = baseLedger(BASE_VALUES); const baseStates = fold(bl); const bp = H.basePackage(bl);
  const s = H.session({ intent, baseStates, answers: { tenancy_model: 'SINGLE_TENANT' }, acceptRecommendations: true });
  const o = H.analyze({ intent, baseStates }, s.ledger);
  const att = X.AT.buildAttachment(o.ctx, o.artifacts, bp.built.package);
  const ap = must(X.AT.approveAttachment(att, s.ledger, { actor_type: 'USER', actor_id: 'owner', at: at(), attachment_sha256: att.content_sha256, base_package_sha256: bp.built.package_sha256 }));
  const impact = X.G.buildChangeImpact(Object.assign({ graph: o.artifacts.graph }, o.ctx), { item_id: 'tenancy_model', from_value: 'SINGLE_TENANT', to_value: 'MULTI_TENANT' });
  assert.ok(impact.directly_affected_decisions.length >= 1 && impact.invalidated_approvals.length >= 1);
  assert.ok(impact.directly_affected_decisions.indexOf('tenant_isolation') !== -1 || impact.newly_required_decisions.some((n) => n.item_id === 'tenant_isolation'), 'tenant questions appear');
  assert.ok(impact.stale_decisions.length >= 1, 'dependents become STALE');
  const changed = must(X.D.userChange(s.ledger, 'tenancy_model', 'MULTI_TENANT', 'founder', at())).ledger;
  const S2 = PL.foldLedger(changed);
  assert.strictEqual(S2.tenancy_model.value, 'MULTI_TENANT');
  const st = X.AT.attachmentStatus(att, ap.approval, changed);
  assert.strictEqual(st.status, 'SUPERSEDED'); assert.strictEqual(st.approval_valid, false);
  const o2 = H.analyze({ intent, baseStates }, changed);
  assert.notStrictEqual(o2.readiness.state, 'APPROVED_FOR_EXECUTION');
  assert.ok(o2.artifacts.threat.threats.some((t) => /^T-MT/.test(t.threat_id)), 'threat model updated');
  assert.strictEqual(o2.artifacts.guardian.blocking, true, 'unresolved tenant decisions block again');
  assert.strictEqual(o2.artifacts.adr.adrs.find((a) => a.decision_id === 'tenancy_model').supersedes !== null, true);
});

test('S10 scenario 29 failure semantics: duplicate webhook, payment ok + provisioning fail, provisioning ok + notification fail, duplicate job', () => {
  const intent = 'full-production SaaS subscription product for multiple clinics';
  const s = H.session({ intent, answers: { tenancy_model: 'MULTI_TENANT', billing_model: 'TIERED_SUBSCRIPTION' }, acceptRecommendations: true });
  const fs = H.analyze({ intent }, s.ledger).artifacts.failures;
  const ids = fs.scenarios.map((x) => x.scenario_id);
  ['F01', 'F02', 'F03', 'F04'].forEach((f) => assert.ok(ids.indexOf(f) !== -1, f));
  const text = JSON.stringify(fs);
  fs.property_vocabulary.forEach((k) => assert.ok(text.indexOf(k) !== -1, k));
  assert.ok(fs.scenarios.find((x) => x.scenario_id === 'F01').required_properties.indexOf('IDEMPOTENCY') !== -1);
  assert.ok(fs.scenarios.find((x) => x.scenario_id === 'F02').required_properties.indexOf('COMPENSATING_ACTION') !== -1 && fs.scenarios.find((x) => x.scenario_id === 'F02').reconciliation_required);
  fs.scenarios.forEach((x) => { assert.ok(x.required_properties.length); assert.ok(['SPECIFIED', 'UNRESOLVED', 'NOT_APPLICABLE_WITH_RATIONALE', 'AI_RECOMMENDED_PENDING_APPROVAL'].indexOf(x.requirement_state) !== -1, x.requirement_state); });
  assert.ok(!/VERIFIED|"PASS"/.test(text), 'defined, never claimed verified');
});

test('S10 scenario 30 AI-native SaaS: MODEL_AVAILABLE != EVALUATED != ADMITTED_FOR_TASK != AI_FEATURE_PRODUCTION_READY; no paid call, no automatic admission', () => {
  const intent = 'full-production AI-powered SaaS assistant for multiple clinics using an LLM';
  const s = H.session({ intent, answers: { tenancy_model: 'MULTI_TENANT', ai_native_scope: 'YES' }, acceptRecommendations: true });
  const o = H.analyze({ intent }, s.ledger);
  assert.ok(o.profile.activation.AI_PRODUCTION_PROFILE_V1);
  const ai = o.artifacts.ai;
  const ch = ai.model_status_chain;
  ['MODEL_AVAILABLE', 'MODEL_EVALUATED', 'MODEL_ADMITTED_FOR_TASK', 'AI_FEATURE_PRODUCTION_READY'].forEach((st) => assert.ok(st in ch, st));
  assert.strictEqual(ch.MODEL_EVALUATED, false); assert.strictEqual(ch.MODEL_ADMITTED_FOR_TASK, false); assert.strictEqual(ch.AI_FEATURE_PRODUCTION_READY, false);
  assert.strictEqual(ch.MODEL_AVAILABLE, 'NOT_ASSESSED_BY_PROMPT_MAKER');
  assert.ok(o.artifacts.threat.threats.some((t) => /^T-AI/.test(t.threat_id)));
  assert.ok(o.artifacts.evidence.claims.some((c) => /AI/.test(c.claim_id)));
  // fabricated admission (self-test / not real run / pending corpus) is refused
  const forged = H.analyze({ intent }, s.ledger, { admission: { status: 'ADMITTED_FOR_TASK', real_run: false, corpus_status: 'REVIEW_PENDING' } }).artifacts.ai;
  assert.strictEqual(forged.model_status_chain.MODEL_ADMITTED_FOR_TASK, false);
  assert.strictEqual(forged.model_status_chain.AI_FEATURE_PRODUCTION_READY, false);
});
