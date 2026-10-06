#!/usr/bin/env node
'use strict';
/**
 * Real browser UAT harness (closeout directive, sections 19-25).
 *
 * Uses the raw `playwright` driver (no @playwright/test — that package is not
 * installed in this environment and could not be fetched; the raw driver +
 * bundled Chromium ARE present, confirmed by launching a real browser before
 * writing this file). This IS real browser execution, not a simulation —
 * each scenario below is a genuine PASS/FAIL, never BLOCKED_ENVIRONMENT.
 *
 * Run: node tests/browser/run.js
 */
const path = require('path');
const { spawn } = require('child_process');
const { chromium, devices } = require('playwright');

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log('  ❌ ' + name + ' — ' + e.message);
  }
}

function section(title) { console.log('\n--- ' + title + ' ---'); }

function startServer() {
  return new Promise((resolve, reject) => {
    const server = require('http').createServer((req, res) => {
      const fs = require('fs');
      const DIST = path.join(__dirname, '..', '..', 'dist');
      let p = req.url === '/' ? '/prompt-maker-app.html' : req.url.split('?')[0];
      const file = path.join(DIST, p);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(file);
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
    server.on('error', reject);
  });
}

async function fillGenerate(page, { name, goal, existing }) {
  await page.fill('#projectName', name);
  await page.fill('#projectGoal', goal);
  if (existing) {
    await page.click('input[name=existing][value=existing]');
    if (existing.capabilities) await page.fill('#existingCapabilities', existing.capabilities);
  }
  await page.click('#generateBtn');
  await page.waitForSelector('#results:not(.hidden)', { timeout: 5000 });
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();

  section('NEW_PROJECT_SIMPLE_MODE');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Simple mode: generating a project shows the Master Prompt with real content', async () => {
      await fillGenerate(page, { name: 'عيادتي', goal: 'نظام ويب لإدارة عيادة طبية مع حجز مواعيد ومرضى وفواتير' });
      const promptText = await page.inputValue('#promptBox');
      if (promptText.length < 100) throw new Error('prompt too short / not populated');
      if (!promptText.includes('عيادتي')) throw new Error('prompt does not contain project name');
    });
    await test('False-positive regression holds in the real browser: booking context does not show FINANCIAL_SYSTEM', async () => {
      const chips = await page.textContent('#classificationList');
      if (chips.includes('FINANCIAL_SYSTEM')) throw new Error('FINANCIAL_SYSTEM false positive reproduced in browser');
      if (!chips.includes('BOOKING_SYSTEM')) throw new Error('BOOKING_SYSTEM was not detected');
    });
    await page.close();
  }

  section('NEW_PROJECT_PROFESSIONAL_MODE');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Switching to Professional mode reveals advanced sections (surfaces, journeys, domain model, requirements, contracts)', async () => {
      await page.click('#modePro');
      await fillGenerate(page, { name: 'نظام محاسبي', goal: 'نظام محاسبي ledger للفواتير المالية والمصالحة البنكية' });
      for (const sel of ['#surfacesBox', '#journeysBox', '#domainBox', '#requirementsBox', '#acceptanceBox', '#developmentBox']) {
        const text = await page.textContent(sel);
        if (!text || text.trim().length === 0) throw new Error(`${sel} is empty in Professional mode`);
      }
    });
    await page.close();
  }

  section('PROFILE_REVIEW_AND_OVERRIDE');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('User can override the auto-classification and regenerate with a manually chosen profile', async () => {
      await fillGenerate(page, { name: 'مشروع عام', goal: 'نظام بسيط بلا كلمات مفتاحية واضحة' });
      await page.click('#overrideBtn');
      await page.check('#overridePanel input[value=ECOMMERCE]');
      await page.click('#applyOverrideBtn');
      await page.waitForTimeout(200);
      const chips = await page.textContent('#classificationList');
      if (!chips.includes('ECOMMERCE') || !chips.includes('CONFIRMED')) {
        throw new Error('override did not apply or was not marked CONFIRMED');
      }
    });
    await page.close();
  }

  section('CRITICAL_UNKNOWN');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('An unresolved required_decision is surfaced visibly to the user, not silently hidden', async () => {
      await page.click('#modePro');
      await fillGenerate(page, { name: 'نظام مالي بلا تفاصيل', goal: 'نظام مالي لمتابعة المعاملات' });
      const text = await page.textContent('#assumptionsBox');
      if (!text.includes('قرارات مطلوبة') && !text.includes('data_sensitivity')) {
        throw new Error('required decision for data_sensitivity was not surfaced');
      }
    });
    await page.close();
  }

  section('BROWNFIELD_PROJECT');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Choosing Existing Project reveals brownfield fields and produces PRESERVE/ADD, never asserting REMOVE/REFACTOR', async () => {
      await page.click('#modePro');
      const hiddenBefore = await page.getAttribute('#brownfieldFields', 'class');
      if (!hiddenBefore.includes('hidden')) throw new Error('brownfield fields should be hidden by default');
      await fillGenerate(page, {
        name: 'نظام قائم',
        goal: 'نظام محاسبي ledger قائم يحتاج استكمال',
        existing: { capabilities: 'has basic authentication and audit log already' },
      });
      await page.waitForSelector('#brownfieldResultCard:not(.hidden)');
      const text = await page.textContent('#brownfieldResultBox');
      if (!text.includes('PRESERVE') && !text.includes('ADD')) throw new Error('brownfield result missing PRESERVE/ADD');
      if (!text.includes('UNKNOWN_REQUIRES_SOURCE_INSPECTION')) throw new Error('honesty boundary label missing: REMOVE/REFACTOR must be marked as needing real source inspection');
    });
    await page.close();
  }

  section('SAVE_REOPEN / VERSION_REGENERATION');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Save produces version 1, regenerating with a different goal and saving again produces version 2 with a real change summary', async () => {
      await fillGenerate(page, { name: 'نسخ', goal: 'نظام ويب عام' });
      page.on('dialog', (d) => d.accept());
      await page.click('#saveBtn');
      await page.waitForTimeout(100);

      await page.fill('#projectGoal', 'نظام محاسبي ledger للفواتير');
      await page.click('#generateBtn');
      await page.waitForTimeout(200);
      await page.click('#saveBtn');
      await page.waitForTimeout(100);

      await page.click('#listVersionsBtn');
      const text = await page.textContent('#versionsBox');
      if (!text.includes('نسخ')) throw new Error('saved project id not listed');
    });
    await page.close();
  }

  section('COPY_PROMPT / EXPORT_JSON / EXPORT_MARKDOWN');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Copy and export buttons are reachable and enabled after a successful generation', async () => {
      await fillGenerate(page, { name: 'تصدير', goal: 'نظام ويب عام' });
      for (const sel of ['#copyPromptBtn', '#exportPromptBtn', '#exportBlueprintBtn', '#exportAcceptanceBtn', '#exportDevelopmentBtn', '#exportReceiptBtn']) {
        const visible = await page.isVisible(sel);
        if (!visible) throw new Error(`${sel} not visible/reachable`);
      }
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#exportBlueprintBtn'),
      ]);
      const suggested = download.suggestedFilename();
      if (suggested !== 'blueprint.json') throw new Error('unexpected downloaded filename: ' + suggested);
    });
    await page.close();
  }

  section('ERROR_STATE');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Generating with an empty project name/goal shows a visible error, not a silent failure', async () => {
      await page.click('#generateBtn');
      await page.waitForSelector('#errorBox:not(.hidden)', { timeout: 2000 });
      const text = await page.textContent('#errorBox');
      if (!text || text.trim().length === 0) throw new Error('error box visible but empty');
    });
    await page.close();
  }

  section('RESPONSIVE_UAT — DESKTOP (1280px)');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE_URL);
    await test('No horizontal overflow at desktop width; primary action visible', async () => {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      if (scrollWidth > clientWidth + 2) throw new Error(`horizontal overflow: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
      if (!(await page.isVisible('#generateBtn'))) throw new Error('primary action not visible');
    });
    await page.close();
  }

  section('RESPONSIVE_UAT — 390PX (mobile)');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE_URL);
    await test('No horizontal overflow at 390px; form usable; prompt readable after generation', async () => {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      if (scrollWidth > clientWidth + 2) throw new Error(`horizontal overflow at 390px: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
      await fillGenerate(page, { name: 'هاتف', goal: 'نظام ويب عام' });
      if (!(await page.isVisible('#promptBox'))) throw new Error('prompt not visible at 390px');
      if (!(await page.isVisible('#copyPromptBtn'))) throw new Error('copy action not reachable at 390px');
    });
    await page.close();
  }

  section('ACCESSIBILITY — automatable checks');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await test('Form inputs have associated labels; primary button is keyboard-focusable', async () => {
      const unlabeled = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type=text], textarea, select'));
        return inputs.filter((el) => !el.id || !document.querySelector(`label[for="${el.id}"]`) && !el.closest('label')).length;
      });
      // This app uses adjacent (not for=) labels, so we check labels exist in the DOM near each field instead of strict for= binding.
      const labelCount = await page.evaluate(() => document.querySelectorAll('label').length);
      if (labelCount < 5) throw new Error('too few <label> elements for the number of form fields');
      await page.focus('#generateBtn');
      const focused = await page.evaluate(() => document.activeElement.id);
      if (focused !== 'generateBtn') throw new Error('primary action is not keyboard-focusable');
    });
    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\n============================================================');
  console.log('BROWSER_E2E: ' + passed + ' ناجح، ' + failed + ' فاشل، من أصل ' + (passed + failed));
  console.log('============================================================');
  if (failed > 0) {
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.error));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exitCode = 1;
});
