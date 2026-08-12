# B-SLICE-001 candidate brief — Stage A

## Candidate

- Candidate SHA: `3a253b854059f42dd3e3954ff9d0796e56591be8`
- Branch: `agent/b-slice-001-vertical`
- Stage: A — candidate freeze and review inputs only
- Full responsibility set: `G2_VERTICAL_SLICE_B_ONLY` (17 cases)
- Scope: one local, non-installable B vertical-slice candidate. The public OpenClaw tool remains non-writing; the internal domain service is exercised only by local test and acceptance drivers.

## Gate boundary

The candidate started clean at the SHA above and remained at that SHA throughout the complete gate sequence. The final status check found no tracked or untracked repository changes, `shared/selected-route-map.json` absent, no protected-path change, and no test-owned B-slice database or log residue. All Node commands used the task-mandated Node `v24.15.0`; no model calls were made.

The allowed shared validators were `shared/tests/validate-x-gate-001.mjs --self-test`, `shared/tests/validate-traceability.mjs --self-test`, and the established shared acceptance tests. The x-gate stores protected path names only to compare them with Git-reported changed names; it does not read, hash, execute, or modify those files. Its evidence SHA reads are limited to its declared dependency evidence paths. The trace validator was statically confirmed not to reference protected lease files. The planned Stage B filename `shared/traceability/evidence.json` does not exist; the established mirror is `shared/traceability/evidence-index.json`.

## Case assertions

case_assertion_paths:
  CASE-MIXED-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-CORR-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-QUERY-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-EFFECT-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-006:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-008:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-004:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-INVENTORY-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-INVENTORY-004:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-002:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-005:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-STORAGE-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-RECEIPT-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-RECEIPT-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-PROGRESS-010:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - shared/acceptance-cases/adapters/b-slice-driver.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts

full_case_set: `G2_VERTICAL_SLICE_B_ONLY`

## Observation-builder map

The assertion test dispatches each case to the named real observation builder in `shared/acceptance-cases/adapters/b-slice-driver.ts`: `CASE-MIXED-001` `runMixed` (589), `CASE-CORR-001` `runCorrection` (654), `CASE-QUERY-001` `runQuery` (717), `CASE-EFFECT-001` `runEffectFailure` (756), `CASE-MEAL-006` `runMeal006` (857), `CASE-NUTR-008` `runNutrition008` (895), `CASE-MEAL-003` `runMeal003` (933), `CASE-MEAL-004` `runMeal004` (968), `CASE-INVENTORY-003` `runInventory003` (1002), `CASE-INVENTORY-004` `runInventory004` (1034), `CASE-NUTR-001` `runNutrition001` (1066), `CASE-NUTR-002` `runNutrition002` (1103), `CASE-NUTR-005` `runNutrition005` (1121), `CASE-STORAGE-001` `runStorage001` (1153), `CASE-RECEIPT-001` `runReceipt001` (1184), `CASE-RECEIPT-003` `runReceipt003` (1205), and `CASE-PROGRESS-010` `runProgress010` (1231). The P1-1 focused SQLite regression is `rejects an invalid meal amount before FactCommit and keeps it query-invisible` in `version-b-lite-plugin/tests/vertical-slice.test.ts`.

Fix2 adds three more pre-FactCommit SQLite regressions in that test file: `rejects nutrition scaling overflow before FactCommit and keeps it query-invisible`, `rejects an accessor envelope without reading it or writing business rows`, and `rejects a custom operations array prototype without calling entries or writing rows`. `3a253b8` descriptor/prototype-clones untrusted envelopes before validation and reuses the no-write meal preflight for real nutrition scaling.

## Stage A disposition

This brief does not mark `B-SLICE-001` complete. Final review, evidence creation, progress/plan status, traceability completion, and plan checkbox changes are reserved for Stage B after an independent P0=0/P1=0 verdict.
