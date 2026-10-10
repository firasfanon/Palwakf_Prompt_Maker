'use strict';
// S17 — Resilient test harness (tools/harness/resilientHarness.js): incremental durable evidence, readiness checks,
// lifecycle, evidence-only outcome classification, no retry, no secrets. All scenarios are SYNTHETIC: the children are
// tiny Node scripts; no DPAPI, no credential store, no Ollama, no load. An OS shutdown is simulated by killing the
// harness with SIGKILL (power-loss equivalent for the process) plus a changed boot time at recovery.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { test } = require('./harness');
const H = require('../../tools/harness/resilientHarness');

const HARNESS = path.join(__dirname, '..', '..', 'tools', 'harness', 'resilientHarness.js');
const POSIX = process.platform !== 'win32';
const CANARY = 'sk-' + 'HARNESSCANARY' + 'Q'.repeat(20);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-s17-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = ['--heartbeat-ms', '100', '--min-uptime-s', '0', '--kill-grace-ms', '300'];
const readEvents = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const types = (runDir) => readEvents(runDir).map((e) => e.type);
function childScript(dir, body) { const f = path.join(dir, 'child-' + Math.random().toString(36).slice(2) + '.js'); fs.writeFileSync(f, body); return f; }
// Subprocess runs get a FIXED minimal environment: env values are sensitive candidates (R4/R8), so an exact-value
// assertion must not depend on whatever this host happens to have in its environment.
const ENV_KEEP = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE'];
const cleanEnv = (extra) => { const e = {}; ENV_KEEP.forEach((k) => { if (process.env[k] !== undefined) e[k] = process.env[k]; }); return Object.assign(e, extra || {}); };
function runSync(dir, runId, extra, child, opts) {
  const r = cp.spawnSync(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', runId].concat(extra || [], BASE, ['--'], child), Object.assign({ encoding: 'utf8', timeout: 60000, env: cleanEnv() }, opts || {}));
  return { status: r.status, out: r.stdout + r.stderr, runDir: path.join(dir, runId) };
}
async function waitFor(fn, ms, what) { const end = Date.now() + (ms || 15000); for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) throw new Error('timeout waiting for ' + what); await sleep(50); } }
function killPidGroup(pid) { try { process.kill(-pid, 'SIGKILL'); } catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (x) { /* gone */ } } }
const result = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
// S17 never reads this machine's boot time or clock for a classification: recovery always gets an injected boot time
// (the run's own recorded boot = "same boot", or an operator-observed one) and an injected "now" (R6).
const runBoot = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')).boot_time_ms;
const lastEventMs = (runDir) => { const ev = H.verify(runDir).events; return ev.length ? Date.parse(ev[ev.length - 1].t_wall) : runBoot(runDir); }; // tolerates a torn tail
const recoverSameBoot = (runDir) => H.recover(runDir, { bootTimeNowMs: runBoot(runDir), nowMs: lastEventMs(runDir) + 600000 });
const recoverObserved = (runDir, bootMs) => H.recover(runDir, { observedBootTime: new Date(bootMs).toISOString(), nowMs: Math.max(bootMs, lastEventMs(runDir)) + 600000 });
const allEvidenceText = (dir) => { let t = ''; const walk = (d) => fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (!/^child-/.test(n)) t += fs.readFileSync(p, 'utf8'); }); walk(dir); return t; };

