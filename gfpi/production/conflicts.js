'use strict';

/**
 * Deterministic conflict detection between production decisions (no model opinion). A conflict between two USER-CONFIRMED
 * decisions is blocking (the human has asked for two things that cannot both hold); if a side is still only a pending
 * recommendation the finding is advisory so the human can resolve it while confirming.
 */

const CONFIRMED = ['USER_CONFIRMED', 'USER_EDITED'];
const PENDING = ['AI_RECOMMENDED_PENDING_APPROVAL', 'ANSWERED'];

const RULES = [
  { id: 'C1_RPO_VS_BACKUP', a: ['nfr_data_loss_rpo', ['NONE_ACCEPTABLE', 'MINUTES_UP_TO_5']], b: ['backup_policy', ['DAILY_AUTOMATED', 'WEEKLY_MANUAL']],
    en: 'Losing at most a few minutes of data cannot be met with daily or weekly backups.', ar: 'تحمّل فقدان دقائق قليلة فقط من البيانات لا يتحقق بنسخ احتياطي يومي أو أسبوعي.' },
  { id: 'C2_AVAILABILITY_VS_RECOVERY_TIME', a: ['nfr_availability', ['HIGH_99_9', 'CRITICAL_99_95']], b: ['nfr_recovery_time_rto', ['UP_TO_24_HOURS', 'UP_TO_72_HOURS']],
    en: 'Very high availability is incompatible with accepting a day or more to recover.', ar: 'التوفر العالي جدًا لا يتفق مع قبول يوم أو أكثر للاستعادة.' },
  { id: 'C3_CRITICAL_AVAILABILITY_VS_MONITORING', a: ['nfr_availability', ['CRITICAL_99_95']], b: ['observability', ['LOGS_ONLY']],
    en: 'Critical availability needs alerts and metrics, not logs alone.', ar: 'التوفر الحرج يحتاج تنبيهات ومقاييس لا سجلات فقط.' },
  { id: 'C4_REGULATED_DATA_VS_LIGHT_AUDIT', a: ['data_classes', ['HEALTH_OR_OTHER_REGULATED']], b: ['audit_trail', ['AUDIT_SECURITY_EVENTS_ONLY']],
    en: 'Regulated or health data needs auditing of data changes, not only security events.', ar: 'البيانات الصحية أو المنظَّمة تحتاج تدقيقًا لتغييرات البيانات لا لأحداث الأمن فقط.' },
  { id: 'C5_SINGLE_TENANT_WITH_TENANT_ISOLATION', a: ['tenancy_model', ['SINGLE_TENANT']], b: ['tenant_isolation', ['RLS_SHARED_SCHEMA', 'SCHEMA_PER_TENANT', 'DATABASE_PER_TENANT']],
    en: 'A single-customer system was chosen but a multi-customer isolation design is still recorded.', ar: 'اخترت نظام جهة واحدة لكن ما زال مسجَّلًا تصميم عزل لعدة جهات.' },
  { id: 'C6_HIGH_AVAILABILITY_WITHOUT_STAGING', a: ['nfr_availability', ['HIGH_99_9', 'CRITICAL_99_95']], b: ['deployment_envs', ['DEV_PRODUCTION_ONLY']],
    en: 'High availability without a staging environment means changes are tested on live users.', ar: 'التوفر العالي دون بيئة تجريبية يعني اختبار التغييرات على المستخدمين الفعليين.' },
];

function kindOf(s, vals) {
  if (!s || s.value === null || s.value === undefined) return null;
  if (typeof s.value !== 'string' || vals.indexOf(s.value) === -1) return null;
  if (CONFIRMED.indexOf(s.state) !== -1) return 'CONFIRMED';
  if (PENDING.indexOf(s.state) !== -1) return 'PENDING';
  return null;
}

function detect(states) {
  const out = [];
  RULES.forEach((r) => {
    const ka = kindOf(states[r.a[0]], r.a[1]); const kb = kindOf(states[r.b[0]], r.b[1]);
    if (!ka || !kb) return;
    out.push({ rule_id: r.id, items: [r.a[0], r.b[0]], values: [states[r.a[0]].value, states[r.b[0]].value], blocking: ka === 'CONFIRMED' && kb === 'CONFIRMED', message_en: r.en, message_ar: r.ar,
      remedy: 'Change one of the two decisions (the change shows what else it affects).' });
  });
  return out;
}

module.exports = { detect, RULES };
