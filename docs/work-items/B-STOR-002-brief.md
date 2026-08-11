# B-STOR-002 Work-Item Brief

## Identity

- task_id: `B-STOR-002`
- milestone: `M3`
- type: `B-only transaction repository`
- product_line: `B only`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `one bounded independent B repository review after candidate freeze`
- requirements: `REQ-SAFE-002`, `REQ-SAFE-003`, `REQ-PANTRY-004`
- cases: `CASE-STORAGE-001`, `CASE-STORAGE-002`, `CASE-STORAGE-006`, `CASE-STORAGE-007`, `CASE-EFFECT-003`, `CASE-INVENTORY-007`, `CASE-PURCHASE-001`, `CASE-QUERY-003`, `CASE-INVENTORY-001`, `CASE-INVENTORY-004`
- roots: `ROOT-B`

## Objective

Implement the B-only SQLite repository that turns an already persisted server preview into durable facts, retryable effects and authoritative inventory projections. A failed `FactCommit` may emit one redacted technical diagnostic outside SQLite, but it must leave every new dietary/business row absent. An effect or response failure after a successful fact commit must never duplicate the fact and must be recoverable after restart.

This task is repository infrastructure. It does not make the OpenClaw Skill user-facing and it does not implement nutrition, correction, progress or receipt UX early.

## Dependencies

- `B-STOR-001` — `EV-20260812-027`
- `B-MERGE-C-001` — `EV-20260812-028`
- `SH-MAP-001` — `EV-20260811-020`
- `SH-HARNESS-001` — `EV-20260812-025`
- `SH-TRACE-001` — `EV-20260812-026`

All dependencies are complete at task start.

## Selected approach

Use one internal B repository with the three transaction boundaries already frozen by the business contract:

1. `FactCommit` verifies the server preview inside `BEGIN IMMEDIATE`, inserts one event, its minimal meal items and durable effect outbox rows, advances the envelope through the legal states to `effects_pending`, and commits once.
2. `EffectBundle` claims one pending effect and atomically applies the corresponding inventory mutation/projection or records a retryable/business-skip outcome. A failed effect never erases the committed fact.
3. `EnvelopeFinalize` remains deferred to the later business slice because receipts, progress and mixed-item final results are not implemented in this storage milestone.

Repository inputs are strict prepared DTOs. They carry deterministic IDs and canonical payloads produced by a future domain service; they are not raw model output and cannot report their own envelope state or data revision.

## Physical data boundary

- tests use only fresh GUID-named direct children of the system temporary directory;
- the official B data root is never opened by repository tests;
- test facts use synthetic neutral identifiers and never real food names, raw chat, credentials or official data;
- the SQLite database is the only business authority;
- technical failure diagnostics use an injected non-database sink and contain only phase, stable error code, trace ID and input digest;
- a diagnostic sink failure cannot commit, roll back or alter a business transaction;
- `FactCommit` failure leaves the pre-existing preview control rows unchanged and adds zero `event_records`, `meal_items`, `effect_outbox`, inventory, projection, finalization or result rows.

## Deliverables

- `version-b-lite-plugin/src/repository/fact-commit.ts`
- `version-b-lite-plugin/src/repository/inventory-effects.ts`
- `version-b-lite-plugin/src/repository/query.ts`
- narrow additions to the preview authority needed for transactional replay
- `version-b-lite-plugin/tests/repository.test.ts`
- design, plan, implementation report, independent review, evidence and progress/trace updates

## Frozen behavior

### FactCommit

