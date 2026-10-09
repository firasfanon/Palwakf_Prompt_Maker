'use strict';

const { sha256OfValue } = require('./canon');
const { redactValue } = require('./redaction');
const B = require('./budget');

/**
 * Vendor-neutral provider layer (ADR-002). Isomorphic (no Node built-ins).
 * Adapter contract: { id, kind: HOSTED_API|LOCAL_MODEL_RUNTIME|MANUAL_DETERMINISTIC|RECORDED_FIXTURE, locality: EXTERNAL|LOCAL|NONE,
 *                     model_version, isAvailable():Promise<bool>, invoke(request):Promise<{text?, json?, usage?}> }
 * AI output is untrusted DATA. It never becomes a confirmed decision here; the caller records it as a proposal only.
 */

const ADAPTER_KINDS = ['HOSTED_API', 'LOCAL_MODEL_RUNTIME', 'MANUAL_DETERMINISTIC', 'RECORDED_FIXTURE'];

// ---------- mini JSON-schema validator (subset) ----------
function validateSchema(schema, value, path, errors) {
  path = path || '$'; errors = errors || [];
  const t = schema.type;
  const fail = (m) => errors.push(path + ': ' + m);
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('expected object'); return errors; }
    (schema.required || []).forEach((k) => { if (!(k in value)) fail('missing ' + k); });
    const props = schema.properties || {};
    Object.keys(value).forEach((k) => {
      if (props[k]) validateSchema(props[k], value[k], path + '.' + k, errors);
      else if (schema.additionalProperties === false) fail('unexpected ' + k);
    });
  } else if (t === 'array') {
    if (!Array.isArray(value)) { fail('expected array'); return errors; }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few items');
    if (schema.items) value.forEach((v, i) => validateSchema(schema.items, v, path + '[' + i + ']', errors));
  } else if (t === 'string') {
    if (typeof value !== 'string') { fail('expected string'); return errors; }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('too long');
    if (schema.enum && schema.enum.indexOf(value) === -1) fail('not in enum');
  } else if (t === 'number') {
    if (typeof value !== 'number' || !isFinite(value)) fail('expected number');
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') fail('expected boolean');
  } else fail('unsupported schema type');
  return errors;
}

function sanitizeStrings(v) {
  if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 4000);
  if (Array.isArray(v)) return v.map(sanitizeStrings);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = sanitizeStrings(v[k]); }); return o; }
  return v;
}

// ---------- consent: single-use, bound to provider + exact redacted payload hash ----------
function createConsentStore() {
  const grants = [];
  return {
    grant(g) {
      if (!g || !g.provider_id || !/^[0-9a-f]{64}$/.test(g.payload_sha256 || '') || !g.granted_by || !g.granted_at || !g.expires_at) return { ok: false, error: 'INVALID_CONSENT' };
      grants.push({ provider_id: g.provider_id, payload_sha256: g.payload_sha256, granted_by: g.granted_by, granted_at: g.granted_at, expires_at: g.expires_at, used: false });
      return { ok: true };
    },
    has(providerId, payloadSha, now) { return grants.some((x) => !x.used && x.provider_id === providerId && x.payload_sha256 === payloadSha && x.expires_at > now); },
    consume(providerId, payloadSha, now) {
      const g = grants.find((x) => !x.used && x.provider_id === providerId && x.payload_sha256 === payloadSha && x.expires_at > now);
      if (!g) return false; g.used = true; return true;
    },
    snapshot() { return grants.map((x) => Object.assign({}, x)); },
  };
}

// ---------- built-in adapters ----------
function createManualAdapter() {
  return { id: 'manual', kind: 'MANUAL_DETERMINISTIC', locality: 'NONE', model_version: 'n/a', isAvailable: async () => true, invoke: async () => ({ manual: true }) };
}

/** Recorded fixture adapter: deterministic, labelled MOCKED/RECORDED everywhere it is surfaced. Never evidence of real performance. */
function createRecordedAdapter(id, responses, opts) {
  opts = opts || {}; let i = 0;
  return {
    id, kind: 'RECORDED_FIXTURE', locality: opts.locality || 'LOCAL', model_version: 'recorded-' + id, evidence_class: 'MOCKED',
    isAvailable: async () => opts.available !== false,
    invoke: async (req) => {
      const r = responses[Math.min(i, responses.length - 1)]; i++;
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return r(req);
      return r;
    },
    get calls() { return i; },
  };
}

/**
 * Cancellation (OP-1/OP-2): every provider attempt gets its own AbortController. A timeout or an external cancel ABORTS
 * the attempt (adapters that honour `request.signal` — the Ollama and hosted adapters — tear the transport down), so a
 * retry never runs concurrently with a still-live earlier attempt. Isomorphic: AbortController exists in browsers and
 * Node >= 16; where it does not, behaviour degrades to the previous race-only timeout.
 */
