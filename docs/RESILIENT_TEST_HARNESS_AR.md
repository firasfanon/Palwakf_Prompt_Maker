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
| Fail-Closed للحفظ | أي فشل في كتابة أو `fsync` لسطر حدث، أو لملف ذري (`run.json`/`result.json`/`SHA256SUMS.json`)، أو لمدخل المجلد (على POSIX) لا يُتجاهل: يتوقف السجل عن قبول الأحداث، وتُقتل العملية الفرعية فورًا (أو لا تبدأ أصلًا)، وتكون النتيجة `UNKNOWN` مع `EVIDENCE_DURABILITY_FAILED`، والخروج `8 EVIDENCE_FAILURE` — ولا يكون `0` أبدًا |
| سجلات مستقلة قابلة للتحقق | سلسلة SHA-256 (`prev` → `hash`) + `seq` متتابع + `run_id`؛ `run.json` و`result.json` و`SHA256SUMS.json` تُكتب ذريًا (tmp + fsync + rename + fsync للمجلد) |
| ربط النتيجة بالأحداث | `result.json` يحمل `events_sha256` و`run_end_seq`؛ و`verify` يتحقق من بصمة **كل** ملف أدلة مقابل `SHA256SUMS.json` (ملف غير مدرج، أو مدرج ومفقود، أو بصمة مختلفة = `CORRUPT`)، ومن تطابق `outcome`/`basis` في `result.json` مع حدث `RUN_END`، ومن تطابق `run.json` مع `RUN_START`. إعادة حساب البصمات بعد تزوير `result.json` لا تكفي: التزوير يُكشف من سلسلة الأحداث |
| تحديد السجل الناقص | `verify` يعطي `OK` / `TRUNCATED_TAIL` (سطر أخير مقطوع عند انقطاع الكهرباء) / `CORRUPT` مع السبب (`HASH_MISMATCH`، `SUMS_MISMATCH:<file>`، `RESULT_INCONSISTENT:<field>`، ...) / `MISSING` / `EMPTY`؛ ويذكر أي ملف غير متوقع في `unexpected_files` |
| جاهزية قبل البدء | `PREFLIGHT`: إصدار Node، الكتابة مع fsync في مجلد الأدلة (وfsync للمجلد على POSIX)، المساحة الحرة، الذاكرة الحرة، زمن تشغيل النظام ووقت الإقلاع، قابلية الكتابة في قناة الإخراج، وعلى Windows ثلاثة استعلامات قراءة فقط عن إعادة تشغيل معلّقة (`RebootRequired`، `RebootPending`، `PendingFileRenameOperations`). أي `FAIL` يمنع تشغيل الاختبار. **على Windows البوابة صارمة دائمًا (`gate: STRICT`)**: إعادة تشغيل معلّقة = `FAIL`، واستعلام لا يمكن الإجابة عنه (خطأ، مهلة، رمز خروج غير 0/1) = `FAIL`، وأي `WARN` (مثل زمن تشغيل أقل من الحد) = `FAIL`. على الأنظمة الأخرى تُفعَّل بـ `--strict-readiness` (و`--fail-on-warn` اسم بديل) |
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
لكل مفتاح قاعدة قيمة خاصة به:

| المفاتيح | القيمة المسموحة |
|---|---|
| `status`, `result` | تعداد مغلق فقط: `OK, PASS, FAIL, FAILED, ERROR, SUCCESS, SKIPPED, STARTED, RUNNING, DONE, TIMEOUT, REFUSED, DENIED, CANCELLED, PENDING, UNKNOWN, UNAVAILABLE, NOT_APPLICABLE` |
| `stage`, `op`, `code` | معرّف بأحرف كبيرة: كلمة حروف (≥2) ثم مقاطع `_XXX` (مثل `DPAPI_PROTECT`، `ERROR_ACCESS_DENIED`)؛ لا أحرف صغيرة، ولا أرقام في البداية، و`code` ليس رقمًا |
| `hresult` | `0x` + 8 خانات لرمز فشل (البت الأعلى مضبوط) أو `0x00000000` |
| `elapsed_ms`, `iteration`, `depth`, `exit_code` | أعداد صحيحة ضمن حدود |

إضافة لذلك، تُحذف أي قيمة تساوي (دون اعتبار لحالة الأحرف) قيمة من بيئة العملية الفرعية أو من argv بطول ≥3، أو تحتوي قيمة منها بطول ≥6 — حتى لو طابقت القاعدة (مثل رمز PIN `4821` أو كلمة مرور قصيرة من متغير بيئة). المقارنة في الذاكرة فقط؛ لا تُكتب القيم الحساسة أبدًا.
كل ما عداها يُحذف ويُعدّ فقط (`child_fields_dropped`). أي نص حر أو كلمة صغيرة أو قيمة تشبه مفتاحًا لا تُحفظ.

