'use strict';

/**
 * Derived Full-Production artifacts (additive): NFRContractV1, CostModelV1, ThreatModelV1, DataLifecycleModelV1,
 * DeploymentTopologyV1, ProductionEvidenceContractV1, ArchitectureDecisionRecordV1, AIProductionProfileV1, BuildVsBuyAnalysisV1.
 *
 * Rules shared by all of them:
 *  - every field names its source decision and carries that decision's status (CONFIRMED | AI_RECOMMENDED_PENDING_APPROVAL |
 *    UNRESOLVED | NOT_APPLICABLE_WITH_RATIONALE | DEFERRED_WITH_GATE); a recommendation is never presented as confirmed;
 *  - numeric values appear only as the definition of a tier the user/pending recommendation selected; unanswered => null, never invented;
 *  - evidence is DEFINED here, never fabricated.
 */

const C = require('./catalog');
const K = require('./common');
const { sha256OfValue } = require('../canon');
const { view, combine, live } = K;
const mk = (type, ctx, fields, refs) => K.makeProdArtifact(type, { artifact_id: ctx.project_id + ':' + type + ':' + ctx.head.slice(0, 12), project_id: ctx.project_id, created_at: ctx.created_at, producer: ctx.producer, references: refs || [], fields });
const baseVal = (ctx, id) => { const s = ctx.baseStates && ctx.baseStates[id]; return s && (s.state === 'USER_CONFIRMED' || s.state === 'USER_EDITED') ? s.value : null; };

/* ---------------- NFRContractV1 ---------------- */
const NFR_MAP = [
  ['availability', ['nfr_availability'], (v) => v.fx.availability_pct !== undefined ? { availability_pct_monthly: v.fx.availability_pct } : null],
  ['latency_p95', ['nfr_performance'], (v) => v.fx.latency_p95_ms ? { latency_p95_ms: v.fx.latency_p95_ms } : null],
  ['throughput', ['nfr_scale'], null], ['concurrency', ['nfr_scale'], null], ['capacity', ['nfr_scale'], (v) => v.fx.users_12m ? { active_users_12m_upper_bound: v.fx.users_12m } : null],
  ['durability', ['backup_policy', 'nfr_data_loss_rpo'], (v, all) => ({ backup_mode: all[0].fx.backup || null, rpo: all[1] && all[1].fx.rpo || null })],
  ['rto', ['nfr_recovery_time_rto'], (v) => v.fx.rto ? { rto: v.fx.rto } : null], ['rpo', ['nfr_data_loss_rpo'], (v) => v.fx.rpo ? { rpo: v.fx.rpo } : null],
  ['backup_frequency', ['backup_policy'], (v) => ({ backup_mode: v.fx.backup || null })], ['restore_objectives', ['restore_drill', 'nfr_recovery_time_rto'], (v, all) => ({ restore_drill: all[0].value, rto: all[1] && all[1].fx.rto || null })],
  ['scaling_expectations', ['nfr_scale'], (v) => v.fx.users_12m ? { growth_tier: v.value } : null], ['rate_limits', ['rate_limit_abuse'], (v) => ({ policy: v.value })],
  ['accessibility', ['accessibility_l10n'], (v) => ({ target: v.value })], ['security_objectives', ['security_threat_assumptions', 'identity_method', 'secrets_key_management'], (v, all) => ({ threat_posture: all[0].value, identity: all[1] && all[1].value, secrets: all[2] && all[2].value })],
  ['privacy_objectives', ['privacy_compliance', 'data_classes'], (v, all) => ({ regime: all[0].value, data_classes: all[1] && all[1].value })], ['data_retention', ['retention_deletion'], (v) => ({ policy: v.value })],
  ['observability', ['observability'], (v) => ({ level: v.value })], ['support_expectations', ['incident_response', 'support_admin_surface'], (v, all) => ({ incident: all[0].value, support_surface: all[1] && all[1].value })],
];
function buildNFRContract(ctx) {
  const targets = NFR_MAP.map(([nfr, ids, fn]) => {
    const liveIds = ids.filter((id) => live(ctx.profile, ctx.states, id)); const vs = liveIds.map((id) => view(ctx.states, id));
    if (!vs.length) return { nfr, status: 'NOT_APPLICABLE_WITH_RATIONALE', value: null, source_items: ids };
    const status = combine(vs);
    const derivable = fnResult(fn, vs[0], vs);
    const derivedOnlyFromScale = (nfr === 'throughput' || nfr === 'concurrency');
    return { nfr, status: derivedOnlyFromScale && status === 'CONFIRMED' ? 'CONFIRMED_TIER_REQUIRES_LOAD_MODEL' : status,
      value: status === 'UNRESOLVED' ? null : (derivedOnlyFromScale ? null : derivable), recommended_only: status === 'AI_RECOMMENDED_PENDING_APPROVAL',
      note: derivedOnlyFromScale ? 'No numeric throughput/concurrency target is derived from a user-count tier alone; a load model must be agreed and confirmed.' : (status === 'UNRESOLVED' ? 'No value is invented for an unanswered item.' : null),
      source_items: liveIds.map((id, i) => ({ item_id: id, status: vs[i].status, ledger_seq: vs[i].ledger_seq })) };
  });
  return mk('NFRContractV1', ctx, { targets, unresolved_targets: targets.filter((t) => t.status === 'UNRESOLVED').map((t) => t.nfr), pending_recommendation_targets: targets.filter((t) => t.status === 'AI_RECOMMENDED_PENDING_APPROVAL').map((t) => t.nfr),
    statement: 'Tier values are definitions of the tier selected; an unanswered or merely recommended target is never presented as agreed.' });
}
function fnResult(fn, v, all) { if (!fn) return null; try { return fn(v, all); } catch (e) { return null; } }

