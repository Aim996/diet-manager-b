# EV-20260820-044 — 0.2.0 双路并行盲测（普通用户视角 · 非规范自然表述）

## Identity and scope

- `evidence_id`: `EV-20260820-044`
- `evidence_type`: `E-BLIND-ACCEPTANCE`（双路并行 · 普通用户黑盒视角）
- `recorded_at`: `2026-08-20`
- `result`: `FAIL`（12 输入：4 通过 / 8 未达预期，其中 1 例为连锁失败）
- `product_version`: `0.2.0`（candidate-010）
- `candidate_zip_sha256`: `762027A2B3CE57F9BC6F3A79A2E939D59CCD0383E0313104039C89C4FA9F2315`
- `source_commit`: `9292579e11513738784a0d061fee20cd07e337b3`
- `contract_version`: `3`（`diet-manager/contract-v3`）
- `gateways`: `openclaw-gateway-01`（路 A）/ `openclaw-gateway-02`（路 B），主机 `192.168.100.1`（iStoreOS）
- `model`: `deepseek-v4-flash`（网关默认）

本证据记录 **0.2.0 已安装到 01/02 两网关后**，以「只知道这是饮食管家技能、不懂产品措辞」的普通用户身份，双路并行、**不同问题、不同思路** 的盲测。路 A 走「随性口语化记饮食」，路 B 走「档案/目标/进度管理」，两路问题互不重叠，专挑规范场景之外的**自然表述**。

## 方法

- 每路一个持久会话键（`agent:main:blind-A2` / `blind-B2`），6 个输入按顺序在同一会话内推进，模拟真实用户持续聊天。
- 每问经 `openclaw agent --session-key <key> -m "<原文>" --json` 驱动，仅取助手可见回执文本（用户视角真值），不改读插件源码。
- 观测口径：助手回执是否「已记录 / 已保存 / 正常渲染」；结合 reason_code（non_self_subject / needs_clarification / ACTION_CONFLICT）判定根因。

## 结果矩阵（12 输入）

| # | 路 | 输入（用户原话） | 观测结果 | 判定 |
|---|---|---|---|---|
| A-1 | A | 帮我记一下，今天早餐吃了一个水煮蛋 | ignored / non_self_subject | ❌ |
| A-2 | A | 中午来了一碗牛肉面，还挺辣的 | ignored / non_self_subject | ❌ |
| A-3 | A | 下午喝了杯冰美式 | ignored / non_self_subject | ❌ |
| A-4 | A | 我刚刚吃了一根香蕉 | needs_clarification（"实际吃了什么"） | ❌ |
| A-5 | A | 查查我今天都吃了啥 | 正常查询（空记录） | ✅ |
| A-6 | A | 把刚才香蕉那条记录撤了吧 | 无记录可撤（A-4 未写入的连锁） | ❌ |
| B-1 | B | 帮我设一下档案，我身高175体重70公斤，男，30岁，正在减脂 | 已保存档案 | ✅ |
| B-2 | B | 我想每天控制在1800千卡热量 | failed / ACTION_CONFLICT | ❌ |
| B-3 | B | 今天到现在喝了800毫升水 | ignored / non_self_subject | ❌ |
| B-4 | B | 早餐吃了两个鸡蛋，还喝了杯豆浆 | 鸡蛋已记录；豆浆 committed_with_issues | ✅ |
| B-5 | B | 给我看看今天的进度 | 六项进度条完整渲染 | ✅ |
| B-6 | B | 帮我把蛋白质目标去掉 | needs_clarification（需确认维度） | ❌ |

## 发现清单（7 项，均指向「冻结语法覆盖缺口」）

### 发现 #1 —— 礼貌前缀「帮我记一下」误判 non_self_subject
- 触发：`帮我记一下，今天早餐吃了一个水煮蛋`
- 根因：`src/parser/subject.ts:88` `FRAME_EXPLICIT_SELF_MODIFIERS` 只认「刚才/今天/早餐…」等时间/餐次修饰词，「帮 / 记一下」不在白名单；`resolvePredicateFrameSubject` 匹配到 `/^我/` 后，`afterSelf = "帮记一下今天早餐"` 不含纯修饰词 → 不判 `explicit_self`；省略主语语法也不匹配 → 落到 `non_self`。
- 关键：SKILL.md 示例（第 65 行）的「帮我记一下」是**后缀**（「我刚喝了…，帮我记一下」），所以从未暴露此前缀形态。

