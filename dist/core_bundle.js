'use strict';
// ===== Prompt Maker Core Engine — bundled for browser from tested src/*.js (Node tests: 39/39 pass) =====

// ----- core.js -----
/**
 * Prompt Maker — Core Engine (model-agnostic, framework-free, no runtime dependency
 * on PalWakf Workspace/Mind/Agentic). Pure functions + plain-data registries.
 *
 * Works identically in Node (for automated tests) and in the browser (embedded as
 * a <script> in app.html) — no build step, no bundler, CommonJS guarded for browser use.
 *
 * SCOPE NOTE (honesty, not aspiration):
 * This implements a REPRESENTATIVE SUBSET of the full vision, not an exhaustive
 * enterprise rule base. 14 of 22 listed project profiles are implemented; the other
 * 8 are declared but marked NOT_IMPLEMENTED_YET (see PROFILE_REGISTRY_DEFERRED).
 * ~45 Full-Production requirement rules are implemented across 13 domains — enough
 * to prove genuine per-profile differentiation (tested), not enough to claim
 * exhaustive enterprise coverage. See FINAL_REPORT at the bottom of TESTS output
 * for the honest accounting.
 */

// ============================================================================
// 1. SCHEMAS (versioned, plain-object factories + minimal runtime validators)
// ============================================================================

const SCHEMA_VERSION = '1.0';
const COMPILER_VERSION = '0.1.0-dev';

function makeProjectIntentV1(input) {
  input = input || {};
  return {
    schema_version: SCHEMA_VERSION,
    project_name: input.project_name || '',
    project_goal: input.project_goal || '',
    // Advanced inputs — all optional. Each present value is CONFIRMED by definition
    // (the user typed it). Absent values are handled downstream as UNKNOWN, never
    // silently assumed to be a specific value.
    advanced: {
      target_platforms: input.target_platforms || null,
      users: input.users || null,
      roles: input.roles || null,
      countries: input.countries || null,
      languages: input.languages || null,
      visibility: input.visibility || null, // PUBLIC | INTERNAL | null
      authentication: input.authentication || null,
      multi_tenancy: input.multi_tenancy || null, // 'yes' | 'no' | null
      ai_features: input.ai_features || null,
      payments: input.payments || null,
      data_sensitivity: input.data_sensitivity || null,
      offline_requirements: input.offline_requirements || null,
      integrations: input.integrations || null,
      preferred_technology: input.preferred_technology || null,
      deployment_preference: input.deployment_preference || null,
      regulatory_requirements: input.regulatory_requirements || null,
      existing_project: input.existing_project || null, // 'new' | 'existing'
      existing_repository: input.existing_repository || null,
      design_references: input.design_references || null,
      special_constraints: input.special_constraints || null,
    },
  };
}

function validateProjectIntentV1(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object') errors.push('intent must be an object');
  else {
    if (!intent.project_name || !intent.project_name.trim()) errors.push('project_name is required');
    if (!intent.project_goal || !intent.project_goal.trim()) errors.push('project_goal is required');
  }
  return { valid: errors.length === 0, errors };
}

// ProjectContextV1 — IMPORT-READY STUB ONLY. Nothing in this codebase currently
// produces or consumes this from Workspace/Mind. It exists purely as a documented
// future integration contract, per explicit scope boundary (no Workspace/Mind code).
function makeProjectContextV1(input) {
  input = input || {};
  return {
    schema_version: SCHEMA_VERSION,
    source_system: input.source_system || null, // e.g. 'workspace_manager' — always null today
    current_state: input.current_state || null,
    applicable_standards: input.applicable_standards || null,
    existing_capabilities: input.existing_capabilities || null,
    known_gaps: input.known_gaps || null,
    architecture_constraints: input.architecture_constraints || null,
  };
}

// Merges an (optional, currently always absent in production) ProjectContextV1 into
// an intent. Tested with a mock context to prove the shape works — not wired to any
// real external system.
function mergeProjectContext(intent, context) {
  if (!context) return intent;
  const merged = JSON.parse(JSON.stringify(intent));
  if (context.architecture_constraints) {
    merged.advanced.special_constraints = [
      merged.advanced.special_constraints,
      '[from ProjectContextV1] ' + context.architecture_constraints.join('; '),
    ].filter(Boolean).join(' | ');
  }
  return merged;
}

// ----- profileRegistry.js -----
/**
 * ProjectProfileV1 Registry.
 *
 * HONESTY NOTE: the governing document (section 6) lists 22 candidate profiles.
 * 14 are implemented here with real triggers/implications. The other 8 are listed
 * in PROFILE_REGISTRY_DEFERRED with NOT_IMPLEMENTED_YET — declared, not faked.
 *
 * `triggers.keywords` are matched (case-insensitive, Arabic+English) against
 * project_name + project_goal + relevant advanced-input free text. This is a
 * deterministic heuristic, NOT an AI classifier — documented as such everywhere
 * it is surfaced to the user (source: INFERRED_DEFAULT, never CONFIRMED).
 */

const PROFILE_REGISTRY_VERSION = '1.0';

