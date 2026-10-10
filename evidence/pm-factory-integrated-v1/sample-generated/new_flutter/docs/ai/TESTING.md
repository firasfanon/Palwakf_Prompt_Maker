# الاختبارات

## الأدوات
- Unit: [Vitest / Jest]
- Integration: [Supertest / ...]
- E2E: [Playwright / Cypress]
- Coverage: [أداة]

## القواعد
- كل دالة مهمة لها اختبار وحدة.
- كل نقطة API لها اختبار تكامل.
- التغطية الدنيا: [70%].
- لا دمج بدون اختبارات ناجحة.

## تشغيل الاختبارات
```bash
npm test
npm run test:coverage
npm run test:e2e
```
