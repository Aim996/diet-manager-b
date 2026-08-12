# B-SLICE-001 independent review package — Stage A

## Candidate and review scope

Review candidate: `074fd30465eded2b650e0e00dadfca98ec363abc` on `agent/b-slice-001-vertical`.

Review the business semantics, operation grouping, replay identity, append-only corrections, read-only query behavior, failure-log redaction, crash/restart cleanup, public tool boundary, and dependency/open-source hygiene. This package contains only sanitized repository-relative evidence. It contains no tokens, user data, machine-private URLs, or protected-file content.

## Reproduction

From the repository root on the candidate SHA, set `$nodeExe` to the verified `v24.15.0` executable required by the Task 10 brief. Verify `& $nodeExe --version` outputs `v24.15.0` before each block.

```powershell
Set-Location version-b-lite-plugin
& $nodeExe .\node_modules\vitest\vitest.mjs run
& $nodeExe .\node_modules\typescript\bin\tsc -p .\tsconfig.json --noEmit
& $nodeExe .\tests\repository-concurrency.mjs
& $nodeExe .\tests\b-slice-crash-harness.mjs
& $nodeExe .\node_modules\typescript\bin\tsc -p .\tsconfig.json
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins build --check --root . --entry .\dist\index.js
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins validate --root . --entry .\dist\index.js
& $nodeExe .\node_modules\vitest\vitest.mjs run .\tests\foundation.test.ts
```

```powershell
Set-Location ..
& $nodeExe .\shared\tests\validate-x-gate-001.mjs --self-test
& $nodeExe .\shared\tests\validate-traceability.mjs --self-test
& $nodeExe --experimental-strip-types --test .\shared\acceptance-cases\tests\harness.test.ts
& $nodeExe --experimental-strip-types --test .\shared\acceptance-cases\tests\b-slice.test.ts
Test-Path .\shared\selected-route-map.json
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
```

Run the x-gate command above: its protected-path Set compares names from Git output only. It does not read, hash, execute, or modify a protected lease file; its SHA reads are only its declared dependency evidence paths. The traceability validator above was also statically confirmed not to reference a protected lease file. Do not otherwise read, hash, execute, or modify any protected lease file while reviewing.

## Fresh sanitized results

- Plugin gate: 7 files / 147 tests passed; TypeScript no-emit passed.
- Repository concurrency and B-slice crash harnesses passed; crash cleanup reported no surviving child, temporary database, or log residue.
- Local OpenClaw build check and validation passed; plugin metadata is current and the plugin is valid.
- X-GATE-001 self-test passed: 13 cases, 7 checks, `pass_b_safety`, and 6 mutation rejections.
- Shared trace self-test passed with 71 requirements, 144 cases, 59 tasks, 63 governance records, 30 evidence records, and 7 mutations.
- Shared acceptance passed 22 tests, including all 17 exact G2 B cases and their mutation checks.
- Foundation boundary passed 13 tests: `handleFoundationAction()` returns `foundation_not_implemented` and `committed:false` for every public action.
- Candidate SHA stayed unchanged; final worktree was clean, no protected path had changed, `shared/selected-route-map.json` was absent, and the residual scan found no test database or log.

## Review-path map and P1 regression

The case assertion test is `shared/acceptance-cases/tests/b-slice.test.ts`; the real observation builders are `runMixed` (589), `runCorrection` (654), `runQuery` (717), `runEffectFailure` (756), `runMeal006` (857), `runNutrition008` (895), `runMeal003` (933), `runMeal004` (968), `runInventory003` (1002), `runInventory004` (1034), `runNutrition001` (1066), `runNutrition002` (1103), `runNutrition005` (1121), `runStorage001` (1153), `runReceipt001` (1184), `runReceipt003` (1205), and `runProgress010` (1231) in `shared/acceptance-cases/adapters/b-slice-driver.ts`. SQLite behavior is in `version-b-lite-plugin/tests/vertical-slice.test.ts`.

P1-1 RED was the real SQLite regression `rejects an invalid meal amount before FactCommit and keeps it query-invisible`: before the fix, negative observed input threw only after FactCommit and left one event, one meal item, two outboxes, and one checkpoint. `4fd6ab7` adds complete runtime envelope validation and canonical deep freezing before preview/FactCommit; `7b83215` refreshes the runtime artifact. The focused GREEN and the full 139-test gate passed. Null nutrition/amount fields remain valid unknowns.

Fix2 adds descriptor/prototype-safe cloning before validation, then a no-write meal preflight which reuses real inventory matching and nutrition scaling. Its real SQLite REDs were (1) all six nutrients and adoption at `Number.MAX_SAFE_INTEGER` with basis `1`, which threw `DOMAIN_RULE_INVALID:nutrition_scaled` only after one event, one item, two outboxes, and one checkpoint; (2) an `envelope_id` accessor hit once; and (3) a custom operations-array `entries()` hit once. `3a253b8` makes all three fail before FactCommit with zero hits, zero business rows, and no query-visible meal; it preserves `null=unknown` fields and uses an in-memory preceding purchase candidate for the legitimate mixed preflight.

Fix3 retains that preflight boundary for the aggregate paths discovered in re-review. The real SQLite tests are `rejects multi-item nutrition summation overflow before FactCommit and keeps it query-invisible` and `rejects correction nutrition scaling overflow before FactCommit and keeps the correction query-invisible`; both now reject with zero new business rows and no query-visible partial write. `ca0d9ea` accumulates every scaled meal vector with `addNutritionVectors()` before FactCommit and preflights corrected nutrition across replace/undo/restore before append. The descriptor test `rejects envelope symbols and non-enumerable array indexes before reading or writing` confirms symbols and non-enumerable indexes are rejected while ordinary frozen arrays remain accepted. The focused three regression tests, existing unknown/undo/restore compatibility tests, full 145-test plugin gate, and complete frozen gate passed. `cbf9811` is the generated OpenClaw metadata-formatting commit included in the reviewed candidate.

Fix4 closes the remaining cumulative-progress boundary. The real SQLite tests are `rejects cross-envelope daily progress overflow before meal FactCommit and keeps prior meals visible` and `rejects cross-envelope daily progress overflow before correction FactCommit and keeps the correction query-invisible`. Before `074fd30`, the meal threw only in EnvelopeFinalize after leaving a second event/item, two outboxes, checkpoint, nutrition profile and snapshot; the correction threw after leaving its correction event/row, two outboxes and checkpoint. The finalizer now exposes its exact no-write authoritative snapshot read plus addition, meal preflight returns its contribution, and correction preflight returns its before/after vectors so execute can run the same projection before append. The finalizer transaction/CAS remains authoritative. Focused 2-test GREEN, the 7-test null/undo/restore/mixed/replay compatibility set, TypeScript no-emit, full 147-test plugin gate, and the complete frozen gate passed.

## Required verdict

Record independently found issues by priority. Stage B may proceed only with an explicit P0=0/P1=0 verdict. This package does not supply that verdict and does not complete `B-SLICE-001`.
