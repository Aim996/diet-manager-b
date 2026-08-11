# SH-CONTRACT-001 实施报告

## 任务与状态

- 任务：SH-CONTRACT-001
- 交付：`shared/business-contract.md` 已重写为 CONTRACT-v1，并包含 77 条任务范围 REQ ID 逐 ID 追踪表。
- 任务台账状态：由主协调者管理；本实施代理未修改总计划、台账或证据登记，也未自行标记任务完成。

## 实际修改文件

1. `E:\codx\skill\饮食管家\shared\business-contract.md`
2. `E:\codx\skill\饮食管家\docs\work-items\SH-CONTRACT-001-report.md`

未修改总计划、案例、Schema、来源注册表、三条路线、验证脚本或证据文件。

## 哈希与规范源审计

- 简报冻结的规范来源 SHA256：`44D191EE102BA22854CDDB6C10D7903ED8598622E70B38F2CD9375ACBE8CE253`
- 执行时规范来源 SHA256：`EC28F7E0E2A39760D753CD0F9DD3E4B444C8DBA46170D6A85F6A87DE000D8EF8`
- 差异处置：主协调者确认该差异仅来自 SH-CONTRACT-001 台账行由“未开始/未分配”变为“进行中/已分配”；第 2—9 节产品需求、REQ ID 与正文未变。本实施以当前文件第 2—9 节为规范来源，未修改该文件。
- 旧契约基线 SHA256：`6527F971C4C7917961CC496C36FFF5C5C55BEFCF53FA62263E03B40349C6685B`（与简报一致）
- 初审候选 CONTRACT-v1 SHA256：`B072AA837F9626298986C68A860893E71E5B29C69DE87CECB779FBC5489669FA`
- 当前通过独立复审的 CONTRACT-v1 SHA256：`CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D`

## 77 条需求集合与追踪结果

- 计划中任务范围 REQ ID：77。
- 契约中唯一任务范围 REQ ID：77。
- 缺失：0；额外：0。
- §13 追踪表中每个任务范围 ID 的出现次数均为 1；非单例：0。
- `REQ-TIME-001` 至 `REQ-TIME-007` 是计划第 5.2 节的支撑性来源，在正文中引用以保持时间语义；其不属于本简报定义的 77 条任务范围追踪集合。

## 关键语义与旧冲突清零

- 必要语义锚点全部存在：`CONTRACT-v1`、`home_default`、`explicit outside: skip inventory read/deduct`、`fact-first`、`upper_plausible_bound`、`append-only correction/void`、`ProductIdentity/NutritionProfile/InventoryBatch`、`NutritionSnapshot`、`unknown != 0`、`per-event atomic`。
- 现行正文（§1—§11）中旧冲突短语命中 0；§12 作为非规范性 `superseded` 审计记录命中 10。旧语义不作为当前默认、兜底或实现许可。

## 只读命令、退出码与关键输出

所有下列命令均为 PowerShell 只读检查；退出码均为 `0`。

### 1. 修改前哈希、报告存在性与业务数据扫描

```powershell
$root='E:\codx\skill\饮食管家'
$plan=Join-Path $root '总功能开发计划0.2.md'
$contract=Join-Path $root 'shared\business-contract.md'
$report=Join-Path $root 'docs\work-items\SH-CONTRACT-001-report.md'
"PLAN_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $plan).Hash)"
"CONTRACT_BASELINE_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $contract).Hash)"
"REPORT_EXISTS=$(Test-Path -LiteralPath $report)"
$businessFiles=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' }
"BUSINESS_DATA_COUNT=$(@($businessFiles).Count)"
```

关键输出：`PLAN_SHA256=EC28F7E0...000D8EF8`；`CONTRACT_BASELINE_SHA256=6527F971...C6685B`；`REPORT_EXISTS=False`；`BUSINESS_DATA_COUNT=0`。

### 2. 契约结构、任务范围集合、追踪表与语义锚点

