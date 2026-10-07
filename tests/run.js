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
const pendingAsync = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingAsync.push(
        result.then(
          () => { passed++; console.log('  ✅ ' + name); },
          (e) => { failed++; failures.push({ name, error: e.message }); console.log('  ❌ ' + name + ' — ' + e.message); }
        )
      );
      return;
    }
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
section('BOUNDED PATCH — ProjectBlueprintV1 technology_decision');
// ============================================================
test('technology_decision: explicit preferred_technology => CONFIRMED and exact value', () => {
  const preferred = 'React 19 + Vite + Supabase';
  const r = compileProject({ project_name: 'Tech Explicit', project_goal: 'نظام ويب عام', preferred_technology: preferred });
  assert.strictEqual(r.blueprint.technology_decision.status, 'CONFIRMED');
  assert.strictEqual(r.blueprint.technology_decision.stack, preferred);
  assert.strictEqual(r.blueprint.technology_decision.source_type, 'USER_CONFIRMED');
  assert.strictEqual(r.blueprint.technology_decision.profile_hint, null);
});

test('technology_decision: absent preferred_technology => REQUIRES_DECISION', () => {
  const r = compileProject({ project_name: 'Tech Missing', project_goal: 'نظام ويب عام' });
  assert.strictEqual(r.blueprint.technology_decision.status, 'REQUIRES_DECISION');
  assert.strictEqual(r.blueprint.technology_decision.stack, null);
  assert.strictEqual(r.blueprint.technology_decision.source_type, null);
  assert.strictEqual(r.blueprint.technology_decision.profile_hint, null);
});

test('technology_decision: inferred profiles/architecture never become CONFIRMED technology', () => {
  const r = compileProject({ project_name: 'Tech Inferred Only', project_goal: 'منصة SaaS متعددة المستأجرين مع لوحة إدارة' });
  assert.ok(r.blueprint.project_profiles.length > 0);
  assert.ok(r.blueprint.architecture_target);
  assert.strictEqual(r.blueprint.technology_decision.status, 'REQUIRES_DECISION');
  assert.strictEqual(r.blueprint.technology_decision.stack, null);
});

test('ProjectBlueprintV1 schema is 1.1 while unrelated contracts remain 1.0', () => {
  const r = compileProject({ project_name: 'Schema Isolation', project_goal: 'نظام ويب عام', preferred_technology: 'React + Vite' });
  assert.strictEqual(r.blueprint.schema_version, '1.1');
  assert.strictEqual(r.acceptanceContract.schema_version, '1.0');
  assert.strictEqual(r.developmentContract.schema_version, '1.0');
  assert.strictEqual(r.receipt.schema_versions.project_intent, '1.0');
  assert.strictEqual(r.receipt.schema_versions.project_blueprint, '1.1');
});

test('technology_decision remains deterministic in blueprint content hash for same input', () => {
  const input = { project_name: 'Tech Hash', project_goal: 'نظام ويب عام', preferred_technology: 'React + Vite + Supabase' };
  const a = compileProject(JSON.parse(JSON.stringify(input)));
  const b = compileProject(JSON.parse(JSON.stringify(input)));
  assert.deepStrictEqual(a.blueprint.technology_decision, b.blueprint.technology_decision);
  assert.strictEqual(a.receipt.blueprint_content_hash, b.receipt.blueprint_content_hash);
});

test('technology_decision does not grant execution authority or production certification', () => {
  const r = compileProject({ project_name: 'Tech Authority', project_goal: 'نظام ويب عام', preferred_technology: 'React + Vite' });
  const serialized = JSON.stringify(r.blueprint.technology_decision);
  assert.ok(!/EXECUTION_AUTHORITY|PRODUCTION_READY|CERTIFIED/i.test(serialized));
  assert.notStrictEqual(r.blueprint.production_readiness_target, true);
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
test('[مُصلَح] كلمة "فواتير" في سياق عيادة/حجز لا تُصنَّف خطأً كـFINANCIAL_SYSTEM بعد إضافة negative_keywords', () => {
  const r = compileProject({ project_name: 'عيادتي', project_goal: 'نظام ويب لإدارة عيادة طبية مع حجز مواعيد ومرضى وفواتير' });
  const gotFinancial = r.blueprint.project_profiles.some((p) => p.profile_id === 'FINANCIAL_SYSTEM');
  const gotBooking = r.blueprint.project_profiles.some((p) => p.profile_id === 'BOOKING_SYSTEM');
  assert.strictEqual(gotFinancial, false, 'FINANCIAL_SYSTEM يجب أن يُقمَع عبر negative_keywords (عيادة/حجز/موعد) الآن');
  assert.strictEqual(gotBooking, true, 'BOOKING_SYSTEM يجب أن يُكتشف بشكل صحيح لهذا السياق');
});

test('[لم يُكسَر] سياق مالي حقيقي (دفتر أستاذ/مصالحة بنكية) لا يزال يُصنَّف FINANCIAL_SYSTEM رغم إصلاح القيد أعلاه', () => {
  const r = compileProject({ project_name: 'نظام محاسبي', project_goal: 'نظام محاسبي لإدارة دفتر الأستاذ (ledger) والفواتير المالية والمصالحة البنكية' });
  const gotFinancial = r.blueprint.project_profiles.some((p) => p.profile_id === 'FINANCIAL_SYSTEM');
  assert.strictEqual(gotFinancial, true, 'سياق مالي حقيقي يجب أن يبقى مكتشَفًا بعد إضافة قمع الإشارات السلبية');
});

test('كل نتيجة تصنيف تحمل حقل evidence (مصفوفة)', () => {
  const r = compileProject({ project_name: 'متجر', project_goal: 'متجر إلكتروني مع سلة شراء' });
  r.classification.forEach((c) => assert.ok(Array.isArray(c.evidence)));
});

const { PROFILE_REGISTRY_DECISIONS, PROFILE_REGISTRY_IMPLEMENTED_THIS_BATCH } = require('../src/profileRegistry');

PROFILE_REGISTRY_IMPLEMENTED_THIS_BATCH.forEach((profileId) => {
  test(`ملف التعريف الجديد ${profileId} قابل للتصنيف عبر كلماته المفتاحية`, () => {
    const profile = require('../src/profileRegistry').getProfileById(profileId);
    const kw = profile.triggers.keywords[0];
    const r = compileProject({ project_name: 'test', project_goal: 'مشروع يتعلق ب' + kw });
    assert.ok(r.classification.some((c) => c.profile_id === profileId), `${profileId} يجب أن يُكتشف عبر الكلمة "${kw}"`);
  });
});

test('PROFILE_REGISTRY_DECISIONS تحتوي 4 قرارات فقط، كل منها برأي حقيقي', () => {
  assert.strictEqual(PROFILE_REGISTRY_DECISIONS.length, 4);
  PROFILE_REGISTRY_DECISIONS.forEach((d) => {
    assert.ok(d.reason && d.reason.length > 20);
    assert.ok(['REMOVED_WITH_REASON', 'DEFERRED_WITH_REASON'].indexOf(d.decision) !== -1);
  });
});

// ============================================================
// GAP-CLOSING BATCH — brownfield, acceptance criteria, ports/adapters,
// versioning, core-leakage regression. Each of these was a genuine gap
// honestly flagged after the first 58-section directive.
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createMemoryProjectRepository, createMemoryExportAdapter,
  createFileProjectRepository, createFileExportAdapter,
  createProjectVersion, compareVersions,
} = require('../src/index');
const { scanCoreForProviderLockIn } = require('../src/validationEngine');

test('BROWNFIELD: مشروع existing_project=existing ينتج _brownfield غير null مع preserve/add', () => {
  const r = compileProject({
    project_name: 'نظام قائم',
    project_goal: 'نظام محاسبي ledger قائم يحتاج استكمال',
    existing_project: 'existing',
    existing_capabilities: 'has basic authentication and audit log already',
  });
  assert.ok(r.blueprint._brownfield);
  assert.strictEqual(r.blueprint._brownfield.mode, 'EXISTING_PROJECT');
  assert.ok(Array.isArray(r.blueprint._brownfield.gap_assessment.preserve));
  assert.ok(Array.isArray(r.blueprint._brownfield.gap_assessment.add));
  assert.deepStrictEqual(r.blueprint._brownfield.gap_assessment.refine, []);
});

test('BROWNFIELD: مشروع جديد (لا existing_project) ينتج _brownfield = null', () => {
  const r = compileProject({ project_name: 'جديد', project_goal: 'نظام محاسبي ledger جديد' });
  assert.strictEqual(r.blueprint._brownfield, null);
});

test('developmentContract يميّز is_brownfield=true/false بسيناريو مختلف فعليًا', () => {
  const green = compileProject({ project_name: 'G', project_goal: 'نظام محاسبي ledger جديد' });
  const brown = compileProject({ project_name: 'B', project_goal: 'نظام محاسبي ledger قائم', existing_project: 'existing', existing_capabilities: 'has auth' });
  assert.strictEqual(green.developmentContract.is_brownfield, false);
  assert.strictEqual(brown.developmentContract.is_brownfield, true);
  assert.notStrictEqual(green.developmentContract.scope, brown.developmentContract.scope);
});

test('بوابات عقد القبول تحمل acceptance_criteria/required_evidence حقيقية لا عامة فقط', () => {
  const r = compileProject({ project_name: 'مالي', project_goal: 'نظام محاسبي ledger' });
  const authGate = r.acceptanceContract.gates.find((g) => g.gate_id === 'AUTH-003');
  if (authGate) {
    assert.ok(authGate.acceptance_criteria && authGate.acceptance_criteria.length > 10);
    assert.ok(authGate.required_evidence && authGate.required_evidence.length > 5);
  }
});

test('prompt النهائي يُظهر قسم BROWNFIELD عند وجوده', () => {
  const r = compileProject({ project_name: 'B', project_goal: 'نظام محاسبي ledger قائم', existing_project: 'existing', existing_capabilities: 'has auth' });
  assert.ok(r.prompt.indexOf('Brownfield Mode') !== -1);
});

test('scanCoreForProviderLockIn يكتشف اسم مزوّد داخل نص', () => {
  const hits = scanCoreForProviderLockIn('this core module calls openai directly');
  assert.ok(hits.length > 0);
});

test('CORE LEAKAGE (آلي): لا يحتوي أي ملف src/*.js على اسم مشروع خاص/محظور', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const forbidden = /palwakf|workspace_manager|mind assistant|agentic ai|local executor/i;
  fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    const m = content.match(forbidden);
    assert.strictEqual(m, null, `${f} يحتوي إشارة محظورة: ${m}`);
  });
});

