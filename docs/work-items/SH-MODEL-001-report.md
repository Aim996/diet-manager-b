# SH-MODEL-001 实施者报告（第 2 轮复核后第 3 候选）

> 结论边界：本报告只记录实现者的 RED→GREEN、结构审计、变异检查和业务数据隔离结果，不是独立复核结论，也不改变 `总功能开发计划0.2.md` §22 的唯一任务状态。`SH-MODEL-001-review.md` 中正式第 1、2 轮历史保持原样，两轮结论均为 FAIL；当前第 3 候选等待新一轮独立复核。

## 1. 范围、冻结输入与实际交付

本任务把冻结共同契约中的 84 条范围需求翻译为 JSON Schema Draft 2020-12 逻辑模型，并建立真实 Ajv 2020 正反例验证。简报允许的六个交付文件如下；本轮另按协调者授权重建独立复核包，但不修改正式第 1、2 轮复核记录。

1. `shared/contracts/data-model.md`
2. `shared/schemas/domain.schema.json`
3. `shared/schemas/fixtures/domain-cases.json`
4. `shared/tests/validate-domain-schema.mjs`
5. `shared/tests/validate-domain-schema.ps1`
6. `docs/work-items/SH-MODEL-001-report.md`
7. 协调材料：`docs/work-items/SH-MODEL-001-review-package.md`

未修改总计划、五份冻结上游、A/B/C 源码、acceptance cases、正式 `review.md` 历史或任何业务数据。冻结输入复算如下，差异为 `0`：

| 输入 | SHA-256 |
| --- | --- |
| `docs/work-items/SH-MODEL-001-brief.md` | `070B92F4B64030BF3EAB9FB7FEE7341154ACDD2DE3F8F7C07AE743DFE8EDA49E` |
| `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |
| 含正式第 1、2 轮历史的 `docs/work-items/SH-MODEL-001-review.md` | `369D0BBA22EA36DA04198995AC7DCA45F831437D879CA95A97DA6771AF40BE4C` |

## 2. 运行时与最终候选基线

权威运行使用显式路径，Ajv 与 `ajv-formats` 来自同一 pnpm 依赖树：

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:DIET_MANAGER_AJV_2020='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv@8.20.0\node_modules\ajv\dist\2020.js'
$env:DIET_MANAGER_AJV_FORMATS='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv-formats@3.0.1_ajv@8.20.0\node_modules\ajv-formats\dist\index.js'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\shared\tests\validate-domain-schema.ps1
exit $LASTEXITCODE
```

| 运行时 | 版本/入口 SHA-256 |
| --- | --- |
| Node | `v24.14.0`；`63C259C81E5D472B5F11C8D506070130CB04A1ECF84B80377A34ED6EC9048088` |
| Ajv 2020 | `8.20.0`；`908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A` |
| ajv-formats | `3.0.1`；`3F3014150293846086D11058BB8BF43E669E354A98B37ADCF10281454D5E753B` |

显式环境变量是权威输入。只读 fallback 顺序为标准直装、pnpm 隐藏提升、版本目录枚举；Ajv 与 formats 必须属于同一依赖树，多个不同哈希候选以 `AJV_AMBIGUOUS` 失败关闭。验证器未修改 B/C 的依赖。

当前候选机器基线：

```text
SCHEMA_COMPILE=PASS
CASE_TOTAL=239
VALID_PASS=103/103
INVALID_PASS=136/136
CASE_FAILURE_COUNT=0
RUNNER_VERDICT=PASS
RUNNER_EXIT_CODE=0
VERDICT=PASS
```

## 3. RED→GREEN 历史

### 3.1 首个生产 Schema 前 RED

测试运行器与首批 6 个 fixtures 先于 `domain.schema.json` 创建。实际运行时：

```text
Test-Path shared/schemas/domain.schema.json = False
SCHEMA_COMPILE=NOT_RUN
CASE_TOTAL=6
ERROR_CODE=SCHEMA_NOT_FOUND
RUNNER_VERDICT=FAIL
BUSINESS_BEFORE_COUNT=0
BUSINESS_AFTER_COUNT=0
BUSINESS_DATA_CHANGED=0
RUNNER_EXIT_CODE=2
历史外层退出码=1
```