```powershell
$text=Get-Content -Raw -Encoding utf8 -LiteralPath $contract
$expected=[regex]::Matches((Get-Content -Raw -Encoding utf8 -LiteralPath $plan),'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$actual=[regex]::Matches($text,'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$trace=$text.Substring($text.IndexOf('## 13. 77 条任务范围 REQ ID 逐 ID 追踪表'))
$missing=@($expected | Where-Object { $_ -notin $actual })
$extra=@($actual | Where-Object { $_ -notin $expected })
$traceBad=@($expected | Where-Object { @([regex]::Matches($trace,[regex]::Escape($_))).Count -ne 1 })
$fences=@($text -split "`n" | Where-Object { $_ -match '^\s*```' }).Count
$anchors=@('CONTRACT-v1','home_default','explicit outside: skip inventory read/deduct','fact-first','upper_plausible_bound','append-only correction/void','ProductIdentity/NutritionProfile/InventoryBatch','NutritionSnapshot','unknown != 0','per-event atomic')
$anchorMissing=@($anchors | Where-Object { -not $text.Contains($_) })
```

关键输出：`TARGET_EXISTS=True`；`H1=# CONTRACT-v1：饮食管家三路线共同业务契约`；`HEADING_COUNT=14`；`FENCE_COUNT=0`；`FENCES_PAIRED=True`；`EXPECTED_TASK_REQ_COUNT=77`；`CONTRACT_TASK_REQ_UNIQUE_COUNT=77`；`MISSING_TASK_REQ_COUNT=0`；`EXTRA_TASK_REQ_COUNT=0`；`TRACE_NON_SINGLETON_COUNT=0`；`ANCHOR_MISSING_COUNT=0`；`SUPERSEDED_AUDIT_HEADING=True`；最终 SHA256 如上。

### 3. 旧规则仅位于 superseded 审计段与修改后业务数据扫描

```powershell
$current=$text.Substring(0,$text.IndexOf('## 12. 被替代规则（非规范性审计）'))
$legacy=@('仅明确“在家”才读取/扣减库存','饮水/目标进度/白水不在范围','禁止纠错或冲销','任意数量模糊都必须 `preview`','库存多候选或不足使整条饮食失败','禁止主动查公共营养资料','估算不能用于营养计算','来源只有四级','同一 SKU 多批次必是 `multiple`','营养估算量可直接扣库存')
$legacyHits=@($legacy | Where-Object { $current.Contains($_) })
$business=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' }
"LEGACY_CURRENT_SECTION_HITS=$($legacyHits.Count)"
"BUSINESS_DATA_COUNT_AFTER_CONTRACT=$(@($business).Count)"
```

关键输出：`LEGACY_CURRENT_SECTION_HITS=0`；`SUPERSEDED_SECTION_HITS=10`；`BUSINESS_DATA_COUNT_AFTER_CONTRACT=0`。

### 4. 报告写入后的最终业务数据扫描与契约哈希复核

```powershell
$business=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' }
"REPORT_EXISTS_FINAL=$(Test-Path -LiteralPath $report)"
"CONTRACT_SHA256_FINAL=$((Get-FileHash -Algorithm SHA256 -LiteralPath $contract).Hash)"
"BUSINESS_DATA_COUNT_FINAL=$(@($business).Count)"
```

关键输出：`REPORT_EXISTS_FINAL=True`；`CONTRACT_SHA256_FINAL=B072AA837F9626298986C68A860893E71E5B29C69DE87CECB779FBC5489669FA`；`BUSINESS_DATA_COUNT_FINAL=0`。

## 业务数据检查

- 修改前 `.jsonl` / `.sqlite` / `.sqlite3` / `.db` 文件数：0。
- CONTRACT-v1 写入后文件数：0。
- 报告写入后的最终文件数：0。
- 本任务未创建任何 JSONL、SQLite、SQLite3、DB 或模拟业务数据。

## 尚存风险

规范源冻结 SHA 与执行时 SHA 不同，但已由主协调者确认差异仅为任务治理状态，未影响第 2—9 节需求正文。本代理未发现其他遗留风险或验证失败。

## 独立审阅后的最小修复（F-001 至 F-005）

### 审阅与修复范围

- 已完整阅读独立审阅 `SH-CONTRACT-001-review.md`；审阅结论为 `FAIL`，并接受 F-001 至 F-005。
- 本次仍只修改 `shared/business-contract.md` 与本报告；未修改审阅文件、审阅包、简报、总计划、证据、Schema、来源注册表、路线或业务数据。
- 审阅前候选 SHA256：`B072AA837F9626298986C68A860893E71E5B29C69DE87CECB779FBC5489669FA`。
- 审阅修复后候选 SHA256：`D7024EAAD3514EFEEF4DF4A9C988FD32F52E216481073376598A2413F33B515B`。

### F-001：规范词与硬规则强度

- 将 SHOULD 的唯一偏离门槛收紧为“已登记且生效的例外决定”。
- 将 mixed 汇总回执逐项状态改为 MUST；将固定测试时钟/时区/locale、可靠范围的 `upper_plausible_bound`、精确包装食品优先和高度自定义食品请求精确资料等硬约束复核并按共同语义使用 MUST。
- 对保留的两个 SHOULD（常见食材主动可信查询、包装/精加工/高度自定义食品优先精确资料）复核后确认其偏离仅能走上述已登记且生效的例外决定；REQ-NUTR-007 和 REQ-NUTR-008 已改为 MUST。

