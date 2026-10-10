#!/usr/bin/env node
'use strict';
/**
 * PM-FULL-PRODUCTION-INTEGRATED-V1 — joint integration proof:
 *   Prompt Maker UI (real Chromium, dist/guided.html) -> ProjectBlueprintV1 (1.1) -> FACTORY_CONSUMER_SUBSET_V1
 *   -> Factory consumer adapter (python3 -m consumer.adapter, REAL Factory checkout, read-only) -> profile validation
 *   -> docs/ai + scaffold -> generated-project checks (provenance, SHA-256, no-clobber, secrets, tokens, build).
 *
 *   FACTORY_DIR=/path/to/factory node tools/uat/pmFactoryIntegration.js --out DIR
 *
 * Every Blueprint used here is produced by the UI (downloaded with the "Download Blueprint" button), never a fixture.
 * Tools that are not present (npm registry, flutter, Windows) are recorded as NOT_RUN with the observed reason — never PASS.
 * The simulated UI user is a test actor, not human UAT. Exit 0 only if every executed check passes.
 */
const fs = require('fs'); const path = require('path'); const http = require('http'); const cp = require('child_process'); const os = require('os'); const crypto = require('crypto');
const { chromium } = require('playwright');
const { extractFactoryConsumerSubset } = require('../../src/consumerSubset');

const FA = process.env.FACTORY_DIR; if (!FA) { console.error('FACTORY_DIR required'); process.exit(2); }
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(oi !== -1 ? process.argv[oi + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'pm-factory-')));
['bp', 'out', 'shots', 'logs'].forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));
const PM_ROOT = path.join(__dirname, '..', '..'); const DIST = path.join(PM_ROOT, 'dist'); const PORT = 4183; const ORIGIN = 'http://127.0.0.1:' + PORT;
const PY = process.env.FACTORY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const results = { started_platform: process.platform + '/' + process.arch, node: process.version, checks: [], scenarios: [], not_run: [] };
let failures = 0;
function check(id, pass, detail) { results.checks.push({ id, status: pass ? 'PASS' : 'FAIL', detail: detail || null }); if (!pass) failures++; console.log((pass ? 'PASS ' : 'FAIL ') + id + (detail && !pass ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); }
function notRun(id, reason) { results.not_run.push({ id, status: 'NOT_RUN', reason }); console.log('NOT_RUN ' + id + ' — ' + reason); }
const sha256lf = (buf) => crypto.createHash('sha256').update(Buffer.from(buf).toString('binary').replace(/\r\n/g, '\n'), 'binary').digest('hex');
const sh = (cmd, args, opts) => cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {}));
function tree(d) { const o = {}; (function walk(x) { if (!fs.existsSync(x)) return; for (const n of fs.readdirSync(x)) { const p = path.join(x, n); const st = fs.lstatSync(p); if (st.isDirectory()) { if (n !== 'node_modules') walk(p); } else o[path.relative(d, p).split(path.sep).join('/')] = sha256lf(fs.readFileSync(p)); } })(d); return o; }

const BASE = {
  project_name: 'Clinic Booking', project_idea: 'نظام ويب لحجز مواعيد عيادة', project_goal: 'تسهيل حجز المواعيد للمرضى', success_measures: '200 حجز شهريًا', workflows: 'حجز، إلغاء، تأكيد',
  scope: 'المواعيد فقط', business_rules: 'لا حجز مزدوج', platforms: 'موقع ويب', languages: 'العربية والإنجليزية', data_entities: 'مرضى، مواعيد', integrations: 'بريد إلكتروني',
  auth_model: 'بريد وكلمة مرور', secrets_handling: 'متغيرات بيئة', availability_targets: '500 مستخدم', architecture: 'واجهة وخدمة بيانات', hosting_target: 'سحابة', testing_expectations: 'اختبار الوظائف الأساسية',
};
const CTX = { repository: 'https://github.com/example/clinic-booking', current_state: 'نسخة أولى تعمل لعيادة واحدة', existing_stack: 'React\nSupabase', existing_capabilities: 'تسجيل الدخول\nحجز المواعيد', known_gaps: 'لا نسخ احتياطي' };
// expect = adapter exit code (0 ready, 10 needs decision, 11 unsupported profile, 13 unsupported schema)
const SCEN = [
  { id: 'new_react_desktop', tech: { radio: 'react-vite-supabase' }, expect: 0, profile: 'react-vite-supabase', build: true },
  { id: 'new_react_390', tech: { radio: 'react-vite-supabase' }, expect: 0, profile: 'react-vite-supabase', vp: { width: 390, height: 844 } },
  { id: 'new_flutter', tech: { radio: 'flutter-supabase' }, platforms: 'تطبيق جوال', expect: 0, profile: 'flutter-supabase', flutter: true },
  { id: 'existing_react', tech: { radio: 'react-vite-supabase' }, ctx: CTX, expect: 0, profile: 'react-vite-supabase', noClobber: true },
  { id: 'alias_documented', tech: { manual: 'React + Vite + Supabase' }, expect: 0, profile: 'react-vite-supabase' },
  { id: 'unsupported_stack', tech: { manual: 'Django + HTMX' }, expect: 11 },
  { id: 'undecided_deferred', tech: { defer: 'بعد التوصية' }, expect: 10 },
  { id: 'unsupported_schema_from_ui_bp', tech: { radio: 'react-vite-supabase' }, mutate: (bp) => { bp.schema_version = '2.0'; }, expect: 13 },
];

