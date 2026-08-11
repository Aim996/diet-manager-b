# B-MERGE-C-001 Work-Item Brief

## Identity

- task_id: `B-MERGE-C-001`
- milestone: `M3`
- type: `B-only security merge`
- product_line: `B only`
- status: `complete`
- owner: `Codex /root`
- reviewer: `OpenClaw 02 independent B security review; PASS P0=0/P1=0/P2=0`
- requirements: `REQ-CORE-003`, `REQ-SAFE-003`, `REQ-CONTEXT-003`, `REQ-OPS-002`
- cases: `CASE-INVENTORY-006`, `CASE-STORAGE-001`, `CASE-STORAGE-005`, `CASE-STORAGE-006`, `CASE-STORAGE-007`
- roots: `ROOT-B`

## Objective

Move only the useful server-authority semantics from the cancelled C route into B: a persisted and signed preview, exact request/revision binding, untrusted caller state, state-transition guards, migration guards and idempotency conflict/retry control. Do not recreate the C product and do not implement the B business repository early.

## Dependencies

- `B-STOR-001` — `EV-20260812-027`
- `SH-MAP-001` — `EV-20260811-020`
- `SH-HARNESS-001` — `EV-20260812-025`
- `SH-TRACE-001` — `EV-20260812-026`

All dependencies are complete and current at task start.

## Selected approach

Use the existing B SQLite control tables and an HMAC-SHA256 capability token:

- `command_envelopes.payload_json` stores one server-owned preview binding and preview hash;
- `idempotency_records` reserves the exact idempotency identity and points to the preview envelope;
- a private server secret signs the exact preview binding;
- authorization reopens the stored row and compares token, stored binding, request identity and current `data_revision` before any business write;
- pure transition and migration guards reject impossible changes before a repository transaction starts.

No new table, migration version, C database or caller-controlled state field is introduced.

## Roots and data boundary

- tests use only a fresh direct child of the system temporary directory matching `diet-manager-b-B-MERGE-C-001-<guid>`;
- the official B data root is not opened by tests;
- fixtures use synthetic identifiers and hashes only, never real food names, quantities, raw chat, credentials or official data;
- successful preview creation may write only `command_envelopes` and `idempotency_records` control rows;
- stale, forged, conflicting, illegal-transition and illegal-migration attempts change no table;
- all dietary/business tables remain empty throughout this task;
- a future redacted technical logger remains outside the business database and cannot alter commit/rollback decisions.

## Deliverables

- `version-b-lite-plugin/src/authority/canonical-json.ts`
- `version-b-lite-plugin/src/preview/token.ts`
- `version-b-lite-plugin/src/preview/store.ts`
- `version-b-lite-plugin/src/state/transition-guard.ts`
- `version-b-lite-plugin/src/storage/migration-guard.ts`
- `version-b-lite-plugin/tests/server-authority.test.ts`
- focused design, implementation report, review package, review, evidence and progress/trace updates

## Frozen behavior

### Preview binding

The signed and stored binding contains exactly:

- `preview_id`
- `preview_version`
- `preview_hash`
- `input_digest`
- `subject_scope`
- `command_type`
- `data_revision`

The token format is versioned, canonical and authenticated with HMAC-SHA256. The private key is injected by a private B server adapter, must be at least 32 bytes and is never stored in SQLite, logged, returned in reports or exposed through the Skill/OpenClaw tool schema.

### Idempotency

The exact identity is `idempotency_key + input_digest + subject_scope + command_type`.

- first valid request atomically creates one preview envelope and one idempotency row;
- same key, same identity, same preview hash and same data revision returns the exact original preview/token with zero new rows;
- same key with a changed digest, subject or command fails with stable `idempotency_conflict` and zero writes;
- a changed preview hash or changed revision cannot silently replace an existing preview.

Terminal-result replay remains a `B-STOR-002` repository responsibility; this task freezes the pre-write authority and conflict boundary it must call.

### State and migration

- envelope transitions are a strict forward chain: `received → facts_committed → effects_pending → effects_stable → finalized`;
- effect transitions are `pending → processing`, `processing → succeeded|retryable_failed|permanent_business_skip`, and `retryable_failed → processing`;
- every transition compares a server-read previous state; a caller-reported state is not an input;
- current schema authority requires exact application ID, user version, committed migration row, migration ID and checksum;
- only the migration scenarios frozen by `storage-mapping/v1` are legal; illegal version jumps, missing backup authority or mismatched history fail before writes.

## Completion Oracle

- forged signatures, malformed/noncanonical tokens and stored-row mismatches are rejected;
- stale `data_revision` is rejected even when token signature is valid;
- changed digest/subject/command with the same idempotency key returns `idempotency_conflict` without mutating the original rows;
- exact retry returns the same preview ID, binding and token with no row delta;
- caller-supplied state cannot authorize a transition or commit;
- all invalid envelope/effect transitions fail before database mutation;
- all invalid migration shapes fail before database mutation;
- every negative test proves all dietary/business table counts remain zero;
- existing B tests, TypeScript build and package build stay green;
- no OpenClaw model call is needed for implementation verification.

## Out of scope

- meal, water, inventory, correction or query repository writes;
- `FactCommit`, `EffectBundle` and `EnvelopeFinalize` transaction implementations;
- terminal frozen result replay;
- production OpenClaw/MCP/Skill adapter wiring;
- new SQLite tables or migration v2;
- any independent C database, state machine, plugin or release.

## Reopen conditions

Reopen when the preview binding fields, token algorithm/version, idempotency identity, state graph, SQLite application/user version, migration identity/checksum or `storage-mapping/v1` control merge points change.

## Machine traceability

case_assertion_paths:
  CASE-INVENTORY-006:
    - /preview/data_revision_stale_zero_write
    - /preview/caller_state_untrusted
  CASE-STORAGE-001:
    - /idempotency/same_identity_returns_original_preview
    - /idempotency/same_identity_zero_new_rows
  CASE-STORAGE-005:
    - /migration/illegal_transition_zero_write
    - /migration/history_and_user_version_match
  CASE-STORAGE-006:
    - /idempotency/retry_uses_frozen_server_authority
  CASE-STORAGE-007:
    - /idempotency/changed_digest_conflict_zero_write
    - /idempotency/changed_subject_conflict_zero_write
    - /idempotency/changed_command_conflict_zero_write
full_case_set: none
