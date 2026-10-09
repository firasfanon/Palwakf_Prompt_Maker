#!/usr/bin/env node
'use strict';
/**
 * Companion CLI.
 *   node companion/cli.js app   [--port 8787] [--ollama-model NAME] [--ollama-endpoint URL] [--timeout-ms N]
 *     ONE command for a non-technical user: serves the guided UI and the Companion API on the SAME loopback origin
 *     (http://127.0.0.1:PORT/), prints the address to open and a pairing code. Press Enter for a fresh pairing code.
 *     Without --ollama-model everything deterministic works; AI proposals are simply unavailable (honestly shown).
 *   node companion/cli.js start --origin http://127.0.0.1:4180 [--ollama-model NAME] [--ollama-endpoint URL] [--port N] [--timeout-ms N]
 *     API only, for a UI served elsewhere on an allowed origin.
 *     --timeout-ms bounds ONE provider attempt (default 120000 with a local model, which may run on CPU; else 15000).
 *     A timed-out attempt is aborted before any retry, so the local runtime never serves duplicate requests.
 *   node companion/cli.js probe --ollama-model NAME [--ollama-endpoint URL] [--smoke] [--timeout-ms N] [--evidence-out FILE]
 *     REAL connection probe of a local Ollama-compatible runtime (loopback only). Writes LocalProviderProbeEvidenceV1.
 *     It classifies what it saw: MODEL_AVAILABLE != MODEL_EVALUATED != MODEL_ADMITTED != PRODUCTION_READY.
 *     Exit: 0 ok · 3 runtime unreachable · 4 model not installed · 5 smoke failed · 2 usage.
 *   node companion/cli.js set-credential <ref>     (secret read from STDIN, never argv)
 *   node companion/cli.js delete-credential <ref>
 * The pairing code is printed to THIS terminal only. Nothing sensitive is ever logged.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCompanion } = require('./server');
const { createOsStore } = require('./credentialStore');
const { createOllamaAdapter } = require('./ollamaAdapter');
const { createManualAdapter, createOrchestrator, TECH_RECOMMENDATION_OUTPUT_SCHEMA } = require('../gfpi/providerAdapter');

const UI_DIR = path.join(__dirname, '..', 'dist');
async function readStdin() { const c = []; for await (const d of process.stdin) c.push(d); return Buffer.concat(c).toString('utf8').replace(/\r?\n$/, ''); }

/** Fixed, synthetic, non-sensitive smoke payload: no user/project data ever leaves the probe. */
const SMOKE_PAYLOAD = { goal: 'Appointment booking for a small clinic', platforms: 'web', data_sensitivity: 'PERSONAL', availability: '500 users', languages: 'Arabic, English', users_roles: { users: 'patients, staff', roles: 'admin, staff' } };

function buildRuntime(flag) {
  const adapters = [];
  const model = flag('--ollama-model');
  let local = null;
  if (model) { local = createOllamaAdapter({ model, endpoint: flag('--ollama-endpoint') || undefined }); adapters.push(local); }
  const timeoutMs = Number(flag('--timeout-ms') || (model ? 120000 : 15000));
  if (!(timeoutMs >= 1000 && timeoutMs <= 600000)) return { error: '--timeout-ms must be between 1000 and 600000' };
  adapters.push(createManualAdapter());
  const now = () => new Date().toISOString();
  const orchestrator = createOrchestrator({ adapters, now, policy: { order: adapters.map((a) => a.id), timeout_ms: timeoutMs } });
  // Availability is probed live on each status request, so the UI never shows a missing model as connected (OP-6).
  const describeProviders = async () => Promise.all(adapters.map(async (a) => {
    const d = { id: a.id, kind: a.kind, locality: a.locality };
    if (a.probe) { const p = await a.probe(); d.availability = p.runtime !== 'REACHABLE' ? 'RUNTIME_UNREACHABLE' : (p.model_installed ? 'READY' : 'MODEL_NOT_INSTALLED'); }
    else d.availability = 'READY';
    return d;
  }));
  return { adapters, local, model, timeoutMs, now, orchestrator, describeProviders };
}

function interactivePairing(comp) {
  if (!process.stdin.isTTY) return;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => { console.log('New pairing code (single use, 5 minutes): ' + comp.newPairingCode()); });
}