### F-002：纠错/冲销的共同结果

冻结任何改变有效摄入、数量、组成或库存效果的 correction/void：MUST 在单一可靠事务边界追加相应事件、执行适用库存补偿与营养重算、更新受影响日期有效 `daily_progress`；原事件、旧营养快照及旧依据仍保留审计。载体字段与展示仍由 companion contracts 冻结。

### F-003：保质动态重算

将位置或开封状态变化后的当前有效估算重算由 MAY 改为 MUST，并保留旧估算及依据审计。

### F-004：位置纠正与入库回执边界

补充用户 MUST 可用自然语言纠正实际采用的位置；冻结共同回执边界为单商品 MAY 详细、多商品 MUST 每项一行简洁反映各自结果，不冻结逐字中文文案。

### F-005：营养基准、精度与覆盖

补充可表达的基准种类（`per_100g`、`per_100ml`、`per_serving`、`per_item`、`per_package`、`custom`）及基准量、单位、份名、每包装份数和换算依据；补充内部稳定精度、展示舍入不回流累计；精确定义 `complete`、`partial`、`estimated`、`unknown` 覆盖状态及未计入项目的 `partial` 规则。未冻结物理字段名或数值精度。

### 审阅修复后的只读验证

实际 PowerShell 检查（退出码 `0`）：

