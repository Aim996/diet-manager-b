# EV-20260809-007：SH-CONTRACT-003 营养来源注册表验证证据

## DOC-0.3 结构化元数据补充

```yaml
evidence_schema_version: EV-v2
evidence_id: EV-20260809-007
started_at: 2026-08-09T15:54:46+08:00
finished_at: 2026-08-09T15:54:46+08:00
timezone: Asia/Shanghai
task_ids:
  - SH-CONTRACT-003
case_ids:
  - CASE-NUTR-010
  - CASE-NUTR-011
requirement_ids:
  - REQ-NUTR-001
  - REQ-NUTR-002
risk_ids: []
change_ids: []
contract_versions:
  business_contract: CONTRACT-v1@CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
  nutrition_source_registry: F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B
official_data_roots: []
scanned_roots:
  - E:\codx\skill\饮食管家
isolated_test_roots: []
business_impact: zero
verdict: PASS
executor: Codex
independent_reviewer: "独立注册表复核者（遗留证据未登记实名，复核文件见docs/work-items/SH-CONTRACT-003-review.md）"
independent_reviewed_at: 2026-08-09T15:54:46+08:00
```

`CASE-NUTR-010`与`CASE-NUTR-011`是在DOC-0.3中对本证据当时已经实际执行并冻结的技术Oracle补上的稳定追踪名称，不是事后伪称重新执行：010逐项对应原始输出中的JSON解析、16/16语义追踪、36/36指针、来源状态和白名单；011逐项对应`CACHE_PRIORITY_SCOPED=True`及两类HTTP 503稳定映射。案例文字没有扩大原检查范围，原始输出和候选hash保持不变。本证据仍未执行营养摄入业务案例；客户端、缓存、营养计算和业务闭环由后续任务负责。

### 逐命令结果

| command_id | 工作目录/命令 | exit_code | route_result |
|---|---|---:|---|
| `registry-validator` | 项目根；`docs/evidence/raw/EV-20260809-007-validate-nutrition-source-registry.ps1` | 0 | 16/16语义、36/36指针、白名单/秘密/失败映射PASS |
| `business-scan` | 项目根；`.jsonl/.sqlite/.sqlite3/.db`前后只读扫描 | 0 | 前0、后0；新增/修改/删除均0 |

该次验证开始与结束只记录到秒且落在同一秒，故两个时间相同，不代表未执行。前后manifest为空集；不存在用户正式数据根，也没有把空集证明扩大为预置数据不变证明。

## 1. 结论

- 任务：`SH-CONTRACT-003`
- 最终结论：`PASS`
- 验证时间：2026-08-09 15:54:46 +08:00
- 验证环境：Windows NT 10.0.26200.0；Windows PowerShell 5.1.26100.8875；项目根 `E:\codx\skill\饮食管家`
- 候选：`shared\nutrition-source-registry.json`
- 候选 SHA-256：`F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B`
- 独立复审：第 1 轮 FAIL 后修复，第 2 轮 PASS；16/16 复核标准、16/16 需求语义、36/36 JSON Pointer 全部通过；剩余高/中阻断 0。
- 正式业务数据：验证前 0，验证后 0，新增/修改/删除 0。

## 2. 冻结输入与交付物

| 文件 | SHA-256 | 说明 |
| --- | --- | --- |
| `docs\work-items\SH-CONTRACT-003-brief.md` | `2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D` | 16 条任务范围及实现边界 |
| `shared\business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | 上游 CONTRACT-v1 |
| `shared\nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` | 最终候选 |
| `docs\work-items\SH-CONTRACT-003-report.md` | `63A73017DEB50F405BF11AD4EC9C10F453665FF5D12A7C8B0DCE4E23EEF39575` | 实施与两项修复审计 |
| `docs\work-items\SH-CONTRACT-003-review-package.md` | `83C6E3CF6CF11C10D3F213A956E90C1D8CDF399AA9981815625F692E9F7CFFD6` | 第 2 轮冻结复核包 |
| `docs\work-items\SH-CONTRACT-003-review.md` | `D3E4AF697170C2D1BC7B49251A475DEE84E6272B026155A9A8971783C43F4A87` | 独立复审；保留第 1 轮 FAIL 历史 |

## 3. 官方来源核验结果

### 3.1 USDA FoodData Central

- 官方 API 指南：`https://fdc.nal.usda.gov/api-guide/`
- 官方版本化下载：`https://fdc.nal.usda.gov/download-datasets/`
- 核验结论：注册为 `enabled_authoritative_public`。API 需要运行时密钥，官方默认限流为每 IP 每小时 1000 次；数据为公共领域并按 CC0 发布。缓存必须保存 FDC 稳定记录标识、数据类型、发布版本/日期、抓取时间和内容摘要，抓取时间不得冒充来源版本。
- 适用边界：常见原始食材、基础食品及加工/生熟状态可可靠匹配的公共参考；FDC Branded 记录不得自动冒充当前生产商标签或精确中国商品。

### 3.2 Open Food Facts

