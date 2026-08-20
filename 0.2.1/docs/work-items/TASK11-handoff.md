# Task 11 交接文档（阶段 2 / Task 11「白水分类 + 库存位置纠正」）

> 状态：**Task 10 已全部完成并提交（commit `5df7dd4`，全量 993 例 GREEN）。Task 11 处于 Step 1（写失败测试）——已落一条白水分类 RED 测试并确认失败原因为 `ACTION_CONFLICT`，尚未写任何实现代码。** 工作树除未跟踪的测试/文档外干净，可直接续跑。

## 一、已完成快照（本会话）

- Task 10「公开接通餐食数量和发生时间纠正」已提交：13 文件、`feat: correct meal amount and time`。
  - 额外修复：`src/domain/service.ts` 新增 `meal_time` 校验分支；`src/domain/effect-bundle.ts` `preflightCorrectionNutrition` 加 `schema_version='domain/v2'` 过滤；`src/parser/meal.ts` 新增 `normalizeMealLexeme`。
  - 全量 `pnpm exec vitest run` = 37 文件 / 993 例全绿，`tsc --noEmit` 通过。
- Task 11 Step 1 已落：`tests/acceptance/water-correction.test.ts`（1 条 RED，确认失败：`ACTION_CONFLICT`）。
  - 失败原因：解析器把「刚才那杯不是白水，是牛奶」当成 `record_meal`（词表含「牛奶」lexeme），与请求 action `correct_record` 冲突 → `ACTION_CONFLICT`，而非识别成白水纠正。

## 二、Task 11 目标（计划原文 885–941 行）

两个子特性，一次提交（`feat: expose water and location corrections`）：

1. **白水分类纠正**（`刚才那杯不是白水，是牛奶`）：`change_food_type` 新领域路径。
2. **库存位置纠正泛化**（`这批牛奶其实放在常温柜/冷藏室`）：泛化既有 frozen 语法 + 多候选澄清。

## 三、关键事实（已核实，别再重查）

### 白水分类纠正（change_food_type）

- `change_food_type` 在 **DB 层已合法**：`src/storage/migration-v1.ts:21` 的 `correction_events.operation` CHECK 约束包含 `'change_food_type'`（连同 13 种操作）。但**领域层不支持**：
  - `src/repository/fact-commit.ts` `insertCorrectionFact`（556–640 行）的 allowlist 只有 `change_amount/change_nutrition_source/void_event/restore_event/change_time`；且 `correct_record` 命令只允许前三者。
  - `insertCorrectionFact` 硬编码 `SELECT ... WHERE event_id = ? AND event_type = 'diet_meal'`（620 行）——白水事件是 `diet_water`，需泛化或新增白水专用插入路径。
- 对外契约**已就绪**：`src/contracts.ts` `CorrectionOutcomeView.operation`（206 行）已含 `"change_water_classification"`，`assertCorrection`（498 行）也接受该值。**无需改契约**。
- 白水事件结构：`event_type='diet_water'`、`fact_kind='water'`、`authority_kind='diet-manager/water-fact/v1'`，载荷含 `plain_water_ml_milli`、`amount_evidence`、`occurred_time`、`source_text`、`timezone`、`estimated`（见 `effect-bundle.ts` `waterProgressFromStoredFact` 2761 行附近与 `query.ts` `listWaterEvents` 514 行）。白水身份用 `src/authority/water-fact-identity.ts`（`parseWaterFactPreviewMaterial`）。
- 白水进度：`daily_progress_snapshots` 的 `nutrients.water_ml_milli`（`query.ts` `summarizeDailyProgress` 601–660 行）。纠正后应归零。
- `resolveCorrectionTarget`（`src/repository/correction-target.ts`）**只认 meal**（`event_type='diet_meal'`，`readEffectiveMealState` 也仅 `diet_meal`）。白水纠正需一条独立的 `resolveWaterCorrectionTarget`（latest water in conversation → diet_water），或把该文件泛化。
- `CoreCorrectionTargetReference`（`parser/types.ts`）目前只有 `event_id | latest_meal_in_conversation`，需加 `latest_water_in_conversation`（或白水纠正专用 target）。

