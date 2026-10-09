'use strict';
/**
 * Reproduction (before/after) of UI connection-state defects, in REAL Chromium against the REAL companion server
 * (provider = RECORDED/MOCKED adapter; not evidence of real model performance).
 *   OP-4  after the companion session is lost (revoked/expired server-side, or the companion stops), the UI still says
 *         "paired" and reports a provider failure instead of telling the user the connection was lost.
 *   OP-5  clicking "ask AI" twice while a request is running sends two /v1/run requests (no in-flight guard, no cancel).
 * Prints one JSON line per check.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const root = path.join(__dirname, '..', '..', '..');
const { chromium } = require(path.join(root, 'node_modules/playwright'));
const P = require(path.join(root, 'gfpi/providerAdapter'));
const { createCompanion } = require(path.join(root, 'companion/server'));

const PORT = 4192; const ORIGIN = 'http://127.0.0.1:' + PORT; const DIST = path.join(root, 'dist');
const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'r', tradeoffs: 't', cost_complexity: 'c', risks: [] }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function startComp(delayMs) {
  const st = { runs: 0 };
  const slow = P.createRecordedAdapter('rec', [async () => { st.runs++; await sleep(delayMs); return { json: GOOD }; }]);
  const now = () => new Date().toISOString();
  const o = P.createOrchestrator({ adapters: [slow, P.createManualAdapter()], now, policy: { order: ['rec', 'manual'], timeout_ms: 5000, max_retries: 0 } });
  const comp = createCompanion({ allowedOrigins: [ORIGIN], orchestrator: o, now, describeProviders: () => [{ id: 'rec', kind: slow.kind, locality: slow.locality }] });
  const info = await comp.start(); return { comp, info, st };
}
async function pairUi(page, info) {
  await page.click('#tab-C'); await page.fill('#inp-comp-url', 'http://127.0.0.1:' + info.port); await page.fill('#inp-comp-code', info.pairingCode); await page.click('#btn-pair');
  await page.waitForFunction(() => document.getElementById('conn-state').textContent.trim() === 'مقترن');
}
async function toTech(page) { await page.click('#tab-Q'); await page.check('#mode-ASSISTED'); await page.waitForSelector('#qsource'); await page.click('#nav-technology_stack'); }

(async () => {
  const server = await startStatic(); const browser = await chromium.launch(); const results = [];
  try {
    // OP-4: companion stops after pairing
    {
      const c = await startComp(50); const page = await (await browser.newContext()).newPage(); await page.goto(ORIGIN + '/guided.html');
      await pairUi(page, c.info); await c.comp.stop(); await toTech(page); await page.click('#btn-ai');
      await page.waitForFunction(() => { const o = document.getElementById('ai-out'); return o && o.textContent && !/جارٍ|Running/.test(o.textContent); }, null, { timeout: 8000 });
      const aiText = (await page.textContent('#ai-out')).trim();
      await page.click('#tab-C'); const conn = (await page.textContent('#conn-state')).trim();
      const r = { id: 'OP-4', observed: { conn_state_after_companion_stopped: conn, ai_message: aiText }, defect_present: conn === 'مقترن' };
      results.push(r); console.log(JSON.stringify(r)); await page.context().close();
    }
    // OP-5: double click while running
    {
      const c = await startComp(900); const page = await (await browser.newContext()).newPage(); await page.goto(ORIGIN + '/guided.html');
      await pairUi(page, c.info); await toTech(page);
      await page.click('#btn-ai'); await sleep(60);
      const disabledWhileRunning = await page.evaluate(() => { const b = document.getElementById('btn-ai'); return !!(b && b.disabled); });
      const cancelPresent = (await page.locator('#btn-ai-cancel').count()) > 0;
      await page.evaluate(() => { const b = document.getElementById('btn-ai'); if (b && !b.disabled) b.click(); });
      await sleep(1500);
      const r = { id: 'OP-5', observed: { provider_runs: c.st.runs, ask_button_disabled_while_running: disabledWhileRunning, cancel_control_present: cancelPresent }, defect_present: c.st.runs > 1 || !cancelPresent };
      results.push(r); console.log(JSON.stringify(r)); await page.context().close(); await c.comp.stop();
    }
  } finally { await browser.close(); server.close(); }
  if (process.argv.includes('--expect-fixed') && results.some((r) => r.defect_present)) process.exitCode = 1;
})();
