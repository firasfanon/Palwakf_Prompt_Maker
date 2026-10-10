# بيئة التشغيل — نمط React + Vite + Supabase

## المتطلبات
- Node.js: [الإصدار >= 20]
- Package manager: pnpm >= 9
- Supabase CLI: [الإصدار] — لإدارة الـ migrations والتطوير المحلي.
- Docker: مطلوب إن استُخدم Supabase محليًا (`supabase start`).

## التثبيت
```bash
git clone [repo]
cd [project]
pnpm install
cp .env.example .env
supabase start        # إن كنت تعمل على نسخة محلية من Supabase
pnpm dev
```

## متغيرات البيئة
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
(لا تضع `SUPABASE_SERVICE_ROLE_KEY` في أي متغير يبدأ بـ `VITE_` — أي متغير بهذه البادئة يُشحَن للمتصفح ويصبح عامًا)
