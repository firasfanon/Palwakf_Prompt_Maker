'use strict';

/**
 * Full Production Requirement Registry (RequirementRegistry).
 *
 * Each rule: { id, domain, description, severity: 'REQUIRED' | 'OPTIONAL',
 * anchors: string[], applies_when(profileIds, intent) => bool }.
 *
 * COVERAGE POLICY (not "representative subset", not "exhaustive encyclopaedia"):
 * the registry holds the MINIMUM REAL rule for every Full-Production domain the
 * first spec asks for (see REQUIRED_FULL_PRODUCTION_DOMAINS below; a regression
 * test fails if any of them has no rule). Whether a rule applies to a given
 * project is decided ONLY by applies_when (real Applicability) — nothing here
 * is REQUIRED for every project except the few genuinely universal rules.
 * Growth is additive: new rules/domains are appended, existing IDs never change
 * meaning.
 *
 * `anchors` are the semantic hooks of a rule: words that MUST appear verbatim in
 * both the rule description and its acceptance criteria (acceptanceCriteriaLibrary).
 * tests/run.js enforces this, so a criterion can never be attached to a rule it
 * does not actually measure (ACCEPTANCE_SEMANTIC_MAPPING gate).
 *
 * Rule/domain counts are NOT written in prose anywhere: derive them from
 * RULES_REGISTRY (tests/run.js checks every doc against the live numbers).
 */

const RULES_REGISTRY_VERSION = '1.1';

function has(profileIds, id) {
  return profileIds.indexOf(id) !== -1;
}
function anyOf(p, ids) {
  return ids.some((id) => has(p, id));
}
function adv(i, key) {
  return (i && i.advanced && i.advanced[key]) || null;
}
function mentions(i, re) {
  const text = [i && i.project_goal, adv(i, 'integrations'), adv(i, 'payments'), adv(i, 'special_constraints')]
    .filter(Boolean).join(' ');
  return re.test(text);
}

// Profiles that persist business data (a database is part of the product).
const DATA_PROFILES = [
  'FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'BOOKING_SYSTEM', 'ECOMMERCE', 'WEB_SAAS',
  'ADMIN_DASHBOARD', 'INTERNAL_OPERATIONS_SYSTEM', 'GIS_SYSTEM', 'LEGAL_SYSTEM',
  'CONTENT_PLATFORM', 'RESEARCH_SYSTEM', 'DOCUMENT_INTELLIGENCE',
];
// Profiles that are installed/run on the user's device and have no server-side deployment of their own.
const CLIENT_ONLY = ['DESKTOP_APPLICATION', 'MOBILE_APPLICATION'];
const hasData = (p) => anyOf(p, DATA_PROFILES);
const serverSide = (p) => p.some((id) => CLIENT_ONLY.indexOf(id) === -1);
const dataAndServer = (p) => hasData(p) && serverSide(p);
const CRITICAL_OPS = ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'BOOKING_SYSTEM', 'API_SERVICE', 'WEB_SAAS', 'INTERNAL_OPERATIONS_SYSTEM'];

