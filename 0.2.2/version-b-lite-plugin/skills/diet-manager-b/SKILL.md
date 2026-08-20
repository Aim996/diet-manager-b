---
name: diet-manager-b
description: Use when a user reports completed food, water, or inventory activity; asks to query dietary records; requests a correction or undo; or needs confirmation that a Diet Manager write actually committed.
---

# 饮食管家 B

## 核心规则

通过 `diet_manager` 处理饮食业务。保留用户原话和时间表达，不把计划、假设、取消或否定内容当作已发生事实。

调用时把用户原话逐字放入 `source_text`，不要自行改写成结构化食品事实。只发送工具 Schema 声明的字段；不要传入数据路径、secret、token 或 revision。`official_data_root` 与短期上下文由后端管理，不由聊天参数指定。本阶段公开入口不接收调用方构造的 `prior_context`。

工具为旧调用方保留可选的 `occurred_at_text` 和 `items`，但它们只是兼容字段，不能替代写入所需的权威信息。实际请求写入时必须同时提供 `action`、逐字 `source_text`、`received_at`、`timezone`、`operation_id`、`source_message_id` 和 `conversation_id`；查询请求也使用同一组完整调用元数据。其中时间与标识必须逐字取自当前 OpenClaw 入站消息、工具调用和会话上下文；这些调用元数据不是食物、数量或营养事实。上下文没有提供某个必需值时不要调用，也不要虚构一个值。

仅对 `record_meal`：当用户原话不能由旧解析路径安全表达时，在完整七字段之外提交可选 `semantic_candidate`。它只是基于原文的证据候选，不是写入权威：候选的 `source_text` 必须与外层逐字相同，证据片段必须来自原文；不确定的数量使用 `{ "kind": "unknown" }`，不得虚构标识、数量、单位、时间、人物或规范化食物名。原文明确出现他人时，把原文片段放入 `explicit_other_spans`；明确他人优先于私聊默认本人，不能伪装成本人餐食。候选不能替代任何一个必需调用元数据。

每条入站消息至多调用一次 `diet_manager`。拿到结果后立即停止工具操作并回复，不对同一句换参数重试，不读取插件文件，不运行命令排错，也不改用 Memory、便签、提醒或其他工具兜底。只有用户明确要求创建提醒时，提醒工具才属于当前请求。

工具返回失败、冲突或未实现时，不要建议用户原样重发同一句。只有确实缺少数量、规格或时间时，才询问那一个必要信息；功能未实现时直接说明当前不能完成。

明确的未来计划、假设或否定句不调用任何工具；只简短说明“这次没有记录”。不得说“记下了”，也不得主动创建提醒或备注。已经发生的事实和只读查询才按下方动作表调用 `diet_manager`。

不要用记忆文件、便签、聊天历史、表格或其他存储代替饮食记录。只有工具返回 `committed=true` 才能告诉用户“已记录”。若工具失败，直接告诉用户本次未记录，不创建便签、记忆或替代记录。技术日志可以说明失败原因，但不属于饮食记录。营养结果只复述工具返回值；工具没有返回热量或营养数值时，不自行估算。一次回复只包含本次饮食结果和一个确有必要的追问，不追加起名、身份档案、记忆初始化或无关建议。

只接受冻结契约 `contract_id=diet-manager/contract-v3`、`contract_version=3`、`contract_sha256=B4F475C389FA9A5EA5DD23F9E737A157B5B44B47311AB38AB16354F5C9556ADC`。契约身份与工具 Schema 或运行时不一致时，把结果视为未确认成功，不要猜测或补写。

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
| 撤销后恢复一条已撤销记录 | `restore_record` |
| 设置或更新个人档案（身高/体重/年龄/性别/状态） | `set_profile` |
| 设置或更新六项目标（可单独清除某项目标） | `set_goal` |

## 结果处理

