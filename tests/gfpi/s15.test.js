'use strict';
// S15 — Windows operational closure (W-CRED, W-OLLAMA, T-1, N-2) on Linux.
// [DOUBLE] The Windows DPAPI store is exercised through an exec double that emulates PowerShell ProtectedData
// semantics (per-user key, entropy as authenticated data, tamper/identity rejection). It proves the Node-side logic
// (transport, binding, fail-closed, no plaintext); it is NOT Windows proof — that is `credential-selftest` on Windows.
// [DOUBLE] Ollama is the protocol double in ./ollamaDouble.js, not a real model.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { test } = require('./harness');
const C = require('../../companion/credentialStore');
const P = require('../../gfpi/providerAdapter');
const B = require('../../gfpi/budget');
const { createOllamaAdapter } = require('../../companion/ollamaAdapter');
const { createHostedAdapter } = require('../../companion/hostedAdapter');
const { createOllamaDouble, tokenize } = require('./ollamaDouble');

const SECRET = 'sk-ABCDEF1234567890ABCDEF1234567890';
const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'r', tradeoffs: 't', cost_complexity: 'c', risks: [] }] };
const now = () => new Date().toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-dpapi-'));

/** Emulated PowerShell+DPAPI for user `user`. Records every invocation (cmd, args, input, env) for leak checks. */
function dpapiDouble(user, calls, opts) {
  opts = opts || {};
  const key = crypto.createHash('sha256').update('dpapi-user-key:' + user).digest();
  return (cmd, args, input, env) => {
    calls.push({ cmd, args: args.slice(), input: Buffer.isBuffer(input) ? input.toString('utf8') : String(input || ''), env: Object.assign({}, env) });
    if (opts.missing) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) };
    if (opts.failAll) return { status: 1, stdout: '', stderr: 'boom ' + (input || '') };
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    const aad = Buffer.from(env.PM_DPAPI_ENTROPY || '', 'utf8');
    if (script.indexOf('::Protect(') !== -1) {
      const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
      const ct = Buffer.concat([c.update(Buffer.isBuffer(input) ? input : Buffer.from(input)), c.final()]);
      return { status: 0, stdout: 'PMOK:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), stderr: '' };
    }
    if (script.indexOf('::Unprotect(') !== -1) {
      try {
        const raw = Buffer.from(String(input).trim(), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(aad); d.setAuthTag(raw.subarray(12, 28));
        const pt = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
        return { status: 0, stdout: 'PMOK:' + (opts.corruptOutput ? pt.toString('base64') + 'AAAA' : pt.toString('base64')), stderr: '' };
      } catch (e) { return { status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D', stderr: '' }; } // framed genuine refusal, real Windows shape (wrapped)
    }
    return { status: 1, stdout: '', stderr: 'unknown script' };
  };
}

test('S15 W-CRED [DOUBLE] Windows store: set/get/rotate/list/delete roundtrip; only ciphertext at rest', async () => {
  const dir = tmp(); const calls = [];
  const s = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', calls), dir });
  assert.strictEqual(s.kind, 'OS_WINDOWS_DPAPI_CURRENT_USER');
  await s.set('provider-x', SECRET); assert.strictEqual(await s.get('provider-x'), SECRET);
  const raw = fs.readFileSync(path.join(dir, 'provider-x.dpapi'), 'utf8');
  assert.ok(!raw.includes(SECRET) && !Buffer.from(raw.trim(), 'base64').toString('latin1').includes(SECRET), 'no plaintext at rest');
  await s.rotate('provider-x', SECRET + 'B'); assert.strictEqual(await s.get('provider-x'), SECRET + 'B');
  assert.deepStrictEqual(await s.list(), ['provider-x']);
  assert.ok(await s.delete('provider-x')); assert.strictEqual(await s.get('provider-x'), null); assert.deepStrictEqual(await s.list(), []);
  await assert.rejects(() => s.rotate('missing', 'v'), { code: 'NOT_FOUND' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S15 W-CRED [DOUBLE] the secret never appears in argv, in the environment, or in any error; only on stdin', async () => {
  const dir = tmp(); const calls = [];
  const s = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', calls), dir });
  await s.set('r1', SECRET); await s.get('r1');
  for (const c of calls) {
    assert.ok(!c.args.join(' ').includes(SECRET), 'argv'); assert.ok(!Buffer.from(c.args[c.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le').includes(SECRET), 'script');
    assert.ok(!JSON.stringify(c.env).includes(SECRET), 'env'); assert.deepStrictEqual(Object.keys(c.env), ['PM_DPAPI_ENTROPY']);
    assert.ok(['-NoProfile', '-NonInteractive'].every((f) => c.args.includes(f)));
  }
  assert.ok(calls[0].input.includes(SECRET), 'protect receives the secret on stdin');
  const failing = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', [], { failAll: true }), dir });
  const e = await failing.set('r2', SECRET).catch((x) => x);
  assert.strictEqual(e.code, 'STORE_FAILED'); assert.ok(!String(e.message).includes(SECRET) && !JSON.stringify(e).includes(SECRET), 'stderr never surfaces in errors');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S15 W-CRED [DOUBLE] another Windows identity cannot decrypt (ACCESS_DENIED_OR_TAMPERED, never data)', async () => {
  const dir = tmp();
  await C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', []), dir }).set('shared', SECRET);
  const bob = C.createOsStore({ platform: 'win32', exec: dpapiDouble('bob', []), dir });
  await assert.rejects(() => bob.get('shared'), { code: 'ACCESS_DENIED_OR_TAMPERED' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S15 W-CRED [DOUBLE] ciphertext is bound to its ref and tamper-evident', async () => {
  const dir = tmp(); const s = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', []), dir });
  await s.set('a1', SECRET);
  fs.copyFileSync(path.join(dir, 'a1.dpapi'), path.join(dir, 'b1.dpapi'));
  await assert.rejects(() => s.get('b1'), { code: 'ACCESS_DENIED_OR_TAMPERED' }, 'swapped ref');
  const t = Buffer.from(fs.readFileSync(path.join(dir, 'a1.dpapi'), 'utf8').trim(), 'base64'); t[t.length - 3] ^= 0x41; fs.writeFileSync(path.join(dir, 'a1.dpapi'), t.toString('base64'));
  await assert.rejects(() => s.get('a1'), { code: 'ACCESS_DENIED_OR_TAMPERED' }, 'tampered');
  fs.writeFileSync(path.join(dir, 'a1.dpapi'), 'plain text secret, not base64!');
  // D1: malformed stored content is classified as such (not as a DPAPI refusal) and is still never returned.
  await assert.rejects(() => s.get('a1'), { code: 'CIPHERTEXT_MALFORMED' }, 'non-ciphertext content is never returned');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S15 W-CRED [DOUBLE] fail closed: no PowerShell / DPAPI failure / bad output => error and NOTHING written; no plaintext fallback', async () => {
  for (const o of [{ missing: true }, { failAll: true }]) {
    const dir = tmp(); const s = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', [], o), dir });
    await assert.rejects(() => s.set('r', SECRET), { code: 'STORE_FAILED' });
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'nothing written');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const dir = tmp(); const s = C.createOsStore({ platform: 'win32', exec: dpapiDouble('alice', [], { corruptOutput: true }), dir });
  await assert.rejects(() => s.set('r', SECRET), { code: 'STORE_FAILED' }, 'verification after write fails closed');
  assert.ok(!fs.existsSync(path.join(dir, 'r.dpapi')), 'unverifiable ciphertext removed');
  await assert.rejects(() => s.set('../evil', SECRET), { code: 'BAD_REF' }); await assert.rejects(() => s.set('r', ''), { code: 'EMPTY_SECRET' });
  fs.rmSync(dir, { recursive: true, force: true });
  await assert.rejects(() => C.createOsStore({ platform: 'aix' }).set('r', 's'), { code: 'UNSUPPORTED_PLATFORM' }, 'unsupported platforms still fail closed');
});

test('S15 W-CRED the PowerShell scripts use DPAPI CurrentUser with entropy and contain no secret material', () => {
  for (const s of [C.DPAPI_PROTECT, C.DPAPI_UNPROTECT]) {
    assert.ok(/DataProtectionScope\]::CurrentUser/.test(s)); assert.ok(/\$env:PM_DPAPI_ENTROPY/.test(s)); assert.ok(!/LocalMachine/.test(s));
    assert.ok(/OpenStandardInput|\[Console\]::In/.test(s), 'input from stdin');
  }
  assert.strictEqual(C.entropyFor('x1'), 'prompt-maker-companion:v1:x1');
});

// ---------------- W-OLLAMA ----------------
const task = (extra) => Object.assign({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: { goal: 'x' }, output_schema: P.TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 300 }, extra || {});
const pieces = tokenize(JSON.stringify(GOOD), 6);

test('S15 W-OLLAMA RC-1 a streamed answer slower than the old hidden 60 s-style idle limit but inside the budget succeeds', async () => {
  // Scaled: adapter idle limit 300 ms, generation ~1.2 s total with a chunk every ~30 ms => never idle, budget 3 s.
  const d = await createOllamaDouble({ models: ['m:latest'], tokenMs: Math.ceil(1200 / pieces.length), tokens: pieces });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm', idle_timeout_ms: 300, timeout_ms: 3000 });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 3000, retry_on_timeout: false } });
    const r = await o.run(task());
    assert.strictEqual(r.status, 'OK'); assert.strictEqual(d.st.chats, 1); assert.strictEqual(d.st.lastBody.stream, true);
    const dg = r.attempts[0].diagnostics; assert.strictEqual(dg.phase, 'GENERATING'); assert.ok(dg.chunks >= pieces.length); assert.strictEqual(dg.done_reason, 'stop');
  } finally { await d.close(); }
});

test('S15 W-OLLAMA RC-1 old behaviour reproduced in miniature: a NON-streamed reply under an idle socket limit is cut (control)', async () => {
  // Control for the root cause: the same total time with no bytes until the end (stream:false) trips an idle limit.
  const d = await createOllamaDouble({ models: ['m:latest'], tokenMs: Math.ceil(1200 / pieces.length), tokens: pieces });
  try {
    const t0 = Date.now(); const res = await new Promise((resolve) => {
      const body = JSON.stringify({ model: 'm', stream: false, messages: [] });
      const q = http.request({ host: '127.0.0.1', port: d.port, method: 'POST', path: '/api/chat', timeout: 300, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (rs) => { rs.resume(); rs.on('end', () => resolve('COMPLETED')); });
      q.on('timeout', () => { q.destroy(); resolve('IDLE_TIMEOUT'); }); q.on('error', () => resolve('IDLE_TIMEOUT')); q.end(body);
    });
    assert.strictEqual(res, 'IDLE_TIMEOUT'); assert.ok(Date.now() - t0 < 1000);
  } finally { await d.close(); }
});

test('S15 W-OLLAMA RC-2 a timed-out local generation is NOT repeated when retry_on_timeout=false; diagnostics say GENERATING', async () => {
  const d = await createOllamaDouble({ models: ['m:latest'], tokenMs: 200, tokens: pieces });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm', idle_timeout_ms: 5000 });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 1000, max_retries: 1, retry_on_timeout: false } });
    const t0 = Date.now(); const r = await o.run(task());
    assert.strictEqual(r.status, 'DEGRADED_TO_MANUAL'); assert.strictEqual(d.st.chats, 1, 'not repeated'); assert.ok(Date.now() - t0 < 1800);
    assert.strictEqual(r.attempts[0].code, 'TIMEOUT'); assert.strictEqual(r.attempts[0].diagnostics.phase, 'GENERATING'); assert.ok(r.attempts[0].diagnostics.chunks >= 1);
    // The double records the connection teardown the moment it happens (aborted); its inflight counter only settles
    // after its current per-chunk delay, so wait (bounded) for the direct teardown signal.
    const t1 = Date.now(); while (d.st.aborted < 1 && Date.now() - t1 < 1000) await new Promise((x) => setTimeout(x, 20));
    assert.strictEqual(d.st.aborted, 1, 'the timed-out attempt was torn down, not orphaned');
  } finally { await d.close(); }
});

test('S15 W-OLLAMA slow model load: no first chunk within the budget => phase LOADING_OR_PROMPT; warmUp measures load separately', async () => {
  const d = await createOllamaDouble({ models: ['m:latest'], loadMs: 1500, tokenMs: 5, tokens: pieces });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 600, retry_on_timeout: false } });
    const r = await o.run(task()); assert.strictEqual(r.attempts[0].code, 'TIMEOUT'); assert.strictEqual(r.attempts[0].diagnostics.phase, 'LOADING_OR_PROMPT'); assert.strictEqual(r.attempts[0].diagnostics.first_chunk_ms, null);
    const d2 = await createOllamaDouble({ models: ['m:latest'], loadMs: 400, tokenMs: 5, tokens: pieces });
    try {
      const a2 = createOllamaAdapter({ endpoint: d2.url, model: 'm' });
      const w = await a2.warmUp({ timeout_ms: 5000 }); assert.ok(w.ok && w.wall_ms >= 380 && w.runtime_load_ms >= 390, JSON.stringify(w)); assert.strictEqual(d2.st.chats, 0, 'warm-up does not generate');
      const o2 = P.createOrchestrator({ adapters: [a2, P.createManualAdapter()], now, policy: { order: [a2.id, 'manual'], timeout_ms: 600, retry_on_timeout: false } });
      const r2 = await o2.run(task()); assert.strictEqual(r2.status, 'OK', 'after warm-up the same budget is enough'); assert.ok(r2.attempts[0].diagnostics.first_chunk_ms < 300);
    } finally { await d2.close(); }
  } finally { await d.close(); }
});

test('S15 W-OLLAMA a stream that stalls after tokens is cut by the idle limit (stalled=true), not left hanging', async () => {
  // One chunk, then 2 s of silence before the final chunk => a stall after tokens started flowing.
  const st = http.createServer((req, res) => { if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end('{"models":[{"name":"m:latest"}]}'); } req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/x-ndjson'); res.write('{"message":{"content":"{\\"rec"},"done":false}\n'); setTimeout(() => res.end('{"message":{"content":""},"done":true}\n'), 2000); }); });
    await new Promise((x) => st.listen(0, '127.0.0.1', x));
    const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + st.address().port, model: 'm', idle_timeout_ms: 300 });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 5000, retry_on_timeout: false } });
    const t0 = Date.now(); const r = await o.run(task());
  try {
    assert.strictEqual(r.attempts[0].code, 'TIMEOUT'); assert.strictEqual(r.attempts[0].diagnostics.stalled, true); assert.ok(Date.now() - t0 < 1500);
  } finally { st.closeAllConnections(); st.close(); }
});

test('S15 W-OLLAMA structured output: schema sent as format; a runtime rejecting it gets "json" once (remembered); output still validated', async () => {
  const d = await createOllamaDouble({ models: ['m:latest'], tokens: pieces, rejectSchemaFormat: true });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 3000 } });
    assert.strictEqual((await o.run(task())).status, 'OK'); assert.strictEqual(typeof d.st.formats[0], 'object'); assert.strictEqual(d.st.formats[1], 'json');
    assert.strictEqual((await o.run(task())).status, 'OK'); assert.strictEqual(d.st.formats[2], 'json', 'fallback remembered (no repeated 400)');
  } finally { await d.close(); }
  const bad = await createOllamaDouble({ models: ['m:latest'], tokens: tokenize(JSON.stringify(Object.assign({}, GOOD, { status: 'USER_CONFIRMED' })), 6) });
  try {
    const a = createOllamaAdapter({ endpoint: bad.url, model: 'm' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 3000 } });
    assert.strictEqual((await o.run(task())).status, 'DEGRADED_TO_MANUAL', 'schema validation is not relaxed by constrained decoding');
  } finally { await bad.close(); }
});

