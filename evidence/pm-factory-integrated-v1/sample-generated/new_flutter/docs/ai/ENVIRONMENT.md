# بيئة التشغيل — نمط Flutter + Supabase

## المتطلبات
- Flutter SDK: [الإصدار — استخدم `flutter --version` وثبّته هنا]
- Dart SDK: يأتي مع Flutter.
- Supabase CLI: [الإصدار] — لإدارة الـ migrations والتطوير المحلي.
- محاكي/جهاز: Android Emulator أو iOS Simulator أو جهاز فعلي.
- Docker: مطلوب إن استُخدم Supabase محليًا (`supabase start`).

## التثبيت
```bash
git clone [repo]
cd [project]
flutter pub get
cp .env.example .env
supabase start        # إن كنت تعمل على نسخة محلية من Supabase
flutter run
```

## متغيرات البيئة
تُمرَّر عبر `--dart-define` أو ملف `.env` (مع `flutter_dotenv`):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
(لا تضع `SUPABASE_SERVICE_ROLE_KEY` في التطبيق مطلقًا — هذا للخادم/Edge Functions فقط)