test('ProjectRepository في الذاكرة: save/load/list/remove تعمل فعليًا', async () => {
  const repo = createMemoryProjectRepository();
  await repo.save('p1', { x: 1 });
  assert.deepStrictEqual(await repo.load('p1'), { x: 1 });
  assert.deepStrictEqual(await repo.list(), ['p1']);
  await repo.remove('p1');
  assert.strictEqual(await repo.load('p1'), null);
});

test('ProjectRepository الحقيقي على نظام الملفات: save/load/list/remove على القرص فعليًا', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fs-'));
  const repo = createFileProjectRepository(dir);
  await repo.save('p2', { y: 2 });
  assert.deepStrictEqual(await repo.load('p2'), { y: 2 });
  assert.deepStrictEqual(await repo.list(), ['p2']);
  await repo.remove('p2');
  assert.strictEqual(await repo.load('p2'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ExportAdapter الحقيقي يكتب ملفًا فعليًا على القرص', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-export-'));
  const exp = createFileExportAdapter(dir);
  const result = await exp.exportFile('out.txt', 'hello');
  assert.ok(fs.existsSync(result.path));
  assert.strictEqual(fs.readFileSync(result.path, 'utf8'), 'hello');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createProjectVersion: نسخة أولى بلا أصل، ثم نسخة ثانية تكتشف تغيّرًا', () => {
  const r1 = compileProject({ project_name: 'V1', project_goal: 'هدف أول' });
  const v1 = createProjectVersion(null, r1);
  assert.strictEqual(v1.version_number, 1);
  assert.strictEqual(v1.parent_version_id, null);

  const r2 = compileProject({ project_name: 'V2', project_goal: 'هدف ثانٍ' });
  const v2 = createProjectVersion(v1, r2);
  assert.strictEqual(v2.version_number, 2);
  assert.strictEqual(v2.parent_version_id, v1.version_id);
  assert.ok(v2.change_summary.indexOf('input changed') !== -1);
});

test('compareVersions: مقارنة على مستوى البصمة فقط، موثَّقة كذلك بوضوح', () => {
  const r1 = compileProject({ project_name: 'C1', project_goal: 'هدف' });
  const v1 = createProjectVersion(null, r1);
  const r2 = compileProject({ project_name: 'C2', project_goal: 'هدف آخر' });
  const v2 = createProjectVersion(v1, r2);
  const cmp = compareVersions(v1, v2);
  assert.strictEqual(cmp.input_changed, true);
  assert.ok(cmp.note.indexOf('بصمة') !== -1);
});

