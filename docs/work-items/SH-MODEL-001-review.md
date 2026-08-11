# SH-MODEL-001 独立复核记录（第 1 轮）

review_round: 1  
review_date: 2026-08-09  
timezone: Asia/Shanghai  
reviewer: Codex `/root/data_model_review_prep`  
verdict: **FAIL**  
remaining_high: **6**  
remaining_medium: **1**

本轮是对冻结候选的只读独立复核。复核者在候选冻结前只读取需求与契约并准备检查表；正式复核时才读取候选。除本文件外未修改任何项目文件，未创建 `.jsonl/.sqlite/.sqlite3/.db` 业务数据。

## 1. 冻结输入、候选与环境

### 1.1 哈希复核

下列 SHA-256 均由复核者在开始正式复核后重新计算，与复核包逐字一致；`HASH_MISMATCH=0`。

| 对象 | SHA-256 |
| --- | --- |
| `docs/work-items/SH-MODEL-001-review-package.md` | `4CACF984FFE4764CBB66F0BDAB57D9BE6E10C674FF1A219E63A2CDFB2DCD8D92` |
| `docs/work-items/SH-MODEL-001-brief.md` | `070B92F4B64030BF3EAB9FB7FEE7341154ACDD2DE3F8F7C07AE743DFE8EDA49E` |
| `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |
| `shared/contracts/data-model.md` | `FCB57C604315DE75DF8548EAB663DEF8E71EB5FD20134F458269D4D2AF2499CB` |
| `shared/schemas/domain.schema.json` | `8C4EA598A719445CD61454916E14F7D7E9C5AC7B5F8781DB16A83FE8DFDE9F0F` |
| `shared/schemas/fixtures/domain-cases.json` | `04F31665A40E05CB1B219AC8DFDA2F1AB87343EDF6D03EA02EECFF8A08B34D91` |
| `shared/tests/validate-domain-schema.mjs` | `C2491EFC384D88934A2D06C3D9608EF86EBB3609A6FF2983572610C30C97EDD4` |
| `shared/tests/validate-domain-schema.ps1` | `762451B29455291493309DB9FFE15F576AC74DC57B44CDC91A6D32D4D60E4001` |
| `docs/work-items/SH-MODEL-001-report.md` | `5505886CB582DDE672AC2B2A97A269BA6E5524A3B11868566A7CFE1E096F0101` |

### 1.2 运行环境

| 项目 | 复核值 |
| --- | --- |
| OS / shell | Windows / Windows PowerShell 5.1 |
| Node | `v24.14.0`；`C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` |
| Ajv 2020 | `908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A` |
| ajv-formats | `3F3014150293846086D11058BB8BF43E669E354A98B37ADCF10281454D5E753B` |
| Ajv 设置 | Draft 2020-12；`strict=true`、`allErrors=true`、`validateFormats=true` |

### 1.3 业务数据隔离

项目根（包含 `node_modules`）递归检查扩展名 `.jsonl/.sqlite/.sqlite3/.db`：

| 时点 | 文件数 | 路径/大小/SHA-256/UTC mtime 差异 |
| --- | ---: | --- |
| 复核写前 | 0 | 空集 |
| 运行现有验证器及独立探针后 | 0 | 0 |
| 写入本复核记录后的最终终扫 | 0 | 0 |

## 2. 独立机器复核

### 2.1 Ajv、89 cases 与根分派

复核者没有引用实施报告结论，直接以冻结 Ajv/format 路径加载 Schema 和 fixture：

```text
INDEPENDENT_SCHEMA_COMPILE=true
CASE_TOTAL=89
VALID_PASS=36/36
INVALID_PASS=53/53
CASE_FAILURE_COUNT=0
```

正例同时通过目标 `$defs` 与根分派；反例按 fixture 的 `expected_keyword`、`expected_schema_path`、`expected_instance_path` 和必要 `expected_params` 命中目标错误，并在根分派失败。`invalid-formal-event-envelope-query-type` 虽另含空 payload，但其期望错误精确锁定 `/event_type` 的 `enum`；放宽该 enum 会使 runner 的 `matchingError` 消失，因此不是 oneOf 噪声假阳性。

### 2.2 17 个顶层与最低 44 `$defs`

根 `oneOf` 恰为 17 个、无缺失/额外，且 17 个均有正例：

```text
event_envelope, product_identity, packaging_variant, inventory_batch,
inventory_effect, inventory_transaction, inventory_balance_view,
nutrition_profile, nutrition_snapshot, issue, issue_state_event, issue_view,
issue_resolution_event, quick_prompt, correction_event,
event_version_snapshot, effective_event_view
```

`$defs` 实际 66 个；简报最低 44 个全部存在且名称唯一：

```text
StableId, VersionRef, RuleRef, ProvenanceEvidence,
CanonicalDecimal, KnownMeasure, UnknownMeasure, Measure,
ExactQuantity, ApproximateQuantity, RangeQuantity, VagueQuantity,
MissingQuantity, Quantity, OccurredTime, EventEnvelope, MealEvent, MealItem,
DishComponent, PurchaseEvent, ProductIdentity, PackagingVariant,
InventoryBatch, StorageAssignment, ExpirationAssessment, InventoryMatch,
BatchAllocation, InventoryEffect, InventoryTransaction, InventoryBalanceView,
NutritionSourceReference, NutritionBasis, NutrientField, NutritionProfile,
NutritionSnapshot, Issue, IssueStateEvent, IssueView, IssueResolutionEvent,
QuickPrompt, QuickOption, CorrectionEvent, EventVersionSnapshot,
EffectiveEventView
```

### 2.3 84 追踪与精确枚举

规范追踪表独立解析结果：`rows=84`、`unique=84`、`missing=0`、`extra=0`、`duplicate=0`、支撑 ID 混入 `0`、空链接 `0`。但“ID 存在”不等于语义满足；第 5 节列出 5 条语义 FAIL。

精确枚举静态重算均与冻结契约一致：

- Issue kind 3：`anomaly/enrichment/blocking`。
- Issue code 17：`missing_quantity/vague_quantity/quantity_range/missing_unit/missing_package_content/conflicting_package_spec/unknown_product_type/unconvertible_unit/ambiguous_inventory_match/insufficient_inventory/missing_nutrition/partial_nutrition/missing_expiration/uncertain_event_time/possible_duplicate/stale_preview/correction_target_not_found`。
- Issue status 6：`open/offered/deferred/resolved/dismissed/invalidated`。
- Resolution outcome 7：`applied/deferred/dismissed/rejected_expired/rejected_stale/rejected_conflict/rejected_effect`。
- Correction operation 12：`change_amount/change_unit/change_time/change_meal_slot/change_item_name/change_item_type/change_components/add_item/remove_item/change_inventory_link/change_nutrition_source/void_event`。

### 2.4 变异与额外语义探针

独立内存变异覆盖 CanonicalDecimal、OccurredTime、VagueQuantity、EventEnvelope、根批次 depleted、InventoryMatch、deducted/skipped、来源版本、Issue kind、QuickOption、IssueView、Correction 和 LocalDate。14 个布尔隔离变异均“移除约束即放过目标反例”；query enum 的 case 因另有空 payload 不发生整体布尔翻转，但精确期望错误断言会失败，故该 guard 仍被 runner 有效覆盖。

另运行 47 个手工正反探针，37 符合契约预期，10 个出现预期/Schema 不一致：

```text
time-unknown-with-exact-start        expected=false actual=true
time-unknown-with-range              expected=false actual=true
vague-adopted-without-range          expected=false actual=true
vague-adopted-not-upper-bound        expected=false actual=true
quick-one-action-no-exit             expected=false actual=true
quick-two-actions-no-exit            expected=false actual=true
quick-five-with-exit                 expected=false actual=true
skipped-zero-point-zero              expected=true  actual=false
skipped-zero-point-zero-zero         expected=true  actual=false
resolution-applied-empty-revalidation expected=false actual=true
```

`adopted_measure == plausible_max` 属于字段间数值/单位比较，可留给语义验证器；问题在于模型的 14 项边界没有登记此不变量，而 `plausible_min/max` 缺失本可由 Schema 直接拒绝却未拒绝。

### 2.5 恶意运行时

临时伪运行时（项目外创建并在测试后删除）对 `--version` 输出 `v99.99.99`，第二次调用不运行 JavaScript，只输出：

```text
SCHEMA_COMPILE=PASS
CASE_TOTAL=89
VALID_PASS=36/36
INVALID_PASS=53/53
CASE_FAILURE_COUNT=0
RUNNER_VERDICT=PASS
```

冻结 wrapper 的实际结果：

```text
NODE_PATH=...\sh-model-001-review-fake-node.cmd
NODE_VERSION=v99.99.99
RUNNER_EXIT_CODE=0
BUSINESS_DATA_CHANGED=0
VERDICT=PASS
MALICIOUS_FAKE_NODE_OUTER_EXIT=0
```

因此“伪 Node 必须失败关闭”未满足。临时伪运行时文件已删除；CR-F01 临时镜像中的测试文件也已删除，未修改项目候选。

## 3. `CR-F01~F05` 定向复验

| ID | 独立复验 | 结果 |
| --- | --- | --- |
| `CR-F01` | 在项目外临时镜像运行冻结 runner/wrapper：fixture `{}` 得 `FIXTURES_INVALID_SHAPE: cases must be an array`、外层 2；`{"cases":[]}` 得 `FIXTURES_INVALID_SHAPE: cases must contain at least one case`、外层 2。 | PASS |
| `CR-F02` | `InventoryBatch.opening_state=depleted` 目标 `$defs` 与根均拒绝。 | PASS |
| `CR-F03` | `change_nutrition_source + required=false + snapshot_refs=[]` 拒绝。 | PASS |
| `CR-F04` | rejected outcome 搭配 `resulting_issue_status=resolved` 拒绝。 | PASS |
| `CR-F05` | `2026-02-30` 在 `TimeChangeDetail/Correction/EffectiveView` 的 LocalDate 路径拒绝。 | PASS |

## 4. 高/中发现与最小修复

### `F-01` 高：伪 Node 可完全绕过验证并产生 PASS

- 位置：`shared/tests/validate-domain-schema.ps1:212-253`。
- 证据：上述恶意运行时实测外层退出 0、最终 `VERDICT=PASS`，实际没有执行 `validate-domain-schema.mjs`。
- 影响：任何能控制 `DIET_MANAGER_NODE` 的错误/恶意可执行文件都能伪造完整 GREEN，违反 PASS 标准 24 和复核包显式恶意运行时门。
- 最小修复：对允许的 Node 二进制做冻结绝对路径与 SHA-256 校验（或由复核包提供允许哈希）；禁止仅凭自报版本字符串认证。另精确校验 `CASE_TOTAL=89`、`VALID_PASS=36/36`、`INVALID_PASS=53/53`、`CASE_FAILURE_COUNT=0`，并为伪协议可执行文件加入回归反例。

### `F-02` 高：`precision=unknown` 可携带伪造精确时间

- 位置：`shared/schemas/domain.schema.json:175-210`；规范声明见 `shared/contracts/data-model.md:55`、简报 §3.4。
- 证据：`time-unknown-with-exact-start` 与 `time-unknown-with-range` 均应拒绝，Ajv 实际接受。
- 影响：未知发生时间可以被持久化为精确钟点，破坏原始事实/推导精度边界。
- 最小修复：在 `OccurredTime` 为 `precision=unknown` 时用条件 `not` 禁止 `resolved_start/resolved_end`；补充两个反例及一个不含解析值的正例。若 date/meal-period 的解析表示另有约定，必须在文档中明确而不能冒充 exact。

### `F-03` 高：营养采用上界可在没有范围时凭空产生

- 位置：`shared/schemas/domain.schema.json:137-153`；`shared/contracts/data-model.md:51`；`shared/business-contract.md:40`。
- 证据：删除 `plausible_min/plausible_max` 后保留 `adopted_measure + upper_plausible_bound + evidence + rule` 仍通过；采用值改为非上界也通过且没有对应跨对象不变量。
- 影响：REQ-MEAL-011/012 的“可靠合理范围上界”可退化为任意数值，营养估算失去可审计依据。
- 最小修复：`adopted_measure` 出现时直接要求 `plausible_min`、`plausible_max`、采用依据、证据、规则及文档承诺的换算/采用公式；在跨对象不变量中新增“单位一致且 adopted 等于 plausible_max、min<=max”，并加入无范围与不等上界反例。

### `F-04` 高：QuickPrompt 不保证 2–4 选项或安全出口

- 位置：`shared/schemas/domain.schema.json:884-899`；`shared/contracts/data-model.md:97`；冻结 `shared/contracts/issue-correction-contract.md:120-122`。
- 证据：1 个 action 无出口、2 个 action 无出口、5 个选项均被 Ajv 接受。
- 影响：可生成无法安全退出或选项泛滥的领域提示，直接违反支撑约束 REQ-QUICK-002/004 与 PASS 标准 19。
- 最小修复：`options` 设 `minItems:2`、`maxItems:4`；用 `contains` + `minContains:1` 强制至少一个 `option_kind=safe_exit`；补充 1、5、无出口三个反例和 2/4 个含出口正例。SHOULD 的“优先 2–4”如不准备硬校验，复核标准必须先经批准变更，当前冻结门要求硬满足。

### `F-05` 高：applied Resolution 可不记录任何重校验版本

- 位置：`shared/schemas/domain.schema.json:903-926`；`shared/contracts/data-model.md:95`；`shared/contracts/issue-correction-contract.md:128`。
- 证据：把合法 applied case 的 `revalidated_versions` 改为空数组仍通过。
- 影响：旧选项可形成声称 applied/resolved 的事件，却没有目标/Issue/库存版本重校验证据；REQ-ISSUE-005 的陈旧执行防线不可审计。
- 最小修复：至少对 `outcome=applied` 要求 `revalidated_versions minItems:1`（涉及库存关联/扣减/补偿时应覆盖契约要求的全部目标）；补空数组反例并由跨对象验证器检查引用存在、版本当前与兼容性。

### `F-06` 高：位置纠正与保质重评历史是语义空映射

- 位置：`shared/contracts/data-model.md:71-73,195,200`；`shared/schemas/domain.schema.json:463-497,981-1042`。
- 证据：追踪行声称“当前位置投影可被自然语言 Correction 更新”“评估版本追加、当前视图重算和旧依据保留”，但候选只有嵌入 `InventoryBatch` 的单个 `storage/expiration`；固定 12 个 Correction operation 无位置/开封重评操作，也没有批次当前位置/当前评估投影、前后版本引用或评估链不变量。
- 影响：REQ-PANTRY-017/022 无法从冻结对象确定怎样追加纠正、选择当前值及保留旧评估；实现路线会各自发明不兼容语义。
- 最小修复：在不擅自增加第 18 个顶层类型的前提下，明确并校验一条批准的追加版本路径，例如为同一 `batch_id` 的 `InventoryBatch` 修订增加 previous/supersedes、revision trigger、当前版本选择规则，并为 `ExpirationAssessment` 增加稳定 ID/版本/被替代引用；或先批准契约变更引入专用事件/视图。必须增加“位置自然语言纠正”和“位置/开封变化→新评估、旧评估仍可审计”的正反例。

### `F-07` 中：合法 CanonicalDecimal 零表示在 skipped effect 中被拒绝

- 位置：`shared/schemas/domain.schema.json:33-37,589-595`。
- 证据：`CanonicalDecimal` 独立接受 `"0.0"`、`"0.00"`，但 skipped `applied_amount.value` 被 `const:"0"` 拒绝；两个探针均出现 `expected=true actual=false`。
- 影响：同一规范十进制类型在嵌套上下文产生不一致的合法域；跨路线可能一条规范化为 `0`、另一条保留小数位而被拒绝。
- 最小修复：二选一并写清规范：若所有冗余零必须规范化为 `"0"`，收紧全局 CanonicalDecimal 并补迁移/反例；否则 skipped 使用“数值语义为零”的字符串正则（如 `^0(?:\.0+)?$`），保持 allocation 空约束。

## 5. 84 条范围需求逐项矩阵

汇总：**PASS 79 / FAIL 5**。`REQ-TIME-*`、`REQ-QUICK-*`、`REQ-SAFE-*` 仅作为支撑约束，不混入这 84 行；其失败体现在第 4、6 节。

| Requirement | 结果 | 预期对象/字段/不变量与结论 |
| --- | --- | --- |
| REQ-EVENT-001 | PASS | EventEnvelope 只分派 meal/purchase；未提交命令不伪造正式对象。 |
| REQ-EVENT-002 | PASS | ignored 留在命令边界；已提交删除由追加 `void_event` 表达。 |
| REQ-EVENT-003 | PASS | Meal 根事实与 skipped InventoryEffect/Nutrition unknown 分离。 |
| REQ-EVENT-004 | PASS | `event_id/source_text/message_source/received_at/committed_at/schema_version` 必填。 |
| REQ-EVENT-005 | PASS | OccurredTime、RuleRef、evidence/version 字段覆盖推导溯源。 |
| REQ-EVENT-006 | PASS | command outcome、record lifecycle 枚举分离且混用反例拒绝。 |
| REQ-EVENT-007 | PASS | 幂等唯一与返回原结果明确留给跨对象/存储约束。 |
| REQ-EVENT-008 | PASS | `possible_duplicate` Issue 可提示，不自动合并。 |
| REQ-EVENT-009 | PASS | input order/逐事件原子边界有字段与跨对象不变量。 |
| REQ-EVENT-010 | PASS | 禁止 mixed 全局回滚的旧语义，逐事件提交边界已说明。 |
| REQ-EVENT-011 | PASS | runner 全程业务数据 0→0，包装器有递归快照。 |
| REQ-EVENT-012 | PASS | failed 属命令且不得成为持久事件/Resolution outcome。 |
| REQ-MEAL-001 | PASS | MealSlot 同时保存 raw/value/source。 |
| REQ-MEAL-002 | PASS | MealSlot source 精确区分 explicit/inferred/unknown。 |
| REQ-MEAL-003 | PASS | meal_slot 与 occurred_time 独立字段。 |
| REQ-MEAL-004 | PASS | MealEvent `items minItems:1` 且保序。 |
| REQ-MEAL-005 | PASS | 事实可在附加数据不完整时保存。 |
| REQ-MEAL-006 | PASS | MealItem 原名/规范身份结构可表达可识别食物。 |
| REQ-MEAL-007 | PASS | 事件原话与 item 原始名称均保留。 |
| REQ-MEAL-008 | PASS | OccurredTime 保留原文、默认依据、锚点与版本。 |
| REQ-MEAL-009 | PASS | reported/nutrition/inventory/meal-slot 状态分离。 |
| REQ-MEAL-010 | PASS | vague/missing Quantity 仍可随 MealItem 保存并引用 Issue。 |
| REQ-MEAL-011 | **FAIL** | F-03：无可信范围仍可写 adopted upper bound。 |
| REQ-MEAL-012 | **FAIL** | F-03：不要求保存范围，且未登记 adopted 等于合理上界的不变量。 |
| REQ-MEAL-013 | PASS | nutrition adopted 与 inventory requested/applied 独立。 |
| REQ-MEAL-014 | PASS | 无 adoption 的 vague/missing 与 unknown 营养可表达；不默认编数。 |
| REQ-MEAL-015 | PASS | exact/approximate/range/vague/missing 五分支保存表达。 |
| REQ-MEAL-016 | PASS | whole/components 条件互斥；跨快照去重列为不变量。 |
| REQ-MEAL-017 | PASS | DishComponent/template/evidence/rule version 可追溯。 |
| REQ-MEAL-018 | PASS | Correction + 新 Snapshot + 旧 EventVersionSnapshot 可表达。 |
| REQ-MEAL-019 | PASS | 套餐根事实、unknown 营养、组合内容 Issue 可并存。 |
| REQ-PANTRY-001 | PASS | home_default 上下文与匹配/扣减效果分开。 |
| REQ-PANTRY-002 | PASS | external explicit 对应稳定 skipped 状态且 allocation 空。 |
| REQ-PANTRY-003 | PASS | skip_inventory_explicit / skipped_by_user 可表达。 |
| REQ-PANTRY-004 | PASS | 七种 skipped 原因形成持久 effect_status。 |
| REQ-PANTRY-005 | PASS | 同商品多批次由 candidate/selected batch 与 allocation 表达，不等于产品 multiple。 |
| REQ-PANTRY-006 | PASS | user-specified 批次策略及证据留给匹配/跨对象规则。 |
| REQ-PANTRY-007 | PASS | FEFO/FIFO 选择顺序明确列为跨对象不变量。 |
| REQ-PANTRY-008 | PASS | deducted effect 可有多个 BatchAllocation。 |
| REQ-PANTRY-009 | PASS | 过期跳过/显式选择证据属于已声明跨对象选择规则。 |
| REQ-PANTRY-010 | PASS | CAS/余额不超扣列为事务与存储约束。 |
| REQ-PANTRY-011 | PASS | InventoryBatch 的 ID、原话、发生/接收/提交时间齐全。 |
| REQ-PANTRY-012 | PASS | PackagingLevel/初始 Quantity/推导字段与证据可表达。 |
| REQ-PANTRY-013 | PASS | 根初始量与 InventoryBalanceView 分离；unknown 不写 0。 |
| REQ-PANTRY-014 | PASS | 来源、推导、规则、质量、issue refs 齐全。 |
| REQ-PANTRY-015 | PASS | batch_id/version 支持独立批次，不覆盖同名旧批次。 |
| REQ-PANTRY-016 | PASS | StorageAssignment 任意非空位置、source/evidence/rule。 |
| REQ-PANTRY-017 | **FAIL** | F-06：只有嵌入初始位置，没有可执行的自然语言纠正/当前位置投影路径。 |
| REQ-PANTRY-018 | PASS | attention policy 与 QuickPrompt 可只在关键不确定性出现。 |
| REQ-PANTRY-019 | PASS | ExpirationAssessment 保存估算、锚点、时区、条件、规则。 |
| REQ-PANTRY-020 | PASS | 到期 known/unknown 与最有价值锚点可表达。 |
| REQ-PANTRY-021 | PASS | 动态剩余天数明确不落原始 Batch。 |
| REQ-PANTRY-022 | **FAIL** | F-06：无位置/开封修订到新评估、当前选择及旧评估审计链。 |
| REQ-PANTRY-023 | PASS | 文档明确保质评估不等于食品安全保证。 |
| REQ-PRODUCT-001 | PASS | Product/Profile/Snapshot 与耗尽余额分离，不删除身份。 |
| REQ-PRODUCT-002 | PASS | 精确历史身份与带版本 Profile 引用可复用。 |
| REQ-PRODUCT-003 | PASS | Product candidate multiple 与证据可表达，不按相似名强选。 |
| REQ-PRODUCT-004 | PASS | per_100g/per_100ml Profile 与 PackagingVariant/批次量分离。 |
| REQ-PRODUCT-005 | PASS | NutritionProfile version + immutable Snapshot 保留旧引用。 |
| REQ-NUTR-001 | PASS | 来源优先级/许可/适用性明确留给冻结注册表验证。 |
| REQ-NUTR-002 | PASS | 动态 source_id+registry_version，不硬编码来源 enum。 |
| REQ-NUTR-003 | PASS | 精确商品/标签/配方来源可带字段级证据。 |
| REQ-NUTR-004 | PASS | 产品身份/变体/来源版本避免通用资料静默套用。 |
| REQ-NUTR-005 | PASS | 核心五字段均为 known/unknown 联合，missing 不得 known zero。 |
| REQ-NUTR-006 | PASS | field estimation_status 支持明确量不标估算。 |
| REQ-NUTR-007 | PASS | Profile 历史版本与沿用证据可追溯。 |
| REQ-NUTR-008 | PASS | template/rule/evidence 可表达个人模板来源但未提前实现学习状态机。 |
| REQ-NUTR-009 | PASS | 公共数据库来源与展示估算状态分离。 |
| REQ-NUTR-010 | PASS | NutritionBasis/field evidence 保存具体采用值与依据。 |
| REQ-NUTR-011 | PASS | 每字段 estimation 与整体 completeness 双轴分离。 |
| REQ-ISSUE-001 | PASS | Issue 不等于写入失败，根事实与 Issue 分离。 |
| REQ-ISSUE-002 | PASS | QuickPrompt `issue_ids[]` 支持统一覆盖多个 Issue。 |
| REQ-ISSUE-003 | PASS | deferred 状态/trigger/attention policy 追加表达。 |
| REQ-ISSUE-004 | PASS | IssueResolutionEvent 独立追加对象。 |
| REQ-ISSUE-005 | **FAIL** | F-05：applied 允许 `revalidated_versions=[]`。 |
| REQ-ISSUE-006 | PASS | invalidated 状态要求 invalidating event 引用。 |
| REQ-CORR-001 | PASS | CorrectionEvent 追加，不物理覆盖。 |
| REQ-CORR-002 | PASS | EventVersionSnapshot/EffectiveEventView 分离历史与当前。 |
| REQ-CORR-003 | PASS | InventoryCompensation + NutritionRecalculation 结构齐全。 |
| REQ-CORR-004 | PASS | remove_item 必须 item target，补偿引用真实 effect。 |
| REQ-CORR-005 | PASS | void_event 禁 item target，有 voided 有效视图。 |
| REQ-CORR-006 | PASS | TimeChangeDetail + affected_local_dates；双日包含列为跨对象不变量。 |
| REQ-CORR-007 | PASS | 领域只保存选择事实，明确不提前复制展示排版/内部 ID 文案。 |
| REQ-CORR-008 | PASS | CAS、无环、幂等、禁止重复补偿列为跨对象/存储约束。 |

## 6. 27 项 PASS 标准

汇总：**PASS 19 / FAIL 8**。

| # | 结果 | 独立结论 |
| ---: | --- | --- |
| 1 | PASS | 冻结哈希、身份、status_source、边界一致，无候选自称独立 PASS。 |
| 2 | PASS | 84 唯一，TIME/QUICK/SAFE 未混入。 |
| 3 | **FAIL** | F-06 两条追踪是语义空映射；MEAL-011/012、ISSUE-005 也未完整落到约束。 |
| 4 | PASS | Draft 2020-12、Ajv strict 与 formats 编译通过。 |
| 5 | PASS | 44 最低 defs 全齐，66 个总 defs 未见越界顶层职责。 |
| 6 | PASS | 顶层恰 17 且有正例，正式 event 拒绝 query/ignore/mixed。 |
| 7 | PASS | command outcome、record lifecycle、Issue status 枚举分离。 |
| 8 | **FAIL** | F-07：全局 CanonicalDecimal 接受的小数零在 skipped 上下文被拒绝。 |
| 9 | **FAIL** | F-03：nutrition adopted 可无合理范围/非上界。 |
| 10 | **FAIL** | F-02：unknown time 可携带精确 timestamp。 |
| 11 | PASS | Meal 有序、whole/components 互斥，模糊/缺量与套餐 unknown 可保存。 |
| 12 | PASS | Product/Packaging/Batch/Transaction/Balance 分离，根批次拒 depleted/current balance。 |
| 13 | PASS | 1 袋 known + 内含 unknown 可表达；位置不硬编码三值。 |
| 14 | **FAIL** | deducted/skipped 主约束正确，但 F-07 拒绝合法语义零表示。 |
| 15 | PASS | Profile/Snapshot、六 basis、五核心字段、双轴、来源版本和证据齐全。 |
| 16 | PASS | source_id 动态；存在性/许可/优先级留给注册表。 |
| 17 | PASS | Issue/StateEvent/View 分离，3/17/6 精确，终态条件齐全。 |
| 18 | PASS | 7 outcome 精确，failed_storage 及矛盾 resulting status 拒绝。 |
| 19 | **FAIL** | F-04：未约束 2–4 选项和 safe_exit。 |
| 20 | PASS | 12 Correction、remove/void、CAS、补偿、新营养快照、跨日视图结构通过 CR 定向。 |
| 21 | **FAIL** | 虽列 14 项，但遗漏 F-03 上界相等及 F-06 批次修订/评估链边界。 |
| 22 | PASS | 未提前加入完整 CommitResult/DailyProgress/Water、物理存储或模板学习状态机。 |
| 23 | PASS | 53 反例精确错误签名，36 正例目标+根均通过。 |
| 24 | **FAIL** | F-01：伪 Node 协议输出可外层 0/最终 PASS。 |
| 25 | PASS | 独立运行 89、17、44、84、枚举、变异及恶意运行时。 |
| 26 | PASS | 旧规则冲突扫描为 0。 |
| 27 | PASS | 业务扩展集合始终为空，最终差异 0。 |

## 7. 旧规则与 Schema/跨对象边界

未发现家庭成员、0.3 健康助手、只有明确在家才扣、附加异常反向阻断事实、unknown=0、同商品多批次一律歧义、物理改写/删除、mixed 全局回滚、`failed_storage` 持久化等旧语义复活。

现有 14 项跨对象边界本身合理：range 顺序、allocation 合计、余额守恒/非负、FEFO/FIFO/CAS、同商品多批次、整菜/组件去重、来源注册表、营养集合一致、Correction 链/补偿、Issue 转换/事务、幂等/mixed、跨日双日期、原子边界、引用存在/版本匹配。FAIL 不在于这些边界谎称由 Ajv 保证，而在于 F-03/F-06 所需边界根本未登记，且若干本可由单对象 Schema 直接阻断的状态被接受。

## 8. 结论

**第 1 轮 FAIL。** 冻结哈希、89 cases、17 顶层、44 最低 defs、精确枚举、CR-F01~F05 与业务数据隔离本身通过；但 6 个高严重度和 1 个中严重度发现尚未解决。按复核包门槛，任一高/中发现、语义空映射或非法状态可通过即不得 PASS。

下一轮必须冻结新的候选哈希后再复核，至少逐项执行 F-01~F-07 的最小修复与新增测试；不得在本冻结候选上就地修改后沿用本报告结论。

---

# SH-MODEL-001 独立复核记录（第 2 轮）

review_round: 2  
review_date: 2026-08-09  
timezone: Asia/Shanghai  
reviewer: Codex `/root/data_model_review_prep`  
verdict: **FAIL**  
remaining_high: **1**  
remaining_medium: **3**  
remaining_low: **1**

本节是对第 2 轮冻结候选的独立复核，完整追加在第 1 轮历史之后。追加前第 1 轮全文 SHA-256 为 `FBBED5AB7895913C7D38C0067279E4C12E7004F763203C1A627C9AADB8056696`，与复核包冻结值一致。除本文件外未修改任何项目文件；临时恶意运行时和镜像均在项目外创建并已删除；未创建 `.jsonl/.sqlite/.sqlite3/.db` 业务数据。

## R2-1. 冻结身份、环境与业务隔离

### R2-1.1 哈希

复核开始及写入前重新计算以下 SHA-256，均逐字匹配复核包；`HASH_MISMATCH=0`。

| 对象 | SHA-256 |
| --- | --- |
| `docs/work-items/SH-MODEL-001-review-package.md` | `3D92347367ED304EBD93DDEF8B432966A314C73B8A4E7EDC1C345DF59064D9FD` |
| `docs/work-items/SH-MODEL-001-brief.md` | `070B92F4B64030BF3EAB9FB7FEE7341154ACDD2DE3F8F7C07AE743DFE8EDA49E` |
| `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |
| 第 1 轮 `docs/work-items/SH-MODEL-001-review.md` | `FBBED5AB7895913C7D38C0067279E4C12E7004F763203C1A627C9AADB8056696` |
| `shared/contracts/data-model.md` | `0FB158C3D7B8376C163A96D4BE74DA798F011687DBCF8C6693F34CB63106347B` |
| `shared/schemas/domain.schema.json` | `B6D0EAE9566D76D381C4A4DBEBCF4F9C227F4BCDCD936EAE75C5498B0F264ABA` |
| `shared/schemas/fixtures/domain-cases.json` | `68A898EC9915F596F5713F9E45B851FA25C85441C5F20405BB078F493850DADB` |
| `shared/tests/validate-domain-schema.mjs` | `C2491EFC384D88934A2D06C3D9608EF86EBB3609A6FF2983572610C30C97EDD4` |
| `shared/tests/validate-domain-schema.ps1` | `D1E85525B341F44EAD52D7B9DD82279B03532DAA7B85EEEB3AF32CD5031DD82F` |
| `docs/work-items/SH-MODEL-001-report.md` | `1F259C417D80C3A890468AE166B1731209B49B611C5873BBD46E3B7CAB4D880D` |

