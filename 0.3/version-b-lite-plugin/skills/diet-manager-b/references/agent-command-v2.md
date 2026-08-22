# Agent Command v2

## 何时读取

当宿主没有契约匹配的 `diet_manager` 适配器、需要通过 `diet-manager execute` 调用，或需要形成 v2 语义提案时读取。工具导出的机器 Schema 是唯一结构真源；本页解释字段语义和安全用法。

## 顶层命令

一个命令只包含：

| 字段 | 规则 |
|---|---|
| `schema_version` | 固定为 `diet-manager/agent-command/v2` |
| `action` | 使用 Skill 动作表中的一个动作 |
| `source_text` | 当前用户消息逐字原文，不能摘要、修正或拼接旧消息 |
| `semantic_proposal` | 写入/修改动作的可选结构化语义提案；查询通常省略 |

Agent 不能提交数据根、数据库路径、secret/token、接收时间、时区、调用标识、消息标识、会话标识或先前上下文。所有对象精确拒绝未知字段；不要增加“方便调试”的键。

## 提案与证据

`semantic_proposal.kind` 必须与动作匹配：

| `kind` | `action` | 必要语义 |
|---|---|---|
| `meal` | `record_meal` | 本人、已发生、餐次、按原顺序的摄入项目、时间证据 |
| `water` | `record_water` | 本人、白水数量、时间证据 |
| `inventory` | `add_inventory` | 商品、包装数量、单包装内容量/位置/到期/价格 |
| `profile` | `set_profile` | `update/clear` 与原文提供的资料字段 |
| `goal` | `set_goal` | `confirm/update/clear` 与六项目标字段 |
| `record_mutation` | `correct_record/undo_record/restore_record` | 操作、用户描述的目标及可选替换内容 |

证据只来自当前 `source_text`：明确事实的 `evidence_span` 必须是原文连续片段；明确他人片段放入 `explicit_other_spans`。省略主语且私人 Agent 默认指当前用户时，主体使用 `basis=private_agent_default`、`evidence_span=null`。数量不明使用 `{ "kind": "unknown" }`，时间未说明使用 `{ "kind": "unspecified", "evidence_span": null }`。`normalized_hint` 只是规范化提示，不是商品、批次或记录 ID。

## 完整示例

已完成的一顿晚饭：

```json
{
  "schema_version": "diet-manager/agent-command/v2",
  "action": "record_meal",
  "source_text": "晚饭我刚吃完两片全麦面包和一个苹果，帮我记下。",
  "semantic_proposal": {
    "kind": "meal",
    "subject": {
      "kind": "self",
      "basis": "explicit",
      "evidence_span": "我",
      "explicit_other_spans": []
    },
    "occurrence": "completed",
    "meal_slot": "dinner",
    "items": [
      {
        "raw_name": "全麦面包",
        "normalized_hint": "bread",
        "amount": {
          "kind": "exact",
          "value": 2,
          "unit": "片",
          "evidence_span": "两片全麦面包"
        }
      },
      {
        "raw_name": "苹果",
        "normalized_hint": "apple",
        "amount": {
          "kind": "exact",
          "value": 1,
          "unit": "个",
          "evidence_span": "一个苹果"
        }
      }
    ],
    "occurred_at": {
      "kind": "source_text",
      "evidence_span": "晚饭"
    }
  }
}
```

白水：

```json
{
  "schema_version": "diet-manager/agent-command/v2",
  "action": "record_water",
  "source_text": "我刚喝了500毫升白水。",
  "semantic_proposal": {
    "kind": "water",
    "subject": {
      "kind": "self",
      "basis": "explicit",
      "evidence_span": "我",
      "explicit_other_spans": []
    },
    "amount": {
      "kind": "exact",
      "value": 500,
      "unit": "ml",
      "evidence_span": "500毫升"
    },
    "occurred_at": {
      "kind": "source_text",
      "evidence_span": "刚"
    }
  }
}
```

双单位入库：

