---
contract_id: RECEIPT-DATE-CONTRACT-v2
upstream_contract: diet-manager/contract-v2
scope: frozen_final_result_and_display
status_source: 总功能开发计划0.3.md §31 唯一任务台账
---

# RECEIPT-DATE-CONTRACT-v2：日期、成功回执、快捷选项与每日进度展示

<!-- BEGIN RECEIPT-DATE-V2-MACHINE -->
```json
{
  "contract_id": "diet-manager/receipt-date-contract-v2",
  "contract_version": 2,
  "upstream_contract": "diet-manager/contract-v2",
  "product_write_route": "B",
  "render_surface": "portable",
  "occurred_time": {
    "fields": ["raw_text", "resolved_start", "resolved_end", "precision", "timezone", "resolution_basis", "resolution_anchor", "resolver_version"],
    "precision_values": ["exact", "date", "meal_period", "approximate", "unknown"],
    "resolved_occurred_at_compatibility": "exact_only"
  },
  "success_receipt_statuses": ["committed", "committed_with_issues"],
  "success_receipt_authority": "EnvelopeFinalize_frozen_result",
  "success_receipt_forbidden_states": ["effects_pending", "failed_fact", "failed"],
  "progress": {
    "canonical_collection": "daily_progress_by_date",
    "one_date_alias": "required_field_equal_alias",
    "multiple_date_alias": "forbidden",
    "current_turn_increment_source": "envelope_persisted_aggregate",
    "terminal_idempotency_frozen": true,
    "metrics": ["energy", "protein", "fat", "carbohydrate", "fiber", "water"],
    "rounding": "decimal_round_half_up",
    "bar_cells": 10
  },
  "golden_progress": [
    {"metric": "energy", "current": 1874, "target": 1900, "increment": 775, "percentage": 99, "filled": 10, "increment_percentage": 41},
    {"metric": "protein", "current": 82.3, "target": 120, "increment": 35, "percentage": 69, "filled": 7, "increment_percentage": 29},
    {"metric": "fat", "current": 63.8, "target": 60, "increment": 23.2, "percentage": 106, "filled": 10, "increment_percentage": 39},
    {"metric": "carbohydrate", "current": 246.5, "target": 250, "increment": 107, "percentage": 99, "filled": 10, "increment_percentage": 43},
    {"metric": "fiber", "current": 21.3, "target": 25, "increment": 9.5, "percentage": 85, "filled": 9, "increment_percentage": 38},
    {"metric": "water", "current": 1420, "target": 2500, "increment": 500, "percentage": 57, "filled": 6, "increment_percentage": 20}
  ],
  "receipt": {
    "block_order": ["record_header", "item_lines", "actual_inventory_effect", "issues_and_quick_options", "progress_blocks"],
    "progress_position": "last",
    "recompute_business_results": false,
    "success_when_effects_pending": false
  },
  "evidence_labels": ["personal_template", "confirmed_historical_nutrition", "reference_database", "estimated"],
  "estimate_label_scope": "only_inferred_fields",
  "date_display": {
    "current_month": "current_month_day_only",
    "same_year_other_month": "same_year_month_day",
    "other_year": "full_date",
    "unknown_time_uses_midnight": false
  },
  "legacy_rule_guards": {
    "all_dates_show_month": false,
    "unknown_time_is_midnight": false,
    "components_are_separate_lines": false,
    "explicit_values_are_estimated": false,
    "nutrition_amount_implies_inventory_deduction": false,
    "separate_turn_nutrition_section": false,
    "progress_has_heading": false,
    "post_progress_advice": false,
    "rebuild_receipt_from_old_progress": false,
    "unknown_is_zero": false
  }
}
```
<!-- END RECEIPT-DATE-V2-MACHINE -->

## 1. 身份、范围与规范词

本契约是可移植 Skill、唯一 B 业务后端和所有薄适配器共同使用的最终结果/展示协议，规定中文日期、成功回执、快捷选项和 `daily_progress` 的呈现方式。它遵守上游 **CONTRACT-v2**；只有 B 可以拥有产品写入，Skill、OpenClaw、MCP 和未来适配器 MUST NOT 重算、补写或改变 B 的业务结果。本契约不定义库存/营养/水分计算、Issue 或 Correction 的物理字段、Schema 或来源选择。

