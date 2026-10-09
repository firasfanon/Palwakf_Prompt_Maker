'use strict';
/**
 * Track E accessibility/layout audit of dist/guided.html in REAL Chromium (no axe-core available offline).
 * For each tab × language × viewport: interactive elements lacking an accessible name, duplicate ids, label[for]
 * pointing at nothing, and horizontal overflow. Uses the browser's own accessibility computation where possible.
 * Prints JSON; --expect-clean exits 1 on any finding.
 */
const fs = require('fs'); const path = require('path'); const http = require('http');
const root = path.join(__dirname, '..', '..', '..');
const { chromium } = require(path.join(root, 'node_modules/playwright'));
const DIST = path.join(root, 'dist'); const PORT = 4193;

function serve() { return new Promise((r) => { const s = http.createServer((q, res) => { const f = path.join(DIST, q.url.split('?')[0].replace(/^\//, '')); if (!f.startsWith(DIST + path.sep) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript'); res.end(fs.readFileSync(f)); }).listen(PORT, '127.0.0.1', () => r(s)); }); }

const AUDIT = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (e) => {
    if (e.getAttribute('aria-label')) return e.getAttribute('aria-label').trim();
    if (e.getAttribute('aria-labelledby')) return e.getAttribute('aria-labelledby').split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
    if (e.labels && e.labels.length) return Array.from(e.labels).map((l) => l.textContent).join(' ').trim();
    if (e.tagName === 'INPUT' && (e.type === 'button' || e.type === 'submit')) return (e.value || '').trim();
    if (e.closest('label')) return e.closest('label').textContent.trim();
    if (e.getAttribute('title')) return e.getAttribute('title').trim();
    if (e.tagName === 'SUMMARY' || e.tagName === 'BUTTON' || e.tagName === 'A') return e.textContent.trim();
    return '';
  };
  // Controls only: tabindex="-1" marks programmatic focus targets (skip-link target, focus management), not controls.
  const els = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], summary, [role="button"], [tabindex]:not([tabindex="-1"])')).filter(vis);
  const unnamed = els.filter((e) => !name(e)).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.type ? '[' + e.type + ']' : ''));
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  const dupIds = Object.keys(ids).filter((k) => ids[k] > 1);
  const badFor = Array.from(document.querySelectorAll('label[for]')).filter((l) => !document.getElementById(l.htmlFor)).map((l) => l.htmlFor);
  return { interactive: els.length, unnamed, dupIds, badFor, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};

(async () => {
  const srv = await serve(); const b = await chromium.launch(); const rows = [];
  try {
    for (const vp of [{ n: '1280', w: 1280, h: 900 }, { n: '390', w: 390, h: 844 }]) {
      for (const lang of ['ar', 'en']) {
        const page = await (await b.newContext({ viewport: { width: vp.w, height: vp.h } })).newPage();
        await page.goto('http://127.0.0.1:' + PORT + '/guided.html');
        if (lang === 'en') { await page.click('#btnLang'); await page.waitForFunction(() => document.documentElement.lang === 'en'); }
        for (const mode of ['GUIDED', 'ASSISTED', 'EXPERT']) {
          await page.click('#tab-Q'); await page.check('#mode-' + mode); await page.waitForSelector('#qsource');
          rows.push(Object.assign({ vp: vp.n, lang: await page.getAttribute('html', 'lang'), tab: 'Q:' + mode }, await page.evaluate(AUDIT)));
        }
        for (const tab of ['L', 'P', 'C', 'F']) { await page.click('#tab-' + tab); await page.waitForTimeout(80); rows.push(Object.assign({ vp: vp.n, lang: await page.getAttribute('html', 'lang'), tab }, await page.evaluate(AUDIT))); }
        await page.context().close();
      }
    }
  } finally { await b.close(); srv.close(); }
  const findings = rows.filter((r) => r.unnamed.length || r.dupIds.length || r.badFor.length || r.overflow > 0);
  console.log(JSON.stringify({ checked: rows.length, findings }, null, 1));
  if (process.argv.includes('--expect-clean') && findings.length) process.exitCode = 1;
})();