历史外层码来自当时包装器尚未原样传播 runner `2`；随后已修正。首个 RED 当时没有记录测试/fixture 的同步 SHA-256，不能事后伪造；本报告保留该证据缺项。最小 Schema 加入后，真实 Ajv strict + `ajv-formats` 的首轮 GREEN 为 `CASE_TOTAL=7`、`1/1` 正例、`6/6` 反例、退出 `0`。

### 3.2 正式第 1 轮复核 F-01～F-07 闭合

正式第 1 轮复核结论仍为 FAIL；下表只说明新候选如何按 TDD 修复，不改写历史结论。

| 正式发现 | 新增 RED | 最小修复与 GREEN |
| --- | --- | --- |
| `F-01` 伪 Node 可伪造 PASS | 临时伪 Node 完整输出旧 PASS 协议，旧包装器外层 `0`、`VERDICT=PASS` | 冻结可信 Node 绝对路径与 SHA-256，校验版本、真实 case 计数和协议；同一伪 Node 现为 `NODE_RUNTIME_UNTRUSTED`、`RUNNER_EXIT_CODE=2`、`VERDICT=FAIL`、外层 `2` |
| `F-02` unknown 可带伪造 resolved 时间 | unknown+`resolved` 的目标 `$defs` 与根分派均错误通过 | `precision=unknown` 禁止 `resolved`；范围顺序留给 §5 语义验证器 |
| `F-03` adopted 上界可脱离范围 | `strategy=upper_bound` 无 `range` 的 vague quantity 错误通过 | adopted 上界必须有可信范围，并登记 adopted 等于上界的跨字段语义检查 |
| `F-04` QuickPrompt 不保证 2–4 项及安全出口 | 1 项、5 项、无 safe_exit 与 ignored safe_exit 分别观察 RED | `minItems=2`、`maxItems=4`、`contains safe_exit`，安全出口不得使用 `ignored`；2/3/4 项合法分支均有正例 |
| `F-05` applied 可无重校验版本 | applied+空 `revalidated_versions` 错误通过 | persisted outcome 均携带非空重校验版本；applied/deferred/dismissed/rejected 的 effect 与结果状态条件闭合 |
| `F-06` 位置/开封/保质修订为空映射 | 初始版本带 supersedes、修订无 supersedes、触发不匹配、当前 opened 无时间等分别 RED | 不增加第 18 个顶层类型；在 `InventoryBatch`/`ExpirationAssessment` 内采用追加版本、`supersedes_*`、revision trigger、evidence，并由 `InventoryBalanceView.current_batch_state` 投影当前位置/开封/当前评估 |
| `F-07` skipped 拒绝合法小数零 | `"0.0"` 被旧零常量拒绝 | 零值约束改为接受 CanonicalDecimal 的 `0`、`0.0`、`0.00` 等合法零表示，同时继续拒绝非零 applied amount |

### 3.3 本轮分组边界

每组都先只增加正反例并实际观察 RED，再改 Schema。早期四组的逐条原始控制台输出未全部固化，不能事后伪造；从 G5 起保留的组边界如下。

| 组边界 | RED/过程证据 | GREEN |
| --- | --- | --- |
| G1 时间、数量角色/模糊量 | 逐项 RED 后 | `93`：正 `37/37`、反 `56/56` |
| G1b unknown 组合 | 逐项 RED 后 | `97`：正 `38/38`、反 `59/59` |
| G2 InventoryMatch/Effect/Transaction | 逐项 RED 后 | `104`：正 `42/42`、反 `62/62` |
| G3 营养 basis/单位维度 | 逐项 RED 后 | `122`：正 `54/54`、反 `68/68` |
| G4 批次版本与评估链 | 逐项 RED 后 | `128`：正 `57/57`、反 `71/71` |
| G5 Issue code-kind 最小闭合 | `133`：正 `58/58`、反 `71/75` | 正 `58/58`、反 `75/75` |
| G6a Issue 合法 code 分支 | `152`：正 `74/74`、反 `75/78` | 正 `74/74`、反 `78/78` |
| G6b IssueView 状态互斥 | `163`：正 `79/79`、反 `78/84` | 正 `79/79`、反 `84/84` |
| G6c Resolution | `177`：正 `85/85`、反 `85/92` | 正 `85/85`、反 `92/92` |
| G6d QuickPrompt | `183`：正 `87/87`、反 `92/96` | 正 `87/87`、反 `96/96` |
| G6 分支补齐 | 新增稳定状态/operation 合法正例与双向反例 | `190`：正 `87/87`、反 `103/103` |
| G7 Correction/版本/有效视图 | `213`：正 `96/96`、反 `103/117` | 正 `96/96`、反 `117/117` |
| F-06 双向边界补齐 | 初始/修订、trigger、当前投影反例逐项 RED | `222`：正 `96/96`、反 `126/126` |

