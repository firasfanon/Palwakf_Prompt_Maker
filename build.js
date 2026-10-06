#!/usr/bin/env node
'use strict';
/**
 * build.js — SINGLE SOURCE OF TRUTH enforcement (closeout directive, section 3).
 *
 * src/*.js (Node/CommonJS, the canonical compiler core)
 *   ↓ this script concatenates the browser-safe subset in dependency order,
 *     stripping require()/module.exports lines (verified collision-free —
 *     see the duplicate-top-level-name check below)
 *   ↓
 * dist/core_bundle.js (browser global, window.PM)
 *
 * This is the ONLY place the browser bundle is produced. Nobody should hand-edit
 * dist/core_bundle.js directly — any change belongs in src/ and must be rebuilt
 * through this script. A content hash of the concatenated source is embedded in
 * the bundle (BUNDLE_SOURCE_HASH) and checked by tests/buildFreshness.test.js,
 * which fails the test run if src/ has changed since the bundle was last built
 * (the STALE_GENERATED_BUNDLE gate).
 *
 * adapters.js and legacyAdapter.js are deliberately EXCLUDED from this bundle:
 * both use Node's `fs`, which doesn't exist in a browser. The browser gets its
 * own export/persistence adapter (download-based) written directly in the HTML
 * shell — same port interface (ExportAdapter.exportFile), different
 * implementation, exactly the Ports/Adapters pattern this project uses
 * everywhere else. This is the one and only place CLI_CORE and BROWSER_CORE are
 * allowed to differ: the adapter, never the classification/rules/blueprint
 * compiler logic itself (ONE_CANONICAL_COMPILER_CORE).
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');

// Browser-safe modules, in dependency order (verified by hand against each
// file's require() graph — see the "top-level name" collision check below).
const MODULES = [
  'core', 'profileRegistry', 'rulesRegistry', 'classificationEngine',
  'applicabilityEngine', 'architectureCompiler', 'journeyCompiler',
  'brownfieldEngine', 'acceptanceCriteriaLibrary', 'blueprintCompiler',
  'contractBuilders', 'receipt', 'versioning', 'promptCompiler', 'validationEngine',
];

function stripModule(source) {
  const lines = source.split('\n');
  const out = [];
  let skippingExportsBlock = false;
  for (let line of lines) {
    if (skippingExportsBlock) {
      if (line.trim() === '};' || line.trim() === '}') skippingExportsBlock = false;
      continue;
    }
    if (/^\s*'use strict';\s*$/.test(line)) continue;
    if (/^\s*const\s+\{[^}]*\}\s*=\s*require\(/.test(line) || /^\s*const\s+\w+\s*=\s*require\(/.test(line)) continue;
    if (/^\s*module\.exports\s*=\s*\{/.test(line)) {
      if (!line.includes('};')) skippingExportsBlock = true;
      continue;
    }
    if (/^\s*module\.exports\s*=/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

// Collision check: every module's top-level const/function name must be
// globally unique once concatenated into one scope. This IS the
// STALE_GENERATED_BUNDLE / naming-collision gate — the build refuses to
// produce a bundle it cannot prove is safe to flatten.
function checkNoCollisions(moduleSources) {
  const seen = new Map();
  let hasCollision = false;
  moduleSources.forEach(({ name, body }) => {
    const re = /^(?:const|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    let m;
    while ((m = re.exec(body)) !== null) {
      const ident = m[1];
      if (seen.has(ident)) {
        console.error(`BUILD FAILED: duplicate top-level identifier "${ident}" in ${name} and ${seen.get(ident)}`);
        hasCollision = true;
      } else {
        seen.set(ident, name);
      }
    }
  });
  if (hasCollision) process.exit(1);
}

function fingerprint(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function build() {
  const moduleSources = MODULES.map((name) => {
    const raw = fs.readFileSync(path.join(SRC_DIR, `${name}.js`), 'utf8');
    return { name, raw, body: stripModule(raw) };
  });

  checkNoCollisions(moduleSources);

  const concatenatedRaw = moduleSources.map((m) => m.raw).join('\n');
  const sourceHash = fingerprint(concatenatedRaw);

  const browserIndex = `
// ---- browser-only orchestration (mirrors src/index.js's compileProject,
// minus legacyAdapter/fs-based adapters.js which cannot run in a browser) ----
function compileProject(rawInput, options) {
  options = options || {};
  const intent = makeProjectIntentV1(rawInput);
  const intentCheck = validateProjectIntentV1(intent);
  if (!intentCheck.valid) return { ok: false, errors: intentCheck.errors };

  const classification = options.overrideProfileIds
    ? options.overrideProfileIds.map((id) => ({
        profile_id: id, confidence: 1.0,
        reason: 'اختيار يدوي من المستخدم بعد مراجعة التصنيف المقترح',
        evidence: [], source: 'CONFIRMED',
      }))
    : classifyProject(intent);
  const blueprint = compileBlueprint(intent, classification);
  const acceptanceContract = buildAcceptanceContract(blueprint);
  const developmentContract = buildDevelopmentContract(blueprint);
  const prompt = renderMasterPrompt(blueprint, acceptanceContract, developmentContract);
  const validation = validateCandidate(intent, blueprint);
  const receipt = buildReceipt(intent, blueprint, acceptanceContract, developmentContract, prompt);

  return { ok: true, intent, classification, blueprint, acceptanceContract, developmentContract, prompt, validation, receipt };
}

// ---- in-memory persistence adapter (browser session only; a real browser
// "save" is a file download, wired in the HTML shell itself, not here) ----
function createMemoryProjectRepository() {
  const store = new Map();
  return {
    save: (id, data) => { store.set(id, JSON.parse(JSON.stringify(data))); return Promise.resolve(); },
    load: (id) => Promise.resolve(store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : null),
    list: () => Promise.resolve(Array.from(store.keys())),
    remove: (id) => { store.delete(id); return Promise.resolve(); },
  };
}

const BUNDLE_SOURCE_HASH = '${sourceHash}';
const BUNDLE_BUILT_AT = '${new Date().toISOString()}';

window.PM = {
  compileProject, classifyProject, createProjectVersion, compareVersions,
  createMemoryProjectRepository,
  makeProjectIntentV1, validateProjectIntentV1,
  PROFILE_REGISTRY, PROFILE_REGISTRY_DECISIONS, PROFILE_REGISTRY_IMPLEMENTED_THIS_BATCH,
  RULES_REGISTRY, SCHEMA_VERSION, COMPILER_VERSION,
  BUNDLE_SOURCE_HASH, BUNDLE_BUILT_AT,
};
`;

  const banner = `/* AUTO-GENERATED by build.js — DO NOT EDIT BY HAND.
 * Source: ${MODULES.map((m) => 'src/' + m + '.js').join(', ')}
 * Rebuild with: node build.js
 * BUNDLE_SOURCE_HASH=${sourceHash} (must match a fresh build's hash — see tests/buildFreshness.test.js)
 */
(function () {
'use strict';
`;

  const footer = `
})();
`;

  const bundle = banner + moduleSources.map((m) => m.body).join('\n\n') + browserIndex + footer;

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(path.join(DIST_DIR, 'core_bundle.js'), bundle);
  console.log(`Built dist/core_bundle.js — BUNDLE_SOURCE_HASH=${sourceHash}`);
  return sourceHash;
}

if (require.main === module) {
  build();
}

module.exports = { build, fingerprint, MODULES, SRC_DIR };
