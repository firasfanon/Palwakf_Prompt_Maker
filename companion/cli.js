#!/usr/bin/env node
'use strict';
/**
 * Companion CLI.
 *   node companion/cli.js start --origin http://127.0.0.1:4180 [--ollama-model NAME] [--port N]
 *   node companion/cli.js set-credential <ref>     (secret read from STDIN, never argv)
 *   node companion/cli.js delete-credential <ref>
 * The pairing code is printed to THIS terminal only. Nothing sensitive is ever logged.
 */
const { createCompanion } = require('./server');
const { createOsStore } = require('./credentialStore');
const { createOllamaAdapter } = require('./ollamaAdapter');
const { createManualAdapter, createOrchestrator } = require('../gfpi/providerAdapter');

async function readStdin() { const c = []; for await (const d of process.stdin) c.push(d); return Buffer.concat(c).toString('utf8').replace(/\r?\n$/, ''); }

async function main(argv) {
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  if (cmd === 'set-credential') { const ref = argv[1]; const secret = await readStdin(); await createOsStore().set(ref, secret); console.log('stored credential ref ' + ref); return 0; }
  if (cmd === 'delete-credential') { const ok = await createOsStore().delete(argv[1]); console.log(ok ? 'deleted' : 'not found'); return ok ? 0 : 1; }
  if (cmd === 'start') {
    const origin = flag('--origin'); if (!origin) { console.error('--origin is required'); return 2; }
    const adapters = [];
    const model = flag('--ollama-model');
    if (model) adapters.push(createOllamaAdapter({ model }));
    adapters.push(createManualAdapter());
    const now = () => new Date().toISOString();
    const orchestrator = createOrchestrator({ adapters, now, policy: { order: adapters.map((a) => a.id) } });
    const comp = createCompanion({ allowedOrigins: [origin], orchestrator, port: Number(flag('--port') || 0), now, paidCallsAuthorized: false, describeProviders: () => adapters.map((a) => ({ id: a.id, kind: a.kind, locality: a.locality })) });
    const info = await comp.start();
    console.log('Companion listening on http://127.0.0.1:' + info.port + ' (loopback only)');
    console.log('Pairing code (enter it in the browser, single use, 5 minutes): ' + info.pairingCode);
    console.log('Paid hosted calls: NOT AUTHORIZED. Press Ctrl+C to stop.');
    return new Promise(() => {});
  }
  console.error('usage: start | set-credential <ref> | delete-credential <ref>'); return 2;
}
if (require.main === module) main(process.argv.slice(2)).then((c) => { if (typeof c === 'number') process.exit(c); }).catch((e) => { console.error(e.code || 'ERROR'); process.exit(1); });
module.exports = { main };
