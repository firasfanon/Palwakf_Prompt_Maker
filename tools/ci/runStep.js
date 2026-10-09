#!/usr/bin/env node
'use strict';
/**
 * CI helper: run a command, stream its output unchanged, and on failure surface the failing lines as GitHub `::error::` annotations
 * (readable from the checks API without log access). Exit code is the command's exit code — it never turns a failure into a pass.
 * Usage: node tools/ci/runStep.js <label> -- <command> [args...]
 */
const cp = require('child_process');
const argv = process.argv.slice(2); const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) { console.error('usage: runStep.js <label> -- <command> [args...]'); process.exit(2); }
const label = argv.slice(0, sep).join(' '); const cmd = argv[sep + 1]; const args = argv.slice(sep + 2);
const r = cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env });
const out = (r.stdout || '') + (r.stderr || '');
process.stdout.write(out);
if (r.status !== 0) {
  const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').slice(0, 900);
  const lines = out.split('\n'); const bad = [];
  lines.forEach((l, i) => { if (/❌|\bFAIL\b|AssertionError|Error:|not ok|timeout|Timeout/.test(l)) bad.push(lines.slice(i, i + 3).join(' | ')); });
  (bad.length ? bad.slice(0, 12) : lines.filter(Boolean).slice(-12)).forEach((l) => console.log('::error title=' + esc(label) + '::' + esc(l)));
  if (r.error) console.log('::error title=' + esc(label) + '::' + esc(String(r.error)));
}
process.exit(r.status === null ? 1 : r.status);