test('CLI الفعلي (bin/prompt-maker.js) يُنتج ملفات حقيقية على القرص من طرف لطرف', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ project_name: 'CLI Test', project_goal: 'نظام حجز عيادة' }));
  const outDir = path.join(dir, 'out');
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'prompt-maker.js'), 'new', '--input', inputPath, '--out', outDir]);
  assert.ok(fs.existsSync(path.join(outDir, 'blueprint.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'master_prompt.md')));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// RECONCILIATION CLOSEOUT BATCH (sections 1-18 of the closeout directive)
// ============================================================
section('RECONCILIATION — Frontend/Core Parity');

test('STALE_GENERATED_BUNDLE gate: dist/core_bundle.js matches current src/', () => {
  require('./buildFreshness.test.js').run();
});

test('BROWSER_BUNDLE smoke test: dist/core_bundle.js loads under a window shim and classifies identically to CLI_CORE', () => {
  const vm = require('vm');
  const bundleSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'core_bundle.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.runInNewContext(bundleSrc, sandbox);
  const browserResult = sandbox.window.PM.compileProject({ project_name: 'عيادتي', project_goal: 'نظام ويب لإدارة عيادة طبية مع حجز مواعيد ومرضى وفواتير' });
  const nodeResult = compileProject({ project_name: 'عيادتي', project_goal: 'نظام ويب لإدارة عيادة طبية مع حجز مواعيد ومرضى وفواتير' });
  // NOTE: browserResult was produced by a function defined inside a separate
  // vm realm (simulating the browser), so its arrays/objects are NOT the same
  // Array/Object constructors as this process's — assert.deepStrictEqual is
  // realm-sensitive and would report a false mismatch on identical content.
  // Normalizing through JSON round-trips the values into this realm's plain
  // types, which is what we actually want to compare (content, not identity).
  const bIds = JSON.parse(JSON.stringify(browserResult.classification.map((c) => c.profile_id)));
  const nIds = JSON.parse(JSON.stringify(nodeResult.classification.map((c) => c.profile_id)));
  assert.deepStrictEqual(bIds, nIds, 'CLI_CORE != BROWSER_CORE — classification drifted between the Node module path and the browser bundle');
  assert.strictEqual(
    JSON.stringify(browserResult.blueprint.production_readiness_target),
    JSON.stringify(nodeResult.blueprint.production_readiness_target)
  );
});

test('CORE_BROWSER_PARITY: browser bundle exposes no private project-name leakage, no secret pattern leakage', () => {
  const bundleSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'core_bundle.js'), 'utf8');
  const forbidden = /palwakf|workspace_manager|mind assistant|agentic ai|local executor/i;
  assert.strictEqual(bundleSrc.match(forbidden), null, 'dist/core_bundle.js leaks a private project reference');
  assert.ok(bundleSrc.indexOf('BUNDLE_SOURCE_HASH') !== -1, 'bundle is missing its freshness marker');
});

section('RECONCILIATION — Master Prompt Parity (section 10)');

test('Master Prompt includes every applicable populated blueprint section for a rich (multi-signal) profile', () => {
  const r = compileProject({
    project_name: 'نظام مالي متعدد المستأجرين',
    project_goal: 'نظام محاسبي ledger متعدد المستأجرين multi-tenant لإدارة فواتير عدة شركات',
  });
  const must = ['تصنيف المشروع', 'المعمارية المقترحة', 'رحلات المستخدم', 'متطلبات الأمان والصلاحيات',
    'استراتيجية البيانات', 'بوابات القبول', 'عقد التطوير', 'ممنوعات صارمة', 'هدف جاهزية الإنتاج'];
  must.forEach((marker) => assert.ok(r.prompt.indexOf(marker) !== -1, `Master Prompt missing section: ${marker}`));
});

test('Master Prompt surfaces BROWNFIELD/relationships/business-rules/state-machines sections exactly when the blueprint has them, never when it does not', () => {
  const brown = compileProject({ project_name: 'ب', project_goal: 'نظام محاسبي ledger قائم', existing_project: 'existing', existing_capabilities: 'has auth' });
  const green = compileProject({ project_name: 'ج', project_goal: 'نظام محاسبي ledger جديد' });
  assert.ok(brown.prompt.indexOf('Brownfield Mode') !== -1);
  assert.strictEqual(green.prompt.indexOf('Brownfield Mode'), -1, 'a greenfield project must NOT show a brownfield section');

  const booking = compileProject({ project_name: 'ح', project_goal: 'نظام حجز مواعيد' });
  assert.ok(booking.prompt.indexOf('قواعد العمل') !== -1);
  assert.ok(booking.prompt.indexOf('آلات الحالة') !== -1);
});

section('RECONCILIATION — Deterministic Receipt Reproven (section 11)');

test('SAME_INPUT + SAME_COMPILER + SAME_PROFILE/RULE_VERSIONS => SAME content hashes, independent of generated_at', () => {
  const input = { project_name: 'تحديد', project_goal: 'نظام للاختبار' };
  const r1 = compileProject(JSON.parse(JSON.stringify(input)));
  const r2 = compileProject(JSON.parse(JSON.stringify(input)));
  assert.strictEqual(r1.receipt.input_hash, r2.receipt.input_hash);
  assert.strictEqual(r1.receipt.blueprint_content_hash, r2.receipt.blueprint_content_hash);
  assert.strictEqual(r1.receipt.acceptance_content_hash, r2.receipt.acceptance_content_hash);
  assert.strictEqual(r1.receipt.development_contract_content_hash, r2.receipt.development_contract_content_hash);
  assert.strictEqual(r1.receipt.prompt_hash, r2.receipt.prompt_hash);
  assert.notStrictEqual(r1.receipt.generated_at, r2.receipt.generated_at, 'generated_at SHOULD differ (it is intentionally volatile) while content hashes do not');
});

test('DIFFERENT_INPUT => different content hashes', () => {
  const r1 = compileProject({ project_name: 'A', project_goal: 'هدف أول' });
  const r2 = compileProject({ project_name: 'B', project_goal: 'هدف ثانٍ مختلف تمامًا' });
  assert.notStrictEqual(r1.receipt.input_hash, r2.receipt.input_hash);
  assert.notStrictEqual(r1.receipt.blueprint_content_hash, r2.receipt.blueprint_content_hash);
});

section('RECONCILIATION — Versioning Readback (section 12), real V1→V2 flow');

test('GENERATE V1 -> MODIFY INPUT -> GENERATE V2: system states exactly what changed, nothing that did not', () => {
  const inputV1 = { project_name: 'مشروع النسخ', project_goal: 'نظام ويب عام' };
  const resultV1 = compileProject(inputV1);
  const v1 = createProjectVersion(null, resultV1);

  // Modify only the goal text — profile/classification may or may not change as a result.
  const inputV2 = { project_name: 'مشروع النسخ', project_goal: 'نظام محاسبي ledger للفواتير المالية' };
  const resultV2 = compileProject(inputV2);
  const v2 = createProjectVersion(v1, resultV2);

  assert.strictEqual(v2.version_number, 2);
  assert.strictEqual(v2.parent_version_id, v1.version_id);
  assert.ok(v2.change_summary.indexOf('input changed') !== -1, 'input genuinely changed and must be reported as changed');
  assert.ok(v2.change_summary.indexOf('blueprint changed') !== -1, 'blueprint genuinely changed (different profile) and must be reported as changed');

  // Negative control: regenerating from the SAME input must NOT report a change.
  const resultV2b = compileProject(inputV2);
  const v2b = createProjectVersion(v2, resultV2b);
  assert.strictEqual(v2b.change_summary, 'no detected change', 'identical input must never be reported as changed');
});

section('RECONCILIATION — Save/Reopen E2E (section 13), real filesystem, no browser needed');

test('CREATE -> SAVE -> RELOAD STATE -> REOPEN -> VERIFY -> MODIFY -> REGENERATE -> SAVE V2 -> REOPEN AGAIN', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-saveflow-'));
  const repo1 = createFileProjectRepository(dir); // simulates "session 1"
  const projectId = 'save-reopen-test';

  const resultV1 = compileProject({ project_name: 'Save Reopen', project_goal: 'نظام ويب عام' });
  const v1 = createProjectVersion(null, resultV1);
  await repo1.save(projectId, { latest_version: v1, result: resultV1 });

  // Simulate terminating the process and starting a fresh one against the same dir.
  const repo2 = createFileProjectRepository(dir);
  const reopened = await repo2.load(projectId);
  assert.ok(reopened, 'project must be loadable after a simulated restart');
  assert.strictEqual(reopened.latest_version.version_number, 1);
  assert.strictEqual(reopened.latest_version.input_hash, resultV1.receipt.input_hash);

  const resultV2 = compileProject({ project_name: 'Save Reopen', project_goal: 'نظام محاسبي ledger' });
  const v2 = createProjectVersion(reopened.latest_version, resultV2);
  await repo2.save(projectId, { latest_version: v2, result: resultV2 });

  const repo3 = createFileProjectRepository(dir);
  const reopenedAgain = await repo3.load(projectId);
  assert.strictEqual(reopenedAgain.latest_version.version_number, 2);
  assert.strictEqual(reopenedAgain.latest_version.parent_version_id, v1.version_id);
  assert.notStrictEqual(reopenedAgain.latest_version.blueprint_hash, v1.blueprint_hash);

  fs.rmSync(dir, { recursive: true, force: true });
});

section('RECONCILIATION — Export Readback (section 14): write real files, read back, parse, validate');

test('EXPORT -> READ FROM DISK -> PARSE -> VALIDATE SCHEMA -> COMPARE HASH, for all 5 artifact files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-exportback-'));
  const exp = createFileExportAdapter(dir);
  const result = compileProject({ project_name: 'Export Test', project_goal: 'نظام ويب عام' });

  exp.exportFile('blueprint.json', JSON.stringify(result.blueprint, null, 2));
  exp.exportFile('acceptance_contract.json', JSON.stringify(result.acceptanceContract, null, 2));
  exp.exportFile('development_contract.json', JSON.stringify(result.developmentContract, null, 2));
  exp.exportFile('receipt.json', JSON.stringify(result.receipt, null, 2));
  exp.exportFile('master_prompt.md', result.prompt);

  const readBlueprint = JSON.parse(fs.readFileSync(path.join(dir, 'blueprint.json'), 'utf8'));
  assert.strictEqual(readBlueprint.schema_version, result.blueprint.schema_version);
  assert.strictEqual(readBlueprint.project_name, 'Export Test');
  assert.ok(Array.isArray(readBlueprint.project_profiles));

  const readAcceptance = JSON.parse(fs.readFileSync(path.join(dir, 'acceptance_contract.json'), 'utf8'));
  assert.ok(Array.isArray(readAcceptance.gates));
  readAcceptance.gates.forEach((g) => {
    assert.ok(g.gate_id && g.domain && g.requirement);
    assert.ok(g.acceptance_criteria && g.required_evidence);
  });

  const readDev = JSON.parse(fs.readFileSync(path.join(dir, 'development_contract.json'), 'utf8'));
  ['scope', 'included_capabilities', 'implementation_requirements', 'quality_gates', 'acceptance_gates', 'prohibited_shortcuts', 'expected_artifacts', 'definition_of_done']
    .forEach((field) => assert.ok(field in readDev, `development_contract.json missing field: ${field}`));

  const readReceipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  assert.strictEqual(readReceipt.blueprint_content_hash, result.receipt.blueprint_content_hash);
  assert.strictEqual(readReceipt.input_hash, result.receipt.input_hash);

  const readPrompt = fs.readFileSync(path.join(dir, 'master_prompt.md'), 'utf8');
  assert.strictEqual(readPrompt, result.prompt);
  const { fingerprint } = require('../src/receipt');
  assert.strictEqual(fingerprint(readPrompt), result.receipt.prompt_hash);

  fs.rmSync(dir, { recursive: true, force: true });
});

