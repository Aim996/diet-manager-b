# SH-CONTRACT-004 Issue/Correction v2 RED/GREEN Report

## Scope

Upgrade the single Issue/Correction companion contract to total-plan 0.3 and CONTRACT-v2 semantics. No Schema, table, migration, repository, adapter business logic, or product data was created.

## Frozen inputs

| Input | SHA-256 |
| --- | --- |
| `总功能开发计划0.3.md` | `2408BE7B22AC5D4B1D3D19E6A26C2B6853DC83A0ECBE3BEE911130E3AADABC8F` |
| `shared/business-contract.md` | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| `shared/contracts/receipt-and-date-contract.md` | `F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD` |

## TDD evidence

The ASCII-only Windows PowerShell 5.1 validator was created before modifying the v1 contract.

RED:

```text
STATIC|parser=0|ascii_nonzero=0|bytes=13915
RED|exit=1|first=powershell.exe : ISSUE-CORRECTION-CONTRACT-v2 machine block is missing
```

Semantic review RED after the first GREEN exposed missing exact task coverage and a wrong correction stage assignment:

```text
STATIC2|parser=0|ascii_nonzero=0|bytes=17624
SEMANTIC_RED2|exit=1|first=powershell.exe : Contract properties count; expected=[17] actual=[16]
```

The second RED added machine assertions for consolidated Issue presentation/query/coverage, quick safe exits, target/concurrency/no-change correction handling, exact correction stage ownership, and PRODUCT-0.2 batch preview/confirmation. The contract was then corrected before the second independent review.

GREEN:

```text
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
```

## Candidate checkpoints

| File | SHA-256 |
| --- | --- |
| `shared/contracts/issue-correction-contract.md` | `41E4A18D4D72644641D66A58F918616EBB0A6189E7F0BE1E836741E057298FDB` |
| `shared/tests/validate-issue-correction-contract-v2.ps1` | `5C719F1E169D5BA17A9C0160FBDA5410FB3F9C78A43672BE11C42DC3CE19DC2C` |
| `docs/work-items/SH-CONTRACT-004-v2-brief.md` | `EFA46AB0F639CEAD7BC81BBB0FCD7D80CE93BE44463B2E535384839F2AF030D3` |
| `docs/superpowers/specs/2026-08-11-sh-contract-004-v2-design.md` | `4E61F7729C3DD140F2AFB96AC3FFFC85008741B89BA3F8C00B98A554AA38E244` |
| `docs/superpowers/plans/2026-08-11-sh-contract-004-issue-correction-v2.md` | `C1BC6B163028ADCF0D5FC211EE9BCBD1A19676EE4BFDC3DC6919FF9E9B4E0B07` |

## Semantics frozen

- Four Issue statuses, four Issue types, 23 stable codes, eight resolution reasons, and four resolution sources.
- Three application outcomes and five business rejection reasons; technical storage failure is not a persisted outcome.
- Six quick-prompt binding fields, 2-4 safe options, natural-language equivalence, and the exact free-text final line.
- Thirteen append-only correction operations and fourteen CorrectionEvent fields, including `restore_event`.
- Ambiguous/stale/concurrent/no-change correction behavior is fail-closed and cannot create meaningless or partial versions.
- Correction stage ownership is exact: CorrectionEvent/idempotency/outbox in FactCommit; nutrition/inventory/Issue contribution in EffectBundle; progress/receipt/terminal result in EnvelopeFinalize.
- `FactCommit -> EffectBundle -> EnvelopeFinalize` with five envelope and five outbox states.
- FactCommit failure permits only a separate redacted technical log and creates zero dietary business data.
- Inventory-insufficient correction commits the corrected fact, keeps the prior real deduction, skips the unsafe delta, creates an Issue, and returns `committed_with_issues`.
- Cross-day correction exposes only the authoritative `daily_progress_by_date[]` collection for multiple dates.
- PRODUCT-0.2 batch correction/void requires zero-write preview, revision-bound confirmation, per-target append-only execution, and one final EnvelopeFinalize.
- Mixed input is ordered and per-event idempotent; a later failure never rolls back an earlier committed fact.
- Product writes remain B-only; Skill, OpenClaw, and MCP stay thin.

## Deferred implementation

Schema fields, SQLite tables, mappings, repositories, outbox workers, adapter payloads, and runtime behavior remain assigned to later total-plan tasks. This contract does not claim those product gates are complete.
