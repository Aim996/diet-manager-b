---
contract_id: SCHEMA-v1
schema_id: https://diet-manager.local/schemas/domain.schema.json
status_source: 总功能开发计划0.2.md §22 唯一任务台账
plan_sha256: 45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B
business_contract_sha256: CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
receipt_date_contract_sha256: D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968
nutrition_registry_sha256: F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B
issue_correction_contract_sha256: 45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA
---

# SCHEMA-v1：饮食管家共同领域模型契约

## 1. 身份、边界与规范词

本文件把四份共同契约及唯一计划中的稳定业务语义翻译为 A/B/C 三条路线共享的逻辑对象。机器结构由 `shared/schemas/domain.schema.json` 定义；本文件补充 JSON Schema 无法独立证明的跨对象不变量。动态任务状态只来自总计划 §22，本文件不充当状态台账。

- **MUST（必须）**、**MUST NOT（不得）**、**SHOULD（应）**、**MAY（可以）**沿用上游共同契约的规范含义。
- 本模型只记录当前用户本人，不建立成员、家庭账号或健康助手对象。
- 本任务不冻结 JSONL 行、SQLite 表、列、索引、迁移、完整 `CommitResult`、`DailyProgressSnapshot`、Water/Hydration 内部结构或个人模板学习状态机。
- 顶层持久化对象由 `model_type` 分派；正式 `EventEnvelope` 只包裹已提交的领域事件。命令结果和 mixed 输入信封属于命令层，不得伪装成正式事件。

## 2. 三类数据及不可替代关系

| 类别 | 定义 | 典型字段/对象 | 修改方式 |
| --- | --- | --- | --- |
| 原始事实 | 用户、标签或外部资料直接提供的证据 | `source_text`、`raw_name`、`raw_text`、标签基准、购买原话 | 原值不可覆盖；更正追加新事件 |
| 推导值 | 规范化、时间解析、换算、匹配、模板、营养选择或保质评估 | `normalized_name`、`OccurredTime` 解析值、`NutritionSnapshot` 换算、`ExpirationAssessment` | 必须带字段级证据、规则版本和依据；新规则不得静默改史 |
| 投影视图 | 从已提交追加事件计算出的当前状态 | `InventoryBalanceView`、`IssueView`、`EffectiveEventView` | 可重建；不得覆盖源事件充当唯一事实 |

用户报告量、营养采用量、库存请求量、库存真实应用量和包装规格是五个独立角色。它们可以数值相同，但只有明确引用和可靠换算才能建立关系；一个角色的估算不得自动写入另一个角色。

## 3. 共同值对象

### 3.1 标识、版本和证据

- `StableId`：非空稳定字符串；当前不擅自限定 UUID。
- `VersionRef`：非空版本引用，用于 CAS、历史选择和来源版本。
- `RuleRef`：`rule_id + rule_version`。
- `ProvenanceEvidence`：证据 ID、证据种类、来源引用、采集时间、适用字段路径、可选采用值/依据和规则引用。证据种类区分用户明确、标签、历史确认、外部来源、系统规则和对话指代。
- `CanonicalDecimal`：规范十进制字符串；禁止 JSON number、指数、前导加号、本地化逗号、NaN、Infinity 和非法前导零。

### 3.2 known 与 unknown

`Measure` 是判别联合：

- `KnownMeasure` 必须为 `state=known + value + unit`；已知零合法。
- `UnknownMeasure` 必须为 `state=unknown + reason`，且不得携带 `value` 或 `unit`。
- `null`、空串、字符串 `"0"`、默认一份或默认单位都不得代表 unknown。

`Quantity` 用 `kind` 区分 `exact`、`approximate`、`range`、`vague`、`missing`。精确/近似量带已知 measure；range 带 min/max；vague 保存描述、可选合理范围和证据；missing 只保存缺失原因。任何推导量必须另存 adopted measure、换算公式、证据和规则版本。

