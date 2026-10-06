# عقود التكامل (Integration Contracts) — قراءة ثابتة/شبه-ثابتة

لكل عقد: `SCHEMA_VERSION` الحالي، `REQUIRED_FIELDS`، `OPTIONAL_FIELDS`،
`VALIDATION_RULES`، `ENUMS`، `UNKNOWN_FIELD_POLICY`، `COMPATIBILITY_POLICY`.
المصدر الحقيقي لكل عقد هو الكود في `src/` — هذا الملف وصف قابل للقراءة البشرية له،
وليس بديلًا عنه؛ عند أي تعارض يُرجَّح الكود.

---

## ProjectIntentV1 — `src/core.js` (`makeProjectIntentV1`, `validateProjectIntentV1`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: `"1.0"`
- **REQUIRED_FIELDS**: `project_name` (string، 1..200 حرف)، `project_goal` (string، 1..5000 حرف)
- **OPTIONAL_FIELDS** (كلها داخل `advanced`، كل منها `string | null`):
  `target_platforms, users, roles, countries, languages, visibility, authentication,
  multi_tenancy, ai_features, payments, data_sensitivity, offline_requirements,
  integrations, preferred_technology, deployment_preference, regulatory_requirements,
  existing_project, existing_repository, existing_architecture, existing_stack,
  existing_capabilities, existing_tests, known_gaps, known_constraints,
  design_references, special_constraints`
- **VALIDATION_RULES**: طول كل حقل نصي حر محدود (`MAX_TEXT_FIELD_LENGTH=5000`،
  `MAX_NAME_LENGTH=200`)؛ `project_name`/`project_goal` غير فارغين.
- **ENUMS**: `visibility ∈ {PUBLIC, INTERNAL, null}`، `multi_tenancy ∈ {yes, no, null}`،
  `existing_project ∈ {new, existing, null}`
- **UNKNOWN_FIELD_POLICY**: أي حقل غائب عن القائمة أعلاه يُقرأ ويُتجاهَل بأمان؛ لا
  يُرفَض الكائن كله بسببه.
- **COMPATIBILITY_POLICY**: حقل اختياري جديد = MINOR؛ حقل مطلوب جديد أو إزالة حقل = MAJOR.

---

## ProjectContextV1 — `src/core.js` (`makeProjectContextV1`, `validateProjectContextV1`, `parseProjectContextV1`, `mergeProjectContext`)

عقد عام لسياق مشروع قائم يقدّمه أي مصدر خارجي؛ غير مرتبط بأي مشروع أو نظام خاص.

- **STATUS**: STABLE (1.0)
- **SCHEMA_VERSION**: `"1.0"` (`MAJOR.MINOR`)
- **REQUIRED_FIELDS**: `schema_version`
- **OPTIONAL_FIELDS**: `project_id` (نص)، `current_state` (نص)، `existing_architecture`،
  `existing_capabilities`، `existing_constraints`، `existing_tests`، `known_gaps`
  (قوائم نصوص)، `source_references` (`[{type, ref, note?}]`)،
  `applicable_external_standards` (`[{id, name?, version?}]`)، وامتدادات `x_*`.
- **VALIDATION**: `validateProjectContextV1(raw) → {valid, errors, warnings}`؛ يرفض
  غير الكائن، `schema_version` ناقص/خاطئ، أنواع حقول خاطئة، وتجاوز حدود الطول/العدد.
- **UNKNOWN_FIELD_POLICY**: حقل مجهول = تحذير ويُتجاهل (لا فشل)؛ حقول `x_*` مسموحة
  بصمت وتُحفظ في `extensions`.
- **COMPATIBILITY_POLICY**: MAJOR مختلف = رفض؛ MINOR أحدث = قبول مع تحذير؛ الأسماء
  القديمة (`architecture_constraints`، `applicable_standards`) تُقبل كأسماء بديلة ولا
  تُصدَر أبدًا. إضافة حقل اختياري = MINOR، تغيير دلالة حقل = MAJOR.
- **MERGE**: `mergeProjectContext(intent, context)` — قيم المستخدم تتغلب دائمًا؛
  السياق يملأ الحقول الفارغة فقط ويُوسَم النص بـ `[from ProjectContextV1]`.
  `compileProject(input, {projectContext})` يتحقق أولًا ويرفض سياقًا غير صالح
  (أخطاؤه تبدأ بـ `projectContext: `).

---

## Persisted Project Record (سجل المشروع المحفوظ — تاريخ الإصدارات)

