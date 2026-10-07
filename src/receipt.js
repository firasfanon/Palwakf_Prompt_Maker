'use strict';
const { SCHEMA_VERSION, COMPILER_VERSION } = require('./core');
const { PROFILE_REGISTRY_VERSION } = require('./profileRegistry');
const { RULES_REGISTRY_VERSION } = require('./rulesRegistry');

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * Machine-readable security semantics of every hash in a GenerationReceiptV1.
 * FNV-1a (32-bit) is a DETERMINISTIC, NON-CRYPTOGRAPHIC content fingerprint: fine for
 * change detection and reproducibility, and explicitly NOT a security control.
 * Anyone can forge a matching artifact (32-bit, no secret, trivially collidable), so a
 * receipt must never be used to prove an artifact was not tampered with, nor to
 * verify content that arrives from an untrusted source.
 */
const FINGERPRINT_SEMANTICS = Object.freeze({
  algorithm: 'FNV-1a-32',
  classification: 'DETERMINISTIC_NON_CRYPTOGRAPHIC_FINGERPRINT',
  tamper_resistance: 'NOT_PROVIDED',
  cryptographic_integrity: 'NOT_PROVIDED',
  untrusted_source_verification: 'NOT_PROVIDED',
  suitable_for: Object.freeze(['CHANGE_DETECTION', 'REPRODUCIBILITY', 'DETERMINISTIC_CONTENT_IDENTITY']),
  not_suitable_for: Object.freeze(['TAMPER_PROOFING', 'CRYPTOGRAPHIC_INTEGRITY', 'UNTRUSTED_SOURCE_VERIFICATION', 'AUTHENTICITY']),
});

/**
 * fingerprint — FNV-1a hash. Intentionally non-cryptographic: chosen so the
 * whole compile pipeline stays synchronous in both Node and the browser,
 * rather than requiring crypto.subtle's async API for SHA-256. NOT a
 * security control (see FINGERPRINT_SEMANTICS); purely a determinism /
 * content-identity fingerprint.
 */
function fingerprint(obj) {
  const str = typeof obj === 'string' ? obj : canonicalStringify(obj);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripVolatile(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone && clone.generation_metadata) delete clone.generation_metadata.generated_at;
  if (clone && clone.generated_at) delete clone.generated_at;
  return clone;
}

/**
 * buildReceipt — accepts either the legacy positional form
 * (intent, blueprint, acceptanceContract, developmentContract, prompt) or a
 * single options object with those same keys. Content hashes exclude
 * timestamps (deterministic, tested); receipt_hash hashes the whole receipt
 * including generated_at, so it is intentionally volatile run-to-run.
 */
function buildReceipt(intentOrOpts, blueprint, acceptanceContract, developmentContract, prompt) {
  let intent;
  if (blueprint === undefined && typeof intentOrOpts === 'object' && intentOrOpts.intent) {
    ({ intent, blueprint, acceptanceContract, developmentContract, prompt } = intentOrOpts);
  } else {
    intent = intentOrOpts;
  }

  const inputHash = fingerprint(stripVolatile(intent));
  const blueprintContentHash = fingerprint(stripVolatile(blueprint));
  const acceptanceContentHash = fingerprint(stripVolatile(acceptanceContract));
  const developmentContractContentHash = fingerprint(stripVolatile(developmentContract));
  const promptHash = fingerprint(prompt);
  const generatedAt = new Date().toISOString();

  const receipt = {
    schema_version: SCHEMA_VERSION,
    compiler_version: COMPILER_VERSION,
    schema_versions: { project_intent: SCHEMA_VERSION, project_blueprint: blueprint.schema_version },
    profile_versions: PROFILE_REGISTRY_VERSION,
    rule_versions: RULES_REGISTRY_VERSION,
    input_hash: inputHash,
    blueprint_content_hash: blueprintContentHash,
    acceptance_content_hash: acceptanceContentHash,
    development_contract_content_hash: developmentContractContentHash,
    prompt_hash: promptHash,
    hash_semantics: JSON.parse(JSON.stringify(FINGERPRINT_SEMANTICS)),
    generated_at: generatedAt,
  };
  receipt.receipt_hash = fingerprint(receipt); // includes generated_at: intentionally volatile
  return receipt;
}

module.exports = { FINGERPRINT_SEMANTICS, canonicalStringify, fingerprint, stripVolatile, buildReceipt };
