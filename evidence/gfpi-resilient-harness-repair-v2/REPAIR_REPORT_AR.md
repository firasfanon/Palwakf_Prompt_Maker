# GFPI_RESILIENT_TEST_HARNESS_MINIMAL_REPAIR_V2 — تقرير الإصلاح

- المرشح السابق: `bd75be432224670fde69de38c9904eb43a59ffec` (الفرع `task/gfpi-resilient-test-harness-v1`)
- مرجع الملاحظات: `GFPI_INDEPENDENT_REVIEW_BD75BE_20261010.md` — **لم يكن متاحًا** في المستودع ولا في Drive ولا كمرفق في جلسة الإصلاح؛
  نُفّذ الإصلاح وفق نص الملاحظات الست كما وردت في رسالة التكليف. يُرجى من المراجع مطابقة كل بند أدناه مع نص التقرير الأصلي.
- النطاق: أداة اختبار فقط. الملفات المعدلة: `tools/harness/resilientHarness.js`، `tests/gfpi/s17.test.js`، `docs/RESILIENT_TEST_HARNESS_AR.md`، وهذا المجلد.
- القيود المحترمة: لا تعديل لمنطق DPAPI أو `companion/`، لا تشغيل Ollama (اختبارات GFPI تستخدم البديل `ollamaDouble`)، لا اختبارات حمل، لا دمج،
  لا ترقية خط أساس (`generateGfpiFrozenBaseline --check` سليم دون تعديل)، لا إصدار ولا وسم.

## الملاحظات والإصلاحات

| # | الملاحظة | الإصلاح | اختبار الانحدار | الدليل |
|---|---|---|---|---|
| 1 | فشل `fsync` أو ضمانات الحفظ كان يُتجاهل (`best effort`)؛ تشغيل كل `fsync` فيه يفشل كان يعطي `COMPLETED` وخروج 0 | `EvidenceLog` يثبّت أول فشل كتابة/`fsync` ويرفض كل حدث بعده؛ الحدث الذي فشل `fsync` له لا يُعد مسجلًا؛ تُقتل العملية الفرعية فورًا أو لا تبدأ؛ `writeJsonAtomic` و`fsyncDir` يرميان خطأ (مع حذف ملف tmp)؛ النتيجة `UNKNOWN` + `EVIDENCE_DURABILITY_FAILED` والخروج الجديد `8 EVIDENCE_FAILURE`؛ فشل كتابة `result.json`/`SHA256SUMS.json` يعطي 8 أيضًا. فحص جاهزية جديد `evidence_dir_entry_fsync` | **R1** (6 حالات: حدث، `RUN_END`، `run.json`، `result.json`، fsync المجلد، وحدة `EvidenceLog`) | `before/defect_probe_bd75be4.txt` F1 ← `after/defect_probe_repaired.txt` F1 |
| 2 | `verify` لم يتحقق من بصمات الملفات ولا من اتساق `result.json` مع الأحداث (تزوير `result.json` أو تعديل `run.json` = `OK`) | `verify` يتحقق من كل ملف أدلة مقابل `SHA256SUMS.json` (غير مدرج/مدرج ومفقود/مختلف)، ويشترط وجود الملخص لأي تشغيل منتهٍ؛ `result.json` مربوط بالأحداث (`events_sha256`، `run_end_seq` = آخر حدث، `outcome`/`basis` = `RUN_END`)؛ `run.json` يطابق `RUN_START` (`boot_time_ms`) و`run_id` مفروض عبر السلسلة؛ الملفات غير المتوقعة تُذكر في `unexpected_files` | **R2** (14 حالة عبث، منها تزوير مع إعادة حساب البصمات) | F2 قبل/بعد |
| 3 | `OS_SHUTDOWN` كان يُقبل عندما يكون الإقلاع الجديد قبل آخر حدث بما يصل إلى 120 ث (ومساويًا له)، وإقلاع رجع للخلف كان يُعامل "نفس الإقلاع" | `OS_SHUTDOWN` فقط إذا: تغيّر الإقلاع للأمام بأكثر من التسامح، وليس في المستقبل (`nowMs` قابل للحقن)، و`boot > last_event` تمامًا، ووقت آخر حدث مقروء؛ غير ذلك `UNKNOWN` مع `BOOT_NOT_AFTER_LAST_EVENT` / `CLOCK_INCONSISTENT` / `BOOT_TIME_IN_FUTURE` / `LAST_EVENT_TIME_UNREADABLE` | **R3** (جدول + تشغيل حقيقي مُقاطَع) | F3 قبل/بعد |
| 4 | قيم حساسة قصيرة (`hunter2`، PIN `4821`، كلمة من البيئة) كانت تمر إلى `CHILD_EVENT` | قاعدة قيمة لكل مفتاح: `status`/`result` تعداد مغلق؛ `stage`/`op`/`code` معرّف بأحرف كبيرة فقط (لا أحرف صغيرة، `code` ليس رقمًا)؛ `hresult` رموز فشل فقط؛ الأعداد صحيحة ضمن حدود؛ وأي قيمة تساوي قيمة من بيئة العملية الفرعية أو argv (≥3) أو تحتويها (≥6) تُحذف — المقارنة في الذاكرة فقط | **R4** (وحدة + تشغيل طرفي مع أسرار في env وargv) | F4 قبل/بعد |
| 5 | بوابة الجاهزية قبل اختبارات Windows ضعيفة: `reg` بأي رمز خروج غير 0 = `ABSENT/PASS`، إعادة تشغيل معلقة = `WARN` لا يمنع، `WARN` لا يمنع إلا بـ `--fail-on-warn` | على Windows البوابة `STRICT` دائمًا: إعادة تشغيل معلقة = `FAIL`؛ رمز 1 فقط = `ABSENT`؛ خطأ/مهلة/رمز آخر = `UNAVAILABLE` ← `FAIL`؛ أي `WARN` ← `FAIL` (`strict_gate: true`)؛ استعلام ثالث `PendingFileRenameOperations`؛ `--strict-readiness` لغير Windows؛ الحقن (`platform`, `regQuery`) لاختبار البوابة خارج Windows | **R5** | F5 قبل/بعد |
| 6 | S17 كان يعتمد على وقت إقلاع الجهاز وساعته (`recover(..., {})` يقرأ `os.uptime()`؛ أوقات إقلاع "ملاحظة" في المستقبل بلا ساعة محقونة) | كل استعادة في S17 تُعطى وقت إقلاع محقونًا (إقلاع التشغيل نفسه = نفس الإقلاع، أو وقت ملاحظ) و`nowMs` محقونًا؛ `recover()` يقبل `bootTimeNowMs`/`nowMs` بمصدر `INJECTED`؛ المسار الحي للمشغّل باقٍ (`THIS_MACHINE_NOW`) | **R6** (فحص ثابت لكل استدعاء + نفس التشغيل بثلاث قيم `uptime` مختلفة) | F6 قبل/بعد، و`xcheck/bd75be4_s17_under_boot_drift.log` (9/11) مقابل `xcheck/repaired_s17_under_boot_drift.log` (17/17) |

