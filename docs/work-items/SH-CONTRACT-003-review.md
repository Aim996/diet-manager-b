# SH-CONTRACT-003 独立复核报告

> 最新有效复核结论（第 2 轮）：**PASS**。第 1 轮 FAIL 历史完整保留在下文。

## 1. 初审结论

- 复核轮次：第 1 轮独立复核
- 复核者：`/root/nutrition_source_review`
- 复核日期：2026-08-09（Asia/Shanghai）
- 结论：**FAIL**
- 候选：`shared/nutrition-source-registry.json`
- 冻结 SHA-256：`AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1`
- 实际 SHA-256：`AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1`
- 候选哈希结论：一致，不是 `candidate_changed`
- 阻断发现：2 个中严重度；高严重度 0 个
- 复核包 16 项标准：14 PASS / 2 FAIL
- 16 条需求语义：15 PASS / 1 FAIL；结构追踪仍为 16/16、重复 0、缺失 0、额外 0

当前候选不得落账为完成。实施者只能修复 F-01、F-02 后提交新冻结哈希，再由本复核者追加第 2 轮复审历史。

## 2. 冻结输入核验

| 输入 | 复核包 SHA-256 | 实际 SHA-256 | 结果 |
| --- | --- | --- | --- |
| `docs/work-items/SH-CONTRACT-003-review-package.md` | `04E91402A4E19FE42AAE20BA0F521156B43411B76F55E9BF5FE3C2F863441033` | `04E91402A4E19FE42AAE20BA0F521156B43411B76F55E9BF5FE3C2F863441033` | PASS |
| `docs/work-items/SH-CONTRACT-003-brief.md` | `2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D` | `2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D` | PASS |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | PASS |
| `shared/nutrition-source-registry.json` | `AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1` | `AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1` | PASS |
| `docs/work-items/SH-CONTRACT-003-report.md` | `7FE5A72E73AC92FF20EB72FA842C49F71A1F49F8671D1E6033E4D7219FD7210B` | `7FE5A72E73AC92FF20EB72FA842C49F71A1F49F8671D1E6033E4D7219FD7210B` | PASS |

## 3. 复核包 16 项标准逐项结论

| # | 标准 | 结果 | 独立证据 |
| ---: | --- | --- | --- |
| 1 | JSON、顶层身份、上游和状态来源 | PASS | PowerShell `ConvertFrom-Json` 成功；顶层版本、`status_source` 与上游路径/哈希存在且一致。 |
| 2 | 16 条各且仅一次追踪，Pointer 存在且非空 | PASS | 16 项、重复 0、缺失 0、额外 0；36 个 JSON Pointer 解析失败 0、空字符串/空数组语义 0。 |
| 3 | 八级优先级不可颠倒 | **FAIL** | 八个 tier 和 1—8 顺序本身正确，但 `/cache_policy/lookup_order` 可让 `confirmed_local_profile` 先于仍适用的更高层生产商精确网络来源终止解析，见 F-01。 |
| 4 | 标签、生产商、历史、公共库、互联网、模板、估算、unknown 边界 | PASS | 各层均有适用判定；未知套餐、加工饮料、历史精确匹配及 unknown 边界明确。 |
| 5 | USDA FDC 身份、许可、密钥、限流、版本与 Branded 限制 | PASS | 官方 API 指南支持 API key、1000 次/小时/IP、429、CC0；下载页支持版本化 JSON/CSV；候选明确 Branded 不自动视为当前生产商标签。 |
| 6 | Open Food Facts 社区性、只读、限流、User-Agent、许可、隐私与缓存隔离 | PASS | 候选与官方 v3.6、15 次产品读取/分钟/IP、10 次搜索/分钟/IP、定制 User-Agent、ODbL/DbCL、照片公开风险一致；写入/照片/用户标识关闭，持久缓存默认关闭。 |
| 7 | 中国疾控目录禁用待授权 | PASS | `disabled_pending_authorization`；不自动访问、不缓存营养数值、不暗示公开 API；与官方注册、申请、责任书及再提供限制一致。 |
| 8 | 生产商逐域登记和精确 SKU | PASS | `conditional_per_domain_allowlist`，无统一公网 API；逐域条款、robots、频率、精确变体/SKU、缓存和再分发默认拒绝。 |
| 9 | 外部请求 allowlist/denylist 与不可绕过 | PASS | 全局 allowlist 6 字段；4 个外部项的 `request_fields` 全为子集；计划所列生活上下文 denylist 完整；记录 ID、健康目标、照片及身份字段均不在 allowlist。 |
| 10 | 运行时密钥、最小日志、无真实凭据 | PASS | `runtime_secret_reference_only`；真实密钥模式命中 0；日志禁止原话、转储、图片、密钥和原始响应体。 |
| 11 | 非个人缓存键、版本/抓取分离、历史快照不静默刷新 | PASS | 缓存键 9 字段与禁用/个人字段交集 0；`retrieved_at` 单列；刷新、撤销、许可变化和完整性失败均不改写历史快照。 |
| 12 | 变体、品牌、条码、生熟/加工、可食部匹配边界 | PASS | 历史复用要求品牌、规范名、变体、包装/标签版本；FDC 限制类别/加工/可食部；OFF 只作条码候选；加工饮料和未知套餐有硬边界。 |
| 13 | 明确、历史、个人模板、公共参考和逐字段推定标签 | PASS | 六类证据标签和逐字段推定元数据完整；公共参考简洁回执与详情规则、历史和个人模板显示文案均存在。 |
| 14 | 超时、429/503、密钥、许可、禁用、无结果、歧义、冲突、缺字段和完整性失败 fact-first | **FAIL** | `fact_first=true` 且 12 个稳定原因齐全，但没有 `http_503` 显式映射；OFF 官方说明全局限流可返回 503，见 F-02。 |
| 15 | 不越权冻结 Schema/客户端/保质期，不提前宣布完成 | PASS | 文件仅登记治理策略和来源边界；实施报告明确未实现客户端、Schema、案例或路线代码，且未宣布任务完成。 |
| 16 | 业务数据前后无新增/修改/删除 | PASS | 初审写报告前扫描为 0；写后复扫见第 8 节。 |

