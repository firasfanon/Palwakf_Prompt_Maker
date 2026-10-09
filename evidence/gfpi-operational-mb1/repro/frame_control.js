// Control: the SAME probe against a server WITHOUT frame-ancestors must report the UI as framed (proves non-vacuity).
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = process.argv[2]; const { chromium } = require(path.join(root, 'node_modules/playwright'));
const html = fs.readFileSync(path.join(root, 'dist/guided.html'));
const js = (n) => fs.readFileSync(path.join(root, 'dist', n));
const srv = http.createServer((q, r) => { const u = q.url === '/' ? '/guided.html' : q.url; if (u === '/guided.html') { r.setHeader('content-type', 'text/html'); return r.end(html); } r.setHeader('content-type', 'application/javascript'); r.end(js(u.slice(1))); }).listen(4199, '127.0.0.1');
const host = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body>host</body></html>'); }).listen(4198, '127.0.0.1');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); await p.goto('http://127.0.0.1:4198/');
  await p.evaluate(() => { const f = document.createElement('iframe'); f.src = 'http://127.0.0.1:4199/'; document.body.appendChild(f); });
  await new Promise((r) => setTimeout(r, 1500)); const fr = p.frames().find((f) => f !== p.mainFrame());
  console.log(JSON.stringify({ control_without_frame_ancestors_framed: !!(fr && await fr.$('#tab-C')) })); await b.close(); srv.close(); host.close(); })();
