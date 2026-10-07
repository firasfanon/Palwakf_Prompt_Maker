#!/usr/bin/env node
'use strict';
/**
 * Generates the frozen FACTORY_CONSUMER_SUBSET_V1 fixtures from the REAL compiler, then writes
 * tests/fixtures/factory-consumer/manifest.json with SHA-256 digests.
 *
 *   node tools/generateFactoryConsumerFixtures.js          # write
 *   node tools/generateFactoryConsumerFixtures.js --check  # exit 1 if committed files differ
 *
 * Hash basis: SHA-256 of the file bytes with CRLF normalized to LF (so a Windows checkout with
 * core.autocrlf cannot silently change a digest). FNV is never used as integrity evidence.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compileProject, extractFactoryConsumerSubset } = require('../src/index');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'factory-consumer');
const PRODUCER_REPOSITORY = 'firasfanon/Palwakf_Prompt_Maker';
// Accepted producer baseline the fixtures were generated from. A commit cannot contain its own
// hash, so this records the code state that PRODUCED them; consumers pin the canonical head at vendoring time.
const PRODUCER_BASE_HEAD = 'afbb5aa9d16b4a7c586296ad8371d5b835bb8dbf';
const FIXTURE_VERSION = 1;
const CONSUMER_SUBSET_VERSION = 1;
const PRODUCER_SCHEMA_VERSION = '1.1';

const BASE_INPUT = { project_name: 'Golden Consumer Project', project_goal: 'منصة ويب لإدارة مهام الفريق مع تسجيل دخول ولوحة متابعة' };

function subsetFor(extra) {
  const r = compileProject(Object.assign({}, BASE_INPUT, extra || {}));
  if (!r.ok) throw new Error('fixture input failed to compile: ' + r.errors.join('; '));
  return extractFactoryConsumerSubset(r.blueprint);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function buildFixtures() {
  const golden = subsetFor({ preferred_technology: 'react-vite-supabase' });
  const futureSchema = clone(golden); futureSchema.schema_version = '2.0';
  const invalid = clone(golden); delete invalid.project_goal;
  return [
    { file: 'golden-react-vite-supabase.json', fixture_id: 'GOLDEN_FIXTURE_V1', content: golden,
      expected: { result: 'MATERIALIZATION_READY', classification: 'SUPPORTED_EXACT', profile: 'react-vite-supabase' },
      created_from: 'compileProject({project_name, project_goal, preferred_technology:"react-vite-supabase"}) -> extractFactoryConsumerSubset(blueprint)' },
    { file: 'negative-requires-technology-decision.json', fixture_id: 'NEGATIVE_REQUIRES_TECHNOLOGY_DECISION_V1', content: subsetFor(),
      expected: { result: 'BLOCKED_REQUIRES_TECHNOLOGY_DECISION', classification: 'REQUIRES_DECISION', profile: null },
      created_from: 'compileProject({project_name, project_goal}) (no preferred_technology) -> extractFactoryConsumerSubset(blueprint)' },
    { file: 'negative-unsupported-technology-profile.json', fixture_id: 'NEGATIVE_UNSUPPORTED_TECHNOLOGY_PROFILE_V1', content: subsetFor({ preferred_technology: 'Django + PostgreSQL' }),
      expected: { result: 'BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE', classification: 'UNSUPPORTED', profile: null },
      created_from: 'compileProject({..., preferred_technology:"Django + PostgreSQL"}) -> extractFactoryConsumerSubset(blueprint)' },
    { file: 'negative-unsupported-blueprint-schema.json', fixture_id: 'NEGATIVE_UNSUPPORTED_BLUEPRINT_SCHEMA_V1', content: futureSchema,
      expected: { result: 'UNSUPPORTED_BLUEPRINT_SCHEMA', classification: null, profile: null },
      created_from: 'GOLDEN_FIXTURE_V1 content with schema_version replaced by "2.0"' },
    { file: 'negative-invalid-consumer-subset.json', fixture_id: 'NEGATIVE_INVALID_CONSUMER_SUBSET_V1', content: invalid,
      expected: { result: 'INVALID_BLUEPRINT', classification: null, profile: null },
      created_from: 'GOLDEN_FIXTURE_V1 content with required field project_goal removed' },
  ];
}

const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
const sha256Lf = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

function buildManifest(fixtures, readStatic) {
  const entry = (file, extra) => Object.assign({ file, sha256: sha256Lf(readStatic(file)) }, extra);
  return {
    manifest_version: 1,
    sha256_basis: 'SHA-256 of file bytes, CRLF normalized to LF',
    fnv_is_not_integrity_evidence: true,
    producer_repository: PRODUCER_REPOSITORY,
    producer_base_head: PRODUCER_BASE_HEAD,
    producer_schema_version: PRODUCER_SCHEMA_VERSION,
    consumer_subset_version: CONSUMER_SUBSET_VERSION,
    fixture_version: FIXTURE_VERSION,
    contract_files: [
      entry('consumer-subset-v1.schema.json'),
      entry('profile-mapping-v1.json', { mapping_id: 'factory_consumer_profile_mapping_v1' }),
    ],
    fixtures: fixtures.map((f) => ({
      fixture_id: f.fixture_id,
      fixture_version: FIXTURE_VERSION,
      file: f.file,
      producer_schema_version: PRODUCER_SCHEMA_VERSION,
      producer_repository: PRODUCER_REPOSITORY,
      producer_head: PRODUCER_BASE_HEAD,
      consumer_subset_version: CONSUMER_SUBSET_VERSION,
      expected_result: f.expected.result,
      expected_classification: f.expected.classification,
      expected_profile: f.expected.profile,
      sha256: sha256Lf(serialize(f.content)),
      created_from: f.created_from,
    })),
  };
}

function generate() {
  const fixtures = buildFixtures();
  const files = {};
  fixtures.forEach((f) => { files[f.file] = serialize(f.content); });
  const manifest = buildManifest(fixtures, (name) => fs.readFileSync(path.join(DIR, name), 'utf8'));
  files['manifest.json'] = serialize(manifest);
  return files;
}

module.exports = { generate, buildFixtures, buildManifest, serialize, sha256Lf, DIR, PRODUCER_BASE_HEAD };

if (require.main === module) {
  const files = generate();
  if (process.argv.includes('--check')) {
    const diff = Object.keys(files).filter((n) => {
      const p = path.join(DIR, n);
      return !fs.existsSync(p) || fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== files[n];
    });
    if (diff.length) { console.error('Fixture drift: ' + diff.join(', ')); process.exit(1); }
    console.log('Fixtures match generator output.');
  } else {
    Object.keys(files).forEach((n) => fs.writeFileSync(path.join(DIR, n), files[n]));
    console.log('Wrote ' + Object.keys(files).length + ' files to ' + DIR);
  }
}
