'use strict';
const cp = require('child_process');

/**
 * Credential store abstraction. Secrets are NEVER written to Git, exports, logs, browser storage or plain files.
 *  - createMemoryStore: tests / process lifetime only.
 *  - createOsStore: delegates to the OS credential store (macOS `security -i` via stdin, Linux `secret-tool` via stdin).
 *    Windows (or any unsupported platform) fails CLOSED. Real keychains are NOT_PROVEN in the build sandbox:
 *    the logic is tested against an injected `exec` double only.
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

function defaultExec(cmd, args, input) {
  const r = cp.spawnSync(cmd, args, { input: input || '', encoding: 'utf8', timeout: 10000 });
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
  return { kind: 'UNSUPPORTED', set: async () => { throw unsupported(); }, get: async () => { throw unsupported(); }, delete: async () => { throw unsupported(); }, list: async () => { throw unsupported(); }, rotate: async () => { throw unsupported(); } };
}

module.exports = { createMemoryStore, createOsStore, checkRef, SERVICE };
