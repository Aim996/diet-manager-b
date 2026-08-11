# EV-20260809-008：SH-CONTRACT-004 问题与纠错共同契约验证证据

## 1. 结论

- 任务：`SH-CONTRACT-004`
- 最终结论：`PASS`
- 主协调验证时间：2026-08-09 16:38:14 +08:00
- 验证环境：Windows NT 10.0.26200.0；Windows PowerShell 5.1.26100.8875；项目根 `E:\codx\skill\饮食管家`
- 候选：`shared\contracts\issue-correction-contract.md`
- 候选 SHA-256：`45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA`
- 独立复审：第 1 轮 FAIL 后修复，第 2 轮完整复审 PASS；32/32 需求、20/20 标准和 13/13 场景全部通过；新增发现 0，剩余高/中阻断 0。
- 正式业务数据：验证前 0，验证后 0，新增/修改/删除 0。

## 2. 冻结输入与交付物

| 文件 | SHA-256 | 说明 |
| --- | --- | --- |
| `docs\work-items\SH-CONTRACT-004-brief.md` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` | 32 条任务范围、场景和审阅边界 |
| `shared\business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | 上游 CONTRACT-v1 |
| `shared\contracts\receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | 上游展示契约 |
| `shared\contracts\issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` | 最终候选 |
| `docs\work-items\SH-CONTRACT-004-report.md` | `439AE4CDA608565C4D3EC1E7A16E6B9BB511435440EDBAA7465CE31B09B60C4D` | 实施、自检和两项修复记录 |
| `docs\work-items\SH-CONTRACT-004-review-package.md` | `B31501F3FFA6EE270AF36A227C8C7D707271FB3313E6AB48545E5DFD404DD40F` | 第 2 轮冻结复核包 |
| `docs\work-items\SH-CONTRACT-004-review.md` | `19B46481DAFFEFDE19064A4AA8CC6E03ACF425E4EF2AA3715B62F93AE26B0673` | 独立复审；完整保留第 1 轮 FAIL 历史 |

## 3. 已冻结的核心语义

### 3.1 事实优先与问题处理

- `preview/committed/ignored/failed` 是命令结果，`active/corrected/voided` 是持久化生命周期，两组状态不得混用。
- 数量模糊、库存多候选/不足和营养未知只影响附加效果；已发生且可识别的饮食事实必须先提交并创建相应 Issue。
- Issue 固定为 3 个 `issue_kind`、17 个稳定 `issue_code` 和 6 个状态；状态变化必须追加记录，不得覆盖原 Issue。
- 已提交事实的“稍后处理/先别扣”必须持久化为 `deferred` Resolution；明确“不关联”必须持久化为 `dismissed` Resolution；两者均返回 `committed`，不得误用 `ignored`。

### 3.2 快捷解决与纠错

- 快捷选项必须说明真实效果和非效果，支持字母、组合、顺序及自由文本；冲突组合必须在任何业务效果前拒绝。
- 每组快捷选项的最后一行固定为“也可以直接说明实际情况，不必选择以上选项。”，其后不得追加同组建议。
- Correction 固定 12 种操作，采用追加式版本链和目标版本校验；单项删除、整条 void、跨日、库存真实差量及营养新快照均有唯一语义。
- 纠错上调但库存不足时，饮食纠正仍 `committed`；保留原真实扣减，新增差量标记 `skipped_insufficient`，创建 `insufficient_inventory(context=correction_increment)`，不得负库存或伪造补扣。

### 3.3 故障与原子边界

- 已持久化的 Resolution outcome 固定为 7 项，包含 `rejected_effect`；`failed_storage` 只能作为未持久化命令失败，不能成为已持久化事件结果。
- 审计存储不可用、事务回滚或提交结果未知时必须失败关闭，不得声称 Resolution、Correction、幂等成功或任何事件 ID 已生成。
- 单一事件必须在一个可证明的原子边界内包含领域事件、真实/跳过库存效果、营养快照、Issue/Resolution、幂等结果和最终进度引用。
- `mixed` 只作为有序输入信封；每个子事件独立幂等、逐事件原子，后一失败不得回滚前一已提交事件。

## 4. 独立复审与修复历史

第 1 轮独立复审结论为 FAIL，共 2 个中严重度阻断：

1. `F-01`：原文把 `ignored` 简写为“明确不处理”，可能把已提交事实的“先别扣/以后再说”误判为零写入，而不是追加 `deferred/dismissed` Resolution。
2. `F-02`：原文要求持久化 `failed_storage` 事件，与“权威审计存储本身不可用”时无法持久化任何审计事件相冲突。

最终候选把 `ignored` 严格限定为计划、假设、明确否定、发生前取消和明确非本人根事实；对已提交事实的安全出口改为持久化 Resolution。`failed_storage` 被限定为未持久化命令错误；存储失败时不得声称任何事件或幂等成功存在。

第 2 轮由同一独立复核者完整重跑，而非只看差异：F-01、F-02 均关闭，新发现 0；32/32 需求、20/20 标准、13/13 场景全部通过，最终 PASS。

## 5. 主协调者最终验证

只读验证脚本：`docs\evidence\raw\EV-20260809-008-validate-issue-correction-contract.ps1`

- 脚本 SHA-256：`B2E9A4358207CAABECE778459D2C87022D9263B134C340CCC9A7588DFAABE513`
- 原始输出：`docs\evidence\raw\EV-20260809-008-validation-output.txt`
- 输出 SHA-256：`F0DC6F5302947360574576B1DEEC13FDADB27B087CA7E801E5F5B8382F3D4434`
- 退出码：0
- 需求追踪：32/32，无缺失、额外或重复
- Issue 枚举：3 kind、17 code、6 status
- Correction 操作：12 项
- 已持久化 Resolution outcome：7 项；`failed_storage` 非持久化边界通过
- 必测语义场景：13/13
- 正常补扣、补扣不足、自由文本末行：黄金文本通过
- 事实优先、真实库存差量、无负库存、跨日、幂等、mixed、固定路径、unknown 与精确十进制：检查通过
- 最终结果：`FAILURE_COUNT=0`、`VERDICT=PASS`

实际执行方式：

```powershell
$scriptPath='E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-008-validate-issue-correction-contract.ps1'
$scriptText=Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
& ([scriptblock]::Create($scriptText))
```

## 6. 业务数据隔离证明

扫描根：`E:\codx\skill\饮食管家`

扫描扩展名：`.jsonl`、`.sqlite`、`.sqlite3`、`.db`

| 时点 | 文件数 | 路径/大小/SHA-256/mtime |
| --- | ---: | --- |
| 独立复审第 2 轮前后 | 0 / 0 | 无 |
| 主协调验证前（2026-08-09 16:38:14 +08:00） | 0 | 无 |
| 主协调验证后（2026-08-09 16:38:14 +08:00） | 0 | 无 |
| 原始输出落盘后（2026-08-09 16:38:44 +08:00） | 0 | 无 |
| 本证据写入后（2026-08-09 16:39:43 +08:00） | 0 | 无 |

因此，本任务的实施、自检、两轮独立复审、主协调者验证和原始证据落盘均未创建或修改 JSONL/SQLite 正式业务数据。

## 7. 后续任务边界

- 本任务只冻结 Issue、快捷解决、Correction/void 和 mixed 的共同语义；物理 JSON Schema 由 `SH-MODEL-001`，最终提交结果/进度 Schema 由 `SH-MODEL-002`，JSONL/SQLite 映射由 `SH-MODEL-003` 完成。
- `Q-004` 尚不能仅凭本文关闭；仍需后续正常补扣、库存不足、自由文本、陈旧候选与幂等 Oracle 证据。
- 本任务未实现 A/B/C 任一路线业务写入，也未安装或填充正式业务数据库。