- **MUST（必须）**、**MUST NOT（不得）**、**SHOULD（应）**、**MAY（可以）**按总计划 §1.2 的含义使用；SHOULD 仅可因已登记且生效的例外决定而偏离。
- 本契约只忠实呈现终态 `EnvelopeFinalize` 同一原子提交冻结的 `ReceiptData`、`daily_progress_by_date[]`、适用的单日 `daily_progress` 别名和终态幂等结果，MUST NOT 决定是否提交，也 MUST NOT 重算业务事实。`effects_pending`、`failed_fact` 或最终器失败时 MUST NOT 生成成功回执或进度块。<!-- EFFECTS-PENDING-NO-SUCCESS -->
- 展示简化 MUST NOT 改变或丢弃底层 ISO 时间、时区、用户原话、解析依据、数值精度、营养快照或库存事务。
- 本文所有菜品、目标、份量、营养、库存和进度数值均为黄金文本或公式验收样本，**MUST NOT** 成为用户默认目标、默认份量、默认营养或默认库存值。

## 2. 输入边界与不可重算规则

### 2.1 必要输入语义

展示层 MUST 保留或可读取 `OccurredTime.raw_text/resolved_start/resolved_end/precision/timezone/resolution_basis/resolution_anchor/resolver_version`，并保持 `received_at`、`committed_at` 与发生时间分离。`precision`只允许`exact/date/meal_period/approximate/unknown`；`resolved_occurred_at`只可作为`exact`的兼容派生字段，日期、餐段、近似或未知不得压成单点。未给发生时间而采用接收时间时，结果 MUST 带 `default_received_at`；模糊时间 MUST 保留时间范围或餐段，MUST NOT 补造具体时分。时间解析规则升级 MUST NOT 静默改写历史解析结果。〔REQ-TIME-001, REQ-TIME-003〕

相对时间 MUST 由可注入时钟、用户时区和解析锚点处理；日范围 MUST 是用户时区下 `[日开始, 次日开始)`。测试环境 MUST 固定时钟、时区和 locale，并覆盖跨午夜、跨月和跨年。〔REQ-TIME-001〕

### 2.2 同次最终结果是唯一权威

成功饮食/白水回执只可使用**同次终态 `EnvelopeFinalize` 冻结结果**中的以下数据：`daily_progress_by_date[]`、适用的单日 `daily_progress`、已提交项目及实际库存效果。`daily_progress_by_date[]`是规范源；恰好影响一个自然日时 MUST 同时提供逐字段相同的`daily_progress`，影响2个或更多自然日时只返回数组且 MUST NOT 提供单数别名。<!-- CROSS-DAY-ARRAY-ONLY --> 展示层 MUST NOT 从旧对话、旧进度快照、额外进度查询，或两个报告的差值重建本轮增量。〔REQ-PROGRESS-002, REQ-PROGRESS-004〕

同次最终结果中的进度只聚合 `active` 且 `committed` 的有效记录；它排除 `preview`、`failed`、`ignored`、被纠错替代的版本和 `voided`。`current_turn_increments` MUST 来自当前请求信封级持久化聚合，不能借用最后一个子事务或由模型相加。终态结果在幂等记录中冻结；同键合法重试返回原结果，不用后续最新累计重建。直接日/周查询 MUST 使用一次聚合调用，但没有当前写入时 MUST NOT 显示本轮增量。〔REQ-PROGRESS-001, REQ-PROGRESS-002, REQ-PROGRESS-004〕

## 3. 日期与时间展示

### 3.1 消歧算法

以**展示时用户时区内的当前日期**为参照：

- 同月仅显示日：`5号`。
- 同年但其他月显示月日：`7月15号`。
- 其他年显示年月日：`2025年12月31号`。
- 仅当具体时间已知且该上下文需要时，追加 `HH:mm`；时间未知 MUST NOT 显示 `00:00`。
- 日期范围 MUST 对每一个端点独立应用相同规则。
- 最近的制作、购买或入库锚点 MAY 显示“2小时前”等相对文字，但 MUST 可回溯到绝对时间；饮食发生日期的标准回执仍按上述绝对日期规则。

这些规则只作用于展示，底层 MUST 保留 ISO 时间、时区、用户原文和解析依据。〔REQ-TIME-002〕

### 3.2 日期黄金文本

固定参考为用户当前时间 `2026-08-09 10:00`、时区 `Asia/Shanghai`：

<!-- DATE-GOLDEN-CURRENT-MONTH -->
<!-- DATE-GOLDEN-CROSS-MONTH -->
<!-- DATE-GOLDEN-CROSS-YEAR -->

