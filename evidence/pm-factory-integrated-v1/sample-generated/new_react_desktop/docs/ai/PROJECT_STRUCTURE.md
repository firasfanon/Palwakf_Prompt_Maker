# بنية المشروع — نمط React + Vite + Supabase

## الشجرة العامة
```text
project-root/
├── docs/
│   └── ai/                  # ملفات السياق للذكاء الاصطناعي
├── src/
│   ├── app/                 # نقاط الدخول والصفحات وإعداد التوجيه
│   ├── components/          # مكونات قابلة لإعادة الاستخدام (UI عام)
│   ├── features/            # وحدات حسب الميزة
│   │   └── [feature_name]/
│   │       ├── components/
│   │       ├── hooks/
│   │       └── api/          # استدعاءات Supabase الخاصة بهذه الميزة
│   ├── lib/
│   │   └── supabase.ts       # عميل Supabase الموحّد (نسخة واحدة فقط في المشروع)
│   ├── hooks/                # React hooks مشتركة
│   ├── store/                # إدارة الحالة المحلية
│   ├── types/                # الأنواع المشتركة (بما فيها أنواع الجداول المولّدة من Supabase)
│   ├── utils/                # دوال مساعدة صغيرة
│   └── styles/               # الأنماط العامة
├── supabase/
│   └── migrations/           # SQL migrations (مُدارة عبر supabase CLI)
├── tests/
│   ├── unit/
│   └── e2e/
├── public/
├── .env.example
├── package.json
└── README.md
```

## قواعد التنظيم
- عميل Supabase واحد فقط (`lib/supabase.ts`) — لا تُنشئ نسخًا متعددة منه.
- لا استعلامات Supabase مباشرة داخل مكونات الواجهة — تمر عبر `features/[name]/api/`.
- أي تعديل على `supabase/migrations/` يُطبَّق أولًا في بيئة تطوير قبل الإنتاج.
