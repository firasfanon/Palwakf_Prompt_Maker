'use strict';

const assert = require('assert');
const {
  compileProject,
  classifyProject,
  loadLegacyTemplates,
  makeProjectIntentV1,
  validateProjectIntentV1,
  mergeProjectContext,
  makeProjectContextV1,
} = require('../src/index');
const { getApplicableRules } = require('../src/rulesRegistry');
const { computeApplicability } = require('../src/applicabilityEngine');
const { suggestArchitecture } = require('../src/architectureCompiler');
const { scanForSecrets } = require('../src/validationEngine');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log('  ❌ ' + name + ' — ' + e.message);
  }
}

function section(title) {
  console.log('\n--- ' + title + ' ---');
}

// ============================================================
section('UNIT — Schemas');
// ============================================================
test('makeProjectIntentV1 يملأ الحقول الأساسية', () => {
  const i = makeProjectIntentV1({ project_name: 'س', project_goal: 'ص' });
  assert.strictEqual(i.project_name, 'س');
  assert.strictEqual(i.schema_version, '1.0');
});
test('validateProjectIntentV1 يرفض اسم فارغ', () => {
  const r = validateProjectIntentV1(makeProjectIntentV1({ project_goal: 'ص' }));
  assert.strictEqual(r.valid, false);
});
test('mergeProjectContext يدمج قيدًا من سياق خارجي وهمي (عقد مستقبلي فقط)', () => {
  const intent = makeProjectIntentV1({ project_name: 'س', project_goal: 'ص' });
  const ctx = makeProjectContextV1({ architecture_constraints: ['يجب استخدام PostgreSQL'] });
  const merged = mergeProjectContext(intent, ctx);
  assert.ok(merged.advanced.special_constraints.includes('PostgreSQL'));
});

// ============================================================
section('UNIT — Classification Engine');
// ============================================================
test('يصنّف متجرًا إلكترونيًا بوضوح', () => {
  const c = classifyProject({ project_name: 'متجري', project_goal: 'متجر إلكتروني لبيع الملابس مع سلة شراء', advanced: {} });
  assert.strictEqual(c[0].profile_id, 'ECOMMERCE');
  assert.strictEqual(c[0].source, 'INFERRED_DEFAULT');
});
test('يصنّف خدمة API فقط', () => {
  const c = classifyProject({ project_name: 'خدمة الدفع', project_goal: 'API فقط لمعالجة طلبات الدفع بين الأنظمة', advanced: {} });
  assert.ok(c.some((m) => m.profile_id === 'API_SERVICE'));
});
test('يصنّف مساعد ذكاء اصطناعي', () => {
  const c = classifyProject({ project_name: 'مساعد الموظفين', project_goal: 'مساعد ذكاء اصطناعي يجيب على أسئلة الموظفين من مستندات الشركة', advanced: {} });
  assert.ok(c.some((m) => m.profile_id === 'AI_ASSISTANT'));
});
test('نص بلا كلمات مفتاحية واضحة → تصنيف افتراضي منخفض الثقة (لا خطأ)', () => {
  const c = classifyProject({ project_name: 'شيء ما', project_goal: 'لا أعرف بعد ماذا أريد بالضبط', advanced: {} });
  assert.strictEqual(c[0].profile_id, 'WEB_APPLICATION');
  assert.ok(c[0].confidence < 0.5);
});
test('حقل متقدم multi_tenancy=yes يضيف MULTI_TENANT_SAAS حتى بلا كلمات مفتاحية', () => {
  const c = classifyProject({ project_name: 'نظامي', project_goal: 'نظام لإدارة العملاء', advanced: { multi_tenancy: 'yes' } });
  assert.ok(c.some((m) => m.profile_id === 'MULTI_TENANT_SAAS'));
});

// ============================================================
section('UNIT — Rules / Applicability (القسم 13 — الاختبار الأهم)');
// ============================================================
test('API_SERVICE المنفرد لا يحتاج اختبار 390px (UAT-002)', () => {
  const rules = getApplicableRules(['API_SERVICE'], { advanced: {} });
  assert.ok(!rules.some((r) => r.id === 'UAT-002'));
});
test('PUBLIC_PORTAL لا يحتاج عزل مستأجرين (DATA-002)', () => {
  const rules = getApplicableRules(['PUBLIC_PORTAL'], { advanced: {} });
  assert.ok(!rules.some((r) => r.id === 'DATA-002'));
});
test('MULTI_TENANT_SAAS يحتاج عزل مستأجرين (DATA-002) واختبار عزل (TEST-002)', () => {
  const rules = getApplicableRules(['MULTI_TENANT_SAAS'], { advanced: {} });
  assert.ok(rules.some((r) => r.id === 'DATA-002'));
  assert.ok(rules.some((r) => r.id === 'TEST-002'));
});
test('FINANCIAL_SYSTEM يحتاج صلاحيات أقوى (AUTH-003) لا يحتاجها WEB_APPLICATION', () => {
  const fin = getApplicableRules(['FINANCIAL_SYSTEM'], { advanced: {} });
  const web = getApplicableRules(['WEB_APPLICATION'], { advanced: {} });
  assert.ok(fin.some((r) => r.id === 'AUTH-003'));
  assert.ok(!web.some((r) => r.id === 'AUTH-003'));
});
test('AI_ASSISTANT فقط يحتاج ضوابط حقن الأوامر (SEC-002)', () => {
  const ai = getApplicableRules(['AI_ASSISTANT'], { advanced: {} });
  const web = getApplicableRules(['WEB_APPLICATION'], { advanced: {} });
  assert.ok(ai.some((r) => r.id === 'SEC-002'));
  assert.ok(!web.some((r) => r.id === 'SEC-002'));
});
test('computeApplicability يُرجع كل القواعد (المنطبقة وغير المنطبقة) مع سبب', () => {
  const all = computeApplicability(['API_SERVICE'], { advanced: {} });
  const na = all.find((r) => r.id === 'UAT-002');
  assert.strictEqual(na.status, 'NOT_APPLICABLE_WITH_RATIONALE');
  assert.ok(na.rationale.length > 0);
});

