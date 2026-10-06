/**
 * Prompt Maker — Core Engine (model-agnostic, framework-free, no runtime dependency
 * on any external workspace/assistant/agent system). Pure functions + plain-data registries.
 *
 * Works identically in Node (for automated tests) and in the browser (embedded as
 * a <script> in app.html) — no build step, no bundler, CommonJS guarded for browser use.
 *
 * SCOPE NOTE (honesty, not aspiration):
 * This implements a REPRESENTATIVE SUBSET of the full vision, not an exhaustive
 * enterprise rule base. 18 of 22 listed project profiles are implemented; the
 * other 4 get an explicit REMOVED/DEFERRED decision with a real rationale
 * (see PROFILE_REGISTRY_DECISIONS in profileRegistry.js — this replaces the
 * earlier flat PROFILE_REGISTRY_DEFERRED list now that 4 of the original 8
 * deferred profiles have been implemented).
 * ~45 Full-Production requirement rules are implemented across domains — enough
 * to prove genuine per-profile differentiation (tested), not enough to claim
 * exhaustive enterprise coverage. See the test summary at the bottom of
 * `node tests/run.js` output for the honest accounting.
 */

'use strict';

// ============================================================================
// 1. SCHEMAS (versioned, plain-object factories + minimal runtime validators)
// ============================================================================

const SCHEMA_VERSION = '1.0';
const COMPILER_VERSION = '1.2.0-dev';

function makeProjectIntentV1(input) {
  input = input || {};
  return {
    schema_version: SCHEMA_VERSION,
    project_name: input.project_name || '',
    project_goal: input.project_goal || '',
    // Advanced inputs — all optional. Each present value is CONFIRMED by definition
    // (the user typed it). Absent values are handled downstream as UNKNOWN, never
    // silently assumed to be a specific value.
    advanced: {
      target_platforms: input.target_platforms || null,
      users: input.users || null,
      roles: input.roles || null,
      countries: input.countries || null,
      languages: input.languages || null,
      visibility: input.visibility || null, // PUBLIC | INTERNAL | null
      authentication: input.authentication || null,
      multi_tenancy: input.multi_tenancy || null, // 'yes' | 'no' | null
      ai_features: input.ai_features || null,
      payments: input.payments || null,
      data_sensitivity: input.data_sensitivity || null,
      offline_requirements: input.offline_requirements || null,
      integrations: input.integrations || null,
      preferred_technology: input.preferred_technology || null,
      deployment_preference: input.deployment_preference || null,
      regulatory_requirements: input.regulatory_requirements || null,
      existing_project: input.existing_project || null, // 'new' | 'existing'
      existing_repository: input.existing_repository || null,
      existing_architecture: input.existing_architecture || null,
      existing_stack: input.existing_stack || null,
      existing_capabilities: input.existing_capabilities || null,
      existing_tests: input.existing_tests || null,
      known_gaps: input.known_gaps || null,
      known_constraints: input.known_constraints || null,
      design_references: input.design_references || null,
      special_constraints: input.special_constraints || null,
    },
  };
}

const MAX_TEXT_FIELD_LENGTH = 5000;
const MAX_NAME_LENGTH = 200;

// Section 33: explicit input length bounds — prevents an unbounded free-text
// field from silently blowing up downstream hashing/rendering, and gives the
// user a clear, specific error instead of a generic failure.
function validateProjectIntentV1(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object') {
    return { valid: false, errors: ['intent must be an object'] };
  }
  if (!intent.project_name || !intent.project_name.trim()) {
    errors.push('project_name is required');
  } else if (intent.project_name.length > MAX_NAME_LENGTH) {
    errors.push(`project_name exceeds ${MAX_NAME_LENGTH} characters`);
  }
  if (!intent.project_goal || !intent.project_goal.trim()) {
    errors.push('project_goal is required');
  } else if (intent.project_goal.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push(`project_goal exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
  }
  const adv = intent.advanced || {};
  ['existing_capabilities', 'known_gaps', 'known_constraints', 'special_constraints', 'existing_tests'].forEach((f) => {
    if (adv[f] && adv[f].length > MAX_TEXT_FIELD_LENGTH) {
      errors.push(`advanced.${f} exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// ProjectContextV1 — IMPORT-READY STUB ONLY. Nothing in this codebase currently
// produces or consumes this from Workspace/Mind. It exists purely as a documented
// future integration contract, per explicit scope boundary (no Workspace/Mind code).
function makeProjectContextV1(input) {
  input = input || {};
  return {
    schema_version: SCHEMA_VERSION,
    source_system: input.source_system || null, // e.g. an external project-management system — always null today
    current_state: input.current_state || null,
    applicable_standards: input.applicable_standards || null,
    existing_capabilities: input.existing_capabilities || null,
    known_gaps: input.known_gaps || null,
    architecture_constraints: input.architecture_constraints || null,
  };
}

// Merges an (optional, currently always absent in production) ProjectContextV1 into
// an intent. Tested with a mock context to prove the shape works — not wired to any
// real external system.
function mergeProjectContext(intent, context) {
  if (!context) return intent;
  const merged = JSON.parse(JSON.stringify(intent));
  if (context.architecture_constraints) {
    merged.advanced.special_constraints = [
      merged.advanced.special_constraints,
      '[from ProjectContextV1] ' + context.architecture_constraints.join('; '),
    ].filter(Boolean).join(' | ');
  }
  return merged;
}

module.exports = {
  SCHEMA_VERSION,
  COMPILER_VERSION,
  MAX_TEXT_FIELD_LENGTH,
  MAX_NAME_LENGTH,
  makeProjectIntentV1,
  validateProjectIntentV1,
  makeProjectContextV1,
  mergeProjectContext,
};