- validate and clone the whole prepared request before opening a transaction;
- start `BEGIN IMMEDIATE`, re-check exact migration authority and server preview binding inside that transaction;
- exact first commit inserts one event, ordered items and one unique outbox row per effect;
- update the existing envelope using server-read compare-and-set transitions `received → facts_committed → effects_pending`;
- update the existing idempotency row to the matching nonterminal state while keeping `terminal_result_json = NULL`;
- commit once and return a frozen result derived from authoritative rows;
- any validation, authority, SQL, foreign-key, constraint or injected pre-commit failure rolls back every new business row;
- after rollback, a best-effort redacted diagnostic may be emitted outside SQLite;
- an injected response loss after `COMMIT` throws to the caller but leaves one complete fact; an exact retry reconstructs the same result without a second insert;
- same key with a changed digest, subject, command, preview or deterministic fact identity fails with `IDEMPOTENCY_CONFLICT` and zero new writes.

### EffectBundle and inventory projection

- process only durable `pending` or `retryable_failed` outbox work;
- use server-read state and the frozen effect transition guard;
- add-inventory creates/validates product and batch authority, writes one inventory transaction and one current projection atomically;
- deduction locks the referenced projection in the same transaction, refuses insufficient stock, never writes a negative quantity and records no inventory transaction on refusal;
- successful effect writes one `effect_bundle_commits` row and advances the outbox state exactly once;
- retry after response loss or restart observes the committed effect and returns it without repeating inventory mutation;
- projection queries read only committed projection rows and remain identical after closing/reopening the database.

### Recovery and concurrency

- WAL plus `BEGIN IMMEDIATE` serializes competing commits;
- two connections racing the same idempotency key produce one fact and one replay, or one fact and one stable conflict for different input;
- a transaction abandoned before commit is invisible after restart;
- pending effects remain discoverable after restart;
- quick-check, foreign-key-check and migration identity remain valid after every fault case;
- repository tests do not execute the OpenClaw model, Node child tools or official data paths.

## Completion Oracle

- first fact commit produces exact table deltas and a valid `effects_pending` envelope;
- prepare-before-commit fault produces a separate redacted log and zero new business rows;
- technical-log failure still produces zero new business rows and preserves the primary error;
- response-loss retry and restart retry return the original deterministic fact with no duplicate row/effect;
- same-key/different-input concurrency returns conflict with no mutation;
- purchase projection survives restart; deduction cannot make quantity negative;
- insufficient inventory produces no inventory transaction or projection mutation;
- pending effect recovery is deterministic and exactly-once;
- all focused and existing B tests, TypeScript build and package build pass;
- no protected path, official data root, credential or test-platform token is read, changed or committed.

## Out of scope

- parser/model-to-prepared-command conversion;
- user-facing preview/confirmation conversation;
- nutrition source lookup and nutrition snapshots;
- correction, undo, daily progress, final receipts and mixed-item finalization;
- OpenClaw/MCP/Skill runtime wiring;
- backup/export product UX or migration v2;
- any A/C product implementation.

## Reopen conditions

Reopen when migration v1, storage mapping, server-preview binding, transaction-stage contract, inventory projection payload, idempotency identity, state graph or SQLite runtime changes.

## Machine traceability

case_assertion_paths:
  CASE-STORAGE-001:
    - /fact_commit/exact_retry_one_fact
    - /effect/exact_retry_one_mutation
  CASE-STORAGE-002:
    - /fact_commit/precommit_fault_zero_business_rows
    - /fact_commit/technical_log_outside_database
  CASE-STORAGE-006:
    - /recovery/response_loss_replays_authoritative_fact
    - /recovery/restart_pending_effect
  CASE-STORAGE-007:
    - /idempotency/same_key_changed_input_conflict_zero_write
  CASE-EFFECT-003:
    - /effect/failure_preserves_fact_and_pending_work
  CASE-INVENTORY-007:
    - /inventory/deduction_never_negative
  CASE-PURCHASE-001:
    - /inventory/add_batch_projection
  CASE-QUERY-003:
    - /query/projection_stable_after_restart
  CASE-INVENTORY-001:
    - /inventory/current_projection_matches_committed_transactions
  CASE-INVENTORY-004:
    - /inventory/insufficient_stock_zero_mutation
full_case_set: none
