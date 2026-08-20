# SH-MODEL-001 Core Event and Inventory Model Design

## Goal

Freeze the shared JSON model for Event, Amount, Product, immutable InventoryBatch facts, rebuildable InventoryBatchProjection, and InventoryTransaction before any production SQLite table is created.

## Scope

This task creates two JSON Schema documents, one fixed positive/negative fixture set, one Windows PowerShell 5.1 validator, and completion evidence. It does not create a repository, migration, database, business record, route map, or runtime adapter.

## Model boundaries

### Event and time

`EventEnvelope` carries stable identity, original user text/message/conversation, receive/commit times, `OccurredTime`, schema version, provenance, fact kind, lifecycle, and transaction result. `OccurredTime` preserves raw text, start/end, precision, timezone, resolution basis/anchor, and resolver version. Only exact precision may expose the compatibility point `resolved_occurred_at`.

Lifecycle is only `active/superseded/voided`. Transaction result is only `committed/failed`. Business action remains in `event_type`; no generic `status` property may collapse these dimensions.

### Amount and MealItem

All decimal quantities are canonical decimal strings, never JSON floating-point values. `Amount.kind` is one of `exact/approximate/range/vague/missing` and its numeric members are conditional on that kind.

Each `MealItem` has four distinct properties: stated intake, nutrition calculation amount, actual inventory effect amount, and package/unit specification. The last three may be unknown, but they may not be omitted or silently copied from stated intake. Committed effects live outside the item; the item holds only effect intent and known input.

### Product and inventory

`ProductIdentity` is a durable identity, separate from nutrition profiles and actual batches. Raw names, normalized name, brand, variant, form, barcode/SKU, package specifications, confirmed aliases and evidence remain separate. An alias requires explicit confirmation evidence.

`InventoryBatch` is immutable creation-time fact. It must not contain remaining quantity, current location, opened state, expiry state, lifecycle state, or any other mutable projection field.

`InventoryBatchProjection` contains current remaining amount/location/seal/expiry/effective state, open Issue IDs, last event and verification timestamps. Unknown quantity is represented as `Amount.kind=missing`, not numeric zero.

`InventoryTransaction` inherits `EventEnvelope`, identifies product and batch, and stores before/delta/after in one unit. Inflow delta is positive, outflow negative, neutral zero; `before + delta = after`; after is nonnegative. Gift received/out, vendor return, stock return, consumption, discard, adjustment, depletion, opening and correction compensation have distinct event/reason semantics. Partial deduction requires current-message explicit authorization.

## Validation architecture

- `shared/schemas/event-and-amount.schema.json` is normative for Event/Time/Amount/Meal.
- `shared/schemas/product-inventory.schema.json` is normative for Product/Batch/Projection/Transaction and references the first schema.
- `shared/tests/fixtures/core-model-cases.json` contains fixed full-object positive and negative cases.
- `shared/tests/validate-core-model-schemas.ps1` pins schema identities/hashes/required definitions and independently evaluates semantic invariants that JSON Schema cannot express, including decimal arithmetic and sign/event coherence.

The validator must not derive expected case IDs or expected outcomes from the schemas. Stable expected IDs and error codes are test-owned literals.

## Safety and compatibility

- Only route B will later write these objects, but the model itself is shared and route-neutral.
- FactCommit failure remains zero business data; technical failure logs are outside these schemas.
- The five protected lease files are unavailable and are not inputs to this task.
- Existing CONTRACT-v2 documents outrank these schemas if a contradiction is found; the task must fail and revise the candidate rather than reinterpret the contracts.

## Completion boundary

Completion requires missing-file RED, semantic mutation RED, final fixture GREEN, Parser/ASCII checks, independent semantic review, private GitHub delivery, and independent clone validation. Completion does not mean a business database or installable Skill exists.