/* ---------------- ThreatModelV1 ---------------- */
function buildThreatModel(ctx) {
  const P = ctx.profile; const S = ctx.states; const mt = live(P, S, 'tenant_isolation'); const bill = live(P, S, 'payment_failure_policy'); const ai = live(P, S, 'ai_evaluation_plan');
  const st = (id) => view(S, id);
  const mit = (control, id) => { const v = id ? st(id) : null; return { control, source_item: id || null, status: v ? v.status : 'REQUIRED_BY_PROFILE', decision_value: v ? v.value : null }; };
  const assets = [{ asset: 'customer_data', why: 'Core product data' }, { asset: 'credentials_and_secrets', why: 'Session tokens, API keys, signing keys' }, { asset: 'audit_log', why: 'Integrity of accountability' }, { asset: 'service_availability', why: 'Customers depend on uptime' }];
  if (mt) assets.push({ asset: 'tenant_boundary', why: 'Customer A must never see customer B' });
  if (bill) assets.push({ asset: 'billing_and_payment_records', why: 'Financial integrity' });
  if (ai) assets.push({ asset: 'prompts_context_and_model_outputs', why: 'May contain customer data; may be attacker-influenced' });
  const actors = [{ actor: 'anonymous_attacker' }, { actor: 'authenticated_user_of_a_tenant' }, { actor: 'malicious_or_compromised_tenant_admin' }, { actor: 'malicious_insider_or_support_operator' }, { actor: 'compromised_third_party_provider' }, { actor: 'automated_abuse_bot' }];
  const boundaries = ['browser_to_api', 'api_to_database', 'api_to_third_party_providers', 'operator_console_to_customer_data'];
  const entry = ['public_web_pages', 'authenticated_api', 'sign_in_and_recovery_flows', 'file_or_data_import'];
  const surfaces = ['session_management', 'input_validation', 'authorization_checks', 'secrets_handling', 'dependency_supply_chain'];
  const threats = [
    { threat_id: 'T-AUTH-01', category: 'Spoofing', description: 'Credential stuffing / account takeover', applies_because: 'always', mitigations: [mit('MFA for privileged roles, lockout, rate limiting', 'identity_method'), mit('Rate limits', 'rate_limit_abuse')] },
    { threat_id: 'T-AUTHZ-01', category: 'Elevation of privilege', description: 'Broken access control / privilege escalation', applies_because: 'always', mitigations: [mit('Server-side authorization on every request', 'authorization_model')] },
    { threat_id: 'T-DATA-01', category: 'Information disclosure', description: 'Sensitive data exposure at rest or in transit', applies_because: 'always', mitigations: [mit('Encryption at rest and in transit; data classification', 'data_classes')] },
    { threat_id: 'T-SEC-01', category: 'Information disclosure', description: 'Secret leakage in code, logs or CI', applies_because: 'always', mitigations: [mit('Vault + rotation; secret scanning', 'secrets_key_management')] },
    { threat_id: 'T-REP-01', category: 'Repudiation', description: 'Actions without an attributable record', applies_because: 'always', mitigations: [mit('Append-only audit trail', 'audit_trail')] },
    { threat_id: 'T-DOS-01', category: 'Denial of service', description: 'Resource exhaustion / abuse', applies_because: 'always', mitigations: [mit('Rate limits and quotas', 'rate_limit_abuse')] },
    { threat_id: 'T-OPS-01', category: 'Tampering', description: 'Destructive administrator mistake or insider action', applies_because: 'always', mitigations: [mit('Audited admin access, backups, restore drills', 'support_admin_surface'), mit('Backups', 'backup_policy')] },
  ];
  if (mt) threats.push(
    { threat_id: 'T-MT-01', category: 'Information disclosure', description: 'Cross-tenant data access through a missing or wrong tenant filter/policy', applies_because: 'multi-tenant', mitigations: [mit('Tenant isolation control', 'tenant_isolation')], acceptance_test: 'negative cross-tenant read/write tests on every tenant-scoped resource' },
    { threat_id: 'T-MT-02', category: 'Elevation of privilege', description: 'Tenant admin acts outside own tenant (IDOR / role confusion)', applies_because: 'multi-tenant', mitigations: [mit('Tenant-scoped authorization', 'authorization_model')], acceptance_test: 'authorization matrix tests incl. cross-tenant IDs' },
    { threat_id: 'T-MT-03', category: 'Denial of service', description: 'Noisy tenant exhausts shared resources', applies_because: 'multi-tenant', mitigations: [mit('Per-tenant quotas and limits', 'entitlements_quotas')] },
    { threat_id: 'T-MT-04', category: 'Information disclosure', description: 'Leak through shared backups, exports or deletion gaps', applies_because: 'multi-tenant', mitigations: [mit('Tenant export/deletion lifecycle', 'tenant_lifecycle'), mit('Backup boundaries', 'backup_policy')] });
  if (bill) threats.push(
    { threat_id: 'T-BILL-01', category: 'Tampering', description: 'Forged or replayed payment webhook', applies_because: 'billing', mitigations: [mit('Signature verification, idempotency keys', 'payment_failure_policy')] },
    { threat_id: 'T-BILL-02', category: 'Tampering', description: 'Entitlement bypass (using a plan not paid for)', applies_because: 'billing', mitigations: [mit('Server-side entitlement enforcement', 'entitlements_quotas')] });
  if (ai) threats.push(
    { threat_id: 'T-AI-01', category: 'Tampering', description: 'Prompt injection from untrusted content', applies_because: 'ai-native', mitigations: [mit('Untrusted-content isolation, least privilege, output filtering', 'ai_injection_exfiltration')], acceptance_test: 'injection test suite with expected refusals' },
    { threat_id: 'T-AI-02', category: 'Information disclosure', description: 'Exfiltration of another tenant\'s or personal data through the model', applies_because: 'ai-native', mitigations: [mit('PII policy and tenant-scoped retrieval', 'ai_pii_policy')] },
    { threat_id: 'T-AI-03', category: 'Elevation of privilege', description: 'Model-driven actions beyond the caller\'s permissions', applies_because: 'ai-native', mitigations: [mit('Tool allow-list per role + human approval', 'ai_tool_permissions')] },
    { threat_id: 'T-AI-04', category: 'Tampering', description: 'Malformed or adversarial model output consumed downstream', applies_because: 'ai-native', mitigations: [mit('Schema validation, fail closed', 'ai_structured_output')] },
    { threat_id: 'T-AI-05', category: 'Denial of service', description: 'Cost exhaustion through token abuse', applies_because: 'ai-native', mitigations: [mit('Per-tenant token budgets and rate limits', 'ai_budget_rate')] });
  threats.forEach((t) => {
    const unconfirmed = t.mitigations.filter((m) => m.status !== 'CONFIRMED' && m.status !== 'NOT_APPLICABLE_WITH_RATIONALE');
    t.residual_risk = unconfirmed.length ? { level: 'UNMITIGATED_PENDING_DECISION', because: unconfirmed.map((m) => m.source_item || m.control) } : { level: 'RESIDUAL_AFTER_CONFIRMED_MITIGATION', note: 'Residual risk persists until the mitigation is implemented and evidenced.' };
  });
  return mk('ThreatModelV1', ctx, { protected_assets: assets, actors, trust_boundaries: boundaries.concat(mt ? ['tenant_to_tenant'] : [], ai ? ['application_to_model_provider', 'untrusted_content_to_prompt'] : []), entry_points: entry, attack_surfaces: surfaces.concat(ai ? ['prompt_and_tool_surface'] : []),
    abuse_cases: threats.map((t) => ({ abuse_case_id: 'A-' + t.threat_id.slice(2), threat_id: t.threat_id, scenario: t.description })), threats, mitigations: threats.reduce((a, t) => a.concat(t.mitigations.map((m) => Object.assign({ threat_id: t.threat_id }, m))), []),
    residual_risks: threats.filter((t) => t.residual_risk.level === 'UNMITIGATED_PENDING_DECISION').map((t) => ({ threat_id: t.threat_id, because: t.residual_risk.because })),
    acceptance_tests: threats.filter((t) => t.acceptance_test).map((t) => ({ threat_id: t.threat_id, test: t.acceptance_test })).concat([{ threat_id: 'T-AUTHZ-01', test: 'authorization matrix per role' }]),
    evidence_requirements: ['SECURITY_TESTED'].concat(mt ? ['TENANT_ISOLATION_READY'] : [], ai ? ['AI_FEATURE_PRODUCTION_READY'] : []),
    architecture_aware: { multi_tenant_cross_tenant_threats_included: mt, ai_specific_threats_included: ai, billing_threats_included: bill } });
}

