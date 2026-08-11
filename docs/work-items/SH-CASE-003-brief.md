# SH-CASE-003 Work-Item Brief

## Identity and state

- task_id: `SH-CASE-003`
- milestone: `M2`
- type: `cases`
- product_line: `B-only shared Oracle`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `independent ops/security case reviewer pending`
- full_case_set: `none`

## Objective

Extend the cumulative acceptance catalog with six deterministic cases covering external disclosure, official-data zero difference, clean installation, migration interruption, frozen-candidate invalidation and rejection of a minimal export as a restore source. This task freezes Oracle and fixtures only. It does not implement an installer, storage, migration, backup, restore, deletion, release pipeline or OpenClaw adapter.

## Dependencies

- `SH-SAFE-BASE-001`
- `SH-MODEL-001`
- `SH-MODEL-002`
- `SH-MODEL-003`
- `SH-CASE-001`
- `SH-CASE-002`

The Plan 0.3 dependencies are complete. Product implementation dependencies remain intentionally pending.

## Requirements and cases

- requirement_ids: `REQ-PRIV-001`, `REQ-SAFE-004`, `REQ-OPS-001`, `REQ-OPS-002`, `REQ-OPS-003`, `REQ-OPS-004`, `REQ-EXPORT-BASE-001`
- case_ids: `CASE-PRIV-001`, `CASE-FOUNDATION-002`, `CASE-OPS-001`, `CASE-OPS-003`, `CASE-OPS-010`, `CASE-EXPORT-004`
- stage: `PRODUCT-0.1`

`REQ-OPS-003` is frozen here only as zero replacement/deletion before rejecting an invalid restore source. Complete uninstall-and-delete flows remain assigned to `SEL-BACKUP-001` and are not added to this task.

## Deliverables

- update `shared/acceptance-cases/cases.json` to cumulative version `1.2.0`
- update `shared/acceptance-cases/fixtures/core-v1.json` to cumulative version `1.2.0`
- create `shared/tests/validate-ops-security-acceptance-cases.ps1`
- update core/domain acceptance validators for registered cumulative suffix compatibility
- create candidate report and independent review package
- create review, evidence and progress closure only after independent P0=0/P1=0

## Case assertion paths

```yaml
case_assertion_paths:
  CASE-PRIV-001:
    - /setup/ops_security_fixture
    - /oracle/privacy
    - /oracle/fallback
    - /forbidden
  CASE-FOUNDATION-002:
    - /setup/ops_security_fixture
    - /oracle/official_manifest
    - /oracle/validation_failure
    - /oracle/cleanup
    - /forbidden
  CASE-OPS-001:
    - /setup/ops_security_fixture
    - /oracle/preflight
    - /oracle/package_verification
    - /oracle/installation
    - /oracle/isolated_smoke
    - /oracle/receipt
    - /forbidden
  CASE-OPS-003:
    - /setup/ops_security_fixture
    - /oracle/migration_failure
    - /oracle/old_state_after_failure
    - /oracle/retry
    - /forbidden
  CASE-OPS-010:
    - /setup/ops_security_fixture
    - /oracle/candidate_integrity
    - /oracle/invalidation
    - /oracle/release
    - /forbidden
  CASE-EXPORT-004:
    - /setup/ops_security_fixture
    - /oracle/export
    - /oracle/restore_rejection
    - /oracle/official_state
    - /forbidden
full_case_set: none
```

## Frozen Oracle

### Package

- case set: `diet-manager/core-acceptance-cases-v1`, version `1.2.0`
- fixture catalog: `diet-manager/core-fixtures-v1`, version `1.2.0`
- cumulative case count: `20`
- original case count: `14`, values unchanged
- ops/security case count: `6`, appended in brief order
- original domain scenario count: `9`, values unchanged
- ops/security scenario count: `6`
- adapters may rewrite Oracle: `false`

### CASE-PRIV-001

- external fields are exactly `normalized_name`, `brand`, `variant`, `specification`, `preparation_state`, `region`
- user identity, raw chat, full meal history, inventory, goals and API token are forbidden externally
- ordinary logs contain only redacted operation metadata
- missing credentials use cache/template/unknown fallback
- business writes: `0`; unknown nutrition is not filled with zero

### CASE-FOUNDATION-002

- official before/after manifest covers JSONL/SQLite-like files and sidecars
- official added/modified/deleted: `0/0/0`
- failure still runs after scan, cleanup and redacted evidence
- path escapes and temporary residuals: `0`
- technical logs are separate and never count as dietary data

### CASE-OPS-001

- read-only preflight and package hash verification occur before any create/migrate step
- installation uses staging and atomic promotion
- B schema initializes empty; formal JSONL and sample business data are absent
- isolated smoke data is cleaned
- official business records and impact both remain `0`
- receipt distinguishes PRODUCT and foundation versions

### CASE-OPS-003

- verified backup and rehearsal precede formal migration
- injected migration failure prevents activation and success receipt
- old data remains readable
- old product/schema version remains authoritative
- partial target is not visible
- retry starts a fresh controlled attempt

### CASE-OPS-010

- one frozen candidate file changes after gates complete
- changed hash differs from candidate manifest
- candidate and prior evidence become invalid
- promotion/rebuild/patch/substitution are forbidden
- new manifest, affected gates and release decision are required

### CASE-EXPORT-004

- minimal user export remains readable and versioned
- it lacks full backup manifest, Schema, idempotency state and integrity proof
- restore returns `not_restorable_backup`
- official replacement/deletion/migration/version changes: `0`
- only a separately verified backup may enter restore

## Stable forbidden outcomes

- external disclosure of user identity, raw chat, history, inventory, goals or secrets
- secret or raw business content in ordinary logs/evidence
- after-scan skipped on failure or an official sidecar omitted
- test/sample business data in official storage
- package hash mismatch accepted or partial installation promoted
- migration failure advancing version, hiding old data or exposing partial target
- changed candidate bytes promoted with old evidence
- minimal export mislabeled as backup
- official data replaced or deleted before restore-source validation
- technical log counted as a dietary/business record

## Absolute roots

- source_root: `E:\codx\skill\饮食管家`
- shared_root: `E:\codx\skill\饮食管家\shared`
- cases_root: `E:\codx\skill\饮食管家\shared\acceptance-cases`
- isolated_worktree_root: `E:\codx\skill\.worktrees\diet-manager-b-sh-case-003`
- product_data_root: not created by this task
- isolated_test_data_root: not needed; validators are read-only

## Governance links

- risk_ids: `RISK-012`, `RISK-016`, `RISK-017`
- debt_ids: `DEBT-002`, `DEBT-007`
- decision_ids: `DEC-023`, `DEC-027`, `DEC-028`
- evidence_class: `E-CASE`

## Verification commands

Run `validate-ops-security-acceptance-cases.ps1`, the existing core/domain acceptance validators and the six non-protected shared contract/model validators with Windows PowerShell 5.1. Also require strict JSON, Parser=0, ASCII/CR/NUL gates, `git diff --check`, exact cumulative IDs, previous-value preservation, protected changed-path count zero, no business candidate files and no temporary residual.

Do not execute protected domain-schema validators.

## Completion and reopen

Completion requires six focused cases, six fixtures, twelve rejected mutations, all permitted regressions, independent P0=0/P1=0, evidence and detailed progress closure. Reopen when any selected case behavior, root rule, privacy allowlist, candidate rule, package/backup/export format or related shared contract changes. Adding later registered cases without changing these twenty values does not itself invalidate this evidence.
