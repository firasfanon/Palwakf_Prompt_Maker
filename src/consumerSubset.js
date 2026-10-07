'use strict';

/**
 * FACTORY_CONSUMER_SUBSET_V1 — the deliberately small, stable slice of ProjectBlueprintV1 that a
 * downstream project-materialization consumer may rely on. PRODUCER-SIDE CONTRACT ONLY:
 * this module projects fields; it does not validate, resolve technologies, or materialize anything.
 *
 * Rules (frozen with the subset):
 *  - Only the fields named below are projected, in this fixed order (deterministic output).
 *  - Fields beginning with "_" are INTERNAL: never projected, never required.
 *  - A field missing from the blueprint is OMITTED, never fabricated, so a consumer can detect it.
 *  - Unknown extra blueprint fields are ignored.
 */
const CONSUMER_SUBSET_VERSION = 1;
const SUPPORTED_CONSUMER_BLUEPRINT_SCHEMA_VERSIONS = Object.freeze(['1.1']);

const FACTORY_CONSUMER_SUBSET_V1_FIELDS = Object.freeze([
  'schema_version',
  'project_name',
  'project_goal',
  'project_profiles',
  'target_platforms',
  'architecture_target',
  'technology_decision',
  'production_readiness_target',
  'required_decisions',
  'prohibited_shortcuts',
]);

function extractFactoryConsumerSubset(blueprint) {
  const out = {};
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return out;
  FACTORY_CONSUMER_SUBSET_V1_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(blueprint, field) && blueprint[field] !== undefined) {
      out[field] = JSON.parse(JSON.stringify(blueprint[field]));
    }
  });
  return out;
}

module.exports = {
  CONSUMER_SUBSET_VERSION,
  SUPPORTED_CONSUMER_BLUEPRINT_SCHEMA_VERSIONS,
  FACTORY_CONSUMER_SUBSET_V1_FIELDS,
  extractFactoryConsumerSubset,
};
