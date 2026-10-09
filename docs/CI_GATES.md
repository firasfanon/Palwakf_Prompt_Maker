# بوابات CI قبل الدمج / Pre-merge CI gates

Workflow: `.github/workflows/gfpi-premerge.yml` — يعمل على طلبات الدمج إلى `main` فقط، بصلاحية `contents: read`، دون أسرار ودون نشر ودون موارد مدفوعة. الإجراءات مثبتة بـ commit SHA، وNode `22.22.0`، وPlaywright `1.56.1` من `package-lock.json`.

| البوابة | في CI؟ |
|---|---|
| فحص الأسرار، baseline المجمد، golden fixtures، طزاجة الحزمتين | نعم (`static-gates`) |
| Node العام، GFPI | نعم (`node-regression`) |
| متصفح عام، متصفح GFPI، Production E2E | نعم (`browser-regression`) |
| Factory consumer UAT | **لا (NOT_RUN في CI)** — بوابة منفصلة يدوية: `FACTORY_DIR=<Factory clone مثبت> node tools/uat/gfpiFactoryUat.js --out <dir>`؛ لا يعدّل Factory |
| اختبار القبول البشري | **لا** — DEFERRED_TO_PRE_RELEASE (`docs/human-uat/`) |
| مزوّد مستضاف حقيقي / Ollama / OS keychain / Windows / بناء التطبيق المولَّد / Flutter | **لا** — NOT_PROVEN |

اختبارات المتصفح تستخدم «مستخدمًا محاكى»؛ نجاح CI ليس قبولًا بشريًا ولا جاهزية إنتاج. غياب بوابة ≠ PASS.

الفرع الافتراضي للمستودع ليس `main`؛ لذلك يستهدف الـworkflow `main` صراحةً، وقد يلزم ضبط «required checks» يدويًا في إعدادات الفرع (لا يغيّره هذا الـPR).

## فشلان معروفان موروثان من خط الأساس (مثبتان بتحكّم في CI، لا علاقة للمرشح بهما)
أثبت الخطوة غير المانعة «Baseline control» (تشغيل نفس الحزمة على `main` غير المعدّل داخل CI) أن:
1. **`tests/browser/run.js` (المتصفح العام) يفشل في اختبارين عند 390px على مشغّل GitHub** (`scrollWidth=410 > 390`)، وبنفس الشكل على `main`. السبب المشخَّص: عنوان `H1` في `prompt-maker-app.html` يبلغ 394px باتجاه RTL (left=-20) بسبب خط `system-ui` البديل على المشغّل. يمر محليًا لاختلاف الخطوط. الإصلاح (خارج النطاق لأنه يمس الواجهة الأصلية المجمدة): قاعدة CSS مثل `h1{overflow-wrap:anywhere;min-width:0}` في المصدر ثم إعادة بناء `dist`. **لم يُطبَّق** ويحتاج قرارًا منفصلًا.
2. **اختبار `generated_at SHOULD differ` في `tests/run.js` متقطع**: يقارن `new Date().toISOString()` لتجميعين متتاليين فقد يتساويان في نفس الميلي ثانية على مشغّل سريع (فشل مرة ونجح مرة على نفس الشجرة). الإصلاح المقترح (غير مطبّق): تأخير ≥2ms بين التجميعين أو إزالة هذا التأكيد.

لا يُحتسب أي منهما PASS. باقي البوابات (فحص الأسرار، baseline المجمد، fixtures، الحزمتان، GFPI، متصفح GFPI، Production E2E) خضراء في CI الحي على آخر HEAD.
