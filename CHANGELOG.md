# سجل التغييرات

## [1.2.0-dev] — PM-FULL-PRODUCTION-INTEGRATED-V1 (CANDIDATE — BUILT_NOT_INTEGRATED)

فرع `task/pm-factory-full-production-integrated-v1` من `main@6b51049`. لا دمج، لا إصدار، لا ترقية لخط الأساس، لا رفع لـ VERSION.
المرشح المقابل في Factory: `task/factory-vite-env-fix-v1` (إصلاح TS2339 فقط).

### أُضيف / أُصلح (نواقص مثبتة في الواجهة الأساسية `dist/guided.html`)
- **G1 مشروع قائم**: النواة تقبل `ProjectContextV1` وتقيّم brownfield، لكن الواجهة لم تمررهما. بطاقة «نوع المشروع» → نموذج → عرض
  `ProjectContextV1` الحرفي وبصمته → تأكيد بشري مربوط بالبصمة (`gfpi/projectRecord.js`)، فشل مغلق عند أي عبث. لم يتغير كتالوج
  القرارات (21 بندًا) ولا `src/`. يضاف إلى Master Prompt الحزمة قسم «تعديل لا بناء من الصفر» للمشروع القائم المؤكد فقط
  (حزم المشاريع الجديدة مطابقة بايتيًا لـ main). الحزمة المبنية بسياق أقدم تُعلَّم ولا تُعتمد حتى إعادة إنشائها.
- **G2 الحفظ وإعادة الفتح**: تصدير المشروع كاملًا إلى ملف وفتحه بعد إعادة حساب كل البصمات وسلاسل السجلين والاعتماد والسياق؛
  لا يستبدل نسخة محلية مختلفة أبدًا.
- **G3 390px**: السؤال الحالي قبل قائمة البنود في الشاشة الأولى (كان على بعد ≈1700px)، تبويبات مضغوطة، شارات حالة بسطر واحد.
- **G4** عرض Master Prompt وBlueprint داخل تبويب الحزمة.
- أداة إثبات التكامل `tools/uat/pmFactoryIntegration.js`، ومُحزِّم المرشح `tools/buildReleaseCandidate.js`، وخطوة CI للرحلة.

### اختبارات
`tests/gfpi/s16.test.js` (11)، `tests/browser/pm_product.run.js` (18). الأعداد الكاملة والأدلة: `evidence/pm-factory-integrated-v1/`.

### حدود صريحة
- بناء npm للمشروع المولَّد وFlutter وWindows: `NOT_RUN` في بيئة التطوير (سجل npm محجوب، لا Flutter، Linux) — `docs/WINDOWS_INTEGRATION_VERIFICATION_AR.md`.
- Human UAT: `PENDING_HUMAN_EXECUTION`.


## [1.2.0-dev] — GFPI-V1 Windows Operational Closure (BUILT_NOT_INTEGRATED)

فرع `task/gfpi-v1-windows-operational-closure` من `main@0af3524`. لا دمج، لا إصدار، لا وسم.

### أُصلح (عيوب مثبتة؛ أدلة قبل/بعد في `evidence/gfpi-windows-closure/`)
- **W-OLLAMA** (Futuer-IT: 2 × TIMEOUT ≈ 120 ث، exit 5): مهلة خمول مقبس خفية 60 ث غير موصولة بـ `--timeout-ms`، والرد غير المتدفق لا يرسل بايتًا قبل نهاية التوليد؛ ثم إعادة المحاولة تكرر العمل نفسه. صارت المحادثة متدفقة (NDJSON) بحد خمول بين الرموز وميزانية المحاولة الحقيقية، ولا تُكرَّر محاولة محلية انتهت مهلتها، ويُقاس تحميل النموذج منفصلًا (`warmUp`)، وتُسجَّل تشخيصات كل محاولة، ويُرسل مخطط الإخراج كـ `format` (رجوع إلى `"json"` للإصدارات الأقدم). التحقق من المخطط لم يُخفف.
- **W-CRED** مخزن الأسرار أعاد `UNSUPPORTED_PLATFORM` على Windows: صار DPAPI بنطاق المستخدم الحالي عبر stdin فقط، مربوطًا بالمرجع، مقاومًا للعبث، بفشل مغلق ودون أي بديل غير مشفر؛ وأمر `credential-selftest` لإثباته على Windows بقيم اصطناعية.
- **W-REPRO** `core.autocrlf=true` كسر البوابات البايتية (Node 123/125، GFPI 164/171، انحراف مجمّد، حزم قديمة): `.gitattributes` بـ `eol=lf` دون تغيير أي محتوى أو بصمة.
- **T-1** تقوية الخاصية: إلغاء محلي لا يتصعّد إلى مزوّد خارجي معتمد وموافَق عليه، مع ضابط يثبت إمكان الوصول.
- **N-2** `localhost` = ‎::1 + 127.0.0.1: اختيار عائلة العنوان تلقائيًا لنقطة Ollama؛ الـ Companion يبقى على 127.0.0.1 فقط.
- **N-3** Actions مثبتة بـ SHA وتعمل على node24 (checkout v7.0.1، setup-node v7.1.0، upload-artifact v7.0.2) بعد التحقق من المصدر.

