# SEL-NUTR-001：0.3 营养基础能力设计

## 1. 目标、权威与范围

本设计实现《总功能开发计划0.3.md》§6.5、§13.1—§13.19、§18.6—§18.7
规定的 PRODUCT-0.1 营养能力。0.3 是功能权威；0.4 的 `REQ-SOURCE-001`、来源注册表、
Doctor 和缓存规则只作为不删减 0.3 的实现增强。现有 B 路线 SQLite、私有 preview、
FactCommit、outbox、EffectBundle、EnvelopeFinalize、幂等和崩溃恢复继续复用。

直接负责：

- `REQ-NUTR-001`—`REQ-NUTR-006`；
- `REQ-MEAL-003`；
- 0.4 `REQ-SOURCE-001` 的来源适配器、真实 Probe、Doctor 与安全配置。

本任务绑定 15 个案例：

- `CASE-NUTR-001`、`CASE-NUTR-002`、`CASE-NUTR-003`、`CASE-NUTR-004`、
  `CASE-NUTR-005`、`CASE-NUTR-006`、`CASE-NUTR-008`、`CASE-NUTR-009`；
- `CASE-MEAL-003`、`CASE-MEAL-006`、`CASE-MEAL-007`、`CASE-MEAL-008`；
- `CASE-SOURCE-001`、`CASE-SOURCE-002`、`CASE-SOURCE-003`。

`CASE-MEAL-003` 是有限模糊量采用合理上界并公开实际采用量的必测回归，不能只依赖旧的
vertical 测试间接覆盖。Research、聚类、可信度评分、Watchlist、自动研究调度和个人模板学习
不进入本任务；但已经存在且已激活的个人模板必须能按 0.3 来源顺序只读使用。

## 2. 当前基线与真实缺口

当前源码已有六字段整数 `NutritionVector`、确定性比例换算、未知传播、日进度贡献、
`nutrition_profiles`、`nutrition_snapshots`、meal nutrition effect、故障缝和真实 OpenClaw 入口。
应用映射仍固定写 `nutrition_sources: []`，来源选择只支持窄版 label/fixture/unknown，也没有：

- 完整八层来源遍历；
- 网络来源、缓存和真实 Probe；
- 动态解析的持久单飞与并发回放；
- 十字段共享 Profile/Snapshot 与字段级证据；
- 网络恢复后的追加式补全；
- 用户可见的采用量和来源标签；
- 精确可信配置、全局网络时限和脱敏 Doctor。

因此已有表和 effect 只是基础，不代表 0.3 营养功能已经完成。

## 3. 选定方案

采用“完整 0.3 来源链 + 现有表持久单飞 + 异步应用入口”，不新增 SQLite migration。

没有采用以下方案：

1. **每次请求直接联网再创建 preview**：同键并发可取得不同动态结果、重复联网并触发
   `PREVIEW_CONFLICT`。
2. **新增营养任务表**：结构独立，但会在本阶段引入 migration；现有 `command_envelopes` 和
   `idempotency_records` 已能承载受认证的解析占位与 CAS 完成。
3. **effect 阶段联网**：重试时来源会变化，而且会扩大 SQLite 写事务。

公开 `diet_manager` 仍只有八个 action。`record_meal` 写入饮食和首次营养；
`correct_record` 负责用户明确要求的营养补全。Doctor 是只读运维 API，不成为模型 action。

## 4. 来源组件

### 4.1 能力契约与三个实现族

新增 `shared/contracts/source-capability-contract.md`，冻结 source ID、tier、authority class、
状态、请求字段 allowlist、许可、缓存、Probe、超时和稳定降级原因。唯一优先级仍来自
`shared/nutrition-source-registry.json`，实现不得创建第二份来源顺序。

首批实现三个能力族：

1. **LocalEvidenceAdapter**：当前精确标签、制造商资料的合规本地缓存、同商品历史、已激活个人
   模板、通用菜模板和有界估算；这些能力虽然共享本地实现，不得跨 tier 提前命中。
2. **FoodDataCentralAdapter**：权威公共数据库，只有可信配置启用且 secret resolver 提供 key
   时联网；可读取符合许可和完整性规则的版本化缓存。
3. **TrustedExactProductAdapter**：逐域 allowlist 的制造商精确商品子项，以及显式启用的
   Open Food Facts 只读精确条码子项。不存在有效子注册、许可或身份不精确时稳定跳过，
   不能退化成开放网页搜索。

中国 CDC 条目继续 `disabled_pending_authorization`。搜索摘要、转载页和模型记忆不是来源。

每个适配器只实现：

```text
describe() -> frozen capability
probe(context) -> frozen health
resolve(request, context) -> frozen result
sanitize(error) -> stable diagnostic
```