const HAS_ABORT = typeof AbortController === 'function';
function cancelledError() { return Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); }
function withTimeout(promise, ms, controller, external) {
  let timer; let onExt;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => { if (controller) controller.abort(); rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })); }, ms);
    if (external) {
      onExt = () => { if (controller) controller.abort(); rej(cancelledError()); };
      if (external.aborted) onExt(); else external.addEventListener('abort', onExt, { once: true });
    }
  });
  return Promise.race([promise, t]).finally(() => { clearTimeout(timer); if (external && onExt) external.removeEventListener('abort', onExt); });
}

/** Attach bounded, numeric/enum-only transport diagnostics to an attempt record (never content). */
function withDiag(a, d) {
  if (!d || typeof d !== 'object') return a;
  const keep = {}; ['streamed', 'first_chunk_ms', 'chunks', 'content_chars', 'elapsed_ms', 'phase', 'format_mode', 'done_reason', 'runtime_total_ms', 'runtime_load_ms', 'prompt_eval_count', 'prompt_eval_ms', 'eval_count', 'eval_ms', 'stalled']
    .forEach((k) => { const v = d[k]; if (typeof v === 'number' || typeof v === 'boolean' || v === null || (typeof v === 'string' && v.length <= 40)) keep[k] = v; });
  a.diagnostics = keep; return a;
}

