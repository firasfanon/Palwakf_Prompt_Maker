/**
 * Prompt Maker — Core Engine (model-agnostic, framework-free, no runtime dependency
 * on any external workspace/assistant/agent system). Pure functions + plain-data registries.
 *
 * Works identically in Node (CLI, tests) and in the browser: build.js concatenates
 * the browser-safe modules of src/ into dist/core_bundle.js (window.PM). src/ is the
 * only place this logic is written; the bundle is generated and freshness-gated.
 *
 * SCOPE NOTE (honesty, not aspiration):
 * Profile and rule counts are never written here: derive them from
 * PROFILE_REGISTRY / RULES_REGISTRY (tests/run.js checks every document against
 * the live numbers). Profiles that are not implemented carry an explicit
 * REMOVED/DEFERRED decision with a real rationale (PROFILE_REGISTRY_DECISIONS).
 * The rule registry holds the minimum real rule for every Full-Production domain
 * the first spec requires; whether each rule applies is decided by Applicability,
 * not assumed (see rulesRegistry.js). It is not an exhaustive compliance
 * encyclopaedia and does not claim to be.
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

// Inverse of makeProjectIntentV1: the flat input object that re-creates this exact intent.
// Used by persistence so a saved version can be re-compiled (deterministically) on reopen.
function intentToInput(intent) {
  const out = { project_name: intent.project_name, project_goal: intent.project_goal };
  const advanced = intent.advanced || {};
  Object.keys(advanced).forEach((k) => { if (advanced[k] !== null && advanced[k] !== undefined) out[k] = advanced[k]; });
  return out;
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
  ['existing_capabilities', 'known_gaps', 'known_constraints', 'special_constraints', 'existing_tests', 'preferred_technology'].forEach((f) => {
    if (adv[f] && adv[f].length > MAX_TEXT_FIELD_LENGTH) {
      errors.push(`advanced.${f} exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
    }
  });
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// ProjectContextV1 — generic, system-agnostic IMPORT contract.
//
// A context is optional, structured knowledge about an existing project that an
// external provider (any tool, person, or script) can hand to Prompt Maker. It
// is NOT tied to any particular product or system: nothing in this codebase
// names or depends on a provider, and no provider is required.
//
//   REQUIRED: schema_version (on raw input, checked by validateProjectContextV1)
//   OPTIONAL: project_id, current_state, existing_architecture,
//             existing_capabilities, existing_constraints, existing_tests,
//             known_gaps, source_references, applicable_external_standards
//   EXTENSIONS: any top-level key starting with "x_" is preserved under
//             `extensions` and otherwise ignored.
//   UNKNOWN_FIELD_POLICY: unknown non-x_ fields are IGNORED (never an error) and
//             reported as warnings by validateProjectContextV1.
//   COMPATIBILITY_POLICY: same MAJOR is accepted (a higher MINOR yields a
//             warning, because newer fields may be dropped); a different MAJOR is
//             rejected — never guessed.
//   TRUST: a context is user-supplied TEXT. Merging it does NOT turn a brownfield
//             assessment into a source inspection (textual context != source inspection).
// ============================================================================

const CONTEXT_LIST_FIELDS = ['existing_architecture', 'existing_capabilities', 'existing_constraints', 'existing_tests', 'known_gaps'];
const CONTEXT_KNOWN_FIELDS = ['schema_version', 'project_id', 'current_state', 'source_references', 'applicable_external_standards', 'extensions']
  .concat(CONTEXT_LIST_FIELDS);
// Pre-1.0-final names that earlier drafts used; accepted as aliases, never emitted.
const CONTEXT_LEGACY_ALIASES = { architecture_constraints: 'existing_constraints', applicable_standards: 'applicable_external_standards', source_system: null };
const CONTEXT_MAX_ITEMS = 100;
const CONTEXT_MAX_ID_LENGTH = 200;

function toStringList(value) {
  if (value === null || value === undefined || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v)).filter((v) => v.trim() !== '');
}

function makeProjectContextV1(input) {
  input = input || {};
  const pick = (name, alias) => (input[name] !== undefined ? input[name] : (alias ? input[alias] : undefined));
  const extensions = {};
  Object.keys(input).forEach((k) => { if (k.indexOf('x_') === 0) extensions[k] = input[k]; });
  return {
    schema_version: SCHEMA_VERSION,
    project_id: input.project_id ? String(input.project_id) : null,
    current_state: input.current_state ? String(input.current_state) : null,
    existing_architecture: toStringList(input.existing_architecture),
    existing_capabilities: toStringList(input.existing_capabilities),
    existing_constraints: toStringList(pick('existing_constraints', 'architecture_constraints')),
    existing_tests: toStringList(input.existing_tests),
    known_gaps: toStringList(input.known_gaps),
    source_references: (Array.isArray(input.source_references) ? input.source_references : []).map((r) => ({
      type: r && r.type ? String(r.type) : 'OTHER',
      ref: r && r.ref ? String(r.ref) : '',
      note: r && r.note ? String(r.note) : null,
    })),
    applicable_external_standards: (() => {
      const raw = pick('applicable_external_standards', 'applicable_standards');
      return (Array.isArray(raw) ? raw : (raw ? [raw] : [])).map((x) => (
        x && typeof x === 'object'
          ? { id: String(x.id || ''), name: x.name ? String(x.name) : null, version: x.version ? String(x.version) : null }
          : { id: String(x), name: null, version: null }
      ));
    })(),
    extensions,
  };
}

/**
 * validateProjectContextV1(raw) — validates the RAW input (so the declared
 * schema_version can be checked) and reports {valid, errors, warnings}.
 */
