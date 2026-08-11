# Diet Manager B Skill-First Practical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Deliver a portable Diet Manager Skill with one B-line SQLite backend, completing the first real record/query/correct/undo business loop before adding optional agent adapters.

**Architecture:** The Skill owns agent-neutral instructions and tool contracts. The B backend owns validation, SQLite transactions, idempotency, queries, and correction/undo semantics. OpenClaw, MCP, and future agent integrations are thin adapters over the same backend. Technical audit logs are physically and logically separate from dietary business records.

**Tech Stack:** TypeScript 5, TypeBox, Vitest, Node.js 24, built-in `node:sqlite` after a compatibility gate, OpenClaw plugin adapter.

## Global Constraints

- Develop only version B. Do not create parallel A or C product implementations.
- Treat `总功能开发计划0.3.md` as the product source of truth; this file is only the short execution route.
- Do not read, hash, edit, or execute the five currently protected lease files under `shared/contracts`, `shared/schemas`, and their schema validators.
- A failed `FactCommit` may write a separate technical/audit log, but must write zero meal, water, inventory, nutrition, issue, outbox, daily-progress, receipt, or idempotency-terminal business rows.
- A later effect failure after a successful fact commit means “business fact committed, effects pending”; it must not roll back or duplicate the fact.
- Keep security work proportional: finish controls that prevent business-data corruption, path escape, command injection, secret leakage, or false commit reporting. Defer platform-only polish that does not protect the product loop.
- Do not make real Node/npm/OpenClaw calls from safety harnesses. Product tests may use the B package only after their exact scope is declared.
- Every behavior change starts with a failing focused test and ends with a focused green test plus parser/type checks.
- No production claim until record/query/correct/undo and failure atomicity pass on the local backend and the dedicated OpenClaw test platform.

---

## Task 1: Freeze the portable Skill contract

**Files:**

- Modify: `version-b-lite-plugin/src/contracts.ts`
- Modify: `version-b-lite-plugin/src/index.ts`
- Modify: `version-b-lite-plugin/tests/foundation.test.ts`
- Modify: `version-b-lite-plugin/skills/diet-manager-b/SKILL.md`

**Interfaces:**

```ts
export type DietManagerAction =
  | "record_meal"
  | "record_water"
  | "add_inventory"
  | "query_inventory"
  | "query_meals"
  | "query_daily_summary"
  | "correct_record"
  | "undo_record";

export type DietManagerStatus =
  | "foundation_not_implemented"
  | "committed"
  | "committed_with_issues"
  | "needs_clarification"
  | "ignored"
  | "failed";

export interface DietManagerOutcome {
  action: DietManagerAction;
  status: DietManagerStatus;
  committed: boolean;
  operation_id?: string;
  reason_code?: string;
  error_code?: string;
  record_id?: string;
}
```

- [x] Add a failing test that checks all eight portable actions and exact status/commit consistency.
- [x] Add a failing test that rejects a committed status when `committed=false`, and rejects a failed status when `committed=true`.
- [x] Update the contract types and TypeBox schema without adding an OpenClaw-specific field.
- [x] Keep the current foundation handler non-writing; it must return `foundation_not_implemented`, `committed=false`, and no fabricated `operation_id` or `record_id`.
- [x] Update the Skill instructions to state that technical logs never count as dietary records and adapters must not fabricate success.
- [x] Add non-writing `needs_clarification` and `ignored` outcomes with mandatory `reason_code` and no `record_id`.
- [x] Verify in the dedicated OpenClaw test session that `ignored` never says “记下了” and `needs_clarification` asks only for missing information.
- [x] Run `pnpm exec vitest run tests/foundation.test.ts` and `pnpm exec tsc --noEmit` from `version-b-lite-plugin`.

## Task 2: Close the SQLite runtime choice with a compatibility gate

**Files:**

- Create: `version-b-lite-plugin/tests/sqlite-compatibility.test.ts`
- Create: `version-b-lite-plugin/src/storage/sqlite-runtime.ts`
- Modify: `version-b-lite-plugin/package.json`
- Update: `docs/开发进度.md`

- [x] Add a failing test that imports `node:sqlite`, creates a database only under a test-owned temporary directory, commits one transaction, rolls it back in a second case, and closes the database.
- [x] Implement a private SQLite runtime factory using built-in `node:sqlite`; do not add a native third-party driver.
- [x] Require Node.js 24 in package metadata and align Node type definitions with the runtime.
- [x] Prove the compatibility test leaves no database, WAL, SHM, or temporary files after cleanup.
- [x] If built-in SQLite fails this exact gate, stop this task and record the blocker in `docs/开发进度.md`; do not silently switch drivers.

## Task 3: Implement the atomic business repository

