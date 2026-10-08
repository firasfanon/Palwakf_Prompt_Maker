'use strict';

/**
 * Decision state machine data (design sections 16 and 25, as corrected).
 * Pure data + pure functions. No clock, no randomness, no I/O.
 */

const DECISION_STATES = [
  'UNASKED', 'ASKED', 'ANSWERED', 'AI_RECOMMENDED_PENDING_APPROVAL', 'USER_CONFIRMED', 'USER_REJECTED',
  'USER_EDITED', 'DEFERRED_WITH_GATE', 'CONTRADICTED', 'STALE', 'NOT_APPLICABLE_WITH_RATIONALE',
];

const RESOLVED_STATES = ['USER_CONFIRMED', 'USER_EDITED', 'NOT_APPLICABLE_WITH_RATIONALE'];

const ACTOR_TYPES = ['USER', 'SYSTEM_RULE', 'AI_PROVIDER'];

// Earliest package stage that an unresolved mandatory item blocks (all later stages are blocked too).
const BLOCK_STAGES = ['COMPILATION', 'REVIEW', 'FACTORY_ADMISSION', 'EXECUTION'];

// from -> to -> allowed actor types. Anything not listed is rejected.
const TRANSITIONS = {
  UNASKED: { ASKED: ['SYSTEM_RULE'] },
  ASKED: {
    ANSWERED: ['USER'],
    AI_RECOMMENDED_PENDING_APPROVAL: ['AI_PROVIDER', 'SYSTEM_RULE'],
    DEFERRED_WITH_GATE: ['USER'],
    NOT_APPLICABLE_WITH_RATIONALE: ['USER'],
  },
  ANSWERED: {
    ANSWERED: ['USER'],
    USER_CONFIRMED: ['USER'],
    CONTRADICTED: ['SYSTEM_RULE'],
    STALE: ['SYSTEM_RULE'],
    DEFERRED_WITH_GATE: ['USER'],
    NOT_APPLICABLE_WITH_RATIONALE: ['USER'],
  },
  AI_RECOMMENDED_PENDING_APPROVAL: {
    USER_CONFIRMED: ['USER'],
    USER_EDITED: ['USER'],
    USER_REJECTED: ['USER'],
    AI_RECOMMENDED_PENDING_APPROVAL: ['AI_PROVIDER', 'SYSTEM_RULE'],
    STALE: ['SYSTEM_RULE'],
  },
  USER_CONFIRMED: { STALE: ['SYSTEM_RULE'], ASKED: ['USER'], CONTRADICTED: ['SYSTEM_RULE'] },
  USER_EDITED: { STALE: ['SYSTEM_RULE'], ASKED: ['USER'], CONTRADICTED: ['SYSTEM_RULE'] },
  NOT_APPLICABLE_WITH_RATIONALE: { STALE: ['SYSTEM_RULE'], ASKED: ['USER'] },
  USER_REJECTED: { ASKED: ['SYSTEM_RULE', 'USER'] },
  DEFERRED_WITH_GATE: { ASKED: ['SYSTEM_RULE', 'USER'], ANSWERED: ['USER'] },
  CONTRADICTED: { ASKED: ['SYSTEM_RULE', 'USER'] },
  STALE: { ASKED: ['SYSTEM_RULE', 'USER'] },
};

function transitionAllowed(from, to, actorType) {
  const row = TRANSITIONS[from];
  if (!row || !row[to]) return false;
  return row[to].indexOf(actorType) !== -1;
}

/**
 * Item catalog. `blocks` = first package stage blocked while the item is unresolved.
 * `phase` marks an item that only gates a later execution phase (phase-scoped approval, section 25).
 * `depends_on` drives invalidation: changing an item makes resolved dependents STALE.
 */
