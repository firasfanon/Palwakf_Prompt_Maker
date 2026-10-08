'use strict';

/**
 * RequirementDependencyGraphV1, TraceabilityGraphV1 and ChangeImpactAnalysisV1 (additive).
 * Pure functions over the production decision states. No clock, no I/O, no AI.
 */

const C = require('./catalog');
const K = require('./common');
const M = require('./models');
const RESOLVED = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];
const SCOPING = ['saas_archetype', 'ai_native_scope', 'build_vs_buy'];
const mk = (type, ctx, fields, refs) => K.makeProdArtifact(type, { artifact_id: ctx.project_id + ':' + type + ':' + ctx.head.slice(0, 12), project_id: ctx.project_id, created_at: ctx.created_at, producer: ctx.producer, references: refs || [], fields });

// impact tag -> downstream node (type:name)
const TAG_NODE = {
  data: 'DATA_MODEL:data_model', schema: 'DATA_MODEL:schema', rls: 'DATA_MODEL:isolation_policies', auth: 'SECURITY_CONTROL:authentication', authorization: 'SECURITY_CONTROL:authorization', security: 'SECURITY_CONTROL:threat_mitigations',
  audit: 'SECURITY_CONTROL:audit_trail', privacy: 'SECURITY_CONTROL:privacy_controls', api: 'ARCHITECTURE:api_surface', architecture: 'ARCHITECTURE:components', billing: 'ARCHITECTURE:billing_subsystem', backup: 'ARCHITECTURE:backup_restore_design',
  deployment: 'ARCHITECTURE:deployment_topology', cost: 'NFR:cost_model', operations: 'EXECUTION_TASK:operations_setup', migration: 'EXECUTION_TASK:data_migration', tests: 'TEST:test_suites', ai: 'ARCHITECTURE:ai_subsystem',
};
// impact tag -> reporting area in ChangeImpactAnalysisV1
const AREA = { schema: 'schema', data: 'schema', rls: 'rls_data_isolation', auth: 'identity', authorization: 'authorization', security: 'security', billing: 'billing', audit: 'audit', backup: 'backup', tests: 'tests', migration: 'migration', deployment: 'deployment', operations: 'operations', cost: 'cost', api: 'api', privacy: 'security', architecture: 'architecture', ai: 'ai' };