function serve() { return new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(DIST, q.url.split('?')[0].replace(/^\//, '')); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript'); r.end(fs.readFileSync(f)); }); s.listen(PORT, '127.0.0.1', () => res(s)); }); }
async function fill(page, id, value) { if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id); await page.fill('#inp-' + id, value); await page.click('#btn-save-' + id); await page.click('#btn-confirm-' + id); }

async function blueprintFromUi(browser, sc) {
  const ctx = await browser.newContext({ viewport: sc.vp || { width: 1280, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ORIGIN + '/guided.html'); await page.waitForSelector('#qsource');
  if (sc.ctx) {
    await page.click('#ctx-summary'); await page.check('#ctx-kind-existing');
    for (const k of Object.keys(sc.ctx)) await page.fill('#ctx-' + k, sc.ctx[k]);
    await page.click('#btn-ctx-preview'); await page.click('#btn-ctx-confirm');
  }
  await page.check('#mode-EXPERT'); await page.waitForSelector('#qsource');
  await page.fill('#inp-users_roles-users', 'مرضى وموظفون'); await page.fill('#inp-users_roles-roles', 'مدير، موظف'); await page.click('#btn-save-users_roles'); await page.click('#btn-confirm-users_roles');
  const vals = Object.assign({}, BASE, sc.platforms ? { platforms: sc.platforms } : {});
  for (const k of Object.keys(vals)) await fill(page, k, vals[k]);
  await page.check('input[name="ch-data_sensitivity"][value="PERSONAL"]'); await page.click('#btn-save-data_sensitivity'); await page.click('#btn-confirm-data_sensitivity');
  if (sc.tech.radio) { await page.check('input[name="ch-technology_stack"][value="' + sc.tech.radio + '"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack'); }
  else if (sc.tech.manual) { await page.check('#ch-technology_stack-manual'); await page.fill('#inp-technology_stack-manual', sc.tech.manual); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack'); }
  else { await page.click('#card-technology_stack details.card > summary'); await page.fill('#inp-gate-technology_stack', sc.tech.defer); await page.click('#btn-defer-technology_stack'); }
  await page.click('#tab-P'); await page.click('#btn-gen'); await page.waitForSelector('#pkg-card');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-bp')]);
  const bpPath = path.join(OUT, 'bp', sc.id + '.json'); fs.copyFileSync(await dl.path(), bpPath);
  await page.screenshot({ path: path.join(OUT, 'shots', sc.id + '_package.png'), fullPage: true });
  await ctx.close();
  return { bpPath, errors };
}

function adapter(args) { return sh(PY, ['-m', 'consumer.adapter'].concat(args), { cwd: FA }); }
function pyVerify(outDir, bpPath) {
  // Recomputes provenance/subset/secret/token checks with the Factory's OWN functions (no reimplementation drift).
  const code = [
    'import json,sys,re,pathlib', 'sys.path.insert(0, sys.argv[1])', 'from consumer import adapter as A',
    'out=pathlib.Path(sys.argv[2]); bp=json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))',
    'prov=json.loads((out/A.PROVENANCE_FILE).read_text(encoding="utf-8")); pin=A.load_pin(verify=True)',
    'files_ok=all(A.sha256_lf((out/k).read_bytes())==v for k,v in prov["files"].items())',
    'listed=set(prov["files"]); actual=set(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and p.relative_to(out).as_posix()!=A.PROVENANCE_FILE)',
    'subset=json.loads((out/A.SUBSET_FILE).read_text(encoding="utf-8"))',
    'secrets=[str(p) for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and A.scan_secrets(p.name, p.read_text(encoding="utf-8", errors="ignore"))]',
    'tokens=[str(p) for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and p.suffix in (".md",".json",".html",".ts",".tsx",".dart",".yaml") and re.search(r"\\{\\{[A-Z_]+\\}\\}", p.read_text(encoding="utf-8", errors="ignore"))]',
    'docs=sorted(p.name for p in (out/"docs/ai").glob("*.md"))',
    'print(json.dumps({"producer_contract_commit":prov["producer_contract_commit"],"pin_commit":pin["producer_contract_commit"],"mapping_ok":prov["profile_mapping_sha256"]==pin["profile_mapping_sha256"],"schema_ok":prov["consumer_schema_sha256"]==pin["consumer_schema_sha256"],"profile":prov["profile"],"files_ok":files_ok,"unlisted":sorted(actual-listed),"missing":sorted(listed-actual),"subset_sha_ok":prov["blueprint_subset_sha256"]==A.sha256_lf((out/A.SUBSET_FILE).read_bytes()),"subset_equals_factory_extract":subset==A.extract_subset(bp),"secrets":secrets,"tokens":tokens,"docs_ai_md":len(docs),"scope_note_ok":"NOT execution authority" in prov.get("scope_note","")}, ensure_ascii=False))',
  ].join('\n');
  const f = path.join(OUT, 'logs', '_verify.py'); fs.writeFileSync(f, code);
  const r = sh(PY, ['-I', f, FA, outDir, bpPath]); if (r.status !== 0) return { error: r.stderr };
  return JSON.parse(r.stdout);
}
function canon(v) { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'; return JSON.stringify(v); }

function contractCompatibility() {
  const pin = JSON.parse(fs.readFileSync(path.join(FA, 'consumer', 'pin', 'producer_pin.json'), 'utf8'));
  check('contract.pin_producer_commit', pin.producer_contract_commit === 'f659f92d34449f093de05be6cc52a7f6c5221c84', pin.producer_contract_commit);
  check('contract.pin_schema_1_1_subset_1', pin.project_blueprint_schema === '1.1' && pin.consumer_subset_version === 1);
  const map = (k) => k.replace(/^consumer\/pin\//, 'tests/fixtures/factory-consumer/').replace(/^tests\/fixtures\/prompt-maker\//, 'tests/fixtures/factory-consumer/');
  const diffs = Object.keys(pin.files).filter((k) => { const p = path.join(PM_ROOT, map(k)); return !fs.existsSync(p) || sha256lf(fs.readFileSync(p)) !== pin.files[k]; });
  check('contract.pinned_files_equal_current_prompt_maker', diffs.length === 0, diffs);
  const anc = sh('git', ['merge-base', '--is-ancestor', pin.producer_contract_commit, 'HEAD'], { cwd: PM_ROOT });
  if (anc.status === 0 || anc.status === 1) check('contract.producer_commit_is_ancestor_of_pm_head', anc.status === 0);
  else notRun('contract.producer_commit_is_ancestor_of_pm_head', 'producer commit not in this clone');
  const d = sh('git', ['diff', '--quiet', pin.producer_contract_commit, 'HEAD', '--', 'src/consumerSubset.js', 'src/blueprintCompiler.js', 'tests/fixtures/factory-consumer'], { cwd: PM_ROOT });
  if (d.status === 0 || d.status === 1) check('contract.producer_sources_unchanged_since_pin', d.status === 0, 'src/consumerSubset.js, src/blueprintCompiler.js, tests/fixtures/factory-consumer');
  else notRun('contract.producer_sources_unchanged_since_pin', 'git diff unavailable');
}

function buildReact(outDir, id) {
  // 1) hermetic TYPE check of the generated project (TS2339 regression), independent of the registry
  const tsc = (process.platform === 'win32' ? sh('where', ['tsc']) : sh('which', ['tsc'])).stdout.trim().split(/\r?\n/)[0];
  if (tsc) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tsc-')); fs.cpSync(path.join(outDir, 'src'), path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules', 'vite'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'node_modules', 'vite', 'package.json'), '{"name":"vite","version":"0.0.0-stub"}'); fs.writeFileSync(path.join(tmp, 'node_modules', 'vite', 'client.d.ts'), 'export {};\n');
    const sb = path.join(tmp, 'node_modules', '@supabase', 'supabase-js'); fs.mkdirSync(sb, { recursive: true }); fs.writeFileSync(path.join(sb, 'package.json'), '{"name":"@supabase/supabase-js","version":"0.0.0-stub","types":"index.d.ts"}'); fs.writeFileSync(path.join(sb, 'index.d.ts'), 'export declare function createClient(u: string, k: string): unknown;\n');
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, types: [] }, files: ['src/lib/supabase.ts', 'src/vite-env.d.ts'] }));
    const r = sh(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: tmp, shell: process.platform === 'win32' });
    fs.writeFileSync(path.join(OUT, 'logs', id + '_tsc_typecheck.log'), (r.stdout || '') + (r.stderr || ''));
    check(id + '.typecheck_import_meta_env_no_TS2339', r.status === 0 && !/TS2339/.test(r.stdout + r.stderr), (r.stdout || '').slice(0, 300));
  } else notRun(id + '.typecheck_import_meta_env_no_TS2339', 'tsc not on PATH');
  // 2) the REAL build: npm install + npm run build of the generated project
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const inst = sh(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', '--fetch-retries=1', '--fetch-timeout=60000'], { cwd: outDir, timeout: 900000, shell: process.platform === 'win32' });
  fs.writeFileSync(path.join(OUT, 'logs', id + '_npm_install.log'), 'exit=' + inst.status + '\n' + (inst.stdout || '') + (inst.stderr || ''));
  if (inst.status !== 0) {
    const txt = (inst.stdout || '') + (inst.stderr || '');
    if (/E403|403|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(txt)) { notRun(id + '.npm_install_and_build', 'npm registry unreachable in this environment (' + (txt.match(/E403|403[^\n]*|ENOTFOUND[^\n]*|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/) || ['network'])[0].slice(0, 120) + ')'); return; }
    check(id + '.npm_install', false, txt.slice(-600)); return;
  }
  check(id + '.npm_install', true);
  const b = sh(npm, ['run', 'build'], { cwd: outDir, timeout: 600000, shell: process.platform === 'win32' });
  fs.writeFileSync(path.join(OUT, 'logs', id + '_npm_build.log'), 'exit=' + b.status + '\n' + (b.stdout || '') + (b.stderr || ''));
  check(id + '.npm_run_build', b.status === 0 && fs.existsSync(path.join(outDir, 'dist', 'index.html')), ((b.stdout || '') + (b.stderr || '')).slice(-600));
}
function flutterChecks(outDir, id) {
  const has = (process.platform === 'win32' ? sh('where', ['flutter']) : sh('which', ['flutter'])).status === 0;
  if (!has) { notRun(id + '.flutter_pub_get_analyze_test', 'flutter SDK not installed in this environment'); return; }
  for (const step of [['pub', 'get'], ['analyze'], ['test']]) {
    const r = sh('flutter', step, { cwd: outDir, timeout: 900000, shell: process.platform === 'win32' });
    fs.writeFileSync(path.join(OUT, 'logs', id + '_flutter_' + step[0] + '.log'), 'exit=' + r.status + '\n' + (r.stdout || '') + (r.stderr || ''));
    check(id + '.flutter_' + step.join('_'), r.status === 0, ((r.stdout || '') + (r.stderr || '')).slice(-400));
    if (r.status !== 0) return;
  }
}