const ITEM_CATALOG = [
  { id: 'project_name', mandatory: true, blocks: 'COMPILATION', depends_on: [], na_allowed: false, label: { ar: 'اسم المشروع', en: 'Project name' } },
  { id: 'project_idea', mandatory: true, blocks: 'COMPILATION', depends_on: [], na_allowed: false, label: { ar: 'فكرة المشروع', en: 'Project idea' } },
  { id: 'project_goal', mandatory: true, blocks: 'COMPILATION', depends_on: [], na_allowed: false, label: { ar: 'هدف المشروع', en: 'Project goal' } },
  { id: 'success_measures', mandatory: true, blocks: 'REVIEW', depends_on: ['project_goal'], na_allowed: true, label: { ar: 'مقاييس النجاح', en: 'Success measures' } },
  { id: 'users_roles', mandatory: true, blocks: 'COMPILATION', depends_on: [], na_allowed: false, label: { ar: 'المستخدمون والأدوار', en: 'Users and roles' } },
  { id: 'workflows', mandatory: true, blocks: 'COMPILATION', depends_on: ['users_roles'], na_allowed: false, label: { ar: 'مسارات العمل', en: 'Workflows' } },
  { id: 'scope', mandatory: true, blocks: 'COMPILATION', depends_on: ['project_goal'], na_allowed: false, label: { ar: 'النطاق وما هو خارجه', en: 'Scope and non-scope' } },
  { id: 'business_rules', mandatory: true, blocks: 'REVIEW', depends_on: ['workflows'], na_allowed: true, label: { ar: 'قواعد العمل', en: 'Business rules' } },
  { id: 'platforms', mandatory: true, blocks: 'REVIEW', depends_on: [], na_allowed: false, label: { ar: 'المنصات', en: 'Platforms' } },
  { id: 'languages', mandatory: true, blocks: 'REVIEW', depends_on: [], na_allowed: false, label: { ar: 'اللغات', en: 'Languages' } },
  { id: 'data_entities', mandatory: true, blocks: 'EXECUTION', depends_on: ['workflows'], na_allowed: true, label: { ar: 'البيانات التي يحفظها النظام', en: 'Data the system keeps' } },
  { id: 'integrations', mandatory: true, blocks: 'EXECUTION', depends_on: ['workflows'], na_allowed: true, label: { ar: 'التكاملات مع أنظمة أخرى', en: 'Integrations' } },
  { id: 'data_sensitivity', mandatory: true, blocks: 'EXECUTION', depends_on: ['data_entities'], na_allowed: false, label: { ar: 'حساسية البيانات', en: 'Data sensitivity' } },
  { id: 'auth_model', mandatory: true, blocks: 'EXECUTION', depends_on: ['users_roles', 'data_sensitivity'], na_allowed: true, label: { ar: 'تسجيل الدخول والصلاحيات', en: 'Sign-in and permissions' } },
  { id: 'secrets_handling', mandatory: true, blocks: 'EXECUTION', depends_on: ['data_sensitivity'], na_allowed: true, label: { ar: 'حماية المفاتيح والأسرار', en: 'Secrets handling' } },
  { id: 'availability_targets', mandatory: true, blocks: 'EXECUTION', depends_on: ['platforms'], na_allowed: false, label: { ar: 'الحجم والتوفر', en: 'Scale and availability' } },
  { id: 'technology_stack', mandatory: true, blocks: 'FACTORY_ADMISSION', depends_on: ['platforms', 'data_sensitivity', 'availability_targets'], na_allowed: false, label: { ar: 'التقنية', en: 'Technology' } },
  { id: 'architecture', mandatory: true, blocks: 'EXECUTION', depends_on: ['technology_stack', 'data_entities', 'integrations'], na_allowed: false, label: { ar: 'المعمارية', en: 'Architecture' } },
  { id: 'hosting_target', mandatory: true, blocks: 'EXECUTION', phase: 'deployment', depends_on: ['technology_stack', 'availability_targets'], na_allowed: false, label: { ar: 'مكان التشغيل والتكلفة', en: 'Hosting and cost' } },
  { id: 'testing_expectations', mandatory: true, blocks: 'REVIEW', depends_on: ['workflows'], na_allowed: true, label: { ar: 'توقعات الاختبار', en: 'Testing expectations' } },
  { id: 'brand_copy', mandatory: false, blocks: null, depends_on: [], na_allowed: true, label: { ar: 'الهوية والنصوص', en: 'Branding and copy' } },
];