### 4.2 八层顺序与层内顺序

`NutritionSourceClient` 必须按注册表 rank 1—8 完整遍历：

```text
1 当前精确标签
2 制造商或精确商品资料
3 已确认同商品历史 Profile
4 权威公共数据库
5 白名单可信互联网
6 已激活个人模板，再到版本化通用菜模板
7 有依据的通用估算
8 unknown
```

每一层内部严格执行：

```text
本轮直接本地证据
→ 该层、该来源的合规未过期缓存
→ 该层、该来源已启用且 Probe=ok 的网络请求
```

只有当前层没有适用可靠结果或已稳定降级后才能进入下一层。低层缓存、历史 Profile、模板和
估算不得抢占仍适用的高层精确证据。已激活个人模板可读但本任务不学习、不激活新模板。

### 4.3 请求最小披露与网络安全

网络请求只能重新构造规范化食品名、品牌、变体、包装规格、生熟/加工状态、最低食品分类和
地区语言。完整原话、饮食历史、用户目标、conversation、数据库路径、secret、库存、日期和
用户身份不得进入请求。

FDC 固定官方 HTTPS origin、路径、同源重定向、响应字节上限和 JSON content-type；制造商/OFF
必须匹配自己的子注册 allowlist。所有网页/响应均是不可信数据，只解析 exact schema 的普通
JSON 数据，不解释其中指令。测试使用 fixture transport，不访问真实网络或凭据。

## 5. 可信配置、异步入口与时限

OpenClaw plugin config 增加 exact、ordinary、无 getter/proxy 的 `nutrition` 对象：

```text
policy_version
resolution_deadline_ms        # 默认 2000，允许 500—5000
source entries[]              # source_id、enabled、backend/version、非秘密许可配置
credential_refs{}             # opaque reference；不是 secret value
```

模型参数不能携带来源配置、API key、token、host 或 deadline。credential ref 由私有 runtime
resolver 换成内存 secret capability；secret 值不进入 digest、SQLite、日志、错误、Profile、
Snapshot 或 Doctor。非秘密配置规范化后产生 `source_config_digest`。

runtime authority 由“物理 official root + source_config_digest”共同约束。同一存活 runtime/API
若收到不同 digest，稳定 `PLUGIN_CONFIG_CONFLICT`；关闭并重新创建后新请求可用新配置。
旧幂等键仍复用其已签来源证据，不因当前配置改变而重解释历史。

`handleCoreRequest` 改为 `Promise<DietManagerOutcome>`；OpenClaw 的公开 execute 本来就是异步，
因此 action 和参数契约不变。parser 的 ignored/clarification 在打开 DB、读取 secret 或解析来源前
立即完成。营养解析只有一个全局 deadline；每个 adapter 只能取得剩余时间与自己的更小上限，
共享 `AbortSignal`。到期后取消所有未完成工作并降级，不允许迟到 promise 写 Profile/preview。

## 6. 持久单飞、双摘要与 preview authority

### 6.1 Base claim

解析完成、业务来源调用开始前，先从用户原始权威输入和静态 meal operation 计算
`base_input_digest`。它不包含动态营养结果、当前 cache 命中、网络响应或 secret/config 值。

在 `BEGIN IMMEDIATE` 中复用现有两表写受 HMAC 保护的 v6 `nutrition_resolution_pending`：

- `command_envelopes.state='received'`，`result_status='nutrition_resolving'`；
- `idempotency_records.state='nutrition_resolving'`；
- payload 保存 base binding、owner nonce、generation、lease expiry、source_config_digest；
- 两表的 `input_digest` 都等于 `base_input_digest`。

不同 key 可以并行；相同 key + 不同 base digest 稳定冲突且零业务写。相同 key + 相同 digest：

- 已完成 preview：认证并直接复用；
- 活跃 lease：同进程通过 single-flight Promise 等待，跨进程有界轮询受认证行；
- lease 过期：以 generation CAS 接管；
- 原 owner 迟到：CAS 失败后丢弃自身动态结果并复用赢家，不得覆盖。

claim 阶段不写 event、Profile、Snapshot、progress 或 outbox。owner 崩溃只留下可接管占位。
若接管者的当前 `source_config_digest` 与过期 claim 不同，只有在没有完整 preview、generation CAS
成功时，才能把 pending claim 的非秘密配置身份更新为当前 digest 后重新解析；旧 owner 随即失去
写权。不得用当前配置生成结果却继续宣称旧配置身份，也不得把 credential ref 写入 claim。

### 6.2 完整 preview

