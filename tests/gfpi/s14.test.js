'use strict';
// S14 — local provider discovery/probe (OP-6) and the same-origin app launcher (OP-7 replacement).
// Runtimes are HTTP TEST DOUBLES of the Ollama protocol. A real Ollama/Windows run is a separate owner-run probe
// (`node companion/cli.js probe ...`); nothing here is evidence of real model behaviour.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { test } = require('./harness');
const P = require('../../gfpi/providerAdapter');
const { createOllamaAdapter, modelInstalled } = require('../../companion/ollamaAdapter');
const { createCompanion } = require('../../companion/server');

const root = path.join(__dirname, '..', '..');
const CLI = path.join(root, 'companion', 'cli.js');
const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'r', tradeoffs: 't', cost_complexity: 'c', risks: [] }] };
const now = () => '2026-01-01T00:00:00.000Z';

function fakeOllama(models, chat) {
  const st = { chats: 0 };
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(typeof models === 'string' ? models : JSON.stringify({ models: models.map((n) => ({ name: n })) }));
    // Documented Ollama endpoints the probe also uses (realistic double): version, and empty-prompt model load.
    if (req.url === '/api/version') return res.end('{"version":"0.6.0"}');
    if (req.url === '/api/generate') { st.generates = (st.generates || 0) + 1; return req.resume().on('end', () => res.end('{"done":true,"done_reason":"load","load_duration":1000000}')); }
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { st.chats++; chat(res, JSON.parse(b)); });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, url: 'http://127.0.0.1:' + srv.address().port })));
}
const okChat = (res) => res.end(JSON.stringify({ message: { content: JSON.stringify(GOOD) }, prompt_eval_count: 5, eval_count: 7 }));
function get(port, p, headers) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: Object.assign({ host: '127.0.0.1:' + port }, headers || {}), setHost: false }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    r.on('error', () => resolve({ status: 0 })); r.end();
  });
}
function cliAsync(args, opts) {
  return new Promise((resolve) => {
    const ch = cp.spawn(process.execPath, [CLI].concat(args), Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
    let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
    ch.on('close', (code) => resolve({ code, out, err }));
  });
}

test('S14 OP-6 model presence is exact: untagged name means :latest; no fuzzy substitution', () => {
  assert.strictEqual(modelInstalled(['llama3:latest'], 'llama3'), true);
  assert.strictEqual(modelInstalled(['llama3:8b'], 'llama3'), false, 'a different tag is a different model');
  assert.strictEqual(modelInstalled(['llama3:8b'], 'llama3:8b'), true);
  assert.strictEqual(modelInstalled(['qwen2.5:latest'], 'qwen2'), false, 'no prefix matching');
  assert.strictEqual(modelInstalled([], 'm'), false);
});

test('S14 OP-6 probe(): reachable+installed / reachable+missing / unreachable / bad reply, and isAvailable follows it', async () => {
  const yes = await fakeOllama(['m:latest', 'x:1b'], okChat); const no = await fakeOllama(['x:1b'], okChat); const bad = await fakeOllama('not json', okChat);
  try {
    const a = createOllamaAdapter({ endpoint: yes.url, model: 'm' }); const pa = await a.probe();
    assert.deepStrictEqual([pa.runtime, pa.model_installed], ['REACHABLE', true]); assert.deepStrictEqual(pa.models, ['m:latest', 'x:1b']); assert.strictEqual(await a.isAvailable(), true);
    const b = createOllamaAdapter({ endpoint: no.url, model: 'm' }); const pb = await b.probe();
    assert.deepStrictEqual([pb.runtime, pb.model_installed], ['REACHABLE', false]); assert.strictEqual(await b.isAvailable(), false);
    const c = createOllamaAdapter({ endpoint: bad.url, model: 'm' }); assert.strictEqual((await c.probe()).runtime, 'BAD_REPLY'); assert.strictEqual(await c.isAvailable(), false);
    const port = no.url.split(':').pop(); no.srv.close(); await new Promise((r) => setTimeout(r, 30));
    const d = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + port, model: 'm' }); assert.strictEqual((await d.probe()).runtime, 'UNREACHABLE');
  } finally { yes.srv.close(); no.srv.close(); bad.srv.close(); }
});

test('S14 OP-6 a missing model is UNAVAILABLE before any chat call (no wasted/failed runtime request)', async () => {
  const no = await fakeOllama(['other:latest'], (res) => { res.statusCode = 404; res.end('{"error":"model not found"}'); });
  try {
    const a = createOllamaAdapter({ endpoint: no.url, model: 'wanted' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 2000, max_retries: 1 } });
    const r = await o.run({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: { goal: 'x' }, output_schema: P.TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 50 });
    assert.strictEqual(r.status, 'DEGRADED_TO_MANUAL'); assert.strictEqual(no.st.chats, 0); assert.deepStrictEqual(r.attempts.map((x) => x.code), ['UNAVAILABLE']);
  } finally { no.srv.close(); }
});