## 4. 16 条需求逐项语义复核

| 需求 | 结果 | 说明 |
| --- | --- | --- |
| `REQ-NUTR-001` | **FAIL** | 有序 tiers 与 selection rule 正确，但被 `/cache_policy/lookup_order` 的可执行次序歧义削弱；见 F-01。 |
| `REQ-NUTR-002` | PASS | 常见原始/基础食品可主动使用本地资料、合规缓存、FDC 或适用可信来源，不要求上传标签。 |
| `REQ-NUTR-003` | PASS | 包装、精加工和高度自定义食品优先精确资料，失败不得冒充精确。 |
| `REQ-NUTR-004` | PASS | 加工饮料不得套普通牛奶或果汁资料。 |
| `REQ-NUTR-005` | PASS | unknown 不等于 0，缺字段为 null/unknown。 |
| `REQ-NUTR-006` | PASS | 明确数量、精确标签、确定换算均为明确证据。 |
| `REQ-NUTR-007` | PASS | 历史复用要求同商品与同标签版本，并显示“沿用历史营养表”。 |
| `REQ-NUTR-008` | PASS | 激活个人模板显示“按个人模板”，不冒充公共或精确标签。 |
| `REQ-NUTR-009` | PASS | 明确数量配公共库可在简洁回执省略估算，详情保留“参考数据库”。 |
| `REQ-NUTR-010` | PASS | 自然单位、可食部、密度、出成率和模板推定均要求采用值、依据、来源、来源版本和规则版本。 |
| `REQ-NUTR-011` | PASS | 估算证据逐字段保存，不给整项笼统贴估算。 |
| `REQ-PRIV-001` | PASS | 全局严格 allowlist，来源只能收窄。 |
| `REQ-PRIV-002` | PASS | 计划所列原话、会话、日期餐次、库存、位置、异常、模板历史和数据库均禁止发送。 |
| `REQ-PRIV-003` | PASS | 网络来源须命中生效注册项；保存来源、版本/抓取时间、匹配条件、允许字段和确定性缓存键。 |
| `REQ-PRIV-004` | PASS | 日志最小化，禁止原话、转储、营养图片和密钥。 |
| `REQ-PRIV-005` | PASS | 凭据仅运行时引用，禁止写入登记目的地；缺密钥只降级营养，不阻断事实。 |