## 3. التصنيف — من الأدلة فقط

| النتيجة | الدليل المطلوب |
|---|---|
| `COMPLETED` | `RUN_END` و`CHILD_EXIT` برمز 0 |
| `PROCESS_FAILURE` | `CHILD_EXIT` برمز غير صفري أو إشارة، أو `CHILD_SPAWN_ERROR`، أو `HARNESS_TIMEOUT` |
| `REMOTE_CHANNEL_FAILURE` | `REMOTE_CHANNEL_LOST` مسجّل، ثم توقف الأداة دون `RUN_END` مع وقت إقلاع **غير متغير** |
| `OS_SHUTDOWN` | لا `RUN_END`، ووقت الإقلاع **تغيّر** عن وقت إقلاع بداية التشغيل بأكثر من 120 ث **إلى الأمام**، وليس في المستقبل بالنسبة لوقت التصنيف، ووقت الإقلاع الجديد **بعد آخر حدث مسجّل تمامًا** (`boot > last_event`). إقلاع عند آخر حدث أو قبله = `UNKNOWN` (`BOOT_NOT_AFTER_LAST_EVENT`) لأن الحدث نفسه يثبت أن التشغيل كان حيًا بعد ذلك الإقلاع؛ وإقلاع رجع للخلف = `UNKNOWN` (`CLOCK_INCONSISTENT`) |
| `UNKNOWN` | كل ما سبق غير متوفر، أو الأدلة معطوبة (`CORRUPT`)، أو فشل حفظ الأدلة (`EVIDENCE_DURABILITY_FAILED`)، أو إشارة إنهاء للأداة الأم (مصدرها غير قابل للتحديد) |
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

رموز الخروج لـ `run`: `0 COMPLETED`، `1 PROCESS_FAILURE`، `2 USAGE`، `3 UNKNOWN`، `4 PREFLIGHT_FAILED`، `5 REFUSED_EXISTING_RUN`، `6 REMOTE_CHANNEL_FAILURE`، `7 OS_SHUTDOWN`، `8 EVIDENCE_FAILURE` (فشل حفظ الأدلة؛ Fail-Closed).
`recover` يكتب ملف `recovery-*.json` جديدًا في كل مرة، ولا يعدّل `events.jsonl` ولا يعيد تشغيل أي شيء (`retry_performed: false`).

## 5. حدود معروفة

- `fsync` يضمن وصول السطر إلى نظام الملفات وفق ما يوفره نظام التشغيل والقرص؛ انقطاع الكهرباء أثناء الكتابة قد يقطع السطر الأخير فقط، ويظهر `TRUNCATED_TAIL`.
- على Windows لا يستطيع Node فتح مجلد لإجراء `fsync` عليه؛ يعتمد ثبات `rename` هناك على سجل بيانات NTFS الوصفية، ويُسجَّل ذلك صراحة في `run.json` (`dir_fsync: NOT_SUPPORTED_ON_WIN32`).
- `reg query` يعيد 1 عند عدم وجود المفتاح؛ لا يميّز ذلك عن بعض أخطاء الوصول، فيُفسَّر 1 كـ `ABSENT`، وأي رمز آخر أو خطأ أو مهلة كـ `UNAVAILABLE` (يُمنع التشغيل).
- `SHA256SUMS.json` غير موقَّع: من يستطيع إعادة كتابة كل الملفات يستطيع إعادة حساب البصمات؛ الحماية الفعلية من التزوير هي ربط `result.json` بسلسلة الأحداث.
- اختبارات S17 لا تقرأ وقت إقلاع الجهاز ولا ساعته في أي تصنيف: كل استعادة تُعطى وقت إقلاع وزمن "الآن" محقونين (R6).
- على Windows: إنهاء الشجرة يتم عبر `taskkill /T /F`؛ قياسات العملية الفرعية غير متاحة دون أدوات إضافية؛ فحوص إعادة التشغيل المعلّقة استعلامات قراءة للسجل.
  هذه المسارات لم تُختبر على Windows حقيقي بعد.
- الأداة لا تحدد **سبب** إيقاف Windows (مستخدم، تحديث، طاقة)؛ تثبت فقط أن الإقلاع حدث بعد آخر دليل.
