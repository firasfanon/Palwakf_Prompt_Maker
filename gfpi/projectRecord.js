'use strict';

const { sha256Hex, sha256OfValue } = require('./canon');
const A = require('./artifacts');
const L = require('./ledger');
const EP = require('./executionPackage');

/**
 * Project record helpers (PM-FULL-PRODUCTION-INTEGRATED-V1). Pure, deterministic, bundle-safe: no clock, randomness,
 * environment, filesystem or network access (time is always passed in by the caller).
 *
 * 1. EXISTING-PROJECT CONTEXT. The guided UI lets the user describe an existing project. The form is turned into the
 *    frozen, generic ProjectContextV1 import contract (src/core.js, schema 1.0) and is used for compilation ONLY after the
 *    user explicitly confirms the exact value shown (its SHA-256 is bound into the record). The 21-item decision catalog
 *    is NOT changed. A textual description is user-stated context, never a source-code inspection: the brownfield
 *    assessment it enables stays ASSUMED, not CONFIRMED.
 *
 * 2. PROJECT FILE. A whole project (decision ledger, production ledger, packages, approvals, context) can be exported to
 *    one JSON file and reopened elsewhere. Import recomputes every hash and verifies every ledger chain; nothing stored
 *    in the file is trusted without recomputation. The file hash is an INTEGRITY check (accidental corruption, tampering
 *    that does not also recompute hashes), NOT an authenticity signature.
 */

const PROJECT_FILE_FORMAT = 'PROMPT_MAKER_PROJECT_FILE_V1';
const CONTEXT_SCHEMA_VERSION = '1.0';
const CONTEXT_FORM_FIELDS = ['repository', 'current_state', 'existing_stack', 'existing_capabilities', 'existing_tests', 'known_gaps', 'existing_constraints'];
const MAX_FIELD = 5000;
const PROJECT_ID_RE = /^p[0-9a-f]{12}$/;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function lines(v) { return typeof v === 'string' ? v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : []; }
function clean(form) {
  const f = {};
  CONTEXT_FORM_FIELDS.forEach((k) => { const v = form && typeof form[k] === 'string' ? form[k].trim() : ''; f[k] = v; });
  return f;
}

/** Validates the existing-project form. Returns {ok, errors[], form (trimmed)}. */
function validateContextForm(form) {
  const f = clean(form); const errors = [];
  CONTEXT_FORM_FIELDS.forEach((k) => {
    if (f[k].length > MAX_FIELD) errors.push({ field: k, code: 'TOO_LONG' });
    if (CTRL.test(f[k])) errors.push({ field: k, code: 'CONTROL_CHARACTERS' });
  });
  if (/\s/.test(f.repository)) errors.push({ field: 'repository', code: 'REPOSITORY_SINGLE_REFERENCE' });
  if (!f.current_state && !f.existing_capabilities) errors.push({ field: 'current_state', code: 'CONTEXT_REQUIRES_STATE_OR_CAPABILITIES' });
  return { ok: errors.length === 0, errors, form: f };
}

/** Form -> raw ProjectContextV1 (schema 1.0). Deterministic. Returns null when the form is invalid. */
function contextFromForm(form) {
  const v = validateContextForm(form); if (!v.ok) return null;
  const f = v.form; const ctx = { schema_version: CONTEXT_SCHEMA_VERSION };
  if (f.current_state) ctx.current_state = f.current_state;
  const arch = lines(f.existing_stack); if (arch.length) ctx.existing_architecture = arch;
  const caps = lines(f.existing_capabilities); if (caps.length) ctx.existing_capabilities = caps;
  const tests = lines(f.existing_tests); if (tests.length) ctx.existing_tests = tests;
  const gaps = lines(f.known_gaps); if (gaps.length) ctx.known_gaps = gaps;
  const cons = lines(f.existing_constraints); if (cons.length) ctx.existing_constraints = cons;
  if (f.repository) ctx.source_references = [{ type: 'REPOSITORY', ref: f.repository, note: 'stated by the user (not inspected)' }];
  return ctx;
}

/**
 * Confirmation record. Only a USER action (actor_type USER) confirms; the record binds the SHA-256 of the exact
 * context value that was shown. `shown_context_sha256` must equal the hash of the value derived from the form.
 */
function confirmContext(form, req) {
  if (!req || req.actor_type !== 'USER' || !req.actor_id || !req.at) return { ok: false, error: 'HUMAN_ACTION_REQUIRED' };
  const v = validateContextForm(form); if (!v.ok) return { ok: false, error: 'CONTEXT_FORM_INVALID', errors: v.errors };
  const context = contextFromForm(v.form); const h = sha256OfValue(context);
  if (req.shown_context_sha256 !== h) return { ok: false, error: 'CONFIRMATION_NOT_BOUND_TO_SHOWN_VALUE' };
  const rec = { kind: 'EXISTING_PROJECT', state: 'CONFIRMED', form: v.form, context, context_sha256: h, actor_type: 'USER', actor_id: req.actor_id, confirmed_at: req.at, evidence_class: 'USER_STATED_TEXT_NOT_SOURCE_INSPECTION' };
  rec.record_sha256 = sha256OfValue(withoutKey(rec, 'record_sha256'));
  return { ok: true, record: rec };
}

function withoutKey(o, k) { const c = Object.assign({}, o); delete c[k]; return c; }

