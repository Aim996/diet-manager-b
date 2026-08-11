# SH-CASE-004 Independent Review

## Result

The public candidate at commit `072c1fb9ed4242a39b7b1aeaf1c134d5d1c33508` passed one independent OpenClaw 02 review:

```text
SH_CASE_004_REVIEW|PASS|P0=0|P1=0|P2=2|sha=072c1fb9ed4242a39b7b1aeaf1c134d5d1c33508|cleanup=1
```

`SH-CASE-004` may close as an Oracle-only work item. This result does not claim that a renderer, SQLite repository, adapter, installer or deployable Skill has been implemented.

## Independence

- acquisition: unauthenticated HTTPS from the public GitHub repository
- isolation: fresh clone at the exact reviewed SHA
- expected sources: public contracts, brief, design, case catalog and golden text assets
- candidate report: supplementary only, never the sole expected source
- protected lease files: not read, hashed, edited or executed
- cleanup: isolated clone removed; residual count `0`
- reviewer runtime: Linux, so the independent reviewer did not rerun Windows PowerShell 5.1; the real WinPS5.1 regression evidence remains the local execution record

## Checks completed

The independent review confirmed:

- exact cumulative order of twenty preserved case values followed by six appended values;
- independent byte comparison of the previous twenty cases against the public base;
- all eight golden assets are unique, strict UTF-8/LF, and match declared length, SHA-256 and line count;
- `CASE-RECEIPT-001` matches the frozen receipt/date contract example byte for byte;
- receipt block order, six-metric order, alias rules, quick options, safe exit, requested-analysis placement, cross-date replay and pending-result boundaries;
- all twelve weakening families are rejected by the real candidate validator;
- the three earlier acceptance validators changed only for cumulative `1.3.0` suffix compatibility;
- no secret, private address, machine path, protected path or business-data artifact was added.

## P2 findings

1. The six newly appended case objects are locked by root shape, setup, requirements, forbidden rules, golden bytes and semantic validation, but their full per-case Oracle property-key sets and exact `source_text` strings do not yet have separate frozen literals. This is optional defense-in-depth for `SH-HARNESS-001` or CI; it does not weaken the current golden Oracle and must not become a second self-generated Oracle.
2. The candidate report used `local_verification_passed_review_pending` while the review package used `candidate_review_pending`. This was a cosmetic pre-review wording difference. The closure documents now use `independent_review_passed`.

Neither P2 finding authorizes extending this completed work item. Reopen only if a golden byte, related contract, case value or renderer-facing semantic changes.
