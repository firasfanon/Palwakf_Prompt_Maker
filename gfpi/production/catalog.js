'use strict';

/**
 * Production decision catalog (additive). Every item is a PLAIN-LANGUAGE question first (nontechnical founders are
 * never required to know RTO/RPO/RLS/idempotency...), with the expert term available in Expert mode. Every choice
 * carries its trade-off and the machine effect (`fx`) that later feeds NFRContractV1 / ThreatModelV1 / DataLifecycleModelV1
 * / DeploymentTopologyV1 / CostModelV1. Numeric NFR values appear ONLY as definitions of a named tier that the user (or a
 * pending recommendation) selects; nothing numeric is ever invented for an unanswered item.
 *
 * Applicability is DERIVED (never silent): YES | NO | CONDITIONAL. NO only when a governing decision is confirmed
 * (e.g. tenancy_model=SINGLE_TENANT confirmed by the user); otherwise CONDITIONAL keeps the item visible and open.
 */

const DIMENSIONS = ['PRODUCT', 'ARCHITECTURE', 'SECURITY', 'DATA', 'TENANCY', 'IDENTITY', 'AUTHORIZATION', 'BILLING', 'RELIABILITY', 'AVAILABILITY', 'OBSERVABILITY', 'PERFORMANCE', 'SCALABILITY',
  'DEPLOYMENT', 'OPERATIONS', 'BACKUP', 'RESTORE', 'DISASTER_RECOVERY', 'BUSINESS_CONTINUITY', 'PRIVACY', 'COMPLIANCE', 'TESTING', 'ACCESSIBILITY', 'LOCALIZATION', 'SUPPORT', 'COST', 'MIGRATION',
  'INCIDENT_RESPONSE', 'AI_SAFETY_WHEN_APPLICABLE'];

const ARCHETYPES = ['B2C_SAAS', 'B2B_SAAS', 'B2B2C_SAAS', 'VERTICAL_SAAS', 'ENTERPRISE_SAAS', 'MARKETPLACE_SAAS', 'INTERNAL_SAAS', 'API_FIRST_SAAS', 'MOBILE_FIRST_SAAS', 'AI_NATIVE_SAAS', 'REGULATED_SAAS', 'SINGLE_TENANT', 'MULTI_TENANT', 'HYBRID_TENANCY'];

function ch(value, ar, en) {
  const rest = Array.prototype.slice.call(arguments, 3); let fx = {};
  if (rest.length && rest[rest.length - 1] && typeof rest[rest.length - 1] === 'object') fx = rest.pop();
  const strs = rest.filter((x) => typeof x === 'string');
  const isAr = (x) => /[\u0600-\u06FF]/.test(x);
  const tAr = strs.find(isAr) || strs[0] || ''; const tEn = strs.find((x) => !isAr(x)) || strs[0] || '';
  return { value, ar, en, tradeoff: { ar: tAr, en: tEn }, fx };
}
const W = (ar, en) => ({ ar, en });

