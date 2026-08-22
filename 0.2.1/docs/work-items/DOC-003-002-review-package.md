# DOC-003-002 独立复核包

## 1. 复核对象

- 工作简报：`docs/work-items/DOC-003-002-brief.md`
- 批准记录：`docs/work-items/DOC-003-002-approval.md`
- 实施报告：`docs/work-items/DOC-003-002-report.md`
- 计划候选：`总功能开发计划0.3.md`
- 当前入口：`START-HERE.md`
- 计划校验器：`docs/evidence/raw/validate-plan-0.3.ps1`

## 2. 修改前快照

快照根：`C:\Users\10481\AppData\Local\Temp\diet-manager-doc\DOC-003-002\0afb6ca030734865a6cbe3b57ac6d4e7\before`

| 文件 | 修改前 SHA-256 |
|---|---|
| `总功能开发计划0.3.md` | `05615B79DE7084C8B8A192F91E5264D0EB6C0D490E86FE1E9A5CECB3D01423FF` |
| `START-HERE.md` | `770F7D75C677F95FBC87C62491CB03298157E09FA9C9FB1D90B9E9AB5B8029A6` |
| `validate-plan-0.3.ps1` | `B519A709DD9DC0BEDD8E5C61854B4DD3D2533D75752EE4C7FE69032362F240B6` |

## 3. 待复核候选身份

| 文件 | 候选 SHA-256 |
|---|---|
| `总功能开发计划0.3.md` | `C999A5FDD1BB12659F0A03B4C8E70EC8E48BB83DB760B9E8510F8AAEB72E369F` |
| `START-HERE.md` | `F2EA121E11C791ECE75FF9C175A4A31C3D44E37957764685F659B953FB2E2CF1` |
| `validate-plan-0.3.ps1` | `037AC05F181FEF9F4D00C7DF42E1CD2EC0089F281146A20D675C4E834DF516DA` |
| `DOC-003-002-brief.md` | `585A47C229E55D8E430B608DC708582ACDF35384FD64E2580C0FCFCB3D48319D` |
| `DOC-003-002-approval.md` | `2922862AD9C2814E79D15524F98816830F7EE79A8A76A96917B13BE7AD3C609C` |
| `DOC-003-002-report.md` | `B644B10A56AC3CA3AE7B5EEEE0E4CAAB983E6F451285636A4CAC9E5011BA5B88` |

## 4. 修改范围

- 计划：11行新增、9行修改/替换；未新增 REQ、CASE、TASK、DEC 或会话台账行。
- 入口页：把 DOC-0.3 设为唯一入口并说明 Skill-first 与不可安装边界。
- 校验器：只在既有 required-text 列表追加3条 Skill-first 文本断言；既有结构、覆盖、任务证据和零业务文件断言未删除。
- 新文件：brief、approval、report；没有 EV，候选仍保持`进行中`。

## 5. 复核问题

独立复核者必须回答：

1. 用户两句原话是否被准确保留，是否存在扩大授权；
2. “智能体 Skill 是主交付物、插件/存储只是后端”是否在计划、DEC-018、入口页和批准记录一致；
3. 是否仍明确 PRODUCT 未完成、不可安装，且没有把批准当业务证据；
4. `DOC-003-002=进行中`、`CHG-001=实施中`、7/1/50与 actual evidence 为空是否一致；
5. 计划校验器的新增断言是否没有弱化既有断言；
6. 71/144/58/26/44及完整案例集是否保持；
7. JSONL/SQLite及sidecar是否为0；
8. 是否可以进入新鲜 E-DOC 登记，还是必须先修订。

## 6. 建议只读命令

```powershell
git diff --no-index -- <before-file> <candidate-file>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\validate-plan-0.3.ps1
Get-FileHash -Algorithm SHA256 -LiteralPath <files>
```

复核者不得修改候选文件；结论写入`docs/work-items/DOC-003-002-review.md`由主协调者落盘，或直接向主协调者返回可审计的逐项结论。