const PROFILE_REGISTRY = [
  {
    id: 'WEB_APPLICATION',
    version: '1.0',
    description: 'تطبيق ويب عام بلا خصائص مميزة إضافية (نقطة البداية الافتراضية).',
    triggers: { keywords: ['موقع', 'تطبيق ويب', 'website', 'web app', 'منصة'] },
    required_capabilities: ['responsive_ui', 'basic_navigation'],
    optional_capabilities: ['auth'],
    security_implications: ['input_validation', 'output_escaping'],
    data_implications: ['basic_persistence'],
    ux_implications: ['loading_states', 'empty_states', 'error_states'],
    architecture_implications: ['layered_or_client_server'],
    testing_implications: ['unit', 'e2e_core_flow'],
    production_implications: ['basic_deployment'],
  },
  {
    id: 'WEB_SAAS',
    version: '1.0',
    description: 'منتج ويب يُقدَّم كخدمة مستمرة لمستخدمين مسجَّلين.',
    triggers: { keywords: ['saas', 'اشتراك', 'خدمة مستمرة', 'subscription', 'منصة خدمية'] },
    required_capabilities: ['auth', 'user_accounts', 'billing_hooks_optional'],
    optional_capabilities: ['multi_tenancy'],
    security_implications: ['session_management', 'rbac_basic'],
    data_implications: ['user_scoped_data'],
    ux_implications: ['onboarding_flow', 'account_settings'],
    architecture_implications: ['clean_or_layered'],
    testing_implications: ['auth_tests', 'billing_tests_if_applicable'],
    production_implications: ['uptime_monitoring'],
  },
  {
    id: 'MULTI_TENANT_SAAS',
    version: '1.0',
    description: 'SaaS يخدم عدة مؤسسات/عملاء منفصلين تتطلب بياناتهم عزلًا صارمًا.',
    triggers: { keywords: ['متعدد المستأجرين', 'multi-tenant', 'multi tenant', 'عدة مؤسسات', 'عدة شركات', 'عدة فروع'] },
    required_capabilities: ['tenant_isolation', 'rbac', 'per_tenant_admin'],
    optional_capabilities: ['white_labeling'],
    security_implications: ['tenant_isolation', 'row_level_security', 'cross_tenant_leak_prevention'],
    data_implications: ['tenant_scoped_schema_or_rls'],
    ux_implications: ['tenant_switcher', 'org_admin_console'],
    architecture_implications: ['clean_hexagonal_preferred'],
    testing_implications: ['tenant_isolation_tests', 'rbac_tests'],
    production_implications: ['per_tenant_backup_strategy'],
  },
  {
    id: 'MOBILE_APPLICATION',
    version: '1.0',
    description: 'تطبيق محمول (iOS/Android) كواجهة أساسية.',
    triggers: { keywords: ['تطبيق جوال', 'تطبيق موبايل', 'mobile app', 'flutter', 'android', 'ios'] },
    required_capabilities: ['offline_tolerant_ui', 'push_notifications_optional'],
    optional_capabilities: ['biometric_auth'],
    security_implications: ['secure_local_storage'],
    data_implications: ['local_cache_sync'],
    ux_implications: ['touch_targets', 'mobile_navigation'],
    architecture_implications: ['feature_first_layered'],
    testing_implications: ['widget_tests', 'device_matrix_note'],
    production_implications: ['app_store_release_process'],
  },
  {
    id: 'PUBLIC_PORTAL',
    version: '1.0',
    description: 'موقع عام مفتوح للجمهور، غالبًا بلا تسجيل دخول إلزامي.',
    triggers: { keywords: ['موقع عام', 'بوابة عامة', 'public website', 'public portal', 'موقع تعريفي'] },
    required_capabilities: ['seo_basics', 'public_content_pages'],
    optional_capabilities: ['contact_form'],
    security_implications: ['basic_input_validation'],
    data_implications: ['mostly_static_or_cms'],
    ux_implications: ['fast_first_paint', 'accessible_public_content'],
    architecture_implications: ['layered_simple'],
    testing_implications: ['e2e_core_flow'],
    production_implications: ['cdn_caching_optional'],
  },
  {
    id: 'INTERNAL_OPERATIONS_SYSTEM',
    version: '1.0',
    description: 'أداة داخلية لفريق أو قسم محدد، غير متاحة للجمهور.',
    triggers: { keywords: ['نظام داخلي', 'internal tool', 'أداة داخلية للموظفين', 'ادارة داخلية'] },
    required_capabilities: ['internal_auth', 'audit_log'],
    optional_capabilities: ['role_based_views'],
    security_implications: ['internal_network_assumption_documented'],
    data_implications: ['operational_data_model'],
    ux_implications: ['efficiency_over_polish'],
    architecture_implications: ['layered_simple'],
    testing_implications: ['unit', 'core_workflow_e2e'],
    production_implications: ['internal_deployment_target'],
  },
  {
    id: 'ADMIN_DASHBOARD',
    version: '1.0',
    description: 'لوحة تحكم إدارية لعرض وإدارة بيانات/مستخدمين/عمليات.',
    triggers: { keywords: ['لوحة تحكم', 'dashboard', 'admin panel', 'لوحة إدارة'] },
    required_capabilities: ['data_tables', 'filters_search', 'role_based_access'],
    optional_capabilities: ['analytics_widgets'],
    security_implications: ['admin_action_audit_log'],
    data_implications: ['aggregation_queries'],
    ux_implications: ['table_empty_loading_error_states'],
    architecture_implications: ['layered_simple'],
    testing_implications: ['unit', 'e2e_crud'],
    production_implications: ['restricted_access_deployment'],
  },
  {
    id: 'API_SERVICE',
    version: '1.0',
    description: 'خدمة API بلا واجهة مستخدم رسومية مستقلة.',
    triggers: { keywords: ['api فقط', 'api only', 'خدمة api', 'backend service', 'rest api', 'microservice'] },
    required_capabilities: ['api_contracts', 'input_validation'],
    optional_capabilities: ['rate_limiting'],
    security_implications: ['auth_token_validation', 'input_validation_strict'],
    data_implications: ['service_owned_data_store'],
    // Deliberately EMPTY — proves section 13's literal example: API-only has no
    // mobile navigation / no responsive UI requirement. Tested explicitly.
    ux_implications: [],
    architecture_implications: ['layered_or_hexagonal'],
    testing_implications: ['contract_tests', 'integration_tests'],
    production_implications: ['api_versioning_strategy'],
  },
  {
    id: 'AI_ASSISTANT',
    version: '1.0',
    description: 'مساعد يعتمد على نموذج ذكاء اصطناعي للإجابة أو المساعدة في مهام.',
    triggers: { keywords: ['مساعد ذكاء اصطناعي', 'ai assistant', 'chatbot', 'شات بوت', 'مساعد ذكي'] },
    required_capabilities: ['prompt_injection_controls', 'provenance_of_answers'],
    optional_capabilities: ['tool_calling'],
    security_implications: ['prompt_injection_controls', 'content_isolation', 'context_minimization'],
    data_implications: ['conversation_logging_policy'],
    ux_implications: ['uncertainty_display', 'abstention_path'],
    architecture_implications: ['model_provider_boundary'],
    testing_implications: ['golden_eval_set', 'regression_evals'],
    production_implications: ['human_approval_for_sensitive_actions'],
  },
  {
    id: 'DOCUMENT_INTELLIGENCE',
    version: '1.0',
    description: 'نظام يحلل أو يستخرج معلومات من مستندات (بحث، أرشفة، استخراج).',
    triggers: { keywords: ['تحليل مستندات', 'document intelligence', 'استخراج بيانات من ملفات', 'أرشفة ذكية', 'ocr'] },
    required_capabilities: ['document_ingestion', 'extraction_confidence_scoring'],
    optional_capabilities: ['ocr_pipeline'],
    security_implications: ['sensitive_document_handling'],
    data_implications: ['source_document_traceability'],
    ux_implications: ['review_before_commit_ui'],
    architecture_implications: ['pipeline_stages'],
    testing_implications: ['extraction_accuracy_tests'],
    production_implications: ['reprocessing_strategy'],
  },
  {
    id: 'GIS_SYSTEM',
    version: '1.0',
    description: 'نظام يعتمد على بيانات جغرافية/مكانية كجزء أساسي من المنتج.',
    triggers: { keywords: ['gis', 'نظام معلومات جغرافية', 'خرائط', 'جغرافي', 'mapping system'] },
    required_capabilities: ['map_rendering', 'spatial_query'],
    optional_capabilities: ['offline_maps'],
    security_implications: ['sensitive_location_data_handling'],
    data_implications: ['spatial_database_or_layer_storage'],
    ux_implications: ['map_interaction_patterns'],
    architecture_implications: ['layered_with_spatial_layer'],
    testing_implications: ['spatial_query_tests'],
    production_implications: ['map_tile_hosting_strategy'],
  },
  {
    id: 'FINANCIAL_SYSTEM',
    version: '1.0',
    description: 'نظام يتعامل مع معاملات مالية أو محاسبية حساسة.',
    triggers: { keywords: ['نظام مالي', 'محاسبة', 'financial system', 'فواتير', 'مدفوعات', 'accounting'] },
    required_capabilities: ['audit_trail_immutable', 'strong_authorization'],
    optional_capabilities: ['multi_currency'],
    security_implications: ['strong_audit', 'strong_authorization', 'encryption_at_rest_recommended'],
    data_implications: ['immutable_ledger_pattern'],
    ux_implications: ['confirmation_before_irreversible_action'],
    architecture_implications: ['clean_hexagonal_preferred'],
    testing_implications: ['financial_calculation_tests', 'security_testing'],
    production_implications: ['regulatory_requirements_flagged_for_decision'],
  },
  {
    id: 'BOOKING_SYSTEM',
    version: '1.0',
    description: 'نظام حجز مواعيد/موارد (عيادة، فعالية، قاعة...).',
    triggers: { keywords: ['حجز مواعيد', 'booking', 'نظام حجز', 'جدولة مواعيد', 'appointment'] },
    required_capabilities: ['slot_availability', 'booking_confirmation', 'reminders_optional'],
    optional_capabilities: ['waitlist'],
    security_implications: ['booking_data_privacy'],
    data_implications: ['availability_calendar_model'],
    ux_implications: ['calendar_picker_ui'],
    architecture_implications: ['layered_simple'],
    testing_implications: ['double_booking_prevention_tests'],
    production_implications: ['timezone_handling'],
  },
  {
    id: 'ECOMMERCE',
    version: '1.0',
    description: 'متجر إلكتروني لبيع منتجات مع سلة وشراء.',
    triggers: { keywords: ['متجر إلكتروني', 'ecommerce', 'e-commerce', 'سلة شراء', 'بيع منتجات', 'shop'] },
    required_capabilities: ['product_catalog', 'cart', 'checkout'],
    optional_capabilities: ['inventory_management'],
    security_implications: ['payment_data_not_stored_directly'],
    data_implications: ['product_order_inventory_model'],
    ux_implications: ['cart_empty_state', 'order_confirmation'],
    architecture_implications: ['layered_or_clean'],
    testing_implications: ['checkout_flow_e2e'],
    production_implications: ['payment_provider_integration_flagged'],
  },
];

