'use strict';

/**
 * Generic lifecycle journey + per-profile customization. Proves real
 * differentiation (section 15/36), not just name/description substitution.
 */
const GENERIC_JOURNEY = ['Discover', 'Input/Create', 'Validate', 'Persist', 'Retrieve', 'Edit', 'Process', 'Complete/Cancel', 'Notify', 'Audit'];

const PROFILE_JOURNEYS = {
  ECOMMERCE: ['تصفّح المنتجات', 'إضافة للسلة', 'الدفع (Checkout)', 'تأكيد الطلب', 'تتبع الشحن'],
  BOOKING_SYSTEM: ['اختيار الموعد المتاح', 'تأكيد الحجز', 'إرسال تذكير', 'الحضور أو الإلغاء', 'تقييم بعد الخدمة (اختياري)'],
  AI_ASSISTANT: ['طرح السؤال', 'استرجاع السياق', 'توليد إجابة مع درجة ثقة', 'عرض المصادر إن وُجدت', 'تصعيد لمراجعة بشرية عند الشك'],
  FINANCIAL_SYSTEM: ['إدخال المعاملة', 'تحقق مزدوج', 'ترحيل للسجل غير القابل للتعديل', 'مطابقة/تسوية', 'تقرير مالي'],
  GIS_SYSTEM: ['تحديد نطاق الدراسة', 'استعلام مكاني', 'عرض الطبقات', 'تحليل التداخل/القرب', 'تصدير الخريطة'],
  API_SERVICE: ['استقبال الطلب', 'تحقق من صحة المدخلات', 'تنفيذ المنطق', 'إرجاع استجابة موحّدة الشكل', 'تسجيل الحدث'],
};

function compileJourneys(profileIds) {
  const journeys = [{ name: 'الدورة العامة (Generic Lifecycle)', steps: GENERIC_JOURNEY, source: 'INFERRED_DEFAULT' }];
  profileIds.forEach((id) => {
    if (PROFILE_JOURNEYS[id]) {
      journeys.push({ name: 'رحلة مخصصة: ' + id, steps: PROFILE_JOURNEYS[id], source: 'INFERRED_DEFAULT' });
    }
  });
  return journeys;
}

module.exports = { compileJourneys, GENERIC_JOURNEY, PROFILE_JOURNEYS };
