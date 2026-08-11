# B-STOR-002 Implementation Report

## Status

- product line: B only
- candidate commit: `d66c55ce5c734eaaa18625e8cf706a91c5eb8e9b`
- scope: atomic repository transactions, inventory projection effects, restart recovery and minimal terminal result freezing
- explicitly absent: model/parser integration, nutrition calculation, correction, daily progress, receipt rendering, installation and deployment

## What was implemented

### FactCommit

`commitPreparedFact` accepts only a strict prepared DTO. Before opening SQL it rejects accessors, custom prototypes, unexpected keys, invalid identifiers, non-canonical payloads and unsupported values. Inside `BEGIN IMMEDIATE` it revalidates migration authority, the signed stored preview and the current server repository revision.

The transaction inserts the event, ordered meal items and durable effect outbox rows, then compare-and-sets the envelope through `received -> facts_committed -> effects_pending` and advances the matching idempotency checkpoint. It commits only after every write succeeds.

All injected failures before `COMMIT` roll the complete transaction back. A failure may invoke one injected diagnostic sink after rollback. That diagnostic contains only phase, stable error code, trace ID and input digest. A diagnostic failure is ignored so it cannot replace the repository error or alter business data.

An exact retry after response loss reconstructs its result from authoritative rows. A retry with a different deterministic fact identity is rejected without another write.

### Server repository revision

The preview's data revision is compared with a fresh server-owned revision inside the write transaction. The revision covers committed events, products, inventory batches, current inventory projections and issues. An unused preview becomes stale when any of those authorities changes.

### EffectBundle and inventory projection

`processInventoryEffect` claims only `pending` or `retryable_failed` inventory work under `BEGIN IMMEDIATE`. Inventory addition creates or validates its product and batch, writes one inventory transaction and one nonnegative projection. Deduction requires the same product, batch, unit and sufficient quantity.

Insufficient inventory produces a permanent business skip: it writes no inventory transaction and does not change the projection. Successful retries and response-loss retries return the original transaction payload rather than recalculating from a later projection.

`listPendingInventoryEffects` provides deterministic restart discovery ordered by creation time and outbox ID. `getInventoryProjection` reads and validates only the committed canonical projection.

### EnvelopeFinalize

`finalizeEnvelope` accepts a strict precomputed terminal payload only after effects are stable. The finalization row, envelope state and frozen terminal idempotency result are one transaction. An injected failure at any finalizer write point rolls back only the finalizer and preserves the committed fact/effects. A later replay returns the original frozen terminal result even if unrelated repository data changed.

## Failure-zero-business-row proof

The focused suite snapshots every physical table before each fault. It injects failures after each meaningful write in FactCommit, EffectBundle and EnvelopeFinalize and requires the exact pre-transaction snapshot afterward.

For FactCommit this means every new dietary/business table remains unchanged, including `event_records`, `meal_items`, `effect_outbox`, products, inventory batches, inventory transactions, projections, effect bundle commits and finalizations. The only permitted failure artifact is the separate redacted technical log written after rollback.

## Concurrency and recovery proof

The standalone concurrency harness uses real worker threads, independent SQLite connections and a shared start barrier. It proves:

- two identical fact commits return one authoritative fact and one replay;
- two changed facts under the same authority produce one success and one stable conflict;
- two workers processing the same effect produce one inventory mutation;
- a finalizer failure can race an unrelated fact without leaking partial finalizer rows;
- a worker that exits with an open uncommitted transaction leaves zero visible event rows after reopen;
- `quick_check`, `foreign_key_check` and migration identity remain valid.

The backup test uses the Node `node:sqlite` backup API, opens the copied database through the normal identity guard and compares committed projection and row counts.

## Verification

All local verification used Node `v24.15.0` with SHA-256 `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`.

| Gate | Result |
|---|---|
| TypeScript `--noEmit` | PASS |
| TypeScript build and tracked `dist` regeneration | PASS |
| focused repository suite | PASS, 21/21 |
| complete B package Vitest | PASS, 5 files / 69 tests |
| real worker/connections concurrency harness | PASS |
| OpenClaw plugin metadata build check | PASS, `Plugin metadata is up to date.` |
| OpenClaw plugin validation | PASS, `Plugin diet-manager-b is valid.` |
| test-owned `B-STOR-002` temporary roots | PASS, residual 0 |
| `index.ts`, migration v1, lockfile and plugin manifest delta | PASS, 0 |
| platform address/token scan | PASS, 0 findings |

The public OpenClaw tool remains non-writing. This task adds repository modules and tests but does not connect raw model/tool input to those writes.

## Frozen implementation files

| File | Bytes | SHA-256 |
|---|---:|---|
| `src/repository/fact-commit.ts` | 24079 | `CC8FD2A43DB31F956A9ECAC5ABAFC0CEF285C4DBCE9329EB3EBCBEFD70FCA0F3` |
| `src/repository/inventory-effects.ts` | 29947 | `79C083AA128BF6F3D4935BECA3CF8860C8CE5C951E18771102D3F67902830082` |
| `src/repository/query.ts` | 4920 | `08E1E1C4F075F0C30D479C55B85C4824AA5AEEF31E94B3645B4558ED15389876` |
| `src/repository/envelope-finalize.ts` | 12075 | `3B20C7103C6A97E98F11E072DC76BBAF7D489DEC0FD35FB770951E325020612B` |
| `src/repository/revision.ts` | 1764 | `A95B664B6DD6A343DED82A9EC3D0B1F320E419447DEFE436F309F7B0BA5EA0EE` |
| `tests/repository.test.ts` | 37734 | `A1DFE7F6850C7594622CDDB5FDE2835682F763C4616DACF3EA4957A2254659CC` |
| `tests/repository-concurrency.mjs` | 15547 | `AA033CAB2A5351DEB235852F97073237B9753BD575FC6F0FD4830E2FA7493ABE` |

## Deferred by design

- turning model or chat text into prepared commands;
- OpenClaw/MCP/other-agent runtime adapters;
- nutrition profiles/snapshots and daily progress;
- correction, undo, issue workflow and mixed-item orchestration;
- user-facing receipt wording and install/upgrade/backup UX;
- technical-log rotation/retention policy beyond the proved redacted sink boundary.

These are later Plan 0.3 tasks, not incomplete claims from B-STOR-002.

## Independent review

OpenClaw 02 performed one bounded isolated public-clone review of the exact candidate. It reproduced TypeScript no-emit/build, 21/21 focused tests, 69/69 complete tests, byte-identical `dist`, the real worker/connection concurrency harness, backup compatibility and all boundary scans. The clone, generated files and review-owned databases/logs were removed.

Result: PASS, P0=0, P1=0, cleanup=1.

Three nonblocking P2 observations are recorded rather than expanding this task: remove one ineffective preliminary replay lookup; optionally give finalized FactCommit retries a more semantic fail-closed error; define attempt-count persistence when a future worker introduces durable `retryable_failed` transitions. None changes a business row, duplicates an effect or weakens this task's accepted Oracle.
