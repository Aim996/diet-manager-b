# SH-MODEL-003 Issue, Correction, and Mixed Result Model Design

## Goal

Freeze one route-neutral JSON model for Issue lifecycle data, append-only Issue resolution and correction events, the three-stage transaction envelope, durable effect outbox state, ordered mixed-operation results, and terminal receipt data before any production SQLite mapping or B runtime implementation begins.

## Scope

This task creates one JSON Schema 2020-12 document, one fixed positive/negative fixture corpus, one dependency-free Windows PowerShell 5.1 validator, and detailed work-item/review/evidence documents. It does not create SQLite tables, migrations, repositories, runtime transaction code, technical-log storage, an OpenClaw or MCP adapter, a renderer, production business data, or an installable Skill.

The schema is shared and route-neutral. Route B remains the only future product writer. The portable Skill and all OpenClaw, MCP, or other agent integrations are thin callers and renderers of the frozen B result.

## Chosen architecture

Use one schema with identity:

```text
https://diet-manager.local/schemas/issue-correction-mixed/v1
```

The document contains strict public definitions grouped into three layers:

1. **Business facts and append-only audit**: `Issue`, `IssueResolutionEvent`, `QuickPrompt`, `CorrectionSnapshot`, and `CorrectionEvent`.
2. **Transaction and recovery state**: `EffectOutboxEntry`, `FactCommitResult`, and `EffectBundleResult`.
3. **Frozen terminal output**: `ReceiptData`, `EnvelopeFinalizeResult`, `MixedItemResult`, and `MixedCommitResult`.

Supporting nested value objects remain inside their owning definition unless two or more public definitions reuse them. No second Issue, Correction, or route-specific result schema is introduced.

This single-schema approach is preferred to split schemas because Issue, Correction, stage state, and terminal result share the same envelope and idempotency invariants. It is preferred to a terminal-only schema because a terminal-only model cannot prove zero-business-data fact failure, durable effect retry, or finalizer failure without a fabricated success receipt.

## Issue and quick-resolution model

`Issue` uses only the four frozen states:

```text
open | awaiting_user | resolved | dismissed
```

It carries the 22 required contract fields, including stable identity/code/type/priority, entity and field references, discovery evidence, safe candidates/actions, status revision, presentation time, and nullable closure fields. The 23 issue codes, four issue types, four priorities, eight resolution reasons, and four resolution sources are exact enums from the v2 contract.

The schema enforces these state rules semantically:

- `open` and `awaiting_user` have no terminal resolution time/source/event; `deferred_by_user` may return an issue to `open` without creating a fifth state.
- `resolved` and `dismissed` require a resolution event, time, source, and compatible reason.
- a superseded or voided target resolves with `event_superseded`; it never creates `invalidated`.
- unresolved issues remain queryable and continue to affect coverage.

`IssueResolutionEvent` is append-only. Its application outcome is exactly `applied | no_change | rejected`. Rejected applications have a frozen rejection reason and no business effects. Technical persistence failure is not represented as a persisted resolution event.

`QuickPrompt` binds prompt identity, issue identity, two to four option IDs, source revision, generated time, and expiry. It stores no executable free-form code. Stale, conflicting, or revision-mismatched selection is rejected with zero business effects.

## Append-only correction model

`CorrectionEvent` has the exact 14 contract fields:

```text
correction_id
target_event_id
base_revision
request_id
source_text
operation
before_snapshot
change_set
after_snapshot
nutrition_delta
inventory_effects
affected_dates
created_at
timezone
```

The operation enum contains the frozen 13 operations, including `change_food_type`, `void_event`, and `restore_event`. The model has no overwrite or physical-delete operation.

`before_snapshot`, `change_set`, and `after_snapshot` are all required. Snapshot references preserve event identity, lifecycle, revision, affected item references, occurred-time reference, and content digest; they prove an append-only change without copying an unrestricted business object into this schema. `base_revision` is a positive integer checked during FactCommit. `affected_dates` is a sorted, unique, nonempty user-timezone date array.

Ambiguous target, stale revision, no-change, and concurrent conflict are represented only as command outcomes with zero new CorrectionEvent and zero effects. Same `request_id` and same input returns the original frozen result rather than adding another correction or compensation.

## Three-stage transaction model

The envelope state machine is exact:

```text
received -> fact_committed -> effects_pending -> terminal
received -> failed_fact
```

No other forward, backward, or terminal-reopen transition is valid.

### FactCommitResult

A successful `FactCommitResult` proves that the fact or CorrectionEvent, idempotency child identity, and pending effect outbox entries were committed together. It has `envelope_state=fact_committed` and references only the committed fact IDs and created outbox IDs.

A failed `FactCommitResult` has `envelope_state=failed_fact`, `result_status=failed`, and `business_writes=0`. Its exact failure branch forbids fact IDs, CorrectionEvent IDs, Issue IDs, outbox IDs, inventory effects, nutrition snapshots, progress, ReceiptData, and terminal idempotency results.

`FactCommitResult` is a command-response DTO, not a persisted dietary business row. An independent redacted technical log may exist outside this schema. It is not a dietary record, not a business object, not a success receipt, and is never embedded in `FactCommitResult`. This preserves the user's explicit rule that a write failure may produce a diagnostic log but must not produce half a dietary record.

### EffectOutboxEntry and EffectBundleResult

Outbox state is exactly:

```text
pending | processing | succeeded | retryable_failed | permanent_business_skip
```

Every entry has stable envelope/operation/effect identity, effect kind, `previous_state`, current state, attempt count, creation/update times, and a nullable stable reason. `previous_state` is null only for creation into `pending`; later updates must form one of the frozen legal transitions. `succeeded` and `permanent_business_skip` are terminal. Retry resumes only `pending` or `retryable_failed`; it never replays a succeeded effect or FactCommit.

