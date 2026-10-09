'use strict';
/**
 * W-OLLAMA reproduction of the Futuer-IT field result with the REAL CLI probe against the Ollama protocol double:
 * a model whose complete (non-streamed) answer takes ~65 s (cold load + generation), probe with the documented
 * defaults (`--smoke`, default --timeout-ms 120000). Field evidence: DEGRADED_TO_MANUAL, attempts 2 × TIMEOUT,
 * duration ≈ 120455 ms, schema_valid false, exit 5. Usage: node repro_probe_timeout.js [repoRoot] [--expect-fixed]
 */
const path = require('path'); const cp = require('child_process'); const fs = require('fs'); const os = require('os');
const root = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '..', '..');
const { createOllamaDouble, tokenize } = require(path.join(__dirname, '..', '..', '..', 'tests', 'gfpi', 'ollamaDouble'));
const GOOD = { recommended_stack: 'react-vite-supabase', options: [{ stack: 'react-vite-supabase', rationale: 'Web app with managed auth and Postgres.', tradeoffs: 'Vendor coupling.', cost_complexity: 'Low', risks: ['lock-in'] }] };
(async () => {
  const pieces = tokenize(JSON.stringify(GOOD), 6);
  // ~15 s cold load + ~65 s warm generation: each attempt fits the 120 s per-attempt budget the operator configured,
  // but exceeds the adapter's hidden 60 s socket-idle default (non-streamed replies send no byte until done).
  const d = await createOllamaDouble({ models: ['qwen2.5:3b'], loadMs: 15000, tokenMs: Math.ceil(65000 / pieces.length), tokens: pieces });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-repro-')), 'probe-evidence.json');
  const t0 = Date.now();
  // async spawn: the double lives in THIS process, so the event loop must stay free while the CLI runs.
  const r = await new Promise((resolve) => { const ch = cp.spawn(process.execPath, [path.join(root, 'companion', 'cli.js'), 'probe', '--ollama-model', 'qwen2.5:3b', '--ollama-endpoint', d.url, '--smoke', '--evidence-out', out], { stdio: 'ignore' }); const k = setTimeout(() => ch.kill(), 400000); ch.on('close', (status) => { clearTimeout(k); resolve({ status }); }); });
  await d.close();
  let ev = null; try { ev = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* none */ }
  const smoke = ev && ev.smoke || {};
  const res = { id: 'W-OLLAMA', repo: root, observed: { exit_code: r.status, wall_ms: Date.now() - t0, smoke_status: smoke.status, schema_valid: smoke.schema_valid, attempts: smoke.attempts, latency_ms: smoke.latency_ms, runtime_chat_requests: d.st.chats, runtime_streamed: d.st.lastBody && d.st.lastBody.stream !== false, diagnostics: smoke.diagnostics || null }, defect_present: r.status !== 0 };
  console.log(JSON.stringify(res));
  if (process.argv.includes('--expect-fixed') && res.defect_present) process.exitCode = 1;
})();