### R2-1.2 环境

| 项目 | 独立复核值 |
| --- | --- |
| OS / shell | Windows / Windows PowerShell 5.1 |
| Node | `v24.14.0`；`C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`；SHA-256 `63C259C81E5D472B5F11C8D506070130CB04A1ECF84B80377A34ED6EC9048088` |
| Ajv 2020 | `8.20.0`；SHA-256 `908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A` |
| ajv-formats | `3.0.1`；SHA-256 `3F3014150293846086D11058BB8BF43E669E354A98B37ADCF10281454D5E753B` |
| Ajv 设置 | Draft 2020-12；`strict=true`、`allErrors=true`、`validateFormats=true` |

### R2-1.3 业务数据三时点

项目根含 `node_modules` 递归扫描 `.jsonl/.sqlite/.sqlite3/.db`：

| 时点 | 文件数 | 与初始快照差异 |
| --- | ---: | ---: |
| 第 2 轮开始前 | 0 | 0 |
| 主体复核及全部临时故障测试后 | 0 | 0 |
| 写入第 2 轮记录后的最终终扫 | 0 | 0 |

因此没有可列出的路径、大小、SHA-256 或 UTC mtime；业务数据最终差异为 **0**。

## R2-2. 独立机器结果

### R2-2.1 真实 wrapper 与独立 Ajv

