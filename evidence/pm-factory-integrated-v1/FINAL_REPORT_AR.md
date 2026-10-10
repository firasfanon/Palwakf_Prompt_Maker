# التقرير النهائي الموحّد — PALWAKF_PROMPT_MAKER_FACTORY_FULL_PRODUCTION_INTEGRATED_DELIVERY_V1

**إلى:** ChatGPT (المراجع النهائي المستقل) · **من:** Claude (المنفّذ الهندسي) · **التاريخ:** 2026-10-11
**الحالة المطلوبة للمراجعة:** `CANDIDATES_BUILT — NOT_MERGED — NOT_RELEASED — NOT_BASELINE — HUMAN_UAT_PENDING`

> لا دمج في main، لا وسم، لا إصدار، لا ترقية لخط الأساس، لا force-push، لا رفع لـ VERSION، لا اعتمادات حقيقية ولا استدعاءات مزوّد مدفوع،
> لا تعديل على Workspace/Mind/Agentic/OS، لا تطوير لأداة GFPI Harness، ولم تُشغَّل اختبارات G4.

## 1. المراجع والفروع

| | Prompt Maker | Project Factory |
|---|---|---|
| المستودع | `firasfanon/Palwakf_Prompt_Maker` | `firasfanon/palwakf-project-factory` |
| الأساس (تحقق حي مطابق للتفويض) | `main@6b51049587d14d196ebec0f4d1458a63d344d8ce` | `main@2e203c5127e18f5d33a6c4bea1bcf6bbcc186558` (tree `b09963fe…2646` ✔) |
| فرع المهمة | `task/pm-factory-full-production-integrated-v1` | `task/factory-vite-env-fix-v1` |
| HEAD الكود المختبَر | `20f61a8956aadd5f16953c42abefbd627c12234f` (tree `a8170264ecd2f29b17a4040d29abaadd9de36013`) | `c8b264eaaf2857b43aced0c3ee36a9f01daa0545` (tree `4248eca9e20aff57f29f9398de6614088a4f5f7b`) |
| HEAD النهائي للفرع | التزام أدلة فوق `20f61a8` يضيف `evidence/pm-factory-integrated-v1/` فقط (يُذكر في رسالة التسليم وفي البندل) | = HEAD الكود |
| الفرق | 18 ملفًا، +1348/−27 — `pm_diff_vs_base_excl_generated_bundle.patch` | 4 ملفات، +157/−1 — `factory/factory_diff_vs_base.patch` |

FACTORY_VERSION بقي `1.1.0`. ProjectBlueprintV1 = `1.1`، FACTORY_CONSUMER_SUBSET_V1 = `1`، Factory pinned producer = `f659f92d…c84` — **لم يتغير شيء منها**.

## 2. مرشح Factory (الإصلاح المحدود فقط)
- المضاف: `profiles/react-vite-supabase/scaffold/src/vite-env.d.ts` (مرجع `vite/client` + نوعا `VITE_SUPABASE_URL/ANON_KEY`). لم يُستخدم `compilerOptions.types`.
- لم يتغير: `consumer/adapter.py`، العقود، الـpins، الـfixtures، `generate.sh`، `substitute.py`.
- الاختبارات: 53/53 (48 قائمة + 5 جديدة في `tests/test_vite_env_fix.py`). اختبار التكافؤ مع `9aeff39` صار يسمح **بإضافة واحدة بعينها** ويشترط تطابق كل ما عداها.
- تجربة ضابطة (`factory/ts2339_control_experiment.log`): مشروع مولَّد بلا الملف ⇒ `TS2339` ×2 (exit 2)؛ مع الملف ⇒ exit 0.

## 3. مرشح Prompt Maker — النواقص المثبتة التي أُصلحت
| # | النقص المثبت (قبل) | الإصلاح | الدليل |
|---|---|---|---|
| G1 | الواجهة الأساسية لا تسمح بوصف **مشروع قائم** رغم أن النواة تقبل `ProjectContextV1` وتقيّم brownfield (`toCompileInput` لا يمرر أي سياق) | بطاقة «نوع المشروع» → نموذج → عرض `ProjectContextV1` الحرفي وبصمته → تأكيد بشري مربوط بالبصمة؛ فشل مغلق عند أي عبث. قسم «تعديل لا بناء من الصفر» في Master Prompt للمشروع القائم المؤكد فقط. حزمة مبنية بسياق أقدم تُعلَّم ولا يظهر زر اعتمادها | s16 (11)، pm_product (18)، `integration` existing_react |
| G2 | الحفظ في المتصفح فقط؛ «الاستيراد» يفحص حزمة ولا يعيد فتح مشروع | «ملف المشروع: تصدير / فتح»: إعادة حساب كل بصمة (حزم، مستندات، Master Prompt، اعتماد، سياق) وسلسلتي السجل، رفض الذيل الممزق، **لا استبدال لنسخة محلية مختلفة** | مصفوفة عبث من 15 صنفًا (s16)، فتح في ملف تعريف متصفح جديد (pm_product) |
| G3 | على 390px يبدأ السؤال على بعد ≈1698px تحت قائمة 21 بندًا؛ شارات الحالة مشوهة | السؤال أولًا (≈722px عربي، ≈814px إنجليزي داخل الشاشة الأولى 844px)، تبويبات مضغوطة، شارات بسطر واحد | `screens/product_journey/m390_*`، pm_product |
| G4 | Master Prompt وBlueprint لا يُقرآن إلا بالتنزيل | عرض داخل تبويب الحزمة مع إدارة التركيز | pm_product |