function buildDependencyGraph(ctx) {
  const nodes = {}; const edges = [];
  const add = (type, id, extra) => { const key = type + ':' + id; if (!nodes[key]) nodes[key] = Object.assign({ node_id: key, type, id }, extra || {}); return key; };
  const edge = (from, to, rel) => { if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, relation: rel }); };
  const goal = ctx.baseStates && ctx.baseStates.project_goal ? add('USER_GOAL', 'project_goal', { state: ctx.baseStates.project_goal.state }) : null;
  const claims = M.CLAIMS;
  C.ITEMS.forEach((it) => {
    const app = C.applicability(it, ctx.profile, ctx.states).applicable; if (app === 'NO') return;
    const st = (ctx.states[it.id] && ctx.states[it.id].state) || 'UNASKED';
    const req = add('REQUIREMENT', it.id, { applicability: app }); const dec = add('DECISION', it.id, { state: st });
    edge(req, dec, 'RESOLVED_BY');
    if (goal && it.deps.length === 0) edge(goal, req, 'MOTIVATES');
    it.deps.forEach((d) => { if (C.applicability(C.byId[d], ctx.profile, ctx.states).applicable !== 'NO') edge(add('DECISION', d), dec, 'CONSTRAINS'); });
    it.impact.forEach((t) => { const [type, id] = TAG_NODE[t].split(':'); edge(dec, add(type, id), 'DETERMINES'); });
    if (it.id.indexOf('nfr_') === 0) edge(dec, add('NFR', it.id), 'DEFINES');
  });
  claims.forEach((c) => {
    if (!c.items.some((i) => nodes['DECISION:' + i])) return;
    const gate = add('PRODUCTION_GATE', c.id); const crit = add('ACCEPTANCE_CRITERION', c.id);
    c.items.forEach((i) => { if (nodes['DECISION:' + i]) edge(nodes['DECISION:' + i].node_id, crit, 'VERIFIED_BY'); });
    edge(crit, gate, 'GATES');
    c.ev.forEach(([kind]) => { const evn = add('EVIDENCE', c.id + '/' + kind); edge(crit, evn, 'REQUIRES_EVIDENCE'); edge(evn, gate, 'PROVES'); if (/TEST|DRILL|REHEARSAL|CHECK/.test(kind)) edge(crit, add('TEST', c.id + '/' + kind), 'REQUIRES_TEST'); });
  });
  const list = Object.keys(nodes).map((k) => nodes[k]);
  const byType = {}; list.forEach((n) => { byType[n.type] = (byType[n.type] || 0) + 1; });
  return mk('RequirementDependencyGraphV1', ctx, { nodes: list, edges, counts_by_type: byType, node_types: ['USER_GOAL', 'REQUIREMENT', 'DECISION', 'ARCHITECTURE', 'SECURITY_CONTROL', 'DATA_MODEL', 'NFR', 'ACCEPTANCE_CRITERION', 'EXECUTION_TASK', 'TEST', 'EVIDENCE', 'PRODUCTION_GATE'],
    invalidation_rule: 'When an upstream decision changes, every transitive dependent is STALE / CONTRADICTED / REVALIDATION_REQUIRED; none stays silently valid.' });
}

function reachable(graph, startKey) {
  const seen = {}; const q = [startKey]; const out = [];
  while (q.length) { const x = q.shift(); graph.edges.filter((e) => e.from === x).forEach((e) => { if (!seen[e.to]) { seen[e.to] = true; out.push(e.to); q.push(e.to); } }); }
  return out;
}

/** Evaluate downstream status after a decision changed: which dependent decisions/artifacts need revalidation. */
function revalidation(graph, states, changedItemId) {
  const reach = reachable(graph, 'DECISION:' + changedItemId);
  const decisions = reach.filter((k) => k.indexOf('DECISION:') === 0).map((k) => k.slice(9));
  return { decisions: decisions.map((id) => ({ item_id: id, current_state: (states[id] && states[id].state) || 'UNASKED', required_state: RESOLVED.indexOf((states[id] && states[id].state) || 'UNASKED') !== -1 ? 'STALE' : 'REVALIDATION_REQUIRED' })), artifacts: reach.filter((k) => k.indexOf('DECISION:') !== 0 && k.indexOf('REQUIREMENT:') !== 0) };
}