/* ---------------- DataLifecycleModelV1 ---------------- */
function buildDataLifecycle(ctx) {
  const P = ctx.profile; const S = ctx.states; const mt = live(P, S, 'tenant_isolation'); const sens = baseVal(ctx, 'data_sensitivity');
  const entities = K.asList(baseVal(ctx, 'data_entities'));
  const classes = entities.map((e) => ({ name: e, origin: 'USER_STATED_ENTITY' }));
  classes.push({ name: 'identity_and_credentials', origin: 'SYSTEM_REQUIRED' }, { name: 'audit_log', origin: 'SYSTEM_REQUIRED' }, { name: 'operational_telemetry', origin: 'SYSTEM_REQUIRED' });
  if (live(P, S, 'payment_failure_policy')) classes.push({ name: 'billing_and_payment_records', origin: 'SYSTEM_REQUIRED_BY_BILLING' });
  if (live(P, S, 'ai_evaluation_plan')) classes.push({ name: 'ai_prompts_context_outputs', origin: 'SYSTEM_REQUIRED_BY_AI' });
  const f = (id) => { const v = view(S, id); return { value: v.value, status: v.status, source_item: id }; };
  const out = classes.map((c) => ({
    data_class: c.name, class_origin: c.origin, source: { value: c.origin === 'USER_STATED_ENTITY' ? 'USER_INPUT_OR_IMPORT (to be confirmed)' : 'SYSTEM_GENERATED', status: 'UNRESOLVED_UNTIL_CONFIRMED' },
    owner: f('data_classes'), tenant_scope: { value: mt ? 'PER_TENANT' : (live(P, S, 'tenant_isolation') ? 'UNKNOWN' : 'SINGLE_ORGANIZATION'), status: view(S, 'tenancy_model').status, source_item: 'tenancy_model' },
    sensitivity: { value: sens || null, status: sens ? 'CONFIRMED' : 'UNRESOLVED', source_item: 'data_sensitivity (frozen item)' },
    storage_location: { value: baseVal(ctx, 'hosting_target'), status: baseVal(ctx, 'hosting_target') ? 'CONFIRMED' : 'UNRESOLVED', source_item: 'hosting_target (frozen item)' },
    encryption_requirements: { value: ['TLS in transit', 'encryption at rest by the storage layer'].concat(sens === 'FINANCIAL_OR_HEALTH' || sens === 'GOVERNMENT_SENSITIVE' ? ['field-level protection to be assessed for the most sensitive attributes'] : []), status: 'REQUIRED_BY_PROFILE' },
    access_policy: f('authorization_model'), retention: f('retention_deletion'), deletion: mt ? f('tenant_lifecycle') : f('retention_deletion'), export: mt ? f('tenant_lifecycle') : { value: null, status: 'UNRESOLVED', source_item: null },
    backup: f('backup_policy'), restore: f('restore_drill'), residency: { value: null, status: 'UNRESOLVED_REQUIRES_LEGAL_INPUT', source_item: 'privacy_compliance' }, auditability: f('audit_trail'), legal_or_policy_constraints: f('privacy_compliance'),
  }));
  return mk('DataLifecycleModelV1', ctx, { data_classes: out, schema_alone_is_not_data_architecture: true, unresolved_fields: out.reduce((n, c) => n + Object.keys(c).filter((k) => c[k] && typeof c[k] === 'object' && /UNRESOLVED/.test(String(c[k].status))).length, 0) });
}

/* ---------------- DeploymentTopologyV1 ---------------- */
function buildDeploymentTopology(ctx) {
  const S = ctx.states; const envsV = view(S, 'deployment_envs'); const envs = envsV.fx.envs || null;
  const g = (id) => { const v = view(S, id); return { value: v.value, status: v.status, source_item: id }; };
  const per = (envs || []).map((e) => ({ environment: e, purpose: { local: 'developer machines', preview: 'per-change review', staging: 'production-like rehearsal', production: 'customers' }[e],
    data_policy: e === 'production' ? 'real data; restricted access' : 'no production data; synthetic or masked only', secret_boundary: 'separate secrets per environment; never shared with production', domain_tls: e === 'local' ? null : g('domain_tls'), health_checks: 'REQUIRED', monitoring_alerting: e === 'production' || e === 'staging' ? g('observability') : null,
    backup_restore: e === 'production' ? { backup: g('backup_policy'), restore_drill: g('restore_drill') } : null }));
  return mk('DeploymentTopologyV1', ctx, { environments: envs ? per : [], environments_status: envsV.status, provider_selection_is_not_topology: true, provider_selection_note: 'Choosing a hosting/database provider does not define environments, domains, secrets, pipelines, health checks, rollback, monitoring or ownership; each is listed here with the decision that must supply it.',
    domains_tls_dns: g('domain_tls'), ci: g('ci_cd'), cd_with_approval: g('ci_cd'), migration_sequencing: g('migration_rollback'), rollback: { value: g('migration_rollback').value, status: g('migration_rollback').status, requirement: 'rollback rehearsal on staging before production' },
    monitoring_alerting: g('observability'), backup_restore: { backup: g('backup_policy'), restore_drill: g('restore_drill'), disaster_recovery: g('continuity_dr') }, deployment_ownership: g('deployment_ownership'), secrets: g('secrets_key_management'),
    open_gaps: ['deployment_envs', 'domain_tls', 'ci_cd', 'migration_rollback', 'observability', 'backup_policy', 'restore_drill', 'deployment_ownership', 'secrets_key_management'].filter((id) => view(S, id).status !== 'CONFIRMED') });
}

