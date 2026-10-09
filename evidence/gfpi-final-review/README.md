# GFPI V1 — Candidate final review (R3, bounded) — evidence

Executed on a fresh full clone. Candidate under review: `a3e997e9f5a6cef176a91f452bed11925da4c0a9` (tree `1480f729eb8f8b2aafce46b6f4a79fd8deec9ab0`), baseline main `291f84019b5d04ce720e8dd043a575963044923b` (tree `3235781fb3717f7419b694fbbcdd9adb1b16ce8e`). Remote readback in `A_*.txt`.
This directory records NEW run results of this round (`after/`, `before/`); older evidence is not reused as a result.

## Proven defects (independent adversarial round) and bounded repairs (branch `task/gfpi-v1-final-review-repairs`)
| ID | Defect (proven, before-state in `before/`) | Repair | Frozen contract touched |
|---|---|---|---|
| D1 | `attachmentStatus`/`approveAttachment` trusted self-reported `guardian_verdict`/`unresolved_blockers`/approval actor: a forged attachment (verdict edited, hash recomputed) plus a self-made approval showed `APPROVED_FOR_EXECUTION` in API and UI | Status/approval now re-derived from CURRENT artifacts (`contentMismatch`), approval must be `USER` and bound to ledger head + base package, blocked attachment can never be APPROVED; UI passes current artifacts | No (`gfpi/production/attachment.js`, additive layer) |
| D2 | Exported attachment JSON carried no status: a SUPERSEDED approval looked valid | Export carries `status`, `status_reason`, `exported_head_is_current` | No |
| D3 | Base technology question offered only React/Flutter/Other/defer-with-condition; no «لا أعرف، اقترح الأنسب» | UI-only deterministic `SYSTEM_RULE` proposal (state `AI_RECOMMENDED_PENDING_APPROVAL`, already permitted by the frozen state machine); plain-language reason; human must confirm; evidence marks `factory_admission: NOT_DECIDED_BY_THIS_SUGGESTION`; both suggestable stacks are limited to the Factory-supported `TECH_CHOICES` | No (no frozen file changed; frozen baseline check intact) |

Limitations kept honest: approvals remain local self-asserted records (no server-side identity); a forged attachment is detectable only by callers that supply current artifacts (the UI always does). Multi-tab concurrent editing was observed but not proven safe/unsafe (NOT_ASSESSED). No screen-reader run (NOT_RUN).

## Human UAT
`docs/human-uat/` (Arabic guide, synthetic data, 5 scenarios, offline observation form). **`HUMAN_UAT = PENDING_HUMAN_EXECUTION`** — never PASS without a real human.

## Canonical local reconciliation
`CANONICAL_LOCAL_RECONCILIATION = BLOCKED_CHANNEL_UNAVAILABLE` (device bridge reported "not connected"; nothing was assumed about `C:\Users\DELL\StudioProjects\Palwakf_Prompt_Maker`).
