# B-SLICE-001 candidate gate report — Stage A

## Result

Candidate `074fd30465eded2b650e0e00dadfca98ec363abc` on `agent/b-slice-001-vertical` passed the complete allowed local gate without a source change between the first and last gate commands. Beginning and ending Git status were clean. This is a review-input report only; it is not final E-STOR/E-CASE evidence and does not complete the work item.

not installable; public OpenClaw tool remains non-writing.

## Runtime and command evidence

| Gate | Result |
| --- | --- |
| Node runtime | `v24.15.0` verified before every command block |
| Plugin full Vitest | PASS: 7 files, 147 tests (`vitest 2.1.9`) |
| TypeScript no-emit | PASS (`typescript 5.9.3`) |
| Repository concurrency harness | PASS: same identity 2; conflict 1+1; effects 2; finalizer failure 1; other fact 1; uncommitted crash visibility 0; business rows exactly once |
| B-slice crash harness | PASS: no surviving child, temporary database, or log residue |
| Local plugin build check | PASS (`openclaw 2026.7.1`): metadata up to date |
| Local plugin validate | PASS: plugin valid |
| X-GATE-001 self-test | PASS: 13 cases; 7 checks; decision `pass_b_safety`; 6 mutations |
| Shared traceability self-test | PASS: requirements 71; cases 144; tasks 59; governance 63; evidence 30; mutations 7 |
| Shared acceptance | PASS: 22 tests, including the exact 17/17 B G2 responsibility set and mutation checks |
| Public foundation boundary | PASS: 13 tests; every action returns `foundation_not_implemented` with `committed:false` |

The acceptance driver creates a fresh test-owned database for each case and cleans it up. The post-gate residual scan found no B-slice test database or log residue. `shared/selected-route-map.json` is absent. Static checks of B source, B tests, and the acceptance driver found no model-call or network-call pattern; no OpenClaw model invocation was made.

Only the safe shared commands were used. `validate-traceability.mjs --self-test` was statically reviewed to confirm it does not load protected lease files. `validate-x-gate-001.mjs --self-test` passed: it stores protected path names only to compare with Git-returned names, does not read/hash/execute those files, and hashes only declared dependency evidence paths. The Stage B plan's `shared/traceability/evidence.json` filename is a documentation error: the existing, validator-owned mirror is `shared/traceability/evidence-index.json`.

## G2 case assertions

Each case is asserted independently by the `EXPECTED` observation map and the `executes exactly the G2 B-only responsibility set` test in `shared/acceptance-cases/tests/b-slice.test.ts`; its real observation builder is in `shared/acceptance-cases/adapters/b-slice-driver.ts`, and underlying local SQLite boundary assertions are in `version-b-lite-plugin/tests/vertical-slice.test.ts`.

| Case | Assertion paths | Observed responsibility |
| --- | --- | --- |
| `CASE-MIXED-001` | `b-slice.test.ts`; driver `runMixed` (589); `vertical-slice.test.ts` | ordered mixed commit, inventory sequence, single finalization |
| `CASE-CORR-001` | `b-slice.test.ts`; `runCorrection` (654); `vertical-slice.test.ts` | append-only correction, compensation, exact replay |
| `CASE-QUERY-001` | `b-slice.test.ts`; `runQuery` (717); `vertical-slice.test.ts` | current-view query has zero business writes |
| `CASE-EFFECT-001` | `b-slice.test.ts`; `runEffectFailure` (756); `vertical-slice.test.ts` | retryable effect failure, restart, and same-key retry |
| `CASE-MEAL-006` | `b-slice.test.ts`; `runMeal006` (857); `vertical-slice.test.ts` | multi-item meal and exact nutrition sources |
| `CASE-NUTR-008` | `b-slice.test.ts`; `runNutrition008` (895); `vertical-slice.test.ts` | estimated adoption amount is explicit |
| `CASE-MEAL-003` | `b-slice.test.ts`; `runMeal003` (933); `vertical-slice.test.ts` | nutrition adoption remains separate from inventory deduction |
| `CASE-MEAL-004` | `b-slice.test.ts`; `runMeal004` (968); `vertical-slice.test.ts` | outside item does not alter inventory |
| `CASE-INVENTORY-003` | `b-slice.test.ts`; `runInventory003` (1002); `vertical-slice.test.ts` | ambiguous inventory creates an Issue rather than selecting |
| `CASE-INVENTORY-004` | `b-slice.test.ts`; `runInventory004` (1034); `vertical-slice.test.ts` | insufficient inventory remains nonnegative |
| `CASE-NUTR-001` | `b-slice.test.ts`; `runNutrition001` (1066); `vertical-slice.test.ts` | product-label nutrition profile/snapshot |
| `CASE-NUTR-002` | `b-slice.test.ts`; `runNutrition002` (1103); `vertical-slice.test.ts` | frozen public-fixture nutrition profile |
| `CASE-NUTR-005` | `b-slice.test.ts`; `runNutrition005` (1121); `vertical-slice.test.ts` | versioned nutrition history preserves old snapshots |
| `CASE-STORAGE-001` | `b-slice.test.ts`; `runStorage001` (1153); `vertical-slice.test.ts` | exact replay creates no extra business state |
| `CASE-RECEIPT-001` | `b-slice.test.ts`; `runReceipt001` (1184); `vertical-slice.test.ts` | sanitized structured receipt and final progress block |
| `CASE-RECEIPT-003` | `b-slice.test.ts`; `runReceipt003` (1205); `vertical-slice.test.ts` | stable quick options and free-text digest |
| `CASE-PROGRESS-010` | `b-slice.test.ts`; `runProgress010` (1231); `vertical-slice.test.ts` | two child contributions freeze one aggregate progress/receipt |

