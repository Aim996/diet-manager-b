# SH-CONTRACT-004 Issue/Correction v2 Independent Review Package

## Reviewer role

Perform a read-only semantic review. Do not trust validator GREEN as proof, do not edit files, and do not infer implementation completion from this contract task.

First line of the review must be exactly `PASS` or `FAIL`. The final line must be exactly one of:

```text
Ready for SH-CONTRACT-004 completion: Yes
Ready for SH-CONTRACT-004 completion: No
```

## Frozen sources

| Source | SHA-256 |
| --- | --- |
| Total plan 0.3 | `2408BE7B22AC5D4B1D3D19E6A26C2B6853DC83A0ECBE3BEE911130E3AADABC8F` |
| CONTRACT-v2 | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| Receipt/date v2 | `F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD` |
| Issue/correction candidate | `41E4A18D4D72644641D66A58F918616EBB0A6189E7F0BE1E836741E057298FDB` |
| Validator | `5C719F1E169D5BA17A9C0160FBDA5410FB3F9C78A43672BE11C42DC3CE19DC2C` |
| Brief | `EFA46AB0F639CEAD7BC81BBB0FCD7D80CE93BE44463B2E535384839F2AF030D3` |
| RED/GREEN report | `44AECCFDAB4EC02D261E48DC8CC79D17E0D337FB0EA0387BFAB102A75B2452F0` |

## Exact scope

Review exactly these current task IDs:

```text
REQ-ISSUE-001
REQ-ISSUE-002
REQ-QUICK-001
REQ-CORR-001
REQ-CORR-002
REQ-CORR-003
```

The total-plan meanings of those IDs are fixed as follows; reviewers must use these definitions rather than infer them from the candidate trace table:

| ID | Exact current meaning |
| --- | --- |
| `REQ-ISSUE-001` | Stable Issue codes, one field model, and the four-state lifecycle. |
| `REQ-ISSUE-002` | Consolidated non-blocking presentation, defer, unresolved query, and retained coverage impact. |
| `REQ-QUICK-001` | 2-4 options, safe exit, combinations/natural language, exact final line, and pre-execution revalidation. |
| `REQ-CORR-001` | Append-only target location, correction, void, and restore. |
| `REQ-CORR-002` | Real inventory return/delta deduction, nutrition recalculation, cross-day progress, and idempotent compensation. |
| `REQ-CORR-003` | PRODUCT-0.2 cross-meal/cross-day batch correction/void preview, revision-bound confirmation, and safe submission. |

Review round 1 is not closure evidence: its source package omitted this exact ID mapping, so it incorrectly mapped `REQ-CORR-003` to mixed/outbox and did not detect the missing batch-preview contract. Round 2 must review the corrected candidate independently.

## Required review questions

1. Are Issue status, type, code, reason, and resolution outcome axes distinct and compatible with total-plan 0.3?
2. Do stale/expired/conflicting quick choices reject before business effects, while equivalent natural language remains supported?
3. Are all thirteen corrections append-only, including void and restore, without overwriting or physically deleting history?
4. Does correction inventory insufficiency preserve the corrected dietary fact and nutrition, retain the prior real deduction, skip only the unsafe delta, create an Issue, prevent negative stock, and return `committed_with_issues`?
5. Does FactCommit failure allow an independent redacted technical log while producing zero dietary business data?
6. Do EffectBundle and EnvelopeFinalize failures preserve committed facts and avoid fabricated success receipts?
7. Does a cross-day correction finalize every affected date through `daily_progress_by_date[]` with no multiple-date single alias?
8. Is mixed input ordered and per-event idempotent, with no rollback of earlier facts and no synthetic overall success?
9. Is B the only product write route, with Skill/OpenClaw/MCP kept as thin adapters?
10. Are v1 six-state, twelve-operation, single-big-transaction, and mixed legacy semantics clearly non-normative?

## Failure policy

Any contradiction with the frozen total plan or upstream contracts is a blocking FAIL. Suggestions about later Schema, SQLite mapping, UI, retry workers, or adapter payloads are non-blocking unless this contract incorrectly claims them complete.
