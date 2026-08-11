# SH-CASE-003 Candidate Report

## Candidate identity

- task: `SH-CASE-003`
- branch: `agent/sh-case-003-ops-security-oracles`
- base: `33e51b773be66b78581e7a3d13fdd95e86c8f6a4`
- candidate implementation head: `3f120a0e6ac037c4a071d9fce7db089cb212335e`
- status: `candidate_review_pending`
- product state: Oracle/fixtures only; not installable and not production-ready
- OpenClaw use: `0`

## Implemented

- cumulative case catalog `1.2.0`, twenty exact ordered cases
- six new cases: privacy, foundation zero difference, clean install, interrupted migration, candidate byte drift and invalid export restore
- cumulative fixture catalog `1.2.0`
- six independent `ops_security_scenarios`
- exact logical paths, UTF-8 Base64 bytes, lengths, SHA-256 values and timestamps for file-like fixtures
- focused Windows PowerShell 5.1 validator with library-only fixture/case entry points
- twelve real anti-weakening mutations
- cumulative suffix compatibility in the existing core/domain validators without changing their owned subset assertions

## TDD record

### RED

The first focused run used the unchanged `1.1.0` catalog and exited `1` with:

```text
OPS_SECURITY_CASE_SET_VERSION_INVALID:expected=1.2.0:actual=1.1.0
```

After fixture assertions were added but before fixture data, the fixture-only validator exited `1` with:

```text
OPS_SECURITY_FIXTURE_SHAPE_INVALID:root:property_count:expected=7:actual=6
```

After the six fixtures were added, the fixture-only entry point passed while the complete package remained RED at the case-set version gate. This proved fixtures independently before cases were appended.

### Initial GREEN

```text
OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=6|scenarios=6|mutations=0
DOMAIN_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=9|scenarios=9|mutations=11
CORE_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=5|fixtures=3|mutations=8
```

### Mutation GREEN

All twelve mutations were rejected by `Test-OpsSecurityCandidate`:

```text
MUT-OPS-DROP-REQUIRED-CASE
MUT-OPS-LEAK-RAW-CONTEXT
MUT-OPS-LEAK-SECRET-TO-LOG
MUT-OPS-HIDE-OFFICIAL-SIDECAR-DIFF
MUT-OPS-SKIP-AFTER-SCAN-ON-FAILURE
MUT-OPS-INSTALL-SAMPLE-BUSINESS-RECORD
MUT-OPS-ACCEPT-PACKAGE-HASH-MISMATCH
MUT-OPS-ADVANCE-VERSION-ON-MIGRATION-FAILURE
MUT-OPS-LOSE-OLD-STATE-ON-MIGRATION-FAILURE
MUT-OPS-PROMOTE-CHANGED-CANDIDATE
MUT-OPS-TREAT-EXPORT-AS-BACKUP
MUT-OPS-DELETE-BEFORE-RESTORE-REJECTION
```

Final focused output:

```text
OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=6|scenarios=6|mutations=12
```

## Behavior frozen by this package

- External nutrition requests use a six-field allowlist and exclude user identity, raw chat, history, inventory, goals and secrets.
- Ordinary logs are redacted; a technical log is allowed separately but never counts as dietary/business data.
- Validation failures still produce an after manifest, include official sidecars, perform cleanup and prove official added/modified/deleted counts are zero.
- Clean installation is preflight-first, package-hash-first, staging-based, SQLite-only, empty of business records and isolated-smoke-clean.
- Migration failure leaves old bytes readable, keeps old product/schema versions active, hides partial target state and requires a fresh attempt.
- Any candidate byte change invalidates the candidate and old evidence; promotion/rebuild/patch/substitution are forbidden.
- A minimal user export remains readable but is rejected as a full restore source before any official replacement, deletion or migration.
- Failed writes may produce redacted technical evidence but produce zero dietary/business records.

## Preservation and hygiene

