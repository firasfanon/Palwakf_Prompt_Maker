'use strict';
// S11 — production bundle (browser) parity, conflict rules, UI-integration guards.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const { test } = require('./harness');
const H = require('./prodHarness');
const { X, assert, at, BASE_VALUES, baseLedger } = H;
const root = path.join(__dirname, '..', '..');

test('S11 dist/gfpi_production_bundle.js is fresh against gfpi/production sources', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'buildGfpiProductionBundle.js'), '--check'], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
test('S11 frozen bundle is untouched by the production bundle (separate file, frozen file still fresh)', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'buildGfpiBundle.js'), '--check'], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/production/.test(fs.readFileSync(path.join(root, 'dist', 'gfpi_bundle.js'), 'utf8').split('\n').slice(0, 5).join('\n')));
});
test('S11 production bundle in an isolated browser-like VM yields identical artifact hashes to the Node modules', () => {
  const ctx = {}; vm.createContext(ctx); ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'dist', 'gfpi_bundle.js'), 'utf8'), ctx); vm.runInContext(fs.readFileSync(path.join(root, 'dist', 'gfpi_production_bundle.js'), 'utf8'), ctx);
  const B = ctx.GFPI_PRODUCTION; assert.ok(B && B.analyze && B.AT && B.D);
  const bl = baseLedger(BASE_VALUES); const baseStates = H.L.foldLedger(bl); const intent = 'full-production SaaS for clinics';
  const s = H.session({ intent, baseStates, answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  const args = { project_id: 'p1', created_at: '2026-03-02T00:00:00Z', intent, ledger: s.ledger, baseStates, producer: H.PROD };
  const a = X.analyze(args); const b = B.analyze(JSON.parse(JSON.stringify(args)));
  Object.keys(a.artifacts).forEach((k) => assert.strictEqual(b.artifacts[k].content_sha256, a.artifacts[k].content_sha256, k));
  assert.strictEqual(b.readiness.state, a.readiness.state);
});
test('S11 production bundle has no Node built-ins, no network, no storage, no clock', () => {
  const src = fs.readFileSync(path.join(root, 'dist', 'gfpi_production_bundle.js'), 'utf8');
  assert.ok(!/require\(['"](fs|http|https|net|child_process|os|path)['"]\)|process\.env|fetch\(|XMLHttpRequest|localStorage|Date\.now|new Date\(|Math\.random/.test(src));
});
test('S11 conflict rules: confirmed-vs-confirmed blocks; pending side is advisory; resolved by changing one decision', () => {
  const intent = 'full-production SaaS';
  const conf = (id, v) => ({ state: 'USER_CONFIRMED', value: v }); const pend = (id, v) => ({ state: 'AI_RECOMMENDED_PENDING_APPROVAL', value: v });
  let c = X.CF.detect({ nfr_data_loss_rpo: conf('x', 'MINUTES_UP_TO_5'), backup_policy: conf('x', 'DAILY_AUTOMATED') });
  assert.strictEqual(c.length, 1); assert.strictEqual(c[0].blocking, true); assert.strictEqual(c[0].rule_id, 'C1_RPO_VS_BACKUP');
  c = X.CF.detect({ nfr_data_loss_rpo: conf('x', 'MINUTES_UP_TO_5'), backup_policy: pend('x', 'DAILY_AUTOMATED') }); assert.strictEqual(c[0].blocking, false);
  assert.deepStrictEqual(X.CF.detect({ nfr_data_loss_rpo: conf('x', 'MINUTES_UP_TO_5'), backup_policy: conf('x', 'DAILY_AUTOMATED_PLUS_PITR') }), []);
  assert.strictEqual(X.CF.RULES.length, 6);
  // end-to-end: the guardian blocks on a confirmed conflict and clears when one side changes
  const bl = baseLedger(BASE_VALUES); const baseStates = H.L.foldLedger(bl);
  const s = H.session({ intent, baseStates, answers: { tenancy_model: 'MULTI_TENANT', nfr_data_loss_rpo: 'MINUTES_UP_TO_5', backup_policy: 'DAILY_AUTOMATED' }, acceptRecommendations: true });
  let o = H.analyze({ intent, baseStates }, s.ledger); assert.ok(o.conflicts.some((x) => x.rule_id === 'C1_RPO_VS_BACKUP'));
  assert.ok(o.artifacts.guardian.findings.some((f) => f.code === 'DECISION_CONFLICT' && f.blocking)); assert.strictEqual(o.artifacts.guardian.blocking, true);
  const fixed = H.must(X.D.userChange(s.ledger, 'backup_policy', 'DAILY_AUTOMATED_PLUS_PITR', 'founder', at())).ledger;
  o = H.analyze({ intent, baseStates }, fixed); assert.deepStrictEqual(o.conflicts, []); assert.ok(!o.artifacts.guardian.findings.some((f) => f.code === 'DECISION_CONFLICT')); // dependents of the changed decision are STALE and still block until the human re-confirms them
});
test('S11 default recommendations never conflict with each other (system does not manufacture conflicts)', () => {
  const s = H.session({ intent: 'full-production SaaS for clinics', answers: { tenancy_model: 'MULTI_TENANT' }, acceptRecommendations: true });
  assert.deepStrictEqual(H.analyze({ intent: 'full-production SaaS for clinics' }, s.ledger).conflicts, []);
});
test('S11 guided.html loads the production bundle after the frozen bundle, keeps CSP and uses no innerHTML for the new tab', () => {
  const html = fs.readFileSync(path.join(root, 'dist', 'guided.html'), 'utf8');
  assert.ok(html.indexOf('gfpi_bundle.js') < html.indexOf('gfpi_production_bundle.js'));
  assert.ok(/id="panelProduction"/.test(html) && !/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(/.test(html));
});
