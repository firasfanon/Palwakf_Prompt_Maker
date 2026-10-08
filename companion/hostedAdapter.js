'use strict';

/**
 * HOSTED_API adapter — CONFIGURATION SUPPORT ONLY in MB1. It validates configuration and implements the call path
 * against an INJECTED fetch so the refusal/consent/budget behaviour is testable, but no real hosted call is made or
 * authorized: PAID_PROVIDER_CALLS = NOT_AUTHORIZED and the default budget is ZERO (the orchestrator refuses first).
 * The API key is resolved from the credential store at call time and never stored on the adapter or in logs.
 */
function validateHostedConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return { valid: false, errors: ['config required'] };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(cfg.id || '')) errors.push('id');
  let u; try { u = new URL(cfg.endpoint); } catch (e) { errors.push('endpoint'); }
  if (u && u.protocol !== 'https:') errors.push('endpoint must be https');
  if (u && (u.username || u.password)) errors.push('endpoint must not contain credentials');
  if (!cfg.model) errors.push('model');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(cfg.credential_ref || '')) errors.push('credential_ref');
  return { valid: errors.length === 0, errors };
}

function createHostedAdapter(cfg, deps) {
  const v = validateHostedConfig(cfg);
  if (!v.valid) throw Object.assign(new Error('invalid hosted config: ' + v.errors.join(',')), { code: 'BAD_CONFIG' });
  return {
    id: cfg.id, kind: 'HOSTED_API', locality: 'EXTERNAL', model_version: cfg.model,
    async isAvailable() { return !!(deps && deps.fetch && deps.store && (await deps.store.get(cfg.credential_ref))); },
    async invoke(req) {
      const key = await deps.store.get(cfg.credential_ref);
      if (!key) throw Object.assign(new Error('credential missing'), { code: 'NO_CREDENTIAL' });
      const res = await deps.fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model: cfg.model, task: req.kind, schema: req.output_schema, data: req.payload, repair_errors: req.repair ? req.repair.errors : undefined, max_tokens: req.max_output_tokens }) });
      if (!res.ok) throw Object.assign(new Error('hosted error ' + res.status), { code: res.status >= 500 || res.status === 429 ? 'TRANSIENT' : 'REJECTED' });
      const j = await res.json();
      return { text: typeof j.text === 'string' ? j.text : undefined, json: j.json, usage: j.usage || {} };
    },
  };
}

module.exports = { createHostedAdapter, validateHostedConfig };
