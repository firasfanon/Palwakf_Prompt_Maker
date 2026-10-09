'use strict';

/**
 * GFPI Full-Production / SaaS / AI-native engineering intelligence (additive layer).
 * analyze() derives every production artifact from (intent, production ledger, frozen base states) in dependency order.
 * Nothing here mutates the frozen engine, the frozen ledger, the frozen contracts or the frozen package.
 */

const C = require('./catalog');
const PL = require('./prodLedger');
const { detectProfile } = require('./profile');
const A = require('./adaptive');
const R = require('./readiness');
const M = require('./models');
const G = require('./graph');
const F = require('./factory');
const GU = require('./guardian');
const D = require('./discovery');
const AT = require('./attachment');
const K = require('./common');
const CF = require('./conflicts');

function analyze(p) {
  const states = PL.foldLedger(p.ledger); const head = PL.headHash(p.ledger);
  const profile = detectProfile({ intent: p.intent, explicit: p.explicit, itemStates: states, baseStates: p.baseStates });
  const ctx = { project_id: p.project_id, created_at: p.created_at, producer: p.producer || { name: 'prompt-maker', commit: 'unknown' }, head, profile, states, ledger: p.ledger, baseStates: p.baseStates || {}, intent: p.intent, admission: p.admission };
  if (!profile.activation.FULL_PRODUCTION_PROFILE) return { activated: false, profile, ctx };
  const evidenceContract = M.buildEvidenceContract(ctx);
  const applied = M.applyEvidence(evidenceContract, states, p.attestations || []);
  const graph = G.buildDependencyGraph(ctx);
  const traceability = G.buildTraceability(Object.assign({ graph }, ctx));
  const factory = F.factoryReport(ctx);
  const nfr = M.buildNFRContract(ctx); const threat = M.buildThreatModel(ctx); const data = M.buildDataLifecycle(ctx); const topology = M.buildDeploymentTopology(ctx); const cost = M.buildCostModel(ctx);
  const bvb = M.buildBuildVsBuy(ctx); const ai = M.buildAIProfile(ctx); const adr = M.buildADRs(ctx); const failures = M.buildFailureSemantics(ctx);
  const guardian = GU.evaluate(Object.assign({ evidenceContract, traceability, factory, assertedClaims: p.assertedClaims, evidenced: applied.evidenced }, ctx));
  const claimsMeta = evidenceContract.claims.filter((c) => c.applicable !== 'NO').map((c) => ({ claim_id: c.claim_id, group: c.group, dimensions: c.dimensions }));
  const model = R.buildReadinessModel({ profile, states, approvedForExecution: !!(p.approval && p.approval.intact), implementation: p.implementationByDimension || null, evidencedClaims: applied.evidenced, claims: claimsMeta });
  const readiness = R.deriveReadinessState({ profile, model, guardian, approval: p.approval || null, implementation: p.implementation || null, claims: claimsMeta, evidencedClaims: applied.evidenced, release: p.release || null });
  const artifacts = { evidence: evidenceContract, graph, traceability, factory, nfr, threat, data, topology, cost, bvb, ai, adr, failures, guardian };
  return { activated: true, profile, ctx, artifacts, conflicts: CF.detect(states), readinessModel: model, readiness, evidenceApplication: applied, nextQuestions: A.nextQuestions(profile, states, { limit: p.limit || 5, lang: p.lang }), head };
}

module.exports = { analyze, CF, C, PL, A, R, M, G, F, GU, D, AT, K, detectProfile };