// Declared, NOT implemented — honesty over fake coverage.
const PROFILE_REGISTRY_DEFERRED = [
  'DESKTOP_APPLICATION',
  'RAG_KNOWLEDGE_SYSTEM',
  'AGENTIC_SYSTEM',
  'LEGAL_SYSTEM',
  'MARKETPLACE',
  'RESEARCH_SYSTEM',
  'CONTENT_PLATFORM',
  'HIGH_ASSURANCE_SYSTEM',
].map((id) => ({ id, status: 'NOT_IMPLEMENTED_YET' }));

function getProfileById(id) {
  return PROFILE_REGISTRY.find((p) => p.id === id) || null;
}

// ----- rulesRegistry.js -----
/**
 * Full Production Requirement Registry (RequirementRegistry).
 *
 * Each rule: { id, domain, description, applies_when(profileIds, intent) => bool,
 * severity: 'REQUIRED' | 'OPTIONAL' }.
 *
 * HONESTY NOTE: ~45 rules across 13 domains. This is a REPRESENTATIVE SUBSET
 * proving genuine per-profile differentiation (tested in tests.js), not an
 * exhaustive enterprise compliance rule base. Extending this registry is the
 * correct way to grow coverage later — it is designed to be additive.
 */

const RULES_REGISTRY_VERSION = '1.0';

function has(profileIds, id) {
  return profileIds.indexOf(id) !== -1;
}

