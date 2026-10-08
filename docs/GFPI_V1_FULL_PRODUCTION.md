# GFPI V1 — Full-Production / SaaS engineering intelligence (additive layer)

Status: CANDIDATE on task branch `task/gfpi-v1-post-baseline-operational-validation`. Not integrated into main, not a baseline, not a release.

Location: `gfpi/production/` (pure, deterministic, bundle-safe; no clock/random/env/fs/network). Tests: `tests/gfpi/s9.test.js`, `s10.test.js` (scenarios 26–30).

Frozen contracts (ProjectBlueprintV1 1.1, AcceptanceContractV1 1.0, DevelopmentContractV1 1.0, the 21-item catalog, package states, golden pins) are untouched. The layer has its own decision ledger (same entry format and human-authority rules), its own artifact envelope (`PRODUCTION-1.0`) and its own approval for a `ProductionExecutionAttachmentV1` bound to the attachment hash, the production-ledger head and the base package hash.

Capabilities: semantic FULL_PRODUCTION / FULL_PRODUCTION_SAAS / AI profile activation; ProductionReadinessModelV1 (29 dimensions, 9 dimension states, derived global); adaptive discovery; RequirementDependencyGraphV1 and ChangeImpactAnalysisV1; ADRs vs pending recommendations; NFRContractV1; CostModelV1; BuildVsBuyAnalysisV1; ThreatModelV1; FailureSemanticsV1; DataLifecycleModelV1; DeploymentTopologyV1; ProductionEvidenceContractV1; TraceabilityGraphV1 with gap detection; AIProductionProfileV1; ProductionCompletenessGuardianV1; FactorySupportReportV1 (engineering recommendation ≠ Factory-admitted stack; no silent substitution).

Not claimed: PRODUCTION_READY for any product, model admission, corpus acceptance, human metrics, real provider/Ollama/keychain/Windows/Flutter/npm-build proof. UI (`dist/guided.html`) and the browser bundle do not yet expose this layer.
