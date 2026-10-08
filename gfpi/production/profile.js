'use strict';

/**
 * Full-Production profile activation (additive). FULL_PRODUCTION is NOT a boolean that bypasses validation:
 * activation produces a profile record that makes the catalog, the readiness model and the completeness guardian
 * mandatory. Detection is deterministic and rule-based (bilingual keyword families) so NO_PROVIDER_MODE works;
 * an AI provider may only ADD proposals later (never remove an activation, never confirm one).
 * Signals are SIGNALS: archetype/tenancy stay candidate until the user confirms the corresponding decision.
 */

const FULL_PRODUCTION = [/production[\s-]*(ready|grade|quality)/i, /full[\s-]*production/i, /real\s+production/i, /complete\s+(saas|product)/i, /commercial\s+(saas|product)/i, /enterprise[\s-]*(ready|grade)?/i, /deployable/i, /ready\s+to\s+launch/i,
  /جاهز[\u064B-\u0652ةا]*\s+للإنتاج/, /إنتاج(ي|ية)?\s*(كامل|حقيقي)/, /منتج\s+(تجاري|كامل)/, /نظام\s+(تجاري|متكامل)/, /مستوى\s+مؤسسي/, /قابل(ة)?\s+للنشر/, /للتشغيل\s+الفعلي/];
const SAAS = [/\bsaas\b/i, /software[\s-]+as[\s-]+a[\s-]+service/i, /subscription\s+(platform|product|service)/i, /multi[\s-]*tenant/i, /\bB2B\b/i, /cloud\s+platform/i,
  /خدمة\s+برمجية/, /منصة\s+(سحابية|اشتراكات|خدمية)/, /اشتراك(ات)?/, /متعدد(ة)?\s+المستأجرين/];
const MULTI_TENANT = [/multi[\s-]*tenant/i, /multiple\s+(organi[sz]ations|companies|clinics|schools|customers|businesses|workspaces)/i, /(each|every)\s+(organi[sz]ation|company|clinic|customer)\s+(has|sees|manages)/i,
  /متعدد(ة)?\s+المستأجرين/, /عدة\s+(مؤسسات|شركات|عيادات|مدارس|منظمات|جهات|فروع)/, /لكل\s+(مؤسسة|شركة|عيادة|جهة)/];
const SINGLE_TENANT = [/single[\s-]*tenant/i, /one\s+(organi[sz]ation|company)\s+only/i, /أحادي\s+المستأجر/, /مؤسسة\s+واحدة\s+فقط/];
const AI_NATIVE = [/\bAI[\s-]*(powered|native|based|assistant|agent)?\b/i, /\bLLM\b/i, /\bGPT\b/i, /chat\s*bot/i, /\bRAG\b/i, /machine\s+learning/i, /ذكاء\s+اصطناعي/, /روبوت\s+محادثة/, /مساعد\s+ذكي/, /نموذج\s+لغوي/];
const REGULATED = [/health(care)?/i, /medical/i, /patient/i, /\bbank(ing)?\b/i, /financ(e|ial)/i, /fintech/i, /legal/i, /government/i, /insurance/i, /صح(ي|ة)/, /طبي/, /مرضى|مريض/, /بنك|مصرف|مالي/, /حكوم/, /تأمين/, /قانون/];
const PAYMENTS = [/billing/i, /subscription/i, /payment/i, /invoice/i, /checkout/i, /اشتراك/, /دفع/, /فوترة|فواتير/];
const B2B = [/\bB2B\b/i, /business(es)?/i, /compan(y|ies)/i, /organi[sz]ations?/i, /clinics?/i, /شركات|مؤسسات|عيادات|جهات/];
const B2C = [/\bB2C\b/i, /consumers?/i, /individuals?/i, /end[\s-]*users?/i, /أفراد|مستهلك/];
const MARKETPLACE = [/marketplace/i, /sellers?\s+and\s+buyers?/i, /سوق\s+إلكتروني|بائعين\s+ومشترين/];
const MOBILE = [/mobile[\s-]*first/i, /تطبيق\s+جوال/];
const API_FIRST = [/api[\s-]*first/i, /public\s+api/i, /developer\s+platform/i];
const INTERNAL = [/internal\s+(tool|system)/i, /نظام\s+داخلي/];

const any = (res, t) => res.filter((r) => r.test(t)).map((r) => String(r));

/**
 * detectProfile({intent, explicit:{full_production, product_type}, itemStates}) -> ProductionProfile (plain object).
 * itemStates = folded production ledger (confirmed decisions override signals).
 */