test('S14 probe(): hostile model names from the runtime are sanitised and bounded', async () => {
  const evil = await fakeOllama(['<script>alert(1)</script>', 'a'.repeat(500), 'ok:latest'], okChat);
  try {
    const p = await createOllamaAdapter({ endpoint: evil.url, model: 'ok' }).probe();
    assert.ok(p.models.every((m) => !/[<>"' ]/.test(m) && m.length <= 120)); assert.strictEqual(p.model_installed, true);
  } finally { evil.srv.close(); }
});

test('S14 CLI probe: real loopback probe, evidence file, classification never claims evaluation/admission/readiness', async () => {
  const yes = await fakeOllama(['m:latest'], okChat);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-probe-')); const out = path.join(dir, 'ev.json');
  try {
    const r = await cliAsync(['probe', '--ollama-model', 'm', '--ollama-endpoint', yes.url, '--smoke', '--evidence-out', out]);
    assert.strictEqual(r.code, 0, r.err);
    const ev = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(ev.schema, 'LocalProviderProbeEvidenceV1'); assert.strictEqual(ev.runtime, 'REACHABLE'); assert.strictEqual(ev.model_installed, true);
    assert.deepStrictEqual(ev.classification, { MODEL_AVAILABLE: true, MODEL_EVALUATED: false, MODEL_ADMITTED: false, PRODUCTION_READY: false });
    assert.strictEqual(ev.smoke.performed, true); assert.strictEqual(ev.smoke.status, 'OK'); assert.strictEqual(ev.smoke.schema_valid, true); assert.strictEqual(ev.smoke.sample_size, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(ev.smoke.output_sha256)); assert.strictEqual(yes.st.chats, 1);
    assert.ok(!/hostname|username/i.test(Object.keys(ev.host).join()), 'no machine identity in evidence');
  } finally { yes.srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S14 CLI probe exit codes: 4 model missing, 3 unreachable, 5 smoke invalid; 2 usage', async () => {
  const no = await fakeOllama(['x:latest'], okChat);
  const junk = await fakeOllama(['m:latest'], (res) => res.end(JSON.stringify({ message: { content: 'prose, not json' } })));
  try {
    const miss = await cliAsync(['probe', '--ollama-model', 'm', '--ollama-endpoint', no.url]); assert.strictEqual(miss.code, 4);
    assert.strictEqual(JSON.parse(miss.out).classification.MODEL_AVAILABLE, false);
    const sm = await cliAsync(['probe', '--ollama-model', 'm', '--ollama-endpoint', junk.url, '--smoke', '--timeout-ms', '3000']); assert.strictEqual(sm.code, 5);
    const smj = JSON.parse(sm.out); assert.strictEqual(smj.smoke.schema_valid, false); assert.strictEqual(smj.smoke.output, null, 'invalid output is never reported as a result');
    const port = no.url.split(':').pop(); no.srv.close(); await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual((await cliAsync(['probe', '--ollama-model', 'm', '--ollama-endpoint', 'http://127.0.0.1:' + port])).code, 3);
    assert.strictEqual((await cliAsync(['probe'])).code, 2);
    assert.strictEqual((await cliAsync(['probe', '--ollama-model', 'm', '--ollama-endpoint', 'http://10.0.0.5:11434'])).code, 1, 'non-loopback endpoint refused (fail closed)');
  } finally { no.srv.close(); junk.srv.close(); }
});

async function appComp(extra) {
  const o = P.createOrchestrator({ adapters: [P.createManualAdapter()], now, policy: { order: ['manual'] } });
  const comp = createCompanion(Object.assign({ uiDir: path.join(root, 'dist'), orchestrator: o, now, describeProviders: () => [] }, extra || {}));
  const info = await comp.start(); return { comp, info };
}

test('S14 OP-7 app launcher serves ONLY the allow-listed UI files with anti-framing CSP; traversal never reaches the disk', async () => {
  const { comp, info } = await appComp();
  try {
    const ui = await get(info.port, '/'); assert.strictEqual(ui.status, 200);
    assert.ok(ui.body.toString().includes('<html') && /frame-ancestors 'none'/.test(ui.headers['content-security-policy'])); assert.strictEqual(ui.headers['x-frame-options'], 'DENY');
    for (const f of ['/guided.html', '/core_bundle.js', '/gfpi_bundle.js', '/gfpi_production_bundle.js']) assert.strictEqual((await get(info.port, f)).status, 200, f);
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/prompt-maker-app.html', '/guided.html/../../package.json', '/dist/guided.html', '//etc/passwd', '/companion/server.js']) {
      const r = await get(info.port, p); assert.notStrictEqual(r.status, 200, p); assert.ok(!/"name":\s*"prompt-maker"|require\(/.test(r.body ? r.body.toString() : ''), 'leak via ' + p);
    }
    assert.strictEqual((await get(info.port, '/', { host: 'evil.test:' + info.port })).status, 403, 'DNS-rebinding Host refused for the UI too');
    assert.strictEqual(info.uiUrl, 'http://127.0.0.1:' + info.port + '/');
  } finally { await comp.stop(); }
});

test('S14 OP-7 same-origin API: Sec-Fetch-Site same-origin stands in for a missing Origin ONLY when the UI is served here', async () => {
  const { comp, info } = await appComp();
  const self = 'http://127.0.0.1:' + info.port;
  try {
    const pr = await new Promise((resolve) => {
      const body = JSON.stringify({ code: info.pairingCode });
      const r = http.request({ host: '127.0.0.1', port: info.port, path: '/v1/pair', method: 'POST', headers: { host: '127.0.0.1:' + info.port, origin: self, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, setHost: false }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) })); });
      r.end(body);
    });
    assert.strictEqual(pr.status, 200, 'self origin is allowed automatically');
    const auth = { authorization: 'Bearer ' + pr.json.token };
    assert.strictEqual((await get(info.port, '/v1/status', Object.assign({ 'sec-fetch-site': 'same-origin' }, auth))).status, 200, 'same-origin GET without Origin');
    assert.strictEqual((await get(info.port, '/v1/status', auth)).status, 403, 'no Origin and no Sec-Fetch-Site => refused');
    assert.strictEqual((await get(info.port, '/v1/status', Object.assign({ 'sec-fetch-site': 'cross-site' }, auth))).status, 403, 'cross-site => refused');
    assert.strictEqual((await get(info.port, '/v1/status', Object.assign({ origin: 'http://evil.test' }, auth))).status, 403, 'foreign Origin wins over any Sec-Fetch-Site');
  } finally { await comp.stop(); }
  // API-only companion (no UI): Sec-Fetch-Site never substitutes for Origin.
  const o = P.createOrchestrator({ adapters: [P.createManualAdapter()], now, policy: { order: ['manual'] } });
  const api = createCompanion({ allowedOrigins: ['http://127.0.0.1:4180'], orchestrator: o, now, describeProviders: () => [] }); const ai = await api.start();
  try { assert.strictEqual((await get(ai.port, '/v1/status', { 'sec-fetch-site': 'same-origin', authorization: 'Bearer ' + 'A'.repeat(43) })).status, 403); assert.strictEqual((await get(ai.port, '/')).status, 403, 'API-only mode serves no UI'); }
  finally { await api.stop(); }
});