赢家解析后计算 `resolved_evidence_digest`，在事务中用 owner/generation/base digest CAS 将两表变成
现有 `preview_ready` 语义。v6 私有材料同时覆盖：

- base input digest 与 resolved evidence digest；
- source_config_digest 和实际采用的 source/backend/version；
- Profile identity、十字段证据、basis、quantity/range、公式；
- 完整 meal event/item/effect/outbox identity。

现有 v1—v5 preview 仍按原 authority 回放。v6 的数据库 `input_digest` 始终是 base digest，
`preview_hash` 与 resolved evidence digest 绑定最终动态证据。后到请求不能把自己的新动态结果拿去
和赢家 preview 比较并报 conflict；它必须先按 base claim 复用赢家。

## 7. 营养模型、unknown 与缓存

### 7.1 ResolvedNutritionEvidence

每个 meal item 产生不可变证据：subject identity、variant、source ID/type/tier、稳定记录与版本、
许可摘要、retained-fields hash、measurement basis、十个共享 nutrient 字段、逐字段 evidence、
known/missing/estimated fields、CoverageStatus、采用量/范围/公式和不确定性。

内部日进度继续使用 energy/protein/fat/carbohydrate/fiber/water 六字段安全整数微单位；Profile 和
Snapshot 另外保存 `energy_kj/sodium_mg/sugar_g/saturated_fat_g`。未知永远为 `null/unknown`，
不进入加法的零值分支。

### 7.2 Shared Schema 修正

当前 `NutritionSnapshot` 强制非空 `consumed_amount/consumed_unit`，与 0.3“数量未知绝不发明”冲突。
本任务必须先以 Schema-impact RED 重开 `SH-MODEL-002`，发布兼容 schema v1.1：

- 已知摄入量仍要求规范 decimal + unit；
- 只有 `source_type='unknown'`、所有 nutrient 为 null、coverage=unknown 时，Snapshot 的
  `consumed_amount/consumed_unit` 才能同时为 null；
- unknown Profile 可保留 `per_serving / 1 serving` 作为 Profile 身份基准，但 Snapshot 不得把它
  冒充实际摄入量；
- `formula='unknown composition'`，不推导库存或营养数值。

这是共享 JSON Schema/fixture/validator 的版本升级，不改变 SQLite 表结构；若精确影响审计发现
必须 migration，则停止实现并回到设计门，不能偷加迁移。

### 7.3 Profile 缓存

现有 `nutrition_profiles` 保存 immutable Profile 和缓存元数据：subject/source/record/profile
版本、retrieved/review 时间、policy version、raw hash、字段证据、coverage、supersedes ID。
缓存复用必须匹配当前 tier/source、subject、variant、状态、basis、版本、完整性和许可周期。
旧 Profile 永不更新或删除；刷新只影响未来解析。

Profile 在 nutrition effect 中写入。来源查询成功但 FactCommit 失败时不留下业务 Profile。

## 8. FactCommit、EffectBundle 与网络恢复补全

### 8.1 首次摄入

完整 preview 后按既有阶段执行：

```text
FactCommit meal fact + nutrition outbox
→ nutrition effect 原子写 Profile + Snapshot + progress contribution
→ EnvelopeFinalize 冻结结果
```

source timeout、无 key、无结果或部分字段只改变 evidence/coverage，不阻止明确 meal fact。
技术失败保留 `effects_pending`；重试只用已签 v6 evidence，不重新联网。

### 8.2 追加式营养补全

网络恢复不会后台静默改历史。本任务在既有 `correct_record` 中实现窄的
`change_nutrition_source`/“重新补全营养”候选：目标必须由 record ID，或唯一日期+meal/item
身份确定；歧义时零写入 clarification。

成功补全按三阶段：

1. FactCommit 追加 `event_type='nutrition_supplemented'`、`fact_kind='correction'` 的 immutable fact，
   同时创建 nutrition correction outbox；
2. 独立 effect 事务写新 Profile、新 Snapshot、目标日期 progress 差量和 effective-tail 指针；
3. EnvelopeFinalize 返回新 correction record ID 与营养详情。

`shared/schemas/event-and-amount.schema.json` 的事件枚举需要以 Schema-impact RED 增加
`nutrition_supplemented`，并把对应 fact payload/fixture/validator 与 `change_nutrition_source`
操作交叉绑定。这是共享契约的加法升级；`event_records.event_type` 本身是 TEXT，因此不需要
SQLite migration。若影响审计得出相反结论，必须停在 Schema 门，不能绕开共享枚举。