/** A context record is usable only if CONFIRMED and every hash recomputes. */
function contextIntact(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.state !== 'CONFIRMED' || rec.kind !== 'EXISTING_PROJECT' || rec.actor_type !== 'USER') return false;
  if (sha256OfValue(withoutKey(rec, 'record_sha256')) !== rec.record_sha256) return false;
  const derived = contextFromForm(rec.form);
  return !!derived && sha256OfValue(derived) === rec.context_sha256 && sha256OfValue(rec.context) === rec.context_sha256;
}

/** The ProjectContextV1 to compile with, or null (new project, draft, or a record that failed verification). */
function effectiveContext(rec) { return contextIntact(rec) ? rec.context : null; }

/** Verifies one stored package entry ({built:{package, documents, package_sha256}, approval}). */
function verifyPackageEntry(entry) {
  const errors = [];
  if (!entry || !entry.built || !entry.built.package) return ['package entry malformed'];
  const pkg = entry.built.package; const docs = entry.built.documents || {};
  const v = A.validateArtifact(pkg); if (!v.valid) errors.push('package artifact: ' + v.errors.join(','));
  if (entry.built.package_sha256 !== pkg.content_sha256) errors.push('package_sha256 differs from content hash');
  (pkg.manifest || []).forEach((m) => {
    if (m.path === 'MASTER_PROMPT.md') { if (sha256Hex(pkg.master_prompt) !== m.sha256) errors.push('master prompt hash'); return; }
    if (docs[m.path] === undefined) errors.push('missing document ' + m.path); else if (sha256OfValue(docs[m.path]) !== m.sha256) errors.push('document hash ' + m.path);
  });
  const listed = (pkg.manifest || []).map((m) => m.path);
  Object.keys(docs).forEach((p) => { if (listed.indexOf(p) === -1) errors.push('unlisted document ' + p); });
  if (entry.approval) {
    if (!EP.approvalIntact(entry.approval)) errors.push('approval record altered');
    else if (entry.approval.package_sha256 !== pkg.content_sha256) errors.push('approval bound to a different package');
  }
  if (entry.context_sha256 !== undefined && entry.context_sha256 !== null && !/^[0-9a-f]{64}$/.test(String(entry.context_sha256))) errors.push('context_sha256 malformed');
  return errors;
}

/** Hash of the project's SUBSTANCE (decisions, packages, approvals, context, production layer); UI preferences
 *  (`lang`, `mode`) are excluded so that switching language never turns an identical project into a "conflict". */
function substanceSha256(record) { const c = Object.assign({}, record); delete c.lang; delete c.mode; return sha256OfValue(c); }

/** Whole-project export. `exported_at` is supplied by the caller (no clock here). */
function exportProjectFile(record, exportedAt) {
  return { format: PROJECT_FILE_FORMAT, exported_at: exportedAt, record, record_sha256: sha256OfValue(record) };
}

function strictLedger(jsonl, id) {
  const r = L.fromJsonl(typeof jsonl === 'string' ? jsonl : '', id);
  if (!r.ok) return { ok: false, error: r.error + (r.broken_at !== undefined ? '@' + r.broken_at : '') };
  if (r.torn_tail_discarded) return { ok: false, error: 'TORN_TAIL' };
  return { ok: true, ledger: r.ledger };
}

/**
 * Verifies a parsed project file. Nothing is trusted without recomputation. Returns {valid, errors[], record}.
 * (`record` is returned only when valid.)
 */
function verifyProjectFile(file) {
  const errors = [];
  if (!file || typeof file !== 'object' || file.format !== PROJECT_FILE_FORMAT) return { valid: false, errors: ['format'], record: null };
  const rec = file.record;
  if (!rec || typeof rec !== 'object') return { valid: false, errors: ['record missing'], record: null };
  if (sha256OfValue(rec) !== file.record_sha256) errors.push('record hash mismatch');
  if (typeof rec.id !== 'string' || !PROJECT_ID_RE.test(rec.id)) errors.push('project id malformed');
  else {
    const led = strictLedger(rec.ledger_jsonl, rec.id); if (!led.ok) errors.push('decision ledger: ' + led.error);
    if (rec.prod) { const pl = strictLedger(rec.prod.ledger_jsonl, rec.id); if (!pl.ok) errors.push('production ledger: ' + pl.error); }
  }
  if (!Array.isArray(rec.packages)) errors.push('packages must be an array');
  else rec.packages.forEach((e, i) => { verifyPackageEntry(e).forEach((x) => errors.push('package v' + (i + 1) + ': ' + x)); });
  if (rec.context !== undefined && rec.context !== null && !contextIntact(rec.context)) errors.push('project context record altered or unconfirmed');
  if (rec.context_draft !== undefined && rec.context_draft !== null) {
    const d = rec.context_draft;
    if (typeof d !== 'object' || (d.kind !== 'NEW' && d.kind !== 'EXISTING') || (d.form !== undefined && (typeof d.form !== 'object' || d.form === null))) errors.push('context draft malformed');
    else Object.keys(d.form || {}).forEach((k) => { if (CONTEXT_FORM_FIELDS.indexOf(k) === -1 || typeof d.form[k] !== 'string' || d.form[k].length > MAX_FIELD) errors.push('context draft field ' + k); });
  }
  if (rec.lang !== undefined && rec.lang !== 'ar' && rec.lang !== 'en') errors.push('lang');
  return { valid: errors.length === 0, errors, record: errors.length ? null : rec };
}

module.exports = {
  PROJECT_FILE_FORMAT, CONTEXT_FORM_FIELDS, CONTEXT_SCHEMA_VERSION, PROJECT_ID_RE,
  validateContextForm, contextFromForm, confirmContext, contextIntact, effectiveContext,
  verifyPackageEntry, exportProjectFile, verifyProjectFile, substanceSha256,
};
