# تسليم التحقق المستقل على Windows (Futuer-IT) — Windows Operational Closure

> المنفّذ المستقل: ChatGPT على Futuer-IT. كل ما يلي **أوامر قراءة/اختبار** بقيم اصطناعية؛ لا تنزيل نماذج، لا تثبيت
> برامج، لا أسرار حقيقية. هذا الفرع لم يُختبر على Windows بعد: نتائج Linux أدناه منطق وبدائل اختبار، لا إثبات Windows.

## 0. التحضير (نسخة معزولة، دون المساس بالنسخة المحلية الأصلية)

```powershell
git clone -b task/gfpi-v1-windows-operational-closure https://github.com/firasfanon/Palwakf_Prompt_Maker.git D:\PALWAKF_DEV_WORKSPACE\03_TEST_LABS\GFPI_WINDOWS_CLOSURE
cd D:\PALWAKF_DEV_WORKSPACE\03_TEST_LABS\GFPI_WINDOWS_CLOSURE
git rev-parse HEAD                 # يجب أن يطابق HEAD المرشح في تقرير الدفعة
git config --get core.autocrlf      # اتركه كما هو (true) عمدًا: هذا جزء من الاختبار
npm ci
```

## 1. W-REPRO — قابلية الإعادة مع `core.autocrlf=true`

```powershell
node tests/run.js                                  # المتوقع: 125/125
node tools/generateGfpiFrozenBaseline.js --check    # المتوقع: frozen baseline intact
node tools/buildGfpiBundle.js --check               # المتوقع: fresh
node tools/buildGfpiProductionBundle.js --check     # المتوقع: fresh
node tests/gfpi/run.js                              # المتوقع: كل الاختبارات ناجحة
```

## 2. W-OLLAMA — المسار الحقيقي بالنموذج المثبت فعليًا

```powershell
node companion/cli.js probe --ollama-model qwen2.5:3b --smoke --evidence-out probe-evidence-v2.json
```

ما يجب قراءته في الدليل (لا يكفي رمز الخروج):

| الحقل | المعنى |
|---|---|
| `runtime_version` | إصدار Ollama |
| `model_load.wall_ms` / `runtime_load_ms` | زمن تحميل النموذج وحده (قبل أي توليد) |
| `smoke.attempts[0].diagnostics.first_chunk_ms` | زمن أول رمز (تقييم المطالبة) |
| `…eval_count`, `…eval_ms`, `…done_reason` | عدد رموز الإخراج وزمنها وسبب التوقف (`stop` أو `length`) |
| `…format_mode` | `SCHEMA` (إخراج مقيَّد بالمخطط) أو `JSON` (رجوع لإصدار أقدم) |
| `smoke.diagnosis` | قراءة مباشرة للأدلة: `OK` أو أين توقف التنفيذ |

النتيجة المقبولة: `exit_code = 0`، `smoke.status = OK`، `schema_valid = true`، محاولة **واحدة**. إن لم تكن كذلك فـ
`smoke.diagnosis` يحدد المرحلة (تحميل/توليد/اقتطاع/توقف) — وهذا بحد ذاته الدليل المطلوب للتشخيص، دون رفع المهلة.

## 3. W-CRED — مخزن أسرار Windows (DPAPI, CurrentUser)

```powershell
node companion/cli.js credential-selftest --evidence-out cred-selftest.json
```

المتوقع: `store_kind = OS_WINDOWS_DPAPI_CURRENT_USER`، `result = PASS`، وكل الفحوص `true`:
`set_ok`, `get_roundtrip`, `no_plaintext_at_rest`, `ciphertext_bound_to_ref`, `altered_ciphertext_rejected`, `rotate_roundtrip`,
`list_has_ref_without_value`, `delete_ok`, `get_after_delete_is_null`، والضوابط الإيجابية `control_before_binding`, `control_after_binding`,
`control_before_altered`, `control_after_altered`؛ و`cleanup.remaining = []`. لا تحتوي الأدلة أي قيمة سرية. (التفسير الكامل في §3.1.)

رفض هوية أخرى (يتطلب حساب Windows ثانيًا). طبقتان مستقلتان، والمطلوب إثبات **طبقة DPAPI** نفسها:

```powershell
# كمستخدم A:
node companion/cli.js credential-selftest --keep-for-foreign-check     # يطبع foreign_check_ref = <REF>
copy "$env:APPDATA\prompt-maker-companion\credentials\<REF>.dpapi" C:\Users\Public\
# كمستخدم B (تسجيل دخول أو runas /user:B powershell):
mkdir "$env:APPDATA\prompt-maker-companion\credentials" -Force
copy C:\Users\Public\<REF>.dpapi "$env:APPDATA\prompt-maker-companion\credentials\"
node companion/cli.js credential-selftest --verify-foreign <REF>
# المتوقع: foreign_user_cannot_decrypt = true ، rejected_by = DPAPI_CURRENT_USER ، result = PASS
# التنظيف: احذف النسخة من C:\Users\Public ومن مجلد B، ثم كمستخدم A: node companion/cli.js delete-credential <REF>
```

(إن حاول B القراءة من ملف A مباشرة فالرفض يأتي من صلاحيات NTFS: `rejected_by = FILESYSTEM_ACL` — مقبول أيضًا لكنه لا يثبت طبقة DPAPI.)

### 3.1 إصلاح D1/D2/D3 — كيف تُقرأ نتيجة `credential-selftest` (المخطط `CredentialStoreSelfTestEvidenceV2`)

**النتائج ورموز الخروج:** `PASS` (0) · `FAIL` (1) · `UNSUPPORTED_FAIL_CLOSED` (2) · `INCONCLUSIVE` (3).
`INCONCLUSIVE` يعني أن الخلفية (PowerShell/المهلة/المخرجات) تعطلت فلم يُثبَت شيء أمنيًا — ليس نجاحًا وليس رفضًا. يُعاد التشغيل ويُسلَّم `backend_diagnostics`.

**D1 — بروتوكول مؤطر:** يكتب PowerShell سطرًا واحدًا فقط: `PMOK:<base64>` أو `PMERR:<STAGE>:<OuterType>:<0xOuterHRESULT>:<CryptoDepth|N>:<0xCryptoHRESULT|N>` (دون نص رسالة الاستثناء، ودون أي قيمة سرية).
يغلّف Windows PowerShell فشل دالة .NET في `MethodInvocationException` (`0x80131501`)، ويكون رفض DPAPI هو `InnerException` (`CryptographicException`، مثل `0x8007000D`).
لذلك تفحص كتلة catch سلسلة `InnerException` بعمق أقصاه 3، ولا تعبر إلا أغلفة الاستدعاء (`MethodInvocationException`، `TargetInvocationException`)، وتبحث عن النوع المطابق تمامًا `System.Security.Cryptography.CryptographicException`. التصنيف:

| الحالة | الرمز |
|---|---|
| انتهاء المهلة أو قتل العملية | `CRED_BACKEND_TIMEOUT` |
| تعذّر تشغيل powershell.exe | `CRED_BACKEND_UNAVAILABLE` |
| خروج غير صفري بلا إطار، أو `PMERR:LOAD`/`OUTPUT` | `CRED_BACKEND_FAILED` |
| خروج 0 بمخرجات غير مؤطرة (مثل تحذيرات profile) | `CRED_BACKEND_PROTOCOL_ERROR` |
| فشل Protect | `DPAPI_PROTECT_FAILED` (ويظهر في `set` كـ `STORE_FAILED` مع `cause_code`) |
| محتوى مخزن ليس base64 أو أقصر من 16 بايت | `CIPHERTEXT_MALFORMED` |
| مرحلة `DPAPI_UNPROTECT` مع `CryptographicException` مباشرة (عمق 0) أو داخل غلاف استدعاء (عمق 1..3) فقط | الرفض الحقيقي (`ACCESS_DENIED_OR_TAMPERED`) — لا يُنسب إليه أي عطل خلفية |
| غلاف دون `CryptographicException` قابل للوصول، أو سلسلة أعمق من الحد، أو نوع فرعي، أو استثناء داخلي غير تشفيري | `CRED_BACKEND_FAILED` (لا يُعدّ رفضًا أمنيًا) |
| إطار غير متسق (عمق دون HRESULT أو العكس) | `CRED_BACKEND_PROTOCOL_ERROR` |

