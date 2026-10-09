'use strict';

/**
 * Engineering recommendation vs Factory admission (additive). ENGINEERING_RECOMMENDED_STACK != FACTORY_ADMITTED_STACK.
 * The recommendation is derived from required CAPABILITIES, never from what the Factory happens to support; if the
 * recommended stack is unsupported the report states the execution gap and the user's choices. NO_SILENT_SUBSTITUTION.
 * Factory support list is read from the frozen question plan (TECH_CHOICES), i.e. the same source the frozen engine uses.
 */

const C = require('./catalog');
const K = require('./common');
const Q = require('../questionPlan');

const STACKS = {
  'react-vite-supabase': { label: 'React + Vite + Supabase', provides: ['web', 'rls_isolation', 'managed_auth', 'edge_functions_webhooks', 'scheduled_jobs_basic', 'managed_postgres'], lacks: ['schema_per_tenant', 'database_per_tenant', 'durable_queue_workers_at_scale', 'self_hosted_models', 'server_side_rendering_seo'] },
  'flutter-supabase': { label: 'Flutter + Supabase', provides: ['mobile', 'rls_isolation', 'managed_auth', 'edge_functions_webhooks', 'managed_postgres'], lacks: ['schema_per_tenant', 'database_per_tenant', 'durable_queue_workers_at_scale', 'self_hosted_models', 'web_first'] },
  'nextjs-managed-postgres-workers': { label: 'Next.js + managed Postgres + queue workers (engineering reference stack)', provides: ['web', 'rls_isolation', 'schema_per_tenant', 'database_per_tenant', 'managed_auth', 'edge_functions_webhooks', 'scheduled_jobs_basic', 'durable_queue_workers_at_scale', 'server_side_rendering_seo', 'managed_postgres'], lacks: ['mobile'] },
};

function requiredCapabilities(ctx) {
  const S = ctx.states; const P = ctx.profile; const need = []; const why = {};
  const add = (c, w) => { if (need.indexOf(c) === -1) { need.push(c); why[c] = w; } };
  const v = (id) => K.view(S, id).value;
  const plat = String((ctx.baseStates && ctx.baseStates.platforms && ctx.baseStates.platforms.value) || '').toLowerCase();
  if (/(جوال|موبايل|mobile|ios|android)/.test(plat) || P.archetype_candidates.indexOf('MOBILE_FIRST_SAAS') !== -1) add('mobile', 'platform/archetype is mobile'); else add('web', 'default web delivery');
  const iso = v('tenant_isolation');
  if (iso === 'RLS_SHARED_SCHEMA') add('rls_isolation', 'tenant_isolation=RLS_SHARED_SCHEMA');
  if (iso === 'SCHEMA_PER_TENANT') add('schema_per_tenant', 'tenant_isolation=SCHEMA_PER_TENANT');
  if (iso === 'DATABASE_PER_TENANT') add('database_per_tenant', 'tenant_isolation=DATABASE_PER_TENANT');
  if (K.live(P, S, 'payment_failure_policy')) add('edge_functions_webhooks', 'billing requires webhook handling');
  if (v('nfr_scale') === 'UP_TO_1M_USERS' || v('nfr_scale') === 'OVER_1M_USERS') add('durable_queue_workers_at_scale', 'scale tier requires dedicated workers');
  if (K.live(P, S, 'ai_evaluation_plan') && /(self[- ]?host|on[- ]?prem|محلي)/i.test(String(v('build_vs_buy') || '') + String(ctx.intent || ''))) add('self_hosted_models', 'self-hosted models requested');
  return { need, why };
}

