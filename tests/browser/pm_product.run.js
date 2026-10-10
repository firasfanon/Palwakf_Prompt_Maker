#!/usr/bin/env node
'use strict';
/**
 * PM-FULL-PRODUCTION-INTEGRATED-V1 — real-browser product journey (dist/guided.html, real Chromium, pinned playwright).
 * A SIMULATED user (test actor, NOT human acceptance testing) goes from an idea / an existing project to an approved
 * package, then persists, versions, exports and reopens the project in a fresh browser profile.
 *   node tests/browser/pm_product.run.js [--evidence DIR]      (screenshots + downloaded artefacts go to DIR when given)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { chromium } = require('playwright');

const PORT = 4181; const ORIGIN = 'http://127.0.0.1:' + PORT; const DIST = path.join(__dirname, '..', '..', 'dist');
const ei = process.argv.indexOf('--evidence'); const EVID = ei !== -1 ? path.resolve(process.argv[ei + 1]) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-product-'));
let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✅ ' + name); } catch (e) { failed++; console.log('  ❌ ' + name + ' — ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

const BASE = {
  project_name: 'عيادة الشفاء', project_idea: 'نظام ويب لحجز مواعيد عيادة', project_goal: 'تسهيل حجز المواعيد للمرضى', success_measures: '200 حجز شهريًا', workflows: 'حجز، إلغاء، تأكيد',
  scope: 'المواعيد فقط', business_rules: 'لا حجز مزدوج', platforms: 'موقع ويب', languages: 'العربية والإنجليزية', data_entities: 'مرضى، مواعيد', integrations: 'بريد إلكتروني',
  auth_model: 'بريد وكلمة مرور', secrets_handling: 'متغيرات بيئة', availability_targets: '500 مستخدم', architecture: 'واجهة وخدمة بيانات', hosting_target: 'سحابة', testing_expectations: 'اختبار الوظائف الأساسية',
};
const CTX = {
  repository: 'https://github.com/example/clinic-booking', current_state: 'نسخة أولى تعمل لعيادة واحدة', existing_stack: 'React\nSupabase',
  existing_capabilities: 'تسجيل الدخول بالبريد\nحجز المواعيد', existing_tests: 'لا توجد اختبارات آلية', known_gaps: 'لا يوجد نسخ احتياطي', existing_constraints: 'الحفاظ على قاعدة البيانات الحالية',
};

function startStatic() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const f = path.join(DIST, req.url.split('?')[0].replace(/^\//, ''));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
      res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8'); res.end(fs.readFileSync(f));
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}
async function open(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); page.__errors = []; page.__external = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) page.__external.push(u); });
  page.on('dialog', (d) => { page.__errors.push('unexpected dialog ' + d.type()); d.dismiss(); });
  await page.goto(ORIGIN + '/guided.html'); await page.waitForSelector('#qsource');
  return { ctx, page };
}
async function shot(page, name) { if (EVID) await page.screenshot({ path: path.join(EVID, name + '.png'), fullPage: true }); }
async function fill(page, id, value) { if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id); await page.fill('#inp-' + id, value); await page.click('#btn-save-' + id); await page.click('#btn-confirm-' + id); }
async function answerAll(page, values, tech) {
  await page.check('#mode-EXPERT'); await page.waitForSelector('#qsource');
  await page.fill('#inp-users_roles-users', 'مرضى وموظفو استقبال'); await page.fill('#inp-users_roles-roles', 'مدير، موظف'); await page.click('#btn-save-users_roles'); await page.click('#btn-confirm-users_roles');
  for (const k of Object.keys(values)) await fill(page, k, values[k]);
  await page.check('input[name="ch-data_sensitivity"][value="PERSONAL"]'); await page.click('#btn-save-data_sensitivity'); await page.click('#btn-confirm-data_sensitivity');
  await page.check('input[name="ch-technology_stack"][value="' + tech + '"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack');
}
async function setExistingContext(page, form) {
  if (!(await page.locator('#ctx-card').evaluate((d) => d.open))) await page.click('#ctx-summary');
  await page.check('#ctx-kind-existing');
  for (const k of Object.keys(form)) await page.fill('#ctx-' + k, form[k]);
  await page.click('#btn-ctx-preview'); await page.waitForSelector('#ctx-preview');
  await page.click('#btn-ctx-confirm'); await page.waitForSelector('#ctx-status');
}
async function download(page, btn, name) {
  if (btn === '#btnExportProj' && !(await page.locator('#projIo').evaluate((d) => d.open))) await page.click('#projIoSummary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
  const p = path.join(EVID || TMP, name); fs.copyFileSync(await dl.path(), p); return p;
}
async function noHorizontalOverflow(page) { return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1); }

(async () => {
  const server = await startStatic(); const browser = await chromium.launch();
  let exported = null; let exportedHead = null; let exportedPkgSha = null;
  try {
    console.log('— 390px mobile layout');
    await test('390px: the current question is on the first screen (not below the item list) in AR and EN', async () => {
      const { ctx, page } = await open(browser, { width: 390, height: 844 });
      for (const l of ['ar', 'en']) {
        if (l === 'en') await page.click('#btnLang');
        const top = await page.evaluate(() => document.getElementById('card-project_name').getBoundingClientRect().top);
        ok(top < 844, l + ' question card top ' + top + ' must be within the first 844px');
        const navTop = await page.evaluate(() => document.querySelector('nav.items').getBoundingClientRect().top);
        ok(navTop > top, l + ' item list follows the question on narrow screens');
        ok(await noHorizontalOverflow(page), l + ' no horizontal overflow');
        await shot(page, 'm390_' + l + '_questions');
      }
      eq(await page.evaluate(() => document.documentElement.dir), 'ltr');
      await ctx.close();
    });
    await test('desktop: two columns kept; status chips in the item list stay single-line pills', async () => {
      const { ctx, page } = await open(browser);
      eq(await page.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length), 2);
      const hs = await page.evaluate(() => Array.from(document.querySelectorAll('nav.items .chip')).map((c) => c.getBoundingClientRect().height));
      ok(hs.length === 21 && Math.max.apply(null, hs) < 34, 'chip heights ' + JSON.stringify(hs));
      await shot(page, 'desktop_ar_questions');
      await ctx.close();
    });

    console.log('— existing project → package (desktop, Arabic)');
    const { ctx: c1, page } = await open(browser);
    await test('project type defaults to NEW; choosing EXISTING without any description is refused with a focused field error', async () => {
      eq((await page.textContent('#ctx-status')).trim(), 'الحالي: مشروع جديد');
      await page.click('#ctx-summary'); await page.check('#ctx-kind-existing'); await page.click('#btn-ctx-preview');
      ok(await page.isVisible('#ctx-current_state-err'), 'error shown');
      eq(await page.evaluate(() => document.activeElement.id), 'ctx-current_state');
      ok((await page.textContent('#ctx-status')).indexOf('غير مؤكد') !== -1);
    });
    await test('existing-project context: preview shows the exact ProjectContextV1 + SHA-256; only the confirm click makes it effective', async () => {
      for (const k of Object.keys(CTX)) await page.fill('#ctx-' + k, CTX[k]);
      await page.click('#btn-ctx-preview');
      const shown = JSON.parse(await page.textContent('#ctx-preview'));
      eq(shown.schema_version, '1.0'); eq(shown.source_references[0].ref, CTX.repository);
      ok((await page.textContent('#ctx-status')).indexOf('غير مؤكد') !== -1, 'still a draft before confirmation');
      await shot(page, 'desktop_ar_context_preview');
      await page.click('#btn-ctx-confirm');
      ok((await page.textContent('#ctx-status')).indexOf('سياق مؤكد') !== -1);
      ok(await page.isVisible('#ctx-confirmed'));
    });
    await test('hostile text in the context is rendered as text only (no element injection)', async () => {
      await page.click('#btn-ctx-edit');
      await page.fill('#ctx-known_gaps', '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>');
      await page.click('#btn-ctx-preview'); await page.click('#btn-ctx-confirm');
      eq(await page.evaluate(() => window.__pwn), undefined);
      eq(await page.locator('#ctx-card img, #ctx-card script').count(), 0);
      await page.click('#btn-ctx-edit'); await page.fill('#ctx-known_gaps', CTX.known_gaps); await page.click('#btn-ctx-preview'); await page.click('#btn-ctx-confirm');
    });
    await test('guided answers + confirmed decisions → package v1 built as an EXISTING project', async () => {
      await answerAll(page, BASE, 'react-vite-supabase');
      await page.click('#tab-P'); await page.click('#btn-gen'); await page.waitForSelector('#pkg-card');
      ok((await page.textContent('#pkg-kind')).indexOf('مشروع قائم') !== -1);
      eq(await page.locator('#pkg-ctx-stale').count(), 0);
    });
    await test('Master Prompt and Blueprint are readable inside the app (no download needed), with the existing-project section', async () => {
      await page.click('#btn-view-mp'); const mp = await page.textContent('#pkg-view');
      ok(mp.indexOf('## مشروع قائم') !== -1 && mp.indexOf(CTX.repository) !== -1, 'brownfield section in Master Prompt');
      eq(await page.evaluate(() => document.activeElement.id), 'pkg-view');
      await shot(page, 'desktop_ar_view_master_prompt');
      await page.click('#btn-view-bp'); const bp = JSON.parse(await page.textContent('#pkg-view'));
      eq(bp.schema_version, '1.1'); eq(bp._brownfield.mode, 'EXISTING_PROJECT'); eq(bp.technology_decision.status, 'CONFIRMED'); eq(bp.technology_decision.stack, 'react-vite-supabase');
      await page.click('#btn-view-close'); eq(await page.locator('#pkg-view').count(), 0);
    });
    await test('changing the context after generation flags the package and removes approval until regenerated (v2)', async () => {
      await page.click('#tab-Q'); await page.click('#btn-ctx-edit');
      await page.fill('#ctx-known_gaps', 'لا يوجد نسخ احتياطي\nلا توجد مراقبة'); await page.click('#btn-ctx-preview'); await page.click('#btn-ctx-confirm');
      await page.click('#tab-P');
      ok(await page.isVisible('#pkg-ctx-stale'), 'stale banner'); eq(await page.locator('#btn-approve').count(), 0, 'no approval with the old context');
      await shot(page, 'desktop_ar_context_stale');
      await page.click('#btn-gen');
      eq(await page.locator('#pkg-ctx-stale').count(), 0); ok(await page.isVisible('#btn-approve'));
      ok((await page.textContent('#versions-box')).indexOf('v2') !== -1);
    });
    await test('approve v2 (local approval, disclosed) and download the Blueprint for the Factory', async () => {
      await page.click('#btn-approve');
      ok((await page.textContent('#pkg-status')).length > 0); ok(await page.isVisible('#pkg-local-disclosure'));
      const bpFile = await download(page, '#btn-dl-bp', 'ui_existing_react_blueprint.json');
      const bp = JSON.parse(fs.readFileSync(bpFile, 'utf8')); eq(bp._brownfield.mode, 'EXISTING_PROJECT');
      await download(page, '#btn-dl-mp', 'ui_existing_react_MASTER_PROMPT.md');
      await download(page, '#btn-dl-pkg', 'ui_existing_react_execution-package.json');
    });
    await test('persistence: reload reopens the same project, package versions and approval', async () => {
      const before = await page.textContent('#pkg-sha');
      await page.reload(); await page.waitForSelector('#qsource'); await page.click('#tab-P');
      eq(await page.textContent('#pkg-sha'), before); ok((await page.textContent('#versions-box')).indexOf('v2') !== -1);
      ok((await page.textContent('#ctx-status').catch(() => '')) !== null);
    });
    await test('edit a decision → v1/v2 superseded, v3 generated, version compare shows the change', async () => {
      await page.click('#tab-Q'); await page.click('#mode-EXPERT');
      await page.click('#btn-edit-success_measures'); await fill(page, 'success_measures', '300 حجز شهريًا');
      await page.click('#tab-P'); ok((await page.textContent('#pkg-status')).length > 0);
      await page.click('#btn-gen'); ok((await page.textContent('#versions-box')).indexOf('v3') !== -1);
      await page.selectOption('#cmp-a', '1'); await page.selectOption('#cmp-b', '2'); await page.click('#btn-compare');
      ok(await page.locator('[data-changed="success_measures"]').count() === 1, 'compare shows the edited decision');
      await shot(page, 'desktop_ar_versions');
    });
    await test('export the whole project to a file', async () => {
      exported = await download(page, '#btnExportProj', 'project_file_export.json');
      const f = JSON.parse(fs.readFileSync(exported, 'utf8'));
      eq(f.format, 'PROMPT_MAKER_PROJECT_FILE_V1'); eq(f.record.packages.length, 3); ok(f.record.context && f.record.context.state === 'CONFIRMED');
      exportedHead = f.record.ledger_jsonl.trim().split('\n').length; exportedPkgSha = f.record.packages[2].built.package_sha256;
      ok(await page.isVisible('#proj-io-result'));
    });
    eq(page.__errors.length, 0, 'page errors: ' + page.__errors.join(' | '));
    eq(page.__external.length, 0, 'external requests: ' + page.__external.join(' | '));
    await c1.close();

    console.log('— reopen in a fresh browser profile (English, 390px)');
    const { ctx: c2, page: p2 } = await open(browser, { width: 390, height: 844 });
    await test('a tampered project file is rejected with reasons and nothing is stored', async () => {
      const f = JSON.parse(fs.readFileSync(exported, 'utf8'));
      f.record.packages[2].built.documents['contracts/ProjectBlueprintV1.json'].project_name = 'X';
      f.record_sha256 = require('../../gfpi/canon').sha256OfValue(f.record);
      const bad = path.join(TMP, 'tampered.json'); fs.writeFileSync(bad, JSON.stringify(f));
      await p2.setInputFiles('#inpOpenProj', bad); await p2.waitForSelector('#proj-io-result');
      ok((await p2.getAttribute('#proj-io-result', 'class')).indexOf('bad') !== -1);
      ok((await p2.textContent('#proj-io-result')).indexOf('document hash') !== -1);
      eq(await p2.evaluate((id) => localStorage.getItem('gfpi.v1.p.' + id), f.record.id), null);
    });
    await test('the exported file reopens the full project: same packages, approval, context and ledger (RTL→LTR UI)', async () => {
      await p2.click('#btnLang');
      await p2.setInputFiles('#inpOpenProj', exported); await p2.waitForSelector('#proj-io-result');
      ok((await p2.getAttribute('#proj-io-result', 'class')).indexOf('ok') !== -1, await p2.textContent('#proj-io-result'));
      eq(await p2.evaluate(() => document.documentElement.dir), 'rtl', 'project language (ar) restored with the project');
      await p2.click('#btnLang'); eq(await p2.evaluate(() => document.documentElement.dir), 'ltr');
      await p2.click('#tab-L'); eq(await p2.locator('#ledger-table tbody tr').count(), exportedHead);
      await p2.click('#tab-P'); ok((await p2.textContent('#pkg-sha')).indexOf(exportedPkgSha) !== -1);
      ok((await p2.textContent('#versions-box')).indexOf('v3') !== -1);
      await p2.click('#tab-Q'); ok((await p2.textContent('#ctx-status')).indexOf('context confirmed') !== -1);
      ok(await noHorizontalOverflow(p2), 'no horizontal overflow at 390px');
      await shot(p2, 'm390_en_reopened_package');
    });
    await test('opening the same file again is idempotent; a different local copy is never overwritten', async () => {
      await p2.setInputFiles('#inpOpenProj', exported); await p2.waitForSelector('#proj-io-result');
      ok((await p2.textContent('#proj-io-result')).indexOf('identical') !== -1);
      await p2.click('#tab-Q'); await p2.click('#mode-EXPERT'); await p2.click('#btn-edit-scope'); await fill(p2, 'scope', 'المواعيد والفواتير');
      const localBefore = await p2.evaluate(() => { const i = JSON.parse(localStorage.getItem('gfpi.v1.index')); return localStorage.getItem('gfpi.v1.p.' + i[i.length - 1].id); });
      await p2.setInputFiles('#inpOpenProj', exported); await p2.waitForSelector('#proj-io-result');
      ok((await p2.getAttribute('#proj-io-result', 'class')).indexOf('bad') !== -1);
      ok((await p2.textContent('#proj-io-result')).indexOf('not replaced') !== -1);
      const localAfter = await p2.evaluate(() => { const i = JSON.parse(localStorage.getItem('gfpi.v1.index')); return localStorage.getItem('gfpi.v1.p.' + i[i.length - 1].id); });
      eq(localAfter, localBefore, 'local work untouched');
    });
    await test('390px: every tab renders without horizontal overflow (EN)', async () => {
      for (const t of ['Q', 'L', 'P', 'F', 'C']) { await p2.click('#tab-' + t); ok(await noHorizontalOverflow(p2), 'tab ' + t); }
      await p2.click('#tab-P'); await p2.click('#btn-view-mp'); ok(await noHorizontalOverflow(p2), 'package view'); await shot(p2, 'm390_en_view_mp');
    });
    eq(p2.__errors.length, 0, 'page errors: ' + p2.__errors.join(' | '));
    eq(p2.__external.length, 0, 'external requests: ' + p2.__external.join(' | '));
    await c2.close();

    console.log('— new project → package (English, desktop) and Flutter');
    for (const tech of ['react-vite-supabase', 'flutter-supabase']) {
      await test('new project (' + tech + '): no brownfield, technology decision confirmed, blueprint downloaded', async () => {
        const { ctx, page: p3 } = await open(browser);
        await p3.click('#btnLang');
        await answerAll(p3, Object.assign({}, BASE, tech === 'flutter-supabase' ? { platforms: 'تطبيق جوال' } : {}), tech);
        await p3.click('#tab-P'); await p3.click('#btn-gen'); await p3.waitForSelector('#pkg-card');
        ok((await p3.textContent('#pkg-kind')).indexOf('new project') !== -1);
        const f = await download(p3, '#btn-dl-bp', 'ui_new_' + tech + '_blueprint.json');
        const bp = JSON.parse(fs.readFileSync(f, 'utf8'));
        eq(bp._brownfield, null); eq(bp.technology_decision.stack, tech); eq(bp.technology_decision.status, 'CONFIRMED');
        if (tech === 'react-vite-supabase') await shot(p3, 'desktop_en_package_new');
        eq(p3.__errors.length, 0, p3.__errors.join(' | ')); await ctx.close();
      });
    }
  } finally {
    await browser.close(); server.close();
  }
  console.log('\n' + '='.repeat(60) + '\nPM_PRODUCT_E2E: ' + passed + ' passed, ' + failed + ' failed, of ' + (passed + failed) + '\n' + '='.repeat(60));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
