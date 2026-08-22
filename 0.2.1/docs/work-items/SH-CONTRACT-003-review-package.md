# SH-CONTRACT-003 独立复核包

## 1. 冻结候选

| 项目 | 路径 | SHA-256 |
| --- | --- | --- |
| 任务简报 | `docs/work-items/SH-CONTRACT-003-brief.md` | `2C765BA658E22ECE62F59D653296BF7D914A6D6CF85CFB03B5CDE71C0CD5EE5D` |
| 上游契约 | `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| 候选注册表 | `shared/nutrition-source-registry.json` | `F340C0C11A5DD2BF10F19D5AA835F55D4AC7126EA008EF98FA18C131A7B9648B` |
| 实施报告 | `docs/work-items/SH-CONTRACT-003-report.md` | `63A73017DEB50F405BF11AD4EC9C10F453665FF5D12A7C8B0DCE4E23EEF39575` |

候选哈希变化即停止复核并报告 `candidate_changed`，不得审阅未冻结版本。

第 1 轮冻结候选 `AB0D7F766B988EFA0C4E632BE06D2EE4D01509B852C30EA01067A45ECA972BC1` 的复核结论为 FAIL；F-01（缓存绕过来源优先级）和 F-02（缺少 HTTP 503 显式降级）已由实现者修复。上表是第 2 轮唯一冻结候选，复核者必须保留第 1 轮审计并逐项确认两项关闭且无退化。

## 2. 结论标准

复核结论只能是 `PASS` 或 `FAIL`。只有同时满足以下条件才可 PASS：

1. JSON 有效、无注释、顶层身份/上游/状态来源可校验；
2. `REQ-NUTR-001~011`、`REQ-PRIV-001~005` 共 16 条各且仅一次追踪，指针均存在且不是空语义占位；
3. 八级优先级与总计划完全一致，适用高优先级不会被低层结果覆盖或冒充；
4. 当前标签、生产商精确资料、同商品历史、公共库、可信互联网、模板、估算和 unknown 的适用边界清楚；
5. USDA FDC 的身份、CC0、API key、限流、版本/稳定标识和缓存规则准确，不把 Branded 数据自动当生产商官方标签；
6. Open Food Facts 明确是社区来源，只读、精确条码候选、限流、自定义 User-Agent、ODbL/DbCL、默认不上传照片、不发用户标识；未满足来源隔离和 ODbL 条件时持久缓存关闭；
7. 中国疾控食物成分目录为 `disabled_pending_authorization`，不自动访问、不缓存数值、不暗示公开 API/机器许可；
8. 生产商来源必须逐域名/条款登记和精确 SKU 匹配，默认不得开放全网抓取、缓存或再分发；
9. 全局请求 allowlist 只含匹配必需字段，每来源只能收窄；denylist 包含计划所列全部生活上下文，且照片、记录 ID、健康目标、用户身份等不会借其他字段绕过；
10. 密钥仅运行时秘密引用，日志不含原话、密钥、图片或数据库；注册表不存在真实凭据样式；
11. 缓存键无个人/事件字段，来源版本与抓取时间分离，来源撤销/许可变化不会静默刷新历史 NutritionSnapshot；
12. 包装变体、品牌、条码、生熟/加工状态、可食部等匹配不足时不得静默精确命中；加工饮料不套普通牛奶/果蔬汁；
13. 明确、历史沿用、个人模板、公共参考和逐字段推定标签符合 `REQ-NUTR-006~011`；
14. 超时、429/503、缺密钥、许可不明、来源禁用、无结果、歧义、变体冲突、缺字段、完整性失败均 fact-first 降级，unknown 不变 0；
15. 注册表没有越权冻结 Schema、来源客户端或保质期规则；没有提前宣布任务完成；
16. 复核前后项目内 `.jsonl`、`.sqlite`、`.sqlite3`、`.db` 新增/修改/删除为 0。

## 3. 官方事实锚点

- USDA FDC API：https://fdc.nal.usda.gov/api-guide/
- USDA FDC 下载：https://fdc.nal.usda.gov/download-datasets/
- Open Food Facts API：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
- Open Food Facts 许可：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/
- Open Food Facts 缓存：https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/creating-a-local-cache-of-open-food-facts-data/
- 中国疾控目录：https://www.phsciencedata.cn/Share/ky_sjml.jsp?id=577e0301-ab65-432a-9bb7-a8342302e589
- 中国疾控用户指南：https://www.phsciencedata.cn/Share/jsp/PublishManager/userGuide.jsp
- 中国疾控申请条件：https://www.phsciencedata.cn/Share/edtShare.jsp

复核者不得用搜索摘要、第三方博客或模型记忆推翻上述第一方页面。若第一方页面本身未证明某项权利，应按“未核验/禁用”处理。

## 4. 输出要求

复核者只创建或更新 `docs/work-items/SH-CONTRACT-003-review.md`，不得修改候选、报告、计划或其他文件。报告至少包含：

- 候选哈希和前后业务数据快照；
- 16 条逐项 PASS/FAIL 表；
- 来源逐项真实性/许可/缓存结论；
- 所有发现的编号、严重度、精确 JSON Pointer/行号、影响和最小修复；
- 自己运行的 JSON/Pointer/优先级/隐私/来源/凭据/旧行为检查；
- 总结论与剩余阻断数。

任一高/中严重度发现、需求语义缺失、官方事实错误、隐私放宽、业务数据变化或候选哈希不一致都必须 FAIL。
