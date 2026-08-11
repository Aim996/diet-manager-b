# SH-HARNESS-001 Implementation Plan

**Goal:** Add one dependency-free shared execution harness that keeps Oracle authority outside adapters and honestly reports the current B backend as pending.

**Architecture:** A frozen manifest owns hashes and route policy. Plain TypeScript adapters receive only input/setup. `run-all.ts` alone reads expected values, compares executed B observations and emits the machine report. Node 24 executes TypeScript directly; no package or database is added.

**Tech stack:** TypeScript with erasable syntax, Node.js 24 built-ins, `node:test`, JSON, Git.

## Constraints

- Work on `agent/sh-harness-001-shared-runner` from `689b4efe882dafb791b40888a85ff03b6b26d76b`.
- Never read, hash, edit, track or execute the five protected domain lease files.
- Do not edit the prior 26 case values, fixtures or golden text. Append only the plan-required `CASE-STORAGE-001` prerequisite discovered by the manifest RED.
- Do not add SQLite, a B repository, a renderer, a C adapter, an A writer or a production OpenClaw/MCP adapter.
- Use the bundled Node `v24.14.0`; no npm/pnpm install.
- Routine work is local and deterministic. Use at most one final independent OpenClaw review.

## Task 1: Freeze manifest and protocol

Files:

- create `shared/acceptance-cases/harness-manifest.json`
- create `shared/acceptance-cases/adapters/types.ts`
- create `shared/acceptance-cases/tests/harness.test.ts`

- [x] Write a failing test for missing manifest and untrusted contract hash.
- [x] Add exact hashes for the three v2 contracts, storage mapping, case catalog and fixture catalog.
- [x] Define exact plain execution-input, observation, adapter and report types.
- [x] Reject extra/dynamic/nonplain DTO members before reading values.
- [x] RED: prove the required `CASE-STORAGE-001` is absent from catalog `1.3.0` / count 26.
- [x] Append only `CASE-STORAGE-001`, reuse the existing fixture, add a domain mutation, and prove catalog `1.4.0` / count 27 with all four required IDs.
- [x] Freeze the protocol together with the first buildable adapter-boundary commit.

## Task 2: Implement A and B adapter boundaries

Files:

- create `shared/acceptance-cases/adapters/a.ts`
- create `shared/acceptance-cases/adapters/b.ts`
- extend `shared/acceptance-cases/tests/harness.test.ts`

- [x] RED: prove a naive adapter receives or mutates Oracle data.
- [x] Build execution inputs from public case fields and resolved setup only.
- [x] Implement A degradation with zero writes/no observation.
- [x] Implement B factory with honest `backend_pending` default.
- [x] Validate injected driver observation without comparing it to expected values.
- [x] Add exact one-way `nutritious_drink -> nutrition_drink` mapping tests.
- [x] Reject failed/nonexecuted observations with nonzero business writes.
- [x] Commit as part of the buildable shared harness implementation candidate.

## Task 3: Implement runner and deterministic machine report

Files:

- create `shared/acceptance-cases/run-all.ts`
- extend `shared/acceptance-cases/tests/harness.test.ts`

- [x] RED: comparator accepts extra/missing/reordered value or pending as product PASS.
- [x] Implement exact recursive plain-value comparison outside adapters.
- [x] Run A and B over the exact 27-case order.
- [x] Emit `backend_pending` for the default no-driver state while protocol remains passed.
- [x] Emit product-case PASS only for executed exact B observations.
- [x] Ensure report contains hashes/counts/statuses but no Oracle payload or absolute path.
- [x] Assert no `adapters/c.ts` exists.
- [x] Commit as one deterministic shared harness implementation candidate.

## Task 4: Verify, review and close

Files:

- create `docs/work-items/SH-HARNESS-001-report.md`
- create `docs/work-items/SH-HARNESS-001-review-package.md`
- after review create `docs/work-items/SH-HARNESS-001-review.md`
- after review create `docs/evidence/EV-20260812-025-sh-harness-001.md`
- update `docs/开发进度.md` and `总功能开发计划0.3.md`

- [ ] Run Node built-in tests and the default harness CLI using the exact bundled Node path.
- [ ] Run the four acceptance validators and relevant contract/model validators serially.
- [ ] Run Parser/JSON/UTF-8/diff/secret/machine-path/protected-scope/residual gates.
- [ ] Publish one stacked draft PR based on the SH-CASE-004 branch.
- [ ] Use at most one independent public-clone review; require P0/P1/P2 and cleanup.
- [ ] After P0=0/P1=0, write evidence, mark the task complete and set next WIP to `SH-TRACE-001`.
- [ ] Re-run focused gates, push and require local/remote/PR-head equality.