/* ---------------- CostModelV1 ---------------- */
const PRESSURE = { DATABASE_PER_TENANT: 'VERY_HIGH', SCHEMA_PER_TENANT: 'HIGH', RLS_SHARED_SCHEMA: 'LOW', CRITICAL_99_95: 'VERY_HIGH', HIGH_99_9: 'HIGH', STANDARD_99_5: 'MEDIUM', BEST_EFFORT: 'LOW', ACTIVE_ACTIVE_MULTI_REGION: 'VERY_HIGH', WARM_STANDBY_SECOND_REGION: 'HIGH',
  SINGLE_REGION_WITH_OFFSITE_BACKUPS: 'LOW', AUDIT_FULL_READ_AND_WRITE: 'HIGH', AUDIT_ADMIN_AND_DATA_CHANGES: 'MEDIUM', AUDIT_SECURITY_EVENTS_ONLY: 'LOW', LOGS_METRICS_TRACES_ALERTS: 'HIGH', LOGS_METRICS_ALERTS: 'MEDIUM', NONE_ACCEPTABLE: 'VERY_HIGH', MINUTES_UP_TO_5: 'HIGH', DAILY_AUTOMATED_PLUS_PITR: 'MEDIUM' };
function buildCostModel(ctx) {
  const P = ctx.profile; const S = ctx.states; const ceiling = view(S, 'cost_budget');
  const comp = (component, applicable, drivers, assumptionsNeeded) => ({ component, applicable, driver_items: drivers, estimate_status: 'NOT_ESTIMATED', estimate: null, assumptions_needed: assumptionsNeeded,
    relative_pressure: drivers.map((d) => { const v = view(S, d); return { item_id: d, status: v.status, pressure: PRESSURE[v.value] || null }; }).filter((x) => x.pressure) });
  const components = [
    comp('fixed_infrastructure', true, ['deployment_envs', 'continuity_dr'], ['provider and region', 'number of environments']), comp('variable_infrastructure', true, ['nfr_scale', 'nfr_availability'], ['traffic profile', 'peak/average ratio']),
    comp('cost_per_tenant', live(P, S, 'tenant_isolation') ? true : 'CONDITIONAL', ['tenant_isolation', 'tenancy_model'], ['expected active tenants', 'data per tenant']), comp('cost_per_active_user', true, ['nfr_scale'], ['active-user definition', 'usage per user']), comp('cost_per_request', true, ['nfr_performance', 'nfr_scale'], ['requests per user per day']),
    comp('database_storage_growth', true, ['audit_trail', 'backup_policy', 'data_classes'], ['rows per entity', 'retention period']), comp('bandwidth_egress', true, ['nfr_scale'], ['asset sizes', 'download volume']), comp('email_sms', live(P, S, 'notifications_policy') ? true : 'CONDITIONAL', ['notifications_policy'], ['messages per user per month']),
    comp('payment_fees', live(P, S, 'payment_failure_policy') ? true : 'CONDITIONAL', ['billing_model'], ['pricing', 'volume', 'provider fee schedule']), comp('third_party_apis', true, ['integrations_resilience', 'build_vs_buy'], ['which providers', 'their pricing tiers']),
    comp('ai_token_inference', live(P, S, 'ai_budget_rate') ? true : 'CONDITIONAL', ['ai_budget_rate', 'ai_provider_abstraction'], ['model choice', 'tokens per task', 'tasks per user']), comp('gpu_local_compute', 'CONDITIONAL', ['ai_provider_abstraction'], ['only if self-hosting models']),
    comp('observability', true, ['observability'], ['log volume', 'retention']), comp('backup', true, ['backup_policy', 'nfr_data_loss_rpo'], ['database size', 'retention']), comp('support_operational_burden', true, ['incident_response', 'support_admin_surface', 'deployment_ownership'], ['staffing model'])];
  const warnings = [];
  ['tenant_isolation', 'nfr_availability', 'continuity_dr', 'audit_trail', 'observability', 'nfr_data_loss_rpo'].forEach((id) => { const v = view(S, id); const pr = PRESSURE[v.value]; if (pr === 'HIGH' || pr === 'VERY_HIGH') warnings.push({ item_id: id, choice: v.value, status: v.status, pressure: pr, message: 'This choice is cost-sensitive (' + pr + '); confirm it is intended.' }); });
  return mk('CostModelV1', ctx, { budget_ceiling: { status: ceiling.status, value: ceiling.value, note: ceiling.status === 'CONFIRMED' && ceiling.value && ceiling.value.indexOf('manual:') === 0 ? 'User-stated ceiling' : 'No numeric ceiling invented' }, cost_assumptions: { scale_tier: view(S, 'nfr_scale').value, tenancy: P.tenancy, status: 'ASSUMPTIONS_NOT_CONFIRMED_UNLESS_ITEMS_CONFIRMED' },
    components, cost_sensitive_architecture_warnings: warnings, scaling_triggers: [{ trigger: 'active tenants or users exceed the confirmed scale tier', action: 'reassess database tier, isolation model and cost per tenant' }, { trigger: 'monthly infrastructure cost exceeds the confirmed ceiling', action: 'review cost-sensitive choices above' }],
    statement: 'No exact future cost is claimed. Estimates require the listed assumptions; until then each component is NOT_ESTIMATED and only ordinal pressure is shown.' });
}

