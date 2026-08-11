# SH-HARNESS-001 Work-Item Brief

## Identity

- task_id: `SH-HARNESS-001`
- milestone: `M2`
- type: `harness`
- product_line: `B-only shared execution`
- status: `completed`
- owner: `Codex /root`
- reviewer: `OpenClaw 02 public-clone review; PASS P0=0/P1=0/P2=2`
- base: `689b4efe882dafb791b40888a85ff03b6b26d76b`

## Objective

Build one deterministic execution protocol and machine report around the shared 27-case Oracle. B is the only executable product route; A proves read-only/no-plugin/zero-write degradation; C has no independent adapter and its safety controls remain assigned to B.

The current B backend is intentionally absent. Therefore completion of this task means `harness ready, backend pending`, not that business cases, SQLite or the installable Skill are complete.

## Dependencies

- `SH-MAP-001`
- `SH-CASE-001`
- `SH-CASE-002`
- `SH-CASE-003`
- `SH-CASE-004`

All dependencies are complete. Closure evidence: `EV-20260812-025`.

## Required cases and requirements

- requirements: `REQ-NFR-002`, `REQ-SAFE-003`
- required cases: `CASE-STORAGE-001`, `CASE-STORAGE-007`, `CASE-EFFECT-001`, `CASE-EFFECT-003`
- cumulative catalog: exact version `1.4.0`, 27 cases from `shared/acceptance-cases/cases.json`
- discovered prerequisite: append only the previously referenced but missing `CASE-STORAGE-001`; preserve the prior 26 cases and all fixture bytes

## Deliverables

- `shared/acceptance-cases/harness-manifest.json`
- `shared/acceptance-cases/cases.json` with the single plan-required `CASE-STORAGE-001` prerequisite
- `shared/acceptance-cases/adapters/types.ts`
- `shared/acceptance-cases/adapters/a.ts`
- `shared/acceptance-cases/adapters/b.ts`
- `shared/acceptance-cases/run-all.ts`
- `shared/acceptance-cases/tests/harness.test.ts`
- compatible updates to the four acceptance validators so each continues to own only its intended case subset
- report, review package, independent review and closure evidence
- Plan 0.3 and development-progress updates after completion

`shared/acceptance-cases/adapters/c.ts` is a forbidden deliverable.

## Completion gates

- manifest recomputes all six frozen hashes and exact case count/version;
- adapter input contains no `oracle` or `forbidden` property at any depth owned by the case wrapper;
- B without a driver reports `backend_pending`, zero writes and no observation;
- injected B driver results are compared only by the shared runner;
- A reports only `read_only_no_plugin`, zero writes and no observation;
- explicit `nutritious_drink -> nutrition_drink` mapping is one-way and does not mutate the shared object;
- failed or nonexecuted cases with business writes are rejected;
- exact plain DTO/property/type/order rules and dynamic-object rejection are tested;
- current default report is deterministic and clearly states `ready_backend_pending`;
- no report embeds Oracle values, absolute machine paths, secrets or business records;
- existing four acceptance validators and contract/model gates remain green;
- protected path-name delta and temporary/business residual are zero.

## Product safety rule

A write failure may create a separate redacted technical log, but it must create zero dietary business rows. The harness must never interpret a log, an exception-free call or an adapter PASS as proof of commit.

## Reopen conditions

Reopen when an upstream contract hash, mapping hash, case catalog, fixture catalog, adapter protocol, selected route or Oracle comparison semantics changes.
