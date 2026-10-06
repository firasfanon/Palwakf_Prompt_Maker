# مُجمِّع البرومبت (Prompt Compiler) — model-agnostic

المصدر: `src/promptCompiler.js` (`renderMasterPrompt(blueprint, acceptanceContract,
developmentContract)`).

## مبدأ: لا فقدان معلومة (Parity)

البرومبت الناتج **يجب** أن يعكس كل معلومة مهمة في الـBlueprint عند انطباقها — مُثبَت
باختبار Parity في `tests/run.js` يفحص وجود أقسام محددة (markers نصية) فقط عند
امتلاء البيانات المقابلة لها:

| القسم في البرومبت | يظهر عندما |
|---|---|
| تصنيف المشروع | دائمًا |
| المعمارية المقترحة | دائمًا |
| أسطح المنتج (Product Surfaces) | دائمًا (حتى لو سطح واحد فقط) |
| الكيانات المستنتَجة / العلاقات / قواعد العمل / آلات الحالة | فقط عند وجود بيانات فعلية — لا قسم فارغ مطبوع |
| وضع المشروع القائم (Brownfield) | فقط عند `blueprint._brownfield != null` |
| بوابات القبول | دائمًا، مع `acceptance_criteria/required_evidence/current_evidence_status` لكل بوابة (لا فقط البوابات الحاسمة) |
| عقد التطوير (Development Contract) | دائمًا — نطاق + محددات معمارية/بيانات/أمان |

## لماذا model-agnostic

لا اسم نموذج ذكاء اصطناعي، لا بنية prompt خاصة بمزوّد واحد (لا System/Human/Assistant
roles خاصة بواجهة برمجية معينة) — Markdown عادي يصلح للصق في أي نموذج. فحص آلي دائم
(`scanCoreForProviderLockIn` في `src/validationEngine.js`) يمنع تسرّب أي اسم مزوّد
(openai/anthropic/claude/gpt-\d/gemini) إلى النواة.

## الحدود الصريحة داخل البرومبت نفسه

البرومبت يحمل داخله تذكيرًا بأن:
- `INFERRED_DEFAULT` ≠ `CONFIRMED` — تصنيف تلقائي لم يُراجَع المستخدم لا يُعامَل كقرار نهائي.
- `UNKNOWN` (في `required_decisions`) لا يُقترَح حله اعتباطيًا — يُطلَب من آخذ البرومبت قرار بشري.
- `production_readiness_target` هدف، لا شهادة — لا يُفترَض أن استيفاء البرومبت = جاهزية إنتاج فعلية.