## 5. 来源真实性、许可与缓存结论

| 来源 | 官方/第一方依据 | 复核结论 |
| --- | --- | --- |
| USDA FoodData Central | https://fdc.nal.usda.gov/api-guide/；https://fdc.nal.usda.gov/download-datasets/ | PASS。API key、1000 次/小时/IP、超限 429、CC0 与版本化下载均有官方依据；候选对 attribution 更保守，不构成放宽。 |
| Open Food Facts | https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/；许可教程；缓存教程 | PASS。v3.6、社区数据质量限制、15/10 次限流、全局限流 503、自定义 User-Agent、ODbL/DbCL、照片公开风险和缓存来源隔离均有第一方依据；候选默认只读且不持久缓存。 |
| 中国疾控公共卫生科学数据中心 | 复核包列出的目录、用户指南、申请入口 | PASS。官方页面只证明目录、注册/申请/责任书与使用限制；候选保持待授权禁用，不声称公开机器 API。 |
| 生产商精确商品类别 | 每个未来域名必须另行提供官方页面与条款 | PASS。当前不是生效公网端点；逐域、逐条款、精确 SKU、默认无缓存/再分发符合最小权限。 |

## 6. 阻断发现

### F-01：缓存查找次序可能反转不可颠倒的来源优先级

- 严重度：**中**
- 位置：`/cache_policy/lookup_order`，候选第 238—243 行；冲突参照 `/priority_policy/selection_rule` 第 21 行、`/priority_policy/ordered_tiers/1` 第 31—36 行和 `/priority_policy/ordered_tiers/2` 第 37—42 行。
- 现状：`lookup_order` 固定为 `confirmed_local_profile → compliant_unexpired_source_cache → enabled_network_source`。它没有声明该顺序只发生在“当前优先级 tier 内”，也没有禁止在更高适用 tier 尚未解析时接受较低 tier 的本地历史或缓存。
- 影响：实现可以在发现“已确认同商品历史档案”（rank 3）后停止，而不尝试仍适用、已启用的生产商精确资料（rank 2）；也可能以任意低层缓存抢先覆盖更高层网络来源。这样会直接削弱 `REQ-NUTR-001` 的不可颠倒语义。
- 最小修复：把缓存查找明确限定为“按 `ordered_tiers` 从 rank 1 到 8 解析；仅在当前 tier 内按本地/合规缓存/网络查找”，并增加机器字段明确 `lookup_order` 不得改变 tier 优先级、低层命中不能在更高适用层未完成前终止。同步更新 `REQ-NUTR-002` 的 trace 路径，确保所指语义仍非空。

### F-02：没有为 HTTP 503 建立可校验的稳定降级映射

- 严重度：**中**
- 位置：`/failure_policy`，候选第 285—318 行；尤其第 308—317 行的事件映射。
- 现状：有 `timeout → source_unavailable` 和 `http_429 → rate_limited`，但没有 `http_503`。Open Food Facts 第一方 API 文档明确说明全局限流超限会返回 HTTP 503。
- 影响：客户端无法仅凭注册表稳定判断 503 是可降级的来源不可用/限流结果，可能产生实现分歧；复核包第 14 项要求 429/503 均可校验。
- 最小修复：增加明确的 `http_503` 映射（例如映射至已有 `source_unavailable`，或新增具有稳定语义的原因并纳入 `stable_reasons`），同时保持 `fact_first=true`、继续下一个适用来源且 unknown 不写 0。

## 7. 独立自动检查结果

复核者直接读取冻结候选并运行只读 PowerShell 检查，未采用实施报告的结论替代复核。