真实冻结 wrapper 重新运行：

```text
SCHEMA_COMPILE=PASS
CASE_TOTAL=222
VALID_PASS=96/96
INVALID_PASS=126/126
CASE_FAILURE_COUNT=0
RUNNER_VERDICT=PASS
RUNNER_EXIT_CODE=0
BUSINESS_BEFORE_COUNT=0
BUSINESS_AFTER_COUNT=0
BUSINESS_DATA_CHANGED=0
VERDICT=PASS
OUTER_EXIT=0
```

另用冻结 Ajv/format 直接编译并逐 case 验证，不调用候选 runner：目标 `$defs` 与根的正例为 `96/96`，反例为 `126/126`；126 个反例均命中 fixture 声明的 `keyword + schemaPath + instancePath + 必要 params`，且根为 false；失败数 `0`，case ID 重复 `0`，反例元数据缺失 `0`。

### R2-2.2 84、17、83/44 与枚举

```text
TRACE_ROWS=84
TRACE_UNIQUE=84
TRACE_MISSING=0
TRACE_EXTRA=0
TRACE_DUPLICATE=0
TRACE_SUPPORT_ID_MIXED=0
TRACE_EMPTY_MAPPING=0
ROOT_ONEOF=17
ROOT_MODEL_TYPE_UNIQUE=17
ROOT_POSITIVE=17/17
DEFS_TOTAL=83
MINIMUM_DEFS_PRESENT=44/44
```

