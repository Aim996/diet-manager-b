# SH-MODEL-001 SCHEMA-v1 核心领域模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Schema 和验证器必须采用 RED→GREEN 顺序，步骤使用本文件的检查清单跟踪；动态任务状态只写总计划 §22。

**Goal:** 把四份已冻结共同契约和总计划中的 84 条任务范围需求翻译为跨 A/B/C 路线一致、可由 JSON Schema Draft 2020-12 验证、且不把 unknown 变成 0 的 `SCHEMA-v1` 核心领域模型。

**Architecture:** `shared/contracts/data-model.md` 定义对象职责、原始事实/推导值/聚合视图区分和 JSON Schema 无法表达的跨对象不变量；`shared/schemas/domain.schema.json` 使用单一 Draft 2020-12 文档、`$defs` 和带 `model_type` 的顶层 `oneOf` 分派机器对象。测试先以手工正反例描述边界，再使用真实 Ajv 2020 编译并验证 Schema；PowerShell 包装器对项目内 `.jsonl/.sqlite/.sqlite3/.db` 做前后快照，测试不得调用任何路线写入器。

**Tech Stack:** JSON Schema Draft 2020-12；JSON；Markdown；Node.js ESM；Ajv 8（2020 模式）；PowerShell 5.1+。

## Global Constraints

- 权威任务状态只来自 `总功能开发计划0.2.md` §22；本简报、契约、Schema、报告和测试不得自称任务已完成。
- 当前没有 Git 仓库；不得伪造 commit。交付以冻结 SHA-256、独立复审和 `EV-*` 证据为准。
- 只记录本人；不得引入成员、家庭账号或 0.3 健康助手模型。
- 已发生且可识别的饮食事实优先；库存/营养附加效果异常不得让根事实消失。
- 未明确外食/非家中/不扣时默认允许尝试家庭库存；营养估算量不得自动成为库存扣减量。
- 正式领域事件只代表已 `committed` 的事件；`preview/ignored/failed/query/mixed` 属命令或信封层，不得伪装成正式账本事件。
- 命令结果、事件生命周期和 Issue 状态是三组不同状态，不得共用字段或枚举。
- 业务关键数值使用规范十进制字符串或整数最小单位；不得使用 JSON number 承载库存、数量或营养累计值。
- unknown 必须是显式分支或字段缺失；不得用数值 0、字符串 `"0"`、空串、`null`、默认一份或默认单位代替 unknown。已知零必须可与 unknown 区分。
- 所有推导/估算字段都要有字段级证据、规则版本和换算依据；原话不得被规范名或估算值覆盖。
- NutritionProfile 与 NutritionSnapshot 分离；Snapshot 不可变，来源更新不得改写历史。
- Issue、Resolution、Correction、void、库存效果和营养快照均追加式；当前状态/余额是投影视图，不是覆盖原事件的事实。
- `DailyProgressSnapshot`、完整 `CommitResult` 和 Water/Hydration 内部结构留给 `SH-MODEL-002`；本任务只定义稳定引用。
- JSONL 文件/SQLite 表列、索引、迁移和物理事务映射留给 `SH-MODEL-003`；本任务只冻结无损逻辑语义。
- Product 个人模板完整学习状态属于 PRODUCT-0.2；本任务至多允许稳定 `template_ref`，不得提前实现学习状态机。
- 验证、构建和文档处理不得创建或修改任何 `.jsonl`、`.sqlite`、`.sqlite3`、`.db` 正式业务数据；前后路径、大小、SHA-256、UTC mtime 必须一致。

---

## 1. 冻结输入

实施开始前逐文件核验；任一哈希不符即停止并报告 `upstream_changed`，不得静默适配：