/* ---------------- Traceability ---------------- */
function buildTraceability(ctx) {
  const graph = ctx.graph; const nodes = {}; graph.nodes.forEach((n) => { nodes[n.node_id] = n; });
  const gaps = [];
  const goalExists = !!graph.nodes.find((n) => n.type === 'USER_GOAL');
  const reqs = graph.nodes.filter((n) => n.type === 'REQUIREMENT' && n.applicability === 'YES');
  const chains = []; const orphans = [];
  reqs.forEach((r) => {
    const id = r.id; const dec = 'DECISION:' + id;
    const hasGoal = goalExists && (graph.edges.some((e) => e.to === r.node_id && e.from.indexOf('USER_GOAL') === 0) || ancestorsHaveGoal(graph, dec));
    const claimsFor = M.CLAIMS.filter((c) => c.items.indexOf(id) !== -1 && graph.nodes.some((n) => n.node_id === 'ACCEPTANCE_CRITERION:' + c.id));
    const chain = { requirement: id, goal: hasGoal, claims: claimsFor.map((c) => c.id) };
    chains.push(chain);
    if (!hasGoal) orphans.push(id);
    if (!claimsFor.length && SCOPING.indexOf(id) === -1) gaps.push({ code: 'UNTESTED_REQUIREMENTS', item_id: id, blocking: true });
  });
  if (orphans.length) gaps.push({ code: 'ORPHAN_REQUIREMENTS', item_ids: orphans, reason: goalExists ? 'requirements not reachable from any user goal' : 'no confirmed USER_GOAL exists; production requirements have nothing to trace to', blocking: true });
  M.CLAIMS.forEach((c) => {
    const crit = nodes['ACCEPTANCE_CRITERION:' + c.id]; if (!crit) return;
    if (!c.ev.length) gaps.push({ code: 'PRODUCTION_CLAIMS_WITHOUT_EVIDENCE', claim_id: c.id, blocking: true });
    if (!c.items.some((i) => nodes['REQUIREMENT:' + i])) gaps.push({ code: 'TESTS_WITHOUT_REQUIREMENTS', claim_id: c.id, blocking: true });
  });
  graph.nodes.filter((n) => n.type === 'DECISION' && ctx.states[n.id] && ctx.states[n.id].state === 'USER_CONFIRMED' && C.byId[n.id].crit >= 4).forEach((n) => {
    const entry = ctx.ledger.entries.filter((e) => e.item_id === n.id && e.to === 'USER_CONFIRMED').slice(-1)[0];
    const rec = C.byId[n.id].rec(ctx.profile, ctx.states);
    if (entry && !entry.rationale && rec && rec.value !== ctx.states[n.id].value) gaps.push({ code: 'DECISIONS_WITHOUT_RATIONALE', item_id: n.id, blocking: false, note: 'differs from the recorded recommendation and no rationale was recorded' });
  });
  // implementation tasks derive from decisions; every task must reach an acceptance criterion
  const tasks = reqs.map((r) => ({ task_id: 'IMPLEMENT:' + r.id, decision: r.id, acceptance: M.CLAIMS.filter((c) => c.items.indexOf(r.id) !== -1).map((c) => c.id) }));
  tasks.forEach((t) => { if (!t.acceptance.length && SCOPING.indexOf(t.decision) === -1) gaps.push({ code: 'IMPLEMENTATION_TASKS_WITHOUT_ACCEPTANCE', task_id: t.task_id, blocking: true }); });
  return mk('TraceabilityGraphV1', ctx, { chain_definition: 'USER_GOAL -> REQUIREMENT -> DECISION -> ARCHITECTURE_COMPONENT -> ACCEPTANCE_CRITERION -> IMPLEMENTATION_TASK -> TEST -> EVIDENCE_REQUIREMENT -> PRODUCTION_GATE',
    chains, implementation_tasks: tasks, scoping_decisions_exempt: SCOPING, gaps, blocking_gap_count: gaps.filter((g) => g.blocking).length, advisory_gap_count: gaps.filter((g) => !g.blocking).length });
}
function ancestorsHaveGoal(graph, decKey) {
  const seen = {}; const q = [decKey];
  while (q.length) { const x = q.shift(); for (const e of graph.edges) { if (e.to === x && !seen[e.from]) { if (e.from.indexOf('USER_GOAL:') === 0) return true; seen[e.from] = true; q.push(e.from); } } }
  return false;
}

