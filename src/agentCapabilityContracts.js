'use strict';

/**
 * Agent capabilities handoff v1. Producer-side reference contract only:
 * no agent invocation, no access to skills library, no Factory materialization.
 * A separate sidecar preserves ProjectBlueprintV1 and the frozen consumer subset.
 */
const crypto = require('node:crypto');

const CONTRACT = 'PM_FACTORY_AGENT_CAPABILITIES_HANDOFF_V1';
const SCHEMA = '1.0';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function copy(v) { return JSON.parse(JSON.stringify(v)); }

function createAgentCapabilitiesHandoff(blueprint, rawBlueprintBytes) {
  if (!isObject(blueprint) || blueprint.schema_version !== '1.1' ||
      typeof blueprint.project_name !== 'string' || !blueprint.project_name.trim() ||
      !Array.isArray(blueprint.product_surfaces) ||
      !blueprint.product_surfaces.every(x => typeof x === 'string') ||
      !Array.isArray(blueprint.target_platforms) ||
      !blueprint.target_platforms.every(x => typeof x === 'string') ||
      !isObject(blueprint.technology_decision) ||
      !['CONFIRMED', 'REQUIRES_DECISION', 'DEFERRED_WITH_GATE', 'NOT_APPLICABLE_WITH_RATIONALE']
          .includes(blueprint.technology_decision.status) ||
      !Buffer.isBuffer(rawBlueprintBytes)) {
    throw new TypeError('INVALID_BLUEPRINT_FOR_AGENT_REFERENCE_HANDOFF');
  }
  if (rawBlueprintBytes.length > 3 * 1024 * 1024) {
    throw new RangeError('BLUEPRINT_OVER_SIZE_LIMIT');
  }
  let decoded;
  try { decoded = JSON.parse(rawBlueprintBytes.toString('utf8')); }
  catch { throw new TypeError('INVALID_BLUEPRINT_BYTES'); }
  if (JSON.stringify(decoded) !== JSON.stringify(blueprint)) {
    throw new TypeError('BLUEPRINT_OBJECT_BYTES_MISMATCH');
  }
  const blueprintSha = sha256(rawBlueprintBytes);
  const references = Array.isArray(blueprint.confirmed_requirements)
    ? blueprint.confirmed_requirements
      .filter(x => isObject(x) && x.field === 'design_references' && x.status === 'CONFIRMED' && typeof x.value === 'string')
      .map(x => x.value.slice(0, 5000))
    : [];
  const taskId = 'pmref_' + blueprintSha.slice(0, 24);
  return {
    contract_id: CONTRACT,
    schema_version: SCHEMA,
    producer: {
      product_id: 'PROMPT_MAKER',
      blueprint_schema_version: '1.1',
      blueprint_sha256: blueprintSha,
      project_name: blueprint.project_name,
    },
    authority: {
      product: 'PROMPT_MAKER',
      materialization: 'PROJECT_FACTORY',
      agent_runtime: 'AGENTIC',
      authorization: 'WORKSPACE',
      runtime_admission: false,
      execution_authorized: false,
    },
    ui_ux_design: {
      status: 'REFERENCE_REQUEST_ONLY',
      agent: 'UI_UX_DESIGNER',
      required_review: true,
      product_surfaces: copy(blueprint.product_surfaces),
      target_platforms: copy(blueprint.target_platforms),
      confirmed_design_references: references,
      output_claim: 'NOT_GENERATED',
    },
    skills_selection: {
      status: 'NOT_INVOKED',
      capability: 'skills.select.read_only',
      runtime_admitted: false,
      source_class: 'SOVEREIGN_INTERNAL_PRIORITY',
      request: {
        task_id: taskId,
        description: 'UI UX accessibility design review engineering reference',
        scope: 'engineering_reference',
        requested_mode: 'read_only_reference',
      },
      selected_skills: [],
    },
    visual_qa_feedback: {
      status: 'NOT_RUN',
      reviewed_by_agent: false,
      findings: [],
      evidence: [],
      acceptance_authority: 'WORKSPACE_NOT_DELEGATED',
    },
    materialization: {
      status: 'FACTORY_CONSUMER_TO_DECIDE',
      candidate_only: true,
      production_ready: false,
    },
  };
}
module.exports = { CONTRACT, SCHEMA, sha256, createAgentCapabilitiesHandoff };
