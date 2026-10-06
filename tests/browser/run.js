#!/usr/bin/env node
'use strict';
/**
 * Real browser UAT harness (closeout directive, sections 19-25).
 *
 * Uses the raw `playwright` driver, declared and pinned in package.json /
 * package-lock.json (no @playwright/test, no other framework). This IS real
 * browser execution, not a simulation — each scenario below is a genuine
 * PASS/FAIL, never BLOCKED_ENVIRONMENT.
 *
 * Reproduce from a clean clone:  npm ci && node tests/run.js && node tests/browser/run.js
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

  section('SAVE_RELOAD_REOPEN / VERSION_HISTORY — real page.reload(), persistent storage');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const goalV1 = 'نظام ويب عام لإدارة المهام والمستخدمين';
    const goalV2 = 'نظام محاسبي ledger للفواتير المالية والمصالحة البنكية';
    const blueprintHash = async () => JSON.parse(await page.textContent('#receiptBox')).blueprint_content_hash;
    let v1Hash, v2Hash;

    await test('CREATE → GENERATE → SAVE (V1) writes a real persisted record', async () => {
      await fillGenerate(page, { name: 'مشروع الحفظ', goal: goalV1 });
      v1Hash = await blueprintHash();
      await page.click('#saveBtn');
      await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.indexOf('نسخة 1') !== -1);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('prompt-maker:project:') === 0).length);
      if (stored !== 1) throw new Error('expected exactly 1 persisted project in localStorage, got ' + stored);
    });

    await test('RELOAD wipes in-page state, then REOPEN restores V1 from storage and verifies hashes', async () => {
      await page.evaluate(() => { window.__marker = 'alive-before-reload'; });
      await page.reload();
      const marker = await page.evaluate(() => window.__marker);
      if (marker !== undefined) throw new Error('page JS state survived reload — not a real reload');
      if (await page.isVisible('#results')) throw new Error('results still visible after reload: state was not reset');
      await page.waitForSelector('#versionsBox [data-action=open-latest]');
      await page.click('#versionsBox [data-action=open-latest]');
      await page.waitForSelector('#results:not(.hidden)');
      if ((await page.inputValue('#projectName')) !== 'مشروع الحفظ') throw new Error('project name not restored');
      if ((await page.inputValue('#projectGoal')) !== goalV1) throw new Error('project goal not restored');
      if ((await blueprintHash()) !== v1Hash) throw new Error('restored blueprint hash differs from the saved one');
      const status = await page.textContent('#openStatus');
      if (status.indexOf('مطابق تمامًا') === -1) throw new Error('open status did not confirm hash match: ' + status);
    });

    await test('EDIT → REGENERATE → SAVE V2 produces a different blueprint and a real change summary', async () => {
      await page.fill('#projectGoal', goalV2);
      await page.click('#generateBtn');
      v2Hash = await blueprintHash();
      if (v2Hash === v1Hash) throw new Error('editing the goal did not change the blueprint hash');
      await page.click('#saveBtn');
      await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.indexOf('نسخة 2') !== -1);
      const status = await page.textContent('#saveStatus');
      if (status.indexOf('input changed') === -1) throw new Error('V2 change summary missing "input changed": ' + status);
    });

    await test('RELOAD again → version history lists V1 and V2; REOPEN V2 then V1 restore each exactly', async () => {
      await page.reload();
      await page.waitForSelector('#versionsBox .version-list li');
      const rows = await page.locator('#versionsBox .version-list li').count();
      if (rows !== 2) throw new Error('expected 2 persisted versions in history, got ' + rows);
      await page.click('#versionsBox [data-action=open-latest]');
      await page.waitForSelector('#results:not(.hidden)');
      if ((await page.inputValue('#projectGoal')) !== goalV2) throw new Error('V2 goal not restored');
      if ((await blueprintHash()) !== v2Hash) throw new Error('V2 blueprint hash mismatch after reopen');
      await page.click('#versionsBox [data-action=open-version][data-version="1"]');
      await page.waitForFunction((g) => document.querySelector('#projectGoal').value === g, goalV1);
      if ((await blueprintHash()) !== v1Hash) throw new Error('V1 blueprint hash mismatch after reopening the older version');
    });
    await page.close();
  }

  section('SAFE_RENDERING — USER_INPUT != TRUSTED_HTML');
  {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const evilName = '<img src=x onerror="window.__pwned=1"><b id="evil-b">bold</b>';
    const evilGoal = 'نظام ويب عام <script>window.__pwned=2</script> <svg onload="window.__pwned=4">';
    const evilCaps = '<img src=x onerror="window.__pwned=3"> authentication';
    await test('HTML-like input (name, goal, brownfield text) is shown as text and never becomes DOM markup', async () => {
      await page.click('#modePro');
      await fillGenerate(page, { name: evilName, goal: evilGoal, existing: { capabilities: evilCaps } });
      await page.click('#saveBtn');
      await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.indexOf('نسخة 1') !== -1);
      await page.reload();
      await page.waitForSelector('#versionsBox [data-action=open-latest]');
      await page.click('#versionsBox [data-action=open-latest]');
      await page.waitForSelector('#results:not(.hidden)');
      await page.waitForTimeout(300);
      const pwned = await page.evaluate(() => window.__pwned);
      if (pwned !== undefined) throw new Error('user-supplied HTML executed: window.__pwned=' + pwned);
      const injected = await page.evaluate(() => document.querySelectorAll('main img, main b, main svg, main script, #evil-b').length);
      if (injected !== 0) throw new Error(injected + ' element(s) were created from user-supplied markup');
      const listText = await page.textContent('#versionsBox');
      if (listText.indexOf('<img src=x') === -1) throw new Error('saved project name is not displayed literally as text');
      const prompt = await page.inputValue('#promptBox');
      if (prompt.indexOf(evilName) === -1) throw new Error('the literal input was not preserved verbatim in the prompt');
    });
    await page.close();
  }

  section('STORAGE_UNAVAILABLE — honest in-memory fallback');
  {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
    });
    await page.goto(BASE_URL);
    await test('When persistent storage is blocked the UI says so and saving is labelled session-only', async () => {
      const notice = await page.textContent('#storageNotice');
      if (notice.indexOf('تحذير') === -1) throw new Error('no warning shown when storage is unavailable: ' + notice);
      await fillGenerate(page, { name: 'بلا تخزين', goal: 'نظام ويب عام' });
      await page.click('#saveBtn');
      await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.indexOf('تم الحفظ') !== -1);
      const status = await page.textContent('#saveStatus');
      if (status.indexOf('ذاكرة الجلسة فقط') === -1) throw new Error('save status does not disclose session-only storage: ' + status);
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
    await test('Every text input, textarea and select has an associated label; page declares lang and dir', async () => {
      const unlabeled = await page.evaluate(() => {
        const fields = Array.from(document.querySelectorAll('input[type=text], textarea, select'));
        return fields.filter((el) => !(el.id && document.querySelector('label[for="' + el.id + '"]')) && !el.closest('label')).map((el) => el.id || el.name || el.tagName);
      });
      if (unlabeled.length) throw new Error('fields without an associated label: ' + unlabeled.join(', '));
      const attrs = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
      if (!attrs.lang || !attrs.dir) throw new Error('missing lang/dir on <html>');
    });
    await test('Primary action is reachable by keyboard Tab order from the first field', async () => {
      await page.focus('#projectName');
      let reached = false;
      for (let i = 0; i < 12 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = (await page.evaluate(() => document.activeElement.id)) === 'generateBtn';
      }
      if (!reached) throw new Error('Tab never reached #generateBtn within 12 presses');
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