test('S15 W-OLLAMA output truncated at num_predict is reported (done_reason=length) and never accepted as valid', async () => {
  const half = JSON.stringify(GOOD).slice(0, 40);
  const d = await createOllamaDouble({ models: ['m:latest'], tokens: tokenize(half, 6), doneReason: 'length' });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm' });
    const o = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 3000 } });
    const r = await o.run(task()); assert.strictEqual(r.status, 'DEGRADED_TO_MANUAL');
    assert.ok(r.attempts.some((x) => x.diagnostics && x.diagnostics.done_reason === 'length'));
  } finally { await d.close(); }
});

test('S15 W-OLLAMA diagnostics in attempts are numeric/enum only: model output text never leaks into attempt records', async () => {
  const d = await createOllamaDouble({ models: ['m:latest'], tokens: tokenize(JSON.stringify(Object.assign({}, GOOD, { recommended_stack: 'LEAKCANARY' })), 6) });
  try {
    const a = createOllamaAdapter({ endpoint: d.url, model: 'm' });
    const r = await P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now, policy: { order: [a.id, 'manual'], timeout_ms: 3000 } }).run(task());
    assert.ok(!JSON.stringify(r.attempts).includes('LEAKCANARY'));
  } finally { await d.close(); }
});

// ---------------- T-1 (strengthened S13 property) ----------------
test('S15 T-1 cancelled LOCAL run never escalates to an APPROVED and CONSENTED external provider; control proves it is reachable', async () => {
  const store = C.createMemoryStore(); await store.set('hx', SECRET); let calls = 0;
  const hosted = createHostedAdapter({ id: 'hosted-x', endpoint: 'https://api.example.test/v1/run', model: 'm', credential_ref: 'hx' }, { store, fetch: async () => { calls++; return { ok: true, json: async () => ({ json: GOOD }) }; } });
  const approved = Object.assign(B.defaultBudgetPolicy(), { per_call_cap: 1, per_project_cap: 5, period_cap: 5, token_caps: { input_per_call: 5000, output_per_call: 2000 }, approved_by: 'owner', approved_at: now(), credential_ref: 'hx' });
  assert.ok(B.checkBudget(approved, B.newUsage(), { input_tokens: 10, max_output_tokens: 300, cost: 0 }, 'EXTERNAL').allowed, 'precondition: budget really authorizes the external call');
  const t = task();
  const sha = require('../../gfpi/canon').sha256OfValue({ kind: t.kind, prompt_version: t.prompt_version, payload: require('../../gfpi/redaction').redactValue(t.payload).value });
  const d = await createOllamaDouble({ models: ['m:latest'], tokenMs: 100, tokens: pieces });
  try {
    const local = createOllamaAdapter({ endpoint: d.url, model: 'm' });
    const mk = () => { const o = P.createOrchestrator({ adapters: [local, hosted, P.createManualAdapter()], now, budgetPolicy: approved, policy: { order: [local.id, 'hosted-x', 'manual'], timeout_ms: 5000, max_retries: 0 } }); o.consent.grant({ provider_id: 'hosted-x', payload_sha256: sha, granted_by: 'u', granted_at: now(), expires_at: new Date(Date.now() + 60000).toISOString() }); return o; };
    const ac = new AbortController(); setTimeout(() => ac.abort(), 150);
    const r = await mk().run(t, { signal: ac.signal });
    assert.strictEqual(r.status, 'CANCELLED'); assert.strictEqual(calls, 0, 'external provider never contacted after cancel');
    await d.close(); await new Promise((x) => setTimeout(x, 30));
    const ctl = await mk().run(t); // control: local runtime gone, same approval + consent => external IS reached
    assert.strictEqual(ctl.status, 'OK'); assert.strictEqual(ctl.provider_id, 'hosted-x'); assert.strictEqual(calls, 1, 'control proves the external path was really available');
  } finally { await d.close().catch(() => {}); }
});

