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
let prevAuth; try { prevAuth = JSON.parse(fs.readFileSync(out, 'utf8')).authorized_changes; } catch (e) { prevAuth = undefined; }
const doc = { base_head: 'db18a5591d5dfa58f5e3ef7662856e01d913ce38', note: 'sha256 over latin1-decoded bytes', files: map };
if (prevAuth) doc.authorized_changes = prevAuth;
if (process.argv.includes('--check')) {
  const cur = JSON.parse(fs.readFileSync(out, 'utf8'));
  // authorized_changes: an owner-authorized exception is accepted ONLY when the file equals the exact recorded post-change hash; the baseline hash in `files` is never rewritten.
  const auth = cur.authorized_changes || {};
  const bad = Object.keys(cur.files).filter((k) => map[k] !== cur.files[k] && !(auth[k] && map[k] === auth[k].sha256_after));
  if (bad.length) { console.error('FROZEN DRIFT: ' + bad.join(', ')); process.exit(1); }
  console.log('frozen baseline intact (' + Object.keys(cur.files).length + ' files' + (Object.keys(auth).length ? '; ' + Object.keys(auth).length + ' owner-authorized exceptions pinned by exact hash: ' + Object.keys(auth).join(', ') : '') + ')');
} else { fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); console.log('baseline written: ' + files.length + ' files'); }
