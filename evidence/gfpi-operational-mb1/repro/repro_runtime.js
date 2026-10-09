'use strict';
/**
 * Reproduction (before/after) for the operational runtime defects found in G1/G2.
 * Uses the REAL orchestrator, REAL Ollama adapter and REAL companion server against a local HTTP double that
 * speaks the Ollama /api/tags + /api/chat protocol (a TEST DOUBLE, not a real Ollama runtime).
 *   OP-1  a timed-out provider call is not aborted; the retry runs concurrently with it (duplicate local load)
 *   OP-2  a client that disconnects (or cancels) does not stop the provider call
 *   OP-3  concurrent /v1/run requests in one session all reach the local runtime (no single-flight guard)
 * Prints one JSON line per check: { id, observed, defect_present }.
 */
const http = require('http');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const P = require(path.join(root, 'gfpi/providerAdapter'));
const { createOllamaAdapter } = require(path.join(root, 'companion/ollamaAdapter'));
const { createCompanion } = require(path.join(root, 'companion/server'));

const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'r', tradeoffs: 't', cost_complexity: 'c', risks: [] }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slowOllama(delayMs) {
  const st = { inflight: 0, maxInflight: 0, chats: 0, aborted: 0, completed: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end('{"models":[{"name":"m:latest"}]}'); }
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      st.chats++; st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
      let done = false;
      const t = setTimeout(() => { done = true; st.inflight--; st.completed++; if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: { content: JSON.stringify(GOOD) } })); } }, delayMs);
      res.on('close', () => { if (!done) { done = true; clearTimeout(t); st.inflight--; st.aborted++; } });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, port: srv.address().port })));
}

function rawReq(port, opts) {
  return new Promise((resolve) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ host: '127.0.0.1:' + port }, opts.headers || {});
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path, headers, setHost: false }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (opts.abortAfterMs) setTimeout(() => r.destroy(), opts.abortAfterMs);
    if (data) r.write(data); r.end();
  });
}

const now = () => new Date().toISOString();
const task = () => ({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: { goal: 'booking' }, output_schema: P.TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 100 });

async function op1() {
  const o = await slowOllama(600);
  const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
  const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 200, max_retries: 1 } });
  const r = await orch.run(task());
  await sleep(150);
  const leftover = o.st.inflight; // provider calls still running AFTER run() has returned
  await sleep(700); o.srv.close();
  return { id: 'OP-1', observed: { status: r.status, max_concurrent_runtime_requests: o.st.maxInflight, still_running_after_run_returned: leftover, runtime_requests: o.st.chats }, defect_present: o.st.maxInflight > 1 || leftover > 0 };
}

async function startComp(o, extra) {
  const ORIGIN = 'http://127.0.0.1:4180';
  const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + o.port, model: 'm', timeout_ms: 60000 });
  const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: Object.assign({ order: [a.id, 'manual'], timeout_ms: 5000, max_retries: 0 }, extra || {}) });
  const comp = createCompanion({ allowedOrigins: [ORIGIN], orchestrator: orch, now, describeProviders: () => [] });
  const info = await comp.start();
  const p = await rawReq(info.port, { method: 'POST', path: '/v1/pair', headers: { origin: ORIGIN }, body: { code: info.pairingCode } });
  return { comp, port: info.port, h: { origin: ORIGIN, authorization: 'Bearer ' + p.json.token } };
}

async function op2() {
  const o = await slowOllama(800);
  const c = await startComp(o);
  await rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body: { task: { kind: 'TECH_RECOMMENDATION', payload: { goal: 'x' } } }, abortAfterMs: 150 });
  await sleep(250);
  const runningAfterClientLeft = o.st.inflight;
  await sleep(800); await c.comp.stop(); o.srv.close();
  return { id: 'OP-2', observed: { runtime_requests_still_running_after_client_disconnect: runningAfterClientLeft, runtime_completed: o.st.completed, runtime_aborted: o.st.aborted }, defect_present: runningAfterClientLeft > 0 };
}

async function op3() {
  const o = await slowOllama(400);
  const c = await startComp(o);
  const body = { task: { kind: 'TECH_RECOMMENDATION', payload: { goal: 'x' } } };
  const rs = await Promise.all([1, 2, 3].map(() => rawReq(c.port, { method: 'POST', path: '/v1/run', headers: c.h, body })));
  await c.comp.stop(); o.srv.close();
  return { id: 'OP-3', observed: { http_statuses: rs.map((r) => r.status), runtime_requests: o.st.chats, max_concurrent_runtime_requests: o.st.maxInflight }, defect_present: o.st.maxInflight > 1 };
}

(async () => {
  const out = [];
  for (const f of [op1, op2, op3]) { const r = await f(); out.push(r); console.log(JSON.stringify(r)); }
  process.exitCode = 0;
  if (process.argv.includes('--expect-fixed') && out.some((r) => r.defect_present)) process.exitCode = 1;
})();