Issue 组首次编辑时，一段条件约束因补丁锚点相似而误插入 `ProvenanceEvidence`；代码检查在运行 GREEN 前发现并移除，再以唯一锚点写入 `Issue`。没有关闭 strict、删测试或保留绕过。

### 3.4 正式第 2 轮复核后的第 3 候选

正式第 2 轮结论为 FAIL（冻结 SHA-256 `369D0BBA22EA36DA04198995AC7DCA45F831437D879CA95A97DA6771AF40BE4C`）。下表只记录新候选的实现者 TDD 证据，不覆盖该历史结论。

| 组 | 首次 RED | 最小修复与 GREEN |
| --- | --- | --- |
| R2-F08 / trigger 精确同集 | fixtures 增至 `228`：正 `98/98`，反 `128/130`；assessment 多报 opening、初始 assessment 少报 initial 被旧 Schema 接受 | 五种 trigger 全部做 Batch→Assessment 与 Assessment→Batch 双向包含；`228`：正 `98/98`、反 `130/130` |
| R2-F09 / 范围 guard 隔离 | 精确 mutant 只移除 `plausible_min/max` 依赖、保留 formula 时，旧 fixture 仍因缺 formula 拒绝，`F09_RANGE_GUARD_KILLED=false` | 无 range case 补合法 `adoption_formula` 和精确 missingProperty；另建只缺 formula 反例；同一 mutant 变为 `F09_RANGE_GUARD_KILLED=true` |
| R2-F10 / supplied facts | `232`：正 `99/99`、反 `130/133`；empty、`banana` 和 operation/fact_type 错配三例均被旧任意 object 接受 | 新增 12 个封闭载荷 defs 与 `CorrectionSuppliedFacts` oneOf，operation 追加 discriminator 绑定；`232`：正 `99/99`、反 `133/133` |
| R2-F11 / time_change 排他 | `233`：正 `99/99`、反 `133/134`；非 change_time 携带 detail 被接受 | 在既有 `allOf[2]` 增加 `else/not`；`233`：正 `99/99`、反 `134/134` |
| safe_exit 白名单 | `237`：正 `101/101`、反 `134/136`；任意字符串和空白被接受 | safe exit operation 固定为 `defer/keep_unchanged/do_not_link`，同时保留三值正向覆盖；`237`：正 `101/101`、反 `136/136` |
| R2-F12 / per-100 尾零 | `239`：正 `101/103`、反 `136/136`；`100.0 g/100.00 ml` 被词法 const 拒绝 | 改为数值 100 的尾零正则。首次 GREEN 尝试因局部 `pattern` 缺 `type:string` 被 strictTypes 以 runner/outer `2` 失败关闭；补类型后 `239`：正 `103/103`、反 `136/136` |

G3 迁移同时把 31 个既有 Correction fixture 的 facts 改成对应合法分支，并仅在专门的 before-snapshot 反例保留坏快照，避免旧目标错误被新约束噪声替代。Ajv 嵌套 `$ref` 的 error `schemaPath` 会缩写为 `#/required`；实现未因此放宽约束，而用追加的 operation discriminator 路径、instancePath 和 params 保持断言可审计。

## 4. 交叉审阅发现闭合边界

