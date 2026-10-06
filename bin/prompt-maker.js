#!/usr/bin/env node
'use strict';
/**
 * CLI — the environment-appropriate interface here (a real terminal and filesystem).
 * Commands:
 *   prompt-maker.js new      --input project.json [--out out_dir] [--data-dir dir]
 *   prompt-maker.js versions --project-id <id> --data-dir <dir> [--version N]
 *
 * `new --data-dir` appends a real version to the project's persisted history
 * (ProjectRepository on the filesystem); `versions` reads that history back.
 */
const fs = require('fs');
const {
  compileProject, createFileProjectRepository, createFileExportAdapter,
  appendVersion, listVersions, getVersion, projectIdFromName,
} = require('../src/index');

const USAGE = [
  'Usage:',
  '  prompt-maker.js new      --input project.json [--out out_dir] [--data-dir dir]',
  '  prompt-maker.js versions --project-id <id> --data-dir <dir> [--version N]',
].join('\n');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function cmdNew(args) {
  const inputPath = args['--input'];
  if (!inputPath) fail(USAGE);
  const rawInput = readJSON(inputPath);
  const result = compileProject(rawInput);
  if (!result.ok) fail('FAIL: ' + result.errors.join('; '));

  const outDir = args['--out'] || './out';
  const exportAdapter = createFileExportAdapter(outDir);
  exportAdapter.exportFile('blueprint.json', JSON.stringify(result.blueprint, null, 2));
  exportAdapter.exportFile('acceptance_contract.json', JSON.stringify(result.acceptanceContract, null, 2));
  exportAdapter.exportFile('development_contract.json', JSON.stringify(result.developmentContract, null, 2));
  exportAdapter.exportFile('master_prompt.md', result.prompt);
  exportAdapter.exportFile('receipt.json', JSON.stringify(result.receipt, null, 2));

  if (args['--data-dir']) {
    const repo = createFileProjectRepository(args['--data-dir']);
    const projectId = projectIdFromName(result.intent.project_name);
    const previous = await repo.load(projectId);
    const record = appendVersion(previous, result, { projectId });
    await repo.save(projectId, record);
    const latest = record.versions[record.versions.length - 1];
    console.log(`Saved project "${projectId}" — version ${latest.version_number} (${latest.change_summary})`);
  }

  console.log(`Status: ${result.validation.status}`);
  console.log(`Files written to: ${outDir}`);
  if (result.validation.findings.length > 0) {
    console.log('Findings:', JSON.stringify(result.validation.findings, null, 2));
  }
}

async function cmdVersions(args) {
  const projectId = args['--project-id'];
  const dataDir = args['--data-dir'];
  if (!projectId || !dataDir) fail(USAGE);
  const repo = createFileProjectRepository(dataDir);
  const record = await repo.load(projectId);
  if (!record) fail(`No saved project "${projectId}" in ${dataDir}`);

  if (args['--version']) {
    const entry = getVersion(record, Number(args['--version']));
    if (!entry) fail(`Project "${projectId}" has no version ${args['--version']}`);
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  const rows = listVersions(record);
  console.log(`Project "${projectId}" — ${rows.length} version(s):`);
  rows.forEach((v) => {
    console.log(`v${v.version_number}  ${v.created_at}  ${v.change_summary}  input=${v.input_hash} blueprint=${v.blueprint_hash} prompt=${v.prompt_hash}`);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i]] = argv[i + 1];
  return out;
}

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const commands = { new: cmdNew, versions: cmdVersions };

if (!command) {
  console.log(USAGE);
} else if (!commands[command]) {
  console.error(USAGE);
  process.exit(1);
} else {
  commands[command](args).catch((e) => fail('ERROR: ' + e.message));
}
