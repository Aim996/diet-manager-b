# Task 10 交接文档（暂停于 2026-08-17，调查完成、零代码写入）

> 状态：**阶段 2 / Task 10「公开接通餐食数量和发生时间纠正」——调研已全部完成，尚未写任何代码，尚未建立 RED 测试。** 工作树干净（Task 9 已提交），可直接停、可无缝续跑。

## 一、当前进度快照

- 阶段 2 已完成：Task 7（有界采购语法泛化）、Task 8（数量 nullable 权威）、Task 9（多商品采购原子提交），均已提交。
- Task 10 是当前活动任务，处于 **Step 1（写失败测试）之前**。
- 任务清单（TaskCreate）里 #5「阶段 2」为 in_progress，#9「文档」为 in_progress。

## 二、下一步（从 RED 开始，不要跳过）

1. 创建 `version-b-lite-plugin/tests/acceptance/core-correction-application.test.ts`，两条失败测试（计划 Step 1 原文）：
   ```typescript
   expect(handle("correct_record", "把刚才苹果改成200克")).toMatchObject({
     status: "committed",
     correction: { operation: "change_amount", target_event_id: mealId },
   });
   expect(handle("correct_record", "刚才那顿其实是昨天晚饭")).toMatchObject({
     status: "committed",
     correction: { operation: "change_time", target_event_id: mealId },
   });
   ```
2. `pnpm exec vitest run tests/acceptance/core-correction-application.test.ts` 确认 RED（当前应返回 `ACTION_NOT_IMPLEMENTED`，因 `correct_record` 只有 inventory_location / nutrition_supplement 两条分支）。
3. 按下面「实施蓝图」逐文件最小实现 → GREEN → 邻接回归 → commit（消息 `feat: correct meal amount and time`）。

## 三、实施蓝图（7 源文件改 + 1 测试文件建）

计划文件 `docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md` 第 810–884 行。逐文件改动：

1. **`src/parser/types.ts`**：`CoreCommandCandidate` 联合新增两个变体 `CoreMealAmountCorrectionCandidate`、`CoreMealTimeCorrectionCandidate`（`action:"correct_record"`，携带 `correction_kind:"meal_amount"|"meal_time"` + `target: CoreCorrectionTargetReference`）。
2. **`src/parser/correction.ts`**：`parseCorrectionCommand` 目前只认「撤销」。新增两条有界正则：
   - `meal_amount`：`/^把\s*刚才(?:的)?\s*(.+?)\s*改成\s*(\d+(?:\.\d+)?)\s*(克|个|ml|毫升|份|杯|斤|两)[。.]?$/u`（`刚才`→latest_meal）。
   - `meal_time`：`/^刚才那顿其实是(.+)[。.]?$/u`，把「昨天晚饭」解析成 `replacement_occurred_at` + `replacement_meal_slot`。
3. **`src/domain/types.ts`**：新增 `CorrectMealTimeOperation`（`kind:"correct_record"`, `correction_kind:"meal_time"`, `operation_id`, `target_event_id`, `base_revision`, `replacement_occurred_at`, `replacement_meal_slot`）。加入 `CorrectRecordOperation` 联合。`change_amount` 复用现有 `CorrectMealRecordOperation`（无 correction_kind）。
4. **`src/application/mapping.ts`**：`mapCoreCandidateToEnvelope` 的 `correct_record` 分支现在用 `"correction_kind" in command` 区分 location / nutrition。需扩展成按 `correction_kind` 精确分派：`meal_amount`→`CorrectMealRecordOperation`，`meal_time`→`CorrectMealTimeOperation`。新增 `ResolvedCoreMealAmount` / `ResolvedCoreMealTime` 解析结果类型。
5. **`src/application/core-runtime.ts`**：
   - `handleCoreRequest` 的 `correct_record` 分支（约 1187–1214 行）目前假定必是 `inventory_location`。改成按 `correction_kind` 分派：`meal_amount` / `meal_time` 走 `resolveCorrectionTarget`（Task 4 已有，latest_meal 解析）+ item 解析 + replacement 构造，再 `executeCandidate`。
   - 构造 `CorrectionOutcomeView`（undo 分支已有范本，约 1286–1293 行），`operation` 分别填 `change_amount` / `change_time`。
   - `handleCoreRequestAsync`（1762 行起）在进入时按 `nutrition_supplement` 分派；meal_amount / meal_time 不需要异步营养解析，落回 `handleCoreRequest`。
6. **`src/repository/fact-commit.ts`** `insertCorrectionFact`（556–632 行）：把 `change_time` 加入 `correct_record` 允许集合（597–602 行两处 `change_amount`/`change_nutrition_source` 列表）。
7. **`src/domain/effect-bundle.ts`**：见下节「change_time 领域改造」。
8. **（额外，计划文件清单遗漏但必须）`src/repository/progress-reservation.ts`**：见下节。

## 四、change_time 的领域改造（本任务最难点，已想清楚）

`change_amount` 领域层**已基本就绪**（`prepareCorrectionOperation` 已把 `CorrectMealRecordOperation` 映射到 `change_amount`），只差 parser/runtime 接线。

`change_time` 是新领域路径，需要动 `effect-bundle.ts` 三处 + `progress-reservation.ts` 一处：

