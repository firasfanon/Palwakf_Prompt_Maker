'use strict';

const D = require('./decisions');

/**
 * Deterministic, versioned question plan (NOT AI-generated; the UI must say so).
 * Same plan for GUIDED / ASSISTED / EXPERT: modes differ only in presentation and in whether provider
 * assistance is offered, never in what counts as a confirmed decision.
 */
const QUESTION_PLAN_VERSION = 'QP-1.0';
const MODES = ['GUIDED', 'ASSISTED', 'EXPERT'];

const SENSITIVITY = [
  { value: 'NONE', ar: 'لا بيانات شخصية', en: 'No personal data' },
  { value: 'PERSONAL', ar: 'بيانات شخصية عادية (اسم، بريد، هاتف)', en: 'Ordinary personal data (name, email, phone)' },
  { value: 'FINANCIAL_OR_HEALTH', ar: 'بيانات مالية أو صحية', en: 'Financial or health data' },
  { value: 'GOVERNMENT_SENSITIVE', ar: 'بيانات حكومية أو سيادية حساسة', en: 'Government or highly sensitive data' },
];
const TECH_CHOICES = [
  { value: 'react-vite-supabase', ar: 'React + Vite + Supabase (موقع أو تطبيق ويب)', en: 'React + Vite + Supabase (web app)' },
  { value: 'flutter-supabase', ar: 'Flutter + Supabase (تطبيق جوال)', en: 'Flutter + Supabase (mobile app)' },
];