تظهر في `backend_diagnostics` الحقول `inner_crypto_depth` و`inner_crypto_hresult` إلى جانب النوع الخارجي وHRESULT الخاص به. النتيجة المتوقعة على Windows لرفض حقيقي: `MethodInvocationException`/`0x80131501`، العمق 1، `0x8007000D` (أو `0x8009000B`).

**D3 — لا نجاح أمني زائف:** كل فحص سلبي (`ciphertext_bound_to_ref`، `altered_ciphertext_rejected`) محاط بضابطين إيجابيين
(`control_before_*` و`control_after_*`: المرجع الأصلي يُفك فعلًا قبل الفحص وبعده). يُحسب الفحص السلبي `true` فقط عند الرفض
التشفيري الحقيقي؛ وعطل الخلفية يجعله `INCONCLUSIVE` لا `true`. `--verify-foreign` بالمثل: عطل الخلفية ⇒ `INCONCLUSIVE` و`rejected_by = NONE_BACKEND_FAULT` (خروج 3).

**D2 — تنظيف مضمون ومُتحقق منه:** كل مرجع اصطناعي يُنشأ يُحذف في `finally`، ثم يُتحقق من غياب الملف وأي ملف مؤقت
(`<ref>.dpapi.*.tmp`). الحقل `cleanup = { created, removed, remaining }` يجب أن يكون `remaining = []`؛ أي بقايا ⇒ `FAIL` مع
`RESIDUE_REMAINING`. `--keep-for-foreign-check` يُبقي المرجع **فقط** إذا نجحت كل الفحوص؛ وإلا يُحذف ويظهر `note`.

**سلامة التدوير:** `set`/`rotate` يفكّ النص المشفر الجديد ويتحقق منه **قبل** استبدال الملف (كتابة ذرية tmp+rename)؛ أي عطل يترك القيمة السابقة كما هي.

### 3.2 خطة إعادة الاختبار المستقل (على نسخة معزولة من المرشح)

```powershell
git rev-parse HEAD; git rev-parse "HEAD^{tree}"          # يطابق المرشح المعلن
# (أ) عشر جولات متتالية في وضع الخمول — المقبول: كل الجولات PASS وremaining فارغة
1..10 | % { node companion/cli.js credential-selftest --evidence-out "cred-idle-$_.json"; "run $_ exit $LASTEXITCODE" }
# (ب) عشر جولات تحت حمل استدلال محلي (نافذة أخرى تشغّل probe --smoke بشكل متكرر)
1..10 | % { node companion/cli.js credential-selftest --evidence-out "cred-load-$_.json"; "run $_ exit $LASTEXITCODE" }
# (ج) بعد كل الجولات: لا بقايا من هذه الجولات
Get-ChildItem "$env:APPDATA\prompt-maker-companion\credentials" -Filter "pm-selftest-*"
```

قواعد القبول: لا جولة بنتيجة `PASS` مع `remaining` غير فارغة (مستحيل بالتصميم)؛ أي `INCONCLUSIVE` يُسلَّم مع `backend_diagnostics`
(المرحلة، نوع الاستثناء، HRESULT، الزمن) ولا يُعدّ فشلًا أمنيًا ولا نجاحًا؛ أي `FAIL` يُسلَّم مع `failed_checks`. ثم يُعاد §3 (الهوية الأخرى).

**البقايا القديمة:** المرجع `pm-selftest-d8cf2ada` من الجولة السابقة **لا** يحذفه هذا الإصلاح ولا أي قناة غير مصرح بها؛ يحذفه المالك
(`node companion/cli.js delete-credential pm-selftest-d8cf2ada`) أو بموافقته الصريحة. ويُستثنى من فحص (ج).

## 4. N-2 — localhost وIPv6

```powershell
npm run app -- --port 8787
# في المتصفح: http://127.0.0.1:8787/ ثم http://localhost:8787/ — كلاهما يعمل؛ الاقتران بالرمز فقط
# من جهاز آخر على الشبكة: http://<IP-Futuer-IT>:8787/ — يجب ألا يتصل
node companion/cli.js probe --ollama-model qwen2.5:3b --ollama-endpoint http://localhost:11434
```

## 5. ما يُسلَّم

`probe-evidence-v2.json`، `cred-selftest.json`، مخرجات §1 كنص، ولقطة اتصال §4، مع `git rev-parse HEAD` وبصمات SHA-256.
