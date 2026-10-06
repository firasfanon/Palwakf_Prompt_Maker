'use strict';

const BY_RULE_ID = {
  'UAT-001': { criteria: 'تحميل كل صفحة رئيسية بدون أخطاء على عرض 1280px وما فوق', evidence: 'لقطة شاشة أو تسجيل جلسة متصفح فعلي', current_evidence_status: 'NOT_EXECUTED' },
  'UAT-002': { criteria: 'تحميل كل صفحة رئيسية بدون كسر تخطيط على عرض 390px', evidence: 'لقطة شاشة أو تسجيل جلسة متصفح فعلي على عرض 390px', current_evidence_status: 'NOT_EXECUTED' },
  'AUTH-002': { criteria: 'مستخدم بصلاحية عادية لا يستطيع الوصول إلى مسار صلاحية مرتفعة', evidence: 'اختبار تلقائي يحاول الوصول ويتوقع رفضًا (403/401)', current_evidence_status: 'NOT_EXECUTED' },
  'AUTH-003': { criteria: 'كل عملية مالية تُنشئ سجل تدقيق قابل للاستعلام', evidence: 'اختبار يُنشئ عملية ثم يستعلم سجل التدقيق المطابق', current_evidence_status: 'NOT_EXECUTED' },
  'DATA-002': { criteria: 'كل Migration يملك مسارًا للتراجع (down migration) تم تنفيذه فعليًا على بيئة اختبار', evidence: 'سجل تنفيذ up ثم down بدون خطأ', current_evidence_status: 'NOT_EXECUTED' },
  'DATA-006': { criteria: 'كل مفتاح خارجي (foreign key) موثق في نموذج البيانات مع سلوك الحذف المرتبط', evidence: 'مراجعة مخطط قاعدة البيانات', current_evidence_status: 'NOT_EXECUTED' },
  'TEST-002': { criteria: 'كل مسار مستخدم حرج مذكور في user_journeys يملك اختبار تكامل واحدًا على الأقل', evidence: 'تقرير تنفيذ اختبارات التكامل', current_evidence_status: 'NOT_EXECUTED' },
  'TEST-003': { criteria: 'تشغيل فعلي لاختبار قبول على متصفح حقيقي (ليس محاكاة)', evidence: 'لقطة شاشة أو تسجيل فعلي', current_evidence_status: 'BLOCKED_NO_BROWSER_IN_ENVIRONMENT' },
  'SEC-002': { criteria: 'توثيق مسار واحد على الأقل يعالج محاولة حقن توجيه (prompt injection) دون تنفيذ تعليمات ضارة', evidence: 'حالة اختبار محاكاة لمحاولة حقن', current_evidence_status: 'NOT_EXECUTED' },
  'SEC-004': { criteria: 'كل إجابة من المساعد الذكي تحمل حقل استشهاد قابل للتتبع', evidence: 'فحص بنية استجابة واحدة على الأقل', current_evidence_status: 'NOT_EXECUTED' },
  'DOC-001': { criteria: 'وجود ملف واحد على الأقل يوثق كل قرار معماري رئيسي مع سببه', evidence: 'ملف ADR أو ما يعادله في المستودع', current_evidence_status: 'NOT_EXECUTED' }
};

