# SH-CASE-001 Core Acceptance Cases Design

> Date: 2026-08-11
>
> Status: approved by DOC-0.3 scope and the user's standing instruction to continue with the recommended B-only plan
>
> Product line: B only

## Goal

Replace the legacy twelve-line intent sample with the first versioned, executable common acceptance-case package. This task freezes five core cases only:

- `CASE-MEAL-001`
- `CASE-MEAL-021`
- `CASE-WATER-001`
- `CASE-RECEIPT-001`
- `CASE-QUERY-001`

The package defines inputs, fixed environment, fixture references, exact Oracle values and forbidden outcomes. It does not create a SQLite database, implement a repository, render final golden receipt text, or run an OpenClaw/MCP adapter.

## Chosen structure

### Canonical case file

`shared/acceptance-cases/cases.json` becomes the single canonical case catalog. It is replaced rather than supplemented by a second competing `core-cases.json` expectation source.

The top-level object contains:

- `case_set_id` and `version`;
- one exact `fixture_catalog` path;
- the frozen business-contract identity;
- package-level invariants, including failed FactCommit zero-business-write behavior;
- exactly five ordered cases for this task.

Every case contains the minimum machine structure required by DOC-0.3 section 24.3: `id`, `requirement_ids`, `stage`, `source_text`, `setup`, `oracle` and `forbidden`.

### Fixture catalog

`shared/acceptance-cases/fixtures/core-v1.json` owns deterministic setup values shared by the five cases:

- clock `2026-08-11T08:30:00+08:00`;
- timezone `Asia/Shanghai`;
- locale `zh-CN`;
- Monday week start;
- one six-metric goal version;
- a test-owned current-day meal view for the query case.

Fixtures describe data; they do not create a database or derive expected results from a candidate implementation.

### Validator

`shared/tests/validate-core-acceptance-cases.ps1` is a PowerShell 5.1, ASCII-only validator. Expected case IDs, requirement links, fixture values, Oracle values and forbidden sets are literals owned by the test. The validator does not copy expectations out of the candidate JSON.

It checks exact top-level and case shapes, reference integrity, uniqueness, fixed environment, business-contract identity and these case-specific rules:

1. `CASE-MEAL-001`: one committed meal groups three ordered items under one `meal_id`; milk remains a meal item, no WaterEvent is created, and final progress comes from the same finalized envelope.
2. `CASE-MEAL-021`: a single food still uses an ordered `items[]` collection and a `meal_id`; there is no alternate single-item schema.
3. `CASE-WATER-001`: exactly 500 ml of plain water creates one exact WaterEvent, is not estimated and is not duplicated as a meal item.
4. `CASE-RECEIPT-001`: the receipt structure is title line, one line per dish/food/drink, same-line dish components and a final progress block. Exact golden prose remains the responsibility of `SH-CASE-004`.
5. `CASE-QUERY-001`: the query uses the user's natural day and current active view, excludes superseded/voided records, returns readable times and performs zero writes.

The package-level atomicity invariant states that a failed FactCommit may reference a separate redacted technical log but forbids every dietary/business artifact listed by CONTRACT-v2.

## Data flow

```text
DOC-0.3 + frozen contracts/schemas
            |
            v
fixed fixture catalog ---> canonical five-case catalog
                                  |
                                  v
                    independent literal validator
                                  |
                                  v
                 future SH-HARNESS-001 B adapter
```

The future harness may consume the case package but may not rewrite expected values for B, A or an adapter. OpenClaw and MCP remain transport adapters over the same B result.

## Error and write boundaries

- Invalid JSON, unknown properties, missing fixtures, duplicate IDs, unregistered requirements, relative-time ambiguity or Oracle weakening fail closed.
- Query cases declare `business_write_count=0`.
- Ignored, clarification and failed-fact behavior cannot be represented as committed.
- A technical log is not a dietary record, is not query-visible and cannot make a failed command appear committed.
- This task writes only documentation, JSON fixtures and a validator. No `.sqlite`, `.db`, WAL, SHM, journal or JSONL business file is allowed.

## TDD strategy

1. Add the validator first and run it against the legacy array to obtain a stable RED.
2. Replace the legacy array with the exact versioned catalog and add the fixture file.
3. Reach GREEN in Windows PowerShell 5.1.
4. Add mutations for dropped case, self-derived expectation, milk misclassified as water, single-item schema split, estimated explicit water, receipt block reordering, query write permission and failed-fact business artifacts.
5. Re-run the frozen contract/model validators and data-candidate gates.

## Scope exclusions

- no purchase, inventory, nutrition-source, Issue, correction, mixed or failure-injection cases; those belong to `SH-CASE-002`;
- no install, migration, privacy, backup or deletion cases; those belong to `SH-CASE-003`;
- no exact final receipt prose or multi-day golden output; those belong to `SH-CASE-004`;
- no case execution adapter or trace registry; those belong to `SH-HARNESS-001` and `SH-TRACE-001`;
- no production SQLite/repository or OpenClaw/MCP business implementation.

## Completion evidence

Completion requires:

- exact 5/5 case identities and exact fixture references;
- validator Parser/ASCII/CR/NUL gates;
- focused GREEN plus mutation rejection;
- six upstream contract/model validators unchanged and passing;
- independent review with P0=0/P1=0;
- zero business data candidates;
- private GitHub push and clean independent-clone reproduction.
