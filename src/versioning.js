'use strict';
const { fingerprint, stripVolatile } = require('./receipt');

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

module.exports = { createProjectVersion, compareVersions, summarizeChange };