/* ---------------- Build vs Buy ---------------- */
const BVB_OPTIONS = ['BUILD', 'MANAGED_SERVICE', 'EXTERNAL_SAAS', 'OPEN_SOURCE_SELF_HOSTED', 'HYBRID'];
const BVB_CRITERIA = ['security', 'privacy', 'cost', 'vendor_lock_in', 'engineering_effort', 'operational_burden', 'scalability', 'reliability', 'time_to_market', 'data_ownership', 'migration_reversibility'];
// Generic reference characteristics (NOT evidence about a specific vendor); higher is better for the buyer on every criterion.
const BVB_REF = {
  BUILD: [3, 4, 3, 5, 1, 1, 3, 2, 1, 5, 4], MANAGED_SERVICE: [4, 3, 3, 2, 4, 4, 4, 4, 5, 3, 2], EXTERNAL_SAAS: [4, 2, 2, 1, 5, 5, 4, 4, 5, 2, 2], OPEN_SOURCE_SELF_HOSTED: [3, 4, 4, 4, 2, 1, 3, 3, 2, 5, 4], HYBRID: [4, 4, 3, 3, 3, 3, 4, 4, 4, 4, 3],
};
function buildBuildVsBuy(ctx) {
  const S = ctx.states; const sel = view(S, 'build_vs_buy');
  const caps = ['identity_and_sign_in', 'billing_and_payments', 'email_and_notifications', 'background_jobs', 'observability_stack', 'file_storage', 'ai_model_hosting'];
  return mk('BuildVsBuyAnalysisV1', ctx, { capabilities: caps, options: BVB_OPTIONS, criteria: BVB_CRITERIA, reference_characteristics: BVB_OPTIONS.map((o) => ({ option: o, scores: BVB_CRITERIA.reduce((a, c, i) => { a[c] = BVB_REF[o][i]; return a; }, {}) })),
    reference_note: 'Generic, non-evidential reference characteristics (1 worst – 5 best for the buyer). They inform a human choice; they do not select an option.', automatic_selection: false, model_preference_applied: false,
    decision: { item_id: 'build_vs_buy', status: sel.status, value: sel.value }, per_capability_selection: caps.map((c) => ({ capability: c, selection: null, status: 'UNRESOLVED_REQUIRES_HUMAN_DECISION' })) });
}

/* ---------------- AIProductionProfileV1 ---------------- */
const AI_DIMS = [['MODEL_PROVIDER_ABSTRACTION', 'ai_provider_abstraction'], ['MODEL_SELECTION', 'ai_model_selection_version'], ['MODEL_VERSION', 'ai_model_selection_version'], ['PROMPT_VERSIONING', 'ai_prompt_versioning'], ['EVALUATION_DATASETS', 'ai_evaluation_plan'],
  ['EVALUATION_METRICS', 'ai_evaluation_plan'], ['STRUCTURED_OUTPUT_VALIDATION', 'ai_structured_output'], ['HALLUCINATION_ERROR_POLICY', 'ai_structured_output'], ['TOOL_PERMISSIONS', 'ai_tool_permissions'], ['PROMPT_INJECTION', 'ai_injection_exfiltration'], ['DATA_EXFILTRATION', 'ai_injection_exfiltration'],
  ['PII_HANDLING', 'ai_pii_policy'], ['HUMAN_APPROVAL', 'ai_human_approval'], ['COST_BUDGET', 'ai_budget_rate'], ['RATE_LIMITS', 'ai_budget_rate'], ['FALLBACK', 'ai_fallback_degraded'], ['DEGRADED_MODE', 'ai_fallback_degraded'], ['OBSERVABILITY', 'ai_observability_migration'],
  ['MODEL_MIGRATION', 'ai_observability_migration'], ['REPRODUCIBILITY', 'ai_model_selection_version'], ['SAFETY_EVALUATION', 'ai_evaluation_plan']];
function buildAIProfile(ctx) {
  const S = ctx.states; const active = live(ctx.profile, S, 'ai_evaluation_plan');
  const adm = ctx.admission || null;
  const admitted = !!(adm && adm.status === 'ADMITTED_FOR_TASK' && adm.real_run === true && adm.corpus_status === 'ACCEPTED' && typeof adm.record_sha256 === 'string' && /^[0-9a-f]{64}$/.test(adm.record_sha256));
  const evaluated = !!(adm && adm.real_run === true);
  return mk('AIProductionProfileV1', ctx, { activated: active, dimensions: active ? AI_DIMS.map(([d, id]) => { const v = view(S, id); return { dimension: d, source_item: id, status: v.status, value: v.value }; }) : [],
    model_status_chain: { MODEL_AVAILABLE: 'NOT_ASSESSED_BY_PROMPT_MAKER', MODEL_EVALUATED: evaluated, MODEL_ADMITTED_FOR_TASK: admitted, AI_FEATURE_PRODUCTION_READY: false },
    chain_rule: 'MODEL_AVAILABLE != MODEL_EVALUATED != MODEL_ADMITTED_FOR_TASK != AI_FEATURE_PRODUCTION_READY. Admission requires a real evaluation run against an ACCEPTED corpus; production readiness additionally requires evidence for every AI claim.',
    admission_input: adm ? { status: adm.status, accepted_as_valid: admitted } : null });
}

