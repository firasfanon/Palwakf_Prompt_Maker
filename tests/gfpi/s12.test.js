'use strict';
// S12 — final-review repairs (D1: attachment forgery with recomputed hash / self-made approval).
const { test } = require('./harness');
const H = require('./prodHarness');
const { X, assert, must, at, BASE_VALUES, baseLedger } = H;
const { sha256OfValue } = require('../../gfpi/canon');
const intent = 'full-production SaaS for multiple clinics';
function ctx() {
  const bl = baseLedger(BASE_VALUES); const baseStates = H.L.foldLedger(bl); const bp = H.basePackage(bl);
  const blocked = H.session({ intent, baseStates, answers: { tenancy_model: 'MULTI_TENANT' } }); const ob = H.analyze({ intent, baseStates }, blocked.ledger);
  const good = H.session({ intent, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true }); const og = H.analyze({ intent, baseStates }, good.ledger);
  return { bp, blocked, ob, good, og };
}
const req = (att, bp, extra) => Object.assign({ actor_type: 'USER', actor_id: 'o', at: at(), attachment_sha256: att.content_sha256, base_package_sha256: bp.built.package_sha256 }, extra || {});
const rehash = (a) => { const c = Object.assign({}, a); delete c.content_sha256; c.content_sha256 = sha256OfValue(c); return c; };

test('S12 forged attachment (verdict+blockers edited, hash recomputed) is refused when current artifacts are supplied', () => {
  const k = ctx(); const att = X.AT.buildAttachment(k.ob.ctx, k.ob.artifacts, k.bp.built.package);
  const forged = rehash(Object.assign({}, att, { guardian_verdict: 'CLEAR_FOR_ENGINEERING_REVIEW', unresolved_blockers: [] }));
  assert.ok(X.K.verifyProdArtifact(forged), 'forgery is self-consistent by hash');
  assert.strictEqual(X.AT.approveAttachment(forged, k.blocked.ledger, req(forged, k.bp, { current_artifacts: k.ob.artifacts })).error, 'ATTACHMENT_CONTENT_MISMATCH');
  assert.strictEqual(X.AT.attachmentStatus(forged, null, k.blocked.ledger, k.ob.artifacts).status, 'EXECUTION_BLOCKED');
});
test('S12 self-made approval records are never honoured: non-USER actor, wrong bindings, blocked attachment', () => {
  const k = ctx(); const att = X.AT.buildAttachment(k.og.ctx, k.og.artifacts, k.bp.built.package);
  const ap = must(X.AT.approveAttachment(att, k.good.ledger, req(att, k.bp, { current_artifacts: k.og.artifacts }))).approval;
  assert.strictEqual(X.AT.attachmentStatus(att, ap, k.good.ledger, k.og.artifacts).status, 'APPROVED_FOR_EXECUTION');
  const mk = (patch) => { const c = Object.assign({}, ap, patch); delete c.approval_sha256; c.approval_sha256 = sha256OfValue(c); return c; };
  assert.notStrictEqual(X.AT.attachmentStatus(att, mk({ actor_type: 'AI' }), k.good.ledger, k.og.artifacts).status, 'APPROVED_FOR_EXECUTION');
  assert.notStrictEqual(X.AT.attachmentStatus(att, mk({ base_package_sha256: 'x' }), k.good.ledger, k.og.artifacts).status, 'APPROVED_FOR_EXECUTION');
  assert.notStrictEqual(X.AT.attachmentStatus(att, mk({ production_ledger_head_sha256: 'x' }), k.good.ledger, k.og.artifacts).status, 'APPROVED_FOR_EXECUTION');
  const batt = X.AT.buildAttachment(k.ob.ctx, k.ob.artifacts, k.bp.built.package);
  const self = Object.assign({}, ap, { attachment_sha256: batt.content_sha256, production_ledger_head_sha256: batt.production_ledger_head_sha256, base_package_sha256: batt.base_package_sha256 }); delete self.approval_sha256; self.approval_sha256 = sha256OfValue(self);
  assert.notStrictEqual(X.AT.attachmentStatus(batt, self, k.blocked.ledger, k.ob.artifacts).status, 'APPROVED_FOR_EXECUTION');
  assert.notStrictEqual(X.AT.attachmentStatus(batt, self, k.blocked.ledger).status, 'APPROVED_FOR_EXECUTION', 'even without artifacts a blocked attachment cannot be APPROVED');
});
test('S12 legitimate flow unchanged: approval honoured with current artifacts, superseded after a decision change', () => {
  const k = ctx(); const att = X.AT.buildAttachment(k.og.ctx, k.og.artifacts, k.bp.built.package);
  const ap = must(X.AT.approveAttachment(att, k.good.ledger, req(att, k.bp, { current_artifacts: k.og.artifacts }))).approval;
  const changed = must(X.D.userChange(k.good.ledger, 'tenancy_model', 'SINGLE_TENANT', 'o', at())).ledger;
  assert.strictEqual(X.AT.attachmentStatus(att, ap, changed, k.og.artifacts).status, 'SUPERSEDED');
});

