#!/usr/bin/env node
'use strict';
/**
 * Resilient test harness (GFPI_RESILIENT_TEST_HARNESS_CANDIDATE_V1) — TEST TOOLING ONLY.
 *
 * Runs ONE child command exactly once and keeps verifiable evidence that survives a sudden stop of the harness, the
 * child, the remote channel or the operating system:
 *  - events.jsonl: append-only, one JSON event per line, fsync after every line, SHA-256 hash chain (prev -> hash),
 *    contiguous seq. Written as the run progresses (never only at the end), so a power-off loses at most the line
 *    being written (detected as TRUNCATED_TAIL).
 *  - run.json (header, atomic), result.json (outcome, atomic, only when the harness finishes), SHA256SUMS.
 *  - recovery-*.json: written by `recover` after an interruption; the original evidence is never rewritten.
 *
 * Outcomes are classified only from recorded evidence:
 *  COMPLETED | PROCESS_FAILURE | REMOTE_CHANNEL_FAILURE | OS_SHUTDOWN | UNKNOWN  (+ PREFLIGHT_FAILED: child never started)
 *  OS_SHUTDOWN requires the machine's boot time to have changed after the run started (observed on recovery, or given
 *  by the operator from Windows logs); REMOTE_CHANNEL_FAILURE requires a recorded channel loss. Anything not supported
 *  by evidence is UNKNOWN — a parent signal (e.g. SIGHUP/SIGBREAK on Windows) alone is NOT treated as a shutdown.
 *
 * NO RETRY: the child is spawned at most once; an existing run directory is never reused or overwritten.
 * NO SECRETS: the harness never records argv values, environment, stdin, child stdout/stderr content or exception
 * messages. The child may report progress on stdout as `PMH-EVENT {json}`; only allow-listed keys with enum-like
 * values survive (see sanitizeChildEvent). This module does not touch DPAPI, credentials or any provider.
 *
 * Usage:
 *   node tools/harness/resilientHarness.js preflight --evidence-dir D
 *   node tools/harness/resilientHarness.js run --evidence-dir D --run-id ID [--label L] [--timeout-ms N]
 *        [--heartbeat-ms N] [--min-free-disk-bytes N] [--min-free-mem-bytes N] [--min-uptime-s N] [--fail-on-warn] -- cmd args...
 *   node tools/harness/resilientHarness.js verify  --run-dir D/ID
 *   node tools/harness/resilientHarness.js recover --run-dir D/ID [--observed-boot-time ISO]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const HARNESS_VERSION = '1.0.0';
const SCHEMA = 'PmResilientHarnessEventV1';
const OUTCOMES = ['COMPLETED', 'PROCESS_FAILURE', 'REMOTE_CHANNEL_FAILURE', 'OS_SHUTDOWN', 'UNKNOWN', 'PREFLIGHT_FAILED'];
const EXIT = { COMPLETED: 0, PROCESS_FAILURE: 1, USAGE: 2, UNKNOWN: 3, PREFLIGHT_FAILED: 4, REFUSED_EXISTING_RUN: 5, REMOTE_CHANNEL_FAILURE: 6, OS_SHUTDOWN: 7 };
const BOOT_TOLERANCE_MS = 120000; // boot time = now - uptime has jitter; a change smaller than this is not a reboot
const DEFAULTS = { heartbeatMs: 5000, timeoutMs: 600000, killGraceMs: 2000, minFreeDiskBytes: 256 * 1024 * 1024, minFreeMemBytes: 256 * 1024 * 1024, minUptimeS: 120 };
const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const LABEL_RE = /^[A-Za-z0-9_.:\- ]{1,80}$/;
const CHILD_EVENT_PREFIX = 'PMH-EVENT ';
const CHILD_EVENT_KEYS = ['stage', 'status', 'code', 'op', 'result', 'elapsed_ms', 'exit_code', 'iteration', 'hresult', 'depth'];
const MAX_LINE = 4096;
// Second line of defence only (values must already be enum-like to survive). Mirrors tools/secretScan.js.
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/, /\beyJ[A-Za-z0-9_-]{15,}\./, /:\/\/[^\s\/:@]+:[^\s\/@]{3,}@/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const genesis = (runId) => sha256('PMH-GENESIS:' + runId);
const looksSecret = (s) => SECRET_PATTERNS.some((re) => re.test(s));
const monoMs = (t0) => Number((process.hrtime.bigint() - t0) / 1000000n);
const bootTimeMs = () => Date.now() - Math.round(os.uptime() * 1000);

/** A value survives only if it is a bounded number/boolean or an enum-like string (never free text). */
function safeValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) < 1e12 ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string' || looksSecret(v)) return undefined;
  if (/^[A-Z][A-Z0-9_]{0,47}$/.test(v) || /^0x[0-9A-Fa-f]{8}$/.test(v) || /^[a-z][a-z0-9_-]{0,15}$/.test(v)) return v;
  return undefined;
}
/** Child progress line -> { event, dropped } ; unknown keys and non-enum values are dropped (counted, not stored). */
function sanitizeChildEvent(line) {
  let obj; try { obj = JSON.parse(line.slice(CHILD_EVENT_PREFIX.length)); } catch (e) { return { event: null, dropped: 1 }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { event: null, dropped: 1 };
  const event = {}; let dropped = 0;
  Object.keys(obj).forEach((k) => { const v = CHILD_EVENT_KEYS.indexOf(k) !== -1 ? safeValue(obj[k]) : undefined; if (v === undefined) dropped++; else event[k] = v; });
  return { event: Object.keys(event).length ? event : null, dropped };
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(obj, null, 2) + '\n'); try { fs.fsyncSync(fd); } catch (e) { /* best effort */ } } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
}
function fsyncDir(dir) { if (process.platform === 'win32') return; try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (e) { /* best effort */ } }

