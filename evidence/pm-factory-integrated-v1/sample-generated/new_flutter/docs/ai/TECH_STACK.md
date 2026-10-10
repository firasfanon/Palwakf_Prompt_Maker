# الحزمة التقنية — نمط Flutter + Supabase

## اللغات
- Dart 3.x — لغة Flutter الأساسية.
- SQL — عبر Supabase (PostgreSQL).

## التطبيق (Flutter)
- الإطار: Flutter (أحدث إصدار مستقر).
- إدارة الحالة: [Riverpod / Provider / Bloc] — حدّد واحدًا فقط لكل مشروع ولا تخلط.
- التنقل (Routing): [go_router / auto_route].
- النماذج والتحقق: [flutter_form_builder + validators] أو تحقق يدوي موثّق.
- التدويل (i18n): [flutter_localizations + intl] إن كان المشروع متعدد اللغات.
- السبب: Flutter يسمح ببناء تطبيق واحد لأندرويد/iOS/الويب، مناسب لفرق صغيرة تدير عدة أنظمة.

## الخلفية (Backend-as-a-Service)
- المزوّد: Supabase (PostgreSQL + Auth + Storage + Realtime).
- المصادقة: Supabase Auth ([email/password / OAuth / Magic Link] — حدّد الطريقة الفعلية).
- الوصول لقاعدة البيانات: `supabase_flutter` SDK مباشرة من التطبيق، أو عبر Edge Functions لمنطق حساس.
- منطق الخادم المخصص: Supabase Edge Functions (Deno/TypeScript) عند الحاجة لمنطق لا يجب أن يعمل على الجهاز.

## قاعدة البيانات
- الأساسية: PostgreSQL (عبر Supabase).
- الصلاحيات: Row Level Security (RLS) إلزامي على كل جدول يحتوي بيانات مستخدمين — لا استثناءات.
- التخزين: Supabase Storage للملفات/الصور.

## الأدوات
- Package manager: pub (pubspec.yaml).
- Linter: flutter_lints أو [analysis_options.yaml مخصص].
- اختبارات: flutter_test (وحدة) + integration_test (تكامل/E2E).
- CI: GitHub Actions (flutter analyze + flutter test قبل أي دمج).
- المراقبة: [Sentry Flutter / Firebase Crashlytics] إن وُجد.

## الاستضافة
- التطبيق: متاجر Google Play / App Store، أو استضافة ويب Flutter (Vercel/Firebase Hosting) إن وُجد إصدار ويب.
- قاعدة البيانات والخلفية: Supabase.

## المكتبات المسموحة
| المكتبة | الاستخدام | ملاحظات |
|---|---|---|
| supabase_flutter | الاتصال بـ Supabase | إلزامي |
| [state management] | إدارة الحالة | حدّد واحدة فقط |
| flutter_dotenv أو --dart-define | متغيرات البيئة | لا تُثبَّت المفاتيح في الكود |

## المكتبات الممنوعة
- أي مكتبة إدارة حالة إضافية تتعارض مع المختارة أعلاه.
- تخزين مفاتيح Supabase (service_role key) داخل التطبيق مطلقًا — هذا المفتاح للخادم فقط.

## قواعد الترقية
- لا ترفع إصدار Flutter/Dart الرئيسي بدون تسجيل ذلك في DECISIONS.md.
- ثبّت الإصدارات في `pubspec.lock`.
- راجع تغييرات Supabase SDK الكبرى (breaking changes) قبل الترقية.