| 检查 | 结果 |
| --- | --- |
| 候选 SHA-256 | PASS；与冻结哈希一致 |
| UTF-8 JSON 解析 | PASS |
| 需求 ID | 16/16；重复 0、缺失 0、额外 0 |
| JSON Pointer | 36；不存在 0；空语义占位 0 |
| 八级 tier | 顺序和值均正确；但见 F-01 的运行次序冲突 |
| source_id | 11 个，唯一 |
| 关键来源状态 | USDA 启用权威公共；OFF 条件只读；中国疾控待授权禁用；生产商逐域条件 |
| 外部来源字段子集 | 检查 4 项；越过全局 allowlist 为 0 |
| denylist | 计划与复核包要求的 15 项均存在；allow/deny 交集 0 |
| 记录 ID/健康目标/照片/身份绕过 | 全局 allowlist 命中 0 |
| 缓存键 | 9 字段；与禁止键交集 0；个人/事件上下文模式命中 0 |
| 真实凭据样式 | `sk-`、`AIza`、GitHub token、Slack token、Bearer token 命中 0 |
| 失败稳定原因 | 12 个要求原因齐全 |
| 事件映射 | timeout、429、缺密钥、许可、禁用、无结果、歧义、变体冲突、缺字段、完整性均存在；503 缺失 |
| unknown 与 fact-first | `unknown_is_zero=false`、缺字段填充值为 null、`fact_first=true` |
| 旧历史静默刷新 | 明确禁止 |

## 8. 业务数据隔离

| 时点 | `.jsonl/.sqlite/.sqlite3/.db` 数量 | 新增 | 修改 | 删除 |
| --- | ---: | ---: | ---: | ---: |
| 写入复核报告前 | 0 | 0 | 0 | 0 |
| 写入复核报告后（2026-08-09 15:43:00 +08:00） | 0 | 0 | 0 | 0 |

复核只创建本报告；未修改候选、实施报告、简报、总计划、上游契约、案例或 Schema。

## 9. 初审历史与复审入口

本节保留第 1 轮 FAIL 历史，后续不得覆盖。修复后复审必须：

1. 记录新的候选 SHA-256；
2. 验证 F-01、F-02 的最小修复且无范围扩张；
3. 重新执行有效 JSON、16/16 trace、36 个 Pointer、来源、隐私、缓存、凭据、失败降级和业务数据前后检查；
4. 在本文件追加“第 2 轮复审”小节；只有所有中/高发现关闭时才可将最新结论写为 PASS。

## 10. 第 2 轮独立复审

### 10.1 最新结论

- 复核轮次：第 2 轮独立复审
- 复核者：`/root/nutrition_source_review`
- 复核日期：2026-08-09（Asia/Shanghai）
- 最新结论：**PASS**
- 新冻结候选：`shared/nutrition-source-registry.json`
- 冻结及实际 SHA-256：`F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B`
- 新冻结实施报告 SHA-256：`63A73017DEB50F405BF11AD4EC9C10F453665FF5D12A7C8B0DCE4E23EEF39575`
- 第 1 轮发现：F-01 已关闭；F-02 已关闭
- 新发现：0
- 剩余高/中阻断：0
- 复核包 16 项标准：16 PASS / 0 FAIL
- 16 条需求语义：16 PASS / 0 FAIL
- 结构追踪：16/16；重复 0、缺失 0、额外 0；36 个 JSON Pointer 失败 0、空语义 0

### 10.2 第 1 轮发现关闭证据

| 发现 | 复审 | 精确证据 | 交叉检查结论 |
| --- | --- | --- | --- |
| F-01：缓存/历史可能反转 tier 优先级 | **已关闭** | `/cache_policy/lookup_order/priority_scoped=true`；`/cache_policy/lookup_order/tier_order_pointer=/priority_policy/ordered_tiers`；第 242—250 行要求任何结果被接受前按 rank 1—8 判定当前 tier，只能在当前 tier 内走本地证据、该 tier/来源缓存、该 tier/来源网络，并明确低层缓存和历史不能抢先。 | 额外交叉核对 `/failure_policy/fallback_order` 第 295—300 行。该数组仍列可用性类别，但它不是第二套 tier 排名：`tier_traversal` 明确约束“接受任何结果前”先应用 tier，两个布尔不变量又直接禁止低层缓存和历史抢先。因此实现若在适用的生产商精确层之前接受历史结果，会直接违反新机器约束；没有合法冲突路径。503 专项 fallback 也明确限定“当前 tier/来源缓存，再按优先级进入下一适用 tier”。 |
| F-02：缺少 HTTP 503 稳定降级 | **已关闭** | `/failure_policy/http_503` 第 318—324 行：默认 `source_unavailable`；只有响应或登记元数据明确全局限流时为 `rate_limited`；禁止即时循环/重试风暴；遵守有效 Retry-After 并使用有界退避；先查当前 tier/来源合规缓存，再按优先级降级且不否认饮食事实。 | 与 Open Food Facts 第一方 API 文档“全局限流可返回 HTTP 503”一致；没有把未知 503 一律误报为限流，也没有改变 fact-first 或 unknown != 0。 |

