# SH-CASE-003 Ops and Security Oracle Design

**Date:** 2026-08-11
**Task:** `SH-CASE-003`
**Product line:** B-only shared Oracle
**Status:** approved scope, design candidate

## 1. Context

`SH-CASE-001` and `SH-CASE-002` established one cumulative, adapter-neutral acceptance catalog. The next DOC-0.3 task freezes the privacy, validation-zero-pollution, installation, migration-failure, immutable-candidate and export/restore safety behavior needed by later B implementation work.

This task defines deterministic data and validators. It does not implement an installer, database, migration runner, backup command, deletion command, B adapter or OpenClaw integration.

## 2. Decision

Implement exactly the six case IDs registered by Plan 0.3:

1. `CASE-PRIV-001`
2. `CASE-FOUNDATION-002`
3. `CASE-OPS-001`
4. `CASE-OPS-003`
5. `CASE-OPS-010`
6. `CASE-EXPORT-004`

Deletion safety is represented only where these six cases require it: failed, cancelled or unverified operations must delete or replace zero official business files. Full uninstall-and-delete behavior for `CASE-OPS-005`, `CASE-OPS-006` and `CASE-OPS-008` remains deferred to `SEL-BACKUP-001` as registered by Plan 0.3.

## 3. Alternatives considered

### A. Exact six-case package — selected

Append the six registered cases, add separate ops/security fixtures, create one focused validator and mutation suite, and preserve the first fourteen cases and all existing fixtures.

This matches the task ledger, keeps Oracle work separate from implementation and gives later installer/migration/backup tasks stable acceptance inputs.

### B. Add standalone uninstall/deletion cases now — rejected

This would cover more of `REQ-OPS-003`, but it would expand `SH-CASE-003` beyond its frozen case list and overlap `SEL-BACKUP-001`.

### C. Implement installer and migration code together with the cases — rejected

This would mix M2 Oracle definition with M7 product delivery, make failures ambiguous and risk claiming installability before B storage and release gates exist.

## 4. Scope and traceability

The package freezes these requirement links:

| Case | Requirements | Frozen responsibility |
|---|---|---|
| `CASE-PRIV-001` | `REQ-PRIV-001` | External nutrition lookup sends only approved normalized product fields; logs and diagnostics exclude user history, secrets and raw chat. |
| `CASE-FOUNDATION-002` | `REQ-SAFE-004` | Before/after official manifests are identical even when validation fails; sidecars are included; temporary roots are audited and cleaned. |
| `CASE-OPS-001` | `REQ-OPS-001`, `REQ-SAFE-004` | Clean install performs read-only preflight, verifies the package, uses staging and isolated smoke data, initializes an empty B schema and atomically promotes only after verification. |
| `CASE-OPS-003` | `REQ-OPS-002` | A migration interruption leaves the old program/data readable, does not advance schema/product version and does not expose a partial target. |
| `CASE-OPS-010` | `REQ-OPS-004` | Any byte change after candidate freeze invalidates the candidate, hashes and evidence; promotion is forbidden until a new candidate is tested. |
| `CASE-EXPORT-004` | `REQ-EXPORT-BASE-001`, `REQ-OPS-002`, `REQ-OPS-003` | A minimal user export is readable but cannot be used as a full restore source; rejection occurs before replacement or deletion of current official data. |

## 5. Cumulative catalog design

### 5.1 Case catalog

`shared/acceptance-cases/cases.json` advances from `1.1.0` to `1.2.0` and from fourteen to twenty ordered cases.

- The existing fourteen case JSON values remain unchanged.
- The six new cases are appended in the order listed in section 2.
- Existing `package_invariants` remain unchanged.
- Each new case uses `setup.ops_security_fixture` and does not reuse a domain fixture as an ops/security Oracle.
- Adapters remain forbidden from rewriting expected values.

### 5.2 Fixture catalog

`shared/acceptance-cases/fixtures/core-v1.json` advances from `1.1.0` to `1.2.0`.

- Existing `environments`, `goals`, `query_views` and `domain_scenarios` remain value-identical.
- Add one new root array, `ops_security_scenarios`.
- Add exactly six ordered scenarios, one per new case.
- Every path is a fixture token under a declared logical root, never a live machine path.
- Hashes are fixed uppercase SHA-256 values over exact fixture byte strings; validators recompute them independently.
- Secrets use recognizable sentinel values that validators must prove absent from outbound, log and report fields.

## 6. Frozen case behavior

### 6.1 CASE-PRIV-001

The input requests public nutrition information for a normalized product. The outbound request may contain only:

```text
normalized_name, brand, variant, specification, preparation_state, region
```

The fixture also contains user name, raw chat, full meal history, inventory, goals and an API-token sentinel. The Oracle requires all of them to be absent from the outbound request, ordinary logs, evidence and user receipt. Missing credentials must produce a cache/template/unknown fallback, with zero business writes and no invented nutrition values.

### 6.2 CASE-FOUNDATION-002

The fixture contains official JSONL/SQLite-like files plus WAL/journal sidecars and independent temporary roots. The Oracle requires:

- complete before and after manifests with path, length, SHA-256 and modification time;
- `added=0`, `modified=0`, `deleted=0` for official business files;
- the same post-scan and cleanup obligations on a forced validation failure;
- no path escape, no temporary residual and no report omission of a known sidecar;
- technical failure logs may exist only in the separate redacted evidence channel and never count as dietary data.

### 6.3 CASE-OPS-001