1. `CorrectionOperationResult.operation` 联合（219–232 行）加 `"change_time"`。
2. `prepareCorrectionOperation`（246–470 行）：新增 `CorrectMealTimeOperation` 分支 → `operationKind="change_time"`。`afterSnapshot` 只改 `occurred_at`/`meal_slot`。`affectedItemOrders=[]`（无库存补偿）、`nutrition_delta.items=[]`（不改营养快照）。
3. `applyCorrectionEffects`（3139–3783 行）：放宽三处硬约束——
   - 3197 行 `inventory_compensation_intent.items.length === 0` 现在报错，change_time 需允许空。
   - 3281 行 `affected_dates.length !== 1` 报错，change_time 跨日期需允许 1 或 2。
   - 3677 行只读 `affected_dates[0]` 做单日期进度替换，需改成按日期列表逐个替换。
4. `readAppliedCorrectionResult`（3860–4133 行）：同步支持 change_time（空 inventory items、多日期、多个 `daily_progress_replacement` 效果）。
5. **`progress-reservation.ts` 的 `reservationFromEventPayload`（365–472 行）**：correction_fact 分支硬性要求 `affected_dates.length===1` 且 `delta.progress_reservation` 为单一 replacement 预留。需泛化。

### 建议的数据模型（我倾向的方案）

把纠正事实 `nutrition_delta.progress_reservation`（单数）**改名为 `progress_reservations`（数组，长度 == affected_dates.length）**，每个元素是 `ReplacementProgressReservation`。改造点集中在三处（`effect-bundle.ts` 的 build + apply + read，和 `progress-reservation.ts` 的 correction 分支）。其余 `progress_reservation`（meal/water/purchase 的 contribution 预留）**不受影响**，字段名继续保留单数。

`change_time` 进度语义：
- 同日（只改时刻/餐次，不跨日期）：单一 `daily_progress_replacement`，before == after == 该餐全量营养（等价 no-op），`affected_dates=[date]`。
- 跨日期（老日期减去全量、新日期加上全量）：两个 replacement，`affected_dates=[oldDate,newDate]`。

### 一个必须提前定的坑（跨日期新日期无快照）

`createReplacementProgressReservation` 要求目标日期**已有** `daily_progress_snapshots`（否则抛 `daily_progress_missing`），且 replacement 预留要求 `base_generated_at` 非空。若「昨天晚饭」把餐移动到**尚无任何记录**的新日期，纯 replacement 预留无法成立。两条出路，二选一：

- **A（推荐，改动大）**：扩展 `createReplacementProgressReservation` / `parseProgressReservation`，允许「空 previous 视为零营养」，即新日期从零开始加。语义最正确，但要动 `progress-reservation.ts` 的空值语义，需回归既有 `daily_progress_missing` 相关测试。
- **B（改动小，靠测试铺底）**：验收测试里**先种两顿饭**——一天在目标新日期（让新日期已有快照）、另一天在「刚才」日期。这样两个日期都有快照，纯 replacement 即可成立，无需动空值语义。

我建议先按 B 落地测试与实现，把 A 记入 DEBT（0.1.x 修复线再放宽空值语义）。

## 五、关键事实（已核实，别再重新查）

- **meal_slot 存的是中文 token**：`mapping.ts` `mealSlot()` 返回「早餐/午餐/晚餐/加餐/夜宵/unknown」，`core-application.test.ts:1526` 断言 `event.meal_slot === "早餐"`。所以 `CorrectMealTimeOperation.replacement_meal_slot` 应沿用中文 token，**不要**照抄计划接口里的英文 `"breakfast"|"lunch"|"dinner"|"snack"`（那会与存量表示不一致）。「晚饭」口语需映射到「晚餐」。
- **时间解析器**（`parser/time.ts` `resolveOccurredTime`）不认「昨天晚饭」这类无钟点的餐次短语（只认显式 ISO / 「昨晚 N 点」）。所以 meal_time 的「昨天晚饭 → 时间戳 + 餐次」需在 `correction.ts` 内自行解析（复用 `parse-command.ts` 里 `shanghaiCalendarDate` 的昨日换算思路 + 自定餐次→整点映射，如 晚饭→18:00）。
- **amount 纠正需要目标餐有非空 nutrition_adoption / inventory_deduction**，否则 `prepareCorrectionOperation` 的 `preflightCorrectionNutrition` / 库存补偿会失败。所以验收测试要用 `handleCoreRequestAsync` + 营养 adapter（照抄 `nutrition-supplement.test.ts` 的 adapter 写法）种餐，别用同步 `handleCoreRequest`（那会留下 null adoption）。
- 本机跑 node/pnpm/vitest 前必须导出会话 PATH：
  `export PATH="/c/Users/10481/AppData/Local/Temp/diet-manager-validation-node-24.15.0/node-v24.15.0-win-x64:/c/Program Files/Git/cmd:$PATH"`
- `src/contracts.ts` 有一个既存字面 NUL 字节（offset 26184，在 `[ -]` 正则内），无害、与 Task 10 无关，别去动它。

## 六、红线（续跑时务必遵守）

- 每个功能任务**先写失败测试 → 确认失败原因 → 再最小实现**；禁止把测试改成适配错误行为。
- secret（authority secret / FDC_API_KEY / 备份口令 / 真实饮食内容）零泄露，不进参数、日志、Git、发布包。
- `releases/v0.1` 只读；测试用隔离根（`os.tmpdir()`/`.tmp`），不碰真实数据根。
- 不新增运行时依赖。
- 只提交计划列出的范围；Task 10 提交清单见计划 882–884 行（若落地时额外改了 `progress-reservation.ts`，记得把它加进 `git add`）。
