# SH-CONTRACT-004 Issue / 纠正 v2 独立复核

## 复核元数据

- 日期：2026-08-11（Asia/Shanghai）
- 平台：专用 OpenClaw 测试环境
- 最终会话：`agent:main:explicit:contract-004-v2-independent-review-round2`
- 会话 URL：`http://192.168.100.10:18789/chat?session=agent%3Amain%3Aexplicit%3Acontract-004-v2-independent-review-round2`
- 方式：只读语义复核；审阅者不执行本地验证器、不修改文件，也不把验证器 GREEN 当成语义证明
- 最终结论：`PASS`
- 完成标志：`Ready for SH-CONTRACT-004 completion: Yes`

## 冻结输入

| 输入 | SHA-256 |
|---|---|
| `shared/contracts/issue-correction-contract.md` | `41E4A18D4D72644641D66A58F918616EBB0A6189E7F0BE1E836741E057298FDB` |
| `shared/tests/validate-issue-correction-contract-v2.ps1` | `5C719F1E169D5BA17A9C0160FBDA5410FB3F9C78A43672BE11C42DC3CE19DC2C` |
| `docs/work-items/SH-CONTRACT-004-v2-brief.md` | `EFA46AB0F639CEAD7BC81BBB0FCD7D80CE93BE44463B2E535384839F2AF030D3` |
| `docs/work-items/SH-CONTRACT-004-v2-report.md` | `44AECCFDAB4EC02D261E48DC8CC79D17E0D337FB0EA0387BFAB102A75B2452F0` |
| `docs/work-items/SH-CONTRACT-004-v2-review-package.md` | `E2608E0C08623C480C73061CD9366091440FA139063C992B8106568927722DCA` |
| `shared/business-contract.md` | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| `shared/contracts/receipt-and-date-contract.md` | `F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD` |

## 两轮复核处理

第一轮不作为关闭证据。第一轮输入没有给出六个当前需求 ID 的精确含义，审阅者因此把 `REQ-CORR-003` 错映射为 mixed/outbox，未能识别批量纠正预览缺口。本地审计同时发现阶段所有权、批量预览、Issue 聚合展示、快捷安全退出等缺口。候选先增加机器断言并真实 RED，再补齐语义。

第二轮使用修正后的契约、验证器、brief、报告、复核包和总计划精确需求映射重新独立审阅。回复首行是 `PASS`，末行是 `Ready for SH-CONTRACT-004 completion: Yes`；本轮才是关闭依据。

## 六项当前需求结论

| ID | 独立结论 |
|---|---|
| `REQ-ISSUE-001` | Issue 统一字段模型、稳定代码和 `open/awaiting_user/resolved/dismissed` 四状态成立。 |
| `REQ-ISSUE-002` | FactCommit 后聚合展示、非阻塞延期、未解决查询和 coverage 影响成立。 |
| `REQ-QUICK-001` | 2–4 个选项、安全退出、组合/自然语言输入、执行前重校验和固定末行成立。 |
| `REQ-CORR-001` | 定位目标后以追加事件完成纠正、作废和恢复，不覆盖或删除历史事件。 |
| `REQ-CORR-002` | 库存返还/差额扣减、营养重算、跨日进度和幂等补偿的阶段所有权成立。 |
| `REQ-CORR-003` | PRODUCT-0.2 跨餐/跨日批量纠正或作废必须先预览，以 revision 绑定确认；取消或陈旧提交写零业务数据。 |

## 关键安全与业务边界

- `FactCommit` 只提交 `CorrectionEvent`、幂等子键和 effect outbox；营养、库存、Issue 投影与进度属于 `EffectBundle`，最终冻结结果属于 `EnvelopeFinalize`。
- `FactCommit` 失败允许独立脱敏技术日志，但饮食业务域、outbox、投影、回执和成功结果均为零新增。
- 批量预览本身写零；逐目标追加事件；取消或任一 revision 陈旧时整体提交写零。
- 无变化不是成功伪装；陈旧、歧义、冲突和库存不足均有稳定结构化结果。
- 唯一正式写入路线仍为 B；Skill、OpenClaw、MCP 和未来智能体只做薄适配，不重算或补写业务真相。

## 非阻断观察

审阅者仅提出可延后整理项：后续可增加更细的材料化错误码，并在模型/trace 阶段继续统一部分章节指针与说明文字。这些不改变当前机器协议、阶段所有权或失败原子性，不阻断本任务完成。

## 复核限制

OpenClaw 审阅者没有计算本地文件哈希、执行 Windows PowerShell 或检查工作区残留。Parser、ASCII、集合计数、trace 唯一性、业务候选文件扫描和独立 clone 回归均由本地最终门禁另行提供。

Ready for SH-CONTRACT-004 completion: Yes