// ============================================================
section('UNIT — Architecture Compiler');
// ============================================================
test('MULTI_TENANT_SAAS يقترح Clean/Hexagonal لا Layered البسيطة', () => {
  assert.ok(suggestArchitecture(['MULTI_TENANT_SAAS']).pattern.includes('Hexagonal'));
});
test('API_SERVICE منفردًا يقترح Layered البسيطة (ابدأ بالبسيط)', () => {
  assert.ok(suggestArchitecture(['API_SERVICE']).pattern.includes('Layered'));
});
test('اقتراح المعمارية دائمًا مُعلَّم INFERRED_DEFAULT', () => {
  assert.strictEqual(suggestArchitecture(['WEB_APPLICATION']).source, 'INFERRED_DEFAULT');
});

// ============================================================
section('UNIT — Validation Engine / Security');
// ============================================================
test('يكتشف نمطًا يشبه مفتاح OpenAI في نص حر', () => {
  const findings = scanForSecrets('مفتاحي هو sk-abcdefghijklmnopqrstuvwxyz123456');
  assert.ok(findings.length > 0);
});
test('لا يُبلِّغ خطأً عن نص عادي بلا أسرار', () => {
  assert.strictEqual(scanForSecrets('نظام لإدارة المخزون').length, 0);
});

