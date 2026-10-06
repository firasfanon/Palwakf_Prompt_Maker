'use strict';

const { SCHEMA_VERSION } = require('./core');
const { computeApplicability } = require('./applicabilityEngine');
const { suggestArchitecture } = require('./architectureCompiler');
const { compileJourneys } = require('./journeyCompiler');
const { assessBrownfield } = require('./brownfieldEngine');

const SURFACE_RULES = {
  PUBLIC: (ids) => ids.indexOf('PUBLIC_PORTAL') !== -1 || ids.indexOf('WEB_APPLICATION') !== -1 || ids.indexOf('CONTENT_PLATFORM') !== -1,
  AUTHENTICATED: (ids, intent) => !!(intent.advanced && intent.advanced.authentication) || ids.indexOf('WEB_SAAS') !== -1 || ids.indexOf('MULTI_TENANT_SAAS') !== -1,
  ADMIN: (ids) => ids.indexOf('ADMIN_DASHBOARD') !== -1 || ids.indexOf('INTERNAL_OPERATIONS_SYSTEM') !== -1,
  MOBILE: (ids) => ids.indexOf('MOBILE_APPLICATION') !== -1,
  DESKTOP: (ids) => ids.indexOf('DESKTOP_APPLICATION') !== -1,
  API: (ids) => ids.indexOf('API_SERVICE') !== -1,
};

function compileProductSurfaces(profileIds, intent) {
  const surfaces = [];
  Object.keys(SURFACE_RULES).forEach((name) => {
    if (SURFACE_RULES[name](profileIds, intent || {})) surfaces.push(name);
  });
  if (surfaces.length === 0) surfaces.push('PUBLIC');
  return surfaces;
}

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

  const relationships = [];
  const businessRules = [];
  const stateMachines = [];
  if (profileIds.indexOf('MULTI_TENANT_SAAS') !== -1) {
    relationships.push({ note: 'REQUIRES_DECISION: علاقة Tenant -> User (واحد لمتعدد أم متعدد لمتعدد عبر دعوات؟)' });
  }
  if (profileIds.indexOf('BOOKING_SYSTEM') !== -1) {
    businessRules.push({ note: 'REQUIRES_DECISION: سياسة الإلغاء/التأخير وحدودها الزمنية غير محددة في المدخلات' });
    stateMachines.push({ entity: 'Booking', note: 'REQUIRES_DECISION: الحالات الدقيقة (Pending/Confirmed/Cancelled/Completed) وشروط الانتقال بينها' });
  }
  if (profileIds.indexOf('FINANCIAL_SYSTEM') !== -1) {
    stateMachines.push({ entity: 'Transaction', note: 'REQUIRES_DECISION: حالات المعاملة الدقيقة وشروط الترحيل النهائي (posting)' });
  }

  const brownfield = assessBrownfield(intent, requiredRules);

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
    product_surfaces: compileProductSurfaces(profileIds, intent),
    information_architecture: 'INFERRED_DEFAULT — يُشتق من الـProfiles المختارة، يحتاج مراجعة بشرية قبل الاعتماد',

    domain_entities: domainEntities,
    relationships: relationships,
    business_rules: businessRules,
    state_machines: stateMachines,

    architecture_target: architecture,
    data_strategy: applicability.filter((r) => r.domain === 'DATA'),
    persistence_strategy: applicability.filter((r) => r.domain === 'DATA' || r.domain === 'BACKUP_RESTORE'),
    security_profile: applicability.filter((r) => r.domain === 'SECURITY' || r.domain === 'AUTHENTICATION' || r.domain === 'AUTHORIZATION'),
    privacy_profile: applicability.filter((r) => r.domain === 'PRIVACY'),
    integration_strategy: applicability.filter((r) => r.domain === 'INTEGRATIONS' || r.domain === 'API_CONTRACTS'),

    ux_requirements: applicability.filter((r) => r.domain === 'UX'),
    design_system_requirements: intent.advanced.design_references
      ? 'استخدام نظام التصميم المرجعي الذي حدده المستخدم: ' + intent.advanced.design_references
      : 'لا يوجد نظام تصميم مرجعي محدد من المستخدم؛ يُقترح نظام رموز تصميم (design tokens) عام بسيط — غير مُدمَج آليًا هنا بعد',
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
    _brownfield: brownfield, // null للمشاريع الجديدة؛ تقييم فجوات نصي للمشاريع القائمة
  };
}

module.exports = { compileBlueprint, guessDomainEntities, compileProductSurfaces };