- **المنفذ**: `ProjectRepository` (`save/load/list/remove`، Promises). التنفيذات:
  ذاكرة، نظام ملفات (`createFileProjectRepository`)، و`createStorageProjectRepository`
  (أي كائن شبيه بـ Web Storage؛ المتصفح يمرّر `localStorage`).
- **الشكل**: `{schema_version, project_id, project_name, versions:[{version_number,
  created_at, change_summary, input_hash, blueprint_hash, prompt_hash, input, options}],
  latest_version_number}` — تاريخ فعلي قابل للقراءة (`listVersions`, `getVersion`).
- **إعادة الفتح**: إعادة تجميع حتمية من `input` المحفوظ ثم `verifyReopenedVersion`
  يقارن الهاشات الثلاثة؛ أي اختلاف يُعلَن ولا يُخفى.
- **CLI**: `prompt-maker.js new --data-dir` يُضيف إصدارًا، و`versions --project-id
  --data-dir [--version N]` يقرأ التاريخ فعليًا.
- **الأمان**: مستودع الملفات يرفض معرّفات المشروع التي تعبر المسار؛ واجهة المتصفح تعرض
  كل قيمة مشتقة من المستخدم عبر `textContent`/`createElement` فقط (لا HTML نصي).

---

## ProjectProfileV1 (عنصر داخل نتيجة `classifyProject`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: مرتبط بـ `PROFILE_REGISTRY_VERSION` (حاليًا `"1.0"`/`"1.1"` لكل ملف تعريف على حدة)
- **REQUIRED_FIELDS**: `profile_id` (string)، `confidence` (number 0..1)،
  `status` (`INFERRED_DEFAULT` حتى تأكيد المستخدم، ثم `CONFIRMED`)، `evidence` (array)
- **ENUMS**: `status ∈ {INFERRED_DEFAULT, CONFIRMED}`
- **VALIDATION_RULES**: ملفات تعريف `sensitive: true` (مثل `FINANCIAL_SYSTEM`,
  `LEGAL_SYSTEM`) تخضع لسقف ثقة (`SENSITIVE_CONFIDENCE_CAP = 0.55`) عند ضعف الدليل،
  وتُقمَع كليًا عند غلبة `negative_keywords`.
- **UNKNOWN_FIELD_POLICY**: تجاهل آمن.
- **COMPATIBILITY_POLICY**: إضافة ملف تعريف جديد إلى `PROFILE_REGISTRY` = MINOR؛ تغيير
  معنى `status` الحالي = MAJOR.

---

## ProjectBlueprintV1 — `src/blueprintCompiler.js` (`compileBlueprint`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: `"1.0"`
- **REQUIRED_FIELDS**: `schema_version, project_name, project_profiles,
  requirements_by_domain, product_surfaces, domain_model, user_journeys,
  architecture, prohibited_shortcuts, production_readiness_target`
- **OPTIONAL_FIELDS**: `_brownfield` (null عند مشروع جديد؛ كائن عند `EXISTING_PROJECT`)،
  `relationships`, `business_rules`, `state_machines` (قد تكون فارغة أو تحتوي
  عناصر `REQUIRES_DECISION`)
- **INTERNAL_FIELDS** (بادئة `_`، للاستخدام الداخلي فقط بين وحدات `src/`، لا تُعتبر
  جزءًا من العقد العام المستقر، ويجوز أن تتغيّر بلا رفع إصدار): `_all_applicability`
- **VALIDATION_RULES**: `product_surfaces` يُبنى حسب `SURFACE_RULES` (PUBLIC،
  AUTHENTICATED، ADMIN، MOBILE، DESKTOP، API) — لا يُفترَض وجود سطح لم يُستنتَج من
  ملفات التعريف أو من `intent.advanced.authentication`.
- **UNKNOWN_FIELD_POLICY**: تجاهل آمن لأي حقل غير مذكور أعلاه.
- **COMPATIBILITY_POLICY**: حقل عام جديد اختياري = MINOR؛ تغيير شكل `requirements_by_domain`
  الحالي = MAJOR.

---

## AcceptanceContractV1 — `src/contractBuilders.js` (`buildAcceptanceContract`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: `"1.0"`
- **REQUIRED_FIELDS**: `schema_version, project_name, gates, brownfield_aware, generated_at`
- **gate shape** (كل عنصر في `gates`): `gate_id, domain, requirement, applicability
  (REQUIRED|OPTIONAL), acceptance_criteria, required_evidence, current_evidence_status,
  evidence_source_type, evidence_source_id, blocking (bool), dependencies, target_status`
