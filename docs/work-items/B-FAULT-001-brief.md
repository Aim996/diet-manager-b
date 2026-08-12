# B-FAULT-001 Work-Item Brief

## Identity

- task_id: `B-FAULT-001`
- milestone: `M3`
- type: `B fault authority`
- product_line: `B only`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `pending independent review`
- requirements: `REQ-SAFE-002`, `REQ-SAFE-003`, `REQ-PROGRESS-002`, `REQ-PROGRESS-004`
- cases: `CASE-EFFECT-001`, `CASE-EFFECT-002`, `CASE-EFFECT-003`, `CASE-STORAGE-005`, `CASE-STORAGE-006`, `CASE-STORAGE-007`, `CASE-INVENTORY-006`
- roots: `ROOT-B`

## Objective

Freeze the seven-case, eighteen-row B fault authority as `diet-manager/b-fault-matrix/v1`. The matrix fixes each distinct write point, error code, failed/outbox state and attempt/reason, complete persistent observation vector, restart expectation, same-token retry boundary, redacted diagnostic constraint, frozen-result rule, forbidden outcome and assertion path. Its SHA-256 in the harness manifest binds the exact bytes used by future executable fault work.

## Frozen correction

`CASE-EFFECT-003` fails at `EnvelopeFinalize` only after all child effects are durable. Its envelope state is therefore `effects_stable`, including after restart. A same-token retry may finalize once, but may not re-run a completed effect.

The exact row order is 1 `after_nutrition`, 3 late EffectBundle rows, 4 finalizer rows, 5 migration/open rows, 1 response-loss row, 3 idempotency-conflict rows and 1 stale-preview row. Each row declares the complete observation vector and requires `stage`, `error_code`, `trace_id`, `input_digest` plus the four forbidden diagnostic content categories.

## Scope boundaries

- `CASE-EFFECT-002` is a structured expression of the already-planned late EffectBundle rollback boundary; it is not an executable catalog case yet.
- `CASE-STORAGE-005` proves only the current migration publish-or-reject boundary, not a full upgrade or backup-restore product.
- `CASE-INVENTORY-006` proves only stale preview/revision rejection after a real inventory candidate change, not a complete IssueResolution interaction.
- No production adapter, migration, dependency, public fault API, installer or release flow is added by this authority-freezing task.

## Verification commands

```powershell
& $nodeExe --test shared/acceptance-cases/tests/b-fault-matrix.test.ts
& $nodeExe shared/tests/validate-traceability.mjs --self-test
```

## Machine traceability

case_assertion_paths:
  CASE-EFFECT-001:
    - /oracle/failure
    - /oracle/state_after_restart
    - /oracle/same_key_retry
    - /forbidden
  CASE-EFFECT-002:
    - /effect_bundle/late_failure_full_rollback
    - /restart/effects_pending
    - /same_token_retry/missing_effect_only
    - /forbidden
  CASE-EFFECT-003:
    - /oracle/failure
    - /oracle/state_after_restart
    - /oracle/same_key_retry
    - /forbidden
  CASE-STORAGE-005:
    - /migration/failure_keeps_final_unpublished
    - /migration/failure_keeps_user_version_unadvanced
    - /scope_limitation
  CASE-STORAGE-006:
    - /oracle/original_result
    - /oracle/later_unrelated_write
    - /oracle/same_key_retry
    - /forbidden
  CASE-STORAGE-007:
    - /oracle/idempotency/conflicts
    - /oracle/idempotency/business_write_count
    - /forbidden
  CASE-INVENTORY-006:
    - /preview/data_revision_stale_zero_write
    - /preview/caller_state_untrusted
    - /scope_limitation
full_case_set: none
