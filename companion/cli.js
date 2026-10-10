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
 *   node companion/cli.js credential-selftest [--evidence-out FILE] [--keep-for-foreign-check | --verify-foreign REF]
 *     Real OS credential store check with SYNTHETIC values (Windows: DPAPI CurrentUser). Evidence holds no secret.
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
  const timeoutMs = Number(flag('--timeout-ms') || (model ? 120000 : 15000));
  if (!(timeoutMs >= 1000 && timeoutMs <= 600000)) return { error: '--timeout-ms must be between 1000 and 600000' };
  // W-OLLAMA RC-1: the adapter receives the SAME per-attempt budget (no hidden 60 s socket timeout).
  if (model) { local = createOllamaAdapter({ model, endpoint: flag('--ollama-endpoint') || undefined, timeout_ms: timeoutMs }); adapters.push(local); }
  adapters.push(createManualAdapter());
  const now = () => new Date().toISOString();
  // W-OLLAMA RC-2: a timed-out local generation is not repeated (same workload, double the wait); transient 5xx still retry once.
  const orchestrator = createOrchestrator({ adapters, now, policy: { order: adapters.map((a) => a.id), timeout_ms: timeoutMs, retry_on_timeout: !model } });
  // Availability is probed live on each status request, so the UI never shows a missing model as connected (OP-6).
  const describeProviders = async () => Promise.all(adapters.map(async (a) => {
    const d = { id: a.id, kind: a.kind, locality: a.locality };
    if (a.probe) { const p = await a.probe(); d.availability = p.runtime !== 'REACHABLE' ? 'RUNTIME_UNREACHABLE' : (p.model_installed ? 'READY' : 'MODEL_NOT_INSTALLED'); }
    else d.availability = 'READY';
    return d;
  }));
  return { adapters, local, model, timeoutMs, now, orchestrator, describeProviders };
}

