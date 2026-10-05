'use strict';

const { getApplicableRules } = require('./rulesRegistry');

/**
 * Classifies every rule in the registry (not just applicable ones) into
 * REQUIRED / OPTIONAL / NOT_APPLICABLE_WITH_RATIONALE for full transparency —
 * a non-applicable rule is an explicit decision, not a silent omission.
 */
const { RULES_REGISTRY } = require('./rulesRegistry');

function computeApplicability(profileIds, intent) {
  const applicableIds = new Set(getApplicableRules(profileIds, intent).map((r) => r.id));
  return RULES_REGISTRY.map((rule) => {
    if (applicableIds.has(rule.id)) {
      return { id: rule.id, domain: rule.domain, description: rule.description, status: rule.severity };
    }
    return {
      id: rule.id,
      domain: rule.domain,
      description: rule.description,
      status: 'NOT_APPLICABLE_WITH_RATIONALE',
      rationale: 'لا ينطبق على مزيج الـProfiles الحالي (' + profileIds.join(', ') + ')',
    };
  });
}

module.exports = { computeApplicability };
