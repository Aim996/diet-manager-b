# SH-CONTRACT-001 CONTRACT-v2 实施简报

## 任务目标

把《总功能开发计划 0.3》已经批准的共同业务语义冻结为可移植 Skill 与唯一 B 写入后端共同遵守的 CONTRACT-v2。OpenClaw、未来 MCP 和其他智能体只能作为薄适配器，不能复制业务提交逻辑。

本任务只冻结契约，不创建 SQLite 表、迁移、业务 repository 或模拟业务数据。

## 规范输入

- 规范来源：`总功能开发计划0.3.md`
- 当前规范来源 SHA-256：`94766B7BF1D100CCBAE5B2885A2C7986E98DD3141EECA95E2AB87C06327D58F3`
- 前置验收：`SH-SAFE-BASE-001` / `EV-20260811-012`
- 路线决定：`DEC-027`（只开发 B）、`DEC-028`（安全有界收口）
- 原子性澄清：`CHG-20260811-001`

受保护的五个 lease 文件继续禁止读取、哈希、编辑或执行；本任务不得以“复核”为由触碰它们。

## 交付物

1. `shared/business-contract.md`
2. `shared/tests/validate-business-contract-v2.ps1`
3. `docs/work-items/SH-CONTRACT-001-v2-report.md`
4. `docs/work-items/SH-CONTRACT-001-v2-review-package.md`
5. 由独立复核者创建的 `docs/work-items/SH-CONTRACT-001-v2-review.md`

旧的无 `-v2` work-item 文件属于 CONTRACT-v1 历史审计，不证明当前候选。

## 必须冻结的共同语义

- 唯一产品写入路线为 B，Skill 与适配器不拥有第二套提交语义。
- 命令业务结果只允许 `committed`、`committed_with_issues`、`needs_clarification`、`ignored`、`failed`。
- 写入协议为 `FactCommit → EffectBundle → EnvelopeFinalize`。
- `FactCommit` 技术失败回滚全部业务行；只允许独立、脱敏且不进入业务查询的技术日志。
- `EffectBundle` 技术失败保留已提交事实并重试效果，不重复提交事实。
- 最终器失败回滚最终器输出并保持 `effects_pending`。
- 幂等身份为 `idempotency_key + input_digest + subject_scope + command_type`。
- 服务端预览必须绑定输入摘要、主体作用域、命令类型和适用的数据 revision；调用方自报状态不可信。
- 生命周期、存放位置、到期锚点、营养来源、单日进度别名和 PRODUCT-0.2 部分扣减边界必须与总计划 0.3 一致并进入机器校验。
- 十类 CONTRACT-v1 旧规则不得在现行规范中复活，并由机器字段 `legacy_rule_guards` 锁定。
- 77 个任务范围 REQ ID 必须全部存在，§13 追踪表中各出现一次。

## 验收

1. 专用验证器输出 `CONTRACT_V2|PASS`，五种状态、三阶段协议和十项旧规则 guard 全部通过。
2. 77 个任务范围 ID：缺失 0、额外 0、追踪表非单例 0。
3. §1—§11 现行规范中的十类旧规则命中 0；§12 仅作明确的 superseded 审计。
4. Markdown 围栏成对，机器 JSON 可由 Windows PowerShell 5.1 解析。
5. `.jsonl/.sqlite/.sqlite3/.db/WAL/SHM/journal` 业务候选前后为 0。
6. 独立复核者逐语义审阅 CONTRACT-v2，并给出 PASS/FAIL、候选哈希和发现处置。

只有六项全部满足并形成新鲜 `EV-*` 后，主计划才可把 `SH-CONTRACT-001` 标记为已完成。
