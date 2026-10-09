'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logScrubber');
const { TECH_RECOMMENDATION_OUTPUT_SCHEMA } = require('../gfpi/providerAdapter');

/**
 * Local Companion (ADR-001). Loopback only; per-session pairing; scoped bearer tokens bound to an Origin;
 * strict Host (anti DNS-rebinding) and Origin allow-listing; minimal CORS; body limit; rate limit; no secrets in
 * any response or log. The browser never receives a provider credential.
 * Operational guards (OP-2/OP-3): at most `maxConcurrentRuns` (default 1) provider runs at a time across all sessions,
 * because a local model runtime serves one generation at a time; a second request gets 409 RUN_IN_PROGRESS instead of
 * queueing duplicate load. A run is ABORTED when its client disconnects, when the session is revoked, on POST
 * /v1/cancel, and on stop(); an aborted run returns CANCELLED and never falls through to another provider.
 */
const TASKS = { TECH_RECOMMENDATION: { schema: TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 1500 } };
const ALL_SCOPES = ['status', 'run', 'consent'];

/**
 * Same-origin UI serving (OP-7 replacement for the test-only static helper). EXACT allow-list of files, read once at
 * start (no path resolution from the request => no traversal), served only on the loopback listener after the Host
 * check, with frame-ancestors 'none' (anti-clickjacking for the pairing UI) and no-store.
 */
