'use strict';
/**
 * OP-6 reproduction: the Ollama adapter reports itself AVAILABLE whenever /api/tags answers, even if the configured
 * model is not installed. The orchestrator then spends a call that fails (Ollama answers 404 "model not found"), and the
 * UI shows a local provider as connected. Runtime = HTTP TEST DOUBLE mimicking Ollama's documented behaviour.
 */
const http = require('http');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const P = require(path.join(root, 'gfpi/providerAdapter'));
const { createOllamaAdapter } = require(path.join(root, 'companion/ollamaAdapter'));

(async () => {
  const st = { chats: 0 };
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'other-model:latest', model: 'other-model:latest' }] }));
    st.chats++; res.statusCode = 404; res.end(JSON.stringify({ error: "model 'wanted-model' not found" }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const a = createOllamaAdapter({ endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'wanted-model', timeout_ms: 2000 });
  const available = await a.isAvailable();
  const orch = P.createOrchestrator({ adapters: [a, P.createManualAdapter()], now: () => new Date().toISOString(), policy: { order: [a.id, 'manual'], timeout_ms: 2000, max_retries: 1 } });
  const r = await orch.run({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: { goal: 'x' }, output_schema: P.TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 50 });
  srv.close();
  const out = { id: 'OP-6', observed: { reported_available_with_model_missing: available, runtime_chat_calls_spent: st.chats, attempt_codes: r.attempts.map((x) => x.code), status: r.status, has_probe: typeof a.probe === 'function' }, defect_present: available === true || st.chats > 0 };
  console.log(JSON.stringify(out));
  if (process.argv.includes('--expect-fixed') && out.defect_present) process.exitCode = 1;
})();
