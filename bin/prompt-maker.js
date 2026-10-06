#!/usr/bin/env node
'use strict';
/**
 * CLI — the environment-appropriate interface here (Claude Code has a real
 * terminal and filesystem; the previous environment this project targeted
 * was a claude.ai Artifact page, which this build does not have access to).
 * Supports two usage modes:
 *   prompt-maker.js new  --input project.json [--out out_dir]
 *   prompt-maker.js versions --project-id <id> --data-dir <dir>
 */
const fs = require('fs');
const path = require('path');
const { compileProject, createFileProjectRepository, createFileExportAdapter, createProjectVersion } = require('../src/index');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function cmdNew(args) {
  const inputPath = args['--input'];
  if (!inputPath) {
    console.error('Usage: prompt-maker.js new --input project.json [--out out_dir] [--data-dir dir]');
    process.exit(1);
  }
  const rawInput = readJSON(inputPath);
  const result = compileProject(rawInput);

  if (!result.ok) {
    console.error('FAIL:', result.errors.join('; '));
    process.exit(1);
  }

  const outDir = args['--out'] || './out';
  const exportAdapter = createFileExportAdapter(outDir);
  exportAdapter.exportFile('blueprint.json', JSON.stringify(result.blueprint, null, 2));
  exportAdapter.exportFile('acceptance_contract.json', JSON.stringify(result.acceptanceContract, null, 2));
  exportAdapter.exportFile('development_contract.json', JSON.stringify(result.developmentContract, null, 2));
  exportAdapter.exportFile('master_prompt.md', result.prompt);
  exportAdapter.exportFile('receipt.json', JSON.stringify(result.receipt, null, 2));

  if (args['--data-dir']) {
    const repo = createFileProjectRepository(args['--data-dir']);
    const projectId = result.intent.project_name.toLowerCase().replace(/\s+/g, '-');
    repo.load(projectId).then((prevData) => {
      const version = createProjectVersion(prevData ? prevData.latest_version : null, result);
      repo.save(projectId, { latest_version: version, result });
      console.log(`Saved project "${projectId}" — version ${version.version_number} (${version.change_summary})`);
    });
  }

  console.log(`Status: ${result.validation.status}`);
  console.log(`Files written to: ${outDir}`);
  if (result.validation.findings.length > 0) {
    console.log('Findings:', JSON.stringify(result.validation.findings, null, 2));
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i]] = argv[i + 1];
  return out;
}

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (command === 'new') {
  cmdNew(args);
} else {
  console.log('Usage: prompt-maker.js new --input project.json [--out out_dir] [--data-dir dir]');
  process.exit(command ? 1 : 0);
}
