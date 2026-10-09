'use strict';
// Shared helpers for the Full-Production tests. NOT a test file itself.
const assert = require('assert');
const X = require('../../gfpi/production');
const L = require('../../gfpi/ledger');
const D0 = require('../../gfpi/decisions');
const SC = require('../../gfpi/specCompiler');
const EP = require('../../gfpi/executionPackage');
const PM = require('../../src/index');
const { sha256OfValue } = require('../../gfpi/canon');

let clk = 0;
const at = () => '2026-03-01T00:' + String(Math.floor(clk / 60) % 60).padStart(2, '0') + ':' + String(clk++ % 60).padStart(2, '0') + 'Z';
const PROD = { name: 'prompt-maker', commit: 'test' };
const must = (r, msg) => { assert.ok(r && r.ok, (msg || 'expected ok') + ' ' + JSON.stringify(r)); return r; };

// Frozen 21-item base decisions for a plain-language SaaS idea (values a nontechnical founder can supply).
const BASE_VALUES = {
  project_name: 'مدير العيادات', project_idea: 'منصة اشتراكات تدير بها عدة عيادات مواعيدها ومرضاها', project_goal: 'تسهيل إدارة المواعيد للعيادات الصغيرة', success_measures: '50 عيادة مشتركة خلال ستة أشهر',
  users_roles: { users: 'أصحاب عيادات، موظفو استقبال', roles: 'مدير العيادة، موظف' }, workflows: 'تسجيل عيادة، حجز موعد، إلغاء، تقرير شهري', scope: 'المواعيد والمرضى فقط', business_rules: 'لا يرى مستخدم بيانات عيادة أخرى',
  platforms: 'موقع ويب', languages: 'العربية والإنجليزية', data_entities: 'عيادات، مرضى، مواعيد', integrations: 'بريد إلكتروني ودفع اشتراكات', data_sensitivity: 'FINANCIAL_OR_HEALTH', auth_model: 'بريد وكلمة مرور',
  secrets_handling: 'متغيرات بيئة', availability_targets: '5000 مستخدم', technology_stack: 'react-vite-supabase', architecture: 'خدمة سحابية', hosting_target: 'سحابة', testing_expectations: 'شامل',
};
function baseLedger(values, skip) {
  let l = L.createLedger('p1');
  Object.keys(values).forEach((k) => {
    if (skip && skip.indexOf(k) !== -1) return;
    l = L.appendEvent(l, { item_id: k, to: 'ASKED', actor_type: 'SYSTEM_RULE', actor_id: 'r', at: at() }).ledger;
    l = L.appendEvent(l, { item_id: k, to: 'ANSWERED', actor_type: 'USER', actor_id: 'founder', at: at(), value: values[k] }).ledger;
    l = must(L.appendEvent(l, { item_id: k, to: 'USER_CONFIRMED', actor_type: 'USER', actor_id: 'founder', at: at(), value: values[k], shown_value_sha256: sha256OfValue(values[k]) }), k).ledger;
  });
  return l;
}
function basePackage(l) {
  const c = SC.compileSpecs({ ledger: l, project_id: 'p1', created_at: '2026-03-01T00:00:00Z', producer: PROD, compileProject: PM.compileProject });
  must(c, 'compile');
  const b = EP.buildPackage(c, { ledger: l, created_at: '2026-03-01T00:00:00Z', producer: PROD });
  must(b, 'package');
  return { compiled: c, built: b };
}

/**
 * Simulated nontechnical user (SIMULATED HUMAN — explicitly a test actor):
 *  - answers only what `answers` provides (plain choices), says "I don't know" otherwise;
 *  - for every "I don't know" the system's deterministic recommendation is written PENDING and then confirmed by the simulated user
 *    only when acceptRecommendations is true.
 */
function session(o) {
  const intent = o.intent; const explicit = o.explicit; const baseStates = o.baseStates || {};
  let r = X.D.startDiscovery({ project_id: 'p1', intent, explicit, at: at(), baseStates });
  let ledger = r.ledger; const asked = new Set(r.asked); const trace = [];
  for (let i = 0; i < 12; i++) {
    let changed = false;
    Object.keys(o.answers || {}).forEach((id) => {
      const S = X.PL.foldLedger(ledger); const st = S[id] && S[id].state;
      if (st === 'USER_CONFIRMED' || st === 'USER_EDITED' || st === 'NOT_APPLICABLE_WITH_RATIONALE') return;
      const profile = X.detectProfile({ intent, explicit, itemStates: S, baseStates });
      if (X.C.applicability(X.C.byId[id], profile, S).applicable === 'NO') return;
      const v = o.answers[id];
      const res = (v && v.na) ? X.D.userNotApplicable(ledger, id, v.na, 'founder', at()) : X.D.userAnswer(ledger, id, v, 'founder', at());
      if (res.ok) { ledger = res.ledger; changed = true; trace.push(['ANSWER', id]); }
    });
    let S = X.PL.foldLedger(ledger);
    const profile = X.detectProfile({ intent, explicit, itemStates: S, baseStates });
    const sync = X.D.syncAsked(ledger, profile, at()); ledger = sync.ledger; sync.asked.forEach((a) => asked.add(a)); if (sync.asked.length) changed = true;
    if (o.acceptRecommendations || o.recommendOnly) {
      const rec = X.D.recommendAll(ledger, profile, at(), { intent, explicit, baseStates }); ledger = rec.ledger; if (rec.recommended.length) { changed = true; rec.recommended.forEach((x) => trace.push(['RECOMMEND', x])); }
    }
    if (o.acceptRecommendations) {
      S = X.PL.foldLedger(ledger);
      Object.keys(S).forEach((id) => {
        if (S[id].state === 'AI_RECOMMENDED_PENDING_APPROVAL') {
          const ex = X.D.explain(X.C.byId[id], profile, S); assert.ok(ex.why && ex.alternatives && ex.human_confirmation_required === true);
          const c = X.D.userConfirm(ledger, id, 'founder', at()); if (c.ok) { ledger = c.ledger; changed = true; trace.push(['CONFIRM', id]); }
        }
      });
    }
    if (!changed) break;
  }
  return { ledger, asked: Array.from(asked), trace };
}
const analyze = (o, ledger, extra) => X.analyze(Object.assign({ project_id: 'p1', created_at: '2026-03-02T00:00:00Z', intent: o.intent, explicit: o.explicit, ledger, baseStates: o.baseStates || {}, producer: PROD }, extra || {}));

module.exports = { X, L, D0, SC, EP, PM, sha256OfValue, at, PROD, must, BASE_VALUES, baseLedger, basePackage, session, analyze, assert };
