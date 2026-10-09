# عائق تكامل مستقل — قالب Factory `react-vite-supabase` لا يُبنى (TS2339 `import.meta.env`)

> المالك: **جلسة Project Factory** (خارج نطاق Prompt Maker). هذه الوثيقة تسجيل وعقد إصلاح مقترح فقط؛ لم يُعدَّل
> مستودع Factory في هذه الدفعة (`NO_FACTORY_SOURCE_MUTATION`).

## الحالة

| البند | القيمة |
|---|---|
| Factory | `firasfanon/palwakf-project-factory` @ `2e203c5127e18f5d33a6c4bea1bcf6bbcc186558` |
| الملف المتأثر | `profiles/react-vite-supabase/scaffold/` |
| الدليل الميداني (Futuer-IT, Windows 11, Node 24.16.0) | `npm install` = PASS (256 حزمة)؛ `npm run build` = **FAIL** بـ `TS2339` على `import.meta.env`؛ بعد إضافة `src/vite-env.d.ts` محليًا = PASS |
| التحقق الساكن في هذه الدفعة (قراءة فقط) | `src/lib/supabase.ts` يستخدم `import.meta.env.VITE_SUPABASE_URL/ANON_KEY`؛ `tsconfig.json` بوضع `strict` و`include: ["src"]` بلا `types: ["vite/client"]`؛ لا يوجد `src/vite-env.d.ts`؛ سكربت البناء `tsc && vite build` ⇒ `tsc` يرى `ImportMeta` بلا الخاصية `env` |
| التصنيف | `FACTORY_TEMPLATE_DEFECT` — ليس عيبًا في Prompt Maker |

## السبب الجذري

أنواع Vite لـ `import.meta.env` تأتي من `vite/client`. القالب لا يُحمّلها (لا ملف مرجعي ولا `compilerOptions.types`)،
فيفشل `tsc` قبل أن يصل `vite build`. Vite نفسه يقدّم الملف `src/vite-env.d.ts` في قوالبه الرسمية لهذا الغرض.

## عقد الإصلاح المقترح (لتفويضه في جلسة Factory)

```makefile
CHANGE  = add profiles/react-vite-supabase/scaffold/src/vite-env.d.ts
CONTENT = /// <reference types="vite/client" />
          interface ImportMetaEnv { readonly VITE_SUPABASE_URL: string; readonly VITE_SUPABASE_ANON_KEY: string }
          interface ImportMeta { readonly env: ImportMetaEnv }
SCOPE   = Factory scaffold only; no change to FACTORY_CONSUMER_SUBSET_V1, PROFILE_MAPPING_V1 or golden fixtures
```

البديل الأقل تفضيلًا: `"types": ["vite/client"]` في `tsconfig.json` (يحجب أنواع `@types/*` الأخرى ضمنيًا).

### معايير القبول (يتحقق منها مالك Factory)
1. `materialize` لقالب `react-vite-supabase` ثم `npm ci && npm run build` = PASS على Linux وWindows (مع `core.autocrlf=true` أيضًا).
2. حذف الملف يعيد إنتاج `TS2339` (اختبار سلبي يثبت أن الإصلاح هو السبب).
3. `tsc --noEmit` يرفض متغيرًا غير معرّف مثل `import.meta.env.VITE_TYPO` إن أضيف `ImportMetaEnv` صارمًا.
4. لا تغيير في عقود المستهلك المجمدة ولا في بصماتها؛ اختبارات Factory الحالية كلها ناجحة.
5. إعادة تشغيل UAT المشترك من Prompt Maker (`FACTORY_DIR=… node tools/uat/gfpiFactoryUat.js`) = 12/12.

## ما لا يعنيه نجاح بناء القالب

نجاح `npm run build` للقالب **لا يثبت** سلسلة Prompt Maker → Factory كاملة: يلزم أيضًا Blueprint مولَّد من الواجهة
→ `consumer.adapter materialize` → بناء واختبارات قبول التطبيق المولَّد نفسه، وهذا قرار تحقق منفصل.
