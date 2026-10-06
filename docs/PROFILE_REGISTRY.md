# سجل ملفات التعريف (Profile Registry)

المصدر: `src/profileRegistry.js`، `PROFILE_REGISTRY_VERSION`. **18 ملف تعريف منفَّذ
فعليًا** (مُصنَّف ومُختبَر)، بالإضافة إلى **4 قرارات صريحة** (حذف أو تأجيل، كل منها
بسبب مذكور — لا إسقاط صامت).

## الـ18 المنفَّذة (جزئي، أمثلة من كل مجموعة — القائمة الكاملة في الكود)

عامة: `WEB_APPLICATION`, `PUBLIC_PORTAL`, `MOBILE_APPLICATION`, `API_SERVICE`,
`DESKTOP_APPLICATION` (جديد هذه الدفعة)
تجارية/تشغيلية: `ECOMMERCE`, `BOOKING_SYSTEM`, `WEB_SAAS`, `MULTI_TENANT_SAAS`,
`ADMIN_DASHBOARD`, `INTERNAL_OPERATIONS_SYSTEM`
حسّاسة (`sensitive: true`): `FINANCIAL_SYSTEM`, `LEGAL_SYSTEM` (جديد هذه الدفعة)
أخرى: `AI_ASSISTANT`, `GIS_SYSTEM`, `CONTENT_PLATFORM` (جديد)، `RESEARCH_SYSTEM`
(جديد)، وملف تعريف إضافي حسب القائمة الكاملة في `src/profileRegistry.js`.

## القرارات الصريحة (`PROFILE_REGISTRY_DECISIONS`) — 4 بالضبط

| الملف | القرار | السبب (مختصر) |
|---|---|---|
| `RAG_KNOWLEDGE_SYSTEM` | `REMOVED_WITH_REASON` | يتطلب بنية استرجاع/تضمين متخصصة خارج نطاق هذه الدفعة؛ حذف صريح لا تجاهل |
| `AGENTIC_SYSTEM` | `DEFERRED_WITH_REASON` | يفتح نطاق "حلقة agentic" المحظور صراحة على هذه الدفعة (NO_AGENTIC_LOOP_EXPANSION) |
| `MARKETPLACE` | `DEFERRED_WITH_REASON` | يحتاج نموذج أعمال ثلاثي الأطراف (بائع/مشتري/منصة) غير مُختبَر بعد بعمق كافٍ |
| `HIGH_ASSURANCE_SYSTEM` | `DEFERRED_WITH_REASON` | يتطلب أدلة امتثال تنظيمية تفصيلية خارج ما يمكن إثباته آليًا هنا |

لا ملف تعريف يُحذَف أو يُؤجَّل دون سبب مكتوب فعليًا (طول السبب > 20 حرفًا، مفروض
باختبار آلي).

## إصلاح الكذبة الإيجابية المالية (False Positive Fix)

`FINANCIAL_SYSTEM` (v1.1) يحمل الآن `negative_keywords` (مثل `عيادة`, `موعد`,
`حجز`, `clinic`, `booking`, `appointment`) — إن غلبت هذه الكلمات السلبية على
الإيجابية، يُقمَع التصنيف المالي كليًا بدل أن يظهر زورًا لمجرد وجود كلمة "فواتير" في
سياق عيادة. موثَّق بسبب `sensitive: true` + سقف ثقة (`SENSITIVE_CONFIDENCE_CAP=0.55`)
يحميه من الظهور بثقة زائفة حتى مع دليل ضعيف.

## كسر التعادل بالتخصيص (Specificity Tie-Break)

عند تعادل ملفَي تعريف في الثقة، يُفضَّل الملف الذي طابقت كلمته المفتاحية نصًا أطول
(أكثر تخصيصًا) — يحل تعارض عام/خاص مثل `WEB_APPLICATION` vs `PUBLIC_PORTAL`.
