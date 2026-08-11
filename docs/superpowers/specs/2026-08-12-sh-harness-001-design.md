# SH-HARNESS-001 Shared Execution Harness Design

## Objective

Create one adapter-neutral execution harness for the cumulative shared acceptance package. The harness lets the future B backend execute a case without seeing its Oracle, compares the returned observation with the shared Oracle outside the adapter, proves A remains a read-only/no-plugin degradation path, and records that C has no independent product adapter.

This work item builds test infrastructure, not the Diet Manager database or business engine.

```text
Harness protocol ready != B business cases passing
Harness protocol ready != SQLite implemented
Harness protocol ready != Skill installable
```

## Chosen approach

Use dependency-free TypeScript executed directly by the frozen Node.js 24 runtime. Node 24 type stripping avoids adding a package manager, build system or second runtime just for the shared harness.

The harness has four layers:

1. `harness-manifest.json` freezes the contract/case/fixture hashes and B-only route policy.
2. `adapters/types.ts` defines the plain input/observation protocol.
3. `adapters/a.ts` and `adapters/b.ts` implement route-specific boundaries.
4. `run-all.ts` owns Oracle comparison and emits one deterministic machine report.

No `adapters/c.ts` is created. C's state-safety rules remain requirements for the B implementation through `B-MERGE-C-001`.

## Trust and data flow

```text
cases.json
  ├─ public input fields ──> adapter ──> observed result
  └─ oracle + forbidden ─────────────────> shared comparator
```

The adapter receives only:

- `case_id`
- `requirement_ids`
- `stage`
- `source_text`
- a deep-cloned setup resolved from the shared fixture catalog
- frozen contract hashes

It never receives `oracle` or `forbidden`. The runner keeps those values and performs the comparison after execution. Input objects are deep-cloned and recursively frozen before delivery. Mutation of the original case catalog or fixture catalog is a harness failure.

## B adapter

`createBAdapter(driver?)` has two honest states:

- no driver: every case returns `not_executed/backend_pending`, `business_writes=0`, and no observation;
- driver present: the driver receives only the frozen execution input and returns a plain observation.

The adapter validates the observation boundary but does not decide whether it matches the Oracle. A failed/nonexecuted result with a nonzero business-write count is rejected. A technical log reference, if later added, remains outside all dietary objects and cannot turn failure into success.

The explicit one-way compatibility map is:

```text
shared fixture kind nutritious_drink -> B storage item_type nutrition_drink
```

It is exposed as a dedicated function and never rewrites the shared case or an observed product result. All other values pass through unchanged. Reverse rewriting is forbidden.

## A adapter

The A adapter has no writer and no product plugin. It runs a degradation assertion for every shared case and returns:

- `not_executed`
- `read_only_no_plugin`
- `business_writes=0`
- no business observation

This does not claim that A passed the B business Oracle. It proves only the frozen no-writer boundary.

## Runner and report

The default CLI validates the manifest hashes, loads the exact 26-case catalog, runs A degradation and the current B adapter, and emits a deterministic JSON report.

Before a B driver exists, the expected report state is:

```text
harness_status = ready_backend_pending
A: 26 degraded, 0 writes
B: 26 backend_pending, 0 comparisons, 0 writes
C: no independent adapter
```

When a B driver is supplied, each executed observation is compared with the corresponding Oracle by exact plain-value comparison. Arrays are ordered and exact length; objects have exact properties; strings are ordinal; numbers remain numbers. The runner does not generate or repair expected values.

Machine PASS means the harness contract, hashes, isolation and reporting rules passed. Product readiness requires all B cases to execute and compare successfully in a later storage/slice task.

## Frozen inputs

The manifest independently locks:

- `shared/business-contract.md`
- `shared/contracts/receipt-and-date-contract.md`
- `shared/contracts/issue-correction-contract.md`
- `shared/contracts/storage-mapping.md`
- `shared/acceptance-cases/cases.json`
- `shared/acceptance-cases/fixtures/core-v1.json`

The expected catalog is `diet-manager/core-acceptance-cases-v1`, version `1.3.0`, count `26`.

## Test strategy

Use Node's built-in test runner with synthetic harness-only cases. Synthetic fixtures test the protocol; they are not a second business Oracle.

Required RED/GREEN families:

- adapter receives an Oracle or forbidden field;
- adapter or driver mutates frozen input;
- B reports a failed/nonexecuted case with business writes;
- adapter observes a wrong case ID or dynamic/nonplain object;
- comparator accepts extra/missing/reordered values;
- contract/case/fixture hash changes;
- `nutritious_drink` is left unmapped, reverse-mapped or generalized;
- A claims execution or a business write;
- C adapter file appears;
- backend-pending is mislabeled product PASS;
- report includes expected Oracle values or machine-specific paths.

## Scope exclusions

- no SQLite database, migration or repository;
- no real meal, inventory, nutrition, Issue or outbox execution;
- no renderer or golden-text generation;
- no OpenClaw/MCP production adapter;
- no C adapter;
- no A writer;
- no modification of the 26 case values, existing fixtures, golden texts or protected lease files.