async function probe(flag, hasFlag) {
  const model = flag('--ollama-model'); if (!model) { console.error('--ollama-model is required'); return 2; }
  const rt = buildRuntime(flag); if (rt.error) { console.error(rt.error); return 2; }
  const started = Date.now();
  const p = await rt.local.probe();
  const ev = {
    schema: 'LocalProviderProbeEvidenceV1', generated_at: rt.now(), evidence_class: 'LIVE_LOCAL_PROBE',
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, cpus: os.cpus().length, total_mem_gb: Math.round(os.totalmem() / 1073741824) },
    endpoint: flag('--ollama-endpoint') || 'http://127.0.0.1:11434', runtime: p.runtime, error_code: p.error_code || null,
    configured_model: model, model_installed: p.model_installed, models_installed: p.models,
    smoke: { performed: false },
    classification: { MODEL_AVAILABLE: p.runtime === 'REACHABLE' && p.model_installed, MODEL_EVALUATED: false, MODEL_ADMITTED: false, PRODUCTION_READY: false },
    note: 'A single live probe. It is NOT a model evaluation (no accepted corpus run), NOT a model admission and NOT production readiness.',
  };
  let code = p.runtime !== 'REACHABLE' ? 3 : (!p.model_installed ? 4 : 0);
  if (code === 0 && hasFlag('--smoke')) {
    const t0 = Date.now();
    const r = await rt.orchestrator.run({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: SMOKE_PAYLOAD, output_schema: TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 1500 });
    ev.smoke = {
      performed: true, payload: 'SYNTHETIC_FIXED (no user data)', status: r.status, schema_valid: r.status === 'OK', latency_ms: Date.now() - t0,
      attempts: r.attempts, usage: r.usage && r.usage.by_provider ? r.usage.by_provider : r.usage,
      output_sha256: r.provenance ? r.provenance.output_sha256 : null, output: r.status === 'OK' ? r.output : null,
      sample_size: 1, caveat: 'One synthetic sample: shows the transport and structured-output path work end to end on this machine; says nothing about recommendation quality.',
    };
    if (r.status !== 'OK') code = 5;
  }
  ev.duration_ms = Date.now() - started; ev.exit_code = code;
  const text = JSON.stringify(ev, null, 2);
  const out = flag('--evidence-out');
  if (out) { fs.writeFileSync(out, text + '\n'); console.log('evidence written: ' + out); }
  console.log(text);
  return code;
}

async function main(argv) {
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const hasFlag = (n) => argv.indexOf(n) !== -1;
  if (cmd === 'set-credential') { const ref = argv[1]; const secret = await readStdin(); await createOsStore().set(ref, secret); console.log('stored credential ref ' + ref); return 0; }
  if (cmd === 'delete-credential') { const ok = await createOsStore().delete(argv[1]); console.log(ok ? 'deleted' : 'not found'); return ok ? 0 : 1; }
  if (cmd === 'probe') return probe(flag, hasFlag);
  if (cmd === 'start' || cmd === 'app') {
    const origin = flag('--origin');
    if (cmd === 'start' && !origin) { console.error('--origin is required'); return 2; }
    const rt = buildRuntime(flag); if (rt.error) { console.error(rt.error); return 2; }
    const port = Number(flag('--port') || (cmd === 'app' ? 8787 : 0));
    const comp = createCompanion({ allowedOrigins: origin ? [origin] : [], uiDir: cmd === 'app' ? UI_DIR : undefined, orchestrator: rt.orchestrator, port, now: rt.now, paidCallsAuthorized: false, describeProviders: rt.describeProviders });
    let info;
    try { info = await comp.start(); } catch (e) {
      if (e && e.code === 'EADDRINUSE') { console.error('Port ' + port + ' is already in use. Close the other program or pass --port N.'); return 3; }
      throw e;
    }
    if (cmd === 'app') {
      console.log('Prompt Maker is running. Open this address in your browser: ' + info.uiUrl);
      console.log('Connection tab → pairing code (single use, 5 minutes): ' + info.pairingCode + '   (press Enter for a new code)');
      if (rt.local) {
        const p = await rt.local.probe();
        console.log('Local model "' + rt.model + '": ' + (p.runtime !== 'REACHABLE' ? 'runtime NOT reachable — AI proposals unavailable, everything else works.' : (p.model_installed ? 'ready (available; not evaluated, not admitted).' : 'NOT installed — run: ollama pull ' + rt.model)));
      } else console.log('No local model configured: deterministic mode (AI proposals unavailable, everything else works).');
    } else {
      console.log('Companion listening on http://127.0.0.1:' + info.port + ' (loopback only)');
      console.log('Pairing code (enter it in the browser, single use, 5 minutes): ' + info.pairingCode);
    }
    console.log('Paid hosted calls: NOT AUTHORIZED. Press Ctrl+C to stop.');
    interactivePairing(comp);
    const stop = () => { comp.stop().then(() => process.exit(0)); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return new Promise(() => {});
  }
  console.error('usage: app | start --origin URL | probe --ollama-model NAME | set-credential <ref> | delete-credential <ref>'); return 2;
}
if (require.main === module) main(process.argv.slice(2)).then((c) => { if (typeof c === 'number') process.exit(c); }).catch((e) => { console.error(e.code || 'ERROR'); process.exit(1); });
module.exports = { main, SMOKE_PAYLOAD };