function validateProjectContextV1(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['context must be an object'], warnings };
  }
  if (typeof raw.schema_version !== 'string' || !/^\d+\.\d+$/.test(raw.schema_version)) {
    errors.push('schema_version is required and must look like "MAJOR.MINOR"');
  } else {
    const [major, minor] = raw.schema_version.split('.').map(Number);
    const [curMajor, curMinor] = SCHEMA_VERSION.split('.').map(Number);
    if (major !== curMajor) errors.push(`unsupported schema_version major ${major} (this compiler reads major ${curMajor})`);
    else if (minor > curMinor) warnings.push(`schema_version ${raw.schema_version} is newer than ${SCHEMA_VERSION}; unknown newer fields will be ignored`);
  }
  if (raw.project_id !== undefined && raw.project_id !== null) {
    if (typeof raw.project_id !== 'string' || raw.project_id.trim() === '') errors.push('project_id must be a non-empty string');
    else if (raw.project_id.length > CONTEXT_MAX_ID_LENGTH) errors.push(`project_id exceeds ${CONTEXT_MAX_ID_LENGTH} characters`);
  }
  if (raw.current_state !== undefined && raw.current_state !== null) {
    if (typeof raw.current_state !== 'string') errors.push('current_state must be a string');
    else if (raw.current_state.length > MAX_TEXT_FIELD_LENGTH) errors.push(`current_state exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
  }
  CONTEXT_LIST_FIELDS.concat(['architecture_constraints']).forEach((f) => {
    const v = raw[f];
    if (v === undefined || v === null) return;
    const items = Array.isArray(v) ? v : [v];
    if (items.length > CONTEXT_MAX_ITEMS) errors.push(`${f} has more than ${CONTEXT_MAX_ITEMS} items`);
    items.forEach((it) => {
      if (typeof it !== 'string') errors.push(`${f} items must be strings`);
      else if (it.length > MAX_TEXT_FIELD_LENGTH) errors.push(`${f} item exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
    });
  });
  if (raw.source_references !== undefined && raw.source_references !== null) {
    if (!Array.isArray(raw.source_references)) errors.push('source_references must be an array');
    else {
      if (raw.source_references.length > CONTEXT_MAX_ITEMS) errors.push(`source_references has more than ${CONTEXT_MAX_ITEMS} items`);
      raw.source_references.forEach((r, idx) => {
        if (!r || typeof r !== 'object' || typeof r.ref !== 'string' || r.ref.trim() === '') errors.push(`source_references[${idx}].ref must be a non-empty string`);
      });
    }
  }
  const stdRaw = raw.applicable_external_standards !== undefined ? raw.applicable_external_standards : raw.applicable_standards;
  if (stdRaw !== undefined && stdRaw !== null) {
    if (!Array.isArray(stdRaw)) errors.push('applicable_external_standards must be an array');
    else if (stdRaw.length > CONTEXT_MAX_ITEMS) errors.push(`applicable_external_standards has more than ${CONTEXT_MAX_ITEMS} items`);
  }
  Object.keys(raw).forEach((k) => {
    if (CONTEXT_KNOWN_FIELDS.indexOf(k) !== -1 || k.indexOf('x_') === 0) return;
    if (Object.prototype.hasOwnProperty.call(CONTEXT_LEGACY_ALIASES, k)) {
      warnings.push(`field "${k}" is a legacy name${CONTEXT_LEGACY_ALIASES[k] ? ` (read as ${CONTEXT_LEGACY_ALIASES[k]})` : ' and is ignored'}`);
    } else {
      warnings.push(`unknown field "${k}" ignored`);
    }
  });
  return { valid: errors.length === 0, errors, warnings };
}

