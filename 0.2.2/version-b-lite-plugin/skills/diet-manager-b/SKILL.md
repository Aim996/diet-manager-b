---
name: diet-manager-b
description: Use when a user reports completed food, water, or inventory events; queries diet records; or asks to correct, undo, restore, or configure Diet Manager data.
---

# 饮食管家

## 核心原则

饮食管家的核心返回是唯一业务事实。识别当前请求的动作；凡需调用，`source_text` 必须逐字保留用户当前原文，不改写、不补全、不把推断当成原话。

明确的未来计划、假设、否定、他人事件或健康建议不是本人已发生事件：业务调用数为零，只说明本次未记录。只有已发生事件、查询、更正、撤销、恢复、档案或目标请求进入动作选择。

## 动作选择

| 用户意图 | `action` |
|---|---|
| 已吃或已喝含营养的食物、饮料 | `record_meal` |
| 已喝白水、纯净水或矿泉水 | `record_water` |
| 已入库食材或商品 | `add_inventory` |
| 查询库存 | `query_inventory` |
| 查询饮食记录 | `query_meals` |
| 查询当天汇总 | `query_daily_summary` |
| 更正已有记录 | `correct_record` |
| 撤销指定记录 | `undo_record` |
| 恢复已撤销记录 | `restore_record` |
| 设置或更新个人档案 | `set_profile` |
| 设置、更新或清除目标 | `set_goal` |

## 执行一次业务调用

需要记录、查询、更正或撤销时，只选择一个可用入口：

1. 宿主已提供契约匹配的 `diet_manager` 适配器：按其 Schema 调用一次。
2. 否则，宿主能执行命令：完整读取 [Agent Command v1](references/agent-command-v1.md)，向 `diet-manager execute` 的标准输入发送一个命令对象。
3. 两者均不可用：明确说明本次未记录；不使用记忆、便签或其他数据库兜底。

一条用户消息最多产生一次业务调用。适配器与 CLI 是互斥入口，不探测、不串联、不重试；协议错误和业务失败也不会开启第二次调用。Agent 只提交动作、逐字原文和协议允许的业务证据，不提交数据根或宿主上下文。

## 按返回结果回复

| 返回 | 回复 |
|---|---|
| `committed=true` 且 `status=committed` | 按动作说明已记录、已更正、已撤销、已恢复或已更新；只引用返回的数据。 |
| `committed=true` 且 `status=committed_with_issues` | 说明事实已提交，并如实说明返回的问题；不再次提交。 |
| `committed=false` 且 `status=needs_clarification` | 先说明尚未记录；只追问返回结果要求的最少信息。 |
| `committed=false` 且 `status=ignored` | 查询时呈现返回数据但不声称写入；其他情况说明本次未记录。 |
| `committed=false` 且 `status=failed`，或结果无效 | 说明本次未记录；不重试，不写记忆、便签或其他数据库，不声称“记好了”。 |

任何结果都是本条消息的业务终点。营养、记录标识、原因和错误只来自返回值。

## 常见错误

- 猜测 CLI 字段并多次试调用：先完整读取协议，只调用一次。
- 把“今晚准备吃火锅”当成已发生事件，或转存记忆：非事件必须零调用、零兜底。
- `committed=false` 后另存文本再说“已经记好了”：失败结果只能回执未记录。
