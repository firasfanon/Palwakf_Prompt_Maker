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
 *    fallback exists: if PowerShell/DPAPI is unavailable or fails, the operation FAILS CLOSED and nothing is written.
 *  - Integrity: after set, the value is decrypted again and compared; on mismatch the file is removed (fail closed).
 *  - Errors carry codes only (no stderr/stdout content, which could echo data).
 */
const DPAPI_PROTECT = [
  "$ErrorActionPreference='Stop'", 'Add-Type -AssemblyName System.Security',
  '$in=[Console]::OpenStandardInput(); $ms=New-Object System.IO.MemoryStream; $in.CopyTo($ms); $b=$ms.ToArray()',
  '$e=[Text.Encoding]::UTF8.GetBytes($env:PM_DPAPI_ENTROPY)',
  '$c=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Array]::Clear($b,0,$b.Length); [Console]::Out.Write([Convert]::ToBase64String($c))',
].join('; ');
const DPAPI_UNPROTECT = [
  "$ErrorActionPreference='Stop'", 'Add-Type -AssemblyName System.Security',
  '$t=[Console]::In.ReadToEnd().Trim(); $c=[Convert]::FromBase64String($t)',
  '$e=[Text.Encoding]::UTF8.GetBytes($env:PM_DPAPI_ENTROPY)',
  '$b=[Security.Cryptography.ProtectedData]::Unprotect($c,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($b)); [Array]::Clear($b,0,$b.Length)',
].join('; ');
const encodePs = (script) => Buffer.from(script, 'utf16le').toString('base64');
const entropyFor = (ref) => 'prompt-maker-companion:v1:' + ref;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function createWindowsDpapiStore(o) {
  const exec = o.exec;
  const shell = o.shell || 'powershell.exe';
  const dir = o.dir || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), SERVICE, 'credentials');
  const fileFor = (ref) => path.join(dir, ref + '.dpapi');
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
  function ps(script, input, ref) {
    const r = exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(script)], input, { PM_DPAPI_ENTROPY: entropyFor(ref) });
    if (r.error || r.status !== 0) return null;
    const out = String(r.stdout || '').trim();
    return B64_RE.test(out) ? out : null;
  }
  async function decryptFile(ref) {
    let cipher;
    try { cipher = fs.readFileSync(fileFor(ref), 'utf8').trim(); } catch (e) { if (e.code === 'ENOENT') return null; throw fail('READ_FAILED'); }
    if (!B64_RE.test(cipher)) throw fail('ACCESS_DENIED_OR_TAMPERED', 'credential cannot be decrypted by this user (or was altered)');
    const plain = ps(DPAPI_UNPROTECT, cipher, ref);
    if (plain === null) throw fail('ACCESS_DENIED_OR_TAMPERED', 'credential cannot be decrypted by this user (or was altered)');
    return Buffer.from(plain, 'base64').toString('utf8');
  }
  return {
    kind: 'OS_WINDOWS_DPAPI_CURRENT_USER',
    async set(ref, secret) {
      checkRef(ref);
      if (typeof secret !== 'string' || !secret) throw fail('EMPTY_SECRET', 'empty secret');
      const cipher = ps(DPAPI_PROTECT, Buffer.from(secret, 'utf8'), ref);
      if (cipher === null) throw fail('STORE_FAILED', 'DPAPI protect failed (fail closed; nothing written)');
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { throw fail('STORE_FAILED'); }
      const tmp = fileFor(ref) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      try { fs.writeFileSync(tmp, cipher + '\n', { mode: 0o600 }); fs.renameSync(tmp, fileFor(ref)); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) { /* none */ } throw fail('STORE_FAILED'); }
      let back = null; try { back = await decryptFile(ref); } catch (e) { back = null; }
      if (back !== secret) { try { fs.unlinkSync(fileFor(ref)); } catch (x) { /* none */ } throw fail('STORE_FAILED', 'verification after write failed (fail closed; removed)'); }
    },
    async get(ref) { checkRef(ref); return decryptFile(ref); },
    async delete(ref) { checkRef(ref); try { fs.unlinkSync(fileFor(ref)); return true; } catch (e) { return false; } },
    async list() { let n = []; try { n = fs.readdirSync(dir); } catch (e) { return []; } return n.filter((f) => /\.dpapi$/.test(f)).map((f) => f.slice(0, -6)).filter((r) => REF_RE.test(r)).sort(); },
    async rotate(ref, secret) { checkRef(ref); if (!fs.existsSync(fileFor(ref))) throw fail('NOT_FOUND', 'no such credential'); return this.set(ref, secret); },
  };
}

module.exports = { createMemoryStore, createOsStore, checkRef, SERVICE, DPAPI_PROTECT, DPAPI_UNPROTECT, entropyFor };