```powershell
$text=Get-Content -Raw -Encoding utf8 -LiteralPath $contract
$expected=[regex]::Matches((Get-Content -Raw -Encoding utf8 -LiteralPath $plan),'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$actual=[regex]::Matches($text,'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$trace=$text.Substring($text.IndexOf('## 13. 77 条任务范围 REQ ID 逐 ID 追踪表'))
$missing=@($expected | Where-Object { $_ -notin $actual })
$extra=@($actual | Where-Object { $_ -notin $expected })
$traceBad=@($expected | Where-Object { @([regex]::Matches($trace,[regex]::Escape($_))).Count -ne 1 })
$fences=@($text -split "`n" | Where-Object { $_ -match '^\s*```' }).Count
$anchors=@('已登记且生效的例外决定','汇总回执 MUST 逐项说明状态','单一可靠事务边界追加相应事件、执行适用的库存补偿和营养重算，并更新受影响日期的有效 `daily_progress`','位置或开封变化后 MUST 重算当前有效估算','用户 MUST 可用自然语言纠正位置','单商品 MAY 提供详细回执；多商品同时入库时 MUST 对每项一行简洁','per_100g','per_100ml','per_serving','per_item','per_package','custom','基准量、基准单位、份名、每包装份数','内部计算 MUST 使用稳定精度','展示后的舍入值 MUST NOT 回流参与累计','`complete` 表示','`partial` 表示','`estimated` 表示','`unknown`（营养覆盖）')
$anchorMissing=@($anchors | Where-Object { -not $text.Contains($_) })
$business=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' }
```

关键输出：`TASK_REQ_EXPECTED=77`；`TASK_REQ_ACTUAL=77`；`TASK_REQ_MISSING=0`；`TASK_REQ_EXTRA=0`；`TRACE_NON_SINGLETON=0`；`FENCES_PAIRED=True`；`REVIEW_ANCHOR_MISSING=0`；`SHOULD_LINE_COUNT=2`（规范词定义及经复核的 REQ-NUTR-002/003 语义）；`BUSINESS_DATA_COUNT_PRE_REVIEW_FIX=0`；新候选 SHA256 如上。

报告写入后的最终只读扫描（退出码 `0`）输出：`REPORT_EXISTS_REVIEW_FIX=True`；`CONTRACT_SHA256_REVIEW_FIX_FINAL=D7024EAAD3514EFEEF4DF4A9C988FD32F52E216481073376598A2413F33B515B`；`BUSINESS_DATA_COUNT_REVIEW_FIX_FINAL=0`。

## 第二轮独立复审后的最小修复（R-001 至 R-004）

### 审阅与修复范围

- 已完整阅读 `SH-CONTRACT-001-review.md` 第 7 节的 R-001 至 R-004；第二轮复审原结论为 `FAIL`。
- 本轮仍只修改 `shared/business-contract.md` 与本报告，未修改任务状态、审阅文件、审阅包、简报、总计划、证据、Schema、来源注册表、路线或业务数据。
- 审阅前候选 SHA256：`D7024EAAD3514EFEEF4DF4A9C988FD32F52E216481073376598A2413F33B515B`。
- 第二轮修复后候选 SHA256：`CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D`。
- 修复前业务数据文件数：0。

### R-001 与 R-002：companion 不得缩窄共同语义

- `issue/correction contract` 现在只冻结问题分类、Correction/void 的载体、字段与展示，并明确 MUST 遵守 §4 的追加、单一可靠事务、适用库存补偿、营养重算、受影响日期 `daily_progress` 更新和原事件/旧快照/旧依据审计结果。
- `receipt/date contract` 现在只冻结精确中文格式、日期格式与快捷选项文案，并明确 MUST 遵守 §8 的位置自然语言纠正以及单商品 MAY 详细、多商品 MUST 每项一行简洁的共同边界。

### R-003：home_default 的可靠扣减

在 `home_default` 下，系统 MUST 默认读取、尝试关联并尝试扣减家庭库存；当且仅当 `unique`、可靠可换算且足量时 MUST 扣减。仅其他前置条件不满足时，饮食事实提交并以稳定状态跳过扣减；fact-first、单一事务、并发安全和不负库存规则未变。

### R-004：默认策略的正确强度

- 有可靠合理范围时，`upper_plausible_bound` 恢复为 SHOULD；偏离仍只能依据 §1 的“已登记且生效的例外决定”。
- §6 与 §9 统一为 SHOULD：精确包装食品优先精确资料，高度自定义复合食品请求配方/用量/标签，包装/精加工/高度自定义食品优先精确资料。明显不适用通用资料的 MUST NOT、无可靠资料 `unknown` 和 fact-first 均保留。

### 第二轮修复后的只读验证

实际 PowerShell 检查（退出码 `0`）：

```powershell
$text=Get-Content -Raw -Encoding utf8 -LiteralPath $contract
$expected=[regex]::Matches((Get-Content -Raw -Encoding utf8 -LiteralPath $plan),'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$actual=[regex]::Matches($text,'REQ-(?:SCOPE|EVENT|MEAL|PANTRY|NUTR)-\d{3}') | ForEach-Object Value | Sort-Object -Unique
$trace=$text.Substring($text.IndexOf('## 13. 77 条任务范围 REQ ID 逐 ID 追踪表'))
$missing=@($expected | Where-Object { $_ -notin $actual })
$extra=@($actual | Where-Object { $_ -notin $expected })
$traceBad=@($expected | Where-Object { @([regex]::Matches($trace,[regex]::Escape($_))).Count -ne 1 })
$fences=@($text -split "`n" | Where-Object { $_ -match '^\s*```' }).Count
$rAnchors=@('receipt/date contract：只冻结','MUST 遵守 §8 已冻结的位置可自然语言纠正','多商品 MUST 每项一行简洁反映各自结果','issue/correction contract：只冻结问题分类、Correction/void 的载体、字段和展示','MUST 遵守 §4 已冻结的追加、单一可靠事务、适用库存补偿、营养重算、受影响日期 `daily_progress` 更新','在 `home_default` 场景系统 MUST 默认读取、尝试关联并尝试扣减家庭库存','当且仅当为 `unique`、可可靠换算且足量时 MUST 扣减','营养存在可靠合理范围时 SHOULD 使用 `upper_plausible_bound`','精确包装食品 SHOULD 优先精确资料','高度自定义复合食品 SHOULD 请求配方、用量或标签')
$anchorMissing=@($rAnchors | Where-Object { -not $text.Contains($_) })
$shouldLines=[regex]::Matches($text,'(?im)^.*\bSHOULD\b.*$') | ForEach-Object Value
$mayLines=[regex]::Matches($text,'(?im)^.*\bMAY\b.*$') | ForEach-Object Value
```

关键输出：`TASK_REQ_EXPECTED=77`；`TASK_REQ_ACTUAL=77`；`TASK_REQ_MISSING=0`；`TASK_REQ_EXTRA=0`；`TRACE_NON_SINGLETON=0`；`FENCES_PAIRED=True`；`R_ANCHOR_MISSING=0`；`SHOULD_LINE_COUNT=4`；`UNEXPECTED_SHOULD=0`；`MAY_LINE_COUNT=10`；新候选 SHA256 如上。

报告写入后的最终只读扫描（退出码 `0`）输出：`REPORT_EXISTS_SECOND_REVIEW=True`；`CONTRACT_SHA256_SECOND_REVIEW_FINAL=CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D`；`BUSINESS_DATA_COUNT_SECOND_REVIEW_FINAL=0`。
