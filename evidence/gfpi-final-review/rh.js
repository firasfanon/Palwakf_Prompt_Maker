#!/usr/bin/env node
'use strict';
/**
 * Real-browser UAT for the Full-Production / SaaS tab of dist/guided.html (real Chromium via the pinned playwright driver).
 * The "user" is a SIMULATED test actor: results are NOT human acceptance testing. No provider, no network, no paid call.
 * Optional: GFPI_UI_SHOTS=<absolute dir> saves screenshots; GFPI_UI_RESULTS=<absolute file> writes a JSON results record.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('/tmp/claude-0/-home-claude/08b8c8c2-6cf8-4695-b690-d26fc7bf7c3e/scratchpad/pbv/m/node_modules/playwright');

const PORT = 4186; const ORIGIN = 'http://127.0.0.1:' + PORT; const DIST = '/tmp/claude-0/review/clone/dist';
const SHOTS = process.env.GFPI_UI_SHOTS || ''; const RESULTS = process.env.GFPI_UI_RESULTS || '';
let passed = 0; let failed = 0; const record = [];
async function test(name, fn) { try { await fn(); passed++; record.push({ name, result: 'PASS' }); console.log('  ✅ ' + name); } catch (e) { failed++; record.push({ name, result: 'FAIL', error: String(e && e.message) }); console.log('  ❌ ' + name + ' — ' + (e && e.message)); } }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const BASE = {
  project_name: 'مدير العيادات', project_idea: 'منصة اشتراكات تدير بها عدة عيادات مواعيدها ومرضاها', project_goal: 'تسهيل إدارة المواعيد للعيادات الصغيرة', success_measures: '50 عيادة مشتركة خلال ستة أشهر',
  workflows: 'تسجيل عيادة، حجز موعد، إلغاء، تقرير شهري', scope: 'المواعيد والمرضى فقط', business_rules: 'لا يرى مستخدم بيانات عيادة أخرى', platforms: 'موقع ويب', languages: 'العربية والإنجليزية',
  data_entities: 'عيادات، مرضى، مواعيد', integrations: 'بريد إلكتروني ودفع اشتراكات', auth_model: 'بريد وكلمة مرور', secrets_handling: 'متغيرات بيئة', availability_targets: '5000 مستخدم',
  architecture: 'خدمة سحابية', hosting_target: 'سحابة', testing_expectations: 'شامل',
};
const CHOICES = { data_sensitivity: 'PERSONAL', technology_stack: 'react-vite-supabase' };
const NONTECH = 'أريد إنشاء منصة SaaS متكاملة وجاهزة للإنتاج، لكنني لا أعرف البرمجة أو قواعد البيانات أو الأمن أو DevOps. ساعدني في اتخاذ القرارات المناسبة.';

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
  const page = await ctx.newPage(); page.__errors = []; page.__external = []; page.__dialogs = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push(m.text()); });
  page.on('dialog', (d) => { page.__dialogs.push(d.message()); d.dismiss(); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) page.__external.push(u); });
  await page.goto(ORIGIN + '/guided.html'); return page;
}
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
const setMode = async (page, m) => { await page.check('#mode-' + m); };
const tabTo = async (page, k) => { await page.click('#tab-' + k); };
const sub = async (page, k) => { await page.click('#ptab-' + k); };
async function fillItem(page, id, value) {
  if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id);
  if (id === 'users_roles') { await page.fill('#inp-users_roles-users', value.users); await page.fill('#inp-users_roles-roles', value.roles); }
  else if (CHOICES[id]) await page.check('input[name="ch-' + id + '"][value="' + CHOICES[id] + '"]');
  else await page.fill('#inp-' + id, value);
  await page.click('#btn-save-' + id); await page.click('#btn-confirm-' + id);
}
async function deferItem(page, id, gate) {
  if ((await page.locator('#card-' + id).count()) === 0) await page.click('#nav-' + id);
  await page.locator('#card-' + id + ' details > summary').first().click(); await page.fill('#inp-gate-' + id, gate); await page.click('#btn-defer-' + id);
}
async function fillBase(page, opts) {
  opts = opts || {}; const all = Object.assign({ users_roles: { users: 'عملاء وموظفون', roles: 'مدير، موظف' } }, BASE, CHOICES);
  for (const id of Object.keys(all)) { if (id === 'technology_stack' && opts.deferStack) { await deferItem(page, id, 'سأقرر بعد توصية النظام'); continue; } if (opts.skip && opts.skip.indexOf(id) !== -1) continue; await fillItem(page, id, all[id]); }
}
async function startProd(page, intent, o) {
  o = o || {}; await tabTo(page, 'F'); await sub(page, 'D'); await page.fill('#prod-intent', intent);
  if (o.fp) await page.check('#prod-explicit-fp'); if (o.saas) await page.check('#prod-explicit-saas');
  await page.click('#btn-prod-start'); await page.waitForSelector('#pprogress, #pnot-active');
}
async function confirmAllPending(page) { let n = 0; while ((await page.locator('[id^="pbtn-confirm-"]').count()) > 0 && n < 120) { await page.locator('[id^="pbtn-confirm-"]').first().click(); n++; } return n; }
async function answerNext(page, id, value) {
  await page.check('input[name="pch-' + id + '"][value="' + value + '"]'); await page.click('#pbtn-use-' + id);
}
async function stored(page) { return page.evaluate(() => { const idx = JSON.parse(localStorage.getItem('gfpi.v1.index') || '[]'); const id = idx[idx.length - 1].id; return JSON.parse(localStorage.getItem('gfpi.v1.p.' + id)); }); }
function prodEntries(rec) { return rec.prod ? rec.prod.ledger_jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }
async function fullJourney(page, o) {
  o = o || {};
  await setMode(page, 'GUIDED'); await tabTo(page, 'Q'); await fillBase(page, { deferStack: true });
  await startProd(page, o.intent || NONTECH);
  // plain answers the simulated founder can give; everything else: "suggest the rest"
  if ((await page.locator('#pcard-tenancy_model').count()) && !o.noTenancy) await answerNext(page, 'tenancy_model', o.tenancy || 'MULTI_TENANT');
  for (let i = 0; i < 6; i++) { if (!(await page.locator('#btn-prod-recommend').isEnabled())) break; await page.click('#btn-prod-recommend'); await confirmAllPending(page); }
}

module.exports = { chromium, test, eq, ok, startStatic, openPage, shot, setMode, tabTo, sub, fillItem, deferItem, fillBase, startProd, confirmAllPending, answerNext, stored, prodEntries, fullJourney, BASE, CHOICES, NONTECH, ORIGIN, getCounts: () => ({ passed, failed, record }) };
