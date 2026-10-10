# أداة الاختبارات المتينة — `tools/harness/resilientHarness.js`

أداة اختبار فقط (TEST_HARNESS_ONLY). لا تلمس DPAPI ولا مخزن الاعتمادات ولا أي مزوّد ولا Ollama، ولا تغيّر إعدادات Windows.
الهدف: ألا تضيع أدلة الاختبار عند توقف مفاجئ (العملية، القناة البعيدة، أو النظام نفسه)، وألا يُستنتج سبب لا تدعمه الأدلة.

## 1. لماذا

في جولة Futuer-IT السابقة: نجحت عملية `DPAPI_PROTECT` الفرعية (10,172 ms، خروج 0)، ثم توقف Windows، وفُقد ملف نتيجة
العملية الأم `measured_one_shot_result.json` لأنه كان يُكتب في النهاية فقط، ولم تتوفر عينات CPU/الذاكرة. لم يكن ممكنًا بعدها
الفصل بين فشل العملية وانقطاع القناة وإيقاف النظام.

## 2. ما تفعله الأداة

| المتطلب | التنفيذ |
|---|---|
| حفظ تدريجي | `events.jsonl`: سطر JSON لكل حدث، يُكتب ثم `fsync` فورًا قبل متابعة التنفيذ |
| سجلات مستقلة قابلة للتحقق | سلسلة SHA-256 (`prev` → `hash`) + `seq` متتابع + `run_id`؛ `run.json` و`result.json` و`SHA256SUMS.json` تُكتب ذريًا (tmp + fsync + rename) |
| تحديد السجل الناقص | `verify` يعطي `OK` / `TRUNCATED_TAIL` (سطر أخير مقطوع عند انقطاع الكهرباء) / `CORRUPT` مع أول `seq` معطوب والسبب / `MISSING` / `EMPTY` |
| جاهزية قبل البدء | `PREFLIGHT`: إصدار Node، الكتابة مع fsync في مجلد الأدلة، المساحة الحرة، الذاكرة الحرة، زمن تشغيل النظام ووقت الإقلاع، قابلية الكتابة في قناة الإخراج، وعلى Windows استعلام قراءة فقط عن إعادة تشغيل معلّقة. أي `FAIL` يمنع تشغيل الاختبار |
| دورة الحياة | `RUN_START`، `CHILD_SPAWN` (pid، `attempt: 1`, `max_attempts: 1`)، `CHILD_EVENT`، `HEARTBEAT`، `CHILD_EXIT` (code، signal، المدة)، `CHILD_SPAWN_ERROR`، `HARNESS_TIMEOUT`، `PARENT_SIGNAL`، `REMOTE_CHANNEL_LOST`، `RUN_END` |
| قياسات | في كل `HEARTBEAT`: زمن تشغيل النظام، الذاكرة الحرة، نسبة انشغال CPU للنظام (من `os.cpus()`، تعمل على Windows)، ذاكرة وCPU الأداة؛ قياسات العملية الفرعية على Linux فقط (`/proc`)، وعلى Windows تُسجَّل صراحة `UNAVAILABLE_ON_PLATFORM` |
| منع إعادة المحاولة | تُشغَّل العملية الفرعية مرة واحدة فقط؛ المهلة تقتلها ولا تعيد تشغيلها؛ إعادة استخدام `run-id` موجود تُرفض (خروج 5) دون لمس أدلته |
| لا أسرار | لا تُسجَّل قيم argv (فقط اسم الملف التنفيذي وعددها)، ولا البيئة، ولا stdin، ولا محتوى stdout/stderr (فقط عدد البايتات)، ولا رسائل الاستثناءات |

### تقدّم العملية الفرعية

يمكن للعملية الفرعية أن تكتب على stdout سطرًا بالشكل:

```
PMH-EVENT {"stage":"DPAPI_PROTECT","status":"OK","elapsed_ms":10172}
```

يُحفظ فورًا كحدث `CHILD_EVENT`. المفاتيح المسموحة فقط: `stage, status, code, op, result, elapsed_ms, exit_code, iteration, hresult, depth`.
القيم المسموحة فقط: أرقام محدودة، قيم منطقية، أو نصوص بشكل تعداد (`UPPER_SNAKE`، أو `0xHHHHHHHH`، أو كلمة صغيرة ≤16 حرفًا).
كل ما عداها يُحذف ويُعدّ فقط (`child_fields_dropped`). أي نص حر أو قيمة تشبه مفتاحًا لا يُحفظ.