```text
2026-08-05 -> 5号
2026-07-15 -> 7月15号
2025-12-31 -> 2025年12月31号
2026-08-05 08:30 -> 5号 08:30
2026-08-05（时间未知） -> 5号
[2026-07-31, 2026-08-02] -> 7月31号—2号
```

## 4. 成功饮食/白水回执

### 4.1 固定区块和内容规则

成功回执 MUST 按下列顺序，且进度块是最后一个区块：

1. `已记录：日期 + 餐次`，标题独占一行；
2. 每道菜、独立食物、营养饮品和白水各占一行；
3. 一行仅陈述真正提交的库存实际结果；
4. 仅在有异常、多候选或用户要求详情时的必要异常和快捷选项；
5. 固定六项进度块。

一道菜的组成 MUST 在该菜同一行结束，MUST NOT 将组件拆成额外行。由自然单位、可食部分、密度、出成率或模板推导的字段 MUST 显示采用的克重/毫升和依据；“估算”只标真正推定的字段，明确数据 MUST NOT 标“估算”。来源标签只允许并明确区分`按个人模板`、`沿用历史营养表`、`参考数据库`和`估算`。<!-- FIELD-EVIDENCE-LABELS --> 若营养采用量没有独立可靠库存证据，库存行 MUST 明确未扣库存。〔REQ-RECEIPT-001, REQ-RECEIPT-002〕

回执 MUST NOT 单列“本轮营养”，MUST NOT 添加 `📊 今日进度：` 等进度标题，也 MUST NOT 在进度块之后添加表扬、警告、剩余额度、建议或下一餐推荐。〔REQ-RECEIPT-002, REQ-RECEIPT-003〕

### 4.2 完整成功回执黄金文本

下列文本逐行固定，且其中数值仅用于验收排版：

```text
已记录：9号晚餐
牛肉面1碗｜牛肉80g（按通用模板估算）、面条100g（按通用模板估算）、配菜50g（按通用模板估算）
凉拌黄瓜1小盘｜黄瓜200g（按通用模板估算）、调味油5g（按通用模板估算）
橙子1个｜按可食部分200g估算
白水500ml
库存：已扣橙子1个；牛肉面和凉拌黄瓜未据通用营养模板扣减组件库存

🔥 热量 ██████████ 99%
🔥1874 / 1900 kcal +775kcal +41%
🥩 蛋白 ███████░░░ 69%
🥩82.3 / 120 g +35g +29%
🧈 脂肪 ██████████ 106%
🧈63.8 / 60 g +23.2g +39%
🌾 碳水 ██████████ 99%
🌾246.5 / 250 g +107g +43%
🥬 纤维 █████████░ 85%
🥬21.3 / 25 g +9.5g +38%
💧 饮水 ██████░░░░ 57%
💧1420ml / 2.5L +500ml +20%
```

若菜的组件仅用于营养模板、没有可靠库存关联，库存行 MUST 如实改为：

```text
库存：已扣橙子1个；牛肉面和凉拌黄瓜组件仅用于营养估算，未扣库存
```

## 5. 入库回执

单商品 MAY 详细显示名称、数量/包装、规格、位置、保质/有效时间锚点、营养资料状态和关键异常。多商品同时入库 MUST 每项一行、保持输入顺序，并简洁显示“名称 + 数量/包装 + 规格 + 位置 + 保质状态/时间锚点 + 必要异常”。回执 MUST 显示实际采用的位置，用户 MUST 可用自然语言纠正位置。回执 MUST NOT 显示内部 ID、Schema、规则名或完整技术时间戳；保质未知时 MUST 显示最有价值的已知时间锚点，MUST NOT 编造剩余天数。位置快捷选项仅在多个合理位置会实质影响结果且明显不确定时出现。〔REQ-PANTRY-017, REQ-PANTRY-018〕

单商品与多商品黄金示例（值不是默认值）：

```text
已入库：蒙牛牛奶｜2盒｜250ml/盒｜冷藏｜标签到期日 12号｜营养资料：已关联

已入库：蒙牛牛奶｜2盒｜250ml/盒｜冷藏｜标签到期日 12号
已入库：鸡蛋｜1袋｜袋内个数未知｜冷藏｜购买于9号｜营养资料待补齐
```

## 6. 异常与快捷选项

### 6.1 出现条件、选项与执行边界

快捷选项 MUST 仅在关键字段明显不确定，或多个合理类别/真实候选会实质影响位置、保质、营养、库存或纠错目标时出现；明确的正常判断 MUST NOT 显示。每个问题优先提供 2–4 个最有价值选项，选项 MUST 来自现有数据、可靠换算或明确标注的估算，并说明执行后实际结果。〔REQ-QUICK-001〕

