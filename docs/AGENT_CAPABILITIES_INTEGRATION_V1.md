# Prompt Maker → Factory Agent Capabilities Integration V1

**Status:** isolated engineering candidate; reference handoff only. This is not a live UI Agent, Skills Agent, or Visual QA runtime connection, and not a release.

## Authority
Prompt Maker owns ProjectBlueprintV1 and the reference sidecar. Project Factory owns the existing pinned consumer and optional materialization. Agentic owns only a separately admitted runtime. Workspace owns task signature, scope lease, and acceptance.

## Frozen boundaries
ProjectBlueprintV1 1.1 and FACTORY_CONSUMER_SUBSET_V1 remain byte-unchanged. New producer-side module src/agentCapabilityContracts.js is NOT imported into the browser core. The optional tool only reads a raw Blueprint and writes a new sidecar; no core recompile or technology inference.

## PM_FACTORY_AGENT_CAPABILITIES_HANDOFF_V1
- Producer exact raw Blueprint file SHA-256, project name and blueprint version.
- UI/UX: requested design review only; exact product surfaces, target platforms, confirmed references; NOT_GENERATED.
- Skills: candidate skills.select.read_only request with engineering_reference / read_only_reference, NOT_INVOKED, no selected skills, runtime_admitted=false.
- Visual QA: NOT_RUN, no evidence or findings, authority not delegated.
- Materialization: FACTORY_CONSUMER_TO_DECIDE, candidate only, production_ready=false.
- Authority: WORKSPACE, AGENTIC runtime NOT_ADMITTED, execution_authorized=false.

Commands:
node tools/agent-capabilities-handoff.js --blueprint path/to/blueprint.json --out NEW-handoff.json
python consumer/agent_capabilities_adapter.py --blueprint same-blueprint.json --handoff NEW-handoff.json --output NEW-output-dir

The second command runs from Factory's repository, not Prompt Maker. Neither invokes any agent or accesses a Skills catalog. The file hash is not a signed task or execution lease.

## Visual QA feedback
Factory can optionally import a report with schema_version 1.0, status REPORT_AVAILABLE, findings and {reference,sha256} evidence. It is stored exclusively as UNVERIFIED_EXTERNAL_REPORT; it cannot grant success, runtime permission, or Workspace acceptance.

## Tests and omissions
Tests cover exact SHA-256 binding, false execution rejection, design-approval and skills-selection tampering, no-clobber, negative technology outcomes, React and Flutter materialization, and source invariants.
No UI generation engine, SQL generation, runtime agent invocation, full product release or Human UAT is provided here. Prior Factory Windows timeout failure and Flutter anonKey deprecation remain open.