- `OccurredTime`：unknown 不得有 resolved；真实 `date`/`date-time` 格式由 `ajv-formats` 验证；起止顺序属于语义验证器。
- 数量：reported、nutrition adopted、inventory requested/applied、packaging 五类角色隔离；vague adopted 必须有范围；unknown 组合不得伪造模板拆分或数值。
- 库存：`InventoryMatch` 五状态封闭；deducted/reversed 需要正量 allocation，skipped 禁止 allocation/非零 applied amount；交易方向由 transaction kind 条件约束。
- 营养：100g/100ml basis 与正量；数值 100 接受合法纯尾零词法；能量只用 kcal/kJ，质量宏量用 g，钠用 mg；来源、Profile、Snapshot 分离。
- Issue：3 kind、17 code、6 status 全部有合法正例。冻结文字不足以证明 17 个 code 到唯一 kind 的完整映射，因此没有发明全表；Schema 只对有明文依据的 `unconvertible_unit`、`ambiguous_inventory_match`、`insufficient_inventory`、`missing_nutrition`、`partial_nutrition`、`missing_expiration` 禁止 `blocking`。
- `IssueView`：六状态正例齐全，resolution/deferred/invalidated 字段按状态互斥。
- Resolution：七个 persisted outcome 正例齐全，版本重校验非空；rejected/deferred/dismissed 不得声称 applied effects，状态结果不得矛盾。
- Correction：12 operation 均有合法正例并绑定 12 种封闭 supplied-facts 分支；空对象、任意键和错判别器拒绝；before snapshot 封闭；只有 change_time 可携带 `time_change`；营养重算 true/false 双向约束；营养相关操作要求新 Snapshot；remove/void 与补偿 effect 成对；事件版本只引用 committed Meal/Purchase。
- F-06/R2-F08：批次、开封、位置、保质评估通过同一顶层对象内的追加版本与当前投影表达；Batch/Assessment 的五种 trigger 双向精确同集，根 `model_type` 仍严格为 17。
- Quick：2–4 项与 safe exit 数量/contains 约束保持；safe exit 只接受 `defer/keep_unchanged/do_not_link`，拒绝 `ignored`、任意字符串和空白。

## 5. 结构、追踪与语义边界审计

机器解析结果：

```text
TRACE_TOTAL=84
TRACE_UNIQUE=84
TRACE_MISSING=0
TRACE_EXTRA=0
TRACE_DUPES=0
SUPPORT_IN_TABLE=0
DEFS_TOTAL=96
REQUIRED_DEFS=44
MISSING_REQUIRED_DEFS=0
ROOT_ONEOF=17
ROOT_TYPES_UNIQUE=17
TOP_POSITIVE_UNIQUE=17
MISSING_TOP_POSITIVE=0
CASES=239
VALID=103
INVALID=136
INVALID_METADATA_MISSING=0
```

冻结枚举计数为 Issue kind/code/status `3/17/6`、Resolution outcome `7`、Correction operation `12`；safe exit operation 为 `3` 个稳定值。新增 13 个 defs 只服务 `CorrectionSuppliedFacts` 与其 12 个 operation 载荷，不增加顶层 model type。每个反例同时验证目标 `$defs` 与根 `oneOf=false`，并精确匹配 `keyword + schemaPath + instancePath + 必要 params`；正例同时通过目标 `$defs` 与根分派。

`data-model.md` §5 明列 22 项 Ajv 不能独立证明的语义不变量及后续验证器计划，包括：时间/范围顺序、采用值等于范围上界、allocation 合计与商品/批次引用、交易余额守恒和非负、FEFO/FIFO、来源注册表真实性、快照集合一致、Issue/Resolution CAS 与状态机、批次/评估无环版本链及 current projection 选择、Correction 目标真实性/补偿成对/跨日、EventVersion committed 引用、幂等与 mixed 原子边界。当前 Schema 只保证单对象可封闭形状，不谎称完成这些跨对象比较或引用真实性检查。

## 6. Mutation check

变异只作用于内存克隆，不写回候选；每个 mutant 都在 `strict:true` 下独立编译，编译失败不得冒充业务断言 killed。原报告 26 项完整重放，另加 11 项第 2 轮发现的精确检查，最终：

```text
MUTATION_BASELINE_PASS=37/37
MUTATION_STRICT_COMPILE_PASS=37/37
MUTATION_KILLED=37/37
ORIGINAL_26_COMPILE=26/26
ORIGINAL_26_KILLED=26/26
EXTRA_COMPILE=11/11
EXTRA_KILLED=11/11
```

