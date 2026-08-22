# SH-CONTRACT-003 实施报告：营养来源注册表

## 1. 实施身份与边界

- 任务：SH-CONTRACT-003
- 实施者：/root/nutrition_source_impl
- 实施时间：2026-08-09（Asia/Shanghai）
- 唯一状态来源：总功能开发计划0.2.md 第 22 节
- 交付物：shared/nutrition-source-registry.json
- 本报告仅说明候选实现和自检结果，不提前宣布任务已完成；最终状态须由独立复核、主协调者证据落账和计划更新决定。
- 未实现来源调用、密钥配置、营养计算、Schema、案例或任何 A/B/C 路线代码。

## 2. 输入核验

| 输入 | 要求 SHA-256 | 实际 SHA-256 | 结果 |
| --- | --- | --- | --- |
| docs/work-items/SH-CONTRACT-003-brief.md | 2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D | 2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D | 一致 |
| shared/business-contract.md | CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D | CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D | 一致 |

修改前扫描 E:\codx\skill\饮食管家 下扩展名为 .jsonl、.sqlite、.sqlite3、.db 的正式业务数据文件，结果为 0。

## 3. 候选交付物

| 文件 | SHA-256 | 字节数 |
| --- | --- | ---: |
| shared/nutrition-source-registry.json | F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B | 35104 |

注册表为无注释 UTF-8 JSON，包含版本身份、8 级不可颠倒优先级、营养字段/计量基准、证据标签、请求/凭据/日志边界、缓存/版本/撤销治理、失败 fact-first 降级、11 个网络或本地策略注册项和 16 条逐项追踪。

## 4. 官方来源核验

核验时间均为 2026-08-09。这里只记录官方或第一方页面支持的事实；搜索摘要和模型记忆未登记为来源。

### 4.1 USDA FoodData Central

- 官方 API 指南：https://fdc.nal.usda.gov/api-guide/
- 官方数据下载：https://fdc.nal.usda.gov/download-datasets/
- CC0 许可：https://creativecommons.org/publicdomain/zero/1.0/
- 已核验事实：API 需要运行时 API key；默认限制为每 IP 每小时 1000 次，超限可返回 429；FoodData Central 数据按 CC0 公共领域提供，并要求保留 FoodData Central 和源数据归属；官方提供版本化 JSON/CSV 数据发布。
- 登记结论：enabled_authoritative_public。缓存保留 fdcId、dataType、publicationDate、数据发布版本、retrieved_at 和内容摘要；抓取时间不冒充数据版本。

### 4.2 Open Food Facts

- 当前 API 文档：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
- 许可教程：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/
- 本地缓存教程：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/creating-a-local-cache-of-open-food-facts-data/
- 已核验事实：当前文档为 Product Opener API v3.6；社区维护数据不保证准确或完整；数据库适用 ODbL/DbCL 条件；产品读取为每 IP 每分钟 15 次、搜索为每 IP 每分钟 10 次；需要自定义 User-Agent；上传照片会公开。
- 登记结论：conditional_read_only。只允许条码精确候选读取，不允许写入、照片上传或发送 app_uuid/user_id；不能冒充生产商或政府权威。持久缓存默认关闭，只有实现 ODbL 归因、同许可共享和来源隔离后才可另行启用；OFF 数据不得与外部产品数据混合。

### 4.3 中国疾控公共卫生科学数据中心食物成分目录

- 中国疾控数据网络介绍：https://www.chinacdc.cn/gzdt/zsdw/202509/t20250929_312801.html
- 官方数据目录：https://www.phsciencedata.cn/Share/ky_sjml.jsp?id=577e0301-ab65-432a-9bb7-a8342302e589
- 官方用户指南：https://www.phsciencedata.cn/Share/jsp/PublishManager/userGuide.jsp
- 官方申请入口：https://www.phsciencedata.cn/Share/edtShare.jsp
- 已核验事实：数据目录和数据网络存在；完整数据需要申请和协议，未经允许不得转供、作为对外服务产品或经营使用；未核验到公开机器 API 或一般机器使用许可。
- 登记结论：disabled_pending_authorization。当前只作人工治理参考，不自动访问、不缓存营养记录、不宣称已获得使用权；获得书面授权、机器接口及缓存/再分发边界后才可复审激活。

### 4.4 生产商精确商品资料

- 该项是条件来源类别，不是虚构的统一公网 API。
- 登记结论：conditional_per_domain_allowlist。每个生产商域名必须分别核验所有权、canonical URL、robots、条款、频率、归因、缓存和再分发权；默认持久缓存和再分发均为 false，不允许开放全网抓取。
- 版本策略：SKU/条码、canonical URL、页面明确更新时间；没有明确版本时使用响应内容 SHA-256。retrieved_at 只表示抓取时间，不得冒充 source version。

### 4.5 WS/T 464—2015

- 仅登记为字段语义参考，不作为营养数值源。
- 可用于字段和未知值表达规范；不得据此生成食物营养数值。