`EffectBundleResult` freezes one operation's nutrition, inventory, Issue, and projection contribution references. A technical failure keeps the fact, returns `effects_pending`, and leaves the unfinished outbox entry retryable. A permanent business skip requires a reason and, where the contract requires one, an Issue reference; it is not reclassified as a successful physical effect.

The inventory-insufficient correction case therefore commits the corrected fact and nutrition result, preserves the prior real deduction, records the unsafe new delta as `skipped_insufficient`, creates the Issue during EffectBundle, and never permits negative inventory.

### EnvelopeFinalizeResult

`EnvelopeFinalizeResult` is the only authority that may set `envelope_state=terminal`. It atomically freezes `MixedCommitResult`, `ReceiptData`, `DailyProgressResult`, and the terminal idempotency result.

If finalization fails, the public stage result remains `effects_pending`; it has no success ReceiptData, no progress block, and no terminal idempotency result. A retry runs only the finalizer after all required effects are succeeded or permanently skipped.

## Mixed and receipt results

`MixedItemResult` stores one input child result with a stable zero-based sequence, operation identity, command type, one of the five command statuses, optional committed fact/correction references, Issue references, and a nullable stable error code. It cannot claim committed data for `needs_clarification`, `ignored`, or `failed`.

`MixedCommitResult` preserves the original child order and per-event idempotency identity. A later child failure never removes or rewrites an earlier committed child. The model does not invent a synthetic all-success state that hides partial failure.

`ReceiptData` is structured renderer input, not rendered Chinese text. It identifies the terminal envelope, committed event/correction references, actual inventory effect references, Issue references, affected dates, and finalization time. It exists only for terminal `committed` or `committed_with_issues` output.

`EnvelopeFinalizeResult` references the existing `DailyProgressResult` by absolute `$id`. Exactly one affected date requires a field-equal single-day alias; multiple dates forbid the alias. Adapters may render the frozen result but may not query old progress or recompute current-envelope increments.

## Error and retry invariants

- Failed FactCommit: zero dietary business objects; only a separate redacted technical log may be written.
- Failed EffectBundle: committed fact remains; incomplete effects remain retryable; no terminal receipt or progress.
- Failed EnvelopeFinalize: committed fact/effects remain; finalizer outputs are rolled back; state remains `effects_pending`.
- Same idempotency key and same input digest: return the frozen terminal result or resume only the unfinished layer.
- Same idempotency key and different input digest: `idempotency_conflict` and zero new business writes.
- Acknowledgement loss after terminal commit: return the byte-equivalent frozen result; never rebuild it from the current database view.
- No-change, stale, ambiguous, cancelled preview, or conflicting quick choice: zero new business writes.

## Validation architecture

- `shared/schemas/issue-correction-mixed.schema.json` defines the public model and references the existing Event/Amount and Nutrition/Progress schemas by absolute `$id` only where an existing public definition is authoritative.
- `shared/tests/fixtures/issue-correction-mixed-cases.json` contains fixed positive and negative full-object cases. Expected case IDs, order, and outcomes are test-owned literals in the validator, not copied from fixture metadata.
- `shared/tests/validate-issue-correction-mixed-schemas.ps1` pins schema/fixture identities and hashes, exact public definitions, exact enums, and semantic invariants that JSON Schema alone cannot express.

The fixed corpus must cover at least:

- all four Issue states and invalid legacy states;
- applied/no-change/rejected resolution branches and technical-failure non-persistence;
- quick-prompt expiry, conflict, and stale revision;
- valid correction, stale revision, no-change, void, restore, and cross-day correction;
- legal outbox transitions and all forbidden backward/reopen transitions;
- successful FactCommit and failed FactCommit with attempted business payload;
- EffectBundle retry and permanent business skip;
- finalizer success and finalizer failure with attempted receipt/progress;
- inventory-insufficient correction truth;
- ordered mixed success/partial failure and duplicate sequence rejection;
- same-terminal idempotency, pending-layer resume, and input conflict;
- single-day receipt/progress alias and cross-day alias prohibition.

At least four validator-owned mutations must prove that removing the failed-fact zero-business guard, accepting a forbidden outbox transition, permitting a pending success receipt, or allowing mixed-result reordering causes validation failure.

## Documentation and progress reporting

The work item maintains:

- a precise brief before implementation;
- this design and a step-by-step implementation plan;
- a report, review package, review verdict, and evidence record after implementation;
- detailed progress sections for completed work, current work, remaining work, newly added content, discovered problems, required optimization, and optional future optimization.

Progress documentation must distinguish “schema/model frozen” from “runtime/database implemented.” Completing this work item does not increase SQLite or OpenClaw integration completion.

## Safety and compatibility

- Route B remains the only future writer; no A/C production branch is created.
- The schema introduces no filesystem, Windows, Docker, OpenClaw, or MCP implementation detail.
- The five protected lease files are not read, hashed, tracked, edited, or executed.
- Tests create no `.jsonl`, `.sqlite`, `.sqlite3`, `.db`, WAL, SHM, journal, or production business record.
- Existing CONTRACT-v2, receipt/date v2, Issue/correction v2, and SH-MODEL-001/002 public schema identities outrank this design. A contradiction fails the candidate instead of silently changing upstream semantics.

## Completion boundary

Completion requires a missing-file RED, semantic RED cases, final fixture GREEN, parser/ASCII/strict-JSON gates, stable hashes, no protected or business-data candidates, independent semantic review, private GitHub delivery, and independent-clone reproduction.

Completion means the shared Issue/Correction/transaction/mixed/receipt model is frozen. It does not mean that SQLite mapping, repository transactions, outbox workers, correction execution, receipt rendering, OpenClaw integration, or an installable product exists.