/** Plain-language reading of the attempt diagnostics (what the evidence shows, not a guess). */
function diagnose(r, budget) {
  if (r.status === 'OK') return 'OK';
  const last = (r.attempts || []).filter((a) => a.diagnostics).slice(-1)[0];
  if (!last) return 'NO_TRANSPORT_DIAGNOSTICS';
  const d = last.diagnostics;
  if (last.code === 'TIMEOUT' && d.stalled) return 'STREAM_STALLED_AFTER_TOKENS';
  if (last.code === 'TIMEOUT' && d.phase === 'LOADING_OR_PROMPT') return 'NO_FIRST_TOKEN_WITHIN_' + budget + 'MS (model load or prompt evaluation too slow for the budget)';
  if (last.code === 'TIMEOUT' && d.phase === 'GENERATING') return 'GENERATION_EXCEEDED_' + budget + 'MS after ' + d.chunks + ' chunks (output too long or too slow for the budget)';
  if (d.done_reason === 'length') return 'OUTPUT_TRUNCATED_AT_NUM_PREDICT (invalid JSON likely)';
  return 'INVALID_OR_FAILED_OUTPUT (' + (last.code || 'see attempts') + ')';
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
  ev.runtime_version = p.runtime === 'REACHABLE' ? await rt.local.version() : null;
  ev.timeout_ms_per_attempt = rt.timeoutMs; ev.retry_on_timeout = false;
  let code = p.runtime !== 'REACHABLE' ? 3 : (!p.model_installed ? 4 : 0);
  if (code === 0) {
    // Measured model load (cold start) BEFORE the smoke request, so load time and generation time are reported apart.
    ev.model_load = await rt.local.warmUp({ timeout_ms: rt.timeoutMs });
  }
  if (code === 0 && hasFlag('--smoke')) {
    const t0 = Date.now();
    const r = await rt.orchestrator.run({ kind: 'TECH_RECOMMENDATION', prompt_version: 'PV-1', payload: SMOKE_PAYLOAD, output_schema: TECH_RECOMMENDATION_OUTPUT_SCHEMA, max_output_tokens: 1500 });
    ev.smoke = {
      performed: true, payload: 'SYNTHETIC_FIXED (no user data)', status: r.status, schema_valid: r.status === 'OK', latency_ms: Date.now() - t0,
      attempts: r.attempts, usage: r.usage && r.usage.by_provider ? r.usage.by_provider : r.usage,
      output_sha256: r.provenance ? r.provenance.output_sha256 : null, output: r.status === 'OK' ? r.output : null,
      diagnostics: (r.attempts || []).map((a) => a.diagnostics || null), diagnosis: diagnose(r, rt.timeoutMs),
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

/**
 * credential-selftest: exercises the REAL OS credential store with SYNTHETIC random values only (never a real key).
 * Evidence contains no secret: only booleans, codes, the store kind, sizes, timings and backend diagnostics.
 * Result: PASS (exit 0) | FAIL (exit 1) | UNSUPPORTED_FAIL_CLOSED (exit 2) | INCONCLUSIVE (exit 3).
 *  - D3: a negative security check passes ONLY on a genuine DPAPI refusal (ACCESS_DENIED_OR_TAMPERED) and is bracketed
 *    by positive controls (the original ref decrypts right before and right after). A backend fault (CRED_BACKEND_*)
 *    makes the check INCONCLUSIVE — never a security PASS.
 *  - D2: every synthetic ref created is removed in `finally`, then its absence (file + temp files) is verified; any
 *    residue makes the run FAIL (RESIDUE_REMAINING). `--keep-for-foreign-check` keeps the ref ONLY if every check passed.
 * Cross-user rejection needs a second Windows account: see `--verify-foreign` and the handoff doc.
 */
async function credentialSelftest(flag, hasFlag) {
  const crypto = require('crypto');
  const { BACKEND_CODES } = require('./credentialStore');
  const store = createOsStore();
  const ev = { schema: 'CredentialStoreSelfTestEvidenceV2', generated_at: new Date().toISOString(), platform: os.platform(), release: os.release(), store_kind: store.kind, checks: {}, backend_diagnostics: [] };
  const out = (code) => { const t = JSON.stringify(ev, null, 2); if (flag('--evidence-out')) fs.writeFileSync(flag('--evidence-out'), t + '\n'); console.log(t); return code; };
  const isBackend = (e) => !!(e && (BACKEND_CODES.indexOf(e.code) !== -1 || BACKEND_CODES.indexOf(e.cause_code) !== -1));
  const note = (op, e) => { if (e && e.diagnostic) ev.backend_diagnostics.push(Object.assign({ during: op }, e.diagnostic)); };
  if (store.kind === 'UNSUPPORTED') { ev.result = 'UNSUPPORTED_FAIL_CLOSED'; return out(2); }
  if (hasFlag('--verify-foreign')) {
    const ref = flag('--verify-foreign');
    // Either layer may refuse: NTFS ACL (READ_FAILED, user B cannot read A's profile) or DPAPI itself
    // (ACCESS_DENIED_OR_TAMPERED, ciphertext copied into B's own folder). Both mean B never obtains the secret.
    // A backend fault proves nothing either way: INCONCLUSIVE.
    try { await store.get(ref); ev.checks.foreign_user_cannot_decrypt = false; } catch (e) {
      note('verify_foreign', e); ev.checks.foreign_error_code = e.code;
      if (isBackend(e)) ev.checks.foreign_user_cannot_decrypt = 'INCONCLUSIVE';
      else ev.checks.foreign_user_cannot_decrypt = e.code === 'ACCESS_DENIED_OR_TAMPERED' || e.code === 'READ_FAILED';
      ev.rejected_by = e.code === 'READ_FAILED' ? 'FILESYSTEM_ACL' : (e.code === 'ACCESS_DENIED_OR_TAMPERED' ? 'DPAPI_CURRENT_USER' : (isBackend(e) ? 'NONE_BACKEND_FAULT' : 'OTHER'));
    }
    const v = ev.checks.foreign_user_cannot_decrypt;
    ev.result = v === true ? 'PASS' : (v === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'FAIL');
    return out(ev.result === 'PASS' ? 0 : (ev.result === 'INCONCLUSIVE' ? 3 : 1));
  }
  const ref = 'pm-selftest-' + crypto.randomBytes(4).toString('hex');
  const other = ref + 'x';
  const v1 = 'synthetic-' + crypto.randomBytes(24).toString('base64url'); const v2 = 'synthetic-' + crypto.randomBytes(24).toString('base64url');
  const c = ev.checks; const created = new Set(); let current = null;
  const dpapi = store.kind === 'OS_WINDOWS_DPAPI_CURRENT_USER';
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'prompt-maker-companion', 'credentials');
  // Positive control: the original ref still decrypts to its current value (true / false / 'INCONCLUSIVE').
  const control = async (label) => { try { c[label] = (await store.get(ref)) === current; } catch (e) { note(label, e); c[label] = isBackend(e) ? 'INCONCLUSIVE' : false; } };
  // Negative check: only a genuine refusal passes; a backend fault is INCONCLUSIVE; returned data is a FAIL.
  const mustRefuse = async (label, r) => { try { await store.get(r); c[label] = false; } catch (e) { note(label, e); c[label] = e.code === 'ACCESS_DENIED_OR_TAMPERED' ? true : (isBackend(e) ? 'INCONCLUSIVE' : false); c[label + '_code'] = e.code; } };
  const cleanup = { created: [], removed: [], remaining: [] }; let keep = false; let errBackend = false;
  try {
    created.add(ref); await store.set(ref, v1); current = v1; c.set_ok = true;
    await control('get_roundtrip');
    if (dpapi) {
      const raw = fs.readFileSync(path.join(dir, ref + '.dpapi'), 'utf8');
      c.no_plaintext_at_rest = !raw.includes(v1) && !Buffer.from(raw.trim(), 'base64').toString('latin1').includes(v1);
      c.ciphertext_bytes = raw.length;
      // A ciphertext copied to another ref must not decrypt (entropy binding), bracketed by positive controls.
      created.add(other); fs.writeFileSync(path.join(dir, other + '.dpapi'), raw);
      await control('control_before_binding'); await mustRefuse('ciphertext_bound_to_ref', other); await control('control_after_binding');
      // A tampered ciphertext must not decrypt, bracketed by positive controls.
      const t = Buffer.from(raw.trim(), 'base64'); t[t.length - 5] ^= 0x55; fs.writeFileSync(path.join(dir, other + '.dpapi'), t.toString('base64'));
      await control('control_before_altered'); await mustRefuse('altered_ciphertext_rejected', other); await control('control_after_altered');
      await store.delete(other);
    }
    await store.rotate(ref, v2); current = v2; await control('rotate_roundtrip');
    if (store.list) { try { const l = await store.list(); c.list_has_ref_without_value = l.indexOf(ref) !== -1 && !JSON.stringify(l).includes(v2); } catch (e) { c.list_has_ref_without_value = e.code === 'LIST_UNSUPPORTED' ? 'LIST_UNSUPPORTED' : false; } }
    if (!hasFlag('--keep-for-foreign-check')) { c.delete_ok = await store.delete(ref); c.get_after_delete_is_null = (await store.get(ref)) === null; }
  } catch (e) { note('flow', e); c.error_code = e.code || 'ERROR'; if (e.cause_code) c.error_cause_code = e.cause_code; } finally {
    // Verdict before cleanup decides whether a ref may be kept for the foreign-user check; any doubt => keep nothing.
    try {
      const vals = Object.keys(c).filter((k) => !/_code$/.test(k) && k !== 'ciphertext_bytes').map((k) => c[k]);
      errBackend = !!(c.error_code && (BACKEND_CODES.indexOf(c.error_code) !== -1 || BACKEND_CODES.indexOf(c.error_cause_code) !== -1));
      const failed = vals.some((x) => x === false) || (c.error_code && !errBackend);
      const inconclusive = !failed && (vals.some((x) => x === 'INCONCLUSIVE') || errBackend);
      keep = hasFlag('--keep-for-foreign-check') && !failed && !inconclusive;
    } catch (e) { keep = false; }
    // D2: guaranteed cleanup of every synthetic ref, then verified absence (file and temp files).
    for (const r of created) { if (keep && r === ref) continue; try { await store.delete(r); } catch (e) { /* verified below */ } }
    for (const r of created) {
      if (keep && r === ref) continue;
      let left = [r];
      try {
        if (store.artifactsFor) { left = store.artifactsFor(r); left.forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* verified below */ } }); left = store.artifactsFor(r); }
        else { left = (await store.get(r)) !== null ? [r] : []; }
      } catch (e) { left = e.code === 'NOT_FOUND' ? [] : [r]; }
      if (left.length) cleanup.remaining.push(r); else cleanup.removed.push(r);
    }
  }
  cleanup.created = Array.from(created);
  ev.cleanup = cleanup;
  if (keep) { ev.foreign_check_ref = ref; ev.note = 'Run as ANOTHER Windows user: node companion/cli.js credential-selftest --verify-foreign ' + ref + '; then delete it as this user.'; }
  else if (hasFlag('--keep-for-foreign-check')) ev.note = 'Not kept for the foreign check: the run did not fully pass.';
  const bad = Object.keys(c).filter((k) => c[k] === false || (k === 'error_code' && !errBackend));
  if (cleanup.remaining.length) bad.push('RESIDUE_REMAINING');
  ev.failed_checks = bad; ev.inconclusive_checks = Object.keys(c).filter((k) => c[k] === 'INCONCLUSIVE').concat(errBackend ? ['error_code'] : []);
  ev.result = bad.length ? 'FAIL' : (ev.inconclusive_checks.length ? 'INCONCLUSIVE' : 'PASS');
  return out(ev.result === 'PASS' ? 0 : (ev.result === 'INCONCLUSIVE' ? 3 : 1));
}