/* ---------------- ProductionEvidenceContractV1 ---------------- */
const CLAIMS = [
  { id: 'TENANT_ISOLATION_READY', dims: ['TENANCY', 'SECURITY', 'DATA'], group: 'PRODUCT', items: ['tenant_isolation', 'tenancy_model'], ev: [['POSITIVE_AUTHORIZATION_TESTS', 'AUTOMATED'], ['NEGATIVE_CROSS_TENANT_TESTS', 'AUTOMATED'], ['DATABASE_POLICY_READBACK', 'AUTOMATED'], ['API_AUTHORIZATION_TESTS', 'AUTOMATED'], ['AUDIT_EVIDENCE', 'AUTOMATED']] },
  { id: 'AUTHENTICATION_READY', dims: ['IDENTITY'], group: 'PRODUCT', items: ['identity_method'], ev: [['AUTH_FLOW_TESTS', 'AUTOMATED'], ['LOCKOUT_AND_RATE_LIMIT_TESTS', 'AUTOMATED'], ['MFA_ENFORCEMENT_CHECK', 'AUTOMATED']] },
  { id: 'AUTHORIZATION_READY', dims: ['AUTHORIZATION'], group: 'PRODUCT', items: ['authorization_model'], ev: [['AUTHORIZATION_MATRIX_TESTS', 'AUTOMATED'], ['PRIVILEGE_ESCALATION_TESTS', 'AUTOMATED']] },
  { id: 'BILLING_RELIABILITY_READY', dims: ['BILLING', 'RELIABILITY'], group: 'PRODUCT', items: ['payment_failure_policy', 'billing_model', 'entitlements_quotas', 'provisioning_failure_policy'], ev: [['DUPLICATE_WEBHOOK_TEST', 'AUTOMATED'], ['PAYMENT_SUCCESS_PROVISIONING_FAILURE_TEST', 'AUTOMATED'], ['RECONCILIATION_REPORT', 'AUTOMATED'], ['OPERATOR_VISIBILITY_CHECK', 'HUMAN']] },
  { id: 'DATA_PROTECTION_READY', dims: ['DATA', 'PRIVACY'], group: 'PRODUCT', items: ['data_classes', 'retention_deletion', 'tenant_lifecycle'], ev: [['ENCRYPTION_CONFIGURATION_READBACK', 'AUTOMATED'], ['RETENTION_DELETION_JOB_TEST', 'AUTOMATED'], ['EXPORT_TEST', 'AUTOMATED']] },
  { id: 'PRIVACY_COMPLIANCE_REVIEWED', dims: ['PRIVACY', 'COMPLIANCE'], group: 'PRODUCT', items: ['privacy_compliance'], ev: [['QUALIFIED_LEGAL_REVIEW_RECORD', 'HUMAN']] },
  { id: 'BACKUP_RESTORE_READY', dims: ['BACKUP', 'RESTORE', 'DISASTER_RECOVERY', 'BUSINESS_CONTINUITY'], group: 'OPERATIONS', items: ['backup_policy', 'restore_drill', 'continuity_dr', 'nfr_data_loss_rpo', 'nfr_recovery_time_rto'], ev: [['BACKUP_CONFIGURATION_READBACK', 'AUTOMATED'], ['SUCCESSFUL_RESTORE_DRILL', 'AUTOMATED'], ['RPO_MEASUREMENT', 'AUTOMATED'], ['RTO_MEASUREMENT', 'AUTOMATED'], ['INTEGRITY_VALIDATION', 'AUTOMATED']] },
  { id: 'AVAILABILITY_TARGET_MET', dims: ['AVAILABILITY', 'RELIABILITY'], group: 'OPERATIONS', items: ['nfr_availability'], ev: [['SLO_MONITORING_DATA', 'AUTOMATED'], ['FAILURE_INJECTION_REPORT', 'AUTOMATED']] },
  { id: 'PERFORMANCE_SCALABILITY_VERIFIED', dims: ['PERFORMANCE', 'SCALABILITY'], group: 'OPERATIONS', items: ['nfr_performance', 'nfr_scale'], ev: [['LOAD_TEST_REPORT', 'AUTOMATED'], ['LATENCY_P95_MEASUREMENT', 'AUTOMATED']] },
  { id: 'OBSERVABILITY_READY', dims: ['OBSERVABILITY'], group: 'OPERATIONS', items: ['observability'], ev: [['DASHBOARD_READBACK', 'AUTOMATED'], ['ALERT_FIRE_TEST', 'AUTOMATED']] },
  { id: 'INCIDENT_READINESS', dims: ['INCIDENT_RESPONSE', 'SUPPORT'], group: 'OPERATIONS', items: ['incident_response'], ev: [['RUNBOOK_REVIEW_RECORD', 'HUMAN'], ['INCIDENT_EXERCISE_REPORT', 'HUMAN']] },
  { id: 'DEPLOYMENT_READY', dims: ['DEPLOYMENT', 'OPERATIONS'], group: 'OPERATIONS', items: ['deployment_envs', 'ci_cd', 'domain_tls'], ev: [['CI_PIPELINE_LOGS', 'AUTOMATED'], ['STAGING_TO_PRODUCTION_PROMOTION_LOG', 'AUTOMATED'], ['ROLLBACK_REHEARSAL_REPORT', 'AUTOMATED'], ['TLS_CERTIFICATE_READBACK', 'AUTOMATED']] },
  { id: 'MIGRATION_SAFE', dims: ['MIGRATION'], group: 'OPERATIONS', items: ['migration_rollback'], ev: [['MIGRATION_REHEARSAL_ON_COPY', 'AUTOMATED'], ['ROLLBACK_TEST', 'AUTOMATED']] },
  { id: 'SECURITY_TESTED', dims: ['SECURITY'], group: 'PRODUCT', items: ['security_threat_assumptions', 'secrets_key_management', 'rate_limit_abuse'], ev: [['STATIC_AND_DEPENDENCY_SCAN_REPORT', 'AUTOMATED'], ['THREAT_MODEL_TEST_RESULTS', 'AUTOMATED'], ['SECRET_SCAN_REPORT', 'AUTOMATED'], ['INDEPENDENT_SECURITY_REVIEW_RECORD', 'HUMAN']] },
  { id: 'ACCESSIBILITY_LOCALIZATION_VERIFIED', dims: ['ACCESSIBILITY', 'LOCALIZATION'], group: 'PRODUCT', items: ['accessibility_l10n'], ev: [['AUTOMATED_ACCESSIBILITY_REPORT', 'AUTOMATED'], ['MANUAL_ASSISTIVE_TECH_REVIEW', 'HUMAN'], ['RTL_VISUAL_REVIEW', 'HUMAN']] },
  { id: 'TEST_STRATEGY_EXECUTED', dims: ['TESTING'], group: 'PRODUCT', items: ['testing_strategy'], ev: [['TEST_RUN_REPORT', 'AUTOMATED'], ['COVERAGE_OF_REQUIREMENTS_REPORT', 'AUTOMATED']] },
  { id: 'COST_VALIDATED', dims: ['COST'], group: 'PRODUCT', items: ['cost_budget'], ev: [['MEASURED_COST_VS_CEILING_REPORT', 'AUTOMATED']] },
  { id: 'SUPPORT_OPERATIONS_READY', dims: ['SUPPORT', 'OPERATIONS'], group: 'OPERATIONS', items: ['support_admin_surface', 'deployment_ownership', 'notifications_policy'], ev: [['OWNERSHIP_ASSIGNMENT_RECORD', 'HUMAN'], ['ADMIN_ACCESS_AUDIT_TEST', 'AUTOMATED']] },
  { id: 'AUDIT_TRAIL_VERIFIED', dims: ['SECURITY', 'COMPLIANCE', 'OBSERVABILITY'], group: 'PRODUCT', items: ['audit_trail'], ev: [['AUDIT_COMPLETENESS_TESTS', 'AUTOMATED'], ['AUDIT_TAMPER_EVIDENCE_CHECK', 'AUTOMATED']] },
  { id: 'BACKGROUND_PROCESSING_RELIABLE', dims: ['RELIABILITY', 'OPERATIONS'], group: 'OPERATIONS', items: ['background_jobs_policy'], ev: [['DUPLICATE_JOB_EXECUTION_TEST', 'AUTOMATED'], ['DEAD_LETTER_HANDLING_TEST', 'AUTOMATED']] },
  { id: 'INTEGRATION_RESILIENCE_VERIFIED', dims: ['RELIABILITY'], group: 'OPERATIONS', items: ['integrations_resilience'], ev: [['PROVIDER_OUTAGE_DRILL_REPORT', 'AUTOMATED']] },
  { id: 'AI_FEATURE_PRODUCTION_READY', dims: ['AI_SAFETY_WHEN_APPLICABLE'], group: 'PRODUCT', items: ['ai_provider_abstraction', 'ai_model_selection_version', 'ai_prompt_versioning', 'ai_evaluation_plan', 'ai_injection_exfiltration', 'ai_structured_output', 'ai_tool_permissions', 'ai_human_approval', 'ai_pii_policy', 'ai_budget_rate', 'ai_fallback_degraded', 'ai_observability_migration'], ev: [['MODEL_ADMISSION_RECORD_FOR_TASK', 'EXTERNAL'], ['EVALUATION_RESULTS_ON_ACCEPTED_CORPUS', 'AUTOMATED'], ['INJECTION_TEST_SUITE_RESULTS', 'AUTOMATED'], ['STRUCTURED_OUTPUT_VALIDATION_TESTS', 'AUTOMATED'], ['BUDGET_ENFORCEMENT_TEST', 'AUTOMATED'], ['FALLBACK_DRILL_REPORT', 'AUTOMATED'], ['MODEL_MIGRATION_REHEARSAL', 'AUTOMATED']] },
];
const hex64 = /^[0-9a-f]{64}$/;
function decisionBinding(states, items) { return sha256OfValue(items.map((id) => [id, (states[id] && states[id].value_sha256) || null, (states[id] && states[id].state) || 'UNASKED'])); }

