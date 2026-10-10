# واجهات الـ API

## الأساس
- Base URL: `/api/v1`
- المصادقة: Bearer Token في الهيدر.
- الصيغة: JSON.

## نقاط النهاية

### POST /auth/login
- الوصف: تسجيل الدخول.
- الطلب:
```json
{ "email": "user@example.com", "password": "..." }