function createOrchestrator(cfg) {
  const adapters = cfg.adapters;
  // retry_on_timeout (W-OLLAMA RC-2): repeating a timed-out LOCAL generation re-runs the same full workload and doubles
  // the wait; operators of a local runtime turn it off. Default stays true (unchanged behaviour for other callers).
  const policy = Object.assign({ order: adapters.map((a) => a.id), sensitivity_mode: 'STANDARD', timeout_ms: 15000, max_retries: 1, retry_on_timeout: true }, cfg.policy || {});
  const consent = cfg.consent || createConsentStore();
  const budgetPolicy = cfg.budgetPolicy || B.defaultBudgetPolicy();
  const now = cfg.now;
  let usage = cfg.usage || B.newUsage();

  async function callWithRetry(adapter, request, attempts, external) {
    let lastErr;
    for (let n = 0; n <= policy.max_retries; n++) {
      if (external && external.aborted) throw cancelledError();
      const controller = HAS_ABORT ? new AbortController() : null;
      const req = controller ? Object.assign({}, request, { signal: controller.signal }) : request;
      let p;
      try { p = Promise.resolve(adapter.invoke(req)); } catch (e) { p = Promise.reject(e); }
      const startedAt = Date.now();
      try {
        const r = await withTimeout(p, policy.timeout_ms, controller, external);
        attempts.push(withDiag({ provider_id: adapter.id, ok: true, elapsed_ms: Date.now() - startedAt }, r && r.diagnostics)); return r;
      } catch (e) {
        lastErr = e;
        // The orchestrator's own deadline fires before the adapter learns why; the adapter's diagnostics (if it reports
        // them on abort) arrive with the rejection of the aborted attempt, so wait briefly for them.
        let diag = e && e.diagnostics;
        if (!diag && controller) { try { await Promise.race([p, new Promise((res) => setTimeout(res, 50))]); } catch (pe) { diag = pe && pe.diagnostics; } }
        attempts.push(withDiag({ provider_id: adapter.id, ok: false, code: e && e.code || 'ERROR', elapsed_ms: Date.now() - startedAt }, diag));
        if (e && e.code === 'CANCELLED') throw e;
        if (e && e.code === 'TIMEOUT' && policy.retry_on_timeout === false) break;
        if (!(e && (e.code === 'TRANSIENT' || e.code === 'TIMEOUT'))) break;
      }
    }
    throw lastErr;
  }

  /**
   * run(task, opts) never throws and never invents content.
   * Statuses: OK | CONSENT_REQUIRED | BUDGET_REFUSED | EXTERNAL_BLOCKED_BY_SENSITIVITY | MANUAL | DEGRADED_TO_MANUAL | CANCELLED
   * opts.signal (optional AbortSignal): cancels the in-flight attempt; a cancelled run never falls through to another
   * provider (in particular never escalates to an external one) and returns CANCELLED with no output.
   */
  async function run(task, opts) {
    const external = opts && opts.signal ? opts.signal : null;
    const attempts = [];
    const red = redactValue(task.payload);
    const payloadSha = sha256OfValue({ kind: task.kind, prompt_version: task.prompt_version, payload: red.value });
    const preview = { redacted_payload: red.value, redactions: red.redactions, payload_sha256: payloadSha };
    let triedLocal = false;
    const cancelled = () => ({ status: 'CANCELLED', reason: 'CANCELLED_BY_USER', attempts, preview, usage });
    const ordered = policy.order.map((id) => adapters.find((a) => a.id === id)).filter(Boolean);
    for (const adapter of ordered) {
      if (external && external.aborted) return cancelled();
      if (adapter.kind === 'MANUAL_DETERMINISTIC') return { status: attempts.length ? 'DEGRADED_TO_MANUAL' : 'MANUAL', attempts, preview, usage };
      let available = false;
      try { available = await adapter.isAvailable(); } catch (e) { available = false; }
      if (!available) { attempts.push({ provider_id: adapter.id, ok: false, code: 'UNAVAILABLE' }); continue; }
      if (external && external.aborted) return cancelled();
      if (adapter.locality === 'EXTERNAL') {
        if (policy.sensitivity_mode === 'LOCAL_ONLY') { attempts.push({ provider_id: adapter.id, ok: false, code: 'BLOCKED_LOCAL_ONLY' }); continue; }
        const est = { input_tokens: B.estimateTokens(JSON.stringify(red.value)), max_output_tokens: task.max_output_tokens || 1000, cost: task.estimated_cost || 0 };
        const bc = B.checkBudget(budgetPolicy, usage, est, adapter.locality);
        if (!bc.allowed) { usage = B.recordRefusal(usage); return { status: 'BUDGET_REFUSED', reason: bc.reason, provider_id: adapter.id, attempts, preview, usage }; }
        if (!consent.has(adapter.id, payloadSha, now())) {
          return { status: 'CONSENT_REQUIRED', reason: triedLocal ? 'FALLBACK_TO_EXTERNAL_NEEDS_FRESH_CONSENT' : 'EXTERNAL_TRANSFER_NEEDS_CONSENT', provider_id: adapter.id, attempts, preview, usage };
        }
        consent.consume(adapter.id, payloadSha, now());
      } else if (adapter.locality === 'LOCAL') triedLocal = true;

      const request = { kind: task.kind, prompt_version: task.prompt_version, payload: red.value, output_schema: task.output_schema, max_output_tokens: task.max_output_tokens || 1000 };
      let res;
      try { res = await callWithRetry(adapter, request, attempts, external); } catch (e) { if (e && e.code === 'CANCELLED') return cancelled(); continue; }
      let parsed = res && res.json !== undefined ? res.json : null;
      if (parsed === null && res && typeof res.text === 'string') { try { parsed = JSON.parse(res.text); } catch (e) { parsed = null; } }
      let errs = parsed === null ? ['not JSON'] : validateSchema(task.output_schema, parsed);
      let totalUsage = res && res.usage || {};
      if (errs.length) {
        // exactly one repair attempt; the untrusted output is NOT echoed back as instructions, only error codes.
        try {
          const rep = await callWithRetry(adapter, Object.assign({}, request, { repair: { errors: errs.slice(0, 10) } }), attempts, external);
          parsed = rep && rep.json !== undefined ? rep.json : null;
          if (parsed === null && rep && typeof rep.text === 'string') { try { parsed = JSON.parse(rep.text); } catch (e) { parsed = null; } }
          errs = parsed === null ? ['not JSON'] : validateSchema(task.output_schema, parsed);
          totalUsage = { input_tokens: (totalUsage.input_tokens || 0) + ((rep && rep.usage && rep.usage.input_tokens) || 0), output_tokens: (totalUsage.output_tokens || 0) + ((rep && rep.usage && rep.usage.output_tokens) || 0), cost: (totalUsage.cost || 0) + ((rep && rep.usage && rep.usage.cost) || 0) };
        } catch (e) { if (e && e.code === 'CANCELLED') { usage = B.recordUsage(usage, adapter.id, totalUsage); return cancelled(); } errs = ['repair failed']; }
      }
      usage = B.recordUsage(usage, adapter.id, totalUsage);
      if (external && external.aborted) return cancelled();
      if (errs.length) { attempts.push({ provider_id: adapter.id, ok: false, code: 'INVALID_OUTPUT' }); continue; }
      const clean = sanitizeStrings(parsed);
      return {
        status: 'OK', provider_id: adapter.id, output: clean, untrusted: true, evidence_class: adapter.evidence_class || 'LIVE', attempts, preview, usage,
        provenance: { provider_id: adapter.id, provider_kind: adapter.kind, model_version: adapter.model_version, prompt_version: task.prompt_version, payload_sha256: payloadSha, output_sha256: sha256OfValue(clean) },
      };
    }
    return { status: 'DEGRADED_TO_MANUAL', reason: 'NO_PROVIDER_PRODUCED_VALID_OUTPUT', attempts, preview, usage };
  }

  return { run, consent, getUsage: () => usage, policy };
}

/** Schema for the TECH_RECOMMENDATION task output. */
const TECH_RECOMMENDATION_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['options', 'recommended_stack'],
  properties: {
    recommended_stack: { type: 'string', maxLength: 200 },
    options: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false, required: ['stack', 'rationale', 'tradeoffs', 'cost_complexity', 'risks'],
        properties: {
          stack: { type: 'string', maxLength: 200 }, rationale: { type: 'string', maxLength: 1500 }, tradeoffs: { type: 'string', maxLength: 1500 },
          cost_complexity: { type: 'string', maxLength: 600 }, risks: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 400 } },
        },
      },
    },
  },
};

module.exports = { ADAPTER_KINDS, validateSchema, sanitizeStrings, createConsentStore, createManualAdapter, createRecordedAdapter, createOrchestrator, TECH_RECOMMENDATION_OUTPUT_SCHEMA };