`exact/approximate/range/vague` 的 `raw_text` 必须非空；只有真正的 `missing` 可以没有数量原话。`vague` 一旦采用营养上界，必须同时保存同单位的 `plausible_min/plausible_max`、`adopted_measure`、采用依据、显式采用公式、证据和规则；Schema 负责字段成组出现，领域验证器负责证明 `min <= max` 且 adopted 数值等于 max。

营养采用、库存请求和包装推导分别使用带固定 `role` 的 `NutritionAdoptedMeasure`、`InventoryRequestedMeasure`、`PackagingDerivedMeasure`。每个角色必须有自己的公式、证据和规则；不得因数值恰好相同就复用另一角色的推导证据。`unknown_combo` 只能保留 unknown 营养量和 Issue，不得携带组件展开、模板引用或伪造营养快照。

### 3.3 时间

`OccurredTime` 保存 `raw_text`、`resolved_start`、可选 `resolved_end`、`precision`、`timezone`、`resolution_basis`、`resolution_anchor` 和 `resolver_version`。`precision` 只允许 `exact/date/meal_period/approximate/unknown`；非 exact 不得用伪造 `00:00` 冒充精确时刻。相对时间的锚点是审计事实，不随当前时间漂移。`LocalDate` 使用真实 `format=date` 校验自然日，不以 `YYYY-MM-DD` 正则冒充日历有效性；它复用于纠错前后自然日及有效视图的受影响日期。

`precision=unknown` 时不得携带 `resolved_start/resolved_end`；已解析范围必须满足 start 不晚于 end。Schema 负责 unknown 的字段禁止与真实日期/时间格式，范围顺序、时区标识真实性和解析依据与原话相容性由语义验证器负责。

## 4. 对象目录与字段职责

### 4.1 正式事件

`EventEnvelope` 保存事件 ID、正式事件类型、版本、生命周期、原话、消息来源、接收/提交时间、Schema 版本和 payload。生命周期只允许 `active/corrected/voided`；`preview/committed/ignored/failed` 只属于命令结果，不进入生命周期。正式事件类型不包含 query、ignore 或 mixed。

`MealEvent` 保存发生时间、餐次（原文、规范值、来源）、用餐上下文和有序 `items[]`。`MealItem` 保存原始/规范名称、食品类型、reported/nutrition/inventory-request 数量角色、整项或组件营养模式、组件、产品/模板引用、营养快照引用和库存效果引用。`DishComponent` 具有自己的名称、数量角色和证据；`nutrition_mode` 保证整菜与组件只选其一。

`PurchaseEvent` 保存购买/制作/入库时间、输入顺序和批次引用。购买事件只陈述已发生事实；每个实际入库批次独立存在。

### 4.2 商品和批次

`ProductIdentity` 是长期身份，保存原名、规范名、类型、品牌、变体、已确认别名、包装变体引用、营养档案引用、状态及证据；不得保存批次余额。`PackagingVariant` 保存外层/内层包装、单件规格、换算和证据，不是一次购买。

`InventoryBatch` 是一次实际入库事实，保存商品/包装引用、原话、购买或制作时间、接收/提交时间、初始数量、包装层级、位置、开封状态、保质评估、资料质量、问题引用和规则证据。根对象的 `opening_state` 只允许入库事实可证明的 `sealed/opened/unknown`，不得用 `depleted` 把当前余额状态写回初始事实；当前耗尽由交易与 `InventoryBalanceView` 投影表达，不删除商品或营养档案。

位置、开封和保质修订不增加第十八个顶层 `model_type`。同一 `batch_id` 通过追加 `InventoryBatch.batch_version` 形成版本链：初始版只能用唯一的 `initial_stock_in` trigger 且不得有 `supersedes_batch_version`；后续版必须引用被替代版本，并用 `storage_changed/opening_changed/expiration_fact_changed/rule_reassessment` 说明原因和证据。修订版不得改写原始入库身份、初始数量或原话，只能追加新的当前事实版本。

