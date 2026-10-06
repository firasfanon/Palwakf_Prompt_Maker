# دليل التكامل الخارجي المستقبلي (Future External Integration Guide)

> **ملاحظة نطاق**: هذا الدليل **عام تمامًا**. لا يفترض وجود أي نظام خارجي محدد، ولا
> يذكر أي اسم منتج أو مشروع آخر، ولا يُعامِل أي تكامل مستقبلي كاعتماد تشغيلي حالي.
> كل مثال هنا وصفي بحت: "مستهلك خارجي" (external consumer)، "مزوّد سياق خارجي"
> (external context provider)، أو "نظام تنفيذ خارجي" (external execution system) —
> أدوار عامة، لا أنظمة بعينها. Prompt Maker لا يستدعي، ولا يعتمد في وقت التشغيل على،
> أي نظام خارجي اليوم. هذا الدليل يوثّق **كيف يمكن** لنظام خارجي أن يتكامل معه لو
> قرر المستخدم ذلك مستقبلًا — وليس قرارًا بأن ذلك سيحدث.

## 1. الحدود (Authority Boundary) — يجب قراءتها أولًا

أي تكامل خارجي يجب أن يحترم هذه الحدود غير القابلة للتفاوض (مفروضة باختبار آلي دائم
في هذا المستودع):

- **Blueprint / DevelopmentContract / Master Prompt ≠ سلطة تنفيذ**: هذه مخرجات
  *وصفية* (ما يجب بناؤه)، وليست أمرًا تنفيذيًا. أي نظام خارجي يستهلكها يبقى مسؤولًا
  عن قرار التنفيذ الفعلي.
- **Acceptance Target ≠ Acceptance Evidence**: وجود `acceptance_criteria` لا يعني
  أن المعيار استُوفي. `current_evidence_status` يبدأ دائمًا `NOT_ASSESSED` حتى يُثبِت
  نظام خارجي (أو إنسان) الدليل الفعلي.
- **Production Readiness Target ≠ Production Certification**: `production_readiness_target`
  هو هدف معلَن من المستخدم، لا شهادة جاهزية صادرة عن هذا المحرك أو عن أي نظام خارجي
  يستهلك مخرجاته.

## 2. عقود الاستيراد (Import Contracts)

نظام خارجي يريد **تزويد** Prompt Maker بسياق (مثلًا: وصف مشروع مُركَّب برمجيًا بدل
إدخال يدوي) يجب أن يُنتج كائن `ProjectIntentV1` صالحًا (انظر
`INTEGRATION_CONTRACTS.md` للمخطط الكامل):

```json
{
  "schema_version": "1.0",
  "project_name": "string, 1..200 حرف",
  "project_goal": "string, 1..5000 حرف",
  "advanced": {
    "target_platforms": "string | null",
    "existing_project": "'new' | 'existing' | null",
    "existing_capabilities": "string | null"
  }
}
```

يجب على المستهلك الخارجي استدعاء `validateProjectIntentV1(intent)` (أو مكافئها في
اللغة المستهدَفة) قبل التمرير إلى `compileProject` — المحرك لا يثق بأي حقل لم يُفحَص.

## 3. عقود التصدير (Export Contracts)

كل توليد يُنتج 5 قطع artifacts مستقلة، كل منها JSON (أو Markdown للبرومبت) صالح
للاستهلاك المباشر من **نظام تنفيذ خارجي** (مثل: منسق مهام، أو نظام توليد كود):

| القطعة | الصيغة | الغرض |
|---|---|---|
| `blueprint.json` | JSON (`ProjectBlueprintV1`) | البنية والمتطلبات والنموذج المجالي |
| `acceptance_contract.json` | JSON (`AcceptanceContractV1`) | بوابات قبول قابلة للاختبار |
| `development_contract.json` | JSON (`DevelopmentContractV1`) | نطاق ومحددات التنفيذ |
| `master_prompt.md` | Markdown | برومبت كامل model-agnostic |
| `receipt.json` | JSON (`GenerationReceiptV1`) | بصمات محتوى حتمية للتحقق |

نظام خارجي يستهلك `receipt.json` يمكنه إعادة حساب أي hash محتوى (نفس خوارزمية
FNV-1a على `canonicalStringify(stripVolatile(artifact))`) للتحقق من عدم التلاعب —
دون الحاجة لثقة ضمنية بالمصدر.

## 4. تفاوض الإصدار (Version Negotiation)

كل artifact يحمل `schema_version` مستقلًا. مستهلك خارجي يجب أن:
1. يقرأ `schema_version` أولًا.
2. يرفض المعالجة (لا يُخمِّن) إذا كان `schema_version` أعلى من ما يدعمه.
3. يُعامِل أي `MAJOR` جديد كتغيير توافق (انظر سياسة التوافق أدناه)، لا كامتداد بسيط.

