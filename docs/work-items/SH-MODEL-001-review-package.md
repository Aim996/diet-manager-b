# SH-MODEL-001 第 3 候选独立复核包

> 正式第 1、2 轮复核结论均为 **FAIL**。本包只冻结第 3 候选供下一轮独立复核，不能覆盖旧结论，也不能把实施者自检当作独立 PASS。

## 1. 唯一冻结输入

| 项目 | 路径 | SHA-256 |
| --- | --- | --- |
| 任务简报 | `docs/work-items/SH-MODEL-001-brief.md` | `070B92F4B64030BF3EAB9FB7FEE7341154ACDD2DE3F8F7C07AE743DFE8EDA49E` |
| 唯一总计划 | `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` |
| 核心业务契约 | `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| 展示契约 | `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| 营养来源注册表 | `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| Issue/Correction 契约 | `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |
| 正式第 1、2 轮历史 | `docs/work-items/SH-MODEL-001-review.md` | `369D0BBA22EA36DA04198995AC7DCA45F831437D879CA95A97DA6771AF40BE4C` |
| 模型说明候选 | `shared/contracts/data-model.md` | `47B444636EFC003168880699BB537710D6541DBBEC3E7BF519500F3CD6F7836E` |
| Schema 候选 | `shared/schemas/domain.schema.json` | `49602D0F068AA3D161EF94117814835E7D1FF17333E49A13BFB723A577274DC0` |
| 正反例候选 | `shared/schemas/fixtures/domain-cases.json` | `958779A2525A7D5918209B20FB73D2A12CE4FE7D34A5A82E7B13C87DFB38F758` |
| Node 验证器 | `shared/tests/validate-domain-schema.mjs` | `C2491EFC384D88934A2D06C3D9608EF86EBB3609A6FF2983572610C30C97EDD4` |
| PowerShell 包装器 | `shared/tests/validate-domain-schema.ps1` | `D1E85525B341F44EAD52D7B9DD82279B03532DAA7B85EEEB3AF32CD5031DD82F` |
| 实施者报告 | `docs/work-items/SH-MODEL-001-report.md` | `A765D811EA5052004CB1DAFFCF9DBA10D98937EEFC780BA6797F00EF91E6A47E` |

开始复核后任一哈希不符，必须停止并报告 `candidate_changed`。复核者不得修改候选、报告、简报、总计划、上游、A/B/C、acceptance cases 或业务数据；只允许在现有 `review.md` 后追加新一轮独立复核历史。

## 2. 实施者声明的待复核基线

以下只是待复核声明：

```text
Draft 2020-12 / Ajv 2020 strict / ajv-formats
CASES=239
VALID=103
INVALID=136
TRACE=84/84
ROOT_MODEL_TYPE=17/17
DEFS=96（最低44/44）
Issue kind/code/status=3/17/6
Resolution outcome=7
Correction operation=12
safe_exit operation=3
MUTATION_STRICT_COMPILE=37/37
MUTATION_KILLED=37/37
BUSINESS_DATA=0→0，差异0
```

复核者必须从冻结文件独立重算，不能引用这些数字代替检查。

