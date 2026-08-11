# SH-MODEL-002 Brief

## Objective

Freeze the shared `nutrition-progress/v1` model required by `REQ-NUTR-003`, `REQ-NUTR-006`, `REQ-PROGRESS-001`, and `REQ-PROGRESS-004`, with component-level coverage for `CASE-NUTR-005`, `CASE-NUTR-006`, `CASE-PROGRESS-001`, and `CASE-PROGRESS-011`.

## Status and ownership

- status: `in_progress`
- root: `E:\codx\skill\饮食管家`
- owner: Codex `/root`
- reviewer: independent OpenClaw semantic review
- full_case_set: `none`
- risk_ids: `RISK-006`, `RISK-008`, `RISK-013`
- decision_ids: `DEC-024`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260810-001`, `CHG-20260811-001`

## Normative inputs

- `总功能开发计划0.3.md` §§13.6–13.8, 13.12, 13.16, 13.19, 17.1–17.13, 23.2, 25.3, 31.4.
- `shared/contracts/receipt-and-date-contract.md` §§2.2 and 7.
- `shared/nutrition-source-registry.json` version/source/history boundaries.
- `shared/schemas/event-and-amount.schema.json` only through its frozen absolute DecimalString reference.
- `docs/superpowers/specs/2026-08-11-sh-model-002-design.md`.

## Deliverables

- `shared/schemas/nutrition-progress.schema.json`
- `shared/tests/fixtures/nutrition-progress-cases.json`
- `shared/tests/validate-nutrition-progress-schemas.ps1`
- design, implementation plan, report, independent review package/review, and EV-018.

## Required identities

- schema `$id = https://diet-manager.local/schemas/nutrition-progress/v1`
- draft = `https://json-schema.org/draft/2020-12/schema`
- schema version = `1.0.0`
- fixture set id = `diet-manager/nutrition-progress-cases/v1`
- absolute decimal reference = `https://diet-manager.local/schemas/event-and-amount/v1#/$defs/DecimalString`

## Required definitions

Exactly these ten public definitions are required:

1. `CoverageStatus`
2. `NutrientValues`
3. `MetricValues`
4. `MetricCoverage`
5. `NutritionFieldEvidence`
6. `NutritionProfile`
7. `NutritionSnapshot`
8. `GoalVersion`
9. `DailyProgress`
10. `DailyProgressResult`

## Required invariants

1. `CoverageStatus` is exactly `complete | partial | unknown | not_applicable`; `estimated` is field evidence, not coverage.
2. Persisted quantities are canonical decimal strings. JSON numbers are invalid; unknown is null plus coverage and never numeric zero.
3. NutritionProfile versions are immutable. New profiles supersede by ID and affect future calculations only.
4. NutritionSnapshot identifies the exact profile version and remains immutable when sources, parsers, or profiles change.
5. Nutrient values have ten exact keys. The five core keys are energy, protein, fat, carbohydrate, and fiber.
6. Snapshot known/missing sets are disjoint and match nonnull/null values. Complete requires all core fields known; partial discloses known and missing; unknown has no reliable nutrient result.
7. GoalVersion is append-only and user-confirmed. All six goal keys exist; null means unconfigured. All-null or population-default goals are forbidden.
8. The exact metric order is energy, protein, fat, carbohydrate, fiber, water.
9. Daily totals/goals/water lower bounds are nonnegative. Correction increments may be signed. Direct queries have null current-turn increments.
10. Unknown fiber remains null. Incomplete hydration has exact water null plus a nonnegative known lower bound and partial water coverage.
11. DailyProgressResult uses a sorted unique nonempty date array. One date requires a deeply identical singular alias; two or more dates forbid it.
12. Result status is committed. Failed FactCommit/finalization creates no object in this schema; only a separate redacted technical log may exist.
13. Generic `status`, extra properties, route-specific fields, health recommendations, and population goal defaults are forbidden.

## Case assertion paths

```yaml
case_assertion_paths:
  CASE-NUTR-005:
    - /nutrition_profile/profile_version
    - /nutrition_profile/supersedes_profile_id
    - /nutrition_snapshot/profile_version
  CASE-NUTR-006:
    - /nutrition_snapshot/nutrient_values
    - /nutrition_snapshot/known_fields
    - /nutrition_snapshot/missing_fields
    - /nutrition_snapshot/coverage_status
  CASE-PROGRESS-001:
    - /goal_version/goals
    - /daily_progress/metric_order
    - /daily_progress/configured_goals
  CASE-PROGRESS-011:
    - /daily_progress_result/daily_progress_by_date
    - /daily_progress/current_turn_increments
full_case_set: none
```

## Stable loader and validation errors

- `NUTRITION_PROGRESS_SCHEMA_FILE_MISSING`
- `NUTRITION_PROGRESS_FIXTURE_FILE_MISSING`
- `NUTRITION_PROGRESS_JSON_INVALID`
- `NUTRITION_PROGRESS_SCHEMA_IDENTITY_INVALID`
- `NUTRITION_PROGRESS_SCHEMA_SHAPE_INVALID`
- `NUTRITION_PROGRESS_SCHEMA_HASH_INVALID`
- `NUTRITION_PROGRESS_FIXTURE_COVERAGE_INVALID`
- `NUTRITION_PROGRESS_CASE_RESULT_INVALID`
- `NUTRITION_PROGRESS_MUTATION_NOT_REJECTED`

## Verification commands

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-nutrition-progress-schemas.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-business-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-receipt-and-date-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-issue-correction-contract-v2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-decision-thresholds.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-core-model-schemas.ps1
```

## Exclusions

- no database, migration, repository, SQL, business record, nutrition network client, renderer, runtime adapter, route map, notification scheduler, or deployment;
- no Issue/Correction/Mixed schema from SH-MODEL-003;
- no A/C product implementation or three-route score;
- no automatic goals, health evaluation, medical advice, remaining-budget advice, or food recommendation;
- no access to the five protected lease files.

## Completion

The task closes only after the exact fixture set and four mutations pass, independent semantic review accepts the frozen candidate, private GitHub delivery is reproduced in the independent clone, protected tracked paths remain zero, business data candidates remain zero, and the total plan records EV-018 without claiming SQLite or product readiness.
