# B-FAULT-001 Fault Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Final status (2026-08-13): COMPLETE — DONE_WITH_CONCERNS.** Frozen code/test/dist candidate `552feee374fe3463f296bd4a110af11747a7ee29`; replacement evidence commit `74d8193debf1347b07a4c5e594f4b7c3f11c5828`; independent whole-branch rereview P0=0/P1=0 and technical Ready YES. Branch `agent/b-fault-001` is published to `origin/agent/b-fault-001`; draft PR [#11](https://github.com/Aim996/diet-manager-b/pull/11) targets `main`. All implementation checklist steps below are executed; the retained Task 6 search-output concern remains non-blocking. This closure does not start `X-GATE-002` or authorize a selected-route map.

**Goal:** 为 B 主线已实现的核心业务建立 7 案精确故障矩阵，修复崩溃恢复和 effect 状态迁移缺口，并证明失败日志可留但饮食业务零半写入。

**Architecture:** 复用现有 `FactCommit -> EffectBundle -> EnvelopeFinalize` 三阶段事务和 crash harness。用独立 SHA 绑定矩阵作为 7 案机器 Oracle，再通过真实 SQLite 业务观测器和进程级崩溃测试执行。生产修改限于单餐 stable 恢复、correction outbox 法定迁移、必要的内部 fault seam 和脱敏失败日志。

**Tech Stack:** Node.js `24.15.0`、TypeScript、`node:sqlite`、Vitest `2.1.9`、OpenClaw plugin build/validate、JSON + SHA-256 acceptance authority。

## Global Constraints

- 唯一工作分支为 `agent/b-fault-001`，基线为 `1ee40731a6d90c43e016ab04eb37ba85a54992ae`。
- 不读取、哈希、执行、修改或跟踪五个保护文件：`shared/contracts/data-model.md`、`shared/schemas/domain.schema.json`、`shared/schemas/fixtures/domain-cases.json`、`shared/tests/validate-domain-schema.mjs`、`shared/tests/validate-domain-schema.ps1`。
- 不修改 migration-v1、lockfile、依赖集、MCP、模型/网络调用和 OpenClaw 公开 action schema。
- 不实现 `record_water`、完整 IssueResolution、升级器、安装/发布或 selected-route map。
- 所有 SQLite 运行使用独立 test-owned 临时根。不同测试不共享数据库文件。
- 同一时间只有一个 owner 运行 TypeScript build/`dist` 生成。
- 用于修复的行为测试必须先产生精确 RED；不因实现现状而放宽 Oracle。

---

### Task 1: Freeze the seven-case B fault authority

**Files:**
- Create: `shared/acceptance-cases/b-fault-matrix.json`
- Modify: `shared/acceptance-cases/harness-manifest.json`
- Create: `shared/acceptance-cases/tests/b-fault-matrix.test.ts`
- Modify: `shared/acceptance-cases/cases.json` (`CASE-EFFECT-003` state correction only)
- Create: `docs/work-items/B-FAULT-001-brief.md`

**Interfaces:**
- Consumes: 总计划的 7 个 case ID、现有 case catalog、`harness-manifest.json` SHA 规则。
- Produces: `diet-manager/b-fault-matrix/v1`、精确 case/fault 顺序、`case_assertion_paths`、修正后 `CASE-EFFECT-003.failure.envelope_status=effects_stable`。

- [x] **Step 1: Write the matrix shape RED**

  在 `b-fault-matrix.test.ts` 中先要求 `b-fault-matrix.json` 存在，且 `case_order` 精确为：

  ```ts
  [
    "CASE-EFFECT-001", "CASE-EFFECT-002", "CASE-EFFECT-003",
    "CASE-STORAGE-005", "CASE-STORAGE-006", "CASE-STORAGE-007",
    "CASE-INVENTORY-006",
  ]
  ```

  断言每个 fault row 精确包含 `fault_id`、`operation_kind`、`fault_point`、`expected_error_code`、`failed_state`、`outbox_state`、`restart`、`same_token_retry`、`forbidden`、`assertion_paths`。

- [x] **Step 2: Run the RED**

  Run:

  ```powershell
  & $nodeExe --test shared/acceptance-cases/tests/b-fault-matrix.test.ts
  ```

  Expected: FAIL because `b-fault-matrix.json` is missing.

- [x] **Step 3: Create the exact authority and manifest binding**

  将设计文档第 3 节的公共观测字段全部写入矩阵。对只有总计划摘要的 3 案用 `scope_limitation` 显式限定当前证明边界。计算矩阵 SHA-256 并存入 manifest；测试重算 SHA 并精确比较。

