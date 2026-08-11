# SH-MODEL-001 Brief

## Objective

Freeze the shared `core-model/v1` schemas required by `REQ-EVENT-001`, `REQ-MEAL-002`, `REQ-PRODUCT-001`, `REQ-PANTRY-004`, and `REQ-CORE-002`, with fixed coverage for `CASE-CORR-001`, `CASE-MEAL-003`, `CASE-PURCHASE-007`, `CASE-INVENTORY-005`, and `CASE-RECEIPT-002`.

## Normative inputs

- `总功能开发计划0.3.md` §§6.2–6.4, 11.1–11.14, 20.5, 31.4.
- `shared/business-contract.md` §§4–8.
- `shared/contracts/receipt-and-date-contract.md` §2.
- `shared/contracts/issue-correction-contract.md` append-only correction boundaries.
- `shared/policies/decision-thresholds.json` only for B-only/no-score and reminder-not-safety compatibility.

## Deliverables

- `shared/schemas/event-and-amount.schema.json`
- `shared/schemas/product-inventory.schema.json`
- `shared/tests/fixtures/core-model-cases.json`
- `shared/tests/validate-core-model-schemas.ps1`
- design, implementation plan, report, independent review package/review, and EV-017.

## Required identities

- event schema `$id = https://diet-manager.local/schemas/event-and-amount/v1`
- inventory schema `$id = https://diet-manager.local/schemas/product-inventory/v1`
- draft = `https://json-schema.org/draft/2020-12/schema`
- fixture set id = `diet-manager/core-model-cases/v1`
- schema version = `1.0.0`

## Required definitions

Event schema: `DecimalString`, `OccurredTime`, `Amount`, `EventEnvelope`, `MealItem`, `MealEvent`.

Inventory schema: `ConfirmedAlias`, `FieldProvenance`, `ProductIdentity`, `InventoryBatch`, `InventoryBatchProjection`, `InventoryTransaction`.

## Required invariants

1. Only already-completed facts may use the committed event envelope.
2. `event_type`, `result_status`, and `lifecycle_status` are separate; a generic `status` field is forbidden.
3. All persisted decimal quantities are canonical strings; JSON numbers are rejected.
4. OccurredTime preserves interval/precision/source; only exact precision may carry `resolved_occurred_at`.
5. `MealItem` has four separate amount properties: stated, nutrition, inventory, and package/specification. Unknown values remain null or `kind=missing`, never invented defaults.
6. ProductIdentity, NutritionProfile identity, InventoryBatch facts, and current batch projection remain distinct.
7. Long-term aliases require explicit user confirmation evidence; transient references cannot be persisted as confirmed aliases.
8. InventoryBatch contains only immutable creation-time facts and cannot contain current remaining/location/open/expiry/lifecycle fields.
9. InventoryBatchProjection is rebuildable and carries current state; unknown quantity is not zero.
10. InventoryTransaction uses decimal before/delta/after with exact arithmetic, nonnegative after, and sign/direction/event coherence.
11. `inventory_gift_received` is positive/inflow; `inventory_gifted_out` and vendor returns are negative/outflow; stock returns are positive/inflow; opening is neutral/zero.
12. Partial deduction requires explicit authorization tied to the current source message and target batch/event.
13. Purchase, production, stock, receive, occur, and commit time meanings are not collapsed.
14. FactCommit failure may be recorded only in a separate technical log; no object in these schemas is created for a failed business commit.

## Stable loader/validation errors

- `MODEL_SCHEMA_FILE_MISSING`
- `MODEL_FIXTURE_FILE_MISSING`
- `MODEL_JSON_INVALID`
- `MODEL_SCHEMA_IDENTITY_INVALID`
- `MODEL_SCHEMA_SHAPE_INVALID`
- `MODEL_SCHEMA_HASH_INVALID`
- `MODEL_FIXTURE_COVERAGE_INVALID`
- `MODEL_CASE_RESULT_INVALID`
- `MODEL_MUTATION_NOT_REJECTED`

## Exclusions

- no database, migration, repository, SQL, business record, route map, notification scheduler, runtime adapter, or product deployment;
- no Nutrition/Profile/Progress or Issue/Correction/Mixed schema from SH-MODEL-002/003;
- no three-route score/weight/winner semantics;
- no generic category shelf-life or food-safety judgment;
- no access to the five protected lease files.

## Completion

The task closes only when the fixed fixture set and mutations pass, an independent semantic reviewer accepts the frozen files, GitHub delivery is reproducible from an independent clone, protected tracked files remain zero, and business data candidates remain zero.
