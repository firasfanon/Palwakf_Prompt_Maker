# مكتبة المكونات

## القائمة
| المكون | الحالة | المسار | ملاحظات |
|---|---|---|---|
| Button | ✅ جاهز | components/ui/Button | |
| Input | ✅ جاهز | components/ui/Input | |
| Modal | 🚧 قيد العمل | components/ui/Modal | |
| Table | ⏳ مخطط | — | |
| Toast | ⏳ مخطط | — | |

## قواعد إنشاء مكون جديد
1. هل هو عام؟ ضعه في `components/ui/`.
2. هل هو خاص بميزة؟ ضعه في `features/[name]/components/`.
3. وثّق props في الأعلى.
4. أضف أمثلة استخدام.
5. أضف اختبار عرض أساسي.
6. لا تكرار لمكون موجود.

## قالب مكون
```tsx
type Props = {
  // ...
};

export function ComponentName({ ... }: Props) {
  return <div>...</div>;
}