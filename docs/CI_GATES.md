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
