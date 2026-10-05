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

  const hasBlocking = findings.some((f) => f.severity === 'BLOCKING');
  const hasRequiredDecisions = blueprint.required_decisions.length > 0;

  let status;
  if (hasBlocking) status = 'BLOCKED_REQUIRES_DECISION';
  else if (hasRequiredDecisions || blueprint.unknowns.length > 0) status = 'PASS_WITH_EXPLICIT_UNKNOWNS';
  else status = 'PASS';

  return { status, findings };
}

module.exports = { validateCandidate, scanForSecrets };
