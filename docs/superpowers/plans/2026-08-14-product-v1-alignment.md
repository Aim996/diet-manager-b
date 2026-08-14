# 饮食管家 v1.0 Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有路线 B 插件收敛为 v1.0 权威文档规定的 0.1.0 五步闭环，同时保留但冻结完整版代码。

**Architecture:** 继续使用现有 TypeScript、`node:sqlite` 和 OpenClaw 插件入口。新开发只走 `餐食事实 → 白名单营养/unknown → 唯一库存扣减 → 回执 → 当日进度查询`；购买、纠正、营养补充等已有代码不删除，但不再扩展或计入 0.1.0。

**Tech Stack:** TypeScript 5、Node.js 24、`node:sqlite`、Vitest 2、OpenClaw plugin SDK。

## Global Constraints

- `饮食管家-开发约束与需求-v1.0.md` 是唯一产品权威源。
- AI 不得生成营养数值；无权威库、用户库或已确认标签时必须保存 `unknown`。
- 开发期每个任务只运行一个代表性 RED/GREEN 和 `tsc --noEmit`；全部任务结束后只运行一次 full。
- 不执行 build、dist emit、网络请求、依赖安装或远端操作。
- 0.1.0 只交付 SLICE-0 到 SLICE-5；已有 SLICE-6/7 能力冻结。

---

### Task 1: Freeze v1.0 authority and disable prohibited default nutrition values

**Files:**
- Create: `饮食管家-开发约束与需求-v1.0.md`
- Modify: `version-b-lite-plugin/src/nutrition/config.ts`
- Modify: `version-b-lite-plugin/src/application/core-runtime.ts`
- Test: `version-b-lite-plugin/tests/acceptance/nutrition-application.test.ts`
- Modify: `docs/work-items/PRODUCT-v1.0-development-log.md`

**Interfaces:**
- Produces: production default nutrition resolution that returns `unknown` unless an explicitly configured allowlisted adapter returns evidence.

- [x] Add the v1.0 authority document to the repository root without rewriting its REQ/I/DEC text.
- [x] Change the default meal test to assert `source_label: "unknown"`, `adopted_amount: null`, and no numeric nutrient value when no explicit allowlisted source is configured.
- [x] Run that one test and observe the old generic estimate failure.
- [x] Remove generic/common-dish sources from the production default config and default adapter set; retain their code only as frozen, non-production compatibility helpers.
- [x] Run the one test plus `tsc --noEmit`, write the batch record, and commit.

### Task 2: Enforce the v1.0 nutrition-source allowlist

**Files:**
- Modify: `version-b-lite-plugin/src/nutrition/config.ts`
- Modify: `version-b-lite-plugin/src/nutrition/types.ts`
- Modify: `version-b-lite-plugin/src/nutrition/source-client.ts`
- Test: `version-b-lite-plugin/tests/acceptance/nutrition-source.test.ts`

**Interfaces:**
- Produces: `assertV1NutritionSource(source_id, source_type)` used before a resolved value becomes a meal fact.

- [x] Add one test that supplies `local.generic_estimate` numeric evidence and expects `NUTRITION_SOURCE_NOT_ALLOWED` before FactCommit.
- [x] Allow only authoritative public database, user-authored library, and confirmed product-label evidence; keep `unknown` as the terminal fallback.
- [x] Run the focused source test and `tsc --noEmit`, record and commit.

### Task 3: Make unique inventory deduction atomic with the 0.1.0 meal fact

