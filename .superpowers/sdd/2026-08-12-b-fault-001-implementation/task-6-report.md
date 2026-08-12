# Task 6 report: storage, stale-preview and idempotency fault evidence

## Status

Complete. The frozen matrix now drives executable evidence for `CASE-STORAGE-005`,
`CASE-STORAGE-006`, `CASE-STORAGE-007`, and `CASE-INVENTORY-006`.

## TDD evidence and defect classification

1. Initial RED: `tests/fault-matrix.test.ts` failed with 1 failure and 30 passes.
   The executable case observation contained only `CASE-EFFECT-001/002/003`, while
   matrix `case_order` also required the four Task 6 cases. This was an aggregation
   gap; no production change was made for it.
2. After adding matrix parsing, mutations, and real SQLite scenarios, the focused
   suite failed with 1 failure and 35 passes. `CASE-STORAGE-007` expected
   `idempotency_conflict`, but terminal changed identity was rejected first as
   `PREVIEW_AUTHORITY_INVALID:state`. This was a focused production defect.
3. The minimal fix detects input-digest, subject-scope, and command-type conflicts
   for a stored successful terminal authority before the preview-ready state guard.
   Preview-ready and nonterminal state/error precedence is retained; token,
   secret, binding, and repository authorization remain unchanged.

## Executable evidence added

- Matrix aggregation consumes the existing matrix as the only case/fault/result
  authority, validates Task 6 row shapes, links row assertion paths to the matrix's
  case assertion paths, and includes deletion/observation/path mutation checks.
- `CASE-STORAGE-005`: all three migration fault points leave no published database
  or candidate residue. Unknown and drifted databases retain exact bytes, SHA-256,
  and `user_version` after rejection.
- `CASE-STORAGE-006`: a real SQLite finalizer commits, loses its response, receives
  a later unrelated fact, then replays the exact stored terminal JSON bytes without
  writes. The matrix-owned date order and absent single-day alias are observed.
- `CASE-STORAGE-007`: digest, subject, and command are changed separately against
  one terminal authority. Each returns its exact stable idempotency conflict twice,
  does not include the prior terminal JSON, and leaves every business/control table
  (except immutable migration history excluded from the snapshot) byte-canonically
  unchanged. A separate nonterminal test proves the original preview-state error
  precedence remains intact.
- `CASE-INVENTORY-006`: a preview is issued with one matching inventory candidate,
  a second candidate changes repository revision, the database is reopened, and
  execution of the old preview is rejected with zero event, item, outbox, or
  checkpoint rows and an unchanged complete table snapshot.

## Files changed

- `version-b-lite-plugin/tests/fault-matrix.test.ts`
- `version-b-lite-plugin/src/preview/store.ts`
- `.superpowers/sdd/2026-08-12-b-fault-001-implementation/task-6-report.md`

No storage migration implementation, dependency/lock file, product API, MCP,
public action, selected map, water behavior, new migration version, or
IssueResolution behavior was changed. The five protected files were not read,
hashed, executed, or modified. The migration-v1 file was not opened, hashed,
executed, or modified.

## Verification

- Node: `C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe`
- Vitest, one worker:
  `vitest run tests/fault-matrix.test.ts tests/storage-bootstrap.test.ts tests/server-authority.test.ts --maxWorkers=1 --minWorkers=1`
  - 3 test files passed
  - 71 tests passed
- TypeScript:
  `tsc -p tsconfig.json --noEmit`
  - exit 0
- `git diff --check`
  - exit 0

## Concerns

One process concern: a repository-wide `rg` symbol search included one matching
line from `src/storage/migration-v1.ts` because its exclusion glob did not match
the Windows-normalized path. No direct file read, hash, execution, or modification
followed. Full repository/build/OpenClaw/crash-harness validation was intentionally
not run because the brief explicitly limited verification to focused
fault/storage/authority behavior, TypeScript no-emit, and diff checking.