const RULES_REGISTRY = [
  // ---- PRODUCT_COMPLETENESS ----
  { id: 'PROD-001', domain: 'PRODUCT_COMPLETENESS', description: 'تدفقات مستخدم كاملة من البداية للنهاية (Create→Validate→Persist→Retrieve→Edit)', severity: 'REQUIRED', anchors: ['تدفق'], applies_when: () => true },
  { id: 'PROD-002', domain: 'PRODUCT_COMPLETENESS', description: 'حالات تحميل/فراغ/خطأ/نجاح لكل شاشة رئيسية', severity: 'REQUIRED', anchors: ['حالات', 'شاشة'], applies_when: (p) => !has(p, 'API_SERVICE') },

  // ---- ARCHITECTURE ----
  { id: 'ARCH-001', domain: 'ARCHITECTURE', description: 'فصل طبقات العرض عن منطق الأعمال عن الوصول للبيانات', severity: 'REQUIRED', anchors: ['فصل', 'طبقات'], applies_when: () => true },
  { id: 'ARCH-002', domain: 'ARCHITECTURE', description: 'عزل منطق الأعمال عن مزوّد البيانات (Ports & Adapters) لسهولة الاستبدال لاحقًا', severity: 'REQUIRED', anchors: ['Port', 'Adapter'], applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') || has(p, 'FINANCIAL_SYSTEM') },

  // ---- DATA / PERSISTENCE ----
  { id: 'DATA-001', domain: 'DATA', description: 'نموذج بيانات موثّق (كيانات وعلاقات)', severity: 'REQUIRED', anchors: ['كيانات'], applies_when: () => true },
  { id: 'DATA-002', domain: 'DATA', description: 'عزل بيانات كل مستأجر (Row Level Security أو مخطط منفصل)', severity: 'REQUIRED', anchors: ['مستأجر', 'Row Level Security'], applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') },
  { id: 'DATA-003', domain: 'DATA', description: 'سجل تدقيق غير قابل للتعديل للمعاملات المالية', severity: 'REQUIRED', anchors: ['تدقيق', 'غير قابل للتعديل'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },
  { id: 'DATA-004', domain: 'DATA', description: 'تخزين مكاني (Spatial) وفهرسة جغرافية', severity: 'REQUIRED', anchors: ['Spatial', 'فهرسة'], applies_when: (p) => has(p, 'GIS_SYSTEM') },

  // ---- MIGRATIONS / REFERENTIAL_INTEGRITY ----
  { id: 'MIG-001', domain: 'MIGRATIONS', description: 'كل تغيير في مخطط البيانات يتم عبر Migration مُرقَّم وله مسار تراجع (down)', severity: 'REQUIRED', anchors: ['Migration', 'down'], applies_when: dataAndServer },
  { id: 'REFI-001', domain: 'REFERENTIAL_INTEGRITY', description: 'سلامة مرجعية: كل علاقة بين الجداول مفتاح خارجي (Foreign Key) مُعرَّف بسلوك حذف مرتبط واضح', severity: 'REQUIRED', anchors: ['مفتاح خارجي', 'Foreign Key'], applies_when: dataAndServer },

  // ---- TRANSACTIONS / CONCURRENCY / IDEMPOTENCY ----
  { id: 'TXN-001', domain: 'TRANSACTIONS', description: 'العمليات متعددة الخطوات تُنفَّذ داخل معاملة قاعدة بيانات ذرية (Transaction)', severity: 'REQUIRED', anchors: ['ذرية', 'Transaction'], applies_when: (p) => anyOf(p, ['FINANCIAL_SYSTEM', 'ECOMMERCE', 'BOOKING_SYSTEM', 'INTERNAL_OPERATIONS_SYSTEM']) },
  { id: 'CONC-001', domain: 'CONCURRENCY', description: 'منع الكتابة المتزامنة المتعارضة (Lost Update) عبر قفل أو ترقيم نسخ (Optimistic Locking)', severity: 'REQUIRED', anchors: ['Lost Update', 'Optimistic Locking'], applies_when: (p) => anyOf(p, ['BOOKING_SYSTEM', 'FINANCIAL_SYSTEM', 'ECOMMERCE', 'INTERNAL_OPERATIONS_SYSTEM', 'MULTI_TENANT_SAAS']) },
  { id: 'IDEM-001', domain: 'IDEMPOTENCY', description: 'العمليات التي تغيّر الحالة أو تتضمن دفعًا قابلة لإعادة الإرسال بأمان عبر مفتاح Idempotency', severity: 'REQUIRED', anchors: ['Idempotency', 'إعادة'], applies_when: (p, i) => anyOf(p, ['FINANCIAL_SYSTEM', 'ECOMMERCE']) || !!adv(i, 'payments') },

  // ---- PRODUCT SECURITY / AUTHN / AUTHZ ----
  { id: 'VAL-001', domain: 'VALIDATION', description: 'تحقق من صحة كل مدخل قبل المعالجة أو الحفظ', severity: 'REQUIRED', anchors: ['تحقق', 'مدخل'], applies_when: () => true },
  { id: 'AUTH-001', domain: 'AUTHENTICATION', description: 'مصادقة المستخدمين', severity: 'REQUIRED', anchors: ['مصادقة'], applies_when: (p) => !has(p, 'PUBLIC_PORTAL') || has(p, 'ADMIN_DASHBOARD') },
  { id: 'AUTH-002', domain: 'AUTHORIZATION', description: 'صلاحيات قائمة على الأدوار (RBAC)', severity: 'REQUIRED', anchors: ['RBAC', 'الأدوار'], applies_when: (p) => has(p, 'ADMIN_DASHBOARD') || has(p, 'WEB_SAAS') || has(p, 'MULTI_TENANT_SAAS') || has(p, 'FINANCIAL_SYSTEM') },
  { id: 'AUTH-003', domain: 'AUTHORIZATION', description: 'صلاحيات أقوى ومراجعة مزدوجة للعمليات المالية الحساسة', severity: 'REQUIRED', anchors: ['مراجعة مزدوجة', 'مالية'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },
  { id: 'SEC-001', domain: 'SECURITY', description: 'عدم كشف أسرار (مفاتيح API) في الواجهة أو السجلات', severity: 'REQUIRED', anchors: ['أسرار', 'API'], applies_when: () => true },
  { id: 'SEC-002', domain: 'SECURITY', description: 'ضوابط حقن الأوامر (Prompt Injection) وعزل المحتوى غير الموثوق', severity: 'REQUIRED', anchors: ['Prompt Injection'], applies_when: (p) => has(p, 'AI_ASSISTANT') },
  { id: 'SEC-003', domain: 'SECURITY', description: 'تشفير البيانات الحساسة أثناء التخزين', severity: 'OPTIONAL', anchors: ['تشفير', 'الحساسة'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') || has(p, 'DOCUMENT_INTELLIGENCE') },
  { id: 'PRIV-001', domain: 'PRIVACY', description: 'سياسة واضحة لحساسية البيانات الموقعية/الشخصية', severity: 'REQUIRED', anchors: ['حساسية', 'سياسة'], applies_when: (p, i) => has(p, 'GIS_SYSTEM') || !!(i.advanced && i.advanced.data_sensitivity) },

  // ---- API / INTEGRATIONS / WEBHOOKS ----
  { id: 'API-001', domain: 'API_CONTRACTS', description: 'توثيق عقود الـAPI (مدخلات/مخرجات/أخطاء)', severity: 'REQUIRED', anchors: ['عقود', 'أخطاء'], applies_when: (p) => has(p, 'API_SERVICE') },
  { id: 'API-002', domain: 'INTEGRATIONS', description: 'معالجة فشل/إعادة محاولة/مهلة لأي تكامل خارجي', severity: 'REQUIRED', anchors: ['مهلة', 'إعادة محاولة'], applies_when: (p, i) => has(p, 'API_SERVICE') || !!(i.advanced && i.advanced.integrations) },
  { id: 'HOOK-001', domain: 'WEBHOOKS', description: 'استقبال Webhooks بالتحقق من التوقيع ومعالجة آمنة للتكرار وإعادة المحاولة', severity: 'REQUIRED', anchors: ['Webhook', 'التوقيع'], applies_when: (p, i) => mentions(i, /webhook|ويب\s?هوك|callback|إشعارات?\s+الدفع/i) || (has(p, 'ECOMMERCE') && !!adv(i, 'payments')) },

  // ---- PERFORMANCE / CACHING / INDEXING / LOAD ----
  { id: 'PERF-001', domain: 'PERFORMANCE', description: 'ترقيم صفحات/تحميل تدريجي للقوائم الطويلة', severity: 'OPTIONAL', anchors: ['ترقيم صفحات', 'قوائم'], applies_when: (p) => has(p, 'ADMIN_DASHBOARD') || has(p, 'ECOMMERCE') },
  { id: 'PERF-002', domain: 'PERFORMANCE', description: 'فهرسة مكانية فعّالة للاستعلامات الجغرافية', severity: 'REQUIRED', anchors: ['فهرسة مكانية'], applies_when: (p) => has(p, 'GIS_SYSTEM') },
  { id: 'CACHE-001', domain: 'CACHING', description: 'سياسة تخزين مؤقت (Cache) موثقة: ما يُخزَّن، المدة، وكيفية الإبطال', severity: 'OPTIONAL', anchors: ['Cache', 'الإبطال'], applies_when: (p) => anyOf(p, ['API_SERVICE', 'ECOMMERCE', 'CONTENT_PLATFORM', 'PUBLIC_PORTAL']) },
  { id: 'IDX-001', domain: 'INDEXING', description: 'فهارس قاعدة البيانات تغطي الاستعلامات الرئيسية والمفاتيح الخارجية', severity: 'OPTIONAL', anchors: ['فهارس', 'الاستعلامات الرئيسية'], applies_when: dataAndServer },
  { id: 'LOAD-001', domain: 'LOAD_TARGETS', description: 'أهداف حمل وأداء رقمية معرَّفة (عدد مستخدمين متزامنين، زمن استجابة مقبول)', severity: 'OPTIONAL', anchors: ['مستخدمين متزامنين', 'زمن استجابة'], applies_when: (p) => anyOf(p, ['API_SERVICE', 'WEB_SAAS', 'MULTI_TENANT_SAAS', 'ECOMMERCE', 'PUBLIC_PORTAL']) },

  // ---- OBSERVABILITY: logging / metrics / tracing / health / readiness / alerting ----
  { id: 'OBS-001', domain: 'OBSERVABILITY', description: 'تسجيل (Logging) أساسي للأخطاء والعمليات الحرجة', severity: 'REQUIRED', anchors: ['Logging', 'الحرجة'], applies_when: () => true },
  { id: 'OBS-002', domain: 'METRICS', description: 'مقاييس تشغيلية (Metrics): معدل الطلبات والأخطاء وزمن الاستجابة', severity: 'OPTIONAL', anchors: ['Metrics', 'معدل'], applies_when: serverSide },
  { id: 'OBS-003', domain: 'TRACING', description: 'تتبع الطلبات عبر المكوّنات (Tracing) بمعرّف ارتباط (Correlation ID)', severity: 'OPTIONAL', anchors: ['Tracing', 'Correlation ID'], applies_when: (p) => anyOf(p, ['API_SERVICE', 'MULTI_TENANT_SAAS', 'AI_ASSISTANT', 'INTERNAL_OPERATIONS_SYSTEM']) },
  { id: 'OBS-004', domain: 'HEALTH', description: 'نقطة فحص صحة (Health Check) تعكس حالة التطبيق وتبعياته الحرجة', severity: 'REQUIRED', anchors: ['Health Check'], applies_when: serverSide },
  { id: 'OBS-005', domain: 'READINESS', description: 'نقطة جاهزية (Readiness) تمنع توجيه الحركة قبل اكتمال التهيئة', severity: 'REQUIRED', anchors: ['Readiness', 'التهيئة'], applies_when: (p) => anyOf(p, CRITICAL_OPS) },
  { id: 'OBS-006', domain: 'ALERTING', description: 'تنبيهات (Alerting) على أعطال الخدمة وارتفاع الأخطاء مع مسؤول محدد', severity: 'REQUIRED', anchors: ['Alerting', 'مسؤول'], applies_when: (p) => anyOf(p, ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'API_SERVICE', 'WEB_SAAS', 'BOOKING_SYSTEM', 'ECOMMERCE']) },

  // ---- RELIABILITY / DEGRADED_MODE / RECOVERY ----
  { id: 'REL-001', domain: 'RELIABILITY', description: 'استمرار معالجة بقية العناصر عند فشل عنصر واحد (بدل توقف كامل)', severity: 'OPTIONAL', anchors: ['بقية العناصر', 'فشل عنصر'], applies_when: (p) => has(p, 'DOCUMENT_INTELLIGENCE') },
  { id: 'DEG-001', domain: 'DEGRADED_MODE', description: 'سلوك وضع متدهور (Degraded Mode) واضح عند تعطل تبعية غير حرجة بدل الفشل الكامل', severity: 'REQUIRED', anchors: ['Degraded Mode', 'تبعية'], applies_when: (p, i) => anyOf(p, ['AI_ASSISTANT', 'API_SERVICE']) || !!adv(i, 'integrations') || !!adv(i, 'payments') },
  { id: 'REC-001', domain: 'RECOVERY', description: 'إجراء تعافٍ موثق بعد الأعطال (إعادة التشغيل، استعادة الحالة، التحقق من سلامة البيانات)', severity: 'REQUIRED', anchors: ['تعافٍ', 'سلامة البيانات'], applies_when: (p) => anyOf(p, CRITICAL_OPS) },

  // ---- BACKUP_RESTORE / RPO / RTO ----
  { id: 'BAK-001', domain: 'BACKUP_RESTORE', description: 'استراتيجية نسخ احتياطي للبيانات', severity: 'REQUIRED', anchors: ['نسخ احتياطي'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') || has(p, 'MULTI_TENANT_SAAS') },
  { id: 'BAK-004', domain: 'BACKUP_RESTORE', description: 'اختبار استعادة فعلي من نسخة احتياطية والتحقق من اكتمال البيانات', severity: 'REQUIRED', anchors: ['استعادة', 'نسخة احتياطية'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') || has(p, 'MULTI_TENANT_SAAS') },
  { id: 'BAK-002', domain: 'RPO', description: 'تحديد هدف نقطة التعافي (RPO): أقصى فقدان بيانات مقبول', severity: 'REQUIRED', anchors: ['RPO', 'فقدان بيانات'], applies_when: (p) => anyOf(p, ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'BOOKING_SYSTEM', 'LEGAL_SYSTEM']) },
  { id: 'BAK-003', domain: 'RTO', description: 'تحديد هدف زمن التعافي (RTO): أقصى زمن توقف مقبول', severity: 'REQUIRED', anchors: ['RTO', 'زمن توقف'], applies_when: (p) => anyOf(p, ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'BOOKING_SYSTEM', 'LEGAL_SYSTEM']) },

  // ---- TESTING: unit / tenant / booking / eval / financial / database / integration / security / regression ----
  { id: 'TEST-001', domain: 'TESTING', description: 'اختبارات وحدة للمنطق الحرج', severity: 'REQUIRED', anchors: ['اختبارات وحدة', 'منطق'], applies_when: () => true },
  { id: 'TEST-002', domain: 'TESTING', description: 'اختبار عزل المستأجرين (لا تسرّب بيانات بين مستأجرين)', severity: 'REQUIRED', anchors: ['مستأجر', 'بين مستأجرين'], applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') },
  { id: 'TEST-003', domain: 'TESTING', description: 'منع الحجز المزدوج لنفس الموعد/المورد', severity: 'REQUIRED', anchors: ['الحجز المزدوج'], applies_when: (p) => has(p, 'BOOKING_SYSTEM') },
  { id: 'TEST-004', domain: 'TESTING', description: 'مجموعة تقييم ثابتة (Golden Eval Set) لجودة إجابات المساعد', severity: 'REQUIRED', anchors: ['Golden Eval Set', 'إجابات'], applies_when: (p) => has(p, 'AI_ASSISTANT') },
  { id: 'TEST-005', domain: 'TESTING', description: 'اختبار صحة الحسابات المالية', severity: 'REQUIRED', anchors: ['الحسابات المالية'], applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },
  { id: 'DBT-001', domain: 'DATABASE_TESTING', description: 'اختبار قاعدة البيانات الفعلية: القيود والفهارس والمعاملات والترحيلات على محرك حقيقي', severity: 'REQUIRED', anchors: ['القيود', 'محرك حقيقي'], applies_when: dataAndServer },
  { id: 'ITEST-001', domain: 'INTEGRATION_TESTING', description: 'اختبارات تكامل تمر عبر المكوّنات الحقيقية (API ← منطق ← قاعدة بيانات) لكل رحلة حرجة', severity: 'REQUIRED', anchors: ['تكامل', 'رحلة حرجة'], applies_when: (p) => dataAndServer(p) || has(p, 'API_SERVICE') },
  { id: 'SECT-001', domain: 'SECURITY_TESTING', description: 'اختبار أمني: حقن، تجاوز صلاحيات، تعرض بيانات، وضعف الجلسات', severity: 'REQUIRED', anchors: ['تجاوز صلاحيات', 'حقن'], applies_when: (p, i) => !!adv(i, 'authentication') || anyOf(p, ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'LEGAL_SYSTEM', 'AI_ASSISTANT', 'ADMIN_DASHBOARD', 'WEB_SAAS']) },
  { id: 'REGT-001', domain: 'REGRESSION_TESTING', description: 'مجموعة اختبارات انحدار (Regression) تُنفَّذ كاملة قبل كل إصدار', severity: 'REQUIRED', anchors: ['Regression', 'قبل كل إصدار'], applies_when: (p, i) => hasData(p) || has(p, 'API_SERVICE') || !!adv(i, 'authentication') },

  // ---- BROWSER_UAT ----
  { id: 'UAT-001', domain: 'BROWSER_UAT', description: 'اختبار الرحلة الكاملة على سطح المكتب', severity: 'REQUIRED', anchors: ['سطح المكتب', 'الرحلة'], applies_when: (p) => !has(p, 'API_SERVICE') },
  { id: 'UAT-002', domain: 'BROWSER_UAT', description: 'اختبار الواجهة على عرض 390px (جوال)', severity: 'REQUIRED', anchors: ['390px', 'جوال'], applies_when: (p) => !has(p, 'API_SERVICE') && !has(p, 'INTERNAL_OPERATIONS_SYSTEM') },
  { id: 'UAT-003', domain: 'BROWSER_UAT', description: 'اختبار قائمة أجهزة/مقاسات شاشة متعددة', severity: 'REQUIRED', anchors: ['أجهزة', 'مقاسات'], applies_when: (p) => has(p, 'MOBILE_APPLICATION') },

  // ---- UX / ACCESSIBILITY ----
  { id: 'A11Y-001', domain: 'UX', description: 'تباين ألوان كافٍ وتسميات واضحة لكل حقل', severity: 'REQUIRED', anchors: ['تباين', 'تسميات'], applies_when: (p) => !has(p, 'API_SERVICE') },
  { id: 'A11Y-002', domain: 'UX', description: 'دعم اتجاه RTL/LTR صحيح عبر خصائص CSS المنطقية', severity: 'OPTIONAL', anchors: ['RTL', 'CSS'], applies_when: (p, i) => !!(i.advanced && i.advanced.languages) },

  // ---- CI_CD / ENVIRONMENT_SEPARATION / RELEASE / ROLLBACK ----
  { id: 'CICD-001', domain: 'CI_CD', description: 'بناء آلي قبل أي نشر', severity: 'OPTIONAL', anchors: ['بناء آلي', 'نشر'], applies_when: () => true },
  { id: 'ENV-001', domain: 'ENVIRONMENT_SEPARATION', description: 'فصل بيئات التطوير والاختبار والإنتاج (بيانات وأسرار وصلاحيات منفصلة)', severity: 'REQUIRED', anchors: ['الإنتاج', 'أسرار'], applies_when: serverSide },
  { id: 'RLS-001', domain: 'RELEASE', description: 'إجراء إصدار موثق بإصدارات مُرقَّمة وقائمة تحقق قبل النشر', severity: 'REQUIRED', anchors: ['إصدارات', 'قائمة تحقق'], applies_when: serverSide },
  { id: 'RBK-001', domain: 'ROLLBACK', description: 'استراتيجية تراجع (Rollback) عن الإصدار: العودة لإصدار سابق سليم خلال زمن محدد', severity: 'REQUIRED', anchors: ['Rollback', 'إصدار سابق'], applies_when: serverSide },
  { id: 'RBK-002', domain: 'ROLLBACK', description: 'تراجع آمن عن تغييرات البيانات عند فشل إصدار يتضمن Migration', severity: 'REQUIRED', anchors: ['Migration', 'تغييرات البيانات'], applies_when: dataAndServer },

  // ---- OPERATIONS: runbooks / incidents / supportability / production evidence ----
  { id: 'RUN-001', domain: 'RUNBOOKS', description: 'أدلة تشغيل (Runbooks) للمهام والأعطال المتكررة', severity: 'REQUIRED', anchors: ['Runbook', 'الأعطال'], applies_when: (p) => anyOf(p, CRITICAL_OPS) },
  { id: 'INC-001', domain: 'INCIDENT_RESPONSE', description: 'خطة استجابة للحوادث: تصنيف الشدة، المسؤولون، قنوات التواصل، مراجعة ما بعد الحادث', severity: 'REQUIRED', anchors: ['حوادث', 'تصنيف الشدة'], applies_when: (p) => anyOf(p, ['FINANCIAL_SYSTEM', 'MULTI_TENANT_SAAS', 'LEGAL_SYSTEM', 'WEB_SAAS', 'API_SERVICE']) },
  { id: 'SUP-001', domain: 'SUPPORTABILITY', description: 'قابلية الدعم: سجلات قابلة للبحث ومعرفات أخطاء يمكن للمستخدم الإبلاغ بها', severity: 'OPTIONAL', anchors: ['سجلات', 'معرفات أخطاء'], applies_when: (p) => anyOf(p, ['WEB_SAAS', 'MULTI_TENANT_SAAS', 'ECOMMERCE', 'PUBLIC_PORTAL', 'BOOKING_SYSTEM', 'FINANCIAL_SYSTEM', 'API_SERVICE', 'INTERNAL_OPERATIONS_SYSTEM', 'ADMIN_DASHBOARD']) },
  { id: 'PEV-001', domain: 'PRODUCTION_EVIDENCE', description: 'حزمة أدلة إنتاج: أدلة فعلية لكل بوابة قبول قبل أي ادعاء جاهزية', severity: 'REQUIRED', anchors: ['أدلة', 'بوابة قبول'], applies_when: serverSide },

  // ---- DOCUMENTATION ----
  { id: 'DOC-001', domain: 'DOCUMENTATION', description: 'README يشرح التشغيل المحلي والنشر', severity: 'REQUIRED', anchors: ['README', 'التشغيل المحلي'], applies_when: () => true },
];

/**
 * Domains the first spec explicitly requires coverage for. A regression test
 * (FULL_PRODUCTION_RULE_COVERAGE_TEST) fails if any of these has no rule.
 */
const REQUIRED_FULL_PRODUCTION_DOMAINS = [
  'MIGRATIONS', 'REFERENTIAL_INTEGRITY',
  'TRANSACTIONS', 'CONCURRENCY', 'IDEMPOTENCY',
  'CACHING', 'INDEXING', 'LOAD_TARGETS',
  'WEBHOOKS',
  'METRICS', 'TRACING', 'HEALTH', 'READINESS', 'ALERTING',
  'DEGRADED_MODE', 'RECOVERY',
  'BACKUP_RESTORE', 'RPO', 'RTO',
  'DATABASE_TESTING', 'INTEGRATION_TESTING', 'SECURITY_TESTING', 'REGRESSION_TESTING',
  'ENVIRONMENT_SEPARATION', 'RELEASE', 'ROLLBACK',
  'RUNBOOKS', 'INCIDENT_RESPONSE', 'SUPPORTABILITY', 'PRODUCTION_EVIDENCE',
];

/**
 * Which Blueprint section each domain feeds. A regression test asserts every
 * domain in the registry lands in at least one named section, so no rule can
 * be silently dropped from the Blueprint (and therefore from the Master Prompt).
 */
const BLUEPRINT_SECTION_DOMAINS = {
  functional_requirements: ['PRODUCT_COMPLETENESS'],
  architecture_requirements: ['ARCHITECTURE'],
  validation_requirements: ['VALIDATION'],
  data_strategy: ['DATA', 'MIGRATIONS', 'REFERENTIAL_INTEGRITY', 'TRANSACTIONS', 'CONCURRENCY', 'IDEMPOTENCY'],
  persistence_strategy: ['DATA', 'BACKUP_RESTORE'],
  security_profile: ['SECURITY', 'AUTHENTICATION', 'AUTHORIZATION'],
  privacy_profile: ['PRIVACY'],
  integration_strategy: ['INTEGRATIONS', 'API_CONTRACTS', 'WEBHOOKS'],
  ux_requirements: ['UX'],
  performance_requirements: ['PERFORMANCE', 'CACHING', 'INDEXING', 'LOAD_TARGETS'],
  reliability_requirements: ['RELIABILITY', 'DEGRADED_MODE', 'RECOVERY'],
  observability_requirements: ['OBSERVABILITY', 'METRICS', 'TRACING', 'HEALTH', 'READINESS', 'ALERTING'],
  backup_restore_requirements: ['BACKUP_RESTORE', 'RPO', 'RTO'],
  rollback_requirements: ['ROLLBACK'],
  test_strategy: ['TESTING', 'DATABASE_TESTING', 'INTEGRATION_TESTING', 'SECURITY_TESTING', 'REGRESSION_TESTING'],
  browser_uat_strategy: ['BROWSER_UAT'],
  release_strategy: ['CI_CD', 'ENVIRONMENT_SEPARATION', 'RELEASE'],
  operations_requirements: ['RUNBOOKS', 'INCIDENT_RESPONSE', 'SUPPORTABILITY', 'PRODUCTION_EVIDENCE'],
  documentation_requirements: ['DOCUMENTATION'],
};

function getApplicableRules(profileIds, intent) {
  return RULES_REGISTRY.filter((rule) => {
    try {
      return rule.applies_when(profileIds, intent);
    } catch (e) {
      return false;
    }
  });
}

module.exports = {
  RULES_REGISTRY_VERSION,
  RULES_REGISTRY,
  REQUIRED_FULL_PRODUCTION_DOMAINS,
  BLUEPRINT_SECTION_DOMAINS,
  getApplicableRules,
};
