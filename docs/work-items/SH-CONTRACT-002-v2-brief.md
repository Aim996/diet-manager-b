# SH-CONTRACT-002 日期/回执 v2 实施简报

## 任务身份

- 任务：`SH-CONTRACT-002`
- 当前状态：`进行中`
- 目标：把总计划 0.3 的 `OccurredTime`、字段级证据标签、单日/跨日权威进度和最终回执冻结为 CONTRACT-v2 的伴随契约。
- 上游：`SH-CONTRACT-001` / `EV-20260811-013`
- 规范来源：`总功能开发计划0.3.md`
- 规范来源 SHA-256（任务开始时）：`25D1C26E3A9800E525D58D76149EF01A259D79D20BA2E03E3BAF0A0FD35687ED`
- 上游 CONTRACT-v2 SHA-256：`632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- 决定：`DEC-013`、`DEC-016`、`DEC-022`、`DEC-024`、`DEC-027`、`DEC-028`
- 变更：`CHG-20260809-001`
- 风险：`RISK-002`

旧的无 `-v2` work-item 文件和 `EV-20260809-006`属于总计划 0.2 / CONTRACT-v1 历史，不证明当前任务完成。

## 授权文件

本任务只修改或创建：

1. `shared/contracts/receipt-and-date-contract.md`
2. `shared/tests/validate-receipt-and-date-contract-v2.ps1`
3. `docs/work-items/SH-CONTRACT-002-v2-{brief,report,review-package,review}.md`
4. `docs/superpowers/plans/2026-08-11-sh-contract-002-date-receipt-v2.md`
5. 独立 PASS 后的 EV、总计划和开发进度状态行

不得读取、哈希、编辑或执行五个受保护 lease 文件；不得创建业务表、迁移、repository 或业务数据。

## 当前任务范围

| 族 | 当前 0.3 ID | 数量 |
|---|---|---:|
| 时间 | `REQ-TIME-001`–`REQ-TIME-003` | 3 |
| 快捷项 | `REQ-QUICK-001` | 1 |
| 进度 | `REQ-PROGRESS-001`–`REQ-PROGRESS-004` | 4 |
| 回执 | `REQ-RECEIPT-001`–`REQ-RECEIPT-003` | 3 |
| 合计 | — | 11 |

`REQ-WATER-001/002`、库存位置/效果、Issue 和 Correction 是支撑性上游语义，不进入本任务 11 条追踪集合。

## 必须冻结

- `OccurredTime` 精确字段和 `exact/date/meal_period/approximate/unknown`；区间不得压成伪精确时刻。
- 本月几号、同年跨月月日、跨年完整日期；未知时间不补 `00:00`。
- 成功回执只来自同次终态 `EnvelopeFinalize` 的冻结 `ReceiptData` 与进度结果。
- `daily_progress_by_date[]` 是规范源；一日同时提供逐字段相同 `daily_progress`，多日不得提供单数别名。
- `current_turn_increments` 只来自当前信封，不由模型求差或累加多个旧结果。
- 六项固定顺序、两行、10 格、十进制 `round_half_up`、未知纤维与饮水已知下界。
- “估算”只标真正推定字段；明确包装、用户明确数量、同商品历史营养表、个人模板和可信公共数据库必须显示准确来源标签。
- `effects_pending` 或最终器失败时不得输出成功回执或进度块；同键终态重试返回冻结原结果。
- 便携 Skill 和薄适配器不得重算、补写或改变 B 后端结果。

## 验收命令

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-receipt-and-date-contract-v2.ps1
```

期望最终输出：

```text
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
```

此外必须通过 PowerShell Parser、11 条 ID 单例、Markdown 围栏、旧规则扫描、黄金公式/日期及业务候选 0，并取得独立复核 PASS 和新鲜 EV 后才能完成。