## إثبات أن اختبارات الانحدار تحرس الإصلاحات

- `xcheck/new_s17_on_bd75be4_harness.log`: اختبارات S17 الجديدة على أداة `bd75be4` ← R1..R5 **تفشل** (10/17).
- R6 خاصية لملف الاختبار نفسه؛ دليله: `bd75be4` S17 تحت انحراف إقلاع محاكى 300 ث (`repro/uptime_drift_preload.js`) يفشل في اختبارين، والإصدار المصلح ينجح 17/17.
- `repro/defect_probe.js` يعيد إنتاج الملاحظات الست مباشرة: كلها `DEFECT_PRESENT` على `bd75be4`، وكلها `FIXED` على المرشح الجديد.

## النتائج النهائية (في `final/`)

| البوابة | النتيجة |
|---|---|
| `tests/run.js` (عام) | 125/125 |
| `tests/gfpi/run.js` (S0..S17) | 223/223 (كانت 217/217 على `bd75be4`؛ +6 اختبارات انحدار) |
| S17 وحده ×3 | 17/17 في كل مرة |
| `secretScan` / frozen baseline / golden fixtures / bundle core / bundle production | كلها سليمة (خروج 0) |

## حدود وملاحظات للمراجع

- بيئة الإصلاح: Linux فقط (Node 22). مسارات Windows (`taskkill`، `reg query`، `SIGBREAK`، غياب fsync للمجلد) **لم تُختبر على Windows حقيقي**؛ منطق البوابة مختبر بالحقن فقط.
- اختبارات المتصفح (Playwright) لم تُشغّل محليًا لعدم توفر Chromium؛ التعديل لا يمس شيفرة المتصفح، وCI يشغّلها.
- على Windows، S17 يرث البوابة الصارمة: جهاز عليه إعادة تشغيل معلقة سيجعل اختبارات S17 التي تشغّل عملية فرعية تنتهي `PREFLIGHT_FAILED` — وهذا هو السلوك المقصود.
- تغيير سلوكي: `safeValue(key, value, sensitive)` أصبح بتوقيع جديد، و`status: 'API_KEY'` أو أي كلمة صغيرة لم تعد تُحفظ.