test('S12 local-approval disclosure exists in both languages in the UI and in the documentation (pre-merge hardening A)', () => {
  const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'dist', 'guided.html'), 'utf8');
  const AR = 'هذه موافقة محلية غير موثقة بهوية خادمية، تخص اعتماد المواصفة فقط، ولا تفوض أي عملية خارجية أو نشرًا إنتاجيًا.';
  const EN = 'This is a local approval without server-side identity. It covers specification approval only and does not authorize any external operation or production deployment.';
  assert.ok(html.indexOf(AR) !== -1 && html.indexOf(EN) !== -1);
  ['pkg-local-disclosure', 'pexec-local-disclosure', 'patt-local-disclosure'].forEach((id) => assert.ok(html.indexOf(id) !== -1, id));
  ['docs/GFPI_V1.md', 'docs/GFPI_V1_FULL_PRODUCTION.md'].forEach((f) => { const d = fs.readFileSync(path.join(root, f), 'utf8'); assert.ok(d.indexOf(AR) !== -1 && d.indexOf(EN) !== -1, f); });
});

test('S12 CI workflow is pinned, least-privilege, secret-free and targets pull requests into main only (pre-merge hardening B)', () => {
  const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..', '..');
  const y = fs.readFileSync(path.join(root, '.github', 'workflows', 'gfpi-premerge.yml'), 'utf8');
  assert.ok(/pull_request:\s*\n\s*branches: \[main\]/.test(y)); assert.ok(!/pull_request_target|workflow_run/.test(y), 'no privileged triggers');
  assert.ok(/permissions:\s*\n\s*contents: read/.test(y)); assert.ok(!/secrets\.|write-all|contents: write|id-token/.test(y), 'no secrets or write scopes');
  const uses = y.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l)); assert.ok(uses.length >= 3);
  uses.forEach((l) => assert.ok(/@[0-9a-f]{40}\b/.test(l), 'action must be pinned to a full commit SHA: ' + l));
  assert.ok(/NODE_VERSION: "22\.22\.0"/.test(y));
  ['secretScan.js', 'generateGfpiFrozenBaseline.js --check', 'generateFactoryConsumerFixtures.js --check', 'buildGfpiBundle.js --check', 'buildGfpiProductionBundle.js --check', 'tests/run.js', 'tests/gfpi/run.js', 'tests/browser/run.js', 'tests/browser/gfpi.run.js', 'tests/browser/gfpi_production.run.js'].forEach((c) => assert.ok(y.indexOf(c) !== -1, c));
  assert.ok(/NOT_RUN in CI[^\n]*Factory consumer UAT/.test(y), 'absent Factory UAT is documented, not counted as PASS');
});
