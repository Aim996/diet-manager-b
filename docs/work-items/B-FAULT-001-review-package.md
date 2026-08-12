# B-FAULT-001 Stage A Independent Review Package

## Candidate identity and verdict boundary

- Implementation/dist candidate: `b8bdbf207e4eda52eb395989b42e159d554cb078`
- Plan baseline: `1ee40731a6d90c43e016ab04eb37ba85a54992ae`
- Expected branch: `agent/b-fault-001`
- Current status: **candidate; independent review pending**
- P0/P1: **unassessed**
- Ready: **NO** until an independent reviewer returns P0=0 and P1=0.

The reviewer must not create `EV-20260812-032`, mark the task complete, write Ready YES on behalf of this package, update closure progress/trace files, push, or open a PR.

## Safety boundary for the reviewer

Do not read, hash, execute, modify, or track these protected files or their validators:

```text
shared/contracts/data-model.md
shared/schemas/domain.schema.json
shared/schemas/fixtures/domain-cases.json
shared/tests/validate-domain-schema.mjs
shared/tests/validate-domain-schema.ps1
```

Do not inspect `version-b-lite-plugin/src/storage/migration-v1.ts` content. Do not run a validator that loads any protected path. Use only explicit safe paths and `Select-String`; do not use repository-wide search.

## Review inputs

Read the B-FAULT plan/spec, `docs/work-items/B-FAULT-001-brief.md`, this package, `docs/work-items/B-FAULT-001-report.md`, and the Task 1–7 reports/reviews in `.superpowers/sdd/2026-08-12-b-fault-001-implementation/`. Review the candidate delta from the plan baseline, with particular attention to:

- `shared/acceptance-cases/b-fault-matrix.json`
- `shared/acceptance-cases/tests/b-fault-matrix.test.ts`
- `version-b-lite-plugin/src/domain/effect-bundle.ts`
- `version-b-lite-plugin/src/domain/service.ts`
- `version-b-lite-plugin/src/preview/store.ts`
- the three corresponding `version-b-lite-plugin/dist/**.js` files
- `version-b-lite-plugin/tests/fault-matrix.test.ts`
- `version-b-lite-plugin/tests/vertical-slice.test.ts`
- `version-b-lite-plugin/tests/b-slice-crash-worker.mjs`
- `version-b-lite-plugin/tests/b-slice-crash-harness.mjs`

## Required review questions

The independent verdict must explicitly assess:

1. All seven frozen case observations and all 18 ordered fault rows are executable, mutation-sensitive, and use the matrix rather than a weaker handwritten oracle.
2. Stable single-meal recovery reconstructs terminal result from frozen Fact/Effect authority without rerunning effects and permits unrelated later repository revision changes.
3. Correction outboxes follow guarded `pending|retryable_failed -> processing -> terminal` transitions, with correct attempts/reasons and full rollback.
4. EffectBundle/finalizer fault diagnostics contain exactly `stage`, `error_code`, `trace_id`, and `input_digest`; sink failure cannot replace the primary error; source/SQL/secret/path are not leaked.
5. Storage, stale-preview, terminal-conflict, and response-loss observations do not invent deferred product features.
6. Crash modes prove real process termination, exact immutable state, one-time recovery, frozen bytes, timeout/no-survivor behavior, and fail-closed cleanup. Review the Task 7 correction digest refresh as a consequence of Task 3's newly built legal attempt count, not as an automatically learned oracle.
7. `src` and `dist` are synchronized for the three changed modules; no extra generated or dependency artifact exists.
8. Public OpenClaw action schema and `src/index.ts` remain unchanged; internal fault seams are not public; selected-route map remains absent; no model/network call was added.
9. Task-owned Node/process/temp residue is zero and the 20 pre-existing temp paths were correctly treated as unowned baseline rather than silently deleted.
10. The retained migration search-output concern is disclosed accurately, and Task 7 introduced no new occurrence.

## Reproduction commands

Use this exact Node binary and run commands serially. Do not substitute npm scripts that rebuild dist.

```powershell
$nodeExe = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
& $nodeExe --version

Set-Location version-b-lite-plugin
& $nodeExe .\node_modules\typescript\bin\tsc -p .\tsconfig.json --noEmit
& $nodeExe .\node_modules\vitest\vitest.mjs run .\tests\fault-matrix.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe .\node_modules\vitest\vitest.mjs run --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe .\tests\repository-concurrency.mjs
& $nodeExe .\tests\progress-reservation-concurrency.mjs
& $nodeExe .\tests\b-slice-crash-harness.mjs
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins build --check --root . --entry .\dist\index.js
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins validate --root . --entry .\dist\index.js

Set-Location ..
& $nodeExe --experimental-strip-types --test --test-concurrency=1 .\shared\acceptance-cases\tests\harness.test.ts
& $nodeExe --experimental-strip-types --test --test-concurrency=1 .\shared\acceptance-cases\tests\b-slice.test.ts
& $nodeExe --experimental-strip-types --test --test-concurrency=1 .\shared\acceptance-cases\tests\b-fault-matrix.test.ts
& $nodeExe .\shared\tests\validate-traceability.mjs --self-test
& $nodeExe .\shared\tests\validate-x-gate-001.mjs --self-test
git diff --check
Test-Path -LiteralPath .\shared\selected-route-map.json
```

Run the nine crash self-tests one at a time using `B_SLICE_CRASH_SELFTEST` values `hang`, `root-replace`, `snapshot-mutation`, `emergency-cleanup`, `allowed-mutation`, `expanded-fact-mutation`, `expanded-effect-mutation`, `expanded-finalize-mutation`, and `canonical-order`. Clear the environment variable after each run.

## Recorded Stage A evidence

- noEmit/build: exit 0; sole formal build generated 3 matching dist files.
- B fault matrix: 73/73.
- full plugin Vitest: 230/230 in 8 files.
- crash: main harness plus 9/9 self-tests PASS after one documented RED/fix cycle.
- shared protocol/B/B-fault acceptance: 15 + 7 + 2 tests PASS; B suite includes exact 17/17 cases.
- trace: 71 requirements / 144 cases / 59 tasks / 64 governance / 31 evidence / 7 mutations.
- X-GATE: 13 cases / 7 checks / 6 mutations.
- every boundary: pinned/task Node `0`; new temp residue relative to frozen baseline `0`.

## Required verdict format

Return one independent review document with reviewed range/SHA, spec compliance, code/test quality, separate P0/P1/P2 counts, concrete file/line evidence for every finding, concern assessment, and a final Ready YES/NO. Any P0 or P1 forces Ready NO and blocks Stage B closure.
