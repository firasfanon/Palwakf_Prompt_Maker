'use strict';
/**
 * brownfieldEngine.js — text-based (NOT code-inspection-based) gap
 * assessment for an existing project. Compares the user's own free-text
 * description of existing_capabilities against the computed required
 * rules. Honestly documented: this produces ASSUMED, not CONFIRMED,
 * preserve/add lists, because no real source code is inspected here.
 */
function assessBrownfield(intent, requiredRules) {
  const adv = intent.advanced || {};
  if (!adv.existing_project) return null;

  const existingText = (adv.existing_capabilities || '').toLowerCase();
  const preserve = [];
  const add = [];

  requiredRules.forEach((rule) => {
    const descWords = rule.description.toLowerCase();
    const mentioned = existingText.length > 0 && (
      existingText.indexOf(rule.id.toLowerCase()) !== -1 ||
      descWords.split(' ').some((w) => w.length > 4 && existingText.indexOf(w) !== -1)
    );
    if (mentioned) {
      preserve.push({ rule_id: rule.id, note: 'المستخدم ذكر ما يشبه هذا ضمن existing_capabilities (ASSUMED، غير مؤكد من كود حقيقي)' });
    } else {
      add.push({ rule_id: rule.id, note: 'لم يُذكر في existing_capabilities؛ يُفترض أنه فجوة (ASSUMED)' });
    }
  });

  return {
    mode: 'EXISTING_PROJECT',
    current_reality: {
      existing_repository: adv.existing_repository || null,
      existing_architecture: adv.existing_architecture || null,
      existing_stack: adv.existing_stack || [],
      existing_tests: adv.existing_tests || null,
      known_gaps_stated_by_user: adv.known_gaps || null
    },
    gap_assessment: {
      preserve,
      add,
      refine: [], // honestly empty: no real code inspection available
      remove_only_with_reason: [] // honestly empty: same reason
    },
    note: 'هذا تقييم نصي (Text-based) يعتمد كليًا على وصف المستخدم لما هو موجود حاليًا (existing_capabilities)، وليس فحصًا فعليًا للكود المصدري. قوائم preserve/add هي ASSUMED لا CONFIRMED. refine وremove_only_with_reason تُركا خاليين عمدًا لعدم توفر فحص كود حقيقي في هذه البيئة.'
  };
}

module.exports = { assessBrownfield };
