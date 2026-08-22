# SH-CASE-001 Candidate Report

## Candidate identity

- task: `SH-CASE-001`
- status: completed; independent review and clone reproduction PASS
- product line: B-only shared Oracle
- case catalog: `shared/acceptance-cases/cases.json`
- fixture catalog: `shared/acceptance-cases/fixtures/core-v1.json`
- validator: `shared/tests/validate-core-acceptance-cases.ps1`
- database file created: no
- product installable after this task: no

## Implemented scope

1. Replaced twelve simplified legacy intent samples with one versioned canonical case-set object.
2. Frozen exactly five formal cases: `CASE-MEAL-001`, `CASE-MEAL-021`, `CASE-WATER-001`, `CASE-RECEIPT-001`, `CASE-QUERY-001`.
3. Added fixed clock, timezone, locale, week start, six-goal and active/superseded/voided query-view fixtures.
4. Frozen exact inputs, requirement links, result status, ordered item shape, meal/water classification, receipt block structure, query range/filter/order and forbidden outcomes.
5. Frozen the package rule that adapters cannot rewrite Oracle values.
6. Frozen failed FactCommit behavior: a separate redacted technical log is allowed, but business writes and all eight business artifact classes remain zero.
7. Added an ASCII PowerShell 5.1 validator with exact shape/type/value checks and eight mutations.

## TDD record

### RED

The validator passed Parser/ASCII/CR/NUL gates before the data changed. Against the legacy array it failed with:

```text
CORE_CASE_SET_SHAPE_INVALID:root
```

### Initial GREEN

After adding the canonical catalog and fixtures:

```text
CORE_ACCEPTANCE_CASES|PASS|version=1.0.0|cases=5|fixtures=3|mutations=0
```

### Mutation GREEN

```text
MUT-CASE-DROP-REQUIRED-CASE|PASS
MUT-CASE-ALLOW-ADAPTER-ORACLE-REWRITE|PASS
MUT-CASE-MILK-AS-WATER|PASS
MUT-CASE-SINGLE-ITEM-ALT-SHAPE|PASS
MUT-CASE-EXPLICIT-WATER-ESTIMATED|PASS
MUT-CASE-RECEIPT-PROGRESS-NOT-LAST|PASS
MUT-CASE-QUERY-ALLOWS-WRITE|PASS
MUT-CASE-FAILED-FACT-ALLOWS-MEAL|PASS
CORE_ACCEPTANCE_CASES|PASS|version=1.0.0|cases=5|fixtures=3|mutations=8
```

## Business invariants

- Multi-item and single-item meals share one ordered `items[]` shape and require a `meal_id`.
- Milk is a nutritious meal drink, not a plain-water event.
- Explicit 500 ml plain water is exact, creates one WaterEvent and is not duplicated as a meal.
- Receipt structure is finalizer-authoritative and ends with progress; exact prose is deferred to `SH-CASE-004`.
- Current-day meal queries use `[day start, next day start)`, return active records only, expose readable times and write zero business state.
- Technical logs never count as dietary records or success evidence.
- A failed FactCommit cannot leave a half meal, water record or any other business artifact.

## Upstream regression

All six relevant frozen validators passed without modifying their inputs:

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4
```

## Candidate hashes

- cases: `4972830F746ED630FF31897D2E958451077DD602EEA1C5510CE0B3432FDD38D7`
- fixtures: `720A8DB76CB00C034164E401B5B45C415D79218C88BCEF87F42399B2DC0CF2CB`
- validator: `F0247742B91400E22AFE117C239AAC91D2B78D0024F59B315B9E8585ABCB4262`
- design: `FFC1BDD89E0DA117A1D27578A2E05313607AE846D0FBE88CB9BF29E445AE268F`
- plan: `CB68D184B10B7BF1FEA35CD1E906C4E88FECE63ACFF396BFF259100CBEA8FCA7`
- brief: `CBD2C86968DA355BE163F05E5278F71E4B83FEED94D8C49EEF1E98C7E299D746`

## Not implemented

- no full-case B adapter execution;
- no SQLite database, migrations, repository or outbox worker;
- no exact golden receipt prose;
- no purchase/inventory/nutrition/Issue/correction/ops case package;
- no OpenClaw/MCP production adapter;
- no G1/G2/G3 or installability claim.

## Independent review

OpenClaw verified the 151068-byte review ZIP, its SHA-256, all 12 entries, 10 declared file hashes, zero protected files and zero business-database payloads. It wrote an independent checker, did not execute the candidate validator to create expectations, and rejected 20/20 independent mutations.

```text
SH-CASE-001-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=5|fixtures=3|mutations=20
```

Two non-blocking P2 items are recorded in `SH-CASE-001-review.md`: the future explicit `nutritious_drink` to `nutrition_drink` adapter mapping, and centralized common output-forbidden checks in the future harness.

## Completion gates

1. strict static/data hygiene gates: PASS;
2. independent review with P0=0/P1=0: PASS;
3. evidence `EV-20260811-021`: written;
4. private GitHub push and independent-clone reproduction: executed as the final delivery gate.

The frozen candidate was pushed at `b37eaf66676fd01f25cc9ee530cae1e84f7f447d`. The independent clone fast-forwarded to that commit and reproduced all seven validators before the review/evidence closure commit was created.
