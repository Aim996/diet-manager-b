# SH-CASE-002 Domain and Failure Acceptance Cases Design

> Date: 2026-08-11
>
> Status: approved by DOC-0.3 scope and the user's standing instruction to continue with the recommended B-only plan
>
> Product line: B only

## Goal

Extend the single shared acceptance catalog from five core cases to fourteen cumulative cases by adding exactly these nine domain and failure cases:

- `CASE-PURCHASE-001`
- `CASE-INVENTORY-003`
- `CASE-NUTR-001`
- `CASE-ISSUE-001`
- `CASE-CORR-001`
- `CASE-MIXED-001`
- `CASE-EFFECT-001`
- `CASE-EFFECT-003`
- `CASE-STORAGE-007`

The task freezes deterministic inputs, pre-state, expected state transitions, failure behavior, restart/retry results and forbidden outcomes. It does not create SQLite, implement a repository, execute a B adapter, inject a real runtime failure or claim an installable product.

## Approaches considered

### Separate domain case catalog

A new `domain-cases-v1.json` would reduce edits to the existing core package, but it would create a second Oracle root. Future adapters could accidentally select one file, merge them differently or rewrite one catalog. This conflicts with the single-Oracle decision from `SH-CASE-001`.

### Cumulative catalog with one fixture catalog — selected

`shared/acceptance-cases/cases.json` remains the only case catalog and advances from `1.0.0` to `1.1.0`. The existing first five cases remain byte-for-byte equivalent at the JSON value level; nine new ordered cases are appended. `fixtures/core-v1.json` remains the sole fixture catalog, advances to `1.1.0`, and gains one `domain_scenarios` collection containing nine fixed scenarios.

This keeps one source of truth, preserves the completed five-case semantics, gives every new case one explicit scenario reference and avoids introducing a database or adapter seam.

### Database-executable cases now

Encoding these scenarios as SQL or repository tests would provide runtime coverage earlier, but `SH-HARNESS-001`, `SH-TRACE-001` and B storage gates have not been completed. It would invert dependencies and risk turning fixture data into a premature implementation. This approach is rejected.

## Canonical structure

### Case catalog

The root retains the exact properties `case_set_id`, `version`, `contract`, `fixture_catalog`, `package_invariants` and `cases`. The case-set ID remains `diet-manager/core-acceptance-cases-v1`; the version becomes `1.1.0`. The first five IDs stay first and unchanged, followed by the nine IDs in the order listed above.

Every new case uses the same exact top-level shape as the core cases:

```text
id, requirement_ids, stage, source_text, setup, oracle, forbidden
```

Each new `setup` references the existing fixed environment and exactly one `domain_scenario_fixture`. Goals are referenced only when the case needs finalized progress. Expected values are literals in the case and fixture files; they are never copied from a candidate adapter result.

### Fixture catalog

The fixture root retains `fixture_catalog_id`, `version`, `environments`, `goals` and `query_views`, and appends `domain_scenarios`. The first three fixture objects remain semantically unchanged. The nine scenario IDs are:

```text
domain-purchase-milk-2x12x250-v1
domain-inventory-multiple-products-v1
domain-nutrition-label-milk-v1
domain-issue-amount-inventory-v1
domain-correction-eggs-2-to-3-v1
domain-mixed-purchase-drink-v1
domain-effect-nutrition-failure-v1
domain-finalizer-failure-concurrent-v1
domain-idempotency-conflict-v1
```

Each scenario owns only test data: product/package facts, active inventory rows, nutrition label/profile evidence, Issue pre-state, correction target, ordered mixed operations, failure injection point, pre-state digest, concurrent contribution and frozen idempotency record. It does not materialize any business database.

## Case Oracle

### Purchase and inventory

`CASE-PURCHASE-001` records two boxes, twelve cartons per box and 250 ml per carton as four independent facts: outer count `2 box`, inner count `24 carton`, total capacity `6000 ml` and formula `2*12*250`. It creates one inventory-stocked event and one batch. The implementation may not collapse the values into only one total or invent an expiry date.

`CASE-INVENTORY-003` starts with two different milk products that are both plausible matches. The matching result is `multiple`, the occurred meal fact still commits, and the inventory impact is `skipped_ambiguous`; quantities remain unchanged and one `inventory_multiple_candidates` Issue is created. The system may not choose either product automatically, create negative inventory or turn the ambiguity into a failed FactCommit.

### Nutrition and Issue

`CASE-NUTR-001` binds an exact package label to one product variant. The label tier wins; raw label values, parsed values, profile version, source identity and applicable product are retained. The resulting intake snapshot references that frozen profile version. No public database may override the exact label and unknown label fields remain unknown rather than zero.

`CASE-ISSUE-001` combines a bounded quantity estimate with multiple inventory candidates. The recognizable meal fact commits with `committed_with_issues`; the inventory impact is `skipped_ambiguous`; `quantity_estimated` and `inventory_multiple_candidates` are stored as two ordered, non-blocking Issues and presented once in one consolidated prompt. The adapter may not ask a serial questionnaire, discard the meal or claim the inventory was deducted.

