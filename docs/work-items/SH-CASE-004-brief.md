# SH-CASE-004 Work-Item Brief

## Identity and state

- task_id: `SH-CASE-004`
- milestone: `M2`
- type: `cases`
- product_line: `B-only shared Oracle`
- status: `completed`
- owner: `Codex /root`
- reviewer: `OpenClaw 02 independent public-clone review; P0=0/P1=0/P2=2`
- full_case_set: `none`

## Objective

Freeze eight exact Chinese final-response artifacts and append the six missing receipt/progress acceptance cases. The text assets are the independent byte-level Oracle; the structured manifest records the final result that a future renderer must consume. This task does not implement a renderer, database, OpenClaw adapter, MCP server, installer or production write path.

The governing product rule remains: a failed business write may produce a technical log, but it must not create a partial dietary record. A finalizer failure after committed facts/effects may expose only the bounded pending message frozen by `CASE-EFFECT-003`; it must not expose a success receipt or progress.

## Dependencies

- `SH-SAFE-BASE-001`
- `SH-MODEL-001`
- `SH-MODEL-002`
- `SH-MODEL-003`
- `SH-CASE-001`
- `SH-CASE-002`
- `SH-CASE-003`

The Plan 0.3 dependencies above are complete. Product renderer/storage implementation remains intentionally pending.

## Requirements and cases

- requirement_ids: `REQ-RECEIPT-001`, `REQ-RECEIPT-002`, `REQ-RECEIPT-003`, `REQ-TIME-001`, `REQ-MEAL-001`, `REQ-CORE-002`, `REQ-QUICK-001`, `REQ-SCOPE-002`, `REQ-PROGRESS-002`, `REQ-PROGRESS-004`, `REQ-SAFE-003`
- golden_case_ids: `CASE-RECEIPT-001`, `CASE-RECEIPT-002`, `CASE-RECEIPT-004`, `CASE-RECEIPT-005`, `CASE-RECEIPT-006`, `CASE-PROGRESS-006`, `CASE-STORAGE-006`, `CASE-EFFECT-003`
- appended_case_ids: `CASE-RECEIPT-002`, `CASE-RECEIPT-004`, `CASE-RECEIPT-005`, `CASE-RECEIPT-006`, `CASE-PROGRESS-006`, `CASE-STORAGE-006`
- stage: `PRODUCT-0.1`

`CASE-RECEIPT-001` and `CASE-EFFECT-003` already exist in the cumulative case registry and remain unchanged there. They are linked only through the external golden catalog.

## Deliverables

- create `shared/acceptance-cases/golden-receipts/manifest.json`
- create eight independent UTF-8/LF `shared/acceptance-cases/golden-receipts/CASE-*.txt` artifacts
- create `shared/tests/validate-golden-receipts.ps1`
- update `shared/acceptance-cases/cases.json` to cumulative version `1.3.0` with exactly six appended cases
- update permitted acceptance validators for cumulative suffix compatibility
- create the SH-CASE-004 report, review package, final review and closure evidence
- update Plan 0.3 and the detailed development-progress document only after all completion gates pass

## Case assertion paths

```yaml
case_assertion_paths:
  CASE-RECEIPT-001:
    - shared/acceptance-cases/golden-receipts/CASE-RECEIPT-001.txt
  CASE-RECEIPT-002:
    - shared/acceptance-cases/golden-receipts/CASE-RECEIPT-002.txt
  CASE-RECEIPT-004:
    - shared/acceptance-cases/golden-receipts/CASE-RECEIPT-004.txt
  CASE-RECEIPT-005:
    - shared/acceptance-cases/golden-receipts/CASE-RECEIPT-005.txt
  CASE-RECEIPT-006:
    - shared/acceptance-cases/golden-receipts/CASE-RECEIPT-006.txt
  CASE-PROGRESS-006:
    - shared/acceptance-cases/golden-receipts/CASE-PROGRESS-006.txt
  CASE-STORAGE-006:
    - shared/acceptance-cases/golden-receipts/CASE-STORAGE-006.txt
  CASE-EFFECT-003:
    - shared/acceptance-cases/golden-receipts/CASE-EFFECT-003.txt
full_case_set: none
```

## Frozen Oracle

### Asset package

- catalog id: `diet-manager/golden-receipts-v1`
- catalog version: `1.0.0`
- entry count: `8`
- text encoding: strict UTF-8 without BOM
- newline: LF only
- terminal newline: exactly one
- exact comparison: bytes, Chinese text, Emoji, punctuation, spaces, blank lines and line order
- structured result may generate expected text: `false`
- adapters may rewrite Oracle: `false`

### Successful receipts

- successful output order is title, item lines, actual inventory effect, optional Issue/requested-analysis block, then progress
- `CASE-RECEIPT-001` is copied exactly from the approved receipt/date v2 example
- explicit fields have no inferred label; inferred fields use the approved evidence label
- quick options are bounded and retain a free-text/safe-exit route
- normal success has no duplicate current-turn nutrition section and no automatic advice
- requested analysis is factual, requested and before progress
- one-item success has no empty placeholder line
- one-date progress is the same `EnvelopeFinalize` result and its single-day alias is equal

### Replay and pending

- cross-date retry returns the exact frozen original two-date result, ordered by date, even after an unrelated later write
- multi-date output forbids a single `daily_progress` alias
- `effects_pending` exposes exactly one bounded pending paragraph
- pending output contains no success title, receipt block, progress Emoji or terminal idempotency result
- write failure before business commit may log a technical failure but creates no dietary data

## Stable forbidden outcomes

- generating the expected text from the same structured object under test
- accepting a byte, punctuation, Emoji, spacing, line-order or newline change
- labels on explicit fields or missing labels on inferred fields
- invented diagnosis, automatic advice or post-progress recommendation
- duplicate current-turn nutrition/progress query output
- returning current totals instead of the frozen original retry result
- exposing a success receipt/progress while finalization is pending
- creating a partial dietary record when the business write failed
- placing renderer-only fields into the previously frozen case values

## Repository-relative roots

- source_root: repository root (`.`)
- shared_root: `./shared`
- golden_root: `./shared/acceptance-cases/golden-receipts`
- product_data_root: not created by this task
- isolated_test_data_root: system temporary test-owned directories only

## Verification commands

Run the focused golden validator and the permitted core/domain/ops acceptance validators with Windows PowerShell 5.1. Require strict JSON, Parser=0, byte mutations, twelve semantic anti-weakening mutations, exact cumulative version/count/order, preservation of the first twenty case values, protected changed-path count zero, `git diff --check`, no business candidate files and no temporary residual.

Do not read, hash, edit, track or execute the five protected domain lease files.

## Completion and reopen

Completion requires eight exact assets, six appended cases, all focused checks, twelve rejected mutations, permitted cumulative regressions, one independent review with P0=0/P1=0, evidence and detailed progress closure. Reopen when a selected receipt/progress/pending behavior, exact text, manifest shape, renderer-input contract or related shared requirement changes. Later appended registered cases do not invalidate these twenty-six frozen values by themselves.
