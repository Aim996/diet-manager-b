# B-FAULT-001 故障矩阵设计

## 1. 目标

`B-FAULT-001` 只为已实现的 B 核心业务补齐故障证据、崩溃恢复和少量必要修复。它要证明：

- 业务写入失败时，可以留下脱敏技术日志，但不能出现半条饮食数据、重复效果、负库存、伪进度或伪成功回执；
- `FactCommit`、`EffectBundle`、`EnvelopeFinalize` 三个持久边界之间崩溃后，同一 token 只续做未完成阶段；
- 响应丢失后重试返回首次冻结结果，不按当前新状态重算；
- 过期 preview、陈旧库存选项、迁移漂移和同键冲突在任何新业务写入之前拒绝。

## 2. 范围和非目标

### 2.1 本任务必须覆盖

总计划冻结的 7 个案例：

1. `CASE-EFFECT-001`：营养 EffectBundle 技术失败、重启和同键只补未完成效果。
2. `CASE-EFFECT-002`：库存、Issue、进度贡献的晚故障整包回滚。
3. `CASE-EFFECT-003`：效果稳定后最终器各写点失败，同时有其他信封提交进度。
4. `CASE-STORAGE-005`：迁移失败不发布候选库，既有未知/漂移库字节不变。
5. `CASE-STORAGE-006`：响应丢失后发生无关新写入，原 token 仍字节级返回原冻结结果且零新写。
6. `CASE-STORAGE-007`：终态同键更换 digest、subject 或 command 均稳定冲突、零新写、不返回旧结果冒充新结果。
7. `CASE-INVENTORY-006`：preview 后库存/revision 改变时拒绝陈旧选择，零 FactCommit 和零派生写入。

### 2.2 明确不做

- 不新增数据库 migration，不修改 migration-v1。
- 不新增依赖、MCP、模型调用、网络调用或公开 fault API。
- 不实现 `record_water`、完整 IssueResolution 交互、真实版本升级器、安装器或发布流程；这些仍属于后续任务。
- 不建通用混沌平台。故障注入仅是内部测试输入，类型受限，不进入最终 OpenClaw 工具契约。

## 3. 权威故障矩阵

### 3.1 共同观测字段

每个故障行都必须显式记录：

- `case_id`、`operation_kind`、`fault_point`、`expected_error_code`；
- 失败后 `command_envelopes.state/result_status`；
- 对应 `effect_outbox.state/attempt_count/reason`；
- 事实、库存交易、营养快照、Issue、进度、最终行和成功回执的精确计数或规范摘要；
- 关闭/重开 SQLite 后的同一状态；
- 同 token 重试后只有未完成阶段变化，已完成事实/效果不重复；
- 技术日志只含冻结脱敏字段，不含食物原文、SQL、密钥或绝对路径。

矩阵中的 `expected_error_code` 使用共享案例层的稳定小写代码；实际异常和技术日志使用
`diagnostic.error_code` 的稳定大写代码。`observations` 必须是精确对象，至少含：

```text
command_envelope, outbox, facts, inventory_transactions,
nutrition_profiles, nutrition_snapshots, issues,
daily_progress_snapshots, envelope_finalizations, success_receipts
```

计数均指本案例专属新数据库中，本轮失败后仍可见的行数；`unchanged_from_pre_fault`
表示该阶段进入前已耐久的数据必须字节不变。非业务存储案例也要显式写
`command_envelope/outbox = not_applicable`，不能省略字段。

### 3.2 精确故障行和失败后状态

矩阵固定 18 行，顺序如下；不得把多个写点合并为一个泛化行：

