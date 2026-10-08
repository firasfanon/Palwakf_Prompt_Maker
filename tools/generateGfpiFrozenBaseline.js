'use strict';
// Records SHA-256 of every frozen file at the verified base. Run with `--check` to compare against the working tree.
const fs = require('fs');
const path = require('path');
const { sha256Hex } = require('../gfpi/canon');

const root = path.join(__dirname, '..');
const out = path.join(root, 'tests', 'gfpi', 'frozen_baseline.json');
function walk(d, acc) {
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  });
  return acc;
}
const files = [];
['src', 'tests/fixtures/factory-consumer'].forEach((d) => walk(path.join(root, d), files));
['dist/core_bundle.js', 'dist/prompt-maker-app.html', 'tests/run.js', 'tests/browser/run.js'].forEach((f) => files.push(path.join(root, f)));
const map = {};
files.sort().forEach((f) => { map[path.relative(root, f).split(path.sep).join('/')] = sha256Hex(fs.readFileSync(f, 'latin1')); });
const doc = { base_head: 'db18a5591d5dfa58f5e3ef7662856e01d913ce38', note: 'sha256 over latin1-decoded bytes', files: map };
if (process.argv.includes('--check')) {
  const cur = JSON.parse(fs.readFileSync(out, 'utf8'));
  const bad = Object.keys(cur.files).filter((k) => map[k] !== cur.files[k]);
  if (bad.length) { console.error('FROZEN DRIFT: ' + bad.join(', ')); process.exit(1); }
  console.log('frozen baseline intact (' + Object.keys(cur.files).length + ' files)');
} else { fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); console.log('baseline written: ' + files.length + ' files'); }
