'use strict';
// OP-7 reproduction: the README tells users to run tests/browser/static-server.js to open the UI.
// That helper binds ALL interfaces (not loopback) and resolves raw '..' segments outside dist/.
const cp = require('child_process'); const http = require('http'); const path = require('path'); const os = require('os');
const root = path.join(__dirname, '..', '..', '..');
// usage: repro_static_server.js [target.js] [port] [-- extra args for target...] [--expect-fixed]
const target = process.argv[2] && process.argv[2] !== '--expect-fixed' ? path.resolve(process.argv[2]) : path.join(root, 'tests/browser/static-server.js');
const port = Number(process.argv[3] || 4173);
const dd = process.argv.indexOf('--'); const extra = dd === -1 ? [] : process.argv.slice(dd + 1).filter((a) => a !== '--expect-fixed');
const child = cp.spawn(process.execPath, [target].concat(extra), { stdio: 'ignore' });
const get = (host, p) => new Promise((r) => { const q = http.request({ host, port, path: p, method: 'GET' }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => r({ status: res.statusCode, body: t })); }); q.on('error', (e) => r({ status: 0, err: e.code })); q.end(); });
setTimeout(async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  const trav = await get('127.0.0.1', '/../package.json');
  const viaLan = lan ? await get(lan.address, '/guided.html') : { status: 'NO_NON_LOOPBACK_INTERFACE' };
  child.kill();
  const out = { id: 'OP-7', target: path.relative(root, target) + (extra.length ? ' ' + extra.join(' ') : ''), observed: { traversal_status: trav.status, traversal_leaked_package_json: /"name":\s*"prompt-maker"/.test(trav.body || ''), non_loopback_interface: lan ? lan.address : null, reachable_from_non_loopback: viaLan.status === 200 }, defect_present: /"name":\s*"prompt-maker"/.test(trav.body || '') || viaLan.status === 200 };
  console.log(JSON.stringify(out));
  if (process.argv.includes('--expect-fixed') && out.defect_present) process.exitCode = 1;
}, 700);