### سُجِّل (خارج النطاق)
- عائق Factory مستقل: قالب `react-vite-supabase` بلا `src/vite-env.d.ts` (TS2339) — `docs/FACTORY_INTEGRATION_BLOCKER_VITE_ENV_AR.md`.

### حدود صريحة
- لم يُختبر هذا الفرع على Windows/Ollama حقيقيين بعد: التسليم في `docs/WINDOWS_RUNTIME_VALIDATION_HANDOFF_AR.md`.

## [1.2.0-dev] — GFPI-V1 Operational Productization MB1 (BUILT_NOT_INTEGRATED)

فرع `task/gfpi-v1-operational-productization-mb1` من `main@a950759`. لا دمج، لا إصدار، لا وسم، لا ادعاء جاهزية إنتاج.

### أُصلح (عيوب مثبتة بإعادة إنتاج قبل/بعد في `evidence/gfpi-operational-mb1/`)
- **OP-1** المهلة لم تُجهض المحاولة؛ إعادة المحاولة كانت تعمل بالتوازي معها فتُحمّل النموذج المحلي بطلبين ويبقيان حيّين بعد انتهاء التشغيل. صارت كل محاولة بـ AbortSignal يصل إلى نقل Ollama والمستضاف؛ سياسة إعادة المحاولة كما هي.
- **OP-2** لا إلغاء: انقطاع المتصفح لم يوقف التشغيل. أُضيف `run(task, {signal})` → `CANCELLED` (بلا سقوط إلى مزوّد آخر أو خارجي)، و`POST /v1/cancel`، والإجهاض عند انقطاع العميل أو إلغاء الجلسة أو الإيقاف.
- **OP-3** طلبات متزامنة كلها تصل النموذج المحلي. صار تنفيذ واحد في وقت واحد (عام، `409 RUN_IN_PROGRESS`).
- **OP-4** الواجهة بقيت «مقترن» بعد انتهاء الجلسة أو توقف الـ Companion، وعرضت «فشل المزوّد». صارت تعرض «انقطع الاتصال» وتعود إلى «غير مقترن».
- **OP-5** النقر المزدوج أطلق تشغيلين، ولا زر إلغاء. صار طلب واحد مع إلغاء حقيقي.
- **OP-6** النموذج غير المثبت كان يُعلن «متاحًا» ويستهلك استدعاءً فاشلًا. أُضيف `probe()` بمطابقة اسم حرفية، وحالة توفر لكل مزوّد في `/v1/status`، والواجهة لا تحسب إلا `READY`.
- **OP-7** الـ README وجّه المستخدم إلى خادم اختبار يستمع على كل الواجهات ويسمح باجتياز `..`. البديل `npm run app`: قائمة بيضاء من 5 ملفات على أصل loopback للـ Companion مع `frame-ancestors 'none'`.

### أُضيف
- `npm run app` (واجهة + Companion بأمر واحد، رمز اقتران جديد بزر Enter)، و`companion/cli.js probe` (دليل `LocalProviderProbeEvidenceV1`: MODEL_AVAILABLE ≠ EVALUATED ≠ ADMITTED ≠ PRODUCTION_READY)، و`--timeout-ms` و`--ollama-endpoint`.
- `docs/LOCAL_OPERATIONS_AR.md`؛ سيناريوهان اختياريان 6-7 في حزمة UAT البشرية.
- اختبارات: GFPI 149 → 171 (S13، S14)، متصفح GFPI 31 → 38؛ الأصلية (125 + 30) والإنتاجية 26 دون تغيير.

### حدود صريحة
- Ollama حقيقي، Windows، مخزن أسرار النظام، بناء التطبيق المولَّد (npm 403)، Flutter: `BLOCKED_WITH_EVIDENCE` / `NOT_PROVEN` في بيئة البناء. مزوّد مستضاف: غير مصرّح. أداء النماذج: NOT_EVALUATED. UAT البشري: مؤجل.

## [1.2.0-dev] — GFPI-V1-MB1: الاكتشاف الموجَّه وذكاء المواصفات الإنتاجية (BUILT_NOT_INTEGRATED)

