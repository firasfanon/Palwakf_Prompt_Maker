'use strict';

/**
 * Suggests an architecture pattern per profile composition, using a generic
 * 5-pattern reference (Layered, Clean/Hexagonal, Event-Driven, Microservices,
 * Modular Monolith) and the "ابدأ بالبسيط" (start simple unless proven
 * otherwise) principle. Always tagged INFERRED_DEFAULT — never presented as
 * a firm decision.
 */
function suggestArchitecture(profileIds) {
  if (profileIds.indexOf('MULTI_TENANT_SAAS') !== -1 || profileIds.indexOf('FINANCIAL_SYSTEM') !== -1) {
    return {
      pattern: 'Clean / Hexagonal (مبسّطة)',
      reason: 'عزل منطق الأعمال عن قاعدة البيانات والواجهة ضروري هنا لحماية قواعد العزل/التدقيق من تقلبات البنية التحتية لاحقًا.',
      source: 'INFERRED_DEFAULT',
    };
  }
  if (profileIds.indexOf('API_SERVICE') !== -1 && profileIds.length === 1) {
    return {
      pattern: 'Layered (طبقية بسيطة)',
      reason: 'خدمة API مفردة بلا تعقيد تعدد مستأجرين أو حساسية مالية — الطبقية البسيطة كافية؛ لا داعٍ لتعقيد إضافي الآن.',
      source: 'INFERRED_DEFAULT',
    };
  }
  return {
    pattern: 'Layered (طبقية بسيطة)',
    reason: 'النمط الافتراضي الأبسط — طبّق "ابدأ بالبسيط": لا يوجد مؤشر حالي (حجم، تعقيد مالي، تعدد مستأجرين) يبرر معمارية أعقد.',
    source: 'INFERRED_DEFAULT',
  };
}

module.exports = { suggestArchitecture };
