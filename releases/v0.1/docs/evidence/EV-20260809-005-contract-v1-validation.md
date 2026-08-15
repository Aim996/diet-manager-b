# EV-20260809-005：CONTRACT-v1 验证与独立复审

## 证据身份

| 字段 | 实际值 |
| --- | --- |
| 证据 ID | EV-20260809-005 |
| 日期时间 | 2026-08-09 14:39 +08:00（Asia/Shanghai） |
| 关联任务 | SH-CONTRACT-001 |
| 关联需求 | REQ-SCOPE-001~012、REQ-EVENT-001~012、REQ-MEAL-001~019、REQ-PANTRY-001~023、REQ-NUTR-001~011 |
| 关联案例 | 不适用；共同验收 Oracle 尚未由 SH-CASE-* 冻结，本任务按 77 条精确需求和独立语义审阅验收 |
| 结果 | PASS |
| 正式业务数据影响 | 0 |

## 环境

| 项目 | 实际值 |
| --- | --- |
| 操作系统 | Microsoft Windows NT 10.0.26200.0 |
| PowerShell | 5.1.26100.8875 |
| 时区 | Asia/Shanghai，+08:00 |
| 项目根 | E:\codx\skill\饮食管家 |
| 数据根 | 未配置、未使用；本任务仅修改 Markdown 文档与证据文本 |
| Node.js / OpenClaw | 未调用；本任务不运行路线实现、插件或业务写入 |
| Git | 项目不是 Git 仓库；以冻结哈希、实施报告和独立审阅替代提交差异 |

## 验收对象与冻结哈希

| 对象 | SHA256 |
| --- | --- |
| 验证时总计划 | EC28F7E0E2A39760D753CD0F9DD3E4B444C8DBA46170D6A85F6A87DE000D8EF8 |
| shared\business-contract.md | CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D |
| 实施简报 | 3728C4237FC884303C537BB35D70009B97040C7B972E1E8CE10EA2F1E33EFF4D |
| 实施报告 | AD9BC254CC57A386A234A770099DC4E389CA9EC7CAC270CF50E2CB8C19B2EE94 |
| 独立审阅报告 | 490E0D2440FE9E51C7C265CCBDAABA5ECF3AC5EFC09D80BE603A23A7A3197470 |
| 审阅包 | A66FC52870B983F5F4814C8271E1657B76BE8C1B41F33671B362326D82E79ACF |
| 可复现验证脚本 | 9ED2842765CF6E4FAEB7C1F5E19D60EDC0029D7768090B0B7E39902F35586019 |
| 成功运行原始输出 | E5076046E5250C3200E30820EF768C7E1810BC9AFF858C8CD8B826787F529759 |

## 实际执行方法

### 实施与自检

独立实施代理 /root/contract_v1_impl 按文件级简报重写共同业务契约，只修改 shared\business-contract.md 和 SH-CONTRACT-001-report.md。实施报告保留 77 个目标需求、追踪表、关键语义、旧规则和业务数据计数的实际检查。

### 独立审阅和修复闭环

独立审阅代理 /root/contract_v1_review 不修改契约，完成三轮逐语义审阅：

1. 初审发现 F-001 至 F-005，结论 FAIL。
2. 首次复审确认部分关闭，又发现 R-001 至 R-004，结论仍 FAIL。
3. 第二次全量复审确认 F-001 至 F-005 无退化、R-001 至 R-004 全部关闭、77/77 逐语义通过，最终结论 PASS。

完整失败结论、精确行号、修复要求和关闭审计位于 docs\work-items\SH-CONTRACT-001-review.md。

### 主协调者新鲜验证

实际成功命令：

    $scriptPath='E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-005-validate-contract.ps1'
    $scriptText=Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
    & ([scriptblock]::Create($scriptText))
    $code=$LASTEXITCODE
    if($null -eq $code){$code=0}
    exit $code

退出码：0。