const PLAN = {
  project_name: { kind: 'text', q: { ar: 'ما اسم مشروعك؟', en: 'What is your project called?' }, help: { ar: 'أي اسم تعمل به الآن، يمكن تغييره لاحقًا.', en: 'Any working name; you can change it later.' } },
  project_idea: { kind: 'longtext', q: { ar: 'صف فكرتك بكلماتك البسيطة.', en: 'Describe your idea in plain words.' }, help: { ar: 'لا حاجة لمصطلحات تقنية.', en: 'No technical terms needed.' } },
  project_goal: { kind: 'longtext', q: { ar: 'ما المشكلة التي يحلها المشروع ولمن؟', en: 'What problem does it solve, and for whom?' }, help: { ar: 'جملة أو جملتان.', en: 'One or two sentences.' } },
  success_measures: { kind: 'longtext', q: { ar: 'كيف ستعرف أن المشروع نجح؟', en: 'How will you know it worked?' }, help: { ar: 'مثال: 100 مستخدم خلال شهر.', en: 'Example: 100 users in a month.' } },
  users_roles: { kind: 'pair', fields: ['users', 'roles'], q: { ar: 'من سيستخدم النظام؟ وما أدوارهم؟', en: 'Who will use it, and in what roles?' }, help: { ar: 'مثال: مدير، موظف، زائر.', en: 'Example: admin, staff, visitor.' } },
  workflows: { kind: 'longtext', q: { ar: 'ما أهم ما يفعله كل مستخدم خطوة بخطوة؟', en: 'What does each user do, step by step?' }, help: { ar: 'اكتب 3 مسارات رئيسية على الأقل.', en: 'Write at least 3 main flows.' } },
  scope: { kind: 'longtext', q: { ar: 'ما الذي يدخل في المشروع وما الذي يبقى خارجه؟', en: 'What is in scope and what is out?' }, help: { ar: 'الخارج مهم بقدر الداخل.', en: 'What is out matters as much.' } },
  business_rules: { kind: 'longtext', q: { ar: 'هل توجد قواعد أو شروط لا يجوز كسرها؟', en: 'Are there rules that must never be broken?' }, help: { ar: 'مثال: لا يُحذف سجل مالي.', en: 'Example: financial records are never deleted.' } },
  platforms: { kind: 'text', q: { ar: 'أين سيعمل؟ (موقع، جوال، سطح مكتب)', en: 'Where will it run? (web, mobile, desktop)' }, help: { ar: 'اختر ما تعرفه فقط.', en: 'Only what you know.' } },
  languages: { kind: 'text', q: { ar: 'ما اللغات المطلوبة؟', en: 'Which languages are needed?' }, help: { ar: 'مثال: العربية والإنجليزية.', en: 'Example: Arabic and English.' } },
  data_entities: { kind: 'longtext', q: { ar: 'ما المعلومات التي يجب أن يحفظها النظام؟', en: 'What information must the system keep?' }, help: { ar: 'مثال: عملاء، طلبات، فواتير.', en: 'Example: customers, orders, invoices.' } },
  integrations: { kind: 'longtext', q: { ar: 'هل يتصل بأنظمة أخرى؟ (دفع، بريد، حكومي)', en: 'Does it connect to other systems? (payments, email, government)' }, help: { ar: 'إن لم يكن، اختر لا ينطبق مع السبب.', en: 'If none, choose not-applicable with a reason.' } },
  data_sensitivity: { kind: 'choice', choices: SENSITIVITY, q: { ar: 'ما مدى حساسية البيانات؟', en: 'How sensitive is the data?' }, help: { ar: 'يحدد مستوى الحماية المطلوب.', en: 'Determines the protection level.' } },
  auth_model: { kind: 'longtext', q: { ar: 'كيف يسجل المستخدمون دخولهم ومن يرى ماذا؟', en: 'How do users sign in and who sees what?' }, help: { ar: 'مثال: بريد وكلمة مرور؛ المدير يرى الكل.', en: 'Example: email+password; admin sees all.' } },
  secrets_handling: { kind: 'longtext', q: { ar: 'هل ستُستخدم مفاتيح أو كلمات سر خارجية؟ أين تُحفظ؟', en: 'Will external keys or passwords be used? Where kept?' }, help: { ar: 'لا تكتب المفاتيح نفسها هنا أبدًا.', en: 'Never type the keys themselves here.' } },
  availability_targets: { kind: 'longtext', q: { ar: 'كم مستخدمًا متوقع؟ وهل يجب أن يعمل دائمًا؟', en: 'How many users, and must it always be up?' }, help: { ar: 'تقدير تقريبي يكفي.', en: 'A rough estimate is fine.' } },
  technology_stack: { kind: 'choice', choices: TECH_CHOICES, allow_manual: true, q: { ar: 'هل لديك تقنية محددة؟', en: 'Do you have a specific technology?' }, help: { ar: 'يمكنك تركه للنظام ليقترح لاحقًا، ولن يُعتمد شيء دون موافقتك.', en: 'You may leave it for a later proposal; nothing is adopted without your approval.' } },
  architecture: { kind: 'longtext', q: { ar: 'ملاحظات على البنية العامة (إن وجدت)', en: 'Notes on the overall structure (if any)' }, help: { ar: 'يمكن تأجيله بشرط واضح.', en: 'May be deferred with an explicit gate.' } },
  hosting_target: { kind: 'longtext', q: { ar: 'أين ستستضيف المشروع وما ميزانيته؟', en: 'Where will it be hosted and at what budget?' }, help: { ar: 'يمكن تأجيله حتى مرحلة النشر.', en: 'May be deferred until the deployment phase.' } },
  testing_expectations: { kind: 'longtext', q: { ar: 'ما مستوى الاختبار المتوقع؟', en: 'What level of testing do you expect?' }, help: { ar: 'مثال: اختبار الوظائف الأساسية.', en: 'Example: test core features.' } },
  brand_copy: { kind: 'longtext', q: { ar: 'هوية أو نصوص خاصة (اختياري)', en: 'Branding or copy (optional)' }, help: { ar: 'اختياري.', en: 'Optional.' } },
};

function planFor(mode) {
  if (MODES.indexOf(mode) === -1) throw new Error('unknown mode ' + mode);
  return {
    version: QUESTION_PLAN_VERSION, mode, source: 'DETERMINISTIC_PREDEFINED',
    items: D.ITEM_CATALOG.map((it) => Object.assign({ item_id: it.id, mandatory: it.mandatory, na_allowed: it.na_allowed, blocks: it.blocks, label: it.label }, PLAN[it.id])),
  };
}

