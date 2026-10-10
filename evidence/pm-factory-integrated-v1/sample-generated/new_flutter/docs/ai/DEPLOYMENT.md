# النشر

## البيئات
- Development: محلي.
- Staging: [رابط].
- Production: [رابط].

## خطوات النشر
1. دمج الفرع في `main`.
2. تشغيل CI (اختبارات + build).
3. نشر تلقائي عبر [Vercel / GitHub Actions / ...].
4. التحقق من الصحة.
5. مراقبة السجلات لمدة [X] دقيقة.

## متطلبات الإنتاج
- HTTPS.
- متغيرات البيئة محدثة.
- نسخ احتياطي لقاعدة البيانات.
- مراقبة (Sentry / ...).

## Rollback
- عبر [لوحة التحكم / git revert].
- أقصى وقت للاستجابة: [X دقيقة].

## CI/CD
```yaml
# مثال مختصر
on: [push]
jobs:
  test:
    steps: [install, lint, test, build]