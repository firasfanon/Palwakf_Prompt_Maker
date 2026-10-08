'use strict';

/**
 * ProductionExecutionAttachmentV1 — enriches an AgentExecutionPackageV1 for Full-Production projects WITHOUT changing the
 * frozen package. It carries references/hashes (not copies) to every production artifact plus the unresolved blockers, and has
 * its OWN approval bound to the attachment hash. The frozen package approval and this approval are independent; an execution
 * grant needs both. Neither approval can be issued while the completeness guardian has blocking findings.
 */

const K = require('./common');
const { sha256OfValue } = require('../canon');
const PL = require('./prodLedger');
const R = require('./readiness');

function buildAttachment(ctx, artifacts, basePackage) {
  const manifest = Object.keys(artifacts).sort().map((k) => ({ name: k, artifact_type: artifacts[k].artifact_type, sha256: artifacts[k].content_sha256 }));
  const g = artifacts.guardian;
  const state = ctx.readiness || null;
  return K.makeProdArtifact('ProductionExecutionAttachmentV1', { artifact_id: ctx.project_id + ':ProductionExecutionAttachmentV1:' + ctx.head.slice(0, 12), project_id: ctx.project_id, created_at: ctx.created_at, producer: ctx.producer,
    references: manifest.map((m) => ({ artifact_type: m.artifact_type, artifact_id: artifacts[m.name].artifact_id, sha256: m.sha256 })).concat(basePackage ? [{ artifact_type: 'AgentExecutionPackageV1', artifact_id: basePackage.artifact_id, sha256: basePackage.content_sha256 }] : []), fields: {
      production_ledger_head_sha256: ctx.head, base_package_sha256: basePackage ? basePackage.content_sha256 : null, manifest,
      carries: ['requirements', 'confirmed decisions', 'ADRs', 'dependency graph', 'NFR contract', 'threat model', 'data lifecycle', 'deployment topology', 'cost model', 'production evidence contract', 'acceptance criteria (claims)', 'execution sequence', 'security gates', 'test gates', 'operational gates', 'rollback expectations', 'unresolved blockers'],
      execution_sequence: ['1. confirm all blocking decisions', '2. implement identity/authorization/tenancy controls and their negative tests first', '3. data model and migrations with rollback plan', '4. billing/provisioning idempotency', '5. observability and alerting', '6. backup, restore drill', '7. staging rehearsal incl. rollback', '8. collect evidence for every claim', '9. human production decision'],
      security_gates: ['TENANT_ISOLATION_READY', 'AUTHENTICATION_READY', 'AUTHORIZATION_READY', 'SECURITY_TESTED'].filter((c) => artifacts.evidence.applicable_claim_ids.indexOf(c) !== -1),
      test_gates: ['TEST_STRATEGY_EXECUTED'], operational_gates: ['BACKUP_RESTORE_READY', 'OBSERVABILITY_READY', 'DEPLOYMENT_READY', 'MIGRATION_SAFE', 'INCIDENT_READINESS'].filter((c) => artifacts.evidence.applicable_claim_ids.indexOf(c) !== -1),
      rollback_expectations: 'Every migration and deployment must have a rehearsed rollback before production.',
      unresolved_blockers: g.findings.filter((f) => f.blocking).map((f) => ({ code: f.code, item_id: f.item_id || null, claim_id: f.claim_id || null })),
      guardian_verdict: g.verdict, readiness_state_at_build: state ? state.state : null,
      factory_support: { status: artifacts.factory.FACTORY_SUPPORT_STATUS, recommended_stack: artifacts.factory.RECOMMENDED_STACK },
      readiness_statement: 'Specification completeness is not implementation completeness, and implementation completeness is not production readiness. This attachment proves none of the latter two.' } });
}

function approveAttachment(att, prodLedger, req) {
  if (!K.verifyProdArtifact(att)) return { ok: false, error: 'ATTACHMENT_INVALID' };
  if (!req || req.actor_type !== 'USER' || !req.actor_id || !req.at) return { ok: false, error: 'HUMAN_ACTION_REQUIRED' };
  if (req.attachment_sha256 !== att.content_sha256) return { ok: false, error: 'APPROVAL_NOT_BOUND_TO_ATTACHMENT_HASH' };
  if (!PL.verifyLedger(prodLedger).valid) return { ok: false, error: 'LEDGER_INVALID' };
  if (PL.headHash(prodLedger) !== att.production_ledger_head_sha256) return { ok: false, error: 'ATTACHMENT_SUPERSEDED_BY_DECISION_CHANGE' };
  if (att.guardian_verdict !== 'CLEAR_FOR_ENGINEERING_REVIEW' || att.unresolved_blockers.length) return { ok: false, error: 'EXECUTION_BLOCKED_BY_GUARDIAN', blockers: att.unresolved_blockers };
  if (att.base_package_sha256 !== (req.base_package_sha256 || null)) return { ok: false, error: 'APPROVAL_NOT_BOUND_TO_BASE_PACKAGE' };
  const rec = { approval_type: 'PRODUCTION_EXECUTION_ATTACHMENT_APPROVAL', attachment_sha256: att.content_sha256, production_ledger_head_sha256: att.production_ledger_head_sha256, base_package_sha256: att.base_package_sha256, actor_type: 'USER', actor_id: req.actor_id, at: req.at,
    statement: 'Approves the SPECIFICATION for execution only. Not an assertion of implementation, validation or production readiness.' };
  rec.approval_sha256 = sha256OfValue(rec);
  return { ok: true, approval: rec };
}
const approvalIntact = (a) => { const c = Object.assign({}, a); delete c.approval_sha256; return sha256OfValue(c) === a.approval_sha256; };

function attachmentStatus(att, approval, currentProdLedger) {
  if (PL.headHash(currentProdLedger) !== att.production_ledger_head_sha256) return { status: 'SUPERSEDED', reason: 'PRODUCTION_DECISIONS_CHANGED', approval_valid: false };
  if (!approval) return { status: att.guardian_verdict === 'CLEAR_FOR_ENGINEERING_REVIEW' ? 'READY_FOR_ENGINEERING_REVIEW' : 'EXECUTION_BLOCKED', approval_valid: false };
  if (!approvalIntact(approval)) return { status: 'EXECUTION_BLOCKED', reason: 'APPROVAL_RECORD_TAMPERED', approval_valid: false };
  if (approval.attachment_sha256 !== att.content_sha256) return { status: 'EXECUTION_BLOCKED', reason: 'APPROVAL_FOR_DIFFERENT_ATTACHMENT', approval_valid: false };
  return { status: 'APPROVED_FOR_EXECUTION', approval_valid: true };
}

module.exports = { buildAttachment, approveAttachment, attachmentStatus, approvalIntact, R };
