# B-SLICE-001 candidate gate report — Stage A

## Result

Code/test candidate `c8e6bcef39d0f98452432c3331095d963b9b9778` on `agent/b-slice-001-vertical` passed the complete allowed local gate without a source change between the first and last gate commands. Beginning and ending Git status were clean. This is a refreshed review-input report only; it is not an independent verdict and does not complete the work item.

not installable; public OpenClaw tool remains non-writing.

## Runtime and command evidence

| Gate | Result |
| --- | --- |
| Node runtime | `v24.15.0` verified before every command block |
| Plugin full Vitest | PASS: 7 files, 153 tests (`vitest 2.1.9`; one worker, no file parallelism) |
| TypeScript no-emit | PASS (`typescript 5.9.3`) |
| TypeScript build / tracked dist | PASS; source and generated runtime artifacts synchronized |
| Repository focused Vitest | PASS: 31 tests (one worker, no file parallelism) |
| Repository concurrency harness | PASS: same identity 2; conflict 1+1; effects 2; finalizer failure 1; other fact 1; uncommitted crash visibility 0; business rows exactly once |
| Daily-progress reservation two-connection harness | PASS: competing connection rejected with `PROGRESS_RESERVATION_AUTHORITY_INVALID:base_changed`; events/items/outboxes/checkpoints/finalizations all 0; envelope stayed `received` |
| B-slice crash harness | PASS: no surviving child, temporary database, or log residue |
| Local plugin build check | PASS (`openclaw 2026.7.1`): metadata up to date |
| Local plugin validate | PASS: plugin valid |
| X-GATE-001 self-test | PASS: 13 cases; 7 checks; decision `pass_b_safety`; 6 mutations |
| Shared traceability self-test | PASS: requirements 71; cases 144; tasks 59; governance 63; evidence 31; mutations 7 |
| Shared acceptance | PASS: 22 tests, including the exact 17/17 B G2 responsibility set and mutation checks |
| Public foundation boundary | PASS: 13 tests; every action returns `foundation_not_implemented` with `committed:false` |

The acceptance driver creates a fresh test-owned database for each case and cleans it up. The post-gate residual scan found no B-slice test database or log residue. `shared/selected-route-map.json` is absent. Static checks of explicitly named B source, B tests, and acceptance paths found no model-call or network-call pattern; no OpenClaw model invocation was made. All larger suites ran serially with one worker, and the owned validation-node process count returned to zero at every suite boundary.

The two-connection reservation harness gives every synchronization barrier a 10-second hard deadline, consumes worker failures, bounds `worker.terminate()`, closes both SQLite runtimes, and removes the owned temporary database root in `finally`. The crash harness independently verifies that no child, database, or log residue survives.

The permitted shared x-gate and trace commands were used. `validate-traceability.mjs --self-test` was statically reviewed to confirm it does not load protected lease files. `validate-x-gate-001.mjs --self-test` passed: its protected-path Set compares names from Git output and its SHA reads are limited to declared dependency evidence paths. Git diff/status evidence shows no protected-path change. A separate read-only `rg` scope incident during evidence collection may have opened paths beyond the explicitly intended safe test files; it emitted no protected-file content and did not hash, execute, modify, or track a protected file, but absence of a low-level file open cannot be proved. The exact incident is retained in the internal task ledger, and every later content search used explicitly named safe paths plus PowerShell filtering. The Stage B plan's `shared/traceability/evidence.json` filename is a documentation error: the existing, validator-owned mirror is `shared/traceability/evidence-index.json`.

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
| Fix5 terminal replay and stored-preview reuse before live preflight | `760e985` | Historical candidate RED: finalized mixed replay, finalized meal replay, and stored preview reuse re-entered live inventory/nutrition preflight after the environment changed. GREEN: `replays the byte-frozen mixed result without live nutrition preflight after the environment changes`, `replays the byte-frozen finalized meal without live inventory or nutrition preflight`, and `reuses a stored preview without live inventory or nutrition preflight`. |
| Fix6 transactional daily-progress reservation authority | `760e985`, crash fixture `c8e6bce` | Real two-connection RED left event=1, meal=1, outbox=2, checkpoint=1, finalization=0 before rejecting the conflicting finalization. GREEN rejects the competing first FactCommit with `base_changed`, leaves all five counts at 0, and keeps the envelope `received`. Exact descriptor/prototype parsing, contribution/replacement mode binding, single/mixed/correction paths, active reservation retention/release, crash/retry, public non-leakage, and dynamic-getter fail-closed regressions pass. |
| P2 chronology and whitespace corrections | `d639b2b` | Review chronology now records the still-open Fix1 findings accurately; trailing whitespace was removed from the two SH-HARNESS documents. |

## Deferred work

Non-G2 work remains deferred: `record_water`, network nutrition lookup, model parsing, rich weekly review, templates, installer/release work, selected-route mapping, MCP, and the complete B fault matrix. `B-FAULT-001` remains not started and cannot become the active implementation task until this refreshed candidate receives its independent verdict. No dependencies were added, no installation or publication occurred.

## Stage A limitation

Independent re-review of `c8e6bcef39d0f98452432c3331095d963b9b9778` is pending. The prior P0=0/P1=0/P2=0 verdict applied only to superseded candidate `074fd30465eded2b650e0e00dadfca98ec363abc` and is not transferred. Stage B must therefore record P0/P1/P2 as unassessed, Ready=NO pending review, and keep `B-SLICE-001` reopened until a new independent verdict exists.