**Entry gate:** Do not start this task until the plan-0.3 prerequisites `SH-SAFE-BASE-001`, `SH-MAP-001`, `SH-HARNESS-001`, and `SH-TRACE-001` have current accepted outputs. The Task 2 SQLite compatibility spike is allowed before this gate; production tables and migrations are not.

**Current gate status (2026-08-12):** `SH-SAFE-BASE-001`, `SH-MAP-001`, `SH-HARNESS-001`, and `SH-TRACE-001` are complete through `EV-20260812-026`. `B-STOR-001` is the sole WIP: its fixed SQLite leaf, migration 0001, exact mapping checks, failure cleanup and local package/OpenClaw gates are implemented and locally green; independent review/evidence closure is still pending. Repository transactions below must not start until that narrower bootstrap closes.

**Files:**

- Create: `version-b-lite-plugin/src/storage/migrations.ts`
- Create: `version-b-lite-plugin/src/storage/repository.ts`
- Create: `version-b-lite-plugin/src/storage/technical-log.ts`
- Create: `version-b-lite-plugin/tests/repository-atomicity.test.ts`

**Repository boundary:**

```ts
interface DietRepository {
  recordMeal(input: RecordMealInput): Promise<CommittedMeal>;
  recordWater(input: RecordWaterInput): Promise<CommittedWater>;
  queryMeals(query: MealQuery): Promise<MealRecord[]>;
  queryDailySummary(query: DailySummaryQuery): Promise<DailySummary>;
  correctRecord(input: CorrectRecordInput): Promise<CorrectionResult>;
  undoRecord(input: UndoRecordInput): Promise<UndoResult>;
}
```

- [ ] Add tests for all-or-nothing fact writes using a failure injection immediately before commit.
- [ ] Add tests proving a technical log may be present while every business table remains unchanged.
- [ ] Add tests for idempotent retry with the same `operation_id` and conflict with a different payload.
- [ ] Add tests proving corrections are append-only and undo targets a specific prior record.
- [ ] Implement migrations and transactions only after the failing tests exist.
- [ ] Keep technical logs in a separate database or separate connection/file, never in business queries.
- [ ] Verify business table counts, query results, and idempotency outcomes after every failure phase.

## Task 4: Deliver the first end-to-end Skill business slice

**Files:**

- Create: `version-b-lite-plugin/src/application/diet-manager.ts`
- Modify: `version-b-lite-plugin/src/index.ts`
- Create: `version-b-lite-plugin/tests/business-flow.test.ts`
- Modify: `version-b-lite-plugin/skills/diet-manager-b/SKILL.md`

- [ ] Add an end-to-end failing test: record meal → query meal → correct meal → query corrected view → undo correction → query restored view.
- [ ] Add the equivalent water-record flow and daily-summary query.
- [ ] Add validation tests for missing time, invalid amounts, duplicate operation IDs, and unknown record IDs.
- [ ] Map repository outcomes to the portable `DietManagerOutcome`; never infer commit success from a log or an exception-free adapter call.
- [ ] Update Skill examples using agent-neutral JSON requests and responses.
- [ ] Run all B package tests and TypeScript checks; record exact counts and hashes in `docs/开发进度.md`.

## Task 5: Integrate and verify the dedicated OpenClaw adapter

**Files:**

- Modify: `version-b-lite-plugin/openclaw.plugin.json`
- Modify: `version-b-lite-plugin/src/index.ts`
- Create: `version-b-lite-plugin/tests/openclaw-adapter.test.ts`
- Update: `docs/开发进度.md`

- [ ] Add adapter tests proving OpenClaw inputs map to the portable contract without changing business semantics.
- [ ] Build and validate the plugin locally.
- [ ] Install or load the plugin only on a dedicated OpenClaw test platform configured out of band; never commit its address or token.
- [ ] Test record/query/correct/undo, duplicate retry, validation failure, injected commit failure, and restart persistence.
- [ ] Confirm a commit failure creates no dietary record even if a technical log is available.
- [ ] Save concise evidence and update the progress document with passed, failed, deferred, and follow-up items.

## Task 6: Stop point and optional adapters

**Files:**

- Update: `docs/开发进度.md`
- Update only when justified: `总功能开发计划0.3.md`

- [ ] Mark the first product milestone complete only when Tasks 1–5 pass.
- [ ] Defer nonessential Windows process-count and console-host polish unless it blocks product correctness or deployment.
- [ ] Decide on MCP only after the portable Skill and backend are stable; if added, implement it as another thin adapter, not a second product backend.
- [ ] List later optimizations separately: nutrition provider adapters, richer inventory flows, more agents, performance tuning, and UI/reporting.

## Progress Reporting Format

After each task, update `docs/开发进度.md` with these short sections:

- 已开发
- 待开发
- 本轮新增
- 发现问题
- 待优化
- 后续可增加

Each entry must include the relevant file, focused test result, and whether it affects business correctness or is only an optional optimization.