section('RECONCILIATION — DevelopmentContract field completeness (section 9)');

test('DevelopmentContract has every section-9 field, and domain constraints genuinely differ by profile', () => {
  const financial = compileProject({ project_name: 'م', project_goal: 'نظام محاسبي ledger' });
  const web = compileProject({ project_name: 'و', project_goal: 'موقع عام للتعريف' });
  ['scope', 'included_capabilities', 'excluded_scope', 'dependencies', 'implementation_requirements',
    'architecture_constraints', 'data_constraints', 'security_constraints', 'ux_constraints',
    'quality_gates', 'acceptance_gates', 'prohibited_shortcuts', 'expected_artifacts', 'definition_of_done']
    .forEach((f) => {
      assert.ok(f in financial.developmentContract, `missing field: ${f}`);
    });
  assert.notDeepStrictEqual(financial.developmentContract.data_constraints, web.developmentContract.data_constraints);
});

section('RECONCILIATION — Authority Boundary regression (section 18)');

test('No artifact ever asserts itself as execution authority or production certification', () => {
  const r = compileProject({ project_name: 'سلطة', project_goal: 'نظام محاسبي ledger' });
  assert.strictEqual(typeof r.blueprint.production_readiness_target, 'object', 'must be a TARGET note object, never a bare boolean true');
  assert.notStrictEqual(r.blueprint.production_readiness_target, true);
  assert.ok(r.prompt.indexOf('ليس شهادة اكتمال') !== -1, 'Master Prompt must state the readiness target is not a completion certificate');
  r.acceptanceContract.gates.forEach((g) => {
    assert.notStrictEqual(g.current_evidence_status, 'PASSED', 'a gate must never silently claim evidence that was not actually produced');
  });
});


// ============================================================
// BOUNDED REPAIR — regression tests (acceptance semantics, evidence state, persistence,
// safe rendering, rule coverage, rollback, ProjectContextV1, docs drift, CLI)
// ============================================================
const { execFileSync } = require('child_process');
const { RULES_REGISTRY, REQUIRED_FULL_PRODUCTION_DOMAINS, BLUEPRINT_SECTION_DOMAINS } = require('../src/rulesRegistry');
const { BY_RULE_ID, getAcceptanceCriteria } = require('../src/acceptanceCriteriaLibrary');
const api = require('../src/index');
const { computeMetrics } = require('../tools/metrics');
const ROOT = path.join(__dirname, '..');

section('REPAIR — Acceptance semantic mapping (RULE → criteria → evidence)');

test('كل قاعدة لها معيار قبول RULE_SPECIFIC ولا UNMAPPED', () => {
  RULES_REGISTRY.forEach((rule) => {
    const c = getAcceptanceCriteria(rule);
    assert.strictEqual(c.source_type, 'RULE_SPECIFIC', rule.id + ' has no rule-specific criteria');
    assert.ok(c.criteria && c.evidence, rule.id + ' missing criteria/evidence');
  });
});
test('ACCEPTANCE_SEMANTIC_MAPPING: كل مرساة (anchor) تظهر في وصف القاعدة وفي معيار القبول معًا', () => {
  RULES_REGISTRY.forEach((rule) => {
    assert.ok(Array.isArray(rule.anchors) && rule.anchors.length > 0, rule.id + ' has no anchors');
    const c = BY_RULE_ID[rule.id];
    rule.anchors.forEach((a) => {
      assert.ok(rule.description.indexOf(a) !== -1, rule.id + ': anchor "' + a + '" not in description');
      assert.ok(c.criteria.indexOf(a) !== -1, rule.id + ': anchor "' + a + '" not in criteria — requirement and criteria measure different things');
    });
  });
});
test('الأخطاء المثبتة سابقًا مصحّحة (DATA-002, TEST-002, TEST-003, AUTH-003)', () => {
  const get = (id) => BY_RULE_ID[id].criteria;
  assert.ok(/(مستأجر|tenant)/i.test(get('DATA-002')) && !/down migration/i.test(get('DATA-002')));
  assert.ok(/(مستأجر|tenant)/i.test(get('TEST-002')) && /مستأجرين/.test(get('TEST-002')));
  assert.ok(/(حجز|مزدوج|double)/i.test(get('TEST-003')));
  assert.ok(/(مراجعة|موافقة|dual|اعتماد)/i.test(get('AUTH-003')));
});
test('ORPHAN_ACCEPTANCE_RULE_ID: لا معيار قبول بمعرّف بلا قاعدة', () => {
  const ids = new Set(RULES_REGISTRY.map((r) => r.id));
  const orphans = Object.keys(BY_RULE_ID).filter((k) => !ids.has(k));
  assert.deepStrictEqual(orphans, [], 'ORPHAN_ACCEPTANCE_RULE_ID: ' + orphans.join(','));
  assert.ok(!('DATA-006' in BY_RULE_ID) && !('SEC-004' in BY_RULE_ID));
  assert.strictEqual(new Set(RULES_REGISTRY.map((r) => r.id)).size, RULES_REGISTRY.length, 'duplicate rule ids');
});

section('REPAIR — GENERATOR_RUNTIME_STATE must not leak into GENERATED_PROJECT_EVIDENCE_STATE');

test('كل Gate مولَّد current_evidence_status=NOT_ASSESSED على أكثر من نوع مشروع', () => {
  [
    { project_name: 'أ', project_goal: 'متجر إلكتروني لبيع الملابس مع دفع وسلة شراء' },
    { project_name: 'ب', project_goal: 'نظام محاسبي ledger متعدد المستأجرين وحجوزات' },
    { project_name: 'ج', project_goal: 'تطبيق سطح مكتب لإدارة الملفات' },
  ].forEach((input) => {
    const r = compileProject(input);
    assert.ok(r.ok);
    assert.ok(r.acceptanceContract.gates.length > 0);
    r.acceptanceContract.gates.forEach((g) => assert.strictEqual(g.current_evidence_status, 'NOT_ASSESSED', g.gate_id));
    assert.ok(!/BLOCKED_NO_BROWSER_IN_ENVIRONMENT|NOT_EXECUTED/.test(JSON.stringify(r.acceptanceContract)));
    assert.ok(!/BLOCKED_NO_BROWSER_IN_ENVIRONMENT|NOT_EXECUTED/.test(r.prompt));
  });
});
test('لا يوجد في src ولا في الحزمة المبنية قيم حالة بيئة المولّد', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src')).map((f) => path.join(ROOT, 'src', f)).concat([path.join(ROOT, 'dist/core_bundle.js')]);
  files.forEach((f) => {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/BLOCKED_NO_BROWSER_IN_ENVIRONMENT/.test(t), f);
    assert.ok(!/['"]NOT_EXECUTED['"]/.test(t), f);
  });
});

section('REPAIR — FULL_PRODUCTION_RULE_COVERAGE');

