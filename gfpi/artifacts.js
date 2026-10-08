'use strict';

const { sha256OfValue } = require('./canon');

/**
 * GFPI additive artifacts (design section 24). Every artifact shares one envelope:
 *   artifact_type, schema_version, artifact_id, project_id, created_at, content_sha256,
 *   references[] ({artifact_type, artifact_id, sha256}), producer ({name, commit}).
 * content_sha256 = SHA-256 over canonical JSON of the artifact WITHOUT content_sha256 itself.
 *
 * Frozen contracts (ProjectBlueprintV1 1.1, AcceptanceContractV1 1.0, DevelopmentContractV1 1.0,
 * FACTORY_CONSUMER_SUBSET_V1, PROFILE_MAPPING_V1) are NOT defined or modified here; they are only
 * referenced by id and hash.
 */

const ENVELOPE_FIELDS = {
  artifact_type: 'string',
  schema_version: 'string',
  artifact_id: 'string',
  project_id: 'string',
  created_at: 'string',
  content_sha256: 'sha256',
  references: 'array',
  producer: 'object',
};

// kind vocabulary: string | array | object | number | boolean | sha256 | string_or_null | enum:A|B
const GFPI_ARTIFACT_TYPES = {
  DecisionLedgerV1: {
    entries: 'array', head_sha256: 'sha256',
  },
  TechnologyRecommendationV1: {
    options: 'array', status: 'enum:AI_RECOMMENDED_PENDING_APPROVAL', produced_by: 'object',
  },
  ProviderPolicyV1: {
    providers: 'array', fallback_rules: 'object', consent_requirements: 'object', sensitivity_mode: 'enum:STANDARD|LOCAL_ONLY', budget_policy_ref: 'string_or_null',
  },
  ProviderCapabilityMatrixV1: {
    matrix_version: 'string', corpus_sha256: 'string_or_null', rows: 'array',
  },
  ProviderEvaluationEvidenceV1: {
    run_id: 'string', run_kind: 'enum:HARNESS_SELFTEST|DEVELOPMENT_RECORDED|REAL_PROVIDER', provider_id: 'string', model_version: 'string',
    prompt_versions: 'array', corpus_sha256: 'string', corpus_status: 'string', case_output_hashes: 'object', reviewer_ids: 'array', metric_results: 'object',
    usage: 'object', started_at: 'string', finished_at: 'string', run_hash: 'sha256',
  },
  ProviderBudgetPolicyV1: {
    scope: 'enum:DEVELOPMENT|TESTING|OPERATIONAL', currency: 'string', per_call_cap: 'number', per_project_cap: 'number', period_cap: 'number',
    token_caps: 'object', approved_by: 'string_or_null', approved_at: 'string_or_null', credential_ref: 'string_or_null',
  },
  ProductSpecV1: {
    goals: 'array', users: 'array', roles: 'array', workflows: 'array', business_rules: 'array', scope: 'array', non_scope: 'array', unresolved: 'array',
  },
  ArchitectureSpecV1: {
    components: 'array', data_flow: 'array', boundaries: 'array', technology_ref: 'object', unresolved: 'array',
  },
  EngineeringSpecV1: {
    repo_layout: 'array', devops: 'array', deployment: 'array', operations: 'array', development_contract_ref: 'object', unresolved: 'array',
  },
  SecuritySpecV1: {
    authentication: 'array', authorization: 'array', data_classification: 'array', secrets_handling: 'array', threat_model: 'array', abuse_cases: 'array', acceptance_gate_ids: 'array', unresolved: 'array',
  },
  UxSpecV1: {
    journeys: 'array', states: 'array', accessibility: 'array', languages: 'array', responsive: 'array', acceptance_gate_ids: 'array', unresolved: 'array',
  },
  ExecutionPlanV1: {
    phases: 'array', checkpoints: 'array', stop_conditions: 'array', human_gates: 'array', deferred_item_effects: 'array', traceability: 'array', evidence_requirements: 'array',
  },
  AgentExecutionPackageV1: {
    manifest: 'array', master_prompt: 'string', ledger_head_sha256: 'sha256', state: 'enum:DRAFT|REVIEWABLE_WITH_DEFERRED_ITEMS|BLOCKED_FOR_EXECUTION|READY_FOR_REVIEW',
    unresolved: 'array', readiness_statement: 'string', version: 'number', previous_package_sha256: 'string_or_null',
  },
};

const GFPI_ARTIFACT_VERSION = '1.0';

