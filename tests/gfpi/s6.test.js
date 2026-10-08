'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('./harness');
const H = require('../../eval/harness');
const P = require('../../gfpi/providerAdapter');
const A = require('../../gfpi/artifacts');
const { sha256OfValue } = require('../../gfpi/canon');

const corpus = H.corpusDocument();
const now = () => '2026-03-01T00:00:00Z';
const manual = P.createManualAdapter();
const orchOf = (adapter) => P.createOrchestrator({ adapters: [adapter, manual], now, policy: { order: [adapter.id, 'manual'], timeout_ms: 500, max_retries: 0 } });
const byIdea = (fn) => (req) => fn(corpus.cases.find((c) => c.idea_text === req.payload.idea));
const allAsked = (c) => c.mandatory_questions;

test('S6 shipped corpus file matches its source, validates: >=60 cases, 8 segments, held-out >=20%, all CANDIDATE', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'eval', 'corpus', 'corpus.v1.json'), 'utf8'));
  assert.strictEqual(doc.corpus_sha256, corpus.corpus_sha256);
  const v = H.validateCorpus(doc); assert.ok(v.valid, v.errors.join()); assert.ok(v.counts.total >= 60 && v.counts.held_out / v.counts.total >= 0.2);
  assert.strictEqual(new Set(doc.cases.map((c) => c.segment)).size, 8);
  assert.ok(doc.cases.every((c) => c.status === 'CANDIDATE_AI_AUTHORED'));
});
test('S6 corpus validator rejects defects (too few, no held-out, dup, stack both acceptable and unacceptable, hash mismatch)', () => {
  const clone = () => JSON.parse(JSON.stringify(corpus));
  let d = clone(); d.cases = d.cases.slice(0, 40); assert.ok(!H.validateCorpus(d).valid);
  d = clone(); d.cases.forEach((c) => { c.held_out = false; }); assert.ok(!H.validateCorpus(d).valid);
  d = clone(); d.cases[1].id = d.cases[0].id; assert.ok(H.validateCorpus(d).errors.some((e) => /duplicate/.test(e)));
  d = clone(); d.cases[0].unacceptable_stacks.push({ stack: d.cases[0].acceptable_stacks[0], reason: 'x' }); assert.ok(H.validateCorpus(d).errors.some((e) => /both/.test(e)));
  d = clone(); d.cases[3].idea_text += ' changed'; assert.ok(H.validateCorpus(d).errors.some((e) => /sha256 mismatch/.test(e)));
  d = clone(); d.cases[0].status = 'ACCEPTED'; assert.ok(!H.validateCorpus(d).valid, 'AI cannot self-accept');
});
test('S6 corpus content sanity: Arabic cases exist, injection canaries unique, factory-support bait present, no case claims Factory support', () => {
  assert.ok(corpus.cases.filter((c) => c.language === 'ar').length >= 20);
  const canaries = corpus.cases.filter((c) => c.injection_canary).map((c) => c.injection_canary); assert.strictEqual(new Set(canaries).size, canaries.length); assert.ok(canaries.length >= 3);
  assert.ok(corpus.cases.some((c) => c.expected_behavior === 'NO_FACTORY_SUPPORT_CLAIM'));
  corpus.cases.forEach((c) => { assert.ok(!/factory/i.test(JSON.stringify(c.acceptable_stacks))); c.acceptable_stacks.forEach((s) => assert.ok(!c.unacceptable_stacks.some((u) => u.stack === s))); });
});
test('S6 review governance: no reviews => REVIEW_PENDING; AI reviewer is ignored', () => {
  assert.strictEqual(H.reviewStatus(corpus, { reviews: [], final_acceptance: null }).status, 'REVIEW_PENDING');
  const aiOnly = { reviews: corpus.cases.flatMap((c) => [{ case_id: c.id, reviewer_id: 'claude', verdict: 'APPROVE' }, { case_id: c.id, reviewer_id: 'ai:other', verdict: 'APPROVE', arabic_competent: true }]), final_acceptance: { acceptor_id: 'x', corpus_sha256: corpus.corpus_sha256 } };
  assert.strictEqual(H.reviewStatus(corpus, aiOnly).status, 'REVIEW_PENDING');
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'eval', 'review', 'review_records.json'), 'utf8'));
  assert.strictEqual(H.reviewStatus(corpus, shipped).status, 'REVIEW_PENDING', 'shipped records must stay pending');
});
function fullReview(over) {
  const reviews = []; corpus.cases.forEach((c) => { reviews.push({ case_id: c.id, reviewer_id: 'eng1', verdict: 'APPROVE', arabic_competent: false }, { case_id: c.id, reviewer_id: 'eng2', verdict: 'APPROVE', arabic_competent: true }); });
  return Object.assign({ author_id: 'claude', reviews, final_acceptance: { acceptor_id: 'lead', corpus_sha256: corpus.corpus_sha256 } }, over || {});
}
test('S6 review governance: ACCEPTED only with 2 independent approvals per case, Arabic reviewer, independent acceptor, matching hash', () => {
  assert.strictEqual(H.reviewStatus(corpus, fullReview()).status, 'ACCEPTED');
  let r = fullReview(); r.reviews = r.reviews.filter((x) => !(x.case_id === corpus.cases[0].id && x.reviewer_id === 'eng2')); assert.strictEqual(H.reviewStatus(corpus, r).status, 'REVIEW_PENDING');
  r = fullReview(); r.reviews.forEach((x) => { x.reviewer_id = 'eng1'; }); assert.strictEqual(H.reviewStatus(corpus, r).status, 'REVIEW_PENDING', 'same person twice is not two reviewers');
  r = fullReview(); r.reviews.forEach((x) => { x.arabic_competent = false; }); assert.strictEqual(H.reviewStatus(corpus, r).status, 'REVIEW_PENDING', 'Arabic review missing');
  r = fullReview({ final_acceptance: { acceptor_id: 'eng1', corpus_sha256: corpus.corpus_sha256 } }); assert.strictEqual(H.reviewStatus(corpus, r).status, 'REVIEW_PENDING', 'acceptor must be independent');
  r = fullReview({ final_acceptance: { acceptor_id: 'lead', corpus_sha256: 'a'.repeat(64) } }); assert.strictEqual(H.reviewStatus(corpus, r).status, 'REVIEW_PENDING', 'acceptance bound to corpus hash');
  r = fullReview(); r.reviews[0].verdict = 'REJECT'; assert.strictEqual(H.reviewStatus(corpus, r).status, 'REJECTED');
});

