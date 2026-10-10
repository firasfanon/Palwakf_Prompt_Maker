'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Credential store abstraction. Secrets are NEVER written to Git, exports, logs, browser storage or plain files.
 *  - createMemoryStore: tests / process lifetime only.
 *  - createOsStore: delegates to the OS credential store (macOS `security -i` via stdin, Linux `secret-tool` via stdin).
 *    Windows: DPAPI with CurrentUser scope via Windows PowerShell (`ProtectedData`), secret and ciphertext over stdin
 *    only; ciphertext files under the user profile. Any other platform fails CLOSED. Real keychains are NOT proven
 *    in the Linux build sandbox: the logic is tested against an injected `exec` double; the Windows proof is the
 *    `credential-selftest` command run on a real Windows machine.
 * Credential references are opaque names ("provider-x"); values never appear in return values of list()/describe().
 */
const SERVICE = 'prompt-maker-companion';
const REF_RE = /^[A-Za-z0-9._-]{1,64}$/;

function checkRef(ref) { if (!REF_RE.test(ref)) throw Object.assign(new Error('invalid credential ref'), { code: 'BAD_REF' }); }

function createMemoryStore() {
  const m = new Map();
  return {
    kind: 'MEMORY',
    async set(ref, secret) { checkRef(ref); if (typeof secret !== 'string' || !secret) throw Object.assign(new Error('empty secret'), { code: 'EMPTY_SECRET' }); m.set(ref, secret); },
    async get(ref) { checkRef(ref); return m.has(ref) ? m.get(ref) : null; },
    async delete(ref) { checkRef(ref); return m.delete(ref); },
    async list() { return Array.from(m.keys()).sort(); },
    async rotate(ref, secret) { checkRef(ref); if (!m.has(ref)) throw Object.assign(new Error('no such credential'), { code: 'NOT_FOUND' }); m.set(ref, secret); },
  };
}