每组 MUST 有“保持原样”“暂不处理”或“不关联”等安全出口；MUST 接受单字母、多个字母组合、顺序指代和自由自然语言，快捷模板不是唯一输入方式。可解析为多个选项的输入不表示可无条件执行：选项互斥或执行后果冲突的组合 MUST NOT 执行，MUST 先请用户消歧；消歧后仍 MUST 重校验。提示记录 MUST 保留 `prompt_id`、`issue_id`、`option_id`、生成时版本和有效期。执行前 MUST 重校验目标记录、商品、库存及问题版本；过期选项或版本变化 MUST NOT 按旧快照直接执行。〔REQ-QUICK-001〕

每组最后一行 MUST 原样为：

```text
也可以直接说明实际情况，不必选择以上选项。
```

〔REQ-QUICK-001〕

### 6.2 快捷选项黄金文本

以下例子已保存饮食事实，库存有两个真实候选且未擅自扣减：

```text
已记录：9号晚餐
蒙牛牛奶250ml｜已记录；库存尚未扣减（存在两个可用候选）
库存：未扣蒙牛牛奶，等待确认具体商品
可选库存：
A. 扣蒙牛牛奶高钙250ml 1盒｜将扣减该批次1盒
B. 扣蒙牛牛奶低脂250ml 1盒｜将扣减该批次1盒
C. 暂不处理｜保持已记录饮食，库存不关联
也可以直接说明实际情况，不必选择以上选项。
```

`A`、`A+C`、`第一个`、`扣蒙牛牛奶`、`先不处理` 都是允许的输入形式；`A+C` 可被解析为输入，但“扣减”与“暂不处理”后果冲突，MUST 请用户确认其实际选择，MUST NOT 直接执行扣减；消歧后仍须按 §6.1 重校验。

## 7. `daily_progress` 与固定六项格式

### 7.1 目标与权威值

未配置且未经用户确认目标时，MUST NOT 创建目标、百分比或进度条。MUST 先显示 `目标未配置，进度条不可用。`，再按固定顺序每项一行显示已有累计量或未知。〔REQ-PROGRESS-001〕

有确认目标时，固定顺序、Emoji 和单位如下：热量 `🔥`（kcal/kcal）、蛋白 `🥩`（g/g）、脂肪 `🧈`（g/g）、碳水 `🌾`（g/g）、纤维 `🥬`（g/g）、饮水 `💧`（当前/增量为 ml，目标为 L）。每项严格两行，且两行都重复相同 Emoji；第一行仅含 Emoji、名称、10 格进度条和百分比，第二行含当前量、目标和可选同次正增量。〔REQ-PROGRESS-001〕

### 7.2 计算与 round_half_up

所有非负进度计算 MUST 使用十进制 `round_half_up`，明确规定 `x.5` 向远离零的方向取整；MUST NOT 使用 PowerShell、JavaScript 或 SQLite 默认 `.5` 行为。先将单位统一后计算：

```text
percentage = round_half_up(current / target * 100)
filled = clamp(round_half_up(current / target * 10), 0, 10)
increment_percentage = round_half_up(increment / target * 100)
```

进度条恰为 10 格、只用 `█` 与 `░`。超目标 MUST 显示真实百分比而条仍最多 10 个 `█`。只显示同次最终结果返回的正增量，格式为 `+amount unit +percent`；零或缺失省略，正增量换算后低于 1% 显示 `+<1%`。〔REQ-PROGRESS-001, REQ-PROGRESS-002〕

### 7.3 未知纤维、未配置目标与水分下界

目标存在而纤维当前值明确未知时，MUST 原样使用：

```text
🥬 纤维 ░░░░░░░░░░ 未知
🥬未知 / 30 g
```

十个 `░` 是未知版式占位，不表示 0；`30 g` 只是黄金样本，目标必须来自用户配置。〔REQ-PROGRESS-003〕

未配置目标黄金片段（示例值不是默认值）：

```text
目标未配置，进度条不可用。
🔥 热量 1874 kcal
🥩 蛋白 82.3 g
🧈 脂肪 63.8 g
🌾 碳水 246.5 g
🥬 纤维 未知
💧 饮水 1420ml
```