// ---------------- N-2 (localhost / IPv6 loopback) ----------------
function ipv6Available() { return new Promise((r) => { const s = http.createServer(); s.once('error', () => r(false)); s.listen(0, '::1', () => { s.close(); r(true); }); }); }
test('S15 N-2 endpoint "localhost" reaches a runtime bound to 127.0.0.1 or to ::1 (address-family auto-selection)', async () => {
  const v4 = await createOllamaDouble({ models: ['m:latest'], tokens: pieces });
  try { const p = await createOllamaAdapter({ endpoint: 'http://localhost:' + v4.port, model: 'm' }).probe(); assert.strictEqual(p.runtime, 'REACHABLE'); } finally { await v4.close(); }
  if (await ipv6Available()) {
    const v6 = await createOllamaDouble({ models: ['m:latest'], tokens: pieces, host: '::1' });
    try {
      assert.strictEqual((await createOllamaAdapter({ endpoint: 'http://localhost:' + v6.port, model: 'm' }).probe()).runtime, 'REACHABLE');
      assert.strictEqual((await createOllamaAdapter({ endpoint: 'http://[::1]:' + v6.port, model: 'm' }).probe()).runtime, 'REACHABLE');
    } finally { await v6.close(); }
  }
  for (const bad of ['http://0.0.0.0:11434', 'http://[::]:11434', 'http://localhost.evil.test:11434', 'http://127.0.0.2:11434', 'http://[::ffff:127.0.0.1]:11434']) {
    assert.throws(() => createOllamaAdapter({ endpoint: bad, model: 'm' }), /NOT_LOOPBACK|BAD_URL/, bad);
  }
});

