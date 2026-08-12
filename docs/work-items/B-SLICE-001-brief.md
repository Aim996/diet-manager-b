# B-SLICE-001 candidate brief — Stage A

## Candidate

- Candidate SHA: `dc96175a3369752fa0247d701718011934113227`
- Branch: `agent/b-slice-001-vertical`
- Stage: A — candidate freeze and review inputs only
- Full responsibility set: `G2_VERTICAL_SLICE_B_ONLY` (17 cases)
- Scope: one local, non-installable B vertical-slice candidate. The public OpenClaw tool remains non-writing; the internal domain service is exercised only by local test and acceptance drivers.

## Gate boundary

The candidate started clean at the SHA above and remained at that SHA throughout the gate sequence. The final status check found no tracked or untracked repository changes, `shared/selected-route-map.json` absent, and no test-owned B-slice database or log residue. All Node commands used the task-mandated Node `v24.15.0`; no model calls were made.

The allowed shared validators were limited to `shared/tests/validate-traceability.mjs` and the established shared acceptance tests. `shared/tests/validate-x-gate-001.mjs` was intentionally not run: static inspection shows it references protected lease files. The trace validator was statically confirmed not to reference those files. The planned Stage B filename `shared/traceability/evidence.json` does not exist; the established mirror is `shared/traceability/evidence-index.json`.

## Case assertions

case_assertion_paths:
  CASE-MIXED-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-CORR-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-QUERY-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-EFFECT-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-006:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-008:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-MEAL-004:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-INVENTORY-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-INVENTORY-004:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-002:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-NUTR-005:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-STORAGE-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-RECEIPT-001:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-RECEIPT-003:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts
  CASE-PROGRESS-010:
    - shared/acceptance-cases/tests/b-slice.test.ts
    - version-b-lite-plugin/tests/vertical-slice.test.ts

full_case_set: `G2_VERTICAL_SLICE_B_ONLY`

## Stage A disposition

This brief does not mark `B-SLICE-001` complete. Final review, evidence creation, progress/plan status, traceability completion, and plan checkbox changes are reserved for Stage B after an independent P0=0/P1=0 verdict.