ثبات ما لم يُطلب تغييره: كتالوج القرارات (21 بندًا) و`src/` والملفات المجمدة الـ33 لم تتغير؛ **حزمة المشروع الجديد مطابقة بايتيًا لـ main**
(`tests/new_project_package_equivalence_main_vs_branch.txt`: `3ea0b25b…88a3` في الحالتين).

بنود الرحلة 1–8: (1) فكرة جديدة/مشروع قائم ✔ G1 · (2) التصنيف والاكتشاف الموجّه: قائم ومختبر (GFPI 201، الإنتاج 26) · (3) مراجعة القرارات وتأكيدها: قائم + تأكيد السياق ·
(4) Blueprint والعقود وMaster Prompt ✔ · (5) الإنتاج/SaaS/الجاهزية/الحارس/أثر القرارات: قائم ومختبر (26) · (6) الحفظ والإصدارات وإعادة الفتح والتصدير ✔ G2 ·
(7) AR/EN، RTL/LTR، Desktop/390 ✔ G3 · (8) حزمة تشغيل مرشحة ✔ (§5).

## 4. التكامل المشترك (Prompt Maker UI → Factory)
`integration/` — `tools/uat/pmFactoryIntegration.js` على Factory `c8b264e`: **115 فحصًا منفذًا، 0 فشل، 3 NOT_RUN**. كل Blueprint نُزِّل من زر «تنزيل Blueprint» في الواجهة.

| السيناريو | القرار | evaluate/materialize | الملف التقني |
|---|---|---|---|
| React جديد (Desktop) و(390px) | CONFIRMED | 0 / 0 | react-vite-supabase (نفس الـsubset في العرضين) |
| Flutter جديد | CONFIRMED | 0 / 0 | flutter-supabase |
| مشروع قائم React (مع ملفات مستخدم مسبقة) | CONFIRMED | 0 / 0 | react-vite-supabase، no-clobber ✔، تشغيل ثانٍ لا يغيّر شيئًا ✔ |
| اسم بديل موثق `React + Vite + Supabase` | CONFIRMED | 0 / 0 | react-vite-supabase |
| `Django + HTMX` | CONFIRMED | 11 / 11 | لا شيء — لا بديل تلقائي، لا كتابة على القرص |
| تقنية مؤجلة | REQUIRES_DECISION | 10 / 10 | لا شيء |
| Blueprint من الواجهة بمخطط `2.0` | — | 13 / 13 | لا شيء |

مُتحقَّق لكل مخرج: المخطط 1.1 وقرار التقنية المؤكد من المستخدم؛ provenance (الالتزام المثبت، بصمات الخريطة والمخطط، **إعادة حساب SHA-256 لكل ملف** بدوال Factory نفسها)؛
تطابق الـsubset مع استخراج Factory **ومع مستخرِج Prompt Maker المنتِج**؛ 23 ملفًا في `docs/ai`؛ لا بقايا أسرار؛ لا رموز `{{…}}` غير محلولة؛ وجود `vite-env.d.ts`؛
فحص أنواع المشروع المولَّد من الواجهة بلا TS2339؛ نسخة Factory غير معدّلة قبل وبعد. UAT المشترك السابق (12 سيناريو): 12/12 (`uat12/`).
**توافق العقد المثبت:** ملفات الـpin الثمانية مطابقة بايتيًا لملفات Prompt Maker الحالية، و`f659f92` سلف لـ HEAD، و`src/consumerSubset.js` و`src/blueprintCompiler.js` والـfixtures دون تغيير منذه ⇒ لا حاجة لتغيير العقد ولم يُغيَّر.

**المشروع النموذجي المولَّد:** `sample-generated/new_react_desktop`، `new_flutter`، `existing_react` (مع provenance كامل).

## 5. حزمة Prompt Maker القابلة للتشغيل
`tools/buildReleaseCandidate.js` ⇒ `prompt-maker-candidate-<sha>.zip` (ZIP حتمي، 70 ملفًا، بلا اعتماديات npm، Node ≥18): `START_HERE.md` ثنائي اللغة،
`start-windows.cmd`، `start-linux-mac.sh`، `CANDIDATE.json` (الالتزام والشجرة وبصمة كل ملف)، `SHA256SUMS.txt`. اختبار دخان من الحزمة المفكوكة:
كل البصمات سليمة، الواجهة 200، اجتياز المسار 403، رحلة قصيرة بلا أخطاء على 1280 و390، وCLI يُنتج الملفات الخمسة. البصمة النهائية تُذكر في رسالة التسليم (تُبنى من HEAD النهائي).

