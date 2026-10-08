'use strict';
const http = require('http');
const crypto = require('crypto');
const { createLogger } = require('./logScrubber');
const { TECH_RECOMMENDATION_OUTPUT_SCHEMA } = require('../gfpi/providerAdapter');

/**
 * Local Companion (ADR-001). Loopback only; per-session pairing; scoped bearer tokens bound to an Origin;
 * strict Host (anti DNS-rebinding) and Origin allow-listing; minimal CORS; body limit; rate limit; no secrets in
 * any response or log. The browser never receives a provider credential.
 */
const TASKS = { TECH_RECOMMENDATION: { schema: TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 1500 } };
const ALL_SCOPES = ['status', 'run', 'consent'];

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

  const sessions = new Map(); // token -> {origin, scopes, expiresMs, hits:[]}
  let pairing = null; // {code, expiresMs, attempts}
  let server = null; let port = 0;
  const pairHits = [];
  if (!allowedOrigins.length) throw new Error('allowedOrigins required (fail closed)');
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
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://x');
    // 1. Host check (DNS rebinding defence).
    const host = req.headers.host || '';
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return send(res, 403, { error: 'BAD_HOST' });
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
      if (url.pathname === '/v1/session' && req.method === 'DELETE') { sessions.delete(tok); return send(res, 200, { revoked: true }, origin); }
      if (url.pathname === '/v1/status' && req.method === 'GET' && need('status')) {
        const policy = orchestrator.policy;
        return send(res, 200, { providers: cfg.describeProviders ? cfg.describeProviders() : [], sensitivity_mode: policy.sensitivity_mode, usage: orchestrator.getUsage(), paid_calls_authorized: !!cfg.paidCallsAuthorized }, origin);
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
          const result = await orchestrator.run({ kind: t.kind, prompt_version: 'PV-1', payload: t.payload, output_schema: def.schema, max_output_tokens: def.max_output_tokens });
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
        server.listen(cfg.port || 0, '127.0.0.1', () => { port = server.address().port; resolve({ port, pairingCode: newPairingCode(), host: '127.0.0.1' }); });
      });
    },
    newPairingCode,
    stop() { return new Promise((r) => { sessions.clear(); pairing = null; if (server) server.close(() => r()); else r(); }); },
    get port() { return port; },
    sessionCount: () => sessions.size,
  };
}

module.exports = { createCompanion, TASKS };
