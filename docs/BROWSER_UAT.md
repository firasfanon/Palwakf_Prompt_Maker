# قبول المستخدم في المتصفح (Browser UAT)

## الحالة: PASS حقيقي، لا BLOCKED_ENVIRONMENT

بيئة التنفيذ الحالية تحتوي فعليًا على `playwright` (الحزمة الخام، لا
`@playwright/test` — غير مثبَّتة وغير قابلة للجلب هنا) و Chromium مُجمَّع
(`/opt/pw-browsers/chromium`)، **مُثبَت بالتشغيل الفعلي** لا بافتراض وثيقة توجيهية
سابقة افترضت غياب المتصفح. تم تشغيل **كل السيناريوهات فعليًا (العدد الحي في مخرجات التشغيل)** في متصفح حقيقي عبر
`tests/browser/run.js`.

```bash
node tests/browser/run.js
```

## السيناريوهات المُنفَّذة فعليًا (لا محاكاة)

| السيناريو | النتيجة |
|---|---|
| NEW_PROJECT_SIMPLE_MODE (+ إعادة إثبات إصلاح الكذبة الإيجابية المالية حيًّا في المتصفح) | PASS |
| NEW_PROJECT_PROFESSIONAL_MODE (كل الأقسام المتقدمة تظهر وتمتلئ) | PASS |
| PROFILE_REVIEW_AND_OVERRIDE | PASS |
| CRITICAL_UNKNOWN (قرار مطلوب يظهر، لا يُخفى) | PASS |
| BROWNFIELD_PROJECT (PRESERVE/ADD فقط؛ REMOVE/REFACTOR يُعلَّمان `UNKNOWN_REQUIRES_SOURCE_INSPECTION`) | PASS |
| SAVE_REOPEN / VERSION_REGENERATION | PASS |
| COPY_PROMPT / EXPORT_JSON (تنزيل حقيقي، `suggestedFilename()==='blueprint.json'`) / EXPORT_MARKDOWN | PASS |
| ERROR_STATE (إدخال فارغ ⇒ رسالة خطأ ظاهرة، لا فشل صامت) | PASS |
| RESPONSIVE_UAT — DESKTOP (1280px): لا تجاوز أفقي غير مقصود، الإجراء الأساسي ظاهر | PASS |
| RESPONSIVE_UAT — 390PX: لا تجاوز أفقي، النموذج قابل للاستخدام، البرومبت مقروء، النسخ/التصدير قابلان للوصول | PASS |
| ACCESSIBILITY (آلي الجزء القابل للأتمتة): عدد `<label>` كافٍ، الزر الأساسي قابل للوصول بلوحة المفاتيح (`focus` فعلي) | PASS |

## ما لا يزال يدويًا (غير مؤتمت، ولم يُعلَّم PASS بلا تنفيذ فعلي)

هذه البنود **لم تُنفَّذ** في هذه الدفعة ولا تُعلَّم PASS — تبقى ضمن checklist يدوي
صريح حتى تُنفَّذ فعليًا بإنسان أو أداة مناسبة:

- [ ] قارئ الشاشة (screen reader semantics) — اختبار يدوي فعلي مطلوب (NVDA/VoiceOver).
- [ ] جودة التركيز البصري (focus ring) — فحص بصري يدوي.
- [ ] التقريب/إعادة التدفق (zoom/reflow) عند 200%+ — فحص يدوي.
- [ ] حجم أهداف اللمس (touch targets) على جهاز حقيقي — فحص يدوي.
- [ ] مراجعة RTL/LTR كاملة لكل عنصر (الحالي: كل النص عربي RTL بثبات واحد — لم تُختبَر
      حالة مزج RTL/LTR فعلي).

## لماذا هذا ليس BLOCKED_ENVIRONMENT

توجيه سابق افترض أن بيئة التنفيذ لا تحتوي متصفحًا، وبنى على ذلك تصنيفًا نهائيًا
متوقَّعًا من `BLOCKED_ENVIRONMENT`. تم التحقق المباشر من هذا الافتراض (لا قبوله
كما هو) بتشغيل Chromium فعليًا والتنقّل في صفحة حقيقية قبل الشروع في بناء أي أداة
اختبار — فتبيّن أنه غير صحيح لهذه البيئة بالتحديد. لذلك الحالة النهائية هنا
`PASS` حقيقي مُثبَت بالتنفيذ، لا `BLOCKED_ENVIRONMENT` ولا `NOT_APPLICABLE`
(كلاهما محظور تحويل أحدهما للآخر صراحة بالتوجيه الحاكم).
