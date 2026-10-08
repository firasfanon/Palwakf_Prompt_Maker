'use strict';

/**
 * Deterministic redaction applied to any payload BEFORE it can leave the machine (and before it is previewed).
 * Conservative: unknown secret formats are not detectable, so redaction reduces risk but never replaces consent.
 */
const RULES = [
  { kind: 'PRIVATE_KEY_BLOCK', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'BEARER_TOKEN', re: /\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}/gi },
  { kind: 'API_KEY_SK', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'AWS_ACCESS_KEY', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'GITHUB_TOKEN', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: 'URL_CREDENTIALS', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s\/:@]+:[^\s\/@]+@[^\s]+/gi },
  { kind: 'KEY_VALUE_SECRET', re: /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi },
  { kind: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'PHONE', re: /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g },
  { kind: 'LONG_DIGIT_ID', re: /(?<![\w.])\d{9,}(?![\w.])/g },
];

function redactText(text) {
  let out = String(text);
  const counts = {};
  RULES.forEach((r) => {
    out = out.replace(r.re, () => { counts[r.kind] = (counts[r.kind] || 0) + 1; return '[REDACTED:' + r.kind + ']'; });
  });
  return { text: out, redactions: Object.keys(counts).sort().map((k) => ({ kind: k, count: counts[k] })) };
}

/** Deep-redacts every string in a JSON-like value (keys are not rewritten). */
function redactValue(value) {
  const redactions = {};
  const walk = (v) => {
    if (typeof v === 'string') {
      const r = redactText(v);
      r.redactions.forEach((x) => { redactions[x.kind] = (redactions[x.kind] || 0) + x.count; });
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = walk(v[k]); }); return o; }
    return v;
  };
  const value2 = walk(value);
  return { value: value2, redactions: Object.keys(redactions).sort().map((k) => ({ kind: k, count: redactions[k] })) };
}

module.exports = { redactText, redactValue, RULES };
