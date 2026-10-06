'use strict';
const { fingerprint, stripVolatile } = require('./receipt');
const { intentToInput } = require('./core');

function summarizeChange(previousVersion, compileResult) {
  if (!previousVersion) return 'initial version';
  const parts = [];
  if (previousVersion.input_hash !== compileResult.receipt.input_hash) parts.push('input changed');
  if (previousVersion.blueprint_hash !== compileResult.receipt.blueprint_content_hash) parts.push('blueprint changed');
  if (previousVersion.prompt_hash !== compileResult.receipt.prompt_hash) parts.push('prompt output changed');
  return parts.length > 0 ? parts.join('; ') : 'no detected change';
}

function createProjectVersion(previousVersion, compileResult) {
  const versionNumber = previousVersion ? previousVersion.version_number + 1 : 1;
  return {
    version_id: fingerprint(compileResult.receipt.receipt_hash + ':' + versionNumber),
    version_number: versionNumber,
    parent_version_id: previousVersion ? previousVersion.version_id : null,
    created_at: new Date().toISOString(),
    input_hash: compileResult.receipt.input_hash,
    blueprint_hash: compileResult.receipt.blueprint_content_hash,
    prompt_hash: compileResult.receipt.prompt_hash,
    change_summary: summarizeChange(previousVersion, compileResult)
  };
}

/**
 * compareVersions — hash-level comparison only, NOT a full structural diff.
 * Tells you WHETHER input/blueprint/prompt changed, not WHAT changed inside
 * them. Honestly documented as a limitation rather than implying deep diff.
 */
function compareVersions(v1, v2) {
  return {
    input_changed: v1.input_hash !== v2.input_hash,
    blueprint_changed: v1.blueprint_hash !== v2.blueprint_hash,
    prompt_hash_changed: v1.prompt_hash !== v2.prompt_hash,
    note: 'مقارنة على مستوى البصمة (hash) فقط، ليست مقارنة بنيوية تفصيلية لما تغيّر داخل كل حقل.'
  };
}

// ---------------------------------------------------------------------------
// Persisted project record with a REAL version history (versions[]), storage-agnostic:
// a record is plain JSON handed to any ProjectRepository (memory, filesystem,
// browser storage...). Each version keeps the flat input + options that produced it, so
// any version can be re-opened by re-compiling (the compiler is deterministic) and the
// stored hashes prove the re-opened content matches what was saved.
// ---------------------------------------------------------------------------
const PROJECT_RECORD_SCHEMA_VERSION = '1.0';

/** projectIdFromName — stable, storage-safe id (no path separators / leading dots), identical in CLI and browser. */
function projectIdFromName(name) {
  const id = String(name || '').trim().toLowerCase().replace(/[\\/\0]+/g, '-').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 100);
  return id || 'project';
}

function emptyProjectRecord(projectId, projectName) {
  return { schema_version: PROJECT_RECORD_SCHEMA_VERSION, project_id: projectId, project_name: projectName || projectId, versions: [], latest_version_number: 0 };
}

function normalizeProjectRecord(raw, projectId, projectName) {
  if (!raw) return emptyProjectRecord(projectId, projectName);
  if (Array.isArray(raw.versions)) return JSON.parse(JSON.stringify(raw));
  // Legacy single-version shape { latest_version, result }: keep it readable as a 1-entry history.
  const rec = emptyProjectRecord(projectId, projectName);
  if (raw.latest_version) {
    rec.versions.push(Object.assign({ input: raw.result && raw.result.intent ? intentToInput(raw.result.intent) : null, options: {} }, raw.latest_version));
    rec.latest_version_number = raw.latest_version.version_number;
  }
  return rec;
}

/** appendVersion — returns a NEW record with one more version (never mutates the argument). */
function appendVersion(record, compileResult, options) {
  const projectId = (options && options.projectId) || (record && record.project_id) || compileResult.intent.project_name;
  const rec = normalizeProjectRecord(record, projectId, compileResult.intent.project_name);
  const previous = rec.versions.length ? rec.versions[rec.versions.length - 1] : null;
  const meta = createProjectVersion(previous, compileResult);
  const overrideIds = options && options.overrideProfileIds;
  rec.versions.push(Object.assign({}, meta, {
    input: intentToInput(compileResult.intent),
    options: overrideIds && overrideIds.length ? { overrideProfileIds: overrideIds.slice() } : {},
  }));
  rec.project_name = compileResult.intent.project_name;
  rec.latest_version_number = meta.version_number;
  return rec;
}

/** listVersions — lightweight history rows (no stored input), oldest first. */
function listVersions(record) {
  const rec = normalizeProjectRecord(record, null, null);
  return rec.versions.map((v) => ({
    version_id: v.version_id, version_number: v.version_number, parent_version_id: v.parent_version_id,
    created_at: v.created_at, change_summary: v.change_summary,
    input_hash: v.input_hash, blueprint_hash: v.blueprint_hash, prompt_hash: v.prompt_hash,
  }));
}

/** getVersion — the full stored entry (including input/options) for one version number; null if absent. */
function getVersion(record, versionNumber) {
  const rec = normalizeProjectRecord(record, null, null);
  return rec.versions.find((v) => v.version_number === versionNumber) || null;
}

/**
 * verifyReopenedVersion — a re-opened version is only reported as restored when the
 * freshly compiled content hashes equal the hashes that were stored when it was saved.
 */
function verifyReopenedVersion(storedVersion, compileResult) {
  const mismatches = [];
  if (storedVersion.input_hash !== compileResult.receipt.input_hash) mismatches.push('input_hash');
  if (storedVersion.blueprint_hash !== compileResult.receipt.blueprint_content_hash) mismatches.push('blueprint_hash');
  if (storedVersion.prompt_hash !== compileResult.receipt.prompt_hash) mismatches.push('prompt_hash');
  return { matches: mismatches.length === 0, mismatches };
}

module.exports = {
  createProjectVersion, compareVersions, summarizeChange,
  PROJECT_RECORD_SCHEMA_VERSION, projectIdFromName, emptyProjectRecord, normalizeProjectRecord,
  appendVersion, listVersions, getVersion, verifyReopenedVersion,
};