## 5. 关键设计取舍

1. 优先级严格冻结为：当前精确标签、生产商/精确商品、确认同商品历史、权威公共库、白名单可信互联网、版本化常见菜模板、通用估算、unknown。每个层级都有适用判定，低层不能覆盖或伪装高层。
2. 普通原始食材和基础食品走本地已确认资料、合规缓存、FDC 等公共来源，不要求用户上传标签；包装、精加工、高度自定义食品仍需精确资料。
3. 同商品历史复用至少要求品牌、规范名、变体、包装/标签版本全部相符；任何实质冲突都不是精确匹配。
4. 加工饮料、未知套餐和拼盘有硬边界：通用牛奶/果汁资料不得套用差异明显配方；未知组合不拆解，只保存饮食事实并保持营养 unknown。
5. unknown 明确不等于 0。部分字段缺失只令该字段 unknown；逐字段推定只给受影响字段附 adopted_value、basis、source、source record version 和 rule version，不给整条记录笼统贴估算。
6. 请求采用全局 allowlist，各来源只能收窄；完整原话、会话、日期餐次、库存、位置、异常、个人模板历史、数据库行、营养图片和密钥永久 deny。
7. 缓存键只由来源、来源版本、非个人匹配字段和语言组成。缓存保存稳定来源 ID、版本、计量基准、匹配强度、字段覆盖、内容 SHA-256 和许可复核时间；刷新只影响未来解析。
8. 所有外部失败 fact-first：先本地确认、合规缓存、下一适用已启用来源、模板/有依据估算，最后 unknown；缺密钥、限流、许可不明或完整性失败都不能否认已发生且可识别的饮食事实。

### 5.1 第 1 轮独立复核 FAIL 与最小修复审计

第 1 轮独立复核冻结候选 SHA-256 为 AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1，结论 FAIL，共有两个中严重度阻断项。本轮没有覆盖这段历史，也没有自行宣布复审通过。

| 发现 | 初审问题 | 最小修复 | 专项自检 |
| --- | --- | --- | --- |
| F-01 | 原 cache_policy.lookup_order 容易被解释为确认历史或任意低层缓存可早于仍适用的高层来源终止解析，削弱 REQ-NUTR-001。 | lookup_order 改成优先级作用域对象：先按 ordered_tiers 从 rank 1 到 8 确定当前适用层，仅在当前层内按直接本地证据、该层该来源合规未过期缓存、该层该来源启用网络查询排序；当前层无适用可靠结果后才进入低层。增加 priority_scoped、lower_tier_cache_cannot_preempt_applicable_higher_tier 和 confirmed_history_cannot_preempt_current_label_or_manufacturer_exact 三个可机检布尔约束。REQ-NUTR-002 仍指向 /cache_policy/lookup_order，且所指对象具有实际语义。 | PRIORITY_SCOPED=True；LOWER_TIER_CACHE_CANNOT_PREEMPT=True；HISTORY_CANNOT_PREEMPT=True。 |
| F-02 | failure_policy 没有显式覆盖 HTTP 503，而 OFF 官方说明全局限流可能返回 503。 | 新增 http_503 对象：普通 503 稳定映射 source_unavailable；仅当响应或已登记来源元数据明确表明全局限流时映射 rate_limited；禁止即时循环/重试风暴，遵循有效 Retry-After 并在当前事实优先解析之外使用有界退避；先尝试当前层该来源的合规未过期缓存，再按优先级降级。 | HTTP503_DEFAULT=source_unavailable；GLOBAL_LIMIT=rate_limited；HTTP503_NO_RETRY_STORM=True。 |

修复后候选 SHA-256 为 F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B。修复仅涉及上述缓存解析边界和 503 降级映射；来源选择、许可状态、隐私边界及其他需求语义未扩张。

## 6. 16 条追踪结果

| 需求 | 注册表稳定路径 | 自检 |
| --- | --- | --- |
| REQ-NUTR-001 | /priority_policy/ordered_tiers；/priority_policy/selection_rule | 通过 |
| REQ-NUTR-002 | /priority_policy/special_boundaries/common_raw_or_basic_food；/cache_policy/lookup_order | 通过 |
| REQ-NUTR-003 | /priority_policy/special_boundaries/packaged_processed_or_highly_custom_food；/evidence_label_policy/historical_profile_exact_match | 通过 |
| REQ-NUTR-004 | /priority_policy/special_boundaries/processed_beverage；/sources/7/match_scope | 通过 |
| REQ-NUTR-005 | /priority_policy/unknown_is_zero；/nutrition_field_policy/missing_field；/nutrition_field_policy/missing_field_fill_value | 通过 |
| REQ-NUTR-006 | /nutrition_field_policy/quantity_evidence 下三个明确证据字段 | 通过 |
| REQ-NUTR-007 | /evidence_label_policy/historical_profile_exact_match；/sources/2/evidence_label | 通过 |
| REQ-NUTR-008 | /sources/6/evidence_label；/sources/6/quality_limitations | 通过 |
| REQ-NUTR-009 | /evidence_label_policy/labels/3；/sources/3/evidence_label | 通过 |
| REQ-NUTR-010 | /nutrition_field_policy/quantity_evidence/inference_required_metadata；/sources/8/version_strategy | 通过 |
| REQ-NUTR-011 | /nutrition_field_policy/partial_inference_rule；/sources/8/field_mapping | 通过 |
| REQ-PRIV-001 | /external_request_policy/global_allowlist；/external_request_policy/source_can_only_narrow_global_allowlist | 通过 |
| REQ-PRIV-002 | /external_request_policy/global_denylist；/external_request_policy/free_text_or_life_context_allowed | 通过 |
| REQ-PRIV-003 | /governance/network_source_must_match_effective_registry_entry；/cache_policy/key_fields；/cache_policy/required_entry_fields | 通过 |
| REQ-PRIV-004 | /logging_policy/default_allowlist；/logging_policy/forbidden | 通过 |
| REQ-PRIV-005 | /credential_policy/storage；/credential_policy/forbidden_destinations；/credential_policy/missing_credential_fact_effect | 通过 |

