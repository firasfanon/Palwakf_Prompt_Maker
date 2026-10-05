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

  push('## بوابات القبول (Acceptance Gates)');
  acceptanceContract.gates.filter((g) => g.blocking).forEach((g) => push('- [إلزامي] ' + g.gate_id + ': ' + g.requirement));
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