精确枚举重算为 Issue kind/code/status `3/17/6`、Resolution outcome `7`、Correction operation `12`，均与冻结契约完全相等；`failed_storage` 未进入持久 Resolution outcome。

所有稳定正向分支均有目标+根合法正例：InventoryMatch 五态 `5/5`，InventoryEffect 九态 `9/9`，InventoryTransaction 六类 `6/6`，NutritionBasis 六类 `6/6`，Issue code `17/17`、IssueView 六态 `6/6`、Resolution 七 outcome `7/7`、Correction 十二 operation `12/12`，QuickPrompt 长度 `2/3/4` 均覆盖。

### R2-2.3 26 项 mutation

26 个 mutant Schema 均能正常编译。按“只移除目标 guard”的隔离变异，结果是 `25/26`：M04 只从 `adopted_measure` 的 `dependentRequired` 删除 `plausible_min/plausible_max` 时，`invalid-vague-adopted-upper-bound-without-plausible-range` 仍因同时缺少 `adoption_formula` 而保持 invalid，不能证明范围 guard 被杀死。给同一模型补上合法 `adoption_formula` 后，原 Schema 因缺少 min/max 拒绝；仅删除 range guard 的 mutant 则接受，证明生产约束存在而回归 fixture 未隔离。实施报告使用删除整个 adopted 依赖的宽变异得到 `26/26`，不能替代精确 guard 的证据。

### R2-2.4 恶意运行时和失败关闭

项目外临时镜像的独立结果如下；测试后临时目录均已删除：

| 场景 | 实际结果 |
| --- | --- |
| 伪 Node 完整输出 222-case PASS 协议 | 在调用前 `NODE_RUNTIME_UNTRUSTED`；wrapper 2；`VERDICT=FAIL` |
| Node `--version` 退出 7（仅临时信任常量镜像） | `NODE_VERSION_FAILED:exit=7`；外层 2 |
| fixture 缺失 / 非法 JSON / `{}` / 空 cases | 均外层 2、FAIL |
| Ajv 缺失 | 外层 2、FAIL |
| Ajv 与 formats 不同依赖树 | `AJV_DEPENDENCY_TREE_MISMATCH`；外层 2 |
| 两组不同哈希候选 | `AJV_AMBIGUOUS:distinct_hash_pairs=2`；外层 2 |
| runner 伪造 PASS 但计数错误 | 协议拒绝；外层 2 |
| runner 自行输出 `VERDICT` | 协议拒绝；外层 2 |
| runner 合法 FAIL 协议并退出 1 / 2 | wrapper 分别传播 1 / 2 |
| runner 临时创建 `.db` | `BUSINESS_DATA_CHANGED=1`；最终 FAIL；优先外层 3 |

## R2-3. 正式 F-01～F-07 与 CR 回归

| ID | 第 2 轮独立结果 | 状态 |
| --- | --- | --- |
| F-01 | 真实 Node 通过；伪 Node 即使完整仿造 222-case PASS 协议也在执行前因路径/哈希不可信被拒，版本失败亦关闭。 | **CLOSED** |
| F-02 | unknown 不带 resolved 为正；unknown+start、unknown+range 均拒；对应 mutation 被杀死。 | **CLOSED** |
| F-03 | Schema 已要求 adopted 同时携带 range/basis/formula/evidence/rule，且 §5 登记相等/顺序语义；但 M04 fixture 因另缺 formula，未隔离 range guard。 | **NOT CLOSED（中）** |
| F-04 | QuickPrompt 1/5/无出口/ignored safe-exit 均拒；2/3/4 含真实安全出口均合法。 | **CLOSED** |
| F-05 | applied 空重校验、rejected 带 effect、矛盾状态均拒；七 outcome 各有合法正例。 | **CLOSED** |
| F-06 | 已增加 batch/assessment 版本与 current projection，但 batch/assessment trigger 集可不一致，仍可由 Ajv 直接放过。 | **NOT CLOSED（高）** |
| F-07 | skipped 接受 `0/0.0/0.00`，非零仍拒；还原 `const:"0"` 的 mutation 被杀死。 | **CLOSED** |

第 1 轮 `CR-F01~F05` 亦重核：fixture 非数组/空数组失败关闭；根批次拒 `depleted`；营养来源纠错强制重算；rejected 不得 resolved；非法 LocalDate 在 TimeChange/Correction/EffectiveView 均拒，五项均 PASS。

## R2-4. 交叉审阅并集与 22 项语义边界

### R2-4.1 15 项交叉矩阵

| # | 结果 | 独立结论 |
| ---: | --- | --- |
| 1 | PASS | OccurredTime unknown/resolved 互斥且真实格式生效；顺序未冒充 Ajv 保证。 |
| 2 | PASS | 五类数量角色及 vague/unknown 合法、非法分支均可区分。 |
| 3 | PASS | InventoryMatch 五态及 multiple 候选下界闭合。 |
| 4 | PASS | Effect/Transaction 正量、零效果、allocation 与方向双向约束闭合。 |
| 5 | PASS | 100g/100ml、正量及 nutrient 单位维度有正反覆盖。 |
| 6 | PASS | 17 code 未发明唯一 code-kind 映射；仅有冻结依据的 blocking 限制生效。 |
| 7 | PASS | IssueView 六态与 resolution/deferred/invalidated 字段双向互斥。 |
| 8 | PASS | Resolution 七 outcome、重校验、状态及 effects 条件闭合。 |
| 9 | **FAIL** | Correction 十二 operation 正例存在，但 `change_amount` 可无 supplied facts，且非 `change_time` 可携带 `time_change`。 |
| 10 | PASS | Snapshot/View 只接受 committed Meal/Purchase 引用并拒命令态；LocalDate 生效。 |
| 11 | **FAIL** | F-06：Batch 与嵌入 Assessment 的 trigger 集未双向一致。 |
| 12 | PASS | Quick 2–4、安全出口和 operation 闭合。 |
| 13 | PASS | 规定的全部稳定状态/operation 正例均同时通过目标与根。 |
| 14 | **FAIL** | 现有 case 的错误签名虽精确，但 F-03 范围 mutation 被缺失 formula 掩盖，且三类新旁路无反例。 |
| 15 | PASS | 22 项比较/引用/版本/事务语义均明确留给后续验证器，没有冒充 Ajv 保证。 |

### R2-4.2 22 项后续语义验证器边界

| # | 结果 | 边界 |
| ---: | --- | --- |
| 1 | PASS | 时间起止、时区支持与解析依据相容。 |
| 2 | PASS | range/vague 顺序、单位与 adopted 等于合理上界。 |
| 3 | PASS | reported/adopted/requested/applied/packaging 证据角色隔离。 |
| 4 | PASS | Match 引用真实性、候选/选择子集。 |
| 5 | PASS | allocation 合计及 effect/transaction 归属与方向。 |
| 6 | PASS | 余额非负、守恒、CAS、FEFO/FIFO。 |
| 7 | PASS | Batch/Assessment supersedes 无环与版本对应。 |
| 8 | PASS | 修订触发真实变化、到期重评与旧依据保留。 |
| 9 | PASS | current batch/assessment projection 唯一选择链头。 |
| 10 | PASS | 营养数学与来源注册表存在、许可、优先级。 |
| 11 | PASS | 营养字段集合、单位、舍入与 whole/component 去重。 |
| 12 | PASS | Issue code-kind 只作有依据的语义检查。 |
| 13 | PASS | Issue 状态图与 IssueView 最新合法投影。 |
| 14 | PASS | Quick 引用/版本/组覆盖、ID 唯一与到期顺序。 |
| 15 | PASS | Resolution option/operation/facts/revalidation/effect 兼容。 |
| 16 | PASS | 改变事实的 Resolution 与 Correction 原子一致。 |
| 17 | PASS | Correction before/目标/CAS/无环/真实补偿/不重复返库。 |
| 18 | PASS | 新营养快照使用纠正事实，change_time 跨日恰含旧日与新日。 |
| 19 | PASS | committed refs 存在且 root/entity/version/current view 一致。 |
| 20 | PASS | 幂等唯一、响应丢失复用与 mixed 子键稳定。 |
| 21 | PASS | 单事件事实、效果、营养、Issue、幂等与进度位于原子边界。 |
| 22 | PASS | 其余引用存在、类型/版本正确且不越隐私许可。 |

这些 22 项是后续语义验证器/事务/存储的明确职责；本轮 FAIL 均是单对象本应封闭的形状或测试隔离问题，不要求 Ajv 证明跨对象真实性。

## R2-5. 第 2 轮高/中发现与最小修复

### `R2-F08` 高：Batch 与 ExpirationAssessment trigger 可互相矛盾

- 位置：`shared/schemas/domain.schema.json:575-647`，规范要求见 `shared/contracts/data-model.md:81`。
- 实测 1：合法初始 batch 改为 `revision_triggers=["initial_stock_in"]`，嵌入 assessment 改为修订态 `assessment_triggers=["storage_changed"]` 并带 supersedes，目标 `$defs` 与根均为 true。
- 实测 2：storage 修订 batch 的 assessment 同时多带 `opening_changed`，目标与根均为 true。
- 根因：Schema 仅实现 batch trigger → assessment `contains` 的单向条件，且 initial 没有关联条件；没有 assessment → batch 的反向禁止或 trigger 集相等约束。
- 影响：REQ-PANTRY-017/022 的位置/开封/保质修订审计会记录互相矛盾原因，当前投影和重评无法可靠重放；F-06 未关闭。
- 最小修复：在同一 `InventoryBatch` 内让五种 `revision_triggers` 与嵌入 `expiration.assessment_triggers` 精确一致。可对每个 trigger 写双向 `if/then`（存在则对侧必须包含，不存在则对侧必须不包含），并明确 initial 两侧都只能是 `initial_stock_in`；增加上述两个独立反例，分别精确命中目标与根。

### `R2-F09` 中：F-03 范围回归 case 未隔离目标 guard

