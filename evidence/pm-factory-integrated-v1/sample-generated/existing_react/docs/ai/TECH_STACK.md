# الحزمة التقنية — نمط React + Vite + Supabase

## اللغات
- TypeScript 5.x — إلزامي، لا JavaScript خام في ملفات جديدة.
- SQL — عبر Supabase (PostgreSQL).

## الواجهة (Frontend)
- الإطار: React 18 + Vite.
- إدارة الحالة: [React Query للبيانات من Supabase + Zustand/Context للحالة المحلية].
- التنسيق: Tailwind CSS.
- مكونات UI: [shadcn/ui / مخصص].
- النماذج: React Hook Form + Zod.
- التوجيه: React Router.
- البناء: Vite.

## الخلفية (Backend-as-a-Service)
- المزوّد: Supabase (PostgreSQL + Auth + Storage + Realtime).
- الاتصال: `@supabase/supabase-js` مباشرة من الواجهة للعمليات المسموح بها عبر RLS.
- منطق حساس أو عمليات تحتاج صلاحيات موسّعة: Supabase Edge Functions (Deno) — لا تُنفَّذ بمفتاح service_role من المتصفح مطلقًا.

## قاعدة البيانات
- الأساسية: PostgreSQL عبر Supabase.
- الصلاحيات: Row Level Security (RLS) إلزامي على كل جدول يحتوي بيانات مستخدمين.
- ملاحظة مهمة لهذا النمط: إن كانت قاعدة بيانات Supabase هذه **مشتركة مع أنظمة أخرى** (Flutter أو React أخرى)، راجع قسم "الأنظمة المرتبطة" في `00_MASTER_CONTEXT.md` قبل أي تعديل بنيوي (جدول/View/صلاحية).

## الأدوات
- Package manager: pnpm.
- Linter: ESLint.
- Formatter: Prettier.
- اختبارات: Vitest (وحدة) + Playwright (E2E).
- CI: GitHub Actions.
- المراقبة: [Sentry / Logtail] إن وُجد.

## الاستضافة
- الواجهة: Vercel.
- قاعدة البيانات والخلفية: Supabase.

## المكتبات المسموحة
| المكتبة | الاستخدام | ملاحظات |
|---|---|---|
| @supabase/supabase-js | الاتصال بـ Supabase | إلزامي |
| zod | التحقق من المدخلات | إلزامي |
| date-fns | التواريخ | لا تستخدم moment |

## المكتبات الممنوعة
- moment.js — ثقيل ومهمل.
- jQuery — لا حاجة.
- أي مكتبة UI ضخمة إضافية بدون موافقة.
- استدعاء مفتاح `service_role` من كود يعمل في المتصفح — ممنوع مطلقًا.

## قواعد الترقية
- لا ترفع إصدارًا رئيسيًا (React/Vite/Supabase SDK) بدون ADR في DECISIONS.md.
- ثبّت الإصدارات في `pnpm-lock.yaml`.
