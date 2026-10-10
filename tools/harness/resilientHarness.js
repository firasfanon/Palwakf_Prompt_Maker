#!/usr/bin/env node
'use strict';
/**
 * Resilient test harness (GFPI_RESILIENT_TEST_HARNESS_CANDIDATE_V1, minimal repair V2) — TEST TOOLING ONLY.
 *
 * Runs ONE child command exactly once and keeps verifiable evidence that survives a sudden stop of the harness, the
 * child, the remote channel or the operating system:
 *  - events.jsonl: append-only, one JSON event per line, fsync after every line, SHA-256 hash chain (prev -> hash),
 *    contiguous seq. Written as the run progresses (never only at the end), so a power-off loses at most the line
 *    being written (detected as TRUNCATED_TAIL).
 *  - run.json (header, atomic), result.json (outcome, atomic, only when the harness finishes, bound to events.jsonl by
 *    its SHA-256 and the RUN_END seq), SHA256SUMS.json (covers run.json, events.jsonl, result.json).
 *  - recovery-*.json: written by `recover` after an interruption; the original evidence is never rewritten.
 *
 * FAIL-CLOSED DURABILITY: every evidence write is CHECKED WRITE-ALL (a short write is continued until every byte is
 * written; a zero, negative, oversized or non-integer byte count is a failure) and every evidence close is checked. A
 * failed write, fsync or close of any evidence (event line, atomic JSON file, directory entry) is never ignored. The log stops accepting events, the child is killed, the outcome is UNKNOWN with
 * EVIDENCE_DURABILITY_FAILED and the harness exits 8 (EVIDENCE_FAILURE) — never 0.
 *
 * Outcomes are classified only from recorded evidence:
 *  COMPLETED | PROCESS_FAILURE | REMOTE_CHANNEL_FAILURE | OS_SHUTDOWN | UNKNOWN  (+ PREFLIGHT_FAILED: child never started)
 *  OS_SHUTDOWN requires a boot time that changed beyond tolerance, moved forward, is not in the future, and is strictly
 *  AFTER the last recorded event (a boot at or before the last event is contradicted by that event). REMOTE_CHANNEL_FAILURE
 *  requires a recorded channel loss on the same boot. Anything not supported by evidence is UNKNOWN — a parent signal
 *  (e.g. SIGHUP/SIGBREAK on Windows) alone is NOT treated as a shutdown.
 *
 * NO RETRY: the child is spawned at most once; an existing run directory is never reused or overwritten.
 * NO SECRETS: the harness never records argv values, environment, stdin, child stdout/stderr content or exception
 * messages. The child may report progress on stdout as `PMH-EVENT {json}`; each allow-listed key has its own typed
 * value rule (closed status enum, identifier tokens without lower case, bounded integers, failure HRESULTs) and any
 * value equal to — or containing, even when short (>= 4 alphanumerics) and split by separators — a value of the child's
 * environment or argv is dropped (see sanitizeChildEvent).
 * This module does not touch DPAPI, credentials or any provider.
 *
 * Usage:
 *   node tools/harness/resilientHarness.js preflight --evidence-dir D [--strict-readiness]
 *   node tools/harness/resilientHarness.js run --evidence-dir D --run-id ID [--label L] [--timeout-ms N]
 *        [--heartbeat-ms N] [--min-free-disk-bytes N] [--min-free-mem-bytes N] [--min-uptime-s N] [--strict-readiness] -- cmd args...
 *   node tools/harness/resilientHarness.js verify  --run-dir D/ID
 *   node tools/harness/resilientHarness.js recover --run-dir D/ID [--observed-boot-time ISO]
 * On Windows the readiness gate is always STRICT (every WARN or UNAVAILABLE check blocks the run).
 * `--fail-on-warn` is kept as an alias of `--strict-readiness`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const HARNESS_VERSION = '1.2.0';
const SCHEMA = 'PmResilientHarnessEventV1';
const OUTCOMES = ['COMPLETED', 'PROCESS_FAILURE', 'REMOTE_CHANNEL_FAILURE', 'OS_SHUTDOWN', 'UNKNOWN', 'PREFLIGHT_FAILED'];
const EXIT = { COMPLETED: 0, PROCESS_FAILURE: 1, USAGE: 2, UNKNOWN: 3, PREFLIGHT_FAILED: 4, REFUSED_EXISTING_RUN: 5, REMOTE_CHANNEL_FAILURE: 6, OS_SHUTDOWN: 7, EVIDENCE_FAILURE: 8 };
const BOOT_TOLERANCE_MS = 120000; // boot time = now - uptime has jitter; a change smaller than this is not a reboot
const DEFAULTS = { heartbeatMs: 5000, timeoutMs: 600000, killGraceMs: 2000, minFreeDiskBytes: 256 * 1024 * 1024, minFreeMemBytes: 256 * 1024 * 1024, minUptimeS: 120 };
const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const LABEL_RE = /^[A-Za-z0-9_.:\- ]{1,80}$/;
const CHILD_EVENT_PREFIX = 'PMH-EVENT ';
const MAX_LINE = 4096;
const EVIDENCE_FILES = ['run.json', 'events.jsonl', 'result.json'];
// Second line of defence only (values must already pass the typed rules to survive). Mirrors tools/secretScan.js.
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/, /\beyJ[A-Za-z0-9_-]{15,}\./, /:\/\/[^\s\/:@]+:[^\s\/@]{3,}@/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/];

// ---- child progress value rules (per key; anything else is dropped and only counted) ----
const STATUS_ENUM = ['OK', 'PASS', 'FAIL', 'FAILED', 'ERROR', 'SUCCESS', 'SKIPPED', 'STARTED', 'RUNNING', 'DONE', 'TIMEOUT', 'REFUSED',
  'DENIED', 'CANCELLED', 'PENDING', 'UNKNOWN', 'UNAVAILABLE', 'NOT_APPLICABLE'];
// Identifier token: an upper-case word of letters (>= 2), then up to 6 `_SEGMENT`s; never lower case, never a leading digit.
const TOKEN_RE = /^[A-Z]{2,24}(?:_[A-Z0-9]{1,24}){0,6}$/;
// HRESULT: failure codes (severity bit set) or S_OK only.
const HRESULT_RE = /^0x(?:[89A-F][0-9A-F]{7}|0{8})$/;
const CHILD_EVENT_RULES = {
  stage: { kind: 'token' }, op: { kind: 'token' }, code: { kind: 'token' },
  status: { kind: 'enum' }, result: { kind: 'enum' },
  hresult: { kind: 'hresult' },
  elapsed_ms: { kind: 'int', min: 0, max: 7 * 24 * 3600 * 1000 }, iteration: { kind: 'int', min: 0, max: 1000000 },
  depth: { kind: 'int', min: 0, max: 64 }, exit_code: { kind: 'int', min: -2147483648, max: 4294967295 }
};
const CHILD_EVENT_KEYS = Object.keys(CHILD_EVENT_RULES);
// Sensitive matching works on the ALPHANUMERIC form (upper case, every other character removed), so separators cannot
// hide a secret: env 'ab-12' matches token 'AB_12'; argv '--otp=7319' matches 'STEP_7319' and 173190.
const SENSITIVE_MIN_EQUAL = 3; // an env/argv value with >= 3 alphanumerics is never stored as a child event value
const SENSITIVE_MIN_EMBED = 4; // ... and any value that CONTAINS one with >= 4 alphanumerics is dropped too (PIN, short password)
const alnum = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const genesis = (runId) => sha256('PMH-GENESIS:' + runId);
const looksSecret = (s) => SECRET_PATTERNS.some((re) => re.test(s));
const monoMs = (t0) => Number((process.hrtime.bigint() - t0) / 1000000n);
const bootTimeMs = () => Date.now() - Math.round(os.uptime() * 1000);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Durable-write primitives. Indirected ONLY so tests can inject write/fsync faults in-process (S17); there is no CLI or
 * environment switch for it.
 */