### Correction and mixed operation

`CASE-CORR-001` changes a prior two-egg meal to three eggs through one append-only CorrectionEvent. The original event remains auditable, the effective view becomes three eggs, the nutrition delta is one egg, the applicable inventory effect requests one additional egg and the affected day is recalculated. A retry with the same child idempotency key does not append another correction or repeat the inventory effect.

`CASE-MIXED-001` processes “buy one box of milk and drink one carton” in narrative order. The purchase commits before the meal, the meal matches the newly stocked product, and the inventory state moves from 0 to 24 and then to 23 cartons. The result contains two ordered child statuses and one envelope-level finalization; failure of a later independent child must not roll back the earlier committed child.

### Failure isolation and idempotency

`CASE-EFFECT-001` injects a nutrition-snapshot write failure after FactCommit. The meal fact and durable outbox remain, the EffectBundle writes no partial nutrition/inventory/Issue/projection state, the envelope remains `effects_pending`, the failed effect is retryable, and there is no success receipt or authoritative progress. Restart sees the same fact and pending effect; same-key retry completes only the missing effect and finalization.

`CASE-EFFECT-003` injects a failure at the finalizer write boundary after all child effects are stable while another request has committed a projection contribution. The complete EnvelopeFinalize layer rolls back, the envelope stays `effects_pending`, no receipt/progress/terminal idempotency result is visible, and facts/effects remain. Same-key retry finalizes exactly once: `current_turn_increments` contain only this envelope, while frozen committed totals use the successful finalization snapshot and may include the concurrent request.

`CASE-STORAGE-007` starts from a frozen terminal idempotency record and tests three conflicts using the same key: changed input digest, changed subject scope and changed command type. Every conflict returns `failed/idempotency_conflict`, performs zero business writes and does not return the old frozen result as if it belonged to the new request.

## Validator boundaries

A new ASCII Windows PowerShell 5.1 validator, `shared/tests/validate-domain-acceptance-cases.ps1`, owns independent literals for the nine new case IDs, scenario IDs, requirement links and case-specific Oracle. It requires exactly fourteen cumulative cases and twelve cumulative fixture objects: one environment, one goal version, one query view and nine domain scenarios.

The existing `validate-core-acceptance-cases.ps1` is updated only after the domain validator has produced the expected RED. It continues validating the original five cases and eight mutations, but accepts the registered nine-case suffix and catalog version `1.1.0`. It must still reject changes to any original core value and unknown/duplicate IDs.

The domain validator includes at least these anti-weakening mutations:

1. drop a required domain case;
2. collapse package quantities to only total ml;
3. auto-select one of multiple products;
4. let public nutrition override the exact label;
5. serialize the two Issues as repeated prompts;
6. overwrite the original meal during correction;
7. reorder mixed children;
8. roll back the fact after EffectBundle failure;
9. expose success progress after finalizer failure;
10. reuse the old frozen result for an idempotency conflict;
11. allow a failed FactCommit to create a business artifact.

## Data and error flow

```text
DOC-0.3 + frozen contracts/schemas
            |
            v
one cumulative fixture catalog ---> one cumulative case catalog
            |                              |
            +--------------+---------------+
                           v
           core validator + domain/failure validator
                           |
                           v
              future SH-HARNESS-001 B adapter
```

Invalid JSON, unknown properties, duplicate IDs, missing fixture references, wrong requirement links, non-literal Oracle weakening, partial-write expectations or forbidden success artifacts fail closed. Fault cases include the DOC-0.3 fields `failure_injection_point`, `pre_state_hash`, `expected_error_code`, `should_rollback`, `post_state_hash`, `state_after_restart`, `same_key_retry_result` and `official_business_data_diff`.

## Compatibility and deferred work

- The first five case values and their three referenced fixtures remain unchanged.
- The completed `SH-CASE-001` evidence remains historical evidence for catalog `1.0.0`; the core validator proves those values did not drift in `1.1.0`.
- The `nutritious_drink` to Schema `nutrition_drink` mapping remains explicit future harness work and cannot be hidden inside the case catalog.
- Exact receipt prose and cross-day golden text remain `SH-CASE-004`.
- Runtime execution, SQL transactions, restart testing and real failure injection remain `SH-HARNESS-001`, B storage and B fault tasks.
- Installation, migration, privacy, backup and deletion cases remain `SH-CASE-003`.

## Completion evidence

Completion requires:

- exact cumulative 14-case order and exact nine domain scenario IDs;
- all original five cases and three original fixtures semantically unchanged;
- focused domain validator GREEN and at least eleven mutation rejections;
- original core validator and six frozen contract/model validators passing;
- strict JSON, Parser/ASCII/CR/NUL, protected-delta and zero-business-data gates;
- independent review with P0=0/P1=0 using an independently written checker;
- private GitHub push and clean independent-clone reproduction.
