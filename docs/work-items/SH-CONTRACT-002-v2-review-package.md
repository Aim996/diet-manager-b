# SH-CONTRACT-002 日期/回执 v2 独立复核包

## 输入

1. `总功能开发计划0.3.md`
2. `shared/business-contract.md`
3. `shared/contracts/receipt-and-date-contract.md`
4. `shared/tests/validate-receipt-and-date-contract-v2.ps1`
5. `docs/work-items/SH-CONTRACT-002-v2-brief.md`
6. `docs/work-items/SH-CONTRACT-002-v2-report.md`

旧无 `-v2` 文件和 `EV-20260809-006`不得作为当前 PASS 依据。

## 冻结候选

- 日期/回执候选：`F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD`
- v2验证器：`DB7B9CD1BADF07CB4BDF14536CC7077276C16702E8040B9FD31D1E4AA6C6F0B7`
- 上游 CONTRACT-v2：`632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- 复核源计划：`12F889F58D1EEC7989CAB373109C8F7622D78AD0032493C128B320F6C7F88DFD`

## 独立检查清单

审阅者必须只读判断，不得把实现方测试 PASS 当作契约 PASS：

1. 当前11条范围是否逐条有真实语义载体且追踪单例：TIME 3、QUICK 1、PROGRESS 4、RECEIPT 3。
2. `OccurredTime` 是否保留区间、时区、解析依据/锚点/版本，且与接收/提交时间分离。
3. 日期消歧是否与总计划一致；未知时间是否不补 `00:00`。
4. `daily_progress_by_date[]` 是否是规范源；一日别名逐字段相同，多日无别名。
5. 信封增量和终态幂等是否冻结，适配器是否禁止旧快照、差值或模型累加。
6. 六项顺序、两行、10格、单位、十进制`round_half_up`、unknown/partial下界是否正确。
7. 6项黄金数值是否应独立重算为99/69/106/99/85/57%，填充10/7/10/10/9/6，增量41/29/39/43/38/20%。
8. 字段级`按个人模板/沿用历史营养表/参考数据库/估算`是否不把明确字段误标估算。
9. 回执区块顺序、真实库存效果和进度块最后位置是否成立。
10. `effects_pending`、事实失败或最终器失败是否完全没有成功回执/进度块；同键重试是否只恢复未完成层。
11. B-only与薄适配器是否保持，是否出现OpenClaw/MCP专属业务逻辑、Schema字段或未经计划批准的新能力。
12. 十项旧展示规则是否只在superseded审计中出现，现行正文没有复活。

## 输出

第一行必须精确为 `PASS` 或 `FAIL`。FAIL要给严重度、精确位置、受影响REQ/DEC/CHG和最小修复；PASS仍需给11条逐语义结论、黄金重算、旧规则结论、哈希边界和审阅限制。结尾必须为：

```text
Ready for SH-CONTRACT-002 completion: Yes|No
```