| 案例 | 精确 fault point（顺序固定） | 失败后权威 |
|---|---|---|
| `CASE-EFFECT-001` | `after_nutrition` | `effects_pending / facts_committed_effects_pending`；2 条 outbox 均为 `retryable_failed, attempt_count=1, reason=NUTRITION_EFFECT_WRITE_FAILED`；1 event、1 meal item 保留，其余效果/进度/最终行/成功回执均 0 |
| `CASE-EFFECT-002` | `after_inventory_write`、`after_issue_write`、`after_progress_contribution_prepared` | 每行均为 `effects_pending / facts_committed_effects_pending`；4 条 outbox 均为 `retryable_failed, attempt_count=1, reason=MEAL_EFFECT_FAILED`；1 event、1 meal item 保留；库存交易、营养 profile/snapshot、Issue、进度 snapshot、最终行和成功回执均 0 |
| `CASE-EFFECT-003` | `after_finalization_row`、`after_envelope`、`after_idempotency`、`before_commit` | 每行均保持 `effects_stable / effects_stable`；4 条已完成 outbox、1 event、1 meal item、1 库存交易、1 营养 snapshot 和 terminal EffectBundle 全部与进入最终器前字节不变；进度 snapshot、finalization 和成功回执均 0 |
| `CASE-STORAGE-005` | `after_schema`、`before_history`、`before_commit`、`unknown_existing_database`、`drifted_v1_index` | 前三行候选库不发布且重试必须从 fresh candidate 开始；后两行拒绝前后数据库完整 bytes 和 `user_version` 不变；不得创建业务 envelope/outbox |
| `CASE-STORAGE-006` | `after_commit_before_reply` | terminal payload bytes、两日期顺序 `2026-08-08,2026-08-09` 和 `single_day_alias_present=false` 冻结；无关后续写入后原 token 返回相同 bytes，所有业务表零新写 |
| `CASE-STORAGE-007` | `changed_digest`、`changed_subject`、`changed_command` | 三行均为 `idempotency_conflict`；原 terminal row/result bytes 不变，全部业务表零新写，且不得返回旧结果冒充新请求结果 |
| `CASE-INVENTORY-006` | `preview_data_revision_changed` | 原 preview 执行返回 `stale_revision`；candidate 变化本身保留，但本次执行产生 0 event、0 meal item、0 outbox、0 checkpoint、0 finalization |

`CASE-EFFECT-002` 的三个 fault 都发生在同一个 meal EffectBundle 的
`BEGIN IMMEDIATE ... ROLLBACK` 范围内。测试 fixture 固定为一个 home item、四条 outbox；
不同 fixture 分别保证库存写、Issue 写和 progress contribution 已真实到达，再注入失败。
因此三行的公开失败码都为 `effect_bundle_write_failed`，技术日志大写码统一为
`MEAL_EFFECT_FAILED`，不能用某张表已暂时写入来改变失败后持久状态。

`CASE-EFFECT-003` 的四行复用 repository 已存在的精确 fault union。公开失败码为
`envelope_finalize_write_failed`，技术日志大写码为 `ENVELOPE_FINALIZE_FAILED`。
最终器事务内的暂时写入必须全部回滚；重启后只允许调用 finalizer，完成效果不得再次 claim。

所有 Effect/Finalizer 行的 `diagnostic` 恰含：

```text
stage, error_code, trace_id, input_digest,
forbidden_content=[source_text,sql,secret,absolute_path]
```

同 token GREEN 后，Effect 行必须只把上述 retryable outbox 再 claim 一次
（最终 `attempt_count=2`），事实行仍各 1、EffectBundle terminal 恰 1、
EnvelopeFinalize 恰 1；Finalizer 行的全部完成 effect 计数和 attempt_count 保持不变，
只新增 1 个进度 snapshot、1 个 finalization 和 1 个冻结成功回执。

### 3.3 `CASE-EFFECT-003` 状态裁决

现有 `cases.json` 写为 `effects_pending`，但数据库状态机和已实现事务边界表明：所有子效果已成功，仅 `EnvelopeFinalize` 失败时，信封必须保持 `effects_stable`。

原因：

- `effects_pending` 表示至少一个效果仍未稳定，同 token 必须再驱动 EffectBundle；
- `effects_stable` 表示事实和效果均已耐久，恢复时只能重试最终器；
- 把它回退到 pending 会破坏“只续做未完成阶段”的语义，并增加重复效果风险。

因此本任务将通过正式案例变更把该字段更正为 `effects_stable`，并增加变更记录和回归。这是修正过时 Oracle，不是修改实现去迎合测试。

### 3.4 三个只有计划摘要的案例

`CASE-EFFECT-002`、`CASE-STORAGE-005`、`CASE-INVENTORY-006` 目前不在可执行案例目录。本任务不会在测试里私设 expected，而是新建 B-FAULT 专用结构化矩阵并用 manifest SHA 绑定。它是对总计划已有摘要的机器化展开，不发明新产品语义。

## 4. 生产修复设计

### 4.1 单餐 `effects_stable` 恢复

`service.execute()` 的单餐分支必须像 mixed/correction 分支一样支持：