/* ---------------- Change impact ---------------- */
function applyHypothetical(states, itemId, value) {
  const s = JSON.parse(JSON.stringify(states)); s[itemId] = Object.assign({}, s[itemId] || {}, { state: 'USER_CONFIRMED', value }); return s;
}
function buildChangeImpact(ctx, change) {
  const { item_id: id, from_value: fromV, to_value: toV } = change;
  const before = ctx.states; const after = applyHypothetical(before, id, toV);
  const P0 = ctx.profile; const P1 = ctx.profileAfter || ctx.profile;
  const rev = revalidation(ctx.graph, before, id);
  const direct = C.ITEMS.filter((it) => it.deps.indexOf(id) !== -1).map((it) => it.id);
  const trans = rev.decisions.map((d) => d.item_id);
  const newlyApplicable = []; const noLongerApplicable = [];
  C.ITEMS.forEach((it) => {
    const a0 = C.applicability(it, P0, before).applicable; const a1 = C.applicability(it, P1, after).applicable;
    if (a0 === 'NO' && a1 !== 'NO') newlyApplicable.push({ item_id: it.id, basis: C.applicability(it, P1, after).basis });
    if (a0 !== 'NO' && a1 === 'NO') noLongerApplicable.push({ item_id: it.id, rationale: C.applicability(it, P1, after).basis });
    if (a0 === 'CONDITIONAL' && a1 === 'YES') newlyApplicable.push({ item_id: it.id, basis: 'conditional item became applicable' });
  });
  const touched = [id].concat(trans, newlyApplicable.map((n) => n.item_id));
  const tags = {}; touched.forEach((t) => (C.byId[t] ? C.byId[t].impact : []).forEach((g) => { tags[g] = true; }));
  const areas = {}; Object.keys(tags).forEach((t) => { areas[AREA[t] || t] = true; });
  const claimsAffected = M.CLAIMS.filter((c) => c.items.some((i) => touched.indexOf(i) !== -1)).map((c) => c.id);
  const structural = id === 'tenancy_model' && fromV !== toV;
  const migrations = [];
  if (structural && fromV === 'SINGLE_TENANT' && (toV === 'MULTI_TENANT' || toV === 'HYBRID_TENANCY')) migrations.push('add tenant identifier to every tenant-owned table and backfill the existing organisation as the first tenant', 'introduce isolation policies and verify them against existing data', 'rewrite uniqueness constraints to be tenant-scoped', 'migrate roles to tenant-scoped roles');
  if (structural && fromV !== 'SINGLE_TENANT' && toV === 'SINGLE_TENANT') migrations.push('collapse tenant scoping and verify no cross-tenant data would be merged');
  const generic = migrations.length ? migrations : (areas.migration || areas.schema ? ['assess schema/data migration required by this change'] : []);
  return mk('ChangeImpactAnalysisV1', ctx, { change: { item_id: id, from_value: fromV, to_value: toV }, directly_affected_decisions: direct, transitively_affected_decisions: trans, revalidation: rev.decisions,
    stale_decisions: rev.decisions.filter((d) => d.required_state === 'STALE').map((d) => d.item_id), newly_required_decisions: newlyApplicable, decisions_no_longer_applicable: noLongerApplicable,
    invalidated_approvals: ['ProductionExecutionAttachmentV1 approval bound to the previous production-ledger head', 'any AgentExecutionPackage approval whose package embeds the previous production attachment hash'],
    affected_areas: Object.keys(areas).sort(), area_detail: { data: !!areas.schema, identity: !!areas.identity, authorization: !!areas.authorization, rls_data_isolation: !!areas.rls_data_isolation, api: !!areas.api, billing: !!areas.billing, audit: !!areas.audit, backup: !!areas.backup, tests: !!areas.tests, migration: !!areas.migration, deployment: !!areas.deployment, operations: !!areas.operations, security: !!areas.security, cost: !!areas.cost },
    required_migrations: generic, required_tests: claimsAffected.map((c) => c + ': re-run all required evidence'), evidence_regeneration: claimsAffected, deployment_impact: !!areas.deployment, security_impact: !!areas.security || !!areas.rls_data_isolation, cost_impact: !!areas.cost,
    continuation_rule: 'NO_SILENT_CONTINUATION: the changed decision, its stale dependents and any approval above must be re-confirmed before the package can be approved again.' });
}

module.exports = { buildDependencyGraph, buildTraceability, buildChangeImpact, revalidation, reachable, SCOPING, TAG_NODE, AREA };
