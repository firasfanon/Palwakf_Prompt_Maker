'use strict';

const { SCHEMA_VERSION } = require('./core');
const { computeApplicability } = require('./applicabilityEngine');
const { suggestArchitecture } = require('./architectureCompiler');
const { compileJourneys } = require('./journeyCompiler');

/**
 * compileBlueprint — the single most important function. Combines intent +
 * classification + applicability into ProjectBlueprintV1 (section 8 schema).
 *
 * HONESTY NOTE on domain_entities: this is NOT NLP-driven entity extraction.
 * It is a deliberately simple, documented heuristic (noun-ish tokens from the
 * goal text, deduplicated) tagged ASSUMED — a human must confirm it. Faking a
 * smarter extractor than this would violate the "UNKNOWN != PASS" invariant
 * this whole document is built around.
 */
function guessDomainEntities(projectGoal) {
  // Extremely light heuristic: look for common Arabic nouns after "إدارة"/"متابعة"/"تتبع".
  const matches = [];
  const re = /(?:إدارة|متابعة|تتبع|تسجيل)\s+([\u0600-\u06FF]{3,15})/g;
  let m;
  while ((m = re.exec(projectGoal || '')) !== null) matches.push(m[1]);
  return matches.length
    ? matches.map((e) => ({ name: e, status: 'ASSUMED', rationale: 'استُخرج من صياغة الهدف تلقائيًا — يحتاج تأكيد المستخدم' }))
    : [{ name: null, status: 'REQUIRES_DECISION', rationale: 'لم يُستخرج أي كيان من نص الهدف — يحتاج المستخدم تحديد الكيانات الأساسية يدويًا' }];
}

function compileBlueprint(intent, classification) {
  const profileIds = classification.map((c) => c.profile_id);
  const applicability = computeApplicability(profileIds, intent);
  const architecture = suggestArchitecture(profileIds);
  const journeys = compileJourneys(profileIds);

  const requiredRules = applicability.filter((r) => r.status === 'REQUIRED');
  const optionalRules = applicability.filter((r) => r.status === 'OPTIONAL');

  const unknowns = [];
  const requiredDecisions = [];
  const assumptions = [];
  const inferredDefaults = [{ field: 'project_profiles', value: profileIds, rationale: classification.map((c) => c.reason) }];
  inferredDefaults.push({ field: 'architecture_target', value: architecture.pattern, rationale: architecture.reason });

  const domainEntities = guessDomainEntities(intent.project_goal);
  domainEntities.forEach((e) => {
    if (e.status === 'ASSUMED') assumptions.push({ field: 'domain_entity', value: e.name, rationale: e.rationale });
    if (e.status === 'REQUIRES_DECISION') requiredDecisions.push({ field: 'domain_entities', rationale: e.rationale });
  });

  if (!intent.advanced.target_platforms) unknowns.push({ field: 'target_platforms', note: 'لم يُحدَّد — افتراض ويب فقط غير مؤكد' });
  if (!intent.advanced.data_sensitivity && (profileIds.includes('GIS_SYSTEM') || profileIds.includes('FINANCIAL_SYSTEM'))) {
    requiredDecisions.push({ field: 'data_sensitivity', rationale: 'مطلوب تحديد حساسية البيانات لنمط ' + profileIds.join('/') });
  }

  return {
    schema_version: SCHEMA_VERSION,
    project_name: intent.project_name,
    project_goal: intent.project_goal,
    project_profiles: classification,
    users: intent.advanced.users ? [intent.advanced.users] : [],
    roles: intent.advanced.roles ? [intent.advanced.roles] : [],
    target_platforms: intent.advanced.target_platforms ? [intent.advanced.target_platforms] : [],

    confirmed_requirements: Object.entries(intent.advanced)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => ({ field: k, value: v, status: 'CONFIRMED' })),
    inferred_defaults: inferredDefaults,
    assumptions: assumptions,
    unknowns: unknowns,
    required_decisions: requiredDecisions,

    functional_requirements: requiredRules.filter((r) => r.domain === 'PRODUCT_COMPLETENESS'),
    nonfunctional_requirements: requiredRules.filter((r) => r.domain !== 'PRODUCT_COMPLETENESS'),

    user_journeys: journeys,
    product_surfaces: profileIds.includes('API_SERVICE') ? ['API endpoints only — لا واجهة رسومية'] : ['Web UI'],
    information_architecture: 'INFERRED_DEFAULT — يُشتق من الـProfiles المختارة، يحتاج مراجعة بشرية قبل الاعتماد',

    domain_entities: domainEntities,
    relationships: [],
    business_rules: [],
    state_machines: [],

    architecture_target: architecture,
    data_strategy: applicability.filter((r) => r.domain === 'DATA'),
    persistence_strategy: applicability.filter((r) => r.domain === 'DATA' || r.domain === 'BACKUP_RESTORE'),
    security_profile: applicability.filter((r) => r.domain === 'SECURITY' || r.domain === 'AUTHENTICATION' || r.domain === 'AUTHORIZATION'),
    privacy_profile: applicability.filter((r) => r.domain === 'PRIVACY'),
    integration_strategy: applicability.filter((r) => r.domain === 'INTEGRATIONS' || r.domain === 'API_CONTRACTS'),

    ux_requirements: applicability.filter((r) => r.domain === 'UX'),
    design_system_requirements: 'راجع DESIGN_SYSTEM.md في palwakf-project-factory كمرجع Token-based — غير مُدمَج آليًا هنا بعد',
    responsive_requirements: applicability.filter((r) => r.id.indexOf('UAT') === 0),
    accessibility_requirements: applicability.filter((r) => r.domain === 'UX' && r.id.indexOf('A11Y') === 0),

    performance_requirements: applicability.filter((r) => r.domain === 'PERFORMANCE'),
    reliability_requirements: applicability.filter((r) => r.domain === 'RELIABILITY'),
    observability_requirements: applicability.filter((r) => r.domain === 'OBSERVABILITY'),

    backup_restore_requirements: applicability.filter((r) => r.domain === 'BACKUP_RESTORE'),
    rollback_requirements: [],

    test_strategy: applicability.filter((r) => r.domain === 'TESTING'),
    browser_uat_strategy: applicability.filter((r) => r.domain === 'BROWSER_UAT'),

    release_strategy: applicability.filter((r) => r.domain === 'CI_CD'),
    production_readiness_target: {
      note: 'هذا هدف (Target)، وليس شهادة جاهزية — لا يُفترض PRODUCTION_READY=TRUE أبدًا هنا',
      domains_covered: Array.from(new Set(applicability.map((r) => r.domain))),
    },

    acceptance_gates: [], // تُبنى في contractBuilders.js
    prohibited_shortcuts: [
      'NO_FAKE_SAVE', 'NO_DEAD_BUTTON', 'NO_PLACEHOLDER_AS_COMPLETE',
      'NO_SILENT_ASSUMPTION', 'NO_SECRET_IN_OUTPUT',
    ],

    generation_metadata: { generated_at: new Date().toISOString() },

    _all_applicability: applicability, // للاستخدام الداخلي في بناء العقود
  };
}

module.exports = { compileBlueprint, guessDomainEntities };
