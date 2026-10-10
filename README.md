# Prompt Maker — محرك Full-Production لتعريف المشاريع وتوليد البرومبت

أداة منفصلة، لا تُعدّل أي مشروع آخر. تأخذ وصف مشروع (اسم + هدف + حقول متقدمة اختيارية)
وتُخرج حزمة كاملة تصف **ما يجب بناؤه ولماذا**:

```text
ProjectIntent  →  Classification (تصنيف تلقائي لنوع المشروع)
               →  ProjectBlueprint (بنية، متطلبات، نموذج مجال، رحلات مستخدم...)
               →  AcceptanceContract  +  DevelopmentContract
               →  Master Prompt (model-agnostic — يصلح لأي نموذج ذكاء اصطناعي)
               →  GenerationReceipt (بصمة محتوى حتمية deterministic)
```

هذه **ليست** أداة "قالب ثابت + حقول متغيّرة". المحرك الأساسي (`src/`) يصنّف المشروع إلى
ملفات تعريف (Profiles) حسب وصفه، يستنتج منها مجموعة متطلبات حقيقية (Rules Engine)،
ويبني Blueprint مختلفًا فعليًا بحسب كل مشروع — لا نصًا ثابتًا يُستنسخ باسم مختلف.

الأداة القديمة (8 قوالب برومبت ثابتة لمهام محددة مسبقًا: GIS، استعادة وثائق، أتمتة
ملفات...) ما زالت موجودة في `templates/` وتُستخدم عبر `generate_prompt.py` — مسار بديل
أسرع لمهمة معروفة مسبقًا، لا يستخدم محرك التصنيف/القواعد.

## الاستخدام

### المحرك الكامل (Full-Production)
```bash
# CLI
node bin/prompt-maker.js new --input project.json --out ./out [--data-dir ./data]

# أو المتصفح — أمر واحد: الواجهة الموجَّهة + الـ Companion على أصل loopback واحد
npm run app                                  # ثم افتح http://127.0.0.1:8787/ وأدخل رمز الاقتران من الطرفية
npm run app -- --ollama-model <NAME>         # اختياري: نموذج محلي عبر Ollama (اقتراحات فقط، لا تُعتمد إلا بتأكيدك)
```
> تنبيه أمني: `tests/browser/static-server.js` أداة **اختبار فقط** — تستمع على كل الواجهات الشبكية ولا تمنع
> اجتياز المسارات (`..`). لا تستخدمها لتشغيل الواجهة؛ استخدم `npm run app` (قائمة بيضاء من الملفات، loopback فقط،
> `frame-ancestors 'none'`). الدليل: `evidence/gfpi-operational-mb1/` (OP-7).
يُنتج في `./out/`: `blueprint.json`، `acceptance_contract.json`،
`development_contract.json`، `master_prompt.md`، `receipt.json`.

### إعادة إنتاج الاختبارات من clone نظيف
```bash
npm ci                      # يثبّت playwright بالإصدار المقفل في package-lock.json
node tests/run.js           # اختبارات النواة (لا تحتاج متصفحًا)
node tests/browser/run.js   # UAT المتصفح (Playwright + Chromium)
```
الاعتماد الوحيد هو حزمة `playwright` الخام بإصدار مثبّت بدقة (لا `@playwright/test`).
متصفح Chromium نفسه يجب أن يكون متاحًا للحزمة: إما عبر `npx playwright install chromium`
أو بيئة تحتوي Chromium مُجمَّعًا (مثل `PLAYWRIGHT_BROWSERS_PATH`). النواة وCLI بلا
اعتماديات تشغيل (runtime).

### القوالب الثابتة (مسار سريع، مهام معروفة)
```bash
python3 generate_prompt.py
```

