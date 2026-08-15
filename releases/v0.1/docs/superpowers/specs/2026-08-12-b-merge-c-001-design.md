# B-MERGE-C-001 Server Authority Design

## Goal

Add the minimum server-owned authority B needs before a real repository may write dietary data. The server persists and signs a preview, binds it to one request identity and current data revision, and rejects forged/stale state, idempotency conflicts, illegal state transitions and illegal migrations before business writes.

This task deliberately stops before repository implementation. It creates control-plane proof, not a usable dietary write path.

## Considered approaches

### A. Existing SQLite control tables plus HMAC token — selected

Persist preview metadata in the already mapped `command_envelopes.payload_json`, reserve idempotency in `idempotency_records`, and sign the exact binding with HMAC-SHA256. This is durable across restart, reuses the mapping-locked B database, requires no migration change and gives B-STOR-002 a narrow authorization API.

### B. Process-memory preview store — rejected

This is smaller but loses authority after restart, cannot prove replay/conflict behavior, and lets an adapter accidentally become the source of truth.

### C. New preview table and migration v2 — rejected for this milestone

This is explicit but changes the frozen mapping before the first repository exists, expands migration/recovery scope and duplicates a control merge point that Plan 0.3 already maps to `command_envelopes.payload_json`.

## Architecture

### 1. Canonical JSON boundary

`authority/canonical-json.ts` accepts only JSON primitives, arrays and ordinary own data properties. Accessors, symbol keys, custom prototypes, sparse arrays, non-finite numbers, `undefined`, cycles and unsupported objects fail before their values are read or signed. Object keys sort by code-unit order and serialization is UTF-8 without BOM.

This one canonicalizer provides:

- deterministic preview hashes;
- deterministic token payload bytes;
- exact retry comparison;
- no execution of caller-supplied getters while validating an adapter/model DTO.

### 2. Signed preview capability

`preview/token.ts` defines `PreviewBindingV1` with exactly seven fields: preview ID, version, preview hash, input digest, subject scope, command type and data revision.

The token is:

```text
dm-b-preview-v1.<base64url(canonical-binding-json)>.<base64url(hmac-sha256)>
```

Verification checks prefix, segment count, canonical base64url, payload length, exact binding shape, canonical reserialization and a constant-time signature comparison. The secret must be a private 32-byte-or-longer byte string. Neither the token nor key is written to technical logs.

### 3. SQLite preview store

`preview/store.ts` accepts an already opened, B-STOR-001-validated `DatabaseSync` connection. Before it reads or writes authority rows it calls the migration guard again, so a connection whose schema authority drifted after open fails closed.

Preview creation executes under `BEGIN IMMEDIATE`:

1. validate and freeze the request identity and preview material;
2. calculate the preview hash from canonical preview bytes;
3. look up the idempotency key;
4. if absent, create one `command_envelopes` row in `received/preview_ready` and one `idempotency_records` row pointing to the same preview ID;
5. if present, load the original server row and compare digest, subject, command, preview hash and revision;
6. return the exact original token for an exact retry, or fail with `idempotency_conflict`/stale-preview errors without an update;
7. commit only the valid first creation; roll back every exception.

The envelope payload stores only versioned control metadata and digests. It never stores raw chat, food names, quantities or a second copy of a domain object.

Authorization is read-only. It verifies the token, exact caller request identity, current data revision, the authoritative envelope state/result status, the stored binding and the idempotency row. It returns a frozen authority DTO for a later repository transaction. The API has no caller-state parameter; unexpected properties fail exact-shape validation.

### 4. Transition guards

`state/transition-guard.ts` exports pure guards for the two mapped state machines:

- envelope: `received → facts_committed → effects_pending → effects_stable → finalized`;
- effect: `pending → processing`; `processing → succeeded|retryable_failed|permanent_business_skip`; `retryable_failed → processing`.

The previous state must come from the authoritative database row. The guard does not perform SQL and cannot be told by a caller that a transition already occurred. B-STOR-002 must combine it with a compare-and-set update inside its transaction.

### 5. Migration guard

`storage/migration-guard.ts` has two responsibilities:

- `assertCurrentMigrationAuthority(database)` checks exact application ID, user version, one committed migration row, migration ID and mapping checksum immediately before authority operations;
- `assertMigrationTransition(plan)` accepts only the scenarios frozen in `storage-mapping/v1`: fresh `0→1` without backup, upgrade `0→1` with verified backup, upgrade failure `0→0` with verified backup, and recovery `1→1` with verified backup.

It never performs a migration. Migration execution remains in B-STOR-001/upgrade work. This guard ensures an adapter or future repository cannot silently write against an unknown/partial schema.

## Failure and logging boundary

Functions return frozen success DTOs or throw a stable authority error code. They do not write a diagnostic to SQLite. A future logger may record only stable code, phase, trace ID and irreversible digest in a separate redacted non-business sink.

The rule is physical and testable:

- valid preview creation writes exactly two control rows;
- exact retry writes zero rows;
- every failed authorization/transition/migration attempt changes zero rows;
- all dietary/business tables remain empty;
- logger failure cannot create a dietary row or change rollback behavior.

## Internal API

```ts
export interface PreviewBindingV1 {
  preview_id: string;
  preview_version: 1;
  preview_hash: string;
  input_digest: string;
  subject_scope: string;
  command_type: DietManagerAction;
  data_revision: string;
}

export function issuePreviewToken(binding: PreviewBindingV1, secret: Uint8Array): string;
export function verifyPreviewToken(token: string, secret: Uint8Array): PreviewBindingV1;

export function createServerPreview(input: CreateServerPreviewInput): CreatedServerPreview;
export function authorizeServerPreview(input: AuthorizeServerPreviewInput): AuthorizedServerPreview;

export function assertEnvelopeTransition(previous: EnvelopeState, next: EnvelopeState): void;
export function assertEffectTransition(previous: EffectState, next: EffectState): void;

export function assertCurrentMigrationAuthority(database: DatabaseSync): void;
export function assertMigrationTransition(plan: MigrationTransitionPlan): void;
```

These modules are internal package exports only. `index.ts`, the OpenClaw tool schema and `handleFoundationAction` remain non-writing in this task.

## Verification strategy

1. RED imports fail because the authority modules do not exist.
2. Token REDs cover forged signature, noncanonical payload, exact-field drift and getter-bearing DTOs.
3. Store REDs cover first create, restart/reopen authorize, stale revision, stored-row tamper, exact retry and three idempotency conflicts.
4. State REDs cover every legal edge and representative backward/skip/self/unknown transitions.
5. Migration REDs cover exact current authority plus illegal version, history and backup combinations.
6. Every negative path snapshots all table counts and proves no mutation; every run proves dietary tables are zero.
7. Run focused tests, existing B tests, TypeScript no-emit and package build with the verified Node 24 runtime. No model call is needed.

## Deferred work

- actual `FactCommit`, `EffectBundle` and `EnvelopeFinalize` SQL (`B-STOR-002`);
- terminal idempotency result storage/replay (`B-STOR-002`);
- server-side data-revision computation from domain rows (`B-STOR-002` and domain service);
- adapter/Skill/OpenClaw/MCP wiring and user-visible preview UX;
- migration v2, backup/restore and upgrade orchestration;
- end-to-end dietary behavior and receipts.