/** Append-only hash-chained event log; every append is written and fsync'ed before returning. */
class EvidenceLog {
  constructor(file, runId, t0) {
    this.file = file; this.runId = runId; this.t0 = t0; this.seq = 0; this.prev = genesis(runId);
    this.fsyncErrors = 0; this.writeError = null; this.events = [];
    this.fd = fs.openSync(file, 'ax'); // fails if the file exists: never append to another run's evidence
    fsyncDir(path.dirname(file));
  }
  append(type, data) {
    const rec = { v: 1, seq: this.seq, run_id: this.runId, t_wall: new Date().toISOString(), t_mono_ms: monoMs(this.t0), type, data: data || {}, prev: this.prev };
    const hash = sha256(JSON.stringify(rec));
    try {
      fs.writeSync(this.fd, JSON.stringify(Object.assign({}, rec, { hash })) + '\n');
      try { fs.fsyncSync(this.fd); } catch (e) { this.fsyncErrors++; }
    } catch (e) { if (!this.writeError) this.writeError = e.code || 'WRITE_ERROR'; return null; }
    this.prev = hash; this.seq++; const full = Object.assign({}, rec, { hash }); this.events.push(full); return full;
  }
  close() { try { fs.closeSync(this.fd); } catch (e) { /* closed */ } }
}

