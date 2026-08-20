# SH-MODEL-001 RED/GREEN Report

## Candidate

| File | SHA-256 |
|---|---|
| `shared/schemas/event-and-amount.schema.json` | `FD5F2B44C5AC1B8295F54774AA3425DD2DB4BA16915111A3E1B241104CEE47CA` |
| `shared/schemas/product-inventory.schema.json` | `681551FA18759AE3F993B0951C3A650FA8ABE16B28D7A9E7223E24F5E9B6613F` |
| `shared/tests/fixtures/core-model-cases.json` | `3FF78E234D063E86294143BD2D91765E96E6569D53704EECEE4A83F29945AA39` |
| `shared/tests/validate-core-model-schemas.ps1` | `486CF6D9783E8FF750115EF49C9C2CA7F6DF3B0C2D608310E490B06B8E30120C` |
| `docs/work-items/SH-MODEL-001-brief.md` | `0EF9430399A696B9F43C946E997C41DBC08769816E42D0030E413A28A571A1B6` |
| `docs/superpowers/specs/2026-08-11-sh-model-001-design.md` | `108AB34CFB686E05404A913A9C8FD11FB7E9CA01CD2F30C408495937CEC7A740` |
| `docs/superpowers/plans/2026-08-11-sh-model-001-plan.md` | `60886216A9123DADA6B8F9593DD7928D7AC0753EB07BFCE637FCFE655C85343D` |

## RED 1 — missing schema

The validator existed before either schema or the fixture file:

```text
STATIC_RED|parser=0|ascii_nonzero=0
RED_EXIT=1
MODEL_SCHEMA_FILE_MISSING:E:\codx\skill\饮食管家\shared\schemas\event-and-amount.schema.json
```

## GREEN 1 — minimum model

The first model had 33 fixed positive/negative cases and four independent mutations:

```text
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=33|event_defs=6|inventory_defs=6|mutations=4
```

## RED 2 — test-quality review

Review found two omissions before completion:

1. inventory adjustment and correction compensation may increase or decrease quantity, but the first evaluator treated them as one-direction operations;
2. `FieldProvenance` existed in the schema but ProductIdentity and InventoryBatch did not require it.

Expected coverage was expanded before candidate changes:

```text
QUALITY_RED_EXIT=1
MODEL_FIXTURE_COVERAGE_INVALID:case ids/order/unique
```

## GREEN 2 — provenance and bidirectional changes

The schemas now require field provenance for ProductIdentity and InventoryBatch. Fixed cases add an outward adjustment and inward correction compensation. Sign, arithmetic, event/reason coherence and authorization remain independently checked.

```text
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=35|event_defs=6|inventory_defs=6|mutations=4
```

## RED 3 — independent review boundary findings

The first independent review passed the candidate but identified two contract inconsistencies and three evaluator gaps. They were treated as required corrections instead of being deferred:

1. a completed business fact still allowed `result_status=failed`, contrary to the rule that failed commits create no dietary object;
2. relative cross-file refs did not resolve to the declared Event schema `$id` under standard 2020-12 resolution;
3. the evaluator did not reject all extra properties or empty required provenance;
4. partial deduction authorization was not tied to the current source message;
5. approximate time and vague amount lacked fixed positive boundaries.

New fixed case IDs were added before the implementation changes. The old evaluator failed on the first new boundary:

```text
MODEL_CASE_RESULT_INVALID:MODEL-PRODUCT-EXTRA-PROPERTY-INVALID error=MODEL_CASE_RESULT_INVALID:product generic status is forbidden
```

## GREEN 3 — contract-closed candidate

- business model envelopes now allow only `result_status=committed`; failed writes remain technical-log-only;
- every cross-file ref uses the exact absolute Event schema `$id`;
- the evaluator rejects extra properties, empty product/batch provenance and wrong-message partial authorization;
- fixture bytes are pinned in addition to schema bytes;
- approximate OccurredTime and vague Amount have fixed positive cases.

```text
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
```

## Covered behavior

- exact, interval and approximate OccurredTime, including non-exact point rejection;
- decimal-string exact/range/vague/missing Amount and JSON-number rejection;
- ordered multi-item MealEvent with four distinct amount fields;
- planned fact and generic `status` rejection;
- explicitly confirmed aliases and field-level provenance;
- immutable InventoryBatch versus rebuildable projection;
- one bag with unknown inner count and unknown quantity not represented as zero;
- stocked, gift in/out, opened, adjustment and correction inventory events;
- direction/sign, before+delta=after, nonnegative after, lifecycle/result separation;
- current-message explicit authorization for partial deduction, including wrong-message rejection;
- committed-only business results, strict extra-property rejection and non-empty provenance;
- four fail-closed mutations: schema ID, floating quantity, generic status and missing fixture coverage.

## Validation boundary

The PowerShell validator pins the exact schema bytes and statically checks critical schema definitions/properties. Cross-field rules that JSON Schema cannot express, such as decimal arithmetic and event/direction/reason coherence, are evaluated independently against materialized full objects.

No third-party JSON Schema runtime was installed for this task. The first independent review determined that this is sufficient for a schema-freeze work item because runtime validation and SQLite mapping are later tasks, while the exact schema and fixture bytes are pinned and cross-field semantics have an independent evaluator. A route-neutral runtime engine remains mandatory before the schemas are used as a production write boundary.

Known later-runtime boundary: the PowerShell evaluator uses .NET `decimal` for arithmetic, so a future runtime validator must define or implement arbitrary-precision decimal arithmetic if it accepts canonical strings beyond .NET decimal precision. This does not narrow the JSON Schema value domain in this freeze.

## Final local gate

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
DECISION_THRESHOLDS|PASS|id=diet-manager/decision-thresholds/v1|version=1.0.0|cases=54|expiry_rules=8|gates=2|mutations=4
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
MODEL_PARSER_ERRORS=0
MODEL_ASCII_NONZERO=0
MODEL_JSON_PARSE=PASS
BUSINESS_CANDIDATES=0
```

An initial manual parse command used Windows PowerShell `Get-Content` without explicit UTF-8 and produced mojibake; it did not indicate invalid JSON. The validator and final parse use explicit UTF-8-no-BOM reads and pass.

## Not claimed

No production table, migration, repository, business record, runtime adapter, gate report, route map, deployment, or product-readiness claim is part of this candidate.