- 位置：`shared/schemas/fixtures/domain-cases.json:2020-2036`；生产 guard 在 `shared/schemas/domain.schema.json:182-185`；实施声明在 `docs/work-items/SH-MODEL-001-report.md:159-167`。
- 证据：fixture 同时缺 `plausible_min`、`plausible_max`、`adoption_formula`。只删除 min/max 依赖的 mutant 仍因缺 formula 被拒，因此精确 mutation 为 `25/26`；删除整个 adopted 依赖的宽 mutant 得 `26/26` 不能证明范围 guard。
- 影响：后续误删范围要求仍可能在报告中显示全绿，属于复核包明确禁止的假阳性测试证据。
- 最小修复：给现有“无范围”模型补合法 `adoption_formula`，并设置 `expected_params` 精确锁定 `missingProperty=plausible_min` 或 `plausible_max`；另建只缺 formula 的独立反例。重跑“只删范围依赖”的 mutant 必须由范围 case 杀死。

### `R2-F10` 中：change_amount 可没有任何新数量事实

- 位置：`shared/schemas/domain.schema.json:1525-1545`（`supplied_facts` 只是任意 object）；契约见 `shared/contracts/issue-correction-contract.md:150-169,179-187`、`shared/contracts/data-model.md:111-113`。
- 证据：从 `valid-correction-change-amount-with-actual-effect-delta` 仅改为 `supplied_facts={}`，其余保持合法，目标 `#/$defs/CorrectionEvent=true`、根 `true`、错误数组均空。
- 影响：事件声称 `operation=change_amount` 并创建补偿/营养新快照，却没有可表达纠正后数量，无法证明库存补偿与营养重算以同一纠正事实计算，直接破坏 REQ-CORR-003。
- 最小修复：至少对 `change_amount` 要求非空且封闭的数量事实（优先复用现有 `Quantity/Measure`，不要继续用任意 object）；其余有输入事实的 operation 也应逐个规定最小字段。新增 `change_amount + supplied_facts={}` 目标+根反例，并为合法精确/模糊新数量各保留正例。

### `R2-F11` 中：非 change_time operation 可额外携带 time_change

- 位置：`shared/schemas/domain.schema.json:1535-1539,1564-1569`；规范见 `shared/contracts/data-model.md:113,119`。
- 证据：给合法 `change_amount` 加入完整合法 `time_change`，目标与根仍均为 true、错误数组为空。
- 影响：固定单一 operation 的 Correction 可同时携带另一 operation 的专属细节；按 operation 分派的跨日验证器会忽略或误解该字段，形成矛盾审计记录并危及 REQ-CORR-006。
- 最小修复：`operation=change_time` 时 require `time_change`；所有其他 operation 用 `else/not` 明确禁止该字段。新增 `change_amount + time_change` 隔离反例，并保留 change_time 有/无 detail 的正反例。

### `R2-F12` 低：per-100 basis 与 CanonicalDecimal 的合法尾零域不一致

- 位置：`shared/schemas/domain.schema.json:904-958`。
- 证据：独立探针中 `CanonicalDecimal` 及 F-07 规则接受合法尾零；但 `per_100g` 的 `100.0 g` 和 `per_100ml` 的 `100.00 ml` 因 basis 使用词法 `const:"100"` 而被目标与根拒绝。
- 影响：不改变数值语义，且可由写入端统一规范化，因此定为低；但当前“CanonicalDecimal”合法域在不同对象不一致，跨路线可能产生不必要的兼容差异。
- 最小修复：二选一并冻结：basis 对数值 100 使用 `^100(?:\.0+)?$` 等语义正则；或全局规定并验证唯一十进制词法、同步收紧 CanonicalDecimal 与迁移规则。补 `100.0 g/100.00 ml` 正例或对应明确反例。

## R2-6. 84 条范围需求逐项结果

汇总：**PASS 80 / FAIL 4**。支撑 `REQ-TIME-* / REQ-QUICK-* / REQ-SAFE-*` 未混入 84 行；F-03 的生产语义已恢复，R2-F09 是测试证据阻断而非额外需求 FAIL。

| Requirement | 结果 | 第 2 轮对象/字段/不变量结论 |
| --- | --- | --- |
| REQ-EVENT-001 | PASS | EventEnvelope 只分派 meal/purchase，命令不伪造正式对象。 |
| REQ-EVENT-002 | PASS | 删除由追加 void 表达，ignored 不冒充生命周期。 |
| REQ-EVENT-003 | PASS | Meal 根事实与库存/营养未决效果分离。 |
| REQ-EVENT-004 | PASS | 事件 ID、原话、来源、接收/提交时间和版本必填。 |
| REQ-EVENT-005 | PASS | 时间、规则与证据版本可追溯。 |
| REQ-EVENT-006 | PASS | 命令 outcome、记录 lifecycle、Issue status 不混用。 |
| REQ-EVENT-007 | PASS | 幂等唯一/返回原结果留给边界 20。 |
| REQ-EVENT-008 | PASS | possible_duplicate 只提示，不自动合并。 |
| REQ-EVENT-009 | PASS | 输入顺序与逐事件边界已表达。 |
| REQ-EVENT-010 | PASS | 禁止 mixed 全局回滚旧规则。 |
| REQ-EVENT-011 | PASS | runner/wrapper 全程业务数据 0→0。 |
| REQ-EVENT-012 | PASS | failed 不成为持久事件/outcome。 |
| REQ-MEAL-001 | PASS | MealSlot raw/value/source 同存。 |
| REQ-MEAL-002 | PASS | explicit/inferred/unknown 来源精确。 |
| REQ-MEAL-003 | PASS | 餐次与 OccurredTime 独立。 |
| REQ-MEAL-004 | PASS | Meal items 非空且有序。 |
| REQ-MEAL-005 | PASS | 事实优先，附加不完整不阻断根事实。 |
| REQ-MEAL-006 | PASS | 可识别项目原名/身份可表达。 |
| REQ-MEAL-007 | PASS | 事件原话与 item 原名保留。 |
| REQ-MEAL-008 | PASS | 默认时间依据、锚点、原文与版本齐全。 |
| REQ-MEAL-009 | PASS | reported/adopted/requested/applied 角色隔离。 |
| REQ-MEAL-010 | PASS | vague/missing 仍可随事实保存并引用 Issue。 |
| REQ-MEAL-011 | PASS | adopted 直接要求 plausible range/basis/formula/evidence/rule。 |
| REQ-MEAL-012 | PASS | 字段证据齐全；相等/顺序明确在边界 2。 |
| REQ-MEAL-013 | PASS | 五类数量角色不互相代替。 |
| REQ-MEAL-014 | PASS | 无可信范围保持 unknown，不编数。 |
| REQ-MEAL-015 | PASS | 五种 Quantity 联合封闭。 |
| REQ-MEAL-016 | PASS | whole/components 互斥，去重留边界 11。 |
| REQ-MEAL-017 | PASS | 组件采用、模板、证据、规则版本可追溯。 |
| REQ-MEAL-018 | PASS | 不可变 Snapshot 与 Correction 新版本可表达。 |
| REQ-MEAL-019 | PASS | 根项目、unknown 营养与内容缺口 Issue 可并存。 |
| REQ-PANTRY-001 | PASS | 家庭默认匹配与扣减效果分开。 |
| REQ-PANTRY-002 | PASS | external 对应稳定 skipped 状态。 |
| REQ-PANTRY-003 | PASS | 用户明确不扣可持久化为 skipped_by_user。 |
| REQ-PANTRY-004 | PASS | 九种 effect 状态及 skipped 零效果闭合。 |
| REQ-PANTRY-005 | PASS | 多批 allocation 与产品 multiple 分离。 |
| REQ-PANTRY-006 | PASS | 用户指定批次策略/证据可表达。 |
| REQ-PANTRY-007 | PASS | FEFO/FIFO 留边界 6。 |
| REQ-PANTRY-008 | PASS | 多 BatchAllocation 原子合计留边界 5。 |
| REQ-PANTRY-009 | PASS | 到期选择证据与 expiration 分离。 |
| REQ-PANTRY-010 | PASS | CAS/余额非负守恒留边界 6。 |
| REQ-PANTRY-011 | PASS | Batch 原话、发生/接收/提交时间齐全。 |
| REQ-PANTRY-012 | PASS | 包装层级、初始量、推导量及证据隔离。 |
| REQ-PANTRY-013 | PASS | 初始事实与 BalanceView 分离，unknown≠0。 |
| REQ-PANTRY-014 | PASS | 来源/推导/规则/质量/Issue refs 齐全。 |
| REQ-PANTRY-015 | PASS | batch ID/version 支持独立批次与追加修订。 |
| REQ-PANTRY-016 | PASS | StorageAssignment 不硬编码位置，含来源/证据/规则。 |
| REQ-PANTRY-017 | **FAIL** | R2-F08：位置修订 trigger 可与到期重评 trigger 矛盾。 |
| REQ-PANTRY-018 | PASS | 关键不确定性与 QuickPrompt 可表达。 |
| REQ-PANTRY-019 | PASS | Assessment ID/version/trigger/锚点/时区/条件/规则齐全。 |
| REQ-PANTRY-020 | PASS | 到期 known/unknown 与最佳锚点封闭。 |
| REQ-PANTRY-021 | PASS | 动态剩余天数不落原始 Batch。 |
| REQ-PANTRY-022 | **FAIL** | R2-F08：追加链存在，但互相矛盾 trigger 可进入审计/当前投影。 |
| REQ-PANTRY-023 | PASS | 保质评估不冒充安全保证。 |
| REQ-PRODUCT-001 | PASS | Product/Profile/Batch/余额分离。 |
| REQ-PRODUCT-002 | PASS | 历史身份与带版本 Profile 可复用。 |
| REQ-PRODUCT-003 | PASS | multiple 候选有证据且不强选。 |
| REQ-PRODUCT-004 | PASS | per100 Profile 与包装/批次数量分离。 |
| REQ-PRODUCT-005 | PASS | Profile 版本与不可变 Snapshot 保留旧引用。 |
| REQ-NUTR-001 | PASS | 来源优先/许可/适用性留注册表验证。 |
| REQ-NUTR-002 | PASS | source_id/registry_version 动态。 |
| REQ-NUTR-003 | PASS | 商品/标签/配方可带字段级证据。 |
| REQ-NUTR-004 | PASS | 身份/变体/来源版本防止静默套用。 |
| REQ-NUTR-005 | PASS | 五核心字段 known/unknown 与单位维度闭合。 |
| REQ-NUTR-006 | PASS | 字段 estimation_status 与明确量分离。 |
| REQ-NUTR-007 | PASS | Profile 历史版本与沿用证据可追溯。 |
| REQ-NUTR-008 | PASS | 模板规则证据可表达，未提前实现学习状态机。 |
| REQ-NUTR-009 | PASS | 公共来源与展示估算状态分离。 |
| REQ-NUTR-010 | PASS | basis/field evidence 保存采用值与依据。 |
| REQ-NUTR-011 | PASS | 字段估算与整体 completeness 双轴。 |
| REQ-ISSUE-001 | PASS | Issue 不等于写入失败。 |
| REQ-ISSUE-002 | PASS | QuickPrompt 可覆盖多个 Issue。 |
| REQ-ISSUE-003 | PASS | deferred/trigger/attention policy 追加表达。 |
| REQ-ISSUE-004 | PASS | Resolution 是独立追加对象。 |
| REQ-ISSUE-005 | PASS | applied 要求重校验；陈旧执行留边界 15。 |
| REQ-ISSUE-006 | PASS | invalidated 要求 invalidating ref。 |
| REQ-CORR-001 | PASS | Correction 追加且根事件保留。 |
| REQ-CORR-002 | PASS | Snapshot/View 分离历史与当前。 |
| REQ-CORR-003 | **FAIL** | R2-F10：change_amount 可无新数量事实，补偿/营养一致性不可证明。 |
| REQ-CORR-004 | PASS | remove 仅单项且补偿成对。 |
| REQ-CORR-005 | PASS | void 禁单项目标并从有效聚合移除。 |
| REQ-CORR-006 | **FAIL** | R2-F11：非 change_time 可携带专属跨日 detail，operation 分派不封闭。 |
| REQ-CORR-007 | PASS | 内部引用与人类展示分离。 |
| REQ-CORR-008 | PASS | CAS/无环/重复补偿留边界 17/20。 |