const io = { writeSync: (fd, buf, off, len) => fs.writeSync(fd, buf, off, len), fsyncSync: (fd) => fs.fsyncSync(fd), closeSync: (fd) => fs.closeSync(fd) };
/**
 * CHECKED WRITE-ALL: writes every byte of `data` or throws. A short write is continued from where it stopped; a byte
 * count that is not a positive integer no larger than what remains (0 = no progress) is a failure, never a retry loop.
 */
function writeAll(fd, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let off = 0;
  while (off < buf.length) {
    const n = io.writeSync(fd, buf, off, buf.length - off);
    if (n === 0) throw Object.assign(new Error('write made no progress'), { code: 'ZERO_WRITE' });
    if (!Number.isInteger(n) || n < 0 || n > buf.length - off) throw Object.assign(new Error('impossible write count'), { code: 'BAD_WRITE_COUNT' });
    off += n;
  }
  return off;
}
function durabilityError(where, e) {
  return Object.assign(new Error('evidence durability failure'), { code: 'EVIDENCE_DURABILITY', where, cause: (e && (e.code || e.name)) || 'ERROR' });
}
const describeFailure = (e) => (e && e.code === 'EVIDENCE_DURABILITY' ? e.where + '_FAILED:' + e.cause : 'HARNESS_IO_FAILED:' + ((e && (e.code || e.name)) || 'ERROR'));

/**
 * Sensitive candidates for one run: the child's environment values and argv values (and `--k=v` right-hand sides),
 * upper-cased. Kept in memory only, never written.
 */