- `received`：执行 FactCommit、EffectBundle、seal、finalize；
- `effects_pending`：从事实/checkpoint 重建权威输入，只重试效果、seal、finalize；
- `effects_stable`：从标准四键 terminal EffectBundle 重建 DomainOperationResult，不再跑效果，只执行 finalize；
- `finalized`：返回已冻结结果，零业务写入。

必须覆盖“seal 已提交后进程退出”和“最终器各写点回滚后同 token 恢复”。

### 4.2 correction outbox 法定状态迁移

correction EffectBundle 必须对每个 pending/retryable outbox 执行：

1. CAS `pending|retryable_failed -> processing`；
2. `attempt_count += 1`，进入 processing 时清除旧 `reason`；
3. 整个 correction EffectBundle 成功时 CAS `processing -> succeeded|permanent_business_skip`；
4. 技术失败时整个 SQLite 事务回滚；outbox 仍为失败前的 pending/retryable 状态。

不允许从 pending 直接跳到 terminal。

### 4.3 最小故障 seam

- FactCommit、inventory 和 EnvelopeFinalize 已有完整写点 seam，直接复用。
- meal EffectBundle 在现有 `after_nutrition`/`after_first_item` 之外，仅补“Issue 已写后”和“progress contribution 已准备后”的内部测试 seam，用来证明整个 EffectBundle 事务回滚。
- correction 仅补足以证明 claim 后、补偿后、营养/进度后整体回滚的内部 seam。
- 所有 seam 只存在于内部 service/repository 输入，不加入 OpenClaw 公开 action 的 runtime schema。

### 4.4 脱敏失败日志

`failureSink` 统一输出四字段：

```text
stage, error_code, trace_id, input_digest
```

`stage` 仅为 `FactCommit|EffectBundle|EnvelopeFinalize`。它不影响事务是否回滚，sink 自身失败也不能覆盖原始业务错误。mixed、meal、purchase 和 correction 使用同一规则。

## 5. 测试架构

### 5.1 结构化矩阵

新增 `shared/acceptance-cases/b-fault-matrix.json`，只保存 7 个 case 的权威故障行和 assertion paths；在 `harness-manifest.json` 中冻结 SHA。矩阵必须拒绝：

- 少/多/reorder case；
- 少/多/reorder fault point；
- 空错误码、非法状态、重复 fault ID；
- 缺 restart/retry/frozen-result 断言；
- 未绑定真实 assertion path。

### 5.2 业务测试

新增独立 `tests/fault-matrix.test.ts`，按 case/fault 行运行真实 `createDietDomainService()` 或直接 repository 边界。每个运行使用独立临时数据库，不共享 SQLite 连接。

断言不能只比 row count；对“不变”范围使用全业务表规范快照，对允许变化的表比较字段级权威。

### 5.3 进程崩溃 harness

扩展现有 owner-marker 、PID 超时和整库快照 harness，覆盖：

- single meal: FactCommit 后、EffectBundle/seal 后、finalize commit 后响应前；
- purchase: EffectBundle/seal 后和 finalize response loss；
- correction: FactCommit 后、EffectBundle/seal 后和 finalize response loss；
- mixed: 保留已有三边界证据。

每个 worker 有硬超时，父进程 finally 精确终止本轮 PID 树、关闭数据库并用 owner marker + root identity 删除本轮临时根。

## 6. 证据与门

顺序固定为：

1. 矩阵 shape/mutation 测试；
2. 每个真故障 RED -> 最小修复 -> focused GREEN；
3. 全部 B Vitest；
4. TypeScript `--noEmit` 与唯一 owner build/dist；
5. repository concurrency、progress reservation、B-FAULT crash harness；
6. OpenClaw local build/validate；
7. shared harness、B acceptance、trace/x-gate；
8. 残留进程/数据库/日志根为 0；
9. 独立复核 P0=0/P1=0 后才可把 `B-FAULT-001` 标记完成。

## 7. 限制性说明

`CASE-STORAGE-005` 在本任务证明的是“当前 migration 发布/拒绝边界”，不是未开发的完整版本升级/备份恢复产品。`CASE-STORAGE-006` 在本任务使用预构造的两日冻结 payload 证明响应丢失语义，不借此实现 `record_water`。`CASE-INVENTORY-006` 只证明已实现 preview/revision 和真实库存候选变化的陈旧拒绝，不宣称完整 IssueResolution 交互已完成。