// ============================================================
section('INTEGRATION — compileProject end-to-end');
// ============================================================
test('مدخل بلا project_name يُرجع ok:false مع رسالة خطأ واضحة', () => {
  const r = compileProject({ project_goal: 'شيء ما' });
  assert.strictEqual(r.ok, false);
});
test('مدخل كامل يُنتج ok:true وكل القطع (blueprint/contracts/prompt/receipt)', () => {
  const r = compileProject({ project_name: 'نظامي', project_goal: 'نظام بسيط' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.blueprint && r.acceptanceContract && r.developmentContract && r.prompt && r.receipt);
});
test('مدخل يحتوي سرًّا واضحًا → validation = BLOCKED_REQUIRES_DECISION', () => {
  const r = compileProject({ project_name: 'س', project_goal: 'نظام يستخدم المفتاح sk-abcdefghijklmnopqrstuvwxyz123456' });
  assert.strictEqual(r.validation.status, 'BLOCKED_REQUIRES_DECISION');
});

// ============================================================
section('REGRESSION — الحفاظ على الأصول القديمة (القسم 37)');
// ============================================================
test('كل القوالب الثمانية القديمة لا تزال موجودة', () => {
  assert.strictEqual(loadLegacyTemplates().length, 8);
});
test('البيانات الوصفية للترخيص محفوظة في idea-to-full-webapp', () => {
  const t = loadLegacyTemplates().find((x) => x.id === 'idea-to-full-webapp');
  assert.ok(t.license.includes('كامل أبو سمرة'));
});
test('قيد "لا وجوه" محفوظ حرفيًا في قالب ترميم الوثائق', () => {
  const t = loadLegacyTemplates().find((x) => x.id === 'damaged-document-restoration');
  assert.ok(t.body.includes('لا تُعدّل') && t.body.includes('وجه'));
});

// ============================================================
section('CORE INVARIANTS (القسم 43)');
// ============================================================
test('production_readiness_target لا يدّعي أبدًا PRODUCTION_READY=TRUE', () => {
  const r = compileProject({ project_name: 'س', project_goal: 'نظام بسيط' });
  const serialized = JSON.stringify(r.blueprint.production_readiness_target);
  assert.ok(!serialized.includes('"PRODUCTION_READY":true') && !serialized.includes('"ready":true'));
});
test('validateCandidate لا يُرجع PASS نقيًا عند وجود required_decisions', () => {
  const r = compileProject({ project_name: 'س', project_goal: 'متجر إلكتروني لبيع الملابس' });
  if (r.blueprint.required_decisions.length > 0) {
    assert.notStrictEqual(r.validation.status, 'PASS');
  }
});
test('كل Profile مُستنتَج مُعلَّم INFERRED_DEFAULT وليس CONFIRMED (المبدأ: INFERRED != USER_REQUIREMENT)', () => {
  const r = compileProject({ project_name: 'س', project_goal: 'متجر إلكتروني' });
  assert.ok(r.blueprint.project_profiles.every((p) => p.source === 'INFERRED_DEFAULT'));
});

// ============================================================
section('GOLDEN CASES — 8 حالات من القسم 36 (إثبات التمايز الفعلي)');
// ============================================================
const goldenCases = [
  { name: 'PUBLIC_WEBSITE', goal: 'موقع عام تعريفي للشركة مفتوح لأي زائر بلا تسجيل دخول', expectProfile: 'PUBLIC_PORTAL' },
  { name: 'MULTI_TENANT_SAAS', goal: 'منصة SaaS تخدم عدة شركات، كل شركة لها بياناتها المعزولة', expectProfile: 'MULTI_TENANT_SAAS' },
  { name: 'MOBILE_BOOKING_APP', goal: 'تطبيق جوال لحجز مواعيد صالون تجميل', expectProfile: 'MOBILE_APPLICATION' },
  { name: 'AI_KNOWLEDGE_ASSISTANT', goal: 'مساعد ذكاء اصطناعي يجيب من مستندات الشركة الداخلية', expectProfile: 'AI_ASSISTANT' },
  { name: 'GIS_SYSTEM', goal: 'نظام معلومات جغرافية لعرض طبقات خرائط الأراضي', expectProfile: 'GIS_SYSTEM' },
  { name: 'FINANCIAL_SYSTEM', goal: 'نظام محاسبة لتتبع الفواتير والمعاملات المالية للشركة', expectProfile: 'FINANCIAL_SYSTEM' },
  { name: 'INTERNAL_ADMIN_SYSTEM', goal: 'لوحة تحكم داخلية لفريق المبيعات لمتابعة العملاء', expectProfile: 'ADMIN_DASHBOARD' },
  { name: 'API_ONLY_SERVICE', goal: 'خدمة API فقط لمعالجة إشعارات الدفع بين الأنظمة', expectProfile: 'API_SERVICE' },
];

const goldenResults = goldenCases.map((gc) => {
  const r = compileProject({ project_name: gc.name, project_goal: gc.goal });
  return { ...gc, result: r };
});

goldenResults.forEach((gc) => {
  test('Golden [' + gc.name + '] يُصنَّف إلى ' + gc.expectProfile, () => {
    assert.ok(gc.result.blueprint.project_profiles.some((p) => p.profile_id === gc.expectProfile),
      'التصنيف الفعلي: ' + gc.result.blueprint.project_profiles.map((p) => p.profile_id).join(','));
  });
});

test('Golden: الثمانية حالات تُنتج متطلبات مختلفة فعليًا، لا فقط اسمًا مختلفًا (القسم 23/36)', () => {
  const reqCounts = goldenResults.map((gc) => gc.result.blueprint._all_applicability.filter((r) => r.status === 'REQUIRED').length);
  const uniqueCounts = new Set(reqCounts);
  assert.ok(uniqueCounts.size > 1, 'كل الحالات أنتجت نفس عدد المتطلبات بالضبط: ' + reqCounts.join(','));
});
test('Golden: API_ONLY_SERVICE وMULTI_TENANT_SAAS لهما معماريات مختلفة', () => {
  const api = goldenResults.find((g) => g.name === 'API_ONLY_SERVICE').result.blueprint.architecture_target.pattern;
  const saas = goldenResults.find((g) => g.name === 'MULTI_TENANT_SAAS').result.blueprint.architecture_target.pattern;
  assert.notStrictEqual(api, saas);
});

// ============================================================
section('KNOWN LIMITATION — موثّقة بصدق، لا مخفية');
// ============================================================
test('[معروف] كلمة "فواتير" في سياق غير مالي بحت قد تُصنَّف خطأً كـFINANCIAL_SYSTEM (قيد الكلمات المفتاحية البسيط)', () => {
  const r = compileProject({ project_name: 'عيادتي', project_goal: 'نظام ويب لإدارة عيادة طبية مع حجز مواعيد ومرضى وفواتير' });
  const gotFinancial = r.blueprint.project_profiles.some((p) => p.profile_id === 'FINANCIAL_SYSTEM');
  // هذا الاختبار يُسجّل القيد كحقيقة معروفة (PASS يعني "نعم، القيد موجود كما وثّقناه")
  // وليس إثباتًا أن السلوك مثالي — راجع الممنوعات والتوصيات في التقرير النهائي.
  assert.strictEqual(gotFinancial, true, 'إن فشل هذا الاختبار، فالقيد المذكور في التقرير لم يعد قائمًا');
});

// ============================================================
console.log('\n============================================================');
console.log('النتيجة: ' + passed + ' ناجح، ' + failed + ' فاشل، من أصل ' + (passed + failed));
console.log('============================================================');
if (failed > 0) {
  console.log('\nالاختبارات الفاشلة:');
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.error));
  process.exit(1);
}