## البنية
```text
prompt-maker/
├── src/                       # النواة الكندية (Node/CommonJS) — مصدر الحقيقة الوحيد
│   ├── core.js                 # ProjectIntentV1 / ProjectContextV1
│   ├── profileRegistry.js      # 18 ملف تعريف منفَّذ + 4 بقرار صريح (حذف/تأجيل)
│   ├── classificationEngine.js # تصنيف بالكلمات المفتاحية + قمع إشارات سلبية
│   ├── rulesRegistry.js        # سجل قواعد المتطلبات (الأعداد الحية: node tools/metrics.js)
│   ├── applicabilityEngine.js  # تحديد انطباق كل قاعدة + مصدرها (Provenance)
│   ├── blueprintCompiler.js    # ProjectBlueprintV1 الكامل
│   ├── brownfieldEngine.js     # تقييم فجوات نصي لمشروع قائم
│   ├── contractBuilders.js     # AcceptanceContract + DevelopmentContract
│   ├── promptCompiler.js       # Master Prompt model-agnostic
│   ├── validationEngine.js     # فحص أسرار/تعارضات/Unknown معيق أو غير معيق
│   ├── receipt.js              # بصمة محتوى حتمية (FNV-1a، غير تشفيرية عمدًا)
│   ├── versioning.js           # كشف تغيّر بين توليدات متتالية (على مستوى البصمة)
│   ├── adapters.js             # Ports/Adapters: تخزين حقيقي على نظام ملفات
│   └── index.js                # compileProject() — نقطة الدخول الوحيدة
├── build.js                    # src/* → dist/core_bundle.js (مصدر حقيقة واحد؛ أي
│                                  تعديل في src بلا إعادة بناء يُفشل الاختبار الآلي)
├── bin/prompt-maker.js         # واجهة سطر الأوامر
├── dist/
│   ├── core_bundle.js           # مولَّد تلقائيًا — لا تُعدّله يدويًا
│   └── prompt-maker-app.html    # واجهة المتصفح (Simple/Professional)
├── tests/run.js                 # اختبارات Node (منطق، تكامل، حتمية)
├── tests/buildFreshness.test.js # بوابة STALE_GENERATED_BUNDLE
├── tests/browser/run.js         # اختبارات متصفح حقيقية (Playwright + Chromium)
├── templates/ + generate_prompt.py + references/examples/  # الأداة القديمة (قوالب ثابتة)
└── docs/FUTURE_EXTERNAL_INTEGRATION_GUIDE.md  # عقود الاستيراد/التصدير العامة
```

## تشغيل الاختبارات
```bash
node tests/run.js           # منطق النواة + التكامل + الحتمية (Node)
node tests/buildFreshness.test.js  # بوابة تقادم الـbundle وحدها
node tests/browser/run.js   # متصفح حقيقي (Chromium عبر Playwright)
node build.js                # إعادة بناء dist/core_bundle.js من src/ الحالي
```

## مبادئ حاكمة (غير قابلة للتفاوض)
- **INFERRED != CONFIRMED**: كل تصنيف تلقائي مُعلَّم `INFERRED_DEFAULT` حتى يراجعه
  المستخدم ويؤكده (`CONFIRMED`).
- **UNKNOWN != PASS**: لا PASS صافٍ عند وجود قرارات معلّقة (`required_decisions`).
- **Blueprint/Prompt/Contract != سلطة تنفيذ**: `production_readiness_target` هدف لا
  شهادة، ولا يُفترض `TRUE` من المحرك نفسه أبدًا.
- **Textual brownfield != فحص مصدر حقيقي**: تقييم Brownfield نصي من وصف المستخدم،
  وليس تحليل كود فعلي — موسوم `ASSUMED` لا `CONFIRMED`.
- **نواة عامة بلا اعتماد خاص**: `src/*.js` لا يذكر أي مشروع خاص آخر — مفروض باختبار
  آلي دائم (core-leakage regression).

## الرحلة الكاملة في الواجهة الموجّهة (`npm run app`)
فكرة جديدة **أو مشروع قائم** (بطاقة «نوع المشروع»: وصف نصي يُعرض كـ `ProjectContextV1` ويُؤكَّد ببصمته) → أسئلة موجّهة →
تأكيد القرارات → حزمة (Blueprint 1.1 + عقدا القبول والتطوير + Master Prompt، تُقرأ داخل التطبيق) → طبقة الإنتاج الكامل/SaaS →
حفظ تلقائي، إصدارات ومقارنة، و«ملف المشروع: تصدير / فتح» بتحقق كامل من البصمات.

- حزمة تشغيل مرشحة بلا اعتماديات: `node tools/buildReleaseCandidate.js` (انظر `START_HERE.md` داخل الحزمة).
- إثبات التكامل مع Project Factory من Blueprint مولَّد بالواجهة: `FACTORY_DIR=… npm run uat:factory -- --out DIR`.
- اختبار الرحلة في متصفح حقيقي: `npm run test:browser:product`.
- اكتمال المواصفات لا يثبت أن التطبيق الذي ستبنيه جاهز للإنتاج.

## GFPI-V1 (الاكتشاف الموجَّه) — إضافة
انظر `docs/GFPI_V1.md`. تشغيل: `npm run build:gfpi && npm run test:gfpi && npm run test:browser:gfpi`. الواجهة: `dist/guided.html`.
التشغيل المحلي الفعلي (Local Companion، Ollama، فحص حقيقي يولّد دليلًا): `docs/LOCAL_OPERATIONS_AR.md`.