/** Read-only readiness checks. FAIL blocks the run; WARN blocks only with --fail-on-warn. */
function preflight(o) {
  const checks = []; const add = (name, status, value, threshold) => checks.push({ name, status, value: value === undefined ? null : value, threshold: threshold === undefined ? null : threshold });
  const major = Number(process.versions.node.split('.')[0]);
  add('node_version', major >= 18 ? 'PASS' : 'FAIL', process.versions.node, '>=18');
  add('platform', 'INFO', process.platform + '/' + process.arch + '/' + os.release());
  try {
    fs.mkdirSync(o.dir, { recursive: true });
    const probe = path.join(o.dir, '.pmh-preflight-' + crypto.randomBytes(4).toString('hex'));
    const fd = fs.openSync(probe, 'wx'); fs.writeSync(fd, 'probe'); fs.fsyncSync(fd); fs.closeSync(fd);
    const ok = fs.readFileSync(probe, 'utf8') === 'probe'; fs.unlinkSync(probe);
    add('evidence_dir_writable_fsync', ok ? 'PASS' : 'FAIL', ok);
  } catch (e) { add('evidence_dir_writable_fsync', 'FAIL', e.code || 'ERROR'); }
  if (typeof fs.statfsSync === 'function') {
    try { const s = fs.statfsSync(o.dir); const free = Number(s.bavail) * Number(s.bsize); add('disk_free_bytes', free >= o.minFreeDiskBytes ? 'PASS' : 'FAIL', free, o.minFreeDiskBytes); } catch (e) { add('disk_free_bytes', 'WARN', 'UNAVAILABLE:' + (e.code || 'ERROR'), o.minFreeDiskBytes); }
  } else add('disk_free_bytes', 'WARN', 'UNAVAILABLE', o.minFreeDiskBytes);
  const mem = os.freemem(); add('free_memory_bytes', mem >= o.minFreeMemBytes ? 'PASS' : 'FAIL', mem, o.minFreeMemBytes);
  const up = Math.round(os.uptime()); add('os_uptime_s', up >= o.minUptimeS ? 'PASS' : 'WARN', up, o.minUptimeS);
  add('boot_time', 'INFO', new Date(bootTimeMs()).toISOString());
  if (process.platform !== 'win32') add('load_average_1m', 'INFO', Math.round(os.loadavg()[0] * 100) / 100);
  const outOk = !!(process.stdout && process.stdout.writable);
  add('channel_stdout_writable', outOk ? 'PASS' : 'FAIL', outOk); add('channel_stdout_is_tty', 'INFO', !!(process.stdout && process.stdout.isTTY));
  if (process.platform === 'win32') {
    // Read-only registry queries (no configuration change): a pending reboot raises the risk of an OS-initiated stop.
    const keys = { windows_update_reboot_required: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
      cbs_reboot_pending: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending' };
    Object.keys(keys).forEach((k) => { const r = cp.spawnSync('reg', ['query', keys[k]], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
      add(k, r.error ? 'WARN' : (r.status === 0 ? 'WARN' : 'PASS'), r.error ? 'UNAVAILABLE:' + (r.error.code || 'ERROR') : (r.status === 0 ? 'PRESENT' : 'ABSENT')); });
  } else add('windows_pending_reboot', 'NOT_APPLICABLE');
  const status = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : (o.failOnWarn && checks.some((c) => c.status === 'WARN') ? 'FAIL' : (checks.some((c) => c.status === 'WARN') ? 'WARN' : 'PASS'));
  return { status, checks };
}

/** Verify a run's evidence without trusting it: hash chain, seq, run id, torn tail. Never modifies anything. */
function verify(runDir) {
  const out = { run_dir_name: path.basename(runDir), status: 'OK', events_valid: 0, first_bad_seq: null, reason: null, tail_bytes_discarded: 0, run_json: null, result_json: null, events_sha256: null };
  let header = null; try { header = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')); out.run_json = 'PRESENT'; } catch (e) { out.run_json = e.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE'; }
  try { JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8')); out.result_json = 'PRESENT'; } catch (e) { out.result_json = e.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE'; }
  let raw; try { raw = fs.readFileSync(path.join(runDir, 'events.jsonl')); } catch (e) { out.status = 'MISSING'; return { verification: out, events: [], header }; }
  out.events_sha256 = sha256(raw);
  const text = raw.toString('utf8'); const parts = text.split('\n'); const tail = parts.pop();
  if (tail) { out.tail_bytes_discarded = Buffer.byteLength(tail); out.status = 'TRUNCATED_TAIL'; }
  const runId = header && header.run_id; let prev = null; const events = [];
  for (let i = 0; i < parts.length; i++) {
    let e; try { e = JSON.parse(parts[i]); } catch (x) { out.status = 'CORRUPT'; out.first_bad_seq = i; out.reason = 'UNPARSEABLE_LINE'; break; }
    const rid = runId || e.run_id; if (prev === null) prev = genesis(rid);
    const rec = { v: e.v, seq: e.seq, run_id: e.run_id, t_wall: e.t_wall, t_mono_ms: e.t_mono_ms, type: e.type, data: e.data, prev: e.prev };
    const bad = e.v !== 1 ? 'BAD_VERSION' : (e.seq !== i ? 'SEQ_GAP_OR_REORDER' : (e.run_id !== rid ? 'RUN_ID_MISMATCH' : (e.prev !== prev ? 'CHAIN_BREAK' : (sha256(JSON.stringify(rec)) !== e.hash ? 'HASH_MISMATCH' : null))));
    if (bad) { out.status = 'CORRUPT'; out.first_bad_seq = i; out.reason = bad; break; }
    prev = e.hash; events.push(e);
  }
  out.events_valid = events.length;
  if (out.status === 'OK' && !events.length) out.status = 'EMPTY';
  return { verification: out, events, header };
}

/** Classify ONLY from evidence. ctx.bootTimeNowMs: the machine's current (or operator-observed) boot time. */
function classify(events, ctx) {
  ctx = ctx || {};
  const of = (t) => events.filter((e) => e.type === t); const lastOf = (t) => { const a = of(t); return a.length ? a[a.length - 1] : null; };
  const start = lastOf('RUN_START'); const end = lastOf('RUN_END'); const last = events.length ? events[events.length - 1] : null;
  const facts = { events_considered: events.length, last_event_type: last ? last.type : null, last_event_at: last ? last.t_wall : null,
    last_heartbeat_at: (lastOf('HEARTBEAT') || {}).t_wall || null, last_child_event: (lastOf('CHILD_EVENT') || {}).data || null,
    child_spawned: of('CHILD_SPAWN').length, remote_channel_lost: of('REMOTE_CHANNEL_LOST').length > 0, run_end_recorded: !!end };
  const r = (outcome, basis) => ({ outcome, basis, facts });
  if (ctx.integrity === 'CORRUPT') return r('UNKNOWN', ['EVIDENCE_CORRUPT: no outcome is asserted from evidence that fails verification']);
  if (!start) return r('UNKNOWN', ['NO_RUN_START']);
  const pre = lastOf('PREFLIGHT'); if (pre && pre.data.status === 'FAIL') return r('PREFLIGHT_FAILED', ['PREFLIGHT_FAILED: child never started']);
  const spawnErr = lastOf('CHILD_SPAWN_ERROR'); const timeout = lastOf('HARNESS_TIMEOUT');
  const sig = events.filter((e) => e.type === 'PARENT_SIGNAL' && e.data.action === 'TERMINATE').pop() || null;
  facts.parent_hangup_signals = events.filter((e) => e.type === 'PARENT_SIGNAL' && e.data.signal === 'SIGHUP').length;
  const exit = lastOf('CHILD_EXIT'); const harnessErr = lastOf('HARNESS_ERROR');
  const childFailure = () => {
    if (spawnErr) return ['CHILD_SPAWN_ERROR:' + spawnErr.data.code];
    if (timeout) return ['HARNESS_TIMEOUT:' + timeout.data.timeout_ms + 'ms (child killed by harness, not retried)'];
    if (exit && (exit.data.signal || exit.data.code !== 0)) return [exit.data.signal ? 'CHILD_SIGNAL:' + exit.data.signal : 'CHILD_EXIT_CODE:' + exit.data.code];
    return null;
  };
  if (end) {
    if (sig) return r('UNKNOWN', ['PARENT_SIGNAL:' + sig.data.signal + ' (origin not determinable from the harness; not assumed to be a shutdown)']);
    if (harnessErr) return r('UNKNOWN', ['HARNESS_ERROR:' + harnessErr.data.code]);
    if (ctx.evidenceWriteError) return r('UNKNOWN', ['EVIDENCE_WRITE_ERROR:' + ctx.evidenceWriteError]);
    const cf = childFailure(); if (cf) return r('PROCESS_FAILURE', cf);
    if (exit && exit.data.code === 0) return r('COMPLETED', ['CHILD_EXIT_CODE:0']);
    return r('UNKNOWN', ['NO_CHILD_EXIT_RECORDED']);
  }
  // Incomplete: the harness stopped before writing RUN_END.
  const basis = ['RUN_END_MISSING: harness stopped after ' + (last ? last.type + '@' + last.t_wall : 'nothing')];
  const bootStart = start.data.boot_time_ms; const bootNow = ctx.bootTimeNowMs;
  if (typeof bootStart === 'number' && typeof bootNow === 'number') {
    facts.boot_time_at_start = new Date(bootStart).toISOString(); facts.boot_time_now = new Date(bootNow).toISOString(); facts.boot_time_source = ctx.bootTimeSource || null;
    if (bootNow - bootStart > BOOT_TOLERANCE_MS) {
      const lastMs = Date.parse(last.t_wall);
      if (bootNow + BOOT_TOLERANCE_MS < lastMs) return r('UNKNOWN', basis.concat(['CLOCK_INCONSISTENT: new boot time precedes the last event']));
      facts.gap_last_event_to_boot_ms = bootNow - lastMs;
      return r('OS_SHUTDOWN', basis.concat(['BOOT_TIME_CHANGED: the machine booted at ' + facts.boot_time_now + ' after the last recorded event; the run cannot have survived it']));
    }
    basis.push('BOOT_TIME_UNCHANGED');
  } else basis.push('BOOT_TIME_NOT_COMPARED');
  if (facts.remote_channel_lost) return r('REMOTE_CHANNEL_FAILURE', basis.concat(['REMOTE_CHANNEL_LOST recorded at ' + lastOf('REMOTE_CHANNEL_LOST').t_wall + ', then the harness stopped (same boot)']));
  const cf = childFailure(); if (cf) return r('PROCESS_FAILURE', basis.concat(cf));
  return r('UNKNOWN', basis.concat(['NO_CORROBORATING_EVIDENCE: cause of the stop is not determinable']));
}

function writeSums(runDir) {
  const names = ['run.json', 'events.jsonl', 'result.json'].filter((n) => fs.existsSync(path.join(runDir, n)));
  const body = names.map((n) => sha256(fs.readFileSync(path.join(runDir, n))) + '  ' + n).join('\n') + '\n';
  writeJsonAtomic(path.join(runDir, 'SHA256SUMS.json'), { algorithm: 'sha256', files: names.reduce((a, n, i) => (a[n] = body.split('\n')[i].split('  ')[0], a), {}) });
}

function killTree(child, sig) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return 'NOT_RUNNING';
  if (process.platform === 'win32') {
    const r = cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
    return r.error ? 'TASKKILL_ERROR:' + (r.error.code || 'ERROR') : 'TASKKILL_EXIT:' + r.status;
  }
  try { process.kill(-child.pid, sig); return 'GROUP_' + sig; } catch (e) { try { child.kill(sig); return 'CHILD_' + sig; } catch (x) { return 'KILL_ERROR:' + (x.code || 'ERROR'); } }
}

/** Run one child once. Resolves to { outcome, exitCode, runDir }. */
function run(o) {
  return new Promise((resolve) => {
    const runDir = path.join(o.evidenceDir, o.runId);
    if (fs.existsSync(runDir)) { resolve({ outcome: 'REFUSED_EXISTING_RUN', exitCode: EXIT.REFUSED_EXISTING_RUN, runDir }); return; }
    fs.mkdirSync(runDir, { recursive: true });
    const t0 = process.hrtime.bigint(); const startedAt = new Date().toISOString(); const bootMs = bootTimeMs();
    const header = { schema: SCHEMA, harness_version: HARNESS_VERSION, run_id: o.runId, label: o.label || null, started_at: startedAt,
      boot_time_ms: bootMs, boot_time: new Date(bootMs).toISOString(), hostname_sha256: sha256(os.hostname()).slice(0, 16), platform: process.platform,
      os_release: os.release(), node: process.versions.node, pid: process.pid, no_retry: true,
      command: { executable: path.basename(o.cmd), argc: o.args.length }, timeout_ms: o.timeoutMs, heartbeat_ms: o.heartbeatMs };
    writeJsonAtomic(path.join(runDir, 'run.json'), header);
    const log = new EvidenceLog(path.join(runDir, 'events.jsonl'), o.runId, t0);
    log.append('RUN_START', { started_at: startedAt, boot_time_ms: bootMs, harness_pid: process.pid, no_retry: true, command: header.command, label: header.label });
    let finished = false; let child = null; let hb = null; let timer = null; let hardStop = null; let channelLost = false;
    const counters = { stdout_bytes: 0, stderr_bytes: 0, stdout_lines: 0, child_events: 0, child_fields_dropped: 0, long_lines_dropped: 0 };
    let cpuPrev = os.cpus().map((c) => c.times);
    const say = (line) => { if (channelLost || !process.stdout.writable) return; try { process.stdout.write(line + '\n'); } catch (e) { onChannel(e); } };
    const onChannel = (e) => { if (channelLost) return; channelLost = true; log.append('REMOTE_CHANNEL_LOST', { code: (e && e.code) || 'STDOUT_ERROR', note: 'evidence continues on disk' }); };
    process.stdout.on('error', onChannel);
    const finish = (extra) => {
      if (finished) return; finished = true;
      clearInterval(hb); clearTimeout(timer); clearTimeout(hardStop); sigs.forEach((s) => { try { process.removeListener(s, handlers[s]); } catch (e) { /* none */ } });
      const res = classify(log.events.concat([{ type: 'RUN_END', data: {}, t_wall: new Date().toISOString() }]), { evidenceWriteError: log.writeError });
      log.append('RUN_END', Object.assign({ outcome: res.outcome, basis: res.basis, counters, fsync_errors: log.fsyncErrors, remote_channel_lost: channelLost }, extra || {}));
      log.close();
      const result = { schema: SCHEMA, run_id: o.runId, outcome: res.outcome, basis: res.basis, facts: res.facts, finished_at: new Date().toISOString(), evidence_write_error: log.writeError, fsync_errors: log.fsyncErrors };
      try { writeJsonAtomic(path.join(runDir, 'result.json'), result); writeSums(runDir); } catch (e) { /* events.jsonl remains the source of truth */ }
      say('PMH-RESULT ' + res.outcome);
      resolve({ outcome: res.outcome, exitCode: EXIT[res.outcome] === undefined ? EXIT.UNKNOWN : EXIT[res.outcome], runDir });
    };
    const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].concat(process.platform === 'win32' ? ['SIGBREAK'] : []); const handlers = {};
    // SIGHUP is a hang-up of the controlling channel: record it and KEEP RUNNING (evidence stays on disk). On Windows the
    // same signal is also raised for console close/logoff/shutdown — it is recorded, never interpreted as a shutdown.
    sigs.forEach((s) => { handlers[s] = () => {
      if (s === 'SIGHUP') { log.append('PARENT_SIGNAL', { signal: s, action: 'CONTINUE' }); return; }
      if (hardStop) return;
      log.append('PARENT_SIGNAL', { signal: s, action: 'TERMINATE', child_kill: killTree(child, 'SIGTERM') });
      hardStop = setTimeout(() => { killTree(child, 'SIGKILL'); finish({ child_terminated_by: 'PARENT_SIGNAL' }); }, o.killGraceMs);
    }; process.on(s, handlers[s]); });
    const pf = preflight({ dir: runDir, minFreeDiskBytes: o.minFreeDiskBytes, minFreeMemBytes: o.minFreeMemBytes, minUptimeS: o.minUptimeS, failOnWarn: o.failOnWarn });
    log.append('PREFLIGHT', pf);
    if (pf.status === 'FAIL') { finish({ child_spawned: false }); return; }
    const spawnedAt = process.hrtime.bigint();
    try {
      child = cp.spawn(o.cmd, o.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', env: process.env });
    } catch (e) { log.append('CHILD_SPAWN_ERROR', { code: e.code || 'ERROR' }); finish({ child_spawned: false }); return; }
    let spawnLogged = false;
    child.on('spawn', () => { spawnLogged = true; log.append('CHILD_SPAWN', { pid: child.pid, attempt: 1, max_attempts: 1 }); say('PMH-STARTED ' + o.runId); });
    child.on('error', (e) => { log.append(spawnLogged ? 'CHILD_ERROR' : 'CHILD_SPAWN_ERROR', { code: e.code || 'ERROR' }); if (!spawnLogged) finish({ child_spawned: false }); });
    let buf = '';
    child.stdout.on('data', (d) => {
      counters.stdout_bytes += d.length; buf += d.toString('utf8');
      let i; while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); counters.stdout_lines++;
        if (line.length > MAX_LINE) { counters.long_lines_dropped++; continue; }
        if (line.indexOf(CHILD_EVENT_PREFIX) === 0) { const s = sanitizeChildEvent(line); counters.child_fields_dropped += s.dropped; if (s.event) { counters.child_events++; log.append('CHILD_EVENT', s.event); } }
      }
      if (buf.length > MAX_LINE) { counters.long_lines_dropped++; buf = ''; }
    });
    child.stderr.on('data', (d) => { counters.stderr_bytes += d.length; });
    child.on('exit', (code, signal) => { log.append('CHILD_EXIT', { code, signal, elapsed_ms: Number((process.hrtime.bigint() - spawnedAt) / 1000000n), stdout_bytes: counters.stdout_bytes, stderr_bytes: counters.stderr_bytes }); });
    child.on('close', () => { if (!hardStop) finish(); });
    timer = setTimeout(() => { if (hardStop) return; log.append('HARNESS_TIMEOUT', { timeout_ms: o.timeoutMs, child_kill: killTree(child, 'SIGTERM') }); hardStop = setTimeout(() => { killTree(child, 'SIGKILL'); finish({ child_terminated_by: 'HARNESS_TIMEOUT' }); }, o.killGraceMs); }, o.timeoutMs);
    hb = setInterval(() => {
      const now = os.cpus().map((c) => c.times); let busy = 0; let total = 0;
      now.forEach((t, k) => { const p = cpuPrev[k] || t; const d = (x) => t[x] - p[x]; const tt = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); total += tt; busy += tt - d('idle'); }); cpuPrev = now;
      const ru = process.resourceUsage();
      const data = { os_uptime_s: Math.round(os.uptime()), free_memory_bytes: os.freemem(), system_cpu_busy_pct: total ? Math.round((busy / total) * 1000) / 10 : null,
        harness_rss_bytes: process.memoryUsage().rss, harness_cpu_user_ms: Math.round(ru.userCPUTime / 1000), harness_cpu_system_ms: Math.round(ru.systemCPUTime / 1000),
        child_alive: !!(child && child.exitCode === null && child.signalCode === null), stdout_bytes: counters.stdout_bytes, stderr_bytes: counters.stderr_bytes, child_metrics: childMetrics(child) };
      log.append('HEARTBEAT', data); say('PMH-HEARTBEAT ' + log.seq);
    }, o.heartbeatMs);
    process.on('uncaughtException', (e) => { log.append('HARNESS_ERROR', { code: (e && (e.code || e.name)) || 'ERROR' }); killTree(child, 'SIGKILL'); finish(); });
  });
}
/** Child CPU/RSS where the OS exposes it without spawning tools (Linux /proc). Elsewhere: explicitly UNAVAILABLE. */
function childMetrics(child) {
  if (!child || !child.pid || child.exitCode !== null) return { status: 'NOT_RUNNING' };
  if (process.platform !== 'linux') return { status: 'UNAVAILABLE_ON_PLATFORM' };
  try {
    const st = fs.readFileSync('/proc/' + child.pid + '/stat', 'utf8'); const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const hz = 100; return { status: 'OK', cpu_user_ms: Math.round(Number(f[11]) * 1000 / hz), cpu_system_ms: Math.round(Number(f[12]) * 1000 / hz), rss_bytes: Number(f[21]) * 4096 };
  } catch (e) { return { status: 'UNAVAILABLE:' + (e.code || 'ERROR') }; }
}

