# SH-CONTRACT-002 实施报告

## 授权范围与修改

仅修改以下两份授权文件：

1. `shared/contracts/receipt-and-date-contract.md`
2. `docs/work-items/SH-CONTRACT-002-report.md`

未修改总计划、`shared/business-contract.md`、其他契约、Schema、案例、来源注册表、验证脚本、证据、A/B/C 路线或任务状态；未创建 JSONL、SQLite、SQLite3、DB 或模拟业务数据。

交付物规定了：展示时区日期消歧、完整成功饮食/白水回执、单/多商品入库回执、快捷选项与安全出口、同次最终 `daily_progress` 权威规则、六项两行格式、十进制 `round_half_up` 与边界 Oracle、无目标/未知纤维/未知水分下界，以及 46 条任务范围 REQ ID 的逐 ID 追踪表。

## 哈希与追踪结果

| 对象 | SHA-256 | 标签 |
| --- | --- | --- |
| 总计划 `总功能开发计划0.2.md` | `6A68F5B3C8A421C2D9D4828AF9CEAC7EC7458D16E23E9423F339F8C34F88EBB8` | 规范来源 |
| 上游 `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | 上游契约 |
| 交付物 `shared/contracts/receipt-and-date-contract.md` | `BCD8597229B5B1926B943F5C4530B7C1D5AC4C2311C26556C56162B62E20B2F6` | 初次实施自检候选 |
| 交付物 `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | 当前通过独立复审候选 |

46 条集合为 `REQ-TIME-001~007`、`REQ-UX-001~007`、`REQ-QUICK-001~008`、`REQ-RECEIPT-001~010`、`REQ-PROGRESS-001~014`。独立校验结果：预期 46，追踪表 46，缺失 0，额外 0，重复 0。

## 只读自检

实际执行的 PowerShell 校验命令（仅读取）：