function detectProfile(params) {
  const text = String(params.intent || '');
  const ex = params.explicit || {};
  const st = params.itemStates || {};
  const confirmed = (id) => { const s = st[id]; return s && (s.state === 'USER_CONFIRMED' || s.state === 'USER_EDITED') ? s.value : null; };
  const sig = {
    full_production: any(FULL_PRODUCTION, text), saas: any(SAAS, text), multi_tenant: any(MULTI_TENANT, text), single_tenant: any(SINGLE_TENANT, text),
    ai_native: any(AI_NATIVE, text), regulated: any(REGULATED, text), payments: any(PAYMENTS, text), b2b: any(B2B, text), b2c: any(B2C, text),
    marketplace: any(MARKETPLACE, text), mobile: any(MOBILE, text), api_first: any(API_FIRST, text), internal: any(INTERNAL, text),
  };
  const fullProduction = ex.full_production === true || sig.full_production.length > 0;
  const saas = String(ex.product_type || '').toUpperCase() === 'SAAS' || sig.saas.length > 0 || confirmed('saas_archetype') !== null;
  const reasons = [];
  if (ex.full_production === true) reasons.push('EXPLICIT_FLAG:FULL_PRODUCTION=TRUE');
  if (sig.full_production.length) reasons.push('INTENT_SIGNAL:production-readiness wording');
  if (String(ex.product_type || '').toUpperCase() === 'SAAS') reasons.push('EXPLICIT_FLAG:PRODUCT_TYPE=SAAS');
  if (sig.saas.length) reasons.push('INTENT_SIGNAL:SaaS wording');
  const tenancyConfirmed = confirmed('tenancy_model');
  let tenancy = 'UNKNOWN'; let tenancySource = 'NONE';
  if (tenancyConfirmed) { tenancy = tenancyConfirmed; tenancySource = 'USER_CONFIRMED'; }
  else if (sig.multi_tenant.length && !sig.single_tenant.length) { tenancy = 'MULTI_TENANT'; tenancySource = 'INTENT_SIGNAL_UNCONFIRMED'; }
  else if (sig.single_tenant.length && !sig.multi_tenant.length) { tenancy = 'SINGLE_TENANT'; tenancySource = 'INTENT_SIGNAL_UNCONFIRMED'; }
  const dataSens = (params.baseStates && params.baseStates.data_sensitivity && ['USER_CONFIRMED', 'USER_EDITED'].indexOf(params.baseStates.data_sensitivity.state) !== -1 ? params.baseStates.data_sensitivity.value : null);
  const sensitive = dataSens === 'FINANCIAL_OR_HEALTH' || dataSens === 'GOVERNMENT_SENSITIVE' || sig.regulated.length > 0;
  const archetypeCandidates = [];
  if (saas) {
    if (sig.b2b.length) archetypeCandidates.push('B2B_SAAS');
    if (sig.b2c.length) archetypeCandidates.push('B2C_SAAS');
    if (sig.b2b.length && sig.b2c.length) archetypeCandidates.push('B2B2C_SAAS');
    if (sig.marketplace.length) archetypeCandidates.push('MARKETPLACE_SAAS');
    if (sig.mobile.length) archetypeCandidates.push('MOBILE_FIRST_SAAS');
    if (sig.api_first.length) archetypeCandidates.push('API_FIRST_SAAS');
    if (sig.internal.length) archetypeCandidates.push('INTERNAL_SAAS');
    if (sig.ai_native.length) archetypeCandidates.push('AI_NATIVE_SAAS');
    if (sig.regulated.length) archetypeCandidates.push('REGULATED_SAAS');
    if (/enterprise/i.test(text)) archetypeCandidates.push('ENTERPRISE_SAAS');
    if (tenancy === 'MULTI_TENANT') archetypeCandidates.push('MULTI_TENANT');
    if (tenancy === 'SINGLE_TENANT') archetypeCandidates.push('SINGLE_TENANT');
    if (!archetypeCandidates.length) archetypeCandidates.push('UNDETERMINED');
  }
  const confirmedArch = confirmed('saas_archetype');
  const aiNative = sig.ai_native.length > 0 || (typeof confirmedArch === 'string' && confirmedArch.indexOf('AI_NATIVE_SAAS') !== -1) || confirmed('ai_native_scope') === 'YES';
  return {
    profile_version: 'PRODUCTION_PROFILE_V1',
    activation: {
      FULL_PRODUCTION_PROFILE: fullProduction,
      FULL_PRODUCTION_SAAS_PROFILE: fullProduction && saas,
      AI_PRODUCTION_PROFILE_V1: aiNative && (fullProduction || saas),
      reasons,
    },
    full_production: fullProduction, saas, ai_native: aiNative,
    tenancy, tenancy_source: tenancySource, archetype_candidates: archetypeCandidates, archetype_confirmed: confirmedArch,
    regulated: sig.regulated.length > 0, sensitive, payments: sig.payments.length > 0 || (confirmed('billing_model') !== null && confirmed('billing_model') !== 'NONE'),
    billing_none_confirmed: confirmed('billing_model') === 'NONE',
    signals: sig,
    note_ar: 'هذه إشارات تحقق حتمية لا قرارات؛ لا تتحول إلى قرار مؤكد إلا بتأكيد المستخدم.',
    note_en: 'These are deterministic signals, not decisions; nothing becomes confirmed without the user.',
  };
}

module.exports = { detectProfile };
