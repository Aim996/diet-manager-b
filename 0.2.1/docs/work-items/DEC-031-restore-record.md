# DEC-031：撤销恢复（restore_record）

> 状态：**已批准（用户拍板 2026-08-19）** · 关联版本线 0.2.0
> 权威性：用户明确「撤销后肯定能反悔，每一步都有痕迹，通过大模型能查到所有痕迹」。本 DEC 将「撤销后恢复」正式立项。按 v1.0 §0 与路线图 §7，先写 DEC 再改方向。

---

## 1. 背景与问题定位（已核实）

- 当前公开动作 8 个：`record_meal` / `record_water` / `add_inventory` / `query_inventory` / `query_meals` / `query_daily_summary` / `correct_record` / `undo_record`。
- `undo_record`（`void_event`）撤销一条记录后**不可反悔**：无公开的 `restore_record` 动作。0.1.1 阶段 1 的 Task 5 标题即「公开接通 undo_record 并**禁止二次撤销恢复**」。
- **痕迹本来就完整**：`event_records.lifecycle_status` 保留 void 前后状态；`correction_events.operation` 的 CHECK 已列 `void_event` 与 **`restore_event`**（`migration-v1.ts:21`，0.3/0.4 设计残留）；`inventory_transactions.direction` 支持 `in/out/neutral` 冲销。归档 0.4 §15.5 亦明确「可以通过 `record_restored` 恢复」。
- 结论：数据链路已具备恢复能力，只缺一个公开动作把它翻回来。

## 2. 决策

**DEC-031：新增 `restore_record` 公开动作，撤销后恢复（un-void）一条已 void 记录，恢复其营养/白水/库存贡献。**

- 版本：随 DEC-030 一起落 0.2.0，共享同一次 `contract v2 → v3` bump（避免重复多文件大改）。
- 语义：`restore_record` 仅对「已 void」记录生效（对非 void 记录返回幂等/拒绝，不新建事实）；恢复后 `lifecycle_status` 回到 active，营养/白水/进度重新计入。

## 3. 库存返还边界（关键设计点）

void 时库存「安全返还」（`inventory_transactions.direction='in'` 冲销）；restore 时需**重新扣减**。若目标批次已被后续事件消耗导致扣减将为负，遵守 I-4（库存非负）：

- 批次仍足够 → 正常重新扣减；
- 批次不足 → 该库存效果标记 `skipped_inventory`（营养/白水/进度照常恢复），回执如实说明「库存已不足以恢复」，不静默造负库存。

## 4. 契约变更（与 DEC-030 共享 v2 → v3）

- 新增动作 `restore_record`：入参定位一条已 void 记录（沿用 `undo_record` 的目标定位：`latest_meal_in_conversation` / 显式 event id）。
- `correction_events.operation` 启用既有 `restore_event`。

## 5. TDD 实施切片（WIP=1，先红后绿）

| 切片 | 内容 | 先证 RED |
|---|---|---|
| R-1 | `restore_record` 解析 + 目标定位（复用 undo 目标解析） | 非 void 记录拒绝 / 未定位失败 |
| R-2 | `restore_event` 落库 + `lifecycle_status` 恢复 + 营养/白水/进度重算 | 恢复后进度回到原值 |
| R-3 | 库存重新扣减 + 不足时 `skipped_inventory` 边界 | 批次不足不造负库存 |
| R-4 | SKILL.md 同步 `restore_record` + 回执 | Skill 回执含恢复断言 |
| R-5 | 随 DEC-030 C-6 合并真实验收（撤销→恢复→再查） | 端到端场景 |

## 6. 风险与边界

- **幂等**：重复 restore 幂等（第二次返回 already_active，不重复扣减）。
- **不物理删除**：restore 不删除 void 痕迹，`correction_events` 链保留完整可追溯（遵守 I-2/I-8）。
- **健康边界**：恢复不涉及任何营养数值生成，只重放既有事实与来源。