The package manifest fixes product/route/contract/schema/installer versions, supported environment and per-file hashes. The clean-install Oracle requires:

- read-only preflight before any create or migration;
- package hash verification before staging;
- a temporary install location and atomic final promotion;
- an empty B schema with zero business records and no formal JSONL creation;
- isolated smoke data that is completely cleaned;
- zero official-data impact and an install receipt that does not call foundation a product release.

### 6.4 CASE-OPS-003

The fixture represents a supported old B schema, a verified pre-migration backup and a fault after a rehearsal step but before activation. The Oracle requires:

- the old program and official data remain readable;
- product/schema version markers remain at the old values;
- the target candidate is not activated;
- no partial migrated database or success receipt is visible;
- the verified backup and redacted failure evidence remain available;
- retry requires a fresh migration attempt rather than continuing unknown partial state.

### 6.5 CASE-OPS-010

The fixture freezes a candidate manifest and then mutates one package file after all gates were associated with the original bytes. The Oracle requires:

- the changed file hash differs from the frozen manifest;
- candidate state becomes `invalidated`;
- prior E2E and release evidence cannot authorize promotion;
- release cannot rebuild, patch or substitute bytes in place;
- a new manifest, affected gates and release decision are required.

### 6.6 CASE-EXPORT-004

The fixture distinguishes a minimal user JSON export from a consistency backup. The export is readable and versioned but intentionally lacks backup manifest, complete schema, idempotency state and integrity proof. The Oracle requires:

- restore rejects it with a stable `not_restorable_backup` outcome;
- current official data is not replaced, deleted or migrated;
- no success receipt or version change is produced;
- the response explains that only a verified backup may be restored;
- ordinary export remains usable for viewing and does not become mislabeled as a backup.

## 7. Validator design

Create `shared/tests/validate-ops-security-acceptance-cases.ps1`.

The validator must:

1. parse both catalogs as strict JSON;
2. require cumulative version `1.2.0` and exact ordered twenty-case registration;
3. prove the original fourteen cases and all previous fixture objects are unchanged using frozen independent snapshots/digests;
4. require exact root/property shapes for each new case and scenario;
5. independently recompute all declared hashes and manifest differences;
6. verify requirement references, fixture references and forbidden outcomes;
7. run mutations through the real validation functions;
8. emit one stable machine-readable PASS line with owned case/scenario/mutation counts.

Update the existing core and domain acceptance validators only enough to recognize the registered cumulative suffix and version `1.2.0`. Their owned subsets, assertions and mutation counts remain unchanged.

## 8. Anti-weakening mutation suite

At least these twelve mutations must be rejected for stable focused error prefixes:

1. drop one required ops/security case;
2. add raw chat or user identity to the external request;
3. add the token sentinel to an ordinary log;
4. omit a modified or deleted official sidecar from the after manifest;
5. skip the after scan on validation failure;
6. create a sample meal during clean install;
7. accept a package file with the wrong hash;
8. advance schema version after migration failure;
9. make old data unreadable or expose a partial target after migration failure;
10. allow promotion after a frozen candidate byte changes;
11. accept the minimal export as a consistency backup;
12. delete or replace official data before rejecting the invalid restore source.

Mutations operate on plain JSON clones. A mutation passes only when the real validator rejects the intended unsound change.

## 9. Failure and cleanup behavior

- Validator failures return nonzero and still perform parser/byte/hygiene checks.
- Test fixtures are static documents; validators do not create product roots or business files.
- No network request, OpenClaw session, Node business runtime, installer, migration or deletion command runs in this task.
- No technical log may be counted as a meal, water, inventory, nutrition, Issue, outbox, progress, receipt or terminal idempotency record.
- Repository tests must not read, hash, edit, track or execute the five protected domain lease files.

## 10. Expected repository changes

Create:

- `shared/tests/validate-ops-security-acceptance-cases.ps1`
- `docs/work-items/SH-CASE-003-brief.md`
- `docs/work-items/SH-CASE-003-report.md`
- `docs/work-items/SH-CASE-003-review-package.md`
- after independent PASS: `docs/work-items/SH-CASE-003-review.md`
- after independent PASS: `docs/evidence/EV-20260811-023-sh-case-003.md`

Modify:

- `shared/acceptance-cases/cases.json`
- `shared/acceptance-cases/fixtures/core-v1.json`
- `shared/tests/validate-core-acceptance-cases.ps1`
- `shared/tests/validate-domain-acceptance-cases.ps1`
- `docs/开发进度.md`
- `总功能开发计划0.3.md`

Do not modify protected contract/schema/fixture/validator lease files, production storage, route implementations or OpenClaw configuration.

## 11. Verification and completion

Completion requires:

- focused RED then GREEN for the new validator;
- all twelve mutations rejected;
- existing core/domain and six upstream shared validators green;
- strict JSON, Parser=0, ASCII/CR/NUL gates and `git diff --check`;
- exact protected-file delta count zero without reading or hashing protected content;
- no business candidate files and no temporary fixture residual;
- independent P0=0/P1=0 review using an independently written checker;
- progress/evidence documents that distinguish Oracle completion from product implementation;
- clean branch and reproducible results in an independent clone before merge/publish.

## 12. Reopen conditions

Reopen `SH-CASE-003` if any selected case semantics, root rules, release-candidate rules, package/backup/export format, privacy allowlist or related shared contract changes. Adding later registered cases without changing these twenty values does not itself invalidate this package.
