# B-STOR-001 Work-Item Brief

## Identity

- task_id: `B-STOR-001`
- milestone: `M3`
- type: `storage`
- product_line: `B only`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `independent B storage review after frozen candidate`
- requirements: `REQ-SAFE-001`, `REQ-OPS-002`, `REQ-NFR-002`
- cases: `CASE-STORAGE-004`, `CASE-STORAGE-005`, `CASE-OPS-003`
- roots: `ROOT-B`

## Objective

Implement built-in SQLite bootstrap, one fixed database filename, migration 0001, mapping constraints and package compatibility. Do not implement the business repository or expose a writing tool.

## Dependencies

- `SH-SAFE-BASE-001` — `EV-20260811-012`
- `SH-MAP-001` — `EV-20260811-020`
- `SH-HARNESS-001` — `EV-20260812-025`
- `SH-TRACE-001` — `EV-20260812-026`

All dependencies are complete and current at task start.

## Roots and data boundary

- official data roots: the configured B SQLite root is read-only for this task and must not be opened by tests;
- isolated test roots: one fresh system-temporary direct child matching `diet-manager-b/B-STOR-001/<guid>` per test run;
- runtime path authority: only an adapter-owned private root enters the storage module; database filename is fixed internally;
- temporary candidate, WAL, SHM and lock files must be direct descendants of the same test-owned root and removed after each test;
- no production business record, user text, food name, quantity or credential may enter tests or reports.

## Deliverables

- `version-b-lite-plugin/src/storage/database.ts`
- `version-b-lite-plugin/src/storage/migrations.ts`
- `version-b-lite-plugin/src/storage/migration-v1.ts`
- `version-b-lite-plugin/tests/storage-bootstrap.test.ts`
- focused compatibility updates to `sqlite-runtime.ts`, package scripts and progress documents
- implementation report, review package, review and evidence

## Frozen contract

- filename: `diet-manager-b.sqlite3`
- driver: `node:sqlite`
- Node: `>=24.14.0 <25`
- mapping: `diet-manager/b-sqlite-mapping/v1`, 44461 bytes, SHA-256 `19A74F1FB131CDCC1799653043EE707F6CC765369F4997811E62815ABED99D2F`
- SQLite application ID: `0x444D4231` (`1145913905`)
- user version: `1`
- migration ID: `diet-manager/b-sqlite-migration/0001`
- expected schema: 20 tables, 18 indexes, 22 declared foreign keys
- pragmas: WAL, foreign keys enabled, busy timeout 5000 ms

## Verification commands

Run from `version-b-lite-plugin` with a repository-supported Node.js 24 and package manager:

```text
pnpm exec vitest run tests/sqlite-compatibility.test.ts tests/storage-bootstrap.test.ts
pnpm exec tsc --noEmit
pnpm run build
pnpm run plugin:validate
```

## Completion Oracle

- only the fixed direct-child database path is accepted;
- root/database symlink or junction and wrong existing identity fail before business writes;
- fresh install publishes only after exact mapping identity, 20/18/22 schema, quick check and foreign-key check pass;
- each injected migration failure leaves the final database absent, business rows zero and candidate/WAL/SHM residual zero;
- a retry starts from a fresh candidate and never resumes a partial migration;
- existing current v1 database opens only after all identity/integrity checks;
- no third-party native SQLite driver, OpenClaw-specific business state machine or real business data is added;
- package compiles and validates in the supported local OpenClaw toolchain;
- official B data root remains unchanged.

## Risk, decision and change IDs

- risk_ids: `RISK-004`, `RISK-010`, `RISK-011`, `RISK-016`
- decision_ids: `DEC-018`, `DEC-020`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260810-001`, `CHG-20260811-002`
- open_question: `Q-002`

## Product safety rule

A migration/write failure may emit a separate redacted technical diagnostic, but it must create zero dietary business rows and no half record. A diagnostic is never proof of commit.

## Reopen conditions

Reopen when the SQLite driver, Node/OpenClaw support matrix, fixed filename, mapping identity, application ID, migration SQL, schema cardinality, path authority or package boundary changes.

## Machine traceability

case_assertion_paths:
  CASE-STORAGE-004:
    - /path_authority/fixed_database_leaf
    - /path_authority/reject_arbitrary_or_reparse_path
  CASE-STORAGE-005:
    - /migration/failure_keeps_final_unpublished
    - /migration/failure_keeps_user_version_unadvanced
  CASE-OPS-003:
    - /migration/interruption_candidate_not_activated
    - /migration/interruption_retry_requires_fresh_candidate
full_case_set: none
