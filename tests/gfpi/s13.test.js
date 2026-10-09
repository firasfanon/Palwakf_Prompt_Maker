'use strict';
// S13 — operational runtime hardening (OP-1..OP-3): abort-before-retry, cancellation, single-flight, disconnect abort.
// The local runtime here is an HTTP TEST DOUBLE speaking the Ollama /api/tags + /api/chat protocol; it is NOT a real
// Ollama runtime and proves nothing about model quality. What it proves is the transport/cancellation behaviour.
const assert = require('assert');
const http = require('http');
const path = require('path');
const cp = require('child_process');
const { test } = require('./harness');
const P = require('../../gfpi/providerAdapter');
const B = require('../../gfpi/budget');
const { createOllamaAdapter } = require('../../companion/ollamaAdapter');
const { createHostedAdapter } = require('../../companion/hostedAdapter');
const { createMemoryStore } = require('../../companion/credentialStore');
const { createCompanion } = require('../../companion/server');

const NOW = '2026-01-01T00:00:00.000Z';
const now = () => NOW;
const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'r', tradeoffs: 't', cost_complexity: 'c', risks: [] }] };
const task = () => ({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: { goal: 'booking' }, output_schema: P.TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 100 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = 'http://127.0.0.1:4180'; const ORIGIN2 = 'http://127.0.0.1:4181';

function slowOllama(delayMs) {
  const st = { inflight: 0, maxInflight: 0, chats: 0, aborted: 0, completed: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end('{"models":[{"name":"m:latest"}]}'); }
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      st.chats++; st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight); let done = false;
      const t = setTimeout(() => { done = true; st.inflight--; st.completed++; if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: { content: JSON.stringify(GOOD) } })); } }, delayMs);
      res.on('close', () => { if (!done) { done = true; clearTimeout(t); st.inflight--; st.aborted++; } });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, port: srv.address().port })));
}
function rawReq(port, opts) {
  return new Promise((resolve) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ host: '127.0.0.1:' + port }, opts.headers || {});
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path, headers, setHost: false }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* none */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (opts.abortAfterMs) setTimeout(() => r.destroy(), opts.abortAfterMs);
    if (data) r.write(data); r.end();
  });
}
async function companionOn(o, extraPolicy, extraCfg) {
  const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
  const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: Object.assign({ order: [a.id, 'manual'], timeout_ms: 5000, max_retries: 0 }, extraPolicy || {}) });
  const comp = createCompanion(Object.assign({ allowedOrigins: [ORIGIN, ORIGIN2], orchestrator: orch, now, describeProviders: () => [] }, extraCfg || {}));
  const info = await comp.start();
  const pr = await rawReq(info.port, { method: 'POST', path: '/v1/pair', headers: { origin: ORIGIN }, body: { code: info.pairingCode } });
  return { comp, port: info.port, token: pr.json.token, h: { origin: ORIGIN, authorization: 'Bearer ' + pr.json.token }, newCode: () => comp.newPairingCode() };
}
const RUN = { task: { kind: 'TECH_RECOMMENDATION', payload: { goal: 'x' } } };

test('S13 OP-1 timed-out local attempt is ABORTED before the retry: never two concurrent runtime requests', async () => {
  const o = await slowOllama(600);
  try {
    const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
    assert.strictEqual(a.supports_abort, true);
    const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 200, max_retries: 1 } });
    const r = await orch.run(task());
    await sleep(100);
    assert.strictEqual(r.status, 'DEGRADED_TO_MANUAL');
    assert.strictEqual(o.st.chats, 2, 'retry policy unchanged: one retry');
    assert.strictEqual(o.st.maxInflight, 1, 'the retry never overlaps the timed-out attempt');
    assert.strictEqual(o.st.inflight, 0, 'nothing keeps running after run() returned');
    assert.deepStrictEqual(r.attempts.map((x) => x.code), ['TIMEOUT', 'TIMEOUT']);
  } finally { o.srv.close(); }
});

test('S13 OP-2 run(task, {signal}) cancels the live attempt => CANCELLED, no output, runtime request torn down', async () => {
  const o = await slowOllama(800);
  try {
    const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
    const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 5000, max_retries: 1 } });
    const ac = new AbortController(); setTimeout(() => ac.abort(), 120);
    const t0 = Date.now(); const r = await orch.run(task(), { signal: ac.signal });
    assert.strictEqual(r.status, 'CANCELLED'); assert.strictEqual(r.output, undefined); assert.ok(Date.now() - t0 < 600, 'returns promptly');
    await sleep(80); assert.strictEqual(o.st.inflight, 0); assert.strictEqual(o.st.aborted, 1); assert.strictEqual(o.st.chats, 1, 'a cancel is not retried');
    const pre = new AbortController(); pre.abort();
    assert.strictEqual((await orch.run(task(), { signal: pre.signal })).status, 'CANCELLED', 'already-cancelled signal: nothing is called');
    assert.strictEqual(o.st.chats, 1);
  } finally { o.srv.close(); }
});