function buildEvidenceContract(ctx) {
  const claims = CLAIMS.map((c) => {
    const apps = c.items.map((id) => C.applicability(C.byId[id], ctx.profile, ctx.states).applicable);
    const applicable = apps.indexOf('YES') !== -1 ? 'YES' : (apps.indexOf('CONDITIONAL') !== -1 ? 'CONDITIONAL' : 'NO');
    return { claim_id: c.id, statement: c.id.replace(/_/g, ' ').toLowerCase() + ' — assertable only with the evidence below', dimensions: c.dims, group: c.group, applicable, linked_items: c.items,
      required_evidence: c.ev.map(([kind, verifier]) => ({ kind, verifier_class: verifier })), decision_binding_sha256: decisionBinding(ctx.states, c.items), status: 'EVIDENCE_REQUIRED' };
  });
  return mk('ProductionEvidenceContractV1', ctx, { claims, rule: 'Prompt Maker DEFINES what evidence would prove a claim; it never fabricates it. EVIDENCED requires attestations produced by someone other than Prompt Maker, bound to the current decision set.',
    applicable_claim_ids: claims.filter((c) => c.applicable !== 'NO').map((c) => c.claim_id) });
}

/**
 * Applies externally produced attestations. Each: {claim_id, kind, sha256, produced_by:{actor_type, actor_id}, at}.
 * Rejected: unknown claim/kind, bad hash, produced by PROMPT_MAKER, or bound to a different decision set (stale evidence).
 */
function applyEvidence(contract, states, attestations) {
  const accepted = {}; const rejected = [];
  (attestations || []).forEach((a) => {
    const c = contract.claims.find((x) => x.claim_id === a.claim_id);
    if (!c) { rejected.push({ attestation: a, reason: 'UNKNOWN_CLAIM' }); return; }
    if (!c.required_evidence.some((r) => r.kind === a.kind)) { rejected.push({ attestation: a, reason: 'KIND_NOT_REQUIRED_BY_CLAIM' }); return; }
    if (!hex64.test(a.sha256 || '')) { rejected.push({ attestation: a, reason: 'EVIDENCE_HASH_REQUIRED' }); return; }
    if (!a.produced_by || !a.produced_by.actor_id || a.produced_by.actor_type === 'PROMPT_MAKER' || ['SYSTEM_RULE', 'AI_PROVIDER'].indexOf(a.produced_by.actor_type) !== -1) { rejected.push({ attestation: a, reason: 'EVIDENCE_MUST_NOT_BE_PRODUCED_BY_PROMPT_MAKER_OR_AI' }); return; }
    const req = c.required_evidence.find((r) => r.kind === a.kind);
    if (req.verifier_class === 'HUMAN' && a.produced_by.actor_type !== 'USER') { rejected.push({ attestation: a, reason: 'HUMAN_VERIFIER_REQUIRED' }); return; }
    if (a.decision_binding_sha256 !== decisionBinding(states, c.linked_items)) { rejected.push({ attestation: a, reason: 'STALE_EVIDENCE_DECISIONS_CHANGED' }); return; }
    (accepted[a.claim_id] = accepted[a.claim_id] || {})[a.kind] = a;
  });
  const status = {}; const evidenced = {};
  contract.claims.forEach((c) => {
    const have = accepted[c.claim_id] || {};
    const complete = c.required_evidence.every((r) => have[r.kind]);
    status[c.claim_id] = complete ? 'EVIDENCED' : (Object.keys(have).length ? 'EVIDENCE_PARTIAL' : 'EVIDENCE_REQUIRED');
    if (complete) evidenced[c.claim_id] = true;
  });
  return { status, evidenced, rejected };
}


