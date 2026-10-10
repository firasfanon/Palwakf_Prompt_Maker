'use strict';
// Reproduces the six review findings against a given harness module. Usage: node defect_probe.js <path/to/resilientHarness.js>
// Prints one line per finding: DEFECT_PRESENT or FIXED. Synthetic only (tiny node children, temp dirs).
const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process'); const crypto = require('crypto');
const modPath = path.resolve(process.argv[2]); const H = require(modPath);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-probe-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const out = [];
const report = (id, present, detail) => out.push(id + ' ' + (present ? 'DEFECT_PRESENT' : 'FIXED') + '  ' + detail);

(async () => {
  // F1 fail-closed on fsync failure
  {
    const dir = tmp(); const hasIo = !!H._io; let present;
    if (!hasIo) {
      // old module: fsync is called directly and errors are swallowed -> patch fs.fsyncSync for the in-process run
      // calls 1-5: run.json tmp, run dir, log ctor dir, RUN_START, preflight probe; from call 6 (PREFLIGHT event) every fsync fails
      const orig = fs.fsyncSync; let n = 0; fs.fsyncSync = (fd) => { if (++n >= 6) throw Object.assign(new Error('x'), { code: 'EIO' }); return orig(fd); };
      const r = await H.run({ evidenceDir: dir, runId: 'f1', cmd: process.execPath, args: ['-e', '0'], timeoutMs: 20000, heartbeatMs: 5000, killGraceMs: 300, minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0 });
      fs.fsyncSync = orig; present = r.outcome === 'COMPLETED' || r.exitCode === 0;
      report('F1', present, 'every fsync throws EIO -> outcome=' + r.outcome + ' exit=' + r.exitCode);
    } else {
      const orig = H._io.fsyncSync; H._io.fsyncSync = () => { throw Object.assign(new Error('x'), { code: 'EIO' }); };
      const r = await H.run({ evidenceDir: dir, runId: 'f1', cmd: process.execPath, args: ['-e', '0'], timeoutMs: 20000, heartbeatMs: 5000, killGraceMs: 300, minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0, channel: { writable: false, on() {}, removeListener() {} } });
      H._io.fsyncSync = orig; present = r.outcome === 'COMPLETED' || r.exitCode === 0;
      report('F1', present, 'every fsync throws EIO -> outcome=' + r.outcome + ' exit=' + r.exitCode);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // F2 evidence hashes + result.json consistency
  {
    const dir = tmp(); const runDir = path.join(dir, 'f2');
    cp.spawnSync(process.execPath, [modPath, 'run', '--evidence-dir', dir, '--run-id', 'f2', '--min-uptime-s', '0', '--heartbeat-ms', '100', '--', process.execPath, '-e', 'process.exit(3)'], { encoding: 'utf8' });
    const rf = path.join(runDir, 'result.json'); const res = JSON.parse(fs.readFileSync(rf, 'utf8'));
    res.outcome = 'COMPLETED'; res.basis = ['CHILD_EXIT_CODE:0']; fs.writeFileSync(rf, JSON.stringify(res, null, 2) + '\n');
    const sumsF = path.join(runDir, 'SHA256SUMS.json'); const sums = JSON.parse(fs.readFileSync(sumsF, 'utf8')); sums.files['result.json'] = sha(fs.readFileSync(rf)); fs.writeFileSync(sumsF, JSON.stringify(sums, null, 2) + '\n');
    const v1 = H.verify(runDir).verification;
    // plain tamper of run.json without touching sums
    const dir2 = tmp(); cp.spawnSync(process.execPath, [modPath, 'run', '--evidence-dir', dir2, '--run-id', 'g', '--min-uptime-s', '0', '--', process.execPath, '-e', '0']);
    const rj = path.join(dir2, 'g', 'run.json'); const hdr = JSON.parse(fs.readFileSync(rj, 'utf8')); hdr.label = 'TAMPERED'; fs.writeFileSync(rj, JSON.stringify(hdr));
    const v2 = H.verify(path.join(dir2, 'g')).verification;
    report('F2', v1.status === 'OK' || v2.status === 'OK', 'forged result.json(COMPLETED for exit 3)+recomputed sums -> verify=' + v1.status + '; edited run.json -> verify=' + v2.status);
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
  }
  // F3 OS_SHUTDOWN when the new boot precedes the last event
  {
    const t = (type, data, at) => ({ type, data: data || {}, t_wall: at });
    const ev = [t('RUN_START', { boot_time_ms: Date.parse('2026-10-01T00:00:00Z') }, '2026-10-10T19:20:00.000Z'), t('PREFLIGHT', { status: 'PASS' }, '2026-10-10T19:20:00.100Z'), t('CHILD_SPAWN', { pid: 1 }, '2026-10-10T19:20:00.200Z'), t('HEARTBEAT', {}, '2026-10-10T19:21:04.000Z')];
    const ctx = (iso) => ({ bootTimeNowMs: Date.parse(iso), nowMs: Date.parse('2026-10-10T20:00:00Z') });
    const a = H.classify(ev, ctx('2026-10-10T19:20:04Z')).outcome; // boot 60 s BEFORE the last event
    const b = H.classify(ev, ctx('2026-10-10T19:21:04Z')).outcome; // boot exactly at the last event
    const c = H.classify(ev.concat([t('REMOTE_CHANNEL_LOST', { code: 'EPIPE' }, '2026-10-10T19:21:05Z')]), ctx('2026-09-20T00:00:00Z')).outcome; // boot moved backwards
    report('F3', a === 'OS_SHUTDOWN' || b === 'OS_SHUTDOWN' || c !== 'UNKNOWN', 'boot 60s before last event -> ' + a + '; boot == last event -> ' + b + '; boot moved backwards -> ' + c);
  }
  // F4 short sensitive values in child events
  {
    const leaks = [];
    const env = { PM_PIN: '4821', PM_PW: 'hunter2', PM_WORD: 'opensesame' };
    const line = 'PMH-EVENT ' + JSON.stringify({ stage: 'hunter2', status: 'opensesame', code: 4821, op: 'admin', result: 'OPENSESAME' });
    const s = H.sanitizeChildEvent.length >= 2 && H.buildSensitiveSet ? H.sanitizeChildEvent(line, H.buildSensitiveSet(env, [])) : H.sanitizeChildEvent(line);
    Object.keys((s && s.event) || {}).forEach((k) => leaks.push(k + '=' + s.event[k]));
    report('F4', leaks.length > 0, 'short secrets surviving sanitization: ' + (leaks.join(', ') || 'none'));
  }
  // F5 readiness gate before Windows tests
  {
    let detail; let present;
    try {
      const pf = H.preflight({ dir: tmp(), minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0, platform: 'win32', regQuery: () => ({ status: 2 }) });
      const regChecks = pf.checks.filter((c) => /reboot|rename/.test(c.name));
      present = pf.status !== 'FAIL' || process.platform !== 'win32' && !regChecks.length;
      detail = 'win32 with unreadable registry (reg exit 2) -> gate=' + pf.status + ' checks=' + regChecks.map((c) => c.name + ':' + c.status + ':' + c.value).join(',');
    } catch (e) { present = true; detail = 'error ' + e.message; }
    if (process.platform !== 'win32' && !H.preflight.toString().includes('regQuery')) { present = true; detail = 'gate not testable off-Windows; reg exit != 0 is mapped to ABSENT/PASS; WARN never blocks unless --fail-on-warn'; }
    report('F5', present, detail);
  }
  // F6 S17 depends on the machine boot time
  {
    const src = fs.readFileSync(path.join(path.dirname(modPath), '..', '..', 'tests', 'gfpi', 's17.test.js'), 'utf8');
    // line-based; the one line that deliberately exercises the live operator path asserts THIS_MACHINE_NOW and is excluded
    const calls = src.split('\n').filter((l) => /H\.recover\(/.test(l) && !/^\s*\/\//.test(l) && !/THIS_MACHINE_NOW/.test(l));
    const machineDependent = calls.filter((c) => !/bootTimeNowMs|observedBootTime/.test(c));
    const futureObserved = calls.filter((c) => /observedBootTime/.test(c) && !/nowMs/.test(c));
    report('F6', machineDependent.length > 0 || futureObserved.length > 0, 'S17 recover() calls using this machine\'s live boot time: ' + machineDependent.length + '; observed-boot calls without an injected clock: ' + futureObserved.length);
  }
  console.log(out.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
