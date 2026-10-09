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

## فشلان موروثان من خط الأساس — عُولجا بتفويض مالك (AUTHORIZE_AND_EXECUTE_GFPI_V1_BOUNDED_PREMERGE_CI_REMEDIATION_V1)
أثبتت خطوة «Baseline control» غير المانعة أن العيبين موجودان على `main` غير المعدّل داخل CI، لا في المرشح:
1. **R1 — تجاوز عنوان الواجهة الأصلية عند 390px:** السبب الجذري أن عنصر `header h1` (عنصر flex) يحوي الرمز غير القابل للكسر `Blueprint/Acceptance/Development/Master-Prompt`، وعرضه بخط بديل أعرض (DejaVu Sans على مشغّل GitHub) 394px > 358px المتاح، فيخرج 20px (RTL) ويتّسع المستند إلى 410px. أُعيد إنتاجه محليًا بالأرقام نفسها. الإصلاح الأدنى: `min-width:0; overflow-wrap:anywhere` على `header h1` في `dist/prompt-maker-app.html` (سطر واحد؛ لا تغيير في المحتوى أو السلوك).
2. **R2 — اختبار `generated_at` المتقطع:** السبب الجذري أن الاختبار كان يعتمد على ساعة الجدار، فيتساوى `toISOString()` لتجميعين متتاليين في الميلي ثانية نفسها (أُعيد إنتاجه حتميًا بساعة مجمّدة). لا عيب في الإنتاج: `generated_at` تتبع الساعة بالتصميم. صار الاختبار يستخدم ساعة مضبوطة (تقدّم ثانية لكل استدعاء) فيضمن اختلاف القيمتين، ويؤكد عكسيًا أن الساعة المجمّدة تعطي قيمًا متطابقة وأن بصمات المحتوى لا تتغير في الحالتين؛ وتبيّن بتجربة طفرة (mutation) أن الاختبار يفشل إذا دخلت `generated_at` في البصمة. لم يُحذف تأكيد ولم يُخفَّف.

الاستثناءان مثبّتان في `tests/gfpi/frozen_baseline.json` تحت `authorized_changes` ببصمة SHA-256 الدقيقة للملفين بعد التعديل؛ أي انحراف آخر في أي منهما يُفشل فحص baseline. باقي الملفات المجمدة بلا تغيير.