- original fourteen case JSON values: unchanged
- original `package_invariants`: unchanged
- original environments/goals/query/domain fixtures: unchanged
- original domain scenario count: `9`
- protected changed-path count: `0`
- business candidate changed-path count: `0`
- new validator Parser errors: `0`
- all three acceptance validators ASCII: true
- all three acceptance validators CR/NUL count: `0/0`
- strict JSON parse: PASS for both cumulative catalogs
- `git diff --check`: PASS
- candidate worktree before report creation: clean

## Full permitted regression

All commands used Windows PowerShell `5.1` and ran serially:

| Validator | Exit | Elapsed ms | Final output |
|---|---:|---:|---|
| `validate-ops-security-acceptance-cases.ps1` | 0 | 1361 | `OPS_SECURITY_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=6|scenarios=6|mutations=12` |
| `validate-domain-acceptance-cases.ps1` | 0 | 1020 | `DOMAIN_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=9|scenarios=9|mutations=11` |
| `validate-core-acceptance-cases.ps1` | 0 | 719 | `CORE_ACCEPTANCE_CASES|PASS|version=1.2.0|cases=5|fixtures=3|mutations=8` |
| `validate-business-contract-v2.ps1` | 0 | 410 | `CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10` |
| `validate-receipt-and-date-contract-v2.ps1` | 0 | 397 | `RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10` |
| `validate-issue-correction-contract-v2.ps1` | 0 | 439 | `ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12` |
| `validate-core-model-schemas.ps1` | 0 | 846 | `CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4` |
| `validate-nutrition-progress-schemas.ps1` | 0 | 1259 | `NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4` |
| `validate-issue-correction-mixed-schemas.ps1` | 0 | 1386 | `ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4` |

Protected domain-schema validators were not read or executed.

## Candidate hashes

| Path | Length | SHA-256 |
|---|---:|---|
| `shared/acceptance-cases/cases.json` | 24042 | `25EB44E3DBB0813457D62136C9C94C7AEF6C5B43AE7C1CCAB11360FF62090163` |
| `shared/acceptance-cases/fixtures/core-v1.json` | 21757 | `E4069D2EB2FCE22B191657BDE91CDFF737597891F3CA0535AA22C5BA6FE16C60` |
| `shared/tests/validate-core-acceptance-cases.ps1` | 27712 | `A514364092E5CA6B7E0158B1A5E14196FE494C8F5AC7C3B53BCDBC0A99E4FC07` |
| `shared/tests/validate-domain-acceptance-cases.ps1` | 35127 | `E17260460D14E620958234428399DD1F4C8B7E744E299ECD661A917938BDCB4F` |
| `shared/tests/validate-ops-security-acceptance-cases.ps1` | 64623 | `3E099833058FFE33A2CAB039AA0061CE14C0A55F020A6D0942C36C4DFBE2F989` |
| `docs/work-items/SH-CASE-003-brief.md` | 7540 | `0096182DA20DC548A03C22F5D62AEB8DBA3F8579D19F052838FB0828A3DFF043` |
| `docs/superpowers/specs/2026-08-11-sh-case-003-design.md` | 12127 | `D5B1F1CC07F90632165A7DD0036AD86568C66A0E8D519561484F00B26D51E20A` |
| `docs/superpowers/plans/2026-08-11-sh-case-003-plan.md` | 17198 | `27DC0F6DEBCBC0C9BB9E952A6248AF6055B378F3192F3762D7DEA828D20190D6` |

## Discovered and corrected

- Removed an unnecessary design coupling between privacy lookup and a separately committed meal fact; the privacy case is now a pure zero-business-write query Oracle.
- Added fixture-only and case-only validation entry points so fixture GREEN cannot be hidden behind a later cumulative case RED.
- Used independently recomputed Base64 length/SHA checks instead of trusting declared hashes.
- Kept deletion scope bounded to zero deletion before invalid restore rejection; standalone uninstall deletion was not pulled forward.

## Pending

- independent P0/P1 review
- final review/evidence documents and Plan 0.3 status closure
- `SH-CASE-004`
- B adapter/harness and all product implementations
- installer, migration, backup/restore, uninstall/delete and release code

## Completion boundary

This candidate must not be marked complete until an independent reviewer reports P0=0/P1=0. No OpenClaw capacity was consumed during implementation. Until review, progress and Plan 0.3 completion fields remain unchanged.
