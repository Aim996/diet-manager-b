# B-FAULT-001 Final Fix Candidate Report

> Final whole-branch review superseded the prior Stage B closure after finding one P1 in mixed-operation diagnostics and two P2 documentation inconsistencies. The old candidate/evidence chain remains below as history; it no longer establishes current completion.

## Status

- Stage: **final fix candidate with replacement gates pending independent whole-branch review**
- Code/dist candidate: `552feee374fe3463f296bd4a110af11747a7ee29`
- Final-review finding baseline: **P0=0, P1=1, P2=2**; the technical P1 is implemented and locally verified, but no independent final verdict has accepted it.
- Ready: **NO**
- Formal closure evidence: **not yet available**; `EV-20260812-032` is retained as `SUPERSEDED_REOPENED`. Replacement gate evidence is frozen, but it has not yet been accepted by an independent whole-branch reviewer.

This report records a technical final-fix candidate only. It does not declare an independent verdict, mark `B-FAULT-001` complete, push, open/update a PR, or claim publication. Those states remain for the controller after actual external actions and final review.

## Final-fix technical delta

- Every production `appendPreparedOperationFact` call now uses one `appendFactWithFailure` adapter, including both real mixed purchase/meal repository append locations.
- Mixed purchase and meal effects now use one `runEffectWithFailure` catch/emit path with the exact four-field public diagnostic.
- A four-row mutation-sensitive test uses real SQLite repository append failures for both FactCommit positions and real effect transaction faults for both EffectBundle positions. It asserts exact stage/code/trace/digest, forbidden source/SQL/secret/path content, throwing-sink primary-error preservation, and all-business-table rollback on same-token retry.
- TDD RED was 4/4 failures at the missing diagnostics; focused GREEN is 4/4. Temporarily deleting the mixed purchase Effect wrapper made its dedicated case RED, and restoring it returned GREEN.

The remaining sections describe the prior Stage A evidence history unless explicitly marked as final-fix evidence.

## Final-fix replacement gate evidence

The final-fix candidate was built exactly once before evidence capture. From evidence-run HEAD `220088dc857f1f09fe31796fa841e9afe91838f2`, the existing capture authority then ran the complete 22-command suite strictly serially without another formal build. The normalized committed artifact is:

| Field | Frozen value |
| --- | --- |
| Candidate | `552feee374fe3463f296bd4a110af11747a7ee29` |
| Evidence-run HEAD | `220088dc857f1f09fe31796fa841e9afe91838f2` |
| Evidence commit | `74d8193debf1347b07a4c5e594f4b7c3f11c5828` |
| Log | `docs/evidence/B-FAULT-001-final-fix-gates.txt` |
| SHA list | `docs/evidence/B-FAULT-001-final-fix-gates.sha256` |
| Byte length | `71,063` |
| SHA-256 | `ECAC880CE676A0F2D64B1B1AAB13479058AA99CEF069CFC915442AC984B87F91` |
| Git blob | `492d3b66bbf30fa4f1a22a351025bf999c6714af` |
| Commands | `22`, sequences `001`–`022`, all exit `0` |

The replacement run passed TypeScript no-emit; fault matrix 73/73; full plugin 8 files / 234 tests; both concurrency harnesses; crash main plus 9/9 self-tests; OpenClaw build-check and validation; shared protocol 15/15; B acceptance 7/7; B fault authority 2/2; trace 71 requirements / 144 cases / 59 tasks / 64 governance / 32 evidence / 7 mutations; and X-GATE-001 self-test 13 cases / 7 checks / 6 mutations. Every command boundary recorded pinned/task Node `0`/`[]` and new temp `0`/`[]`. Complete stdout/stderr and byte counts are retained. The adjacent SHA list binds the normalized committed bytes above.

## Runtime and build ownership

All commands used the pinned executable:

```text
C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe
v24.15.0
```

For the final-fix wave, `--noEmit` and the focused/full relevant tests passed before one and only one formal `tsc -p tsconfig.json` build. That build changed only `version-b-lite-plugin/dist/domain/service.js`, matching the only changed production source module. Candidate `552feee374fe3463f296bd4a110af11747a7ee29` binds the source, tests, and generated artifact.

Historical Task 7 build record: Task 7 was the sole build/dist writer for the superseded candidate. It ran TypeScript `--noEmit` first and then exactly one formal build, which changed these generated files:

| Source | Generated artifact |
| --- | --- |
| `version-b-lite-plugin/src/domain/effect-bundle.ts` | `version-b-lite-plugin/dist/domain/effect-bundle.js` |
| `version-b-lite-plugin/src/domain/service.ts` | `version-b-lite-plugin/dist/domain/service.js` |
| `version-b-lite-plugin/src/preview/store.ts` | `version-b-lite-plugin/dist/preview/store.js` |

