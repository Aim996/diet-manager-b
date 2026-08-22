# X-GATE-001 Work-Item Brief

## Identity

- task_id: `X-GATE-001`
- milestone: `M3`
- type: `B-only G1 storage safety gate`
- status: `complete`
- product_line: `B only`
- owner: `Codex /root as gate host`
- reviewer: `OpenClaw 02 bounded independent gate review`
- dependencies: `B-STOR-001`, `B-MERGE-C-001`, `B-STOR-002`
- evidence inputs: `EV-20260812-027`, `EV-20260812-028`, `EV-20260812-029`
- completion evidence: `EV-20260812-030`
- roots: `ROOT-SHARED`, `ROOT-B`

## Objective

Decide whether the completed B storage/bootstrap, server preview authority and atomic repository evidence are sufficient to enter `B-SLICE-001`. This task is a gate, not a feature implementation task.

It must produce exactly one outcome:

- `pass_b_safety`: B may begin the minimal vertical product slice; or
- `return_to_b_storage`: identify the precise failed Oracle and reopen only the responsible B storage task.

## Scope

- verify the three B evidence packages refer to an exact, compatible stacked history;
- verify failure-zero-business-row, signed preview/state authority, transaction atomicity, concurrency, restart and cleanup evidence are fresh;
- execute only the deterministic B/common gates permitted by the frozen safety boundary;
- confirm official data roots are not opened and all tests use test-owned roots;
- confirm the public Skill remains non-writing and no installation/product-readiness claim is made;
- record an exact gate decision and next-task disposition.

## Non-goals

- no new repository feature, migration or schema change;
- no parser/model, nutrition, correction, progress, receipt or installer implementation;
- no A/C product comparison or scoring;
- no OpenClaw model usage during ordinary local verification;
- no `selected-route-map` creation (that belongs to `X-GATE-002`).

## Completion Oracle

- dependency commits and EV-027/028/029 are exact and mutually compatible;
- the frozen B package tests, transaction concurrency harness, OpenClaw local build/validate and traceability validation pass;
- every required G1 case has current accepted evidence or a deterministic executable Oracle without borrowing A/C results;
- protected/official roots, credentials, real dietary data and test residuals remain untouched/zero;
- an independent reviewer reports no P0/P1 in the gate reasoning;
- the decision is recorded as `pass_b_safety` or `return_to_b_storage` with one exact next action.

## Reopen conditions

Reopen when any dependency implementation/evidence changes, a required G1 case loses fresh evidence, the protected/official-root boundary changes, or the gate decision is contradicted by a later deterministic test.

## Final result

`pass_b_safety`; only `B-SLICE-001` is authorized next. This does not claim G2/G3, installation or product readiness.

## Machine traceability

case_assertion_paths:
  CASE-STORAGE-001:
    - /cases/CASE-STORAGE-001/atomic_fact_and_idempotency
  CASE-STORAGE-002:
    - /cases/CASE-STORAGE-002/precommit_failure_zero_business_rows
  CASE-STORAGE-004:
    - /cases/CASE-STORAGE-004/fixed_private_root_and_nonwriting_entry
  CASE-STORAGE-005:
    - /cases/CASE-STORAGE-005/restart_migration_and_backup_integrity
  CASE-STORAGE-006:
    - /cases/CASE-STORAGE-006/response_loss_exact_replay
  CASE-STORAGE-007:
    - /cases/CASE-STORAGE-007/transition_and_finalizer_atomicity
  CASE-EFFECT-003:
    - /cases/CASE-EFFECT-003/pending_retry_and_exactly_once_effect
  CASE-FOUNDATION-002:
    - /cases/CASE-FOUNDATION-002/nonwriting_public_entry_and_zero_residual
  CASE-INVENTORY-007:
    - /cases/CASE-INVENTORY-007/nonnegative_insufficient_stock
  CASE-PURCHASE-001:
    - /cases/CASE-PURCHASE-001/atomic_batch_add
  CASE-QUERY-003:
    - /cases/CASE-QUERY-003/reopen_projection_query
  CASE-INVENTORY-001:
    - /cases/CASE-INVENTORY-001/add_deduct_projection
  CASE-INVENTORY-004:
    - /cases/CASE-INVENTORY-004/revision_bound_inventory_fact
full_case_set: G1_COMMON_B_ONLY
