#!/usr/bin/env node
'use strict';
/**
 * S7 joint UAT: Blueprints generated THROUGH the real guided UI (dist/guided.html, real Chromium) are fed to the REAL
 * Factory consumer (python3 -m consumer.adapter evaluate/materialize) from a read-only Factory checkout.
 *   FACTORY_DIR=/path/to/factory node tools/uat/gfpiFactoryUat.js [--out DIR]
 * Nothing in the Factory checkout is modified (output goes to --out). Exit 0 only if every scenario behaves as expected.
 */
const fs = require('fs'); const path = require('path'); const http = require('http'); const cp = require('child_process'); const os = require('os');
const { chromium } = require('playwright');
const FA = process.env.FACTORY_DIR; if (!FA) { console.error('FACTORY_DIR required'); process.exit(2); }
const oi = process.argv.indexOf('--out'); const OUT = oi !== -1 ? process.argv[oi + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'gfpi-uat-'));
fs.mkdirSync(path.join(OUT, 'bp'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'out'), { recursive: true });
const DIST = path.join(__dirname, '..', '..', 'dist'); const PORT = 4177; const ORIGIN = 'http://127.0.0.1:' + PORT;
const BASE = { project_name: 'UAT', project_idea: 'نظام ويب عام لإدارة المهام', project_goal: 'نظام ويب عام لإدارة المهام', success_measures: 'عشرة مستخدمين', workflows: 'إنشاء، تعديل، إغلاق', scope: 'مهام فقط', business_rules: 'لا حذف نهائي', platforms: 'موقع ويب', languages: 'العربية', data_entities: 'مهام', integrations: 'لا يوجد', auth_model: 'بريد وكلمة مرور', secrets_handling: 'متغيرات بيئة', availability_targets: '10 مستخدمين', architecture: 'واجهة وخدمة', hosting_target: 'سحابة', testing_expectations: 'أساسي' };
const SCEN = [
  { id: 'supported_react', tech: { radio: 'react-vite-supabase' }, expect: 0 },
  { id: 'supported_flutter', tech: { radio: 'flutter-supabase' }, platforms: 'تطبيق جوال', expect: 0 },
  { id: 'alias_documented', tech: { manual: 'React + Vite + Supabase' }, expect: 0 },
  { id: 'unsupported_django', tech: { manual: 'Django + HTMX' }, expect: 11 },
  { id: 'undecided_deferred', tech: { defer: 'بعد التوصية' }, expect: 10 },
  { id: 'hostile_manual', tech: { manual: '<img src=x onerror=1>"; touch ' + path.join(os.tmpdir(), 'PWNED_GFPI') + '; $(touch ' + path.join(os.tmpdir(), 'PWNED_GFPI2') + ') `x`' }, expect: 11 },
];
function serve() { return new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(DIST, q.url.split('?')[0].replace(/^\//, '')); if (!f.startsWith(DIST) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript'); r.end(fs.readFileSync(f)); }); s.listen(PORT, '127.0.0.1', () => res(s)); }); }
async function fill(page, id, value) { if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id); await page.fill('#inp-' + id, value); await page.click('#btn-save-' + id); await page.click('#btn-confirm-' + id); }
(async () => {
  for (const f of ['PWNED_GFPI', 'PWNED_GFPI2']) { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch (e) { /* none */ } }
  const server = await serve(); const browser = await chromium.launch(); const results = [];
  for (const vp of [{ n: 'desktop', w: 1280, h: 900 }, { n: '390', w: 390, h: 844 }]) {
    for (const sc of SCEN) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, acceptDownloads: true }); const page = await ctx.newPage(); await page.goto(ORIGIN + '/guided.html');
      await page.check('#mode-EXPERT'); await page.waitForSelector('#qsource');
      const vals = Object.assign({}, BASE, sc.platforms ? { platforms: sc.platforms } : {});
      await page.fill('#inp-users_roles-users', 'مستخدمون'); await page.fill('#inp-users_roles-roles', 'مدير'); await page.click('#btn-save-users_roles'); await page.click('#btn-confirm-users_roles');
      for (const k of Object.keys(vals)) await fill(page, k, vals[k]);
      await page.check('input[name="ch-data_sensitivity"][value="PERSONAL"]'); await page.click('#btn-save-data_sensitivity'); await page.click('#btn-confirm-data_sensitivity');
      if (sc.tech.radio) { await page.check('input[name="ch-technology_stack"][value="' + sc.tech.radio + '"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack'); }
      else if (sc.tech.manual) { await page.check('#ch-technology_stack-manual'); await page.fill('#inp-technology_stack-manual', sc.tech.manual); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack'); }
      else { await page.click('#card-technology_stack details.card > summary'); await page.fill('#inp-gate-technology_stack', sc.tech.defer); await page.click('#btn-defer-technology_stack'); }
      await page.click('#tab-P'); await page.click('#btn-gen');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-bp')]);
      const bpPath = path.join(OUT, 'bp', vp.n + '_' + sc.id + '.json'); fs.copyFileSync(await dl.path(), bpPath);
      if (sc.id === 'supported_react' || sc.id === 'undecided_deferred') await page.screenshot({ path: path.join(OUT, vp.n + '_' + sc.id + '.png') });
      await ctx.close();
      const outDir = path.join(OUT, 'out', vp.n + '_' + sc.id);
      const ev = cp.spawnSync('python3', ['-m', 'consumer.adapter', 'evaluate', '--blueprint', bpPath], { cwd: FA, encoding: 'utf8' });
      const mat = cp.spawnSync('python3', ['-m', 'consumer.adapter', 'materialize', '--blueprint', bpPath, '--output', outDir], { cwd: FA, encoding: 'utf8' });
      const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8'));
      results.push({ vp: vp.n, id: sc.id, stack: bp.technology_decision.stack, status: bp.technology_decision.status, schema: bp.schema_version, eval_exit: ev.status, mat_exit: mat.status, expected: sc.expect, out_exists: fs.existsSync(outDir) });
    }
  }
  await browser.close(); server.close();
  let bad = 0;
  results.forEach((r) => { const ok = r.eval_exit === r.expected && r.mat_exit === r.expected && r.out_exists === (r.expected === 0) && r.schema === '1.1'; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + r.vp + ' ' + r.id + ' status=' + r.status + ' stack=' + JSON.stringify(r.stack).slice(0, 40) + ' eval=' + r.eval_exit + ' mat=' + r.mat_exit + ' out=' + r.out_exists); });
  const pwned = ['PWNED_GFPI', 'PWNED_GFPI2'].filter((f) => fs.existsSync(path.join(os.tmpdir(), f)));
  if (pwned.length) { bad++; console.log('FAIL injection artefacts created: ' + pwned.join()); } else console.log('PASS no injection artefacts');
  const dirty = cp.spawnSync('git', ['status', '--porcelain'], { cwd: FA, encoding: 'utf8' }).stdout.trim(); if (dirty) { bad++; console.log('FAIL factory checkout modified: ' + dirty); } else console.log('PASS factory checkout unmodified');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('SCENARIOS ' + results.length + ' FAILS ' + bad + ' OUT ' + OUT); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