| 文件 | SHA-256 |
| --- | --- |
| `总功能开发计划0.2.md` | `45D7659F8B9414F90D25A649B11DA69BDFFDCA85E7B3E3F680E8C0FD9078B16B` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` |

## 2. 任务范围：84 条需求

规范性追踪表必须且只能包含以下 84 个 ID，每个恰出现一次：

- EVENT 12：`REQ-EVENT-001`、`REQ-EVENT-002`、`REQ-EVENT-003`、`REQ-EVENT-004`、`REQ-EVENT-005`、`REQ-EVENT-006`、`REQ-EVENT-007`、`REQ-EVENT-008`、`REQ-EVENT-009`、`REQ-EVENT-010`、`REQ-EVENT-011`、`REQ-EVENT-012`
- MEAL 19：`REQ-MEAL-001`、`REQ-MEAL-002`、`REQ-MEAL-003`、`REQ-MEAL-004`、`REQ-MEAL-005`、`REQ-MEAL-006`、`REQ-MEAL-007`、`REQ-MEAL-008`、`REQ-MEAL-009`、`REQ-MEAL-010`、`REQ-MEAL-011`、`REQ-MEAL-012`、`REQ-MEAL-013`、`REQ-MEAL-014`、`REQ-MEAL-015`、`REQ-MEAL-016`、`REQ-MEAL-017`、`REQ-MEAL-018`、`REQ-MEAL-019`
- PANTRY 23：`REQ-PANTRY-001`、`REQ-PANTRY-002`、`REQ-PANTRY-003`、`REQ-PANTRY-004`、`REQ-PANTRY-005`、`REQ-PANTRY-006`、`REQ-PANTRY-007`、`REQ-PANTRY-008`、`REQ-PANTRY-009`、`REQ-PANTRY-010`、`REQ-PANTRY-011`、`REQ-PANTRY-012`、`REQ-PANTRY-013`、`REQ-PANTRY-014`、`REQ-PANTRY-015`、`REQ-PANTRY-016`、`REQ-PANTRY-017`、`REQ-PANTRY-018`、`REQ-PANTRY-019`、`REQ-PANTRY-020`、`REQ-PANTRY-021`、`REQ-PANTRY-022`、`REQ-PANTRY-023`
- PRODUCT 5：`REQ-PRODUCT-001`、`REQ-PRODUCT-002`、`REQ-PRODUCT-003`、`REQ-PRODUCT-004`、`REQ-PRODUCT-005`
- NUTR 11：`REQ-NUTR-001`、`REQ-NUTR-002`、`REQ-NUTR-003`、`REQ-NUTR-004`、`REQ-NUTR-005`、`REQ-NUTR-006`、`REQ-NUTR-007`、`REQ-NUTR-008`、`REQ-NUTR-009`、`REQ-NUTR-010`、`REQ-NUTR-011`
- ISSUE 6：`REQ-ISSUE-001`、`REQ-ISSUE-002`、`REQ-ISSUE-003`、`REQ-ISSUE-004`、`REQ-ISSUE-005`、`REQ-ISSUE-006`
- CORR 8：`REQ-CORR-001`、`REQ-CORR-002`、`REQ-CORR-003`、`REQ-CORR-004`、`REQ-CORR-005`、`REQ-CORR-006`、`REQ-CORR-007`、`REQ-CORR-008`

`REQ-TIME-*`、`REQ-QUICK-*` 与 `REQ-SAFE-*` 是必须遵守的支撑约束，但不得作为额外任务范围行混入 84 条规范性追踪表。

## 3. 已批准的建模取舍

以下是已冻结产品语义的结构化翻译，不是新增产品行为：

1. 采用一个 `domain.schema.json`，以 `$defs` 复用对象，并用 `model_type` 的顶层 `oneOf` 验证独立持久化对象；不生成三路线各自 Schema。
2. `EventEnvelope` 只包裹已提交 `meal_event` 与 `purchase_event` 等正式领域事件；命令状态和 mixed 信封不进入本 Schema 的正式事件联合。
3. 时间保存 `raw_text/resolved_start/resolved_end/precision/timezone/resolution_basis/resolution_anchor/resolver_version`；`meal_period` 或 `unknown` 不得伪造精确钟点。
4. Quantity 分开保存用户报告量、营养采用量、库存请求量、库存实际应用量和包装规格；不得由同一个字段暗示五者相等。
5. Measure 使用 `state=known|unknown` 判别联合：known 必须带规范十进制字符串与单位；unknown 必须带原因且禁止 value/unit。known `0` 合法，unknown 绝不等于 `0`。
6. ProductIdentity、PackagingVariant、InventoryBatch 分离；批次耗尽不得删除商品身份、别名和 NutritionProfile。
7. `InventoryBatch` 保存初始事实；当前余额放入 `InventoryBalanceView`，由追加 `InventoryTransaction/InventoryEffect` 投影，不把可变余额冒充原始事实。
8. 同商品多批次以 `BatchAllocation[]` 表达，不等于不同商品多候选；跳过状态禁止任何非零实际 allocation。
9. Nutrition coverage 拆为两轴：`completeness=complete|partial|unknown` 与 `estimation_status=none|partial|key_fields_estimated`，避免“字段完整但有估算”和“字段缺失”混成一个枚举。
10. `NutritionSourceReference.source_id + registry_version` 只校验结构，再由来源注册表校验存在性；domain Schema 不复制动态来源枚举。
11. 不可变 Issue 本体、追加 `IssueStateEvent/IssueResolutionEvent` 与派生 `IssueView.status` 分离；不得把可变 status 当唯一审计历史。
12. CorrectionEvent 固定 12 operation；`remove_item` 与 `void_event` 使用条件约束区分单项和整条，库存补偿只引用实际已应用效果。
13. `QuickPrompt/QuickOption` 只承载已冻结快捷解决结构；不复制用户可见回执排版或按钮实现。
14. JSON Schema 负责单对象结构、枚举、条件和局部一致性；跨对象余额、分配合计、无环、CAS、来源优先级、幂等唯一与同事务原子性由 `data-model.md` 明列为语义验证器/存储约束，Schema 不伪装能验证它们。
15. ID 暂为非空稳定字符串，不擅自限制 UUID；存放位置值为非空规范字符串并带证据来源，不擅自冻结“冷藏/冷冻/常温”全集。

## 4. 文件边界

**Create:**

- `shared/contracts/data-model.md`：对象目录、字段字典、原始/推导/投影分类、跨对象不变量、84 条追踪表、被禁止旧语义。
- `shared/schemas/domain.schema.json`：Draft 2020-12 机器 Schema，不包含动态任务状态。
- `shared/schemas/fixtures/domain-cases.json`：手工正反例及预期验证结果；只含静态 JSON，不是业务数据。
- `shared/tests/validate-domain-schema.mjs`：真实 Ajv 2020 验证器；对每个 case 断言预期通过/失败及预期关键字。
- `shared/tests/validate-domain-schema.ps1`：解析显式/可发现 Node 与 Ajv 运行时、调用 MJS、验证前后快照业务数据并恢复环境。
- `docs/work-items/SH-MODEL-001-report.md`：RED/GREEN 原始命令结果、交付哈希、自检和未解决边界；不得自称独立 PASS。

**Must not modify:**

- 四份冻结上游契约及营养来源注册表；
- A/B/C 任一路线源码、`data` 目录、构建产物；
- `shared/acceptance-cases/cases.json`；
- `总功能开发计划0.2.md`；
- 任何 `.jsonl/.sqlite/.sqlite3/.db` 文件。

## 5. `$defs` 最低集合

Schema 至少定义以下可复用模型；可以在不改变职责边界的前提下增加纯值对象：

```text
StableId, VersionRef, RuleRef, ProvenanceEvidence,
CanonicalDecimal, KnownMeasure, UnknownMeasure, Measure,
ExactQuantity, ApproximateQuantity, RangeQuantity, VagueQuantity, MissingQuantity, Quantity,
OccurredTime, EventEnvelope, MealEvent, MealItem, DishComponent, PurchaseEvent,
ProductIdentity, PackagingVariant, InventoryBatch, StorageAssignment, ExpirationAssessment,
InventoryMatch, BatchAllocation, InventoryEffect, InventoryTransaction, InventoryBalanceView,
NutritionSourceReference, NutritionBasis, NutrientField, NutritionProfile, NutritionSnapshot,
Issue, IssueStateEvent, IssueView, IssueResolutionEvent, QuickPrompt, QuickOption,
CorrectionEvent, EventVersionSnapshot, EffectiveEventView
```

顶层 `oneOf` 最少可验证：`event_envelope`、`product_identity`、`packaging_variant`、`inventory_batch`、`inventory_effect`、`inventory_transaction`、`inventory_balance_view`、`nutrition_profile`、`nutrition_snapshot`、`issue`、`issue_state_event`、`issue_view`、`issue_resolution_event`、`quick_prompt`、`correction_event`、`event_version_snapshot`、`effective_event_view`。

## 6. 必须由 JSON Schema 直接拒绝的错误

每项都要有至少一个明确命名的 invalid case，且 case 的 `expected_keyword` 由手工确定：

1. 正式 EventEnvelope 使用 `query/ignore/mixed` 事件类型。
2. 命令结果 `committed` 填进生命周期，或 `active` 填进命令结果。
3. known Measure 缺数值/单位；unknown Measure 带 value、0、空串或单位。
4. 十进制使用 JSON number、指数、NaN、Infinity、前导加号、本地化逗号或非法前导零。
5. range Quantity 缺 min/max；missing/vague Quantity 伪造精确 value。
6. MealEvent 没有项目；MealItem 同时把 whole item 和 components 计入营养。
7. “一袋鸡蛋”把整条数量标 missing，而不是外层 1 袋 known、内含量 unknown。
8. deducted InventoryEffect 无 allocation、实际应用量 unknown 或 allocation 为空。
9. skipped InventoryEffect 带非零 applied amount 或 allocation。
10. NutritionProfile 缺版本/来源/基准/核心字段 known-or-unknown；字段缺失写成 known 0。
11. NutritionSnapshot 缺不可变版本、profile/version、原始/舍入值、换算或内容摘要。
12. Issue 使用第 17 项之外的 code、3 kind 之外的 kind 或 6 status 之外的 status。
13. resolved/dismissed IssueView 缺 resolution reference；invalidated 缺 invalidating event；deferred 缺触发条件。
14. persisted IssueResolutionEvent 使用 `failed_storage` outcome。
15. Correction 使用第 12 项之外的 operation、`remove_item` 缺 item 目标、`void_event` 错带单项目标。
16. 用户可变状态/余额被塞进不可变根对象的禁止字段，或对象带未声明属性。
17. Nutrition source ref 只带 `source_id` 而缺 `registry_version`。
18. 位置枚举被硬编码成只允许三值，导致合法非空规范位置无法通过。

## 7. 必须由 `data-model.md` 明列、而非伪装由 Schema 保证的不变量

- `min_value <= max_value`；
- 批次 allocation 合计等于真实 applied amount；
- 库存交易前后余额与差量一致且永不为负；
- 用户指定→FEFO→FIFO 顺序及过期批次跳过；
- 同商品多批次不成为不同商品多候选；
- 组合菜 whole/components 不重复计入；
- 来源优先级、许可状态和 `source_id + registry_version` 的注册表存在性；
- known/missing/estimated 字段集合与 NutrientField 状态一致，rounded 值不回流累计；
- Correction 链无环、CAS 当前、remove/void 不重复返库、返还不超过历史真实扣减；
- Issue 转换合法，改变事实的 Resolution 与 Correction 同事务；
- 幂等键唯一、响应丢失读取原结果、mixed 子键稳定且不重演；
- `change_time` 跨日时旧日/新日均在 affected dates；
- 单事件的事实、真实/跳过效果、营养、Issue、幂等与最终进度引用同一原子边界；
- 所有对象引用存在且版本匹配。

---

### Task 1: 写测试运行器和首批手工正反例（RED）

**Files:**

- Create: `shared/tests/validate-domain-schema.mjs`
- Create: `shared/tests/validate-domain-schema.ps1`
- Create: `shared/schemas/fixtures/domain-cases.json`

**Interfaces:**

- Consumes: `DIET_MANAGER_NODE` 与 `DIET_MANAGER_AJV_2020` 可选环境变量；若未提供，PowerShell 包装器可在项目已安装依赖中只读发现 Ajv 2020 入口。
- Produces: 控制台稳定字段 `SCHEMA_COMPILE`、`CASE_TOTAL`、`VALID_PASS`、`INVALID_PASS`、`BUSINESS_BEFORE_COUNT`、`BUSINESS_AFTER_COUNT`、`BUSINESS_DATA_CHANGED`、`VERDICT`；退出 0 表示全部符合。

- [ ] **Step 1: 写 MJS 验证器**

验证器加载 `domain.schema.json` 和 `domain-cases.json`，使用真实 Ajv 2020 编译。每个 case 结构固定为：

```json
{
  "id": "invalid-known-measure-without-unit",
  "requirement_ids": ["REQ-MEAL-009"],
  "valid": false,
  "expected_keyword": "required",
  "model": { "model_type": "example" }
}
```

正例必须验证为 true；反例必须验证为 false，且 Ajv errors 至少包含手工指定关键字。不得用 Schema 代码生成 expected 结果，不得只 grep Schema 文本。

- [ ] **Step 2: 写 PowerShell 隔离包装器**

包装器在运行前后扫描项目根内 `.jsonl/.sqlite/.sqlite3/.db` 的绝对路径、大小、SHA-256、UTC mtime；任一变化退出非 0。它只执行 MJS，不调用三路线 handler、构建、迁移或数据库客户端。

- [ ] **Step 3: 写首批 fixtures**

至少先写一个嵌入合法 `KnownMeasure` 的 `inventory_effect` 顶层正例，以及 unknown=0、生命周期混用、skipped 带 allocation、`failed_storage` outcome、`void_event` 带 item target 五个反例。预期值必须是手工字面量。

- [ ] **Step 4: 运行并确认 RED**

Run：

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:DIET_MANAGER_AJV_2020='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv@8.20.0\node_modules\ajv\dist\2020.js'
powershell -ExecutionPolicy Bypass -File .\shared\tests\validate-domain-schema.ps1
```