test('S13 OP-2 a cancelled LOCAL run never falls through to an EXTERNAL provider (no silent escalation)', async () => {
  const o = await slowOllama(800);
  const calls = []; const store = createMemoryStore(); await store.set('hx', 'sk-ABCDEF1234567890ABCDEF1234567890');
  try {
    const local = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
    const hosted = createHostedAdapter({ id: 'hosted-x', endpoint: 'https://api.example.test/v1/run', model: 'm', credential_ref: 'hx' }, { store, fetch: async (u, init) => { calls.push(init); return { ok: true, json: async () => ({ json: GOOD }) }; } });
    const approved = Object.assign(B.defaultBudgetPolicy(), { per_call_cap: 1, per_project_cap: 5, period_cap: 5, token_caps: { input_per_call: 5000, output_per_call: 2000 }, approved_by: 'owner', approved_at: NOW });
    const orch = P.createOrchestrator({ adapters: [local, hosted, P.createManualAdapter()], now, budgetPolicy: approved, policy: { order: [local.id, 'hosted-x', 'manual'], timeout_ms: 5000, max_retries: 0 } });
    const ac = new AbortController(); setTimeout(() => ac.abort(), 100);
    const r = await orch.run(task(), { signal: ac.signal });
    assert.strictEqual(r.status, 'CANCELLED'); assert.strictEqual(calls.length, 0, 'hosted never contacted');
  } finally { o.srv.close(); }
});

test('S13 hosted adapter forwards the abort signal to fetch (transport can be torn down)', async () => {
  const store = createMemoryStore(); await store.set('hx', 'sk-ABCDEF1234567890ABCDEF1234567890'); let seen = null;
  const hosted = createHostedAdapter({ id: 'hosted-x', endpoint: 'https://api.example.test/v1/run', model: 'm', credential_ref: 'hx' }, { store, fetch: async (u, init) => { seen = init; return { ok: true, json: async () => ({ json: GOOD }) }; } });
  assert.strictEqual(hosted.supports_abort, true);
  const ac = new AbortController(); await hosted.invoke({ kind: 'TECH_RECOMMENDATION', payload: {}, output_schema: {}, max_output_tokens: 10, signal: ac.signal });
  assert.strictEqual(seen.signal, ac.signal); assert.ok(!JSON.parse(seen.body).signal, 'the signal is never serialised into the request body');
});

