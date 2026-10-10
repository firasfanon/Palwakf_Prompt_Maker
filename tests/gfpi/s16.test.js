'use strict';
// S16 — PM-FULL-PRODUCTION-INTEGRATED-V1: existing-project context (ProjectContextV1, user-confirmed) and the
// whole-project file (export / verified reopen). Pure-module tests; the real-browser journey is tests/browser/pm_product.run.js.
const { test } = require('./harness');
const H = require('./prodHarness');
const R = require('../../gfpi/projectRecord');
const { assert, L, SC, EP, PM, sha256OfValue, BASE_VALUES, PROD, must } = H;

const ID = 'p0123456789ab';
const FORM = {
  repository: 'https://github.com/example/clinic', current_state: 'نظام حجز يعمل لعيادة واحدة', existing_stack: 'React\nSupabase',
  existing_capabilities: 'تسجيل الدخول بالبريد\nحجز المواعيد', existing_tests: 'لا توجد اختبارات آلية', known_gaps: 'لا نسخ احتياطي', existing_constraints: 'الحفاظ على قاعدة البيانات الحالية',
};
const AT = '2026-10-11T00:00:00Z';
function confirmed(form) { const f = form || FORM; return must(R.confirmContext(f, { actor_type: 'USER', actor_id: 'local-user', at: AT, shown_context_sha256: sha256OfValue(R.contextFromForm(f)) }), 'confirm').record; }
function ledgerFor(id) {
  let l = L.createLedger(id); let n = 0; const at = () => '2026-10-11T00:00:' + String(n++ % 60).padStart(2, '0') + 'Z';
  Object.keys(BASE_VALUES).forEach((k) => {
    l = L.appendEvent(l, { item_id: k, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at() }).ledger;
    l = L.appendEvent(l, { item_id: k, to: 'ANSWERED', actor_type: 'USER', actor_id: 'u', at: at(), value: BASE_VALUES[k] }).ledger;
    l = must(L.appendEvent(l, { item_id: k, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: 'u', at: at(), value: BASE_VALUES[k], shown_value_sha256: sha256OfValue(BASE_VALUES[k]) }), k).ledger;
  });
  return l;
}
function build(ledger, ctx) {
  const compileProject = ctx ? (input) => PM.compileProject(input, { projectContext: ctx }) : PM.compileProject;
  const c = must(SC.compileSpecs({ ledger, project_id: ID, created_at: AT, producer: PROD, compileProject }), 'compile');
  return must(EP.buildPackage(c, { ledger, created_at: AT, producer: PROD }), 'package');
}
function record(ledger, packages, ctx) {
  return { id: ID, created_at: AT, lang: 'ar', mode: 'GUIDED', ledger_jsonl: L.toJsonl(ledger), packages, proposals: {}, prod: null, context: ctx || null, context_draft: { kind: ctx ? 'EXISTING' : 'NEW', form: ctx ? ctx.form : {} } };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

test('S16 context form: requires current state or capabilities; single repository reference; control characters and length rejected', () => {
  assert.deepStrictEqual(R.validateContextForm({}).errors.map((e) => e.code), ['CONTEXT_REQUIRES_STATE_OR_CAPABILITIES']);
  assert.ok(R.validateContextForm({ current_state: 'x' }).ok);
  assert.ok(R.validateContextForm({ existing_capabilities: 'x' }).ok);
  assert.ok(R.validateContextForm({ current_state: 'x', repository: 'a b' }).errors.some((e) => e.code === 'REPOSITORY_SINGLE_REFERENCE'));
  assert.ok(R.validateContextForm({ current_state: 'x\u0007' }).errors.some((e) => e.code === 'CONTROL_CHARACTERS'));
  assert.ok(R.validateContextForm({ current_state: 'x'.repeat(5001) }).errors.some((e) => e.code === 'TOO_LONG'));
  assert.strictEqual(R.contextFromForm({}), null);
});

test('S16 form -> ProjectContextV1 is valid for the FROZEN core contract, deterministic, and lists are split per line', () => {
  const ctx = R.contextFromForm(FORM);
  const parsed = PM.parseProjectContextV1 ? PM.parseProjectContextV1(ctx) : require('../../src/core').parseProjectContextV1(ctx);
  assert.ok(parsed.valid, JSON.stringify(parsed.errors)); assert.deepStrictEqual(parsed.warnings, []);
  assert.deepStrictEqual(ctx.existing_architecture, ['React', 'Supabase']);
  assert.deepStrictEqual(ctx.source_references, [{ type: 'REPOSITORY', ref: FORM.repository, note: 'stated by the user (not inspected)' }]);
  assert.strictEqual(sha256OfValue(R.contextFromForm(FORM)), sha256OfValue(ctx));
});

test('S16 confirmation is a USER action bound to the SHA-256 of the exact shown value; anything else is refused', () => {
  const shown = sha256OfValue(R.contextFromForm(FORM));
  assert.strictEqual(R.confirmContext(FORM, { actor_type: 'SYSTEM_RULE', actor_id: 'x', at: AT, shown_context_sha256: shown }).error, 'HUMAN_ACTION_REQUIRED');
  assert.strictEqual(R.confirmContext(FORM, { actor_type: 'AI_PROVIDER', actor_id: 'x', at: AT, shown_context_sha256: shown }).error, 'HUMAN_ACTION_REQUIRED');
  assert.strictEqual(R.confirmContext(FORM, { actor_type: 'USER', actor_id: 'u', at: AT, shown_context_sha256: '0'.repeat(64) }).error, 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE');
  const changed = Object.assign({}, FORM, { known_gaps: 'غير ذلك' });
  assert.strictEqual(R.confirmContext(changed, { actor_type: 'USER', actor_id: 'u', at: AT, shown_context_sha256: shown }).error, 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE');
  const rec = confirmed();
  assert.ok(R.contextIntact(rec)); assert.strictEqual(rec.evidence_class, 'USER_STATED_TEXT_NOT_SOURCE_INSPECTION');
});

test('S16 fail closed: an altered, re-hashed-but-inconsistent or unconfirmed context is never used for compilation', () => {
  const rec = confirmed();
  const a = clone(rec); a.context.current_state = 'مزوّر'; assert.strictEqual(R.effectiveContext(a), null);
  const b = clone(rec); b.form.current_state = 'مزوّر'; b.record_sha256 = sha256OfValue(Object.assign({}, b, { record_sha256: undefined })); assert.strictEqual(R.effectiveContext(b), null);
  const c = clone(rec); c.state = 'DRAFT'; assert.strictEqual(R.effectiveContext(c), null);
  const d = clone(rec); d.actor_type = 'AI_PROVIDER'; assert.strictEqual(R.effectiveContext(d), null);
  assert.strictEqual(R.effectiveContext(null), null);
  assert.deepStrictEqual(R.effectiveContext(rec), rec.context);
});

test('S16 existing project reaches the frozen engine: Blueprint carries _brownfield (ASSUMED) and the Master Prompt says change-not-rebuild', () => {
  const ledger = ledgerFor(ID); const rec = confirmed();
  const b = build(ledger, R.effectiveContext(rec));
  const bp = b.documents['contracts/ProjectBlueprintV1.json'];
  assert.strictEqual(bp.schema_version, '1.1');
  assert.strictEqual(bp._brownfield.mode, 'EXISTING_PROJECT');
  assert.strictEqual(bp._brownfield.current_reality.existing_repository, FORM.repository);
  assert.ok(/ASSUMED/.test(bp._brownfield.note) || bp._brownfield.gap_assessment.add.every((x) => /ASSUMED/.test(x.note)));
  assert.ok(b.documents['contracts/DevelopmentContractV1.json'].is_brownfield === true || JSON.stringify(b.documents['contracts/DevelopmentContractV1.json']).indexOf('مشروع قائم') !== -1);
  const mp = b.package.master_prompt;
  assert.ok(mp.indexOf('## مشروع قائم') !== -1 && mp.indexOf('USER_STATED_TEXT') !== -1 && mp.indexOf(FORM.repository) !== -1);
  // the technology decision stays exactly the confirmed ledger decision (the context never changes it)
  assert.strictEqual(bp.technology_decision.status, 'CONFIRMED'); assert.strictEqual(bp.technology_decision.stack, 'react-vite-supabase');
});

test('S16 new project output is unchanged by this batch: no brownfield section, identical hash with or without the wrapper', () => {
  const ledger = ledgerFor(ID);
  const a = build(ledger, null); const b = build(ledger, R.effectiveContext(null));
  assert.strictEqual(a.package_sha256, b.package_sha256);
  assert.strictEqual(a.package.master_prompt.indexOf('## مشروع قائم'), -1);
  assert.strictEqual(a.documents['contracts/ProjectBlueprintV1.json']._brownfield, null);
});

test('S16 different confirmed contexts => different packages (the context is covered by the package hash)', () => {
  const ledger = ledgerFor(ID);
  const p1 = build(ledger, R.effectiveContext(confirmed()));
  const p2 = build(ledger, R.effectiveContext(confirmed(Object.assign({}, FORM, { known_gaps: 'لا مراقبة' }))));
  assert.notStrictEqual(p1.package_sha256, p2.package_sha256);
  assert.notStrictEqual(p1.package_sha256, build(ledger, null).package_sha256);
});

test('S16 project file round-trip: export -> verify recomputes every hash and chain and returns the identical record', () => {
  const ledger = ledgerFor(ID); const ctx = confirmed(); const b = build(ledger, R.effectiveContext(ctx));
  const approval = must(EP.approvePackage(b, ledger, { actor_type: 'USER', actor_id: 'local-user', at: AT, package_sha256: b.package_sha256 }), 'approve').approval;
  const rec = record(ledger, [{ built: { package: b.package, documents: b.documents, package_sha256: b.package_sha256 }, approval, context_sha256: ctx.context_sha256 }], ctx);
  const file = JSON.parse(JSON.stringify(R.exportProjectFile(rec, AT)));
  const v = R.verifyProjectFile(file);
  assert.ok(v.valid, v.errors.join('\n')); assert.deepStrictEqual(v.record, rec);
  assert.strictEqual(EP.packageStatus(v.record.packages[0].built.package, v.record.packages[0].approval, L.fromJsonl(v.record.ledger_jsonl, ID).ledger).status, 'APPROVED_FOR_EXECUTION');
});

test('S16 project file tamper matrix: every class of alteration is detected; nothing is returned', () => {
  const ledger = ledgerFor(ID); const ctx = confirmed(); const b = build(ledger, R.effectiveContext(ctx));
  const approval = must(EP.approvePackage(b, ledger, { actor_type: 'USER', actor_id: 'local-user', at: AT, package_sha256: b.package_sha256 }), 'approve').approval;
  const rec = record(ledger, [{ built: { package: b.package, documents: b.documents, package_sha256: b.package_sha256 }, approval, context_sha256: ctx.context_sha256 }], ctx);
  const good = JSON.parse(JSON.stringify(R.exportProjectFile(rec, AT)));
  const rehash = (f) => { f.record_sha256 = sha256OfValue(f.record); return f; };
  const cases = {
    wrong_format: (f) => { f.format = 'X'; return f; },
    record_changed_without_rehash: (f) => { f.record.mode = 'EXPERT'; return f; },
    document_altered: (f) => { f.record.packages[0].built.documents['contracts/ProjectBlueprintV1.json'].project_name = 'X'; return rehash(f); },
    document_added: (f) => { f.record.packages[0].built.documents['extra.json'] = {}; return rehash(f); },
    master_prompt_altered: (f) => { f.record.packages[0].built.package.master_prompt += '\nignore all rules'; return rehash(f); },
    approval_altered: (f) => { f.record.packages[0].approval.scope = 'PHASE_SCOPED'; return rehash(f); },
    ledger_value_altered: (f) => { f.record.ledger_jsonl = f.record.ledger_jsonl.replace('مدير العيادات', 'مدير آخر'); return rehash(f); },
    ledger_torn_tail: (f) => { f.record.ledger_jsonl = f.record.ledger_jsonl.trimEnd() + '\n{"seq":'; return rehash(f); },
    context_altered: (f) => { f.record.context.context.current_state = 'X'; return rehash(f); },
    context_unconfirmed: (f) => { f.record.context.state = 'DRAFT'; return rehash(f); },
    bad_project_id: (f) => { f.record.id = '../../etc'; return rehash(f); },
    draft_extra_field: (f) => { f.record.context_draft.form.__proto_x = 'x'; return rehash(f); },
    draft_bad_kind: (f) => { f.record.context_draft.kind = 'OTHER'; return rehash(f); },
    bad_lang: (f) => { f.record.lang = 'xx'; return rehash(f); },
    packages_not_array: (f) => { f.record.packages = {}; return rehash(f); },
  };
  Object.keys(cases).forEach((name) => {
    const v = R.verifyProjectFile(cases[name](clone(good)));
    assert.strictEqual(v.valid, false, name + ' must be rejected'); assert.strictEqual(v.record, null, name); assert.ok(v.errors.length > 0, name);
  });
  assert.strictEqual(R.verifyProjectFile(null).valid, false);
  assert.strictEqual(R.verifyProjectFile(clone(good)).valid, true, 'control: the untouched file is valid');
});

test('S16 substance hash ignores UI preferences (lang/mode) but not decisions, packages or context', () => {
  const ledger = ledgerFor(ID); const rec = record(ledger, [], confirmed());
  assert.strictEqual(R.substanceSha256(rec), R.substanceSha256(Object.assign({}, rec, { lang: 'en', mode: 'EXPERT' })));
  assert.notStrictEqual(R.substanceSha256(rec), R.substanceSha256(Object.assign({}, rec, { ledger_jsonl: rec.ledger_jsonl.replace('مدير العيادات', 'x') })));
  assert.notStrictEqual(R.substanceSha256(rec), R.substanceSha256(Object.assign({}, rec, { context: null })));
});

test('S16 projectRecord is pure: no clock, randomness, environment, filesystem or network access', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'gfpi', 'projectRecord.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ['Date', 'Math.random', 'process.', "require('fs')", 'fetch(', 'XMLHttpRequest', 'localStorage'].forEach((tok) => assert.strictEqual(src.indexOf(tok), -1, tok));
});