// scope tags: FP full production, SAAS, MT multi-tenant, BILL billing, AI ai-native
const ITEMS = [
  { id: 'saas_archetype', dims: ['PRODUCT', 'ARCHITECTURE'], crit: 4, scope: ['SAAS'], deps: [], burden: 2, impact: ['architecture'], na_allowed: false,
    q: W('أي نوع من منتجات الخدمة السحابية تبنيها؟ (يمكن اختيار أكثر من وصف)', 'Which kind of cloud-service product are you building? (more than one may apply)'), expert: W('SaaS archetype', 'SaaS archetype'),
    choices: ARCHETYPES.slice(0, 11).map((a) => ch(a, a, a, 'يحدد الأسئلة اللاحقة', 'Shapes the follow-up questions')), multi: true,
    rec: (P) => ({ value: (P.archetype_candidates.filter((a) => ARCHETYPES.indexOf(a) !== -1 && a !== 'UNDETERMINED' && a !== 'MULTI_TENANT' && a !== 'SINGLE_TENANT').slice(0, 3).join('+')) || 'B2B_SAAS', caused: ['intent signals'], why: W('استُنتج من وصفك ويبقى مقترحًا حتى تؤكده.', 'Inferred from your description; stays a proposal until you confirm.') }) },
  { id: 'ai_native_scope', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'PRODUCT'], crit: 4, scope: ['SAAS'], deps: [], burden: 1, impact: ['ai'], na_allowed: false,
    q: W('هل يستخدم المنتج نفسه الذكاء الاصطناعي لخدمة عملائه (مثل مساعد ذكي أو تلخيص أو تحليل)؟', 'Does the product itself use AI for its customers (assistant, summaries, analysis)?'), expert: W('AI-native scope', 'AI-native scope'),
    choices: [ch('YES', 'نعم', 'Yes', 'يفعّل أسئلة سلامة وتقييم وتكلفة خاصة بالذكاء الاصطناعي', 'Activates AI safety/evaluation/cost questions'), ch('NO', 'لا', 'No', 'لا أسئلة ذكاء اصطناعي', 'No AI-specific questions')],
    rec: (P) => ({ value: P.ai_native ? 'YES' : 'NO', caused: ['intent signals'], why: W('بحسب كلماتك في الوصف.', 'Based on the wording of your description.') }) },
  { id: 'tenancy_model', dims: ['TENANCY', 'ARCHITECTURE'], crit: 5, scope: ['SAAS'], deps: [], burden: 2, impact: ['data', 'schema', 'auth', 'authorization', 'rls', 'security', 'billing', 'audit', 'backup', 'tests', 'migration', 'deployment', 'cost', 'operations', 'api'], na_allowed: false,
    q: W('هل ستخدم عدة جهات منفصلة (عيادات، شركات، مدارس...) نفس النظام، بحيث ترى كل جهة بياناتها فقط؟', 'Will several separate customers (clinics, companies, schools...) share the same running system, each seeing only its own data?'), expert: W('Tenancy model (single / multi / hybrid)', 'Tenancy model (single / multi / hybrid)'),
    choices: [ch('SINGLE_TENANT', 'جهة واحدة فقط', 'One customer only', 'أبسط وأرخص؛ تغييره لاحقًا مكلف', 'Simplest and cheapest; changing later is expensive', { tenancy: 'SINGLE' }),
      ch('MULTI_TENANT', 'عدة جهات في نظام واحد', 'Many customers in one system', 'اقتصادي لكنه يتطلب عزلًا صارمًا للبيانات واختبارات تسرب', 'Economical but requires strict data isolation and leak testing', { tenancy: 'MULTI' }),
      ch('HYBRID_TENANCY', 'مزيج (بعض الجهات بنسخة مستقلة)', 'Hybrid (some customers get a dedicated instance)', 'مرونة أعلى وتعقيد تشغيلي أكبر', 'More flexible, more operational complexity', { tenancy: 'HYBRID' })],
    rec: (P) => ({ value: P.tenancy === 'SINGLE_TENANT' ? 'SINGLE_TENANT' : 'MULTI_TENANT', caused: ['intent signals', 'archetype'], why: W('منتجات SaaS التجارية تخدم عادة عدة جهات منفصلة؛ اختر جهة واحدة إن لم يكن ذلك صحيحًا.', 'Commercial SaaS usually serves several separate customers; choose one customer if that is not true.') }) },
  { id: 'tenant_isolation', dims: ['TENANCY', 'SECURITY', 'DATA'], crit: 5, scope: ['MT'], deps: ['tenancy_model'], burden: 2, impact: ['data', 'schema', 'rls', 'security', 'tests', 'backup', 'audit'], na_allowed: false,
    q: W('كم يجب أن تكون بيانات كل جهة معزولة عن غيرها؟', 'How strongly must each customer\'s data be separated from the others?'), expert: W('Tenant isolation (RLS / schema / database per tenant)', 'Tenant isolation (RLS / schema / database per tenant)'),
    choices: [ch('RLS_SHARED_SCHEMA', 'قواعد وصول على مستوى الصفوف في قاعدة مشتركة', 'Row-level policies in a shared database', 'أقل تكلفة؛ خطأ سياسة واحد قد يسرّب بيانات فيلزم اختبار تسرب إلزامي', 'Lowest cost; one policy mistake could leak data, so leak tests are mandatory', { isolation: 'RLS' }),
      ch('SCHEMA_PER_TENANT', 'مخطط (Schema) مستقل لكل جهة', 'A separate schema per customer', 'عزل أقوى وتكلفة ترحيلات أعلى', 'Stronger isolation, costlier migrations', { isolation: 'SCHEMA' }),
      ch('DATABASE_PER_TENANT', 'قاعدة بيانات مستقلة لكل جهة', 'A separate database per customer', 'أقوى عزل وأعلى تكلفة وتعقيدًا', 'Strongest isolation, highest cost and complexity', { isolation: 'DATABASE' })],
    rec: (P) => (P.regulated && P.archetype_candidates.indexOf('ENTERPRISE_SAAS') !== -1 ? { value: 'DATABASE_PER_TENANT', caused: ['regulated data', 'enterprise archetype'], why: W('بيانات منظَّمة لعملاء مؤسسيين.', 'Regulated data for enterprise customers.') } : { value: 'RLS_SHARED_SCHEMA', caused: ['tenancy_model'], why: W('أنسب توازن كلفة/عزل مع اختبارات تسرب إلزامية.', 'Best cost/isolation balance with mandatory leak tests.') }) },
  { id: 'tenant_lifecycle', dims: ['TENANCY', 'DATA', 'PRIVACY'], crit: 4, scope: ['MT'], deps: ['tenancy_model'], burden: 2, impact: ['data', 'api', 'operations', 'backup', 'tests'], na_allowed: false,
    q: W('عندما تريد جهة مغادرة المنتج: كيف تأخذ بياناتها وكيف تُحذف؟', 'When a customer leaves: how do they take their data and how is it deleted?'), expert: W('Tenant export / offboarding / deletion', 'Tenant export / offboarding / deletion'),
    choices: [ch('SELF_SERVICE_EXPORT_AND_DELETE', 'تصدير وحذف ذاتي مع مهلة تراجع', 'Self-service export and deletion with a grace period', 'تجربة أفضل ويحتاج تطويرًا', 'Best experience; needs development'), ch('OPERATOR_ASSISTED', 'بطلب يعالجه فريقك يدويًا', 'On request, handled manually by your team', 'أسرع في البداية ويعتمد على الأشخاص', 'Faster to start, depends on people')],
    rec: () => ({ value: 'SELF_SERVICE_EXPORT_AND_DELETE', caused: ['tenancy_model'], why: W('الاحتفاظ بالبيانات دون مسار خروج واضح خطر قانوني وتجاري.', 'Having no clear exit path is a legal and commercial risk.') }) },
  { id: 'identity_method', dims: ['IDENTITY', 'SECURITY'], crit: 5, scope: ['FP'], deps: [], burden: 2, impact: ['auth', 'security', 'tests'], na_allowed: false,
    q: W('كيف يثبت المستخدم هويته عند الدخول؟', 'How do users prove who they are when signing in?'), expert: W('Identity / authentication / MFA', 'Identity / authentication / MFA'),
    choices: [ch('EMAIL_PASSWORD_MFA_REQUIRED_FOR_ADMINS', 'بريد وكلمة مرور ومصادقة ثنائية إلزامية للمديرين', 'Email + password, MFA required for admins', 'توازن أمان وسهولة', 'Balanced security and convenience', { mfa: 'ADMINS' }),
      ch('EMAIL_PASSWORD_MFA_OPTIONAL', 'بريد وكلمة مرور ومصادقة ثنائية اختيارية', 'Email + password, optional MFA', 'أسهل وأضعف للحسابات الحساسة', 'Easier, weaker for sensitive accounts', { mfa: 'OPTIONAL' }),
      ch('SSO_OIDC_SAML_ENTERPRISE', 'دخول موحّد للمؤسسات (SSO)', 'Enterprise single sign-on (SSO)', 'يلبي المؤسسات ويزيد التعقيد', 'Meets enterprise needs, more complexity', { mfa: 'SSO' }),
      ch('MAGIC_LINK_OR_SOCIAL', 'رابط دخول بالبريد أو حساب اجتماعي', 'Magic link or social login', 'سهل جدًا ويعتمد على مزود خارجي', 'Very easy, depends on an external provider', { mfa: 'NONE' })],
    rec: (P) => ({ value: P.sensitive ? 'EMAIL_PASSWORD_MFA_REQUIRED_FOR_ADMINS' : 'EMAIL_PASSWORD_MFA_REQUIRED_FOR_ADMINS', caused: P.sensitive ? ['sensitive data'] : ['production baseline'], why: W('حسابات المديرين هي الأعلى خطرًا.', 'Admin accounts carry the highest risk.') }) },
  { id: 'authorization_model', dims: ['AUTHORIZATION', 'SECURITY'], crit: 5, scope: ['FP'], deps: ['tenancy_model'], burden: 2, impact: ['authorization', 'security', 'api', 'tests'], na_allowed: false,
    q: W('كيف تُحدَّد صلاحيات كل مستخدم (من يرى ماذا ومن يعدّل ماذا)؟', 'How are permissions decided (who may see and change what)?'), expert: W('Authorization (RBAC / ABAC / ownership)', 'Authorization (RBAC / ABAC / ownership)'),
    choices: [ch('RBAC_WITH_TENANT_SCOPE', 'أدوار ثابتة محصورة بنطاق الجهة', 'Fixed roles scoped to the customer', 'بسيط وقابل للتدقيق', 'Simple and auditable', { authz: 'RBAC' }), ch('RBAC_PLUS_OWNERSHIP', 'أدوار مع ملكية السجل', 'Roles plus record ownership', 'أدق وأعقد', 'More precise, more complex', { authz: 'RBAC_OWNERSHIP' }), ch('ABAC_POLICY_BASED', 'سياسات مبنية على الخصائص', 'Attribute/policy-based', 'الأكثر مرونة والأعلى تعقيدًا', 'Most flexible, most complex', { authz: 'ABAC' })],
    rec: () => ({ value: 'RBAC_WITH_TENANT_SCOPE', caused: ['users_roles', 'tenancy_model'], why: W('يغطي أغلب المنتجات ويسهل اختباره.', 'Covers most products and is easy to test.') }) },
  { id: 'audit_trail', dims: ['SECURITY', 'COMPLIANCE', 'OBSERVABILITY'], crit: 4, scope: ['FP'], deps: ['tenancy_model', 'authorization_model'], burden: 1, impact: ['audit', 'data', 'security', 'tests', 'cost'], na_allowed: false,
    q: W('هل تريد سجلًا لا يمكن تعديله يوضح من فعل ماذا ومتى؟', 'Do you want a tamper-evident record of who did what and when?'), expert: W('Audit trail (append-only, tenant-scoped)', 'Audit trail (append-only, tenant-scoped)'),
    choices: [ch('AUDIT_ADMIN_AND_DATA_CHANGES', 'تسجيل العمليات الإدارية وتغييرات البيانات', 'Log admin actions and data changes', 'توازن بين الفائدة والتكلفة', 'Balance of value and cost', { audit: 'WRITES' }), ch('AUDIT_SECURITY_EVENTS_ONLY', 'الأحداث الأمنية فقط', 'Security events only', 'أرخص وأقل كفاية للامتثال', 'Cheaper, weaker for compliance', { audit: 'SECURITY' }), ch('AUDIT_FULL_READ_AND_WRITE', 'تسجيل القراءة والكتابة', 'Log reads and writes', 'الأقوى امتثالًا والأعلى تخزينًا', 'Strongest for compliance, highest storage', { audit: 'FULL' })],
    rec: (P) => ({ value: P.sensitive ? 'AUDIT_FULL_READ_AND_WRITE' : 'AUDIT_ADMIN_AND_DATA_CHANGES', caused: P.sensitive ? ['sensitive data'] : ['production baseline'], why: W('البيانات الحساسة تتطلب أثر وصول.', 'Sensitive data needs an access trail.') }) },
  { id: 'billing_model', dims: ['BILLING', 'PRODUCT'], crit: 4, scope: ['SAAS'], deps: [], burden: 1, impact: ['billing', 'api', 'data', 'tests', 'cost'], na_allowed: true,
    q: W('كيف ستحصّل المال من العملاء؟', 'How will you charge customers?'), expert: W('Billing model / subscriptions / entitlements', 'Billing model / subscriptions / entitlements'),
    choices: [ch('NONE', 'لا تحصيل داخل المنتج', 'No charging inside the product', 'يلغي أسئلة الدفع', 'Removes payment questions', { billing: 'NONE' }), ch('FLAT_SUBSCRIPTION', 'اشتراك ثابت', 'Flat subscription', 'بسيط', 'Simple', { billing: 'FLAT' }), ch('TIERED_SUBSCRIPTION', 'باقات متدرجة', 'Tiered plans', 'يحتاج حدودًا وصلاحيات لكل باقة', 'Needs per-plan limits and entitlements', { billing: 'TIERED' }), ch('USAGE_BASED', 'حسب الاستخدام', 'Usage-based', 'يحتاج قياسًا دقيقًا', 'Needs accurate metering', { billing: 'USAGE' }), ch('ONE_TIME_OR_INVOICE', 'دفعات منفردة أو فواتير', 'One-off payments or invoices', 'أبسط تقنيًا وأثقل تشغيليًا', 'Technically simpler, heavier operationally', { billing: 'INVOICE' })],
    rec: (P) => ({ value: P.payments ? 'TIERED_SUBSCRIPTION' : 'NONE', caused: ['intent signals'], why: W('بحسب ذكر الاشتراك أو الدفع في وصفك.', 'Based on whether you mentioned subscription or payment.') }) },
  { id: 'entitlements_quotas', dims: ['BILLING', 'TENANCY', 'SCALABILITY'], crit: 4, scope: ['SAAS', 'BILLORMT'], deps: ['billing_model', 'tenancy_model'], burden: 2, impact: ['billing', 'api', 'data', 'tests', 'cost', 'operations'], na_allowed: true,
    q: W('هل تريد حدودًا لكل جهة أو باقة (عدد مستخدمين، مساحة، عمليات)؟', 'Do you want limits per customer or plan (users, storage, operations)?'), expert: W('Plans, quotas, entitlements', 'Plans, quotas, entitlements'),
    choices: [ch('PLAN_LIMITS_ENFORCED_SERVER_SIDE', 'حدود تُفرض من الخادم وتُسجَّل', 'Limits enforced server-side and audited', 'يحمي التكلفة ويحتاج تطويرًا', 'Protects cost, needs development', { quotas: 'ENFORCED' }), ch('SOFT_LIMITS_WARN_ONLY', 'تنبيه فقط دون منع', 'Warn only, do not block', 'أسهل ويعرّض للتكلفة المفتوحة', 'Easier, exposes open-ended cost', { quotas: 'SOFT' })],
    rec: () => ({ value: 'PLAN_LIMITS_ENFORCED_SERVER_SIDE', caused: ['billing_model', 'tenancy_model'], why: W('بدون حدود مفروضة قد يستهلك عميل واحد موارد الجميع.', 'Without enforced limits one customer can consume everyone\'s resources.') }) },
  { id: 'payment_failure_policy', dims: ['BILLING', 'RELIABILITY'], crit: 5, scope: ['BILL'], deps: ['billing_model'], burden: 2, impact: ['billing', 'api', 'data', 'operations', 'audit', 'tests'], na_allowed: false,
    q: W('إذا وصل إشعار الدفع مرتين، أو نجح الدفع وفشل تفعيل الحساب، ماذا يجب أن يحدث؟', 'If a payment notice arrives twice, or payment succeeds but account activation fails, what should happen?'), expert: W('Webhook idempotency, reconciliation, compensation', 'Webhook idempotency, reconciliation, compensation'),
    choices: [ch('IDEMPOTENT_WEBHOOKS_WITH_RECONCILIATION', 'لا تتكرر الآثار، ومطابقة دورية وتعويض تلقائي', 'No duplicate effects, periodic reconciliation, automatic compensation', 'الأكثر أمانًا ويحتاج تطويرًا', 'Safest, needs development', { failure: 'IDEMPOTENT_RECONCILED' }), ch('MANUAL_RECONCILIATION_ONLY', 'مطابقة يدوية', 'Manual reconciliation only', 'أرخص وأعلى خطر خطأ مالي', 'Cheaper, higher risk of money errors', { failure: 'MANUAL' })],
    rec: () => ({ value: 'IDEMPOTENT_WEBHOOKS_WITH_RECONCILIATION', caused: ['billing_model'], why: W('الأخطاء المالية تضر الثقة والقانون.', 'Money errors hurt trust and legal standing.') }) },
  { id: 'provisioning_failure_policy', dims: ['RELIABILITY', 'TENANCY', 'BILLING'], crit: 4, scope: ['SAAS', 'BILLORMT'], deps: ['tenancy_model', 'billing_model'], burden: 2, impact: ['operations', 'api', 'data', 'audit', 'tests'], na_allowed: true,
    q: W('إذا فشل إنشاء مساحة العميل بعد الدفع أو فشل إرسال الرسائل، كيف يعالج النظام ذلك؟', 'If creating the customer\'s workspace fails after payment, or notifications fail, how does the system recover?'), expert: W('Provisioning saga / compensating actions / operator queue', 'Provisioning saga / compensating actions / operator queue'),
    choices: [ch('COMPENSATING_ACTIONS_WITH_OPERATOR_QUEUE', 'إعادة محاولة ثم تعويض وقائمة مراجعة للمشغّل', 'Retry, compensate, and an operator review queue', 'أوضح تشغيليًا ويحتاج واجهة تشغيل', 'Clearest operationally; needs an operator view'), ch('AUTO_RETRY_THEN_ALERT', 'إعادة محاولة ثم تنبيه', 'Retry then alert', 'أبسط وأقل ضمانًا')],
    rec: () => ({ value: 'COMPENSATING_ACTIONS_WITH_OPERATOR_QUEUE', caused: ['billing_model', 'tenancy_model'], why: W('تجنب عميل دفع ولم يحصل على خدمة دون أن يعلم أحد.', 'Avoid a customer who paid and got nothing while nobody knows.') }) },
  { id: 'notifications_policy', dims: ['OPERATIONS', 'RELIABILITY'], crit: 3, scope: ['FP'], deps: [], burden: 1, impact: ['operations', 'api', 'cost'], na_allowed: true,
    q: W('كيف ستصل الإشعارات للمستخدمين وماذا يحدث إن فشل الإرسال؟', 'How do notifications reach users, and what if sending fails?'), expert: W('Email/SMS delivery, retry, bounce handling', 'Email/SMS delivery, retry, bounce handling'),
    choices: [ch('EMAIL_WITH_RETRY_AND_BOUNCE_HANDLING', 'بريد مع إعادة محاولة ومعالجة الارتداد', 'Email with retry and bounce handling', 'قياسي', 'Standard'), ch('EMAIL_AND_SMS', 'بريد ورسائل نصية', 'Email and SMS', 'تكلفة أعلى'), ch('IN_APP_ONLY', 'داخل التطبيق فقط', 'In-app only', 'أرخص وقد تُفوَّت الرسائل')],
    rec: () => ({ value: 'EMAIL_WITH_RETRY_AND_BOUNCE_HANDLING', caused: ['production baseline'], why: W('الخيار القياسي منخفض الكلفة.', 'The standard, low-cost option.') }) },
  { id: 'background_jobs_policy', dims: ['RELIABILITY', 'OPERATIONS'], crit: 4, scope: ['SAAS'], deps: [], burden: 2, impact: ['operations', 'data', 'tests', 'deployment'], na_allowed: true,
    q: W('هل توجد مهام تعمل في الخلفية (تقارير، تنبيهات، مزامنة)؟ وماذا يحدث إن عُلِّقت أو نُفِّذت مرتين؟', 'Are there background tasks (reports, alerts, syncing)? What if one is delayed or runs twice?'), expert: W('Queues / idempotent jobs / dead-letter', 'Queues / idempotent jobs / dead-letter'),
    choices: [ch('IDEMPOTENT_JOBS_WITH_DEAD_LETTER', 'مهام آمنة للتكرار مع قائمة للفاشلة', 'Safe-to-repeat jobs with a failed-jobs queue', 'الأمتن', 'Most robust'), ch('NO_BACKGROUND_JOBS', 'لا مهام خلفية', 'No background jobs', 'يلغي التعقيد ويحدّ المزايا')],
    rec: () => ({ value: 'IDEMPOTENT_JOBS_WITH_DEAD_LETTER', caused: ['workflows'], why: W('المهام الخلفية تتكرر وتتأخر حتمًا.', 'Background jobs inevitably repeat and lag.') }) },
  { id: 'integrations_resilience', dims: ['RELIABILITY'], crit: 4, scope: ['FP'], deps: [], burden: 1, impact: ['operations', 'api', 'tests'], na_allowed: true,
    q: W('إذا تعطلت خدمة خارجية يعتمد عليها المنتج (دفع، بريد...) ماذا يجب أن يرى المستخدم؟', 'If an outside service you depend on goes down (payments, email...), what should users see?'), expert: W('Provider outage behaviour (fail-closed / degrade)', 'Provider outage behaviour (fail-closed / degrade)'),
    choices: [ch('DEGRADE_GRACEFULLY_WITH_RETRY_QUEUE', 'يستمر العمل جزئيًا وتُعاد المحاولة لاحقًا', 'Keep working partially and retry later', 'تجربة أفضل ويحتاج تصميمًا'), ch('FAIL_CLOSED_WITH_CLEAR_ERROR', 'يتوقف الإجراء برسالة واضحة', 'Stop the action with a clear message', 'أبسط وأكثر أمانًا')],
    rec: () => ({ value: 'DEGRADE_GRACEFULLY_WITH_RETRY_QUEUE', caused: ['integrations'], why: W('يحافظ على الاستمرارية دون فقد بيانات.', 'Preserves continuity without losing data.') }) },
  { id: 'data_classes', dims: ['DATA', 'PRIVACY', 'COMPLIANCE'], crit: 5, scope: ['FP'], deps: [], burden: 2, impact: ['data', 'security', 'schema', 'tests'], na_allowed: false,
    q: W('ما أنواع المعلومات التي سيحفظها النظام ومن يملكها (أفراد، جهات، النظام)؟', 'What kinds of information will be stored and who owns them (individuals, customers, the system)?'), expert: W('Data classes / ownership / tenant scope', 'Data classes / ownership / tenant scope'),
    choices: [ch('PERSONAL_DATA_ONLY', 'بيانات شخصية عادية فقط', 'Ordinary personal data only', 'ضمانات أخف'), ch('PERSONAL_PLUS_FINANCIAL', 'شخصية ومالية', 'Personal and financial', 'ضمانات أقوى'), ch('HEALTH_OR_OTHER_REGULATED', 'صحية أو منظَّمة أخرى', 'Health or other regulated', 'أعلى التزامات'), ch('NO_PERSONAL_DATA', 'لا بيانات شخصية', 'No personal data', 'أبسط التزامات')],
    rec: (P) => ({ value: P.regulated ? 'HEALTH_OR_OTHER_REGULATED' : 'PERSONAL_DATA_ONLY', caused: P.regulated ? ['regulated-domain signal'] : ['production baseline'], why: W('تقدير أولي من المجال الذي ذكرته.', 'Initial estimate from the domain you described.') }) },
  { id: 'retention_deletion', dims: ['PRIVACY', 'DATA', 'COMPLIANCE'], crit: 4, scope: ['FP'], deps: ['data_classes'], burden: 1, impact: ['data', 'operations', 'tests', 'backup'], na_allowed: false,
    q: W('كم من الوقت تُحفظ البيانات وكيف تُحذف عند الطلب؟', 'How long is data kept, and how is it deleted on request?'), expert: W('Retention / deletion / export', 'Retention / deletion / export'),
    choices: [ch('DELETE_ON_REQUEST_WITH_FIXED_RETENTION', 'حذف عند الطلب مع مدة حفظ محددة', 'Delete on request with a fixed retention period', 'قابل للتحقق'), ch('RETAIN_UNTIL_ACCOUNT_CLOSED_PLUS_GRACE', 'حتى إغلاق الحساب ثم مهلة', 'Until the account closes plus a grace period', 'أبسط'), ch('RETENTION_DEFERRED_WITH_GATE', 'مؤجل بشرط واضح', 'Deferred with an explicit gate', 'لا يسمح بالتنفيذ')],
    rec: (P) => ({ value: 'DELETE_ON_REQUEST_WITH_FIXED_RETENTION', caused: ['data_classes'], why: W('أقرب لمتطلبات الخصوصية الشائعة.', 'Closest to common privacy expectations.') }) },
  { id: 'privacy_compliance', dims: ['PRIVACY', 'COMPLIANCE'], crit: 4, scope: ['FP'], deps: ['data_classes'], burden: 2, impact: ['data', 'security', 'operations', 'audit'], na_allowed: true,
    q: W('هل توجد أنظمة أو قوانين يجب الالتزام بها (خصوصية، صحة، مالية)؟ إن لم تعرف فسنحدد ما يلزم مراجعته قانونيًا.', 'Are there laws or regulations you must follow (privacy, health, financial)? If you do not know, we will flag what needs legal review.'), expert: W('Privacy / compliance regimes', 'Privacy / compliance regimes'),
    choices: [ch('LEGAL_REVIEW_REQUIRED_REGIME_UNKNOWN', 'لا أعرف — يلزم تحديد الأنظمة بمراجعة قانونية', 'I do not know — a legal review must identify the regimes', 'الأصدق عند عدم المعرفة'), ch('GENERAL_PRIVACY_BASELINE', 'خط أساس عام للخصوصية', 'General privacy baseline', 'قد لا يكفي لمجال منظَّم'), ch('REGULATED_DOMAIN_REGIME', 'نظام مجال منظَّم محدد (يُذكر)', 'A specific regulated-domain regime (to be named)', 'أعلى التزامات')],
    rec: () => ({ value: 'LEGAL_REVIEW_REQUIRED_REGIME_UNKNOWN', caused: ['data_classes'], why: W('لا يستطيع النظام الجزم بالالتزامات القانونية؛ هذا ليس رأيًا قانونيًا.', 'The system cannot determine legal obligations; this is not legal advice.') }) },
  { id: 'nfr_availability', dims: ['AVAILABILITY', 'RELIABILITY'], crit: 4, scope: ['FP'], deps: [], burden: 1, impact: ['deployment', 'operations', 'cost', 'tests'], na_allowed: false,
    q: W('كم من الوقت يمكن أن يتوقف المنتج خلال الشهر دون ضرر كبير؟', 'How much downtime per month could you tolerate without serious harm?'), expert: W('Availability target (SLO)', 'Availability target (SLO)'),
    choices: [ch('BEST_EFFORT', 'لا التزام محدد', 'No specific commitment', 'أرخص بلا ضمان', { availability_pct: null }), ch('STANDARD_99_5', 'حتى نحو 3.6 ساعات شهريًا', 'Up to about 3.6 hours a month', 'كلفة معتدلة', 'Moderate cost', { availability_pct: 99.5 }), ch('HIGH_99_9', 'حتى نحو 43 دقيقة شهريًا', 'Up to about 43 minutes a month', 'يتطلب تكرارًا ومراقبة', 'Needs redundancy and monitoring', { availability_pct: 99.9 }), ch('CRITICAL_99_95', 'حتى نحو 22 دقيقة شهريًا', 'Up to about 22 minutes a month', 'مكلف جدًا', 'Very costly', { availability_pct: 99.95 })],
    rec: (P) => ({ value: P.sensitive || P.payments ? 'HIGH_99_9' : 'STANDARD_99_5', caused: P.sensitive || P.payments ? ['payments or sensitive data'] : ['production baseline'], why: W('مستوى مقترح يمكنك تغييره.', 'A proposed tier you may change.') }) },
  { id: 'nfr_data_loss_rpo', dims: ['BACKUP', 'RELIABILITY'], crit: 5, scope: ['FP'], deps: [], burden: 1, impact: ['backup', 'deployment', 'cost', 'operations', 'tests'], na_allowed: false,
    q: W('إذا تعطل النظام، كم من البيانات الحديثة يمكنك تحمّل خسارتها: لا شيء، دقائق قليلة، ساعة، أم يومًا؟', 'If the service fails, how much recent data could you tolerate losing: none, a few minutes, an hour, or a day?'), expert: W('RPO (recovery point objective)', 'RPO (recovery point objective)'),
    choices: [ch('NONE_ACCEPTABLE', 'لا شيء', 'None', 'يتطلب نسخًا متزامنًا وأعلى كلفة', 'Needs synchronous replication; highest cost', { rpo: 'PT0S' }), ch('MINUTES_UP_TO_5', 'حتى 5 دقائق', 'Up to 5 minutes', 'استرجاع لحظي (PITR)', 'Point-in-time recovery', { rpo: 'PT5M' }), ch('UP_TO_1_HOUR', 'حتى ساعة', 'Up to 1 hour', 'نسخ متكرر', 'Frequent backups', { rpo: 'PT1H' }), ch('UP_TO_24_HOURS', 'حتى يوم', 'Up to a day', 'الأرخص', 'Cheapest', { rpo: 'PT24H' })],
    rec: (P) => ({ value: P.sensitive || P.payments ? 'MINUTES_UP_TO_5' : 'UP_TO_1_HOUR', caused: P.sensitive || P.payments ? ['payments or sensitive data'] : ['production baseline'], why: W('مقترح قابل للتغيير.', 'A proposal you may change.') }) },
  { id: 'nfr_recovery_time_rto', dims: ['RESTORE', 'DISASTER_RECOVERY'], crit: 5, scope: ['FP'], deps: [], burden: 1, impact: ['deployment', 'operations', 'cost', 'tests'], na_allowed: false,
    q: W('إذا تعطل النظام، كم من الوقت يمكنك الانتظار حتى يعود: دقائق، ساعات، أم أيام؟', 'If the service fails, how long can you wait for it to come back: minutes, hours, or days?'), expert: W('RTO (recovery time objective)', 'RTO (recovery time objective)'),
    choices: [ch('MINUTES_UP_TO_15', 'حتى 15 دقيقة', 'Up to 15 minutes', 'يتطلب جاهزية دائمة', 'Needs standby capacity', { rto: 'PT15M' }), ch('HOURS_UP_TO_4', 'حتى 4 ساعات', 'Up to 4 hours', 'توازن', 'Balanced', { rto: 'PT4H' }), ch('UP_TO_24_HOURS', 'حتى يوم', 'Up to a day', 'أرخص', 'Cheaper', { rto: 'PT24H' }), ch('UP_TO_72_HOURS', 'حتى 3 أيام', 'Up to 3 days', 'الأرخص وأعلى خطر على الأعمال', 'Cheapest, highest business risk', { rto: 'PT72H' })],
    rec: (P) => ({ value: P.sensitive || P.payments ? 'HOURS_UP_TO_4' : 'UP_TO_24_HOURS', caused: P.sensitive || P.payments ? ['payments or sensitive data'] : ['production baseline'], why: W('مقترح قابل للتغيير.', 'A proposal you may change.') }) },
  { id: 'nfr_performance', dims: ['PERFORMANCE'], crit: 3, scope: ['FP'], deps: [], burden: 1, impact: ['tests', 'deployment', 'cost'], na_allowed: false,
    q: W('ما مدى سرعة استجابة الشاشات المتوقعة؟', 'How fast should screens respond?'), expert: W('Latency objective (p95)', 'Latency objective (p95)'),
    choices: [ch('FAST_P95_500MS', 'سريع جدًا (أقل من نصف ثانية غالبًا)', 'Very fast (under half a second, typically)', 'كلفة أعلى', 'Higher cost', { latency_p95_ms: 500 }), ch('STANDARD_P95_1S', 'قياسي (حتى ثانية)', 'Standard (up to a second)', 'توازن', 'Balanced', { latency_p95_ms: 1000 }), ch('RELAXED_P95_2S', 'مريح (حتى ثانيتين)', 'Relaxed (up to two seconds)', 'أرخص', 'Cheaper', { latency_p95_ms: 2000 })],
    rec: () => ({ value: 'STANDARD_P95_1S', caused: ['production baseline'], why: W('مقترح شائع.', 'A common proposal.') }) },
  { id: 'nfr_scale', dims: ['SCALABILITY', 'PERFORMANCE'], crit: 4, scope: ['FP'], deps: [], burden: 1, impact: ['deployment', 'cost', 'data', 'tests'], na_allowed: false,
    q: W('كم عدد المستخدمين النشطين المتوقع بعد سنة؟', 'How many active users do you expect after a year?'), expert: W('Capacity / scalability target', 'Capacity / scalability target'),
    choices: [ch('UP_TO_1K_USERS', 'حتى ألف', 'Up to 1,000', 'بنية بسيطة', 'Simple infrastructure', { users_12m: 1000 }), ch('UP_TO_50K_USERS', 'حتى 50 ألفًا', 'Up to 50,000', 'يحتاج مراقبة وفهارس', 'Needs monitoring and indexing', { users_12m: 50000 }), ch('UP_TO_1M_USERS', 'حتى مليون', 'Up to 1,000,000', 'يحتاج تصميمًا للتوسع', 'Needs scale-aware design', { users_12m: 1000000 }), ch('OVER_1M_USERS', 'أكثر من مليون', 'More than a million', 'تصميم متخصص', 'Specialised design', { users_12m: 1000001 })],
    rec: () => ({ value: 'UP_TO_50K_USERS', caused: ['availability_targets (frozen item) if provided'], why: W('تقدير افتراضي ينتظر رقمك الحقيقي.', 'A placeholder estimate awaiting your real number.') }) },
  { id: 'rate_limit_abuse', dims: ['SECURITY', 'RELIABILITY'], crit: 4, scope: ['FP'], deps: ['tenancy_model'], burden: 1, impact: ['security', 'api', 'tests', 'operations'], na_allowed: false,
    q: W('كيف تحمي المنتج من الإساءة أو الاستهلاك المفرط؟', 'How do you protect the product from abuse or runaway usage?'), expert: W('Rate limiting / abuse prevention', 'Rate limiting / abuse prevention'),
    choices: [ch('PER_TENANT_AND_PER_USER_LIMITS', 'حدود لكل جهة ولكل مستخدم', 'Limits per customer and per user', 'يحمي الجميع'), ch('PER_USER_AND_PER_IP_LIMITS', 'حدود لكل مستخدم وعنوان', 'Limits per user and IP', 'أبسط')],
    rec: (P) => ({ value: P.tenancy === 'SINGLE_TENANT' ? 'PER_USER_AND_PER_IP_LIMITS' : 'PER_TENANT_AND_PER_USER_LIMITS', caused: ['tenancy_model'], why: W('يمنع جهة واحدة من إيذاء الباقين.', 'Stops one customer from harming the rest.') }) },
  { id: 'backup_policy', dims: ['BACKUP'], crit: 5, scope: ['FP'], deps: ['nfr_data_loss_rpo', 'tenancy_model'], burden: 1, impact: ['backup', 'deployment', 'cost', 'operations', 'tests'], na_allowed: false,
    q: W('كيف تُنسخ البيانات احتياطيًا؟', 'How is data backed up?'), expert: W('Backup frequency / PITR / retention', 'Backup frequency / PITR / retention'),
    choices: [ch('DAILY_AUTOMATED_PLUS_PITR', 'نسخ يومي تلقائي مع استرجاع لحظي', 'Daily automated plus point-in-time recovery', 'الأكثر أمانًا', 'Safest', { backup: 'DAILY_PITR' }), ch('DAILY_AUTOMATED', 'نسخ يومي تلقائي', 'Daily automated', 'قياسي', 'Standard', { backup: 'DAILY' }), ch('WEEKLY_MANUAL', 'أسبوعي يدوي', 'Weekly manual', 'غير موصى به', 'Not recommended', { backup: 'WEEKLY_MANUAL' })],
    rec: () => ({ value: 'DAILY_AUTOMATED_PLUS_PITR', caused: ['nfr_data_loss_rpo'], why: W('تلبية هدف فقد البيانات.', 'Supports the data-loss target.') }) },
  { id: 'restore_drill', dims: ['RESTORE', 'BACKUP'], crit: 5, scope: ['FP'], deps: ['backup_policy'], burden: 1, impact: ['backup', 'operations', 'tests'], na_allowed: false,
    q: W('هل تريد اختبار استرجاع النسخ فعليًا؟ (نسخة لم تُجرَّب لا تُعدّ نسخة)', 'Do you want backups restore-tested for real? (an untested backup is not a backup)'), expert: W('Restore drill', 'Restore drill'),
    choices: [ch('QUARTERLY_RESTORE_DRILL', 'اختبار استرجاع دوري كل ربع سنة', 'A restore drill every quarter', 'يثبت الجاهزية'), ch('RESTORE_DRILL_BEFORE_LAUNCH_ONLY', 'قبل الإطلاق فقط', 'Before launch only', 'أدنى مقبول')],
    rec: () => ({ value: 'QUARTERLY_RESTORE_DRILL', caused: ['backup_policy'], why: W('هو الدليل الوحيد على أن الاسترجاع يعمل.', 'It is the only proof that restore works.') }) },
  { id: 'continuity_dr', dims: ['DISASTER_RECOVERY', 'BUSINESS_CONTINUITY'], crit: 4, scope: ['FP'], deps: ['nfr_recovery_time_rto', 'nfr_availability'], burden: 1, impact: ['deployment', 'operations', 'cost', 'tests'], na_allowed: false,
    q: W('إذا تعطل مركز البيانات كله، ما الخطة؟', 'If a whole data centre fails, what is the plan?'), expert: W('Disaster recovery / business continuity', 'Disaster recovery / business continuity'),
    choices: [ch('SINGLE_REGION_WITH_OFFSITE_BACKUPS', 'منطقة واحدة ونسخ خارجية', 'One region with off-site backups', 'أرخص وأبطأ تعافيًا'), ch('WARM_STANDBY_SECOND_REGION', 'منطقة ثانية جاهزة جزئيًا', 'A warm standby second region', 'أسرع وأغلى'), ch('ACTIVE_ACTIVE_MULTI_REGION', 'منطقتان تعملان معًا', 'Active-active multi-region', 'الأعلى كلفة وتعقيدًا')],
    rec: (P) => ({ value: P.sensitive || P.payments ? 'WARM_STANDBY_SECOND_REGION' : 'SINGLE_REGION_WITH_OFFSITE_BACKUPS', caused: ['availability and recovery targets'], why: W('يتبع أهداف التوفر والتعافي.', 'Follows the availability and recovery targets.') }) },
  { id: 'observability', dims: ['OBSERVABILITY', 'OPERATIONS'], crit: 4, scope: ['FP'], deps: ['nfr_availability'], burden: 1, impact: ['operations', 'cost', 'deployment', 'tests'], na_allowed: false,
    q: W('كيف ستعرف أن المنتج يعمل جيدًا أو يتعطل؟', 'How will you know the product is healthy or failing?'), expert: W('Logs / metrics / traces / alerts', 'Logs / metrics / traces / alerts'),
    choices: [ch('LOGS_METRICS_ALERTS', 'سجلات ومقاييس وتنبيهات', 'Logs, metrics and alerts', 'قياسي'), ch('LOGS_METRICS_TRACES_ALERTS', 'مع تتبع للطلبات', 'Plus request tracing', 'أدق وأغلى'), ch('LOGS_ONLY', 'سجلات فقط', 'Logs only', 'غير كافٍ للإنتاج')],
    rec: () => ({ value: 'LOGS_METRICS_ALERTS', caused: ['nfr_availability'], why: W('الحد الأدنى المعقول لإنتاج حقيقي.', 'The sensible minimum for real production.') }) },
  { id: 'incident_response', dims: ['INCIDENT_RESPONSE', 'SUPPORT'], crit: 4, scope: ['FP'], deps: ['observability'], burden: 1, impact: ['operations', 'tests'], na_allowed: false,
    q: W('من يُنبَّه ويتصرف عند وقوع عطل، ومتى؟', 'Who gets alerted and acts when something breaks, and when?'), expert: W('Incident response / on-call / runbooks', 'Incident response / on-call / runbooks'),
    choices: [ch('ONCALL_WITH_RUNBOOKS', 'مناوبة مع أدلة تشغيل', 'On-call with runbooks', 'الأفضل للتوفر العالي'), ch('BUSINESS_HOURS_WITH_RUNBOOKS', 'ساعات العمل مع أدلة تشغيل', 'Business hours with runbooks', 'أرخص'), ch('BEST_EFFORT_NO_COMMITMENT', 'بلا التزام', 'Best effort, no commitment', 'غير موصى به')],
    rec: (P) => ({ value: P.payments || P.sensitive ? 'ONCALL_WITH_RUNBOOKS' : 'BUSINESS_HOURS_WITH_RUNBOOKS', caused: ['nfr_availability'], why: W('يتبع هدف التوفر.', 'Follows the availability target.') }) },
  { id: 'support_admin_surface', dims: ['SUPPORT', 'OPERATIONS', 'SECURITY'], crit: 3, scope: ['SAAS'], deps: ['authorization_model', 'audit_trail'], burden: 1, impact: ['operations', 'security', 'audit', 'api'], na_allowed: true,
    q: W('هل يحتاج فريقك لوحة إدارة لمساعدة العملاء؟', 'Does your team need an admin console to help customers?'), expert: W('Support/admin surface (audited impersonation)', 'Support/admin surface (audited impersonation)'),
    choices: [ch('ADMIN_CONSOLE_WITH_AUDITED_ACCESS', 'لوحة إدارة بوصول مُدقَّق', 'Admin console with audited access', 'يتطلب ضبط صلاحيات صارم'), ch('READ_ONLY_SUPPORT_VIEW', 'عرض للقراءة فقط', 'Read-only support view', 'أقل خطرًا'), ch('NONE_INITIALLY', 'لا شيء في البداية', 'None initially', 'يرفع عبء الدعم اليدوي')],
    rec: () => ({ value: 'READ_ONLY_SUPPORT_VIEW', caused: ['authorization_model'], why: W('أقل خطرًا كبداية.', 'Lowest risk as a start.') }) },
  { id: 'cost_budget', dims: ['COST'], crit: 4, scope: ['FP'], deps: ['tenancy_model', 'nfr_scale', 'nfr_availability'], burden: 1, impact: ['cost'], na_allowed: false,
    q: W('ما سقف التكلفة الشهرية التي تقبلها؟ (اذكر رقمك إن عرفته، وإلا سنقدّم نطاقًا بافتراضات)', 'What monthly cost ceiling is acceptable? (Give your number if you know it; otherwise we give a range with assumptions)'), expert: W('Budget ceiling / cost per tenant', 'Budget ceiling / cost per tenant'),
    choices: [ch('BOOTSTRAP_LOW_CEILING', 'ميزانية منخفضة', 'A low budget', 'يحدّ الخيارات'), ch('GROWTH_MODERATE_CEILING', 'ميزانية متوسطة', 'A moderate budget', 'توازن'), ch('ENTERPRISE_HIGH_CEILING', 'ميزانية مؤسسية', 'An enterprise budget', 'أوسع الخيارات'), ch('UNKNOWN_ESTIMATE_REQUIRED', 'لا أعرف — أحتاج تقديرًا', 'I do not know — I need an estimate', 'يبقى قرارًا مفتوحًا')],
    rec: () => ({ value: 'UNKNOWN_ESTIMATE_REQUIRED', caused: ['nfr_scale', 'tenancy_model'], why: W('لا يمكن اختراع سقف نيابة عنك؛ ستُعرض نطاقات بافتراضاتها.', 'A ceiling cannot be invented for you; ranges with assumptions are shown.') }) },
  { id: 'build_vs_buy', dims: ['ARCHITECTURE', 'COST', 'SECURITY'], crit: 3, scope: ['FP'], deps: ['cost_budget'], burden: 2, impact: ['architecture', 'cost', 'security', 'operations'], na_allowed: false,
    q: W('للأمور العامة (تسجيل الدخول، الدفع، البريد): نبنيها بأنفسنا أم نستخدم خدمات جاهزة؟', 'For common needs (sign-in, payments, email): build them ourselves or use ready-made services?'), expert: W('Build vs buy (managed / external SaaS / OSS self-hosted / hybrid)', 'Build vs buy (managed / external SaaS / OSS self-hosted / hybrid)'),
    choices: [ch('MANAGED_SERVICES_FIRST', 'خدمات مُدارة أولًا', 'Managed services first', 'أسرع وأقل عبئًا ويربطك بمزود'), ch('BUILD_CORE_BUY_COMMODITY', 'نبني جوهر المنتج ونشتري ما هو عام', 'Build the core, buy the commodity', 'متوازن'), ch('OPEN_SOURCE_SELF_HOSTED', 'مفتوح المصدر مستضاف ذاتيًا', 'Open-source self-hosted', 'تحكم أعلى وعبء تشغيلي أكبر')],
    rec: () => ({ value: 'BUILD_CORE_BUY_COMMODITY', caused: ['cost_budget'], why: W('الخيار الافتراضي المتوازن؛ انظر جدول المقارنة.', 'The balanced default; see the comparison table.') }) },
  { id: 'deployment_envs', dims: ['DEPLOYMENT', 'OPERATIONS'], crit: 4, scope: ['FP'], deps: [], burden: 1, impact: ['deployment', 'operations', 'cost', 'tests'], na_allowed: false,
    q: W('كم بيئة تريد قبل الإنتاج؟', 'How many environments before production?'), expert: W('Environment separation', 'Environment separation'),
    choices: [ch('DEV_STAGING_PRODUCTION', 'تطوير وتجريب وإنتاج', 'Development, staging and production', 'قياسي', 'Standard', { envs: ['local', 'staging', 'production'] }), ch('DEV_PREVIEW_STAGING_PRODUCTION', 'مع معاينة لكل تعديل', 'Plus per-change previews', 'أدق وأغلى', 'More precise, costlier', { envs: ['local', 'preview', 'staging', 'production'] }), ch('DEV_PRODUCTION_ONLY', 'تطوير وإنتاج فقط', 'Development and production only', 'غير موصى به', 'Not recommended', { envs: ['local', 'production'] })],
    rec: () => ({ value: 'DEV_STAGING_PRODUCTION', caused: ['production baseline'], why: W('حد أدنى معقول لإنتاج حقيقي.', 'The sensible minimum for real production.') }) },
  { id: 'deployment_ownership', dims: ['DEPLOYMENT', 'OPERATIONS', 'SUPPORT'], crit: 4, scope: ['FP'], deps: ['deployment_envs'], burden: 1, impact: ['operations', 'deployment', 'cost'], na_allowed: false,
    q: W('من سيكون مسؤولًا عن نشر المنتج وتشغيله ومتابعته بعد الإطلاق؟', 'Who will be responsible for releasing, running and watching the product after launch?'), expert: W('Deployment / operations ownership', 'Deployment / operations ownership'),
    choices: [ch('FOUNDER_OR_INTERNAL_TEAM_OWNS', 'أنت أو فريقك', 'You or your own team', 'تحكم كامل ويتطلب قدرة تشغيلية'), ch('EXTERNAL_ENGINEERING_TEAM_OWNS', 'فريق هندسة خارجي', 'An external engineering team', 'يلزم عقد مستوى خدمة'), ch('MANAGED_OPERATIONS_PARTNER', 'شريك تشغيل مُدار', 'A managed-operations partner', 'عبء أقل وتكلفة أعلى')],
    rec: () => ({ value: 'FOUNDER_OR_INTERNAL_TEAM_OWNS', caused: ['deployment_envs'], why: W('افتراض أولي؛ يجب أن يحدد إنسان المسؤول فعليًا.', 'A starting assumption; a human must name the real owner.') }) },
  { id: 'domain_tls', dims: ['DEPLOYMENT', 'SECURITY'], crit: 3, scope: ['FP'], deps: ['tenancy_model'], burden: 1, impact: ['deployment', 'security', 'operations'], na_allowed: false,
    q: W('أي عنوان إنترنت سيستخدم المنتج؟', 'Which web address will the product use?'), expert: W('Domain / DNS / TLS', 'Domain / DNS / TLS'),
    choices: [ch('OWN_DOMAIN_MANAGED_TLS', 'نطاق خاص بشهادة مُدارة', 'Your own domain with managed TLS', 'قياسي'), ch('PROVIDER_SUBDOMAIN_ONLY', 'نطاق فرعي من المزود فقط', 'Provider subdomain only', 'لا يليق بمنتج تجاري'), ch('TENANT_CUSTOM_DOMAINS', 'نطاق خاص لكل جهة', 'A custom domain per customer', 'أعقد')],
    rec: () => ({ value: 'OWN_DOMAIN_MANAGED_TLS', caused: ['production baseline'], why: W('قياسي لمنتج تجاري.', 'Standard for a commercial product.') }) },
  { id: 'ci_cd', dims: ['DEPLOYMENT', 'TESTING', 'OPERATIONS'], crit: 4, scope: ['FP'], deps: ['deployment_envs'], burden: 1, impact: ['deployment', 'tests', 'operations'], na_allowed: false,
    q: W('كيف تُنشر التعديلات؟ هل تمر باختبارات تلقائية أولًا؟', 'How do changes get released? Do they pass automatic tests first?'), expert: W('CI/CD', 'CI/CD'),
    choices: [ch('CI_TESTS_GATE_CD_WITH_APPROVAL', 'اختبارات تلقائية ونشر بموافقة', 'Automated tests gate deployment, with approval', 'الأكثر أمانًا'), ch('CI_ONLY_MANUAL_DEPLOY', 'اختبارات تلقائية ونشر يدوي', 'Automated tests, manual deploy', 'أبسط'), ch('NO_CI', 'بدون أتمتة', 'No automation', 'غير موصى به')],
    rec: () => ({ value: 'CI_TESTS_GATE_CD_WITH_APPROVAL', caused: ['deployment_envs'], why: W('يقلل أخطاء النشر.', 'Reduces release mistakes.') }) },
  { id: 'migration_rollback', dims: ['MIGRATION', 'DEPLOYMENT'], crit: 4, scope: ['FP'], deps: ['deployment_envs', 'backup_policy'], burden: 1, impact: ['migration', 'deployment', 'data', 'tests', 'backup'], na_allowed: false,
    q: W('كيف تُعدَّل قاعدة البيانات دون خطر، وماذا لو فشل تعديل في منتصفه؟', 'How are database changes made safely, and what if one fails midway?'), expert: W('Migration strategy / rollback', 'Migration strategy / rollback'),
    choices: [ch('EXPAND_CONTRACT_WITH_BACKUP_AND_ROLLBACK_PLAN', 'تعديل تدريجي مع نسخة وخطة تراجع', 'Gradual changes with a backup and rollback plan', 'الأكثر أمانًا'), ch('FORWARD_ONLY_WITH_BACKUP', 'تعديلات أمامية مع نسخة قبلها', 'Forward-only changes with a prior backup', 'أبسط وأخطر')],
    rec: () => ({ value: 'EXPAND_CONTRACT_WITH_BACKUP_AND_ROLLBACK_PLAN', caused: ['backup_policy'], why: W('يمنع فقدان البيانات عند الفشل الجزئي.', 'Prevents data loss on partial failure.') }) },
  { id: 'accessibility_l10n', dims: ['ACCESSIBILITY', 'LOCALIZATION'], crit: 3, scope: ['FP'], deps: [], burden: 1, impact: ['tests', 'api'], na_allowed: false,
    q: W('ما مستوى إتاحة المنتج لذوي الاحتياجات وللغات متعددة (مثل العربية من اليمين لليسار)؟', 'What accessibility level and which languages (e.g. Arabic right-to-left)?'), expert: W('Accessibility (WCAG) / i18n / RTL', 'Accessibility (WCAG) / i18n / RTL'),
    choices: [ch('WCAG_2_2_AA_BILINGUAL_RTL', 'WCAG 2.2 AA مع العربية (RTL) والإنجليزية', 'WCAG 2.2 AA with Arabic (RTL) and English', 'شامل'), ch('WCAG_2_2_AA_SINGLE_LANGUAGE', 'WCAG 2.2 AA للغة واحدة', 'WCAG 2.2 AA, one language', 'أبسط'), ch('BASIC_ACCESSIBILITY', 'إتاحة أساسية', 'Basic accessibility', 'قد لا يفي بمتطلبات')],
    rec: () => ({ value: 'WCAG_2_2_AA_BILINGUAL_RTL', caused: ['languages (frozen item) if provided'], why: W('يتبع لغات المنتج.', 'Follows the product languages.') }) },
  { id: 'testing_strategy', dims: ['TESTING'], crit: 4, scope: ['FP'], deps: ['tenancy_model', 'authorization_model'], burden: 1, impact: ['tests'], na_allowed: false,
    q: W('ما مستوى الاختبار الذي تريده قبل الإطلاق؟', 'What level of testing do you want before launch?'), expert: W('Test strategy (unit / integration / e2e / security / load)', 'Test strategy (unit / integration / e2e / security / load)'),
    choices: [ch('LAYERED_UNIT_INTEGRATION_E2E_SECURITY_LOAD', 'طبقات: وحدة وتكامل وشاملة وأمن وحمل', 'Layered: unit, integration, end-to-end, security and load', 'الأشمل'), ch('UNIT_AND_E2E_ONLY', 'وحدة وشاملة فقط', 'Unit and end-to-end only', 'لا يغطي الأمن والحمل')],
    rec: () => ({ value: 'LAYERED_UNIT_INTEGRATION_E2E_SECURITY_LOAD', caused: ['production baseline'], why: W('مطلوب لإثبات ادعاءات الإنتاج.', 'Needed to prove production claims.') }) },
  { id: 'security_threat_assumptions', dims: ['SECURITY'], crit: 5, scope: ['FP'], deps: ['tenancy_model', 'data_classes'], burden: 2, impact: ['security', 'tests', 'architecture'], na_allowed: false,
    q: W('من تخشى منه أكثر، وما أهم ما يجب حمايته؟', 'Whom do you fear most, and what matters most to protect?'), expert: W('Threat assumptions / protected assets', 'Threat assumptions / protected assets'),
    choices: [ch('WEB_THREATS_INSIDER_AND_CROSS_TENANT', 'هجمات الويب المعتادة وموظف سيئ ووصول بين الجهات', 'Common web attacks, a malicious insider and cross-customer access', 'الأنسب لـ SaaS متعدد الجهات'), ch('WEB_THREATS_ONLY', 'هجمات الويب المعتادة', 'Common web attacks', 'أضيق'), ch('TARGETED_ATTACKER_REGULATED_DATA', 'مهاجم مستهدف لبيانات منظَّمة', 'A targeted attacker after regulated data', 'الأعلى حماية')],
    rec: (P) => ({ value: P.regulated ? 'TARGETED_ATTACKER_REGULATED_DATA' : (P.tenancy === 'SINGLE_TENANT' ? 'WEB_THREATS_ONLY' : 'WEB_THREATS_INSIDER_AND_CROSS_TENANT'), caused: ['tenancy_model', 'data_classes'], why: W('يتبع نموذج التأجير وحساسية البيانات.', 'Follows the tenancy model and data sensitivity.') }) },
  { id: 'secrets_key_management', dims: ['SECURITY', 'OPERATIONS'], crit: 4, scope: ['FP'], deps: [], burden: 1, impact: ['security', 'operations', 'deployment'], na_allowed: false,
    q: W('كيف تُحفظ المفاتيح وكلمات السر وتُجدَّد؟', 'How are keys and passwords stored and rotated?'), expert: W('Secrets management / rotation', 'Secrets management / rotation'),
    choices: [ch('VAULT_WITH_ROTATION_POLICY', 'خزنة أسرار مع سياسة تجديد', 'A secrets vault with a rotation policy', 'الأكثر أمانًا'), ch('ENV_VARS_ONLY', 'متغيرات بيئة فقط', 'Environment variables only', 'لا تجديد منظم')],
    rec: () => ({ value: 'VAULT_WITH_ROTATION_POLICY', caused: ['production baseline'], why: W('يقلل أثر تسرب مفتاح.', 'Limits the impact of a leaked key.') }) },
  // ---- AI-native SaaS (activated only when the product itself uses AI) ----
  { id: 'ai_provider_abstraction', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'ARCHITECTURE'], crit: 4, scope: ['AI'], deps: ['ai_native_scope'], burden: 2, impact: ['architecture', 'ai', 'cost'], na_allowed: false,
    q: W('هل يجب أن يعمل المنتج مع أكثر من مزود ذكاء اصطناعي ويسهل التبديل بينهم؟', 'Must the product work with more than one AI provider and make switching easy?'), expert: W('Model/provider abstraction', 'Model/provider abstraction'),
    choices: [ch('PROVIDER_ABSTRACTION_LAYER', 'طبقة تجريد لمزودين متعددين', 'An abstraction layer over several providers', 'مرونة وتعقيد'), ch('SINGLE_PROVIDER_DIRECT', 'مزود واحد مباشرة', 'One provider directly', 'أبسط وأكثر ارتباطًا')],
    rec: () => ({ value: 'PROVIDER_ABSTRACTION_LAYER', caused: ['ai_native_scope'], why: W('النماذج تتغير وتنسحب.', 'Models change and get retired.') }) },
  { id: 'ai_model_selection_version', dims: ['AI_SAFETY_WHEN_APPLICABLE'], crit: 4, scope: ['AI'], deps: ['ai_provider_abstraction'], burden: 1, impact: ['ai', 'tests'], na_allowed: false,
    q: W('هل نثبّت نسخة النموذج ونختبرها قبل اعتمادها؟', 'Do we pin the model version and test it before adopting it?'), expert: W('Model selection / version pinning / admission', 'Model selection / version pinning / admission'),
    choices: [ch('PINNED_VERSION_WITH_EVAL_GATE', 'نسخة مثبتة مع بوابة تقييم', 'A pinned version with an evaluation gate', 'الأكثر أمانًا'), ch('FLOATING_LATEST', 'أحدث نسخة تلقائيًا', 'Whatever is latest', 'غير موصى به')],
    rec: () => ({ value: 'PINNED_VERSION_WITH_EVAL_GATE', caused: ['ai_provider_abstraction'], why: W('توفّر النموذج لا يعني أنه مقبول للمهمة.', 'Availability does not mean the model is admitted for the task.') }) },
  { id: 'ai_prompt_versioning', dims: ['AI_SAFETY_WHEN_APPLICABLE'], crit: 3, scope: ['AI'], deps: ['ai_native_scope'], burden: 1, impact: ['ai', 'tests'], na_allowed: false,
    q: W('كيف تُدار تعليمات الذكاء الاصطناعي (البرومبتات) عند تغييرها؟', 'How are AI instructions (prompts) managed when they change?'), expert: W('Prompt versioning / governance', 'Prompt versioning / governance'),
    choices: [ch('VERSIONED_AND_REVIEWED_WITH_TESTS', 'نسخ موثقة ومراجعة واختبار', 'Versioned, reviewed and tested', 'الأفضل'), ch('EDITED_LIVE', 'تعديل مباشر', 'Edited live', 'خطر انحدار')],
    rec: () => ({ value: 'VERSIONED_AND_REVIEWED_WITH_TESTS', caused: ['ai_native_scope'], why: W('أي تغيير في البرومبت قد يغيّر السلوك.', 'Any prompt change can change behaviour.') }) },
  { id: 'ai_evaluation_plan', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'TESTING'], crit: 5, scope: ['AI'], deps: ['ai_model_selection_version'], burden: 2, impact: ['ai', 'tests'], na_allowed: false,
    q: W('كيف نقيس جودة ما يقوله الذكاء الاصطناعي قبل الاعتماد عليه؟', 'How do we measure the quality of what the AI says before relying on it?'), expert: W('Evaluation datasets and metrics', 'Evaluation datasets and metrics'),
    choices: [ch('GOLDEN_DATASET_AND_METRICS_BEFORE_ADMISSION', 'مجموعة اختبار مرجعية ومقاييس قبل الاعتماد', 'A reference test set and metrics before admission', 'الأقوى'), ch('MANUAL_SPOT_CHECKS_ONLY', 'فحص يدوي عشوائي', 'Manual spot checks only', 'لا يثبت الجودة')],
    rec: () => ({ value: 'GOLDEN_DATASET_AND_METRICS_BEFORE_ADMISSION', caused: ['ai_model_selection_version'], why: W('لا اعتماد دون تقييم.', 'No admission without evaluation.') }) },
  { id: 'ai_structured_output', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'RELIABILITY'], crit: 4, scope: ['AI'], deps: ['ai_native_scope'], burden: 1, impact: ['ai', 'api', 'tests'], na_allowed: false,
    q: W('إذا أعاد الذكاء الاصطناعي إجابة مشوّهة أو غير صالحة، ماذا يفعل النظام؟', 'If the AI returns malformed or invalid output, what does the system do?'), expert: W('Structured output validation / repair / fail-closed', 'Structured output validation / repair / fail-closed'),
    choices: [ch('SCHEMA_VALIDATION_REPAIR_ONCE_THEN_FAIL_CLOSED', 'تحقق من الصيغة ومحاولة إصلاح واحدة ثم إيقاف آمن', 'Validate against a schema, repair once, then fail closed', 'الأكثر أمانًا'), ch('FREE_TEXT_OUTPUT', 'نص حر', 'Free text', 'غير موثوق للأتمتة')],
    rec: () => ({ value: 'SCHEMA_VALIDATION_REPAIR_ONCE_THEN_FAIL_CLOSED', caused: ['ai_native_scope'], why: W('لا يجوز تمرير مخرجات غير مُتحقَّق منها.', 'Unvalidated outputs must not flow downstream.') }) },
  { id: 'ai_injection_exfiltration', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'SECURITY'], crit: 5, scope: ['AI'], deps: ['ai_native_scope', 'tenancy_model'], burden: 2, impact: ['ai', 'security', 'tests', 'data'], na_allowed: false,
    q: W('كيف نحمي المنتج إن حاول نص خبيث داخل المحتوى خداع الذكاء الاصطناعي أو تسريب بيانات جهة أخرى؟', 'How do we protect the product if malicious text tries to trick the AI or leak another customer\'s data?'), expert: W('Prompt injection / data exfiltration controls', 'Prompt injection / data exfiltration controls'),
    choices: [ch('ISOLATE_UNTRUSTED_CONTENT_LEAST_PRIVILEGE_OUTPUT_FILTERING', 'عزل المحتوى غير الموثوق وأقل صلاحيات وفلترة المخرجات', 'Isolate untrusted content, least privilege, output filtering', 'الأقوى'), ch('BASIC_INPUT_FILTERING', 'فلترة بسيطة', 'Basic input filtering', 'لا يكفي')],
    rec: () => ({ value: 'ISOLATE_UNTRUSTED_CONTENT_LEAST_PRIVILEGE_OUTPUT_FILTERING', caused: ['ai_native_scope', 'tenancy_model'], why: W('الحقن وتسريب بيانات الجهات هما الخطر الأول.', 'Injection and cross-customer leakage are the top risks.') }) },
  { id: 'ai_tool_permissions', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'AUTHORIZATION'], crit: 5, scope: ['AI'], deps: ['authorization_model', 'ai_native_scope'], burden: 1, impact: ['ai', 'authorization', 'security', 'tests'], na_allowed: false,
    q: W('هل يستطيع الذكاء الاصطناعي تنفيذ إجراءات (حذف، إرسال، تعديل)؟ وبأي صلاحيات؟', 'Can the AI take actions (delete, send, edit)? With what permissions?'), expert: W('Tool permissions', 'Tool permissions'),
    choices: [ch('ALLOWLISTED_TOOLS_PER_ROLE', 'أدوات مسموحة بقائمة وحسب دور المستخدم', 'Allow-listed tools per user role', 'الأكثر أمانًا'), ch('NO_ACTION_TOOLS', 'لا إجراءات، اقتراحات فقط', 'No actions, suggestions only', 'الأقل خطرًا')],
    rec: () => ({ value: 'NO_ACTION_TOOLS', caused: ['authorization_model'], why: W('الأقل خطرًا كبداية.', 'Lowest risk as a start.') }) },
  { id: 'ai_human_approval', dims: ['AI_SAFETY_WHEN_APPLICABLE'], crit: 4, scope: ['AI'], deps: ['ai_tool_permissions'], burden: 1, impact: ['ai', 'operations', 'tests'], na_allowed: false,
    q: W('أي إجراءات يجب ألا ينفذها الذكاء الاصطناعي دون موافقة إنسان؟', 'Which actions must never run without a human approving?'), expert: W('Human-in-the-loop approval', 'Human-in-the-loop approval'),
    choices: [ch('HUMAN_APPROVAL_FOR_CONSEQUENTIAL_ACTIONS', 'موافقة بشرية للإجراءات المؤثرة', 'Human approval for consequential actions', 'موصى به'), ch('FULLY_AUTOMATED', 'أتمتة كاملة', 'Fully automated', 'خطر عالٍ')],
    rec: () => ({ value: 'HUMAN_APPROVAL_FOR_CONSEQUENTIAL_ACTIONS', caused: ['ai_tool_permissions'], why: W('الأخطاء المؤثرة لا تُسترد دائمًا.', 'Consequential mistakes are not always reversible.') }) },
  { id: 'ai_pii_policy', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'PRIVACY'], crit: 5, scope: ['AI'], deps: ['data_classes', 'ai_native_scope'], burden: 1, impact: ['ai', 'privacy', 'security', 'data', 'tests'], na_allowed: false,
    q: W('هل يُسمح بإرسال بيانات شخصية إلى مزود الذكاء الاصطناعي؟ وبأي شروط؟', 'May personal data be sent to the AI provider? Under what conditions?'), expert: W('PII handling for model providers', 'PII handling for model providers'),
    choices: [ch('REDACT_PII_AND_NO_TRAINING_TERMS', 'إخفاء الشخصي وشروط عدم التدريب', 'Redact personal data and require no-training terms', 'موصى به'), ch('NO_PERSONAL_DATA_TO_PROVIDER', 'لا بيانات شخصية للمزود إطلاقًا', 'No personal data to the provider at all', 'الأكثر حماية'), ch('SEND_AS_IS', 'إرسال كما هي', 'Send as is', 'غير موصى به')],
    rec: (P) => ({ value: P.sensitive ? 'NO_PERSONAL_DATA_TO_PROVIDER' : 'REDACT_PII_AND_NO_TRAINING_TERMS', caused: ['data_classes'], why: W('يتبع حساسية البيانات.', 'Follows data sensitivity.') }) },
  { id: 'ai_budget_rate', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'COST'], crit: 4, scope: ['AI'], deps: ['cost_budget', 'ai_native_scope'], burden: 1, impact: ['ai', 'cost', 'operations'], na_allowed: false,
    q: W('كيف نمنع تكلفة الذكاء الاصطناعي من الخروج عن السيطرة؟', 'How do we stop AI cost from running away?'), expert: W('Token budgets and rate limits', 'Token budgets and rate limits'),
    choices: [ch('PER_TENANT_TOKEN_BUDGET_AND_RATE_LIMITS', 'ميزانية رموز لكل جهة وحدود معدل', 'A token budget per customer plus rate limits', 'يحمي التكلفة'), ch('GLOBAL_BUDGET_ONLY', 'سقف عام فقط', 'A global budget only', 'قد يستهلكه عميل واحد')],
    rec: () => ({ value: 'PER_TENANT_TOKEN_BUDGET_AND_RATE_LIMITS', caused: ['cost_budget'], why: W('يمنع عميلًا واحدًا من استهلاك الميزانية.', 'Stops one customer from consuming the budget.') }) },
  { id: 'ai_fallback_degraded', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'RELIABILITY'], crit: 4, scope: ['AI'], deps: ['ai_provider_abstraction'], burden: 1, impact: ['ai', 'operations', 'tests'], na_allowed: false,
    q: W('إذا تعطل مزود الذكاء الاصطناعي، ماذا يرى المستخدم؟', 'If the AI provider is down, what do users see?'), expert: W('Fallback / degraded mode', 'Fallback / degraded mode'),
    choices: [ch('FALLBACK_MODEL_THEN_NON_AI_DEGRADED_MODE', 'نموذج بديل ثم وضع بلا ذكاء اصطناعي', 'A fallback model, then a non-AI degraded mode', 'الأمتن'), ch('FAIL_WITH_CLEAR_ERROR', 'رسالة خطأ واضحة', 'A clear error', 'أبسط')],
    rec: () => ({ value: 'FALLBACK_MODEL_THEN_NON_AI_DEGRADED_MODE', caused: ['ai_provider_abstraction'], why: W('لا يتوقف المنتج بتوقف مزود.', 'The product does not stop when a provider does.') }) },
  { id: 'ai_observability_migration', dims: ['AI_SAFETY_WHEN_APPLICABLE', 'OBSERVABILITY'], crit: 4, scope: ['AI'], deps: ['observability', 'ai_model_selection_version'], burden: 1, impact: ['ai', 'operations', 'tests'], na_allowed: false,
    q: W('كيف نراقب جودة الذكاء الاصطناعي ونبدّل النموذج عند الحاجة؟', 'How do we monitor AI quality and switch models when needed?'), expert: W('AI observability / reproducibility / model migration', 'AI observability / reproducibility / model migration'),
    choices: [ch('REDACTED_TRACES_AND_MIGRATION_RUNBOOK', 'تتبع مُنقَّح وخطة ترحيل بين النماذج', 'Redacted traces and a model-migration runbook', 'موصى به'), ch('METRICS_ONLY', 'مقاييس فقط', 'Metrics only', 'لا يتيح تتبع الأسباب')],
    rec: () => ({ value: 'REDACTED_TRACES_AND_MIGRATION_RUNBOOK', caused: ['observability'], why: W('لا يمكن إصلاح ما لا يمكن رؤيته.', 'You cannot fix what you cannot see.') }) },
];

