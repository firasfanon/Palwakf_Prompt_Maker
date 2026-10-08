'use strict';

const { sha256OfValue } = require('./canon');
const A = require('./artifacts');
const D = require('./decisions');
const L = require('./ledger');
const Q = require('./questionPlan');

/**
 * Spec / plan compilation (S4). Deterministic, offline, provider-free.
 * Inputs: the verified decision ledger + the FROZEN engines (injected compileProject).
 * Rules:
 *  - every spec entry carries a `source` (ledger item + seq + value_sha256, or the frozen engine);
 *  - unresolved mandatory items are LISTED as unresolved, never filled in;
 *  - every AcceptanceContractV1 gate is traced to a spec and a plan phase; a gap is reported, not hidden;
 *  - AcceptanceContractV1 is NOT re-defined here: it is consumed from the frozen engine and referenced by hash.
 */

const DOMAIN_GROUPS = [
  // [spec, phase, domains]
  ['ProductSpecV1', 'P3_CORE_WORKFLOWS', ['PRODUCT_COMPLETENESS']],
  ['ArchitectureSpecV1', 'P0_FOUNDATION', ['ARCHITECTURE', 'API_CONTRACTS']],
  ['ArchitectureSpecV1', 'P1_DATA_MODEL', ['DATA', 'INDEXING', 'REFERENTIAL_INTEGRITY', 'TRANSACTIONS', 'MIGRATIONS', 'CONCURRENCY', 'IDEMPOTENCY', 'CACHING']],
  ['ArchitectureSpecV1', 'P3_CORE_WORKFLOWS', ['INTEGRATIONS', 'WEBHOOKS']],
  ['SecuritySpecV1', 'P2_AUTH_AND_AUTHORIZATION', ['AUTHENTICATION', 'AUTHORIZATION']],
  ['SecuritySpecV1', 'P4_SECURITY_HARDENING', ['SECURITY', 'VALIDATION', 'PRIVACY', 'SECURITY_TESTING']],
  ['EngineeringSpecV1', 'P0_FOUNDATION', ['CI_CD', 'ENVIRONMENT_SEPARATION']],
  ['EngineeringSpecV1', 'P4_SECURITY_HARDENING', ['DEGRADED_MODE', 'RELIABILITY', 'PERFORMANCE', 'LOAD_TARGETS']],
  ['EngineeringSpecV1', 'P6_TEST_AND_BROWSER_UAT', ['TESTING', 'INTEGRATION_TESTING', 'REGRESSION_TESTING', 'DATABASE_TESTING']],
  ['EngineeringSpecV1', 'P7_RELEASE_AND_EVIDENCE', ['OBSERVABILITY', 'METRICS', 'HEALTH', 'ALERTING', 'TRACING', 'RELEASE', 'ROLLBACK', 'PRODUCTION_EVIDENCE', 'DOCUMENTATION', 'BACKUP_RESTORE', 'RECOVERY', 'RPO', 'RTO', 'RUNBOOKS', 'INCIDENT_RESPONSE', 'SUPPORTABILITY', 'READINESS']],
  ['UxSpecV1', 'P5_UX_RESPONSIVE_ACCESSIBILITY', ['UX']],
  ['UxSpecV1', 'P6_TEST_AND_BROWSER_UAT', ['BROWSER_UAT']],
];
const DOMAIN_TO_SPEC = {};
const DOMAIN_TO_PHASE = {};
DOMAIN_GROUPS.forEach((g) => g[2].forEach((d) => { DOMAIN_TO_SPEC[d] = g[0]; DOMAIN_TO_PHASE[d] = g[1]; }));
const ITEM_TO_SPEC = {
  project_name: 'ProductSpecV1', project_idea: 'ProductSpecV1', project_goal: 'ProductSpecV1', success_measures: 'ProductSpecV1', users_roles: 'ProductSpecV1', workflows: 'ProductSpecV1',
  scope: 'ProductSpecV1', business_rules: 'ProductSpecV1', platforms: 'ArchitectureSpecV1', languages: 'UxSpecV1', data_entities: 'ArchitectureSpecV1', integrations: 'ArchitectureSpecV1',
  data_sensitivity: 'SecuritySpecV1', auth_model: 'SecuritySpecV1', secrets_handling: 'SecuritySpecV1', availability_targets: 'EngineeringSpecV1', technology_stack: 'ArchitectureSpecV1',
  architecture: 'ArchitectureSpecV1', hosting_target: 'EngineeringSpecV1', testing_expectations: 'EngineeringSpecV1', brand_copy: 'UxSpecV1',
};