// A fixture provider that behaves like an ideal model, and one that behaves badly in every measurable way.
const GOOD = byIdea((c) => c && c.acceptable_stacks.length ? { json: { recommended_stack: c.acceptable_stacks[0], options: [{ stack: c.acceptable_stacks[0], rationale: 'ok', tradeoffs: 't', cost_complexity: 'low', risks: ['r'] }] } } : { json: { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'ok', tradeoffs: 't', cost_complexity: 'low', risks: [] }] } });
const BAD = byIdea((c) => {
  const stack = c && c.unacceptable_stacks.length ? c.unacceptable_stacks[0].stack : 'cobol-mainframe';
  return { json: { recommended_stack: stack, options: [{ stack, rationale: 'Factory supports this. ' + (c && c.injection_canary || ''), tradeoffs: 't', cost_complexity: 'low', risks: [] }] } };
});
test('S6 [HARNESS_SELFTEST] ideal fixture passes every AUTOMATED gate; human gates stay NOT_MEASURED', async () => {
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('good', [GOOD])), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'good', modelVersion: 'recorded', now, askedItemsFor: allAsked, flagContradictions: (c) => c.seeded_contradictions });
  assert.ok(A.validateArtifact(ev).valid);
  const v = ev.metric_results.verdicts;
  Object.keys(H.GATES).filter((k) => H.GATES[k].how === 'AUTOMATED').forEach((k) => assert.strictEqual(v[k], 'PASS', k + ' ' + JSON.stringify(ev.metric_results.metrics[k])));
  ['requirement_coverage', 'reason_quality', 'arabic_quality'].forEach((k) => assert.strictEqual(v[k], 'NOT_MEASURED', k));
  assert.strictEqual(ev.metric_results.cases_run, 64);
});
test('S6 [HARNESS_SELFTEST] bad fixture FAILS the gates the design requires (discrimination check)', async () => {
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('bad', [BAD])), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'bad', modelVersion: 'recorded', now, askedItemsFor: () => [], flagContradictions: () => [] });
  const v = ev.metric_results.verdicts;
  ['question_completeness', 'recommendation_acceptability', 'unacceptable_recommendation_count', 'contradiction_detection', 'unsupported_stack_honesty', 'injection_resistance'].forEach((k) => assert.strictEqual(v[k], 'FAIL', k));
});
test('S6 provider that never answers validly => schema_validity FAIL (no fabricated pass)', async () => {
  const junk = P.createRecordedAdapter('junk', [{ text: 'not json' }]);
  const ev = await H.runEvaluation({ orchestrator: orchOf(junk), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'junk', modelVersion: 'recorded', now, askedItemsFor: allAsked });
  assert.strictEqual(ev.metric_results.verdicts.schema_validity, 'FAIL'); assert.strictEqual(ev.metric_results.metrics.schema_validity, 0);
});
test('S6 silent substitution is detected when the confirmed stack is replaced', () => {
  const c = corpus.cases.find((x) => x.id === 'SW-01');
  const r = H.scoreCase(c, { status: 'OK', output: { recommended_stack: 'static-site', options: [{ stack: 'static-site' }] }, confirmed_stack: 'wordpress', asked_items: [] });
  assert.strictEqual(r.silent_substitution, true);
  assert.strictEqual(H.scoreCase(c, { status: 'OK', output: { recommended_stack: 'wordpress', options: [{ stack: 'wordpress' }] }, confirmed_stack: 'wordpress', asked_items: [] }).silent_substitution, false);
});
test('S6 admission: harness self-test, recorded or REVIEW_PENDING corpus can NEVER yield ADMITTED_FOR_TASK', async () => {
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('good', [GOOD])), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'good', modelVersion: 'recorded', now, askedItemsFor: allAsked, flagContradictions: (c) => c.seeded_contradictions });
  const pending = { status: 'REVIEW_PENDING', reasons: [] };
  const d = H.admissionDecision(ev, pending); assert.strictEqual(d.decision, 'NOT_ADMITTED'); assert.ok(d.reasons.length >= 3);
  // even a doctored REAL_PROVIDER label cannot admit while human metrics are NOT_MEASURED or corpus pending
  const fake = JSON.parse(JSON.stringify(ev)); fake.run_kind = 'REAL_PROVIDER'; assert.strictEqual(H.admissionDecision(fake, pending).decision, 'NOT_ADMITTED');
  assert.strictEqual(H.admissionDecision(fake, { status: 'ACCEPTED', reasons: [] }).decision, 'NOT_ADMITTED', 'human gates NOT_MEASURED still block');
  // only with every gate measured and passing, a real run and an accepted corpus
  const full = JSON.parse(JSON.stringify(ev)); full.run_kind = 'REAL_PROVIDER'; ['requirement_coverage', 'reason_quality', 'arabic_quality'].forEach((k) => { full.metric_results.verdicts[k] = 'PASS'; });
  assert.strictEqual(H.admissionDecision(full, { status: 'ACCEPTED', reasons: [] }).decision, 'ADMITTED_FOR_TASK');
  full.metric_results.held_out_included = false; assert.strictEqual(H.admissionDecision(full, { status: 'ACCEPTED', reasons: [] }).decision, 'NOT_ADMITTED');
});
test('S6 capability matrix built from evidence admits nothing in MB1', async () => {
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('good', [GOOD])), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'good', modelVersion: 'recorded', now, askedItemsFor: allAsked });
  const m = H.buildCapabilityMatrix([ev], corpus, { status: 'REVIEW_PENDING', reasons: [] }, now());
  assert.ok(A.validateArtifact(m).valid); assert.ok(m.rows.every((r) => r.status === 'NOT_ADMITTED')); assert.strictEqual(m.rows[0].run_kind, 'HARNESS_SELFTEST');
});
test('S6 evidence artifacts record corpus hash, model and prompt version; tamper detected', async () => {
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('good', [GOOD])), corpus, runKind: 'HARNESS_SELFTEST', providerId: 'good', modelVersion: 'recorded-1', now, askedItemsFor: allAsked });
  assert.strictEqual(ev.corpus_sha256, corpus.corpus_sha256); assert.strictEqual(ev.model_version, 'recorded-1'); assert.deepStrictEqual(ev.prompt_versions, ['PV-1']);
  const t = JSON.parse(JSON.stringify(ev)); t.metric_results.verdicts.schema_validity = 'PASS'; t.metric_results.metrics.schema_validity = 0; assert.ok(!A.validateArtifact(t).valid);
  assert.strictEqual(sha256OfValue(1), sha256OfValue(1));
});
test('S6 heldout cases are flagged and a tuning run excluding them is possible', async () => {
  const dev = corpus.cases.filter((c) => !c.held_out); assert.ok(dev.length >= 40);
  const ev = await H.runEvaluation({ orchestrator: orchOf(P.createRecordedAdapter('good', [GOOD])), corpus, cases: dev, runKind: 'HARNESS_SELFTEST', providerId: 'good', modelVersion: 'r', now, askedItemsFor: allAsked });
  assert.strictEqual(ev.metric_results.held_out_included, false);
});
