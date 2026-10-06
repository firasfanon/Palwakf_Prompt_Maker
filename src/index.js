'use strict';

const core = require('./core');
const { classifyProject } = require('./classificationEngine');
const { compileBlueprint } = require('./blueprintCompiler');
const { buildAcceptanceContract, buildDevelopmentContract } = require('./contractBuilders');
const { renderMasterPrompt } = require('./promptCompiler');
const { validateCandidate } = require('./validationEngine');
const { buildReceipt } = require('./receipt');
const { loadLegacyTemplates } = require('./legacyAdapter');
const { PROFILE_REGISTRY, PROFILE_REGISTRY_DECISIONS } = require('./profileRegistry');
const {
  createMemoryProjectRepository,
  createMemoryExportAdapter,
  createFileProjectRepository,
  createFileExportAdapter,
} = require('./adapters');
const { createProjectVersion, compareVersions, appendVersion, listVersions, getVersion, verifyReopenedVersion, projectIdFromName } = require('./versioning');
const { createStorageProjectRepository } = require('./storageAdapter');

/**
 * compileProject — the single public orchestration entrypoint, used by both
 * the Node test suite and the browser UI (identical logic, zero duplication —
 * this directly fixes the "duplicated canonical generation logic" debt flagged
 * in the v1.1.0 reality report, section 2 of the governing directive).
 */
function compileProject(rawInput, options) {
  options = options || {};
  let intent = core.makeProjectIntentV1(rawInput);
  // Optional ProjectContextV1 (generic import contract): validated first, never trusted blindly.
  let contextWarnings = null;
  if (options.projectContext) {
    const parsed = core.parseProjectContextV1(options.projectContext);
    if (!parsed.valid) return { ok: false, errors: parsed.errors.map((e) => 'projectContext: ' + e) };
    intent = core.mergeProjectContext(intent, parsed.context);
    contextWarnings = parsed.warnings;
  }
  const intentCheck = core.validateProjectIntentV1(intent);
  if (!intentCheck.valid) {
    return { ok: false, errors: intentCheck.errors };
  }

  // Section 7: a user-edited profile selection is a CONFIRMED decision, not an
  // inferred guess — INFERRED != USER_REQUIREMENT applies in both directions.
  const classification = options.overrideProfileIds
    ? options.overrideProfileIds.map((id) => ({
        profile_id: id,
        confidence: 1.0,
        reason: 'اختيار يدوي من المستخدم بعد مراجعة التصنيف المقترح',
        source: 'CONFIRMED',
      }))
    : classifyProject(intent);
  const blueprint = compileBlueprint(intent, classification);
  const acceptanceContract = buildAcceptanceContract(blueprint);
  const developmentContract = buildDevelopmentContract(blueprint);
  const prompt = renderMasterPrompt(blueprint, acceptanceContract, developmentContract);
  const validation = validateCandidate(intent, blueprint);
  const receipt = buildReceipt(intent, blueprint, acceptanceContract, developmentContract, prompt);

  return {
    ok: true,
    intent,
    classification,
    blueprint,
    acceptanceContract,
    developmentContract,
    prompt,
    validation,
    receipt,
    contextWarnings,
  };
}

module.exports = {
  ...core,
  compileProject,
  classifyProject,
  loadLegacyTemplates,
  PROFILE_REGISTRY,
  PROFILE_REGISTRY_DECISIONS,
  createMemoryProjectRepository,
  createMemoryExportAdapter,
  createFileProjectRepository,
  createFileExportAdapter,
  createProjectVersion,
  compareVersions,
  appendVersion,
  listVersions,
  getVersion,
  verifyReopenedVersion,
  createStorageProjectRepository,
  projectIdFromName,
};