当前注入的 Ajv 2020 入口 SHA-256 为 `908E9670B478B2BA126802A221B7E47006F50CF467E2C5DD7935D3DBEF10A20A`。Expected：非 0；稳定失败原因是 `SCHEMA_NOT_FOUND` 或 `domain.schema.json` 不存在；业务数据前后计数和快照相同。若脚本因语法、找不到 fixture 或运行时错误失败，先修测试直到它只因生产 Schema 缺失而 RED。

### Task 2: 写最小领域说明与 Schema 骨架（首轮 GREEN）

**Files:**

- Create: `shared/contracts/data-model.md`
- Create: `shared/schemas/domain.schema.json`

**Interfaces:**

- Consumes: Task 1 的真实 Ajv 验证器和手工 cases；五份冻结输入。
- Produces: 合法 Draft 2020-12 Schema，顶层 `oneOf`，以及包含 84 条唯一追踪行的模型说明。

- [ ] **Step 1: 创建 Schema 头和值对象**

Schema 必须包含以下头部语义：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://diet-manager.local/schemas/domain.schema.json",
  "title": "Diet Manager SCHEMA-v1",
  "oneOf": [],
  "$defs": {}
}
```

先实现 StableId、CanonicalDecimal、Known/Unknown Measure、Quantity、状态分离和首批顶层承载对象，直到 Task 1 的六个 cases 按预期通过/失败。

- [ ] **Step 2: 运行首轮 GREEN**

Run：

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:DIET_MANAGER_AJV_2020='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv@8.20.0\node_modules\ajv\dist\2020.js'
powershell -ExecutionPolicy Bypass -File .\shared\tests\validate-domain-schema.ps1
```

