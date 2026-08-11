# SH-CONTRACT-001 CONTRACT-v2 实施报告

## 当前状态

- 任务状态：`已完成`
- 实现状态：CONTRACT-v2 已完成 TDD 修订、第二轮独立 PASS 和本地新鲜门禁。
- 完成证据：`EV-20260811-013`。
- 产品边界：本任务没有创建业务表、迁移、repository 或可安装产品。

## 实际交付

- `shared/business-contract.md`
- `shared/tests/validate-business-contract-v2.ps1`
- `docs/work-items/SH-CONTRACT-001-v2-brief.md`
- `docs/work-items/SH-CONTRACT-001-v2-report.md`
- `docs/work-items/SH-CONTRACT-001-v2-review-package.md`
- `docs/work-items/SH-CONTRACT-001-v2-review.md`
- `docs/evidence/EV-20260811-013-sh-contract-v2.md`

旧 CONTRACT-v1 work-item 文件保持原样，继续只作为历史审计。

## CONTRACT-v1 到 v2 的主要差量

| 范围 | CONTRACT-v2 候选 |
|---|---|
| 产品路线 | 从三路线共同实现收敛为可移植 Skill + 唯一 B 写入后端；A 只读，C 控制并入 B |
| 命令结果 | 冻结五种业务结果；`foundation_not_implemented` 仅为开发期适配器状态 |
| 写入协议 | 冻结 `FactCommit → EffectBundle → EnvelopeFinalize` |
| 失败原子性 | FactCommit 失败业务零数据；独立技术日志允许但不属于业务记录 |
| 效果失败 | 已提交事实保留，效果进入 pending/retryable，禁止重复提交事实 |
| 幂等 | 四字段身份、终态冻结返回、非终态恢复、冲突零新业务写入 |
| 预览安全 | 服务端权威预览绑定；调用方状态不可信 |
| 旧规则 | 十项 `legacy_rule_guards` 机器化禁止复活 |
| 审阅修复 | 生命周期、三类优先级、预览 revision、技术日志/时间/估算强度、共食未知量、0.2 部分扣减和单日进度别名进入正文与机器校验 |

## TDD 证据

新增验证前，CONTRACT-v2 机器块没有 `legacy_rule_guards`。验证器首先稳定 RED：

```text
Legacy rule guards are missing
```

仅补充十项机器 guard 后，Windows PowerShell 5.1 GREEN：

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
PARSER_ERRORS=0
```

第一轮独立审阅随后发现机器校验没有覆盖正文的关键枚举与优先级。先扩展验证器，旧候选稳定 RED：

```text
The property 'record_lifecycle' cannot be found on this object.
```

补齐总计划 0.3 已批准的共同语义后，Windows PowerShell 5.1 再次 GREEN：

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
```

首轮独立 FAIL 的成立项已全部处置。第二轮 OpenClaw 独立复核重新审阅新哈希后给出 `PASS`，并明确 `Ready for SH-CONTRACT-001 completion: Yes`。

## 实现方只读审计

```text
CONTRACT_AUDIT|PASS|expected=77|actual=77|families=12,12,19,23,11|trace_non_singleton=0|legacy_current_hits=0|fences=even|business_candidates=0
```

- 任务范围 REQ ID：77/77；缺失 0；额外 0。
- §13 追踪表：非单例 0。
- 现行规范旧规则命中：0。
- Markdown 围栏：2，成对。
- 业务数据候选：0。

## 当前候选哈希

- `shared/business-contract.md`：`632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- `shared/tests/validate-business-contract-v2.ps1`：`2395D4B0A5806CDCE5FE1C313BE814CF473ABF65B3810E72DBC2BFFD20790589`
- `总功能开发计划0.3.md`（本报告验证时）：`94766B7BF1D100CCBAE5B2885A2C7986E98DD3141EECA95E2AB87C06327D58F3`

## 独立复核与完成边界

- 独立复核记录：`docs/work-items/SH-CONTRACT-001-v2-review.md`。
- 完成证据：`docs/evidence/EV-20260811-013-sh-contract-v2.md`。
- 独立审阅者只做上传材料的语义复核；本地哈希、验证器、77 条集合、旧规则和业务候选由主协调者另行验证。
- 本任务完成不绕过 `SH-CONTRACT-002`、`SH-MAP-001`、`SH-HARNESS-001` 或 `SH-TRACE-001`，也不代表业务表、SQLite repository、G1/G2/G3 或产品安装可用。
