# البنية (Architecture)

## المبدأ: مصدر حقيقة واحد

```
src/*.js  (Node/CommonJS، النواة الكندية الوحيدة)
    │
    ├──► bin/prompt-maker.js        (CLI — يستهلك src/ مباشرة عبر require)
    │
    └──► build.js  ──►  dist/core_bundle.js  ──►  dist/prompt-maker-app.html
           (بناء حتمي، bundle مولَّد — لا يُعدَّل يدويًا، محمي ببوابة STALE_GENERATED_BUNDLE)
```

لا يوجد تطبيقان لمنطق التصنيف/القواعد/الـBlueprint. `dist/prompt-maker-app.html`
يُحمِّل `core_bundle.js` كملف `<script>` خارجي ويستهلك `window.PM.*` فقط — لا منطق
محرك مكرور داخل HTML. هذا كان إصلاحًا لمشكلة سابقة (نسخة قديمة من الواجهة كانت
تحتوي كل منطق المحرك ملصوقًا مباشرة داخل الصفحة، فانحرف عن `src/` بمرور الوقت).

## بوابة STALE_GENERATED_BUNDLE

`build.js` يحسب بصمة (`fingerprint`, FNV-1a) من محتوى `src/*.js` المُدمَج، ويُضمِّنها
في `core_bundle.js` كـ `BUNDLE_SOURCE_HASH`. اختبار `tests/buildFreshness.test.js`
يُعيد حساب البصمة من `src/` الحالي ويُقارنها بالمُضمَّنة — يفشل بوضوح
(`STALE_GENERATED_BUNDLE: ...`) إن نسي أحد تشغيل `node build.js` بعد تعديل `src/`.
تم التحقق من عمل هذه البوابة فعليًا (لا افتراضًا) بإفساد البصمة المُضمَّنة عمدًا
ومراقبة فشل الاختبار، ثم استعادتها.

## المنافذ والمحوّلات (Ports & Adapters)

| المنفذ | التطبيق الحقيقي (Node) | التطبيق في المتصفح |
|---|---|---|
| `ProjectRepository` (save/load/list/remove) | `createFileProjectRepository` — `fs` فعلي | نسخة in-memory مكافئة داخل `core_bundle.js` |
| `ExportAdapter` (exportFile) | `createFileExportAdapter` — يكتب ملفًا فعليًا | تنزيل عبر `Blob` + `URL.createObjectURL` + نقرة وهمية |

نفس الواجهة (interface)، تطبيقان مختلفان — لا تكرار لمنطق الأعمال، فقط لمنطق
التخزين/التصدير البيئي.

## خط الأنابيب (Pipeline) الكامل

```
rawInput → makeProjectIntentV1 → validateProjectIntentV1
         → classifyProject (ProjectProfileV1[])
         → computeApplicability (requirements_by_domain)
         → assessBrownfield (إن existing_project)
         → compileBlueprint (ProjectBlueprintV1)
         → buildAcceptanceContract + buildDevelopmentContract
         → renderMasterPrompt
         → validateCandidate (status: PASS_WITH_EXPLICIT_UNKNOWNS | BLOCKED_REQUIRES_DECISION)
         → buildReceipt (GenerationReceiptV1، بصمات حتمية)
```

`compileProject(rawInput, options)` في `src/index.js` هو نقطة الدخول الوحيدة
(`{ok:true, intent, classification, blueprint, acceptanceContract,
developmentContract, prompt, validation, receipt}` أو `{ok:false, errors}`).

## نمط المعمارية المقترح للمشروع المُولَّد (ليس لـPrompt Maker نفسه)

`architectureCompiler.js` يقترح أحد 5 أنماط مرجعية عامة (Layered، Clean/Hexagonal،
Event-Driven، Microservices، Modular Monolith) حسب ملفات التعريف المطابقة — اقتراح
قابل للتجاوز من المستخدم، لا قرار نهائي مُلزَم.