`StorageAssignment` 保存非空规范位置、证据来源和规则版本，不硬编码三值全集。`ExpirationAssessment` 保存稳定 assessment ID、版本、被替代版本、重评 trigger、依据优先级、锚点、到期值或 unknown、时区、存放条件、估算标记及规则版本；动态剩余天数不是原始批次字段。同一 `InventoryBatch` 版本的 `revision_triggers` 与嵌入评估的 `assessment_triggers` 必须是完全相同的集合：`initial_stock_in/storage_changed/opening_changed/expiration_fact_changed/rule_reassessment` 中任一值在一侧出现，当且仅当也在另一侧出现；不得少报、多报或把初始入库与修订原因混写。`InventoryBalanceView.current_batch_state` 只投影唯一批次链头的位置、开封状态和当前评估引用，旧 Batch 与旧 Assessment 必须继续可查。

### 4.3 库存匹配、效果、交易和余额

`InventoryMatch` 保存 `unique/multiple/none/insufficient/unconvertible`、候选商品、选定商品、证据和规则。五种状态具有封闭结构：unique 恰有一个候选商品、一个 matched 商品和非空候选/选中批次；multiple 至少两个商品候选但不选商品/批次；none 的候选和选择均空；insufficient/unconvertible 只识别一个商品和候选批次但不声称已选中可扣批次。相同商品的多个批次通过 `BatchAllocation[]` 表达，不成为不同商品 `multiple`。

`InventoryEffect` 保存来源事件/项目、match、请求量、真实应用量、状态、批次分配和规则。状态只允许 `deducted`、七种稳定 skipped 状态及 `reversed`。`deducted` 必须有非空 allocation 和正的已知 applied amount；skipped 必须有零真实应用量且 allocation 为空。`BatchAllocation` 只引用同一商品的实际批次和已知量。

`InventoryTransaction` 是追加式入库、扣减、返还、盘点、丢弃或退货事务，保存 effect/batch 引用、正的已知差量、事务版本和时间。`stock_in/return` 方向只能 increase，`deduction/discard/refund` 只能 decrease，`adjustment` 可双向；方向合法不等于算术已经被 Schema 证明。`InventoryBalanceView` 是按批次投影的当前已知或 unknown 余额及截至事务版本；它不是原始入库事实。

### 4.4 营养

`NutritionSourceReference` 必须同时保存 `source_id` 与 `registry_version`，并可带来源记录版本、获取时间和匹配范围。Schema 只校验结构；来源存在性、许可和优先级由注册表验证器负责。

`NutritionBasis` 区分 `per_100g/per_100ml/per_serving/per_item/per_package/custom`，并保存正的基准量、单位、份名、每包装份数及换算证据；`per_100g` 必须在数值上恰为 `100 g`，`per_100ml` 必须在数值上恰为 `100 ml`。在当前 CanonicalDecimal 合法域内，数值 100 的等价词法 `100`、`100.0`、`100.00` 及更多纯尾零均接受，其他数值仍拒绝。`NutrientField` 是字段级 known/unknown 联合；known 值带单位、证据和估算状态，unknown 带原因。能量单位只允许 `kcal/kJ`，蛋白质、脂肪、碳水和纤维使用 `g`，钠使用 `mg`；钠在来源提供时保存。

`NutritionProfile` 是可版本化资料，保存 profile/version、适用商品或食物、来源、基准、六字段容器、完整度轴和估算轴、内容摘要、创建时间及上代引用。`NutritionSnapshot` 是一次摄入采用的不可变计算结果，保存 profile/version、来源、消费量、换算公式、原始值、舍入值、舍入规则、字段集合、两轴覆盖状态、内容摘要及创建时间。舍入值只用于展示，不回流累计。

### 4.5 Issue、解决与快捷提示

`Issue` 是不可变发现事实，保存版本、三类 kind、十七种稳定 code、实体/字段、已知与缺失事实、影响、允许解决、注意策略、发现时间和规则。状态变化通过 `IssueStateEvent` 或 `IssueResolutionEvent` 追加。`IssueView` 派生当前六状态，并按终态要求引用 resolution、invalidating event 或 deferred trigger。

