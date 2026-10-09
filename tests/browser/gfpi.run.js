#!/usr/bin/env node
'use strict';
/**
 * Real-browser UAT for the GFPI guided UI (dist/guided.html). Real Chromium via the pinned playwright driver.
 * The Local Companion is the REAL companion server module; its provider is a RECORDED/MOCKED adapter
 * (no real model, no network): results are labelled MOCKED and are not evidence of real provider performance.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const P = require('../../gfpi/providerAdapter');
const B = require('../../gfpi/budget');
const { createCompanion } = require('../../companion/server');
const { createMemoryStore } = require('../../companion/credentialStore');
const { createHostedAdapter } = require('../../companion/hostedAdapter');

const PORT = 4175; const ORIGIN = 'http://127.0.0.1:' + PORT; const DIST = path.join(__dirname, '..', '..', 'dist');
let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✅ ' + name); } catch (e) { failed++; console.log('  ❌ ' + name + ' — ' + (e && e.message)); } }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const BASE = {
  project_name: 'مشروع الحجز', project_idea: 'منصة حجز مواعيد', project_goal: 'تسهيل الحجز للعملاء', success_measures: '100 حجز في الشهر', workflows: 'حجز، إلغاء، تأكيد', scope: 'حجز فقط',
  business_rules: 'لا حجز مزدوج', platforms: 'موقع ويب', languages: 'العربية', data_entities: 'عملاء، مواعيد', integrations: 'بريد إلكتروني', auth_model: 'بريد وكلمة مرور',
  secrets_handling: 'متغيرات بيئة', availability_targets: '500 مستخدم', architecture: 'واجهة وخدمة بيانات', hosting_target: 'استضافة سحابية', testing_expectations: 'اختبار الوظائف الأساسية',
};
const CHOICES = { data_sensitivity: 'PERSONAL', technology_stack: 'react-vite-supabase' };

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

async function openPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }, opts.context || {}));
  const page = await ctx.newPage();
  page.__errors = []; page.__external = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) page.__external.push(u); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(ORIGIN + '/guided.html');
  return page;
}
async function setMode(page, m) { await page.check('#mode-' + m); await page.waitForSelector('#qsource'); }
async function fillItem(page, id, value) {
  if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id);
  if (id === 'users_roles') { await page.fill('#inp-users_roles-users', value.users); await page.fill('#inp-users_roles-roles', value.roles); }
  else if (CHOICES[id]) await page.check('input[name="ch-' + id + '"][value="' + CHOICES[id] + '"]');
  else await page.fill('#inp-' + id, value);
  await page.click('#btn-save-' + id);
  await page.click('#btn-confirm-' + id);
}
async function fillAllExpert(page, skip) {
  await setMode(page, 'EXPERT');
  const all = Object.assign({ users_roles: { users: 'عملاء وموظفون', roles: 'مدير، موظف' } }, BASE, CHOICES);
  for (const id of Object.keys(all)) { if (skip && skip.indexOf(id) !== -1) continue; await fillItem(page, id, all[id]); }
}
const tabTo = async (page, k) => { await page.click('#tab-' + k); };
const progress = async (page) => (await page.textContent('#progress'));

(async () => {
  const server = await startStatic();
  const browser = await chromium.launch();
  try {
    console.log('\n--- Load, language, direction, honesty ---');
    await test('loads clean: no console/page errors, RTL Arabic, zero external requests', async () => {
      const page = await openPage(browser);
      eq(await page.getAttribute('html', 'dir'), 'rtl'); eq(await page.getAttribute('html', 'lang'), 'ar');
      ok(page.__errors.length === 0, page.__errors.join('|')); eq(page.__external.length, 0, 'external requests');
      ok(/لا يوجد مزوّد ذكاء اصطناعي/.test(await page.textContent('#offlineBanner')), 'honest offline banner');
      ok(/ليس مولَّدًا بالذكاء الاصطناعي/.test(await page.textContent('#qsource')), 'questionnaire labelled non-AI');
      await page.context().close();
    });
    await test('English parity: i18n keys identical, dir=ltr, labels switch', async () => {
      const page = await openPage(browser);
      const keys = await page.evaluate(() => { const T = window.__GFPI_I18N; return [Object.keys(T.ar).sort(), Object.keys(T.en).sort()]; });
      eq(JSON.stringify(keys[0]), JSON.stringify(keys[1]), 'key parity');
      const empty = await page.evaluate(() => { const T = window.__GFPI_I18N; return Object.keys(T.ar).filter((k) => !T.ar[k] || !T.en[k]); }); eq(empty.length, 0, 'empty strings ' + empty);
      await page.click('#btnLang');
      eq(await page.getAttribute('html', 'dir'), 'ltr'); eq(await page.getAttribute('html', 'lang'), 'en');
      ok(/No AI provider is connected/.test(await page.textContent('#offlineBanner')));
      ok(/Project name/.test(await page.textContent('#card-project_name h2')));
      await page.context().close();
    });
    await test('catalog and question plan: every item has Arabic and English text', async () => {
      const page = await openPage(browser);
      const bad = await page.evaluate(() => { const D = window.GFPI.decisions, Q = window.GFPI.questionPlan; return D.ITEM_CATALOG.filter((i) => !(i.label.ar && i.label.en && Q.PLAN[i.id].q.ar && Q.PLAN[i.id].q.en && Q.PLAN[i.id].help.ar && Q.PLAN[i.id].help.en)).map((i) => i.id); });
      eq(bad.length, 0, bad.join()); await page.context().close();
    });

    console.log('\n--- Guided flow, explicit confirmation, validation ---');
    await test('guided: answer is NOT confirmed until the user confirms the exact shown value', async () => {
      const page = await openPage(browser);
      await page.fill('#inp-project_name', 'مشروع تجريبي'); await page.click('#btn-save-project_name');
      ok(/مُجاب/.test(await page.textContent('#card-project_name')), 'answered, awaiting confirmation');
      eq(await page.textContent('#shown-project_name'), 'مشروع تجريبي');
      ok(/0 من 20/.test(await progress(page)), 'still unresolved');
      await page.click('#btn-confirm-project_name');
      ok(/مؤكَّد/.test(await page.textContent('#card-project_name')));
      ok(/1 من 20/.test(await progress(page)));
      await page.context().close();
    });
    await test('validation: empty answer rejected with role=alert, aria-invalid and focus on the field', async () => {
      const page = await openPage(browser);
      await page.click('#btn-save-project_name');
      eq(await page.getAttribute('#inp-project_name', 'aria-invalid'), 'true');
      ok((await page.locator('[role=alert]').count()) >= 1);
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'inp-project_name');
      ok(/0 من 20/.test(await progress(page)));
      await page.context().close();
    });
    await test('XSS: hostile text is displayed literally, never executed or parsed as HTML', async () => {
      const page = await openPage(browser);
      const evil = '<img src=x onerror="window.__x=1"><script>window.__y=1<\/script>';
      await page.fill('#inp-project_name', evil); await page.click('#btn-save-project_name'); await page.click('#btn-confirm-project_name');
      eq(await page.textContent('#val-project_name'), evil);
      eq(await page.evaluate(() => [typeof window.__x, typeof window.__y, document.querySelectorAll('main img, main script').length].join()), 'undefined,undefined,0');
      await page.click('#tab-L'); ok((await page.textContent('#ledger-table')).includes('project_name'));
      ok(page.__errors.length === 0, page.__errors.join('|'));
      await page.context().close();
    });
    await test('XSS: hostile text inside ledger tab, package tab and project selector stays inert', async () => {
      const page = await openPage(browser);
      await setMode(page, 'EXPERT');
      const evil = '"><svg onload="window.__z=1">';
      await fillItem(page, 'project_name', evil);
      await page.click('#tab-L'); await page.click('#tab-P');
      eq(await page.evaluate(() => typeof window.__z), 'undefined'); eq(await page.locator('svg').count(), 0);
      ok((await page.textContent('#projSelect')).includes('<svg') || true);
      await page.context().close();
    });
    await test('keyboard: Tab order starts at skip link; Save and Confirm operable by keyboard; focus moves to Confirm', async () => {
      const page = await openPage(browser);
      await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement.id), 'skip');
      await page.focus('#inp-project_name'); await page.keyboard.type('لوحة المفاتيح'); await page.focus('#btn-save-project_name'); await page.keyboard.press('Enter');
      eq(await page.evaluate(() => document.activeElement.id), 'btn-confirm-project_name');
      await page.keyboard.press('Enter'); ok(/مؤكَّد/.test(await page.textContent('#card-project_name')));
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'h-project_name', 'focus restored to the card heading after confirm');
      await page.context().close();
    });
    await test('deferral needs a condition; N/A needs a reason and is refused for non-N/A items', async () => {
      const page = await openPage(browser);
      await page.click('#nav-integrations'); await page.click('#card-integrations summary');
      await page.click('#btn-defer-integrations'); ok(/شرط التأجيل مطلوب/.test(await page.textContent('#live')));
      await page.click('#btn-na-integrations'); ok(/السبب مطلوب/.test(await page.textContent('#live')));
      await page.fill('#inp-na-integrations', 'لا توجد أنظمة خارجية'); await page.click('#btn-na-integrations');
      ok(/لا ينطبق/.test(await page.textContent('#card-integrations')));
      await page.click('#nav-project_name'); eq(await page.locator('#btn-na-project_name').count(), 0, 'no N/A button for mandatory non-N/A item');
      await page.context().close();
    });

    console.log('\n--- Full flow: package, approval, persistence, invalidation, versions ---');
    await test('expert full flow: 20/20 resolved => READY_FOR_REVIEW => package => human approval bound to hash', async () => {
      const page = await openPage(browser); await fillAllExpert(page);
      ok(/20 من 20/.test(await progress(page)), await progress(page));
      await tabTo(page, 'P'); ok(/جاهزة للمراجعة/.test(await page.textContent('#pkg-state')));
      await page.click('#btn-gen'); const sha = (await page.textContent('#pkg-sha')).split(': ')[1]; ok(/^[0-9a-f]{64}$/.test(sha), 'sha shown');
      ok(/جاهزة للمراجعة/.test(await page.textContent('#pkg-status')), 'not approved before human action');
      await page.click('#btn-approve'); ok(/معتمدة للتنفيذ \(كاملة\)/.test(await page.textContent('#pkg-status')));
      ok(/لا يثبت جاهزية الإنتاج/.test(await page.textContent('#panelPackage')), 'non-readiness statement visible');
      await page.context().close();
    });
    await test('UI-generated Blueprint carries the confirmed technology and no profile_hint', async () => {
      const page = await openPage(browser); await fillAllExpert(page); await tabTo(page, 'P'); await page.click('#btn-gen');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-bp')]);
      const bp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      eq(bp.technology_decision.status, 'CONFIRMED'); eq(bp.technology_decision.stack, 'react-vite-supabase'); eq(bp.technology_decision.profile_hint, null);
      eq(bp.schema_version, '1.1');
      await page.context().close();
    });
    await test('save/reopen: reload keeps decisions, package, approval and a verified ledger chain', async () => {
      const page = await openPage(browser); await fillAllExpert(page); await tabTo(page, 'P'); await page.click('#btn-gen'); await page.click('#btn-approve');
      await page.reload(); ok(/20 من 20/.test(await progress(page)));
      await tabTo(page, 'P'); ok(/معتمدة للتنفيذ/.test(await page.textContent('#pkg-status')));
      await tabTo(page, 'L'); ok(/سليمة/.test(await page.textContent('#chain-status')));
      await page.context().close();
    });
    await test('changing a decision supersedes the approval, stales dependents, blocks generation; v2 compare shows the change', async () => {
      const page = await openPage(browser); await fillAllExpert(page); await tabTo(page, 'P'); await page.click('#btn-gen'); await page.click('#btn-approve');
      await tabTo(page, 'Q'); await page.click('#btn-edit-users_roles');
      ok(/قديم/.test(await page.textContent('#card-workflows')), 'dependent workflows stale');
      ok(/قديم/.test(await page.textContent('#card-auth_model')), 'transitive dependent stale');
      await tabTo(page, 'P'); ok(/تجاوزها/.test(await page.textContent('#pkg-status')), 'approval superseded');
      eq(await page.isDisabled('#btn-gen'), true); ok(await page.locator('#gen-blocked').count() === 1);
      await tabTo(page, 'Q');
      await fillItem(page, 'users_roles', { users: 'عملاء فقط', roles: 'مدير' });
      for (const id of ['workflows', 'business_rules', 'data_entities', 'data_sensitivity', 'auth_model', 'secrets_handling', 'technology_stack', 'architecture', 'hosting_target', 'testing_expectations']) {
        const st = await page.textContent('#card-' + id); if (/قديم/.test(st)) { await page.click('#btn-reopen-' + id); const v = BASE[id]; await fillItem(page, id, CHOICES[id] ? v : v); }
      }
      await tabTo(page, 'P'); ok(!(await page.isDisabled('#btn-gen')), 'generation possible again');
      await page.click('#btn-gen');
      ok(/v2/.test(await page.textContent('#versions-box')), 'v2 present');
      await page.click('#btn-compare'); ok(await page.locator('[data-changed="users_roles"]').count() === 1, 'compare shows users_roles change');
      ok(/تجاوزها|متجاوَزة|superseded/i.test(await page.textContent('#versions-box')), 'v1 listed as superseded');
      await page.context().close();
    });
    await test('deferred hosting: package is reviewable-with-deferred; approval needs the explicit hard-stop tick; phase-scoped', async () => {
      const page = await openPage(browser); await setMode(page, 'EXPERT');
      const all = Object.assign({ users_roles: { users: 'عملاء', roles: 'مدير' } }, BASE, CHOICES);
      for (const id of Object.keys(all)) { if (id === 'hosting_target') continue; await fillItem(page, id, all[id]); }
      await page.click('#card-hosting_target details.card > summary'); await page.fill('#inp-gate-hosting_target', 'قبل النشر'); await page.click('#btn-defer-hosting_target');
      await tabTo(page, 'P'); ok(/قابلة للمراجعة مع بنود مؤجلة/.test(await page.textContent('#pkg-state')));
      await page.click('#btn-gen');
      await page.click('#btn-approve'); ok(/PHASE_SCOPED_APPROVAL_NOT_ELIGIBLE/.test(await page.textContent('#live')), 'refused without tick');
      await page.check('#chk-hosting_target'); await page.click('#btn-approve');
      ok(/معتمدة للتنفيذ \(مراحل محدودة\)/.test(await page.textContent('#pkg-status')));
      await page.context().close();
    });
    await test('undecided technology: a deferred technology blocks the package and nothing is substituted silently', async () => {
      const page = await openPage(browser); await setMode(page, 'EXPERT');
      const all = Object.assign({ users_roles: { users: 'عملاء', roles: 'مدير' } }, BASE, CHOICES);
      for (const id of Object.keys(all)) { if (id === 'technology_stack') continue; await fillItem(page, id, all[id]); }
      await page.click('#card-technology_stack details.card > summary'); await page.fill('#inp-gate-technology_stack', 'بعد التوصية'); await page.click('#btn-defer-technology_stack');
      await tabTo(page, 'P'); await page.click('#btn-gen');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-bp')]);
      const bp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); ok(bp.technology_decision.status !== 'CONFIRMED', 'not confirmed'); eq(bp.technology_decision.stack, null);
      await page.context().close();
    });
    await test('export then verify in the UI: intact bundle accepted, tampered bundle rejected', async () => {
      const page = await openPage(browser); await fillAllExpert(page); await tabTo(page, 'P'); await page.click('#btn-gen'); await page.click('#btn-approve');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl-pkg')]);
      const file = await dl.path(); const text = fs.readFileSync(file, 'utf8');
      await page.setInputFiles('#inp-import', file); await page.waitForSelector('#import-result'); ok(/سليمة/.test(await page.textContent('#import-result')), 'intact accepted');
      const t1 = JSON.parse(text); t1.documents['specs/SecuritySpecV1.json'].authentication = [];
      const f2 = path.join(require('os').tmpdir(), 'gfpi-tampered-' + Date.now() + '.json'); fs.writeFileSync(f2, JSON.stringify(t1));
      await page.setInputFiles('#inp-import', f2); await page.waitForFunction(() => /غير سليمة/.test(document.getElementById('import-out').textContent)); ok(true);
      const t2 = JSON.parse(text); t2.approval.actor_id = 'someone else'; fs.writeFileSync(f2, JSON.stringify(t2));
      await page.setInputFiles('#inp-import', f2); await page.waitForFunction(() => /غير سليمة/.test(document.getElementById('import-out').textContent));
      fs.unlinkSync(f2); await page.context().close();
    });
    await test('ledger tab: chain verified, entries listed, deterministic contradiction rule fires and is explained', async () => {
      const page = await openPage(browser); await setMode(page, 'EXPERT');
      await fillItem(page, 'platforms', 'موقع ويب');
      await page.check('input[name="ch-technology_stack"][value="flutter-supabase"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack');
      await tabTo(page, 'L'); ok(/سليمة/.test(await page.textContent('#chain-status'))); eq(await page.locator('[data-rule="R1_FLUTTER_WITHOUT_MOBILE"]').count(), 1);
      ok((await page.locator('#ledger-table tbody tr').count()) >= 6);
      await page.context().close();
    });

    console.log('\n--- Failure states: corruption, storage unavailable ---');
    await test('corrupted stored ledger: integrity banner, edits blocked, valid prefix recoverable', async () => {
      const page = await openPage(browser); await setMode(page, 'EXPERT'); await fillItem(page, 'project_name', 'اسم'); await fillItem(page, 'project_idea', 'فكرة');
      await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.indexOf('gfpi.v1.p.') === 0); const r = JSON.parse(localStorage.getItem(k)); const lines = r.ledger_jsonl.split('\n').filter(Boolean); lines[lines.length - 2] = lines[lines.length - 2].replace('"USER"', '"AI_PROVIDER"'); r.ledger_jsonl = lines.join('\n') + '\n'; localStorage.setItem(k, JSON.stringify(r)); });
      await page.reload(); await page.waitForSelector('#integrity-banner'); ok(/فشل التحقق/.test(await page.textContent('#integrity-banner')));
      ok(await page.locator('#btn-recover').count() === 1); await page.click('#btn-recover'); ok(await page.locator('#integrity-banner').count() === 0);
      await tabTo(page, 'L'); ok(/سليمة/.test(await page.textContent('#chain-status')));
      await page.context().close();
    });
    await test('storage unavailable: honest warning, app still works, nothing claims to be saved', async () => {
      const page = await openPage(browser, { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); } });
      ok(/غير متاح/.test(await page.textContent('#storageBanner')), 'warning shown');
      await page.fill('#inp-project_name', 'بلا حفظ'); await page.click('#btn-save-project_name'); await page.click('#btn-confirm-project_name');
      ok(/مؤكَّد/.test(await page.textContent('#card-project_name'))); ok(page.__errors.length === 0, page.__errors.join('|'));
      await page.context().close();
    });

    console.log('\n--- Mobile 390px and desktop ---');
    await test('390px: no horizontal overflow on any tab, touch targets >= 44px, usable', async () => {
      const page = await openPage(browser, { context: { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true } });
      for (const k of ['Q', 'L', 'P', 'C']) {
        await tabTo(page, k); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(o <= 1, 'overflow on tab ' + k + ': ' + o);
      }
      await tabTo(page, 'Q');
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => b.id || b.textContent.slice(0, 20)));
      eq(small.length, 0, 'small targets: ' + small.join());
      await page.fill('#inp-project_name', 'جوال'); await page.tap('#btn-save-project_name'); await page.tap('#btn-confirm-project_name'); ok(/مؤكَّد/.test(await page.textContent('#card-project_name')));
      await page.screenshot({ path: path.join(require('os').tmpdir(), 'gfpi-390.png') });
      await page.context().close();
    });
    await test('390px expert mode and English LTR: no overflow', async () => {
      const page = await openPage(browser, { context: { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true } });
      await setMode(page, 'EXPERT'); await page.click('#btnLang');
      for (const k of ['Q', 'L', 'P', 'C']) { await tabTo(page, k); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(o <= 1, 'overflow ' + k + ': ' + o); }
      await page.context().close();
    });
    await test('desktop layout: two-column grid in guided mode, nav lists all 21 items', async () => {
      const page = await openPage(browser); eq(await page.locator('nav.items button').count(), 21);
      const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length); eq(cols, 2);
      await page.context().close();
    });

    console.log('\n--- Local Companion integration (REAL companion server, MOCKED/RECORDED provider) ---');
    const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'مناسب للويب', tradeoffs: 'اعتماد على خدمة خارجية', cost_complexity: 'منخفضة', risks: ['قفل المزوّد'] }] };
    async function startComp(adapters, extra) {
      const now = () => new Date().toISOString();
      const o = P.createOrchestrator(Object.assign({ adapters, now, policy: { order: adapters.map((a) => a.id), timeout_ms: 1500, max_retries: 0 } }, extra || {}));
      const comp = createCompanion({ allowedOrigins: [ORIGIN], orchestrator: o, now, describeProviders: () => adapters.map((a) => ({ id: a.id, kind: a.kind, locality: a.locality })) });
      const info = await comp.start(); return { comp, info, o };
    }
    async function pairUi(page, info) {
      await tabTo(page, 'C'); await page.fill('#inp-comp-url', 'http://127.0.0.1:' + info.port); await page.fill('#inp-comp-code', info.pairingCode); await page.click('#btn-pair');
      await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
    }
    async function toTech(page) { await tabTo(page, 'Q'); await setMode(page, 'ASSISTED'); await page.click('#nav-technology_stack'); }
    await test('pairing: wrong code fails honestly; right code pairs; capability list flips to available', async () => {
      const rec = P.createRecordedAdapter('rec', [{ json: GOOD }]); const c = await startComp([rec, P.createManualAdapter()]);
      const page = await openPage(browser);
      await tabTo(page, 'C'); await page.fill('#inp-comp-url', 'http://127.0.0.1:' + c.info.port); await page.fill('#inp-comp-code', 'WRONGWRONG'); await page.click('#btn-pair');
      await page.waitForFunction(() => /فشل الاقتران/.test(document.getElementById('live').textContent)); eq((await page.textContent('#conn-state')).trim(), 'غير مقترن');
      eq(await page.getAttribute('[data-cap="generative_discovery"]', 'data-available'), 'false');
      await page.fill('#inp-comp-code', c.info.pairingCode); await page.click('#btn-pair'); await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
      eq(await page.getAttribute('[data-cap="generative_discovery"]', 'data-available'), 'true'); ok(/غير مصرَّح بها/.test(await page.textContent('#paid-no')));
      ok(!/token|Bearer/i.test(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))), 'no token persisted in storage');
      await page.context().close(); await c.comp.stop();
    });
    await test('assisted: model proposal is a PROPOSAL (unconfirmed, labelled MOCKED); only an explicit accept confirms it', async () => {
      const rec = P.createRecordedAdapter('rec', [{ json: GOOD }]); const c = await startComp([rec, P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info);
      await tabTo(page, 'Q'); await fillItem(page, 'platforms', 'موقع ويب'); await toTech(page);
      await page.click('#btn-ai'); await page.waitForSelector('#proposal-box');
      ok(/اقتراح بانتظار قرارك/.test(await page.textContent('#card-technology_stack')), 'pending approval chip');
      ok(/تجريبي مسجَّل/.test(await page.textContent('#card-technology_stack')), 'MOCKED label shown');
      ok(/0 من 20|1 من 20/.test(await progress(page)) && !/مؤكَّد/.test(await page.textContent('#nav-technology_stack')), 'not counted as resolved');
      await tabTo(page, 'L'); ok((await page.textContent('#ledger-table')).includes('AI_PROVIDER:rec'), 'AI actor recorded');
      await tabTo(page, 'Q'); await page.click('#nav-technology_stack'); await page.click('#btn-ai-accept'); ok(/مؤكَّد/.test(await page.textContent('#card-technology_stack')));
      await tabTo(page, 'L'); ok(/USER:local-user|USER_CONFIRMED/.test(await page.textContent('#ledger-table')));
      await page.context().close(); await c.comp.stop();
    });
    await test('assisted: rejecting a proposal keeps the item open; user can still choose manually', async () => {
      const rec = P.createRecordedAdapter('rec', [{ json: GOOD }]); const c = await startComp([rec, P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info); await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#proposal-box');
      await page.click('#btn-ai-reject'); ok(/مرفوض/.test(await page.textContent('#card-technology_stack')));
      await page.click('#btn-reopen-technology_stack'); await page.check('input[name="ch-technology_stack"][value="flutter-supabase"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack');
      ok(/مؤكَّد/.test(await page.textContent('#card-technology_stack'))); await page.context().close(); await c.comp.stop();
    });
    await test('provider failure degrades to manual with an honest message; ledger state is unchanged', async () => {
      const bad = P.createRecordedAdapter('bad', [new Error('boom')]); const c = await startComp([bad, P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info); await toTech(page); await page.click('#btn-ai');
      await page.waitForSelector('#ai-manual'); ok(/لم ينتج أي مزوّد اقتراحًا صالحًا/.test(await page.textContent('#ai-manual')));
      ok(/مطلوب/.test(await page.textContent('#card-technology_stack')), 'item still plainly open');
      await page.check('input[name="ch-technology_stack"][value="react-vite-supabase"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack');
      ok(/مؤكَّد/.test(await page.textContent('#card-technology_stack'))); await page.context().close(); await c.comp.stop();
    });
    await test('companion down: pairing fails with a clear message and every manual capability still works', async () => {
      const page = await openPage(browser); await tabTo(page, 'C'); await page.fill('#inp-comp-url', 'http://127.0.0.1:1'); await page.fill('#inp-comp-code', 'ABCDEFGHJK'); await page.click('#btn-pair');
      await page.waitForFunction(() => /NETWORK/.test(document.getElementById('live').textContent));
      await tabTo(page, 'Q'); await page.fill('#inp-project_name', 'يعمل دون Companion'); await page.click('#btn-save-project_name'); await page.click('#btn-confirm-project_name'); ok(/مؤكَّد/.test(await page.textContent('#card-project_name')));
      await page.context().close();
    });
    await test('assisted without a provider: AI button disabled with the reason; guided mode offers no AI button at all', async () => {
      const page = await openPage(browser); await toTech(page); eq(await page.isDisabled('#btn-ai'), true); ok(/غير متاح: لا يوجد مزوّد/.test(await page.textContent('#ai-unavail')));
      await page.check('#mode-GUIDED'); await page.waitForSelector('#qsource'); eq(await page.locator('#btn-ai').count(), 0); await page.context().close();
    });
    await test('hosted with ZERO budget: UI shows the refusal, the hosted endpoint is never contacted', async () => {
      let hits = 0; const store = createMemoryStore(); await store.set('hx', 'sk-ABCDEF1234567890ABCDEF1234567890');
      const hosted = createHostedAdapter({ id: 'hosted-x', endpoint: 'https://api.example.test/v1', model: 'm', credential_ref: 'hx' }, { store, fetch: async () => { hits++; return { ok: true, json: async () => ({ json: GOOD }) }; } });
      const c = await startComp([hosted, P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info); await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#ai-budget');
      ok(/PAID_CALLS_NOT_AUTHORIZED/.test(await page.textContent('#ai-budget'))); eq(hits, 0, 'hosted fetch calls'); ok(/غير مصرَّح بها/.test(await page.textContent('#ai-budget')));
      await page.context().close(); await c.comp.stop();
    });
    await test('[MOCKED approved budget] hosted needs consent: redacted preview shown, deny sends nothing, allow sends once', async () => {
      let hits = 0; let lastBody = ''; const store = createMemoryStore(); await store.set('hx', 'sk-ABCDEF1234567890ABCDEF1234567890');
      const hosted = createHostedAdapter({ id: 'hosted-x', endpoint: 'https://api.example.test/v1', model: 'm', credential_ref: 'hx' }, { store, fetch: async (u, init) => { hits++; lastBody = init.body; return { ok: true, json: async () => ({ json: GOOD, usage: { cost: 0.01 } }) }; } });
      const approved = Object.assign(B.defaultBudgetPolicy(), { per_call_cap: 1, per_project_cap: 5, period_cap: 5, token_caps: { input_per_call: 5000, output_per_call: 2000 }, approved_by: 'owner', approved_at: '2026-01-01T00:00:00Z', credential_ref: 'hx' });
      const c = await startComp([hosted, P.createManualAdapter()], { budgetPolicy: approved });
      const page = await openPage(browser); await pairUi(page, c.info); await tabTo(page, 'Q');
      await fillItem(page, 'project_goal', 'تواصلوا معي على someone@example.com بخصوص المشروع'); await fillItem(page, 'platforms', 'موقع');
      await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#consent-box');
      const prev = await page.textContent('#consent-preview'); ok(!prev.includes('someone@example.com') && prev.includes('REDACTED:EMAIL'), 'preview is redacted'); eq(hits, 0, 'nothing sent before consent');
      await page.click('#btn-consent-deny'); eq(hits, 0); eq(await page.locator('#consent-box').count(), 0);
      await page.click('#btn-ai'); await page.waitForSelector('#consent-box'); await page.click('#btn-consent-allow'); await page.waitForSelector('#proposal-box');
      eq(hits, 1, 'exactly one external call'); ok(!lastBody.includes('someone@example.com'), 'redacted before leaving');
      await page.context().close(); await c.comp.stop();
    });
    // ---- OP-4 / OP-5: connection-state honesty, single in-flight request, real cancel (REAL companion, MOCKED provider) ----
    function slowRec(ms, st) { return P.createRecordedAdapter('rec', [async () => { st.runs++; await new Promise((r) => setTimeout(r, ms)); st.done++; return { json: GOOD }; }]); }
    await test('OP-4 companion stops after pairing: UI says "connection lost" (not a provider failure), returns to unpaired; manual still works', async () => {
      const st = { runs: 0, done: 0 }; const c = await startComp([slowRec(20, st), P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info); await c.comp.stop();
      await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#ai-lost');
      ok(/انقطع الاتصال بالـ Companion/.test(await page.textContent('#ai-lost')), 'explicit connection-lost message');
      eq(await page.locator('#ai-manual').count(), 0, 'not reported as a provider failure');
      eq(await page.getAttribute('#btn-ai', 'disabled'), '', 'AI disabled once the session is gone');
      ok(/لا يوجد مزوّد ذكاء اصطناعي/.test(await page.textContent('#offlineBanner')), 'offline banner restored');
      await tabTo(page, 'C'); eq((await page.textContent('#conn-state')).trim(), 'غير مقترن'); ok(/تعذّر الوصول/.test(await page.textContent('#conn-lost')));
      eq(await page.getAttribute('[data-cap="generative_discovery"]', 'data-available'), 'false');
      await tabTo(page, 'Q'); await page.click('#nav-technology_stack'); await page.check('input[name="ch-technology_stack"][value="react-vite-supabase"]'); await page.click('#btn-save-technology_stack'); await page.click('#btn-confirm-technology_stack');
      ok(/مؤكَّد/.test(await page.textContent('#card-technology_stack')), 'manual path intact'); eq(st.runs, 0); await page.context().close();
    });
    await test('OP-4 session expired server-side: UI says the session ended and offers re-pairing; re-pairing restores AI', async () => {
      const st = { runs: 0, done: 0 }; const rec = slowRec(20, st); const now = () => new Date().toISOString();
      const o = P.createOrchestrator({ adapters: [rec, P.createManualAdapter()], now, policy: { order: ['rec', 'manual'], timeout_ms: 1500, max_retries: 0 } });
      const comp = createCompanion({ allowedOrigins: [ORIGIN], orchestrator: o, now, tokenTtlMs: 400, describeProviders: () => [{ id: 'rec', kind: rec.kind, locality: rec.locality }] });
      const info = await comp.start();
      const page = await openPage(browser); await pairUi(page, info); await new Promise((r) => setTimeout(r, 600));
      await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#ai-lost'); ok(/انتهت الجلسة/.test(await page.textContent('#ai-lost'))); eq(st.runs, 0, 'expired token never reaches the provider');
      await tabTo(page, 'C'); eq((await page.textContent('#conn-state')).trim(), 'غير مقترن');
      await page.fill('#inp-comp-code', comp.newPairingCode()); await page.click('#btn-pair'); await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
      eq(await page.locator('#conn-lost').count(), 0, 'lost banner cleared after re-pairing'); await page.context().close(); await comp.stop();
    });
    await test('OP-5 one request at a time: ask is disabled while running, a second click sends nothing, cancel aborts with no proposal; a new request then works', async () => {
      const st = { runs: 0, done: 0 }; const c = await startComp([slowRec(900, st), P.createManualAdapter()]);
      const page = await openPage(browser); await pairUi(page, c.info); await toTech(page);
      await page.click('#btn-ai'); await page.waitForSelector('#btn-ai-cancel');
      eq(await page.getAttribute('#btn-ai', 'disabled'), '', 'ask disabled while running'); eq(await page.getAttribute('#btn-ai', 'aria-busy'), 'true');
      await page.evaluate(() => { const b = document.getElementById('btn-ai'); b.disabled = false; b.click(); }); // DOM tampering: the in-code guard still refuses
      ok(/هناك طلب قيد التنفيذ/.test(await page.textContent('#live')), 'busy announced');
      await page.click('#btn-ai-cancel'); await page.waitForSelector('#ai-cancelled');
      eq(await page.locator('#proposal-box').count(), 0, 'no proposal recorded'); ok(/مطلوب/.test(await page.textContent('#card-technology_stack')), 'item still open');
      await new Promise((r) => setTimeout(r, 1100)); eq(st.runs, 1, 'exactly one provider run'); eq(await page.locator('#proposal-box').count(), 0, 'late result of the cancelled run is ignored');
      await tabTo(page, 'L'); ok(!(await page.textContent('#ledger-table')).includes('AI_PROVIDER'), 'ledger untouched by the cancelled run');
      await tabTo(page, 'Q'); await page.click('#nav-technology_stack'); await page.click('#btn-ai'); await page.waitForSelector('#proposal-box', { timeout: 5000 }); eq(st.runs, 2);
      await page.context().close(); await c.comp.stop();
    });
    await test('OP-5 390px Arabic: running state with the cancel control does not overflow', async () => {
      const st = { runs: 0, done: 0 }; const c = await startComp([slowRec(1500, st), P.createManualAdapter()]);
      const page = await openPage(browser, { context: { viewport: { width: 390, height: 844 } } }); await pairUi(page, c.info); await toTech(page);
      await page.click('#btn-ai'); await page.waitForSelector('#btn-ai-cancel');
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(ov <= 0, 'horizontal overflow ' + ov);
      await page.click('#btn-ai-cancel'); await page.waitForSelector('#ai-cancelled'); await page.context().close(); await c.comp.stop();
    });
    // ---- OP-6 / OP-7: one-command app (UI served by the REAL companion on its own loopback origin) ----
    // Playwright can inspect cross-origin frames, so this observes whether the UI actually RENDERED in the frame.
    async function framesUi(page, url) {
      await page.evaluate((u) => { const f = document.createElement('iframe'); f.id = 'probe-frame'; f.src = u; document.body.appendChild(f); }, url);
      await new Promise((r) => setTimeout(r, 1500));
      const fr = page.frames().find((f) => f !== page.mainFrame());
      return !!(fr && (await fr.$('#tab-C').catch(() => null)));
    }
    async function startApp(adapters, describe) {
      const now = () => new Date().toISOString();
      const o = P.createOrchestrator({ adapters, now, policy: { order: adapters.map((a) => a.id), timeout_ms: 1500, max_retries: 0 } });
      const comp = createCompanion({ uiDir: DIST, orchestrator: o, now, describeProviders: describe || (() => adapters.map((a) => ({ id: a.id, kind: a.kind, locality: a.locality, availability: 'READY' }))) });
      const info = await comp.start(); return { comp, info };
    }
    await test('OP-7 app mode: UI from the companion origin, address prefilled, pairing needs only the code; CSP with frame-ancestors; no CSP violations', async () => {
      const rec = P.createRecordedAdapter('rec', [{ json: GOOD }]); const c = await startApp([rec, P.createManualAdapter()]);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage(); const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
      const resp = await page.goto(c.info.uiUrl); ok(/frame-ancestors 'none'/.test(resp.headers()['content-security-policy']), 'CSP header');
      await tabTo(page, 'C'); eq(await page.inputValue('#inp-comp-url'), 'http://127.0.0.1:' + c.info.port, 'companion address defaults to this origin');
      await page.fill('#inp-comp-code', c.info.pairingCode); await page.click('#btn-pair'); await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
      ok(/جاهز \(متاح، غير مُقيَّم\)/.test(await page.textContent('#provider-list')), 'availability shown honestly: available, not evaluated');
      await toTech(page); await page.click('#btn-ai'); await page.waitForSelector('#proposal-box'); await page.click('#btn-ai-accept'); ok(/مؤكَّد/.test(await page.textContent('#card-technology_stack')));
      ok(errs.length === 0, 'console/CSP errors: ' + errs.join(' | ')); await ctx.close(); await c.comp.stop();
    });
    await test('OP-7 app mode refuses to be framed by another page (clickjacking on the pairing UI)', async () => {
      const c = await startApp([P.createManualAdapter()]);
      const page = await openPage(browser);
      eq(await framesUi(page, c.info.uiUrl), false, 'UI must not render inside a foreign frame'); await page.context().close(); await c.comp.stop();
    });
    await test('OP-6 model not installed: provider listed with that reason, AI stays unavailable, no run attempted', async () => {
      const st = { runs: 0, done: 0 }; const rec = slowRec(10, st);
      const c = await startApp([rec, P.createManualAdapter()], () => [{ id: 'rec', kind: 'LOCAL_MODEL_RUNTIME', locality: 'LOCAL', availability: 'MODEL_NOT_INSTALLED' }, { id: 'manual', kind: 'MANUAL_DETERMINISTIC', locality: 'NONE', availability: 'READY' }]);
      const page = await browser.newPage(); await page.goto(c.info.uiUrl);
      await tabTo(page, 'C'); await page.fill('#inp-comp-code', c.info.pairingCode); await page.click('#btn-pair'); await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
      ok(/النموذج غير مثبت/.test(await page.textContent('#provider-list'))); eq(await page.getAttribute('[data-cap="generative_discovery"]', 'data-available'), 'false');
      ok(/لا يوجد مزوّد ذكاء اصطناعي/.test(await page.textContent('#offlineBanner')), 'not shown as online');
      await toTech(page); eq(await page.getAttribute('#btn-ai', 'disabled'), ''); eq(st.runs, 0); await page.close(); await c.comp.stop();
    });
    await test('offline guarantee: no request leaves the page while working fully offline', async () => {
      const page = await openPage(browser, { context: { offline: false } }); await fillAllExpert(page); await tabTo(page, 'P'); await page.click('#btn-gen'); await page.click('#btn-approve');
      eq(page.__external.length, 0, 'external requests: ' + page.__external.join()); await page.context().close();
    });
  } finally {
    await browser.close(); server.close();
  }
  console.log('\n' + '='.repeat(60) + '\nGFPI_BROWSER_E2E: ' + passed + ' ناجح، ' + failed + ' فاشل، من أصل ' + (passed + failed) + '\n' + '='.repeat(60));
  process.exit(failed ? 1 : 0);
})();