test('كل مجال Full-Production المطلوب له قاعدة حقيقية واحدة على الأقل', () => {
  const domains = new Set(RULES_REGISTRY.map((r) => r.domain));
  const missing = REQUIRED_FULL_PRODUCTION_DOMAINS.filter((d) => !domains.has(d));
  assert.deepStrictEqual(missing, []);
  ['MIGRATIONS','REFERENTIAL_INTEGRITY','TRANSACTIONS','CONCURRENCY','IDEMPOTENCY','CACHING','INDEXING','LOAD_TARGETS','WEBHOOKS',
   'METRICS','TRACING','HEALTH','READINESS','ALERTING','DEGRADED_MODE','RECOVERY','BACKUP_RESTORE','RPO','RTO','DATABASE_TESTING',
   'INTEGRATION_TESTING','SECURITY_TESTING','REGRESSION_TESTING','ENVIRONMENT_SEPARATION','RELEASE','ROLLBACK','RUNBOOKS',
   'INCIDENT_RESPONSE','SUPPORTABILITY','PRODUCTION_EVIDENCE'].forEach((d) => assert.ok(domains.has(d), 'missing domain ' + d));
});
test('كل مجال يغذّي قسمًا فعليًا من Blueprint', () => {
  const unmapped = Array.from(new Set(RULES_REGISTRY.map((r) => r.domain))).filter((d) => !Object.keys(BLUEPRINT_SECTION_DOMAINS).some((sec) => BLUEPRINT_SECTION_DOMAINS[sec].indexOf(d) !== -1));
  assert.deepStrictEqual(unmapped, [], 'domains feeding no Blueprint section');
});
test('Applicability حقيقي: ليست كل القواعد REQUIRED لكل المشاريع', () => {
  const web = compileProject({ project_name: 'و', project_goal: 'نظام ويب متعدد المستأجرين مع قاعدة بيانات ودفع' });
  const desk = compileProject({ project_name: 'س', project_goal: 'تطبيق سطح مكتب بسيط بدون خادم' });
  const status = (r) => new Map(r.blueprint._all_applicability.map((x) => [x.id, x.status]));
  const a = status(web), b = status(desk);
  let differ = 0, notApplicable = 0;
  a.forEach((v, k) => { if (b.get(k) !== v) differ++; });
  b.forEach((v) => { if (v === 'NOT_APPLICABLE_WITH_RATIONALE') notApplicable++; });
  assert.ok(differ > 5, 'applicability should differ between web and desktop profiles');
  assert.ok(notApplicable > 0 && notApplicable < RULES_REGISTRY.length);
  assert.ok(!/REPRESENTATIVE SUBSET|تمثيلي/.test(fs.readFileSync(path.join(ROOT, 'src/rulesRegistry.js'), 'utf8')));
});

section('REPAIR — ROLLBACK_APPLICABILITY');

test('نظام ويب قابل للنشر: rollback_requirements غير فارغة وبمعيار ودليل', () => {
  const r = compileProject({ project_name: 'نشر', project_goal: 'نظام ويب متعدد المستأجرين مع قاعدة بيانات ودفع ونشر إنتاجي' });
  const rb = r.blueprint.rollback_requirements;
  assert.ok(rb.length > 0);
  const live = rb.filter((x) => x.status !== 'NOT_APPLICABLE_WITH_RATIONALE');
  assert.ok(live.length > 0, 'deployable system must have applicable rollback requirements');
  live.forEach((x) => { assert.ok(x.acceptance_criteria && x.required_evidence, x.id); });
  assert.ok(r.prompt.indexOf('التراجع (Rollback)') !== -1);
});
test('تطبيق سطح مكتب: التراجع غير منطبق مع تعليل (ليس صفرًا صامتًا)', () => {
  const r = compileProject({ project_name: 'سطح', project_goal: 'تطبيق سطح مكتب بسيط بدون خادم' });
  r.blueprint.rollback_requirements.forEach((x) => {
    if (x.status === 'NOT_APPLICABLE_WITH_RATIONALE') assert.ok(x.rationale);
  });
});

section('REPAIR — ProjectContextV1 contract');

test('الحقول التسعة + schema_version + validation', () => {
  const c = makeProjectContextV1({ project_id: 'p1', current_state: 'يعمل', existing_architecture: ['طبقات'], existing_capabilities: ['تسجيل'],
    existing_constraints: ['PostgreSQL'], existing_tests: ['وحدة'], known_gaps: ['لا نسخ احتياطي'],
    source_references: [{ type: 'REPOSITORY', ref: 'x/y' }], applicable_external_standards: [{ id: 'S1', name: 'معيار' }] });
  ['project_id','current_state','existing_architecture','existing_capabilities','existing_constraints','existing_tests','known_gaps','source_references','applicable_external_standards','schema_version']
    .forEach((f) => assert.ok(f in c, f));
  assert.strictEqual(api.validateProjectContextV1(c).valid, true);
});
test('سياسة الحقول المجهولة والامتدادات x_ وسياسة التوافق', () => {
  const v = api.validateProjectContextV1(Object.assign(api.makeProjectContextV1({}), { surprise: 1, x_custom: 2 }));
  assert.strictEqual(v.valid, true);
  assert.ok(v.warnings.some((w) => /surprise/.test(w)), 'unknown field warns');
  assert.ok(!v.warnings.some((w) => /x_custom/.test(w)), 'x_ extension is allowed silently');
  assert.strictEqual(api.validateProjectContextV1({ schema_version: '99.0' }).valid, false, 'major mismatch rejected');
  const newer = api.validateProjectContextV1({ schema_version: '1.99' });
  assert.ok(newer.valid && newer.warnings.length > 0, 'newer minor accepted with warning');
  assert.strictEqual(api.validateProjectContextV1(null).valid, false);
  assert.strictEqual(api.validateProjectContextV1({ schema_version: '1.0', existing_tests: 5 }).valid, false);
});
test('الأسماء القديمة (aliases) تُقبل، وقيم المستخدم تتغلب عند الدمج، والمصدر موسوم', () => {
  const c = makeProjectContextV1({ architecture_constraints: ['يجب PostgreSQL'], applicable_standards: ['S2'] });
  assert.deepStrictEqual(c.existing_constraints, ['يجب PostgreSQL']);
  assert.strictEqual(c.applicable_external_standards.length, 1);
  const intent = makeProjectIntentV1({ project_name: 'س', project_goal: 'ص', existing_architecture: 'من المستخدم' });
  const merged = mergeProjectContext(intent, makeProjectContextV1({ existing_architecture: ['من السياق'] }));
  assert.strictEqual(merged.advanced.existing_architecture, 'من المستخدم');
  const m2 = mergeProjectContext(makeProjectIntentV1({ project_name: 'س', project_goal: 'ص' }), makeProjectContextV1({ existing_capabilities: ['ميزة'] }));
  assert.ok(m2.advanced.existing_capabilities.indexOf('[from ProjectContextV1]') !== -1);
});
test('compileProject يرفض سياقًا غير صالح ويقبل صالحًا بلا ربط بأي مشروع خاص', () => {
  const bad = compileProject({ project_name: 'س', project_goal: 'نظام ويب' }, { projectContext: { schema_version: '9.0' } });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.indexOf('projectContext: ') === 0));
  const good = compileProject({ project_name: 'س', project_goal: 'نظام ويب' }, { projectContext: makeProjectContextV1({ current_state: 'قائم' }) });
  assert.ok(good.ok);
});

