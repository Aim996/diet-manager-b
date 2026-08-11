# DOC-003-002 实施报告：批准入口切换

## 范围与状态

本次仅实现批准入口切换候选。独立复核 P1 判定原候选存在 Skill-first 权威规则重复、REQ/CASE Oracle 未固化及旧 E-DOC 新鲜度失效；现已按 P1 处置：完整决定仅保留在 `DEC-018`，`REQ-SCOPE-003` 与 `CASE-FOUNDATION-001` 分别承载约束和 Oracle，`DOC-003-001` 因 DEC/REQ/CASE/validator 变化重开为进行中，`DOC-003-002` 回到未开始并等待同一新鲜 E-DOC。

第二轮只读复核确认第一轮 P1 已关闭，同时提出两项 P1，均已处置：附录 A 追加第45轮稳定批准来源并同步所有现行45/45视图；新增 `validate-skill-first-foundations.ps1`，以可重复的 PowerShell 5.1 静态检查覆盖三路线 Skill、metadata、A纯Skill边界及B/C唯一插件工具映射。第三轮复核又发现批准记录复制了任务状态；现已删除该状态副本，批准记录只引用总计划唯一台账。

内容候选已经三轮独立复核；联合证据`EV-20260809-011`负责补强五项foundation的Skill-first增量、重验`DOC-003-001`并记录用户批准。该证据不关闭`SH-SAFE-BASE-001`或任何PRODUCT任务。

未创建或修改 JSONL、SQLite 或任何业务/sidecar 数据。已新建 `EV-20260809-011`、其初步 raw、终态封装器和终态 raw；没有覆盖或改写任何既有 EV/raw。该证据仅关闭批准与 Skill-first foundation 增量，不关闭 `SH-SAFE-BASE-001` 或任何 PRODUCT 任务。

## 文件与 SHA-256

| 文件 | 第二轮P1修复前 SHA-256 | 当前 SHA-256 |
|---|---|---|
| `总功能开发计划0.3.md` | `2134FF7E7F426077F15B12EC4D66017CE6110604724540059C35A45C7E627A5B` | `FA3E3216460E1C1608E3C1787F5BEF2F37ADFF97DE08E2007DE955B3C7E771AE` |
| `START-HERE.md` | `F2EA121E11C791ECE75FF9C175A4A31C3D44E37957764685F659B953FB2E2CF1` | `AA43E21E55599D9A962F950753F475FC41D305725DD41C10347751C870B71A47` |
| `docs/evidence/raw/validate-plan-0.3.ps1` | `4A8A062F5B73FFF2E285F259FF0F0460363C27DEF9D7EA665B9F12CEF8E3E6B7` | `3EF7B23A87FE0F94DEFB3D898D2114DB668639FB1096133B6549C768BA6F435D` |
| `docs/evidence/raw/validate-skill-first-foundations.ps1` | 不适用（新建） | `45396B27F420B0E221D53409CFF512DAE4565C104483F0C01A12A43178C3682A` |
| `docs/work-items/DOC-003-002-brief.md` | `585A47C229E55D8E430B608DC708582ACDF35384FD64E2580C0FCFCB3D48319D` | `7A795BCCCE7AFEC2AB13B1F4E9236B6324F8CE0B0B8666B482DEA5B281CD495B` |
| `docs/work-items/DOC-003-002-approval.md` | `2922862AD9C2814E79D15524F98816830F7EE79A8A76A96917B13BE7AD3C609C` | `505EBF05483B86CE77B4583477B7E3EA10E71CCCC5260A0835D70B7423FEBCB7` |
| `docs/evidence/raw/EV-20260809-011-validate-evidence.ps1` | 不适用（新建） | `7F18FD301448B7AB2EFE9E0116A4A71ED0FC64B87437DCA61FA7D54B95AA8790` |
| `docs/evidence/raw/EV-20260809-011-final-output.txt` | 不适用（新建） | `1CC344D26537C6D88849BBFACCBF6B6EA8F06D497893B919B1C6C1397DF41B7A` |
| `docs/work-items/DOC-003-002-report.md` | `37FDD363958F752274D0F9F2464121B769CF802CBCB7562588180CB5A008FD7B` | 不自引用；最终 SHA-256 由交付时的只读哈希命令输出 |