旧 unknown Profile/Snapshot 保留且审计可见；普通查询取最新 applied supplement tail。补全事件和
原 meal 的 Profile/Snapshot identity、base revision、日期、旧/新 contribution 都受 preview HMAC、
outbox、bundle 和 CAS 保护。Fact 后崩溃可恢复；并发 stale correction 稳定失败且不产生第二补全。
未来 Issue 模块可建议同一个公开 `correct_record`，但本任务不创建后台 scheduler。

## 9. 食品、份量和公开结果

- 精确包装商品只有相同 product/version 的标签或制造商资料可称精确。
- 普通鸡蛋、米饭、苹果必须匹配生熟、可食部分和 basis。
- 明确 200g 保持 explicit；公共营养只标 `public_reference`，不能把数量标成估算。
- 橙子 1 个保存自然单位、可食克重、规则版本；仅推定字段 estimated。
- “半碗”等有限范围采用冻结合理上界，保存上下界、采用值和依据。
- 蛋炒饭/牛肉面模板列出参与计算的组件与版本，整菜和组件只能贡献一次。
- 内容不明套餐/高度可变食品保存事实并保持 unknown，不套普通同类数据。

为在本任务真实交付 §18.6—§18.7，`CommittedOutcome` 增加可选、exact、deep-frozen 的
`nutrition_items[]`：

```text
item_id
name
adopted_amount | null
adopted_unit | null
amount_range | null
quantity_evidence
source_label
coverage_status
known_fields[]
missing_fields[]
estimated_fields[]
```

`quantity_evidence` 和 `source_label` 必须引用注册表的冻结枚举；不能让 adapter 返回任意展示文本。
`amount_range` 只有真实有界推定时出现，并要求 min、max、adopted、unit 和 rule version 精确一致。

它只出现在已提交 meal 或 nutrition supplement 结果中。自然单位必须公开实际采用的克重/毫升和
范围；明确 200g 不显示估算；公共资料显示“参考数据库”。该结构不含 secret、私有 URL、raw
响应或内部 token。现有 status/record_id/record_ids 字段和八 action 不变，旧调用者可忽略新字段。

本任务只交付这些机器可读、用户可见的字段级证据；最终中文排版、日/周查询和完整进度回执仍由
`SEL-RECEIPT-001`、`SEL-QUERY-001`、`SEL-PROGRESS-001` 负责。

## 10. Doctor

`runNutritionDoctor` 是只读、异步、可注入并冻结输出的运维 API。它逐来源做真实轻量 Probe，
报告配置状态、实际 backend、允许的下一 backend、稳定错误码和行动建议。单来源崩溃不影响其他
诊断；Doctor 共享全局 deadline/AbortSignal，但不创建 config/cache/DB/研究目录/浏览器状态、
不安装依赖、不创建调度。

Doctor 输出仅含 source ID、非秘密 config identity、backend/version、health、稳定原因和建议；
不得包含 key、credential ref、cookie、Authorization、带凭据 URL、用户内容或绝对私有根。

## 11. 开发节奏与统一测试

本任务采用用户批准的“连续开发、清晰记录、模块末统一测试”，不减少功能：

1. **批次 A：契约与模型**——15 CASE authority、source contract/registry adapter、Schema v1.1、
   outcome additive shape。
2. **批次 B：来源与单飞**——三个 adapter 族、配置、deadline、Doctor、base claim/v6 preview。
3. **批次 C：业务闭环**——Profile/Snapshot effect、nutrition_items、supplement event、progress 差量、
   fault/replay/tamper/concurrency。

每个批次只要求：代表性真实 RED、改动相关的定向 smoke、开发日志更新。禁止每个小修改都运行
full、trace、双复审或 formal build。批次内发现问题只运行直接受影响测试。

三个批次完成后统一运行一次模块验收：15 CASE、source/Doctor、Profile/Snapshot、补全、故障、
并发、公开 outcome、`tsc --noEmit`。模块修复后只重跑受影响集；候选冻结时再运行一次 full source、
trace normal/self 和双独立复审。正式 emit/build 仍只允许最终发布阶段执行一次。

开发日志固定记录：批次、REQ/CASE、改动文件、接口/Schema/authority 决策、RED、smoke、延期测试、
已知风险、修复索引和最终 gate。日志不保存 secret、原始私人数据或冗长重复控制台输出。

## 12. 完成与非声明

`SEL-NUTR-001` 完成代表：15 案绑定的来源优先级、异步单飞、计算、字段证据、Profile/Snapshot、
公开采用量、追加式网络补全和 Doctor 在 source 候选中完成。

它不代表完整 PRODUCT-0.1、安装态已发布、六项目标、最终排版回执、日周查询、Research、
Watchlist、个人模板学习或完整 Issue/纠正中心完成。正式 build/release 前，
`PRODUCT-0.3-PARITY.md` 的营养与用户安装状态继续保持 `partial`。
