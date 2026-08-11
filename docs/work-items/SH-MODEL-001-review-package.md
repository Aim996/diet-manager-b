# SH-MODEL-001 Independent Review Package

## Review objective

Independently decide whether the frozen SH-MODEL-001 candidate is a complete, contract-consistent shared model for Event/Amount/Product/Inventory, without trusting validator GREEN or candidate descriptions.

## Frozen inputs

| File | SHA-256 |
|---|---|
| `shared/schemas/event-and-amount.schema.json` | `FD5F2B44C5AC1B8295F54774AA3425DD2DB4BA16915111A3E1B241104CEE47CA` |
| `shared/schemas/product-inventory.schema.json` | `681551FA18759AE3F993B0951C3A650FA8ABE16B28D7A9E7223E24F5E9B6613F` |
| `shared/tests/fixtures/core-model-cases.json` | `3FF78E234D063E86294143BD2D91765E96E6569D53704EECEE4A83F29945AA39` |
| `shared/tests/validate-core-model-schemas.ps1` | `486CF6D9783E8FF750115EF49C9C2CA7F6DF3B0C2D608310E490B06B8E30120C` |
| `docs/work-items/SH-MODEL-001-brief.md` | `0EF9430399A696B9F43C946E997C41DBC08769816E42D0030E413A28A571A1B6` |
| `docs/work-items/SH-MODEL-001-report.md` | `AF3A304EE87D2C855A9CB2A16CA41FAAEB11BA59AF107DE7BFC02CA216CFFC8A` |

## Required independent checks

1. EventEnvelope keeps event type, transaction result and lifecycle separate; generic status is impossible in public leaf objects.
2. OccurredTime preserves exact/range/unknown semantics and never fabricates a point for date/meal-period/approximate/unknown precision.
3. Decimal quantities are canonical strings, with no JSON floating-point storage or invented default amount.
4. MealItem materially separates stated, nutrition, inventory and package amounts; committed effects are not embedded into immutable fact input.
5. ProductIdentity, nutrition profile identity, InventoryBatch and InventoryBatchProjection have non-overlapping ownership; confirmed aliases require evidence.
6. InventoryBatch contains no mutable projection field and still represents “one bag, inner count unknown” correctly.
7. Projection represents unknown quantity as unknown rather than zero and retains current location/open/expiry/effective state plus Issue/event references.
8. InventoryTransaction inherits all EventEnvelope facts, enforces decimal before/delta/after and nonnegative after, and distinguishes stocked/gift/return/vendor return/consume/discard/open/adjust/correction semantics.
9. Partial deduction authorization is scoped to the current explicit message and related event/batch; no inherited authorization exists.
10. Product and batch field provenance is actually required and distinguishes explicit, label, manufacturer, confirmed rule, deterministic rule, evidence-backed model and unknown sources.
11. The 41 case IDs and four mutations are independent and sufficient; identify any important missing at-boundary/negative case.
12. Determine whether exact schema-byte pinning plus static shape checks plus the semantic evaluator is sufficient, or whether absence of a real JSON Schema runtime makes completion unsafe.
13. Confirm consistency with CONTRACT-v2, receipt/date v2, issue/correction v2 and decision policy v1.
14. Confirm no protected lease, business database, route map, G1/G2 or product-readiness claim is present.

## Known scope limits

- Nutrition/Profile/Progress and Issue/Correction/Mixed schemas belong to SH-MODEL-002/003.
- SQLite mapping and runtime validators belong to later tasks.
- A later route-neutral runtime validator must execute standard draft 2020-12 validation plus the cross-field semantic rules; this freeze does not claim production write-boundary enforcement.
- No notification, shelf-life safety judgment, medical advice or installable Skill is in scope.
- The five protected lease files are unavailable and must not be requested.

## Response contract

First line exactly `PASS` or `FAIL`.

Then provide blocking findings, a result for each of the fourteen checks, and any required test/schema correction. Do not grant PASS merely because hashes or the local validator pass.

Explicitly state whether SH-MODEL-001 can close without a third-party JSON Schema runtime and why.

Final line exactly one of:

```text
Ready for SH-MODEL-001 completion: Yes
```

```text
Ready for SH-MODEL-001 completion: No
```
