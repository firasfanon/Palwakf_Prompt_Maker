# محرك القواعد (Rule Engine)

المصدر: `src/rulesRegistry.js` (`RULES_REGISTRY_VERSION`)، `src/applicabilityEngine.js`
(`computeApplicability`).

## الحالة الفعلية

**35 قاعدة** عبر **19 مجالًا (domain)**:
`PRODUCT_COMPLETENESS, ARCHITECTURE, DATA, VALIDATION, AUTHENTICATION,
AUTHORIZATION, SECURITY, PRIVACY, API_CONTRACTS, INTEGRATIONS, PERFORMANCE,
OBSERVABILITY, RELIABILITY, BACKUP_RESTORE, TESTING, BROWSER_UAT, UX, CI_CD,
DOCUMENTATION`.

هذا **تمثيل كافٍ لإثبات اختلاف فعلي بين ملفات التعريف (مُختبَر)، لا تغطية شاملة
لمؤسسة كاملة** — إعلان صريح، لا ادعاء اكتمال غير مثبَت.

## كيف يُحدَّد الانطباق

لكل قاعدة، ولكل ملف تعريف مُصنَّف (`profileIds`)، ولكل `intent` كامل،
`computeApplicability(profileIds, intent)` يُعيد حالة واحدة من ثلاث لكل قاعدة:

| الحالة | المعنى |
|---|---|
| `REQUIRED` | القاعدة تنطبق وتُعتبَر بوابة قبول (`blocking=true` في `AcceptanceContract`) |
| `OPTIONAL` | تنطبق جزئيًا أو بشرط (`blocking=false`) |
| `NOT_APPLICABLE_WITH_RATIONALE` | لا تنطبق — **مع سبب نصي صريح**، لا إسقاط صامت |

كل عنصر ناتج يحمل `{id, domain, description, status, rationale?}` — الشفافية هنا
مقصودة: المستخدم يرى *لماذا* استُبعدت قاعدة، لا فقط أنها غابت.

## القواعد الحاسمة لكل مجال (Blocking vs Non-Blocking)

`AUTH-002/003`, `DATA-002/006`, `SEC-002/004`, `TEST-002/003`, `UAT-001/002`,
`DOC-001` وغيرها لها معايير قبول حقيقية (ليست عامة) في
`src/acceptanceCriteriaLibrary.js` — مطابَقة بـ `rule_id` ثم `domain` كـ fallback،
مع `source_type`/`source_id` تُظهر من أين جاء كل معيار (لا نص عام ثابت مُلصَق خارج
السياق).