原 26 项依次覆盖：CanonicalDecimal JSON number、unknown 携值、unknown 时间 resolved、vague adopted 无 range、multiple match 只有一个 product、deducted 空 allocation、deduction 增加方向、per100ml 错用 g、energy 错用 g、Issue 副作用型 blocking、open view 带 resolution、applied 空重校验、rejected 带 applied effect、Quick 仅 1 项、Quick 无出口、safe_exit 使用 ignored、before snapshot 空对象、false recalc 带 snapshot、change_amount 不重算、remove 无成对补偿、EventVersion 引用 preview、批次初始版带 supersedes、批次 revision trigger 不匹配、当前 opened 无时间、2 月 30 日、F-07 合法 `0.0` 被拒绝。

新增 11 项覆盖：opening trigger 少报单 guard、多报单 guard、initial mismatch 的 forward-initial + reverse-storage 组合防线、amount facts `banana` 闭合、operation↔fact_type 绑定、非 change_time 的 `else/not`、safe_exit 白名单、per_100g 与 per_100ml 尾零回退 const、只删除 formula guard、amount 缺 `reported_quantity` 的内存定向探针。F-03 的范围 mutant 只删除 `plausible_min/plausible_max` 依赖并保留合法 formula，确由无 range case 杀死；formula-only case 则保留完整范围，二者不再互相掩盖。initial mismatch 自身同时缺 initial、多 storage，因此如实按组合防线计，不虚报为单 guard。

## 7. 包装器可信度与业务数据隔离

PowerShell 包装器是唯一最终 `VERDICT` 输出者；runner `1/2` 原样传播，业务数据变化独立优先码为 `3`。Node `--version`、可信路径/哈希、runner 协议、精确 case 计数任一异常均失败关闭。真实运行时为外层 `0`；伪 Node 最终定向测试为：

```text
RUNNER_ERROR=NODE_RUNTIME_UNTRUSTED:...
RUNNER_EXIT_CODE=2
VERDICT=FAIL
外层退出码=2
```

每次 wrapper 运行前后都递归扫描项目根（包含 `node_modules`）内 `.jsonl/.sqlite/.sqlite3/.db`，快照包含绝对路径、大小、SHA-256、UTC mtime。最终结果：

```text
BUSINESS_BEFORE_COUNT=0
BUSINESS_AFTER_COUNT=0
BUSINESS_DATA_CHANGED=0
新增=0，修改=0，删除=0
```

因此验证没有创建 JSONL 或 SQLite 业务数据。

## 8. 当前候选 SHA-256

下列五个非报告候选在本报告写入前冻结；写报告不会改变它们：

| 文件 | SHA-256 |
| --- | --- |
| `shared/contracts/data-model.md` | `47B444636EFC003168880699BB537710D6541DBBEC3E7BF519500F3CD6F7836E` |
| `shared/schemas/domain.schema.json` | `49602D0F068AA3D161EF94117814835E7D1FF17333E49A13BFB723A577274DC0` |
| `shared/schemas/fixtures/domain-cases.json` | `958779A2525A7D5918209B20FB73D2A12CE4FE7D34A5A82E7B13C87DFB38F758` |
| `shared/tests/validate-domain-schema.mjs` | `C2491EFC384D88934A2D06C3D9608EF86EBB3609A6FF2983572610C30C97EDD4` |
| `shared/tests/validate-domain-schema.ps1` | `D1E85525B341F44EAD52D7B9DD82279B03532DAA7B85EEEB3AF32CD5031DD82F` |

报告和复核包不能可靠自嵌各自最终哈希；冻结后由外部计算并交给下一轮独立复核者。

## 9. 明确保留给后续任务的边界

- `SH-MODEL-002`：完整 `CommitResult`、`DailyProgressSnapshot`、Water/Hydration 内部结构与展示读取契约。
- `SH-MODEL-003`：JSONL/SQLite 物理表、列、索引、迁移、事务和持久化适配。
- PRODUCT-0.2：个人复合食品模板的完整学习状态机；本模型只保留稳定 `template_ref`。
- CASE/语义验证层：§5 的 22 项跨对象不变量、17 code 到唯一 kind 的完整权威映射（若未来契约明确）及一正一反集成案例。

当前没有已知未通过的机器用例；正式第 1、2 轮 FAIL 历史未被改写。第 3 候选只是实现者自检通过，仍等待新冻结哈希上的独立复核，不自称独立 PASS。
