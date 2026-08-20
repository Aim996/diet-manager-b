# SH-MAP-001 Candidate Report

## Candidate identity

- task: `SH-MAP-001`
- status: completed after round-3 independent review PASS
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
5. Defined four write boundaries: FactCommit, EffectBundle, EnvelopeFinalize and migration; every boundary now classifies all 20 tables exactly once as writable or forbidden.
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
MUT-MAP-INVENTORY-DIRECTION-ENUM|PASS
MUT-MAP-NUTRITION-PROFILE-VERSION-TYPE|PASS
MUT-MAP-NUTRITION-SNAPSHOT-VERSION-TYPE|PASS
MUT-MAP-ISSUE-STATUS-ENUM|PASS
MUT-MAP-CORRECTION-OPERATION-ENUM|PASS
MUT-MAP-EFFECT-STAGE-CONST|PASS
MUT-MAP-FINALIZE-STAGE-CONST|PASS
MUT-MAP-EFFECT-ENVELOPE-UNCLASSIFIED|PASS
MUT-MAP-EFFECT-IDEMPOTENCY-WRITABLE|PASS
STORAGE_MAPPING|PASS|version=1.0.0|sources=4|definitions=34|tables=20|indexes=18|mutations=18
```

### Independent review round 1 and correction RED

The first independent review correctly returned `FAIL|p0=0|p1=7`. It found seven physical constraints that contradicted pinned Schema values: inventory direction, two nutrition profile-version affinities, Issue status, correction operation, EffectBundle stage and EnvelopeFinalize stage.

Before changing the mapping, the strengthened validator rejected the old candidate with:

```text
STORAGE_MAPPING_SCHEMA_CONSTRAINT_INVALID:inventory_transactions.direction check
```

The seven mappings were then corrected and each now has a dedicated mutation. The first-review failure remains part of the audit history.

### Independent review round 2 and transaction-boundary correction RED

Round 2 independently revalidated 34 definitions, 20 tables, 18 indexes, 22 foreign keys and rejected 28/28 independent mutations, but correctly returned `FAIL|p0=0|p1=1`. The `effect_bundle` boundary did not classify `command_envelopes` or `idempotency_records`, so the declared `effects_pending -> effects_stable` transition had no permitted envelope write. The same review also recorded the unclassified `goal_versions` table in `envelope_finalize` as P2.

Before changing the mapping, the strengthened validator rejected the candidate with:

```text
STORAGE_MAPPING_SET_INVALID:effect_bundle allowed
```

The four boundaries now partition all 20 tables into exact, non-overlapping writable/forbidden sets. `effect_bundle` may update `command_envelopes`, cannot update `idempotency_records`, and `envelope_finalize` explicitly forbids `goal_versions`. Two dedicated mutations prevent either EffectBundle regression. This correction was then submitted to a fresh round-3 review.

### Independent review round 3 PASS

The third review received four exact candidate files through a five-chunk gzip/Base64 package, verified every chunk, payload and file hash, then combined them with the already verified Schema/design/brief inputs. Its independent checker did not execute the candidate PowerShell validator, reproduced the physical contract hash and rejected 33/33 independent mutations.

```text
SH-MAP-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|definitions=34|tables=20|indexes=18|mutations=33
```

The remaining P2 suggestions concern optional future SQLite `CHECK` hardening for additional enum columns. They are recorded for the DDL/migration task and do not expand this mapping task.

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

- mapping: `6BEAC0DD2126A680DAD995E9889388BE980DEBE557D05CF1ADAF4F47B77D5A47`
- validator: `5D17CAB033C9230960E39AAD510AB7C520F3EE217DA6936042DEDF644279E540`

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

## Completion status

The mapping candidate is frozen in implementation commit `d8f612b5c2a7a556fc4f79c7f76414d4d70b78e3`. Independent review is complete. Evidence, private GitHub delivery and clone reproduction are recorded in `EV-20260811-020`; the documentation closure commit is intentionally separate so the evidence does not self-reference its own Git object.
