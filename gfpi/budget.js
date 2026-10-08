'use strict';

/**
 * ProviderBudgetPolicyV1 behaviour. MB1 default: ZERO external paid budget, PAID_PROVIDER_CALLS NOT_AUTHORIZED.
 * A policy only authorizes spending when it carries approved_by + approved_at AND a credential_ref AND positive caps.
 * Deterministic: no clock inside (the caller passes `now`), no network.
 */
function defaultBudgetPolicy() {
  return {
    scope: 'DEVELOPMENT', currency: 'USD', per_call_cap: 0, per_project_cap: 0, period_cap: 0,
    token_caps: { input_per_call: 0, output_per_call: 0 }, approved_by: null, approved_at: null, credential_ref: null,
  };
}

function newUsage() { return { calls: 0, input_tokens: 0, output_tokens: 0, cost: 0, refusals: 0, by_provider: {} }; }

function authorizesPaid(policy) {
  return !!(policy && policy.approved_by && policy.approved_at && policy.credential_ref && policy.per_call_cap > 0 && policy.per_project_cap > 0 && policy.period_cap > 0);
}

/**
 * estimate: {input_tokens, max_output_tokens, cost}. Local/manual providers are free and never consume the paid budget.
 */
function checkBudget(policy, usage, estimate, providerLocality) {
  if (providerLocality === 'LOCAL' || providerLocality === 'NONE') return { allowed: true, reason: null, paid: false };
  if (!authorizesPaid(policy)) return { allowed: false, reason: 'PAID_CALLS_NOT_AUTHORIZED', paid: true };
  if (estimate.cost > policy.per_call_cap) return { allowed: false, reason: 'PER_CALL_CAP_EXCEEDED', paid: true };
  if (usage.cost + estimate.cost > policy.per_project_cap) return { allowed: false, reason: 'PROJECT_CAP_EXCEEDED', paid: true };
  if (usage.cost + estimate.cost > policy.period_cap) return { allowed: false, reason: 'PERIOD_CAP_EXCEEDED', paid: true };
  if (estimate.input_tokens > policy.token_caps.input_per_call) return { allowed: false, reason: 'INPUT_TOKEN_CAP_EXCEEDED', paid: true };
  if (estimate.max_output_tokens > policy.token_caps.output_per_call) return { allowed: false, reason: 'OUTPUT_TOKEN_CAP_EXCEEDED', paid: true };
  return { allowed: true, reason: null, paid: true };
}

function recordUsage(usage, providerId, actual) {
  const u = JSON.parse(JSON.stringify(usage));
  u.calls += 1; u.input_tokens += actual.input_tokens || 0; u.output_tokens += actual.output_tokens || 0; u.cost += actual.cost || 0;
  const p = u.by_provider[providerId] || { calls: 0, cost: 0 };
  p.calls += 1; p.cost += actual.cost || 0; u.by_provider[providerId] = p;
  return u;
}
function recordRefusal(usage) { const u = JSON.parse(JSON.stringify(usage)); u.refusals += 1; return u; }

function estimateTokens(text) { return Math.ceil(String(text).length / 3); }

module.exports = { defaultBudgetPolicy, newUsage, authorizesPaid, checkBudget, recordUsage, recordRefusal, estimateTokens };
