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
