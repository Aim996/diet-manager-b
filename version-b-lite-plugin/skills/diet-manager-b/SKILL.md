---
name: diet-manager-b
description: Use when a user reports completed food, water, or inventory activity; asks to query dietary records; requests a correction or undo; or needs confirmation that a Diet Manager write actually committed.
---

# 饮食管家 B

## 核心规则

通过 `diet_manager` 处理饮食业务。保留用户原话和时间表达，不把计划、假设、取消或否定内容当作已发生事实。

不要用记忆文件、便签、聊天历史、表格或其他存储代替饮食记录。只有工具返回 `committed=true` 才能告诉用户“已记录”。技术日志可以说明失败原因，但不属于饮食记录。

## 动作选择

| 用户意图 | 动作 |
|---|---|
| 已吃或已喝含营养的食物、饮料 | `record_meal` |
| 已喝水 | `record_water` |
| 已入库食材或商品 | `add_inventory` |
| 查询库存 | `query_inventory` |
| 查询饮食记录 | `query_meals` |
| 查询当天汇总 | `query_daily_summary` |
| 更正已有记录 | `correct_record` |
| 撤销指定记录 | `undo_record` |

## 结果处理

- `committed=true` 且状态为 `committed`：明确告知已记录，并引用返回的记录标识。
- `committed=true` 且状态为 `committed_with_issues`：告知事实已记录，同时说明后续效果仍待处理；不要重复提交事实。
- `committed=false` 且状态为 `needs_clarification`：明确告知尚未记录，只追问完成记录所缺少的最少信息。不要猜测食物、数量或时间，也不要说“记下了”。
- `committed=false` 且状态为 `ignored`：明确告知没有写入饮食记录，并根据 `reason_code` 简短说明这是计划、否定、查询或其他非写入内容。不要说“记下了”或“已记录”。
- `committed=false` 且状态为 `failed`：明确告知未记录。可以说明存在技术故障日志，但不要把日志说成记录成功。
- `foundation_not_implemented`：明确告知该动作尚未部署且没有产生饮食数据；不要换用其他文件偷偷记录。
- 状态与 `committed` 相互矛盾：视为无效结果，报告未确认成功，不要猜测。

## 示例

用户说“我刚喝了 500 毫升水，帮我记一下”时，调用 `record_water`。若返回 `foundation_not_implemented`，回答“饮水记录功能尚未部署，这次没有写入饮食记录”，不要写入每日记忆并声称已经记录。

## 常见错误

- 把“今晚准备吃火锅”写成已发生的餐食。
- 在工具失败后用笔记补写，再对用户说“记好了”。
- 把技术日志、审计事件或重试队列当成饮食记录。
- 在 `committed_with_issues` 后重复提交同一事实。
