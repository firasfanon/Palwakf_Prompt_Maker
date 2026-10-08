'use strict';

/**
 * Shared helpers for the additive Full-Production artifacts. Same envelope idea as gfpi/artifacts.js
 * (artifact_type, schema_version, ids, references, content_sha256 over canonical JSON) but with its OWN type registry,
 * so the frozen GFPI artifact registry is untouched.
 */

const { sha256OfValue } = require('../canon');
const C = require('./catalog');

const PRODUCTION_SCHEMA_VERSION = 'PRODUCTION-1.0';
const PRODUCTION_ARTIFACT_TYPES = ['ProductionReadinessModelV1', 'RequirementDependencyGraphV1', 'ArchitectureDecisionRecordV1', 'NFRContractV1', 'CostModelV1', 'ThreatModelV1', 'DataLifecycleModelV1',
  'DeploymentTopologyV1', 'ProductionEvidenceContractV1', 'TraceabilityGraphV1', 'ChangeImpactAnalysisV1', 'AIProductionProfileV1', 'BuildVsBuyAnalysisV1', 'ProductionCompletenessGuardianV1',
  'FactorySupportReportV1', 'ProductionExecutionAttachmentV1', 'FailureSemanticsV1'];

function makeProdArtifact(type, p) {
  if (PRODUCTION_ARTIFACT_TYPES.indexOf(type) === -1) throw new Error('unknown production artifact type ' + type);
  const a = Object.assign({ artifact_type: type, schema_version: PRODUCTION_SCHEMA_VERSION, artifact_id: p.artifact_id, project_id: p.project_id, created_at: p.created_at, producer: p.producer || { name: 'prompt-maker', commit: 'unknown' }, references: p.references || [] }, p.fields);
  a.content_sha256 = sha256OfValue(a);
  return a;
}
function verifyProdArtifact(a) {
  if (!a || PRODUCTION_ARTIFACT_TYPES.indexOf(a.artifact_type) === -1) return false;
  const c = Object.assign({}, a); delete c.content_sha256;
  return sha256OfValue(c) === a.content_sha256;
}
const refTo = (a) => ({ artifact_type: a.artifact_type, artifact_id: a.artifact_id, sha256: a.content_sha256 });

const CONFIRMED = ['USER_CONFIRMED', 'USER_EDITED'];
/** Field view of one decision: value is exposed as a DECISION only when the human confirmed it. */
function view(states, id) {
  const s = states[id] || { state: 'UNASKED', value: null, value_sha256: null };
  const item = C.byId[id];
  const choice = item && item.choices && typeof s.value === 'string' ? item.choices.find((c) => c.value === s.value) : null;
  let status;
  if (CONFIRMED.indexOf(s.state) !== -1) status = 'CONFIRMED';
  else if (s.state === 'NOT_APPLICABLE_WITH_RATIONALE') status = 'NOT_APPLICABLE_WITH_RATIONALE';
  else if (s.state === 'AI_RECOMMENDED_PENDING_APPROVAL') status = 'AI_RECOMMENDED_PENDING_APPROVAL';
  else if (s.state === 'DEFERRED_WITH_GATE') status = 'DEFERRED_WITH_GATE';
  else status = 'UNRESOLVED';
  return { item_id: id, status, decision_state: s.state, value: status === 'UNRESOLVED' || status === 'DEFERRED_WITH_GATE' ? null : s.value, value_sha256: s.value_sha256 || null, fx: choice ? choice.fx : {}, ledger_seq: s.last_seq || null, rationale: s.rationale || null, gate: s.gate || null };
}
/** Combined status over several views: CONFIRMED only if every live source is confirmed. */
function combine(views) {
  const live = views.filter((v) => v.status !== 'NOT_APPLICABLE_WITH_RATIONALE');
  if (!live.length) return 'NOT_APPLICABLE_WITH_RATIONALE';
  if (live.every((v) => v.status === 'CONFIRMED')) return 'CONFIRMED';
  if (live.some((v) => v.status === 'UNRESOLVED' || v.status === 'DEFERRED_WITH_GATE')) return 'UNRESOLVED';
  return 'AI_RECOMMENDED_PENDING_APPROVAL';
}
const live = (P, states, id) => C.applicability(C.byId[id], P, states).applicable !== 'NO';
const asList = (v) => (typeof v === 'string' ? v.split(/[,،;\n]|\s+و(?=\S)|\sand\s/).map((x) => x.trim()).filter(Boolean) : []);

module.exports = { PRODUCTION_SCHEMA_VERSION, PRODUCTION_ARTIFACT_TYPES, makeProdArtifact, verifyProdArtifact, refTo, view, combine, live, asList, CONFIRMED };