function factoryReport(ctx) {
  const supported = Q.TECH_CHOICES.map((t) => t.value);
  const userStack = ctx.baseStates && ctx.baseStates.technology_stack && ['USER_CONFIRMED', 'USER_EDITED'].indexOf(ctx.baseStates.technology_stack.state) !== -1 ? ctx.baseStates.technology_stack.value : null;
  const req = requiredCapabilities(ctx);
  const fits = (id) => req.need.every((c) => STACKS[id].provides.indexOf(c) !== -1);
  const order = ['react-vite-supabase', 'flutter-supabase', 'nextjs-managed-postgres-workers'];
  const engineering = order.find(fits) || null;
  const recommended = userStack && userStack.indexOf('manual:') !== 0 ? userStack : (userStack ? userStack.slice(7) : engineering);
  const rec = engineering ? 'Selected by capability fit (not by Factory support): ' + req.need.map((c) => c + ' <- ' + req.why[c]).join('; ') : 'No catalogued stack satisfies all required capabilities';
  const status = recommended && supported.indexOf(recommended) !== -1 ? 'SUPPORTED' : (recommended ? 'UNSUPPORTED' : 'NOT_DETERMINED');
  const alternatives = supported.map((s) => ({ stack: s, satisfies_all_required_capabilities: fits(s), missing_capabilities: req.need.filter((c) => STACKS[s].provides.indexOf(c) === -1), tradeoff: fits(s) ? 'Fully covers the required capabilities' : 'Would require changing the requirement or accepting a capability gap' }));
  const choices = status === 'UNSUPPORTED' ? [
    { id: 'ACCEPT_GAP_EXECUTE_OUTSIDE_FACTORY', text_en: 'Keep the recommended stack and execute with a non-Factory agent; Factory admission stays UNSUPPORTED.', text_ar: 'إبقاء التقنية الموصى بها والتنفيذ بوكيل خارج المصنع؛ يبقى قبول المصنع غير مدعوم.' },
    { id: 'CHOOSE_SUPPORTED_STACK_WITH_EXPLICIT_REQUIREMENT_CHANGES', text_en: 'Choose a Factory-supported stack and explicitly revise the requirements it cannot meet (shown in alternatives).', text_ar: 'اختيار تقنية يدعمها المصنع مع تعديل صريح للمتطلبات التي لا تغطيها.' },
    { id: 'REQUEST_FACTORY_PROFILE_EXTENSION', text_en: 'Request a Factory profile extension (a separate authorization in a different project).', text_ar: 'طلب توسيع ملفات المصنع (تفويض منفصل في مشروع آخر).' }] : [];
  const gaps = recommended && STACKS[recommended] ? req.need.filter((c) => STACKS[recommended].provides.indexOf(c) === -1) : [];
  return K.makeProdArtifact('FactorySupportReportV1', { artifact_id: ctx.project_id + ':FactorySupportReportV1:' + ctx.head.slice(0, 12), project_id: ctx.project_id, created_at: ctx.created_at, producer: ctx.producer, references: [], fields: {
    RECOMMENDED_STACK: recommended, STACK_SOURCE: userStack ? 'USER_CONFIRMED_DECISION' : 'ENGINEERING_RECOMMENDATION_PENDING_APPROVAL', recommendation_state: userStack ? 'CONFIRMED_BY_USER' : 'AI_RECOMMENDED_PENDING_APPROVAL',
    WHY_RECOMMENDED: rec, required_capabilities: req.need, FACTORY_SUPPORT_STATUS: status, factory_supported_stacks: supported,
    EXECUTION_GAP: status === 'UNSUPPORTED' ? 'Factory cannot execute ' + recommended + '; the package can still be reviewed and executed by another agent, but Factory-based execution is not available.' : (gaps.length ? 'Supported stack but capability gaps: ' + gaps.join(', ') : null),
    capability_gaps_on_selected_stack: gaps, ALTERNATIVES: alternatives, TRADEOFFS: alternatives.map((a) => a.stack + ': ' + a.tradeoff), AVAILABLE_USER_CHOICES: choices, silent_substitution: false,
    separation: 'ENGINEERING_RECOMMENDED_STACK != FACTORY_ADMITTED_STACK; Factory admission is decided by the Factory profile mapping, not by this report.' } });
}

module.exports = { factoryReport, requiredCapabilities, STACKS };