Expected：退出 0；`SCHEMA_COMPILE=PASS`，首批有效/无效 case 全部符合，`BUSINESS_DATA_CHANGED=0`。

- [ ] **Step 3: 写 data-model.md 骨架和边界**

写入契约身份、五份上游哈希、对象职责、三类数据（原始事实/推导值/投影视图）、Schema 可验证/跨对象验证分界、被取代旧语义和 84 条唯一追踪表。不得写“完成”“通过”动态状态。

### Task 3: 逐对象扩展 fixtures 与 Schema（重复 RED→GREEN）

**Files:**

- Modify: `shared/schemas/fixtures/domain-cases.json`
- Modify: `shared/schemas/domain.schema.json`
- Modify: `shared/contracts/data-model.md`

**Interfaces:**

- Consumes: Task 2 的值对象与统一验证器。
- Produces: §5 所列最低对象、§6 全部负例和每个核心模型至少一个正例。

对下列每组严格执行：先增加 cases，运行并确认至少一个新 case 因缺少模型/约束而按预期 RED；再实现最小 `$defs`/条件与说明；随后全量 GREEN。实施报告必须逐组记录 RED 的退出码和首个预期失败，再记录 GREEN 计数。

- [ ] **Step 1: 时间、正式事件、Meal/Purchase**