冻结契约没有给出完整的十七 code→唯一 kind 映射，Schema 不得自行发明整张表。能由现有事实边界证明的最小规则是：`unconvertible_unit/ambiguous_inventory_match/insufficient_inventory/missing_nutrition/partial_nutrition/missing_expiration` 不得标为 blocking；其余 code 的上下文分类由领域验证器按“核心事实是否真的不能安全形成”判断。`IssueView` 的 resolution、deferred 和 invalidating 字段互斥：open/offered 不得带三者，deferred 只带 deferred 条件，resolved/dismissed 只带 resolution，invalidated 只带 invalidating event。

`IssueResolutionEvent` 保存组、Issue/CAS 版本、prompt/option、补充事实、原话、操作、重校验版本、七种可持久 outcome、应用/跳过效果、结果状态、幂等键和时间。所有已持久 outcome 必须至少记录一个重校验版本；`applied/deferred/dismissed` 分别只能得到 `resolved/deferred/dismissed`，其中 deferred/dismissed 不得声称 applied effects；四种 `rejected_*` 只能保持 `open/offered/deferred` 且 applied effects 必须为空，不得伪装成 resolved、dismissed 或 invalidated。`failed_storage` 只能是未持久化命令错误，绝不是此事件 outcome。

`QuickPrompt` 保存 Issue 集、生成版本、2–4 个选项、规则、生成/到期时间，且至少包含一个 `safe_exit`。`QuickOption` 保存 effect/non-effect 摘要、受影响 Issue、冲突组、操作和值；`safe_exit` 的 operation 只允许 `defer/keep_unchanged/do_not_link`，分别表示延后、保持当前事实或明确不关联库存。任意字符串、空白和命令结果 `ignored` 都不是安全出口。UI 固定文案不复制为领域事实。自由文本和按钮最终都解析为同一结构化操作；每个冲突组都有出口、option ID 唯一和到期顺序属于跨对象/集合语义。

### 4.6 Correction 与有效视图

`CorrectionEvent` 保存根/目标事件、可选目标项目、目标 CAS 版本、十二种 operation、封闭的 before snapshot、封闭的补充事实、原话、库存补偿、营养重算、受影响自然日、结果版本、幂等键和时间。`CorrectionSuppliedFacts` 是带 `fact_type` 的十二分支判别联合，且 `fact_type` 必须与 operation 相同：数量复用 `Quantity`，时间复用 `OccurredTime`，餐次复用 `MealSlot`，组件/新增项目复用 `DishComponent/MealItem`，库存关联复用 `InventoryMatch`，营养来源复用 `NutritionSourceReference`；名称、类型和单位使用各自最小封闭字段，remove/void 只允许稳定判别器。空对象、任意键和另一 operation 的载荷都必须拒绝。`CorrectionBeforeSnapshot` 必须引用被纠正的不可变 `EventVersionSnapshot`，不得塞入未定义的松散字段。`InventoryCompensation.actual_effect_refs[]` 只能引用历史真实应用过的效果，`compensation_effect_refs[]` 引用本次追加的反向/替代效果，`mode` 固定为 `actual_effect_delta`；禁止用预览量或期望扣减量生成返还。remove/void 若任一侧存在实际效果引用，另一侧也必须非空；两侧均空只表示历史没有真实库存效果。

`NutritionRecalculation.required=false` 时 `snapshot_refs` 必须为空；`change_amount/change_unit/change_item_name/change_item_type/change_components/add_item/remove_item/change_nutrition_source` 必须 `required=true` 并引用至少一个不可变新 Snapshot。`remove_item` 必须有单项目标；`void_event` 禁止单项目标。只有 `change_time` 可以且必须携带 `time_change`，其他十一种 operation 均禁止该专属字段；`change_time` 还必须保存变更前后的完整 `OccurredTime` 解析事实以及旧、新自然日。Schema 校验局部结构，supplied facts 与原话/目标快照的真实性、facts 中新时间等于 `time_change.after_time`、旧日和新日均出现在 `affected_local_dates[]` 等由跨对象验证器保证。

