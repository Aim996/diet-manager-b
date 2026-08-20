# Agent Command v1

当宿主没有契约匹配的 `diet_manager` 适配器、但能执行本地命令时，完整读取本页，然后只执行一次 CLI 业务调用。

## 命令对象 Schema

标准输入对象只允许下列字段；未知字段、缺少必填字段、数组顶层或错误类型会被拒绝。

| 字段 | 必填 | 精确约束 |
|---|---:|---|
| `schema_version` | 是 | 字符串，必须为 `diet-manager/agent-command/v1` |
| `action` | 是 | 下方动作表中的字符串 |
| `source_text` | 是 | 用户当前消息的逐字原文，1–4096 个 UTF-16 code units；不改写、不摘要、不补字段 |
| `semantic_candidate` | 否 | 只可用于 `record_meal`；结构必须符合下方 Schema，且其 `source_text` 与外层逐字相同 |

Agent 不提供数据根或宿主上下文。命令中不得出现 `official_data_root`、数据库路径、secret、token、`received_at`、`timezone`、`operation_id`、`source_message_id`、`conversation_id`、`prior_context` 或其他宿主字段。部署管理员配置数据根；CLI 生成时间和调用标识。

最小命令：

```json
{
  "schema_version": "diet-manager/agent-command/v1",
  "action": "record_meal",
  "source_text": "我吃了两个鸡蛋"
}
```

普通、可直接解析的餐食陈述使用的命令对象就是上述三个必填字段。仅当基础解析无法安全表达原文、并且已有完整的规范词汇与证据时，命令对象才增加 `semantic_candidate`。

### `semantic_candidate` 精确结构

仅在 `record_meal` 需要携带原文证据候选时使用。对象及其嵌套对象不接受额外字段。

```json
{
  "schema_version": "diet-manager/semantic-candidate/v1",
  "intent": "record_meal",
  "source_text": "我吃了两个鸡蛋",
  "subject": {
    "kind": "self",
    "basis": "explicit",
    "evidence_span": "我",
    "explicit_other_spans": []
  },
  "items": [
    {
      "raw_name": "鸡蛋",
      "normalized_hint": "egg",
      "amount": {
        "kind": "exact",
        "value": 2,
        "unit": "piece",
        "evidence_span": "两个鸡蛋"
      }
    }
  ],
  "time": {
    "kind": "unspecified",
    "evidence_span": null
  }
}
```

约束：`intent` 只能是 `record_meal`；`subject.kind` 只能是 `self`；`basis` 为 `explicit` 或 `private_agent_default`；`items` 为 1–64 项。精确数量使用 `{ "kind": "exact", "value": 正数, "unit": "运行时规范单位", "evidence_span": "原文片段" }`，例如鸡蛋使用 `piece`；不确定数量只使用 `{ "kind": "unknown" }`。`time.kind` 为 `source_text` 或 `unspecified`，对应的 `evidence_span` 分别使用原文片段或 `null`。所有证据片段来自逐字原文；只有已知的运行时规范词汇才能进入 `normalized_hint` 和 `unit`，否则不提交候选。

## 动作

| `action` | 用途 |
|---|---|
| `record_meal` | 记录已发生的食物或含营养饮品 |
| `record_water` | 记录已喝的白水、纯净水或矿泉水 |
| `add_inventory` | 记录已入库食材或商品 |
| `query_inventory` | 查询库存 |
| `query_meals` | 查询饮食记录 |
| `query_daily_summary` | 查询当天汇总和目标进度 |
| `correct_record` | 更正已有记录 |
| `undo_record` | 撤销指定记录 |
| `restore_record` | 恢复已撤销记录 |
| `set_profile` | 设置或更新个人档案 |
| `set_goal` | 设置、更新或清除目标 |

## stdin、stdout 与退出状态

- 调用形式固定为 `diet-manager execute`；stdin 是一个 UTF-8 JSON 对象，最大 65,536 字节。一次进程只发送一个对象，然后关闭 stdin。
- 接受的业务请求在 stdout 产生一个 `DietManagerOutcome` JSON 对象和一个换行；stdout 没有日志或第二行内容。
- 只要 stdout 成功产生结构合法的业务结果，退出状态就是 `0`；业务未写入由 `committed=false` 和 `status` 表达，不能因为退出 `0` 就声称成功。
- 协议、配置或启动错误在 stderr 产生一个稳定错误码，退出状态为 `2`，stdout 为空。这同样是未记录；不修改命令重试，不切换其他存储。

### PowerShell 7+

路径也使用正斜杠；部署环境已由管理员配置，命令对象不携带数据根或宿主上下文。不要用 `$command | & ...` 发送含中文的 JSON；请把三个重定向流的编码都显式设为无 BOM UTF-8。

```powershell
$node = 'C:/Program Files/diet-manager/node.exe'
$cli = 'C:/Program Files/diet-manager/dist/cli/agent.js'
$command = '{"schema_version":"diet-manager/agent-command/v1","action":"record_meal","source_text":"我吃了两个鸡蛋"}'
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

Windows PowerShell 5.1 没有 `ProcessStartInfo.StandardInputEncoding`；兼容调用应把 stdin 直接写成 UTF-8 字节，并显式设置 stdout/stderr：

```powershell
$node = 'C:/Program Files/diet-manager/node.exe'
$cli = 'C:/Program Files/diet-manager/dist/cli/agent.js'
$command = '{"schema_version":"diet-manager/agent-command/v1","action":"record_meal","source_text":"我吃了两个鸡蛋"}'
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

### POSIX shell

```sh
printf '%s\n' '{"schema_version":"diet-manager/agent-command/v1","action":"record_meal","source_text":"我吃了两个鸡蛋"}' \
  | node '/opt/diet-manager/dist/cli/agent.js' execute
```

## 结果 Schema 与回执

结果仅有三种顶层形状：

| 形状 | 必填字段 | 可选返回字段 |
|---|---|---|
| 已提交 | `action`, `status` (`committed` 或 `committed_with_issues`), `committed=true`, `operation_id`, `record_id` | `record_ids`, `nutrition_items`, `receipt`, `correction` |
| 未写入 | `action`, `status` (`needs_clarification` 或 `ignored`), `committed=false`, `reason_code` | `operation_id`, `question`, `missing_items`, `clarification`, `daily_progress`, `meal_history`, `inventory_view`, `correction` |
| 失败 | `action`, `status=failed`, `committed=false`, `error_code` | `operation_id` |

渲染顺序固定为：先检查 `committed`，再检查 `status`，最后只使用结果中实际存在的业务字段。

- `committed=true`：按动作说明已记录、已更正、已撤销、已恢复或已更新；`committed_with_issues` 同时说明返回的问题，但不再次提交。
- `committed=false/status=needs_clarification`：先说尚未记录，再问 `question` 或 `missing_items` 指定的最少信息。
- `committed=false/status=ignored`：若含查询视图，呈现视图且不声称写入；否则说明本次未记录。
- `committed=false/status=failed`：说明本次未记录，可报告 `error_code`；不重试、不使用记忆、便签或其他数据库兜底。
- 缺字段、未知形状或 `committed` 与 `status` 矛盾：视为无效结果并说明未确认成功。