覆盖原话、解析锚点、precision、不伪造 00:00、meal items 顺序、多项、餐次、库存场景、外食跳过表达、reported/nutrition/inventory amounts 分离、whole/components 防双计。

- [ ] **Step 2: Product、PackagingVariant、InventoryBatch**

覆盖原名/规范名/品牌/类型/变体/别名证据、包装层级、`1袋 + 内含量unknown`、批次时间锚点、位置证据、开封/保质评估、耗尽不删除身份。

- [ ] **Step 3: Inventory match/effect/transaction/view**

覆盖 unique/multiple/none/insufficient/unconvertible，deducted 与全部 skipped/reversed 状态，BatchAllocation、真实 applied amount、同商品跨批次、余额投影与不可变交易分离。

- [ ] **Step 4: Nutrition source/profile/snapshot**

覆盖六项营养字段结构、per_100g/per_100ml/per_serving/per_item/per_package/custom 基准、字段级 known/unknown、completeness/estimation 双轴、来源版本、Profile 历史复用边界、Snapshot 不可变和 content hash。

- [ ] **Step 5: Issue/Resolution/QuickPrompt**

覆盖 3 kind、17 code、6 status、追加 IssueStateEvent、派生 IssueView、7 persisted outcome、`failed_storage` 排除、版本重校验引用、快捷选项影响/非影响/冲突组/到期时间。