async function main(argv) {
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const hasFlag = (n) => argv.indexOf(n) !== -1;
  if (cmd === 'set-credential') { const ref = argv[1]; const secret = await readStdin(); await createOsStore().set(ref, secret); console.log('stored credential ref ' + ref); return 0; }
  if (cmd === 'delete-credential') { const ok = await createOsStore().delete(argv[1]); console.log(ok ? 'deleted' : 'not found'); return ok ? 0 : 1; }
  if (cmd === 'probe') return probe(flag, hasFlag);
  if (cmd === 'credential-selftest') return credentialSelftest(flag, hasFlag);
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
        // Load the model in the background so its cold-start cost is not charged to the first proposal request.
        if (p.runtime === 'REACHABLE' && p.model_installed) rt.local.warmUp({ timeout_ms: 600000 }).then((w) => console.log(w.ok ? 'Model loaded in ' + w.wall_ms + ' ms.' : 'Model warm-up did not complete (' + w.code + '); the first request will include the load time.'));
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
  console.error('usage: app | start --origin URL | probe --ollama-model NAME | credential-selftest | set-credential <ref> | delete-credential <ref>'); return 2;
}
if (require.main === module) main(process.argv.slice(2)).then((c) => { if (typeof c === 'number') process.exit(c); }).catch((e) => { console.error(e.code || 'ERROR'); process.exit(1); });
module.exports = { main, SMOKE_PAYLOAD };