## R2-7. 27 项 PASS 标准

汇总：**PASS 22 / FAIL 5**。

| # | 结果 | 第 2 轮独立结论 |
| ---: | --- | --- |
| 1 | PASS | 冻结身份/哈希/status_source 一致。 |
| 2 | PASS | 84 唯一且支撑 ID 未混入。 |
| 3 | **FAIL** | R2-F08/F10/F11 使 4 条需求仍存在直接语义缺口。 |
| 4 | PASS | Draft 2020-12 strict Ajv/formats 编译。 |
| 5 | PASS | 83 defs 且最低 44 全存在。 |
| 6 | PASS | 顶层恰 17、全部有根正例，正式事件不接收命令类型。 |
| 7 | PASS | command/lifecycle/Issue status 分离。 |
| 8 | PASS | CanonicalDecimal 与 known zero/unknown 一致。 |
| 9 | PASS | adopted range 生产约束及边界 2 已补齐。 |
| 10 | PASS | unknown time 不携带 resolved。 |
| 11 | PASS | Meal 顺序、whole/components、vague/missing 套餐分支闭合。 |
| 12 | **FAIL** | R2-F08 允许 Batch/Assessment 的同次修订原因矛盾。 |
| 13 | PASS | 包装 unknown 与任意位置表达正确。 |
| 14 | PASS | deducted/reversed/skipped 的 amount/allocation/方向闭合。 |
| 15 | PASS | 六 basis、五营养字段、双轴、来源/证据齐全。 |
| 16 | PASS | 动态来源及 registry 边界清楚。 |
| 17 | PASS | Issue/State/View 与 3/17/6 闭合。 |
| 18 | PASS | Resolution 7 outcome、失败边界、状态/effects 闭合。 |
| 19 | PASS | Quick 2–4、safe exit 和 operation 闭合。 |
| 20 | **FAIL** | R2-F10/F11：Correction operation/facts/detail 不封闭。 |
| 21 | PASS | 22 项跨对象/事务边界完整且没有 Ajv 夸大。 |
| 22 | PASS | 未提前复制 CommitResult/DailyProgress/Water/存储/学习模型。 |
| 23 | **FAIL** | R2-F09 是范围 guard 假阳性隔离，另缺三类新旁路反例。 |
| 24 | PASS | wrapper 拒绝伪 Node、错误协议/计数/依赖，退出码正确。 |
| 25 | **FAIL** | 精确 mutation 为 25/26，不满足复核包“每个 mutant 由对应隔离 case 杀死”。 |
| 26 | PASS | 旧规则冲突扫描为 0。 |
| 27 | PASS | 业务数据三时点均空，差异 0。 |

## R2-8. 旧规则与最终结论

未发现家庭成员/0.3 健康助手越界、只有明确在家才扣、附加异常反向阻断事实、unknown=0、同商品多批次一律歧义、物理覆盖/删除、mixed 全局回滚、`failed_storage` 持久化、safe exit→ignored 等旧规则复活。17 顶层范围未扩成 18；CommitResult、DailyProgress、Water、物理 JSONL/SQLite 与模板学习仍留给后续任务。

**第 2 轮 FAIL。** 真实 222 cases、84/17/83/44、精确枚举、全部稳定正向分支、真实 wrapper、伪 Node/依赖/协议/退出码故障和业务隔离通过；F-01/F-02/F-04/F-05/F-07 已关闭。但仍有 **1 高 + 3 中 + 1 低**：Batch/Assessment trigger 旁路（高）；F-03 mutation/fixture 未隔离、change_amount 空 supplied facts、非 change_time 携带 time_change（中）；per-100 尾零词法不一致（低）。复核包规定任一高/中、假阳性测试或直接非法状态仍可通过即不得 PASS。

下一轮只需在新的冻结哈希上逐项验证 R2-F08～R2-F11 的最小修复与反例，并再次执行全部 222+新增 cases、26 个精确 mutation、wrapper 恶意矩阵及业务三时点扫描；本轮结论不得跨哈希沿用。

---

# SH-MODEL-001 独立复核记录（第 3 轮）

> 复核日期：2026-08-09（Asia/Shanghai）  
> 身份：独立复核者；第 1、2 轮原文及其 FAIL 结论完整保留，本节只评价第 3 轮冻结候选。  
> 最终结论：**PASS**  
> 剩余阻断：**高 0 / 中 0 / 低 0**

## R3-1. 冻结身份、环境与业务隔离

### R3-1.1 冻结哈希

开始主体检查前独立执行 `Get-FileHash -Algorithm SHA256`；全部与第 3 轮复核包一致，未触发 `candidate_changed`。实施者报告只作为待核声明，不作为独立 PASS 依据。

| 项目 | SHA-256 | 结果 |
| --- | --- | --- |
| `docs/work-items/SH-MODEL-001-review-package.md` | `F0CBFD8ECB22E01D3F8FCFD8162B2E29ADBC75D3EC06407EF5A727FDF4A97FF8` | PASS |
| `docs/work-items/SH-MODEL-001-brief.md` | `070B92F4B64030BF3EAB9FB7FEE7341154ACDD2DE3F8F7C07AE743DFE8EDA49E` | PASS |
| `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` | PASS |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | PASS |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | PASS |
| `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` | PASS |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` | PASS |
| 本文件第 1、2 轮完整前缀 | `369D0BBA22EA36DA04198995AC7DCA45F831437D879CA95A97DA6771AF40BE4C` | PASS；追加前整文件哈希精确相等 |
| `shared/contracts/data-model.md` | `47B444636EFC003168880699BB537710D6541DBBEC3E7BF519500F3CD6F7836E` | PASS |
| `shared/schemas/domain.schema.json` | `49602D0F068AA3D161EF94117814835E7D1FF17333E49A13BFB723A577274DC0` | PASS |
| `shared/schemas/fixtures/domain-cases.json` | `958779A2525A7D5918209B20FB73D2A12CE4FE7D34A5A82E7B13C87DFB38F758` | PASS |
| `shared/tests/validate-domain-schema.mjs` | `C2491EFC384D88934A2D06C3D9608EF86EBB3609A6FF2983572610C30C97EDD4` | PASS |
| `shared/tests/validate-domain-schema.ps1` | `D1E85525B341F44EAD52D7B9DD82279B03532DAA7B85EEEB3AF32CD5031DD82F` | PASS |
| `docs/work-items/SH-MODEL-001-report.md` | `A765D811EA5052004CB1DAFFCF9DBA10D98937EEFC780BA6797F00EF91E6A47E` | PASS |

### R3-1.2 运行环境

| 项目 | 独立实测 |
| --- | --- |
| PowerShell | Windows PowerShell 5.1，权威命令用新进程 `-NoProfile -ExecutionPolicy Bypass` |
| Node | `v24.14.0`；路径 `C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`；SHA `63C259C81E5D472B5F11C8D506070130CB04A1ECF84B80377A34ED6EC9048088` |
| Ajv 2020 | Ajv 8.20.0；入口 SHA `908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A` |
| ajv-formats | 3.0.1；入口 SHA `3F3014150293846086D11058BB8BF43E669E354A98B37ADCF10281454D5E753B` |
| Schema dialect | Draft 2020-12；独立 `strict: true` 编译通过 |

### R3-1.3 业务数据三时点

递归扫描整个 `E:\codx\skill\饮食管家`（包含 `node_modules`），扩展名严格为 `.jsonl/.sqlite/.sqlite3/.db`，并以绝对路径、大小、SHA-256、UTC mtime 比较快照：

| 时点 | 文件数 | 与前一时点差异 |
| --- | ---: | ---: |
| 复核前 | 0 | 0 |
| 主体检查及外部临时探针清理后 | 0 | 0 |
| 写入本轮记录并终扫后 | 0 | 0 |

恶意业务变化探针只在已核准的系统临时目录创建 `probe.db`，wrapper 实测 `BUSINESS_BEFORE_COUNT=0 / AFTER_COUNT=1 / BUSINESS_DATA_CHANGED=1 / VERDICT=FAIL / exit=3`；探针和全部外部临时文件随后删除。候选、上游、计划及业务数据均未改动；本轮只追加本文件。

## R3-2. 独立机器复核

### R3-2.1 权威 wrapper 与独立 Ajv

按复核包命令显式指定冻结 Node、Ajv、formats，真实 wrapper 输出：

```text
NODE_RUNTIME_TRUST=trusted
NODE_VERSION=v24.14.0
SCHEMA_COMPILE=PASS
CASE_TOTAL=239
VALID_PASS=103/103
INVALID_PASS=136/136
CASE_FAILURE_COUNT=0
RUNNER_VERDICT=PASS
BUSINESS_BEFORE_COUNT=0
BUSINESS_AFTER_COUNT=0
BUSINESS_DATA_CHANGED=0
RUNNER_EXIT_CODE=0
VERDICT=PASS
OUTER_EXIT=0
```

另写只读、内存运行的独立 Ajv 驱动，未调用候选 mjs：

- `strict: true` 编译通过；`239=103 valid + 136 invalid`，fixture ID 重复 0，invalid 元数据缺失 0。
- 103 个正例逐一 `target=true/root=true`；136 个反例逐一 `target=false/root=false`。
- 136 个反例以与正式 runner 相同的 `$ref` wrapper 解析完整 schema ref；`keyword + schemaPath 后缀 + instancePath + 必要 params` 精确匹配 `136/136`。直接 `getSchema(fullRef)` 产生的局部 `#/...` 路径未被误计为候选失败。

### R3-2.2 84、17、96/44、枚举与稳定正向

| 检查 | 独立结果 |
| --- | --- |
| 84 追踪 | 从简报期望集合与模型追踪表重算：expected/actual/unique=`84/84/84`；缺失/额外/重复/支撑 ID 混入=`0/0/0/0` |
| 根分派 | `oneOf` 恰 17 个唯一顶层类型；每类均有目标与根同时为真的正例；无第 18 个类型 |
| `$defs` | 总数 96；简报最低 44 全存在；新增 13 个 Correction facts defs 是 12 个封闭分支加 1 个联合，不扩顶层职责 |
| Issue | kind/code/status=`3/17/6`，全部枚举精确 |
| Resolution | outcome=`7`，全部有目标+根正例 |
| Correction | operation=`12`，全部有对应 `fact_type` 目标+根正例 |
| safe exit | `defer/keep_unchanged/do_not_link` 恰 3；`ignored` 不在枚举 |
| 稳定正向 | InventoryMatch 5、Effect 9、Transaction 6、NutritionBasis 6、Issue code 17、IssueView 6、Resolution 7、Correction 12、QuickPrompt 长度 2/3/4 全覆盖 |