/** Offline recovery of an interrupted (or complete) run. Writes a new recovery file; never touches original evidence. */
function recover(runDir, o) {
  o = o || {};
  const v = verify(runDir);
  let bootNow = null; let source = null;
  if (o.observedBootTime) { bootNow = Date.parse(o.observedBootTime); source = 'OPERATOR_OBSERVED'; if (!Number.isFinite(bootNow)) throw Object.assign(new Error('bad --observed-boot-time'), { code: 'USAGE' }); }
  else if (o.sameMachine !== false) { bootNow = typeof o.bootTimeNowMs === 'number' ? o.bootTimeNowMs : bootTimeMs(); source = 'THIS_MACHINE_NOW'; }
  const integrity = v.verification.status === 'CORRUPT' ? 'CORRUPT' : v.verification.status;
  const res = classify(v.events, { integrity, bootTimeNowMs: bootNow, bootTimeSource: source });
  const report = { schema: SCHEMA, kind: 'RECOVERY', recovered_at: new Date().toISOString(), harness_version: HARNESS_VERSION, verification: v.verification,
    outcome: res.outcome, basis: res.basis, facts: res.facts, retry_performed: false };
  const file = path.join(runDir, 'recovery-' + new Date().toISOString().replace(/[:.]/g, '') + '-' + crypto.randomBytes(2).toString('hex') + '.json');
  writeJsonAtomic(file, report);
  return Object.assign({ file }, report);
}