`EventVersionSnapshot` 保存某根事件某版本的不可变 `event_ref/event_version`、项目引用、营养快照引用、库存效果引用、生命周期、提交时间和内容摘要。`event_ref` 与 `EffectiveEventView.effective_event_ref` 都使用 `CommittedEventVersionRef`，只允许 `meal_event/purchase_event`，不得引用 preview、Correction、Issue 或命令结果。`EffectiveEventView` 保存某根事件当前生效版本快照、带版本的事件引用、生命周期、受影响自然日、投影新鲜度和计算时间。`preview/failed/ignored` 与被替代版本不会成为当前有效版本；整条 void 后仍保留 `lifecycle=voided` 的有效视图供审计和重建，但汇总器不得把该版本的饮食、营养或库存贡献计入当前结果。

## 5. Schema 能力边界

JSON Schema Draft 2020-12 直接负责：单对象必填、类型、判别联合、枚举、数值字符串格式、unknown 禁止字段、条件必填/禁止、数组非空/为空、未声明属性拒绝和顶层 `model_type` 分派。

JSON Schema 不声称独立证明下列比较、引用真实性、版本图或事务语义；这些必须由领域验证器、事务层或存储约束执行并由案例验证：

1. `OccurredTime.resolved_start <= resolved_end`，timezone 是受支持的 IANA/offset，解析依据与原话/锚点相容。
2. range 与 vague 的同单位 `min <= max`；采用上界时 adopted 与 plausible max 数值相等，公式、证据和规则实际支持该采用。
3. 营养采用、库存请求和包装推导的证据角色隔离；任何跨角色转换都有显式可靠公式，unknown 不被旁路成默认量。
4. InventoryMatch 的 matched/候选/选中 ID 真实存在、属于同一商品，selected 是 candidate 子集；同商品多批次不被误判成商品 multiple。
5. allocation 引用真实可用批次、单位可换算，合计恰等于真实 applied amount；deducted/reversed 与对应 transaction 的方向、数量和 effect 引用一致。
6. 交易前后余额满足差量算术且永不为负；用户指定→FEFO→FIFO 顺序、过期批次跳过及并发 CAS 正确。
7. Batch/ExpirationAssessment 的 supersedes 引用同一稳定 ID 的真实前版，版本严格前进、无环、无分叉且只有一个链头；Schema 已保证同对象内两侧 trigger 集合完全相同，领域验证器仍须证明每个 trigger 对应真实字段变化而非自报字符串。
8. 批次 revision 不新建 stock-in 或改写初始数量；新评估实际使用修订后位置/开封事实，`expires_at > anchor_at`，旧版本完整保留。
9. `InventoryBalanceView.current_batch_state` 与唯一 Batch/Assessment 链头完全一致；余额只由 InventoryTransaction 投影，不由位置/保质修订改变。
10. NutritionBasis 的 serving/package/density 换算数学正确；来源存在、许可、优先级和 registry/source 版本匹配。
11. known/missing/estimated 字段集合与 NutrientField 一致，能量/质量单位换算正确，整菜/组件不重复计入，rounded 不回流累计。
12. Issue 引用实体存在、field path 有效、facts/impact/code/kind/allowed resolution 与上下文相容；Schema 的最小不得-blocking 集合不冒充完整分类政策。
13. IssueStateEvent 转换符合允许图，终态不重开；IssueView 由同一 Issue 的最新合法事件投影，resolution/invalidating 引用的 outcome 与状态一致。
14. QuickPrompt 的 issue/target/option 引用存在且版本当前；option ID 唯一，每个 conflict group 都有 safe exit，affected Issue 覆盖正确，`generated_at < expires_at`。
15. Resolution 的 selected option、operation、supplied facts 和 allowed resolution 一致；revalidated refs 存在且仍当前，rejected 原因真实成立，applied/skipped effect 归属正确。
16. 改变事实的 Resolution 与 Correction 位于同一事务；审计存储失败时二者和所有业务效果均不得持久化。
17. Correction before snapshot 存在且属于目标版本，CAS 当前；resulting version 前进且链无环。每个 operation 的 supplied facts 由 `source_text` 和目标事实真实支持并实际进入结果快照；库存匹配、营养来源及新增 ID 的引用存在、版本当前且不冲突。remove/void 的补偿引用真实历史扣减、反向/替代成对、不会重复返库，返还不超过真实扣减。
18. NutritionRecalculation 的新 Snapshot 确实使用纠正后事实；`change_time` 的 facts 时间等于 `time_change.after_time`、before 来自旧快照，跨日受影响日期同时且仅一次包含旧日与新日。
19. EventVersionSnapshot/EffectiveEventView 的 committed-event 引用存在，entity/root/version 相互一致；有效视图指向唯一当前版本快照，被替代或命令态对象不得成为当前版本。
20. 幂等键唯一；响应丢失返回原结果；mixed 子键稳定且不重演。
21. 单事件的事实、真实或跳过效果、营养、Issue、幂等和最终进度引用位于一个原子边界。
22. 所有其他对象引用存在、类型正确、版本匹配且未越过隐私/许可边界。