function kindOk(kind, v) {
  if (kind === 'string') return typeof v === 'string';
  if (kind === 'array') return Array.isArray(v);
  if (kind === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (kind === 'number') return typeof v === 'number' && isFinite(v);
  if (kind === 'boolean') return typeof v === 'boolean';
  if (kind === 'sha256') return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  if (kind === 'string_or_null') return v === null || typeof v === 'string';
  if (kind.indexOf('enum:') === 0) return kind.slice(5).split('|').indexOf(v) !== -1;
  return false;
}

function hashOfArtifact(artifact) {
  const copy = {};
  Object.keys(artifact).forEach((k) => { if (k !== 'content_sha256') copy[k] = artifact[k]; });
  return sha256OfValue(copy);
}

/**
 * makeArtifact — builds a sealed artifact. `created_at` is always supplied by the caller
 * (no hidden clock => deterministic, replayable output).
 */
function makeArtifact(type, params) {
  const spec = GFPI_ARTIFACT_TYPES[type];
  if (!spec) throw new Error('unknown artifact type: ' + type);
  const a = {
    artifact_type: type,
    schema_version: GFPI_ARTIFACT_VERSION,
    artifact_id: params.artifact_id,
    project_id: params.project_id,
    created_at: params.created_at,
    references: params.references || [],
    producer: params.producer || { name: 'prompt-maker', commit: 'unknown' },
  };
  Object.keys(spec).forEach((k) => { a[k] = params.fields[k]; });
  a.content_sha256 = hashOfArtifact(a);
  return a;
}

function validateArtifact(a) {
  const errors = [];
  if (!a || typeof a !== 'object') return { valid: false, errors: ['artifact must be an object'] };
  const spec = GFPI_ARTIFACT_TYPES[a.artifact_type];
  if (!spec) return { valid: false, errors: ['unknown artifact_type: ' + a.artifact_type] };
  Object.keys(ENVELOPE_FIELDS).forEach((k) => {
    if (!(k in a) || !kindOk(ENVELOPE_FIELDS[k], a[k])) errors.push('envelope.' + k);
  });
  if (a.schema_version !== GFPI_ARTIFACT_VERSION) errors.push('schema_version (unsupported major/minor: ' + a.schema_version + ')');
  Object.keys(spec).forEach((k) => {
    if (!(k in a) || !kindOk(spec[k], a[k])) errors.push(a.artifact_type + '.' + k);
  });
  const allowed = {};
  Object.keys(ENVELOPE_FIELDS).concat(Object.keys(spec)).forEach((k) => { allowed[k] = true; });
  Object.keys(a).forEach((k) => { if (!allowed[k]) errors.push('unexpected field: ' + k); });
  if (Array.isArray(a.references)) {
    a.references.forEach((r, i) => {
      if (!r || typeof r.artifact_type !== 'string' || typeof r.artifact_id !== 'string' || !kindOk('sha256', r.sha256)) errors.push('references[' + i + ']');
    });
  }
  if (errors.length === 0 && hashOfArtifact(a) !== a.content_sha256) errors.push('content_sha256 mismatch (artifact altered)');
  return { valid: errors.length === 0, errors };
}

function referenceTo(a) {
  return { artifact_type: a.artifact_type, artifact_id: a.artifact_id, sha256: a.content_sha256 };
}

/** JSON Schema (draft 2020-12 subset) generated from the same registry — single source of truth. */
function toJsonSchema(type) {
  const spec = GFPI_ARTIFACT_TYPES[type];
  const prop = (kind) => {
    if (kind === 'string') return { type: 'string' };
    if (kind === 'array') return { type: 'array' };
    if (kind === 'object') return { type: 'object' };
    if (kind === 'number') return { type: 'number' };
    if (kind === 'boolean') return { type: 'boolean' };
    if (kind === 'sha256') return { type: 'string', pattern: '^[0-9a-f]{64}$' };
    if (kind === 'string_or_null') return { type: ['string', 'null'] };
    return { enum: kind.slice(5).split('|') };
  };
  const properties = {};
  const required = [];
  Object.keys(ENVELOPE_FIELDS).forEach((k) => { properties[k] = prop(ENVELOPE_FIELDS[k]); required.push(k); });
  properties.artifact_type = { const: type };
  properties.schema_version = { const: GFPI_ARTIFACT_VERSION };
  Object.keys(spec).forEach((k) => { properties[k] = prop(spec[k]); required.push(k); });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:prompt-maker:gfpi:' + type + ':' + GFPI_ARTIFACT_VERSION,
    title: type,
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

module.exports = { GFPI_ARTIFACT_TYPES, GFPI_ARTIFACT_VERSION, ENVELOPE_FIELDS, makeArtifact, validateArtifact, hashOfArtifact, referenceTo, toJsonSchema };
