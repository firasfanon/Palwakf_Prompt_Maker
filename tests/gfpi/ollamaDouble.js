'use strict';
/**
 * Ollama protocol TEST DOUBLE (not a test file; not a real model). Mirrors the documented REST behaviour that matters to
 * the companion: GET /api/version, GET /api/tags, POST /api/generate (empty prompt = load the model), POST /api/chat with
 * stream true (NDJSON chunks, final chunk done:true with metrics and done_reason) or false (one JSON body at the end).
 * Timing knobs reproduce the field failure: a cold model load before the first token and a slow token rate.
 *   opts: { models, version, loadMs, tokenMs, tokens (string[] content pieces), doneReason, rejectSchemaFormat }
 */
const http = require('http');

function createOllamaDouble(opts) {
  opts = Object.assign({ models: ['m:latest'], version: '0.6.0', loadMs: 0, tokenMs: 0, doneReason: 'stop' }, opts || {});
  const st = { chats: 0, generates: 0, inflight: 0, max: 0, aborted: 0, loaded: false, lastBody: null, formats: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const srv = http.createServer((req, res) => {
    const json = (code, o) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && req.url === '/api/version') return json(200, { version: opts.version });
    if (req.method === 'GET' && req.url === '/api/tags') return json(200, { models: opts.models.map((n) => ({ name: n, model: n })) });
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(b || '{}'); } catch (e) { return json(400, { error: 'invalid json' }); }
      st.lastBody = body;
      if (opts.models.indexOf(body.model) === -1 && opts.models.indexOf(body.model + ':latest') === -1) return json(404, { error: "model '" + body.model + "' not found" });
      let closed = false; res.on('close', () => { if (!res.writableFinished) { closed = true; st.aborted++; } });
      const load = async () => { if (!st.loaded) { await sleep(opts.loadMs); st.loaded = true; return opts.loadMs; } return 0; };
      if (req.url === '/api/generate') {
        st.generates++; const t0 = Date.now(); const ld = await load(); if (closed) return;
        return json(200, { model: body.model, response: '', done: true, done_reason: 'load', load_duration: ld * 1e6, total_duration: (Date.now() - t0) * 1e6 });
      }
      if (req.url !== '/api/chat') return json(404, { error: 'not found' });
      st.formats.push(body.format);
      if (opts.rejectSchemaFormat && body.format && typeof body.format === 'object') return json(400, { error: 'invalid format: expected "json"' });
      st.chats++; st.inflight++; st.max = Math.max(st.max, st.inflight);
      const t0 = Date.now();
      try {
        const ld = await load();
        const pieces = opts.tokens || [JSON.stringify(opts.reply || {})];
        if (body.stream === false) {
          for (let i = 0; i < pieces.length && !closed; i++) await sleep(opts.tokenMs);
          if (closed) return;
          return json(200, { model: body.model, message: { role: 'assistant', content: pieces.join('') }, done: true, done_reason: opts.doneReason, load_duration: ld * 1e6, prompt_eval_count: 50, eval_count: pieces.length, eval_duration: pieces.length * opts.tokenMs * 1e6, total_duration: (Date.now() - t0) * 1e6 });
        }
        res.statusCode = 200; res.setHeader('content-type', 'application/x-ndjson');
        for (let i = 0; i < pieces.length; i++) {
          await sleep(opts.tokenMs); if (closed) return;
          res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: pieces[i] }, done: false }) + '\n');
        }
        if (closed) return;
        res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: opts.doneReason, load_duration: ld * 1e6, prompt_eval_count: 50, eval_count: pieces.length, eval_duration: pieces.length * opts.tokenMs * 1e6, total_duration: (Date.now() - t0) * 1e6 }) + '\n');
      } finally { st.inflight--; }
    });
  });
  return new Promise((r) => srv.listen(opts.port || 0, opts.host || '127.0.0.1', () => r({ srv, st, port: srv.address().port, url: 'http://' + (opts.host && opts.host.indexOf(':') !== -1 ? '[' + opts.host + ']' : (opts.host || '127.0.0.1')) + ':' + srv.address().port, close: () => new Promise((c) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(() => c()); }) })));
}

/** Split a JSON string into small content pieces, like a token stream. */
function tokenize(s, size) { const out = []; for (let i = 0; i < s.length; i += (size || 8)) out.push(s.slice(i, i + (size || 8))); return out; }

module.exports = { createOllamaDouble, tokenize };
