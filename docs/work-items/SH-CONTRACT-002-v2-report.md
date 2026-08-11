# SH-CONTRACT-002 日期/回执 v2 实施报告

## 当前状态

- 任务状态：`进行中`
- 候选状态：本地 TDD 与静态审计通过，等待独立语义复核。
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
| `docs/superpowers/plans/2026-08-11-sh-contract-002-date-receipt-v2.md` | `C8A1179376F291D90041D14378F8897A415C9283FF683BE48A8FFACAFB854E4A` |
| 任务开始时总计划0.3 | `25D1C26E3A9800E525D58D76149EF01A259D79D20BA2E03E3BAF0A0FD35687ED` |

## 未关闭项

- 独立复核者必须逐语义审阅11条范围、机器/正文一致性和黄金计算，不能只信验证器。
- 独立 PASS 和新鲜 EV 前不得把任务标为已完成。
- 本契约完成后仍不能绕过 mapping、harness、trace、SQLite 安全门或业务纵切。