### أُضيف (إضافي بالكامل؛ الملفات المجمّدة دون أي تغيير)
- `gfpi/`: بصمة SHA-256 متزامنة وcanonical JSON، سجل 13 نوع عقد إضافي مع مخططات JSON مولَّدة (`schemas/gfpi/`)، آلة حالات القرار، سجل قرارات متسلسل بالبصمات (استرداد من انهيار، كشف عبث)، خطة أسئلة ثابتة ثنائية اللغة، مصفوفة قدرات بلا مزوّد، تنقيح الأسرار، سياسة ميزانية (صفر مدفوع)، طبقة مزوّدين محايدة (يدوي/مسجَّل/محلي/مستضاف-إعداد فقط) بموافقة أحادية الاستخدام مرتبطة بالحمولة، مُجمِّع مواصفات مع تتبّع كل بوابة قبول، حزمة تنفيذ الوكيل بموافقة بشرية مرتبطة بـSHA-256.
- `companion/`: خادم loopback فقط (اقتران، Origin/Host صارم، رموز بنطاق ومدة، حد معدل وحجم)، مخزن اعتماد (OS عبر stdin؛ NOT_PROVEN على مفاتيح حقيقية)، محوّل Ollama متوافق (loopback فقط)، محوّل مستضاف (إعداد فقط؛ PAID_CALLS_NOT_AUTHORIZED).
- `dist/guided.html` + `dist/gfpi_bundle.js`: واجهة موجَّه/بمساعدة/خبير، عربية RTL مع تكافؤ إنجليزي، حفظ وإصدارات ومقارنة وتصدير/تحقق.
- `eval/`: مجموعة تقييم مرشّحة (64 حالة، 8 شرائح، 16 محجوزة) بحالة `REVIEW_PENDING`، حوكمة مراجعة، أداة قياس وبوابات قبول لا تقبل شيئًا دون تشغيل حقيقي ومجموعة ACCEPTED.
- `tools/uat/gfpiFactoryUat.js`: UAT مشترك (واجهة حقيقية → Factory consumer حقيقي) 12 سيناريو.
- اختبارات: GFPI 107، متصفح GFPI 31؛ الاختبارات الأصلية (125 + 30) دون تغيير.

### حدود صريحة
- لا مزوّد حقيقي ولا مفتاح ولا Ollama حقيقي ولا OS keychain حقيقي في بيئة البناء: كل ذلك MOCKED/NOT_PROVEN. لم يُقَس أداء أي نموذج.
- توليد الحزمة لا يثبت جاهزية الإنتاج.

## [1.2.0-dev] — محرك Full-Production + مصالحة Frontend/Core + UAT متصفح حقيقي

### أُضيف — PM-UI-TECH-DECISION-V1: اختيار التقنية الصريح في الواجهة
- محدد تقنية في الواجهة الأساسية: «غير محدد» افتراضيًا، `react-vite-supabase`، `flutter-supabase`، أو «أخرى (إدخال يدوي)» تُسجَّل حرفيًا بعد trim (سطر واحد، ≤5000) دون أي استبدال صامت. التصنيف (مدعوم/غير مدعوم) يتم لدى المستهلك وفق PROFILE_MAPPING_V1؛ الواجهة لا تدّعي دعمًا.
- الحفظ/إعادة الفتح/مقارنة النسخ تشمل `preferred_technology`.
- قسم «قرار التقنية» في Master Prompt يُعرَض من `blueprint.technology_decision` فقط (CONFIRMED حرفيًا كسلسلة JSON أحادية السطر، أو REQUIRES_DECISION) دون ادعاء دعم Factory.
- تحقق طول `preferred_technology` (≤5000) في النواة. Blueprint يبقى 1.1؛ العقود والـfixtures والتعيين دون تغيير.
- إصلاح عيب سابق اكتُشف في UAT المشترك: الواجهة كانت ترسل `users`/`roles`/`target_platforms` كمصفوفات فتتحول إلى `[[]]` في Blueprint ويرفضها Factory كـINVALID_BLUEPRINT حتى مع تقنية مدعومة؛ صارت تُرسَل كنص أو null (اختبار انحدار مثبت بتجربة تعطيل).
- اختبارات: 7 Node جديدة (125) و12 اختبار متصفح جديد (30) تشمل XSS وaliases وعدم الاستنتاج وسطحي 1280/390px.

### أُضيف — الدفعة A: عقد مستهلك Project Factory (مُجمَّد)
- `FACTORY_CONSUMER_SUBSET_V1` (`src/consumerSubset.js`) و`PROFILE_MAPPING_V1` وmanifest بـSHA-256 وfixture ذهبي حقيقي (React/Vite/Supabase) و4 fixtures سلبية في `tests/fixtures/factory-consumer/`.
- مُولِّد fixtures (`tools/generateFactoryConsumerFixtures.js`) ومُقيِّم اختبار فقط (`tests/helpers/factoryConsumerOracle.js`) — ليس adapter.
- 16 اختبارًا جديدًا (الإجمالي 118). لا تغيير في `dist/` ولا في Blueprint 1.1.

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
