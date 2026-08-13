# SEL-PANTRY-001 设计

## 1. 目标与边界

本切片把现有的“可提交饮食事实 + 最小库存加减”扩展为可审计的商品、采购、家庭库存和批次能力。唯一验收权威是 `shared/acceptance-cases/cases.json` 中按 `SEL-PANTRY-001` 顺序冻结的 17 个案例；执行简报中的表格只用于生成这些机器 Oracle，不成为第二份期望对象。

交付范围包括：

- 产品身份、品牌/口味/规格证据及稳定复用；
- 采购事实、包装四量、位置、开封和保质证据；
- 批次投影、追加式库存交易、FEFO/FIFO 分配；
- 已发生饮食事实之后的唯一匹配、歧义、单位不兼容、数量未知、库存不足和过期排除；
- 外食和“只记录”在库存读取前短路；
- 批次位置的追加式更正与旧值审计；
- parser → application → domain → repository → receipt 的真实本地路径。

不在本切片中实现营养来源研究、Doctor、完整进度、通用纠错/撤销、安装发布或远程验收。不得使用生产数据根、网络源或 Gateway 凭据。

## 2. 已有基础与缺口

现有 v1 SQLite schema 已包含 `products`、`nutrition_profiles`、`inventory_batches`、`inventory_batch_projections`、`inventory_transactions`、`event_records`、`effect_outbox`、`issues` 和 finalization 表。`AddInventoryOperation`、`preparePurchaseOperation()`、`inventory_add` effect、meal fact-first 流程及单批次 `resolveInventoryMatch()` 已有真实覆盖。因此本切片优先复用现有表，不先新增 migration。

当前缺口是语义而非基础持久化：

- purchase operation 只有一个扁平 `KnownStructuredAmount`，无法同时保存外包装数、每外包装内件数、单内件容量与总量；
- product/batch payload 只保存最小 authority，缺品牌、口味、规格、位置、开封、保质和推断标签；
- inventory match 只接受单候选并按 `batch_id` 排序，无法表达跨批次 FEFO/FIFO allocation；
- core parser 只有一个冻结的鲜牛奶特例，不能表达多商品采购、身份歧义或位置更正；
- application mapping 不处理 `add_inventory`；
- location correction 尚无追加事实/效果类型；
- public receipt 尚未稳定呈现采购条目、共享 issue 与推断字段标签。

## 3. 方案比较与选择

### 方案 A：在现有事实/效果架构上增量扩展（采用）

先冻结目录，再增加 Pantry 专属证据类型、规则和 allocation plan；FactCommit、outbox、finalizer 与现有表继续作为事务骨架。旧 meal/water/purchase 的无新字段字节保持兼容，新增语义通过 exact payload 版本和独立 validator 进入。

优点是变更面可分层审查、无需先迁移、不会重开已稳定的 Task6–Task9 权威。代价是需要在现有 effect-bundle 旁增加明确的 Pantry 边界，避免继续扩大单文件职责。

### 方案 B：一次性重写通用商品/库存状态机（不采用）

将 meal、purchase、correction 全部改成同一种 event/effect reducer。长期结构可能更统一，但会重开 meal/water replay、preview identity、finalizer 和 correction 的大量稳定代码，超过本切片授权。

### 方案 C：只补 17 个路径特例（不采用）

实现量最小，但会形成第二套散落的正则和数据库分支，无法证明包装方程、分配顺序、并发或追加审计，且不满足“可正常使用”。

## 4. 权威数据模型

### 4.1 商品身份

`ProductIdentityEvidence` 保存 normalized name、brand、flavour、规格值/单位及各字段的 `explicit | inherited_exact | unknown` 来源。稳定 identity fingerprint 只由这些规范字段生成；展示文本和时间不参与。匹配必须是全字段相等，不能只按同名复用。

新产品 ID 由 identity fingerprint 稳定派生。历史产品仅在 exact identity 成立时复用；多个候选时返回 2–4 个有界选项与自由文本，FactCommit 前零业务写。

### 4.2 包装四量

`PackageQuantityEvidence` 独立保存：

- `outer_count` 与 `outer_unit`；
- `inner_per_outer` 与 `inner_unit`；
- `capacity_per_inner` 与 `capacity_unit`；
- `total_inner`、`total_capacity` 与 `formula`；
- 每个值的原文 span 和 evidence kind。