## 6. 生命周期、版本和保留

- 正式领域对象只代表可证明已提交的数据；未提交命令不伪造事件 ID。
- 根事件、Issue、Resolution、Correction、营养快照和库存交易只追加。投影视图可重建，不是审计历史的唯一副本。
- 同一批次的位置/开封/保质修订以 Batch 与 Assessment 追加版本链表达；当前投影只选唯一链头，旧版本不得覆盖或删除。
- 商品身份、别名和营养档案跨库存批次保留；耗尽批次仍可审计。
- Profile 更新创建新版本；历史 Snapshot 始终引用提交时版本和内容摘要。
- 逻辑模型使用 `schema_version`/对象版本支持未来迁移；物理映射与迁移顺序由后续存储契约定义。

## 7. 隐私和日志边界

原话和外部请求所需字段分离。外部营养请求只能从规范食物/商品名、品牌、变体、规格、生熟状态和最小类别构造；不得发送整段原话、日期餐次、库存位置、Issue 或完整数据库。诊断日志只引用稳定 ID、错误码、Schema/规则版本和必要技术上下文，不输出原话、访问密钥或数据转储。

## 8. 被禁止的旧语义

以下不得复活：只有明确在家才读库存；用营养估算量直接扣库存；数量不清令已发生饮食消失；多候选或库存不足使根事实失败；unknown 写为零/空串/null/默认一份；同商品多批次视为多个商品；原地改 Issue/status/余额/纠错；批次耗尽删除商品或 Profile；新营养来源改写旧快照；`failed_storage` 持久化为解决事件；remove item 等同整条 void；query/ignore/mixed 进入正式事件联合；把动态进度、Water 细节或模板学习状态机提前塞入本模型。

## 9. 84 条规范性需求追踪表

本表只收录本模型任务范围的 84 个 ID；每行指向上文的实际字段或跨对象不变量。时间、快捷选项和安全规则作为支撑约束体现在正文，但不另增范围行。