```powershell
$root = 'E:\codx\skill\饮食管家'
$plan = Join-Path $root '总功能开发计划0.2.md'
$contract = Join-Path $root 'shared\contracts\receipt-and-date-contract.md'
$business = Join-Path $root 'shared\business-contract.md'
$text = Get-Content -Raw -Encoding utf8 $contract
$expected = @()
foreach ($x in @(@('REQ-TIME',7),@('REQ-UX',7),@('REQ-QUICK',8),@('REQ-RECEIPT',10),@('REQ-PROGRESS',14))) {
  1..$x[1] | ForEach-Object { $expected += ('{0}-{1:D3}' -f $x[0], $_) }
}
$trace = $text.Substring($text.IndexOf('## 9. 46 条任务范围 REQ ID 逐 ID 追踪表'))
$ids = [regex]::Matches($trace, '\| (REQ-(?:TIME|UX|QUICK|RECEIPT|PROGRESS)-\d{3}) \|') | ForEach-Object { $_.Groups[1].Value }
$golden = @('2026-08-05 -> 5号','2026-07-15 -> 7月15号','已记录：9号晚餐','也可以直接说明实际情况，不必选择以上选项。','🥬 纤维 ░░░░░░░░░░ 未知','目标未配置，进度条不可用。','💧 饮水 ██░░░░░░░░ ≥20%','round_half_up','current=5, target=100')
$missing = $expected | Where-Object { $_ -notin $ids }
$extra = $ids | Where-Object { $_ -notin $expected }
$dupes = $ids | Group-Object | Where-Object Count -ne 1
$missingGolden = $golden | Where-Object { -not $text.Contains($_) }
$data = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' }
[pscustomobject]@{ exists = Test-Path -LiteralPath $contract; front_matter = $text.StartsWith("---`ncontract_id:"); fences = ([regex]::Matches($text,'(?m)^```')).Count; expected_ids = $expected.Count; trace_ids = $ids.Count; missing_ids = @($missing).Count; extra_ids = @($extra).Count; nonunique_ids = @($dupes).Count; missing_golden = @($missingGolden).Count; business_data = @($data).Count; plan_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $plan).Hash; business_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $business).Hash; deliverable_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $contract).Hash } | Format-List
if ((Test-Path -LiteralPath $contract) -and $text.StartsWith("---`ncontract_id:") -and (([regex]::Matches($text,'(?m)^```')).Count % 2 -eq 0) -and @($missing).Count -eq 0 -and @($extra).Count -eq 0 -and @($dupes).Count -eq 0 -and @($missingGolden).Count -eq 0 -and @($data).Count -eq 0) { exit 0 }
exit 1
```

退出码：`0`。

关键输出：

```text
contract_exists            : True
front_matter               : True
markdown_fence_count       : 20
expected_id_count          : 46
trace_id_count             : 46
missing_id_count           : 0
extra_id_count             : 0
nonunique_trace_id_count   : 0
missing_golden_token_count : 0
business_data_file_count   : 0
```

业务数据文件数为 0：交付物修改前为 0，交付物修改后仍为 0；实现期间仅以 `apply_patch` 写入本报告列出的两份 Markdown 文件，未接触任何业务数据路径。上游 business-contract 哈希与简报给定的 `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` 一致。

黄金文本和公式 Oracle 检查覆盖日期、完整成功回执、快捷末行、未配置目标、纤维未知、饮水下界、`round_half_up` 与 `current=5,target=100` 的半进位边界；被取代的 15 类旧展示行为仅在 `superseded` 审计段出现，不构成现行规范。

## 遗留问题

无。后续仍需由独立复核角色按总计划完成复核，并由主协调者维护任务台账和证据登记；本实施未修改它们。

## 独立审阅 F-01～F-10 最小修复

已在独立审阅 FAIL 后仅修订交付物和本报告，未修改任务状态或证据登记。

| 发现 | 最小修复 |
| --- | --- |
| F-01 | 模糊时间从“日期范围”更正为“时间范围”。 |
| F-02 | 明确解析规则升级 MUST NOT 静默改写历史解析结果。 |
| F-03 | 入库示例的本月标签到期日改为 `12号`，购买日改为 `9号`。 |
| F-04 | 完整黄金回执中的纤维进度条改为 9 `█` + 1 `░`，饮水改为 6 `█` + 4 `░`。 |
| F-05 | 在库存行与六项进度块之间恢复一个空行。 |
| F-06 | 明定互斥/后果冲突的组合 MUST NOT 执行，先消歧再重校验；`A+C` 仅可解析，不得直接扣减。 |
| F-07 | 直接日/周进度查询改为 MUST 使用一次聚合调用。 |
| F-08 | 无目标时改为 MUST 先显示固定首行。 |
| F-09 | 入库回执改为 MUST 显示实际采用位置，且用户 MUST 可自然语言纠正。 |
| F-10 | 删除动态 `status`；改为 `status_source: 总功能开发计划0.2.md §22 唯一任务台账`，正文“冻结”改为“规定”。 |

交付物 SHA-256 已由审阅前的 `BCD8597229B5B1926B943F5C4530B7C1D5AC4C2311C26556C56162B62E20B2F6` 更新为 `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968`。总计划和上游 business-contract 哈希保持不变。

### 审阅修复后的只读复验

实际执行的 PowerShell 命令以 `$expected` 生成 46 个 ID，读取 §9 追踪表；以十进制 `[decimal]` 和 `[MidpointRounding]::AwayFromZero` 重算六项 `percentage`、`filled`、`increment_percentage` 及 0/5/105/已知饮水下界；同时逐字检查全部六个日期样本、入库本月日期、完整回执空行、快捷冲突文案、无目标/未知下界黄金文本、front matter、围栏、旧行为约束、业务数据扩展名和 SHA-256。实际执行主体如下：

```powershell
$text = Get-Content -Raw -Encoding utf8 $contract
$expected = @(); foreach ($x in @(@('REQ-TIME',7),@('REQ-UX',7),@('REQ-QUICK',8),@('REQ-RECEIPT',10),@('REQ-PROGRESS',14))) { 1..$x[1] | ForEach-Object { $expected += ('{0}-{1:D3}' -f $x[0], $_) } }
$trace = $text.Substring($text.IndexOf('## 9. 46 条任务范围 REQ ID 逐 ID 追踪表'))
$ids = [regex]::Matches($trace, '\| (REQ-(?:TIME|UX|QUICK|RECEIPT|PROGRESS)-\d{3}) \|') | ForEach-Object { $_.Groups[1].Value }
$roundHalfUp = { param([decimal]$n) [Math]::Round($n,0,[MidpointRounding]::AwayFromZero) }
# 对六项 current/target/increment 和四个边界逐项比较预期 percentage/filled/increment。
# 对所有日期、黄金行、status_source、围栏、superseded 旧行为约束和业务数据扩展名断言。
(Get-FileHash -Algorithm SHA256 -LiteralPath $plan).Hash
(Get-FileHash -Algorithm SHA256 -LiteralPath $business).Hash
(Get-FileHash -Algorithm SHA256 -LiteralPath $contract).Hash
```

退出码：`0`。实际关键输出：

```text
exists                 : True
front_matter           : True
fences                 : 20
expected_ids           : 46
trace_ids              : 46
missing_ids            : 0
extra_ids              : 0
nonunique_ids          : 0
missing_golden         : 0
numeric_failures       : 0
boundary_failures      : 0
old_behavior_check     : True
business_data          : 0
plan_sha256            : 6A68F5B3C8A421C2D9D4828AF9CEAC7EC7458D16E23E9423F339F8C34F88EBB8
business_sha256        : CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
old_deliverable_sha256 : BCD8597229B5B1926B943F5C4530B7C1D5AC4C2311C26556C56162B62E20B2F6
deliverable_sha256     : D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968
```

业务数据文件在修复前和修复后均为 0；本轮仅使用 `apply_patch` 修改本报告和交付物。遗留风险：无；仍须由独立复核角色按总计划复审，且只有主协调者可更新任务状态或证据登记。