const MAX_LEN = 5000;
/** Deterministic answer validation. Returns {ok} or {ok:false, error_code}. */
function validateAnswer(itemId, value) {
  const p = PLAN[itemId];
  if (!p) return { ok: false, error_code: 'UNKNOWN_ITEM' };
  const isTxt = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_LEN && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s);
  if (p.kind === 'pair') {
    if (!value || typeof value !== 'object') return { ok: false, error_code: 'EXPECTED_OBJECT' };
    for (const f of p.fields) if (!isTxt(value[f])) return { ok: false, error_code: 'EMPTY_OR_INVALID_' + f.toUpperCase() };
    return { ok: true };
  }
  if (!isTxt(value)) return { ok: false, error_code: 'EMPTY_OR_INVALID_TEXT' };
  if (p.kind === 'choice') {
    const known = p.choices.some((c) => c.value === value);
    if (!known && !(p.allow_manual && value.indexOf('manual:') === 0 && isTxt(value.slice(7)))) return { ok: false, error_code: 'NOT_A_LISTED_CHOICE' };
  }
  if (itemId === 'project_name' && value.length > 200) return { ok: false, error_code: 'TOO_LONG' };
  return { ok: true };
}

/**
 * Maps resolved decisions to the flat compileProject input. Only USER_CONFIRMED / USER_EDITED values are used
 * (NOT_APPLICABLE contributes nothing; deferred/open items are never silently filled in).
 * preferred_technology is set ONLY from an explicit confirmed technology_stack decision.
 */
function toCompileInput(itemStates) {
  const val = (id) => {
    const s = itemStates[id];
    return s && (s.state === 'USER_CONFIRMED' || s.state === 'USER_EDITED') ? s.value : null;
  };
  const input = { project_name: val('project_name') || '', project_goal: val('project_goal') || '' };
  const ur = val('users_roles');
  if (ur) { input.users = ur.users; input.roles = ur.roles; }
  const set = (k, id) => { const v = val(id); if (typeof v === 'string') input[k] = v; };
  set('target_platforms', 'platforms'); set('languages', 'languages'); set('integrations', 'integrations');
  set('authentication', 'auth_model'); set('data_sensitivity', 'data_sensitivity');
  const tech = val('technology_stack');
  if (typeof tech === 'string') input.preferred_technology = tech.indexOf('manual:') === 0 ? tech.slice(7).trim() : tech;
  const extra = [];
  [['project_idea', 'الفكرة'], ['scope', 'النطاق'], ['workflows', 'المسارات'], ['business_rules', 'قواعد العمل'], ['success_measures', 'مقاييس النجاح'],
    ['data_entities', 'البيانات'], ['availability_targets', 'الحجم والتوفر'], ['secrets_handling', 'الأسرار'], ['hosting_target', 'الاستضافة'],
    ['testing_expectations', 'الاختبار'], ['architecture', 'المعمارية']].forEach((p) => {
    const v = val(p[0]);
    if (typeof v === 'string') extra.push(p[1] + ': ' + v.replace(/[\r\n]+/g, ' '));
  });
  if (extra.length) input.special_constraints = extra.join('\n').slice(0, MAX_LEN);
  return input;
}

/**
 * No-provider capability matrix (Gap G). `provider_state`: 'NONE' | 'AVAILABLE'.
 * Offline never shows AI features as working; it states what is unavailable and why.
 */
