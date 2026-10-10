# بنية المشروع — نمط Flutter + Supabase

## الشجرة العامة
```text
project-root/
├── docs/
│   └── ai/                      # ملفات السياق للذكاء الاصطناعي
├── lib/
│   ├── main.dart                 # نقطة الدخول
│   ├── app/                      # إعداد التطبيق (theme, routes, providers)
│   ├── core/                     # أدوات مشتركة (constants, errors, utils)
│   ├── features/                 # وحدات حسب الميزة (كل ميزة مجلد مستقل)
│   │   └── [feature_name]/
│   │       ├── data/              # مصادر البيانات (Supabase repositories)
│   │       ├── domain/            # النماذج والمنطق الصافي
│   │       └── presentation/      # الشاشات والـ widgets وإدارة الحالة
│   ├── shared/                    # widgets/مكونات قابلة لإعادة الاستخدام عبر الميزات
│   └── l10n/                      # ملفات الترجمة (إن وُجدت)
├── supabase/
│   ├── migrations/                 # SQL migrations (يُدار عبر supabase CLI)
│   └── functions/                  # Edge Functions (إن وُجدت)
├── test/
│   ├── unit/
│   └── widget/
├── integration_test/               # اختبارات E2E
├── assets/                         # صور وخطوط وملفات ثابتة
├── .env.example
├── pubspec.yaml
└── README.md
```

## قواعد التنظيم
- كل ميزة (`feature`) مستقلة قدر الإمكان: `data` لا يعرف شيئًا عن `presentation` والعكس.
- لا منطق وصول لقاعدة البيانات مباشرة داخل الـ widgets — يمر عبر `data/` فقط.
- أي migration جديد في `supabase/migrations/` يجب أن يكون قابلًا للتطبيق على بيئة نظيفة بدون تدخل يدوي.