function buildSensitiveSet(env, args) {
  const set = new Set();
  const add = (s) => { if (typeof s !== 'string') return; const t = alnum(s); if (t.length >= SENSITIVE_MIN_EQUAL) set.add(t); };
  Object.keys(env || {}).forEach((k) => add(env[k]));
  (args || []).forEach((a) => { add(a); const i = typeof a === 'string' ? a.indexOf('=') : -1; if (i !== -1) add(a.slice(i + 1)); });
  return set;
}
function matchesSensitive(str, sensitive) {
  if (!sensitive || !sensitive.size) return false;
  const u = alnum(str); if (sensitive.has(u)) return true;
  for (const s of sensitive) if (s.length >= SENSITIVE_MIN_EMBED && u.indexOf(s) !== -1) return true;
  return false;
}
/** A value survives only if it satisfies its key's typed rule and is not a value of the child's env/argv. */
function safeValue(key, v, sensitive) {
  const rule = CHILD_EVENT_RULES[key]; if (!rule) return undefined;
  if (rule.kind === 'int') {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < rule.min || v > rule.max) return undefined;
    return matchesSensitive(String(v), sensitive) ? undefined : v;
  }
  if (typeof v !== 'string' || looksSecret(v)) return undefined;
  let ok = false;
  if (rule.kind === 'enum') ok = STATUS_ENUM.indexOf(v) !== -1;
  else if (rule.kind === 'token') ok = v.length <= 64 && TOKEN_RE.test(v);
  else if (rule.kind === 'hresult') ok = HRESULT_RE.test(v);
  if (!ok) return undefined;
  // closed enum values cannot carry a secret; tokens and HRESULTs are also checked against the child's env/argv
  return rule.kind !== 'enum' && matchesSensitive(v, sensitive) ? undefined : v;
}
/** Child progress line -> { event, dropped } ; unknown keys and values failing their rule are dropped (counted, not stored). */
function sanitizeChildEvent(line, sensitive) {
  let obj; try { obj = JSON.parse(line.slice(CHILD_EVENT_PREFIX.length)); } catch (e) { return { event: null, dropped: 1 }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { event: null, dropped: 1 };
  const event = {}; let dropped = 0;
  Object.keys(obj).forEach((k) => { const v = safeValue(k, obj[k], sensitive); if (v === undefined) dropped++; else event[k] = v; });
  return { event: Object.keys(event).length ? event : null, dropped };
}

/** tmp + write + fsync + rename + directory fsync. Throws EVIDENCE_DURABILITY on any failure (the tmp file is removed). */
function writeJsonAtomic(file, obj) {
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try { writeAll(fd, JSON.stringify(obj, null, 2) + '\n'); } catch (e) { closeQuiet(fd); unlinkQuiet(tmp); throw durabilityError('ATOMIC_WRITE', e); }
  try { io.fsyncSync(fd); } catch (e) { closeQuiet(fd); unlinkQuiet(tmp); throw durabilityError('ATOMIC_FSYNC', e); }
  try { io.closeSync(fd); } catch (e) { unlinkQuiet(tmp); throw durabilityError('ATOMIC_CLOSE', e); }
  try { fs.renameSync(tmp, file); } catch (e) { unlinkQuiet(tmp); throw durabilityError('ATOMIC_RENAME', e); }
  fsyncDir(path.dirname(file));
}
/**
 * fsync a directory so a create/rename is durable. Throws on failure. Windows cannot open a directory for fsync from
 * Node; there the rename is covered by the NTFS metadata journal and the limitation is recorded in run.json.
 */
function fsyncDir(dir) {
  if (process.platform === 'win32') return 'NOT_SUPPORTED_ON_WIN32';
  let fd;
  try { fd = fs.openSync(dir, 'r'); io.fsyncSync(fd); } catch (e) { if (fd !== undefined) closeQuiet(fd); throw durabilityError('DIR_FSYNC', e); }
  try { io.closeSync(fd); } catch (e) { throw durabilityError('DIR_CLOSE', e); }
  return 'OK';
}
function closeQuiet(fd) { try { fs.closeSync(fd); } catch (e) { /* already closed */ } }
function unlinkQuiet(f) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }

/**
 * Append-only hash-chained event log; every append is written and fsync'ed before returning. FAIL-CLOSED: the first
 * write or fsync failure is latched in `failure`, every later append is refused (returns null) and `onFail` is called
 * once (asynchronously) so the run can stop. An event whose fsync failed is NOT counted as recorded.
 */
class EvidenceLog {
  constructor(file, runId, t0, onFail) {
    this.file = file; this.runId = runId; this.t0 = t0; this.seq = 0; this.prev = genesis(runId);
    this.failure = null; this.onFail = onFail || null; this.events = [];
    this.fd = fs.openSync(file, 'ax'); // fails if the file exists: never append to another run's evidence
    fsyncDir(path.dirname(file));
  }
  append(type, data) {
    if (this.failure || this.fd === null) return null;
    const rec = { v: 1, seq: this.seq, run_id: this.runId, t_wall: new Date().toISOString(), t_mono_ms: monoMs(this.t0), type, data: data || {}, prev: this.prev };
    const hash = sha256(JSON.stringify(rec)); const full = Object.assign({}, rec, { hash });
    try { writeAll(this.fd, JSON.stringify(full) + '\n'); } catch (e) { return this.fail('EVENT_WRITE', e); }
    try { io.fsyncSync(this.fd); } catch (e) { return this.fail('EVENT_FSYNC', e); }
    this.prev = hash; this.seq++; this.events.push(full); return full;
  }
  fail(where, e) {
    this.failure = where + '_FAILED:' + ((e && (e.code || e.name)) || 'ERROR');
    const cb = this.onFail; this.onFail = null; if (cb) setImmediate(() => cb(this.failure));
    return null;
  }
  /** Checked close: a close error (e.g. a deferred write error) latches EVENT_CLOSE_FAILED. Returns the failure, if any. */
  close() {
    if (this.fd === null) return this.failure;
    const fd = this.fd; this.fd = null;
    try { io.closeSync(fd); } catch (e) { if (!this.failure) this.failure = 'EVENT_CLOSE_FAILED:' + ((e && (e.code || e.name)) || 'ERROR'); }
    return this.failure;
  }
}

/** Default read-only registry probe (Windows). Exit 0 = key/value present, 1 = absent; anything else = unavailable. */
function realRegQuery(args) {
  const r = cp.spawnSync('reg', ['query'].concat(args), { windowsHide: true, timeout: 10000, stdio: 'ignore' });
  return { status: r.status, signal: r.signal || null, error: r.error ? (r.error.code || 'ERROR') : null };
}
const PENDING_REBOOT_QUERIES = {
  windows_update_reboot_required: ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'],
  cbs_reboot_pending: ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'],
  pending_file_rename_operations: ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager', '/v', 'PendingFileRenameOperations']
};

/**
 * Read-only readiness checks. FAIL always blocks the run. The gate is STRICT on Windows (always) or when asked
 * (--strict-readiness / --fail-on-warn): then every WARN — including any check whose value is UNAVAILABLE — blocks too.
 * o.platform / o.regQuery exist only so the Windows gate can be tested off-Windows.
 */