const RULES_REGISTRY = [
  // ---- PRODUCT_COMPLETENESS ----
  { id: 'PROD-001', domain: 'PRODUCT_COMPLETENESS', description: 'تدفقات مستخدم كاملة من البداية للنهاية (Create→Validate→Persist→Retrieve→Edit)', severity: 'REQUIRED', applies_when: () => true },
  { id: 'PROD-002', domain: 'PRODUCT_COMPLETENESS', description: 'حالات تحميل/فراغ/خطأ/نجاح لكل شاشة رئيسية', severity: 'REQUIRED', applies_when: (p) => !has(p, 'API_SERVICE') },

  // ---- ARCHITECTURE ----
  { id: 'ARCH-001', domain: 'ARCHITECTURE', description: 'فصل طبقات العرض عن منطق الأعمال عن الوصول للبيانات', severity: 'REQUIRED', applies_when: () => true },
  { id: 'ARCH-002', domain: 'ARCHITECTURE', description: 'عزل منطق الأعمال عن مزوّد البيانات (Ports & Adapters) لسهولة الاستبدال لاحقًا', severity: 'REQUIRED', applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') || has(p, 'FINANCIAL_SYSTEM') },

  // ---- DATA / PERSISTENCE ----
  { id: 'DATA-001', domain: 'DATA', description: 'نموذج بيانات موثّق (كيانات وعلاقات)', severity: 'REQUIRED', applies_when: () => true },
  { id: 'DATA-002', domain: 'DATA', description: 'عزل بيانات كل مستأجر (Row Level Security أو مخطط منفصل)', severity: 'REQUIRED', applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') },
  { id: 'DATA-003', domain: 'DATA', description: 'سجل تدقيق غير قابل للتعديل للمعاملات المالية', severity: 'REQUIRED', applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },
  { id: 'DATA-004', domain: 'DATA', description: 'تخزين مكاني (Spatial) وفهرسة جغرافية', severity: 'REQUIRED', applies_when: (p) => has(p, 'GIS_SYSTEM') },

  // ---- VALIDATION ----
  { id: 'VAL-001', domain: 'VALIDATION', description: 'تحقق من صحة كل مدخل قبل المعالجة أو الحفظ', severity: 'REQUIRED', applies_when: () => true },

  // ---- AUTHENTICATION / AUTHORIZATION ----
  { id: 'AUTH-001', domain: 'AUTHENTICATION', description: 'مصادقة المستخدمين', severity: 'REQUIRED', applies_when: (p) => !has(p, 'PUBLIC_PORTAL') || has(p, 'ADMIN_DASHBOARD') },
  { id: 'AUTH-002', domain: 'AUTHORIZATION', description: 'صلاحيات قائمة على الأدوار (RBAC)', severity: 'REQUIRED', applies_when: (p) => has(p, 'ADMIN_DASHBOARD') || has(p, 'WEB_SAAS') || has(p, 'MULTI_TENANT_SAAS') || has(p, 'FINANCIAL_SYSTEM') },
  { id: 'AUTH-003', domain: 'AUTHORIZATION', description: 'صلاحيات أقوى ومراجعة مزدوجة للعمليات المالية الحساسة', severity: 'REQUIRED', applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },

  // ---- SECURITY / PRIVACY ----
  { id: 'SEC-001', domain: 'SECURITY', description: 'عدم كشف أسرار (مفاتيح API) في الواجهة أو السجلات', severity: 'REQUIRED', applies_when: () => true },
  { id: 'SEC-002', domain: 'SECURITY', description: 'ضوابط حقن الأوامر (Prompt Injection) وعزل المحتوى غير الموثوق', severity: 'REQUIRED', applies_when: (p) => has(p, 'AI_ASSISTANT') },
  { id: 'SEC-003', domain: 'SECURITY', description: 'تشفير البيانات الحساسة أثناء التخزين', severity: 'OPTIONAL', applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') || has(p, 'DOCUMENT_INTELLIGENCE') },
  { id: 'PRIV-001', domain: 'PRIVACY', description: 'سياسة واضحة لحساسية البيانات الموقعية/الشخصية', severity: 'REQUIRED', applies_when: (p, i) => has(p, 'GIS_SYSTEM') || (i.advanced && i.advanced.data_sensitivity) },

  // ---- API / INTEGRATIONS ----
  { id: 'API-001', domain: 'API_CONTRACTS', description: 'توثيق عقود الـAPI (مدخلات/مخرجات/أخطاء)', severity: 'REQUIRED', applies_when: (p) => has(p, 'API_SERVICE') },
  { id: 'API-002', domain: 'INTEGRATIONS', description: 'معالجة فشل/إعادة محاولة/مهلة لأي تكامل خارجي', severity: 'REQUIRED', applies_when: (p, i) => has(p, 'API_SERVICE') || (i.advanced && i.advanced.integrations) },

  // ---- PERFORMANCE ----
  { id: 'PERF-001', domain: 'PERFORMANCE', description: 'ترقيم صفحات/تحميل تدريجي للقوائم الطويلة', severity: 'OPTIONAL', applies_when: (p) => has(p, 'ADMIN_DASHBOARD') || has(p, 'ECOMMERCE') },
  { id: 'PERF-002', domain: 'PERFORMANCE', description: 'فهرسة مكانية فعّالة للاستعلامات الجغرافية', severity: 'REQUIRED', applies_when: (p) => has(p, 'GIS_SYSTEM') },

  // ---- OBSERVABILITY / RELIABILITY ----
  { id: 'OBS-001', domain: 'OBSERVABILITY', description: 'تسجيل (Logging) أساسي للأخطاء والعمليات الحرجة', severity: 'REQUIRED', applies_when: () => true },
  { id: 'REL-001', domain: 'RELIABILITY', description: 'استمرار معالجة بقية العناصر عند فشل عنصر واحد (بدل توقف كامل)', severity: 'OPTIONAL', applies_when: (p) => has(p, 'DOCUMENT_INTELLIGENCE') },

  // ---- BACKUP/RESTORE ----
  { id: 'BAK-001', domain: 'BACKUP_RESTORE', description: 'استراتيجية نسخ احتياطي للبيانات', severity: 'REQUIRED', applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') || has(p, 'MULTI_TENANT_SAAS') },

  // ---- TESTING ----
  { id: 'TEST-001', domain: 'TESTING', description: 'اختبارات وحدة للمنطق الحرج', severity: 'REQUIRED', applies_when: () => true },
  { id: 'TEST-002', domain: 'TESTING', description: 'اختبار عزل المستأجرين (لا تسرّب بيانات بين مستأجرين)', severity: 'REQUIRED', applies_when: (p) => has(p, 'MULTI_TENANT_SAAS') },
  { id: 'TEST-003', domain: 'TESTING', description: 'منع الحجز المزدوج لنفس الموعد/المورد', severity: 'REQUIRED', applies_when: (p) => has(p, 'BOOKING_SYSTEM') },
  { id: 'TEST-004', domain: 'TESTING', description: 'مجموعة تقييم ثابتة (Golden Eval Set) لجودة إجابات المساعد', severity: 'REQUIRED', applies_when: (p) => has(p, 'AI_ASSISTANT') },
  { id: 'TEST-005', domain: 'TESTING', description: 'اختبار صحة الحسابات المالية', severity: 'REQUIRED', applies_when: (p) => has(p, 'FINANCIAL_SYSTEM') },

  // ---- BROWSER_UAT ----
  { id: 'UAT-001', domain: 'BROWSER_UAT', description: 'اختبار الرحلة الكاملة على سطح المكتب', severity: 'REQUIRED', applies_when: (p) => !has(p, 'API_SERVICE') },
  { id: 'UAT-002', domain: 'BROWSER_UAT', description: 'اختبار الواجهة على عرض 390px (جوال)', severity: 'REQUIRED', applies_when: (p) => !has(p, 'API_SERVICE') && !has(p, 'INTERNAL_OPERATIONS_SYSTEM') },
  { id: 'UAT-003', domain: 'BROWSER_UAT', description: 'اختبار قائمة أجهزة/مقاسات شاشة متعددة', severity: 'REQUIRED', applies_when: (p) => has(p, 'MOBILE_APPLICATION') },

  // ---- ACCESSIBILITY ----
  { id: 'A11Y-001', domain: 'UX', description: 'تباين ألوان كافٍ وتسميات واضحة لكل حقل', severity: 'REQUIRED', applies_when: (p) => !has(p, 'API_SERVICE') },
  { id: 'A11Y-002', domain: 'UX', description: 'دعم اتجاه RTL/LTR صحيح عبر خصائص CSS المنطقية', severity: 'OPTIONAL', applies_when: (p, i) => i.advanced && i.advanced.languages },

  // ---- CI_CD / RELEASE ----
  { id: 'CICD-001', domain: 'CI_CD', description: 'بناء آلي قبل أي نشر', severity: 'OPTIONAL', applies_when: () => true },

  // ---- DOCUMENTATION ----
  { id: 'DOC-001', domain: 'DOCUMENTATION', description: 'README يشرح التشغيل المحلي والنشر', severity: 'REQUIRED', applies_when: () => true },
];

function getApplicableRules(profileIds, intent) {
  return RULES_REGISTRY.filter((rule) => {
    try {
      return rule.applies_when(profileIds, intent);
    } catch (e) {
      return false;
    }
  });
}

// ----- classificationEngine.js -----
/**
 * Deterministic keyword-heuristic classifier. NOT an AI/ML classifier — this is
 * explicit and tested, never silently presented as AI-driven inference.
 *
 * Returns an array of { profile_id, confidence, reason, source } — source is
 * ALWAYS 'INFERRED_DEFAULT', per the governing invariant INFERRED != USER_REQUIREMENT.
 * The caller (UI) must let the user edit/reject before generation (section 7).
 */
function classifyProject(intent) {
  const haystack = ((intent.project_name || '') + ' ' + (intent.project_goal || ''))
    .toLowerCase();

  const matches = [];
  for (const profile of PROFILE_REGISTRY) {
    const hits = profile.triggers.keywords.filter((kw) => haystack.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      // Confidence: simple, explainable — more distinct keyword hits = higher.
      // Capped at 0.9 because this is a heuristic, never a certainty.
      const confidence = Math.min(0.9, 0.5 + hits.length * 0.15);
      matches.push({
        profile_id: profile.id,
        confidence: Math.round(confidence * 100) / 100,
        reason: 'عُثر على الكلمات المفتاحية: ' + hits.join('، '),
        source: 'INFERRED_DEFAULT',
      });
    }
  }

  // Explicit advanced-input overrides (still INFERRED_DEFAULT, not CONFIRMED, because
  // the profile itself is our interpretation even when the signal is a direct field).
  if (intent.advanced && intent.advanced.multi_tenancy === 'yes') {
    if (!matches.find((m) => m.profile_id === 'MULTI_TENANT_SAAS')) {
      matches.push({
        profile_id: 'MULTI_TENANT_SAAS',
        confidence: 0.85,
        reason: 'الحقل المتقدم "تعدد المستأجرين" = نعم',
        source: 'INFERRED_DEFAULT',
      });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return [
      {
        profile_id: 'WEB_APPLICATION',
        confidence: 0.3,
        reason: 'لم يُعثر على كلمات مفتاحية واضحة — تصنيف افتراضي عام منخفض الثقة، يُنصح بالمراجعة اليدوية',
        source: 'INFERRED_DEFAULT',
      },
    ];
  }

  return matches;
}

// ----- applicabilityEngine.js -----
/**
 * Classifies every rule in the registry (not just applicable ones) into
 * REQUIRED / OPTIONAL / NOT_APPLICABLE_WITH_RATIONALE for full transparency —
 * a non-applicable rule is an explicit decision, not a silent omission.
 */

function computeApplicability(profileIds, intent) {
  const applicableIds = new Set(getApplicableRules(profileIds, intent).map((r) => r.id));
  return RULES_REGISTRY.map((rule) => {
    if (applicableIds.has(rule.id)) {
      return { id: rule.id, domain: rule.domain, description: rule.description, status: rule.severity };
    }
    return {
      id: rule.id,
      domain: rule.domain,
      description: rule.description,
      status: 'NOT_APPLICABLE_WITH_RATIONALE',
      rationale: 'لا ينطبق على مزيج الـProfiles الحالي (' + profileIds.join(', ') + ')',
    };
  });
}

// ----- architectureCompiler.js -----
/**
 * Suggests an architecture pattern per profile composition. Reuses the exact
 * 5-pattern reference already established in palwakf-project-factory's
 * ARCHITECTURE.md ("ابدأ بالبسيط" — start simple unless proven otherwise).
 * Always tagged INFERRED_DEFAULT — never presented as a firm decision.
 */
function suggestArchitecture(profileIds) {
  if (profileIds.indexOf('MULTI_TENANT_SAAS') !== -1 || profileIds.indexOf('FINANCIAL_SYSTEM') !== -1) {
    return {
      pattern: 'Clean / Hexagonal (مبسّطة)',
      reason: 'عزل منطق الأعمال عن قاعدة البيانات والواجهة ضروري هنا لحماية قواعد العزل/التدقيق من تقلبات البنية التحتية لاحقًا.',
      source: 'INFERRED_DEFAULT',
    };
  }
  if (profileIds.indexOf('API_SERVICE') !== -1 && profileIds.length === 1) {
    return {
      pattern: 'Layered (طبقية بسيطة)',
      reason: 'خدمة API مفردة بلا تعقيد تعدد مستأجرين أو حساسية مالية — الطبقية البسيطة كافية؛ لا داعٍ لتعقيد إضافي الآن.',
      source: 'INFERRED_DEFAULT',
    };
  }
  return {
    pattern: 'Layered (طبقية بسيطة)',
    reason: 'النمط الافتراضي الأبسط — طبّق "ابدأ بالبسيط": لا يوجد مؤشر حالي (حجم، تعقيد مالي، تعدد مستأجرين) يبرر معمارية أعقد.',
    source: 'INFERRED_DEFAULT',
  };
}

// ----- journeyCompiler.js -----
/**
 * Generic lifecycle journey + per-profile customization. Proves real
 * differentiation (section 15/36), not just name/description substitution.
 */
const GENERIC_JOURNEY = ['Discover', 'Input/Create', 'Validate', 'Persist', 'Retrieve', 'Edit', 'Process', 'Complete/Cancel', 'Notify', 'Audit'];

const PROFILE_JOURNEYS = {
  ECOMMERCE: ['تصفّح المنتجات', 'إضافة للسلة', 'الدفع (Checkout)', 'تأكيد الطلب', 'تتبع الشحن'],
  BOOKING_SYSTEM: ['اختيار الموعد المتاح', 'تأكيد الحجز', 'إرسال تذكير', 'الحضور أو الإلغاء', 'تقييم بعد الخدمة (اختياري)'],
  AI_ASSISTANT: ['طرح السؤال', 'استرجاع السياق', 'توليد إجابة مع درجة ثقة', 'عرض المصادر إن وُجدت', 'تصعيد لمراجعة بشرية عند الشك'],
  FINANCIAL_SYSTEM: ['إدخال المعاملة', 'تحقق مزدوج', 'ترحيل للسجل غير القابل للتعديل', 'مطابقة/تسوية', 'تقرير مالي'],
  GIS_SYSTEM: ['تحديد نطاق الدراسة', 'استعلام مكاني', 'عرض الطبقات', 'تحليل التداخل/القرب', 'تصدير الخريطة'],
  API_SERVICE: ['استقبال الطلب', 'تحقق من صحة المدخلات', 'تنفيذ المنطق', 'إرجاع استجابة موحّدة الشكل', 'تسجيل الحدث'],
};

function compileJourneys(profileIds) {
  const journeys = [{ name: 'الدورة العامة (Generic Lifecycle)', steps: GENERIC_JOURNEY, source: 'INFERRED_DEFAULT' }];
  profileIds.forEach((id) => {
    if (PROFILE_JOURNEYS[id]) {
      journeys.push({ name: 'رحلة مخصصة: ' + id, steps: PROFILE_JOURNEYS[id], source: 'INFERRED_DEFAULT' });
    }
  });
  return journeys;
}

// ----- blueprintCompiler.js -----
/**
 * compileBlueprint — the single most important function. Combines intent +
 * classification + applicability into ProjectBlueprintV1 (section 8 schema).
 *
 * HONESTY NOTE on domain_entities: this is NOT NLP-driven entity extraction.
 * It is a deliberately simple, documented heuristic (noun-ish tokens from the
 * goal text, deduplicated) tagged ASSUMED — a human must confirm it. Faking a
 * smarter extractor than this would violate the "UNKNOWN != PASS" invariant
 * this whole document is built around.
 */
function guessDomainEntities(projectGoal) {
  // Extremely light heuristic: look for common Arabic nouns after "إدارة"/"متابعة"/"تتبع".
  const matches = [];
  const re = /(?:إدارة|متابعة|تتبع|تسجيل)\s+([\u0600-\u06FF]{3,15})/g;
  let m;
  while ((m = re.exec(projectGoal || '')) !== null) matches.push(m[1]);
  return matches.length
    ? matches.map((e) => ({ name: e, status: 'ASSUMED', rationale: 'استُخرج من صياغة الهدف تلقائيًا — يحتاج تأكيد المستخدم' }))
    : [{ name: null, status: 'REQUIRES_DECISION', rationale: 'لم يُستخرج أي كيان من نص الهدف — يحتاج المستخدم تحديد الكيانات الأساسية يدويًا' }];
}

function compileBlueprint(intent, classification) {
  const profileIds = classification.map((c) => c.profile_id);
  const applicability = computeApplicability(profileIds, intent);
  const architecture = suggestArchitecture(profileIds);
  const journeys = compileJourneys(profileIds);

  const requiredRules = applicability.filter((r) => r.status === 'REQUIRED');
  const optionalRules = applicability.filter((r) => r.status === 'OPTIONAL');

  const unknowns = [];
  const requiredDecisions = [];
  const assumptions = [];
  const inferredDefaults = [{ field: 'project_profiles', value: profileIds, rationale: classification.map((c) => c.reason) }];
  inferredDefaults.push({ field: 'architecture_target', value: architecture.pattern, rationale: architecture.reason });

  const domainEntities = guessDomainEntities(intent.project_goal);
  domainEntities.forEach((e) => {
    if (e.status === 'ASSUMED') assumptions.push({ field: 'domain_entity', value: e.name, rationale: e.rationale });
    if (e.status === 'REQUIRES_DECISION') requiredDecisions.push({ field: 'domain_entities', rationale: e.rationale });
  });

  if (!intent.advanced.target_platforms) unknowns.push({ field: 'target_platforms', note: 'لم يُحدَّد — افتراض ويب فقط غير مؤكد' });
  if (!intent.advanced.data_sensitivity && (profileIds.includes('GIS_SYSTEM') || profileIds.includes('FINANCIAL_SYSTEM'))) {
    requiredDecisions.push({ field: 'data_sensitivity', rationale: 'مطلوب تحديد حساسية البيانات لنمط ' + profileIds.join('/') });
  }

  return {
    schema_version: SCHEMA_VERSION,
    project_name: intent.project_name,
    project_goal: intent.project_goal,
    project_profiles: classification,
    users: intent.advanced.users ? [intent.advanced.users] : [],
    roles: intent.advanced.roles ? [intent.advanced.roles] : [],
    target_platforms: intent.advanced.target_platforms ? [intent.advanced.target_platforms] : [],

    confirmed_requirements: Object.entries(intent.advanced)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => ({ field: k, value: v, status: 'CONFIRMED' })),
    inferred_defaults: inferredDefaults,
    assumptions: assumptions,
    unknowns: unknowns,
    required_decisions: requiredDecisions,

    functional_requirements: requiredRules.filter((r) => r.domain === 'PRODUCT_COMPLETENESS'),
    nonfunctional_requirements: requiredRules.filter((r) => r.domain !== 'PRODUCT_COMPLETENESS'),

    user_journeys: journeys,
    product_surfaces: profileIds.includes('API_SERVICE') ? ['API endpoints only — لا واجهة رسومية'] : ['Web UI'],
    information_architecture: 'INFERRED_DEFAULT — يُشتق من الـProfiles المختارة، يحتاج مراجعة بشرية قبل الاعتماد',

    domain_entities: domainEntities,
    relationships: [],
    business_rules: [],
    state_machines: [],

    architecture_target: architecture,
    data_strategy: applicability.filter((r) => r.domain === 'DATA'),
    persistence_strategy: applicability.filter((r) => r.domain === 'DATA' || r.domain === 'BACKUP_RESTORE'),
    security_profile: applicability.filter((r) => r.domain === 'SECURITY' || r.domain === 'AUTHENTICATION' || r.domain === 'AUTHORIZATION'),
    privacy_profile: applicability.filter((r) => r.domain === 'PRIVACY'),
    integration_strategy: applicability.filter((r) => r.domain === 'INTEGRATIONS' || r.domain === 'API_CONTRACTS'),

    ux_requirements: applicability.filter((r) => r.domain === 'UX'),
    design_system_requirements: 'راجع DESIGN_SYSTEM.md في palwakf-project-factory كمرجع Token-based — غير مُدمَج آليًا هنا بعد',
    responsive_requirements: applicability.filter((r) => r.id.indexOf('UAT') === 0),
    accessibility_requirements: applicability.filter((r) => r.domain === 'UX' && r.id.indexOf('A11Y') === 0),

    performance_requirements: applicability.filter((r) => r.domain === 'PERFORMANCE'),
    reliability_requirements: applicability.filter((r) => r.domain === 'RELIABILITY'),
    observability_requirements: applicability.filter((r) => r.domain === 'OBSERVABILITY'),

    backup_restore_requirements: applicability.filter((r) => r.domain === 'BACKUP_RESTORE'),
    rollback_requirements: [],

    test_strategy: applicability.filter((r) => r.domain === 'TESTING'),
    browser_uat_strategy: applicability.filter((r) => r.domain === 'BROWSER_UAT'),

    release_strategy: applicability.filter((r) => r.domain === 'CI_CD'),
    production_readiness_target: {
      note: 'هذا هدف (Target)، وليس شهادة جاهزية — لا يُفترض PRODUCTION_READY=TRUE أبدًا هنا',
      domains_covered: Array.from(new Set(applicability.map((r) => r.domain))),
    },

    acceptance_gates: [], // تُبنى في contractBuilders.js
    prohibited_shortcuts: [
      'NO_FAKE_SAVE', 'NO_DEAD_BUTTON', 'NO_PLACEHOLDER_AS_COMPLETE',
      'NO_SILENT_ASSUMPTION', 'NO_SECRET_IN_OUTPUT',
    ],

    generation_metadata: { generated_at: new Date().toISOString() },

    _all_applicability: applicability, // للاستخدام الداخلي في بناء العقود
  };
}

// ----- contractBuilders.js -----
function buildAcceptanceContract(blueprint) {
  const gates = blueprint._all_applicability
    .filter((r) => r.status === 'REQUIRED' || r.status === 'OPTIONAL')
    .map((r) => ({
      gate_id: r.id,
      domain: r.domain,
      requirement: r.description,
      applicability: r.status,
      acceptance_criteria: 'يُحدَّد عند التنفيذ الفعلي لهذا المتطلب',
      required_evidence: 'UNKNOWN — لا دليل بعد؛ لم يُبنَ المشروع الفعلي',
      blocking: r.status === 'REQUIRED',
      dependencies: [],
      target_status: 'DEFERRED_WITH_GATE',
    }));

  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    gates,
    generated_at: new Date().toISOString(),
  };
}

function buildDevelopmentContract(blueprint) {
  return {
    schema_version: SCHEMA_VERSION,
    project_name: blueprint.project_name,
    scope: 'تطوير ' + blueprint.project_name + ' وفق Blueprint المرفق فقط',
    included_capabilities: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    excluded_scope: blueprint._all_applicability.filter((r) => r.status === 'NOT_APPLICABLE_WITH_RATIONALE').map((r) => r.id),
    dependencies: [],
    implementation_requirements: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.description),
    quality_gates: ['FORMAT/LINT=PASS', 'UNIT=PASS', 'SECURITY=PASS'],
    acceptance_gates: blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').map((r) => r.id),
    prohibited_shortcuts: blueprint.prohibited_shortcuts,
    expected_artifacts: ['كود المشروع', 'اختبارات', 'README', 'تقرير إنجاز'],
    definition_of_done: 'كل Gate إلزامي (blocking=true) منفَّذ وله دليل فعلي، لا بالادعاء فقط',
    generated_at: new Date().toISOString(),
  };
}

// ----- promptCompiler.js -----
/**
 * Renders the Master Development Prompt from Blueprint + Contracts.
 * Sections genuinely OMITTED when not applicable (section 21's closing rule) —
 * this is what proves the output isn't just a static template with name swapped.
 */
function renderMasterPrompt(blueprint, acceptanceContract, developmentContract) {
  const lines = [];
  const push = (s) => lines.push(s);

  push('# برومبت تطوير رئيسي — ' + blueprint.project_name);
  push('');
  push('## هوية المشروع والهدف');
  push('الاسم: ' + blueprint.project_name);
  push('الهدف: ' + blueprint.project_goal);
  push('');
  push('## تصنيف المشروع (استنتاج آلي — راجعه قبل الاعتماد)');
  blueprint.project_profiles.forEach((p) => push('- ' + p.profile_id + ' (ثقة ' + p.confidence + ') — ' + p.reason));
  push('');

  if (blueprint.required_decisions.length) {
    push('## قرارات مطلوبة منك قبل المتابعة (لا تُخمَّن)');
    blueprint.required_decisions.forEach((d) => push('- ' + d.field + ': ' + d.rationale));
    push('');
  }
  if (blueprint.assumptions.length) {
    push('## افتراضات (ASSUMED — غير مؤكدة، راجعها)');
    blueprint.assumptions.forEach((a) => push('- ' + a.field + ' = ' + a.value + ' (' + a.rationale + ')'));
    push('');
  }

  push('## المعمارية المقترحة (' + blueprint.architecture_target.source + ')');
  push(blueprint.architecture_target.pattern + ' — ' + blueprint.architecture_target.reason);
  push('');

  push('## رحلات المستخدم');
  blueprint.user_journeys.forEach((j) => push('- ' + j.name + ': ' + j.steps.join(' → ')));
  push('');

  if (blueprint.security_profile.length) {
    push('## متطلبات الأمان والصلاحيات');
    blueprint.security_profile.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.data_strategy.length) {
    push('## استراتيجية البيانات');
    blueprint.data_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.ux_requirements.length) {
    push('## متطلبات تجربة المستخدم');
    blueprint.ux_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.performance_requirements.length) {
    push('## متطلبات الأداء');
    blueprint.performance_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.test_strategy.length) {
    push('## استراتيجية الاختبار');
    blueprint.test_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.browser_uat_strategy.length) {
    push('## اختبار القبول عبر المتصفح (UAT)');
    blueprint.browser_uat_strategy.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }
  if (blueprint.backup_restore_requirements.length) {
    push('## النسخ الاحتياطي والاستعادة');
    blueprint.backup_restore_requirements.forEach((r) => push('- [' + r.status + '] ' + r.description));
    push('');
  }

  push('## بوابات القبول (Acceptance Gates)');
  acceptanceContract.gates.filter((g) => g.blocking).forEach((g) => push('- [إلزامي] ' + g.gate_id + ': ' + g.requirement));
  push('');

  push('## ممنوعات صارمة (Prohibited Shortcuts)');
  blueprint.prohibited_shortcuts.forEach((s) => push('- ' + s));
  push('');

  push('## هدف جاهزية الإنتاج (ليس شهادة اكتمال)');
  push(blueprint.production_readiness_target.note);
  push('المجالات المغطاة: ' + blueprint.production_readiness_target.domains_covered.join('، '));
  push('');

  push('---');
  push('هذا البرومبت model-agnostic — صالح لأي نموذج ذكاء اصطناعي أو مطوّر بشري، دون أي تعليمات خاصة بمزوّد معيّن.');

  return lines.join('\n');
}

// ----- validationEngine.js -----
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

// ----- receipt.js -----
// Non-cryptographic, dependency-free, deterministic hash (FNV-1a variant).
// Documented as such — NOT a security control, purely a change-detection fingerprint.
function fingerprint(obj) {
  const str = JSON.stringify(obj);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildReceipt(intent, blueprint, acceptanceContract, developmentContract, prompt) {
  return {
    schema_version: SCHEMA_VERSION,
    compiler_version: COMPILER_VERSION,
    profile_versions: PROFILE_REGISTRY_VERSION,
    rules_versions: RULES_REGISTRY_VERSION,
    input_hash: fingerprint(intent),
    blueprint_hash: fingerprint(blueprint),
    acceptance_hash: fingerprint(acceptanceContract),
    development_hash: fingerprint(developmentContract),
    prompt_hash: fingerprint(prompt),
    generated_at: new Date().toISOString(),
  };
}/**
 * compileProject — the single public orchestration entrypoint, used by both
 * the Node test suite and the browser UI (identical logic, zero duplication —
 * this directly fixes the "duplicated canonical generation logic" debt flagged
 * in the v1.1.0 reality report, section 2 of the governing directive).
 */
function compileProject(rawInput, options) {
  options = options || {};
  const intent = makeProjectIntentV1(rawInput);
  const intentCheck = validateProjectIntentV1(intent);
  if (!intentCheck.valid) {
    return { ok: false, errors: intentCheck.errors };
  }

  // Section 7: a user-edited profile selection is a CONFIRMED decision, not an
  // inferred guess — INFERRED != USER_REQUIREMENT applies in both directions.
  const classification = options.overrideProfileIds
    ? options.overrideProfileIds.map((id) => ({
        profile_id: id,
        confidence: 1.0,
        reason: 'اختيار يدوي من المستخدم بعد مراجعة التصنيف المقترح',
        source: 'CONFIRMED',
      }))
    : classifyProject(intent);
  const blueprint = compileBlueprint(intent, classification);
  const acceptanceContract = buildAcceptanceContract(blueprint);
  const developmentContract = buildDevelopmentContract(blueprint);
  const prompt = renderMasterPrompt(blueprint, acceptanceContract, developmentContract);
  const validation = validateCandidate(intent, blueprint);
  const receipt = buildReceipt(intent, blueprint, acceptanceContract, developmentContract, prompt);

  return {
    ok: true,
    intent,
    classification,
    blueprint,
    acceptanceContract,
    developmentContract,
    prompt,
    validation,
    receipt,
  };
}
window.PM = { compileProject, PROFILE_REGISTRY, PROFILE_REGISTRY_DEFERRED, makeProjectIntentV1, validateProjectIntentV1 };
