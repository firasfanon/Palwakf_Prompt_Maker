'use strict';
/**
 * STALE_GENERATED_BUNDLE gate (closeout directive, section 3).
 *
 * Recomputes the source hash straight from the current src/*.js files and
 * compares it against the hash embedded in the committed dist/core_bundle.js.
 * If anyone edits src/ and forgets to run `node build.js`, this test FAILS —
 * it is the automated enforcement that CLI_CORE and BROWSER_CORE cannot
 * silently drift apart.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { build, fingerprint, MODULES, SRC_DIR } = require('../build');

function run() {
  const concatenatedRaw = MODULES.map((m) => fs.readFileSync(path.join(SRC_DIR, `${m}.js`), 'utf8')).join('\n');
  const expectedHash = fingerprint(concatenatedRaw);

  const bundlePath = path.join(__dirname, '..', 'dist', 'core_bundle.js');
  if (!fs.existsSync(bundlePath)) {
    throw new Error('dist/core_bundle.js does not exist — run `node build.js` first');
  }
  const bundleContent = fs.readFileSync(bundlePath, 'utf8');
  const m = bundleContent.match(/BUNDLE_SOURCE_HASH\s*=\s*'([0-9a-f]+)'/);
  assert.ok(m, 'dist/core_bundle.js has no BUNDLE_SOURCE_HASH marker — it was not built by build.js');
  const embeddedHash = m[1];

  assert.strictEqual(
    embeddedHash,
    expectedHash,
    `STALE_GENERATED_BUNDLE: dist/core_bundle.js (hash ${embeddedHash}) does not match current src/ (hash ${expectedHash}). Run: node build.js`
  );

  return true;
}

module.exports = { run };

if (require.main === module) {
  run();
  console.log('✅ buildFreshness: dist/core_bundle.js matches current src/ (no stale bundle)');
}