### 库存位置纠正泛化

- 既有实现**已全链路打通并测试**：`src/parser/purchase.ts` `resolvePantryCommand`（366 行）只认一条 frozen 句 `更正：这批牛奶放在冷藏室，不是常温柜` → `CoreInventoryLocationCorrectionCandidate`（`batch_reference:"this_batch"`、`previous_location:"room_temperature_cabinet"`、`next_location:"refrigerator"`）。
- `src/application/core-runtime.ts` `resolveLocationCorrection`（842 行）：按 `product_reference` 查 `inventory_batch_projections`，`candidates.length!==1` 时 **throw**（`location_correction_missing`/`location_correction_ambiguous`），不是澄清结果。Task 11 需把它改成返回 `needs_clarification`（2–4 个可读选项、零写入）。
- 公开路径已测：`tests/acceptance/pantry-application.test.ts` 588 行「commits CASE-PURCHASE-010 through the public runtime」等（含 already_current / 伪造投影权威 / 显式过期保留）。
- 位置 token：`refrigerator`（冷藏室）、`room_temperature_cabinet`（常温柜）、`freezer`（冷冻室）。`resolveExpiration` 用 `diet-manager/fresh-milk-shelf-life-v1`（冷藏 7 天）vs `room-temperature-milk-shelf-life-v1`（常温）。

## 四、实施蓝图

### A. 白水分类纠正（新领域路径，本任务最难）

1. **`src/parser/types.ts`**：新增 `CoreWaterClassificationCorrectionCandidate`（`action:"correct_record"`、`correction_kind:"water_classification"`、`target: latest_water_in_conversation`、`replacement_kind:"nutritious_drink"`、`replacement_name:"milk"`）。`CoreCommandCandidate` 联合加入。`CoreCorrectionTargetReference` 加 `latest_water_in_conversation`。
2. **`src/parser/correction.ts`**：新增有界正则识别「刚才那杯不是白水，是牛奶」→ 白水纠正候选（把「是 X」映射到词表 normalized_name，用 `normalizeMealLexeme` 或新映射表）。注意当前该句会被误判为 record_meal（因「牛奶」lexeme），故纠正语法必须在 `parse-command.ts` 的 meal 判定**之前**短路（查看 `parseCoreCommand` 里 `parseCorrectionCommand` 的调用顺序，确保白水纠正优先）。
3. **`src/domain/types.ts`**：新增 `CorrectWaterClassificationOperation`（`kind:"correct_record"`、`correction_kind:"water_classification"`、`operation_id`、`target_event_id`、`base_revision`、`replacement_kind:"nutritious_drink"`、`replacement_name`）。加入 `CorrectRecordOperation` 联合。
4. **`src/domain/service.ts`**：`validateOperation` 加 `water_classification` 校验分支（参照刚加的 `meal_time` 分支，字段列表 `["kind","operation_id","correction_kind","target_event_id","base_revision","replacement_kind","replacement_name"]`，`replacement_kind` 用 `enumValue(["nutritious_drink"])`，`replacement_name` 用 `text()`，`base_revision>=1`）。
5. **`src/domain/water-correction.ts`（新）**：白水纠正领域逻辑——校验白水事件+revision、写 `correction_events`（`operation='change_food_type'`）、after-snapshot（白水→nutritious_drink 餐食项）的营养/库存/日进度效果，单 `BEGIN IMMEDIATE` 事务。**不追加第二条 occurrence 事实**；原白水事实不可变，meal/water 查询解释认证后的纠正快照。
6. **`src/repository/fact-commit.ts`**：`insertCorrectionFact` 放宽——`correct_record` 允许 `change_food_type`；target 事件类型从硬编码 `diet_meal` 泛化为按 operation 允许 `diet_water`（或新增白水专用插入，保持既有 meal 路径不变）。
7. **`src/application/mapping.ts`**：新增 `waterClassificationOperation(command, resolution)` builder 与 `ResolvedCoreWaterClassification` 类型；`correctionOperation` 分派加 `correction_kind==="water_classification"` 分支。
8. **`src/application/core-runtime.ts`**：`correct_record` 分派加 `water_classification` 分支 → 独立解析白水 target（latest water）→ mapping → preview/execute → `readAppliedCorrectionResult` → `CorrectionOutcomeView{operation:"change_water_classification"}`。`resolveCorrectionTarget` 仅 meal，需新增白水解析（可在 `correction-target.ts` 加 `resolveWaterCorrectionTarget` 或内联）。

