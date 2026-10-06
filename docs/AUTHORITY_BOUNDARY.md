# حدود السلطة (Authority Boundary)

ثلاث حدود غير قابلة للتفاوض، كل منها مفروض بـ**اختبار آلي دائم** (قسم "Authority
Boundary regression" في `tests/run.js`)، لا بتوثيق نصي فقط:

## 1. Blueprint / DevelopmentContract / Master Prompt ≠ سلطة تنفيذ

هذه ثلاثة مخرجات **وصفية**: تصف ما يجب بناؤه ولماذا. لا واحد منها يحمل صلاحية
تنفيذ فعلية — لا استدعاء شبكة، لا كتابة ملف خارج ما يطلبه المستخدم صريحًا عبر
Ports/Adapters، لا قرار آلي "هذا جاهز، نفّذه الآن". التنفيذ الفعلي يبقى قرارًا
بشريًا (أو نظامًا خارجيًا يملك صلاحياته الخاصة، غير مُستمَدة من هذا المحرك).

**الاختبار**: يفحص أن لا حقل في `blueprint`/`developmentContract`/البرومبت المُولَّد
يحمل قيمة تُصرِّح ضمنيًا أو صريحًا بأن التنفيذ تم أو مُصرَّح به تلقائيًا.

## 2. Acceptance Target ≠ Acceptance Evidence

كل بوابة في `AcceptanceContractV1` تحمل `acceptance_criteria` (الهدف القابل
للاختبار) **و** `current_evidence_status` (الدليل الفعلي) كحقلين منفصلين تمامًا.
`current_evidence_status` يبدأ **دائمًا** `NOT_ASSESSED` عند التوليد — لا PASS
مُفترَض، ولا حالة أخرى تُستنتَج آليًا من مجرد وجود المعيار.

**الاختبار**: يفحص أن كل بوابة ناتجة تحمل `current_evidence_status === 'NOT_ASSESSED'`
عند التوليد الأول، ولا توجد أي بوابة تُنتَج بحالة PASS بلا دليل مُقدَّم فعليًا.

## 3. Production Readiness Target ≠ Production Certification

`production_readiness_target` (في الـBlueprint) هو **هدف** يُعلِنه المستخدم ضمن
مدخلاته (أو يُستنتَج كافتراض قابل للمراجعة) — ليس شهادة جاهزية إنتاج صادرة عن هذا
المحرك أو عن أي نظام يستهلك مخرجاته. إن كان `production_readiness_target === true`
في المدخل، يفرض `validationEngine.js` حالة `BLOCKED_REQUIRES_DECISION` ما لم تتوفر
أدلة كافية — أي اختصار يتجاوز هذا الفحص يُعَد "اختصارًا محظورًا"
(prohibited shortcut) ويُسجَّل كمخالفة.

**الاختبار**: `production_readiness_target === true` بلا قرارات مُحسَمة ⇒
`validation.status === 'BLOCKED_REQUIRES_DECISION'` حتمًا، لا `PASS` تحت أي ظرف.

---

هذه الحدود الثلاثة تنطبق أيضًا على أي **نظام خارجي** يستهلك مخرجات هذا المحرك — انظر
`FUTURE_EXTERNAL_INTEGRATION_GUIDE.md` §1.