关键输出：

    CHECKED_AT=2026-08-09 14:39:16 +08:00
    EXPECTED_REQ_COUNT=77
    ACTUAL_REQ_COUNT=77
    MISSING_REQ_COUNT=0
    EXTRA_REQ_COUNT=0
    TRACE_NON_SINGLETON_COUNT=0
    REVIEW_FIRST_LINE=PASS
    FINAL_REVIEW_SECTION_COUNT=1
    ANCHOR_MISSING_COUNT=0
    LEGACY_CURRENT_HIT_COUNT=0
    BUSINESS_DATA_COUNT=0
    FAILURE_COUNT=0
    VERDICT=PASS

完整脚本：docs\evidence\raw\EV-20260809-005-validate-contract.ps1

原始输出：docs\evidence\raw\EV-20260809-005-validation-output.txt

### 验证载体诊断记录

以下运行不作为通过证据，但为保持审计完整而记录：

- 第一份临时内联检查在 Windows 路径冒号处发生 PowerShell 字符串解析错误，退出码 1，未进入业务验证。
- 修正后内联检查完成，但使用了与独立报告实际措辞不一致的三个固定锚点，退出码 1；其 77 ID、哈希、旧规则和业务数据检查均无异常。
- 直接以 Windows PowerShell 5.1 -File 运行无 BOM UTF-8 脚本时发生本地代码页乱码并解析失败，退出码 1；随后显式以 UTF-8 读取脚本并完整运行，退出码 0。

这些失败只属于验证载体准备。本证据的 PASS 仅依据最后一次完整、退出码 0 的新鲜运行。

## 需求与语义结果

| 检查 | 实际结果 |
| --- | ---: |
| 计划内目标需求 | 77 |
| 契约内唯一目标需求 | 77 |
| 缺失需求 | 0 |
| 额外目标范围需求 | 0 |
| 追踪表非单例 | 0 |
| 最终审阅章节 | 1 |
| 关键语义缺失 | 0 |
| 旧规则在现行正文命中 | 0 |
| 未关闭独立审阅发现 | 0 |

关键边界已逐语义确认：只记录本人；home_default 默认读取、关联并尝试扣减库存；明确外食同时跳过库存读取和扣减；事实优先；模糊量营养采用合理范围上界；营养采用量不得自动成为库存扣减量；追加式 correction/void 及事务补偿；同商品多批次 FEFO/FIFO；三层商品数据模型；营养不可变快照；外部请求最小披露；位置自然语言纠正与多商品逐项回执。

## 业务数据零污染

扫描扩展名为 .jsonl、.sqlite、.sqlite3、.db。

| 扫描阶段 | 扫描根 | 文件数 | 路径 |
| --- | --- | ---: | --- |
| 任务开始前 | E:\codx\skill\饮食管家 | 0 | 无 |
| 契约与实施报告写入后 | 同上 | 0 | 无 |
| 独立审阅最终写入后 | 同上 | 0 | 无 |
| 原始验证工件写入后（2026-08-09 14:39:40 +08:00） | 同上 | 0 | 无 |
| 本证据文件写入后（2026-08-09 14:41:38 +08:00） | 同上 | 0 | 无 |

验证、实施和审阅均未创建 JSONL、SQLite、SQLite3、DB 或模拟业务数据；没有正式数据根被读取或写入。

## 验证与复核责任

| 角色 | 执行者 | 结论 |
| --- | --- | --- |
| 实施 | Codex /root/contract_v1_impl | 完成契约与多轮修复 |
| 独立规格/质量复核 | Codex /root/contract_v1_review | 最终 PASS |
| 新鲜验证与证据整理 | Codex /root | 退出码 0，FAILURE_COUNT=0 |

## 结论

SH-CONTRACT-001 的精确交付物存在，77 条目标需求逐 ID 和逐语义通过，旧冲突规则未作为现行规范复活，独立审阅无未关闭发现，主协调者新鲜验证退出码为 0。完成条件满足；任务状态应在本证据写入后由唯一任务台账更新。