### B. 库存位置纠正泛化

1. **`src/parser/purchase.ts`**：`resolvePantryCommand` 泛化——识别「这批(牛奶)其实放在(常温柜/冷藏室/冷冻室)」「更正：…」+ 用户有界位置文本；`batch_reference` 支持 `this_batch` 或精确 batch ID 字符串；`previous_location`/`next_location` 支持 `refrigerator/freezer/room_temperature_cabinet`。
2. **`src/application/core-runtime.ts`**：`resolveLocationCorrection` 改为返回三种状态 `resolved | already_current | needs_clarification`（多候选时返回澄清，带 2–4 个可读 batch 选项，**零写入**），替代现在的 throw；精确 batch ID 或唯一 normalized product 直接解析。

## 五、落地顺序与测试

1. 补齐 `tests/acceptance/inventory-location-correction.test.ts`（计划 Step 1）：
   - 种两批牛奶（参照 `pantry-application.test.ts` `seedSingleBatchEvidence`，跑两次不同 batch_id）→「这批」句返回 `needs_clarification`（当前会 throw，RED）。
   - 精确 batch ID 句 → `committed`，位置/过期重算，旧投影保留在纠正载荷。
2. 运行 `pnpm exec vitest run tests/acceptance/water-correction.test.ts tests/acceptance/inventory-location-correction.test.ts` 确认 RED。
3. 按蓝图 A、B 最小实现 → GREEN。
4. 邻接回归（计划 Step 6）：`tests/acceptance/core-water.test.ts tests/acceptance/pantry-inventory.test.ts tests/fault-matrix.test.ts`（`--maxWorkers=1 --minWorkers=1`）+ `tsc --noEmit`。
5. 提交（计划 Step 7 清单 + 若额外改 `fact-commit.ts`/`correction-target.ts`/`effect-bundle.ts` 记得一并 `git add`），消息 `feat: expose water and location corrections`。

## 六、红线（续跑务必遵守）

- 先失败测试→确认失败原因→再最小实现；禁止改测试适配错误行为。
- secret 零泄露；`releases/v0.1` 只读；测试用 `os.tmpdir()` 隔离根；不新增运行时依赖。
- 本机跑 node/pnpm/vitest 前导出会话 PATH：
  `export PATH="/c/Users/10481/AppData/Local/Temp/diet-manager-validation-node-24.15.0/node-v24.15.0-win-x64:/c/Program Files/Git/cmd:$PATH"`
- `src/contracts.ts` 有一处既存字面 NUL 字节（offset 26184），无害，别动它。

## 七、相关文件索引

- 计划：`docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md` 885–941 行。
- 白水 RED 测试：`version-b-lite-plugin/tests/acceptance/water-correction.test.ts`（已落，未提交）。
- 白水领域参考：`src/domain/effect-bundle.ts`（water 效果）、`src/authority/water-fact-identity.ts`、`src/repository/query.ts` `listWaterEvents`/`summarizeDailyProgress`。
- 位置纠正参考：`src/parser/purchase.ts` `resolvePantryCommand`、`src/application/core-runtime.ts` `resolveLocationCorrection`、`tests/acceptance/pantry-application.test.ts` 588–745 行。
- 纠正目标参考：`src/repository/correction-target.ts`（meal-only，需白水泛化）。