- [ ] **Step 6: Correction/有效视图**

覆盖 12 operation、CAS、before snapshot、真实库存补偿引用、营养重算、跨日、remove item、void whole event、最新有效版本与生命周期分离。

- [ ] **Step 7: 全量 GREEN 与 mutation check**

全量运行：

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:DIET_MANAGER_AJV_2020='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\ajv@8.20.0\node_modules\ajv\dist\2020.js'
powershell -ExecutionPolicy Bypass -File .\shared\tests\validate-domain-schema.ps1
```

然后逐项脑内/临时验证下列错误至少会让一个测试失败：允许 JSON number、unknown 带 0、删除 `additionalProperties:false`、把 `failed_storage` 加进 outcome、让 skipped 带 allocation、删除 Correction operation、允许 void 带 item target、移除 source registry version。不得为了让 mutation 通过而保留临时改动。

### Task 4: 追踪、自检和实施报告

**Files:**

- Modify: `shared/contracts/data-model.md`
- Create: `docs/work-items/SH-MODEL-001-report.md`

**Interfaces:**

- Consumes: 最终 Schema、fixtures、测试输出和五份冻结输入。
- Produces: 可供独立复核者冻结的候选哈希、RED/GREEN 记录、84/84 追踪检查和业务数据隔离快照。

- [ ] **Step 1: 检查 84 条追踪**

从任务范围生成期望集合，解析 data-model.md 规范性追踪表；断言实际恰为 84、无缺失、无额外、无重复。每条映射章节必须含实际字段/不变量，不能是空链接。

- [ ] **Step 2: 检查 Schema 结构与旧语义**

断言 Draft 版本、`$id`、顶层分派、必需 `$defs`、枚举精确值、unknown 联合和 `unevaluatedProperties/additionalProperties` 边界。语义检查必须通过真实正反例，不得仅检查字符串存在。

- [ ] **Step 3: 最终隔离运行**

从干净进程运行 `validate-domain-schema.ps1`，保存退出码、运行时版本、Ajv 版本、有效/无效 case 计数和业务数据前后快照。不得把终端输出写入业务扩展名文件。

- [ ] **Step 4: 写实施报告**

报告包含：范围、实际创建文件、上游哈希、每组 RED/GREEN 命令/退出码/关键输出、最终 case 计数、84/84 追踪、自检、候选 SHA-256、业务数据前后差异和仍属于 MODEL-002/003/CASE 的边界。结论只能写“实现者自检通过，等待独立复核”，不能写独立 PASS 或更新总计划。

## 8. 独立复核 PASS 门

后续复核者必须至少验证：

1. 五份冻结输入哈希不变；
2. 84/84 范围 ID 唯一，支撑约束未混入任务范围；
3. Schema 是可由 Ajv 2020 编译的真实 Draft 2020-12 文档；
4. 每个顶层 model_type 有正例，每个 §6 错误族有可命中预期关键字的反例；
5. 命令/生命周期/Issue 状态没有混用；
6. 五类数量角色、known zero/unknown、用户事实/营养估算/库存真实效果不混用；
7. Product/Profile/Batch、Profile/Snapshot、根事实/投影视图均分离；
8. InventoryEffect 跳过状态不允许实际扣减，deducted 需要真实 allocation；
9. Issue 3/17/6、Resolution 7、Correction 12 枚举与冻结契约一致；
10. `failed_storage` 不能作为已持久化 Resolution；remove/void、跨日和真实补偿结构可表达；
11. Schema 能验证的约束与跨对象语义验证器边界没有夸大；
12. 未提前复制完整 CommitResult、DailyProgress、Water 或个人模板学习模型；
13. 现有 A/B/C 旧外壳未被当作共同语义权威；
14. 验证前后正式业务数据新增、修改、删除均为 0；
15. 只有高/中发现为 0、全部机器验证通过时才可 PASS。

## 9. 完成定义

只有实现者按 RED→GREEN 交付、独立复核 PASS、主协调者再次从冻结哈希执行验证并生成新 `EV-*`、最后更新总计划唯一台账后，`SH-MODEL-001` 才可标为已完成。当前简报本身不改变任务状态。