function defaultExec(cmd, args, input, env) {
  const r = cp.spawnSync(cmd, args, { input: input || '', encoding: 'utf8', timeout: 20000, windowsHide: true, env: env ? Object.assign({}, process.env, env) : process.env });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

function createOsStore(opts) {
  opts = opts || {};
  const platform = opts.platform || process.platform;
  const exec = opts.exec || defaultExec;
  const unsupported = () => Object.assign(new Error('OS credential store not supported on ' + platform + ' (fail closed)'), { code: 'UNSUPPORTED_PLATFORM' });
  const q = (s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
  if (platform === 'linux') {
    return {
      kind: 'OS_LINUX_SECRET_TOOL',
      async set(ref, secret) { checkRef(ref); const r = exec('secret-tool', ['store', '--label=' + SERVICE + ':' + ref, 'service', SERVICE, 'account', ref], secret); if (r.status !== 0) throw Object.assign(new Error('store failed'), { code: 'STORE_FAILED' }); },
      async get(ref) { checkRef(ref); const r = exec('secret-tool', ['lookup', 'service', SERVICE, 'account', ref]); return r.status === 0 && r.stdout ? r.stdout : null; },
      async delete(ref) { checkRef(ref); return exec('secret-tool', ['clear', 'service', SERVICE, 'account', ref]).status === 0; },
      async list() { throw Object.assign(new Error('list not supported by secret-tool'), { code: 'LIST_UNSUPPORTED' }); },
      async rotate(ref, secret) { return this.set(ref, secret); },
    };
  }
  if (platform === 'darwin') {
    // `security -i` reads commands from stdin so the secret never appears in argv / process listings.
    return {
      kind: 'OS_MACOS_KEYCHAIN',
      async set(ref, secret) { checkRef(ref); if (/[\r\n]/.test(secret)) throw Object.assign(new Error('multi-line secrets unsupported'), { code: 'UNSUPPORTED_SECRET' }); const r = exec('security', ['-i'], 'add-generic-password -U -s ' + q(SERVICE) + ' -a ' + q(ref) + ' -w ' + q(secret) + '\n'); if (r.status !== 0) throw Object.assign(new Error('store failed'), { code: 'STORE_FAILED' }); },
      async get(ref) { checkRef(ref); const r = exec('security', ['find-generic-password', '-s', SERVICE, '-a', ref, '-w']); return r.status === 0 ? r.stdout.replace(/\n$/, '') : null; },
      async delete(ref) { checkRef(ref); return exec('security', ['delete-generic-password', '-s', SERVICE, '-a', ref]).status === 0; },
      async list() { throw Object.assign(new Error('list not supported'), { code: 'LIST_UNSUPPORTED' }); },
      async rotate(ref, secret) { return this.set(ref, secret); },
    };
  }
  if (platform === 'win32') return createWindowsDpapiStore({ exec, dir: opts.dir, shell: opts.shell });
  return { kind: 'UNSUPPORTED', set: async () => { throw unsupported(); }, get: async () => { throw unsupported(); }, delete: async () => { throw unsupported(); }, list: async () => { throw unsupported(); }, rotate: async () => { throw unsupported(); } };
}

/**
 * Windows DPAPI store (W-CRED). Security properties:
 *  - Encryption: ProtectedData.Protect with DataProtectionScope.CurrentUser — only the same Windows user on the same
 *    machine can decrypt; another identity gets an error (ACCESS_DENIED_OR_TAMPERED), never data.
 *  - Binding: additional entropy "prompt-maker-companion:v1:<ref>" — a ciphertext copied to another ref will not decrypt.
 *  - Transport: the secret goes to PowerShell on STDIN and comes back base64 on STDOUT; never argv, never env, never a
 *    temp file. Only the (non-secret) entropy label is passed in the environment.
 *  - At rest: only ciphertext is written (atomic temp+rename, 0600 where supported) under %APPDATA%. No plaintext
 *    fallback exists: if PowerShell/DPAPI is unavailable or fails, the operation FAILS CLOSED.
 *  - Integrity: a new ciphertext is decrypted and compared BEFORE it replaces the stored file, so any failure leaves the
 *    previous value intact (or absent) — never a partially verified one.
 *  - Errors carry codes only (no stderr/stdout content, no exception message, which could echo data).
 *
 * D1 (error classification): PowerShell answers with ONE framed line, PMOK:<base64> or
 * PMERR:<STAGE>:<OuterType>:<0xOuterHRESULT>:<CryptoDepth|N>:<0xCryptoHRESULT|N>, never an exception message.
 * Windows PowerShell wraps a .NET method failure in MethodInvocationException (0x80131501); the DPAPI refusal is its
 * InnerException (CryptographicException, e.g. 0x8007000D). The catch block therefore walks the InnerException chain
 * (bounded: depth 0..MAX_INNER_DEPTH, passing ONLY through invocation wrappers) for an exact
 * System.Security.Cryptography.CryptographicException and reports its depth and HRESULT. Only such an exception from the ProtectedData.Unprotect stage, directly or inside an allowed
 * method-invocation wrapper, is a genuine refusal (ACCESS_DENIED_OR_TAMPERED). Any other inner exception, a chain
 * deeper than the bound, and every process, timeout, host and protocol failure get CRED_BACKEND_* codes, so a backend
 * fault can never pass for a security rejection.
 */
const MAX_INNER_DEPTH = 3;
/** The only exceptions the walk may pass through on its way to the CryptographicException (invocation wrappers). */
const CRYPTO_WRAPPERS = ['MethodInvocationException', 'TargetInvocationException'];
const CRYPTO_WRAPPERS_PS = CRYPTO_WRAPPERS.join("','");
// Writes the frame and exits 3. Defined once; every stage's catch calls it. Never writes $e.Message or data.
const PS_ERR_FN = "function PmErr([string]$s, $e) { try { $t=$e.GetType().Name; $h='0x{0:X8}' -f $e.HResult; $d='N'; $ch='N'; $x=$e; " +
  'for ($k=0; $k -le ' + MAX_INNER_DEPTH + " -and $null -ne $x; $k++) { if ($x.GetType().FullName -eq 'System.Security.Cryptography.CryptographicException') { $d=[string]$k; $ch='0x{0:X8}' -f $x.HResult; break }; " +
  "if (@('" + CRYPTO_WRAPPERS_PS + "') -notcontains $x.GetType().Name) { break }; $x=$x.InnerException }; " +
  "[Console]::Out.Write('PMERR:' + $s + ':' + $t + ':' + $h + ':' + $d + ':' + $ch) } catch { [Console]::Out.Write('PMERR:' + $s + ':Unknown:0x00000000:N:N') }; exit 3 }";
const PS_FRAME = (stages) => ["$ErrorActionPreference='Stop'", PS_ERR_FN,
  "try { Add-Type -AssemblyName System.Security } catch { PmErr 'LOAD' $_.Exception }"]
  .concat(stages.map(([stage, body]) => 'try { ' + body + " } catch { PmErr '" + stage + "' $_.Exception }"))
  .join('; ');
const DPAPI_PROTECT = PS_FRAME([
  ['INPUT', '$in=[Console]::OpenStandardInput(); $ms=New-Object System.IO.MemoryStream; $in.CopyTo($ms); $b=$ms.ToArray(); $e=[Text.Encoding]::UTF8.GetBytes($env:PM_DPAPI_ENTROPY)'],
  ['DPAPI_PROTECT', '$c=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Array]::Clear($b,0,$b.Length)'],
  ['OUTPUT', "[Console]::Out.Write('PMOK:' + [Convert]::ToBase64String($c))"],
]);
const DPAPI_UNPROTECT = PS_FRAME([
  ['INPUT', '$t=[Console]::In.ReadToEnd().Trim(); $c=[Convert]::FromBase64String($t); $e=[Text.Encoding]::UTF8.GetBytes($env:PM_DPAPI_ENTROPY)'],
  ['DPAPI_UNPROTECT', '$b=[Security.Cryptography.ProtectedData]::Unprotect($c,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)'],
  ['OUTPUT', "[Console]::Out.Write('PMOK:' + [Convert]::ToBase64String($b)); [Array]::Clear($b,0,$b.Length)"],
]);
const encodePs = (script) => Buffer.from(script, 'utf16le').toString('base64');
const entropyFor = (ref) => 'prompt-maker-companion:v1:' + ref;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const OK_RE = /^PMOK:([A-Za-z0-9+/]+={0,2})$/;
const ERR_RE = /^PMERR:(LOAD|INPUT|DPAPI_PROTECT|DPAPI_UNPROTECT|OUTPUT):([A-Za-z][A-Za-z0-9]{0,63}):(0x[0-9A-F]{8}):([0-9]|N):(0x[0-9A-F]{8}|N)$/;
const MIN_CIPHER_BYTES = 16;
/** Codes that mean "the backend could not answer" — never a security verdict. */
const BACKEND_CODES = ['CRED_BACKEND_UNAVAILABLE', 'CRED_BACKEND_TIMEOUT', 'CRED_BACKEND_FAILED', 'CRED_BACKEND_PROTOCOL_ERROR', 'DPAPI_PROTECT_FAILED'];

/** Classify one PowerShell run. Returns { ok:true, payload } or { ok:false, code, stage, exception_type, hresult } (no data). */
function classifyPs(r, op) {
  if (r.error) {
    const c = r.error.code;
    return { ok: false, code: c === 'ETIMEDOUT' ? 'CRED_BACKEND_TIMEOUT' : (c === 'ENOENT' || c === 'EACCES' || c === 'EPERM' ? 'CRED_BACKEND_UNAVAILABLE' : 'CRED_BACKEND_FAILED'), stage: 'PROCESS' };
  }
  if (r.signal) return { ok: false, code: 'CRED_BACKEND_TIMEOUT', stage: 'PROCESS' };
  const out = String(r.stdout || '').trim();
  const m = OK_RE.exec(out);
  if (m && r.status === 0) return { ok: true, payload: m[1] };
  const e = ERR_RE.exec(out);
  if (!e) return { ok: false, code: r.status === 0 ? 'CRED_BACKEND_PROTOCOL_ERROR' : 'CRED_BACKEND_FAILED', stage: 'PROTOCOL' };
  // PmErr always exits 3: an error frame with any other exit status is incoherent, never a verdict.
  if (r.status !== 3) return { ok: false, code: 'CRED_BACKEND_PROTOCOL_ERROR', stage: 'PROTOCOL' };
  const [, stage, type, hresult, depthS, cryptoHr] = e;
  const depth = depthS === 'N' ? null : Number(depthS);
  // A genuine refusal: an exact CryptographicException found within the bound, reported consistently — itself the outer
  // exception (depth 0), or the inner exception of an allowed invocation wrapper (depth 1..MAX_INNER_DEPTH).
  const crypto = depth !== null && cryptoHr !== 'N' && depth <= MAX_INNER_DEPTH &&
    ((depth === 0 && type === 'CryptographicException' && cryptoHr === hresult) || (depth >= 1 && CRYPTO_WRAPPERS.indexOf(type) !== -1));
  const coherent = (depth === null) === (cryptoHr === 'N');
  let code = 'CRED_BACKEND_FAILED';
  if (!coherent) code = 'CRED_BACKEND_PROTOCOL_ERROR';
  else if (stage === 'DPAPI_UNPROTECT' && crypto) code = 'ACCESS_DENIED_OR_TAMPERED';
  else if (stage === 'DPAPI_PROTECT') code = 'DPAPI_PROTECT_FAILED';
  else if (stage === 'INPUT' && op === 'UNPROTECT') code = 'CIPHERTEXT_MALFORMED';
  return { ok: false, code, stage, exception_type: type, hresult, inner_crypto_depth: depth, inner_crypto_hresult: cryptoHr === 'N' ? null : cryptoHr };
}

function createWindowsDpapiStore(o) {
  const exec = o.exec;
  const shell = o.shell || 'powershell.exe';
  const dir = o.dir || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), SERVICE, 'credentials');
  const fileFor = (ref) => path.join(dir, ref + '.dpapi');
  const fail = (code, msg, extra) => Object.assign(new Error(msg || code), { code }, extra || {});
  const diagnostic = (res, op, t0) => ({ op, code: res.code, stage: res.stage, exception_type: res.exception_type || null, hresult: res.hresult || null, inner_crypto_depth: res.inner_crypto_depth === undefined ? null : res.inner_crypto_depth, inner_crypto_hresult: res.inner_crypto_hresult || null, elapsed_ms: Date.now() - t0 });
  function ps(script, input, ref, op) {
    const t0 = Date.now();
    const r = exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(script)], input, { PM_DPAPI_ENTROPY: entropyFor(ref) });
    const res = classifyPs(r || {}, op);
    if (!res.ok) res.diagnostic = diagnostic(res, op, t0);
    return res;
  }
  function decryptCipher(cipher, ref) {
    if (!B64_RE.test(cipher) || Buffer.from(cipher, 'base64').length < MIN_CIPHER_BYTES) throw fail('CIPHERTEXT_MALFORMED', 'stored credential is not a valid ciphertext');
    const res = ps(DPAPI_UNPROTECT, cipher, ref, 'UNPROTECT');
    if (!res.ok) {
      const msg = res.code === 'ACCESS_DENIED_OR_TAMPERED' ? 'credential cannot be decrypted by this user (or was altered)' : 'credential backend did not answer (' + res.code + ')';
      throw fail(res.code, msg, { diagnostic: res.diagnostic });
    }
    return Buffer.from(res.payload, 'base64').toString('utf8');
  }
  function readCipher(file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { if (e.code === 'ENOENT') return null; throw fail('READ_FAILED'); }
  }
  return {
    kind: 'OS_WINDOWS_DPAPI_CURRENT_USER',
    async set(ref, secret) {
      checkRef(ref);
      if (typeof secret !== 'string' || !secret) throw fail('EMPTY_SECRET', 'empty secret');
      const res = ps(DPAPI_PROTECT, Buffer.from(secret, 'utf8'), ref, 'PROTECT');
      if (!res.ok) throw fail('STORE_FAILED', 'DPAPI protect failed (fail closed; nothing written)', { cause_code: res.code, diagnostic: res.diagnostic });
      // Verify the NEW ciphertext before it replaces anything: a failure leaves the previous value untouched.
      let back; try { back = decryptCipher(res.payload, ref); } catch (e) { throw fail('STORE_FAILED', 'verification before write failed (fail closed; nothing replaced)', { cause_code: e.code, diagnostic: e.diagnostic }); }
      if (back !== secret) throw fail('STORE_FAILED', 'verification before write failed (fail closed; nothing replaced)', { cause_code: 'VERIFY_MISMATCH' });
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { throw fail('STORE_FAILED', 'cannot create store directory', { cause_code: 'DIR_FAILED' }); }
      const tmp = fileFor(ref) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      try { fs.writeFileSync(tmp, res.payload + '\n', { mode: 0o600 }); fs.renameSync(tmp, fileFor(ref)); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) { /* none */ } throw fail('STORE_FAILED', 'write failed', { cause_code: 'WRITE_FAILED' }); }
    },
    async get(ref) { checkRef(ref); const c = readCipher(fileFor(ref)); return c === null ? null : decryptCipher(c, ref); },
    async delete(ref) { checkRef(ref); try { fs.unlinkSync(fileFor(ref)); return true; } catch (e) { return false; } },
    async list() { let n = []; try { n = fs.readdirSync(dir); } catch (e) { return []; } return n.filter((f) => /\.dpapi$/.test(f)).map((f) => f.slice(0, -6)).filter((r) => REF_RE.test(r)).sort(); },
    async rotate(ref, secret) { checkRef(ref); if (!fs.existsSync(fileFor(ref))) throw fail('NOT_FOUND', 'no such credential'); return this.set(ref, secret); },
    /** Paths a caller may need to verify cleanup (synthetic self-test refs): the file and any temp files for the ref. */
    artifactsFor(ref) { checkRef(ref); let n = []; try { n = fs.readdirSync(dir); } catch (e) { return []; } return n.filter((f) => f === ref + '.dpapi' || (f.indexOf(ref + '.dpapi.') === 0 && /\.tmp$/.test(f))); },
  };
}

module.exports = { createMemoryStore, createOsStore, checkRef, SERVICE, DPAPI_PROTECT, DPAPI_UNPROTECT, entropyFor, classifyPs, BACKEND_CODES, MAX_INNER_DEPTH };
