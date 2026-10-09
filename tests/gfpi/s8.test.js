'use strict';
const assert = require('assert');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { test } = require('./harness');
const root = path.join(__dirname, '..', '..');

test('S8 secret scan over tracked files is clean', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'secretScan.js')], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr);
});
test('S8 secret scan actually detects a planted credential (not vacuous)', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ss-')); cp.spawnSync('git', ['init', '-q'], { cwd: tmp });
  fs.mkdirSync(path.join(tmp, 'tools')); fs.copyFileSync(path.join(root, 'tools', 'secretScan.js'), path.join(tmp, 'tools', 'secretScan.js'));
  fs.writeFileSync(path.join(tmp, 'x.js'), "const k = 'sk-" + 'Z'.repeat(30) + "';\n"); cp.spawnSync('git', ['add', '-A'], { cwd: tmp });
  const r = cp.spawnSync(process.execPath, [path.join(tmp, 'tools', 'secretScan.js')], { encoding: 'utf8' }); assert.strictEqual(r.status, 1); assert.ok(/OPENAI_STYLE_KEY/.test(r.stderr));
});
test('S8 no GFPI production code reads or writes a credential into files, logs or exports', () => {
  const src = ['gfpi/executionPackage.js', 'gfpi/ledger.js', 'gfpi/specCompiler.js', 'dist/guided.html'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  assert.ok(!/localStorage\.setItem\([^)]*(token|secret|apikey|api_key)/i.test(src)); assert.ok(!/process\.env/.test(src));
});
test('S8 frozen core: bundle hash and tracked frozen files unchanged', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'generateGfpiFrozenBaseline.js'), '--check'], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/BUNDLE_SOURCE_HASH=f83b81e7/.test(fs.readFileSync(path.join(root, 'dist', 'core_bundle.js'), 'utf8')));
});
test('S8 additive scope: only whitelisted paths changed relative to the verified base', () => {
  const base = 'db18a5591d5dfa58f5e3ef7662856e01d913ce38';
  const have = cp.spawnSync('git', ['cat-file', '-t', base], { cwd: root, encoding: 'utf8' }); if (have.status !== 0) return; // base object unavailable in an exported tree
  const files = cp.spawnSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const allowed = /^(gfpi\/|companion\/|eval\/|tools\/|schemas\/gfpi\/|tests\/gfpi\/|tests\/browser\/gfpi\.run\.js|dist\/guided\.html|dist\/gfpi_bundle\.js|dist\/gfpi_production_bundle\.js|tests\/browser\/gfpi_production\.run\.js|docs\/|\.github\/workflows\/gfpi-premerge\.yml$|CHANGELOG\.md|README\.md|package\.json|evidence\/)/;
  const frozen = files.filter((f) => !allowed.test(f)); assert.deepStrictEqual(frozen, [], 'unexpected changed files: ' + frozen.join());
  ['src/', 'dist/core_bundle.js', 'dist/prompt-maker-app.html', 'tests/run.js', 'tests/browser/run.js', 'tests/fixtures/'].forEach((p) => assert.ok(!files.some((f) => f.indexOf(p) === 0), p + ' must not change'));
});