### R3-2.3 37 项精确 mutation

只对内存深克隆 Schema 变异，未写回冻结候选。原 26 项与新增 11 项均先验证原始反例失败、再要求 mutant 在 `strict: true` 下编译、最后由指定单因 case 杀死：

```text
MUTATION_BASELINE=37/37
MUTATION_STRICT_COMPILE=37/37
MUTATION_KILLED=37/37
ORIGINAL_26=26/26
ADDED_11=11/11
```

最初试写的 M01 变体用联合 `type` 导致 strict 编译失败，按规则未计 killed；改成 strict 合法的 `anyOf` 单点放宽后重新执行并被对应 number case 杀死。M04 只删 `plausible_min/plausible_max` 依赖而保留 `formula`，由“有 formula、无 range”单因 case 杀死；M36 只删 formula guard，由 formula-only case 杀死。opening 少报/多报、initial 组合防线、banana closure、operation/fact binding、非 time detail、safe whitelist、per100g/ml 尾零、amount 缺 reported quantity等新增项均 strict 编译并被各自 case 杀死。

### R3-2.4 恶意运行时与失败关闭

所有替身 fixture/runner 只放在项目外临时目录，执行后删除。候选 wrapper 本身未修改；需要到达特定内部分支时，只在内存副本重定向测试路径，最终候选哈希再验不变。

| 场景 | 独立观察 | 结果 |
| --- | --- | --- |
| 完整 239-PASS 协议伪 Node | 执行前 `NODE_RUNTIME_UNTRUSTED`，最终 FAIL，外层 2 | PASS |
| Node `--version` 返回 7 | 信任常量仅在内存重定向以到达该分支；`NODE_VERSION_FAILED:exit=7`，最终 FAIL，外层 2 | PASS |
| Ajv 路径不存在 | `AJV_2020_NOT_FOUND`，业务 0→0，外层 2 | PASS |
| Ajv/formats 跨树 | `AJV_DEPENDENCY_TREE_MISMATCH`，业务 0→0，外层 2 | PASS |
| 两套不同哈希 | `AJV_AMBIGUOUS:distinct_hash_pairs=2`，外层 2 | PASS |
| fixture 缺失 | `FIXTURES_NOT_FOUND`，外层 2 | PASS |
| fixture 非 JSON | JSON 解析失败，最终 FAIL，外层 2 | PASS |
| fixture `{}` 或 `cases=[]` | `FIXTURES_INVALID_SHAPE:cases must be a non-empty array`，外层 2 | PASS |
| runner 报 238、fixture 为 239 | `RUNNER_PROTOCOL_INVALID:field=CASE_TOTAL actual=238 expected=239`，外层 2 | PASS |
| runner 注入 `VERDICT` | `RUNNER_PROTOCOL_INVALID:runner must not emit wrapper VERDICT`，外层 2 | PASS |
| 合法 FAIL 协议退出 1/2 | wrapper 分别传播 1/2，最终均 FAIL | PASS |
| runner PASS 后写业务文件 | 业务变化优先，最终 FAIL，外层 3 | PASS |

## R3-3. 正式 F-01～F-07 与 R2-F08～F12 关闭

### R3-3.1 正式 F-01～F-07

| 发现 | 第 3 轮独立证据 | 状态 |
| --- | --- | --- |
| F-01 伪 Node 绕过 | 真实 Node 239/239；完整协议伪 Node 在执行前被路径+哈希信任钉死 | CLOSED |
| F-02 unknown 带 resolved | 合法 unknown 通过；unknown+resolved 目标/根均拒绝；时间顺序仍留边界 1 | CLOSED |
| F-03 adopted 无范围 | no-range-with-formula 与 formula-only 两单因反例均精确；M04/M36 分别被杀死 | CLOSED |
| F-04 QuickPrompt | 2/3/4 通过；1/5/无出口拒绝，长度错误不靠 contains 噪声；安全出口白名单精确 | CLOSED |
| F-05 Resolution 重校验 | 7 outcome 正例齐；revalidation、状态、applied/skipped effects 条件双向闭合 | CLOSED |
| F-06 批次修订 | 仍为 17 顶层；Batch/Assessment 追加版本、supersedes、trigger/evidence、评估链可表达；五 trigger 局部同集 | CLOSED；真实变化/链头留边界 7～9 |
| F-07 小数零 | skipped 接受 `0/0.0/0.00` 且拒非零；回退 `const:"0"` mutant 被杀死 | CLOSED |

### R3-3.2 R2-F08～F12

| 发现 | 第 3 轮独立证据 | 状态 |
| --- | --- | --- |
| R2-F08 trigger 矛盾 | `initial_stock_in/storage_revision/opening_revision/expiration_fact_revision/rule_revision` 五值逐一正例；每值 batch 多报与 assessment 多报共 10 个目标/根反例均拒绝。opening 两侧各由单 guard 拒绝；initial mismatch 明确是 forward-initial + reverse-storage 组合防线，未虚报单 guard | CLOSED |
| R2-F09 F-03 测试隔离 | 无 range case 含合法 formula，精确缺 min/max；formula-only case 精确缺 formula；两个单点 mutant 分别被杀死 | CLOSED |
| R2-F10 任意 supplied facts | 12 个 facts 分支各自 `additionalProperties:false`；12 operation 与 `fact_type` 一一绑定。12 正例通过；12 个错配、12 个 `banana`、12 个空对象目标/根均拒绝 | CLOSED |
| R2-F11 非 time 带 detail | change_time+detail 通过、缺 detail 拒绝；非 change_time+detail 由 `else/not` 目标/根拒绝 | CLOSED |
| R2-F12 per-100 尾零 | g/ml 均接受 `100/100.0/100.00/100.000`，拒绝 `50`；显式 string strict 编译；两个回退 const mutant 被杀死 | CLOSED |

## R3-4. 交叉闭合与 22 项语义边界

### R3-4.1 14 项交叉闭合

| # | 结果 | 第 3 轮独立结论 |
| ---: | --- | --- |
| 1 | PASS | OccurredTime unknown/resolved 互斥且真实格式生效；起止顺序未冒充 Ajv 保证。 |
| 2 | PASS | reported、nutrition-adopted、inventory-requested/applied、packaging 五类数量角色隔离；vague/unknown 正反分支齐全。 |
| 3 | PASS | InventoryMatch 五态；Effect/Transaction 正量、零效果、allocation 与方向双向闭合。 |
| 4 | PASS | 六种营养 basis、能量/质量/钠单位、来源/Profile/Snapshot 分离；per-100 尾零域一致。 |
| 5 | PASS | Issue 3 kind/17 code/6 status 有正例；只约束冻结依据支持的 blocking 子集，未发明 code-kind 全映射。 |
| 6 | PASS | IssueView 六态与 resolution/deferred/invalidated 字段双向互斥。 |
| 7 | PASS | Resolution 七 outcome、重校验、结果状态和 effects 条件闭合。 |
| 8 | PASS | Correction 十二 operation/facts、before、营养重算、remove/void 补偿和 time detail 排他闭合。 |
| 9 | PASS | EventVersion/EffectiveView 只接 committed Meal/Purchase 引用并使用 LocalDate。 |
| 10 | PASS | Batch 五 trigger 局部双向同集；真实字段变化/链真实性明确留后续验证器。 |
| 11 | PASS | QuickPrompt 2–4 且有出口；safe exit 只接受三值，拒绝 `ignored`、任意字符串和空白。 |
| 12 | PASS | 17 顶层及全部稳定状态/operation 正向覆盖，目标与根同时通过。 |
| 13 | PASS | 136 反例签名精确且根 false；103 正例目标与根均 true。 |
| 14 | PASS | 模型 §5 的 22 项跨对象真实性/版本图/事务/幂等边界完整，未夸称 Schema 已证明。 |

### R3-4.2 22 项后续验证器边界

以下均是“Schema 直接可验证范围与后续验证器职责划分正确”的 PASS，不表示候选已实现跨对象查询或事务验证器。

| # | 结果 | 边界复核 |
| ---: | --- | --- |
| 1 | PASS | 时间起止、时区支持与解析依据相容。 |
| 2 | PASS | range/vague 顺序、单位与 adopted 等于合理上界。 |
| 3 | PASS | reported/adopted/requested/applied/packaging 证据角色隔离。 |
| 4 | PASS | Match 引用真实性、候选与选择子集。 |
| 5 | PASS | allocation 合计及 effect/transaction 归属与方向。 |
| 6 | PASS | 余额非负、守恒、CAS、FEFO/FIFO。 |
| 7 | PASS | Batch/Assessment supersedes 无环与版本对应。 |
| 8 | PASS | 修订 trigger 对应真实变化、到期重评与旧依据保留。 |
| 9 | PASS | current batch/assessment projection 唯一选择链头。 |
| 10 | PASS | 营养数学及来源注册表存在、许可、优先级。 |
| 11 | PASS | 营养字段集合、单位、舍入与 whole/component 去重。 |
| 12 | PASS | Issue code-kind 仅作有冻结依据的语义检查。 |
| 13 | PASS | Issue 状态图与 IssueView 最新合法投影。 |
| 14 | PASS | Quick 引用/版本/组覆盖、ID 唯一与到期顺序。 |
| 15 | PASS | Resolution option/operation/facts/revalidation/effect 兼容。 |
| 16 | PASS | 改变事实的 Resolution 与 Correction 原子一致。 |
| 17 | PASS | Correction before/目标/CAS/无环/真实补偿/不重复返库；12 facts 仍需原话和旧快照支持。 |
| 18 | PASS | 新营养快照使用纠正事实；change_time facts 等于 after time，跨日恰含旧日与新日。 |
| 19 | PASS | committed refs 存在且 root/entity/version/current view 一致；新增 ID 不冲突。 |
| 20 | PASS | 幂等唯一、响应丢失复用与 mixed 子键稳定。 |
| 21 | PASS | 单事件事实、效果、营养、Issue、幂等与进度位于原子边界。 |
| 22 | PASS | 其余引用存在、类型/版本正确且不越隐私许可。 |

## R3-5. 84 条范围需求逐项结果

汇总：**PASS 84 / FAIL 0**。支撑 `REQ-TIME-* / REQ-QUICK-* / REQ-SAFE-*` 未混入 84 行；每行均复核对象/字段/局部不变量及必要的跨对象边界。