test('S15 N-2 the companion listens on 127.0.0.1 only: not on ::1, not on non-loopback interfaces; foreign Origin refused', async () => {
  const { createCompanion } = require('../../companion/server');
  const o = P.createOrchestrator({ adapters: [P.createManualAdapter()], now, policy: { order: ['manual'] } });
  const comp = createCompanion({ uiDir: path.join(__dirname, '..', '..', 'dist'), orchestrator: o, now, describeProviders: () => [] });
  const info = await comp.start();
  const get = (host, p, headers) => new Promise((resolve) => { const q = http.request({ host, port: info.port, path: p, headers: headers || {}, family: host.indexOf(':') !== -1 ? 6 : 4 }, (rs) => { rs.resume(); rs.on('end', () => resolve(rs.statusCode)); }); q.on('error', (e) => resolve(e.code)); q.setTimeout(1500, () => { q.destroy(); resolve('TIMEOUT'); }); q.end(); });
  try {
    assert.strictEqual(await get('127.0.0.1', '/'), 200);
    if (await ipv6Available()) assert.strictEqual(await get('::1', '/'), 'ECONNREFUSED', 'not exposed on IPv6 loopback either');
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (lan) assert.notStrictEqual(await get(lan.address, '/'), 200, 'not reachable from a non-loopback interface');
    assert.strictEqual(await get('127.0.0.1', '/v1/status', { origin: 'http://localhost.evil.test:' + info.port }), 403);
  } finally { await comp.stop(); }
});

