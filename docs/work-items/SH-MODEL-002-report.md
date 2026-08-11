# SH-MODEL-002 RED/GREEN Report

## Candidate

| File | SHA-256 |
|---|---|
| `shared/schemas/nutrition-progress.schema.json` | `E8F0C95006529D5D6F9C388E657EA1F834C567D975577C5903B2B28D79C26DE8` |
| `shared/tests/fixtures/nutrition-progress-cases.json` | `0686975A30F8F74ECD8866F5F0D795F226E1AA374B9165ECB2CE44F12F498623` |
| `shared/tests/validate-nutrition-progress-schemas.ps1` | `1C0C63BD3A99BD8884B7C87F3B58E8FF44C9818BEAF0B241C2AD63E4B68556C7` |
| `docs/work-items/SH-MODEL-002-brief.md` | `4A598C77F3D210208A9ED00CED7A509574709EDB2ACDE3F39840E458243CF8DE` |
| `docs/superpowers/specs/2026-08-11-sh-model-002-design.md` | `143BA469A5E9861D1AAD0DDE8A948F13DFC62A37D34F7B712E97983EEA2BA1FB` |

## RED — missing schema

The fixed 42-case list and stable loader errors existed before the schema and fixture corpus:

```text
TDD_RED|PASS|code=NUTRITION_PROGRESS_SCHEMA_FILE_MISSING|parser=0|ascii=true
```

## GREEN — frozen nutrition and progress model

```text
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
```

The validator pins the exact schema and fixture bytes. Four independent fail-closed mutations cover changed schema identity, a JSON-number quantity, unsupported coverage and missing fixture coverage.

## Covered behavior

- immutable/versioned nutrition profiles with source, basis, evidence, supersession and complete/partial/unknown coverage;
- immutable nutrition snapshots tied to the exact profile ID and version used for a meal item;
- exact known/missing/value consistency, including unknown values that remain `null` instead of numeric zero;
- append-only, user-confirmed goal versions with exactly six nullable metric keys and no population defaults;
- exact metric order: energy, protein, fat, carbohydrate, fiber and water;
- nonnegative daily totals/goals, signed current-turn corrections, per-metric coverage and water lower bounds;
- direct queries with null current-turn increments;
- one-date results with a required deep-identical alias and multi-date results with no alias;
- sorted unique dates and cross-day signed correction results;
- strict extra-property and generic `status` rejection.

## Validation boundary

The schema is route-neutral and references the frozen canonical decimal-string definition by absolute `$id`. The PowerShell validator separately checks semantic rules that JSON Schema cannot conveniently express, including cross-field coverage, known/missing partitions, exact metric order, date ordering and alias equality.

No production JSON Schema runtime, SQLite table, repository or writer is added here. Before any dietary write boundary uses these objects, a route-neutral runtime validator must load the referenced schema registry by `$id`, assert date/date-time formats and preserve the same semantic checks.

## Fresh local gates

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
DECISION_THRESHOLDS|PASS|id=diet-manager/decision-thresholds/v1|version=1.0.0|cases=54|expiry_rules=8|gates=2|mutations=4
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
MODEL_PARSER_ERRORS=0
VALIDATOR_NONASCII=0
STRICT_JSON=PASS
PROTECTED_CHANGED=0
BUSINESS_CANDIDATES=0
```

## Not claimed

This candidate is a shared model freeze, not a database, production repository, runtime adapter, OpenClaw/MCP handler, renderer, installable Skill or product-readiness milestone. A failed FactCommit/finalization may create a separate redacted technical log but creates zero dietary business objects.
