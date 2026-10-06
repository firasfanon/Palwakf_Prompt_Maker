# تقرير الإصلاح المحدود (Bounded Repair)

الأساس: `5752133efe9cc096a3f98bc62aca9022d1a14c89` على `development/full-production-engine`.
القرار المستقل السابق: `BOUNDED_REPAIR_REQUIRED`. لا دمج، لا تعديل `main`.

| البند | الإصلاح |
|---|---|
| 1 ربط المعايير | مطابقة بـ`rule_id` فقط + `anchors` مشتركة بين الوصف والمعيار؛ DATA-002/TEST-002/TEST-003/AUTH-003 صُحّحت؛ DATA-006 أُعيد ترقيمه إلى REFI-001، وSEC-004 حُذف؛ اختبار `ORPHAN_ACCEPTANCE_RULE_ID` |
| 2 حالة الأدلة | `current_evidence_status=NOT_ASSESSED` ثابت عند التوليد؛ لا قيم بيئة المولّد في src أو الحزمة |
| 3 حفظ/فتح حقيقي | `localStorage` عبر `createStorageProjectRepository`؛ واجهة قائمة/فتح/آخر إصدار؛ احتياطي ذاكرة معلن بصدق عند حجب التخزين |
| 4 تاريخ الإصدارات | `versions[]` فعلي مع هاشات وقراءة وإعادة فتح متحقَّق منها |
| 5 اختبار المتصفح | حفظ ← `page.reload()` ← فتح ← تحقق ← إعادة توليد ← V2 ← reload ← فتح V1/V2 |
| 6 العرض الآمن | لا `innerHTML` وأخواتها؛ اختبار انحدار أمني (مُختبَر بطفرة عمدية) واختبار ساكن |
| 7 تغطية الإنتاج | قواعد حقيقية بانطباق حقيقي لكل المجالات المطلوبة؛ السجل لم يعد «تمثيليًا» |
| 8 التراجع | `rollback_requirements` مشتق من قواعد ROLLBACK حسب الانطباق |
| 9 ProjectContextV1 | عقد كامل: 9 حقول + تحقق + سياسة حقول مجهولة + سياسة توافق |
| 10 انجراف الوثائق | الأعداد تُشتق من `tools/metrics.js` ويفحصها `tests/run.js` |
| 11 CLI | `versions` منفَّذ فعليًا على `ProjectRepository` |

إصلاح أمني جانبي: مستودع الملفات كان يقبل معرّف مشروع يعبر المسار؛ يُرفض الآن.

الحالة: **READY_FOR_INDEPENDENT_REVERIFICATION** — ليس FINAL_ACCEPTED ولا PRODUCTION_READY.