只有构成完整、安全整数方程的值才可派生。`2 箱 × 12 盒 × 250 ml` 得到 `24 盒` 和 `6000 ml`；“一袋鸡蛋”只保存外包装 `1 bag`，其余字段为 `null`。未知不变成零，也不通过模板补齐。

库存投影使用可扣减的 `stock_quantity`/`stock_unit`，但 payload 同时保留完整四量，不能把它们折叠成一个数字。

### 4.3 位置、开封和保质

位置证据区分 `explicit`、`configured_home_default` 和 `corrected_explicit`，保存 rule/version/source span。无位置时可以采用冻结的家庭默认，但 receipt 必须标为推断，不能写成用户原话。

开封状态只由显式“已喝一部分”等证据或明确版本化规则产生。保质期保存 duration、anchor、calculation rule/version 和 effective expiration；不可靠或缺失的期限保持 `null`。位置/开封变化触发投影重算，但不改写原采购事实。

### 4.4 批次和库存分配

新增 `InventoryAllocationPlan`，包含稳定有序的 `allocations[]`，每项指向 product/batch、before、deducted、after、unit 和 selection basis。

规则顺序固定为：

1. 显式指定且兼容的批次；
2. 排除过期或不可用批次；
3. 同产品、同单位的批次按 effective expiration 升序（FEFO）；
4. expiration 同为 null 或相同时按 stocked_at、batch_id（FIFO/稳定 tie-break）；
5. 依次分配直到满足完整请求。

不同 product identity 不得跨产品自动合并。两个同名但不同身份是 `skipped_ambiguous`。总库存不足时默认整项零扣减，不产生部分交易。每个成功 allocation 生成独立 transaction；事务总和必须等于请求量且所有 after 非负。

### 4.5 饮食事实优先与零读取边界

meal FactCommit 永远先于库存 effect。库存歧义、未知、单位不兼容或不足只能形成业务 skip/issue，不能回滚饮食事实。

以下场景在查询候选批次前短路：

- context scene 为 `outside`/`company`；
- 原文包含冻结的“只记录/别扣库存”指令；
- 数量未知或 deduction 未被权威转换。

这三个路径必须以 SQL read-count 或等价 deterministic seam 证明没有读取家庭库存。

### 4.6 追加式位置更正

公开动作复用冻结的 `correct_record`。`CorrectInventoryLocationOperation` 以 `kind: "correct_record"`、`correction_kind: "inventory_location"`、batch ID、base revision、previous/next location evidence 为输入。它提交一个 schema 已允许的 `inventory_adjusted` event，并在 exact payload 中保存 `adjustment_kind: "location_correction"`，再由 effect 更新 batch projection 和 applicable expiration。原 purchase event、旧 projection evidence 与 audit previous value 保留；同 key 重试返回同一事件，不重复应用。

## 5. 组件边界与数据流

### 5.1 目录与根门

第一阶段创建：

- `shared/tests/validate-sel-pantry-cases.mjs`：从唯一 catalog 选择精确 17 ID，验证顺序、fixture、Oracle path 和 forbidden 分类；self-test 对缺失、额外、重排、未知 fixture、Oracle/forbidden 漂移 fail closed。
- `shared/tests/validate-sel-pantry-roots.mjs`：只接受简报中的两个绝对任务根；official sentinel 仅做前后 manifest，isolated base 只创建/删除 test-owned 子根，禁止数据库落入 sentinel。
- `version-b-lite-plugin/tests/acceptance/pantry-catalog.test.ts`：消费 catalog 对象，不复制第二份期望。

缺少的 15 个案例及 fixture 必须先写入 `cases.json` 并通过 normal/self；此后才允许生产文件变化。

### 5.2 Parser 与 application

Parser 继续先于数据库/secret 执行，只做 bounded lexical evidence：采购条目、四量、显式位置/开封/保质、库存指令和位置更正意图。它不自行选择已有 product/batch。

候选进入 runtime 后，由 application resolver 只读查询 exact identities/batches：

- 0 个 identity：派生新 product；
- 1 个 exact identity：复用；
- 多个：返回带 2–4 个净化可读选项和自由文本出口的 clarification，零 FactCommit；
- 多商品：按原文顺序映射为同一父 envelope 内的多个 domain operations；公开 `record_id` 保持首事件身份，并只在多事件成功时附加有序 `record_ids`；
- 更正：解析为 batch-bound correction operation。

