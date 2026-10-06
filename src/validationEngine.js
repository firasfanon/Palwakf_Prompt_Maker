'use strict';

const SECRET_LIKE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,       // OpenAI-style key
  /AKIA[0-9A-Z]{16}/,          // AWS access key
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\bpassword\s*[:=]\s*\S+/i,
];

function scanForSecrets(text) {
  const findings = [];
  SECRET_LIKE_PATTERNS.forEach((re) => {
    if (re.test(text || '')) findings.push('نمط يشبه سرًّا/مفتاحًا موجود في النص الحر — راجعه قبل المشاركة');
  });
  return findings;
}

const PROVIDER_LOCKIN_PATTERNS = [/\bopenai\b/i, /\banthropic\b/i, /\bclaude\b/i, /\bgpt-?\d/i, /\bgemini\b/i];

// scanCoreForProviderLockIn — section 31: a regression test to ensure the
// core compiler's own source text never hardcodes a specific AI provider's
// name into the generated output logic (would break model-agnosticity).
function scanCoreForProviderLockIn(sourceText) {
  const hits = [];
  PROVIDER_LOCKIN_PATTERNS.forEach((re) => { if (re.test(sourceText)) hits.push(re.toString()); });
  return hits;
}

/**
 * validateCandidate — section 32. Returns PASS | PASS_WITH_EXPLICIT_UNKNOWNS |
 * BLOCKED_REQUIRES_DECISION. Never returns a bare "PASS" if required_decisions
 * is non-empty — that would violate UNKNOWN != PASS.
 */
function validateCandidate(intent, blueprint) {
  const findings = [];

  const schemaOk = !!(blueprint.schema_version && blueprint.project_name && blueprint.project_profiles);
  if (!schemaOk) findings.push({ severity: 'BLOCKING', message: 'Blueprint ناقص بنيويًا' });

  const secretFindings = scanForSecrets(
    (intent.project_goal || '') + ' ' + JSON.stringify(intent.advanced || {})
  );
  secretFindings.forEach((f) => findings.push({ severity: 'BLOCKING', message: f }));

  // Basic contradiction check (section 32).
  if (
    blueprint.project_profiles.some((p) => p.profile_id === 'PUBLIC_PORTAL') &&
    blueprint.project_profiles.some((p) => p.profile_id === 'MULTI_TENANT_SAAS')
  ) {
    findings.push({
      severity: 'WARNING',
      message: 'تعارض محتمل: PUBLIC_PORTAL (مفتوح للجميع) و MULTI_TENANT_SAAS (عزل بيانات مؤسسات) في نفس المشروع — راجع يدويًا',
    });
  }

  // Section 31: distinguish unknowns that block a REQUIRED gate from ones
  // that don't (e.g. an unset optional field with a safe inferred default).
  const blockingUnknowns = [];
  const nonBlockingUnknowns = [];
  (blueprint.unknowns || []).forEach((u) => {
    const field = u.field || u;
    const blocksRequiredGate = (blueprint.required_decisions || []).some((d) => d.field === field);
    if (blocksRequiredGate) blockingUnknowns.push(u); else nonBlockingUnknowns.push(u);
  });

  // Prohibited-shortcut-violation scan: production_readiness_target must
  // never be asserted as a completion certificate by the engine itself.
  if (blueprint.production_readiness_target && blueprint.production_readiness_target === true) {
    findings.push({ severity: 'BLOCKING', message: 'production_readiness_target must never be asserted true by the compiler itself' });
  }

  const hasBlocking = findings.some((f) => f.severity === 'BLOCKING');
  const hasRequiredDecisions = blueprint.required_decisions.length > 0;

  let status;
  if (hasBlocking) status = 'BLOCKED_REQUIRES_DECISION';
  else if (hasRequiredDecisions || blueprint.unknowns.length > 0) status = 'PASS_WITH_EXPLICIT_UNKNOWNS';
  else status = 'PASS';

  return { status, findings, blocking_unknowns: blockingUnknowns, non_blocking_unknowns: nonBlockingUnknowns };
}

module.exports = { validateCandidate, scanForSecrets, scanCoreForProviderLockIn };