const byId = {}; ITEMS.forEach((it) => { byId[it.id] = it; });
ITEMS.forEach((it) => it.deps.forEach((d) => { if (!byId[d]) throw new Error('catalog: unknown dependency ' + d + ' of ' + it.id); }));

function dependentsOf(id) {
  const out = []; const seen = {};
  const walk = (x) => ITEMS.forEach((it) => { if (it.deps.indexOf(x) !== -1 && !seen[it.id]) { seen[it.id] = true; out.push(it.id); walk(it.id); } });
  walk(id); return out;
}

const isTxt = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 2000 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s);
function validValue(id, value) {
  const it = byId[id]; if (!it) return false;
  if (typeof value !== 'string') return false;
  if (value.indexOf('manual:') === 0) return isTxt(value.slice(7));
  if (it.multi) return value.split('+').every((v) => it.choices.some((c) => c.value === v));
  return it.choices.some((c) => c.value === value);
}

/** Applicability: YES | NO | CONDITIONAL with an auditable basis. NO requires a CONFIRMED governing decision or explicit scope. */
function applicability(item, P, states) {
  const st = (id) => states[id];
  const confirmed = (id) => st(id) && (st(id).state === 'USER_CONFIRMED' || st(id).state === 'USER_EDITED') ? st(id).value : null;
  const out = { applicable: 'YES', basis: 'ACTIVE_PROFILE' };
  for (const tag of item.scope) {
    let r = null;
    if (tag === 'FP') r = P.activation.FULL_PRODUCTION_PROFILE ? { a: 'YES' } : { a: 'NO', b: 'FULL_PRODUCTION_PROFILE not active' };
    else if (tag === 'SAAS') r = P.activation.FULL_PRODUCTION_SAAS_PROFILE ? { a: 'YES' } : { a: 'NO', b: 'FULL_PRODUCTION_SAAS_PROFILE not active' };
    else if (tag === 'MT') {
      if (!P.activation.FULL_PRODUCTION_SAAS_PROFILE) r = { a: 'NO', b: 'FULL_PRODUCTION_SAAS_PROFILE not active' };
      else if (confirmed('tenancy_model') === 'SINGLE_TENANT') r = { a: 'NO', b: 'tenancy_model confirmed SINGLE_TENANT by the user' };
      else if (confirmed('tenancy_model')) r = { a: 'YES' };
      else r = { a: 'CONDITIONAL', b: 'tenancy_model not yet confirmed (signal: ' + P.tenancy + ')' };
    } else if (tag === 'BILL' || tag === 'BILLORMT') {
      if (!P.activation.FULL_PRODUCTION_SAAS_PROFILE) r = { a: 'NO', b: 'FULL_PRODUCTION_SAAS_PROFILE not active' };
      else if (confirmed('billing_model') === 'NONE' && (tag === 'BILL' || confirmed('tenancy_model') === 'SINGLE_TENANT')) r = { a: 'NO', b: 'billing_model confirmed NONE' + (tag === 'BILLORMT' ? ' and single tenant' : '') + ' by the user' };
      else if (confirmed('billing_model') || P.payments) r = { a: 'YES' };
      else r = { a: 'CONDITIONAL', b: 'billing_model not yet confirmed' };
    } else if (tag === 'AI') {
      if (!P.activation.FULL_PRODUCTION_PROFILE) r = { a: 'NO', b: 'FULL_PRODUCTION_PROFILE not active' };
      else if (confirmed('ai_native_scope') === 'NO') r = { a: 'NO', b: 'ai_native_scope confirmed NO by the user' };
      else if (confirmed('ai_native_scope') === 'YES' || P.ai_native) r = { a: 'YES' };
      else r = { a: 'CONDITIONAL', b: 'ai_native_scope not yet confirmed' };
    }
    if (r && r.a === 'NO') return { applicable: 'NO', basis: r.b };
    if (r && r.a === 'CONDITIONAL') { out.applicable = 'CONDITIONAL'; out.basis = r.b; }
  }
  return out;
}

const catalog = { items: ITEMS, byId, dependentsOf, validValue, dimensions: DIMENSIONS, archetypes: ARCHETYPES };

module.exports = { DIMENSIONS, ARCHETYPES, ITEMS, byId, dependentsOf, validValue, applicability, catalog };
