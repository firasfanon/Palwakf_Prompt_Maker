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
`list_has_ref_without_value`, `delete_ok`, `get_after_delete_is_null`. لا تحتوي الأدلة أي قيمة سرية.

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

## 4. N-2 — localhost وIPv6

```powershell
npm run app -- --port 8787
# في المتصفح: http://127.0.0.1:8787/ ثم http://localhost:8787/ — كلاهما يعمل؛ الاقتران بالرمز فقط
# من جهاز آخر على الشبكة: http://<IP-Futuer-IT>:8787/ — يجب ألا يتصل
node companion/cli.js probe --ollama-model qwen2.5:3b --ollama-endpoint http://localhost:11434
```

## 5. ما يُسلَّم

`probe-evidence-v2.json`، `cred-selftest.json`، مخرجات §1 كنص، ولقطة اتصال §4، مع `git rev-parse HEAD` وبصمات SHA-256.