function preflight(o) {
  const platform = o.platform || process.platform;
  const strict = platform === 'win32' || !!o.strict || !!o.failOnWarn;
  const checks = []; const add = (name, status, value, threshold) => checks.push({ name, status, value: value === undefined ? null : value, threshold: threshold === undefined ? null : threshold });
  const major = Number(process.versions.node.split('.')[0]);
  add('node_version', major >= 18 ? 'PASS' : 'FAIL', process.versions.node, '>=18');
  add('platform', 'INFO', platform + '/' + process.arch + '/' + os.release());
  try {
    fs.mkdirSync(o.dir, { recursive: true });
    const probe = path.join(o.dir, '.pmh-preflight-' + crypto.randomBytes(4).toString('hex'));
    const fd = fs.openSync(probe, 'wx'); fs.writeSync(fd, 'probe'); fs.fsyncSync(fd); fs.closeSync(fd);
    const ok = fs.readFileSync(probe, 'utf8') === 'probe'; fs.unlinkSync(probe);
    add('evidence_dir_writable_fsync', ok ? 'PASS' : 'FAIL', ok);
  } catch (e) { add('evidence_dir_writable_fsync', 'FAIL', e.code || 'ERROR'); }
  if (process.platform !== 'win32') {
    try { const fd = fs.openSync(o.dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } add('evidence_dir_entry_fsync', 'PASS', true); }
    catch (e) { add('evidence_dir_entry_fsync', 'FAIL', e.code || 'ERROR'); }
  } else add('evidence_dir_entry_fsync', 'INFO', 'NOT_SUPPORTED_ON_WIN32');
  if (typeof fs.statfsSync === 'function') {
    try { const s = fs.statfsSync(o.dir); const free = Number(s.bavail) * Number(s.bsize); add('disk_free_bytes', free >= o.minFreeDiskBytes ? 'PASS' : 'FAIL', free, o.minFreeDiskBytes); } catch (e) { add('disk_free_bytes', 'WARN', 'UNAVAILABLE:' + (e.code || 'ERROR'), o.minFreeDiskBytes); }
  } else add('disk_free_bytes', 'WARN', 'UNAVAILABLE', o.minFreeDiskBytes);
  const mem = os.freemem(); add('free_memory_bytes', mem >= o.minFreeMemBytes ? 'PASS' : 'FAIL', mem, o.minFreeMemBytes);
  const up = Math.round(os.uptime()); add('os_uptime_s', up >= o.minUptimeS ? 'PASS' : 'WARN', up, o.minUptimeS);
  add('boot_time', 'INFO', new Date(bootTimeMs()).toISOString());
  if (platform !== 'win32') add('load_average_1m', 'INFO', Math.round(os.loadavg()[0] * 100) / 100);
  const outOk = !!(process.stdout && process.stdout.writable);
  add('channel_stdout_writable', outOk ? 'PASS' : 'FAIL', outOk); add('channel_stdout_is_tty', 'INFO', !!(process.stdout && process.stdout.isTTY));
  if (platform === 'win32') {
    // Read-only registry queries (no configuration change). A pending reboot means Windows may stop the run: FAIL.
    // A query that cannot be answered is not evidence of "no pending reboot": WARN, which the strict gate turns into FAIL.
    const q = o.regQuery || realRegQuery;
    Object.keys(PENDING_REBOOT_QUERIES).forEach((k) => {
      let r; try { r = q(PENDING_REBOOT_QUERIES[k]) || {}; } catch (e) { r = { error: e.code || 'ERROR' }; }
      if (r.error) add(k, 'WARN', 'UNAVAILABLE:' + r.error);
      else if (r.signal) add(k, 'WARN', 'UNAVAILABLE:SIGNAL_' + r.signal);
      else if (r.status === 0) add(k, 'FAIL', 'PRESENT');
      else if (r.status === 1) add(k, 'PASS', 'ABSENT');
      else add(k, 'WARN', 'UNAVAILABLE:EXIT_' + r.status);
    });
  } else add('windows_pending_reboot', 'NOT_APPLICABLE');
  if (strict) checks.forEach((c) => { if (c.status === 'WARN') { c.status = 'FAIL'; c.strict_gate = true; } });
  const status = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : (checks.some((c) => c.status === 'WARN') ? 'WARN' : 'PASS');
  return { status, gate: strict ? 'STRICT' : 'STANDARD', checks };
}

/**
 * Verify a run's evidence without trusting it. Never modifies anything. Checks:
 *  - events.jsonl: hash chain, seq, run id, torn tail;
 *  - run.json: present, parseable, run id and boot time equal to RUN_START;
 *  - SHA256SUMS.json: every evidence file present is listed and matches; every listed file exists;
 *    a finished run (result.json present) must have it;
 *  - result.json: bound to events.jsonl (sha256, RUN_END seq = last event) and its outcome/basis equal RUN_END's.
 * Any failure is CORRUPT with a reason (no outcome is asserted from such evidence).
 */
