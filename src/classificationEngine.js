'use strict';

const { PROFILE_REGISTRY } = require('./profileRegistry');

const SENSITIVE_CONFIDENCE_CAP = 0.55;

/**
 * Deterministic keyword-heuristic classifier. NOT an AI/ML classifier — this is
 * explicit and tested, never silently presented as AI-driven inference.
 *
 * Returns an array of { profile_id, confidence, reason, evidence, source } —
 * source is ALWAYS 'INFERRED_DEFAULT', per the governing invariant
 * INFERRED != USER_REQUIREMENT. The caller (UI) must let the user edit/reject
 * before generation (section 7).
 *
 * v2 (gap-closing batch): adds negative-keyword suppression and a confidence
 * cap for `sensitive` profiles (FINANCIAL_SYSTEM, LEGAL_SYSTEM) — this is the
 * real fix for the previously-documented false positive where "فواتير" inside
 * a clinic/booking context used to wrongly trigger FINANCIAL_SYSTEM. Also adds
 * a specificity tie-break so a more specific profile (e.g. MULTI_TENANT_SAAS,
 * PUBLIC_PORTAL) outranks a more generic one (WEB_SAAS, WEB_APPLICATION) when
 * both match overlapping text with otherwise-equal confidence.
 */
function classifyProject(intent) {
  const haystack = ((intent.project_name || '') + ' ' + (intent.project_goal || '') + ' ' +
    ((intent.advanced && intent.advanced.special_constraints) || ''))
    .toLowerCase();

  const matches = [];
  for (const profile of PROFILE_REGISTRY) {
    const kws = profile.triggers.keywords || [];
    const negKws = (profile.triggers && profile.triggers.negative_keywords) || [];
    const evidence = kws.filter((kw) => haystack.includes(kw.toLowerCase()));
    if (evidence.length === 0) continue;

    const negHits = negKws.filter((nk) => haystack.includes(nk.toLowerCase()));
    if (profile.triggers.sensitive && negHits.length > 0 && evidence.length <= negHits.length) {
      // Negative-signal suppression: a sensitive profile with weak/ambiguous
      // evidence outweighed by contextual negative signals is not reported at all.
      continue;
    }

    let confidence = Math.min(0.9, 0.5 + evidence.length * 0.15);
    if (profile.triggers.sensitive && evidence.length === 1) {
      confidence = Math.min(confidence, SENSITIVE_CONFIDENCE_CAP);
    }

    matches.push({
      profile_id: profile.id,
      confidence: Math.round(confidence * 100) / 100,
      reason: 'عُثر على الكلمات المفتاحية: ' + evidence.join('، '),
      evidence,
      source: 'INFERRED_DEFAULT',
    });
  }

  // Explicit advanced-input overrides (still INFERRED_DEFAULT, not CONFIRMED, because
  // the profile itself is our interpretation even when the signal is a direct field).
  if (intent.advanced && intent.advanced.multi_tenancy === 'yes') {
    const existing = matches.find((m) => m.profile_id === 'MULTI_TENANT_SAAS');
    if (existing) {
      existing.confidence = Math.max(existing.confidence, 0.85);
    } else {
      matches.push({
        profile_id: 'MULTI_TENANT_SAAS',
        confidence: 0.85,
        reason: 'الحقل المتقدم "تعدد المستأجرين" = نعم',
        evidence: [],
        source: 'INFERRED_DEFAULT',
      });
    }
  }

  function maxEvidenceLength(m) {
    return m.evidence.reduce((max, kw) => Math.max(max, kw.length), 0);
  }
  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return maxEvidenceLength(b) - maxEvidenceLength(a);
  });

  if (matches.length === 0) {
    return [
      {
        profile_id: 'WEB_APPLICATION',
        confidence: 0.3,
        reason: 'لم يُعثر على كلمات مفتاحية واضحة — تصنيف افتراضي عام منخفض الثقة، يُنصح بالمراجعة اليدوية',
        evidence: [],
        source: 'INFERRED_DEFAULT',
      },
    ];
  }

  return matches;
}

module.exports = { classifyProject, SENSITIVE_CONFIDENCE_CAP };