traceability 数组共 16 项，期望项 16、缺失 0、额外 0、重复 0；共 36 个 JSON Pointer，解析失败 0。

## 7. 只读验证命令与结果

### 7.1 JSON、追踪、优先级、来源状态和业务数据扫描

执行核心命令：

    $j = Get-Content -Raw -Encoding UTF8 shared\nutrition-source-registry.json | ConvertFrom-Json
    # 比较 16 个期望 REQ ID、8 个有序 tier、唯一 source_id、关键来源状态、unknown、密钥模式和业务数据扩展名

结果：

    JSON_PARSE=PASS
    TRACE=16/16; DUP=0; MISSING=0; EXTRA=0
    PRIORITY_EXACT=True
    SOURCE_IDS_UNIQUE=True; SOURCES=11
    FDC=enabled_authoritative_public
    OFF=conditional_read_only
    CHINA=disabled_pending_authorization
    MANUFACTURER=conditional_per_domain_allowlist
    UNKNOWN_NOT_ZERO=True
    SECRET_LIKE_VALUES=0
    BUSINESS_DATA_AFTER_REGISTRY=0
    FAILURES=0

初审修复后新增专项结果：

    PRIORITY_SCOPED=True
    LOWER_TIER_CACHE_CANNOT_PREEMPT=True
    HISTORY_CANNOT_PREEMPT=True
    HTTP503_DEFAULT=source_unavailable; GLOBAL_LIMIT=rate_limited
    HTTP503_NO_RETRY_STORM=True
    FAILURES=0

### 7.2 JSON Pointer、请求最小化、缓存键和失败原因

执行核心命令：

    # 逐条解析 traceability.paths；检查每来源 request_fields 为全局 allowlist 子集；
    # 检查缓存 key/denylist 无交叉；检查 12 个稳定失败原因、5 个核心营养字段和 6 个计量基准。

结果：

    TRACE_POINTERS=36; BAD=0
    EXTERNAL_SOURCES_CHECKED=4; REQUEST_POLICY_ERRORS=0
    SOURCE_ID_DUP=0
    CACHE_KEY_DENY_OVERLAP=0
    FAILURE_REASONS_MISSING=0
    NUTRIENT_FIELDS_MISSING=0; BASES_MISSING=0
    REAL_SECRET_PATTERNS=0
    FAILURES=0

## 8. 业务数据隔离

| 时点 | .jsonl/.sqlite/.sqlite3/.db 数量 | 新增/修改/删除 |
| --- | ---: | ---: |
| 修改前 | 0 | 0 |
| 注册表候选写入后 | 0 | 0 |
| 实施报告写入后（2026-08-09 15:34:18 +08:00） | 0 | 0 |
| 第 1 轮初审修复后（2026-08-09 15:45:01 +08:00） | 0 | 0 |

本任务没有创建或修改任何 JSONL、SQLite、SQLite3 或 DB 正式业务数据，也没有写入真实 API key、token、用户原话、会话数据或业务样例。

## 9. 剩余风险与后续门禁

- 注册表只冻结治理与可用边界，不代表来源客户端已经实现；FDC 的运行时 secret、限流和归因仍须在路线实现中验证。
- Open Food Facts 的 persistent_cache 保持 false；只有完成 ODbL 来源隔离、归因和 share-alike 设计并经复核后才能启用。
- 中国官方食物成分目录保持禁用；必须先获得适合本产品用途的授权、机器访问方式和缓存/再分发说明。
- manufacturer_exact 只是逐域注册机制；没有具体生效域名项时不得自动调用。
- JSON Pointer 当前包含 sources 数组下标；以后改变来源顺序必须同步迁移 traceability 并重新执行指针解析验证。
- 独立复核仍需核查官方事实表述、许可边界、逐字段推定语义和 16 条映射是否具有真实语义覆盖。