function parseArgs(argv) {
  const sep = argv.indexOf('--'); const head = sep === -1 ? argv : argv.slice(0, sep); const tail = sep === -1 ? [] : argv.slice(sep + 1);
  const flag = (n) => { const i = head.indexOf(n); return i === -1 ? null : head[i + 1]; }; const has = (n) => head.indexOf(n) !== -1;
  const num = (n, d) => { const v = flag(n); if (v === null) return d; const x = Number(v); if (!Number.isFinite(x) || x < 0) throw Object.assign(new Error('bad ' + n), { code: 'USAGE' }); return x; };
  return { cmd: head[0], flag, has, num, tail };
}

async function main(argv) {
  let a; try { a = parseArgs(argv); } catch (e) { console.error(e.message); return EXIT.USAGE; }
  const print = (o) => console.log(JSON.stringify(o, null, 2));
  try {
    if (a.cmd === 'preflight') { const dir = a.flag('--evidence-dir'); if (!dir) throw Object.assign(new Error('--evidence-dir required'), { code: 'USAGE' });
      const r = preflight({ dir, minFreeDiskBytes: a.num('--min-free-disk-bytes', DEFAULTS.minFreeDiskBytes), minFreeMemBytes: a.num('--min-free-mem-bytes', DEFAULTS.minFreeMemBytes), minUptimeS: a.num('--min-uptime-s', DEFAULTS.minUptimeS), failOnWarn: a.has('--fail-on-warn') });
      print(r); return r.status === 'FAIL' ? EXIT.PREFLIGHT_FAILED : 0; }
    if (a.cmd === 'verify') { const d = a.flag('--run-dir'); if (!d) throw Object.assign(new Error('--run-dir required'), { code: 'USAGE' }); const v = verify(d); print(v.verification); return v.verification.status === 'OK' ? 0 : 1; }
    if (a.cmd === 'recover') { const d = a.flag('--run-dir'); if (!d) throw Object.assign(new Error('--run-dir required'), { code: 'USAGE' });
      const r = recover(d, { observedBootTime: a.flag('--observed-boot-time'), sameMachine: !a.has('--other-machine') }); print(r); return 0; }
    if (a.cmd === 'run') {
      const evidenceDir = a.flag('--evidence-dir'); const runId = a.flag('--run-id'); const label = a.flag('--label');
      if (!evidenceDir || !runId || !RUN_ID_RE.test(runId) || !a.tail.length || (label !== null && (!LABEL_RE.test(label) || looksSecret(label)))) throw Object.assign(new Error('usage: run --evidence-dir D --run-id [A-Za-z0-9_.-]{1,64} [--label L] -- cmd args...'), { code: 'USAGE' });
      const r = await run({ evidenceDir, runId, label, cmd: a.tail[0], args: a.tail.slice(1), timeoutMs: a.num('--timeout-ms', DEFAULTS.timeoutMs), heartbeatMs: Math.max(50, a.num('--heartbeat-ms', DEFAULTS.heartbeatMs)),
        killGraceMs: a.num('--kill-grace-ms', DEFAULTS.killGraceMs), minFreeDiskBytes: a.num('--min-free-disk-bytes', DEFAULTS.minFreeDiskBytes), minFreeMemBytes: a.num('--min-free-mem-bytes', DEFAULTS.minFreeMemBytes),
        minUptimeS: a.num('--min-uptime-s', DEFAULTS.minUptimeS), failOnWarn: a.has('--fail-on-warn') });
      if (r.outcome === 'REFUSED_EXISTING_RUN') console.error('refused: run directory already exists (no retry, no overwrite): ' + r.runDir);
      return r.exitCode;
    }
    console.error('usage: resilientHarness.js preflight|run|verify|recover ...'); return EXIT.USAGE;
  } catch (e) { console.error(e.code === 'USAGE' ? e.message : 'harness error: ' + (e.code || e.name)); return e.code === 'USAGE' ? EXIT.USAGE : EXIT.UNKNOWN; }
}

module.exports = { preflight, verify, classify, recover, run, sanitizeChildEvent, safeValue, EvidenceLog, genesis, OUTCOMES, EXIT, CHILD_EVENT_PREFIX, BOOT_TOLERANCE_MS, SCHEMA };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