/** parseProjectContextV1(raw) — validate then normalize; context is null when invalid. */
function parseProjectContextV1(raw) {
  const check = validateProjectContextV1(raw);
  return Object.assign({}, check, { context: check.valid ? makeProjectContextV1(raw) : null });
}

// Merges a (validated) ProjectContextV1 into an intent. USER-STATED values always win;
// the context only fills empty fields. Merged text is tagged so provenance stays visible.
function mergeProjectContext(intent, context) {
  if (!context) return intent;
  const ctx = (context.extensions !== undefined && Array.isArray(context.existing_architecture)) ? context : makeProjectContextV1(context);
  const merged = JSON.parse(JSON.stringify(intent));
  const a = merged.advanced;
  const tag = '[from ProjectContextV1] ';
  const fill = (field, list) => { if (!a[field] && list.length) a[field] = tag + list.join('; '); };
  fill('existing_architecture', ctx.existing_architecture);
  fill('existing_capabilities', ctx.existing_capabilities);
  fill('existing_tests', ctx.existing_tests);
  fill('known_gaps', ctx.known_gaps);
  fill('known_constraints', ctx.existing_constraints);
  const repo = ctx.source_references.find((r) => String(r.type).toUpperCase() === 'REPOSITORY');
  if (!a.existing_repository && repo) a.existing_repository = repo.ref;
  if (!a.existing_project && (ctx.current_state || ctx.existing_architecture.length || ctx.existing_capabilities.length || ctx.existing_constraints.length)) {
    a.existing_project = 'existing';
  }
  const specials = [];
  if (ctx.existing_constraints.length) specials.push(tag + ctx.existing_constraints.join('; '));
  if (ctx.applicable_external_standards.length) {
    specials.push(tag + 'standards: ' + ctx.applicable_external_standards.map((s) => [s.id, s.name, s.version].filter(Boolean).join(' ')).join('; '));
  }
  if (ctx.current_state) specials.push(tag + 'current state: ' + ctx.current_state);
  if (specials.length) a.special_constraints = [a.special_constraints].concat(specials).filter(Boolean).join(' | ');
  return merged;
}

module.exports = {
  SCHEMA_VERSION,
  COMPILER_VERSION,
  MAX_TEXT_FIELD_LENGTH,
  MAX_NAME_LENGTH,
  makeProjectIntentV1,
  intentToInput,
  validateProjectIntentV1,
  makeProjectContextV1,
  validateProjectContextV1,
  parseProjectContextV1,
  mergeProjectContext,
};