- **ENUMS**: `current_evidence_status` يبدأ دائمًا `NOT_ASSESSED` عند التوليد — لا
  حالة أخرى تُفترَض آليًا؛ `target_status = "DEFERRED_WITH_GATE"` ثابت حاليًا.
- **VALIDATION_RULES**: `acceptance_criteria`/`required_evidence` يأتيان من
  `acceptanceCriteriaLibrary.js` (مطابقة بـ `rule_id` فقط، بلا fallback) — لا
  نص عام ثابت (placeholder) يُستخدم لأي gate.
- **UNKNOWN_FIELD_POLICY**: تجاهل آمن.
- **COMPATIBILITY_POLICY**: إضافة حقل جديد لكل gate = MINOR؛ تغيير دلالة `current_evidence_status` = MAJOR.

---

## DevelopmentContractV1 — `src/contractBuilders.js` (`buildDevelopmentContract`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: `"1.0"`
- **REQUIRED_FIELDS**: `schema_version, project_name, scope, is_brownfield,
  included_capabilities, excluded_scope, dependencies, implementation_requirements,
  architecture_constraints, data_constraints, security_constraints, ux_constraints,
  quality_gates, acceptance_gates, prohibited_shortcuts, expected_artifacts,
  definition_of_done, generated_at`
- **VALIDATION_RULES**: `architecture_constraints`/`data_constraints`/
  `security_constraints`/`ux_constraints` تختلف فعليًا حسب ملفات التعريف المطابقة
  (`DOMAIN_CONSTRAINTS` map لـ `MULTI_TENANT_SAAS`, `FINANCIAL_SYSTEM`, `LEGAL_SYSTEM`,
  `AI_ASSISTANT`) — ليست نصًا عامًا موحّدًا لكل المشاريع. `scope` و`expected_artifacts`
  يختلفان صراحة بين مشروع جديد ومشروع Brownfield.
- **UNKNOWN_FIELD_POLICY**: تجاهل آمن.
- **COMPATIBILITY_POLICY**: حقل جديد = MINOR؛ تغيير شكل `architecture_constraints` (من
  array-of-string إلى array-of-object `{source_id, constraint}`) كان MAJOR داخلي —
  حدث ضمن هذه الدفعة ومُوثَّق هنا كتذكير أن أي تغيير مماثل مستقبلًا يتطلب رفع إصدار.

---

## GenerationReceiptV1 — `src/receipt.js` (`buildReceipt`)

- **STATUS**: STABLE
- **SCHEMA_VERSION**: `"1.0"`
- **REQUIRED_FIELDS**: `schema_version, compiler_version, schema_versions,
  profile_versions, rule_versions, input_hash, blueprint_content_hash,
  acceptance_content_hash, development_contract_content_hash, prompt_hash,
  generated_at, receipt_hash`
- **VALIDATION_RULES** (الأهم في هذا العقد):
  - كل `*_content_hash` و`input_hash` و`prompt_hash` هي `fingerprint(canonicalStringify(stripVolatile(x)))`
    — **حتمية**: نفس المدخل + نفس إصدار المحرك ⇒ نفس القيمة بالضبط، بصرف النظر عن
    `generated_at`.
  - `receipt_hash` وحده **متعمَّد التقلّب** (volatile) لأنه يُحسَب من الإيصال كاملًا
    *بعد* تعيين `generated_at` — لا يُستخدَم للمقارنة بين توليدين لنفس المدخل.
  - الخوارزمية: FNV-1a (`fingerprint` في `src/receipt.js`) — **غير تشفيرية عمدًا**،
    اختيرت لتبقى متزامنة (synchronous) في Node والمتصفح دون الحاجة لـ `crypto.subtle`
    غير المتزامن.
- **UNKNOWN_FIELD_POLICY**: تجاهل آمن.
- **COMPATIBILITY_POLICY**: تغيير خوارزمية البصمة نفسها (FNV-1a → غيرها) = MAJOR
  حتمًا، لأنه يُبطل كل بصمة سابقة محفوظة.

---

## ملاحظة JSON Schema الآلي

لم يُولَّد ملف JSON Schema منفصل (`.schema.json`) بعد لكل عقد أعلاه — هذا الملف
النصي هو التوثيق الحالي. توليد JSON Schema فعلي من دوال `make*`/`validate*` و
`build*` القائمة في `src/` ممكن لاحقًا (عمل غير معيق، non-blocking) دون تغيير أي
سلوك حالي، لأن الحقول والقيود أعلاه مأخوذة مباشرة من الكود الفعلي لا من تخطيط مُسبَق.