### 发现 #2 —— 进食动词「来」不被识别
- 触发：`中午来了一碗牛肉面，还挺辣的`
- 根因：进食动词仅「吃/喝」；「来了一碗」不在 `predicate-frame.ts` `EAT_OBJECT_START` 与 `subject.ts` `OMITTED_SUBJECT_GRAMMAR` 中。

### 发现 #3 —— 量词「根」不被识别（香蕉）
- 触发：`我刚刚吃了一根香蕉`
- 根因：`src/parser/meal.ts:144` banana 仅 `{个:"piece", 克:"g"}`；`AMOUNT_BEFORE_ITEM`/`AMOUNT_AFTER_ITEM`（同文件 157/159 行）单位类 `(个|片|瓶|盒|碗|块|盘|克|ml|毫升)` 不含「根」。验收场景只用「一个/三个香蕉」。

### 发现 #4 —— 时间短语「到现在」不被识别
- 触发：`今天到现在喝了800毫升水`
- 根因：`subject.ts` 时间修饰白名单无「到现在」，前缀解析失败 → `non_self`。

### 发现 #5 —— 食物词典缺「冰美式」
- 触发：`下午喝了杯冰美式`
- 根因：冻结食物词典仅「咖啡」等 ~13 项（`predicate-frame.ts:30-32`、`meal.ts`），「冰美式 / 拿铁」等具体饮品缺失；「杯」无数字形态也不在单位类 → 整句无法生成有效谓词框 → 兜底 `non_self`。

### 发现 #6 —— 目标表述缺「目标」词 → ACTION_CONFLICT
- 触发：`我想每天控制在1800千卡热量`
- 根因：`src/parser/goal.ts:71` 要求 `源文含「目标」` 才介入；「控制在1800千卡」无「目标」→ `parseGoalCommand` 返回 `undefined` → 其它解析器把整句判为非 set_goal 动作 → `core-runtime.ts:1288-1290` 因 `parsed.action !== request.action` 返回 `ACTION_CONFLICT`。验收场景只用「热量目标2100千卡」式。

### 发现 #7 —— 目标清除词「去掉」不在白名单
- 触发：`帮我把蛋白质目标去掉`
- 根因：`src/parser/goal.ts:14` `CLEAR_MARKER = 清除|取消|删除|重置`，不含口语「去掉/删掉」。验收场景只用「清除蛋白质目标」。

## 通过项（对照基线，证明规范表述下产品正常）

- B-1 `set_profile`（「帮我设一下档案…」）✅ —— 档案解析器不经 subject 解析，更健壮。
- B-4 `早餐吃了两个鸡蛋` ✅（鸡蛋 committed；豆浆 `committed_with_issues` 属预期）。
- B-5 `query_daily_summary` 六项进度条 ✅ 完整渲染。
- A-5 `query_meals` ✅。

## 结论

**系统性问题：`non_self_subject` 是「兜底误判」。** 凡解析器不认识的表述，一律被归类为「非本人主体」，把「语法覆盖缺口」错误标记为「主体归属错误」。冻结语法（PRODUCT-0.1 范围）远窄于真实用户自然表述：12 输入中 6 个非规范表述**全部**失败（5 个 non_self_subject/needs_clarification + 1 个 ACTION_CONFLICT）。

**影响面**：普通用户首条消息（A-1「帮我记一下…」）即失败，且失败回执把根因误导成「身份没设置」（助手反复建议先建档案），用户会被带偏。此非单点 bug，而是解析器「白名单式冻结语法」的架构性覆盖缺口。

**不构成阶段收口、不授权 releases 晋级或 tag**。修复需按 DEC 流程新增决策（冻结语法泛化 / non_self 兜底重归类），不在本证据范围内。