function verify(runDir) {
  const out = { run_dir_name: path.basename(runDir), status: 'OK', events_valid: 0, first_bad_seq: null, reason: null, tail_bytes_discarded: 0,
    run_json: null, result_json: null, sha256sums: null, events_sha256: null, file_sha256: {}, unexpected_files: [], evidence_failure: null };
  const corrupt = (reason) => { if (out.status !== 'CORRUPT') { out.status = 'CORRUPT'; out.reason = reason; } };
  const readJson = (n) => { const p = path.join(runDir, n); let raw; try { raw = fs.readFileSync(p); } catch (e) { return { state: e.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE' }; }
    out.file_sha256[n] = sha256(raw); try { return { state: 'PRESENT', obj: JSON.parse(raw.toString('utf8')) }; } catch (e) { return { state: 'UNPARSEABLE' }; } };
  const hj = readJson('run.json'); out.run_json = hj.state; const header = hj.obj || null;
  const rj = readJson('result.json'); out.result_json = rj.state; const result = rj.obj || null;
  const sj = readJson('SHA256SUMS.json'); out.sha256sums = sj.state;
  try { fs.readdirSync(runDir).forEach((n) => { if (EVIDENCE_FILES.indexOf(n) === -1 && n !== 'SHA256SUMS.json' && !/^recovery-[0-9A-Za-z-]+\.json$/.test(n)) out.unexpected_files.push(n); }); } catch (e) { /* reported below */ }
  let raw; try { raw = fs.readFileSync(path.join(runDir, 'events.jsonl')); } catch (e) { out.status = 'MISSING'; return { verification: out, events: [], header }; }
  out.events_sha256 = sha256(raw); out.file_sha256['events.jsonl'] = out.events_sha256;
  const text = raw.toString('utf8'); const parts = text.split('\n'); const tail = parts.pop();
  if (tail) { out.tail_bytes_discarded = Buffer.byteLength(tail); out.status = 'TRUNCATED_TAIL'; }
  const runId = header && header.run_id; let prev = null; const events = [];
  for (let i = 0; i < parts.length; i++) {
    let e; try { e = JSON.parse(parts[i]); } catch (x) { corrupt('UNPARSEABLE_LINE'); out.first_bad_seq = i; break; }
    const rid = runId || e.run_id; if (prev === null) prev = genesis(rid);
    const rec = { v: e.v, seq: e.seq, run_id: e.run_id, t_wall: e.t_wall, t_mono_ms: e.t_mono_ms, type: e.type, data: e.data, prev: e.prev };
    const bad = e.v !== 1 ? 'BAD_VERSION' : (e.seq !== i ? 'SEQ_GAP_OR_REORDER' : (e.run_id !== rid ? 'RUN_ID_MISMATCH' : (e.prev !== prev ? 'CHAIN_BREAK' : (sha256(JSON.stringify(rec)) !== e.hash ? 'HASH_MISMATCH' : null))));
    if (bad) { corrupt(bad); out.first_bad_seq = i; break; }
    prev = e.hash; events.push(e);
  }
  out.events_valid = events.length;
  if (out.status === 'CORRUPT') return { verification: out, events, header };
  // run.json <-> events
  if (hj.state === 'UNPARSEABLE' || hj.state === 'UNREADABLE') corrupt('RUN_JSON_' + hj.state);
  else if (header) {
    const start = events.find((e) => e.type === 'RUN_START');
    // (run.json's run_id is already enforced on every event by the chain check above: RUN_ID_MISMATCH)
    if (start && header.boot_time_ms !== start.data.boot_time_ms) corrupt('RUN_JSON_INCONSISTENT:boot_time_ms');
  }
  // SHA256SUMS.json
  if (sj.state === 'PRESENT') {
    const files = (sj.obj && sj.obj.files) || {};
    if (!sj.obj || sj.obj.algorithm !== 'sha256' || typeof files !== 'object') corrupt('SUMS_MALFORMED');
    EVIDENCE_FILES.forEach((n) => {
      const present = out.file_sha256[n] !== undefined;
      if (present && files[n] === undefined) corrupt('SUMS_UNLISTED:' + n);
      else if (!present && files[n] !== undefined) corrupt('SUMS_LISTED_FILE_MISSING:' + n);
      else if (present && files[n] !== out.file_sha256[n]) corrupt('SUMS_MISMATCH:' + n);
    });
  } else if (sj.state !== 'MISSING') corrupt('SUMS_' + sj.state);
  else if (rj.state !== 'MISSING') corrupt('SUMS_MISSING_FOR_FINISHED_RUN');
  // result.json <-> events
  if (rj.state === 'UNPARSEABLE' || rj.state === 'UNREADABLE') corrupt('RESULT_' + rj.state);
  else if (result) {
    out.evidence_failure = result.evidence_failure || null;
    const last = events[events.length - 1]; const runEnd = events.filter((e) => e.type === 'RUN_END').pop() || null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (header && result.run_id !== header.run_id) corrupt('RESULT_INCONSISTENT:run_id');
    else if (result.events_sha256 !== out.events_sha256) corrupt('RESULT_INCONSISTENT:events_sha256');
    else if (result.evidence_failure) {
      // fail-closed run: never a positive outcome; RUN_END is referenced exactly when it was durably recorded
      if (result.outcome !== 'UNKNOWN') corrupt('RESULT_INCONSISTENT:evidence_failure_outcome');
      else if (runEnd ? (result.run_end_seq !== runEnd.seq || last !== runEnd) : (result.run_end_seq !== null && result.run_end_seq !== undefined)) corrupt('RESULT_INCONSISTENT:run_end_seq');
    } else if (result.run_end_seq === null || result.run_end_seq === undefined) {
      corrupt(runEnd ? 'RESULT_INCONSISTENT:run_end_not_referenced' : 'RESULT_INCONSISTENT:outcome_without_run_end');
    } else if (!runEnd || runEnd.seq !== result.run_end_seq || last !== runEnd) corrupt('RESULT_INCONSISTENT:run_end_seq');
    else if (result.outcome !== runEnd.data.outcome) corrupt('RESULT_INCONSISTENT:outcome');
    else if (!same(result.basis, runEnd.data.basis)) corrupt('RESULT_INCONSISTENT:basis');
  }
  if (out.status === 'OK' && !events.length) out.status = 'EMPTY';
  return { verification: out, events, header };
}

/**
 * Classify ONLY from evidence. ctx.bootTimeNowMs: the machine's current (or operator-observed) boot time;
 * ctx.nowMs: the time of the classification (default: now) — injectable so tests do not depend on the clock.
 */
function classify(events, ctx) {
  ctx = ctx || {};
  const of = (t) => events.filter((e) => e.type === t); const lastOf = (t) => { const a = of(t); return a.length ? a[a.length - 1] : null; };
  const start = lastOf('RUN_START'); const end = lastOf('RUN_END'); const last = events.length ? events[events.length - 1] : null;
  const facts = { events_considered: events.length, last_event_type: last ? last.type : null, last_event_at: last ? last.t_wall : null,
    last_heartbeat_at: (lastOf('HEARTBEAT') || {}).t_wall || null, last_child_event: (lastOf('CHILD_EVENT') || {}).data || null,
    child_spawned: of('CHILD_SPAWN').length, remote_channel_lost: of('REMOTE_CHANNEL_LOST').length > 0, run_end_recorded: !!end };
  const r = (outcome, basis) => ({ outcome, basis, facts });
  if (ctx.integrity === 'CORRUPT') return r('UNKNOWN', ['EVIDENCE_CORRUPT: no outcome is asserted from evidence that fails verification']);
  const evidenceFailure = ctx.evidenceFailure || ctx.evidenceWriteError || null;
  if (evidenceFailure) return r('UNKNOWN', ['EVIDENCE_DURABILITY_FAILED:' + evidenceFailure + ' (fail closed: the run was stopped, no outcome is asserted)']);
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
    const cf = childFailure(); if (cf) return r('PROCESS_FAILURE', cf);
    if (exit && exit.data.code === 0) return r('COMPLETED', ['CHILD_EXIT_CODE:0']);
    return r('UNKNOWN', ['NO_CHILD_EXIT_RECORDED']);
  }
  // Incomplete: the harness stopped before writing RUN_END.
  const basis = ['RUN_END_MISSING: harness stopped after ' + (last ? last.type + '@' + last.t_wall : 'nothing')];
  const bootStart = start.data.boot_time_ms; const bootNow = ctx.bootTimeNowMs; const nowMs = isNum(ctx.nowMs) ? ctx.nowMs : Date.now();
  if (isNum(bootStart) && isNum(bootNow)) {
    facts.boot_time_at_start = new Date(bootStart).toISOString(); facts.boot_time_now = new Date(bootNow).toISOString(); facts.boot_time_source = ctx.bootTimeSource || null;
    const drift = bootNow - bootStart;
    if (Math.abs(drift) <= BOOT_TOLERANCE_MS) basis.push('BOOT_TIME_UNCHANGED');
    else {
      // A changed boot time proves a shutdown only if every condition holds; otherwise nothing is asserted.
      const lastMs = Date.parse(last.t_wall);
      if (drift < 0) return r('UNKNOWN', basis.concat(['CLOCK_INCONSISTENT: boot time moved backwards (' + facts.boot_time_now + ' < ' + facts.boot_time_at_start + ')']));
      if (!Number.isFinite(lastMs)) return r('UNKNOWN', basis.concat(['LAST_EVENT_TIME_UNREADABLE']));
      if (bootNow > nowMs + BOOT_TOLERANCE_MS) return r('UNKNOWN', basis.concat(['BOOT_TIME_IN_FUTURE: ' + facts.boot_time_now + ' is after the classification time']));
      if (bootNow <= lastMs) return r('UNKNOWN', basis.concat(['BOOT_NOT_AFTER_LAST_EVENT: new boot ' + facts.boot_time_now + ' <= last event ' + last.t_wall + '; the run was recorded alive at or after that boot']));
      facts.gap_last_event_to_boot_ms = bootNow - lastMs;
      return r('OS_SHUTDOWN', basis.concat(['BOOT_TIME_CHANGED: the machine booted at ' + facts.boot_time_now + ' after the last recorded event; the run cannot have survived it']));
    }
  } else basis.push('BOOT_TIME_NOT_COMPARED');
  if (facts.remote_channel_lost) return r('REMOTE_CHANNEL_FAILURE', basis.concat(['REMOTE_CHANNEL_LOST recorded at ' + lastOf('REMOTE_CHANNEL_LOST').t_wall + ', then the harness stopped (same boot)']));
  const cf = childFailure(); if (cf) return r('PROCESS_FAILURE', basis.concat(cf));
  return r('UNKNOWN', basis.concat(['NO_CORROBORATING_EVIDENCE: cause of the stop is not determinable']));
}

/** SHA-256 of every evidence file present, written atomically (throws EVIDENCE_DURABILITY on failure). */
function writeSums(runDir) {
  const files = {};
  EVIDENCE_FILES.forEach((n) => { const p = path.join(runDir, n); if (fs.existsSync(p)) files[n] = sha256(fs.readFileSync(p)); });
  writeJsonAtomic(path.join(runDir, 'SHA256SUMS.json'), { algorithm: 'sha256', files });
}

function killTree(child, sig) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return 'NOT_RUNNING';
  if (process.platform === 'win32') {
    const r = cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
    return r.error ? 'TASKKILL_ERROR:' + (r.error.code || 'ERROR') : 'TASKKILL_EXIT:' + r.status;
  }
  try { process.kill(-child.pid, sig); return 'GROUP_' + sig; } catch (e) { try { child.kill(sig); return 'CHILD_' + sig; } catch (x) { return 'KILL_ERROR:' + (x.code || 'ERROR'); } }
}