- 当前 API 文档：`https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/`
- 许可说明：`https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/`
- 缓存说明：`https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/creating-a-local-cache-of-open-food-facts-data/`
- 核验结论：注册为 `conditional_read_only`，只可作为精确条码包装食品候选。社区数据不保证准确、完整或当前；不能冒充生产商或政府权威。产品读限流 15 次/分钟/IP，搜索限流 10 次/分钟/IP，且全局限流可返回 503。
- 安全边界：首版禁止写入、照片上传和发送 `app_uuid`/`user_id`；持久缓存默认关闭。只有实现来源隔离、ODbL 归因/同许可处理后才可通过后续变更启用。

### 3.3 中国疾控食物成分目录

- 官方目录：`https://www.phsciencedata.cn/Share/ky_sjml.jsp?id=577e0301-ab65-432a-9bb7-a8342302e589`
- 官方用户指南：`https://www.phsciencedata.cn/Share/jsp/PublishManager/userGuide.jsp`
- 官方申请条件：`https://www.phsciencedata.cn/Share/edtShare.jsp`
- 核验结论：注册为 `disabled_pending_authorization`。官方页面证明数据目录存在，但完整数据需要申请、协议和责任书；未核验到公开机器 API 或允许本项目作为对外服务自动使用、缓存、再分发的授权。当前不得自动访问或缓存营养记录。

### 3.4 生产商来源

生产商官方资料是来源类别而非统一 API，注册为 `conditional_per_domain_allowlist`。每个域名必须独立登记官方域、条款复核时间、读取/缓存/再分发权利、速率和精确 SKU/条码匹配；缺条款或缺精确匹配时默认禁用，禁止开放全网抓取。

## 4. 独立复审与修复历史

第 1 轮复审结论为 FAIL，共 2 个中严重度阻断：

1. `F-01`：原 `/cache_policy/lookup_order` 可能使已确认历史或低层缓存抢先于仍适用的高层精确来源。
2. `F-02`：原 `/failure_policy` 未显式覆盖 Open Food Facts 官方文档说明的 HTTP 503。

最终候选将缓存查找限定在当前来源优先级层内部，只有本层不存在适用可靠结果才进入下一层，并用两个布尔不变量禁止低层缓存/历史抢先。HTTP 503 现在稳定分类为：普通服务不可用使用 `source_unavailable`；有明确全局限流证据时使用 `rate_limited`；两者均禁止即时重试风暴并按当前层缓存和来源优先级降级。

第 2 轮由同一独立复核者完整重跑：F-01、F-02 均关闭，新发现 0，复核标准 16/16、需求语义 16/16、追踪 16/16、JSON Pointer 36/36，最终 PASS。

## 5. 主协调者最终验证

只读验证脚本：`docs\evidence\raw\EV-20260809-007-validate-nutrition-source-registry.ps1`

- 脚本 SHA-256：`0547DA3E187E8AAC4F0B1DDCD349675F00DF89A63D7F7E7338A90C8C8D4BD3B2`
- 原始输出：`docs\evidence\raw\EV-20260809-007-validation-output.txt`
- 输出 SHA-256：`E36D091A8F0EA2DF2AEA97D6BDDA708CB7A14F8D5934A35D326D985111BB8172`
- 退出码：0
- JSON：PASS
- 需求追踪：16/16
- JSON Pointer：36/36
- 八级优先级：顺序精确，缓存受层级约束
- 来源：FDC 启用、OFF 条件只读、中国疾控待授权禁用、生产商逐域条件启用
- 外部请求：全局 allowlist 6 项，各来源只能收窄；denylist 15 项
- 凭据：仅运行时秘密引用，未发现真实秘密值样式
- 失败：429 与 503 均有稳定映射，fact-first 保持
- 最终结果：`FAILURE_COUNT=0`、`VERDICT=PASS`

实际执行方式：

```powershell
$scriptPath='E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-007-validate-nutrition-source-registry.ps1'
$scriptText=Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
& ([scriptblock]::Create($scriptText))
```

## 6. 业务数据隔离证明

扫描根：`E:\codx\skill\饮食管家`

扫描扩展名：`.jsonl`、`.sqlite`、`.sqlite3`、`.db`

| 时点 | 文件数 | 路径/大小/SHA-256/mtime |
| --- | ---: | --- |
| 最终验证前（2026-08-09 15:54:46 +08:00） | 0 | 无 |
| 最终验证后（2026-08-09 15:54:46 +08:00） | 0 | 无 |
| 原始输出落盘后 | 0 | 无 |
| 本证据写入后（2026-08-09 15:56:17 +08:00） | 0 | 无 |

因此本任务的研究、实现、自检、两轮独立复审、主协调者验证和原始证据落盘都没有创建或修改 JSONL/SQLite 正式业务数据。

## 7. 仍属后续任务的边界

- 本任务只冻结来源注册表，不代表来源客户端、API key、限流器、缓存数据库或营养计算已经实现。
- Open Food Facts 持久缓存仍关闭；中国疾控目录仍待书面授权；生产商域名仍需逐个登记。
- 这些限制是显式安全门，不影响已经发生且可识别的饮食事实保存；网络失败或缺密钥只能让营养降级为缓存、模板、估算或 `unknown`。