| 需求 ID | SCHEMA-v1 字段或不变量 |
| --- | --- |
| REQ-EVENT-001 | §4.1 `EventEnvelope` 正式事件联合 |
| REQ-EVENT-002 | §4.6 `CorrectionEvent.operation=void_event`；§8 禁止 ignore 代替 void |
| REQ-EVENT-003 | §4.1 根事实与 §4.3/§4.4 附加效果分离；§5 原子边界 |
| REQ-EVENT-004 | §4.1 事件 ID、原话、来源、接收/提交时间和 Schema 版本 |
| REQ-EVENT-005 | §3.1 `ProvenanceEvidence/RuleRef`；§4 各推导引用 |
| REQ-EVENT-006 | §4.1 生命周期枚举与命令结果分离 |
| REQ-EVENT-007 | §4.5/§4.6 幂等键；§5 幂等唯一不变量 |
| REQ-EVENT-008 | §4.5 `possible_duplicate` Issue；§5 不自动合并 |
| REQ-EVENT-009 | §1 mixed 仅命令信封；§5 稳定有序子键 |
| REQ-EVENT-010 | §5 per-event 原子与有序 mixed 不变量 |
| REQ-EVENT-011 | §1 物理写入范围边界；§7 测试不得接触业务数据 |
| REQ-EVENT-012 | §6 仅可证明提交的数据成为领域对象 |
| REQ-MEAL-001 | §4.1 `MealEvent.meal_slot` 原文、值和来源 |
| REQ-MEAL-002 | §4.1 餐次来源区分用户明确与系统推断 |
| REQ-MEAL-003 | §3.3 `OccurredTime` 与 §4.1 餐次独立 |
| REQ-MEAL-004 | §4.1 一个 MealEvent 的有序 `items[]` |
| REQ-MEAL-005 | §4.1 正式 MealEvent 代表已发生摄入 |
| REQ-MEAL-006 | §4.1 `items` 非空且 `raw_name` 非空 |
| REQ-MEAL-007 | §4.1 `source_text` 与 `MealItem.raw_name` |
| REQ-MEAL-008 | §3.3/§4.1 `OccurredTime` 及默认时间依据 |
| REQ-MEAL-009 | §3.2 known/unknown 联合及数量角色独立 |
| REQ-MEAL-010 | §3.2 vague/missing Quantity；§4.5 Issue 引用 |
| REQ-MEAL-011 | §3.2 vague 合理范围及 adopted measure |
| REQ-MEAL-012 | §3.1 字段级证据、依据和规则版本 |
| REQ-MEAL-013 | §2 五类数量角色不可替代 |
| REQ-MEAL-014 | §3.2 无可信范围保持 unknown |
| REQ-MEAL-015 | §3.2 exact/approximate/range/vague/missing 联合 |
| REQ-MEAL-016 | §4.1 `nutrition_mode` 整项/组件互斥 |
| REQ-MEAL-017 | §4.1 组件采用量、模板引用、证据和版本 |
| REQ-MEAL-018 | §4.4 不可变 Snapshot；§4.6 新版本和营养重算 |
| REQ-MEAL-019 | §4.1 unknown 组合可保留根条目；§4.5 内容缺口 Issue |
| REQ-PANTRY-001 | §4.1 用餐上下文；§4.3 默认库存效果可表达 |
| REQ-PANTRY-002 | §4.1 external/delivery context；§4.3 `skipped_external` |
| REQ-PANTRY-003 | §4.1 skip-inventory context；§4.3 `skipped_by_user` |
| REQ-PANTRY-004 | §4.3 九种稳定库存效果状态 |
| REQ-PANTRY-005 | §4.3 同商品多批次以 allocations 表达 |
| REQ-PANTRY-006 | §4.3 match/allocation 证据支持用户指定批次 |
| REQ-PANTRY-007 | §5 FEFO/FIFO 跨对象选择不变量 |
| REQ-PANTRY-008 | §4.3 `BatchAllocation[]` 跨批次原子分配 |
| REQ-PANTRY-009 | §4.2 到期评估及 §5 过期批次选择不变量 |
| REQ-PANTRY-010 | §5 库存 CAS、余额非负和分配合计不变量 |
| REQ-PANTRY-011 | §4.1 PurchaseEvent 与 §4.2 Batch 的时间/来源字段 |
| REQ-PANTRY-012 | §3.2/§4.2 外层、内层、单件和推导总量分离 |
| REQ-PANTRY-013 | §3.2 unknown 不等于零；§4.3 BalanceView 分离 |
| REQ-PANTRY-014 | §3.1 证据/规则；§4.2 数据质量和 Issue 引用 |
| REQ-PANTRY-015 | §4.2 每次入库独立 Batch；§6 跨批次保留身份 |
| REQ-PANTRY-016 | §4.2 StorageAssignment 位置、来源与规则版本 |
| REQ-PANTRY-017 | §4.2 当前位置投影可被自然语言 Correction 更新 |
| REQ-PANTRY-018 | §4.5 仅关键不确定性生成 QuickPrompt |
| REQ-PANTRY-019 | §4.2 ExpirationAssessment 锚点、时区、条件、估算和版本 |
| REQ-PANTRY-020 | §4.2 到期值显式 known/unknown 并保留最有价值锚点 |
| REQ-PANTRY-021 | §4.2 动态剩余天数不是原始 Batch 字段 |
| REQ-PANTRY-022 | §4.2 评估版本追加、当前视图重算和旧依据保留 |
| REQ-PANTRY-023 | §4.2 保质评估语义不等同食品安全保证 |
| REQ-PRODUCT-001 | §4.2 Product/Profile/Batch 分离；§6 耗尽不删除 |
| REQ-PRODUCT-002 | §4.2 Product 的历史 Profile 引用与匹配证据 |
| REQ-PRODUCT-003 | §4.2 品牌/变体/规格字段；§4.3 multiple match |
| REQ-PRODUCT-004 | §4.2 PackagingVariant 与 §4.4 density basis 分离 |
| REQ-PRODUCT-005 | §4.4 Profile 新版本及历史 Snapshot 引用 |
| REQ-NUTR-001 | §4.4 SourceReference；§5 注册表优先级不变量 |
| REQ-NUTR-002 | §4.4 公共来源引用可用于基础食品 |
| REQ-NUTR-003 | §4.4 精确商品、标签或配方来源可追溯 |
| REQ-NUTR-004 | §4.4 Profile 适用商品/变体范围和内容摘要 |
| REQ-NUTR-005 | §4.4 六字段 known/unknown 与完整度轴 |
| REQ-NUTR-006 | §4.4 字段级估算状态区分 explicit/none |
| REQ-NUTR-007 | §4.4 Profile/version 历史复用引用 |
| REQ-NUTR-008 | §4.1 稳定 `template_ref`；不提前建学习状态机 |
| REQ-NUTR-009 | §4.4 公共库来源详情可追溯 |
| REQ-NUTR-010 | §4.4消费量、公式、原始值和字段级证据 |
| REQ-NUTR-011 | §4.4 `completeness` 与 `estimation_status` 双轴 |
| REQ-ISSUE-001 | §4.5 Issue 与命令失败分离，关联已提交根事实 |
| REQ-ISSUE-002 | §4.5 一个 QuickPrompt 可引用多个 Issue |
| REQ-ISSUE-003 | §4.5 attention policy、deferred trigger 和状态事件 |
| REQ-ISSUE-004 | §4.5 追加 IssueResolutionEvent |
| REQ-ISSUE-005 | §4.5 expected/revalidated versions |
| REQ-ISSUE-006 | §4.5 invalidating event 引用；§4.6 void 版本 |
| REQ-CORR-001 | §4.6 CorrectionEvent 追加且根事件保留 |
| REQ-CORR-002 | §4.6 EventVersionSnapshot/EffectiveEventView 分离 |
| REQ-CORR-003 | §4.6 真实库存补偿与新营养快照引用 |
| REQ-CORR-004 | §4.6 `remove_item` 必须有单项目标 |
| REQ-CORR-005 | §4.6 `void_event` 禁止单项目标并改变生命周期 |
| REQ-CORR-006 | §4.6 `affected_local_dates[]`；§5 跨日不变量 |
| REQ-CORR-007 | §4.6 纠错目标内部引用与展示投影分离 |
| REQ-CORR-008 | §4.6 CAS 版本；§5 无环、无重复补偿不变量 |