// ---------------- normal lifecycle ----------------
test('S17 completed run: incremental hash-chained events, sanitized child progress, result + sums, verify OK', () => {
  const dir = tmp();
  try {
    const c = childScript(dir, "console.log('PMH-EVENT ' + JSON.stringify({ stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172, note: 'free text is dropped' })); console.log('ordinary output is never stored'); setTimeout(() => {}, 400);");
    const r = runSync(dir, 'ok1', [], [process.execPath, c]);
    assert.strictEqual(r.status, 0, r.out);
    const t = types(r.runDir);
    assert.deepStrictEqual([t[0], t[1], t[2]], ['RUN_START', 'PREFLIGHT', 'CHILD_SPAWN']); assert.strictEqual(t[t.length - 1], 'RUN_END');
    assert.ok(t.indexOf('CHILD_EVENT') !== -1 && t.indexOf('CHILD_EXIT') !== -1 && t.indexOf('HEARTBEAT') !== -1);
    const ev = readEvents(r.runDir); const ce = ev.find((e) => e.type === 'CHILD_EVENT');
    assert.deepStrictEqual(ce.data, { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 }, 'unknown keys / free text dropped');
    assert.ok(!allEvidenceText(dir).includes('free text') && !allEvidenceText(dir).includes('ordinary output'));
    const v = H.verify(r.runDir).verification; assert.strictEqual(v.status, 'OK'); assert.strictEqual(v.events_valid, ev.length);
    const res = result(r.runDir); assert.strictEqual(res.outcome, 'COMPLETED');
    const sums = JSON.parse(fs.readFileSync(path.join(r.runDir, 'SHA256SUMS.json'), 'utf8'));
    for (const n of ['run.json', 'events.jsonl', 'result.json']) assert.strictEqual(sums.files[n], require('crypto').createHash('sha256').update(fs.readFileSync(path.join(r.runDir, n))).digest('hex'), n);
    const hdr = JSON.parse(fs.readFileSync(path.join(r.runDir, 'run.json'), 'utf8')); assert.strictEqual(hdr.no_retry, true); assert.deepStrictEqual(hdr.command, { executable: path.basename(process.execPath), argc: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 PROCESS_FAILURE: non-zero exit and spawn error are recorded with exact codes (exit 1)', () => {
  const dir = tmp();
  try {
    const r = runSync(dir, 'nz', [], [process.execPath, '-e', 'process.exit(7)']);
    assert.strictEqual(r.status, 1); assert.strictEqual(result(r.runDir).outcome, 'PROCESS_FAILURE'); assert.deepStrictEqual(result(r.runDir).basis, ['CHILD_EXIT_CODE:7']);
    const r2 = runSync(dir, 'enoent', [], ['pm-no-such-binary-' + Date.now()]);
    assert.strictEqual(r2.status, 1); assert.deepStrictEqual(result(r2.runDir).basis, ['CHILD_SPAWN_ERROR:ENOENT']);
    assert.ok(types(r2.runDir).indexOf('CHILD_SPAWN') === -1, 'no spawn recorded for a binary that never started');
    if (POSIX) {
      const r3 = runSync(dir, 'sig', [], [process.execPath, '-e', "process.kill(process.pid, 'SIGKILL')"]);
      assert.strictEqual(r3.status, 1); assert.deepStrictEqual(result(r3.runDir).basis, ['CHILD_SIGNAL:SIGKILL']);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 NO RETRY: a timed-out child is killed once and never restarted; a reused run id is refused without touching evidence', () => {
  const dir = tmp();
  try {
    const marker = path.join(dir, 'starts.txt');
    const c = childScript(dir, "require('fs').appendFileSync(" + JSON.stringify(marker) + ", 'start\\n'); setInterval(() => {}, 1000);");
    const r = runSync(dir, 'to', ['--timeout-ms', '500'], [process.execPath, c]);
    assert.strictEqual(r.status, 1, r.out); const res = result(r.runDir);
    assert.strictEqual(res.outcome, 'PROCESS_FAILURE'); assert.ok(/^HARNESS_TIMEOUT:500ms/.test(res.basis[0]), res.basis[0]);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'start\n', 'child started exactly once');
    assert.strictEqual(types(r.runDir).filter((t) => t === 'CHILD_SPAWN').length, 1);
    const before = fs.readFileSync(path.join(r.runDir, 'events.jsonl'));
    const again = runSync(dir, 'to', [], [process.execPath, c]);
    assert.strictEqual(again.status, H.EXIT.REFUSED_EXISTING_RUN); assert.ok(/refused/.test(again.out));
    assert.ok(before.equals(fs.readFileSync(path.join(r.runDir, 'events.jsonl'))), 'evidence untouched');
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'start\n', 'no second start');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 readiness: a failed preflight blocks the child (PREFLIGHT_FAILED, exit 4); --fail-on-warn blocks on warnings', () => {
  const dir = tmp();
  try {
    const marker = path.join(dir, 'm.txt'); const c = childScript(dir, "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'x')");
    const r = runSync(dir, 'pf', ['--min-free-disk-bytes', String(1e15)], [process.execPath, c]);
    assert.strictEqual(r.status, 4); assert.strictEqual(result(r.runDir).outcome, 'PREFLIGHT_FAILED'); assert.ok(!fs.existsSync(marker));
    const pf = readEvents(r.runDir).find((e) => e.type === 'PREFLIGHT').data; assert.strictEqual(pf.checks.find((x) => x.name === 'disk_free_bytes').status, 'FAIL');
    const r2 = runSync(dir, 'pw', ['--min-uptime-s', String(1e9), '--fail-on-warn'], [process.execPath, c]);
    assert.strictEqual(r2.status, 4); assert.ok(!fs.existsSync(marker));
    const names = H.preflight({ dir: path.join(dir, 'p'), minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0 }).checks.map((x) => x.name);
    ['node_version', 'evidence_dir_writable_fsync', 'disk_free_bytes', 'free_memory_bytes', 'os_uptime_s', 'boot_time', 'channel_stdout_writable'].forEach((n) => assert.ok(names.indexOf(n) !== -1, n));
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'p')), [], 'preflight leaves no probe file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- sudden stop / recovery ----------------
async function startAndKillMidRun(dir, runId, opts) {
  const c = childScript(dir, "console.log('PMH-EVENT ' + JSON.stringify({ stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 })); setInterval(() => {}, 1000);");
  const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', runId].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  h.stdout.on('data', () => {}); h.stderr.on('data', () => {});
  const runDir = path.join(dir, runId);
  await waitFor(() => fs.existsSync(path.join(runDir, 'events.jsonl')) && types(runDir).indexOf('CHILD_EVENT') !== -1 && types(runDir).indexOf('HEARTBEAT') !== -1, 15000, 'child event');
  if (opts && opts.before) await opts.before(h, runDir);
  const childPid = readEvents(runDir).find((e) => e.type === 'CHILD_SPAWN').data.pid;
  h.kill('SIGKILL'); await new Promise((r) => h.on('close', r)); killPidGroup(childPid);
  return runDir;
}

test('S17 sudden harness death (power-loss equivalent): evidence up to the stop is intact; recovery classifies only from evidence', async () => {
  if (!POSIX) { console.log('       SKIPPED on win32 (process-group kill)'); return; }
  const dir = tmp();
  try {
    const runDir = await startAndKillMidRun(dir, 'kill1');
    assert.ok(!fs.existsSync(path.join(runDir, 'result.json')), 'no result file: the harness never finished');
    const v = H.verify(runDir).verification; assert.strictEqual(v.status, 'OK', JSON.stringify(v));
    // same machine, same boot: nothing corroborates a cause
    const same = recoverSameBoot(runDir); assert.strictEqual(same.outcome, 'UNKNOWN', JSON.stringify(same.basis));
    assert.ok(same.basis.some((b) => /BOOT_TIME_UNCHANGED/.test(b)) && same.basis.some((b) => /NO_CORROBORATING_EVIDENCE/.test(b)));
    assert.deepStrictEqual(same.facts.last_child_event, { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 }, 'sub-step evidence survived the stop');
    assert.strictEqual(same.retry_performed, false);
    // operator supplies the boot time observed in Windows logs (after the last event) => OS_SHUTDOWN
    const lastAt = Date.parse(same.facts.last_event_at);
    const boot = recoverObserved(runDir, lastAt + 222000);
    assert.strictEqual(boot.outcome, 'OS_SHUTDOWN', JSON.stringify(boot.basis)); assert.strictEqual(boot.facts.gap_last_event_to_boot_ms, 222000);
    // boot time not changed beyond tolerance => not a shutdown
    const start = runBoot(runDir);
    assert.strictEqual(recoverObserved(runDir, start + 60000).outcome, 'UNKNOWN');
    // original evidence never rewritten; one recovery file per recovery
    assert.strictEqual(fs.readdirSync(runDir).filter((n) => /^recovery-/.test(n)).length, 3);
    assert.strictEqual(H.verify(runDir).verification.events_sha256, v.events_sha256);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 REMOTE_CHANNEL_FAILURE: a closed channel is recorded and the run continues; channel loss then a stop is classified as such', async () => {
  if (!POSIX) { console.log('       SKIPPED on win32 (pipe/EPIPE + process-group kill)'); return; }
  const dir = tmp();
  try {
    // (a) channel closes, run completes: COMPLETED with remote_channel_lost recorded
    const c = childScript(dir, 'setTimeout(() => {}, 900);');
    const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'ch1'].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() });
    await new Promise((r) => h.stdout.once('data', r)); h.stdout.destroy();
    const code = await new Promise((r) => h.on('close', r));
    assert.strictEqual(code, 0); const res = result(path.join(dir, 'ch1'));
    assert.strictEqual(res.outcome, 'COMPLETED'); assert.strictEqual(res.facts.remote_channel_lost, true);
    assert.ok(types(path.join(dir, 'ch1')).indexOf('HEARTBEAT') < types(path.join(dir, 'ch1')).lastIndexOf('HEARTBEAT'), 'heartbeats continued after the loss');
    // (b) channel lost, then the harness is stopped (same boot): REMOTE_CHANNEL_FAILURE
    const runDir = await startAndKillMidRun(dir, 'ch2', { before: async (hh, rd) => { hh.stdout.destroy(); await waitFor(() => types(rd).indexOf('REMOTE_CHANNEL_LOST') !== -1, 10000, 'channel loss'); } });
    const rec = recoverSameBoot(runDir); assert.strictEqual(rec.outcome, 'REMOTE_CHANNEL_FAILURE', JSON.stringify(rec.basis));
    // but a reboot after the last event takes precedence (both facts kept)
    const rb = recoverObserved(runDir, Date.parse(rec.facts.last_event_at) + 5000);
    assert.strictEqual(rb.outcome, 'OS_SHUTDOWN'); assert.strictEqual(rb.facts.remote_channel_lost, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 parent signals: SIGTERM terminates the child once (UNKNOWN, origin not assumed); SIGHUP is recorded and the run continues', async () => {
  if (!POSIX) { console.log('       SKIPPED on win32 (POSIX signals)'); return; }
  const dir = tmp();
  try {
    const marker = path.join(dir, 's.txt');
    const c = childScript(dir, "require('fs').appendFileSync(" + JSON.stringify(marker) + ", 'start\\n'); setInterval(() => {}, 1000);");
    const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'term'].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() });
    h.stdout.on('data', () => {}); await waitFor(() => fs.existsSync(marker), 10000, 'child start'); h.kill('SIGTERM');
    assert.strictEqual(await new Promise((r) => h.on('close', r)), H.EXIT.UNKNOWN);
    const res = result(path.join(dir, 'term')); assert.strictEqual(res.outcome, 'UNKNOWN'); assert.ok(/^PARENT_SIGNAL:SIGTERM/.test(res.basis[0]));
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'start\n');
    const c2 = childScript(dir, 'setTimeout(() => {}, 900);');
    const h2 = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'hup'].concat(BASE, ['--'], [process.execPath, c2]), { stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv() });
    h2.stdout.on('data', () => {}); await waitFor(() => types(path.join(dir, 'hup')).indexOf('CHILD_SPAWN') !== -1, 10000, 'spawn'); h2.kill('SIGHUP');
    assert.strictEqual(await new Promise((r) => h2.on('close', r)), 0);
    const r2 = result(path.join(dir, 'hup')); assert.strictEqual(r2.outcome, 'COMPLETED'); assert.strictEqual(r2.facts.parent_hangup_signals, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- evidence damage ----------------
test('S17 damaged evidence: torn tail is tolerated and reported; any corruption, reorder, deletion or forged line is detected and yields no outcome claim', () => {
  const dir = tmp();
  try {
    const r = runSync(dir, 'base', [], [process.execPath, '-e', 'setTimeout(() => {}, 350)']); assert.strictEqual(r.status, 0);
    const src = fs.readFileSync(path.join(r.runDir, 'events.jsonl'), 'utf8'); const lines = src.split('\n').filter(Boolean); const n = lines.length;
    const variant = (name, text) => { const d = path.join(dir, name); fs.mkdirSync(d); fs.copyFileSync(path.join(r.runDir, 'run.json'), path.join(d, 'run.json')); fs.writeFileSync(path.join(d, 'events.jsonl'), text); return d; };
    // torn tail after a complete run: earlier events intact, RUN_END kept
    let d = variant('torn1', src + lines[1].slice(0, 40)); let v = H.verify(d).verification;
    assert.strictEqual(v.status, 'TRUNCATED_TAIL'); assert.strictEqual(v.events_valid, n); assert.strictEqual(v.tail_bytes_discarded, 40);
    assert.strictEqual(recoverSameBoot(d).outcome, 'COMPLETED');
    // torn RUN_END line itself: the run is treated as incomplete, never as completed
    d = variant('torn2', lines.slice(0, n - 1).join('\n') + '\n' + lines[n - 1].slice(0, 30));
    v = H.verify(d).verification; assert.strictEqual(v.status, 'TRUNCATED_TAIL'); assert.strictEqual(v.events_valid, n - 1);
    const rec = recoverSameBoot(d); assert.notStrictEqual(rec.outcome, 'COMPLETED'); assert.strictEqual(rec.facts.run_end_recorded, false);
    const corrupt = (name, text, reason) => { const dd = variant(name, text); const vv = H.verify(dd).verification; assert.strictEqual(vv.status, 'CORRUPT', name); if (reason) assert.strictEqual(vv.reason, reason, name);
      const rr = H.recover(dd, { bootTimeNowMs: 0, nowMs: 0 }); assert.strictEqual(rr.outcome, 'UNKNOWN', name); assert.ok(/EVIDENCE_CORRUPT/.test(rr.basis[0])); return vv; };
    const flip = lines.slice(); flip[2] = flip[2].replace('"type":"', '"type":"X'); corrupt('flip', flip.join('\n') + '\n', 'HASH_MISMATCH');
    const del = lines.slice(); del.splice(2, 1); corrupt('delete', del.join('\n') + '\n', 'SEQ_GAP_OR_REORDER');
    const swap = lines.slice(); [swap[2], swap[3]] = [swap[3], swap[2]]; corrupt('swap', swap.join('\n') + '\n', 'SEQ_GAP_OR_REORDER');
    const forged = lines.slice(); const e = JSON.parse(forged[2]); e.data = { forged: true }; delete e.hash;
    e.hash = require('crypto').createHash('sha256').update(JSON.stringify({ v: e.v, seq: e.seq, run_id: e.run_id, t_wall: e.t_wall, t_mono_ms: e.t_mono_ms, type: e.type, data: e.data, prev: e.prev })).digest('hex');
    forged[2] = JSON.stringify(e); const fv = corrupt('forged', forged.join('\n') + '\n', 'CHAIN_BREAK'); assert.strictEqual(fv.first_bad_seq, 3, 'the forged line breaks the chain at the next line');
    const junk = lines.slice(); junk[1] = '{not json'; corrupt('junk', junk.join('\n') + '\n', 'UNPARSEABLE_LINE');
    const other = variant('missing', ''); fs.unlinkSync(path.join(other, 'events.jsonl')); assert.strictEqual(H.verify(other).verification.status, 'MISSING');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- classification table (no inference beyond evidence) ----------------
test('S17 classify(): every outcome needs its own evidence; signals and gaps alone never become OS_SHUTDOWN', () => {
  const t = (type, data, at) => ({ type, data: data || {}, t_wall: at || '2026-10-10T19:21:00.000Z' });
  const start = t('RUN_START', { boot_time_ms: Date.parse('2026-10-01T00:00:00Z') }); const pre = t('PREFLIGHT', { status: 'PASS' }); const spawn = t('CHILD_SPAWN', { pid: 1 });
  const c = (ev, ctx) => H.classify(ev, Object.assign({ nowMs: Date.parse('2026-10-11T00:00:00Z') }, ctx || {})); // injected clock (R6)
  assert.strictEqual(c([]).outcome, 'UNKNOWN');
  assert.strictEqual(c([start, t('PREFLIGHT', { status: 'FAIL' }), t('RUN_END')]).outcome, 'PREFLIGHT_FAILED');
  assert.strictEqual(c([start, pre, spawn, t('CHILD_EXIT', { code: 0 }), t('RUN_END')]).outcome, 'COMPLETED');
  assert.strictEqual(c([start, pre, spawn, t('CHILD_EXIT', { code: 0 }), t('RUN_END')], { integrity: 'CORRUPT' }).outcome, 'UNKNOWN');
  assert.strictEqual(c([start, pre, spawn, t('CHILD_EXIT', { code: 2 }), t('RUN_END')]).outcome, 'PROCESS_FAILURE');
  assert.strictEqual(c([start, pre, spawn, t('PARENT_SIGNAL', { signal: 'SIGBREAK', action: 'TERMINATE' }), t('CHILD_EXIT', { code: null, signal: 'SIGTERM' }), t('RUN_END')]).outcome, 'UNKNOWN', 'a Windows SIGBREAK is not proof of a shutdown');
  assert.strictEqual(c([start, pre, spawn, t('PARENT_SIGNAL', { signal: 'SIGHUP', action: 'CONTINUE' }), t('CHILD_EXIT', { code: 0 }), t('RUN_END')]).outcome, 'COMPLETED');
  assert.strictEqual(c([start, pre, spawn, t('CHILD_EXIT', { code: 0 }), t('RUN_END')], { evidenceWriteError: 'ENOSPC' }).outcome, 'UNKNOWN');
  // incomplete runs
  const inc = [start, pre, spawn, t('CHILD_EVENT', { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 }, '2026-10-10T19:21:00.600Z'), t('HEARTBEAT', {}, '2026-10-10T19:21:04.000Z')];
  assert.strictEqual(c(inc).outcome, 'UNKNOWN', 'no boot comparison => no shutdown claim');
  assert.strictEqual(c(inc, { bootTimeNowMs: Date.parse('2026-10-01T00:00:30Z') }).outcome, 'UNKNOWN', 'boot unchanged within tolerance');
  const sd = c(inc, { bootTimeNowMs: Date.parse('2026-10-10T19:24:47Z') }); assert.strictEqual(sd.outcome, 'OS_SHUTDOWN'); assert.strictEqual(sd.facts.gap_last_event_to_boot_ms, 223000);
  assert.strictEqual(c(inc, { bootTimeNowMs: Date.parse('2026-10-05T00:00:00Z') }).outcome, 'UNKNOWN', 'a new boot before the last event is inconsistent, not a shutdown');
  assert.ok(c(inc, { bootTimeNowMs: Date.parse('2026-10-05T00:00:00Z') }).basis.some((b) => /BOOT_NOT_AFTER_LAST_EVENT/.test(b)));
  assert.strictEqual(c(inc.concat([t('REMOTE_CHANNEL_LOST', { code: 'EPIPE' })]), { bootTimeNowMs: Date.parse('2026-10-01T00:00:00Z') }).outcome, 'REMOTE_CHANNEL_FAILURE');
  assert.strictEqual(c(inc.concat([t('CHILD_EXIT', { code: 9 })])).outcome, 'PROCESS_FAILURE');
  assert.strictEqual(c(inc.concat([t('HARNESS_TIMEOUT', { timeout_ms: 5 })])).outcome, 'PROCESS_FAILURE');
  assert.deepStrictEqual(H.OUTCOMES.slice().sort(), ['COMPLETED', 'OS_SHUTDOWN', 'PREFLIGHT_FAILED', 'PROCESS_FAILURE', 'REMOTE_CHANNEL_FAILURE', 'UNKNOWN']);
});

// ---------------- secrets ----------------
test('S17 secrets: argv, environment, stdout, stderr and child progress values never reach the evidence; a secret-looking label is refused', () => {
  const dir = tmp();
  try {
    const c = childScript(dir, "console.log(process.env.PM_S17_SECRET); console.error('err ' + process.env.PM_S17_SECRET); console.log('PMH-EVENT ' + JSON.stringify({ stage: process.env.PM_S17_SECRET, code: 'OK', secret: process.env.PM_S17_SECRET, status: 'API_KEY' })); console.log('PMH-EVENT not json ' + process.env.PM_S17_SECRET);");
    const r = runSync(dir, 'sec', ['--label', 'secret hygiene'], [process.execPath, c, '--token', CANARY], { env: cleanEnv({ PM_S17_SECRET: CANARY }) });
    assert.strictEqual(r.status, 0, r.out);
    const text = allEvidenceText(dir); assert.ok(!text.includes(CANARY) && !text.includes('HARNESSCANARY'), 'canary leaked into evidence');
    assert.ok(!r.out.includes(CANARY), 'canary leaked into harness output');
    // status is a closed enum: 'API_KEY' is not a status and is dropped (R4)
    const ev = readEvents(r.runDir).filter((e) => e.type === 'CHILD_EVENT'); assert.deepStrictEqual(ev.map((e) => e.data), [{ code: 'OK' }]);
    assert.ok(!/PM_S17_SECRET|"env"/.test(text), 'environment never recorded');
    const bad = runSync(dir, 'sec2', ['--label', CANARY], [process.execPath, '-e', '0']); assert.strictEqual(bad.status, H.EXIT.USAGE); assert.ok(!fs.existsSync(bad.runDir));
    // key allow-list: an unknown key is dropped even when its value is enum-like
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT ' + JSON.stringify({ stage: 'DPAPI_UNPROTECT', user: 'admin', extra: 'OK', depth: 1 })), { event: { stage: 'DPAPI_UNPROTECT', depth: 1 }, dropped: 2 });
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT [1,2]'), { event: null, dropped: 1 });
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT {broken'), { event: null, dropped: 1 });
    // value filter unit cases (typed per key)
    assert.strictEqual(H.safeValue('stage', 'DPAPI_UNPROTECT'), 'DPAPI_UNPROTECT'); assert.strictEqual(H.safeValue('hresult', '0x8007000D'), '0x8007000D'); assert.strictEqual(H.safeValue('status', 'OK'), 'OK');
    assert.strictEqual(H.safeValue('status', 'ok'), undefined, 'lower-case words are never stored');
    ['sk-' + 'a'.repeat(24), 'some free text', 'aB3dE5gH7jK9mN1pQ3rS5tU7', 'x'.repeat(70), 'ghp_' + 'b'.repeat(36)].forEach((s) => assert.strictEqual(H.safeValue('stage', s), undefined, s));
    assert.strictEqual(H.safeValue('elapsed_ms', Infinity), undefined); assert.strictEqual(H.safeValue('stage', { a: 1 }), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 scope: the harness is standalone test tooling — no DPAPI, credential store, provider or companion dependency; writes only inside its run dir', () => {
  const src = fs.readFileSync(HARNESS, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/require\([^)]*(companion|credentialStore|ollama|gfpi\/)/.test(code), 'no product module required');
  assert.ok(!/ProtectedData|DPAPI|secret-tool|setCredential|createOsStore|fetch\(|https?\.request|net\.connect/.test(code), 'no DPAPI / credential / network call');
  const reqs = (code.match(/require\('([^']+)'\)/g) || []).map((x) => x.slice(9, -2)).sort(); assert.deepStrictEqual(reqs, ['child_process', 'crypto', 'fs', 'os', 'path']);
  const dir = tmp();
  try { const r = runSync(dir, 'only', [], [process.execPath, '-e', '0']); assert.strictEqual(r.status, 0); assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['only']);
    assert.deepStrictEqual(fs.readdirSync(r.runDir).sort(), ['SHA256SUMS.json', 'events.jsonl', 'result.json', 'run.json']); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// =====================================================================================================================
// Regression tests — GFPI_RESILIENT_TEST_HARNESS_MINIMAL_REPAIR_V2 (independent review of bd75be4, findings 1..6).
// Each test fails on bd75be4 and passes on the repaired harness.
// =====================================================================================================================
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SILENT = { writable: true, write() {}, on() {}, removeListener() {} }; // in-process runs do not print to the test log
const ioFault = (pred) => { // fault injection on the harness' durable-write primitives only (H._io); restored by the caller
  const orig = { writeSync: H._io.writeSync, fsyncSync: H._io.fsyncSync }; const last = new Map();
  H._io.writeSync = (fd, buf, off, len) => { last.set(fd, buf.toString('utf8', off, off + len)); return orig.writeSync(fd, buf, off, len); };
  H._io.fsyncSync = (fd) => { if (pred(fd, last.get(fd) || '')) throw Object.assign(new Error('injected'), { code: 'EIO' }); return orig.fsyncSync(fd); };
  return () => { H._io.writeSync = orig.writeSync; H._io.fsyncSync = orig.fsyncSync; };
};
const inproc = (dir, runId, args, extra) => H.run(Object.assign({ evidenceDir: dir, runId, cmd: process.execPath, args, timeoutMs: 20000, heartbeatMs: 100, killGraceMs: 300,
  minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0, channel: SILENT }, extra || {}));

test('S17 R1 fail-closed durability: an event, RUN_END, run.json, result.json or directory fsync failure stops the run, never COMPLETED, exit 8', async () => {
  const dir = tmp();
  try {
    // (a) fsync of a CHILD_EVENT line fails: the child is killed at once, no later event is accepted
    const marker = path.join(dir, 'a.txt');
    const c = childScript(dir, "const fs=require('fs');fs.appendFileSync(" + JSON.stringify(marker) + ",'start\\n');console.log('PMH-EVENT '+JSON.stringify({stage:'DPAPI_PROTECT',status:'OK'}));setTimeout(()=>fs.appendFileSync(" + JSON.stringify(marker) + ",'end\\n'),3000);");
    let restore = ioFault((fd, last) => last.indexOf('"type":"CHILD_EVENT"') !== -1);
    const t0 = Date.now(); let r;
    try { r = await inproc(dir, 'r1a', [c]); } finally { restore(); }
    assert.strictEqual(r.exitCode, H.EXIT.EVIDENCE_FAILURE); assert.strictEqual(r.outcome, 'UNKNOWN'); assert.strictEqual(r.evidenceFailure, 'EVENT_FSYNC_FAILED:EIO');
    assert.ok(Date.now() - t0 < 2500, 'child stopped without waiting for it'); await sleep(3300);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'start\n', 'the child was killed, not allowed to continue');
    const res = result(r.runDir); assert.strictEqual(res.outcome, 'UNKNOWN'); assert.strictEqual(res.run_end_seq, null); assert.strictEqual(res.evidence_failure, 'EVENT_FSYNC_FAILED:EIO');
    assert.ok(/^EVIDENCE_DURABILITY_FAILED:EVENT_FSYNC_FAILED:EIO/.test(res.basis[0]), res.basis[0]);
    assert.ok(types(r.runDir).indexOf('RUN_END') === -1 && types(r.runDir).indexOf('CHILD_EXIT') === -1, 'nothing accepted after the failure');
    assert.strictEqual(H.verify(r.runDir).verification.status, 'OK', 'the evidence that exists is still consistent');
    const rec = H.recover(r.runDir, { bootTimeNowMs: runBoot(r.runDir), nowMs: lastEventMs(r.runDir) + 1000 });
    assert.strictEqual(rec.outcome, 'UNKNOWN'); assert.ok(/EVIDENCE_DURABILITY_FAILED/.test(rec.basis[0]), rec.basis[0]);
    // (b) only the RUN_END fsync fails on a run whose child exited 0: UNKNOWN, never COMPLETED
    restore = ioFault((fd, last) => last.indexOf('"type":"RUN_END"') !== -1);
    try { r = await inproc(dir, 'r1b', ['-e', '0']); } finally { restore(); }
    assert.strictEqual(r.exitCode, H.EXIT.EVIDENCE_FAILURE); assert.strictEqual(r.outcome, 'UNKNOWN'); assert.notStrictEqual(result(r.runDir).outcome, 'COMPLETED');
    // (c) run.json cannot be made durable: nothing is spawned, no partial file is left
    const m2 = path.join(dir, 'c.txt'); const c2 = childScript(dir, "require('fs').writeFileSync(" + JSON.stringify(m2) + ",'x')");
    restore = ioFault((fd, last) => last.indexOf('"schema"') !== -1 && last.indexOf('"no_retry": true') !== -1);
    try { r = await inproc(dir, 'r1c', [c2]); } finally { restore(); }
    assert.strictEqual(r.exitCode, H.EXIT.EVIDENCE_FAILURE); assert.strictEqual(r.evidenceFailure, 'ATOMIC_FSYNC_FAILED:EIO');
    await sleep(300); assert.ok(!fs.existsSync(m2), 'child never started'); assert.deepStrictEqual(fs.readdirSync(r.runDir), [], 'no run.json, no tmp file');
    // (d) result.json cannot be made durable: the run is not reported as success (exit 8) and no unsealed result is left
    restore = ioFault((fd, last) => last.indexOf('"run_end_seq"') !== -1);
    try { r = await inproc(dir, 'r1d', ['-e', '0']); } finally { restore(); }
    assert.strictEqual(r.exitCode, H.EXIT.EVIDENCE_FAILURE); assert.ok(!fs.existsSync(path.join(r.runDir, 'result.json')));
    // (e) directory fsync failure (POSIX): fail closed before anything is spawned
    if (POSIX) {
      restore = ioFault((fd) => { try { return fs.fstatSync(fd).isDirectory(); } catch (e) { return false; } });
      try { r = await inproc(dir, 'r1e', [c2]); } finally { restore(); }
      assert.strictEqual(r.exitCode, H.EXIT.EVIDENCE_FAILURE); assert.strictEqual(r.evidenceFailure, 'DIR_FSYNC_FAILED:EIO'); await sleep(300); assert.ok(!fs.existsSync(m2));
    }
    // (f) EvidenceLog unit: after the first failure every append is refused and onFail fires once
    let fired = 0; const f = path.join(dir, 'unit.jsonl'); const log = new H.EvidenceLog(f, 'u', process.hrtime.bigint(), () => fired++);
    assert.ok(log.append('A')); restore = ioFault(() => true);
    try { assert.strictEqual(log.append('B'), null); } finally { restore(); }
    assert.strictEqual(log.append('C'), null, 'refused after failure even when fsync works again'); assert.strictEqual(log.events.length, 1); log.close();
    await sleep(20); assert.strictEqual(fired, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 R2 verify checks every evidence file hash and binds result.json to the events (forged or edited evidence is CORRUPT)', () => {
  const dir = tmp();
  try {
    const ok = runSync(dir, 'r2ok', [], [process.execPath, '-e', '0']); const bad = runSync(dir, 'r2bad', [], [process.execPath, '-e', 'process.exit(3)']);
    assert.strictEqual(ok.status, 0); assert.strictEqual(bad.status, 1);
    const v0 = H.verify(ok.runDir).verification; assert.strictEqual(v0.status, 'OK', JSON.stringify(v0)); assert.strictEqual(v0.sha256sums, 'PRESENT');
    assert.deepStrictEqual(Object.keys(v0.file_sha256).sort(), ['SHA256SUMS.json', 'events.jsonl', 'result.json', 'run.json']);
    const res0 = result(ok.runDir); assert.strictEqual(res0.events_sha256, v0.events_sha256); assert.strictEqual(res0.run_end_seq, v0.events_valid - 1);
    const copy = (src, name) => { const d = path.join(dir, name); fs.mkdirSync(d); fs.readdirSync(src).forEach((n) => fs.copyFileSync(path.join(src, n), path.join(d, n))); return d; };
    const resum = (d) => { const s = JSON.parse(fs.readFileSync(path.join(d, 'SHA256SUMS.json'), 'utf8')); Object.keys(s.files).forEach((n) => { s.files[n] = sha(fs.readFileSync(path.join(d, n))); }); fs.writeFileSync(path.join(d, 'SHA256SUMS.json'), JSON.stringify(s)); };
    const editJson = (d, n, fn) => { const p = path.join(d, n); const o = JSON.parse(fs.readFileSync(p, 'utf8')); fn(o); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
    const expectCorrupt = (d, reason) => { const v = H.verify(d).verification; assert.strictEqual(v.status, 'CORRUPT', reason + ' ' + JSON.stringify(v)); assert.strictEqual(v.reason, reason);
      const rr = H.recover(d, { bootTimeNowMs: 0, nowMs: 0 }); assert.strictEqual(rr.outcome, 'UNKNOWN', reason);
      const cli = cp.spawnSync(process.execPath, [HARNESS, 'verify', '--run-dir', d], { encoding: 'utf8' }); assert.strictEqual(cli.status, 1, reason); };
    let d = copy(ok.runDir, 'v-runjson'); editJson(d, 'run.json', (o) => { o.label = 'EDITED'; }); expectCorrupt(d, 'SUMS_MISMATCH:run.json');
    d = copy(ok.runDir, 'v-result'); editJson(d, 'result.json', (o) => { o.finished_at = '2000-01-01T00:00:00.000Z'; }); expectCorrupt(d, 'SUMS_MISMATCH:result.json');
    d = copy(ok.runDir, 'v-events'); fs.appendFileSync(path.join(d, 'events.jsonl'), '{"v":1'); expectCorrupt(d, 'SUMS_MISMATCH:events.jsonl');
    // forgery that also recomputes the sums: a failed run (exit 3) presented as COMPLETED
    d = copy(bad.runDir, 'v-forged'); editJson(d, 'result.json', (o) => { o.outcome = 'COMPLETED'; o.basis = ['CHILD_EXIT_CODE:0']; }); resum(d); expectCorrupt(d, 'RESULT_INCONSISTENT:outcome');
    d = copy(bad.runDir, 'v-basis'); editJson(d, 'result.json', (o) => { o.basis = ['CHILD_EXIT_CODE:0']; }); resum(d); expectCorrupt(d, 'RESULT_INCONSISTENT:basis');
    d = copy(ok.runDir, 'v-endseq'); editJson(d, 'result.json', (o) => { o.run_end_seq = 1; }); resum(d); expectCorrupt(d, 'RESULT_INCONSISTENT:run_end_seq');
    d = copy(ok.runDir, 'v-evsha'); editJson(d, 'result.json', (o) => { o.events_sha256 = '0'.repeat(64); }); resum(d); expectCorrupt(d, 'RESULT_INCONSISTENT:events_sha256');
    d = copy(ok.runDir, 'v-norunend'); editJson(d, 'result.json', (o) => { o.run_end_seq = null; }); resum(d); expectCorrupt(d, 'RESULT_INCONSISTENT:run_end_not_referenced');
    d = copy(ok.runDir, 'v-runid'); editJson(d, 'run.json', (o) => { o.run_id = 'other'; }); editJson(d, 'result.json', (o) => { o.run_id = 'other'; }); resum(d); expectCorrupt(d, 'RUN_ID_MISMATCH');
    d = copy(ok.runDir, 'v-boot'); editJson(d, 'run.json', (o) => { o.boot_time_ms += 1; }); resum(d); expectCorrupt(d, 'RUN_JSON_INCONSISTENT:boot_time_ms');
    d = copy(ok.runDir, 'v-nosums'); fs.unlinkSync(path.join(d, 'SHA256SUMS.json')); expectCorrupt(d, 'SUMS_MISSING_FOR_FINISHED_RUN');
    d = copy(ok.runDir, 'v-noresult'); fs.unlinkSync(path.join(d, 'result.json')); expectCorrupt(d, 'SUMS_LISTED_FILE_MISSING:result.json');
    d = copy(ok.runDir, 'v-unlisted'); editJson(d, 'SHA256SUMS.json', (o) => { delete o.files['run.json']; }); expectCorrupt(d, 'SUMS_UNLISTED:run.json');
    d = copy(ok.runDir, 'v-badjson'); fs.writeFileSync(path.join(d, 'result.json'), '{oops'); resum(d); expectCorrupt(d, 'RESULT_UNPARSEABLE');
    // a recovery file is expected; anything else is reported (not hidden)
    d = copy(ok.runDir, 'v-extra'); recoverSameBoot(d); fs.writeFileSync(path.join(d, 'stray.txt'), 'x');
    const ve = H.verify(d).verification; assert.strictEqual(ve.status, 'OK'); assert.deepStrictEqual(ve.unexpected_files, ['stray.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 R3 OS_SHUTDOWN only when the new boot is strictly after the last event (and moved forward, not in the future)', async () => {
  const t = (type, data, at) => ({ type, data: data || {}, t_wall: at });
  const B0 = Date.parse('2026-10-01T00:00:00Z'); const LAST = '2026-10-10T19:21:04.000Z'; const lastMs = Date.parse(LAST);
  const inc = [t('RUN_START', { boot_time_ms: B0 }, '2026-10-10T19:20:00.000Z'), t('PREFLIGHT', { status: 'PASS' }, '2026-10-10T19:20:00.100Z'),
    t('CHILD_SPAWN', { pid: 1 }, '2026-10-10T19:20:00.200Z'), t('HEARTBEAT', {}, LAST)];
  const now = Date.parse('2026-10-10T20:00:00Z'); const c = (ev, boot) => H.classify(ev, { bootTimeNowMs: boot, nowMs: now });
  const unknownWith = (res, re, msg) => { assert.strictEqual(res.outcome, 'UNKNOWN', msg + ' ' + JSON.stringify(res.basis)); assert.ok(res.basis.some((b) => re.test(b)), msg + ' ' + JSON.stringify(res.basis)); };
  unknownWith(c(inc, lastMs - 60000), /BOOT_NOT_AFTER_LAST_EVENT/, 'boot 60 s before the last event (was OS_SHUTDOWN on bd75be4)');
  unknownWith(c(inc, lastMs - 1), /BOOT_NOT_AFTER_LAST_EVENT/, 'boot 1 ms before the last event');
  unknownWith(c(inc, lastMs), /BOOT_NOT_AFTER_LAST_EVENT/, 'boot exactly at the last event');
  const sd = c(inc, lastMs + 1); assert.strictEqual(sd.outcome, 'OS_SHUTDOWN'); assert.strictEqual(sd.facts.gap_last_event_to_boot_ms, 1);
  assert.ok(sd.facts.gap_last_event_to_boot_ms > 0);
  const lost = inc.concat([t('REMOTE_CHANNEL_LOST', { code: 'EPIPE' }, '2026-10-10T19:21:05.000Z')]);
  unknownWith(c(lost, B0 - 10 * 86400000), /CLOCK_INCONSISTENT/, 'boot moved backwards is not "same boot" (was REMOTE_CHANNEL_FAILURE)');
  unknownWith(c(inc, now + H.BOOT_TOLERANCE_MS + 1000), /BOOT_TIME_IN_FUTURE/, 'boot after the classification time');
  assert.strictEqual(c(lost, B0 - 60000).outcome, 'REMOTE_CHANNEL_FAILURE', 'small negative jitter is still the same boot');
  unknownWith(c([inc[0], inc[1], inc[2], t('HEARTBEAT', {}, 'not-a-date')], lastMs + 5000), /LAST_EVENT_TIME_UNREADABLE/, 'unreadable last event time');
  // end to end on a real interrupted run: an observed boot before the last event is refused
  if (POSIX) {
    const dir = tmp();
    try {
      const runDir = await startAndKillMidRun(dir, 'r3'); const last = lastEventMs(runDir);
      unknownWith(recoverObserved(runDir, last - 30000), /BOOT_NOT_AFTER_LAST_EVENT/, 'observed boot 30 s before the last event');
      assert.strictEqual(recoverObserved(runDir, last + 1000).outcome, 'OS_SHUTDOWN');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('S17 R4 short sensitive values (PIN, short password, a word from env/argv) never reach a CHILD_EVENT', () => {
  const env = { PM_PIN: '4821', PM_PW: 'hunter2', PM_WORD: 'OPENSESAME', PM_TOKEN: 'abc' };
  const sens = H.buildSensitiveSet(env, ['--pin=7319', 'CORRECT_HORSE']);
  const s = (o) => H.sanitizeChildEvent('PMH-EVENT ' + JSON.stringify(o), sens);
  // every one of these survived on bd75be4
  assert.deepStrictEqual(s({ stage: 'hunter2', status: 'opensesame', code: 4821, op: 'admin', result: 'OPENSESAME' }), { event: null, dropped: 5 });
  assert.deepStrictEqual(s({ code: 'OPENSESAME' }).event, null, 'enum-shaped token equal to an env value');
  assert.deepStrictEqual(s({ stage: 'STEP_OPENSESAME' }).event, null, 'token containing an env value');
  assert.deepStrictEqual(s({ iteration: 7319 }).event, null, 'number equal to an argv value');
  assert.deepStrictEqual(s({ elapsed_ms: 4821 }).event, null, 'number equal to an env value');
  assert.deepStrictEqual(s({ op: 'CORRECT_HORSE' }).event, null, 'argv value'); assert.deepStrictEqual(s({ code: 'ABC' }).event, null, 'case-insensitive');
  assert.deepStrictEqual(s({ code: 12345 }).event, null, 'code is a token, never a number');
  assert.deepStrictEqual(s({ hresult: '0x12345678' }).event, null, 'only failure HRESULTs (or S_OK)');
  assert.deepStrictEqual(s({ status: 'MYPASS' }).event, null, 'status is a closed enum');
  assert.deepStrictEqual(s({ depth: 65 }).event, null); assert.deepStrictEqual(s({ elapsed_ms: 1.5 }).event, null, 'integers only');
  // legitimate progress still survives
  assert.deepStrictEqual(s({ stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172, hresult: '0x8007000D', code: 'ERROR_ACCESS_DENIED', depth: 2, exit_code: 0 }),
    { event: { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172, hresult: '0x8007000D', code: 'ERROR_ACCESS_DENIED', depth: 2, exit_code: 0 }, dropped: 0 });
  // end to end: env + argv short secrets echoed by the child are absent from all evidence
  const dir = tmp();
  try {
    const c = childScript(dir, "const e=process.env;console.log('PMH-EVENT '+JSON.stringify({stage:e.PM_PW,status:e.PM_PW,code:e.PM_WORD,elapsed_ms:Number(e.PM_PIN),iteration:7319,op:'DPAPI_PROTECT',result:'OK'}));");
    const r = runSync(dir, 'r4', [], [process.execPath, c, '--pin=7319'], { env: cleanEnv(env) });
    assert.strictEqual(r.status, 0, r.out);
    const ev = readEvents(r.runDir).filter((e) => e.type === 'CHILD_EVENT').map((e) => e.data);
    assert.deepStrictEqual(ev, [{ op: 'DPAPI_PROTECT', result: 'OK' }]);
    const text = allEvidenceText(dir).toLowerCase(); ['hunter2', 'opensesame'].forEach((w) => assert.ok(text.indexOf(w) === -1, w + ' leaked'));
    assert.strictEqual(readEvents(r.runDir).find((e) => e.type === 'RUN_END').data.counters.child_fields_dropped, 5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 R5 readiness gate before Windows tests is STRICT: pending reboot, unreadable registry, low uptime or any WARN blocks the run', () => {
  const dir = tmp();
  try {
    const seen = [];
    const win = (reg, extra) => H.preflight(Object.assign({ dir: path.join(dir, 'w'), minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0, platform: 'win32',
      regQuery: (args) => { seen.push(args); return typeof reg === 'function' ? reg(args) : reg; } }, extra || {}));
    const pf = (r) => [r.status, r.gate];
    const absent = win({ status: 1 }); assert.deepStrictEqual(pf(absent), ['PASS', 'STRICT'], JSON.stringify(absent.checks));
    ['windows_update_reboot_required', 'cbs_reboot_pending', 'pending_file_rename_operations'].forEach((n) => assert.strictEqual(absent.checks.find((c) => c.name === n).value, 'ABSENT', n));
    assert.ok(seen.every((a) => /^HKLM\\/.test(a[0]) && a.indexOf('add') === -1 && a.indexOf('delete') === -1), 'read-only registry queries');
    assert.ok(seen.some((a) => a.indexOf('PendingFileRenameOperations') !== -1));
    const check = (r, n) => r.checks.find((c) => c.name === n);
    let r = win((a) => ({ status: /RebootRequired/.test(a[0]) ? 0 : 1 })); assert.strictEqual(r.status, 'FAIL'); assert.strictEqual(check(r, 'windows_update_reboot_required').value, 'PRESENT');
    r = win({ status: 2 }); assert.strictEqual(r.status, 'FAIL', 'reg error exit (was mapped to ABSENT/PASS on bd75be4)'); assert.strictEqual(check(r, 'cbs_reboot_pending').value, 'UNAVAILABLE:EXIT_2'); assert.strictEqual(check(r, 'cbs_reboot_pending').strict_gate, true);
    r = win({ error: 'ENOENT' }); assert.strictEqual(r.status, 'FAIL'); assert.strictEqual(check(r, 'cbs_reboot_pending').value, 'UNAVAILABLE:ENOENT');
    r = win({ status: null, signal: 'SIGTERM' }); assert.strictEqual(r.status, 'FAIL', 'timed-out query');
    r = win(() => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }); assert.strictEqual(r.status, 'FAIL');
    r = win({ status: 1 }, { minUptimeS: 1e9 }); assert.strictEqual(r.status, 'FAIL', 'low uptime blocks on Windows without any flag'); assert.strictEqual(check(r, 'os_uptime_s').status, 'FAIL');
    // the same low uptime off-Windows is a WARN in the standard gate, and blocks with --strict-readiness
    const lin = H.preflight({ dir: path.join(dir, 'l'), minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 1e9, platform: 'linux' });
    assert.deepStrictEqual(pf(lin), ['WARN', 'STANDARD']);
    assert.deepStrictEqual(pf(H.preflight({ dir: path.join(dir, 'l'), minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 1e9, platform: 'linux', strict: true })), ['FAIL', 'STRICT']);
    const marker = path.join(dir, 'm.txt'); const c = childScript(dir, "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'x')");
    // CLI: --strict-readiness blocks the child on a WARN (extra flags precede BASE; the first occurrence of a flag is used)
    const run = runSync(dir, 'r5', ['--min-uptime-s', String(1e9), '--strict-readiness'], [process.execPath, c]);
    assert.strictEqual(run.status, H.EXIT.PREFLIGHT_FAILED, run.out); assert.ok(!fs.existsSync(marker), 'child never started');
    const pe = readEvents(run.runDir).find((e) => e.type === 'PREFLIGHT').data; assert.strictEqual(pe.gate, 'STRICT'); assert.strictEqual(pe.checks.find((x) => x.name === 'os_uptime_s').strict_gate, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 R6 S17 is independent of this machine\'s boot time and clock: every recovery injects them; results do not move when uptime does', async () => {
  // static: no recover()/classify() in this file reads the live boot time or clock
  const src = fs.readFileSync(__filename, 'utf8').split('\n');
  const recoverLines = src.filter((l) => /H\.recover\(/.test(l) && !/^\s*\/\//.test(l) && !/const recover(SameBoot|Observed) =/.test(l) && !/THIS_MACHINE_NOW/.test(l));
  recoverLines.forEach((l) => assert.ok(/nowMs/.test(l) && /(bootTimeNowMs|observedBootTime)/.test(l), 'recover() without injected boot/clock: ' + l.trim()));
  ['recoverSameBoot', 'recoverObserved'].forEach((h) => { const def = src.find((l) => l.indexOf('const ' + h + ' =') !== -1); assert.ok(/nowMs/.test(def) && /(bootTimeNowMs|observedBootTime)/.test(def), h); });
  assert.ok(src.filter((l) => /\bc\(inc/.test(l)).length > 0 && src.some((l) => /const c = \(ev, ctx\) => H\.classify\(ev, Object\.assign\(\{ nowMs:/.test(l)));
  if (!POSIX) return;
  // dynamic: the same interrupted run classifies identically whatever this machine's uptime reports
  const dir = tmp(); const realUptime = os.uptime;
  try {
    const runDir = await startAndKillMidRun(dir, 'r6');
    const outcomes = [5, 3600, 1e8].map((u) => { os.uptime = () => u; try { const a = recoverSameBoot(runDir); const b = recoverObserved(runDir, lastEventMs(runDir) + 222000); return [a.outcome, b.outcome, b.facts.gap_last_event_to_boot_ms]; } finally { os.uptime = realUptime; } });
    outcomes.forEach((o) => assert.deepStrictEqual(o, ['UNKNOWN', 'OS_SHUTDOWN', 222000]));
    // the default (live) path is still available to operators and does read the machine boot time
    os.uptime = () => 5; try { const live = H.recover(runDir, { nowMs: Date.now() }); assert.strictEqual(live.facts.boot_time_source, 'THIS_MACHINE_NOW'); } finally { os.uptime = realUptime; }
    // a completed run never depends on the boot time (uptime reported as 1 s: fresh boot)
    os.uptime = () => 1; let r; try { r = await inproc(dir, 'r6c', ['-e', '0']); } finally { os.uptime = realUptime; }
    assert.strictEqual(r.outcome, 'COMPLETED');
  } finally { os.uptime = realUptime; fs.rmSync(dir, { recursive: true, force: true }); }
});

// =====================================================================================================================
// Regression tests — GFPI_RESILIENT_TEST_HARNESS_V3_MINIMAL_REPAIR (F07 checked write-all + checked close, F08 short
// embedded secrets). Exact negative assertions: exact failure codes, exact exit codes, exact dropped fields.
// =====================================================================================================================
const fdPath = (fd) => { try { return fs.readlinkSync('/proc/self/fd/' + fd); } catch (e) { return ''; } };
/** Replace the write primitive: `plan(fd, text, remaining)` returns how many bytes the "OS" accepts (0..remaining), or a bogus count. */
const writeFault = (plan) => {
  const orig = H._io.writeSync;
  H._io.writeSync = (fd, buf, off, len) => {
    const n = plan(fd, buf.toString('utf8', off, off + len), len);
    if (n === undefined) return orig(fd, buf, off, len);
    if (Number.isInteger(n) && n > 0 && n <= len) return orig(fd, buf, off, n); // really write exactly the accepted bytes
    return n; // 0, negative, oversized or non-integer: claim it without writing
  };
  return () => { H._io.writeSync = orig; };
};
const closeFault = (pred) => { const orig = H._io.closeSync; let fired = false;
  H._io.closeSync = (fd) => { const hit = !fired && pred(fd); orig(fd); if (hit) { fired = true; throw Object.assign(new Error('injected'), { code: 'EIO' }); } };
  return () => { H._io.closeSync = orig; }; };

test('S17 R7 F07 checked write-all: short writes are continued, zero/bogus byte counts and close errors fail closed with exact codes (exit 8)', async () => {
  const dir = tmp();
  try {
    // (a) writeAll unit: 1 byte per call is continued to the exact full content
    const f = path.join(dir, 'w.bin'); const fd = fs.openSync(f, 'w'); const text = 'PMH é中 line\n';
    let restore = writeFault(() => 1);
    try { assert.strictEqual(H.writeAll(fd, text), Buffer.byteLength(text)); } finally { restore(); }
    fs.closeSync(fd); assert.strictEqual(fs.readFileSync(f, 'utf8'), text, 'multi-byte content intact after 1-byte writes');
    // (b) writeAll unit: every non-progress / impossible count throws an exact code
    const bogus = [[0, 'ZERO_WRITE'], [-1, 'BAD_WRITE_COUNT'], [1.5, 'BAD_WRITE_COUNT'], [99999, 'BAD_WRITE_COUNT'], [undefined, 'BAD_WRITE_COUNT'], ['3', 'BAD_WRITE_COUNT']];
    for (const [n, code] of bogus) {
      const g = fs.openSync(path.join(dir, 'b.bin'), 'w'); const orig = H._io.writeSync; H._io.writeSync = () => n;
      try { assert.throws(() => H.writeAll(g, 'abcdef'), (e) => e.code === code, 'count ' + String(n)); } finally { H._io.writeSync = orig; fs.closeSync(g); }
    }
    // the run-level cases identify files through /proc/self/fd (Linux); elsewhere only the unit cases above run
    if (!fs.existsSync('/proc/self/fd')) { console.log('       PARTIAL on ' + process.platform + ' (no /proc/self/fd): run-level fault cases skipped'); return; }
    // (c) every event-log write accepts 1 byte at a time: run COMPLETED, evidence byte-identical in structure, verify OK
    restore = writeFault((fd2) => (/events\.jsonl$/.test(fdPath(fd2)) ? 1 : undefined));
    let r; try { r = await inproc(dir, 'r7c', ['-e', '0']); } finally { restore(); }
    assert.strictEqual(r.exitCode, 0); assert.strictEqual(r.outcome, 'COMPLETED'); assert.strictEqual(r.evidenceFailure, null);
    assert.strictEqual(H.verify(r.runDir).verification.status, 'OK');
    // (d) zero bytes accepted for the CHILD_EVENT line: exact failure, child killed, nothing after it, evidence intact
    const marker = path.join(dir, 'd.txt');
    const c = childScript(dir, "const fs=require('fs');console.log('PMH-EVENT '+JSON.stringify({stage:'DPAPI_PROTECT'}));setTimeout(()=>fs.writeFileSync(" + JSON.stringify(marker) + ",'late'),2500);");
    restore = writeFault((fd2, t) => (t.indexOf('"type":"CHILD_EVENT"') !== -1 ? 0 : undefined));
    try { r = await inproc(dir, 'r7d', [c]); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.outcome, 'UNKNOWN'); assert.strictEqual(r.evidenceFailure, 'EVENT_WRITE_FAILED:ZERO_WRITE');
    let res = result(r.runDir); assert.strictEqual(res.evidence_failure, 'EVENT_WRITE_FAILED:ZERO_WRITE'); assert.strictEqual(res.run_end_seq, null);
    assert.deepStrictEqual(res.basis, ['EVIDENCE_DURABILITY_FAILED:EVENT_WRITE_FAILED:ZERO_WRITE (fail closed: the run was stopped, no outcome is asserted)']);
    assert.deepStrictEqual(types(r.runDir), ['RUN_START', 'PREFLIGHT', 'CHILD_SPAWN'], 'nothing recorded at or after the failed line');
    assert.strictEqual(H.verify(r.runDir).verification.status, 'OK'); await sleep(2800); assert.ok(!fs.existsSync(marker), 'child killed');
    // (e) half the bytes, then no progress: torn line on disk, exact failure, recovery asserts nothing
    // the continuation carries only the rest of the line, so the plan is stateful once the line started — on that fd only
    let calls = 0; let evFd = null;
    restore = writeFault((fd2, t, len) => {
      if (evFd === null) { if (t.indexOf('"type":"CHILD_EVENT"') === -1) return undefined; evFd = fd2; }
      if (fd2 !== evFd || !/events\.jsonl$/.test(fdPath(fd2))) return undefined; // fd numbers are reused after close
      calls++; return calls === 1 ? Math.floor(len / 2) : 0;
    });
    try { r = await inproc(dir, 'r7e', [c]); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.evidenceFailure, 'EVENT_WRITE_FAILED:ZERO_WRITE'); assert.strictEqual(calls, 2, 'continued once, then stopped (no retry loop)');
    let v = H.verify(r.runDir).verification; assert.strictEqual(v.status, 'TRUNCATED_TAIL'); assert.strictEqual(v.events_valid, 3); assert.strictEqual(v.evidence_failure, 'EVENT_WRITE_FAILED:ZERO_WRITE');
    let rec = H.recover(r.runDir, { bootTimeNowMs: runBoot(r.runDir), nowMs: lastEventMs(r.runDir) + 1000 });
    assert.strictEqual(rec.outcome, 'UNKNOWN'); assert.strictEqual(rec.basis[0], 'EVIDENCE_DURABILITY_FAILED:EVENT_WRITE_FAILED:ZERO_WRITE (fail closed: the run was stopped, no outcome is asserted)');
    // (f) an "OS" that claims more bytes than asked is not believed
    restore = writeFault((fd2, t, len) => (t.indexOf('"type":"PREFLIGHT"') !== -1 ? len + 7 : undefined));
    try { r = await inproc(dir, 'r7f', [c]); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.evidenceFailure, 'EVENT_WRITE_FAILED:BAD_WRITE_COUNT'); assert.deepStrictEqual(types(r.runDir), ['RUN_START'], 'never spawned');
    // (g) result.json write stalls: exit 8, exact code, no result.json and no tmp file left
    restore = writeFault((fd2, t) => (t.indexOf('"run_end_seq"') !== -1 ? 0 : undefined));
    try { r = await inproc(dir, 'r7g', ['-e', '0']); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.evidenceFailure, 'ATOMIC_WRITE_FAILED:ZERO_WRITE');
    assert.deepStrictEqual(fs.readdirSync(r.runDir).sort(), ['events.jsonl', 'run.json'], 'no result.json, no sums, no tmp');
    // (h) close of the event log fails after RUN_END(COMPLETED): the run is NOT accepted (UNKNOWN, exit 8) and stays consistent
    restore = closeFault((fd2) => /events\.jsonl$/.test(fdPath(fd2)));
    try { r = await inproc(dir, 'r7h', ['-e', '0']); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.outcome, 'UNKNOWN'); assert.strictEqual(r.evidenceFailure, 'EVENT_CLOSE_FAILED:EIO');
    res = result(r.runDir); const end = readEvents(r.runDir).pop();
    assert.strictEqual(end.type, 'RUN_END'); assert.strictEqual(end.data.outcome, 'COMPLETED'); assert.strictEqual(res.run_end_seq, end.seq);
    assert.strictEqual(res.outcome, 'UNKNOWN'); assert.strictEqual(res.evidence_failure, 'EVENT_CLOSE_FAILED:EIO');
    v = H.verify(r.runDir).verification; assert.strictEqual(v.status, 'OK'); assert.strictEqual(v.evidence_failure, 'EVENT_CLOSE_FAILED:EIO');
    rec = H.recover(r.runDir, { bootTimeNowMs: runBoot(r.runDir), nowMs: lastEventMs(r.runDir) + 1000 }); assert.strictEqual(rec.outcome, 'UNKNOWN', 'recovery never upgrades it to COMPLETED');
    // ... and forging such a result into COMPLETED (sums recomputed) is detected
    const forged = path.join(dir, 'r7h-forged'); fs.mkdirSync(forged); fs.readdirSync(r.runDir).forEach((n) => fs.copyFileSync(path.join(r.runDir, n), path.join(forged, n)));
    const rf = JSON.parse(fs.readFileSync(path.join(forged, 'result.json'), 'utf8')); rf.outcome = 'COMPLETED'; fs.writeFileSync(path.join(forged, 'result.json'), JSON.stringify(rf));
    const sums = JSON.parse(fs.readFileSync(path.join(forged, 'SHA256SUMS.json'), 'utf8')); sums.files['result.json'] = sha(fs.readFileSync(path.join(forged, 'result.json'))); fs.writeFileSync(path.join(forged, 'SHA256SUMS.json'), JSON.stringify(sums));
    v = H.verify(forged).verification; assert.strictEqual(v.status, 'CORRUPT'); assert.strictEqual(v.reason, 'RESULT_INCONSISTENT:evidence_failure_outcome');
    // (i) close of the run.json tmp file fails: nothing spawned, nothing left
    const m2 = path.join(dir, 'i.txt'); const c2 = childScript(dir, "require('fs').writeFileSync(" + JSON.stringify(m2) + ",'x')");
    restore = closeFault((fd2) => /run\.json\..*\.tmp$/.test(fdPath(fd2)));
    try { r = await inproc(dir, 'r7i', [c2]); } finally { restore(); }
    assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.evidenceFailure, 'ATOMIC_CLOSE_FAILED:EIO'); await sleep(300); assert.ok(!fs.existsSync(m2));
    assert.deepStrictEqual(fs.readdirSync(r.runDir), []);
    // (j) close of a directory handle after its fsync fails (POSIX)
    if (POSIX) {
      restore = closeFault((fd2) => { try { return fs.fstatSync(fd2).isDirectory(); } catch (e) { return false; } });
      try { r = await inproc(dir, 'r7j', [c2]); } finally { restore(); }
      assert.strictEqual(r.exitCode, 8); assert.strictEqual(r.evidenceFailure, 'DIR_CLOSE_FAILED:EIO'); await sleep(300); assert.ok(!fs.existsSync(m2));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 R8 F08 short secrets embedded in allowed values (>= 4 alphanumerics, separators ignored) are dropped; exact boundary', () => {
  const env = { PM_PIN: '4821', PM_PW: 'pw12', PM_KEY: 'ab-12', PM_TRI: 'xyz', PM_SLASH: '/', PM_TWO: 'ab' };
  const sens = H.buildSensitiveSet(env, ['--otp=7319']);
  assert.deepStrictEqual([...sens].sort(), ['4821', '7319', 'AB12', 'OTP7319', 'PW12', 'XYZ'], 'alphanumeric form; < 3 alphanumerics ignored');
  assert.strictEqual(H.SENSITIVE_MIN_EQUAL, 3); assert.strictEqual(H.SENSITIVE_MIN_EMBED, 4);
  const s = (o) => H.sanitizeChildEvent('PMH-EVENT ' + JSON.stringify(o), sens);
  // every one of these survived on 6e2312f; each must now be dropped, exactly one field each
  const embedded = [{ stage: 'STEP_4821' }, { code: 'ERR_PW12' }, { op: 'AB_12' }, { stage: 'OK_7319_DONE' }, { code: 'X_PW_12' }, { stage: 'PW12_STAGE' },
    { elapsed_ms: 148210 }, { iteration: 73190 }, { exit_code: -4821 }, { hresult: '0x80074821' }, { code: 'XYZ' }];
  embedded.forEach((o) => assert.deepStrictEqual(s(o), { event: null, dropped: 1 }, JSON.stringify(o)));
  // exact boundary: a 3-alphanumeric value is matched only when EQUAL, not when embedded (documented floor)
  assert.deepStrictEqual(s({ stage: 'STEP_XYZ' }), { event: { stage: 'STEP_XYZ' }, dropped: 0 });
  // values that do not carry a sensitive value are untouched
  assert.deepStrictEqual(s({ stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172, iteration: 3, hresult: '0x8007000D' }),
    { event: { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172, iteration: 3, hresult: '0x8007000D' }, dropped: 0 });
  // mixed line: only the carrying fields go, exact count
  assert.deepStrictEqual(s({ stage: 'DPAPI_PROTECT', code: 'E_4821', elapsed_ms: 148210, status: 'OK' }), { event: { stage: 'DPAPI_PROTECT', status: 'OK' }, dropped: 2 });
  // end to end with a fixed environment: the secrets never appear in CHILD_EVENT data; exact survivors and drop count
  const dir = tmp();
  try {
    const c = childScript(dir, "const e=process.env;[{stage:'STEP_'+e.PM_PIN},{code:'ERR_'+e.PM_PW.toUpperCase()},{op:e.PM_KEY.toUpperCase().replace('-','_')},{elapsed_ms:Number('1'+e.PM_PIN+'0')},{iteration:73190},{stage:'DPAPI_PROTECT',status:'OK',elapsed_ms:10172}].forEach((o)=>console.log('PMH-EVENT '+JSON.stringify(o)));");
    const r = runSync(dir, 'r8', [], [process.execPath, c, '--otp=7319'], { env: cleanEnv(env) });
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(readEvents(r.runDir).filter((e) => e.type === 'CHILD_EVENT').map((e) => e.data), [{ stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 }]);
    assert.strictEqual(readEvents(r.runDir).find((e) => e.type === 'RUN_END').data.counters.child_fields_dropped, 5);
    const text = allEvidenceText(dir); ['4821', '7319', 'PW12', 'AB_12'].forEach((w) => assert.ok(text.indexOf(w) === -1, w + ' leaked'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
