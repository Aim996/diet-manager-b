# B-STOR-001 Implementation Report

## Status

- product line: B only
- state: local candidate green; independent review and evidence closure pending
- scope: SQLite bootstrap and migration 0001 only
- explicitly absent: business repository, meal/water/inventory writes, outbox worker, OpenClaw business adapter and MCP

## Implemented boundary

`openDietDatabase` accepts one adapter-owned absolute private runtime root and appends the fixed leaf `diet-manager-b.sqlite3`. It rejects a missing/non-directory root, a root whose lexical and physical identity differ, a database junction/symlink, a multiply-linked database leaf, and an existing database whose frozen identity does not match.

Fresh installation uses a random direct-child candidate. The candidate enables WAL, foreign keys and a 5000 ms busy timeout, applies migration 0001 under `BEGIN EXCLUSIVE`, validates the complete physical result, closes/checkpoints it, and only then publishes it without overwriting an existing leaf. A migration failure closes and removes the unpublished database, WAL and SHM files.

The implementation uses only Node 24 built-in `node:sqlite`. No third-party SQLite driver or native install approval was added.

## Mapping ownership

- mapping id: `diet-manager/b-sqlite-mapping/v1`
- machine block: 44461 UTF-8 bytes
- mapping SHA-256: `19A74F1FB131CDCC1799653043EE707F6CC765369F4997811E62815ABED99D2F`
- application ID: `0x444D4231` / `1145913905`
- user version: `1`
- migration ID: `diet-manager/b-sqlite-migration/0001`
- physical schema: 20 tables, 18 explicit indexes, 22 foreign keys

The runtime SQL is frozen in `migration-v1.ts`. The acceptance test independently reads the mapping machine block and compares every table name, column name/type/nullability/default, primary-key order, CHECK expression, foreign key, index column order, uniqueness and partial-index flag. It does not generate its expected schema from the implementation SQL.

## TDD evidence

1. Initial focused RED: Vitest could not load `../src/storage/database.js`; the production storage bootstrap did not exist.
2. Test-harness compatibility RED: Vite 5 misresolved a runtime `node:sqlite` import. The test was changed to the repository's established `createRequire("node:sqlite")` pattern before implementation assertions were accepted.
3. Windows fixture RED: unprivileged file symlink creation returned `EPERM`. The database-leaf reparse test now uses a test-owned directory junction and separately covers a hard link; the external sentinel is checked byte-for-byte.
4. GREEN: all seven bootstrap scenarios pass, including three migration fault phases, fresh retry, unknown-existing-database byte preservation and drifted-v1 byte preservation.

## Failure atomicity

The three fault points are `after_schema`, `before_history` and `before_commit`. For each point the test requires:

- stable `STORAGE_MIGRATION_FAILED:<phase>`;
- final `diet-manager-b.sqlite3` absent;
- candidate, WAL and SHM residue absent;
- private test root empty;
- a retry creates a new valid candidate and succeeds.

The migration contains only schema and migration-history work. No dietary business row is inserted. A later business write failure may emit a separate redacted technical log, but that log will not be stored in or counted as a dietary record; repository atomicity belongs to `B-STOR-002`.

## Verification

| Gate | Result |
|---|---|
| focused bootstrap | PASS, 7/7 |
| complete B package Vitest | PASS, 3 files / 21 tests |
| TypeScript `--noEmit` | PASS |
| TypeScript build | PASS |
| OpenClaw 2026.7.1 local build/validate | PASS, `Plugin metadata is up to date` and `Plugin diet-manager-b is valid` |
| changed/protected paths | PASS, protected delta 0 |
| test-owned SQLite residual | PASS, 0 |
| repository business artifacts | PASS, 0 SQLite/DB/JSONL candidates |
| machine path, test platform address and secret scan | PASS, 0 findings |

OpenClaw rejected bundled Node 24.14 before validation because the current host requires Node 24.15 or newer. Package metadata, README, brief and foundation test were aligned to `>=24.15.0 <25`; the successful local validation used the previously verified Node 24.15 binary with SHA-256 `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`. No model call was made.

## Frozen candidate files

| File | Bytes | SHA-256 |
|---|---:|---|
| `version-b-lite-plugin/src/storage/database.ts` | 8882 | `BF5BAB39F620FA578557175E011F5B59BE03CAFAB274638CA3AF65F5047463A1` |
| `version-b-lite-plugin/src/storage/migrations.ts` | 1733 | `E6C1ED8BD69113A63741E9199502D832FA5BABCE0CAC8D4AB5B51F14E04D88FC` |
| `version-b-lite-plugin/src/storage/migration-v1.ts` | 16826 | `9C02EDB52F2AC9E11F4828B9511B29157B62910B3D8AB420111B2AEBD9CFD5F1` |
| `version-b-lite-plugin/tests/storage-bootstrap.test.ts` | 12678 | `0037EA4ACE5445A1270137EBF946DA6FBF70DC68FC383630FD6B38AF1DE81A80` |
| `version-b-lite-plugin/package.json` | 816 | `16BBDDF51868518AC5E3FCAF630D07717F5F19718BE5CF84BDA4902BF60FFD23` |

## Deferred by design

- business repository transactions and technical-log file separation;
- idempotency, fact/effect/finalize writes and outbox recovery;
- upgrades/backups from unknown older versions;
- OpenClaw platform installation and record/query/correct/undo persistence;
- MCP or other agent adapters.

These are later plan items, not missing claims from B-STOR-001.