/** Run one child once. Resolves to { outcome, exitCode, runDir, evidenceFailure }. */
function run(o) {
  return new Promise((resolve) => {
    const runDir = path.join(o.evidenceDir, o.runId);
    if (fs.existsSync(runDir)) { resolve({ outcome: 'REFUSED_EXISTING_RUN', exitCode: EXIT.REFUSED_EXISTING_RUN, runDir }); return; }
    const channel = o.channel || process.stdout;
    const t0 = process.hrtime.bigint(); const startedAt = new Date().toISOString(); const bootMs = bootTimeMs();
    const header = { schema: SCHEMA, harness_version: HARNESS_VERSION, run_id: o.runId, label: o.label || null, started_at: startedAt,
      boot_time_ms: bootMs, boot_time: new Date(bootMs).toISOString(), hostname_sha256: sha256(os.hostname()).slice(0, 16), platform: process.platform,
      os_release: os.release(), node: process.versions.node, pid: process.pid, no_retry: true, fail_closed_durability: true,
      dir_fsync: process.platform === 'win32' ? 'NOT_SUPPORTED_ON_WIN32' : 'REQUIRED',
      command: { executable: path.basename(o.cmd), argc: o.args.length }, timeout_ms: o.timeoutMs, heartbeat_ms: o.heartbeatMs };
    let log;
    try {
      fs.mkdirSync(runDir, { recursive: true }); fsyncDir(o.evidenceDir);
      writeJsonAtomic(path.join(runDir, 'run.json'), header);
      log = new EvidenceLog(path.join(runDir, 'events.jsonl'), o.runId, t0, onEvidenceFailure);
    } catch (e) {
      // Fail closed before anything is spawned: the evidence cannot be kept durably.
      resolve({ outcome: 'UNKNOWN', exitCode: EXIT.EVIDENCE_FAILURE, runDir, evidenceFailure: describeFailure(e) }); return;
    }
    let finished = false; let child = null; let hb = null; let timer = null; let hardStop = null; let channelLost = false;
    const counters = { stdout_bytes: 0, stderr_bytes: 0, stdout_lines: 0, child_events: 0, child_fields_dropped: 0, long_lines_dropped: 0 };
    const sensitive = buildSensitiveSet(process.env, o.args);
    let cpuPrev = os.cpus().map((c) => c.times);
    const say = (line) => { if (channelLost || !channel.writable) return; try { channel.write(line + '\n'); } catch (e) { onChannel(e); } };
    const onChannel = (e) => { if (channelLost || finished) return; channelLost = true; log.append('REMOTE_CHANNEL_LOST', { code: (e && e.code) || 'STDOUT_ERROR', note: 'evidence continues on disk' }); };
    channel.on('error', onChannel);
    const onUncaught = (e) => { log.append('HARNESS_ERROR', { code: (e && (e.code || e.name)) || 'ERROR' }); killTree(child, 'SIGKILL'); finish(); };
    process.on('uncaughtException', onUncaught);
    function onEvidenceFailure() { if (finished) return; killTree(child, 'SIGKILL'); finish({ child_terminated_by: 'EVIDENCE_FAILURE' }); }
    const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].concat(process.platform === 'win32' ? ['SIGBREAK'] : []); const handlers = {};
    const finish = (extra) => {
      if (finished) return; finished = true;
      clearInterval(hb); clearTimeout(timer); clearTimeout(hardStop);
      sigs.forEach((s) => { try { process.removeListener(s, handlers[s]); } catch (e) { /* none */ } });
      process.removeListener('uncaughtException', onUncaught); // the channel 'error' listener stays: a late EPIPE must not crash the harness
      if (log.failure) killTree(child, 'SIGKILL');
      let res = classify(log.events.concat([{ type: 'RUN_END', data: {}, t_wall: new Date().toISOString() }]), { evidenceFailure: log.failure });
      const endEv = log.append('RUN_END', Object.assign({ outcome: res.outcome, basis: res.basis, counters, remote_channel_lost: channelLost }, extra || {}));
      log.close(); // checked: a close failure after RUN_END still makes the run UNKNOWN / exit 8
      if (log.failure) res = classify(log.events, { evidenceFailure: log.failure });
      let finalizeFailure = null; let eventsSha = null;
      try { eventsSha = sha256(fs.readFileSync(path.join(runDir, 'events.jsonl'))); } catch (e) { finalizeFailure = 'EVENTS_READ_FAILED:' + (e.code || 'ERROR'); }
      const result = { schema: SCHEMA, run_id: o.runId, outcome: res.outcome, basis: res.basis, facts: res.facts, finished_at: new Date().toISOString(),
        evidence_failure: log.failure, run_end_seq: endEv ? endEv.seq : null, events_count: log.events.length, events_sha256: eventsSha };
      if (!finalizeFailure) {
        try { writeJsonAtomic(path.join(runDir, 'result.json'), result); writeSums(runDir); }
        catch (e) { finalizeFailure = describeFailure(e); }
      }
      const failed = log.failure || finalizeFailure;
      say('PMH-RESULT ' + res.outcome + (failed ? ' EVIDENCE_FAILURE' : ''));
      resolve({ outcome: res.outcome, exitCode: failed ? EXIT.EVIDENCE_FAILURE : (EXIT[res.outcome] === undefined ? EXIT.UNKNOWN : EXIT[res.outcome]), runDir, evidenceFailure: failed || null });
    };
    // SIGHUP is a hang-up of the controlling channel: record it and KEEP RUNNING (evidence stays on disk). On Windows the
    // same signal is also raised for console close/logoff/shutdown — it is recorded, never interpreted as a shutdown.
    sigs.forEach((s) => { handlers[s] = () => {
      if (s === 'SIGHUP') { log.append('PARENT_SIGNAL', { signal: s, action: 'CONTINUE' }); return; }
      if (hardStop) return;
      log.append('PARENT_SIGNAL', { signal: s, action: 'TERMINATE', child_kill: killTree(child, 'SIGTERM') });
      hardStop = setTimeout(() => { killTree(child, 'SIGKILL'); finish({ child_terminated_by: 'PARENT_SIGNAL' }); }, o.killGraceMs);
    }; process.on(s, handlers[s]); });
    log.append('RUN_START', { started_at: startedAt, boot_time_ms: bootMs, harness_pid: process.pid, no_retry: true, command: header.command, label: header.label });
    const pf = preflight({ dir: runDir, minFreeDiskBytes: o.minFreeDiskBytes, minFreeMemBytes: o.minFreeMemBytes, minUptimeS: o.minUptimeS, strict: o.strict, failOnWarn: o.failOnWarn });
    log.append('PREFLIGHT', pf);
    if (log.failure) { finish({ child_spawned: false }); return; } // fail closed: nothing is spawned without durable evidence
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
        if (line.indexOf(CHILD_EVENT_PREFIX) === 0) { const s = sanitizeChildEvent(line, sensitive); counters.child_fields_dropped += s.dropped; if (s.event) { counters.child_events++; log.append('CHILD_EVENT', s.event); } }
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
      if (log.append('HEARTBEAT', data)) say('PMH-HEARTBEAT ' + log.seq);
    }, o.heartbeatMs);
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