function capabilityMatrix(providerState) {
  const aiOn = providerState === 'AVAILABLE';
  const always = (id, ar, en) => ({ id, available: true, requires_provider: false, ar, en });
  const ai = (id, ar, en) => ({ id, available: aiOn, requires_provider: true, ar, en, unavailable_reason: aiOn ? null : 'NO_PROVIDER' });
  return [
    always('expert_manual_creation', 'إنشاء مشروع يدويًا (خبير)', 'Manual project creation (Expert)'),
    always('deterministic_questionnaire', 'استبيان إرشادي ثابت (غير مولَّد بالذكاء الاصطناعي)', 'Deterministic questionnaire (not AI-generated)'),
    always('manual_requirements_capture', 'إدخال المتطلبات يدويًا', 'Manual requirements capture'),
    always('deterministic_validation', 'تحقق حتمي من الحقول والعقود', 'Deterministic field/contract validation'),
    always('human_technology_selection', 'اختيار التقنية بقرار بشري', 'Explicit human technology selection'),
    always('confirmed_input_compilation', 'التجميع من مدخلات مؤكدة', 'Compilation from confirmed inputs'),
    always('contract_generation', 'توليد العقود المتاحة', 'Blueprint/contract generation'),
    always('save_reopen_versions', 'الحفظ وإعادة الفتح والإصدارات', 'Save, reopen, version history'),
    always('decision_provenance', 'سجل القرارات والمصدر', 'Decision provenance and audit'),
    always('offline_export_verify', 'تصدير محلي والتحقق من السلامة', 'Local export and integrity validation'),
    ai('generative_discovery', 'اكتشاف المتطلبات بالذكاء الاصطناعي', 'Generative requirement discovery'),
    ai('ai_architecture_recommendation', 'توصيات معمارية بالذكاء الاصطناعي', 'AI architecture recommendations'),
    ai('ai_contradiction_reasoning', 'استدلال على التناقضات يتجاوز القواعد الحتمية', 'AI contradiction reasoning beyond deterministic rules'),
    ai('ai_explanations', 'شروحات تحتاج استدلالًا', 'Inference-based explanations'),
  ];
}

/** Deterministic contradiction rules (no AI). Returns [{rule_id, items, message_ar, message_en}]. */
function deterministicContradictions(itemStates) {
  const out = [];
  const val = (id) => { const s = itemStates[id]; return s && (s.state === 'USER_CONFIRMED' || s.state === 'USER_EDITED') ? s.value : null; };
  const tech = val('technology_stack');
  const plat = (val('platforms') || '').toLowerCase();
  const sens = val('data_sensitivity');
  if (tech === 'flutter-supabase' && plat && !/(جوال|موبايل|mobile|ios|android|تطبيق)/.test(plat))
    out.push({ rule_id: 'R1_FLUTTER_WITHOUT_MOBILE', items: ['technology_stack', 'platforms'], message_ar: 'اخترت تقنية جوال لكن المنصة لا تذكر الجوال.', message_en: 'A mobile stack was chosen but the platform does not mention mobile.' });
  if (tech === 'react-vite-supabase' && plat && /^(جوال|موبايل|mobile|ios|android)\s*$/.test(plat))
    out.push({ rule_id: 'R2_WEB_STACK_MOBILE_ONLY', items: ['technology_stack', 'platforms'], message_ar: 'اخترت تقنية ويب لكن المنصة جوال فقط.', message_en: 'A web stack was chosen but the platform is mobile only.' });
  const auth = val('auth_model');
  if ((sens === 'FINANCIAL_OR_HEALTH' || sens === 'GOVERNMENT_SENSITIVE') && itemStates.auth_model && itemStates.auth_model.state === 'NOT_APPLICABLE_WITH_RATIONALE')
    out.push({ rule_id: 'R3_SENSITIVE_DATA_NO_AUTH', items: ['data_sensitivity', 'auth_model'], message_ar: 'بيانات حساسة دون تسجيل دخول.', message_en: 'Sensitive data declared with no authentication.' });
  void auth;
  return out;
}

module.exports = { QUESTION_PLAN_VERSION, MODES, PLAN, SENSITIVITY, TECH_CHOICES, planFor, validateAnswer, toCompileInput, capabilityMatrix, deterministicContradictions };