const UI_FILES = { '/': 'guided.html', '/guided.html': 'guided.html', '/core_bundle.js': 'core_bundle.js', '/gfpi_bundle.js': 'gfpi_bundle.js', '/gfpi_production_bundle.js': 'gfpi_production_bundle.js' };
const UI_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:*; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";
function loadUi(dir) {
  const files = {};
  Object.keys(UI_FILES).forEach((route) => {
    const name = UI_FILES[route];
    const body = fs.readFileSync(path.join(dir, name));
    files[route] = { body, type: name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8' };
  });
  return files;
}

function createCompanion(cfg) {
  const allowedOrigins = (cfg.allowedOrigins || []).slice();
  const orchestrator = cfg.orchestrator;
  const now = cfg.now || (() => new Date().toISOString());
  const nowMs = cfg.nowMs || (() => Date.now());
  const tokenTtlMs = cfg.tokenTtlMs || 30 * 60 * 1000;
  const pairingTtlMs = cfg.pairingTtlMs || 5 * 60 * 1000;
  const maxBody = cfg.maxBodyBytes || 64 * 1024;
  const rate = cfg.rateLimit || { max: 30, windowMs: 60 * 1000 };
  const log = createLogger(cfg.logSink || (() => {}));
  const rnd = cfg.randomBytes || ((n) => crypto.randomBytes(n));

  const sessions = new Map(); // token -> {origin, scopes, expiresMs, hits:[], run: AbortController|null}
  const maxConcurrentRuns = cfg.maxConcurrentRuns || 1;
  let activeRuns = 0;
  const abortRun = (s) => { if (s && s.run) { s.run.abort(); return true; } return false; };
  let pairing = null; // {code, expiresMs, attempts}
  let server = null; let port = 0;
  const pairHits = [];
  const ui = cfg.uiDir ? loadUi(cfg.uiDir) : null;
  if (!allowedOrigins.length && !ui) throw new Error('allowedOrigins required (fail closed)');
  allowedOrigins.forEach((o) => { if (!/^https?:\/\/[^\/\s*]+$/.test(o)) throw new Error('bad origin: ' + o); });

  function newPairingCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = rnd(10); let c = '';
    for (let i = 0; i < 10; i++) c += alphabet[b[i] % alphabet.length];
    pairing = { code: c, expiresMs: nowMs() + pairingTtlMs, attempts: 0 };
    return c;
  }

  function send(res, status, body, origin) {
    const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-site' };
    if (origin) { h['access-control-allow-origin'] = origin; h.vary = 'Origin'; }
    if (status === 413) h.connection = 'close';
    res.writeHead(status, h); res.end(JSON.stringify(body));
  }
  const bearer = (req) => { const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };
  function hitOk(arr) { const t = nowMs(); while (arr.length && arr[0] <= t - rate.windowMs) arr.shift(); if (arr.length >= rate.max) return false; arr.push(t); return true; }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > maxBody) { if (!chunks.over) { chunks.over = true; reject(Object.assign(new Error('too large'), { status: 413 })); } } else chunks.push(c); });
      req.on('end', () => { try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    // 1. Host check (DNS rebinding defence).
    const host = req.headers.host || '';
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return send(res, 403, { error: 'BAD_HOST' });
    // 1b. Same-origin UI (only when uiDir is configured). Exact routes only; everything else falls through to the API.
    if (ui && (req.method === 'GET' || req.method === 'HEAD') && Object.prototype.hasOwnProperty.call(ui, url.pathname)) {
      const f = ui[url.pathname];
      res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': UI_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin' });
      return res.end(req.method === 'HEAD' ? undefined : f.body);
    }
    // Browsers omit Origin on same-origin GETs; Sec-Fetch-Site (not settable by page script) stands in for it, and
    // only when the UI is served by this companion, so the effective origin is exactly this loopback origin.
    let origin = req.headers.origin;
    if (!origin && ui && req.headers['sec-fetch-site'] === 'same-origin') origin = 'http://' + host;
    // 2. Origin allow-list (everything except /v1/health requires an allowed Origin).
    const originOk = !!origin && allowedOrigins.indexOf(origin) !== -1;
    if (url.pathname === '/v1/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'prompt-maker-companion' }, originOk ? origin : undefined);
    if (!originOk) { log.log('origin_rejected'); return send(res, 403, { error: 'ORIGIN_NOT_ALLOWED' }); }
    if (req.method === 'OPTIONS') {
      const h = { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET,POST,DELETE', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', 'cache-control': 'no-store' };
      if (req.headers['access-control-request-private-network'] === 'true') h['access-control-allow-private-network'] = 'true';
      res.writeHead(204, h);
      return res.end();
    }
    try {
      if (url.pathname === '/v1/pair' && req.method === 'POST') {
        if (!hitOk(pairHits)) return send(res, 429, { error: 'RATE_LIMITED' }, origin);
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON_REQUIRED' }, origin);
        const body = await readBody(req);
        if (!pairing || nowMs() > pairing.expiresMs) return send(res, 401, { error: 'PAIRING_EXPIRED' }, origin);
        pairing.attempts++;
        if (pairing.attempts > 5) { pairing = null; return send(res, 401, { error: 'PAIRING_LOCKED' }, origin); }
        const a = Buffer.from(String(body.code || '')); const b = Buffer.from(pairing.code);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: 'BAD_CODE' }, origin);
        pairing = null; // single use
        const token = rnd(32).toString('base64url');
        sessions.set(token, { origin, scopes: ALL_SCOPES.slice(), expiresMs: nowMs() + tokenTtlMs, hits: [] });
        return send(res, 200, { token, scopes: ALL_SCOPES, expires_in_ms: tokenTtlMs }, origin);
      }
      // authenticated routes
      const tok = bearer(req); const s = tok && sessions.get(tok);
      if (!s) return send(res, 401, { error: 'UNAUTHENTICATED' }, origin);
      if (nowMs() > s.expiresMs) { sessions.delete(tok); return send(res, 401, { error: 'TOKEN_EXPIRED' }, origin); }
      if (s.origin !== origin) return send(res, 403, { error: 'TOKEN_ORIGIN_MISMATCH' }, origin);
      if (!hitOk(s.hits)) return send(res, 429, { error: 'RATE_LIMITED' }, origin);
      const need = (sc) => s.scopes.indexOf(sc) !== -1;
      if (url.pathname === '/v1/session' && req.method === 'DELETE') { abortRun(s); sessions.delete(tok); return send(res, 200, { revoked: true }, origin); }
      if (url.pathname === '/v1/status' && req.method === 'GET' && need('status')) {
        const policy = orchestrator.policy;
        const providers = cfg.describeProviders ? await cfg.describeProviders() : [];
        return send(res, 200, { providers, sensitivity_mode: policy.sensitivity_mode, usage: orchestrator.getUsage(), paid_calls_authorized: !!cfg.paidCallsAuthorized, run_in_progress: !!s.run, session_expires_in_ms: Math.max(0, s.expiresMs - nowMs()) }, origin);
      }
      if (url.pathname === '/v1/cancel' && req.method === 'POST' && need('run')) {
        const had = abortRun(s); log.log('run_cancel_requested', had ? 'active' : 'none');
        return send(res, 200, { cancelled: had }, origin);
      }
      if (['/v1/run', '/v1/consent'].indexOf(url.pathname) !== -1 && req.method === 'POST') {
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON_REQUIRED' }, origin);
        const body = await readBody(req);
        if (url.pathname === '/v1/consent' && need('consent')) {
          const g = orchestrator.consent.grant({ provider_id: String(body.provider_id || ''), payload_sha256: String(body.payload_sha256 || ''), granted_by: 'session:' + tok.slice(0, 6), granted_at: now(), expires_at: new Date(nowMs() + 5 * 60 * 1000).toISOString() });
          return send(res, g.ok ? 200 : 400, g.ok ? { granted: true, single_use: true } : { error: g.error }, origin);
        }
        if (url.pathname === '/v1/run' && need('run')) {
          const t = body.task; const def = t && TASKS[t.kind];
          if (!def) return send(res, 400, { error: 'UNKNOWN_TASK_KIND' }, origin);
          if (!t.payload || typeof t.payload !== 'object') return send(res, 400, { error: 'PAYLOAD_REQUIRED' }, origin);
          if (s.run || activeRuns >= maxConcurrentRuns) return send(res, 409, { error: 'RUN_IN_PROGRESS' }, origin);
          const ac = new AbortController(); s.run = ac; activeRuns++;
          const onGone = () => { if (!res.writableFinished) ac.abort(); };
          res.on('close', onGone);
          let result;
          try { result = await orchestrator.run({ kind: t.kind, prompt_version: 'PV-1', payload: t.payload, output_schema: def.schema, max_output_tokens: def.max_output_tokens }, { signal: ac.signal }); }
          finally { activeRuns--; if (s.run === ac) s.run = null; }
          if (res.destroyed) return undefined; // client already gone; the run was aborted, nothing to deliver
          return send(res, 200, result, origin);
        }
      }
      return send(res, 404, { error: 'NOT_FOUND' }, origin);
    } catch (e) {
      log.log('request_error', e && e.message);
      if (e.status === 413) { res.on('finish', () => req.destroy()); }
      return send(res, e.status || 500, { error: e.status === 413 ? 'BODY_TOO_LARGE' : e.status === 400 ? 'BAD_JSON' : 'INTERNAL' }, origin);
    }
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: 'INTERNAL' }); } catch (e) { /* ignore */ } }); });
        server.on('error', reject);
        server.listen(cfg.port || 0, '127.0.0.1', () => {
          port = server.address().port;
          if (ui) ['http://127.0.0.1:' + port, 'http://localhost:' + port].forEach((o) => { if (allowedOrigins.indexOf(o) === -1) allowedOrigins.push(o); });
          resolve({ port, pairingCode: newPairingCode(), host: '127.0.0.1', uiUrl: ui ? 'http://127.0.0.1:' + port + '/' : null });
        });
      });
    },
    newPairingCode,
    stop() { return new Promise((r) => { sessions.forEach((x) => abortRun(x)); sessions.clear(); pairing = null; if (server) { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); } else r(); }); },
    get port() { return port; },
    sessionCount: () => sessions.size,
  };
}

module.exports = { createCompanion, TASKS };