/* ---------------- FailureSemanticsV1 (failure & abuse engineering) ---------------- */
const FAILURES = [
  ['F01', 'A webhook is delivered twice', 'قيل إن إشعار الدفع وصل مرتين', 'payment_failure_policy', ['IDEMPOTENCY', 'AUDIT'], true],
  ['F02', 'Payment succeeds but provisioning fails', 'نجح الدفع وفشل تجهيز الحساب', 'provisioning_failure_policy', ['COMPENSATING_ACTION', 'RETRY', 'AUDIT', 'RECOVERY'], true],
  ['F03', 'Provisioning succeeds but payment confirmation fails', 'نجح التجهيز وفشل تأكيد الدفع', 'payment_failure_policy', ['RETRY', 'RECOVERY', 'AUDIT', 'FAIL_CLOSED'], true],
  ['F04', 'A background job executes twice', 'نُفِّذت مهمة خلفية مرتين', 'background_jobs_policy', ['IDEMPOTENCY', 'AUDIT'], true],
  ['F05', 'A queue is delayed', 'تأخر طابور المهام', 'background_jobs_policy', ['DEGRADATION', 'RETRY'], true],
  ['F06', 'A provider is unavailable', 'مزود خارجي غير متاح', 'integrations_resilience', ['DEGRADATION', 'FAIL_CLOSED', 'RETRY'], false],
  ['F07', 'A database migration partially fails', 'فشل ترحيل قاعدة البيانات جزئيًا', 'migration_rollback', ['ROLLBACK', 'RECOVERY', 'AUDIT'], false],
  ['F08', 'A tenant attempts cross-tenant access', 'جهة تحاول الوصول إلى بيانات جهة أخرى', 'tenant_isolation', ['FAIL_CLOSED', 'AUDIT'], false],
  ['F09', 'An administrator makes a destructive mistake', 'مدير يرتكب خطأً مدمرًا', 'support_admin_surface', ['AUDIT', 'RECOVERY', 'ROLLBACK'], false],
  ['F10', 'An external API changes', 'تغيّر واجهة خارجية', 'integrations_resilience', ['DEGRADATION', 'FAIL_CLOSED'], false],
  ['F11', 'An AI model returns malformed output', 'نموذج الذكاء الاصطناعي يعيد مخرجات مشوّهة', 'ai_structured_output', ['FAIL_CLOSED', 'RETRY'], false],
  ['F12', 'An AI model returns adversarial content', 'النموذج يعيد محتوى عدائيًا', 'ai_injection_exfiltration', ['FAIL_CLOSED', 'AUDIT'], false],
  ['F13', 'An operation is retried after partial completion', 'إعادة محاولة عملية أُنجز جزء منها', 'background_jobs_policy', ['IDEMPOTENCY', 'COMPENSATING_ACTION', 'AUDIT'], true],
];
function buildFailureSemantics(ctx) {
  const scenarios = FAILURES.map(([id, en, ar, item, props, opsVis]) => {
    const app = C.applicability(C.byId[item], ctx.profile, ctx.states).applicable; const v = view(ctx.states, item);
    return { scenario_id: id, question_en: 'What happens if: ' + en + '?', question_ar: 'ماذا يحدث إذا: ' + ar + '؟', applicable: app, governing_decision: item, decision_status: v.status, decision_value: v.value,
      required_properties: props, reconciliation_required: ['F02', 'F03'].indexOf(id) !== -1, operator_visibility_required: opsVis, requirement_state: app === 'NO' ? 'NOT_APPLICABLE_WITH_RATIONALE' : (v.status === 'CONFIRMED' ? 'SPECIFIED' : 'UNRESOLVED_DECISION_PENDING') };
  });
  return mk('FailureSemanticsV1', ctx, { scenarios, property_vocabulary: ['IDEMPOTENCY', 'RETRY', 'ROLLBACK', 'COMPENSATING_ACTION', 'FAIL_CLOSED', 'DEGRADATION', 'AUDIT', 'RECOVERY'] });
}

/* ---------------- ADR ---------------- */
function buildADRs(ctx) {
  const entries = ctx.ledger.entries; const S = ctx.states; const P = ctx.profile; const out = []; const proposals = [];
  C.ITEMS.forEach((it) => {
    const v = view(S, it.id); if (C.applicability(it, P, S).applicable === 'NO') return;
    const choice = it.choices.find((c) => c.value === v.value);
    if (v.status === 'AI_RECOMMENDED_PENDING_APPROVAL') { proposals.push({ decision_id: it.id, status: 'PROPOSED_NOT_AN_ADR', value: v.value, note: 'AI/rule recommendation; becomes an ADR only after human confirmation' }); return; }
    if (v.status !== 'CONFIRMED' || it.crit < 4) return;
    const mine = entries.filter((e) => e.item_id === it.id); const last = mine.filter((e) => e.to === 'USER_CONFIRMED' || e.to === 'USER_EDITED').slice(-1)[0];
    const rec = it.rec ? it.rec(P, S) : null; const prior = mine.filter((e) => e.to === 'USER_CONFIRMED' || e.to === 'USER_EDITED').slice(0, -1).slice(-1)[0];
    const deps = C.dependentsOf(it.id);
    out.push({ decision_id: it.id, context: it.q.en, decision: v.value, status: 'ACCEPTED_BY_HUMAN', alternatives_considered: it.choices.filter((c) => c.value !== v.value).map((c) => ({ value: c.value, tradeoff: c.tradeoff.en })),
      selection_rationale: last && last.rationale ? last.rationale : (rec && rec.value === v.value ? 'Matches the recorded recommendation: ' + rec.why.en : 'USER_CONFIRMED_WITHOUT_RECORDED_RATIONALE'),
      tradeoffs: choice ? choice.tradeoff.en : null, assumptions: rec ? rec.caused : [], constraints: it.deps, dependencies: it.deps, security_implications: it.impact.filter((t) => ['security', 'auth', 'authorization', 'rls', 'privacy', 'audit'].indexOf(t) !== -1),
      cost_implications: PRESSURE[v.value] || 'NOT_ASSESSED', operational_implications: it.impact.filter((t) => ['operations', 'deployment', 'backup', 'migration'].indexOf(t) !== -1), reversal_cost: deps.length >= 8 ? 'HIGH' : (deps.length >= 3 ? 'MEDIUM' : 'LOW'),
      affected_artifacts: it.impact, supersedes: prior ? { entry_sha256: prior.entry_sha256, seq: prior.seq } : null, created_at: last ? last.at : null, decision_ledger_reference: last ? { seq: last.seq, entry_sha256: last.entry_sha256 } : null });
  });
  return mk('ArchitectureDecisionRecordV1', ctx, { adrs: out, not_adrs: proposals, distinction: 'AI/rule recommendations (TechnologyRecommendationV1 / pending items) and human-confirmed ADRs are different records.' });
}

module.exports = { buildNFRContract, buildThreatModel, buildDataLifecycle, buildDeploymentTopology, buildCostModel, buildBuildVsBuy, buildAIProfile, buildEvidenceContract, applyEvidence, buildADRs, buildFailureSemantics, CLAIMS, decisionBinding, BVB_OPTIONS, BVB_CRITERIA };
