'use strict';

const { SCHEMA_VERSION } = require('./core');
const { getAcceptanceCriteria, EVIDENCE_STATUS_INITIAL } = require('./acceptanceCriteriaLibrary');

function buildAcceptanceContract(blueprint) {
  const gates = blueprint._all_applicability
    .filter((r) => r.status === 'REQUIRED' || r.status === 'OPTIONAL')
    .map((r) => {
      const ac = getAcceptanceCriteria(r);
      return {
        gate_id: r.id,
        domain: r.domain,
        requirement: r.description,
        applicability: r.status,
        acceptance_criteria: ac.criteria,
        required_evidence: ac.evidence,
        // GENERATOR_RUNTIME_STATE must not leak into GENERATED_PROJECT_EVIDENCE_STATE:
        // the generator defines targets only; nothing has been assessed yet.
        current_evidence_status: EVIDENCE_STATUS_INITIAL,
        evidence_source_type: ac.source_type,
        evidence_source_id: ac.source_id,
        blocking: r.status === 'REQUIRED',
        dependencies: [],
        target_status: 'DEFERRED_WITH_GATE',
      };
    });

  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    gates,
    brownfield_aware: blueprint._brownfield != null,
    generated_at: new Date().toISOString(),
  };
}

const DOMAIN_CONSTRAINTS = {
  MULTI_TENANT_SAAS: { architecture: 'كل استعلام يجب أن يتضمن tenant_id صريحًا', data: 'لا جدول بدون tenant_id إن كان يحمل بيانات خاصة بمستأجر', security: 'اختبار تلقائي يثبت عدم تسرب بيانات بين المستأجرين', ux: 'عرض واضح لاسم المستأجر الحالي في كل شاشة' },
  FINANCIAL_SYSTEM: { architecture: 'منطق الأعمال المالي معزول تمامًا عن طبقة العرض', data: 'سجل معاملات غير قابل للتعديل بعد الترحيل (immutable)', security: 'سجل تدقيق على كل عملية', ux: 'عرض دقيق للأرقام العشرية دون تقريب مُضلل' },
  LEGAL_SYSTEM: { architecture: 'فصل صلاحيات القراءة عن الكتابة للسجلات الحساسة', data: 'سلسلة حيازة (chain of custody) موثقة لكل وثيقة', security: 'لا وصول دون تسجيل في سجل التدقيق', ux: 'إفشاء تدريجي للمعلومات الحساسة فقط عند الحاجة' },
  AI_ASSISTANT: { architecture: 'مسار بديل عند فشل أو عدم تأكد نموذج الذكاء الاصطناعي', data: 'سياسة احتفاظ محددة لسجل المحادثات', security: 'وعي بمخاطر حقن التوجيهات', ux: 'عرض صريح لمستوى عدم اليقين عند الحاجة' },
};

function buildDevelopmentContract(blueprint) {
  const isBrownfield = blueprint._brownfield != null;
  const profileIds = blueprint.project_profiles.map((p) => p.profile_id);

  const architectureConstraints = [];
  const dataConstraints = [];
  const securityConstraints = [];
  const uxConstraints = [];
  profileIds.forEach((id) => {
    const c = DOMAIN_CONSTRAINTS[id];
    if (c) {
      architectureConstraints.push({ source_id: id, constraint: c.architecture });
      dataConstraints.push({ source_id: id, constraint: c.data });
      securityConstraints.push({ source_id: id, constraint: c.security });
      uxConstraints.push({ source_id: id, constraint: c.ux });
    }
  });

  const scope = isBrownfield
    ? `تعديل/استكمال مشروع قائم (${(blueprint._brownfield.current_reality.existing_repository) || 'بدون رابط مستودع'}) — ليس بناء من الصفر. راجع preserve/add في قسم BROWNFIELD قبل كتابة أي كود.`
    : 'تطوير ' + blueprint.project_name + ' وفق Blueprint المرفق فقط';

  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    scope,
    is_brownfield: isBrownfield,
    included_capabilities: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    excluded_scope: blueprint._all_applicability.filter((r) => r.status === 'NOT_APPLICABLE_WITH_RATIONALE').map((r) => r.id),
    dependencies: [],
    implementation_requirements: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.description),
    architecture_constraints: architectureConstraints,
    data_constraints: dataConstraints,
    security_constraints: securityConstraints,
    ux_constraints: uxConstraints,
    quality_gates: ['FORMAT/LINT=PASS', 'UNIT=PASS', 'SECURITY=PASS'],
    acceptance_gates: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    prohibited_shortcuts: blueprint.prohibited_shortcuts,
    expected_artifacts: isBrownfield
      ? ['تقرير فجوات (gap report) مطابق لقوائم add', 'تعديلات على الكود القائم دون كسر ما هو مذكور في preserve']
      : ['كود المشروع', 'اختبارات', 'README', 'تقرير إنجاز'],
    definition_of_done: 'كل Gate إلزامي (blocking=true) منفَّذ وله دليل فعلي، لا بالادعاء فقط',
    generated_at: new Date().toISOString(),
  };
}

module.exports = { buildAcceptanceContract, buildDevelopmentContract };