### 10.3 复核包 16 项标准重跑

| # | 标准 | 结果 | 第 2 轮独立证据 |
| ---: | --- | --- | --- |
| 1 | JSON、身份、上游、状态来源 | PASS | UTF-8 JSON 解析成功；顶层身份、`status_source`、上游路径及 SHA 一致。 |
| 2 | 16 条唯一追踪和非空 Pointer | PASS | 16 项；重复/缺失/额外均 0；36 Pointer 失败 0、空语义 0。 |
| 3 | 八级优先级不可颠倒 | PASS | tier 精确为 rank 1—8；priority-scoped 遍历、低层缓存禁止抢先、历史禁止抢先三个机器约束成立；F-01 关闭。 |
| 4 | 八类来源/策略适用边界 | PASS | 当前标签、生产商、历史、公共库、可信互联网、模板、估算、unknown 边界无退化。 |
| 5 | USDA FDC 事实与限制 | PASS | 官方 URL、CC0、API key、1000 次/小时/IP、429、版本/抓取分离和 Branded 非精确标签限制均保留。 |
| 6 | Open Food Facts 社区、只读、许可与缓存 | PASS | v3.6、社区质量限制、15/10 次限流、User-Agent、ODbL/DbCL、写入/照片/用户标识关闭、持久缓存关闭和来源隔离均保留。 |
| 7 | 中国疾控待授权禁用 | PASS | `disabled_pending_authorization`；请求字段 0；缓存/再分发 false；无公开机器 API 宣称。 |
| 8 | 生产商逐域和精确 SKU | PASS | 条件逐域登记，官方域名/robots/条款/频率/SKU 门禁存在，缓存及再分发默认 false。 |
| 9 | 请求 allowlist/denylist | PASS | 4 个外部项字段均为全局 allowlist 子集；计划要求的 denylist 无缺失；生活/记录/健康/图片/身份字段绕过 0。 |
| 10 | 密钥与日志 | PASS | 运行时秘密引用；真实凭据样式命中 0；日志禁止原话、密钥、图片、数据库与原始响应。 |
| 11 | 缓存键、版本、撤销和历史 | PASS | 9 个缓存键无个人/事件字段；版本与 `retrieved_at` 分离；刷新、许可变化、撤销和完整性失败不静默改写历史。 |
| 12 | 精确匹配与加工边界 | PASS | 品牌、规范名、变体、包装/标签版本、条码、生熟/加工状态、可食部边界保留；加工饮料不套普通资料。 |
| 13 | 证据标签和逐字段推定 | PASS | explicit、history、personal template、public reference、field inference、unknown 六类完整；逐字段元数据无退化。 |
| 14 | 全部失败 fact-first 降级 | PASS | 12 个稳定原因齐全；timeout、429、503、缺密钥、许可、禁用、无结果、歧义、变体、缺字段、完整性映射全部存在；F-02 关闭。 |
| 15 | 无越权冻结或提前完成 | PASS | 无任务 `status` 字段；未实现 Schema、客户端、案例或保质期规则；实施报告未提前宣布完成。 |
| 16 | 正式业务数据无变化 | PASS | 第 2 轮写报告前为 0；写后最终复扫见 10.7。 |

### 10.4 16 条需求语义复审

