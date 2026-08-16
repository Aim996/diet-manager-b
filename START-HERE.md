# 饮食管家：当前计划入口

现行产品需求的唯一权威是仓库根的《[饮食管家-开发约束与需求-v1.0.md](./饮食管家-开发约束与需求-v1.0.md)》。`releases/v0.1` 是 0.1.0 的冻结工程快照（只读）；当前目标版本是 **0.1.1**。

0.1.1 按以下两份文件推进，阶段状态记录在台账中：

1. 批准设计：[docs/superpowers/specs/2026-08-15-complete-0.1x-staged-development-design.md](./docs/superpowers/specs/2026-08-15-complete-0.1x-staged-development-design.md)
2. 分段实施计划：[docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md](./docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md)
3. 阶段台账：[docs/work-items/PRODUCT-0.1.1-ledger.json](./docs/work-items/PRODUCT-0.1.1-ledger.json)

旧《总功能开发计划》系列（0.1–0.4）已全部归档至 `docs/archive/legacy-plans/`，仅用于追溯历史，不再决定任何新任务范围、完成状态或发布结论。

## 从哪里看起

1. `饮食管家-开发约束与需求-v1.0.md`：产品定义、8 条硬不变式、需求与切片。
2. `version-b-lite-plugin/`：唯一主线（B 路线，Skill + TypeScript/SQLite 插件）。
3. `docs/work-items/`：任务 brief、报告、复核与台账。
4. `docs/evidence/`：不可变证据链。
5. `version-a-skill-only/`、`version-c-strict-plugin/`：历史对照版本，已停止开发。

当前阶段目标：完成 0.1.1 的六阶段交付（治理统一 → 撤销闭环 → 完整业务 → 安装灾备 → 真实验收 → 不可变发布）。阶段 1 的撤销能力关闭前，产品不得宣称可发布。
