'use strict';

const { PROFILE_REGISTRY } = require('./profileRegistry');

/**
 * Deterministic keyword-heuristic classifier. NOT an AI/ML classifier — this is
 * explicit and tested, never silently presented as AI-driven inference.
 *
 * Returns an array of { profile_id, confidence, reason, source } — source is
 * ALWAYS 'INFERRED_DEFAULT', per the governing invariant INFERRED != USER_REQUIREMENT.
 * The caller (UI) must let the user edit/reject before generation (section 7).
 */
function classifyProject(intent) {
  const haystack = ((intent.project_name || '') + ' ' + (intent.project_goal || ''))
    .toLowerCase();

  const matches = [];
  for (const profile of PROFILE_REGISTRY) {
    const hits = profile.triggers.keywords.filter((kw) => haystack.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      // Confidence: simple, explainable — more distinct keyword hits = higher.
      // Capped at 0.9 because this is a heuristic, never a certainty.
      const confidence = Math.min(0.9, 0.5 + hits.length * 0.15);
      matches.push({
        profile_id: profile.id,
        confidence: Math.round(confidence * 100) / 100,
        reason: 'عُثر على الكلمات المفتاحية: ' + hits.join('، '),
        source: 'INFERRED_DEFAULT',
      });
    }
  }

  // Explicit advanced-input overrides (still INFERRED_DEFAULT, not CONFIRMED, because
  // the profile itself is our interpretation even when the signal is a direct field).
  if (intent.advanced && intent.advanced.multi_tenancy === 'yes') {
    if (!matches.find((m) => m.profile_id === 'MULTI_TENANT_SAAS')) {
      matches.push({
        profile_id: 'MULTI_TENANT_SAAS',
        confidence: 0.85,
        reason: 'الحقل المتقدم "تعدد المستأجرين" = نعم',
        source: 'INFERRED_DEFAULT',
      });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return [
      {
        profile_id: 'WEB_APPLICATION',
        confidence: 0.3,
        reason: 'لم يُعثر على كلمات مفتاحية واضحة — تصنيف افتراضي عام منخفض الثقة، يُنصح بالمراجعة اليدوية',
        source: 'INFERRED_DEFAULT',
      },
    ];
  }

  return matches;
}

module.exports = { classifyProject };
