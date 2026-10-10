#!/usr/bin/env node
'use strict';
/**
 * Builds the runnable Prompt Maker CANDIDATE package (NOT a release; no version bump, no publication):
 *   node tools/buildReleaseCandidate.js [--out DIR] [--allow-dirty]
 * Output: prompt-maker-candidate-<shortsha>.zip + .sha256, containing only what the app needs at runtime
 * (dist UI + bundles, companion, gfpi, src core, CLI), start scripts for Windows and Linux/macOS, a bilingual START_HERE,
 * CANDIDATE.json (commit, tree, per-file SHA-256) and SHA256SUMS.txt. Zero npm dependencies at runtime (Node >= 18 only).
 * Deterministic: sorted entries, fixed timestamps, store-only ZIP written by this script (no external zip tool).
 */
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const crypto = require('crypto');
const root = path.join(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const OUT = path.resolve(arg('--out') || path.join(root, 'release-candidate'));
const git = (a) => cp.execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const dirty = git(['status', '--porcelain']);
if (dirty && !process.argv.includes('--allow-dirty')) { console.error('refusing: working tree not clean (the candidate must match a commit)\n' + dirty); process.exit(2); }
const head = git(['rev-parse', 'HEAD']); const tree = git(['rev-parse', 'HEAD^{tree}']); const short = head.slice(0, 10);
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();

// Runtime file set (tracked files only, so nothing local or secret can leak in).
const tracked = git(['ls-files']).split('\n').filter(Boolean);
const INCLUDE = [/^dist\/(guided\.html|core_bundle\.js|gfpi_bundle\.js|gfpi_production_bundle\.js)$/, /^companion\/[^/]+\.js$/, /^gfpi\/(production\/)?[^/]+\.js$/, /^src\/[^/]+\.js$/, /^bin\/prompt-maker\.js$/,
  /^docs\/(LOCAL_OPERATIONS_AR|PROJECT_BLUEPRINT_SCHEMA|AUTHORITY_BOUNDARY|INTEGRATION_CONTRACTS)\.md$/, /^docs\/human-uat\/.+$/, /^(VERSION|CHANGELOG\.md)$/];
const files = tracked.filter((f) => INCLUDE.some((r) => r.test(f))).sort();
for (const must of ['dist/guided.html', 'companion/cli.js', 'companion/server.js', 'gfpi/projectRecord.js', 'src/index.js']) if (files.indexOf(must) === -1) { console.error('missing runtime file ' + must); process.exit(3); }

const START_HERE = `# Prompt Maker — مرشح تشغيل (Candidate) / Run candidate

**هذا مرشح للمراجعة وليس إصدارًا إنتاجيًا.** الالتزام: \`${head}\` (tree \`${tree}\`)، الإصدار المعلن في VERSION: \`${version}\`.
**This is a review candidate, not a production release.** Commit \`${head}\`.

## التشغيل / Run
المتطلب الوحيد: Node.js 18 أو أحدث (لا حاجة إلى npm install). / Only requirement: Node.js >= 18 (no npm install).

- Windows: انقر نقرًا مزدوجًا على \`start-windows.cmd\` / double-click \`start-windows.cmd\`
- Linux / macOS: \`sh start-linux-mac.sh\`
- أو / or: \`node companion/cli.js app\`

ثم افتح \`http://127.0.0.1:8787/\` في المتصفح. يعمل كل شيء محليًا على هذا الجهاز فقط (loopback). رمز الاقتران يظهر في الطرفية
ويلزم فقط لميزات الذكاء الاصطناعي الاختيارية (Ollama محلي: \`node companion/cli.js app --ollama-model <NAME>\`).
Then open \`http://127.0.0.1:8787/\`. Everything runs locally (loopback only). The pairing code (terminal) is only needed for optional AI help.

## ما الذي يفعله / What it does
فكرة مشروع جديد أو وصف مشروع قائم → أسئلة موجّهة → مراجعة القرارات وتأكيدها → حزمة: ProjectBlueprintV1 (1.1)
وعقدا القبول والتطوير وMaster Prompt → طبقة الإنتاج الكامل/SaaS (الجاهزية، الحارس، أثر القرارات) → حفظ تلقائي في المتصفح،
إصدارات ومقارنة، وتصدير/فتح ملف المشروع. ملف Blueprint يُمرَّر إلى Project Factory لتوليد docs/ai وهيكل الكود.

## حدود صريحة / Explicit limits
- اكتمال المواصفات **لا يثبت** أن التطبيق الذي ستبنيه جاهز للإنتاج. / Complete specifications do NOT prove the app you build is production-ready.
- الموافقة داخل الأداة محلية بلا هوية خادمية ولا تفوّض أي نشر. / In-app approval is local, has no server identity, and authorizes no deployment.
- وصف "المشروع القائم" نص منك وليس فحصًا للكود. / The existing-project description is your text, not a code inspection.
- الحفظ في متصفحك؛ صدّر ملف المشروع لنسخة احتياطية. / Work is saved in your browser; export the project file for backups.

## التحقق من سلامة الحزمة / Verify integrity
\`SHA256SUMS.txt\` يسرد بصمة كل ملف؛ \`CANDIDATE.json\` يربطها بالالتزام. / Every file is listed with its SHA-256.
`;
const START_CMD = '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js 18+ is required: https://nodejs.org/\r\n  pause\r\n  exit /b 1\r\n)\r\necho Starting Prompt Maker on http://127.0.0.1:8787/  (close this window to stop)\r\nnode companion\\cli.js app %*\r\npause\r\n';
const START_SH = '#!/bin/sh\nset -e\ncd "$(dirname "$0")"\ncommand -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required: https://nodejs.org/"; exit 1; }\necho "Starting Prompt Maker on http://127.0.0.1:8787/  (Ctrl+C to stop)"\nexec node companion/cli.js app "$@"\n';
const PKG = JSON.stringify({ name: 'prompt-maker-candidate', version, private: true, description: 'Prompt Maker run candidate (not a release)', license: 'UNLICENSED', engines: { node: '>=18' }, scripts: { app: 'node companion/cli.js app', cli: 'node bin/prompt-maker.js' } }, null, 2) + '\n';

const entries = files.map((f) => ({ name: f, data: fs.readFileSync(path.join(root, f)) }));
entries.push({ name: 'START_HERE.md', data: Buffer.from(START_HERE) }, { name: 'start-windows.cmd', data: Buffer.from(START_CMD) }, { name: 'start-linux-mac.sh', data: Buffer.from(START_SH), mode: 0o755 }, { name: 'package.json', data: Buffer.from(PKG) });
entries.sort((a, b) => (a.name < b.name ? -1 : 1));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifest = { kind: 'PROMPT_MAKER_RUN_CANDIDATE', not_a_release: true, commit: head, tree, version_file: version, built_from_clean_tree: !dirty, files: entries.map((e) => ({ path: e.name, sha256: sha(e.data), bytes: e.data.length })) };
entries.push({ name: 'CANDIDATE.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
entries.push({ name: 'SHA256SUMS.txt', data: Buffer.from(entries.map((e) => sha(e.data) + '  ' + e.name).join('\n') + '\n') });

// --- minimal deterministic store-only ZIP (PKZIP 2.0, UTF-8 names) ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const prefix = 'prompt-maker-candidate-' + short + '/';
const DOS_TIME = 0; const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // 2026-01-01 00:00 (fixed => reproducible)
const parts = []; const central = []; let off = 0;
for (const e of entries) {
  const name = Buffer.from(prefix + e.name, 'utf8'); const crc = CRC(e.data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
  parts.push(lh, name, e.data);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE((((e.mode || 0o644) | 0o100000) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
  central.push(ch, name); off += 30 + name.length + e.data.length;
}
const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
const zip = Buffer.concat(parts.concat([cd, end]));
fs.mkdirSync(OUT, { recursive: true });
const zipName = 'prompt-maker-candidate-' + short + '.zip'; fs.writeFileSync(path.join(OUT, zipName), zip);
fs.writeFileSync(path.join(OUT, zipName + '.sha256'), sha(zip) + '  ' + zipName + '\n');
console.log(JSON.stringify({ zip: path.join(OUT, zipName), sha256: sha(zip), files: entries.length, commit: head, tree }, null, 1));
