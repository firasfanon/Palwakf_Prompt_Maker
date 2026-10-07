'use strict';
/**
 * TEST ORACLE for the FACTORY_CONSUMER_SUBSET_V1 contract — NOT an adapter.
 *
 * It exists only so Prompt Maker can prove its frozen fixtures mean what the contract says
 * (expected outcome per fixture). It materializes nothing and is not shipped from src/.
 * The real consumer lives in the downstream project and must reproduce these outcomes.
 */
const OUTCOMES = Object.freeze({
  READY: 'MATERIALIZATION_READY',
  NEEDS_DECISION: 'BLOCKED_REQUIRES_TECHNOLOGY_DECISION',
  UNSUPPORTED_PROFILE: 'BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE',
  INVALID: 'INVALID_BLUEPRINT',
  UNSUPPORTED_SCHEMA: 'UNSUPPORTED_BLUEPRINT_SCHEMA',
});

const STATUSES = ['CONFIRMED', 'REQUIRES_DECISION', 'NOT_APPLICABLE_WITH_RATIONALE', 'DEFERRED_WITH_GATE'];
const SOURCE_TYPES = ['USER_CONFIRMED', 'PROFILE', 'RULE', 'INFERRED_DEFAULT', null];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim() !== '';

function validateSubset(s) {
  const errors = [];
  if (!nonEmpty(s.project_name)) errors.push('project_name');
  if (!nonEmpty(s.project_goal)) errors.push('project_goal');
  if (!Array.isArray(s.project_profiles) || !s.project_profiles.every((p) => isObj(p) && nonEmpty(p.profile_id))) errors.push('project_profiles');
  if (!Array.isArray(s.target_platforms) || !s.target_platforms.every(isStr)) errors.push('target_platforms');
  if (!isObj(s.architecture_target) || !nonEmpty(s.architecture_target.pattern) || !nonEmpty(s.architecture_target.source)) errors.push('architecture_target');
  const t = s.technology_decision;
  if (!isObj(t)) errors.push('technology_decision');
  else {
    if (STATUSES.indexOf(t.status) === -1) errors.push('technology_decision.status');
    if (!(t.stack === null || isStr(t.stack))) errors.push('technology_decision.stack');
    if (SOURCE_TYPES.indexOf(t.source_type === undefined ? '__missing__' : t.source_type) === -1) errors.push('technology_decision.source_type');
    if (!(t.profile_hint === null || isStr(t.profile_hint))) errors.push('technology_decision.profile_hint');
    if (!isStr(t.rationale)) errors.push('technology_decision.rationale');
    if (t.status === 'CONFIRMED' && (!nonEmpty(t.stack) || t.source_type !== 'USER_CONFIRMED')) errors.push('technology_decision.CONFIRMED_requires_user_confirmed_stack');
  }
  const p = s.production_readiness_target;
  if (!isObj(p) || !isStr(p.note) || !Array.isArray(p.domains_covered) || !p.domains_covered.every(isStr)) errors.push('production_readiness_target');
  if (!Array.isArray(s.required_decisions) || !s.required_decisions.every(isObj)) errors.push('required_decisions');
  if (!Array.isArray(s.prohibited_shortcuts) || !s.prohibited_shortcuts.every(isStr)) errors.push('prohibited_shortcuts');
  return errors;
}

const canonicalKey = (stack) => stack.trim().replace(/\s+/g, ' ').toLowerCase();

function resolveProfile(stack, mapping) {
  const key = canonicalKey(stack);
  for (const p of mapping.profiles) {
    if (key === p.profile_id.toLowerCase()) return { classification: 'SUPPORTED_EXACT', profile: p.profile_id };
    if (p.aliases.some((a) => canonicalKey(a) === key)) return { classification: 'SUPPORTED_ALIAS', profile: p.profile_id };
  }
  return { classification: 'UNSUPPORTED', profile: null };
}

function evaluateConsumerSubset(subset, mapping, supportedSchemas) {
  const supported = supportedSchemas || ['1.1'];
  if (!isObj(subset)) return { outcome: OUTCOMES.INVALID, errors: ['subset must be an object'] };
  // Schema is checked FIRST: a future/foreign schema may legitimately restructure other fields.
  if (!isStr(subset.schema_version) || subset.schema_version.trim() === '') return { outcome: OUTCOMES.INVALID, errors: ['schema_version'] };
  if (supported.indexOf(subset.schema_version) === -1) return { outcome: OUTCOMES.UNSUPPORTED_SCHEMA, errors: ['schema_version ' + subset.schema_version] };
  const errors = validateSubset(subset);
  if (errors.length) return { outcome: OUTCOMES.INVALID, errors };
  const t = subset.technology_decision;
  if (t.status !== 'CONFIRMED') return { outcome: OUTCOMES.NEEDS_DECISION, classification: 'REQUIRES_DECISION', errors: [] };
  const r = resolveProfile(t.stack, mapping);
  if (r.classification === 'UNSUPPORTED') return { outcome: OUTCOMES.UNSUPPORTED_PROFILE, classification: 'UNSUPPORTED', errors: [] };
  return { outcome: OUTCOMES.READY, classification: r.classification, profile: r.profile, errors: [] };
}

module.exports = { OUTCOMES, validateSubset, resolveProfile, canonicalKey, evaluateConsumerSubset };
