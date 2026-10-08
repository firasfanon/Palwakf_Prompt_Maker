'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { test } = require('./harness');
const { sha256Hex, canonicalize, sha256OfValue } = require('../../gfpi/canon');
const A = require('../../gfpi/artifacts');

const root = path.join(__dirname, '..', '..');
const nodeSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('S0 sha256 matches Node crypto on varied inputs', () => {
  const inputs = ['', 'abc', 'مرحبا بالعالم', '😀 emoji \u{1F600}', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'a\u0000b', 'é'.repeat(300)];
  inputs.forEach((s) => assert.strictEqual(sha256Hex(s), nodeSha(s), 'mismatch for len ' + s.length));
});
test('S0 sha256 known vector', () => {
  assert.strictEqual(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('S0 canonicalize sorts keys and rejects non-finite', () => {
  assert.strictEqual(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.strictEqual(sha256OfValue({ a: 1, b: 2 }), sha256OfValue({ b: 2, a: 1 }));
  assert.throws(() => canonicalize({ a: NaN }));
  assert.throws(() => canonicalize({ a: Infinity }));
});
function sample(type) {
  const spec = A.GFPI_ARTIFACT_TYPES[type];
  const fields = {};
  Object.keys(spec).forEach((k) => {
    const kind = spec[k];
    fields[k] = kind === 'string' ? 's' : kind === 'array' ? [] : kind === 'object' ? {} : kind === 'number' ? 1 : kind === 'boolean' ? true
      : kind === 'sha256' ? 'a'.repeat(64) : kind === 'string_or_null' ? null : kind.slice(5).split('|')[0];
  });
  return A.makeArtifact(type, { artifact_id: 'id-1', project_id: 'p-1', created_at: '2026-01-01T00:00:00Z', fields });
}
test('S0 every artifact type builds and validates', () => {
  Object.keys(A.GFPI_ARTIFACT_TYPES).forEach((t) => { const v = A.validateArtifact(sample(t)); assert.ok(v.valid, t + ': ' + v.errors.join(',')); });
  assert.strictEqual(Object.keys(A.GFPI_ARTIFACT_TYPES).length, 13);
});
test('S0 tampering is detected', () => {
  const a = sample('ExecutionPlanV1');
  a.phases = [{ x: 1 }];
  const v = A.validateArtifact(a);
  assert.ok(!v.valid && v.errors.some((e) => /content_sha256 mismatch/.test(e)));
});
test('S0 unexpected field, unknown type and bad version are rejected', () => {
  const a = sample('ProductSpecV1');
  assert.ok(!A.validateArtifact(Object.assign({}, a, { extra: 1 })).valid);
  assert.ok(!A.validateArtifact(Object.assign({}, a, { artifact_type: 'Nope' })).valid);
  const b = JSON.parse(JSON.stringify(a)); b.schema_version = '2.0'; b.content_sha256 = A.hashOfArtifact(b);
  assert.ok(!A.validateArtifact(b).valid);
});
test('S0 no second AcceptanceContractV1 / frozen names not redefined', () => {
  ['AcceptanceContractV1', 'DevelopmentContractV1', 'ProjectBlueprintV1', 'FACTORY_CONSUMER_SUBSET_V1', 'PROFILE_MAPPING_V1'].forEach((n) => assert.ok(!(n in A.GFPI_ARTIFACT_TYPES), n));
});
test('S0 generated JSON schemas have no drift', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'generateGfpiSchemas.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});
test('S0 frozen baseline files are byte-identical to base', () => {
  const r = cp.spawnSync(process.execPath, [path.join(root, 'tools', 'generateGfpiFrozenBaseline.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
});
test('S0 factory pins unchanged (mapping and schema SHA-256)', () => {
  const fx = path.join(root, 'tests', 'fixtures', 'factory-consumer');
  const h = (f) => nodeSha(fs.readFileSync(path.join(fx, f), 'latin1').toString()) ;
  const raw = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(fx, f))).digest('hex');
  assert.strictEqual(raw('profile-mapping-v1.json'), '74b71c798e1f73b41450cf8a5b93e2e7c1183f70bb7146f4f78377332c0fa5ec');
  assert.strictEqual(raw('consumer-subset-v1.schema.json'), 'c0ce0b73a1e8e80697216445c10e654fc2f0ea5cbc32cdc8617c6ebb681ca9cb');
  void h;
});
