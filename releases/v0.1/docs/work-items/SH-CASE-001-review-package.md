# SH-CASE-001 Independent Review Package

## Review objective

Independently determine whether the candidate is a strong, implementation-neutral common Oracle for the five frozen core cases. Do not execute the candidate PowerShell validator to generate expected values.

Required final verdict:

```text
SH-CASE-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=5|fixtures=3|mutations=<independent-count>
```

Return `FAIL` with concrete P0/P1 findings if any correct future B implementation would be rejected, or any materially wrong/weak implementation could pass.

## Exact candidate hashes

| File | SHA-256 |
|---|---|
| `shared/acceptance-cases/cases.json` | `4972830F746ED630FF31897D2E958451077DD602EEA1C5510CE0B3432FDD38D7` |
| `shared/acceptance-cases/fixtures/core-v1.json` | `720A8DB76CB00C034164E401B5B45C415D79218C88BCEF87F42399B2DC0CF2CB` |
| `shared/tests/validate-core-acceptance-cases.ps1` | `F0247742B91400E22AFE117C239AAC91D2B78D0024F59B315B9E8585ABCB4262` |
| `docs/superpowers/specs/2026-08-11-sh-case-001-design.md` | `FFC1BDD89E0DA117A1D27578A2E05313607AE846D0FBE88CB9BF29E445AE268F` |
| `docs/work-items/SH-CASE-001-brief.md` | `CBD2C86968DA355BE163F05E5278F71E4B83FEED94D8C49EEF1E98C7E299D746` |

Relevant frozen inputs:

| File | SHA-256 |
|---|---|
| `shared/business-contract.md` | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| `shared/contracts/receipt-and-date-contract.md` | `F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD` |
| `shared/schemas/event-and-amount.schema.json` | `FD5F2B44C5AC1B8295F54774AA3425DD2DB4BA16915111A3E1B241104CEE47CA` |
| `shared/schemas/nutrition-progress.schema.json` | `E8F0C95006529D5D6F9C388E657EA1F834C567D975577C5903B2B28D79C26DE8` |
| `shared/schemas/issue-correction-mixed.schema.json` | `EDBB15A38543431DD66564B696F7EA956F725E241E628D8EF36E1B9B0D3B511F` |

The five protected lease files are out of scope and must not be requested, read, hashed or executed.

## Required independent checks

1. Verify every supplied file hash before review.
2. Parse candidate JSON independently and require one root object, exact five ordered case IDs and exact three fixture objects.
3. Check that expected values are literals independent of candidate output and that adapters cannot rewrite Oracle values.
4. Check requirement links and scope against DOC-0.3 for the five claimed IDs only.
5. Check meal item order, shared single/multi-item shape and required `meal_id` grouping.
6. Check milk/plain-water classification and absence of double hydration contribution.
7. Check receipt authority, block order and the boundary between structural Oracle here and golden prose in `SH-CASE-004`.
8. Check query natural-day range, active-only filtering, ordering, readable time and zero writes.
9. Check failed FactCommit and technical-log separation against CONTRACT-v2.
10. Check fixture references, uniqueness, fixed clock/timezone/locale/week start, goal order and active/superseded/voided query rows.
11. Independently mutate at least: missing case, duplicate ID, wrong requirement, adapter rewrite, milk as water, alternate single-item shape, estimated explicit water, reordered receipt, writable query, returning voided data and failed-fact meal write.
12. Confirm no database/runtime/installability claim and no protected/business-data payload in the package.

## Severity

- P0: destructive scope escape, protected-data access, business data creation, or a fundamental unsafe Oracle design.
- P1: correct B implementation cannot satisfy the case, materially wrong behavior can pass, expectation is candidate-derived, or a required task invariant is untested.
- P2: useful later expansion that does not weaken or block this five-case package.

## Review independence

The reviewer may write a private checker in its isolated test area. It must not copy the candidate validator's result into its expected values and must report its own mutation count and concrete findings.
