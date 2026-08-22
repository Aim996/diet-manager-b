# EV-20260811-013 — SH-CONTRACT-001 CONTRACT-v2

## 结论

`SH-CONTRACT-001` 通过，CONTRACT-v2 可作为后续日期/回执、模型、SQLite mapping 和 B 后端实现的共同语义输入。

本证据不证明业务表、迁移、repository、真实饮食写入、OpenClaw 部署、G1/G2/G3 或产品发布完成。

## 冻结输入

| 文件 | SHA-256 |
|---|---|
| `shared/business-contract.md` | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| `shared/tests/validate-business-contract-v2.ps1` | `2395D4B0A5806CDCE5FE1C313BE814CF473ABF65B3810E72DBC2BFFD20790589` |
| 复核时 `总功能开发计划0.3.md` | `94766B7BF1D100CCBAE5B2885A2C7986E98DD3141EECA95E2AB87C06327D58F3` |

## TDD 证据

第一轮独立审阅发现机器块没有覆盖正文关键枚举。扩展验证器后，旧候选稳定 RED：

```text
The property 'record_lifecycle' cannot be found on this object.
```

修订候选后，Windows PowerShell 5.1 GREEN：

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
```

## 独立复核

- 平台：专用 OpenClaw 测试环境。
- 会话：`agent:main:explicit:contract-v2-independent-review`。
- 第一轮：`FAIL`，提出 F1–F9 和 NUTR 十层来源优先级问题。
- 第二轮：`PASS`，逐项确认全部关闭；77 条需求与 10 项 legacy guard 成立；新发现为 0。
- 完成标志：`Ready for SH-CONTRACT-001 completion: Yes`。

独立复核者未执行本地验证器、未计算哈希、未扫描业务数据，因此这些机器事实由下述本地门禁独立提供。

## 本地新鲜门禁

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
CONTRACT_AUDIT|PASS|expected=77|actual=77|families=12,12,19,23,11|trace_non_singleton=0|legacy_current_hits=0|fences=even|business_candidates=0
PARSER_ERRORS=0
```

审计期望集合由冻结的五族连续编号独立生成：SCOPE 001–012、EVENT 001–012、MEAL 001–019、PANTRY 001–023、NUTR 001–011。业务候选扫描只匹配 JSONL/SQLite/DB 及其 sidecar/temp/log 文件名，不读取业务内容。

## 关键业务边界

- 唯一写入产品路线是 B；Skill 与 OpenClaw/MCP 只定义或适配同一契约。
- `FactCommit` 失败可以写独立脱敏技术日志，但饮食业务域必须零数据。
- `EffectBundle` 失败保留已提交事实并进入可重试状态；不得重复写事实。
- `EnvelopeFinalize` 失败回滚最终器层并保留 `effects_pending`；不得伪造成功回执或旧进度。

## 受保护文件与数据卫生

五个受保护 lease 文件未读取、未哈希、未编辑、未执行。审计结束时业务候选文件数为 0。

## 后继

下一任务是 `SH-CONTRACT-002`（日期/回执 v2）。本证据不会授权提前创建生产业务表；SQLite repository 仍需等待共享 mapping、harness 和 trace 的计划入口满足。
