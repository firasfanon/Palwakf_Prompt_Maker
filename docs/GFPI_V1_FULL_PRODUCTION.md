# GFPI V1 — Full-Production / SaaS engineering intelligence (additive layer)

Status: CANDIDATE on task branch `task/gfpi-v1-post-baseline-operational-validation`. Not integrated into main, not a baseline, not a release.

Location: `gfpi/production/` (pure, deterministic, bundle-safe; no clock/random/env/fs/network). Tests: `tests/gfpi/s9.test.js`, `s10.test.js` (scenarios 26–30).

Frozen contracts (ProjectBlueprintV1 1.1, AcceptanceContractV1 1.0, DevelopmentContractV1 1.0, the 21-item catalog, package states, golden pins) are untouched. The layer has its own decision ledger (same entry format and human-authority rules), its own artifact envelope (`PRODUCTION-1.0`) and its own approval for a `ProductionExecutionAttachmentV1` bound to the attachment hash, the production-ledger head and the base package hash.

Capabilities: semantic FULL_PRODUCTION / FULL_PRODUCTION_SAAS / AI profile activation; ProductionReadinessModelV1 (29 dimensions, 9 dimension states, derived global); adaptive discovery; RequirementDependencyGraphV1 and ChangeImpactAnalysisV1; ADRs vs pending recommendations; NFRContractV1; CostModelV1; BuildVsBuyAnalysisV1; ThreatModelV1; FailureSemanticsV1; DataLifecycleModelV1; DeploymentTopologyV1; ProductionEvidenceContractV1; TraceabilityGraphV1 with gap detection; AIProductionProfileV1; ProductionCompletenessGuardianV1; FactorySupportReportV1 (engineering recommendation ≠ Factory-admitted stack; no silent substitution).

Not claimed: PRODUCTION_READY for any product, model admission, corpus acceptance, human metrics, real provider/Ollama/keychain/Windows/Flutter/npm-build proof. UI (`dist/guided.html`) and the browser bundle do not yet expose this layer.

## UI integration (this candidate)

`dist/guided.html` gains a **Full-Production / SaaS** tab (Discovery, Readiness dashboard, Guardian, Documents, Execution) backed by `dist/gfpi_production_bundle.js`, built by `tools/buildGfpiProductionBundle.js` from `gfpi/production/*.js` (the frozen `dist/gfpi_bundle.js` is not modified; the production bundle resolves frozen modules from `window.GFPI`). The production decision ledger, attachments and approvals persist inside the existing project record and are hash-verified on reopen. A deterministic decision-conflict rule set (`gfpi/production/conflicts.js`) was added after the UI scenario "conflict between two decisions" exposed that gap.

Tests: `tests/browser/gfpi_production.run.js` (real Chromium, simulated user, Arabic/English, desktop and 390px) and `tests/gfpi/s11.test.js`. The simulated user is NOT human acceptance testing.


## إفصاح أمني: طبيعة الموافقة المحلية / Security disclosure: nature of local approval

> هذه موافقة محلية غير موثقة بهوية خادمية، تخص اعتماد المواصفة فقط، ولا تفوض أي عملية خارجية أو نشرًا إنتاجيًا.
>
> This is a local approval without server-side identity. It covers specification approval only and does not authorize any external operation or production deployment.

لا يُرتَّب على `APPROVED_FOR_EXECUTION` أي إذن خارجي: الحالة محسوبة داخل المتصفح ومعرّف الفاعل ثابت محلي (`local-user`)؛ تفويض أي عملية خارجية أو نشر إنتاجي قرار سيادي منفصل يُوثَّق خارج هذه الأداة. / `APPROVED_FOR_EXECUTION` grants no external permission: it is computed in the browser and the actor id is a constant local value; authorizing any external operation or production deployment is a separate sovereign decision recorded outside this tool.
