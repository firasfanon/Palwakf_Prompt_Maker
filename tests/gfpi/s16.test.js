'use strict';
// S16 — Windows DPAPI fail-closed repair (D1 classification, D2 guaranteed cleanup, D3 no false security PASS).
// [DOUBLE] PowerShell + DPAPI are emulated (AES-GCM per user, entropy as AAD, framed PMOK/PMERR protocol). This proves
// the Node-side logic only; it is NOT Windows evidence (that is `credential-selftest` on Futuer-IT).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { test } = require('./harness');
const C = require('../../companion/credentialStore');

const CANARY = 'sk-CANARY-' + 'Z'.repeat(28);
const CLI = path.join(__dirname, '..', '..', 'companion', 'cli.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-s16-'));
const frameOf = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

/**
 * Emulated PowerShell/DPAPI. opts.faults: { protect: Set<n>, unprotect: Set<n> } 1-based call numbers that fail with
 * opts.mode: TIMEOUT | ENOENT | KILLED | LOAD | NOISE | HOST_EXIT. opts.breakBinding ignores the entropy (mutation).
 */
function dpapi(user, opts) {
  opts = opts || {}; const calls = []; let np = 0; let nu = 0;
  const key = crypto.createHash('sha256').update('dpapi-user-key:' + user).digest();
  const fault = (mode) => ({
    TIMEOUT: { status: null, stdout: '', stderr: '', error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' },
    ENOENT: { status: null, stdout: '', stderr: '', error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    KILLED: { status: null, stdout: '', stderr: '', error: null, signal: 'SIGKILL' },
    LOAD: { status: 3, stdout: 'PMERR:LOAD:FileNotFoundException:0x80070002:N:N', stderr: '' },
    NOISE: { status: 0, stdout: 'WARNING: profile\r\nPMOK:AAAA', stderr: '' },
    HOST_EXIT: { status: 1, stdout: '', stderr: 'host error ' + CANARY },
  })[mode];
  const exec = (cmd, args, input, env) => {
    const script = frameOf(args); const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''));
    calls.push({ args: args.slice(), env: Object.assign({}, env), script });
    const aad = Buffer.from(opts.breakBinding ? 'constant' : (env.PM_DPAPI_ENTROPY || ''));
    if (script.indexOf('::Protect(') !== -1) {
      np++; if (opts.faults && opts.faults.protect && opts.faults.protect.has(np)) return fault(opts.mode || 'TIMEOUT');
      const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
      const ct = Buffer.concat([c.update(buf), c.final()]);
      return { status: 0, stdout: 'PMOK:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), stderr: '' };
    }
    nu++; if (opts.faults && opts.faults.unprotect && opts.faults.unprotect.has(nu)) return fault(opts.mode || 'TIMEOUT');
    let raw; try { raw = Buffer.from(buf.toString().trim(), 'base64'); } catch (e) { return { status: 3, stdout: 'PMERR:INPUT:MethodInvocationException:0x80131501:N:N', stderr: '' }; }
    try { const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(aad); d.setAuthTag(raw.subarray(12, 28)); return { status: 0, stdout: 'PMOK:' + Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('base64'), stderr: '' }; }
    catch (e) { return { status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D', stderr: '' }; }
  };
  exec.calls = calls; return exec;
}
// Correct protect implementation (the helper above keeps one code path per branch; this replaces its protect output).
function realDpapi(user, opts) {
  const base = dpapi(user, opts); let np = 0;
  const key = crypto.createHash('sha256').update('dpapi-user-key:' + user).digest();
  const exec = (cmd, args, input, env) => {
    const script = frameOf(args);
    if (script.indexOf('::Protect(') === -1) return base(cmd, args, input, env);
    np++; base.calls.push({ args: args.slice(), env: Object.assign({}, env), script });
    if (opts && opts.faults && opts.faults.protect && opts.faults.protect.has(np)) {
      return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' };
    }
    const aad = Buffer.from(opts && opts.breakBinding ? 'constant' : (env.PM_DPAPI_ENTROPY || ''));
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
    const ct = Buffer.concat([c.update(Buffer.isBuffer(input) ? input : Buffer.from(String(input))), c.final()]);
    return { status: 0, stdout: 'PMOK:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), stderr: '' };
  };
  exec.calls = base.calls; return exec;
}
const store = (dir, user, opts) => C.createOsStore({ platform: 'win32', dir, exec: realDpapi(user || 'A', opts || {}) });

// ---------------- D1: classification ----------------
test('S16 D1 classifyPs maps every backend outcome to its own code; only a framed DPAPI_UNPROTECT CryptographicException is a refusal', () => {
  const k = (r, op) => C.classifyPs(r, op || 'UNPROTECT');
  assert.deepStrictEqual(k({ status: 0, stdout: 'PMOK:QUJD' }), { ok: true, payload: 'QUJD' });
  const cases = [
    [{ error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' }, 'CRED_BACKEND_TIMEOUT'],
    [{ status: null, signal: 'SIGKILL' }, 'CRED_BACKEND_TIMEOUT'],
    [{ error: { code: 'ENOENT' } }, 'CRED_BACKEND_UNAVAILABLE'],
    [{ error: { code: 'EACCES' } }, 'CRED_BACKEND_UNAVAILABLE'],
    [{ error: { code: 'EIO' } }, 'CRED_BACKEND_FAILED'],
    [{ status: 0, stdout: 'garbage' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    [{ status: 0, stdout: 'WARNING x\nPMOK:QUJD' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    [{ status: 1, stdout: '' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMOK:QUJD' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:LOAD:FileNotFoundException:0x80070002:N:N' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:OUTPUT:IOException:0x80070070:N:N' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:INPUT:MethodInvocationException:0x80131501:N:N' }, 'CIPHERTEXT_MALFORMED'],
    // D1 correction — the shape observed on real Windows: MethodInvocationException wrapping the DPAPI CryptographicException.
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D' }, 'ACCESS_DENIED_OR_TAMPERED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8009000B' }, 'ACCESS_DENIED_OR_TAMPERED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:TargetInvocationException:0x80131604:1:0x8007000D' }, 'ACCESS_DENIED_OR_TAMPERED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:3:0x8007000D' }, 'ACCESS_DENIED_OR_TAMPERED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:CryptographicException:0x8009000B:0:0x8009000B' }, 'ACCESS_DENIED_OR_TAMPERED'],
    // wrapped, but no CryptographicException reachable through invocation wrappers within the bound => backend fault
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:N:N' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:FormatException:0x80131537:N:N' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:Unknown:0x00000000:N:N' }, 'CRED_BACKEND_FAILED'],
    // incoherent / out-of-bound / non-wrapper frames are never a refusal
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:4:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:InvalidOperationException:0x80131509:1:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:0:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:CryptographicException:0x8009000B:0:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:N' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:N:0x8007000D' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    // a refusal frame from any stage other than Unprotect is not a refusal
    [{ status: 3, stdout: 'PMERR:INPUT:MethodInvocationException:0x80131501:1:0x8007000D' }, 'CIPHERTEXT_MALFORMED'],
    [{ status: 3, stdout: 'PMERR:OUTPUT:MethodInvocationException:0x80131501:1:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:LOAD:MethodInvocationException:0x80131501:1:0x8007000D' }, 'CRED_BACKEND_FAILED'],
    // the pre-correction 4-field frame is no longer valid protocol => backend fault, never a refusal
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:CryptographicException:0x8009000B' }, 'CRED_BACKEND_FAILED'],
    [{ status: 0, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    [{ status: 1, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D' }, 'CRED_BACKEND_PROTOCOL_ERROR'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D\nextra' }, 'CRED_BACKEND_FAILED'],
    [{ status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D the message text' }, 'CRED_BACKEND_FAILED'],
  ];
  for (const [r, code] of cases) assert.strictEqual(k(r).code, code, JSON.stringify(r));
  assert.strictEqual(k({ status: 3, stdout: 'PMERR:DPAPI_PROTECT:MethodInvocationException:0x80131501:1:0x80090016' }, 'PROTECT').code, 'DPAPI_PROTECT_FAILED');
  assert.strictEqual(k({ status: 3, stdout: 'PMERR:INPUT:IOException:0x80070070:N:N' }, 'PROTECT').code, 'CRED_BACKEND_FAILED', 'stdin read failure on protect is a backend fault');
});

test('S16 D1 get(): each backend fault surfaces its own code, never data, never ACCESS_DENIED_OR_TAMPERED', async () => {
  for (const mode of ['TIMEOUT', 'ENOENT', 'KILLED', 'LOAD', 'NOISE', 'HOST_EXIT']) {
    const dir = tmp(); await store(dir).set('r1', CANARY);
    const s = C.createOsStore({ platform: 'win32', dir, exec: realDpapi('A', { faults: { unprotect: new Set([1]) }, mode }) });
    // realDpapi delegates unprotect faults to dpapi(), which honours opts.mode
    const e = await s.get('r1').then(() => null, (x) => x);
    assert.ok(e, mode + ': must throw'); assert.notStrictEqual(e.code, 'ACCESS_DENIED_OR_TAMPERED', mode);
    assert.ok(C.BACKEND_CODES.indexOf(e.code) !== -1, mode + ' -> ' + e.code);
    assert.ok(!JSON.stringify(e).includes(CANARY) && !String(e.message).includes(CANARY), mode + ': no secret in error');
    assert.deepStrictEqual(Object.keys(e.diagnostic).sort(), ['code', 'elapsed_ms', 'exception_type', 'hresult', 'inner_crypto_depth', 'inner_crypto_hresult', 'op', 'stage'], 'diagnostic carries only safe fields');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S16 D1 genuine refusals stay ACCESS_DENIED_OR_TAMPERED: other user, other ref, altered ciphertext; malformed => CIPHERTEXT_MALFORMED', async () => {
  const dir = tmp(); await store(dir, 'A').set('a1', CANARY);
  await assert.rejects(() => store(dir, 'B').get('a1'), { code: 'ACCESS_DENIED_OR_TAMPERED' });
  fs.copyFileSync(path.join(dir, 'a1.dpapi'), path.join(dir, 'b1.dpapi'));
  await assert.rejects(() => store(dir, 'A').get('b1'), { code: 'ACCESS_DENIED_OR_TAMPERED' });
  const t = Buffer.from(fs.readFileSync(path.join(dir, 'a1.dpapi'), 'utf8').trim(), 'base64'); t[t.length - 2] ^= 1; fs.writeFileSync(path.join(dir, 'b1.dpapi'), t.toString('base64'));
  await assert.rejects(() => store(dir, 'A').get('b1'), { code: 'ACCESS_DENIED_OR_TAMPERED' });
  for (const bad of ['not base64 at all!', 'QUJD', '']) { fs.writeFileSync(path.join(dir, 'b1.dpapi'), bad); await assert.rejects(() => store(dir, 'A').get('b1'), { code: 'CIPHERTEXT_MALFORMED' }, JSON.stringify(bad)); }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- FAIL_CLOSED + rotation integrity ----------------
test('S16 FAIL_CLOSED set(): protect or verify fault => STORE_FAILED with cause_code, nothing written, no temp file, no plaintext', async () => {
  for (const faults of [{ protect: new Set([1]) }, { unprotect: new Set([1]) }]) {
    const dir = tmp(); const s = C.createOsStore({ platform: 'win32', dir, exec: realDpapi('A', { faults }) });
    const e = await s.set('r1', CANARY).then(() => null, (x) => x);
    assert.strictEqual(e.code, 'STORE_FAILED'); assert.ok(C.BACKEND_CODES.indexOf(e.cause_code) !== -1, e.cause_code);
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'nothing written');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await assert.rejects(() => C.createOsStore({ platform: 'aix' }).set('r', 's'), { code: 'UNSUPPORTED_PLATFORM' });
});

test('S16 rotation integrity: a fault while rotating leaves the PREVIOUS value intact (verify-before-replace)', async () => {
  for (const faults of [{ protect: new Set([2]) }, { unprotect: new Set([2]) }]) {
    const dir = tmp(); const s = C.createOsStore({ platform: 'win32', dir, exec: realDpapi('A', { faults }) });
    await s.set('r1', 'old-' + CANARY);
    await assert.rejects(() => s.rotate('r1', 'new-value'), { code: 'STORE_FAILED' });
    assert.strictEqual(await store(dir).get('r1'), 'old-' + CANARY, 'previous value intact');
    assert.deepStrictEqual(fs.readdirSync(dir), ['r1.dpapi'], 'no temp residue');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S16 secrets: canary never in argv, env, scripts, errors or diagnostics across all operations and faults', async () => {
  const dir = tmp(); const ex = realDpapi('A', { faults: { unprotect: new Set([3]) }, mode: 'HOST_EXIT' });
  const s = C.createOsStore({ platform: 'win32', dir, exec: ex });
  const errs = [];
  await s.set('r1', CANARY); await s.get('r1'); await s.get('r1').catch((e) => errs.push(e)); await s.rotate('r1', CANARY + '2').catch((e) => errs.push(e));
  for (const c of ex.calls) { assert.ok(!c.args.join(' ').includes('CANARY') && !c.script.includes('CANARY') && !JSON.stringify(c.env).includes('CANARY')); }
  for (const e of errs) assert.ok(!JSON.stringify(e).includes('CANARY') && !String(e.message).includes('CANARY'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- credential-selftest under fault injection (D2, D3) ----------------
const SHIM = `
const cp = require('child_process'); const crypto = require('crypto'); const real = cp.spawnSync;
Object.defineProperty(process, 'platform', { value: 'win32' });
const E = process.env; let np = 0; let nu = 0;
const set = (v) => new Set(String(v || '').split(',').filter(Boolean).map(Number));
const fu = set(E.PM_FAIL_UNPROTECT_AT); const fp = set(E.PM_FAIL_PROTECT_AT);
const key = crypto.createHash('sha256').update('dpapi-user-key:' + (E.FAKE_WIN_USER || 'A')).digest();
const faults = { TIMEOUT: { status: null, stdout: '', stderr: '', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }, ENOENT: { status: null, stdout: '', stderr: '', error: Object.assign(new Error('n'), { code: 'ENOENT' }) }, KILLED: { status: null, stdout: '', stderr: '', error: null, signal: 'SIGKILL' }, LOAD: { status: 3, stdout: 'PMERR:LOAD:FileNotFoundException:0x80070002:N:N', stderr: '' }, NOISE: { status: 0, stdout: 'WARNING\\nPMOK:AAAA', stderr: '' } };
if (E.PM_FAIL_UNLINK) { const fs = require('fs'); const ul = fs.unlinkSync; fs.unlinkSync = function (f) { if (/\\.dpapi$/.test(String(f))) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } return ul.apply(this, arguments); }; }
if (E.PM_UNLINK_BUSY_ONCE) { const fs = require('fs'); const ul = fs.unlinkSync; const seen = new Set(); fs.unlinkSync = function (f) { const k = String(f); if (/\\.dpapi$/.test(k) && !seen.has(k)) { seen.add(k); const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; } return ul.apply(this, arguments); }; }
cp.spawnSync = function (cmd, args, o) {
  if (cmd !== 'powershell.exe') return real.apply(this, arguments);
  const s = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  const aad = Buffer.from(E.PM_BREAK_BINDING ? 'constant' : ((o.env && o.env.PM_DPAPI_ENTROPY) || ''));
  const input = Buffer.isBuffer(o.input) ? o.input : Buffer.from(String(o.input || ''));
  if (s.includes('::Protect(')) { np++; if (fp.has(np)) return faults[E.PM_FAIL_MODE || 'TIMEOUT']; const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad); const ct = Buffer.concat([c.update(input), c.final()]); return { status: 0, stdout: 'PMOK:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), stderr: '' }; }
  nu++; if (fu.has(nu)) return faults[E.PM_FAIL_MODE || 'TIMEOUT'];
  try { const r = Buffer.from(input.toString().trim(), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, r.subarray(0, 12)); d.setAAD(aad); d.setAuthTag(r.subarray(12, 28)); return { status: 0, stdout: 'PMOK:' + Buffer.concat([d.update(r.subarray(28)), d.final()]).toString('base64'), stderr: '' }; }
  catch (e) { return { status: 3, stdout: 'PMERR:DPAPI_UNPROTECT:MethodInvocationException:0x80131501:1:0x8007000D', stderr: '' }; }
};`;
function selftest(env, args) {
  const dir = tmp(); const shim = path.join(dir, 'shim.js'); fs.writeFileSync(shim, SHIM); const app = path.join(dir, 'app');
  const r = cp.spawnSync(process.execPath, ['-r', shim, CLI, 'credential-selftest'].concat(args || []), { encoding: 'utf8', env: Object.assign({}, process.env, { APPDATA: app }, env) });
  const credDir = path.join(app, 'prompt-maker-companion', 'credentials');
  const files = fs.existsSync(credDir) ? fs.readdirSync(credDir) : [];
  let ev = null; try { ev = JSON.parse(r.stdout); } catch (e) { /* none */ }
  return { status: r.status, ev, files, raw: r.stdout + r.stderr, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const UNPROTECT_CALLS = 10; // set-verify, roundtrip, 2 controls + binding, 2 controls + altered, rotate-verify, rotate roundtrip

test('S16 clean run: PASS, every control true, nothing left on disk, no synthetic value in evidence', () => {
  const x = selftest({});
  try {
    assert.strictEqual(x.status, 0, x.raw); assert.strictEqual(x.ev.result, 'PASS'); assert.strictEqual(x.ev.schema, 'CredentialStoreSelfTestEvidenceV2');
    ['set_ok', 'get_roundtrip', 'control_before_binding', 'ciphertext_bound_to_ref', 'control_after_binding', 'control_before_altered', 'altered_ciphertext_rejected', 'control_after_altered', 'rotate_roundtrip', 'delete_ok', 'get_after_delete_is_null'].forEach((k) => assert.strictEqual(x.ev.checks[k], true, k));
    assert.deepStrictEqual(x.ev.cleanup.remaining, []); assert.deepStrictEqual(x.files, []);
    assert.ok(!/synthetic-/.test(x.raw) && !/PMOK:/.test(x.raw));
  } finally { x.cleanup(); }
});

test('S16 D2+D3 a backend fault at ANY of the 10 decrypt calls and at either encrypt call: never PASS, never residue', () => {
  const runs = [];
  for (let n = 1; n <= UNPROTECT_CALLS; n++) runs.push({ PM_FAIL_UNPROTECT_AT: String(n) });
  runs.push({ PM_FAIL_PROTECT_AT: '1' }, { PM_FAIL_PROTECT_AT: '2' });
  for (const env of runs) {
    const x = selftest(env);
    try {
      assert.notStrictEqual(x.ev.result, 'PASS', JSON.stringify(env)); assert.ok(x.status === 1 || x.status === 3, JSON.stringify(env) + ' exit ' + x.status);
      assert.strictEqual(x.ev.result, 'INCONCLUSIVE', JSON.stringify(env) + ' a pure backend fault is INCONCLUSIVE, not a security FAIL or PASS');
      assert.deepStrictEqual(x.ev.cleanup.remaining, [], JSON.stringify(env)); assert.deepStrictEqual(x.files, [], JSON.stringify(env) + ' files left');
      assert.ok(x.ev.backend_diagnostics.some((d) => d.code === 'CRED_BACKEND_TIMEOUT'), 'the injected fault is recorded');
      assert.ok(x.ev.backend_diagnostics.every((d) => d.code === 'CRED_BACKEND_TIMEOUT' || d.code === 'ACCESS_DENIED_OR_TAMPERED'), 'only safe, coded entries');
    } finally { x.cleanup(); }
  }
  // Call-count guard: a fault scheduled AFTER the last call is never hit, so the sweep above covered every call.
  for (const env of [{ PM_FAIL_UNPROTECT_AT: String(UNPROTECT_CALLS + 1) }, { PM_FAIL_PROTECT_AT: '3' }]) {
    const x = selftest(env); try { assert.strictEqual(x.ev.result, 'PASS', JSON.stringify(env)); } finally { x.cleanup(); }
  }
});

test('S16 D3 every fault MODE on the binding and tamper checks yields INCONCLUSIVE (never a security PASS)', () => {
  for (const mode of ['TIMEOUT', 'ENOENT', 'KILLED', 'LOAD', 'NOISE']) {
    for (const at of ['4', '7']) {
      const x = selftest({ PM_FAIL_UNPROTECT_AT: at, PM_FAIL_MODE: mode });
      try { assert.strictEqual(x.ev.result, 'INCONCLUSIVE', mode + '@' + at); assert.deepStrictEqual(x.files, []); } finally { x.cleanup(); }
    }
  }
});

test('S16 D3 MUTATION: with the ref binding deliberately broken the self-test can NEVER pass, with or without faults', () => {
  const clean = selftest({ PM_BREAK_BINDING: '1' });
  try { assert.strictEqual(clean.ev.result, 'FAIL'); assert.strictEqual(clean.ev.checks.ciphertext_bound_to_ref, false); assert.deepStrictEqual(clean.files, []); } finally { clean.cleanup(); }
  for (let n = 1; n <= UNPROTECT_CALLS; n++) {
    const x = selftest({ PM_BREAK_BINDING: '1', PM_FAIL_UNPROTECT_AT: String(n) });
    try { assert.notStrictEqual(x.ev.result, 'PASS', 'broken binding + fault at ' + n); assert.deepStrictEqual(x.files, []); } finally { x.cleanup(); }
  }
});

test('S16 D2 --keep-for-foreign-check keeps the ref ONLY after a full PASS; any failure cleans everything', () => {
  const ok = selftest({}, ['--keep-for-foreign-check']);
  try { assert.strictEqual(ok.ev.result, 'PASS'); assert.ok(ok.ev.foreign_check_ref); assert.deepStrictEqual(ok.files, [ok.ev.foreign_check_ref + '.dpapi'], 'exactly the kept ref'); } finally { ok.cleanup(); }
  for (const env of [{ PM_FAIL_UNPROTECT_AT: '4' }, { PM_BREAK_BINDING: '1' }]) {
    const x = selftest(env, ['--keep-for-foreign-check']);
    try { assert.notStrictEqual(x.ev.result, 'PASS'); assert.strictEqual(x.ev.foreign_check_ref, undefined); assert.deepStrictEqual(x.files, [], 'not kept after a failed/inconclusive run'); } finally { x.cleanup(); }
  }
});

test('S16 --verify-foreign: genuine refusal PASS; backend fault INCONCLUSIVE (exit 3); data returned FAIL', () => {
  const dir = tmp(); const shim = path.join(dir, 'shim.js'); fs.writeFileSync(shim, SHIM);
  const appA = path.join(dir, 'A'); const appB = path.join(dir, 'B');
  const run = (args, env) => cp.spawnSync(process.execPath, ['-r', shim, CLI, 'credential-selftest'].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, env) });
  try {
    const k = run(['--keep-for-foreign-check'], { APPDATA: appA, FAKE_WIN_USER: 'A' }); const ref = JSON.parse(k.stdout).foreign_check_ref; assert.ok(ref);
    fs.mkdirSync(path.join(appB, 'prompt-maker-companion', 'credentials'), { recursive: true });
    fs.copyFileSync(path.join(appA, 'prompt-maker-companion', 'credentials', ref + '.dpapi'), path.join(appB, 'prompt-maker-companion', 'credentials', ref + '.dpapi'));
    const b = run(['--verify-foreign', ref], { APPDATA: appB, FAKE_WIN_USER: 'B' }); assert.strictEqual(b.status, 0); assert.strictEqual(JSON.parse(b.stdout).rejected_by, 'DPAPI_CURRENT_USER');
    const bf = run(['--verify-foreign', ref], { APPDATA: appB, FAKE_WIN_USER: 'B', PM_FAIL_UNPROTECT_AT: '1' }); const bfe = JSON.parse(bf.stdout);
    assert.strictEqual(bf.status, 3); assert.strictEqual(bfe.result, 'INCONCLUSIVE'); assert.strictEqual(bfe.rejected_by, 'NONE_BACKEND_FAULT');
    const a = run(['--verify-foreign', ref], { APPDATA: appA, FAKE_WIN_USER: 'A' }); assert.strictEqual(a.status, 1, 'control: the owner decrypts => FAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S16 D2 residue can never PASS: when synthetic files cannot be removed the run is FAIL with RESIDUE_REMAINING', () => {
  const x = selftest({ PM_FAIL_UNLINK: '1' });
  try {
    assert.strictEqual(x.ev.result, 'FAIL'); assert.strictEqual(x.status, 1);
    assert.ok(x.ev.failed_checks.indexOf('RESIDUE_REMAINING') !== -1, JSON.stringify(x.ev.failed_checks));
    assert.ok(x.ev.cleanup.remaining.length >= 1 && x.files.length >= 1, 'the residue is reported, not hidden');
  } finally { x.cleanup(); }
});

test('S16 D2 a transiently locked file (first unlink EBUSY, e.g. antivirus) is still removed by the verified-absence pass', () => {
  const x = selftest({ PM_FAIL_PROTECT_AT: '2', PM_UNLINK_BUSY_ONCE: '1' });
  try { assert.strictEqual(x.ev.result, 'INCONCLUSIVE'); assert.deepStrictEqual(x.ev.cleanup.remaining, []); assert.deepStrictEqual(x.files, []); } finally { x.cleanup(); }
});

test('S16 D1 static script invariants (second line; the real engine test below is the proof): bounded walk, exact type, wrappers only, no message', () => {
  for (const script of [C.DPAPI_PROTECT, C.DPAPI_UNPROTECT]) {
    assert.strictEqual(C.MAX_INNER_DEPTH, 3);
    assert.ok(script.includes('for ($k=0; $k -le ' + C.MAX_INNER_DEPTH + ' -and $null -ne $x; $k++)'), 'bounded InnerException walk');
    assert.ok(script.includes("$x.GetType().FullName -eq 'System.Security.Cryptography.CryptographicException'"), 'exact type, no subclass');
    assert.ok(script.includes("if (@('MethodInvocationException','TargetInvocationException') -notcontains $x.GetType().Name) { break }"), 'walk passes through invocation wrappers only');
    assert.ok(!/\.Message|ToString\(\)|StackTrace|Write-Error|Write-Host/.test(script), 'no exception text can be written');
    assert.strictEqual((script.match(/\[Console\]::Out\.Write\(/g) || []).length, 3, 'only PMOK, PMERR and the fallback PMERR write to stdout');
    for (const st of (script.match(/catch \{ PmErr '([A-Z_]+)' \$_\.Exception \}/g) || [])) assert.ok(/LOAD|INPUT|DPAPI_PROTECT|DPAPI_UNPROTECT|OUTPUT/.test(st));
  }
  assert.ok(C.DPAPI_UNPROTECT.includes("catch { PmErr 'DPAPI_UNPROTECT' $_.Exception }") && C.DPAPI_UNPROTECT.indexOf('ProtectedData]::Unprotect') !== -1);
});

// ---------------- D1 correction: the REAL framed PowerShell script, executed by a real PowerShell engine ----------------
// ProtectedData is replaced by a compiled .NET stand-in that throws the requested exception, so PowerShell itself
// produces the wrapping (MethodInvocationException 0x80131501 -> CryptographicException) observed on Windows.
// Runs wherever `pwsh` exists (GitHub ubuntu runners ship it; PM_PWSH overrides). It is still NOT DPAPI on Windows.
const PWSH = process.env.PM_PWSH || (() => { const r = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pwsh'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; })();
const FAKE_DPAPI = `Add-Type -TypeDefinition @'
using System; using System.Reflection; using System.Security.Cryptography;
public static class PmFakeDpapi {
  static Exception Make(string m) { var c = new CryptographicException(unchecked((int)0x8007000D));
    switch (m) { case "crypto": return c; case "crypto_badkey": return new CryptographicException(unchecked((int)0x8009000B));
      case "tie": return new TargetInvocationException(c); case "tie2": return new TargetInvocationException(new TargetInvocationException(c));
      case "deep": { Exception e = c; for (int i = 0; i < 4; i++) e = new TargetInvocationException(e); return e; }
      case "arg": return new ArgumentException("SECRET-LOOKING-MESSAGE"); case "ioe_crypto": return new InvalidOperationException("SECRET-LOOKING-MESSAGE", c);
      case "pnse": return new PlatformNotSupportedException(); case "subclass": return new CryptographicUnexpectedOperationException("SECRET-LOOKING-MESSAGE");
      default: return null; } }
  public static byte[] Unprotect(byte[] d, byte[] e, object s) { var x = Make(Environment.GetEnvironmentVariable("PM_FAKE_U")); if (x != null) throw x; return (byte[])d.Clone(); }
  public static byte[] Protect(byte[] d, byte[] e, object s) { var x = Make(Environment.GetEnvironmentVariable("PM_FAKE_P")); if (x != null) throw x; return (byte[])d.Clone(); }
}
'@
`;
function pwshExec(fakeEnv, opts) {
  const seen = [];
  const exec = (cmd, args, input, env) => {
    let script = frameOf(args);
    if (!(opts && opts.realProtectedData)) script = FAKE_DPAPI + script.split('[Security.Cryptography.ProtectedData]').join('[PmFakeDpapi]');
    const r = cp.spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, env, fakeEnv) });
    seen.push(String(r.stdout) + String(r.stderr)); return r;
  };
  exec.seen = seen; return exec;
}

test('S16 D1 REAL PowerShell: the Windows-observed wrapping is a genuine refusal; non-crypto inners, deep chains and the real non-Windows ProtectedData are backend faults', async () => {
  const ci = !!process.env.GITHUB_ACTIONS; // in CI, leave an annotation readable from the checks API (no log access needed)
  if (!PWSH) { console.log('       SKIPPED: pwsh not found (set PM_PWSH); covered by the frame-level cases above'); if (ci) console.log('::warning title=S16 real PowerShell::SKIPPED (pwsh not found)'); return; }
  const ver = cp.spawnSync(PWSH, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).stdout.trim();
  console.log('       real pwsh: ' + ver);
  const CIPHER = Buffer.from('synthetic-ciphertext-bytes-0123456789').toString('base64');
  const cases = [
    ['crypto', 'ACCESS_DENIED_OR_TAMPERED', 1, '0x8007000D'], ['crypto_badkey', 'ACCESS_DENIED_OR_TAMPERED', 1, '0x8009000B'],
    ['tie', 'ACCESS_DENIED_OR_TAMPERED', 1, '0x8007000D'], ['tie2', 'ACCESS_DENIED_OR_TAMPERED', 2, '0x8007000D'],
    ['deep', 'CRED_BACKEND_FAILED', null, null], ['arg', 'CRED_BACKEND_FAILED', null, null], ['ioe_crypto', 'CRED_BACKEND_FAILED', null, null],
    ['pnse', 'CRED_BACKEND_FAILED', null, null], ['subclass', 'CRED_BACKEND_FAILED', null, null],
  ];
  for (const [mode, code, depth, inner] of cases) {
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'r1.dpapi'), CIPHER);
    const ex = pwshExec({ PM_FAKE_U: mode }); const s = C.createOsStore({ platform: 'win32', dir, exec: ex });
    const e = await s.get('r1').then(() => null, (x) => x);
    assert.ok(e, mode + ': must not return data');
    assert.strictEqual(e.code, code, mode + ' -> ' + e.code + ' ' + JSON.stringify(e.diagnostic));
    assert.strictEqual(e.diagnostic.exception_type, 'MethodInvocationException', mode + ': PowerShell wraps the .NET failure');
    assert.strictEqual(e.diagnostic.hresult, '0x80131501');
    assert.strictEqual(e.diagnostic.inner_crypto_depth, depth, mode); assert.strictEqual(e.diagnostic.inner_crypto_hresult, inner, mode);
    assert.ok(!ex.seen.join('').includes('SECRET-LOOKING-MESSAGE') && !JSON.stringify(e).includes('SECRET-LOOKING-MESSAGE'), mode + ': no exception message leaves PowerShell');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // malformed stored content -> INPUT stage (wrapped FormatException) -> CIPHERTEXT_MALFORMED, not a refusal
  { const dir = tmp(); fs.writeFileSync(path.join(dir, 'r1.dpapi'), 'A'.repeat(23) + '*'); const s = C.createOsStore({ platform: 'win32', dir, exec: pwshExec({}) });
    await assert.rejects(() => s.get('r1'), { code: 'CIPHERTEXT_MALFORMED' }); fs.rmSync(dir, { recursive: true, force: true }); }
  // protect-stage CryptographicException -> STORE_FAILED / DPAPI_PROTECT_FAILED, nothing written
  { const dir = tmp(); const s = C.createOsStore({ platform: 'win32', dir, exec: pwshExec({ PM_FAKE_P: 'crypto' }) });
    await assert.rejects(() => s.set('r1', 'synthetic-value'), (e) => e.code === 'STORE_FAILED' && e.cause_code === 'DPAPI_PROTECT_FAILED');
    assert.ok(!fs.existsSync(path.join(dir, 'r1.dpapi'))); fs.rmSync(dir, { recursive: true, force: true }); }
  // positive control through the same real engine: set (with verify-before-write) and get round-trip
  { const dir = tmp(); const s = C.createOsStore({ platform: 'win32', dir, exec: pwshExec({}) });
    await s.set('r1', 'synthetic-value-ok'); assert.strictEqual(await s.get('r1'), 'synthetic-value-ok'); fs.rmSync(dir, { recursive: true, force: true }); }
  // the REAL ProtectedData off Windows throws PlatformNotSupportedException (wrapped): a backend fault, never a refusal
  if (process.platform !== 'win32') {
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'r1.dpapi'), CIPHER); const s = C.createOsStore({ platform: 'win32', dir, exec: pwshExec({}, { realProtectedData: true }) });
    const e = await s.get('r1').then(() => null, (x) => x); assert.strictEqual(e.code, 'CRED_BACKEND_FAILED', JSON.stringify(e.diagnostic)); assert.strictEqual(e.diagnostic.inner_crypto_depth, null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (ci) console.log('::notice title=S16 real PowerShell::RAN pwsh ' + ver + ' - all ' + cases.length + ' exception shapes + malformed/protect/positive/real-ProtectedData cases passed');
});
