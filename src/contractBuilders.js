'use strict';

const { SCHEMA_VERSION } = require('./core');

function buildAcceptanceContract(blueprint) {
  const gates = blueprint._all_applicability
    .filter((r) => r.status === 'REQUIRED' || r.status === 'OPTIONAL')
    .map((r) => ({
      gate_id: r.id,
      domain: r.domain,
      requirement: r.description,
      applicability: r.status,
      acceptance_criteria: 'يُحدَّد عند التنفيذ الفعلي لهذا المتطلب',
      required_evidence: 'UNKNOWN — لا دليل بعد؛ لم يُبنَ المشروع الفعلي',
      blocking: r.status === 'REQUIRED',
      dependencies: [],
      target_status: 'DEFERRED_WITH_GATE',
    }));

  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    gates,
    generated_at: new Date().toISOString(),
  };
}

function buildDevelopmentContract(blueprint) {
  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    scope: 'تطوير ' + blueprint.project_name + ' وفق Blueprint المرفق فقط',
    included_capabilities: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    excluded_scope: blueprint._all_applicability.filter((r) => r.status === 'NOT_APPLICABLE_WITH_RATIONALE').map((r) => r.id),
    dependencies: [],
    implementation_requirements: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.description),
    quality_gates: ['FORMAT/LINT=PASS', 'UNIT=PASS', 'SECURITY=PASS'],
    acceptance_gates: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    prohibited_shortcuts: blueprint.prohibited_shortcuts,
    expected_artifacts: ['كود المشروع', 'اختبارات', 'README', 'تقرير إنجاز'],
    definition_of_done: 'كل Gate إلزامي (blocking=true) منفَّذ وله دليل فعلي، لا بالادعاء فقط',
    generated_at: new Date().toISOString(),
  };
}

module.exports = { buildAcceptanceContract, buildDevelopmentContract };
