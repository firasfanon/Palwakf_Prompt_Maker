# Factory consumer fixtures (Prompt Maker = producer-contract authority)

Canonical fixtures for `ProjectBlueprintV1 (1.1)` -> `FACTORY_CONSUMER_SUBSET_V1` -> Project Factory.
Prompt Maker owns the contract; Project Factory owns the consumer implementation.

| File | Purpose | Expected result |
|---|---|---|
| `consumer-subset-v1.schema.json` | JSON Schema of the subset | - |
| `profile-mapping-v1.json` | stack -> normalized id -> Factory profile | - |
| `golden-react-vite-supabase.json` | real `compileProject` output, CONFIRMED | `MATERIALIZATION_READY` (react-vite-supabase) |
| `negative-requires-technology-decision.json` | status REQUIRES_DECISION | `BLOCKED_REQUIRES_TECHNOLOGY_DECISION` |
| `negative-unsupported-technology-profile.json` | CONFIRMED, unsupported stack | `BLOCKED_UNSUPPORTED_TECHNOLOGY_PROFILE` |
| `negative-unsupported-blueprint-schema.json` | schema_version 2.0 | `UNSUPPORTED_BLUEPRINT_SCHEMA` |
| `negative-invalid-consumer-subset.json` | required field removed | `INVALID_BLUEPRINT` |
| `manifest.json` | provenance + SHA-256 per file | - |

## Rules
- Hash = SHA-256 of file bytes with CRLF normalized to LF. FNV is a non-cryptographic fingerprint and is never integrity evidence.
- Fields beginning with `_` are ignored and never required. Technology readiness is read only from `technology_decision.status`.
- `producer_base_head` is the code state that produced the fixtures (a commit cannot contain its own hash); a consumer pins the accepted canonical head when vendoring.
- Vendoring into Project Factory: copy with provenance (`producer_repository`, `producer_head`, `project_blueprint_schema` 1.1, `factory_consumer_subset_version` 1, `golden_fixture_version` 1, `golden_fixture_sha256`) and verify the hash. The copy is a pinned test input, not authority.
- `tests/helpers/factoryConsumerOracle.js` is a test oracle, not an adapter.

## Regenerate / verify
```
node tools/generateFactoryConsumerFixtures.js          # write
node tools/generateFactoryConsumerFixtures.js --check  # compare with committed files
```

## Open question
`generic` (a Factory profile) is excluded from the mapping: an undecided stack must not pass the fail-closed gate. Revisit only by explicit decision.
