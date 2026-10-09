#!/usr/bin/env node
'use strict';
/** CI diagnostic (non-gating): report which elements of the ORIGINAL app overflow at 390px, as ::notice:: annotations. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const DIST = path.join(process.argv[2] || '.', 'dist');
const srv = http.createServer((q, s) => { const f = path.join(DIST, q.url === '/' ? 'prompt-maker-app.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { s.statusCode = 404; return s.end(); } s.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript'); s.end(d); }); });
srv.listen(4199, '127.0.0.1', async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } }); await p.goto('http://127.0.0.1:4199/');
  const r = await p.evaluate(() => { const out = []; document.querySelectorAll('body *').forEach((e) => { const x = e.getBoundingClientRect(); if (x.width > 0 && (x.right > 391 || x.left < -1 || e.scrollWidth > e.clientWidth + 2)) out.push((e.tagName + '#' + (e.id || '') + '.' + String(e.className || '').slice(0, 40)) + ' left=' + Math.round(x.left) + ' right=' + Math.round(x.right) + ' sw=' + e.scrollWidth + ' cw=' + e.clientWidth + ' dir=' + getComputedStyle(e).direction + ' w=' + Math.round(x.width) + ' font=' + getComputedStyle(e).fontFamily.slice(0, 40)); }); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, dir: document.documentElement.dir, over: out.slice(0, 10) }; });
  console.log('::notice title=overflow-diagnostic::' + JSON.stringify(r)); await b.close(); srv.close();
});