## 6. نتائج الاختبارات (على `20f61a8`؛ السجلات في `tests/`)
| المجموعة | النتيجة |
|---|---|
| Node النواة | 125/125 |
| GFPI (منها S16 الجديدة 11، S8 النطاق الإضافي) | 201/201 |
| حداثة الحزم + خط الأساس المجمد + fixtures الذهبية | سليمة |
| متصفح عام / GFPI / إنتاج | 30/30 · 38/38 · 26/26 |
| رحلة المنتج الجديدة (Chromium حقيقي، AR/EN، Desktop/390) | 18/18 |
| Factory | 53/53 |
| تكامل PM→Factory | 115 منفذًا / 0 فشل / 3 NOT_RUN |
| UAT المشترك السابق | 12/12 |

## 7. الأمن وحماية الملفات وسلامة المخرجات
فحص الأسرار نظيف؛ نطاق التغيير الإضافي (S8) سليم؛ نص عدائي في السياق يُعرض نصًا فقط (لا حقن عناصر)؛ مدخلات تقنية عدائية لا تُنفّذ شيئًا ولا تُنشئ ملفات؛
مصفوفة عبث ملف المشروع (15 صنفًا) كلها مرفوضة مع ضابط سليم؛ no-clobber + idempotence؛ provenance لكل ملف؛ لا طلبات شبكة خارج الأصل المحلي في اختبارات الواجهة؛
CSP دون تغيير؛ الـCompanion على loopback ويرفض اجتياز المسار؛ وحدة `projectRecord` نقية (بلا ساعة/عشوائية/شبكة/ملفات) بفحص آلي.

## 8. أدلة Desktop و390px
`screens/product_journey/` (عربي/إنجليزي، أسئلة، معاينة السياق، الحزمة القديمة السياق، الإصدارات، Master Prompt، إعادة الفتح على 390)، و`integration/shots/` لكل سيناريو.

## 9. العوائق المتبقية
### مانعة (قبل أي قرار قبول نهائي)
1. **البناء الفعلي للمشروع المولَّد (`npm install && npm run build`)**: `NOT_RUN` — سجل npm غير قابل للوصول في بيئة التطوير (ENOTFOUND/403). البديل المنفذ إثبات على مستوى الأنواع فقط. يلزم تشغيل §4 من `docs/WINDOWS_INTEGRATION_VERIFICATION_AR.md`.
2. **Windows end-to-end** (بما فيه `core.autocrlf=true`): `NOT_RUN` — لا قناة تنفيذ أوامر على جهاز Windows في هذه الجلسة.
3. **Human UAT**: `PENDING_HUMAN_EXECUTION` (أضيفت السيناريوهات 8–10).
### غير مانعة
- Flutter `pub get/analyze/test`: `NOT_RUN` (لا SDK)؛ التوليد والتحقق البنيوي للمخرجات تمّا.
- حارس «السياق القديم» يعمل في الواجهة؛ لم تُغيَّر `approvePackage`. لكن بصمة الحزمة تشمل السياق الذي بُنيت به فعلًا، فلا يمكن أن يرتبط اعتماد بغير ما بُني.
- بصمة ملف المشروع فحص سلامة لا توقيع هوية. الموافقة محلية بلا هوية خادمية (كما هو مُفصح سابقًا).
- تقييم brownfield نصي بالمطابقة اللفظية (قيد قائم في المحرك المجمد) ويبقى `ASSUMED`.
- فحص الأنواع المحلي استخدم tsc 6.0.3؛ القالب يثبّت `typescript ^5.5`، والتحقق النهائي هو البناء الحقيقي (العائق 1).
- G4 (DPAPI/Ollama الحقيقي) محجوبة ولم تُشغَّل.

## 10. حالة Human UAT الحقيقية
**`PENDING_HUMAN_EXECUTION`** — لم ينفذه أي إنسان. كل الاختبارات أعلاه بمستخدم محاكى ولا تمثل قبولًا بشريًا. الحزمة: `docs/human-uat/HUMAN_UAT_PACKAGE_AR.md` والنموذج `UAT_OBSERVATION_FORM.html` (افتراضي كل سيناريو `NOT_RUN`).

---
**SINGLE_NEXT_ACTION = ONE_INDEPENDENT_FINAL_REVIEW** (ثم، بقرار سيادي: تشغيل التحقق على Windows وHuman UAT). اكتمال المواصفات لا يُعرض هنا دليلًا على أن أي تطبيق سيُبنى جاهز للإنتاج.
