'use strict';

const { SCHEMA_VERSION, COMPILER_VERSION } = require('./core');
const { PROFILE_REGISTRY_VERSION } = require('./profileRegistry');
const { RULES_REGISTRY_VERSION } = require('./rulesRegistry');

// Non-cryptographic, dependency-free, deterministic hash (FNV-1a variant).
// Documented as such — NOT a security control, purely a change-detection fingerprint.
function fingerprint(obj) {
  const str = JSON.stringify(obj);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildReceipt(intent, blueprint, acceptanceContract, developmentContract, prompt) {
  return {
    schema_version: SCHEMA_VERSION,
    compiler_version: COMPILER_VERSION,
    profile_versions: PROFILE_REGISTRY_VERSION,
    rules_versions: RULES_REGISTRY_VERSION,
    input_hash: fingerprint(intent),
    blueprint_hash: fingerprint(blueprint),
    acceptance_hash: fingerprint(acceptanceContract),
    development_hash: fingerprint(developmentContract),
    prompt_hash: fingerprint(prompt),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { buildReceipt, fingerprint };