| Requirement | 结果 | 第 3 轮对象/字段/不变量结论 |
| --- | --- | --- |
| REQ-EVENT-001 | PASS | EventEnvelope 只分派 meal/purchase，命令不伪造正式对象。 |
| REQ-EVENT-002 | PASS | 删除由追加 void 表达，ignored 不冒充生命周期。 |
| REQ-EVENT-003 | PASS | Meal 根事实与库存/营养未决效果分离。 |
| REQ-EVENT-004 | PASS | 事件 ID、原话、来源、接收/提交时间和版本必填。 |
| REQ-EVENT-005 | PASS | 时间、规则与证据版本可追溯。 |
| REQ-EVENT-006 | PASS | 命令 outcome、记录 lifecycle、Issue status 不混用。 |
| REQ-EVENT-007 | PASS | 幂等唯一/返回原结果留边界 20。 |
| REQ-EVENT-008 | PASS | possible_duplicate 只提示，不自动合并。 |
| REQ-EVENT-009 | PASS | 输入顺序与逐事件边界已表达。 |
| REQ-EVENT-010 | PASS | 禁止 mixed 全局回滚旧规则。 |
| REQ-EVENT-011 | PASS | runner/wrapper 全程业务数据 0→0。 |
| REQ-EVENT-012 | PASS | failed 不成为持久事件/outcome。 |
| REQ-MEAL-001 | PASS | MealSlot raw/value/source 同存。 |
| REQ-MEAL-002 | PASS | explicit/inferred/unknown 来源精确。 |
| REQ-MEAL-003 | PASS | 餐次与 OccurredTime 独立。 |
| REQ-MEAL-004 | PASS | Meal items 非空且有序。 |
| REQ-MEAL-005 | PASS | 事实优先，附加不完整不阻断根事实。 |
| REQ-MEAL-006 | PASS | 可识别项目原名/身份可表达。 |
| REQ-MEAL-007 | PASS | 事件原话与 item 原名保留。 |
| REQ-MEAL-008 | PASS | 默认时间依据、锚点、原文与版本齐全。 |
| REQ-MEAL-009 | PASS | reported/adopted/requested/applied 角色隔离。 |
| REQ-MEAL-010 | PASS | vague/missing 仍可随事实保存并引用 Issue。 |
| REQ-MEAL-011 | PASS | adopted 直接要求 plausible range/basis/formula/evidence/rule。 |
| REQ-MEAL-012 | PASS | 字段证据齐全；相等/顺序明确在边界 2。 |
| REQ-MEAL-013 | PASS | 五类数量角色不互相代替。 |
| REQ-MEAL-014 | PASS | 无可信范围保持 unknown，不编数。 |
| REQ-MEAL-015 | PASS | 五种 Quantity 联合封闭。 |
| REQ-MEAL-016 | PASS | whole/components 互斥，去重留边界 11。 |
| REQ-MEAL-017 | PASS | 组件采用、模板、证据、规则版本可追溯。 |
| REQ-MEAL-018 | PASS | 不可变 Snapshot 与 Correction 新版本可表达。 |
| REQ-MEAL-019 | PASS | 根项目、unknown 营养与内容缺口 Issue 可并存。 |
| REQ-PANTRY-001 | PASS | 家庭默认匹配与扣减效果分开。 |
| REQ-PANTRY-002 | PASS | external 对应稳定 skipped 状态。 |
| REQ-PANTRY-003 | PASS | 用户明确不扣可持久化为 skipped_by_user。 |
| REQ-PANTRY-004 | PASS | 九种 effect 状态及 skipped 零效果闭合。 |
| REQ-PANTRY-005 | PASS | 多批 allocation 与产品 multiple 分离。 |
| REQ-PANTRY-006 | PASS | 用户指定批次策略/证据可表达。 |
| REQ-PANTRY-007 | PASS | FEFO/FIFO 留边界 6。 |
| REQ-PANTRY-008 | PASS | 多 BatchAllocation 原子合计留边界 5。 |
| REQ-PANTRY-009 | PASS | 到期选择证据与 expiration 分离。 |
| REQ-PANTRY-010 | PASS | CAS/余额非负守恒留边界 6。 |
| REQ-PANTRY-011 | PASS | Batch 原话、发生/接收/提交时间齐全。 |
| REQ-PANTRY-012 | PASS | 包装层级、初始量、推导量及证据隔离。 |
| REQ-PANTRY-013 | PASS | 初始事实与 BalanceView 分离，unknown≠0。 |
| REQ-PANTRY-014 | PASS | 来源/推导/规则/质量/Issue refs 齐全。 |
| REQ-PANTRY-015 | PASS | batch ID/version 支持独立批次与追加修订。 |
| REQ-PANTRY-016 | PASS | StorageAssignment 不硬编码位置，含来源/证据/规则。 |
| REQ-PANTRY-017 | PASS | Batch 与嵌入 Assessment 的 trigger 由五值双向约束为同集；真实变化留边界 8。 |
| REQ-PANTRY-018 | PASS | 关键不确定性与 QuickPrompt 可表达。 |
| REQ-PANTRY-019 | PASS | Assessment ID/version/trigger/锚点/时区/条件/规则齐全。 |
| REQ-PANTRY-020 | PASS | 到期 known/unknown 与最佳锚点封闭。 |
| REQ-PANTRY-021 | PASS | 动态剩余天数不落原始 Batch。 |
| REQ-PANTRY-022 | PASS | 追加链/评估链可表达，trigger 局部同集；无环、真实变化及当前链头留边界 7～9。 |
| REQ-PANTRY-023 | PASS | 保质评估不冒充安全保证。 |
| REQ-PRODUCT-001 | PASS | Product/Profile/Batch/余额分离。 |
| REQ-PRODUCT-002 | PASS | 历史身份与带版本 Profile 可复用。 |
| REQ-PRODUCT-003 | PASS | multiple 候选有证据且不强选。 |
| REQ-PRODUCT-004 | PASS | per100 Profile 与包装/批次数量分离。 |
| REQ-PRODUCT-005 | PASS | Profile 版本与不可变 Snapshot 保留旧引用。 |
| REQ-NUTR-001 | PASS | 来源优先/许可/适用性留注册表验证。 |
| REQ-NUTR-002 | PASS | source_id/registry_version 动态。 |
| REQ-NUTR-003 | PASS | 商品/标签/配方可带字段级证据。 |
| REQ-NUTR-004 | PASS | 身份/变体/来源版本防止静默套用。 |
| REQ-NUTR-005 | PASS | 五核心字段 known/unknown 与单位维度闭合。 |
| REQ-NUTR-006 | PASS | 字段 estimation_status 与明确量分离。 |
| REQ-NUTR-007 | PASS | Profile 历史版本与沿用证据可追溯。 |
| REQ-NUTR-008 | PASS | 模板规则证据可表达，未提前实现学习状态机。 |
| REQ-NUTR-009 | PASS | 公共来源与展示估算状态分离。 |
| REQ-NUTR-010 | PASS | basis/field evidence 保存采用值与依据。 |
| REQ-NUTR-011 | PASS | 字段估算与整体 completeness 双轴。 |
| REQ-ISSUE-001 | PASS | Issue 不等于写入失败。 |
| REQ-ISSUE-002 | PASS | QuickPrompt 可覆盖多个 Issue。 |
| REQ-ISSUE-003 | PASS | deferred/trigger/attention policy 追加表达。 |
| REQ-ISSUE-004 | PASS | Resolution 是独立追加对象。 |
| REQ-ISSUE-005 | PASS | applied 要求重校验；陈旧执行留边界 15。 |
| REQ-ISSUE-006 | PASS | invalidated 要求 invalidating ref。 |
| REQ-CORR-001 | PASS | Correction 追加且根事件保留。 |
| REQ-CORR-002 | PASS | Snapshot/View 分离历史与当前。 |
| REQ-CORR-003 | PASS | 12 facts 分支封闭且与 operation 一一绑定，补偿/营养真实性留边界 17/18。 |
| REQ-CORR-004 | PASS | remove 仅单项且补偿成对。 |
| REQ-CORR-005 | PASS | void 禁单项目标并从有效聚合移除。 |
| REQ-CORR-006 | PASS | change_time 必有且仅有 time_change；非 time operation 禁带 detail，跨日一致性留边界 18。 |
| REQ-CORR-007 | PASS | 内部引用与人类展示分离。 |
| REQ-CORR-008 | PASS | CAS/无环/重复补偿留边界 17/20。 |

## R3-6. 27 项 PASS 标准

汇总：**PASS 27 / FAIL 0**。

| # | 结果 | 第 3 轮独立结论 |
| ---: | --- | --- |
| 1 | PASS | 冻结身份、全部哈希、status_source 与复核角色一致。 |
| 2 | PASS | 84 唯一且支撑 ID 未混入。 |
| 3 | PASS | 84 条均有非空对象/字段/不变量映射，R2 的 4 条直接缺口已关闭。 |
| 4 | PASS | Draft 2020-12 strict Ajv/formats 编译。 |
| 5 | PASS | 96 defs 且最低 44 全存在，额外 defs 不扩顶层职责。 |
| 6 | PASS | 顶层恰 17、全部有根正例，正式事件不接收命令类型。 |
| 7 | PASS | command outcome、record lifecycle、Issue status 分离。 |
| 8 | PASS | CanonicalDecimal 与 known zero/unknown 一致。 |
| 9 | PASS | adopted range/formula 生产约束与后续相等/顺序边界齐全。 |
| 10 | PASS | unknown time 不携带 resolved，真实格式生效。 |
| 11 | PASS | Meal 顺序、whole/components、vague/missing 套餐分支闭合。 |
| 12 | PASS | Product/Packaging/Batch/Transaction/Balance 分离；五 trigger 局部同集。 |
| 13 | PASS | 包装 unknown 与任意位置表达正确。 |
| 14 | PASS | deducted/reversed/skipped 的 amount/allocation/方向闭合。 |
| 15 | PASS | 六 basis、五营养字段、双轴、来源/证据齐全。 |
| 16 | PASS | 动态来源及 registry 边界清楚。 |
| 17 | PASS | Issue/State/View 与 3/17/6 闭合。 |
| 18 | PASS | Resolution 7 outcome、失败边界、状态/effects 闭合。 |
| 19 | PASS | Quick 2–4、三值 safe exit 与 operation 闭合。 |
| 20 | PASS | Correction 12 operation/facts、before、补偿、营养与 time detail 局部闭合。 |
| 21 | PASS | 22 项跨对象/事务边界完整且没有 Ajv 夸大。 |
| 22 | PASS | 未提前复制 CommitResult/DailyProgress/Water/存储/学习模型。 |
| 23 | PASS | 103 正例目标+根通过；136 反例目标+根拒绝且错误签名精确。 |
| 24 | PASS | wrapper 拒绝伪 Node、版本/依赖/fixture/协议/计数故障，并正确传播 1/2 与业务优先码 3。 |
| 25 | PASS | 独立完成 239 cases、84/17/96/44、枚举、稳定分支及精确 mutation 37/37。 |
| 26 | PASS | 旧规则冲突扫描为 0。 |
| 27 | PASS | 业务数据三时点均空，最终差异 0。 |

## R3-7. 旧规则、新发现与最终结论

旧规则冲突扫描未发现：家庭成员/0.3 健康助手越界、只有明确在家才扣、附加异常反向阻断根事实、unknown=0、同商品多批次一律歧义、物理覆盖/删除、mixed 全局回滚、`failed_storage` 持久化、safe exit→`ignored` 等均未复活。范围仍为 17 顶层；CommitResult、DailyProgress、Water、物理 JSONL/SQLite 与模板学习状态机仍留给后续任务。

第 3 轮没有新增高、中或低严重度发现；正式 F-01～F-07、R2-F08～F12 及交叉 safe-exit 项全部以独立目标/根反例、稳定正例、精确 mutation 或恶意运行时证据关闭。跨对象真实性、比较、版本图、事务、幂等与当前投影仍按 22 项边界交给后续验证器，未将局部 Schema 通过夸称为端到端业务证明。

**第 3 轮 PASS。** 冻结哈希一致；真实与独立 Ajv 均为 `239/239`；追踪/根类型/defs 为 `84/17/96/44`；精确枚举与全部稳定正向通过；mutation `37/37` strict 编译且 `37/37` killed；真实 wrapper 和恶意运行时矩阵失败关闭；业务数据 `0→0→0`、最终差异 0。剩余高/中阻断为 **0/0**，满足复核包 PASS 门。