test('S13 OP-3 companion single-flight: concurrent runs => one reaches the runtime, others 409 RUN_IN_PROGRESS', async () => {
  const o = await slowOllama(400); const c = await companionOn(o);
  try {
    const rs = await Promise.all([1, 2, 3].map(() => rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN })));
    const st = rs.map((r) => r.status).sort(); assert.deepStrictEqual(st, [200, 409, 409]);
    assert.ok(rs.filter((r) => r.status === 409).every((r) => r.json.error === 'RUN_IN_PROGRESS'));
    assert.strictEqual(o.st.chats, 1); assert.strictEqual(o.st.maxInflight, 1);
    const again = await rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN }); assert.strictEqual(again.status, 200, 'free again after completion');
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 OP-3 the single-flight limit is global across sessions (one local runtime)', async () => {
  const o = await slowOllama(400); const c = await companionOn(o);
  try {
    c.newCode(); const code = c.comp.newPairingCode();
    const p2 = await rawReq(c.port, { method: 'POST', path: '/v1/pair', headers: { origin: ORIGIN2 }, body: { code } });
    const h2 = { origin: ORIGIN2, authorization: 'Bearer ' + p2.json.token };
    const [a, b] = await Promise.all([rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN }), sleep(30).then(() => rawReq(c.port, { method: 'POST', path: '/v1/run', headers: h2, body: RUN }))]);
    assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 409); assert.strictEqual(o.st.maxInflight, 1);
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 OP-2 client disconnect aborts the run; the runtime request is torn down', async () => {
  const o = await slowOllama(800); const c = await companionOn(o);
  try {
    await rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN, abortAfterMs: 150 });
    await sleep(200); assert.strictEqual(o.st.inflight, 0); assert.strictEqual(o.st.aborted, 1); assert.strictEqual(o.st.completed, 0);
    const st = await rawReq(c.port, { path: '/v1/status', headers: c.h }); assert.strictEqual(st.json.run_in_progress, false, 'slot released');
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 POST /v1/cancel aborts the session run => CANCELLED; cancel with nothing running is a no-op', async () => {
  const o = await slowOllama(800); const c = await companionOn(o);
  try {
    const none = await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: c.h, body: {} });
    assert.strictEqual(none.status, 200); assert.strictEqual(none.json.cancelled, false);
    const running = rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN });
    await sleep(120);
    const mid = await rawReq(c.port, { path: '/v1/status', headers: c.h }); assert.strictEqual(mid.json.run_in_progress, true);
    const cx = await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: c.h, body: {} }); assert.strictEqual(cx.json.cancelled, true);
    const r = await running; assert.strictEqual(r.status, 200); assert.strictEqual(r.json.status, 'CANCELLED'); assert.strictEqual(r.json.output, undefined);
    await sleep(50); assert.strictEqual(o.st.inflight, 0); assert.strictEqual(o.st.aborted, 1);
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 /v1/cancel is authenticated and origin-bound like every other route (adversarial)', async () => {
  const o = await slowOllama(800); const c = await companionOn(o);
  try {
    const running = rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN }); await sleep(100);
    assert.strictEqual((await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: { origin: ORIGIN }, body: {} })).status, 401, 'no token');
    assert.strictEqual((await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: { origin: ORIGIN, authorization: 'Bearer ' + 'A'.repeat(43) }, body: {} })).status, 401, 'forged token');
    assert.strictEqual((await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: { origin: ORIGIN2, authorization: 'Bearer ' + c.token }, body: {} })).status, 403, 'token replayed from another origin');
    assert.strictEqual((await rawReq(c.port, { method: 'POST', path: '/v1/cancel', headers: { origin: 'http://evil.test', authorization: 'Bearer ' + c.token }, body: {} })).status, 403, 'foreign origin');
    const r = await running; assert.strictEqual(r.json.status, 'OK', 'none of the rejected cancels affected the run');
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 revoking the session (DELETE /v1/session) and stop() both abort an in-flight run', async () => {
  const o = await slowOllama(800); const c = await companionOn(o);
  try {
    const running = rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: RUN }); await sleep(100);
    assert.strictEqual((await rawReq(c.port, { method: 'DELETE', path: '/v1/session', headers: c.h })).status, 200);
    const r = await running; assert.strictEqual(r.json.status, 'CANCELLED'); await sleep(50); assert.strictEqual(o.st.inflight, 0);
    const code = c.comp.newPairingCode(); const p = await rawReq(c.port, { method: 'POST', path: '/v1/pair', headers: { origin: ORIGIN }, body: { code } });
    rawReq(c.port, { method: 'POST', path: '/v1/run', headers: { origin: ORIGIN, authorization: 'Bearer ' + p.json.token }, body: RUN }); await sleep(100);
    await c.comp.stop(); await sleep(80); assert.strictEqual(o.st.inflight, 0, 'stop() leaves no orphaned runtime work');
  } finally { o.srv.close(); }
});

test('S13 status exposes run_in_progress and session expiry, still no secrets', async () => {
  const o = await slowOllama(50); const c = await companionOn(o);
  try {
    const st = await rawReq(c.port, { path: '/v1/status', headers: c.h });
    assert.strictEqual(st.json.run_in_progress, false); assert.ok(st.json.session_expires_in_ms > 0 && st.json.session_expires_in_ms <= 30 * 60 * 1000);
    assert.ok(!JSON.stringify(st.json).includes(c.token), 'the bearer token is never echoed');
  } finally { await c.comp.stop(); o.srv.close(); }
});

test('S13 CLI rejects an out-of-range --timeout-ms (fail closed, exit 2) before listening', () => {
  const cli = path.join(__dirname, '..', '..', 'companion', 'cli.js');
  for (const v of ['5', '999999999', 'abc']) {
    const r = cp.spawnSync(process.execPath, [cli, 'start', '--origin', ORIGIN, '--timeout-ms', v], { encoding: 'utf8', timeout: 5000 });
    assert.strictEqual(r.status, 2, 'value ' + v); assert.ok(/timeout-ms/.test(r.stderr)); assert.ok(!/listening/.test(r.stdout));
  }
});