section('REPAIR — Persistent version history (storage-agnostic)');

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; }, _m: m };
}
test('VERSION_HISTORY_REOPEN: حفظ V1 ثم V2 ثم "إعادة فتح" بمستودع جديد على نفس التخزين وفحص الهاشات', async () => {
  const storage = fakeStorage();
  const repo1 = api.createStorageProjectRepository(storage);
  const input1 = { project_name: 'مشروع الحفظ', project_goal: 'نظام ويب لإدارة المهام' };
  const r1 = compileProject(input1);
  const id = api.projectIdFromName(input1.project_name);
  let rec = api.appendVersion(null, r1, { projectId: id });
  await repo1.save(id, rec);
  const r2 = compileProject(Object.assign({}, input1, { project_goal: 'نظام ويب لإدارة المهام مع إشعارات' }));
  rec = api.appendVersion(await repo1.load(id), r2, { projectId: id });
  await repo1.save(id, rec);

  const repo2 = api.createStorageProjectRepository(storage); // "new page load"
  const loaded = await repo2.load(id);
  assert.strictEqual(api.listVersions(loaded).length, 2);
  assert.deepStrictEqual((await repo2.list()).includes(id), true);
  [1, 2].forEach((n) => {
    const v = api.getVersion(loaded, n);
    assert.ok(v, 'version ' + n);
    const check = api.verifyReopenedVersion(v, compileProject(v.input));
    assert.ok(check.matches && check.mismatches.length === 0, 'hash verification of v' + n + ': ' + JSON.stringify(check));
  });
  assert.notStrictEqual(api.getVersion(loaded, 1).input_hash, api.getVersion(loaded, 2).input_hash);
});
test('مستودع التخزين يرفض JSON تالفًا بدل إرجاع بيانات مزيفة', async () => {
  const storage = fakeStorage();
  storage.setItem('prompt-maker:project:bad', '{not json');
  await assert.rejects(() => api.createStorageProjectRepository(storage).load('bad'));
});
test('مستودع الملفات يرفض معرّفات مشروع تعبر المسار (path traversal)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-repo-'));
  const repo = api.createFileProjectRepository(dir);
  for (const bad of ['../x', 'a/b', '', '..', 'a\0b']) {
    await assert.rejects(() => repo.load(bad), /invalid project id/, JSON.stringify(bad));
  }
});

section('REPAIR — CLI versions command is real');

test('prompt-maker.js new --data-dir ثم versions يقرآن تاريخًا حقيقيًا', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-'));
  const inputFile = path.join(dir, 'in.json');
  const bin = path.join(ROOT, 'bin/prompt-maker.js');
  fs.writeFileSync(inputFile, JSON.stringify({ project_name: 'cli demo', project_goal: 'نظام ويب لإدارة المهام' }));
  const run = (args) => execFileSync('node', [bin].concat(args), { encoding: 'utf8' });
  run(['new', '--input', inputFile, '--out', path.join(dir, 'o1'), '--data-dir', path.join(dir, 'data')]);
  fs.writeFileSync(inputFile, JSON.stringify({ project_name: 'cli demo', project_goal: 'نظام ويب لإدارة المهام مع تقارير' }));
  run(['new', '--input', inputFile, '--out', path.join(dir, 'o2'), '--data-dir', path.join(dir, 'data')]);
  const id = api.projectIdFromName('cli demo');
  const out = run(['versions', '--project-id', id, '--data-dir', path.join(dir, 'data')]);
  assert.ok(/2 version/.test(out), out);
  assert.ok(/v1 /.test(out) && /v2 /.test(out));
  const v2 = JSON.parse(run(['versions', '--project-id', id, '--data-dir', path.join(dir, 'data'), '--version', '2']));
  assert.strictEqual(v2.version_number, 2);
  assert.throws(() => execFileSync('node', [bin, 'versions', '--project-id', 'nope', '--data-dir', path.join(dir, 'data')], { stdio: 'pipe' }));
});

section('REPAIR — SAFE_RENDERING (static) and DOCUMENTATION_DRIFT');

test('واجهة المتصفح لا تستخدم أي واجهة حقن HTML نصية (innerHTML وأخواتها)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist/prompt-maker-app.html'), 'utf8');
  [/innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/].forEach((re) => assert.ok(!re.test(html), String(re)));
  assert.ok(!/createMemoryProjectRepository/.test(html.replace(/memory fallback/gi, '')) || /localStorage/.test(html), 'UI must use persistent storage');
  assert.ok(/createStorageProjectRepository/.test(html));
});
test('DOC_DRIFT: لا أرقام يدوية قديمة، وكل رقم قواعد/مجالات/Profiles في الوثائق يطابق الحي', () => {
  const m = computeMetrics();
  const docs = ['README.md', 'CHANGELOG.md'].concat(fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md') && f !== 'CLOSEOUT_REPORT.md').map((f) => 'docs/' + f));
  docs.forEach((rel) => {
    const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/~\s*45\s*قاعدة|13 domains|REPRESENTATIVE SUBSET|مجموعة تمثيلية|\(تمثيلي\)/.test(t), rel + ' has stale claims');
    const rulesMatch = t.match(/(\d+)\s*قاعدة/g) || [];
    rulesMatch.forEach((x) => assert.strictEqual(Number(x.match(/\d+/)[0]), m.rules, rel + ': "' + x + '" != live rule count ' + m.rules));
    (t.match(/(\d+)\s*مجالًا/g) || []).forEach((x) => assert.strictEqual(Number(x.match(/\d+/)[0]), m.rule_domains, rel + ': "' + x + '" != live domain count'));
    (t.match(/(\d+)\s*Profile/g) || []).forEach((x) => assert.strictEqual(Number(x.match(/\d+/)[0]), m.profiles_implemented, rel + ': "' + x + '" != live profile count'));
  });
});
test('CLOSEOUT_REPORT التاريخي موسوم كمتجاوَز', () => {
  assert.ok(/SUPERSEDED|متجاوَز/.test(fs.readFileSync(path.join(ROOT, 'docs/CLOSEOUT_REPORT.md'), 'utf8').slice(0, 800)));
});

section('REPAIR 2 — Receipt hash semantics (FNV-1a is NOT a security control)');

test('FNV_SECURITY_SEMANTICS: الإيصال يعلن آليًا أن البصمة غير تشفيرية ولا توفر مقاومة تلاعب', () => {
  const r = compileProject({ project_name: 'دلالات', project_goal: 'نظام ويب لإدارة المهام' });
  const h = r.receipt.hash_semantics;
  assert.ok(h, 'receipt.hash_semantics missing');
  assert.strictEqual(h.algorithm, 'FNV-1a-32');
  assert.strictEqual(h.classification, 'DETERMINISTIC_NON_CRYPTOGRAPHIC_FINGERPRINT');
  assert.strictEqual(h.tamper_resistance, 'NOT_PROVIDED');
  assert.strictEqual(h.cryptographic_integrity, 'NOT_PROVIDED');
  assert.strictEqual(h.untrusted_source_verification, 'NOT_PROVIDED');
  ['TAMPER_PROOFING', 'CRYPTOGRAPHIC_INTEGRITY', 'UNTRUSTED_SOURCE_VERIFICATION'].forEach((x) => assert.ok(h.not_suitable_for.includes(x), x));
  ['CHANGE_DETECTION', 'REPRODUCIBILITY'].forEach((x) => assert.ok(h.suitable_for.includes(x), x));
  const r2 = compileProject({ project_name: 'دلالات', project_goal: 'نظام ويب لإدارة المهام' });
  assert.strictEqual(r.receipt.blueprint_content_hash, r2.receipt.blueprint_content_hash, 'determinism unchanged');
});
test('FALSE_TAMPER_CLAIM=ABSENT: لا وثيقة/كود يدّعي أن FNV يوفر حماية من التلاعب أو سلامة تشفيرية', () => {
  const files = ['README.md', 'CHANGELOG.md'].concat(fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f))
    .concat(fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f));
  const negation = /(لا |ليس|غير|NOT|not |never|No |no |not_suitable_for)/;
  const offenders = [];
  files.forEach((rel) => {
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (/تلاعب|tamper|cryptographic integrity|سلامة تشفيرية|دون الحاجة لثقة/i.test(line) && !negation.test(line)) offenders.push(rel + ':' + (i + 1) + ': ' + line.trim());
    });
  });
  assert.deepStrictEqual(offenders, [], 'FALSE_TAMPER_CLAIM candidates (a line mentioning tamper/integrity must state it is NOT provided)');
  const guide = fs.readFileSync(path.join(ROOT, 'docs/FUTURE_EXTERNAL_INTEGRATION_GUIDE.md'), 'utf8');
  assert.ok(!/للتحقق من عدم التلاعب/.test(guide));
  assert.ok(/NOT_PROVIDED/.test(guide) && /hash_semantics/.test(guide));
});

section('REPAIR 2 — Reproducible browser UAT (declared dependency)');

