# SH-MODEL-003 Work Item Brief

## Identity and ownership

| Field | Frozen value |
|---|---|
| `task_id` | `SH-MODEL-003` |
| `milestone/type` | `M2/model` |
| `status` | `进行中` |
| `owner` | `Codex /root` |
| `reviewer` | independent semantic/security review |
| `formal_root` | `E:\codx\skill\饮食管家` |
| `isolated_clone` | `E:\codx\skill\github\diet-manager-b` |
| `schema_id` | `https://diet-manager.local/schemas/issue-correction-mixed/v1` |
| `schema_version` | `1.0.0` |
| `fixture_set_id` | `diet-manager/issue-correction-mixed-cases/v1` |
| `full_case_set` | `none` |

## Goal

Freeze the shared, route-neutral JSON model for Issue, append-only Issue resolution and CorrectionEvent audit, FactCommit/EffectBundle/EnvelopeFinalize state, durable effect outbox, ordered mixed-operation results, and terminal ReceiptData.

## Dependencies

- `SH-CONTRACT-001` / `diet-manager/contract-v2`
- `SH-CONTRACT-002` / `diet-manager/receipt-date-contract-v2`
- `SH-CONTRACT-004` / `diet-manager/issue-correction-contract-v2`
- `SH-MODEL-001` Event/Amount/Product/Inventory schema v1
- `SH-MODEL-002` Nutrition/Progress schema v1

All dependencies are completed. This task must fail rather than reinterpret a conflicting upstream contract.

## Deliverables

- `shared/schemas/issue-correction-mixed.schema.json`
- `shared/tests/fixtures/issue-correction-mixed-cases.json`
- `shared/tests/validate-issue-correction-mixed-schemas.ps1`
- `docs/work-items/SH-MODEL-003-{brief,report,review-package,review}.md`
- `docs/evidence/EV-20260811-019-sh-model-003.md`
- detailed updates to `docs/开发进度.md` and `总功能开发计划0.3.md`

## Exact public definitions

```text
Issue
IssueResolutionEvent
QuickPrompt
CorrectionSnapshot
CorrectionEvent
EffectOutboxEntry
FactCommitResult
EffectBundleResult
ReceiptData
EnvelopeFinalizeResult
MixedItemResult
MixedCommitResult
```

## Required semantics

1. Issue uses exactly `open`, `awaiting_user`, `resolved`, and `dismissed`; closure fields match the lifecycle state.
2. Issue resolution and correction are append-only; technical persistence failure never creates a fake persisted resolution event.
3. CorrectionEvent uses exactly the 13 v2 operations and 14 required fields; original facts are never overwritten or physically deleted.
4. The transaction stages and envelope states are exact: `FactCommit -> EffectBundle -> EnvelopeFinalize` and `received | fact_committed | effects_pending | terminal | failed_fact`.
5. Outbox states are exact: `pending | processing | succeeded | retryable_failed | permanent_business_skip`.
6. Failed FactCommit returns a non-persisted command response with `business_writes=0`; no fact, inventory, nutrition, Issue, business outbox, progress, receipt, or terminal-idempotency business object may exist.
7. A failed FactCommit may create a separate redacted technical log outside this schema and outside dietary queries. The log is not a dietary record and cannot be embedded in the command response as business data.
8. EffectBundle failure preserves the committed fact and retries only unfinished effects. Permanent business skip preserves a reason and required Issue and is not a fake physical success.
9. EnvelopeFinalize is the only success-receipt/progress authority. Finalizer failure stays `effects_pending` and has no ReceiptData/progress/terminal idempotency result.
10. Mixed child results preserve input order and per-child idempotency. A later failure never rolls back an earlier committed child.
11. Same-key same-input retry returns the frozen terminal result or resumes only unfinished layers. Same-key different-input returns `idempotency_conflict` and zero new business writes.
12. Single-date final progress requires a field-equal alias; two or more dates forbid the alias.

## Verification commands

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-issue-correction-mixed-schemas.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-business-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-receipt-and-date-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-issue-correction-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-core-model-schemas.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-nutrition-progress-schemas.ps1
```

## Case assertion paths

```text
shared/tests/fixtures/issue-correction-mixed-cases.json#/cases/*
shared/schemas/issue-correction-mixed.schema.json#/$defs/*
```

The validator owns the exact 58 case IDs/order/outcomes and four mutation checks. Fixture metadata or candidate schema content cannot define expected outcomes.

## Trace ownership

| Kind | IDs |
|---|---|
| requirements | `REQ-ISSUE-001`, `REQ-ISSUE-002`, `REQ-QUICK-001`, `REQ-CORR-001`, `REQ-CORR-002`, `REQ-CORR-003`, `REQ-MIXED-001`, `REQ-SAFE-002`, `REQ-SAFE-003`, `REQ-PROGRESS-004` |
| cases | `CASE-ISSUE-001`, `CASE-ISSUE-003`, `CASE-CORR-001`, `CASE-EFFECT-001`, `CASE-EFFECT-002`, `CASE-EFFECT-003`, `CASE-MIXED-001`, `CASE-MIXED-002`, `CASE-MIXED-003`, `CASE-STORAGE-006`, `CASE-STORAGE-007` |
| risks | `RISK-010`, `RISK-014`, `RISK-016` |
| decisions | `DEC-017`, `DEC-019`, `DEC-023`, `DEC-024`, `DEC-027`, `DEC-028` |
| changes | `CHG-20260811-001` |

## Exclusions

- no SQLite schema, migration, table, repository, transaction, or outbox worker;
- no B runtime handler, correction executor, renderer, install/upgrade path, or production business data;
- no OpenClaw, MCP, Docker, Windows-path, process, or browser implementation field;
- no A/C product route;
- no access to the five protected lease files.

## Completion gate

The task may be marked complete only after missing-file RED, 58-case GREEN, four mutation RED/GREEN proofs, upstream regression PASS, strict parser/JSON/ASCII gates, zero protected/business-data candidates, independent P0/P1 review PASS, private GitHub delivery, and independent-clone reproduction. Completion freezes a shared model only and does not make the product installable.
