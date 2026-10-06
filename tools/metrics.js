#!/usr/bin/env node
'use strict';
/**
 * tools/metrics.js — the ONE place the project's headline numbers are derived.
 * Docs must not hand-copy these (tests/run.js scans every doc against this output),
 * and humans can print them with:  node tools/metrics.js
 */
function computeMetrics() {
  const { PROFILE_REGISTRY, PROFILE_REGISTRY_DECISIONS } = require('../src/profileRegistry');
  const { RULES_REGISTRY } = require('../src/rulesRegistry');
  return {
    profiles_implemented: PROFILE_REGISTRY.length,
    profile_decisions: PROFILE_REGISTRY_DECISIONS.length,
    rules: RULES_REGISTRY.length,
    rule_domains: new Set(RULES_REGISTRY.map((r) => r.domain)).size,
  };
}

module.exports = { computeMetrics };

if (require.main === module) {
  console.log(JSON.stringify(computeMetrics(), null, 2));
}