test('PLAYWRIGHT_DEPENDENCY_DECLARED: package.json + package-lock.json يثبّتان playwright الخام بإصدار دقيق', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const declared = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  assert.ok(/^\d+\.\d+\.\d+$/.test(declared.playwright || ''), 'playwright must be pinned to an exact version');
  assert.ok(!('@playwright/test' in declared), '@playwright/test must not be added');
  assert.deepStrictEqual(Object.keys(declared), ['playwright'], 'no other frameworks');
  assert.strictEqual(lock.lockfileVersion, 3);
  ['playwright', 'playwright-core'].forEach((n) => {
    const e = lock.packages['node_modules/' + n];
    assert.ok(e && e.version === declared.playwright, n + ' locked version must equal declared');
    assert.ok(/^sha512-/.test(e.integrity), n + ' needs integrity');
  });
  assert.ok(/node_modules/.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));
  const run = fs.readFileSync(path.join(ROOT, 'tests/browser/run.js'), 'utf8');
  assert.ok(/require\('playwright'\)/.test(run) && !/require\('@playwright\/test'\)/.test(run));
  assert.ok(/npm ci/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
});

// ============================================================
// BATCH A — FACTORY_CONSUMER_SUBSET_V1 / PROFILE_MAPPING_V1 / GOLDEN + NEGATIVE FIXTURES
// ============================================================
const crypto = require('crypto');
const FIX_DIR = path.join(ROOT, 'tests', 'fixtures', 'factory-consumer');
const readFix = (n) => fs.readFileSync(path.join(FIX_DIR, n), 'utf8');
const readFixJson = (n) => JSON.parse(readFix(n));
const sha256Lf = (t) => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const oracle = require('./helpers/factoryConsumerOracle');
const fixtureGen = require('../tools/generateFactoryConsumerFixtures');
const mappingV1 = readFixJson('profile-mapping-v1.json');
const manifestV1 = readFixJson('manifest.json');
const evalSubset = (s) => oracle.evaluateConsumerSubset(s, mappingV1, api.SUPPORTED_CONSUMER_BLUEPRINT_SCHEMA_VERSIONS);
const deepCopy = (o) => JSON.parse(JSON.stringify(o));
const BASE_IN = { project_name: 'اختبار المستهلك', project_goal: 'منصة ويب لإدارة مهام الفريق' };

section('BATCH A — FACTORY_CONSUMER_SUBSET_V1 extraction');

test('الاستخراج حتمي ويتبع ترتيب الحقول المجمّد', () => {
  const a = api.extractFactoryConsumerSubset(compileProject(BASE_IN).blueprint);
  const b = api.extractFactoryConsumerSubset(compileProject(BASE_IN).blueprint);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.deepStrictEqual(Object.keys(a), api.FACTORY_CONSUMER_SUBSET_V1_FIELDS.slice());
  assert.strictEqual(a.schema_version, '1.1');
});
test('الحقول التي تبدأ بـ "_" داخلية: لا تُستخرج ولا تُشترط، وحقول مجهولة إضافية تُتجاهل', () => {
  const bp = compileProject(BASE_IN).blueprint;
  assert.ok(Object.keys(bp).some((k) => k.charAt(0) === '_'), 'live blueprint does have internal fields');
  const sub = api.extractFactoryConsumerSubset(bp);
  assert.ok(Object.keys(sub).every((k) => k.charAt(0) !== '_'));
  const bp2 = Object.assign(deepCopy(bp), { _new_internal: { x: 1 }, brand_new_public_field: 5 });
  assert.strictEqual(JSON.stringify(api.extractFactoryConsumerSubset(bp2)), JSON.stringify(sub));
  // the consumer side ignores internals and unknown fields too
  const noisy = Object.assign(deepCopy(readFixJson('golden-react-vite-supabase.json')), { _internal: 'x', future_field: [1] });
  assert.strictEqual(evalSubset(noisy).outcome, 'MATERIALIZATION_READY');
});
test('حقل مفقود في Blueprint يُحذف من الـsubset ولا يُختلق', () => {
  const bp = deepCopy(compileProject(BASE_IN).blueprint); delete bp.project_goal;
  assert.ok(!('project_goal' in api.extractFactoryConsumerSubset(bp)));
  assert.deepStrictEqual(api.extractFactoryConsumerSubset(null), {});
});

section('BATCH A — fixtures, outcomes and PROFILE_MAPPING_V1');

test('كل fixture مجمّد ينتج النتيجة المتوقعة المسجّلة في manifest', () => {
  assert.strictEqual(manifestV1.fixtures.length, 5);
  manifestV1.fixtures.forEach((f) => {
    const r = evalSubset(readFixJson(f.file));
    assert.strictEqual(r.outcome, f.expected_result, f.fixture_id + ' -> ' + JSON.stringify(r));
    assert.strictEqual(r.classification === undefined ? null : r.classification, f.expected_classification, f.fixture_id + ' classification');
    assert.strictEqual(r.profile === undefined ? null : r.profile, f.expected_profile, f.fixture_id + ' profile');
  });
  const ids = manifestV1.fixtures.map((f) => f.expected_result).sort();
  assert.deepStrictEqual(ids, ['BLOCKED_REQUIRES_TECHNOLOGY_DECISION', 'BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE', 'INVALID_BLUEPRINT', 'MATERIALIZATION_READY', 'UNSUPPORTED_BLUEPRINT_SCHEMA']);
});
test('الـgolden fixture ناتج حقيقي لـ compileProject (يطابق المُصرّف الحي) ومستقر', () => {
  const live = api.extractFactoryConsumerSubset(compileProject(Object.assign({}, { project_name: 'Golden Consumer Project', project_goal: 'منصة ويب لإدارة مهام الفريق مع تسجيل دخول ولوحة متابعة', preferred_technology: 'react-vite-supabase' })).blueprint);
  assert.deepStrictEqual(readFixJson('golden-react-vite-supabase.json'), live);
  assert.strictEqual(live.schema_version, '1.1');
  assert.strictEqual(live.technology_decision.status, 'CONFIRMED');
});
test('الملفات المرفوعة تطابق مخرجات المولّد حرفيًا (fixture drift = فشل)', () => {
  const gen = fixtureGen.generate();
  Object.keys(gen).forEach((n) => assert.strictEqual(readFix(n).replace(/\r\n/g, '\n'), gen[n], 'drift in ' + n));
});
test('تطابق SHA-256 مع manifest لكل fixture وملف عقد (readback)', () => {
  manifestV1.fixtures.forEach((f) => {
    assert.ok(/^[0-9a-f]{64}$/.test(f.sha256), 'sha256 must be 64-hex, never FNV');
    assert.strictEqual(sha256Lf(readFix(f.file)), f.sha256, f.file);
    ['fixture_id', 'fixture_version', 'producer_schema_version', 'producer_repository', 'producer_head', 'consumer_subset_version', 'expected_result', 'sha256', 'created_from'].forEach((k) => assert.ok(f[k] !== undefined && f[k] !== null && f[k] !== '', f.fixture_id + ' missing ' + k));
  });
  manifestV1.contract_files.forEach((c) => assert.strictEqual(sha256Lf(readFix(c.file)), c.sha256, c.file));
  assert.strictEqual(manifestV1.fnv_is_not_integrity_evidence, true);
  assert.ok(/^[0-9a-f]{40}$/.test(manifestV1.producer_base_head));
});
test('تتطابق نسخة المخطط في manifest وfixtures مع Blueprint الحي', () => {
  const live = compileProject(BASE_IN).blueprint.schema_version;
  assert.strictEqual(manifestV1.producer_schema_version, live);
  assert.deepStrictEqual(api.SUPPORTED_CONSUMER_BLUEPRINT_SCHEMA_VERSIONS.slice(), [live]);
});
test('الجدول: SUPPORTED_EXACT / SUPPORTED_ALIAS / UNSUPPORTED بلا تخمين أو مطابقة تقريبية', () => {
  const r = (stack) => oracle.resolveProfile(stack, mappingV1);
  assert.deepStrictEqual(r('react-vite-supabase'), { classification: 'SUPPORTED_EXACT', profile: 'react-vite-supabase' });
  assert.deepStrictEqual(r('  REACT-VITE-SUPABASE '), { classification: 'SUPPORTED_EXACT', profile: 'react-vite-supabase' });
  assert.deepStrictEqual(r('React + Vite + Supabase'), { classification: 'SUPPORTED_ALIAS', profile: 'react-vite-supabase' });
  assert.deepStrictEqual(r('React/Vite/Supabase'), { classification: 'SUPPORTED_ALIAS', profile: 'react-vite-supabase' });
  assert.deepStrictEqual(r('flutter-supabase'), { classification: 'SUPPORTED_EXACT', profile: 'flutter-supabase' });
  assert.deepStrictEqual(r('Flutter + Supabase'), { classification: 'SUPPORTED_ALIAS', profile: 'flutter-supabase' });
  ['react vite supabase', 'react-vite', 'react-vite-supabase-v2', 'React with Supabase', 'Vue + Supabase', 'generic', 'Django + PostgreSQL', ''].forEach((x) => {
    assert.strictEqual(r(x).classification, 'UNSUPPORTED', JSON.stringify(x) + ' must not be guessed');
    assert.strictEqual(r(x).profile, null);
  });
  assert.ok(mappingV1.classifications.indexOf('REQUIRES_DECISION') !== -1);
  ['CLOSE_ENOUGH', 'BEST_GUESS', 'AUTO_SUBSTITUTE'].forEach((x) => assert.ok(mappingV1.forbidden_behaviors.indexOf(x) !== -1));
  assert.ok(mappingV1.excluded.some((e) => e.profile_id === 'generic'));
});