- [x] **Step 4: Freeze assertion paths and mutations**

  `B-FAULT-001-brief.md` 声明 7 案 assertion paths。测试对以下变异逐一拒绝：case 缺失/额外/重排，fault 缺失/额外/重排，非法 state，空 error code，缺 restart/retry，缺 assertion path。

- [x] **Step 5: Run GREEN and commit**

  Run:

  ```powershell
  & $nodeExe --test shared/acceptance-cases/tests/b-fault-matrix.test.ts
  & $nodeExe shared/tests/validate-traceability.mjs --self-test
  ```

  Expected: all PASS. Commit:

  ```powershell
  git add shared/acceptance-cases/b-fault-matrix.json shared/acceptance-cases/harness-manifest.json shared/acceptance-cases/cases.json shared/acceptance-cases/tests/b-fault-matrix.test.ts docs/work-items/B-FAULT-001-brief.md
  git commit -m "test: freeze B fault matrix authority"
  ```

### Task 2: Restore single-meal envelopes from `effects_stable`

**Files:**
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts` only if a plain terminal result reader cannot be reused
- Generated later by single owner: `version-b-lite-plugin/dist/domain/*.js`

**Interfaces:**
- Consumes: stored command envelope authority, standard four-key EffectBundle, existing `finalizeEnvelope()`.
- Produces: same-token `record_meal` recovery from `effects_stable` without rerunning effects.

- [x] **Step 1: Write the exact crash-window RED**

  构造一个真实 meal，手工执行 FactCommit、meal EffectBundle 和 seal，但不调用 finalizer。记录全业务表 snapshot，然后用原 token 调用 `service.execute()`。期望 committed result、finalization=1，事实/营养/库存/outbox/effect bundle 与重试前字节一致。

- [x] **Step 2: Run RED**

  Run focused Vitest with one worker. Expected failure: `DIET_DOMAIN_EXECUTION_PENDING:effects_stable`.

- [x] **Step 3: Implement minimal terminal readback**

  在 meal 分支的 live EffectBundle 之前处理 `effects_stable`：从 immutable meal fact + exact terminal bundle 重建 plain operation result，校验 operation/envelope/digest/revision/effect IDs/states，然后直接进入 seal/finalize 之后的 finalization 路径。不读 live inventory/nutrition selection，不写 effect 表。

- [x] **Step 4: Run GREEN plus replay compatibility**

  运行新 focused test，以及 finalized meal、effects_pending retry、mixed stable、correction stable 现有测试。Expected: PASS.

- [x] **Step 5: Commit**

  ```powershell
  git add version-b-lite-plugin/src/domain/service.ts version-b-lite-plugin/src/domain/effect-bundle.ts version-b-lite-plugin/tests/vertical-slice.test.ts
  git commit -m "fix: resume stable meal finalization"
  ```

### Task 3: Enforce correction effect state transitions

**Files:**
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`

**Interfaces:**
- Consumes: `assertEffectTransition()` and correction outbox rows.
- Produces: pending/retryable -> processing -> succeeded/permanent_business_skip with `attempt_count` authority.

- [x] **Step 1: Write RED for legal claim and retry**

  在成功 correction 和 business-skip correction 后断言所有 outbox `attempt_count=1`、terminal state 正确、success reason 为 null。再构造 retryable_failed row，重试后期望 `attempt_count=2`且旧 reason 不残留。

- [x] **Step 2: Run RED**

  Expected: attempt count remains 0 or CAS fails because correction jumps directly from pending to terminal.

- [x] **Step 3: Add transactional claim and terminal CAS**

  在 correction EffectBundle 事务开始后，对排序 outboxes 执行法定 claim；所有业务写完成后才从 processing 进入 terminal。每次 CAS 必须 changes=1，否则整个事务失败并回滚。

- [x] **Step 4: Run correction suite GREEN**

  Run:

  ```powershell
  & $nodeExe node_modules/vitest/vitest.mjs run tests/vertical-slice.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism -t "CASE-CORR-001|undo appends|restores a voided|keeps a correction fact|same-token retry.*correction"
  ```

  Expected: `CASE-CORR-001`、undo、restore、insufficient business skip 与 correction 两个 same-token retry 窗口全部 PASS，且新断言证明无 state-guard bypass。

- [x] **Step 5: Commit**

  ```powershell
  git add version-b-lite-plugin/src/domain/effect-bundle.ts version-b-lite-plugin/tests/vertical-slice.test.ts
  git commit -m "fix: enforce correction effect transitions"
  ```

### Task 4: Cover late EffectBundle failures and redacted diagnostics

**Files:**
- Create: `version-b-lite-plugin/tests/fault-matrix.test.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Modify: `version-b-lite-plugin/package.json`

**Interfaces:**
- Consumes: matrix fault rows, service failure sink, existing test fixture builders.
- Produces: internal-only meal/correction fault points and exact four-field diagnostics.

- [x] **Step 1: Write CASE-EFFECT-001/002/003 and diagnostic REDs**

  在新文件中按矩阵执行：营养失败重开重试；Issue 已写后晚故障；progress contribution 已准备后晚故障；真实 meal/correction finalizer fault。失败时比较全业务表 snapshot，断言 `failureSink` 每行恰四键且不含 source text/SQL/secret/path。

- [x] **Step 2: Run RED and classify each failure**

  把无 seam、无 EnvelopeFinalize log、无 stable recovery 分开记录；不一次修多个未证实原因。

- [x] **Step 3: Add only the required internal seams and wrapper**

  扩展内部受限 union，增加 Issue/progress/correction 晚故障点。在 service 边界为 EffectBundle/EnvelopeFinalize 统一转换脱敏日志；日志 sink 失败不覆盖主错误。

- [x] **Step 4: Run matrix GREEN and mutation checks**

  至少证明删任一 fault 行、允许半写、重复 effect、冒出成功回执、泄漏 path/source 会使测试失败。

- [x] **Step 5: Add package entry and commit**

  `test:b-fault` 只运行 fault matrix Vitest + crash harness，不隐式运行 Node/npm/OpenClaw 其他工具。Commit:

  ```powershell
  git add version-b-lite-plugin/src/domain/service.ts version-b-lite-plugin/src/domain/effect-bundle.ts version-b-lite-plugin/tests/fault-matrix.test.ts version-b-lite-plugin/package.json
  git commit -m "test: add B domain fault matrix"
  ```

### Task 5: Expand process-crash recovery coverage

**Files:**
- Modify: `version-b-lite-plugin/tests/b-slice-crash-worker.mjs`
- Modify: `version-b-lite-plugin/tests/b-slice-crash-harness.mjs`
- Test: `version-b-lite-plugin/tests/fault-matrix.test.ts`

**Interfaces:**
- Consumes: existing owner marker, root identity, canonical table snapshots, worker timeout helpers.
- Produces: bounded crash modes for meal, purchase, correction and retained mixed windows.

- [x] **Step 1: Add crash-mode RED expectations**

  父 harness 要求每个 operation 的 after-fact、after-effect/seal、after-finalize-before-reply 模式都 exit 73，并对崩溃时 snapshot、重启后 snapshot、固化 payload bytes 和零重复写入做 exact 比较。

- [x] **Step 2: Run RED**

  Expected: unknown worker modes or stable-meal retry failure.

- [x] **Step 3: Implement worker modes without new production API**

  worker 仅组合已有 repository/service 边界和受限 test fault。每个 mode 使用新数据库根和新 token，不复用另一 mode 的状态。

- [x] **Step 4: Harden timeout and cleanup self-tests**

  保留 hang timeout/SIGKILL/no-survivor、replacement-root fail-closed、count-preserving mutation detection 和 emergency cleanup 自测。新 mode 同样必须在 finally 后 root/PID=0。

- [x] **Step 5: Run GREEN and commit**

  ```powershell
  & $nodeExe version-b-lite-plugin/tests/b-slice-crash-harness.mjs
  git add version-b-lite-plugin/tests/b-slice-crash-worker.mjs version-b-lite-plugin/tests/b-slice-crash-harness.mjs version-b-lite-plugin/tests/fault-matrix.test.ts
  git commit -m "test: expand B crash recovery matrix"
  ```

### Task 6: Close storage/stale/idempotency fault evidence

**Files:**
- Modify: `version-b-lite-plugin/tests/fault-matrix.test.ts`
- Modify: `version-b-lite-plugin/tests/storage-bootstrap.test.ts` only for assertion reuse, not migration behavior
- Modify: `version-b-lite-plugin/tests/server-authority.test.ts` only for public helper extraction if required

**Interfaces:**
- Consumes: migration fault points, canonical file bytes, stored terminal replay, preview revision authority.
- Produces: executable `CASE-STORAGE-005/006/007` and `CASE-INVENTORY-006` evidence.

- [x] **Step 1: Write the four case REDs**

  - 005: 三个 migration fault 均不发布库；unknown/drift 库拒绝前后字节 SHA/user_version 不变。
  - 006: 预构造两日 terminal payload，响应丢失后插入无关事实，原 token 返回完全相同 payload bytes，不返回当前总量。
  - 007: 在终态后分别改 digest/subject/command，稳定冲突，全业务表不变，异常不含旧 terminal payload。
  - inventory-006: preview 时唯一候选，随后另一入库使候选/revision 变化，原 preview 执行拒绝，零 event/item/outbox/checkpoint。

- [x] **Step 2: Run RED and verify missing aggregation only**

  预期大部分基础能力已绿；如出现生产红灯，必须记录精确业务写入差量再修复。

- [x] **Step 3: Reuse public authorities; do not invent deferred features**

  006 不实现 water；005 不实现新版本升级器；inventory-006 不实现 IssueResolution。只证明设计文档限定的存储/服务权威边界。

- [x] **Step 4: Run GREEN and commit**

  ```powershell
  git add version-b-lite-plugin/tests/fault-matrix.test.ts version-b-lite-plugin/tests/storage-bootstrap.test.ts version-b-lite-plugin/tests/server-authority.test.ts
  git commit -m "test: close B storage fault cases"
  ```

### Task 7: Build, full gate, evidence and independent review

**Files:**
- Generate/modify: `version-b-lite-plugin/dist/**` corresponding exactly to changed `src/**`
- Create: `docs/work-items/B-FAULT-001-report.md`
- Create: `docs/work-items/B-FAULT-001-review-package.md`
- Create after verdict: `docs/work-items/B-FAULT-001-review.md`
- Create after fresh evidence: `docs/evidence/EV-20260812-032-b-fault-001.md`
- Modify: `docs/开发进度.md`
- Modify: `docs/项目开发汇报-2026-08-12.md`
- Modify: `总功能开发计划0.3.md`
- Regenerate: `shared/traceability/*.json`

**Interfaces:**
- Consumes: all previous commits and exact case matrix.
- Produces: frozen candidate, E-STOR evidence, independent verdict and task closure.

- [x] **Step 1: Single-owner build and static synchronization**

  Run TypeScript `--noEmit`, then the sole `tsc -p tsconfig.json` build. Verify each changed `src` behavior exists in the corresponding `dist`, `git diff --check` passes, no dependency/lock/migration/public action change exists.

- [x] **Step 2: Run focused and full gates**

  In order: matrix tests; full plugin Vitest; repository concurrency; progress reservation; crash harness; OpenClaw build/validate; shared harness/B acceptance; trace self-test; x-gate self-test. Do not run crash/concurrency harness concurrently with full Vitest.

- [x] **Step 3: Verify residue and no-scope expansion**

  Assert task-owned Node processes, databases and log roots are zero. Verify selected-route map remains absent and explicitly named B source/test paths contain no model/network call addition.

- [x] **Step 4: Write Stage A report and request independent review**

  Freeze candidate SHA and exact command results. The reviewer must inspect all seven case observations, the two production fixes, crash cleanup, public non-leakage, src/dist parity and stated limitations. Any P0/P1 blocks closure.

- [x] **Step 5: Close only after verdict and push**

  With P0=0/P1=0, add `EV-20260812-032`, mark `B-FAULT-001=已完成`, leave `X-GATE-002` blocked until all of its remaining frozen inputs exist, regenerate trace, commit, push `agent/b-fault-001`, and open/update a draft PR. If review does not pass, keep the task `进行中` and record the exact blockers.

## Plan self-review

- Spec coverage: all 7 frozen case IDs map to Tasks 1, 4, 5 and 6; both confirmed production gaps map to Tasks 2 and 3; evidence/review maps to Task 7.
- Scope: no water, full IssueResolution, version upgrade product, installer, MCP, migration-v1, dependency, model/network or public fault interface task exists.
- Type consistency: `effects_stable`, `processing`, `attempt_count`, `failureSink` four-field DTO and standard four-key EffectBundle terminology match current production contracts.
- Execution isolation: Tasks 1 and 6 may edit shared acceptance/test authority; Tasks 2/3/4 share production files and therefore must be serialized. Task 5 owns crash files. Only Task 7 owns build/dist generation.
