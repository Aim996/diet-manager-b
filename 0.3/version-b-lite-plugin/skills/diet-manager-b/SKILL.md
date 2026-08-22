---
name: diet-manager-b
description: Use when a user reports completed personal food, water, or inventory events; queries Diet Manager records; or asks to correct, undo, restore, or configure Diet Manager data.
---

# 饮食管家

## 触发范围

用于本人已经发生的饮食、白水和食品入库事件，以及库存/饮食/进度查询、更正、撤销、恢复、建档和目标请求。Agent 只负责理解原话和提交语义提案；后端结果是记录、库存、营养、目标和进度的唯一业务事实。

健康咨询、菜单建议、假设讨论和纯未来计划不属于持久化事件。用户只要求分析时可以回答，但不能声称已写入饮食管家。

## 主体与非事件边界

明确的否定、假设、未完成计划或纯他人事件不调用业务入口，并说明本次未记录。混合主体只提交原话中明确属于当前用户且已经发生的部分；不得为他人创建个人事实。

当前用户本人可以来自明确的“我”，也可以来自私人 Agent 的默认主体；默认主体不能伪造成原文证据。主体、完成状态或关键事实有冲突时不猜测，按后端返回提出最短澄清。细则按末表读取“自然语言边界”。

## 动作选择

| 当前意图 | `action` |
|---|---|
| 已吃食物或已喝含营养饮品 | `record_meal` |
| 已喝白水、纯净水或矿泉水 | `record_water` |
| 已入库食材或商品 | `add_inventory` |
| 查询库存 | `query_inventory` |
| 查询饮食记录 | `query_meals` |
| 查询当天汇总或目标进度 | `query_daily_summary` |
| 更正已有记录 | `correct_record` |
| 撤销指定记录 | `undo_record` |
| 恢复已撤销记录 | `restore_record` |
| 设置或更新个人档案 | `set_profile` |
| 设置、更新或清除目标 | `set_goal` |

更正、撤销和恢复的目标选择按末表读取“更正与恢复”。

## 一次业务调用

需要记录、查询或修改时，一条用户消息只选择一个入口并调用一次：优先使用宿主提供的契约匹配 `diet_manager` 适配器；否则完整读取末表中的“Agent Command v2”，向已配置的 `diet-manager execute` 发送一个 v2 命令。两者都不可用时明确说明本次未保存，可整理待提交内容，但不使用记忆、便签、文件或其他数据库冒充持久化。

`source_text` 必须逐字保留当前用户消息。证据充分时提交与 `action` 匹配的 v2 `semantic_proposal`；缺失值使用契约允许的 `unknown`/`null`，不编造数量、单位、时间、主体或名称。Agent 不提交数据根、数据库路径、调用标识、消息标识、会话标识、接收时间或时区；这些由宿主提供。

协议错误、业务失败和待澄清结果都是本消息的业务终点：不修改参数重试，不串联 CLI 与适配器，不另查文件或切换存储。库存和营养规则按末表读取“库存与营养”。

## 结果状态处理

优先逐字使用后端返回的 `render_model.text`；它已经包含真实正文和允许展示的冻结进度。不得补数字、重算进度或在末尾追加健康建议。

| 结构化结果 | 处理 |
|---|---|
| `committed=true`，`status=committed` | 只按真实结果说明已提交。 |
| `committed=true`，`status=committed_with_issues` | 说明事实已提交及返回的问题；不再次提交。 |
| `committed=false`，`status=needs_clarification` | 先说明尚未记录，只问返回的一个最短问题。 |
| `committed=false`，`status=ignored` | 查询时呈现返回数据且不声称写入；其他情况说明未记录。 |
| `committed=false`，`status=failed`，或结果无效 | 明确未记录，不重试、不兜底、不说“记好了”。 |

回执和进度的完整边界按末表读取“回执与进度”。

## 按需读取 references

| 当前任务 | 只需加载 |
|---|---|
| v2 字段、语义提案或 CLI 调用 | [Agent Command v2](references/agent-command-v2.md) |
| 主体、否定、未来、假设、混合句或弱模型降级 | [自然语言边界](references/natural-language-boundaries.md) |
| `committed/status`、澄清、失败、正文或六项进度 | [回执与进度](references/receipt-and-progress.md) |
| 入库规格、库存扣减、营养来源或未知值 | [库存与营养](references/inventory-and-nutrition.md) |
| 更正、撤销、恢复、目标选择或历史关系 | [更正与恢复](references/correction-and-recovery.md) |
