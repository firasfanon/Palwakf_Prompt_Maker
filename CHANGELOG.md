# سجل التغييرات

## [1.2.0-dev] — محرك Full-Production + مصالحة Frontend/Core + UAT متصفح حقيقي

### أُضيف
- محرك Project Definition Compiler كامل: تصنيف (`classifyProject`)، قواعد متطلبات
  (الأعداد الحية: `node tools/metrics.js`)، Blueprint (`compileBlueprint`)، عقدا قبول/تطوير
  (`AcceptanceContractV1`/`DevelopmentContractV1`)، مُجمِّع برومبت model-agnostic،
  إيصال توليد حتمي (`GenerationReceiptV1`)، إصدارات (`createProjectVersion`/
  `compareVersions`)، دعم Brownfield (مشروع قائم) نصي صريح الحدود.
- 18 ملف تعريف منفَّذ (4 جديدة هذه الدفعة: `DESKTOP_APPLICATION`, `LEGAL_SYSTEM`,
  `RESEARCH_SYSTEM`, `CONTENT_PLATFORM`) + 4 قرارات صريحة (حذف/تأجيل بسبب مكتوب).
- Ports/Adapters حقيقية على نظام الملفات (`createFileProjectRepository`,
  `createFileExportAdapter`) بجانب نسخ in-memory للاختبار.
- `build.js`: بناء حتمي لـ`dist/core_bundle.js` من `src/*.js` + بوابة
  `STALE_GENERATED_BUNDLE` آلية (`tests/buildFreshness.test.js`) تمنع انحراف
  الواجهة عن النواة صمتًا.
- إعادة كتابة كاملة لـ`dist/prompt-maker-app.html` لتحميل `core_bundle.js`
  خارجيًا بدل تكرار منطق المحرك داخل الصفحة (إصلاح جذر مشكلة الانحراف).
- `tests/browser/run.js`: UAT حقيقي (ليس محاكاة) عبر Playwright+Chromium —
  12 سيناريو مطلوب، بما فيها استجابة 1280px/390px وفحوصات إتاحة آلية.
- `docs/`: `FUTURE_EXTERNAL_INTEGRATION_GUIDE.md` (عام تمامًا، بلا أي اعتماد خاص)،
  `INTEGRATION_CONTRACTS.md`، `AUTHORITY_BOUNDARY.md`، `ARCHITECTURE.md`،
  `PROFILE_REGISTRY.md`، `RULE_ENGINE.md`، `PROMPT_COMPILER.md`،
  `TEST_STRATEGY.md`، `BROWSER_UAT.md`، `PROJECT_BLUEPRINT_SCHEMA.md`.

### أُصلح
- كذبة إيجابية في تصنيف `FINANCIAL_SYSTEM` (كلمة "فواتير" في سياق عيادة/حجز) —
  أُصلحت بـ`negative_keywords` + سقف ثقة للملفات الحساسة.
- تسرّب اسم مشروع آخر داخل تعليقات/نصوص نواة `src/*.js` — مُزال، ومحروس الآن
  باختبار regression آلي دائم.

### السياق
هذه دفعة إغلاق (closeout) ضمن نطاق محدود صريح: لا SaaS، لا حلقة agentic، لا ميزات
منتج كبرى جديدة، لا تعديل لمشروع آخر، لا دمج في `main`. البقاء على فرع
`development/full-production-engine`.

### التوافق
امتداد غير كاسر لمعظم العقود الحالية؛ تغيير داخلي واحد في شكل
`architecture_constraints`/`data_constraints`/... في `DevelopmentContractV1` (من
نص حر إلى `{source_id, constraint}`) — موثَّق في `INTEGRATION_CONTRACTS.md`.
**MINOR مع ملاحظة توافق داخلية.**

## [1.1.0] — استبدال قالب الصور بقالب ترميم الوثائق

### أُضيف
- `damaged-document-restoration.md`: قالب أصلي (لا منقول من مصدر خارجي) لترميم وضوح
  الوثائق والمخطوطات التالفة — نص/ورق فقط، مع حظر صريح لأي تعديل على صور بشرية ومنع
  اختلاق أي نص غير مقروء (يُترك [غير مقروء] صراحة).

### السياق
النسخة الأولى من المثال 7 ("استعادة صور فورنسية") طلبت إعادة بناء وجوه من تسجيلات مراقبة
ضبابية — رُفضت ولم تُحفَظ (مخاطر تضليل وخصوصية). أوضح المستخدم أن الحاجة الفعلية مختلفة:
ترميم وثائق تالفة لا وجوه. هذا الإصدار يضيف القالب البديل المشروع بدلًا منها.

### التوافق
لا كسر توافق — إضافة قالب ثامن فقط. **MINOR**.

## [1.0.0] — الإصدار الأول الكامل

### أُضيف
- 7 قوالب برومبت جاهزة عبر مجالات متعددة (بحث تاريخي/GIS، أتمتة ملفات، تنظيم ملفات، تنظيف
  بيانات جغرافية، تحويل Figma لكود، بناء تطبيقات كاملة، خرائط أثرية ثلاثية الأبعاد).
- `generate_prompt.py`: أداة سطر أوامر تكتشف متغيرات أي قالب تلقائيًا وتولّد البرومبت النهائي.
- `app.html`: تطبيق ويب تفاعلي كامل (منشور كـArtifact) — اختيار قالب، نموذج ديناميكي حسب
  متغيرات القالب، توليد ونسخ البرومبت، عرض ملاحظات الترخيص والمرفقات المطلوبة تلقائيًا.
- `references/examples/`: النصوص الأصلية الكاملة لكل قالب + تحليل ثابت/متغيّر + `CATALOG.md`.
- دعم حقلي `license` و`note` في frontmatter القوالب — تُعرَض تلقائيًا في الواجهة.

### مرفوض عمدًا
- برومبت "استعادة صور فورنسية" (إعادة بناء وجوه من تسجيلات مراقبة ضبابية) — غير مُدرَج
  لمخاطر تضليل وانتهاك خصوصية حقيقية. موثّق في `CATALOG.md` دون محتوى فعلي.

### ملاحظة ترخيص
قالبا `idea-to-full-webapp` و`archaeological-3d-gis-map` مرخّصان من معِدهما الأصلي
للاستخدام الأكاديمي/التعليمي فقط — الاستخدام التجاري ممنوع دون إذن شخصي مسبق. **يُنصح
بإبقاء هذا المستودع خاصًا (Private) على GitHub.**