const BY_DOMAIN_FALLBACK = {
  PRODUCT_COMPLETENESS: { criteria: 'مراجعة يدوية لحدود النطاق مقابل هدف المشروع المصرَّح به', evidence: 'مراجعة نصية', current_evidence_status: 'NOT_EXECUTED' },
  ARCHITECTURE: { criteria: 'مراجعة هيكل المجلدات/الوحدات يطابق النمط المعماري المقترح', evidence: 'مراجعة كود', current_evidence_status: 'NOT_EXECUTED' },
  DATA: { criteria: 'مراجعة نموذج البيانات مقابل القاعدة المذكورة', evidence: 'مراجعة مخطط', current_evidence_status: 'NOT_EXECUTED' },
  VALIDATION: { criteria: 'اختبار يرسل مدخلًا غير صالح ويتوقع رفضه من الخادم', evidence: 'نتيجة اختبار', current_evidence_status: 'NOT_EXECUTED' },
  AUTHENTICATION: { criteria: 'اختبار تسجيل دخول صالح وغير صالح', evidence: 'نتيجة اختبار', current_evidence_status: 'NOT_EXECUTED' },
  AUTHORIZATION: { criteria: 'اختبار وصول حسب الدور', evidence: 'نتيجة اختبار', current_evidence_status: 'NOT_EXECUTED' },
  SECURITY: { criteria: 'مراجعة أمنية موثقة للمسارات الحساسة', evidence: 'تقرير مراجعة', current_evidence_status: 'NOT_EXECUTED' },
  PRIVACY: { criteria: 'مراجعة سياسة الخصوصية مقابل المتطلبات التنظيمية المذكورة', evidence: 'مراجعة نصية', current_evidence_status: 'NOT_EXECUTED' },
  API_CONTRACTS: { criteria: 'مراجعة توثيق العقد مقابل التنفيذ الفعلي', evidence: 'مراجعة توثيق', current_evidence_status: 'NOT_EXECUTED' },
  INTEGRATIONS: { criteria: 'اختبار تكامل فعلي أو محاكى مع كل خدمة خارجية مذكورة', evidence: 'نتيجة اختبار', current_evidence_status: 'NOT_EXECUTED' },
  PERFORMANCE: { criteria: 'قياس زمن استجابة أساسي على بيانات تجريبية', evidence: 'تقرير قياس', current_evidence_status: 'NOT_EXECUTED' },
  OBSERVABILITY: { criteria: 'تحقق من ظهور سجلات منظمة عند تشغيل العملية', evidence: 'مراجعة سجلات', current_evidence_status: 'NOT_EXECUTED' },
  RELIABILITY: { criteria: 'اختبار محاكاة فشل والتحقق من المعالجة', evidence: 'نتيجة اختبار', current_evidence_status: 'NOT_EXECUTED' },
  BACKUP_RESTORE: { criteria: 'تنفيذ فعلي لاستعادة نسخة احتياطية على بيئة اختبار', evidence: 'سجل تنفيذ استعادة', current_evidence_status: 'NOT_EXECUTED' },
  TESTING: { criteria: 'تقرير تنفيذ اختبارات مع نسبة النجاح', evidence: 'تقرير اختبار', current_evidence_status: 'NOT_EXECUTED' },
  BROWSER_UAT: { criteria: 'تنفيذ فعلي على متصفح حقيقي', evidence: 'لقطة شاشة أو تسجيل', current_evidence_status: 'BLOCKED_NO_BROWSER_IN_ENVIRONMENT' },
  UX: { criteria: 'مراجعة وصولية أساسية (تباين الألوان، تسميات النماذج)', evidence: 'مراجعة يدوية', current_evidence_status: 'NOT_EXECUTED' },
  CI_CD: { criteria: 'تشغيل فعلي لخط أنابيب CI على التزام تجريبي', evidence: 'سجل تشغيل CI', current_evidence_status: 'NOT_EXECUTED' },
  DOCUMENTATION: { criteria: 'مراجعة وجود الوثيقة المطلوبة في المستودع', evidence: 'مراجعة ملفات', current_evidence_status: 'NOT_EXECUTED' }
};

function getAcceptanceCriteria(rule) {
  if (BY_RULE_ID[rule.rule_id || rule.id]) {
    return Object.assign({ source_type: 'RULE_SPECIFIC', source_id: rule.rule_id || rule.id }, BY_RULE_ID[rule.rule_id || rule.id]);
  }
  const domain = rule.domain;
  if (BY_DOMAIN_FALLBACK[domain]) {
    return Object.assign({ source_type: 'DOMAIN_FALLBACK', source_id: domain }, BY_DOMAIN_FALLBACK[domain]);
  }
  return {
    criteria: 'مراجعة يدوية عامة (لا يوجد معيار محدد مسجل لهذا المجال)',
    evidence: 'مراجعة نصية',
    current_evidence_status: 'NOT_EXECUTED',
    source_type: 'GENERIC_FALLBACK',
    source_id: null
  };
}

module.exports = { BY_RULE_ID, BY_DOMAIN_FALLBACK, getAcceptanceCriteria };