| 需求 | 结果 | 复审说明 |
| --- | --- | --- |
| `REQ-NUTR-001` | PASS | 精确八级次序与 priority-scoped 执行不变量共同关闭 F-01。 |
| `REQ-NUTR-002` | PASS | 常见原始/基础食品主动补全，`/cache_policy/lookup_order` 现为有实际语义的对象。 |
| `REQ-NUTR-003` | PASS | 包装、精加工、高度自定义食品优先精确证据，失败不冒充精确。 |
| `REQ-NUTR-004` | PASS | 加工饮料禁止套普通牛奶/果汁资料。 |
| `REQ-NUTR-005` | PASS | unknown 不等于 0，缺失字段为 null/unknown。 |
| `REQ-NUTR-006` | PASS | 用户明确数量、精确标签和确定换算均为明确证据。 |
| `REQ-NUTR-007` | PASS | 历史仅精确同版本复用，并显示“沿用历史营养表”。 |
| `REQ-NUTR-008` | PASS | 激活个人模板显示“按个人模板”且不冒充其他来源。 |
| `REQ-NUTR-009` | PASS | 公共参考简洁回执和详情追溯边界保留。 |
| `REQ-NUTR-010` | PASS | 推定保存采用值、依据、来源、来源版本和规则版本。 |
| `REQ-NUTR-011` | PASS | 估算逐字段保存，不给整项笼统贴估算。 |
| `REQ-PRIV-001` | PASS | 全局 allowlist 6 字段，来源只能收窄。 |
| `REQ-PRIV-002` | PASS | 原话、会话、日期餐次、库存、位置、异常、模板历史、数据库均禁止发送。 |
| `REQ-PRIV-003` | PASS | 来源登记、版本/抓取、匹配、允许字段和缓存键均可追溯。 |
| `REQ-PRIV-004` | PASS | 日志最小化并禁止敏感内容。 |
| `REQ-PRIV-005` | PASS | 密钥仅运行时引用；缺密钥只降级营养，不阻断事实。 |

### 10.5 来源真实性、许可和缓存复审

| 来源 | 结果 | 第 2 轮结论 |
| --- | --- | --- |
| USDA FoodData Central | PASS | 登记事实与第一方 API/下载页一致；CC0 允许缓存/再分发，仍保留来源、版本、发布日期、抓取时间和 Branded 限制。 |
| Open Food Facts | PASS | 社区来源、只读、条码候选、质量限制、限流、User-Agent、ODbL/DbCL 和默认不持久缓存均未改变；503 新规则与第一方说明一致。 |
| 中国疾控公共卫生科学数据中心 | PASS | 继续待授权禁用；官方页面不足以证明公开机器 API，候选没有扩大使用权。 |
| 生产商精确商品类别 | PASS | 继续逐域、逐条款、精确 SKU 激活；不存在已启用统一公网来源，默认不缓存、不再分发。 |

### 10.6 独立自动检查摘要

| 检查 | 第 2 轮结果 |
| --- | --- |
| 候选/实施报告冻结哈希 | 均一致 |
| JSON | PASS |
| 追踪 | 16/16；重复 0、缺失 0、额外 0 |
| Pointer | 36；失败 0、空语义 0 |
| tier | 精确 1,2,3,4,5,6,7,8 |
| F-01 专项 | lookup 为对象；priority-scoped=true；tier pointer 正确；低层缓存禁止抢先=true；历史禁止抢先=true |
| F-01 fallback 交叉 | 通用 fallback 不能覆盖“接受任何结果前先按 tier”及两个显式禁止不变量；503 fallback 另有当前 tier/按优先级限定 |
| 来源 | 11 个 source_id，唯一；4 个外部来源状态、许可和缓存边界符合登记 |
| 请求隐私 | 外部字段子集错误 0；denylist 缺失 0；allow/deny 交集 0；绕过 0 |
| 缓存隐私 | key/deny 交集 0；个人/事件字段模式命中 0 |
| 凭据 | 真实 secret 样式命中 0；`runtime_secret_reference_only` |
| F-02 专项 | 503 默认 source_unavailable；明确全局限流才 rate_limited；禁止重试风暴；按当前 tier 缓存和下一适用 tier 降级 |
| 失败覆盖 | 12 稳定原因无缺失；11 类要求映射全部存在 |
| fact-first/unknown | true / false；缺失值为 null |
| 历史更新 | 刷新、撤销、许可和完整性变化不静默改写 NutritionSnapshot |

### 10.7 第 2 轮业务数据隔离

| 时点 | `.jsonl/.sqlite/.sqlite3/.db` 数量 | 新增 | 修改 | 删除 |
| --- | ---: | ---: | ---: | ---: |
| 第 2 轮写入复审记录前 | 0 | 0 | 0 | 0 |
| 第 2 轮写入复审记录后（2026-08-09 15:52:18 +08:00） | 0 | 0 | 0 | 0 |

第 2 轮只追加本复核报告；没有修改候选、实施报告、简报、复核包、计划、上游契约、案例、Schema 或正式业务数据。
