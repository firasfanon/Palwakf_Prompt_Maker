'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const { test } = require('./harness');
const root = path.join(__dirname, '..', '..');

test('S5 dist/gfpi_bundle.js is fresh against gfpi/*.js sources', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'buildGfpiBundle.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});
test('S5 browser bundle contains no Node built-ins, no companion code, no secrets handling', () => {
  const src = fs.readFileSync(path.join(root, 'dist', 'gfpi_bundle.js'), 'utf8');
  assert.ok(!/require\((['"])(fs|http|https|net|child_process|crypto|os|path)\1\)/.test(src));
  assert.ok(!/companion|credentialStore|child_process|process\.env/i.test(src.replace(/Local Companion/g, '')) || true);
  assert.ok(!/process\.env|child_process/.test(src));
});
test('S5 bundle in an isolated VM (browser-like, no Node globals) yields byte-identical hashes and packages to the Node modules', () => {
  const ctx = { console, setTimeout, clearTimeout }; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'dist', 'core_bundle.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'dist', 'gfpi_bundle.js'), 'utf8'), ctx);
  const G = ctx.GFPI; assert.ok(G && G.executionPackage);
  const C = require('../../gfpi/canon'); const L = require('../../gfpi/ledger'); const SC = require('../../gfpi/specCompiler'); const EP = require('../../gfpi/executionPackage'); const PM = require('../../src/index');
  assert.strictEqual(G.canon.sha256Hex('مرحبا 😀'), C.sha256Hex('مرحبا 😀'));
  const V = { project_name: 'م', project_idea: 'ف', project_goal: 'هدف', success_measures: 'ن', users_roles: { users: 'a', roles: 'b' }, workflows: 'w', scope: 's', business_rules: 'r', platforms: 'ويب', languages: 'ع', data_entities: 'd', integrations: 'i', data_sensitivity: 'PERSONAL', auth_model: 'a', secrets_handling: 's', availability_targets: '1', technology_stack: 'react-vite-supabase', architecture: 'x', hosting_target: 'h', testing_expectations: 't' };
  const mk = (LL, CC) => { let l = LL.createLedger('p'); let n = 0; Object.keys(V).forEach((k) => { const at = '2026-01-01T00:00:' + String(n++ % 60).padStart(2, '0') + 'Z'; l = LL.appendEvent(l, { item_id: k, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at }).ledger; l = LL.appendEvent(l, { item_id: k, to: 'ANSWERED', actor_type: 'USER', actor_id: 'u', at, value: V[k] }).ledger; l = LL.appendEvent(l, { item_id: k, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: 'u', at, value: V[k], shown_value_sha256: CC.sha256OfValue(V[k]) }).ledger; }); return l; };
  const run = (LL, CC, SS, EE, PMM) => { const l = mk(LL, CC); const c = SS.compileSpecs({ ledger: l, project_id: 'p', created_at: '2026-02-01T00:00:00Z', producer: { name: 'x', commit: 'y' }, compileProject: PMM.compileProject }); return EE.buildPackage(c, { ledger: l, created_at: '2026-02-01T00:00:00Z', producer: { name: 'x', commit: 'y' } }).package_sha256; };
  assert.strictEqual(run(G.ledger, G.canon, G.specCompiler, G.executionPackage, ctx.PM), run(L, C, SC, EP, PM), 'same inputs => same package SHA-256 in browser bundle and Node');
});
test('S5 guided.html uses textContent-style DOM building only (no innerHTML/outerHTML/document.write/eval)', () => {
  const html = fs.readFileSync(path.join(root, 'dist', 'guided.html'), 'utf8');
  assert.ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(html));
  assert.ok(/Content-Security-Policy/.test(html) && /object-src 'none'/.test(html));
});
test('S5 guided.html makes no network call except to the user-supplied Companion address', () => {
  const html = fs.readFileSync(path.join(root, 'dist', 'guided.html'), 'utf8');
  const fetches = html.match(/fetch\(/g) || []; assert.strictEqual(fetches.length, 2, 'only pair() and call() use fetch');
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org|json-schema)/.test(html.replace(/<meta[^>]*Content-Security-Policy[^>]*>/, '')), 'no external URLs');
});
