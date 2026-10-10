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
function runSync(dir, runId, extra, child, opts) {
  const r = cp.spawnSync(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', runId].concat(extra || [], BASE, ['--'], child), Object.assign({ encoding: 'utf8', timeout: 60000 }, opts || {}));
  return { status: r.status, out: r.stdout + r.stderr, runDir: path.join(dir, runId) };
}
async function waitFor(fn, ms, what) { const end = Date.now() + (ms || 15000); for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) throw new Error('timeout waiting for ' + what); await sleep(50); } }
function killPidGroup(pid) { try { process.kill(-pid, 'SIGKILL'); } catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (x) { /* gone */ } } }
const result = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
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
  const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', runId].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const same = H.recover(runDir, {}); assert.strictEqual(same.outcome, 'UNKNOWN', JSON.stringify(same.basis));
    assert.ok(same.basis.some((b) => /BOOT_TIME_UNCHANGED/.test(b)) && same.basis.some((b) => /NO_CORROBORATING_EVIDENCE/.test(b)));
    assert.deepStrictEqual(same.facts.last_child_event, { stage: 'DPAPI_PROTECT', status: 'OK', elapsed_ms: 10172 }, 'sub-step evidence survived the stop');
    assert.strictEqual(same.retry_performed, false);
    // operator supplies the boot time observed in Windows logs (after the last event) => OS_SHUTDOWN
    const lastAt = Date.parse(same.facts.last_event_at);
    const boot = H.recover(runDir, { observedBootTime: new Date(lastAt + 222000).toISOString() });
    assert.strictEqual(boot.outcome, 'OS_SHUTDOWN', JSON.stringify(boot.basis)); assert.strictEqual(boot.facts.gap_last_event_to_boot_ms, 222000);
    // boot time not changed beyond tolerance => not a shutdown
    const start = readEvents(runDir)[0].data.boot_time_ms;
    assert.strictEqual(H.recover(runDir, { observedBootTime: new Date(start + 60000).toISOString() }).outcome, 'UNKNOWN');
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
    const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'ch1'].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((r) => h.stdout.once('data', r)); h.stdout.destroy();
    const code = await new Promise((r) => h.on('close', r));
    assert.strictEqual(code, 0); const res = result(path.join(dir, 'ch1'));
    assert.strictEqual(res.outcome, 'COMPLETED'); assert.strictEqual(res.facts.remote_channel_lost, true);
    assert.ok(types(path.join(dir, 'ch1')).indexOf('HEARTBEAT') < types(path.join(dir, 'ch1')).lastIndexOf('HEARTBEAT'), 'heartbeats continued after the loss');
    // (b) channel lost, then the harness is stopped (same boot): REMOTE_CHANNEL_FAILURE
    const runDir = await startAndKillMidRun(dir, 'ch2', { before: async (hh, rd) => { hh.stdout.destroy(); await waitFor(() => types(rd).indexOf('REMOTE_CHANNEL_LOST') !== -1, 10000, 'channel loss'); } });
    const rec = H.recover(runDir, {}); assert.strictEqual(rec.outcome, 'REMOTE_CHANNEL_FAILURE', JSON.stringify(rec.basis));
    // but a reboot after the last event takes precedence (both facts kept)
    const rb = H.recover(runDir, { observedBootTime: new Date(Date.parse(rec.facts.last_event_at) + 5000).toISOString() });
    assert.strictEqual(rb.outcome, 'OS_SHUTDOWN'); assert.strictEqual(rb.facts.remote_channel_lost, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S17 parent signals: SIGTERM terminates the child once (UNKNOWN, origin not assumed); SIGHUP is recorded and the run continues', async () => {
  if (!POSIX) { console.log('       SKIPPED on win32 (POSIX signals)'); return; }
  const dir = tmp();
  try {
    const marker = path.join(dir, 's.txt');
    const c = childScript(dir, "require('fs').appendFileSync(" + JSON.stringify(marker) + ", 'start\\n'); setInterval(() => {}, 1000);");
    const h = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'term'].concat(BASE, ['--'], [process.execPath, c]), { stdio: ['ignore', 'pipe', 'ignore'] });
    h.stdout.on('data', () => {}); await waitFor(() => fs.existsSync(marker), 10000, 'child start'); h.kill('SIGTERM');
    assert.strictEqual(await new Promise((r) => h.on('close', r)), H.EXIT.UNKNOWN);
    const res = result(path.join(dir, 'term')); assert.strictEqual(res.outcome, 'UNKNOWN'); assert.ok(/^PARENT_SIGNAL:SIGTERM/.test(res.basis[0]));
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'start\n');
    const c2 = childScript(dir, 'setTimeout(() => {}, 900);');
    const h2 = cp.spawn(process.execPath, [HARNESS, 'run', '--evidence-dir', dir, '--run-id', 'hup'].concat(BASE, ['--'], [process.execPath, c2]), { stdio: ['ignore', 'pipe', 'ignore'] });
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
    assert.strictEqual(H.recover(d, {}).outcome, 'COMPLETED');
    // torn RUN_END line itself: the run is treated as incomplete, never as completed
    d = variant('torn2', lines.slice(0, n - 1).join('\n') + '\n' + lines[n - 1].slice(0, 30));
    v = H.verify(d).verification; assert.strictEqual(v.status, 'TRUNCATED_TAIL'); assert.strictEqual(v.events_valid, n - 1);
    const rec = H.recover(d, {}); assert.notStrictEqual(rec.outcome, 'COMPLETED'); assert.strictEqual(rec.facts.run_end_recorded, false);
    const corrupt = (name, text, reason) => { const dd = variant(name, text); const vv = H.verify(dd).verification; assert.strictEqual(vv.status, 'CORRUPT', name); if (reason) assert.strictEqual(vv.reason, reason, name);
      const rr = H.recover(dd, {}); assert.strictEqual(rr.outcome, 'UNKNOWN', name); assert.ok(/EVIDENCE_CORRUPT/.test(rr.basis[0])); return vv; };
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
  const c = (ev, ctx) => H.classify(ev, ctx || {});
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
  assert.ok(c(inc, { bootTimeNowMs: Date.parse('2026-10-05T00:00:00Z') }).basis.some((b) => /CLOCK_INCONSISTENT/.test(b)));
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
    const r = runSync(dir, 'sec', ['--label', 'secret hygiene'], [process.execPath, c, '--token', CANARY], { env: Object.assign({}, process.env, { PM_S17_SECRET: CANARY }) });
    assert.strictEqual(r.status, 0, r.out);
    const text = allEvidenceText(dir); assert.ok(!text.includes(CANARY) && !text.includes('HARNESSCANARY'), 'canary leaked into evidence');
    assert.ok(!r.out.includes(CANARY), 'canary leaked into harness output');
    const ev = readEvents(r.runDir).filter((e) => e.type === 'CHILD_EVENT'); assert.deepStrictEqual(ev.map((e) => e.data), [{ code: 'OK', status: 'API_KEY' }]);
    assert.ok(!/PM_S17_SECRET|"env"/.test(text), 'environment never recorded');
    const bad = runSync(dir, 'sec2', ['--label', CANARY], [process.execPath, '-e', '0']); assert.strictEqual(bad.status, H.EXIT.USAGE); assert.ok(!fs.existsSync(bad.runDir));
    // key allow-list: an unknown key is dropped even when its value is enum-like
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT ' + JSON.stringify({ stage: 'DPAPI_UNPROTECT', user: 'admin', extra: 'OK', depth: 1 })), { event: { stage: 'DPAPI_UNPROTECT', depth: 1 }, dropped: 2 });
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT [1,2]'), { event: null, dropped: 1 });
    assert.deepStrictEqual(H.sanitizeChildEvent('PMH-EVENT {broken'), { event: null, dropped: 1 });
    // value filter unit cases
    assert.strictEqual(H.safeValue('DPAPI_UNPROTECT'), 'DPAPI_UNPROTECT'); assert.strictEqual(H.safeValue('0x8007000D'), '0x8007000D'); assert.strictEqual(H.safeValue('ok'), 'ok');
    ['sk-' + 'a'.repeat(24), 'some free text', 'aB3dE5gH7jK9mN1pQ3rS5tU7', 'x'.repeat(70), 'ghp_' + 'b'.repeat(36)].forEach((s) => assert.strictEqual(H.safeValue(s), undefined, s));
    assert.strictEqual(H.safeValue(Infinity), undefined); assert.strictEqual(H.safeValue({ a: 1 }), undefined);
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