function srcOf(states, id) { const s = states[id]; return s ? { item_id: id, ledger_seq: s.last_seq, value_sha256: s.value_sha256, state: s.state } : { item_id: id, ledger_seq: null, value_sha256: null, state: 'UNASKED' }; }
function entry(states, id, text) { return { text, source: srcOf(states, id) }; }
function val(states, id) { const s = states[id]; return s && (s.state === 'USER_CONFIRMED' || s.state === 'USER_EDITED') ? s.value : null; }
const asList = (v) => (typeof v === 'string' ? v.split(/[\n,،;؛]+/).map((x) => x.trim()).filter(Boolean) : []);

function unresolvedFor(cs, specName) {
  return cs.unresolved.filter((u) => ITEM_TO_SPEC[u.item_id] === specName).map((u) => ({ item_id: u.item_id, state: u.state, blocks: u.blocks, phase: u.phase }));
}

function compileSpecs(params) {
  const { ledger, project_id, created_at, producer, compileProject } = params;
  const v = L.verifyLedger(ledger);
  if (!v.valid) return { ok: false, error: 'LEDGER_INVALID', detail: v };
  const states = L.foldLedger(ledger);
  const cs = D.computePackageState(states);
  if (!cs.compilable) return { ok: false, error: 'NOT_COMPILABLE', unresolved: cs.unresolved.filter((u) => u.blocks === 'COMPILATION') };
  const compiled = compileProject(Q.toCompileInput(states));
  if (!compiled.ok) return { ok: false, error: 'FROZEN_ENGINE_REJECTED_INPUT', errors: compiled.errors };
  const head = L.headHash(ledger);
  const idFor = (t) => project_id + ':' + t + ':' + head.slice(0, 12);
  // The frozen engine stamps volatile wall-clock `generated_at` fields (excluded from its own receipt fingerprint).
  // For a reproducible package hash these fields are normalised to the caller-supplied `created_at`; nothing else is touched.
  const norm = (o, f) => { const c = JSON.parse(JSON.stringify(o)); f(c); return c; };
  const bp = norm(compiled.blueprint, (c) => { if (c.generation_metadata) c.generation_metadata.generated_at = created_at; });
  compiled.acceptanceContract = norm(compiled.acceptanceContract, (c) => { c.generated_at = created_at; });
  compiled.developmentContract = norm(compiled.developmentContract, (c) => { c.generated_at = created_at; });
  const gates = compiled.acceptanceContract.gates;
  const acceptanceSha = sha256OfValue(compiled.acceptanceContract); const developmentSha = sha256OfValue(compiled.developmentContract); const blueprintSha = sha256OfValue(bp);
  const gateIdsFor = (spec) => gates.filter((g) => DOMAIN_TO_SPEC[g.domain] === spec).map((g) => g.gate_id);
  const ledgerRef = { artifact_type: 'DecisionLedgerV1', artifact_id: idFor('DecisionLedgerV1'), sha256: head };
  const mk = (type, fields, refs) => A.makeArtifact(type, { artifact_id: idFor(type), project_id, created_at, producer, references: [ledgerRef].concat(refs || []), fields });
  const engine = { engine: 'compileProject', blueprint_sha256: blueprintSha };

  const ur = val(states, 'users_roles');
  const product = mk('ProductSpecV1', {
    goals: [entry(states, 'project_goal', val(states, 'project_goal'))].concat(val(states, 'success_measures') ? [entry(states, 'success_measures', val(states, 'success_measures'))] : []),
    users: ur ? asList(ur.users).map((t) => entry(states, 'users_roles', t)) : [],
    roles: ur ? asList(ur.roles).map((t) => entry(states, 'users_roles', t)) : [],
    workflows: asList(val(states, 'workflows')).map((t) => entry(states, 'workflows', t)),
    business_rules: asList(val(states, 'business_rules')).map((t) => entry(states, 'business_rules', t)),
    scope: asList(val(states, 'scope')).map((t) => entry(states, 'scope', t)),
    non_scope: (bp.excluded_scope || []).map((t) => ({ text: String(t), source: engine })),
    unresolved: unresolvedFor(cs, 'ProductSpecV1'),
  });
  const tech = states.technology_stack;
  const architecture = mk('ArchitectureSpecV1', {
    components: (Array.isArray(bp.architecture_target) ? bp.architecture_target : []).map((t) => ({ text: typeof t === 'string' ? t : JSON.stringify(t), source: engine })),
    data_flow: asList(val(states, 'data_entities')).map((t) => entry(states, 'data_entities', t)),
    boundaries: asList(val(states, 'integrations')).map((t) => entry(states, 'integrations', t)).concat(asList(val(states, 'platforms')).map((t) => entry(states, 'platforms', t))),
    technology_ref: { status: bp.technology_decision.status, stack: bp.technology_decision.stack, source_type: bp.technology_decision.source_type, ledger: srcOf(states, 'technology_stack'), confirmed_by_human: !!(tech && (tech.state === 'USER_CONFIRMED' || tech.state === 'USER_EDITED')) },
    unresolved: unresolvedFor(cs, 'ArchitectureSpecV1'),
  }, [{ artifact_type: 'ProjectBlueprintV1', artifact_id: bp.project_name, sha256: blueprintSha }]);
  const engineering = mk('EngineeringSpecV1', {
    repo_layout: (compiled.developmentContract.expected_artifacts || []).map((t) => ({ text: typeof t === 'string' ? t : JSON.stringify(t), source: { engine: 'compileProject', development_contract_sha256: developmentSha } })),
    devops: gates.filter((g) => ['CI_CD', 'ENVIRONMENT_SEPARATION'].indexOf(g.domain) !== -1).map((g) => ({ text: g.requirement, source: { engine: 'compileProject', gate_id: g.gate_id } })),
    deployment: asList(val(states, 'hosting_target')).map((t) => entry(states, 'hosting_target', t)),
    operations: asList(val(states, 'availability_targets')).map((t) => entry(states, 'availability_targets', t)).concat(asList(val(states, 'testing_expectations')).map((t) => entry(states, 'testing_expectations', t))),
    development_contract_ref: { artifact_type: 'DevelopmentContractV1', schema_version: compiled.developmentContract.schema_version, sha256: developmentSha },
    unresolved: unresolvedFor(cs, 'EngineeringSpecV1'),
  });
  const sens = val(states, 'data_sensitivity');
  const threat = [];
  if (sens && sens !== 'NONE') threat.push({ text: 'كشف أو تسريب البيانات (' + sens + ')', source: srcOf(states, 'data_sensitivity') });
  threat.push({ text: 'إدخال خبيث (حقن/XSS) عبر أي حقل نصي', source: { engine: 'GFPI_BASELINE_THREATS' } }, { text: 'وصول بلا صلاحية إلى بيانات مستخدم آخر', source: { engine: 'GFPI_BASELINE_THREATS' } });
  const security = mk('SecuritySpecV1', {
    authentication: asList(val(states, 'auth_model')).map((t) => entry(states, 'auth_model', t)),
    authorization: ur ? asList(ur.roles).map((t) => ({ text: 'دور: ' + t, source: srcOf(states, 'users_roles') })) : [],
    data_classification: sens ? [entry(states, 'data_sensitivity', sens)] : [],
    secrets_handling: asList(val(states, 'secrets_handling')).map((t) => entry(states, 'secrets_handling', t)),
    threat_model: threat,
    abuse_cases: [{ text: 'تكرار الطلبات لإغراق الخدمة', source: { engine: 'GFPI_BASELINE_THREATS' } }, { text: 'استخدام مفتاح مسرّب', source: { engine: 'GFPI_BASELINE_THREATS' } }],
    acceptance_gate_ids: gateIdsFor('SecuritySpecV1'),
    unresolved: unresolvedFor(cs, 'SecuritySpecV1'),
  });
  const ux = mk('UxSpecV1', {
    journeys: (bp.user_journeys || []).map((t) => ({ text: typeof t === 'string' ? t : JSON.stringify(t), source: engine })),
    states: [{ text: 'تحميل / فراغ / خطأ / نجاح لكل شاشة رئيسية', source: { engine: 'compileProject', gate_id: 'PROD-002' } }],
    accessibility: (bp.accessibility_requirements || []).map((t) => ({ text: typeof t === 'string' ? t : JSON.stringify(t), source: engine })),
    languages: asList(val(states, 'languages')).map((t) => entry(states, 'languages', t)),
    responsive: (bp.responsive_requirements || []).map((t) => ({ text: typeof t === 'string' ? t : JSON.stringify(t), source: engine })),
    acceptance_gate_ids: gateIdsFor('UxSpecV1'),
    unresolved: unresolvedFor(cs, 'UxSpecV1'),
  });
  const specs = { ProductSpecV1: product, ArchitectureSpecV1: architecture, EngineeringSpecV1: engineering, SecuritySpecV1: security, UxSpecV1: ux };

  // ---- traceability: every acceptance gate -> spec + phase + evidence requirement ----
  const traceability = gates.map((g) => {
    const spec = DOMAIN_TO_SPEC[g.domain] || null; const phase = DOMAIN_TO_PHASE[g.domain] || null;
    return { gate_id: g.gate_id, domain: g.domain, applicability: g.applicability, spec, phase, covered: !!(spec && phase) };
  });
  const gaps = traceability.filter((t) => !t.covered).map((t) => t.gate_id);

  const deferred = cs.unresolved.map((u) => ({ item_id: u.item_id, state: u.state, blocks: u.blocks, phase: u.phase, effect: u.blocks === 'EXECUTION' ? 'يمنع التنفيذ حتى القرار' : u.blocks === 'FACTORY_ADMISSION' ? 'يمنع قبول المصنع حتى القرار' : 'يمنع المراجعة' }));
  const phaseNames = Array.from(new Set(Object.keys(DOMAIN_TO_PHASE).map((k) => DOMAIN_TO_PHASE[k]))).sort();
  const phases = phaseNames.map((p) => ({
    phase_id: p, order: Number(p.slice(1, 2)),
    gate_ids: traceability.filter((t) => t.phase === p).map((t) => t.gate_id),
    spec_refs: Array.from(new Set(traceability.filter((t) => t.phase === p).map((t) => t.spec))).sort(),
    blocked_by_unresolved: cs.unresolved.filter((u) => u.phase && ((p === 'P7_RELEASE_AND_EVIDENCE' && u.phase === 'deployment'))).map((u) => u.item_id),
  }));
  const plan = mk('ExecutionPlanV1', {
    phases,
    checkpoints: phases.map((p) => ({ after_phase: p.phase_id, report: ['changed_files', 'tests_executed', 'results', 'security_findings', 'unknowns', 'scope_drift', 'readiness_statement'] })),
    stop_conditions: [
      'ظهور عنصر قرار إلزامي غير محسوم (STALE أو CONTRADICTED أو غير مؤكد)',
      'فشل بوابة قبول إلزامية',
      'الحاجة إلى بيانات اعتماد أو مفاتيح لم يقدمها المستخدم',
      'تغيّر النطاق أو التقنية دون قرار بشري جديد',
      'اكتشاف سر مكشوف في الشيفرة أو السجلات',
    ],
    human_gates: ['موافقة بشرية على هذه الحزمة بالـ SHA-256', 'موافقة بشرية قبل أي نشر أو إنفاق'],
    deferred_item_effects: deferred,
    traceability,
    evidence_requirements: gates.map((g) => ({ gate_id: g.gate_id, required_evidence: g.required_evidence, current_evidence_status: g.current_evidence_status })),
  }, [{ artifact_type: 'AcceptanceContractV1', artifact_id: bp.project_name, sha256: acceptanceSha }]);

  return { ok: true, specs, plan, traceability_gaps: gaps, package_state: cs, frozen: { blueprint: bp, acceptanceContract: compiled.acceptanceContract, developmentContract: compiled.developmentContract, blueprint_sha256: blueprintSha, acceptance_sha256: acceptanceSha, development_sha256: developmentSha }, ledger_head_sha256: head, project_id };
}

module.exports = { compileSpecs, DOMAIN_TO_SPEC, DOMAIN_TO_PHASE, ITEM_TO_SPEC, DOMAIN_GROUPS };