test('S14 CLI app: binds loopback only, prints the address and an honest model state; busy port => exit 3', async () => {
  const yes = await fakeOllama(['other:latest'], okChat);
  const blocker = http.createServer(() => {}); await new Promise((r) => blocker.listen(0, '127.0.0.1', r)); const busy = blocker.address().port;
  try {
    const b = await cliAsync(['app', '--port', String(busy)]); assert.strictEqual(b.code, 3); assert.ok(/already in use/.test(b.err));
    const ch = cp.spawn(process.execPath, [CLI, 'app', '--port', '0', '--ollama-model', 'wanted', '--ollama-endpoint', yes.url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    const t0 = Date.now(); while (!/NOT AUTHORIZED/.test(out) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    ch.kill('SIGTERM'); await new Promise((r) => ch.on('close', r));
    assert.ok(/Open this address in your browser: http:\/\/127\.0\.0\.1:\d+\//.test(out), out);
    assert.ok(/NOT installed — run: ollama pull wanted/.test(out), 'missing model reported honestly');
  } finally { yes.srv.close(); blocker.close(); }
});

test('S14 status reports per-provider availability from a live probe (UI must not count a missing model)', async () => {
  const no = await fakeOllama(['x:latest'], okChat);
  try {
    const a = createOllamaAdapter({ endpoint: no.url, model: 'm' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'] } });
    const describeProviders = async () => [{ id: a.id, kind: a.kind, locality: a.locality, availability: (await a.probe()).model_installed ? 'READY' : 'MODEL_NOT_INSTALLED' }];
    const comp = createCompanion({ uiDir: path.join(root, 'dist'), orchestrator: o, now, describeProviders }); const info = await comp.start();
    try {
      const self = 'http://127.0.0.1:' + info.port; const body = JSON.stringify({ code: info.pairingCode });
      const tok = await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: info.port, path: '/v1/pair', method: 'POST', headers: { host: '127.0.0.1:' + info.port, origin: self, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, setHost: false }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(JSON.parse(t).token)); }); r.end(body); });
      const st = await get(info.port, '/v1/status', { origin: self, authorization: 'Bearer ' + tok });
      assert.strictEqual(JSON.parse(st.body.toString()).providers[0].availability, 'MODEL_NOT_INSTALLED');
    } finally { await comp.stop(); }
  } finally { no.srv.close(); }
});
