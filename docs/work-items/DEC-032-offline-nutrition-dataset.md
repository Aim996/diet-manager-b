# DEC-032：离线营养数据集（去除网络/代理依赖）

> 状态：**已批准（用户拍板 2026-08-19）** · 关联版本线 0.2.0（在 candidate-009 未发布前并入，重建 candidate-010）
> 权威性：用户 2026-08-19 明确「开源项目不能假设所有环境都有代理可用，营养方案不能依赖代理——要么把有效资源数据下载写入 skill，要么找别的方式」。本 DEC 将「营养解析去网络化」正式立项。

---

## 1. 背景与问题定位（已核实）

- 当前生产营养解析**唯一来源 = USDA FoodData Central HTTP**（`public.usda_fooddata_central`，network + 需要 `env:FDC_API_KEY`）。无 key/无网络 → 一律降级 `terminal.unknown`。
- `builtin.ts` 里的离线数据（`COMMON_FOODS` 6 食物 + `COMMON_DISHES` 2 菜）**并未接入解析链**（`createBuiltinNutritionAdapters()` 未被 `plugin.ts` 调用），只被 `water-correction.ts` 的白水改判用来取牛奶营养；且键名与解析器词表不一致（`chicken_breast` vs 解析器 `chicken`），且是 `generic_estimate`（通用估计），非权威来源。
- 餐食解析器词表是**封闭的 12 项**：`chicken` / `soy_milk` / `fried_rice` / `banana` / `bread` / `coffee` / `apple` / `milk` / `egg` / `rice` / `soup` / `tea`。
- 真实验收 `REAL-0.1.1-nutrition-hit`（牛奶 200ml）依赖网络+key，在透明代理环境（4–15s vs 2000ms 截止）**不可达**。offline/timeout/missing-key 三场景都断言降级为 unknown——整套验收语义绑定网络。
- USDA FoodData Central 数据为**美国政府公有领域作品**，可合法下载并随开源 skill 分发。

## 2. 决策

**DEC-032：以「离线权威数据集」取代网络依赖——把餐食词表 12 项的 USDA FDC 权威营养值下载后固化进 skill，离线解析链无条件接通，网络 FDC 降级为可选项（非发布门禁）。**

- 数据源：USDA FDC（Foundation / SR Legacy），公有领域。逐项记录 `fdcId` / `dataType` / `publicationDate` / `source_ref`（FDC 页面 URL）作为出处，`source_type = authoritative_public_database`。
- 覆盖：封闭词表 12 项。其中约 10 项在 USDA 有权威单一记录（milk / egg / apple / banana / bread / rice / chicken / coffee / tea / soy_milk）；复合菜 `fried_rice`、`soup` 无单一权威来源，保留为版本化通用模板（`versioned_common_dish_template`）。
- 解析链（离线无条件接通）：离线 USDA bundle（rank 4 权威）→ `versioned_common_dish_template`（rank 6）→ `generic_estimate`（rank 7）→ `unknown`（rank 8）。
- 网络 FDC：**降级为可选增强**，仅当用户显式配置 `env:FDC_API_KEY` 且有网络时激活，用于未来开放词表扩展；**不参与发布门禁、不被依赖**。

## 3. 关键设计点

- **离线数据固化**：数据随源码提交（构建期一次性下载 + 转写），运行时零网络、零 key、零代理。
- **词表对齐**：修掉 `chicken_breast` → `chicken` 等键名不一致，离线数据键名与解析器 `LEXICON` 严格同源。
- **出处可验证**：每条记录携带 FDC fdcId + publicationDate，`retained_fields_sha256` 覆盖出处字段，与 HTTP 路径同构（保证未来若同时启用在线路径，语义一致）。
- **coffee / tea**：USDA 有黑咖啡/清茶冲泡液记录（≈0 kcal），按饮品记录。

## 4. 契约/配置变更

- 不新增公开动作，`contract v3` 不变。
- 新增离线源 `public.usda_fooddata_central_bundled`（rank 4，`authoritative_public_database`，network:false）入 `REGISTERED_SOURCE_TIERS` 与 `assertV1NutritionSource` 白名单；**始终启用，无需配置**。
- `nutritionConfigSchema.sources` 仍只描述可选网络 FDC（现状不变）；`credential_refs` 不变。

## 5. 验收语义修订（scenarios.json nutrition 段）

| 场景 | 旧语义（网络） | 新语义（离线） |
|---|---|---|
| nutrition-hit（牛奶） | requires_fdc_key，coverage≠unknown | **离线命中**：无 key/无网络，coverage≠unknown，source=authoritative_public_database |
| nutrition-missing-key / -offline / -timeout（牛奶） | 降级 unknown | **离线仍命中**：coverage≠unknown（bundle） |
| nutrition-no-result（香蕉） | 无结果→unknown | 香蕉在词表+USDA → 离线命中 coverage≠unknown（或按真实数据判定） |

（具体断言以实现后 O-5 切片确定的真实值为准；「真正 unknown」仅对未映射输入保留。）

## 6. TDD 实施切片（WIP=1，先红后绿）

| 切片 | 内容 | 先证 RED |
|---|---|---|
| O-1 | 离线 USDA 数据模块（12 项，含 fdcId/publicationDate 出处）+ 冻结加载 + 完整性 | 数据加载失败/出处缺失 |
| O-2 | 新离线适配器 `public.usda_fooddata_central_bundled` + 无条件接入解析链 | 无 key 无网络下 milk 解析为权威命中 |
| O-3 | 词表键名对齐（chicken 等）+ 12 项全离线解析 | 每个词表项离线命中/模板命中 |
| O-4 | 网络 FDC 降级为可选（仅配置 key 才激活，否则不参与） | 不配 key 时解析链不含网络源 |
| O-5 | scenarios.json nutrition 段修订 + 全量回归 + 重建 candidate-010 | 离线命中场景绿，无网络依赖 |

## 7. 风险与边界

- **数据转写忠实**：值从 FDC API 响应逐项转写，记录出处；不手工估算。
- **复合菜无权威源**：`fried_rice` / `soup` 保留通用模板，`source_label` 如实标注。
- **网络代码保留为可选增强（已拍板）**：在线 FDC 仅在用户显式配置 `env:FDC_API_KEY` 时启用，不参与发布门禁；不删除代码，便于未来开放词表。
- **版本线**：0.2.0 未发布，本 DEC 并入 0.2.0（重建 candidate-010），不 bump 版本号、不动 0.1.1 台账/ledger。