/**
 * Offline recovery of an interrupted (or complete) run. Writes a new recovery file; never touches original evidence.
 * o.bootTimeNowMs / o.nowMs are injectable (tests); o.observedBootTime is the operator-supplied boot time (Windows logs).
 */
function recover(runDir, o) {
  o = o || {};
  const v = verify(runDir);
  let bootNow = null; let source = null;
  if (o.observedBootTime) { bootNow = Date.parse(o.observedBootTime); source = 'OPERATOR_OBSERVED'; if (!Number.isFinite(bootNow)) throw Object.assign(new Error('bad --observed-boot-time'), { code: 'USAGE' }); }
  else if (isNum(o.bootTimeNowMs)) { bootNow = o.bootTimeNowMs; source = o.bootTimeSource || 'INJECTED'; }
  else if (o.sameMachine !== false) { bootNow = bootTimeMs(); source = 'THIS_MACHINE_NOW'; }
  const integrity = v.verification.status === 'CORRUPT' ? 'CORRUPT' : v.verification.status;
  const res = classify(v.events, { integrity, bootTimeNowMs: bootNow, bootTimeSource: source, nowMs: o.nowMs, evidenceFailure: v.verification.evidence_failure });
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
  const strictFlag = () => a.has('--strict-readiness') || a.has('--fail-on-warn');
  try {
    if (a.cmd === 'preflight') { const dir = a.flag('--evidence-dir'); if (!dir) throw Object.assign(new Error('--evidence-dir required'), { code: 'USAGE' });
      const r = preflight({ dir, minFreeDiskBytes: a.num('--min-free-disk-bytes', DEFAULTS.minFreeDiskBytes), minFreeMemBytes: a.num('--min-free-mem-bytes', DEFAULTS.minFreeMemBytes), minUptimeS: a.num('--min-uptime-s', DEFAULTS.minUptimeS), strict: strictFlag() });
      print(r); return r.status === 'FAIL' ? EXIT.PREFLIGHT_FAILED : 0; }
    if (a.cmd === 'verify') { const d = a.flag('--run-dir'); if (!d) throw Object.assign(new Error('--run-dir required'), { code: 'USAGE' }); const v = verify(d); print(v.verification); return v.verification.status === 'OK' ? 0 : 1; }
    if (a.cmd === 'recover') { const d = a.flag('--run-dir'); if (!d) throw Object.assign(new Error('--run-dir required'), { code: 'USAGE' });
      const r = recover(d, { observedBootTime: a.flag('--observed-boot-time'), sameMachine: !a.has('--other-machine') }); print(r); return 0; }
    if (a.cmd === 'run') {
      const evidenceDir = a.flag('--evidence-dir'); const runId = a.flag('--run-id'); const label = a.flag('--label');
      if (!evidenceDir || !runId || !RUN_ID_RE.test(runId) || !a.tail.length || (label !== null && (!LABEL_RE.test(label) || looksSecret(label)))) throw Object.assign(new Error('usage: run --evidence-dir D --run-id [A-Za-z0-9_.-]{1,64} [--label L] -- cmd args...'), { code: 'USAGE' });
      const r = await run({ evidenceDir, runId, label, cmd: a.tail[0], args: a.tail.slice(1), timeoutMs: a.num('--timeout-ms', DEFAULTS.timeoutMs), heartbeatMs: Math.max(50, a.num('--heartbeat-ms', DEFAULTS.heartbeatMs)),
        killGraceMs: a.num('--kill-grace-ms', DEFAULTS.killGraceMs), minFreeDiskBytes: a.num('--min-free-disk-bytes', DEFAULTS.minFreeDiskBytes), minFreeMemBytes: a.num('--min-free-mem-bytes', DEFAULTS.minFreeMemBytes),
        minUptimeS: a.num('--min-uptime-s', DEFAULTS.minUptimeS), strict: strictFlag() });
      if (r.outcome === 'REFUSED_EXISTING_RUN') console.error('refused: run directory already exists (no retry, no overwrite): ' + r.runDir);
      if (r.evidenceFailure) console.error('evidence failure (fail closed): ' + r.evidenceFailure);
      return r.exitCode;
    }
    console.error('usage: resilientHarness.js preflight|run|verify|recover ...'); return EXIT.USAGE;
  } catch (e) {
    if (e.code === 'EVIDENCE_DURABILITY') { console.error('evidence failure (fail closed): ' + describeFailure(e)); return EXIT.EVIDENCE_FAILURE; }
    console.error(e.code === 'USAGE' ? e.message : 'harness error: ' + (e.code || e.name)); return e.code === 'USAGE' ? EXIT.USAGE : EXIT.UNKNOWN;
  }
}

module.exports = { preflight, verify, classify, recover, run, sanitizeChildEvent, safeValue, buildSensitiveSet, EvidenceLog, genesis, OUTCOMES, EXIT, CHILD_EVENT_PREFIX,
  CHILD_EVENT_KEYS, STATUS_ENUM, BOOT_TOLERANCE_MS, SCHEMA, SENSITIVE_MIN_EQUAL, SENSITIVE_MIN_EMBED, writeAll, _io: io };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