Explicit `Select-String` checks found the stable-meal reader, legal correction claim/finalize transitions, late EffectBundle seams, failure wrapper, and terminal repository-authority validator in both source and corresponding dist. `git diff --check` passed.

## Historical Task 7 fresh serial gate evidence

The suites ran strictly serially. Full Vitest never overlapped a concurrency or crash harness.

| Order | Gate | Fresh result |
| --- | --- | --- |
| 1 | TypeScript no-emit | PASS, exit 0 |
| 2 | Sole TypeScript build | PASS, exit 0 |
| 3 | B fault matrix Vitest | PASS, 1 file / 73 tests |
| 4 | Full plugin Vitest, one worker, no file parallelism | PASS, 8 files / 230 tests |
| 5 | Repository concurrency | PASS: same identity `2`, conflict `1+1`, effect `2`, one finalizer failure, one concurrent fact, crashed uncommitted rows visible `0`, business rows exactly once |
| 6 | Progress reservation concurrency | PASS: `base_changed`; event/item/outbox/checkpoint/finalization counts all `0`; envelope remained `received` |
| 7 | Crash recovery main harness | PASS: 11 expanded modes plus retained legacy cases; no surviving child/database/log residue |
| 8 | Crash harness self-tests | PASS, 9/9: hang, root replacement, snapshot mutation, emergency cleanup, allowed-table mutation, expanded Fact/Effect/Finalize mutations, canonical ordering |
| 9 | OpenClaw local build check | PASS: plugin metadata up to date |
| 10 | OpenClaw local validation | PASS: plugin `diet-manager-b` valid |
| 11 | Shared harness protocol | PASS, 15/15 |
| 12 | B G2 acceptance | PASS, 7/7 tests including exact 17/17 responsibility cases and mutation rejection |
| 13 | B fault authority | PASS, 2/2 tests; exact 18 rows and mutations |
| 14 | Trace self-test | PASS: requirements `71`, cases `144`, tasks `59`, governance `64`, evidence `31`, mutations `7` |
| 15 | X-GATE-001 self-test | PASS: cases `13`, checks `7`, decision `pass_b_safety`, mutations `6` |

## Historical fix round 1 immutable gate-output freeze

The Stage A review found that the table above summarized results but did not freeze complete command output. The unchanged code/dist candidate was therefore rerun from evidence-run HEAD `15d2c541074a1f25bf6c7fa560201c3503f5ad18`. No second formal build was run; command 001 reran noEmit and OpenClaw command 016 used `plugins build --check`.

| Artifact | Identity |
| --- | --- |
| Complete append-only gate log | `docs/evidence/B-FAULT-001-stage-a-gates.txt` |
| SHA list | `docs/evidence/B-FAULT-001-stage-a-gates.sha256` |
| Log byte length | `70,879` |
| Log SHA-256 | `433FF257E578C1461FE63E7191B7083AEF4583002CBDCA1C6E602E631466F69F` |
| Frozen candidate binding | `b8bdbf207e4eda52eb395989b42e159d554cb078` |
| Captured commands | `22`, all exit `0` |

For every command the log records sequence, name, working directory, exact PowerShell command, UTC start/end, complete sanitized stdout and stderr with UTF-8 byte counts, exit code, pinned/task Node process count and exact process list, and baseline/after/new temp counts and exact name lists. All 22 boundary process counts and new-temp counts are zero, with explicit empty arrays.

Output was not summarized or line-filtered. Deterministic redaction replaced only worktree, TEMP, and user-profile absolute prefixes with `<WORKTREE>`, `<TEMP>`, and `<USERPROFILE>`; the approved pinned Node path remains. An explicit audit found no unredacted worktree/user-profile prefix, protected/migration filename, bearer/API key, OpenAI-key, or JWT-shaped value.

## Crash-gate RED and minimal fix

The first fresh crash run failed before any crash self-test:

```text
B_SLICE_CRASH_HARNESS_FAILED:crash_boundary_outbox_attempt:correction:after_finalize_before_reply
actual=[{"state":"succeeded","attempt_count":1},{"state":"succeeded","attempt_count":1}]
```

Root cause: Task 5 intentionally did not build dist and froze its correction crash authority against the then-existing artifact, where correction attempt count was `0`. Task 3 had already established the legal production transition `pending|retryable_failed -> processing -> terminal` with `attempt_count=1`; the sole Task 7 build made the crash worker execute that corrected behavior for the first time.

