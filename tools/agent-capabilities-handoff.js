#!/usr/bin/env node
'use strict';
/** Strict read-only producer; --out is an exclusive new sidecar file. */
const fs = require('node:fs');
const path = require('node:path');
const { createAgentCapabilitiesHandoff } = require('../src/agentCapabilityContracts');
function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--blueprint' || argv[2] !== '--out') {
    throw new Error('USAGE: --blueprint EXACT_JSON --out NEW_HANDOFF_JSON');
  }
  const data = fs.readFileSync(argv[1]);
  if (data.length > 3 * 1024 * 1024) throw new Error('BLUEPRINT_OVER_SIZE_LIMIT');
  const blueprint = JSON.parse(data.toString('utf8'));
  const handoff = createAgentCapabilitiesHandoff(blueprint, data);
  const out = path.resolve(argv[3]);
  const dir = path.dirname(out);
  if (!fs.statSync(dir).isDirectory()) throw new Error('OUTPUT_PARENT_NOT_DIRECTORY');
  fs.writeFileSync(out, JSON.stringify(handoff, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  process.stdout.write(JSON.stringify({
    status: 'REFERENCE_ONLY_NOT_EXECUTED',
    contract_id: handoff.contract_id,
    handoff_path: out,
    blueprint_sha256: handoff.producer.blueprint_sha256,
    runtime_admission: false,
  }) + '\n');
}
try { main(process.argv.slice(2)); }
catch (e) { process.stderr.write('HANDOFF_REJECTED: ' + e.message + '\n'); process.exitCode = 2; }
