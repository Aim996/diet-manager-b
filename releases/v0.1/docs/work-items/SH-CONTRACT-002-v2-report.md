# SH-CONTRACT-002 日期/回执 v2 实施报告

## 当前状态

- 任务状态：`已完成`
- 候选状态：本地 TDD、静态审计和 OpenClaw 独立语义复核均通过；证据为 `EV-20260811-014`。
- 产品边界：没有创建业务表、迁移、repository 或业务数据；产品仍不可安装。

## 交付物

- `shared/contracts/receipt-and-date-contract.md`
- `shared/tests/validate-receipt-and-date-contract-v2.ps1`
- `docs/work-items/SH-CONTRACT-002-v2-brief.md`
- `docs/work-items/SH-CONTRACT-002-v2-report.md`
- `docs/work-items/SH-CONTRACT-002-v2-review-package.md`
- `docs/superpowers/plans/2026-08-11-sh-contract-002-date-receipt-v2.md`

旧无 `-v2` work-item 与 `EV-20260809-006`只作为总计划0.2/CONTRACT-v1历史。

## 实际修订

- 上游从 CONTRACT-v1 切换到 `diet-manager/contract-v2`，写入路线只允许 B，Skill/OpenClaw/MCP 只能薄适配。
- 新增机器块，冻结 `OccurredTime` 八字段、五种精度、日期消歧、五个回执区块、六项进度、十进制 `round_half_up`、字段级证据标签和十项旧展示 guard。
- `daily_progress_by_date[]` 成为规范源；一日提供逐字段相同别名，多日禁止别名。
- `current_turn_increments` 只来自信封持久化聚合；终态幂等返回冻结原结果。
- `effects_pending`、`failed_fact`、最终器失败或业务 `failed` 均不得生成成功回执/进度块。
- 黄金回执改为字段级估算，并只报告真实库存效果；通用营养模板不再冒充组件库存扣减依据。
- 追踪表从旧0.2的46个拆分ID收敛为当前0.3的11个任务ID。

## TDD

验证器改为 ASCII-only，避免 Windows PowerShell 5.1 对无 BOM UTF-8 脚本中的中文字符串产生解析歧义。

第一轮真正 RED：

```text
RECEIPT-DATE-CONTRACT-v2 machine block is missing
```

补机器协议后第一轮 GREEN：

```text
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
```

第二轮先扩展验证器，旧候选 RED：

```text
The property 'golden_progress' cannot be found on this object.
```

补 6 项黄金输入/期望与单日、跨日、最终器 pending 正文锚点后 GREEN：

```text
VALIDATOR_NON_ASCII=0
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
```

## 当前哈希

| 文件 | SHA-256 |
|---|---|
| `shared/contracts/receipt-and-date-contract.md` | `F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD` |
| `shared/tests/validate-receipt-and-date-contract-v2.ps1` | `DB7B9CD1BADF07CB4BDF14536CC7077276C16702E8040B9FD31D1E4AA6C6F0B7` |
| `docs/work-items/SH-CONTRACT-002-v2-brief.md` | `06116A5176342CD06AEA1D7392DA627C6BECFD13AA99F61EE3AC8E510259DD25` |
| `docs/superpowers/plans/2026-08-11-sh-contract-002-date-receipt-v2.md` | `73D589402C127765987CEA6B11D6E16FC102BEB5CF4FEDE8F6E4BD70538A8490` |
| `docs/work-items/SH-CONTRACT-002-v2-review.md` | `880C13E9C30638F7BB05ACAADA90BE03FAF5AB37950D384F2820C3CAF9AEC7FF` |
| `docs/evidence/EV-20260811-014-sh-contract-002-v2.md` | `59E2D29AF0F9E0CCC3B441FB617635BF809B7DFF5C3A237538A876AC798D8BF2` |
| 任务开始时总计划0.3 | `25D1C26E3A9800E525D58D76149EF01A259D79D20BA2E03E3BAF0A0FD35687ED` |

## 独立复核与最终门禁

- OpenClaw 会话：`agent:main:explicit:contract-002-v2-independent-review`。
- 结论：`PASS`；完成标志为 `Ready for SH-CONTRACT-002 completion: Yes`。
- 独立重算：百分比 `99/69/106/99/85/57`，filled `10/7/10/10/9/6`，本轮增量百分比 `41/29/39/43/38/20`。
- 本地最终门禁：Parser 0、ASCII 0、11/11 trace 单例、旧 ID 0、围栏 24、业务候选 0。

本契约完成后仍不能绕过模型、mapping、harness、trace、SQLite 安全门或业务纵切。下一项是 `SH-CONTRACT-004`。