```json
{
  "schema_version": "diet-manager/agent-command/v2",
  "action": "add_inventory",
  "source_text": "刚买了两盒纯牛奶，每盒250毫升，保质期到下周五，放冰箱冷藏层，一共12块钱。",
  "semantic_proposal": {
    "kind": "inventory",
    "product": {
      "raw_name": "纯牛奶",
      "normalized_hint": "milk",
      "evidence_span": "纯牛奶"
    },
    "package_amount": {
      "kind": "exact",
      "value": 2,
      "unit": "盒",
      "evidence_span": "两盒"
    },
    "per_package_content": {
      "kind": "exact",
      "value": 250,
      "unit": "ml",
      "evidence_span": "每盒250毫升"
    },
    "location": {
      "value": "冰箱冷藏层",
      "evidence_span": "冰箱冷藏层"
    },
    "expires_at": {
      "kind": "source_text",
      "evidence_span": "下周五"
    },
    "price": {
      "amount": 12,
      "currency": "CNY",
      "evidence_span": "一共12块钱"
    }
  }
}
```

更新一个正式目标，其他目标保持不变：

```json
{
  "schema_version": "diet-manager/agent-command/v2",
  "action": "set_goal",
  "source_text": "热量目标改成每天2100千卡，其他不变。",
  "semantic_proposal": {
    "kind": "goal",
    "operation": "update",
    "values": {
      "energy_kcal": {
        "value": 2100,
        "evidence_span": "2100千卡"
      }
    }
  }
}
```

查询命令保留逐字原文但不编造提案，例如：`{"schema_version":"diet-manager/agent-command/v2","action":"query_inventory","source_text":"冰箱里还有多少牛奶？"}`。

## CLI 一次调用

stdin 只发送一个 UTF-8 JSON 对象并关闭；stdout 成功时只有一个结构化结果。退出码 `0` 不等于已经写入，必须检查 `committed` 和 `status`。协议/配置错误通常退出 `2`、stdout 为空，同样不得重试或改用其他存储。

三种环境都只启动一次进程、发送一次命令，不把数据根或宿主上下文放进 JSON。

## PowerShell 7+

不要通过 PowerShell 管道发送含中文的 JSON。三个重定向流都显式使用无 BOM UTF-8：

```powershell
$node = 'C:/Program Files/diet-manager/node.exe'
$cli = 'C:/Program Files/diet-manager/dist/cli/agent.js'
$command = '{"schema_version":"diet-manager/agent-command/v2","action":"query_inventory","source_text":"冰箱里还有多少牛奶？"}'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node
$psi.ArgumentList.Add($cli)
$psi.ArgumentList.Add('execute')
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardInputEncoding = $utf8
$psi.StandardOutputEncoding = $utf8
$psi.StandardErrorEncoding = $utf8
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
[void]$process.Start()
$process.StandardInput.WriteLine($command)
$process.StandardInput.Close()
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -eq 0) { $stdout } else { $stderr }
```

## Windows PowerShell 5.1

5.1 没有 `ProcessStartInfo.StandardInputEncoding`；stdin 直接写 UTF-8 字节：

```powershell
$node = 'C:/Program Files/diet-manager/node.exe'
$cli = 'C:/Program Files/diet-manager/dist/cli/agent.js'
$command = '{"schema_version":"diet-manager/agent-command/v2","action":"query_inventory","source_text":"冰箱里还有多少牛奶？"}'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = '"' + $cli + '" execute'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = $utf8
$psi.StandardErrorEncoding = $utf8
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
[void]$process.Start()
$stdinBytes = $utf8.GetBytes($command)
$process.StandardInput.BaseStream.Write($stdinBytes, 0, $stdinBytes.Length)
$process.StandardInput.Close()
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()
if ($process.ExitCode -eq 0) { $stdout } else { $stderr }
```

## POSIX shell

```sh
printf '%s\n' '{"schema_version":"diet-manager/agent-command/v2","action":"query_inventory","source_text":"冰箱里还有多少牛奶？"}' \
  | node '/opt/diet-manager/dist/cli/agent.js' execute
```
