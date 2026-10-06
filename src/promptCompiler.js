'use strict';

/**
 * Renders the Master Development Prompt from Blueprint + Contracts.
 * Sections genuinely OMITTED when not applicable (section 21's closing rule) —
 * this is what proves the output isn't just a static template with name swapped.
 */
function renderMasterPrompt(blueprint, acceptanceContract, developmentContract) {
  const lines = [];
  const push = (s) => lines.push(s);

  push('# برومبت تطوير رئيسي — ' + blueprint.project_name);
  push('');
  push('## هوية المشروع والهدف');
  push('الاسم: ' + blueprint.project_name);
  push('الهدف: ' + blueprint.project_goal);
  push('');
  push('## تصنيف المشروع (استنتاج آلي — راجعه قبل الاعتماد)');
  blueprint.project_profiles.forEach((p) => push('- ' + p.profile_id + ' (ثقة ' + p.confidence + ') — ' + p.reason));
  push('');

  if (blueprint.product_surfaces && blueprint.product_surfaces.length) {
    push('## أسطح المنتج (Product Surfaces)');
    blueprint.product_surfaces.forEach((s) => push('- ' + s));
    push('');
  }

  if (blueprint.domain_entities && blueprint.domain_entities.length) {
    push('## الكيانات المستنتَجة (استدلال نصي بسيط — يحتاج تأكيد بشري)');
    blueprint.domain_entities.forEach((e) => push('- ' + (e.name || 'بدون اسم') + ' [' + e.status + '] ' + e.rationale));
    push('');
  }
  if (blueprint.relationships && blueprint.relationships.length) {
    push('## العلاقات بين الكيانات');
    blueprint.relationships.forEach((r) => push('- ' + r.note));
    push('');
  }
  if (blueprint.business_rules && blueprint.business_rules.length) {
    push('## قواعد العمل (Business Rules)');
    blueprint.business_rules.forEach((r) => push('- ' + r.note));
    push('');
  }
  if (blueprint.state_machines && blueprint.state_machines.length) {
    push('## آلات الحالة (State Machines)');
    blueprint.state_machines.forEach((s) => push('- ' + s.entity + ': ' + s.note));
    push('');
  }

  if (blueprint._brownfield) {
    const bf = blueprint._brownfield;
    push('## وضع المشروع القائم (Brownfield Mode)');
    push('الواقع الحالي: ' + JSON.stringify(bf.current_reality));
    push('### الحفاظ عليه (PRESERVE — افتراضي من وصف المستخدم)');
    bf.gap_assessment.preserve.forEach((p) => push('- ' + p.rule_id + ': ' + p.note));
    push('### إضافته (ADD — فجوة مُفترَضة)');
    bf.gap_assessment.add.forEach((a) => push('- ' + a.rule_id + ': ' + a.note));
    push(bf.note);
    push('');
  }

  if (blueprint.required_decisions.length) {
    push('## قرارات مطلوبة منك قبل المتابعة (لا تُخمَّن)');
    blueprint.required_decisions.forEach((d) => push('- ' + d.field + ': ' + d.rationale));
    push('');
  }
  if (blueprint.assumptions.length) {
    push('## افتراضات (ASSUMED — غير مؤكدة، راجعها)');
    blueprint.assumptions.forEach((a) => push('- ' + a.field + ' = ' + a.value + ' (' + a.rationale + ')'));
    push('');
  }

  push('## المعمارية المقترحة (' + blueprint.architecture_target.source + ')');
  push(blueprint.architecture_target.pattern + ' — ' + blueprint.architecture_target.reason);
  push('');

  push('## رحلات المستخدم');
  blueprint.user_journeys.forEach((j) => push('- ' + j.name + ': ' + j.steps.join(' → ')));
  push('');

  if (blueprint.security_profile.length) {
    push('## متطلبات الأمان والصلاحيات');
    blueprint.security_profile.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.data_strategy.length) {
    push('## استراتيجية البيانات');
    blueprint.data_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.ux_requirements.length) {
    push('## متطلبات تجربة المستخدم');
    blueprint.ux_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.performance_requirements.length) {
    push('## متطلبات الأداء');
    blueprint.performance_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.test_strategy.length) {
    push('## استراتيجية الاختبار');
    blueprint.test_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.browser_uat_strategy.length) {
    push('## اختبار القبول عبر المتصفح (UAT)');
    blueprint.browser_uat_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.backup_restore_requirements.length) {
    push('## النسخ الاحتياطي والاستعادة');
    blueprint.backup_restore_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }

  // Full-Production sections added with the extended registry. Only APPLICABLE entries are
  // printed (N/A rules stay visible in the Blueprint JSON with their rationale), and a
  // section with nothing applicable is omitted entirely rather than printed empty.
  const applicableOnly = (list) => (list || []).filter((r) => r.status !== 'NOT_APPLICABLE_WITH_RATIONALE');
  [
    ['privacy_profile', 'الخصوصية'],
    ['integration_strategy', 'التكاملات وواجهات الـAPI'],
    ['reliability_requirements', 'الموثوقية ووضع التدهور والتعافي'],
    ['observability_requirements', 'المراقبة (سجلات، مقاييس، تتبع، صحة، جاهزية، تنبيهات)'],
    ['release_strategy', 'الإصدار وفصل البيئات'],
    ['operations_requirements', 'التشغيل والدعم (Runbooks، الحوادث، أدلة الإنتاج)'],
  ].forEach(([field, title]) => {
    const items = applicableOnly(blueprint[field]);
    if (!items.length) return;
    push('## ' + title);
    items.forEach((r) => push('- [' + r.status + '] ' + r.id + ': ' + r.description));
    push('');
  });

  const rollbackItems = applicableOnly(blueprint.rollback_requirements);
  if (rollbackItems.length) {
    push('## التراجع (Rollback)');
    rollbackItems.forEach((r) =>
      push('- [' + r.status + '] ' + r.id + ': ' + r.description +
        ' | معيار القبول: ' + r.acceptance_criteria + ' | الدليل المطلوب: ' + r.required_evidence)
    );
    push('');
  }

  push('## بوابات القبول (Acceptance Gates)');
  acceptanceContract.gates.forEach((g) =>
    push('- [' + (g.blocking ? 'إلزامي' : 'اختياري') + '] ' + g.gate_id + ': ' + g.requirement +
      ' | المعيار: ' + g.acceptance_criteria + ' | الدليل: ' + g.required_evidence + ' | الحالة: ' + g.current_evidence_status)
  );
  push('');

  push('## عقد التطوير (Development Contract)');
  push('النطاق: ' + developmentContract.scope);
  if (developmentContract.architecture_constraints && developmentContract.architecture_constraints.length) {
    push('قيود معمارية: ' + developmentContract.architecture_constraints.map((c) => '[' + c.source_id + '] ' + c.constraint).join(' | '));
  }
  if (developmentContract.data_constraints && developmentContract.data_constraints.length) {
    push('قيود بيانات: ' + developmentContract.data_constraints.map((c) => '[' + c.source_id + '] ' + c.constraint).join(' | '));
  }
  if (developmentContract.security_constraints && developmentContract.security_constraints.length) {
    push('قيود أمان: ' + developmentContract.security_constraints.map((c) => '[' + c.source_id + '] ' + c.constraint).join(' | '));
  }
  push('');

  push('## ممنوعات صارمة (Prohibited Shortcuts)');
  blueprint.prohibited_shortcuts.forEach((s) => push('- ' + s));
  push('');

  push('## هدف جاهزية الإنتاج (ليس شهادة اكتمال)');
  push(blueprint.production_readiness_target.note);
  push('المجالات المغطاة: ' + blueprint.production_readiness_target.domains_covered.join('، '));
  push('');

  push('---');
  push('هذا البرومبت model-agnostic — صالح لأي نموذج ذكاء اصطناعي أو مطوّر بشري، دون أي تعليمات خاصة بمزوّد معيّن.');

  return lines.join('\n');
}

module.exports = { renderMasterPrompt };
