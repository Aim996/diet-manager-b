# 更正与恢复

## 何时读取

当用户要更正记录、撤销、恢复、修改/清除目标，或用“刚才那个”等自然描述指向历史事实时读取。

## 动作与提案

| 用户意图 | `action` | `record_mutation.operation` |
|---|---|---|
| 改正一条已有记录 | `correct_record` | `correct` |
| 撤销记录或最近修改 | `undo_record` | `undo` |
| 恢复已撤销内容 | `restore_record` | `restore` |

`target.description` 使用用户能理解的目标描述，`target.evidence_span` 必须来自当前原话。更正时 `replacement` 描述新内容并保留原文证据。Agent 不能提交权威记录 ID、事件 ID、批次 ID、数据库主键或自行选择第一条候选；目标身份由后端根据原文、提案和可信会话上下文查询确认。后端无法唯一解释该描述时必须返回最短澄清，不能把它扩大成“会话里唯一一条记录”。

例如“刚才鸡蛋不是一个，是两个”应作为一次 `correct_record`，目标描述最近的鸡蛋记录，替换内容描述两个鸡蛋；它不是新增一顿饭。后端只需区分一个关键条件时会返回 `needs_clarification`，Agent 只问该问题。

```json
{
  "schema_version": "diet-manager/agent-command/v2",
  "action": "correct_record",
  "source_text": "刚才鸡蛋不是一个，是两个。",
  "semantic_proposal": {
    "kind": "record_mutation",
    "operation": "correct",
    "target": {
      "description": "刚才一个鸡蛋的记录",
      "evidence_span": "刚才鸡蛋不是一个"
    },
    "replacement": {
      "description": "两个鸡蛋",
      "evidence_span": "是两个"
    }
  }
}
```

## 历史与联动

更正、撤销和恢复都由后端建立版本/关系历史，不物理覆盖或删除原事实。库存、营养和进度只按后端实际差量变化；Agent 不根据旧回执推算“该退多少”或“该再扣多少”。重复请求由宿主身份和后端幂等处理，不能靠再次调用验证。

“撤销刚才那个修改”在目标唯一时可以直接提交；批量撤销、清空库存或多个同样合理目标需要先确认影响范围或最少区分信息。恢复时库存可能已经变化，必须接受后端当前结果，不能沿用撤销前余额。

## 目标与资料

设置或更新目标使用 `set_goal`；`goal.operation` 为 `confirm/update/clear`。只提交原话明确涉及的六项目标字段：`energy_kcal`、`protein_g`、`fat_g`、`carbohydrate_g`、`fiber_g`、`water_ml`。更新一个字段时不要复制或重建其他目标；清除具体目标时该字段使用 `null`。

建档推荐与正式目标不同：推荐在用户确认前保持待确认，不能自动启用。修改目标生成后端版本，Agent 不计算推荐值、BMI 诊断或生效区间。

## 回执

只有 `committed=true` 才能说已更正、已撤销、已恢复或已更新。使用后端 `render_model.text` 和结构化 `correction/goal_update/progress`；失败或待澄清时明确未执行，不用聊天记忆冒充历史操作。