**Files:**
- Modify: `version-b-lite-plugin/src/repository/fact-commit.ts`
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/src/storage/inventory-repository.ts`
- Test: `version-b-lite-plugin/tests/acceptance/pantry-inventory.test.ts`

**Interfaces:**
- Produces: one meal transaction that either commits the fact plus a proven unique deduction, or commits a fact with `skipped_inventory` when no safe candidate exists.

- [x] Add one technical-failure test proving a unique deduction failure leaves neither the new meal fact nor deduction.
- [x] Add one business-skip test proving multiple candidates commit the meal fact, create no deduction, and return `skipped_inventory`.
- [x] Move only the unique-deduction write into the meal FactCommit transaction; leave nutrition/progress non-essential.
- [x] Run the two focused tests and `tsc --noEmit`, record and commit.

### Task 4: Return the 0.1.0 receipt from committed authority

**Files:**
- Modify: `version-b-lite-plugin/src/contracts.ts`
- Modify: `version-b-lite-plugin/src/application/outcome.ts`
- Modify: `version-b-lite-plugin/src/application/core-runtime.ts`
- Test: `version-b-lite-plugin/tests/acceptance/nutrition-application.test.ts`

**Interfaces:**
- Produces: a frozen receipt containing exact raw text, parsed items, nutrition status/source labels, and inventory effect status.

- [x] Add one exact receipt test for a meal with unknown nutrition and skipped inventory.
- [x] Build the receipt only from committed/read-back rows; do not recompute values in the renderer.
- [x] Run the focused receipt test and `tsc --noEmit`, record and commit.

### Task 5: Expose read-only daily progress

**Files:**
- Modify: `version-b-lite-plugin/src/contracts.ts`
- Modify: `version-b-lite-plugin/src/application/outcome.ts`
- Modify: `version-b-lite-plugin/src/application/core-runtime.ts`
- Test: `version-b-lite-plugin/tests/acceptance/core-application.test.ts`

**Interfaces:**
- Produces: public `query_daily_summary` six-area readback that recomputes from facts/effects and never writes a fact row.

- [x] Add one test recording a meal then querying the same natural day.
- [x] Implement the public query using existing repository read models, returning unknown fields as unknown.
- [x] Assert the complete database business snapshot is unchanged by the query.
- [x] Run the focused query test and `tsc --noEmit`, record and commit.

### Task 6: 0.1.0 unified gate and closure

**Files:**
- Create: `docs/work-items/PRODUCT-v1.0-report.md`
- Modify: `docs/work-items/PRODUCT-v1.0-development-log.md`

**Interfaces:**
- Produces: one immutable commit-backed gate record for SLICE-0..5; makes no claim for frozen SLICE-6/7 features.

- [x] Run the v1.0 focused acceptance files once.
- [x] Run the full plugin Vitest suite once and `tsc --noEmit` once; record the two legacy expectation failures and their focused GREEN without rerunning full.
- [ ] Run OpenClaw metadata validation without building or emitting dist.
- [ ] Record exact commands/counts/commit SHA, unresolved DEBT/RISK, and the nonclaims for full 0.1.
- [ ] Commit the closure documents without modifying source after the final gate.

### Task 7: Connect one real allowlisted authoritative nutrition backend

**Files:**
- Create: `version-b-lite-plugin/src/nutrition/adapters/fooddata-central-http.ts`
- Modify: `version-b-lite-plugin/src/openclaw/plugin.ts`
- Modify: `version-b-lite-plugin/openclaw.plugin.json`
- Test: `version-b-lite-plugin/tests/acceptance/nutrition-source.test.ts`
- Test: `version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts`

- [x] Implement a fixed-origin, bounded, JSON-only USDA FoodData Central transport.
- [x] Resolve the API key only from private `FDC_API_KEY` process environment through opaque `env:FDC_API_KEY` config.
- [x] Map only fixed nutrient IDs and preserve the FDC source URL/record/version.
- [x] Prove with fixture transport and registered OpenClaw tool tests that the key is absent from public request/result bytes.
- [x] Run the two focused files and `tsc --noEmit`; do not make a real network call.

### Task 8: Expose authenticated meal and inventory read models

**Files:**
- Modify: `version-b-lite-plugin/src/contracts.ts`
- Modify: `version-b-lite-plugin/src/application/outcome.ts`
- Modify: `version-b-lite-plugin/src/application/core-runtime.ts`
- Modify: `version-b-lite-plugin/src/index.ts`
- Test: `version-b-lite-plugin/tests/acceptance/core-application.test.ts`

- [x] Return natural-day meal history through `query_meals`.
- [x] Return current authenticated batches through `query_inventory`.
- [x] Preserve the existing five public statuses and label both as `read_only_result`.
- [x] Assert exact public shapes, recursive freeze, and an unchanged business snapshot.
- [x] Run one combined smoke and `tsc --noEmit`; do not rerun full.

### Task 9: Add database backup and same-root restore

**Files:**
- Create: `version-b-lite-plugin/src/storage/backup.ts`
- Create: `version-b-lite-plugin/src/admin/cli.ts`
- Modify: `version-b-lite-plugin/src/index.ts`
- Modify: `version-b-lite-plugin/package.json`
- Test: `version-b-lite-plugin/tests/acceptance/backup-restore.test.ts`

- [x] Produce an integrity-checked online SQLite backup without overwriting an existing file.
- [x] Return a SHA-256 that is required for restore.
- [x] Restore only into the same initialized private root, preserve its private authority secret, and roll back on validation failure.
- [x] Add admin CLI entry points without exposing them as model actions.
- [x] Run one end-to-end backup/restore smoke and `tsc --noEmit`; do not emit dist.
