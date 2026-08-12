# B-FAULT-001 Task 5 Report

## Status

Implementation and focused verification are complete. The crash worker and parent harness now cover real process termination and restart recovery for single meal, purchase, and correction operations at their durable Fact, Effect, and Finalize windows, while retaining the two mixed-envelope windows.

No production API, source module, generated `dist`, dependency, lockfile, public schema, MCP surface, selected map, or migration was changed.

## TDD evidence

The crash-mode exit expectations were added to the parent harness before the worker accepted any new mode.

First RED, using the pinned Node 24.15.0 executable:

```text
Error: B_SLICE_CRASH_HARNESS_FAILED:child_exit:meal_after_fact:1
```

This was the intended unknown-mode failure: the worker rejected `meal_after_fact` instead of reaching the durable boundary and exiting 73.

After adding the real boundary composition and the complete restart assertions, a second expected RED exposed the stable-meal limitation in the unbuilt baseline `dist`:

```text
Error: DIET_DOMAIN_EXECUTION_PENDING:effects_stable
```

This occurred when a single meal was sealed before restart. Task 5 explicitly forbids building or modifying `dist`, so the final matrix uses the actual existing transaction boundaries:

- Single meal, purchase, and correction crash after the terminal Effect commit but before envelope seal.
- Mixed purchase+meal retains the existing crash after seal but before finalization.
- Restart proves the completed single-operation Effect is not repeated, then completes seal and finalization exactly once.

## Implemented crash modes

Every invocation receives a fresh owned temp root and owner token and must terminate with exit code 73.

| Operation | Durable window | Worker mode |
| --- | --- | --- |
| Meal | Fact committed | `meal_after_fact` |
| Meal | Effect committed, before seal | `meal_after_effect_before_seal` |
| Meal | Finalized, before parent reply | `meal_after_finalize_before_reply` |
| Purchase | Fact committed | `purchase_after_fact` |
| Purchase | Effect committed, before seal | `purchase_after_effect_before_seal` |
| Purchase | Finalized, before parent reply | `purchase_after_finalize_before_reply` |
| Correction | Fact committed | `correction_after_fact` |
| Correction | Effect committed, before seal | `correction_after_effect_before_seal` |
| Correction | Finalized, before parent reply | `correction_after_finalize_before_reply` |
| Mixed purchase+meal | Sealed, before finalization | `mixed_after_seal_before_finalize` |
| Mixed purchase+meal | Finalized, before parent reply | `mixed_after_finalize_before_reply` |

The three legacy worker names remain aliases so the existing harness self-tests and retained cases continue to exercise their original windows:

- `after_fact_commit` -> meal after Fact
- `after_effect_bundle` -> mixed after seal, before finalization
- `after_finalize_before_reply` -> mixed after finalization, before reply

The correction fixture creates and finalizes its prerequisite stock and meal target inside the same fresh mode database before previewing the correction. Its crash and recovery assertions are scoped to the correction envelope while the full canonical database snapshot includes the prerequisite authority.

## Recovery oracle

For each expanded mode, the parent harness now verifies:

1. The worker exits 73 with empty stderr and the expected mode payload.
2. The process PID no longer exists after `spawnSync` returns; timeout still uses the hard 30-second bound and `SIGKILL` with the same no-survivor check.
3. Crash-time command-envelope state, event count, and finalization count match the literal boundary expectation.
4. Per-kind literal outbox count/state/attempt and EffectBundle checkpoint state distinguish after-Fact from after-Effect. Scoped nutrition or inventory artifacts must be absent after Fact and present after Effect for meal, purchase, and correction.
5. Closing and reopening SQLite produces an exact canonical table snapshot equal to the crash-time snapshot.
6. Fact/item/correction/outbox identities for the crashed envelope do not change across recovery.
7. For single after-Effect-before-seal modes, completed business Effect tables stay byte-for-byte unchanged while only seal/finalizer authority tables may advance.
8. For mixed after-seal-before-finalize, every non-finalizer table remains byte-for-byte unchanged.
9. Recovery converges to the exact terminal snapshot produced by the same operation's independent after-Finalize mode; `schema_migrations` is excluded only from this cross-root comparison because its installation timestamp is root-specific. It remains included in same-root crash/reopen and replay comparisons.
10. The stored `envelope_finalizations.payload_json`, recovered result bytes, independent terminal result bytes, and replay result bytes are identical.
11. A second replay changes no table in the full same-root canonical snapshot.
12. The mode root is removed in `finally` only after root identity, owner marker identity, and exact owner bytes pass fail-closed checks.

An independent read-only review identified that the original purchase/correction after-Fact oracle could not distinguish an accidentally early Effect. The boundary-specific outbox/checkpoint/artifact assertions above close that gap. A temporary mutation that deliberately applied the purchase Effect in `purchase_after_fact` failed as intended:

```text
B_SLICE_CRASH_HARNESS_FAILED:crash_boundary_outbox_state:purchase:after_fact
```

The mutation was removed and the complete pinned crash harness returned to GREEN.
The same reviewer then rechecked the fix and reported no remaining Critical or Important findings, with a Ready assessment.

The pre-existing fixed mixed-finalizer table digests and all five negative harness self-tests remain in place:

- hang timeout / hard kill / no survivor
- replacement-root refusal
- count-preserving snapshot mutation detection
- emergency cleanup after verifier failure
- mutation detection in an otherwise allowed finalizer table

## Verification

Pinned runtime used for every crash command:

```text
C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe
```

Results:

- `node tests/b-slice-crash-harness.mjs` — PASS; all 11 expanded modes, retained legacy cases, no surviving child/temp database/log residue.
- `B_SLICE_CRASH_SELFTEST=hang` — PASS.
- `B_SLICE_CRASH_SELFTEST=root-replace` — PASS.
- `B_SLICE_CRASH_SELFTEST=snapshot-mutation` — PASS.
- `B_SLICE_CRASH_SELFTEST=emergency-cleanup` — PASS.
- `B_SLICE_CRASH_SELFTEST=allowed-mutation` — PASS.
- Focused `vitest run tests/fault-matrix.test.ts --maxWorkers=1 --minWorkers=1` under pinned Node — 1 file passed, 30 tests passed.
- `git diff --check` — PASS.

No build, full Vitest suite, OpenClaw build/validation, migration validator, or protected contract/schema validator was run.

## Protected scope

The five protected contract/schema/validator paths were not read, hashed, executed, modified, or tracked. Migration-v1 content was not read. The change is limited to the crash worker, crash harness, and this report.

## Concerns

The mode names intentionally distinguish single-operation `after_effect_before_seal` from mixed `after_seal_before_finalize`. The matrix does not claim that the current unbuilt `dist` can recover a sealed single meal; doing so would reproduce the recorded `DIET_DOMAIN_EXECUTION_PENDING:effects_stable` failure and would require an out-of-scope build or production change.

## Fix round 1: independent expanded authority

The independent Task 5 review found one P1: the cross-root terminal reference was produced by another run of the same worker/service implementation. It proved deterministic convergence but could accept a shared missing or incorrect write. The finding was reproduced before changing the oracle with three new real database mutation self-tests.

### RED

Each self-test ran a real crash worker, mutated the durable database without changing the previously asserted primary row counts, and asked the old expanded oracle to reject it. All three instead exited 1 with `selftest_missing_failure`:

```text
B_SLICE_CRASH_HARNESS_FAILED:selftest_missing_failure:expanded_authority:meal_after_fact
B_SLICE_CRASH_HARNESS_FAILED:selftest_missing_failure:expanded_authority:meal_after_effect_before_seal
B_SLICE_CRASH_HARNESS_FAILED:selftest_missing_failure:expanded_authority:meal_after_finalize_before_reply
```

The mutations were:

- Fact: set the meal command envelope's `committed_at` early. This preserves every table's row count and the old literal state/result expectation.
- Effect: replace the existing meal nutrition projection `payload_json` with canonical `{}`. The projection row remains present, so the old count assertion still passes.
- Finalize: delete the finalizer-owned daily progress row while leaving the envelope finalization row and frozen response path present.

### GREEN

The primary expanded oracle no longer obtains expected terminal state from any worker or service invocation. It contains immutable literal authority for:

- one canonical all-table SHA-256 for each of the 11 crash modes;
- one canonical terminal all-table SHA-256 for each of meal, purchase, correction, and mixed recovery;
- one exact frozen payload byte length and SHA-256 for each operation kind.

The canonical all-table snapshot includes every table, row, column name, scalar value, and blob byte in deterministic order. Only `schema_migrations` is excluded from the fixed cross-root digest because its installation timestamp is root-specific; it remains covered by the exact same-root crash/reopen and replay snapshots. Thus Fact rows and payloads, completed Effect projections, finalizer-owned rows, terminal idempotency authority, and frozen finalization content are all bound by independent literals.

The original cross-root terminal comparison remains as secondary convergence evidence only. The fixed digest and frozen-byte checks run independently for every expanded mode before that comparison.

The three new mutation self-tests now pass:

```text
PASS B-SLICE-001 expanded Fact authority mutation self-test
PASS B-SLICE-001 expanded Effect authority mutation self-test
PASS B-SLICE-001 expanded Finalize authority mutation self-test
```

The normal pinned crash harness also passes with all 11 immutable crash authorities and all four immutable terminal/frozen authorities.

### Canonical ordering review follow-up

A read-only review of the fix found that `localeCompare()` made row ordering depend on the host's default ICU locale. A focused in-memory SQLite self-test was added before changing the comparator. With rows `z` and `ä`, the old helper produced locale order and failed:

```text
B_SLICE_CRASH_HARNESS_FAILED:selftest_canonical_order:[[["value","ä"]],[["value","z"]]]
```

`tableSnapshot()` now compares the serialized row JSON with explicit `<`/`>` code-unit ordering, which is independent of the default locale. The canonical-order self-test and the normal 11-mode harness both pass. The existing fixed digests remained valid because the crash fixtures' serialized row values already had the same order under both comparators.

Final fix-round verification under the pinned Node executable:

- normal 11-mode crash harness: PASS;
- original five supervision/mutation/cleanup self-tests: PASS;
- expanded Fact, Effect, and Finalize authority mutation self-tests: PASS;
- canonical snapshot ordering self-test: PASS;
- focused `fault-matrix.test.ts`: 30/30 PASS;
- `git diff --check`: PASS.

The fix-round read-only reviewer reported no remaining Critical or Important findings and a Ready verdict.