section('BATCH A — fail-closed technology gate (no hidden inference)');

test('REQUIRES_DECISION يحجب حتى لو ذُكرت التقنية في نص الهدف أو كانت الـprofiles تلمّح إليها', () => {
  const r = compileProject({ project_name: 'تلميح', project_goal: 'تطبيق React Vite Supabase لإدارة المهام' });
  const sub = api.extractFactoryConsumerSubset(r.blueprint);
  assert.strictEqual(sub.technology_decision.status, 'REQUIRES_DECISION');
  assert.strictEqual(sub.technology_decision.stack, null);
  assert.strictEqual(sub.technology_decision.profile_hint, null);
  assert.strictEqual(evalSubset(sub).outcome, 'BLOCKED_REQUIRES_TECHNOLOGY_DECISION');
});
test('كل حالة غير CONFIRMED تحجب، والمصدر المستنتَج لا يصير CONFIRMED أبدًا', () => {
  const base = readFixJson('golden-react-vite-supabase.json');
  ['REQUIRES_DECISION', 'DEFERRED_WITH_GATE', 'NOT_APPLICABLE_WITH_RATIONALE'].forEach((st) => {
    const s = deepCopy(base); s.technology_decision.status = st;
    assert.strictEqual(evalSubset(s).outcome, 'BLOCKED_REQUIRES_TECHNOLOGY_DECISION', st);
  });
  ['INFERRED_DEFAULT', 'PROFILE', 'RULE', null].forEach((src) => {
    const s = deepCopy(base); s.technology_decision.source_type = src;
    assert.strictEqual(evalSubset(s).outcome, 'INVALID_BLUEPRINT', 'CONFIRMED with source ' + src);
  });
  const empty = deepCopy(base); empty.technology_decision.stack = '  ';
  assert.strictEqual(evalSubset(empty).outcome, 'INVALID_BLUEPRINT');
  const unknown = deepCopy(base); unknown.technology_decision.status = 'MAYBE';
  assert.strictEqual(evalSubset(unknown).outcome, 'INVALID_BLUEPRINT');
});
test('تقنية مؤكدة غير مدعومة = حجب صريح وليس INVALID ولا استبدال', () => {
  const s = deepCopy(readFixJson('golden-react-vite-supabase.json')); s.technology_decision.stack = 'Rust + Actix + SQLite';
  const r = evalSubset(s);
  assert.strictEqual(r.outcome, 'BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE');
  assert.notStrictEqual(r.outcome, 'INVALID_BLUEPRINT');
  assert.ok(!r.profile);
});
test('المخطط غير المدعوم يُفحص أولًا؛ المفقود/غير النصي = INVALID', () => {
  const g = readFixJson('golden-react-vite-supabase.json');
  ['1.0', '1.2', '2.0', '0.9', 'abc', '1.1.0'].forEach((v) => {
    const s = deepCopy(g); s.schema_version = v;
    assert.strictEqual(evalSubset(s).outcome, 'UNSUPPORTED_BLUEPRINT_SCHEMA', v);
  });
  const restructured = { schema_version: '3.0', something_else: true };
  assert.strictEqual(evalSubset(restructured).outcome, 'UNSUPPORTED_BLUEPRINT_SCHEMA', 'future schema must not be called invalid');
  const missing = deepCopy(g); delete missing.schema_version;
  assert.strictEqual(evalSubset(missing).outcome, 'INVALID_BLUEPRINT');
  const num = deepCopy(g); num.schema_version = 1.1;
  assert.strictEqual(evalSubset(num).outcome, 'INVALID_BLUEPRINT');
  [null, [], 'x', 5].forEach((bad) => assert.strictEqual(evalSubset(bad).outcome, 'INVALID_BLUEPRINT'));
});
test('حذف أي حقل مطلوب من الـsubset = INVALID_BLUEPRINT (وليس حجب تقنية)', () => {
  const g = readFixJson('golden-react-vite-supabase.json');
  api.FACTORY_CONSUMER_SUBSET_V1_FIELDS.filter((f) => f !== 'schema_version').forEach((f) => {
    const s = deepCopy(g); delete s[f];
    assert.strictEqual(evalSubset(s).outcome, 'INVALID_BLUEPRINT', 'missing ' + f);
  });
  const s = deepCopy(g); s.target_platforms = 'web';
  assert.strictEqual(evalSubset(s).outcome, 'INVALID_BLUEPRINT');
  const emptyPlatforms = deepCopy(g); emptyPlatforms.target_platforms = [];
  assert.strictEqual(evalSubset(emptyPlatforms).outcome, 'MATERIALIZATION_READY', 'empty target_platforms is legitimate');
});
test('المخطط JSON يتطابق مع الحقول المجمّدة', () => {
  const schema = readFixJson('consumer-subset-v1.schema.json');
  assert.deepStrictEqual(schema.required.slice().sort(), api.FACTORY_CONSUMER_SUBSET_V1_FIELDS.slice().sort());
  assert.deepStrictEqual(Object.keys(schema.properties).sort(), api.FACTORY_CONSUMER_SUBSET_V1_FIELDS.slice().sort());
  assert.deepStrictEqual(schema.properties.technology_decision.properties.status.enum, ['CONFIRMED', 'REQUIRES_DECISION', 'NOT_APPLICABLE_WITH_RATIONALE', 'DEFERRED_WITH_GATE']);
});
test('لا يوجد تنفيذ مستهلك/Adapter داخل Prompt Maker (النواة تُنتج العقد فقط)', () => {
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).map((f) => path.join(ROOT, 'src', f)).concat(fs.readdirSync(path.join(ROOT, 'bin')).map((f) => path.join(ROOT, 'bin', f)));
  srcFiles.forEach((f) => {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/MATERIALIZATION_READY|BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE|BLOCKED_REQUIRES_TECHNOLOGY_DECISION/.test(t), f + ' contains consumer outcomes');
  });
  assert.ok(!fs.readdirSync(path.join(ROOT, 'src')).some((f) => /factory.*adapter|consumer.*adapter|materializ/i.test(f)));
  assert.ok(!/extractFactoryConsumerSubset/.test(fs.readFileSync(path.join(ROOT, 'dist', 'core_bundle.js'), 'utf8')), 'subset projection is Node-side producer helper, not part of the browser bundle');
});

// ============================================================
(async () => {
  await Promise.all(pendingAsync);
  console.log('\n============================================================');
  console.log('النتيجة: ' + passed + ' ناجح، ' + failed + ' فاشل، من أصل ' + (passed + failed));
  console.log('============================================================');
  if (failed > 0) {
    console.log('\nالاختبارات الفاشلة:');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.error));
    process.exitCode = 1;
  }
})();