const CATALOG_BY_ID = {};
ITEM_CATALOG.forEach((it) => { CATALOG_BY_ID[it.id] = it; });

function stageIndex(stage) { return BLOCK_STAGES.indexOf(stage); }

function transitiveDependents(itemId) {
  const out = [];
  const seen = {};
  const walk = (id) => {
    ITEM_CATALOG.forEach((it) => {
      if (it.depends_on.indexOf(id) !== -1 && !seen[it.id]) {
        seen[it.id] = true;
        out.push(it.id);
        walk(it.id);
      }
    });
  };
  walk(itemId);
  return out;
}

/**
 * computePackageState — design section 25.
 *  DRAFT                          : an unresolved mandatory item blocks COMPILATION or REVIEW.
 *  BLOCKED_FOR_EXECUTION          : compilable and reviewable, but at least one unresolved mandatory item is
 *                                   still OPEN (asked/answered/proposed/stale/contradicted/rejected) and blocks
 *                                   FACTORY_ADMISSION or EXECUTION.
 *  REVIEWABLE_WITH_DEFERRED_ITEMS : compilable and reviewable; every unresolved mandatory item is a conscious
 *                                   DEFERRED_WITH_GATE. Readable by reviewers; never approvable by itself.
 *  READY_FOR_REVIEW               : every mandatory item resolved (confirmed, edited or N/A with rationale).
 * DEFERRED_WITH_GATE is NEVER treated as resolved.
 */
function computePackageState(itemStates) {
  const unresolved = [];
  ITEM_CATALOG.forEach((it) => {
    if (!it.mandatory) return;
    const st = (itemStates[it.id] && itemStates[it.id].state) || 'UNASKED';
    if (RESOLVED_STATES.indexOf(st) === -1) unresolved.push({ item_id: it.id, state: st, blocks: it.blocks, phase: it.phase || null });
  });
  const blockingEarly = unresolved.filter((u) => stageIndex(u.blocks) <= stageIndex('REVIEW'));
  let state;
  if (blockingEarly.length > 0) state = 'DRAFT';
  else if (unresolved.length === 0) state = 'READY_FOR_REVIEW';
  else if (unresolved.every((u) => u.state === 'DEFERRED_WITH_GATE')) state = 'REVIEWABLE_WITH_DEFERRED_ITEMS';
  else state = 'BLOCKED_FOR_EXECUTION';
  const compilable = !unresolved.some((u) => u.blocks === 'COMPILATION');
  return { state, unresolved, compilable, reviewable: blockingEarly.length === 0 };
}

/**
 * Phase-scoped approval eligibility (section 25): only when EVERY unresolved item is a conscious deferral
 * of an item that carries a `phase`, and the approval names all of those phases and gates.
 */
function phaseScopedEligibility(itemStates, requestedPhases, requestedGateItemIds) {
  const cs = computePackageState(itemStates);
  if (cs.state !== 'REVIEWABLE_WITH_DEFERRED_ITEMS') return { eligible: false, reason: 'package is not REVIEWABLE_WITH_DEFERRED_ITEMS (' + cs.state + ')' };
  const missing = [];
  cs.unresolved.forEach((u) => {
    if (!u.phase) missing.push(u.item_id + ' has no phase scope and cannot be deferred past approval');
    else if (requestedPhases.indexOf(u.phase) === -1) missing.push(u.item_id + ' phase ' + u.phase + ' not listed');
    if (requestedGateItemIds.indexOf(u.item_id) === -1) missing.push(u.item_id + ' gate not listed');
  });
  return missing.length ? { eligible: false, reason: missing.join('; ') } : { eligible: true, reason: null, unresolved: cs.unresolved };
}

module.exports = {
  DECISION_STATES, RESOLVED_STATES, ACTOR_TYPES, BLOCK_STAGES, TRANSITIONS, ITEM_CATALOG, CATALOG_BY_ID,
  transitionAllowed, stageIndex, transitiveDependents, computePackageState, phaseScopedEligibility,
};