## 5. التوافق للخلف والأمام (Backward / Forward Compatibility)

- **حقل جديد اختياري** يُضاف بأثر بالٍ (backward-compatible) طالما قيمته الافتراضية
  عند الغياب لا تُغيّر معنى الحقول القائمة.
- **حقل مطلوب جديد** يتطلب رفع `schema_version` (MINOR على الأقل) ولا يجوز افتراض
  قيمة له صمتًا.
- **إزالة حقل** تتطلب رفع `MAJOR` ودليل ترحيل (migration note) صريح.
- مستهلك خارجي **يجب** أن يتبع `UNKNOWN_FIELD_POLICY` (انظر `INTEGRATION_CONTRACTS.md`):
  تجاهل الحقول غير المعروفة بأمان، لا رفض الكائن كاملًا بسببها.

## 6. سلوك الأخطاء (Error Behavior)

`compileProject(rawInput)` يُعيد دائمًا كائنًا واحدًا من شكلين، لا استثناءً يُرمى
لأخطاء إدخال عادية:

```json
{ "ok": false, "errors": ["string", "..."] }
```
أو
```json
{ "ok": true, "intent": {...}, "classification": [...], "blueprint": {...}, "..." }
```

نظام خارجي يستدعي هذا المحرك (عبر CLI أو مكتبة) يجب أن يفحص `ok` أولًا دومًا، لا أن
يفترض النجاح ويقرأ الحقول مباشرة.

## 7. التحقق (Validation)

قبل أي استهلاك لمخرجات هذا المحرك من نظام خارجي، يجب تنفيذ تحقق من نوعين مستقلين:

1. **تحقق بنيوي (structural)**: الحقول المطلوبة موجودة وبالنوع الصحيح — اختبار سريع
   وآلي (JSON Schema عند توافره، أو فحص برمجي مباشر).
2. **تحقق دلالي (semantic)**: الفحص الأهم وغالبًا المتجاهَل — هل `validation.status`
   يساوي `PASS_WITH_EXPLICIT_UNKNOWNS` أو `BLOCKED_REQUIRES_DECISION`؟ النظام الخارجي
   **لا يجوز له** أن يُعامِل `BLOCKED_REQUIRES_DECISION` كنجاح جزئي قابل للتجاوز —
   هذا يعني أن قرارًا بشريًا مطلوبًا أولًا.

## 8. أمثلة حمولة (Example Payloads)

### مثال: مستهلك خارجي عام يستلم Blueprint
```json
{
  "schema_version": "1.0",
  "project_name": "مثال عام",
  "project_profiles": [{ "profile_id": "WEB_APPLICATION", "confidence": 0.8, "status": "INFERRED_DEFAULT" }],
  "requirements_by_domain": { "AUTH": [{ "id": "AUTH-002", "status": "REQUIRED" }] }
}
```
مستهلك مثل هذا **لا** يفترض أن `INFERRED_DEFAULT` يعني موافقة مستخدم فعلية — فقط
`CONFIRMED` تعني ذلك.

### مثال: مزوّد سياق خارجي عام يُغذّي ProjectIntentV1
```json
{ "project_name": "نظام من مصدر خارجي", "project_goal": "...", "existing_project": "existing", "existing_capabilities": "..." }
```
يُمرَّر هذا عبر `validateProjectIntentV1` **قبل** أي استخدام — لا ثقة ضمنية بمصدره.

## 9. امتدادات مخصصة (Custom Extensions)

أي نظام خارجي يحتاج حقلًا إضافيًا غير موجود في العقد الحالي يضيفه داخل مساحة اسم
مخصصة لا تتعارض مع الحقول القياسية، مثلًا:
```json
{ "...": "...", "x_external_system_metadata": { "any": "shape" } }
```
بادئة `x_` تُعلِم أي مستهلك آخر أن هذا الحقل خارج العقد القياسي، ويجوز تجاهله بأمان.

## 10. الحدود الأمنية (Security Boundary)

- هذا المحرك **لا يتصل بالشبكة** ولا يقرأ/يكتب ملفات إلا عبر Ports/Adapters صريحة
  (`src/adapters.js`) يستدعيها المستهلك عمدًا.
- لا سر (مفتاح API، كلمة مرور) يُفترض أو يُطلَب من المستخدم في أي حقل من
  `ProjectIntentV1` — أي محاولة لإدخال سر يجب أن تُرفَض أو تُحذَف من قِبل النظام
  المستهلك قبل التمرير، وليس بعد.
- نظام تنفيذ خارجي يستهلك `DevelopmentContractV1` يبقى **المسؤول الوحيد** عن أي صلاحية
  وصول (filesystem، شبكة، بيانات حساسة) يحتاجها التنفيذ الفعلي — هذا المحرك لا يمنح
  ولا يفترض أي صلاحية.
