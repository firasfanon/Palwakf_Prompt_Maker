# تحقق Windows — Prompt Maker + Project Factory (PM-FULL-PRODUCTION-INTEGRATED-V1)

> الحالة في هذه الدفعة: **`WINDOWS = NOT_RUN`**. نُفّذ كل ما يلي على Linux في بيئة التطوير؛ لم تتوفر قناة تنفيذ أوامر على جهاز Windows.
> هذه الوثيقة أوامر جاهزة للتحقق المستقل على جهاز Windows (مثل Futuer-IT). لا تُحتسب أي خطوة PASS قبل تشغيلها فعليًا وإرفاق مخرجاتها.

## المتطلبات
Git، Node.js 18+ (يُفضل 22 أو 24)، Python 3.10+ (أمر `python` يعمل فعلًا وليس اختصار Microsoft Store)، اتصال بسجل npm.
اختياري: Flutter SDK (وإلا تُسجَّل اختبارات Flutter كـ `NOT_RUN`)، و`tsc` على PATH (`npm i -g typescript`) لفحص الأنواع المستقل.

## 1. نسخ نظيفة من الفروع المعزولة (لا تستخدم نسخًا محلية قديمة)
```powershell
$WS = "D:\PALWAKF_DEV_WORKSPACE\verify-pm-factory-v1"
New-Item -ItemType Directory -Force $WS | Out-Null; Set-Location $WS
git clone --branch task/pm-factory-full-production-integrated-v1 https://github.com/firasfanon/Palwakf_Prompt_Maker.git pm
git clone --branch task/factory-vite-env-fix-v1 https://github.com/firasfanon/palwakf-project-factory.git factory
git -C pm rev-parse HEAD HEAD^{tree}         # يجب أن يطابق التقرير النهائي
git -C factory rev-parse HEAD HEAD^{tree}    # يجب أن يطابق التقرير النهائي
```

## 2. Factory
```powershell
Set-Location "$WS\factory"; python -m unittest discover -s tests -v 2>&1 | Tee-Object "$WS\factory_tests.log"
```
المتوقع: `Ran 53 tests ... OK` (قد يُتخطى اختبار الروابط الرمزية إن لم تكن مسموحة).

## 3. Prompt Maker
```powershell
Set-Location "$WS\pm"; npm ci; npx playwright install chromium
node tests/run.js; node tests/gfpi/run.js
node tests/browser/run.js; node tests/browser/gfpi.run.js; node tests/browser/gfpi_production.run.js
node tests/browser/pm_product.run.js --evidence "$WS\pm_product_evidence"
```
المتوقع: 125 · 201 · 30 · 38 · 26 · 18 بلا فشل.

## 4. التكامل المشترك مع بناء فعلي للمشروع المولَّد
```powershell
$env:FACTORY_DIR = "$WS\factory"; Set-Location "$WS\pm"
node tools/uat/pmFactoryIntegration.js --out "$WS\integ" 2>&1 | Tee-Object "$WS\integ.log"
```
على Windows مع سجل npm متاح يُنفَّذ `npm install` و`npm run build` للمشروع المولَّد من واجهة Prompt Maker فعليًا،
ويُتوقع `PASS new_react_desktop.npm_run_build`. إن توفر Flutter تُنفَّذ `flutter pub get/analyze/test` تلقائيًا.

### 4.ب نفس الفحص مع `core.autocrlf=true` (معيار قبول إصلاح vite-env)
```powershell
git -c core.autocrlf=true clone --branch task/factory-vite-env-fix-v1 https://github.com/firasfanon/palwakf-project-factory.git factory-crlf
$env:FACTORY_DIR = "$WS\factory-crlf"; node tools/uat/pmFactoryIntegration.js --out "$WS\integ-crlf"
```

## 5. حزمة المرشح
فك ضغط `prompt-maker-candidate-<sha>.zip`، تحقّق من البصمة (`Get-FileHash -Algorithm SHA256`) مقابل ملف `.sha256`،
ثم انقر `start-windows.cmd` وافتح `http://127.0.0.1:8787/`.

## ما يُعاد للمراجعة
`factory_tests.log`، مخرجات الأوامر في القسم 3، المجلدان `integ` و`integ-crlf` كاملين (`results.json`، `SUMMARY.md`، `logs/`، `shots/`)،
ومجلد `pm_product_evidence`. أي خطوة لم تُشغَّل تبقى `NOT_RUN`.

## خارج النطاق
لا تُشغَّل هنا اختبارات G4 (استقرار DPAPI/Ollama الحقيقي) — محجوبة حتى تفويض مستقل.
