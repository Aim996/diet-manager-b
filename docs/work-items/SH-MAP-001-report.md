# SH-MAP-001 Candidate Report

## Candidate identity

- task: `SH-MAP-001`
- status: candidate green, independent review pending
- product line: B only
- mapping: `shared/contracts/storage-mapping.md`
- validator: `shared/tests/validate-storage-mapping.ps1`
- database file created: no
- product installable after this task: no

## Implemented scope

1. Pinned four upstream Schema IDs and SHA-256 values.
2. Covered all 34 upstream definitions and every resolved field exactly once.
3. Defined 20 future SQLite tables with column name, affinity, nullability, default, primary key, checks and foreign-key intent.
4. Defined 18 indexes for idempotency, event lookup, meal-item ordering, outbox dispatch, inventory ordering, nutrition versioning, goal/progress lookup, Issue lifecycle, correction requests and terminal mixed results.
5. Defined four write boundaries: FactCommit, EffectBundle, EnvelopeFinalize and migration.
6. Defined fresh install, successful upgrade, failed upgrade and recovery behavior.
7. Defined normal open, WAL recovery, integrity failure and restore-candidate recovery checks.
8. Defined five C-control merge points into B and explicitly prohibited A/C writers.
9. Kept redacted technical logs outside the business database, business queries and transaction outcome.

## Failure atomicity

`fact_commit.failure_state` is exactly `failed_fact_zero_business_rows`. FactCommit cannot write nutrition snapshots, inventory transactions, Issues, daily progress, finalization or mixed-result tables. A write failure may emit a separate redacted technical log, but cannot leave an event, meal item, correction, outbox, receipt, progress row or terminal idempotency result.

## TDD record

### RED

After the validator passed Parser/ASCII/CR/NUL gates, running it without the mapping file failed with:

```text
STORAGE_MAPPING_FILE_MISSING:E:\codx\skill\饮食管家\shared\contracts\storage-mapping.md
```

### GREEN

```text
MUT-MAP-DROP-FIELD|PASS
MUT-MAP-A-WRITER|PASS
MUT-MAP-LOG-IN-BUSINESS-DB|PASS
MUT-MAP-FACT-WRITES-FINAL|PASS
MUT-MAP-DROP-IDEMPOTENCY-INDEX|PASS
MUT-MAP-FAILED-MIGRATION-ADVANCES|PASS
MUT-MAP-WEAKEN-COLUMN-TYPE|PASS
MUT-MAP-WEAKEN-NULLABILITY|PASS
MUT-MAP-REDIRECT-FOREIGN-KEY|PASS
STORAGE_MAPPING|PASS|version=1.0.0|sources=4|definitions=34|tables=20|indexes=18|mutations=9
```

## Upstream regression

All six frozen validators passed without editing their upstream inputs:

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4
```

## Candidate hashes

- mapping: `BF2BCE34C254C8510B689E93F1CB15BA1230548466E45FB10B7BE909D5F2BC33`
- validator: `C9603E01A1149D244903370460FFCA42EDC27FD72888C894AB5D513B7EA00785`

These hashes are candidate identities and must be refreshed if independent review causes any edit.

## Verification gates

- mapping machine blocks: exactly 1
- strict JSON parse: pass
- validator Parser errors: 0
- validator non-ASCII bytes: 0
- changed-file CR bytes: 0
- changed-file NUL bytes: 0
- `git diff --check`: pass
- new business database/JSONL candidates: 0

## Not implemented

- no SQLite database, DDL executor or migration runner;
- no repository or outbox worker;
- no OpenClaw/MCP production adapter;
- no `selected-route-map.json`;
- no G1/G2/G3 or installability claim.

## Pending completion gates

1. independent storage-mapping review with P0=0/P1=0;
2. evidence `EV-20260811-020`;
3. private GitHub push and independent-clone reproduction;
4. final source/origin/clone equality and clean status.
