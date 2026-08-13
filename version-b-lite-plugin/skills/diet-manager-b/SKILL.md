---
name: diet-manager-b
description: Use when a user reports completed food, water, or inventory activity; asks to query dietary records; requests a correction or undo; or needs confirmation that a Diet Manager write actually committed.
---

# 饮食管家 B

## 核心规则

通过 `diet_manager` 处理饮食业务。保留用户原话和时间表达，不把计划、假设、取消或否定内容当作已发生事实。

调用时把用户原话逐字放入 `source_text`，不要自行改写成结构化食品事实。只发送工具 Schema 声明的字段；不要传入数据路径、secret、token 或 revision。`official_data_root` 与短期上下文由后端管理，不由聊天参数指定。本阶段公开入口不接收调用方构造的 `prior_context`。

不要用记忆文件、便签、聊天历史、表格或其他存储代替饮食记录。只有工具返回 `committed=true` 才能告诉用户“已记录”。技术日志可以说明失败原因，但不属于饮食记录。

只接受冻结契约 `contract_id=diet-manager/contract-v2`、`contract_version=2`、`contract_sha256=632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`。契约身份与工具 Schema 或运行时不一致时，把结果视为未确认成功，不要猜测或补写。

`official_data_root` 只由后端配置和管理。Skill 不创建、打开或替换该根，也不把便签、记忆文件或其他路径当作回退业务库。

牛奶、汤、豆浆、咖啡和茶按饮食处理，不按白水处理。只有明确的白水、纯净水或矿泉水使用 `record_water`。同一句中既有营养饮品又有白水时，保留整句原话并单次使用 `record_meal`；本阶段后端可能返回 `needs_clarification` 要求拆分。此时如实说明未记录并请用户分别说明，不要擅自改写原话拆成两次调用，也不要承诺自动分类提交。

健康建议请求不进入饮食记录。诊断、减重建议或医疗营养请求不得伪装为 `record_meal`，也不得因为出现食品名称就声称产生了记录。

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
- 状态与 `committed` 相互矛盾：视为无效结果，报告未确认成功，不要猜测。

## 示例

用户说“我刚喝了 500 毫升白水，帮我记一下”时，把整句原话作为 `source_text` 调用 `record_water`。只有返回 `committed=true` 才回答已记录；若返回 `failed`，明确说明本次未记录，不要写入每日记忆兜底。

## 常见错误

- 把“今晚准备吃火锅”写成已发生的餐食。
- 在工具失败后用笔记补写，再对用户说“记好了”。
- 把技术日志、审计事件或重试队列当成饮食记录。
- 在 `committed_with_issues` 后重复提交同一事实。
