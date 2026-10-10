'use strict';
// Reproduces V3 findings F07 (unchecked partial writes / unchecked close) and F08 (short secrets embedded in allowed
// values) against a given harness module. Usage: node defect_probe_v3.js <path/to/resilientHarness.js>
// Prints one line per case: DEFECT_PRESENT or FIXED. Synthetic only: tiny node children, temp dirs, in-process faults.
const fs = require('fs'); const os = require('os'); const path = require('path');
const H = require(path.resolve(process.argv[2]));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pm-probe3-'));
const SILENT = { writable: true, write() {}, on() {}, removeListener() {} };
const out = []; const report = (id, present, detail) => out.push(id + ' ' + (present ? 'DEFECT_PRESENT' : 'FIXED') + '  ' + detail);
const v3 = H._io.writeSync.length >= 4; // V3 primitive: (fd, buf, offset, length) -> bytes written
const fdPath = (fd) => { try { return fs.readlinkSync('/proc/self/fd/' + fd); } catch (e) { return ''; } };
const runOnce = (dir, id) => H.run({ evidenceDir: dir, runId: id, cmd: process.execPath, args: ['-e', '0'], timeoutMs: 20000, heartbeatMs: 5000,
  killGraceMs: 300, minFreeDiskBytes: 0, minFreeMemBytes: 0, minUptimeS: 0, channel: SILENT });

/** Replace the write primitive with one that writes only part (or none) of the bytes of event-log lines and reports that. */
function shortWrite(mode) {
  const orig = H._io.writeSync;
  H._io.writeSync = function (fd, data, off, len) {
    const isEvents = /events\.jsonl$/.test(fdPath(fd));
    if (v3) {
      if (!isEvents) return orig(fd, data, off, len);
      const want = len; const n = mode === 'zero' ? 0 : Math.max(1, Math.floor(want / 2));
      return n === 0 ? 0 : fs.writeSync(fd, data, off, n);
    }
    if (!isEvents) return orig(fd, data);
    const buf = Buffer.from(String(data)); const n = mode === 'zero' ? 0 : Math.max(1, Math.floor(buf.length / 2));
    return n === 0 ? 0 : fs.writeSync(fd, buf, 0, n);
  };
  return () => { H._io.writeSync = orig; };
}

(async () => {
  for (const mode of ['short', 'zero']) {
    const dir = tmp(); const restore = shortWrite(mode); let r;
    try { r = await runOnce(dir, 'f07' + mode); } finally { restore(); }
    const v = H.verify(r.runDir).verification;
    // defect = success reported while the recorded evidence is damaged (a short write that is CONTINUED to completion is correct)
    report('F07-' + mode.toUpperCase() + '_WRITE', (r.exitCode === 0 || r.outcome === 'COMPLETED') && v.status !== 'OK',
      'event-log writes ' + (mode === 'zero' ? 'return 0 bytes' : 'write half the bytes') + ' -> outcome=' + r.outcome + ' exit=' + r.exitCode + ' verify=' + v.status);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  { // close of events.jsonl fails (e.g. deferred write error reported at close)
    const dir = tmp(); const orig = fs.closeSync; let r;
    // only the FIRST close of events.jsonl fails: that is the harness closing its append handle (later reads close cleanly)
    let fired = false;
    const closeHook = (fd) => { const p = fdPath(fd); orig(fd); if (!fired && /events\.jsonl$/.test(p)) { fired = true; throw Object.assign(new Error('injected'), { code: 'EIO' }); } };
    if (H._io.closeSync) H._io.closeSync = closeHook; else fs.closeSync = closeHook;
    try { r = await runOnce(dir, 'f07close'); } finally { if (H._io.closeSync) H._io.closeSync = orig; fs.closeSync = orig; }
    report('F07-CLOSE_ERROR', r.exitCode === 0 || r.outcome === 'COMPLETED', 'close(events.jsonl) throws EIO -> outcome=' + r.outcome + ' exit=' + r.exitCode);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  { // F08: short secrets embedded in values that pass the typed rules
    const env = { PM_PIN: '4821', PM_PW: 'pw12', PM_KEY: 'ab-12', PM_WORD: 'abcd' };
    const sens = H.buildSensitiveSet(env, ['--otp=7319']);
    const cases = [{ stage: 'STEP_4821' }, { code: 'ERR_PW12' }, { op: 'AB_12' }, { stage: 'A_B_C_D' }, { stage: 'OK_7319_DONE' }, { elapsed_ms: 148210 }, { iteration: 73190 }];
    const leaked = cases.map((c) => H.sanitizeChildEvent('PMH-EVENT ' + JSON.stringify(c), sens).event).filter(Boolean);
    report('F08-SHORT_EMBEDDED', leaked.length > 0, 'values carrying an embedded env/argv secret (4-5 chars) that survived: ' + (leaked.map((e) => JSON.stringify(e)).join(' ') || 'none'));
  }
  console.log(out.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
