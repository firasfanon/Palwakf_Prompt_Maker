# GFPI-V1 — الاكتشاف الموجَّه وذكاء المواصفات الإنتاجية

الحالة: **BUILT_NOT_INTEGRATED** (فرع `task/gfpi-v1-mb1`). لا دمج في main، ولا إصدار، ولا ادعاء جاهزية إنتاج.

## ما الذي بُني
| المكوّن | المسار | ملاحظة |
|---|---|---|
| العقود الإضافية (13) + مخططات JSON | `gfpi/artifacts.js`, `schemas/gfpi/` | المخططات مولَّدة؛ `npm run gfpi:schemas`. لا تعريف ثانٍ لـ AcceptanceContractV1 |
| آلة القرار والسجل | `gfpi/decisions.js`, `gfpi/ledger.js` | سجل append-only متسلسل SHA-256؛ التأكيد يرتبط بالقيمة المعروضة بالضبط؛ تغيير قرار يُبطل التابعين |
| أسئلة بلا مزوّد | `gfpi/questionPlan.js` | استبيان ثابت غير مولَّد؛ مصفوفة قدرات صادقة |
| المواصفات والحزمة | `gfpi/specCompiler.js`, `gfpi/executionPackage.js` | كل بوابة قبول مرتبطة بمواصفة ومرحلة؛ فجوة تتبّع ⇒ رفض |
| المزوّدون | `gfpi/providerAdapter.js`, `gfpi/budget.js`, `gfpi/redaction.js` | موافقة أحادية الاستخدام مرتبطة بالحمولة المنقَّحة؛ ميزانية صفر؛ لا تصعيد صامت |
| Companion | `companion/` | loopback فقط؛ `node companion/cli.js start --origin http://127.0.0.1:PORT [--ollama-model NAME]` |
| الواجهة | `dist/guided.html` | بناء الحزمة: `npm run build:gfpi` |
| التقييم | `eval/`, `tools/gfpiEval.js` | الحالة REVIEW_PENDING |

## حالات الحزمة (مصحَّحة)
`DRAFT` / `BLOCKED_FOR_EXECUTION` / `REVIEWABLE_WITH_DEFERRED_ITEMS` / `READY_FOR_REVIEW`، و`APPROVED_FOR_EXECUTION` و`SUPERSEDED` **حالتان محسوبتان** من (الحزمة، سجل الموافقة، رأس السجل الحالي) لا تعديل للحزمة. `DEFERRED_WITH_GATE` لا يُعد حسمًا أبدًا؛ الموافقة المحدودة بالمراحل لا تصح إلا لبنود لها `phase` مع توقف إلزامي مسمّى.

## العمل دون مزوّد (Gap G)
يعمل: إنشاء يدوي/خبير، استبيان ثابت، إدخال المتطلبات، تحقق حتمي، اختيار تقنية بشري، تجميع من مدخلات مؤكدة، العقود، الحفظ والإصدارات، سجل القرارات، تصدير محلي وفحص سلامة. لا يعمل (ويُقال ذلك في الواجهة): الاكتشاف التوليدي، توصيات المعمارية، الاستدلال على التناقضات، الشروحات الاستدلالية.

## ما لم يُثبَت (NOT_PROVEN) — صراحةً
- مزوّد مستضاف حقيقي، Ollama حقيقي، OS keychain حقيقي، Windows الأصلي، npm install/build/test للتطبيقات المولَّدة (registry 403)، Flutter/Dart.
- أداء أي نموذج على المجموعة؛ المجموعة نفسها مرشّحة بلا مراجعة بشرية.
- المقاييس البشرية (requirement_coverage, reason_quality, arabic_quality) = NOT_MEASURED.
- طريق الإغلاق بأدلة حقيقية على جهاز المالك (Ollama/Windows): `node companion/cli.js probe --ollama-model <NAME> --smoke --evidence-out probe-evidence.json` — انظر `docs/LOCAL_OPERATIONS_AR.md`. نجاح الفحص يعني MODEL_AVAILABLE فقط، لا تقييمًا ولا اعتمادًا.

## التشغيل
```
npm ci
npm run build:gfpi && node tools/buildGfpiBundle.js --check
npm test && npm run test:browser          # الأصلية 125 + 30
npm run test:gfpi && npm run test:browser:gfpi
node tools/secretScan.js
FACTORY_DIR=/path/to/factory node tools/uat/gfpiFactoryUat.js
```


## إفصاح أمني: طبيعة الموافقة المحلية / Security disclosure: nature of local approval

> هذه موافقة محلية غير موثقة بهوية خادمية، تخص اعتماد المواصفة فقط، ولا تفوض أي عملية خارجية أو نشرًا إنتاجيًا.
>
> This is a local approval without server-side identity. It covers specification approval only and does not authorize any external operation or production deployment.

لا يُرتَّب على `APPROVED_FOR_EXECUTION` أي إذن خارجي: الحالة محسوبة داخل المتصفح ومعرّف الفاعل ثابت محلي (`local-user`)؛ تفويض أي عملية خارجية أو نشر إنتاجي قرار سيادي منفصل يُوثَّق خارج هذه الأداة. / `APPROVED_FOR_EXECUTION` grants no external permission: it is computed in the browser and the actor id is a constant local value; authorizing any external operation or production deployment is a separate sovereign decision recorded outside this tool.