饮水由上游的 `plain_water_ml + food_hydration_ml` 表示；两者 MUST NOT 重复计算。存在未知食物水分时精确 `progress_water_ml` 保持未知，已知部分只作为 `progress_water_known_min_ml` 下界。此时有目标的展示 MUST 以十进制 `round_half_up(progress_water_known_min_ml / target_ml * 100)` 计算 `known_min_percentage` 和条，并原样以 `≥` 表示；不得称作精确当前量。〔REQ-PROGRESS-003〕

```text
💧 饮水 ██░░░░░░░░ ≥20%
💧已知至少500ml / 2.5L｜另有饮品水分未知
```

若本轮有已知正增量，MAY 按普通增量格式追加该已知增量；未知部分只能写“本轮另有饮品水分未知”，MUST NOT 伪造增量。

### 7.4 公式边界 Oracle

| 输入或情形 | 必须结果 |
| --- | --- |
| `current=0, target=100` | `0%`，`0` 格填充 |
| `current=5, target=100` | `5%`，`filled=1`（`0.5` 使用 `round_half_up`） |
| `current=105, target=100` | `105%`，`10` 格填充 |
| 正增量大于 0 且换算小于 1% | 显示 `+<1%` |
| 直接进度查询无 `current_turn_increments` | 不显示本轮增量 |
| 目标缺失 | 完全不进入百分比和进度条公式 |

### 7.5 单日别名、跨日块与最终器失败

<!-- GOLDEN-SINGLE-DAY-ALIAS -->

当一次终态成功请求恰好影响一个用户时区自然日时，`daily_progress_by_date[]` MUST 恰有一个对象，同时 MUST 提供 `daily_progress`；两者必须是同一冻结结果的逐字段相同值。回执只显示一个最终六项进度块，同日 mixed 也不得按子操作重复显示。

<!-- GOLDEN-CROSS-DAY-RECEIPT -->

当一次终态成功请求影响两个或更多自然日时，MUST 只提供按日期排序的 `daily_progress_by_date[]`，MUST NOT 提供 `daily_progress`。每个受影响日期显示一个带日期标签的六项块，例如：

```text
8号更新后
<8号固定六项进度块>

9号更新后
<9号固定六项进度块>
```

每个日期块只可读取同次数组中的对应对象；不得把多个自然日合并，不得借用另一日期快照。终态同键重试必须返回原数组、原别名状态和原 `ReceiptData`，即使后续累计变化也不得重建。

<!-- GOLDEN-FINALIZER-PENDING -->

若任一必要效果仍是 `pending/retryable_failed`，或 `EnvelopeFinalize` 尚未成功原子提交，信封保持 `effects_pending`。此时只可报告待重试状态，MUST NOT 输出“已记录/已完成”成功标题、成功 `ReceiptData`、单日别名或任何进度块；同键重试只恢复未完成效果或最终器，不重做已成功事实/效果。

## 8. 被取代的展示行为

以下仅为非规范性审计，均为 **superseded**，不得作为当前默认、兜底或实现许可：本月日期固定带月份；时间未知补 `00:00`；逐菜组件分行；明确数据整条标估算；把营养估算克重写成已扣库存；单列“本轮营养”；在进度前后增加“今日进度”标题；进度后追加表扬/警告/余额/建议；额外查询或旧快照/报告差值重建成功回执；无目标仍显示百分比或进度条；纤维未知显示 0；未知饮品水分按 0 算入精确总量；非 10 格或使用其他字符的进度条；缺少安全出口或自由文本末行的快捷选项。

## 9. Current 11-ID task trace table

本表仅含总计划0.3中SH-CONTRACT-002的11个当前任务范围ID；每个ID在本表中恰出现一次。旧总计划0.2中的`REQ-UX-*`及拆分后的QUICK/RECEIPT/PROGRESS编号属于v1历史，不得继续冒充当前范围。`REQ-WATER-*`、库存位置/效果、Issue、Correction与CONTRACT-v2是支撑性上游语义，不属于这11条追踪集合。

| REQ ID | 本契约正文小节 |
| --- | --- |
| REQ-TIME-001 | §2.1 |
| REQ-TIME-002 | §2.1 |
| REQ-TIME-003 | §2.1 |
| REQ-QUICK-001 | §6.1 |
| REQ-RECEIPT-001 | §4.1 |
| REQ-RECEIPT-002 | §4.1 |
| REQ-RECEIPT-003 | §4.1 |
| REQ-PROGRESS-001 | §2.2 |
| REQ-PROGRESS-002 | §2.2 |
| REQ-PROGRESS-003 | §2.2 |
| REQ-PROGRESS-004 | §2.2 |