公开 handler 仍只返回净化、冻结 outcome。`ignored`/clarification/unsupported 不创建数据库或业务行；只有需要数据库消歧的 candidate 才打开 runtime。

### 5.3 Domain 与 repository

§29.6 已冻结两个主交付路径，设计以它们为中心，不另造平行 Pantry service：

- `src/domain/inventory-service.ts`：ordinary/exact/deep-frozen Product、Package、Location、Opening、Expiration authority，以及方程、identity fingerprint、默认位置、expiry 和 FEFO/FIFO allocation 纯规则；
- `src/storage/inventory-repository.ts`：在现有表和事务内追加 purchase/correction 事实、批次、transaction 与 projection，负责 CAS、非负、幂等和 audit readback；
- `src/parser/purchase.ts` 与 `src/parser/inventory-directive.ts`：仅解析有界 source evidence，不读取数据库；
- 现有 `effect-bundle.ts` 保持 meal orchestration，只调用 allocation authority，不再复制 Pantry 规则；
- `repository/inventory-effects.ts` 继续负责事务/CAS/authority readback，扩展 exact payload validator 与多 allocation 应用。

`shared/schemas/product-inventory.schema.json` 是目标模型旁证；它当前的单一 `package_spec` 仍不足以表达包装四量，因此不得把新结构悄悄塞成旧 Amount 并宣称满足。先做 schema impact audit：现有物理列足以表达选中案例时，以规范化 payload validator 承载新增证据而不改 `migration-v1`；只有 exact test 证明无法以 canonical payload + 既有 indexed columns 安全查询时，才提出 schema version/migration，并在生产写前单独设计/评审。

### 5.4 Receipt 与 query

Purchase receipt 按原文顺序一行一个产品，共享 issue 只出现一次；推断位置/开封/expiry 均带 evidence label。Inventory query 返回当前投影及可审计 evidence，不泄露 preview secret 或内部 token。

## 6. 错误与并发语义

- 所有入参在反射前拒绝 Proxy/accessor/prototype/extra key，稳定错误且 getter/trap 为 0。
- 计算只接受 safe integer；乘法/加法使用 BigInt 中间值并在回到 number 前检查范围。
- 同 envelope/key 的 fact、effects、allocations 和 terminal result 必须 byte-exact；changed input 为稳定 conflict、零附加写。
- 两个并发采购或扣减通过现有 revision/progress reservation 和 `BEGIN IMMEDIATE` 串行；失败重试不重复 transaction。
- allocation 在一个 effect transaction 中全成或全不成；不足不允许默认部分扣减。
- stored fact/effect/projection/receipt 的 schema-valid tamper 必须由独立 preview identity/expected fact 检测，而非由同一行自证。

## 7. 测试与交付顺序

实现分为四个独立可复核增量：

1. **Authority catalog**：17 案、fixtures、forbidden、root gate；生产 diff 必须为零。
2. **Purchase/product**：四量、identity、default location、expiry/opening、多商品与 ambiguity；真实 FactCommit/effect/replay/query。
3. **Inventory consumption**：outside/explicit skip、unique/ambiguous/unit/unknown/insufficient、FEFO/FIFO 跨批次、非负与 fault/concurrency。
4. **Correction/application**：位置更正追加事件、public parser/application/OpenClaw outcome、完整回归与双审。

每个增量都先捕获针对功能缺失的 RED，再做最小 GREEN，运行 focused Vitest、repository/fault、`tsc --noEmit`、catalog normal/self 和敏感/残留检查。

本任务不执行 emit build、不改 `dist/**`、不发布远程。首次生产 source 变更前删除 ignored 的旧 `selected-route-map.json`；Task9 的 dist/X-GATE 身份继续作为历史证据。最终安装/发布任务对累计 source 运行其唯一正式 build、更新全量 dist manifest，再做授权 OpenClaw 验收。SEL-PANTRY 的完成证据只声明 source/domain/storage acceptance，不冒充可安装产物已刷新。

## 8. 完成条件

- catalog 17/17 且所有 forbidden 机械分类；
- 17 案各自的 assertion paths 由真实实现证据覆盖；
- unknown never zero、fact-first、zero-read、FEFO/FIFO、nonnegative、append-only、idempotency/concurrency 均有直接测试；
- focused/full source tests 与 noEmit 通过，所有 test-owned roots 清除；
- 两名独立复核者均无 P0/P1；
- 未触碰生产 official root、网络、Gateway 凭据、remote 或 dist build。