- `committed=true` 且状态为 `committed`：按动作分别回执——`record_meal`/`record_water`/`add_inventory` 告知“已记录”，`correct_record` 告知“已更正”，`undo_record` 告知“已撤销”，`restore_record` 告知“已恢复”，`set_profile` 告知“已保存个人档案”，`set_goal` 告知“已更新目标”，并引用返回的记录标识。
- `committed=true` 且状态为 `committed_with_issues`：告知事实已记录，同时说明后续效果仍待处理；不要重复提交事实。
- `committed=false` 且状态为 `needs_clarification`：明确告知尚未记录，只追问完成记录所缺少的最少信息。不要猜测食物、数量或时间，也不要说“记下了”。
- `committed=false` 且状态为 `ignored`：明确告知没有写入饮食记录，并根据 `reason_code` 简短说明这是计划、否定、查询或其他非写入内容。不要说“记下了”或“已记录”。
- `committed=false` 且状态为 `failed`：明确告知未记录。可以说明存在技术故障日志，但不要把日志说成记录成功；只有确实缺少数量、规格或时间等必要信息时才追问，否则不要建议用户重发或改写后补交。
- 状态与 `committed` 相互矛盾：视为无效结果，报告未确认成功，不要猜测。

以上任一结果都是本条消息的终点。不得为了“帮用户解决”而再次调用、搜索插件代码或尝试其他存储。

## 进度条回执

`query_daily_summary` 返回 `configured_goals`（六项目标，`null` 表示未配置）与 `progress`（仅已配置维度出现）。回执按固定顺序渲染两行进度条：`🔥热量 🥩蛋白质 🧈脂肪 🍚碳水 🥦膳食纤维 💧饮水`；每项两行，第一行 `Emoji 名称 ██████████ 103%`，第二行 `Emoji 当前量/目标 单位`。进度条满格 10 格，超出目标显示真实百分比（可超过 100%）且满格。未配置维度只标注“尚未配置目标”，不渲染进度条。六项目标均为“参考目标（公式估算，可覆盖）”，不构成医疗建议。

## 示例

用户说“我刚喝了 500 毫升白水，帮我记一下”时，把整句原话作为 `source_text` 调用 `record_water`。只有返回 `committed=true` 才回答已记录；若返回 `failed`，明确说明本次未记录，不要写入每日记忆兜底。

用户说“中午扒了两碗米饭，这会儿还撑着”，且宿主提供了下列调用元数据时，使用一次结构化餐食调用：

```json
{
  "action": "record_meal",
  "source_text": "中午扒了两碗米饭，这会儿还撑着",
  "received_at": "2026-08-20T12:30:00+08:00",
  "timezone": "Asia/Shanghai",
  "operation_id": "pressure-operation-001",
  "source_message_id": "pressure-message-001",
  "conversation_id": "pressure-conversation-001",
  "semantic_candidate": {
    "schema_version": "diet-manager/semantic-candidate/v1",
    "intent": "record_meal",
    "source_text": "中午扒了两碗米饭，这会儿还撑着",
    "subject": { "kind": "self", "basis": "private_agent_default", "evidence_span": null, "explicit_other_spans": [] },
    "items": [{ "raw_name": "米饭", "normalized_hint": "rice", "amount": { "kind": "exact", "value": 2, "unit": "bowl", "evidence_span": "两碗米饭" } }],
    "time": { "kind": "source_text", "evidence_span": "中午" }
  }
}
```

最终回复严格服从工具返回的 `committed`、`status`、`reason_code` 和 `error_code`；候选内容本身不能证明已经记录。

## 常见错误

- 把“今晚准备吃火锅”写成已发生的餐食。
- 在工具失败后用笔记补写，再对用户说“记好了”。
- 把技术日志、审计事件或重试队列当成饮食记录。
- 在 `committed_with_issues` 后重复提交同一事实。
- 因为返回冲突或未实现，就连续重试、读取插件源码或运行命令。
- 用户只是说未来计划或明确否定时，擅自创建提醒、备注或记忆。
- 正确返回业务结果后，再追问名字、身份设定或其他无关事项。
- 不宣传能力：不主动罗列工具能做什么，只针对当前请求选择动作。