## Reproducible RED → commit → GREEN history

| RED/fault name | Fix commit | GREEN assertion path/command |
| --- | --- | --- |
| deterministic protocol and four-amount separation | `7283e3a` | historical RED title unavailable in retained artifacts; GREEN `B-SLICE-001 pure domain rules`; `vitest run tests/domain-rules.test.ts` |
| ordered child FactCommit/EffectBundle/finalization | `ddf3ed0` | historical RED title unavailable in retained artifacts; GREEN `commits purchase then meal under one authority and freezes ordered mixed results`; `vitest run tests/repository.test.ts` |
| purchase and inventory projection | `4503be6` | historical RED title unavailable in retained artifacts; GREEN `adds two boxes of 12 milk cartons and queries one 24-carton batch`; `vitest run tests/vertical-slice.test.ts` |
| meal nutrition/progress and receipt finalization | `d9ccaeb`, `007afdc` | historical RED title unavailable; GREEN `CASE-MEAL-006` / `CASE-RECEIPT-001`; `vitest run tests/vertical-slice.test.ts` |
| append-only correction/undo | `1748548` | historical RED title unavailable; GREEN `CASE-CORR-001`; `vitest run tests/vertical-slice.test.ts` |
| ordered mixed envelope | `54af295` | historical RED title unavailable; GREEN `CASE-MIXED-001 adds 24 cartons, drinks one, and finalizes once at 23`; focused `vitest run tests/vertical-slice.test.ts -t "CASE-MIXED-001"` |
| 17-case authority and mutation rejection | `4dad227` | GREEN `executes exactly the G2 B-only responsibility set` and `the independent expectations reject mutations at the real observation boundary`; Node `--test shared/acceptance-cases/tests/b-slice.test.ts` |
| crash/restart/redaction/cleanup | `569a3e3`, `c5ac0b9`, `37e3030` | fault knob `after_fact_commit` / `after_effect_bundle` / `after_finalize_before_reply`; `node tests/b-slice-crash-harness.mjs` |
| P1-1 negative observed amount visible after FactCommit | `4fd6ab7`, artifact `7b83215` | RED `DOMAIN_RULE_INVALID:observed_microunits` with event/item/outbox/checkpoint rows; GREEN `rejects an invalid meal amount before FactCommit and keeps it query-invisible`; focused Vitest then 139-test gate |
| Fix2 overflow/accessor/custom-array preflight | `3a253b8` | RED: `DOMAIN_RULE_INVALID:nutrition_scaled` after FactCommit, getter hit 1, custom `entries` hit 1; GREEN named Fix2 regressions; focused 4 tests then 142-test gate |
| Fix3 aggregate meal/correction nutrition and descriptor boundaries | `ca0d9ea`, metadata `cbf9811` | RED: two-item `nutrition_sum` and correction `nutrition_scaled` appeared after FactCommit; symbol/non-enumerable descriptors were accepted. GREEN `rejects multi-item nutrition summation overflow before FactCommit and keeps it query-invisible`, `rejects correction nutrition scaling overflow before FactCommit and keeps the correction query-invisible`, and `rejects envelope symbols and non-enumerable array indexes before reading or writing`; focused 3 tests, compatibility 3 tests, then 145-test frozen gate |
| Fix4 cross-envelope daily-progress preflight | `074fd30` | RED: the meal left a second event/item, two outboxes, checkpoint, nutrition profile and snapshot; the correction left its event/row, two outboxes and checkpoint. GREEN `rejects cross-envelope daily progress overflow before meal FactCommit and keeps prior meals visible` and `rejects cross-envelope daily progress overflow before correction FactCommit and keeps the correction query-invisible`; focused 2 tests, compatibility 7 tests, then 147-test frozen gate |

## Deferred work

Non-G2 work remains deferred: `record_water`, network nutrition lookup, model parsing, rich weekly review, templates, installer/release work, selected-route mapping, MCP, and the complete B fault matrix. `B-FAULT-001` remains not started. No dependencies were added, no installation or publication occurred, and no final traceability/evidence status was changed.

## Stage A limitation

Independent review is pending. Therefore `B-SLICE-001` is not marked complete, no `B-SLICE-001-review.md` or `EV-20260812-031-b-slice-001.md` has been created, and no progress, plan, completion trace, or plan-checkbox change has been made.