// ---------------- W-REPRO (line endings independent of local Git settings) ----------------
test('S15 W-REPRO every tracked text file resolves to eol=lf; a core.autocrlf=true clone checks out LF (byte-exact gates hold)', () => {
  const cp = require('child_process'); const root = path.join(__dirname, '..', '..');
  if (cp.spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root }).status !== 0) return; // exported tree without .git
  const files = cp.spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const attrs = cp.spawnSync('git', ['check-attr', 'text', 'eol', '--stdin'], { cwd: root, input: files.join('\n'), encoding: 'utf8' }).stdout;
  const eol = {}; attrs.split('\n').forEach((l) => { const m = /^(.*): eol: (.*)$/.exec(l); if (m) eol[m[1]] = m[2]; });
  const binary = /\.(png|jpe?g|gif|pdf|bundle|gz|zip)$/i;
  const notLf = files.filter((f) => !binary.test(f) && eol[f] !== 'lf'); assert.deepStrictEqual(notLf, [], 'text files without eol=lf');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-crlf-'));
  try {
    // A normal clone of the committed HEAD, exactly as a Windows user with core.autocrlf=true would make it.
    const r = cp.spawnSync('git', ['-c', 'core.autocrlf=true', 'clone', '-q', '--no-hardlinks', root, dir], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr);
    const head = cp.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const co = cp.spawnSync('git', ['-c', 'core.autocrlf=true', 'checkout', '-q', head], { cwd: dir, encoding: 'utf8' }); assert.strictEqual(co.status, 0, co.stderr);
    for (const f of ['tests/run.js', 'src/core.js', 'dist/core_bundle.js', 'companion/server.js', 'tests/gfpi/frozen_baseline.json']) {
      const a = fs.readFileSync(path.join(dir, f)); assert.ok(!a.includes(13), f + ' contains CR after an autocrlf=true checkout');
      assert.ok(a.equals(fs.readFileSync(path.join(root, f))) || cp.spawnSync('git', ['diff', '--quiet', 'HEAD', '--', f], { cwd: root }).status !== 0, f + ' differs from the committed bytes');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S15 W-CRED [DOUBLE] credential-selftest CLI end-to-end under an emulated win32 + DPAPI: PASS, evidence holds no secret', () => {
  const cp = require('child_process'); const dir = tmp(); const shim = path.join(dir, 'win32-dpapi-shim.js');
  // Preloaded shim: process.platform -> win32; spawnSync('powershell.exe') -> AES-GCM emulation keyed per USERNAME.
  fs.writeFileSync(shim, `
    const cp = require('child_process'); const crypto = require('crypto'); const real = cp.spawnSync;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    cp.spawnSync = function (cmd, args, o) {
      if (cmd !== 'powershell.exe') return real.apply(this, arguments);
      const key = crypto.createHash('sha256').update('dpapi-user-key:' + (process.env.FAKE_WIN_USER || 'A')).digest();
      const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      const aad = Buffer.from((o.env && o.env.PM_DPAPI_ENTROPY) || ''); const input = Buffer.isBuffer(o.input) ? o.input : Buffer.from(String(o.input || ''));
      try {
        if (script.includes('::Protect(')) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad); const ct = Buffer.concat([c.update(input), c.final()]); return { status: 0, stdout: 'PMOK:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), stderr: '' }; }
        const raw = Buffer.from(input.toString().trim(), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(aad); d.setAuthTag(raw.subarray(12, 28));
        return { status: 0, stdout: 'PMOK:' + Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('base64'), stderr: '' };
      } catch (e) { return { status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D', stderr: '' }; }
    };`);
  const cli = path.join(__dirname, '..', '..', 'companion', 'cli.js');
  const run = (args, user, appdata) => cp.spawnSync(process.execPath, ['-r', shim, cli].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, { APPDATA: appdata, FAKE_WIN_USER: user }) });
  try {
    const appA = path.join(dir, 'A'); const appB = path.join(dir, 'B');
    const r = run(['credential-selftest', '--evidence-out', path.join(dir, 'ev.json')], 'A', appA);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const ev = JSON.parse(fs.readFileSync(path.join(dir, 'ev.json'), 'utf8'));
    assert.strictEqual(ev.store_kind, 'OS_WINDOWS_DPAPI_CURRENT_USER'); assert.strictEqual(ev.result, 'PASS');
    ['set_ok', 'get_roundtrip', 'no_plaintext_at_rest', 'ciphertext_bound_to_ref', 'altered_ciphertext_rejected', 'rotate_roundtrip', 'list_has_ref_without_value', 'delete_ok', 'get_after_delete_is_null'].forEach((k) => assert.strictEqual(ev.checks[k], true, k));
    assert.ok(!/synthetic-/.test(r.stdout) && !/synthetic-/.test(JSON.stringify(ev)), 'no synthetic secret value in output or evidence');
    // Foreign identity, DPAPI layer: A keeps a ciphertext, it is copied into B's folder, B cannot decrypt it.
    const k = run(['credential-selftest', '--keep-for-foreign-check'], 'A', appA); assert.strictEqual(k.status, 0, k.stdout);
    const ref = JSON.parse(k.stdout).foreign_check_ref; assert.ok(ref);
    fs.mkdirSync(path.join(appB, 'prompt-maker-companion', 'credentials'), { recursive: true });
    fs.copyFileSync(path.join(appA, 'prompt-maker-companion', 'credentials', ref + '.dpapi'), path.join(appB, 'prompt-maker-companion', 'credentials', ref + '.dpapi'));
    const f = run(['credential-selftest', '--verify-foreign', ref], 'B', appB); const fe = JSON.parse(f.stdout);
    assert.strictEqual(f.status, 0); assert.strictEqual(fe.checks.foreign_user_cannot_decrypt, true); assert.strictEqual(fe.rejected_by, 'DPAPI_CURRENT_USER');
    const same = run(['credential-selftest', '--verify-foreign', ref], 'A', appA); assert.strictEqual(same.status, 1, 'control: the owner CAN decrypt, so the check is not vacuous');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