## 验证命令与结果

已在 `E:\codx\skill\饮食管家` 运行；结果如下：

- 终态封装器：退出码 `0`，`VERDICT=PASS`，运行时间 `2026-08-09T18:59:38+08:00` 至 `18:59:52+08:00`；前后业务/sidecar manifest 均为空，A/M/D 均为0，EV文件名与内部ID重复均为0。
- 计划校验器：退出码 `0`，`VERDICT=PASS`；71 REQ、144 CASE、58 TASK、26 DEC、45/45会话、任务案例并集144、发布选择器122/144、8完成/0进行中/50未开始，业务与 sidecar 文件为0。
- 校验器新增并通过 REQ-SCOPE-003、CASE-FOUNDATION-001、DEC-018 各自 Skill-first 语义断言、§4.2 不重复权威规则断言和陈旧批准文字缺失断言。
- 静态 Skill 校验器：退出码 `0`，`VERDICT=PASS`，`SKILL_COUNT=3/3`、`METADATA_COUNT=3/3`、`PLUGIN_EXPECTATION_COUNT=3/3`、`ROUTE_PASS_COUNT=3/3`、`FAILURE_COUNT=0`；脚本非 ASCII 字节数为0，未调用 Node/npm。
- 静态对象 SHA-256：A Skill `464A293FAA34744ED8951B8FB3B8077DC2B803F04404E14D1D71CCEDC155D035`、A metadata `E8FFCAE31C0FBF67F08F61656FC24BBC8FD727375A90357F6E2F6F9F71BD300D`、A manifest按预期不存在；B Skill `98256C98582FC9CB77759D1675400BED86016FD0D70BBE5C225A64649D58D1DB`、B metadata `DDA22E200A37CCCAB8F28ADF74444E83D71961F2A205742699EB6F328219C3F9`、B manifest `EB778C4F7B474472F3E575EB9203C0B8AB1DE32382DB115CBDB04275E66DA5BB`；C Skill `922FF962AF2F98DCC1622700101BC830D303F49EA864D80F7DA8628895F85D1D`、C metadata `E787BFDFBA57B7F6EE60C9ECDD5B3C696DF10209C712B72F57AC3CEB1FDAF0A9`、C manifest `C54AC242D35F4D7D776F56601AD2657B89DA7B4646B9E87F464D8C1B8A06C977`。
- 项目根业务/sidecar 扫描：退出码 `0`，`BUSINESS_SIDECAR_COUNT=0`。
- SHA-256：退出码 `0`；结果见上表（报告文件自身不写入自引用哈希）。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\validate-plan-0.3.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\validate-skill-first-foundations.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-011-validate-evidence.ps1
Get-ChildItem -LiteralPath E:\codx\skill\饮食管家 -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and ($_.Extension -in '.jsonl','.sqlite','.sqlite3','.db' -or $_.Name -match '\.(jsonl|sqlite|sqlite3|db)[.-](wal|shm|journal|tmp|temp|log)$') }
Get-FileHash -Algorithm SHA256 -LiteralPath E:\codx\skill\饮食管家\总功能开发计划0.3.md,E:\codx\skill\饮食管家\START-HERE.md,E:\codx\skill\饮食管家\docs\evidence\raw\validate-plan-0.3.ps1,E:\codx\skill\饮食管家\docs\evidence\raw\validate-skill-first-foundations.ps1,E:\codx\skill\饮食管家\docs\work-items\DOC-003-002-brief.md,E:\codx\skill\饮食管家\docs\work-items\DOC-003-002-approval.md,E:\codx\skill\饮食管家\docs\work-items\DOC-003-002-report.md
```