(async () => {
  const factoryHead = sh('git', ['rev-parse', 'HEAD'], { cwd: FA }).stdout.trim(); const pmHead = sh('git', ['rev-parse', 'HEAD'], { cwd: PM_ROOT }).stdout.trim();
  results.factory_head = factoryHead; results.pm_head = pmHead;
  const pyv = sh(PY, ['--version']); results.python = (pyv.stdout || pyv.stderr || '').trim();
  check('env.factory_checkout_clean_before', sh('git', ['status', '--porcelain'], { cwd: FA }).stdout.trim() === '');
  contractCompatibility();
  const server = await serve(); const browser = await chromium.launch();
  for (const sc of SCEN) {
    console.log('— ' + sc.id);
    const g = await blueprintFromUi(browser, sc);
    check(sc.id + '.ui_no_page_errors', g.errors.length === 0, g.errors);
    const bp = JSON.parse(fs.readFileSync(g.bpPath, 'utf8'));
    check(sc.id + '.blueprint_schema_1_1', bp.schema_version === '1.1');
    const td = bp.technology_decision || {};
    if (sc.tech.defer) check(sc.id + '.technology_not_decided', td.status === 'REQUIRES_DECISION' && td.stack === null, td);
    else check(sc.id + '.technology_confirmed_by_user', td.status === 'CONFIRMED' && td.source_type === 'USER_CONFIRMED', td);
    if (sc.ctx) check(sc.id + '.blueprint_brownfield_from_confirmed_context', bp._brownfield && bp._brownfield.mode === 'EXISTING_PROJECT');
    else check(sc.id + '.blueprint_new_project', bp._brownfield === null);
    if (sc.mutate) { sc.mutate(bp); fs.writeFileSync(g.bpPath, JSON.stringify(bp, null, 2)); }
    const outDir = path.join(OUT, 'out', sc.id);
    if (sc.noClobber) {
      fs.mkdirSync(path.join(outDir, 'docs', 'ai'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'package.json'), '{"name":"user-owned","private":true}\n'); fs.writeFileSync(path.join(outDir, 'docs', 'ai', 'PRD.md'), 'USER PRD — must survive\n');
    }
    const ev = adapter(['evaluate', '--blueprint', g.bpPath]); const mat = adapter(['materialize', '--blueprint', g.bpPath, '--output', outDir, '--date', '2026-10-11']);
    fs.writeFileSync(path.join(OUT, 'logs', sc.id + '_adapter.log'), 'evaluate exit=' + ev.status + '\n' + ev.stdout + ev.stderr + '\nmaterialize exit=' + mat.status + '\n' + mat.stdout + mat.stderr);
    check(sc.id + '.evaluate_exit_' + sc.expect, ev.status === sc.expect, { got: ev.status, out: (ev.stdout || '').slice(0, 200) });
    check(sc.id + '.materialize_exit_' + sc.expect, mat.status === sc.expect, { got: mat.status, out: (mat.stdout + mat.stderr).slice(0, 300) });
    const row = { id: sc.id, viewport: sc.vp ? sc.vp.width + 'px' : 'desktop', stack: td.stack, status: td.status, schema: bp.schema_version, evaluate_exit: ev.status, materialize_exit: mat.status, blueprint_sha256: sha256lf(fs.readFileSync(g.bpPath)) };
    if (sc.expect !== 0) {
      const exists = fs.existsSync(outDir);
      check(sc.id + '.blocked_touches_no_filesystem', !exists, exists ? fs.readdirSync(outDir) : null);
      // no silent substitution: the evaluation output names no profile for a blocked outcome
      if (sc.expect === 11 || sc.expect === 10) check(sc.id + '.no_substitute_profile_chosen', !/"profile":\s*"(react|flutter|generic)/.test(ev.stdout), ev.stdout.slice(0, 200));
      results.scenarios.push(row); continue;
    }
    const v = pyVerify(outDir, g.bpPath);
    if (v.error) { check(sc.id + '.provenance_verification_ran', false, v.error); results.scenarios.push(row); continue; }
    row.profile = v.profile; row.docs_ai_md = v.docs_ai_md;
    check(sc.id + '.profile_' + sc.profile, v.profile === sc.profile, v.profile);
    check(sc.id + '.provenance_producer_commit_pinned', v.producer_contract_commit === v.pin_commit && v.mapping_ok && v.schema_ok, v);
    check(sc.id + '.provenance_every_file_sha256_recomputes', v.files_ok && v.missing.length === 0, { missing: v.missing });
    check(sc.id + '.subset_sha256_and_equals_factory_extract', v.subset_sha_ok && v.subset_equals_factory_extract);
    const sub = JSON.parse(fs.readFileSync(path.join(outDir, 'docs', 'ai', 'BLUEPRINT_CONSUMER_SUBSET.json'), 'utf8'));
    check(sc.id + '.subset_equals_prompt_maker_producer_extract', canon(sub) === canon(extractFactoryConsumerSubset(JSON.parse(fs.readFileSync(g.bpPath, 'utf8')))));
    check(sc.id + '.docs_ai_complete_23', v.docs_ai_md === 23, v.docs_ai_md);
    check(sc.id + '.no_secret_residue', v.secrets.length === 0, v.secrets);
    check(sc.id + '.no_unresolved_tokens', v.tokens.length === 0, v.tokens);
    check(sc.id + '.scope_note_not_execution_authority', v.scope_note_ok);
    if (sc.profile === 'react-vite-supabase') check(sc.id + '.scaffold_has_vite_env_d_ts', fs.existsSync(path.join(outDir, 'src', 'vite-env.d.ts')));
    if (sc.noClobber) {
      check(sc.id + '.no_clobber_user_package_json_preserved', fs.readFileSync(path.join(outDir, 'package.json'), 'utf8') === '{"name":"user-owned","private":true}\n');
      check(sc.id + '.no_clobber_user_prd_preserved', fs.readFileSync(path.join(outDir, 'docs', 'ai', 'PRD.md'), 'utf8') === 'USER PRD — must survive\n');
      check(sc.id + '.no_clobber_reported_in_output', /package\.json/.test(mat.stdout) && /PRD\.md/.test(mat.stdout), mat.stdout.slice(0, 300));
      const before = tree(outDir); const again = adapter(['materialize', '--blueprint', g.bpPath, '--output', outDir, '--date', '2026-10-11']);
      check(sc.id + '.idempotent_second_run_changes_nothing', again.status === 0 && canon(tree(outDir)) === canon(before));
      row.no_clobber = 'VERIFIED';
    }
    if (sc.build) buildReact(outDir, sc.id);
    if (sc.flutter) flutterChecks(outDir, sc.id);
    results.scenarios.push(row);
  }
  await browser.close(); server.close();
  // desktop vs 390px UI produce the same consumer subset for the same answers (layout-independent output)
  const sA = extractFactoryConsumerSubset(JSON.parse(fs.readFileSync(path.join(OUT, 'bp', 'new_react_desktop.json'), 'utf8')));
  const sB = extractFactoryConsumerSubset(JSON.parse(fs.readFileSync(path.join(OUT, 'bp', 'new_react_390.json'), 'utf8')));
  check('ui.desktop_and_390_same_consumer_subset', canon(sA) === canon(sB));
  check('env.factory_checkout_unmodified_after', sh('git', ['status', '--porcelain'], { cwd: FA }).stdout.trim() === '');
  if (process.platform !== 'win32') notRun('windows.end_to_end', 'this run is on ' + process.platform + '; run the same tool on Windows (see docs/WINDOWS_INTEGRATION_VERIFICATION_AR.md)');
  results.summary = { executed: results.checks.length, failed: failures, not_run: results.not_run.length };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const md = ['# PM → Factory integration run', '', '- platform: ' + results.started_platform + ' · node ' + results.node + ' · ' + results.python, '- Prompt Maker HEAD: `' + pmHead + '`', '- Factory HEAD: `' + factoryHead + '`', '',
    '| scenario | viewport | stack | decision | evaluate | materialize | profile |', '|---|---|---|---|---|---|---|']
    .concat(results.scenarios.map((r) => '| ' + [r.id, r.viewport, '`' + String(r.stack).slice(0, 30) + '`', r.status, r.evaluate_exit, r.materialize_exit, r.profile || '—'].join(' | ') + ' |'))
    .concat(['', '## Checks', ''], results.checks.map((c) => '- ' + c.status + ' `' + c.id + '`'), ['', '## NOT_RUN', ''], results.not_run.length ? results.not_run.map((c) => '- NOT_RUN `' + c.id + '` — ' + c.reason) : ['- none'],
      ['', '**Summary:** ' + results.checks.length + ' executed checks, ' + failures + ' failed, ' + results.not_run.length + ' NOT_RUN. The UI user is simulated (not human UAT); materialization is a starting project, not production readiness.']);
  fs.writeFileSync(path.join(OUT, 'SUMMARY.md'), md.join('\n') + '\n');
  console.log('\nCHECKS ' + results.checks.length + ' FAILED ' + failures + ' NOT_RUN ' + results.not_run.length + ' OUT ' + OUT);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
