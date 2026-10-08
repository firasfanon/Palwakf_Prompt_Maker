# دروس GFPI-V1-MB1 (ERROR → ROOT_CAUSE → LESSON → SKILL → ADAPTER → GATE → TEST)

1. **413 دون استجابة** — ERROR: العميل يرى `socket hang up`. ROOT_CAUSE: `req.destroy()` قبل كتابة الاستجابة. LESSON: ردّ أولًا ثم أغلق. SKILL: اختبار HTTP حقيقي لا محاكاة. GATE: اختبار 413 بلا `catch` يخفي الفشل. TEST: `S2 body limit 413...`.
2. **ساعة المحرك المجمّد** — ERROR: بصمة الحزمة تتغير بين استدعاءين. ROOT_CAUSE: `generated_at` بساعة النظام داخل المحرك (يستثنيه إيصاله نفسه). LESSON: لا تعدّل المجمَّد؛ طبّع الحقل المتقلب علنًا في الطبقة الإضافية. GATE: اختبار تطابق مع تجريد الحقل. TEST: `S4 frozen contracts inside the package...`.
3. **فقدان التركيز بعد إعادة الرسم** — ERROR: بعد «أؤكد» يصبح activeElement هو body. ROOT_CAUSE: مسح DOM كامل. LESSON: سجّل عنصر التركيز المقصود قبل render. TEST: `keyboard: ... focus moves to Confirm` وإعادته إلى عنوان البطاقة.
4. **تطابق جزئي في الاختبار** — ERROR: `/مقترن/` يطابق «غير مقترن». LESSON: قارن النص كاملًا. TEST: `pairing: wrong code fails honestly...`.
5. **نطاق تتبّع ناقص** — ERROR: بوابات بمجالات غير مخرَّطة (PRIVACY…) ⇒ رفض الحزمة. LESSON: فشل مغلق أفضل من تجاهل صامت؛ خرِّط كل المجالات واختبر على متغيرات متعددة. TEST: `S4 traceability... varied projects`.
6. **أوامر الصدفة تقتل نفسها** — ERROR: `pkill -f` طابق سطر أمره ذاته. LESSON: لا تستخدم أنماطًا تظهر في سطر الأمر نفسه.