## 3. التصنيف — من الأدلة فقط

| النتيجة | الدليل المطلوب |
|---|---|
| `COMPLETED` | `RUN_END` و`CHILD_EXIT` برمز 0 |
| `PROCESS_FAILURE` | `CHILD_EXIT` برمز غير صفري أو إشارة، أو `CHILD_SPAWN_ERROR`، أو `HARNESS_TIMEOUT` |
| `REMOTE_CHANNEL_FAILURE` | `REMOTE_CHANNEL_LOST` مسجّل، ثم توقف الأداة دون `RUN_END` مع وقت إقلاع **غير متغير** |
| `OS_SHUTDOWN` | لا `RUN_END`، ووقت إقلاع الجهاز **تغيّر** بعد آخر حدث مسجّل (أكثر من 120 ث فرقًا) |
| `UNKNOWN` | كل ما سبق غير متوفر، أو الأدلة معطوبة (`CORRUPT`)، أو إشارة إنهاء للأداة الأم (مصدرها غير قابل للتحديد) |
| `PREFLIGHT_FAILED` | فشل فحص الجاهزية؛ لم تبدأ العملية الفرعية |

ملاحظات:
- **إشارة وحدها ليست دليل إيقاف.** على Windows تصل `SIGHUP`/`SIGBREAK` عند إغلاق النافذة أو تسجيل الخروج أو الإيقاف؛ تُسجَّل كما هي ولا تُفسَّر.
  `SIGHUP` يُسجَّل وتستمر الأداة (انقطاع قناة)، أما `SIGINT`/`SIGTERM`/`SIGBREAK` فتُنهي العملية الفرعية مرة واحدة وتكون النتيجة `UNKNOWN`.
- **انقطاع القناة لا يوقف الاختبار.** عند فشل الكتابة إلى stdout (مثل `EPIPE`) يُسجَّل `REMOTE_CHANNEL_LOST` وتستمر الأدلة على القرص.
- سلسلة SHA-256 تكشف التلف العرضي والقطع والحذف وإعادة الترتيب وتعديل سطر منفرد؛ وهي **لا** توفر حماية من جهة قادرة على إعادة كتابة السجل كاملًا.

## 4. التشغيل

```powershell
# فحص الجاهزية فقط (لا ينفّذ شيئًا)
node tools/harness/resilientHarness.js preflight --evidence-dir C:\pm-evidence

# تشغيل واحد (لا إعادة محاولة). يُختار run-id جديد لكل تشغيل.
node tools/harness/resilientHarness.js run --evidence-dir C:\pm-evidence --run-id futuer-2026-10-11-a `
  --label "in-memory probe" --timeout-ms 600000 --heartbeat-ms 5000 -- node <probe.js> <args>

# التحقق من الأدلة (قراءة فقط)
node tools/harness/resilientHarness.js verify --run-dir C:\pm-evidence\futuer-2026-10-11-a

# الاستعادة بعد انقطاع: على الجهاز نفسه يُقارن وقت الإقلاع تلقائيًا؛
# وعند التحليل على جهاز آخر يُعطى وقت الإقلاع من سجلات Windows:
node tools/harness/resilientHarness.js recover --run-dir <dir> --observed-boot-time 2026-10-10T19:24:47Z
```

رموز الخروج لـ `run`: `0 COMPLETED`، `1 PROCESS_FAILURE`، `2 USAGE`، `3 UNKNOWN`، `4 PREFLIGHT_FAILED`، `5 REFUSED_EXISTING_RUN`.
`recover` يكتب ملف `recovery-*.json` جديدًا في كل مرة، ولا يعدّل `events.jsonl` ولا يعيد تشغيل أي شيء (`retry_performed: false`).

## 5. حدود معروفة

- `fsync` يضمن وصول السطر إلى نظام الملفات وفق ما يوفره نظام التشغيل والقرص؛ انقطاع الكهرباء أثناء الكتابة قد يقطع السطر الأخير فقط، ويظهر `TRUNCATED_TAIL`.
- على Windows: إنهاء الشجرة يتم عبر `taskkill /T /F`؛ قياسات العملية الفرعية غير متاحة دون أدوات إضافية؛ فحوص إعادة التشغيل المعلّقة استعلامات قراءة للسجل.
  هذه المسارات لم تُختبر على Windows حقيقي بعد.
- الأداة لا تحدد **سبب** إيقاف Windows (مستخدم، تحديث، طاقة)؛ تثبت فقط أن الإقلاع حدث بعد آخر دليل.