TDD remediation was limited to `version-b-lite-plugin/tests/b-slice-crash-harness.mjs`:

1. The observed RED established that a completed correction Effect expects attempt `1`, while after-Fact remains `0`.
2. After changing only that boundary assertion, the immutable digest checks produced two further exact REDs for correction after-finalize and after-effect states.
3. Only those two correction crash digests and the correction terminal digest were refreshed. The frozen result byte length/SHA did not change.
4. The main harness then passed, followed by all 9 self-tests.

No production source was changed by this gate repair.

## Seven-case evidence summary

| Case | Executable observation |
| --- | --- |
| `CASE-EFFECT-001` | Fact is durable, failed nutrition EffectBundle is retryable, reopen is stable, same-token retry performs only unfinished effects and one finalization. |
| `CASE-EFFECT-002` | Inventory/Issue/progress late seams roll back the complete EffectBundle; diagnostics remain exact and redacted; retry performs the missing stage only. |
| `CASE-EFFECT-003` | Four finalizer transaction faults leave `effects_stable`; retry performs finalizer-only work and returns frozen terminal authority. |
| `CASE-STORAGE-005` | Three migration candidate faults do not publish; unknown/drifted existing databases retain exact bytes/SHA/user version. No migration-v1 content was read or changed. |
| `CASE-STORAGE-006` | Response loss after commit replays exact stored multi-date payload bytes after an unrelated later fact, without recomputation or writes. |
| `CASE-STORAGE-007` | Changed digest/subject/command produce stable idempotency conflicts only after successful-terminal authority validation; prior payload is not leaked and state is unchanged. |
| `CASE-INVENTORY-006` | Repository revision change invalidates a stale preview with zero event/item/outbox/checkpoint writes. |

## Scope and residue

- Explicit baseline-to-candidate path audit found `0` protected-path changes, `0` migration changes, `0` lock/dependency changes, `0` public `src/index.ts` changes, and `0` selected-route-map changes.
- `shared/selected-route-map.json` remains absent.
- Explicit `Select-String` over named B source/test paths found no new model/network call pattern.
- No model call was made.
- At every suite boundary, pinned/task Node process count was `0`.
- A start-of-task baseline captured 20 pre-existing `diet-manager-*` temporary paths. They were not treated as owned and were not deleted. Relative to that baseline, every boundary and the final scan reported `0` new task temp residue.

## Commit chain

Final-fix commits through immutable evidence freeze:

```text
31f3541 fix(b-fault): cover mixed failure diagnostics
552feee build(b-fault): regenerate mixed service artifact
220088d docs(b-fault): reopen final review closure
74d8193 test(b-fault): freeze final fix gate evidence
```

Historical implementation chain:

The candidate contains the following B-FAULT implementation chain after the plan baseline `1ee40731a6d90c43e016ab04eb37ba85a54992ae`:

```text
f902ff0 docs: design B fault matrix
ed5a297 docs: plan B fault matrix implementation
1cd3016 test: freeze B fault matrix authority
1322fae docs: freeze exact B fault rows
741cbf5 test: expand B fault matrix authority
438456d test: harden B fault authority assertions
9121941 fix: resume stable meal finalization
70c52b1 fix: harden stable meal recovery authority
8c06b54 fix: enforce correction effect transitions
978a741 test: add B domain fault matrix
0a50aef test: harden B fault matrix evidence
5d89768 test: bind exact B fault matrix oracle
5a9e26b test: expand B crash recovery matrix
f16aac5 test: bind B crash recovery authority
4bb07f3 test: close B storage fault cases
911f9f5 fix: validate B terminal fault authority
b8bdbf2 build: freeze B fault candidate artifacts
```

## Concerns and limitations

- Retained process concern: before Task 7, Task 6 and its first independent review each reported that a repository-wide search exclusion failed on Windows normalization and emitted matching `migration-v1.ts` lines. No direct read, hash, execution, modification, or use as technical evidence followed. Task 7 introduced no new such search/output concern: it used explicit safe paths and `Select-String` only.
- The three scope-limited matrix cases remain limited as frozen: no public catalog claim for `CASE-EFFECT-002`, no upgrade/backup-restore product for `CASE-STORAGE-005`, and no full IssueResolution interaction for `CASE-INVENTORY-006`.
- The first independent Task 7 review returned P0=0/P1=1/P2=1 because complete gate output was absent and the ledger lagged. The historical scoped rereview accepted that remediation for the old candidate. The later whole-branch review superseded its closure effect; no independent reviewer has yet accepted the final-fix candidate, so current Ready remains NO.
