# SH-MODEL-002 Nutrition and Progress Model Design

## Goal

Freeze the route-neutral JSON model for versioned nutrition profiles, immutable intake snapshots, user-confirmed goal versions, authoritative daily progress, cross-day progress results, and one shared four-value `CoverageStatus` before any production SQLite table or Skill handler is created.

## Scope

This task creates one JSON Schema 2020-12 document, one fixed positive/negative fixture set, one Windows PowerShell 5.1 validator, and review/evidence documents. It does not create a database, migration, repository, nutrition network client, progress renderer, OpenClaw/MCP adapter, production record, or installable Skill.

## Shared scalar and coverage rules

All persisted nutrition, goal, total, lower-bound, and increment quantities use canonical decimal strings. JSON numbers are forbidden. Totals, goals, basis amounts, and known lower bounds are nonnegative; correction increments may be signed. Unknown is represented by `null` plus explicit coverage metadata and is never converted to numeric zero.

The only cross-domain coverage type is:

```text
complete | partial | unknown | not_applicable
```

`estimated` is evidence about a field, not a coverage state. Nutrition, each progress metric, and the overall daily result reuse the same `CoverageStatus`; no `completeness` or route-specific synonym is added.

## Model boundaries

### NutritionProfile

`NutritionProfile` is an immutable, versioned description of a food or product. It carries stable profile/subject identity, applicable variant, profile version, source type/name/reference/version/retrieval time, basis kind/amount/unit, optional serving metadata, raw label values, parsed fields, fixed nutrient values, field evidence, coverage, issues, creation time, and an optional superseded-profile reference.

The fixed core nutrients are `energy_kcal`, `protein_g`, `fat_g`, `carbohydrate_g`, and `fiber_g`. The same nutrient object also reserves `energy_kj`, `sodium_mg`, `sugar_g`, `saturated_fat_g`, and `water_ml`. Every property is present and may be `null`; absent source data remains unknown. A newer profile is used only by future calculations. It never rewrites a committed snapshot.

### NutritionSnapshot

`NutritionSnapshot` is the immutable result used for one actual intake item. It identifies the meal event/item and exact profile version, repeats the source reference and calculation basis, records consumed amount, fixed nutrient values, formula, rounding rule, estimated fields, uncertainty, known fields, missing fields, coverage, and creation time.

Known and missing field sets are disjoint and together account for all fixed nutrient properties. A known field has a decimal-string value; a missing field has `null`. `complete` requires all five core nutrients known. `partial` requires at least one reliable known field and at least one missing required field or item contribution. `unknown` requires no reliable nutrient result. Historical snapshots are not reinterpreted when a profile, source registry, parser, or rounding rule changes.

### GoalVersion

`GoalVersion` records only user-configured progress targets. It has stable identity/version, user/timezone, effective start and optional exclusive end date, confirmation source message, creation time, and a fixed six-property goal object. The six properties are energy, protein, fat, carbohydrate, fiber, and water. All keys are present; an unconfigured metric is `null` and may not receive a population default.

Goal versions are append-only. Date queries select the version effective on that date. A later target does not alter an earlier day's interpretation. This model does not calculate or recommend goals.

### DailyProgress

`DailyProgress` is the authoritative frozen progress object for one user-timezone natural date. It contains date/timezone, optional goal version identity, fixed metric order, committed totals, configured goals, current-envelope increments, per-metric coverage, overall coverage, unknown item IDs, water known lower bound, idempotency result identity, and generation time.

The fixed metric order is:

```text
energy_kcal, protein_g, fat_g, carbohydrate_g, fiber_g, water_ml
```

Committed totals include only active committed facts. Preview, failed, ignored, voided, superseded, uncommitted, or pending effects are excluded. `current_turn_increments` is the persisted envelope-level aggregation for the current final result; it is not reconstructed from chat history or the last child operation. Direct read-only progress queries use `null` increments.

Unknown nutrient totals remain `null`. When food hydration is incomplete, exact `water_ml` remains `null`, `water_known_min_ml` stores the known nonnegative lower bound, and water coverage is `partial`. The lower bound is not presented as an exact total.

### DailyProgressResult

`DailyProgressResult` freezes `daily_progress_by_date` as the normative nonempty, date-sorted, unique array. If exactly one date is affected, `daily_progress` is required and must be deeply identical to the sole array item. If two or more dates are affected, `daily_progress` is forbidden. Signed cross-day correction increments stay in their respective date objects.

The model freezes data only. Ten-cell bars, two-line metric text, emoji, percentages, and receipt block ordering remain renderer/golden-receipt responsibilities and are not implemented here.

## Validation architecture

- `shared/schemas/nutrition-progress.schema.json` defines the public model and uses an absolute `$ref` to the frozen decimal-string definition in `event-and-amount.schema.json`.
- `shared/tests/fixtures/nutrition-progress-cases.json` contains full-object positive and negative instances for profile versioning, immutable snapshots, partial/unknown coverage, six goals, unknown fiber/water lower bounds, single-day aliases, and cross-day corrections.
- `shared/tests/validate-nutrition-progress-schemas.ps1` pins schema/fixture identities and hashes, expected definition names, expected case IDs/order/outcomes, and independently checks semantic invariants not expressible in JSON Schema.

The validator must prove at least: decimal-string-only quantities; nonnegative totals/goals/lower bounds; signed increments; profile-version history separation; known/missing consistency; four-value coverage only; six exact metric keys/order; no invented goals; single-day deep alias equality; multi-day alias absence; sorted unique dates; and failed writes producing no model object.

Expected IDs and outcomes are test-owned literals, never derived from the candidate schema or fixture metadata. Independent review uses a second draft 2020-12 implementation when available, but the repository validator remains dependency-free and is the frozen local gate.

## Safety and compatibility

- Route B is the only future writer; the schema itself remains shared and route-neutral.
- A remains read-only/no-plugin fallback and C has no independent implementation.
- FactCommit or finalization failure may create a separate redacted technical log, but creates no nutrition snapshot, goal, daily progress, receipt, outbox success, or other dietary business object.
- The five protected lease files are not read, hashed, tracked, or used as inputs.
- Existing CONTRACT-v2 documents and the frozen source registry outrank this schema. Any contradiction fails the candidate instead of silently reinterpreting the contracts.

## Completion boundary

Completion requires missing-file RED, semantic mutation RED, final fixture GREEN, Parser/ASCII/JSON checks, no protected or business-data candidates, independent semantic review, private GitHub delivery, and independent-clone reproduction. It does not mean SQLite, nutrition lookup, progress rendering, OpenClaw integration, or an installable product exists.
