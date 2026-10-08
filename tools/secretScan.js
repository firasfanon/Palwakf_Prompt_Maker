#!/usr/bin/env node
'use strict';
// Scans git-tracked files for credential-shaped strings. Exits 1 on any finding not on the explicit fake-value allowlist.
const cp = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const PATTERNS = [
  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/], ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['OPENAI_STYLE_KEY', /\bsk-[A-Za-z0-9_-]{20,}\b/], ['GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{35}\b/], ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/],
  ['URL_WITH_PASSWORD', /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/:@"']+:[^\s\/@"']{3,}@[^\s"']+/i], ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];
// Deliberately fake values used by tests to prove redaction/leak-prevention. Anything else is a finding.
const ALLOWED_FAKES = ['sk-ABCDEF1234567890ABCDEF1234567890', 'sk-abcdefghijklmnopqrstuvwxyz123456'];
// Per-file allowance: the redaction test intentionally embeds a dummy PEM block with body 'AAAA'.
const ALLOWED_FILE_PATTERN = { 'tests/gfpi/s2s3.test.js': ['PRIVATE_KEY'] };
const files = cp.spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean).filter((f) => !/package-lock\.json$/.test(f));
const findings = [];
files.forEach((f) => {
  let text; try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { return; }
  PATTERNS.forEach(([name, re]) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m;
    while ((m = g.exec(text))) { if ((ALLOWED_FILE_PATTERN[f] || []).indexOf(name) === -1 && ALLOWED_FAKES.indexOf(m[0]) === -1 && !/^(AKIAABCDEFGHIJKLMNOP|u:p@|user:pass@)/.test(m[0]) && !/ghp_a{30}|eyJhbGciOiJIUzI1NiJ9\.eyJzdWIiOiIxMjM0NTY3ODkwIn0\.abcdefghijklmnop/.test(m[0])) findings.push(f + ': ' + name); }
  });
});
const envFiles = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f)); envFiles.forEach((f) => findings.push(f + ': ENV_FILE_TRACKED'));
if (findings.length) { console.error('SECRET SCAN FINDINGS:\n' + findings.join('\n')); process.exit(1); }
console.log('secret scan clean (' + files.length + ' tracked files)');