## 3. 权威运行方式与失败关闭

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:DIET_MANAGER_AJV_2020='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv@8.20.0\node_modules\ajv\dist\2020.js'
$env:DIET_MANAGER_AJV_FORMATS='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv-formats@3.0.1_ajv@8.20.0\node_modules\ajv-formats\dist\index.js'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\shared\tests\validate-domain-schema.ps1
$exit = $LASTEXITCODE
"OUTER_EXIT=$exit"
exit $exit
```

冻结运行时：Node `v24.14.0`、SHA `63C259C81E5D472B5F11C8D506070130CB04A1ECF84B80377A34ED6EC9048088`；Ajv 入口 SHA `908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A`；formats 入口 SHA `3F3014150293846086D11058BB8BF43E669E354A98B37ADCF10281454D5E753B`。

必须独立复验：显式 env 权威、Ajv/formats 同依赖树、多个不同哈希报 `AJV_AMBIGUOUS`、Node `--version` 失败、伪 Node、fixture 缺失/空/非法、错误协议/计数、runner 1/2 传播和业务变化优先码 3。PowerShell 包装器是唯一最终 `VERDICT` 输出者；runner PASS 后若业务快照变化，最终仍必须 FAIL。

## 4. 正式 F-01～F-07 回归矩阵

| 正式发现 | 第 3 候选必须独立证明 |
| --- | --- |
| F-01 伪 Node 绕过 | 真实 Node 通过；伪 Node 即使输出完整 239-case PASS 协议，也在执行前因路径/哈希不可信而外层 2、最终 FAIL |
| F-02 unknown 带 resolved | unknown+resolved 目标与根拒绝；合法 unknown 不伪造时间；顺序留给语义验证器 |
| F-03 adopted 无范围 | 无 range 与只缺 formula 两反例相互隔离；只删除 min/max 依赖的精确 mutant 必须被杀死 |
| F-04 QuickPrompt | 1 项、5 项、无 safe exit 均拒绝；2/3/4 项合法；数量反例不被 contains 噪声代替 |
| F-05 Resolution 重校验 | 七 outcome 正例齐全；revalidation、状态和 applied/skipped effects 条件闭合 |
| F-06 批次修订 | 不新增第 18 个顶层；追加版本、supersedes、trigger/evidence、评估链和当前投影可审计 |
| F-07 小数零 | skipped 接受 `0/0.0/0.00`，拒绝非零；回退 `const:"0"` mutant 被正例杀死 |

## 5. 第 2 轮 R2-F08～F12 定向矩阵

| 第 2 轮发现 | 第 3 候选修复声明 | 必须独立复验 |
| --- | --- | --- |
| R2-F08 Batch/Assessment trigger 矛盾 | 五值逐一双向 contains；集合因此完全相同 | opening 少报和多报各有单 guard 反例；initial mismatch 是 forward-initial + reverse-storage 组合防线，不得虚报单 guard |
| R2-F09 范围 guard 假阳性 | 无 range case 带合法 formula 和精确 missingProperty；另有 formula-only 反例 | 只删 min/max 依赖、保留 formula 的 mutant 被无 range case 杀死；只删 formula guard 被 formula-only case 杀死 |
| R2-F10 任意 supplied facts | `CorrectionSuppliedFacts` 为 12 个封闭 discriminated 分支；operation 绑定 fact_type | 空对象、`banana`、change_amount 携 change_unit facts 均目标+根拒绝；精确/vague amount 与其余 11 operation 正例通过 |
| R2-F11 非 time 携带 detail | 既有 change_time `then/required` 增加 `else/not` | change_time 有/无 detail 正反仍有效；非 change_time+detail 被精确拒绝 |
| R2-F12 per-100 尾零 | 数值 100 用 `^100(?:\.0+)?$`；显式 `type:string` 保持 strict | `100`、`100.0 g`、`100.00 ml` 通过，50 等非 100 拒绝；回退词法 const 两个 mutant 被杀死 |

## 6. 交叉发现闭合映射

1. `OccurredTime` unknown/resolved 互斥，真实 date/date-time 格式生效；范围顺序不冒充 Ajv 保证。
2. reported、nutrition-adopted、inventory-requested/applied、packaging 五类数量角色隔离；vague 与 unknown-combo 正反分支齐全。
3. `InventoryMatch` 五状态闭合；Effect/Transaction 的正量、零效果、allocation 与方向双向约束闭合。
4. 营养 basis、能量/质量/钠单位、来源/Profile/Snapshot 分离；per-100 尾零域一致。
5. Issue 3 kind、17 code、6 status 有正例；未发明冻结契约不存在的 17-code 唯一 kind 全表，只保留有依据的不得-blocking 子集。
6. `IssueView` 六状态及 resolution/deferred/invalidated 字段双向互斥。
7. Resolution 七 outcome、重校验、结果状态和 effects 条件闭合。
8. Correction 十二 operation、十二 facts 分支、before snapshot、营养重算、remove/void 补偿、time detail 排他闭合。
9. EventVersion/EffectiveView 只引用 committed Meal/Purchase，并使用真实 LocalDate。
10. Batch 五 trigger 双向完全同集；版本链真实性和实际字段变化仍留给 §5。
11. QuickPrompt 2–4 且有出口；safe exit 只允许 `defer/keep_unchanged/do_not_link`，拒绝 `ignored`、任意字符串和空白。
12. 17 顶层、五 Match 状态、六 IssueView 状态、七 Resolution outcome、十二 Correction operation、Quick 2/3/4 和三种 safe exit 均有合法正向覆盖。
13. 反例匹配 `schema_ref + keyword + schemaPath + instancePath + 必要 params`，同时根 false；正例目标与根均 true。
14. `data-model.md` §5 的 22 项比较、引用真实性、版本图、事务和幂等不变量仍明确属于后续验证器，没有冒充 Ajv 保证。

特别核对 Correction §5 边界：before snapshot 属于目标版本/CAS 当前；facts 受原话和旧快照支持；time facts 等于 after time；新增 ID 不冲突；InventoryMatch/NutritionSourceReference 真实存在且版本当前；补偿、营养新快照、受影响日期和 resulting version 与 facts 一致。这些跨对象真实性不能因局部 Schema 变严而被误称为已证明。

## 7. 结构与 mutation 最低检查

1. 从简报期望集合和 `data-model.md` 追踪表独立证明 `84/84` 唯一，缺失/额外/重复/支撑 ID 混入均 0。
2. 根 `oneOf` 恰有 17 个唯一 model type，并逐类找到根正例。
3. `$defs=96`，最低 44 全存在；额外 13 个 Correction facts defs 均服务已批准边界，不得扩出第 18 个顶层。
4. 独立复算枚举 `3/17/6/7/12/3`，确认 `failed_storage` 不在 persisted outcome，`ignored` 不在 safe exit。
5. Fixtures 非空、ID 唯一；复算 `239=103+136`；136 个反例元数据完整。
6. 原 26 mutation 必须 strict 编译 `26/26` 且 killed `26/26`。
7. 新增 11 项必须 strict 编译/killed `11/11`：opening 少报/多报、initial 组合防线、banana closure、operation/fact binding、非 time detail、safe whitelist、per100g/ml 尾零、formula-only、amount 缺 reported quantity。
8. Mutant Schema 编译失败不得计 killed；mutation 只作用于内存克隆，不得改写冻结候选。

## 8. 业务数据与复核记录

复核前、主体检查后、写复核记录后，都要递归扫描整个项目根（含 `node_modules`）内 `.jsonl/.sqlite/.sqlite3/.db`，记录绝对路径、大小、SHA-256、UTC mtime；任一新增、修改或删除必须 FAIL。

下一轮内容只能追加到 `SH-MODEL-001-review.md` 后部，至少记录：

- 本包全部冻结哈希、环境和业务三时点；
- 84 条逐项结果或唯一完整矩阵引用；
- F-01～F-07 回归与 R2-F08～F12 定向结果；
- 交叉闭合映射和 §5 语义边界核对；
- 239 cases、17 顶层、96/44 defs、枚举、37 mutation 的独立命令和输出；
- 新发现的严重度、精确文件/行号、影响与最小修复；
- 最新结论与剩余高/中阻断数。

任一高/中发现、哈希变化、语义空映射、假阳性测试、旧规则复活、运行时绕过或业务数据变化都必须 FAIL。只有全部关闭且无新高/中发现时，复核者才可在保留前两轮 FAIL 历史的前提下追加新一轮 PASS。
