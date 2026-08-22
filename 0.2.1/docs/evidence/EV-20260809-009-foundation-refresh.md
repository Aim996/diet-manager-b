# EV-20260809-009：三条 foundation 新鲜重验与零业务数据基线

## 1. 结论

- 最终结论：`PASS`
- foundation执行时间：2026-08-09 16:59—17:00（Asia/Shanghai）；证据身份与清理最新复核时间见结构化元数据
- 执行环境：Windows PowerShell 5.1；隔离 Node 24.15.0
- 结果：A结构通过；B、C各7/7测试、TypeScript构建和OpenClaw插件验证通过；状态隔离回归通过。
- 正式业务数据：执行前0、执行后0、manifest差异0；OpenClaw临时状态残留0。
- 本证据使用全新编号与独立原始输出，替代因编号和原始输出路径碰撞而失效的旧foundation报告；碰撞历史保留在`COLLISION-20260809-foundation-refresh-invalid.md`。

## 2. 结构化元数据

```yaml
evidence_schema_version: EV-v2
evidence_id: EV-20260809-009
started_at: 2026-08-09T16:59:00+08:00
foundation_finished_at: 2026-08-09T17:00:00+08:00
evidence_audit_reverified_at: 2026-08-09T17:22:14+08:00
finished_at: 2026-08-09T17:25:58+08:00
timezone: Asia/Shanghai
task_ids:
  - A-FND-001
  - B-FND-001
  - C-FND-001
  - SH-FND-001
  - SH-FND-REFRESH-001
case_ids:
  - CASE-FOUNDATION-001
  - CASE-FOUNDATION-002
requirement_ids:
  - REQ-SCOPE-003
  - REQ-SAFE-004
risk_ids: []
change_ids:
  - CHG-20260809-001
contract_versions:
  business_contract: CONTRACT-v1@CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
official_data_roots: []
scanned_roots:
  - E:\codx\skill\饮食管家
isolated_test_roots:
  - "%TEMP%\\diet-manager-openclaw-<guid>"
validation_roots:
  - E:\codx\skill\饮食管家
build_roots:
  - E:\codx\skill\饮食管家\version-b-lite-plugin\dist
  - E:\codx\skill\饮食管家\version-c-strict-plugin\dist
openclaw_state_roots:
  - "%TEMP%\\diet-manager-openclaw-<guid>"
backup_roots: []
export_roots: []
evidence_roots:
  - E:\codx\skill\饮食管家\docs\evidence
machine_report_path: E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-009-evidence-audit-output.txt
machine_report_sha256: A0BAD01E8D3500FD6259D97459E40070049AB5DEFA0F45BA9811F15787D6E42D
evidence_validator_path: E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-009-validate-evidence.ps1
evidence_validator_sha256: BD091A39C673E30BF95C7CEC4C37E8C206D8BCC3829C88E2FAB1ECD3B15B4D93
schema_artifacts: not_applicable_foundation_only
candidate_package: not_applicable_foundation_only
cleanup_verified_at: 2026-08-09T17:17:30+08:00
route_results:
  - command_id: foundation-a-structure
    route: A
    working_directory: E:\codx\skill\饮食管家
    command: powershell -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\version-a-skill-only\tests\validate-foundation.ps1
    exit_code: 0
    result: structure_pass
  - command_id: foundation-b-test
    route: B
    working_directory: E:\codx\skill\饮食管家\version-b-lite-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\vitest\vitest.mjs run
    exit_code: 0
    result: 7_of_7_pass
  - command_id: foundation-b-build
    route: B
    working_directory: E:\codx\skill\饮食管家\version-b-lite-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\typescript\bin\tsc -p tsconfig.json
    exit_code: 0
    result: build_pass
  - command_id: foundation-b-openclaw
    route: B
    working_directory: E:\codx\skill\饮食管家\version-b-lite-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs plugins validate --root . --entry ./dist/index.js
    exit_code: 0
    result: plugin_valid
  - command_id: foundation-c-test
    route: C
    working_directory: E:\codx\skill\饮食管家\version-c-strict-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\vitest\vitest.mjs run
    exit_code: 0
    result: 7_of_7_pass
  - command_id: foundation-c-build
    route: C
    working_directory: E:\codx\skill\饮食管家\version-c-strict-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\typescript\bin\tsc -p tsconfig.json
    exit_code: 0
    result: build_pass
  - command_id: foundation-c-openclaw
    route: C
    working_directory: E:\codx\skill\饮食管家\version-c-strict-plugin
    command: C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs plugins validate --root . --entry ./dist/index.js
    exit_code: 0
    result: plugin_valid
  - command_id: state-isolation
    route: shared
    working_directory: E:\codx\skill\饮食管家
    command: powershell -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-foundations-state-isolation.ps1
    exit_code: 0
    result: state_restored_and_temp_removed
  - command_id: post-evidence-audit
    route: shared
    working_directory: E:\codx\skill\饮食管家
    command: powershell -NoProfile -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-009-validate-evidence.ps1
    exit_code: 0
    executed_at: 2026-08-09T17:22:14+08:00
    result: 38_identities_business_0_sidecar_0_temp_0_collision_0
business_impact: zero
verdict: PASS
executor: Codex
independent_reviewer: Codex /root/final_evidence_audit
independent_reviewed_at: 2026-08-09T17:25:58+08:00
independent_review_status: passed
independent_review_conclusion: PASS — EV-20260809-009的有效文件名、内部ID和raw路径唯一；38项输入/工具/构建身份与机器报告一致；A结构、B/C各7/7、构建、OpenClaw、状态隔离均有route结果；business/sidecar/OpenClaw/Node/project-temp均为0；证据边界未越权，五个foundation任务可引用。
```

五个`task_ids[]`均由同一次总验证实际覆盖：A结构、B/C测试/构建/插件验证、共享状态隔离和业务文件扫描分别有对应输出；本证据不支撑任何PRODUCT业务任务。

## 3. 逐命令结果

| command_id | 工作目录与命令 | exit_code | 结果 |
|---|---|---:|---|
| `foundation-all` | 项目根；`shared/validate-foundations.ps1`，显式Node 24.15.0与OpenClaw入口 | 0 | A结构PASS；B/C各7/7、build、plugin PASS |
| `state-isolation` | 项目根；`shared/tests/validate-foundations-state-isolation.ps1` | 0 | 环境恢复与临时状态清理PASS |
| `post-scan` | 项目根；JSONL/SQLite/DB及WAL/SHM/journal/temp/log sidecar扫描 | 0 | 前后0、差异0、临时残留0 |
| `evidence-audit` | 项目根；`docs/evidence/raw/EV-20260809-009-validate-evidence.ps1` | 0 | 38项文件身份、业务0、sidecar 0、OpenClaw/Node临时根0、EV碰撞0 |

原始执行输出：`docs/evidence/raw/EV-20260809-009-foundation-validation-output.txt`；SHA-256为`14AC5522A1D565779A1FC4378D62B007D2193FC9CB5286A0A808672152FDDE2A`。该文件按实际控制台顺序保存；仅去除了Vitest ANSI颜色码、毫秒耗时和空白装饰，没有增删通过项、退出码或隔离计数。机器身份/清理复核输出：`docs/evidence/raw/EV-20260809-009-evidence-audit-output.txt`，SHA-256为`A0BAD01E8D3500FD6259D97459E40070049AB5DEFA0F45BA9811F15787D6E42D`；其只读脚本SHA-256为`BD091A39C673E30BF95C7CEC4C37E8C206D8BCC3829C88E2FAB1ECD3B15B4D93`。

## 4. 环境、来源与完整执行方式

| 项目 | 实际值/来源 |
|---|---|
| Windows | `Microsoft Windows NT 10.0.26200.0` |
| Windows PowerShell | `5.1.26100.8875` |
| Node | `24.15.0`；`https://nodejs.org/dist/v24.15.0/node-v24.15.0-win-x64.zip`；官方压缩包hash见下表 |
| npm/pnpm | EV-009的新鲜成功命令未调用；此前为恢复旧`node_modules`链接曾用pnpm 11.16.0，但该准备步骤无独立raw，不计入EV-009完成证明 |
| Vitest | `2.1.9`；使用C路线已有`node_modules`中的受控入口 |
| TypeScript | `5.9.3`；使用C路线已有`node_modules`中的受控入口 |
| OpenClaw | `2026.7.1`；使用C路线已有`node_modules/openclaw/openclaw.mjs` |
| 工作目录 | `E:\codx\skill\饮食管家` |
| 隔离Node实际根 | `C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009`；成功执行后曾因清理遗漏短暂保留，独立审计发现后补清，17:17:30复核不存在 |
| OpenClaw状态根 | 每次唯一`%TEMP%\diet-manager-openclaw-<guid>`；命令后清理并复核残留0 |

实际执行等价命令如下；环境变量只为本次进程提供已校验运行时，未改用户持久环境：

```powershell
$env:DIET_MANAGER_NODE='C:\Users\10481\AppData\Local\Temp\diet-manager-node-refresh-20260809-ev009\node-v24.15.0-win-x64\node.exe'
$env:DIET_MANAGER_TOOL_MODULES='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules'
$env:DIET_MANAGER_OPENCLAW_ENTRY='E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs'
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\codx\skill\饮食管家\shared\validate-foundations.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\codx\skill\饮食管家\shared\tests\validate-foundations-state-isolation.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\codx\skill\饮食管家\docs\evidence\raw\EV-20260809-009-validate-evidence.ps1'
```

成功重跑外层包装所使用的前后业务/sidecar扫描逻辑如下；`$before`在foundation命令前取得，`$after`在foundation与状态隔离命令退出0后取得：

```powershell
function Get-BusinessManifest {
    @(Get-ChildItem -LiteralPath 'E:\codx\skill\饮食管家' -Recurse -File -ErrorAction Stop |
        Where-Object {
            $_.FullName -notmatch '\\node_modules\\' -and
            $_.Name -match '\.(jsonl|sqlite|sqlite3|db)([.-](wal|shm|journal|tmp|temp|log))?$'
        } |
        ForEach-Object {
            $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
            '{0}|{1}|{2}' -f $_.FullName,$_.Length,$hash
        } | Sort-Object)
}
$before = Get-BusinessManifest
# 在此执行上列foundation-all和state-isolation命令，并检查各自退出码为0。
$after = Get-BusinessManifest
$diff = @(Compare-Object -ReferenceObject @($before) -DifferenceObject @($after))
$openClawLeftovers = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'diet-manager-openclaw-*' })
# 断言：before.Count=0、after.Count=0、diff.Count=0、openClawLeftovers.Count=0。
```

17:17:30首次完成清理确认；17:22:14又使用完整、可直接执行的`EV-20260809-009-validate-evidence.ps1`重新复核，进一步把业务文件与sidecar拆开计数，并验证输入/产物hash、两类临时根和EV编号唯一性。完整命令、脚本hash和最新原始输出hash已在元数据中冻结。

## 5. 关键文件SHA-256

| 文件 | SHA-256 |
|---|---|
| `shared/validate-foundations.ps1` | `47EAB29BE03D1BA83A20BEA5A00CE860D8E9D26EDB15B026AD7FF3C57F0DBDEB` |
| `shared/tests/validate-foundations-state-isolation.ps1` | `A9EF8248DF8AF4588B83F375D7194C077EF9373F13F60D6F3BD82F261EA87D6D` |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` |
| `shared/acceptance-cases/cases.json` | `C489E6A12F331B5438BEFF11864E80BCA4435891D42C367C1A4AECADF3441399` |
| `version-b-lite-plugin/package.json` | `94F6BF5D304E654B86BE3D09FD5EB3AABFCB3F26271FEFBBB4A58E8AB165318C` |
| `version-c-strict-plugin/package.json` | `07793D2D2A8ED476E8A2FD04394BED59B23921B0F68BADC145AAEBD9850629F6` |
| Node 24.15.0官方zip | `CC5149EABD53779CE1E7BDC5401643622D0C7E6800ADE18928A767E940BB0E62` |
| Node 24.15.0 `node.exe` | `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5` |

完整验证输入与构建产物均已绑定。下表列路线关键身份；每项的字节数、完整SHA-256与UTC mtime由上面的不可变机器报告逐行给出，共38项：

| 路线/类别 | 文件 | SHA-256 |
|---|---|---|
| A/验证 | `version-a-skill-only/tests/validate-foundation.ps1` | `67B1E274B2432D9149AB3937B83EFBB71F053C8EF2EFF6749FC0CEB620085047` |
| A/Skill | `version-a-skill-only/skills/diet-manager-a/SKILL.md` | `464A293FAA34744ED8951B8FB3B8077DC2B803F04404E14D1D71CCEDC155D035` |
| A/metadata | `version-a-skill-only/skills/diet-manager-a/agents/openai.yaml` | `E8FFCAE31C0FBF67F08F61656FC24BBC8FD727375A90357F6E2F6F9F71BD300D` |
| A/storage | `version-a-skill-only/storage-contract.md` | `E2D09663B6352417C56DCA706D5DB18A2FF5AABCAF5487978ED5B1268ED61445` |
| B/src | `version-b-lite-plugin/src/contracts.ts` | `FB2CE822B6433B89CFA08735C2E4E92DFB6C61C036861AEA83770B61F740DC3F` |
| B/src | `version-b-lite-plugin/src/index.ts` | `F963BE39A2D13FA86AABE8F450254F86F91CDDD668F375562AF415CB40FD52C5` |
| B/test | `version-b-lite-plugin/tests/foundation.test.ts` | `75596DF5F15224628269F9BE2BDB4F8E512200BA78AF15F16269F2ABA9BC70AC` |
| B/config | `version-b-lite-plugin/openclaw.plugin.json` | `EB778C4F7B474472F3E575EB9203C0B8AB1DE32382DB115CBDB04275E66DA5BB` |
| B/config | `version-b-lite-plugin/tsconfig.json` | `62CEFCCD78C0B1870ADB362DFF314F10A74E00231807DED13E78FC5804964046` |
| B/build | `version-b-lite-plugin/dist/contracts.js` | `CD72130FC9CD2895D959EB957A161DAB833DB081AFDF265FADE76BF686CF8309` |
| B/build | `version-b-lite-plugin/dist/index.js` | `4C18F6760FE6B5101A0BAB311C03A0136832EF65AB529673E15196E7836EDBA1` |
| C/src | `version-c-strict-plugin/src/contracts.ts` | `4E57B977251825373576E37646A4D83D49B3E5318C3596C0F94FFF7C4D9A37BA` |
| C/src | `version-c-strict-plugin/src/index.ts` | `9728651EBA563E1C24B43E11D3204BA705E9584CE69E74C4EC00D8A777DD88EA` |
| C/src | `version-c-strict-plugin/src/state-machine.ts` | `89B4F44BB024466D624D0271987B97BBD55ACAFCCB3E712B127E91A486BBF4B2` |
| C/test | `version-c-strict-plugin/tests/foundation.test.ts` | `B16599282D286B6EC7E9110C587E9A78B7177E0185E5F98832368074D15F93C8` |
| C/config | `version-c-strict-plugin/openclaw.plugin.json` | `C54AC242D35F4D7D776F56601AD2657B89DA7B4646B9E87F464D8C1B8A06C977` |
| C/config | `version-c-strict-plugin/tsconfig.json` | `5DD25FBAD00AEA30442E2967BF01757C89C090B8169FD61174AE1989AE9A4751` |
| C/build | `version-c-strict-plugin/dist/contracts.js` | `C4659AADD33945FE094D28519730DA9F7462C241EB9DB02A22388B006ABE7361` |
| C/build | `version-c-strict-plugin/dist/index.js` | `0D83061BB12085E31E632D1C536051DCAC102B076CDFB6A4FEE3637778A895CA` |
| C/build | `version-c-strict-plugin/dist/state-machine.js` | `5E75944752801B7C99C9BC83E7FE084F129B2D2A5AE7E99F7240DE47BF368E19` |
| tool/Vitest | `version-c-strict-plugin/node_modules/vitest/vitest.mjs` | `39DB22F579ACF5639BBB17A261408DEBBDE03F4692C0C439E77E7F13AEBA74D6` |
| tool/TypeScript | `version-c-strict-plugin/node_modules/typescript/bin/tsc` | `8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0` |
| tool/OpenClaw | `version-c-strict-plugin/node_modules/openclaw/openclaw.mjs` | `F643B005D6DB233A0B45204E8D8E943256874CCC6897B8A6E0CF42A9B376A188` |

本任务验证的是foundation，不存在业务Schema冻结或可发布候选包；两者在结构化元数据中显式标为`not_applicable_foundation_only`，不能据此宣称产品候选已经形成。

## 6. 数据隔离、清理与证据边界

本轮扫描项目根中`.jsonl`、`.sqlite`、`.sqlite3`、`.db`及其WAL、SHM、journal、temp、log辅助文件，前后manifest均为空集，因此新增、修改、删除清单均为`[]`；未创建JSONL或SQLite业务数据。结构化值如下：

```yaml
business_manifest_before:
  root: E:\codx\skill\饮食管家
  patterns: [.jsonl, .sqlite, .sqlite3, .db]
  count: 0
  total_bytes: 0
  entries: []
business_manifest_after:
  root: E:\codx\skill\饮食管家
  patterns: [.jsonl, .sqlite, .sqlite3, .db]
  count: 0
  total_bytes: 0
  entries: []
sidecar_manifest_before:
  suffixes: [.wal, .shm, .journal, .tmp, .temp, .log]
  count: 0
  total_bytes: 0
  entries: []
sidecar_manifest_after:
  suffixes: [.wal, .shm, .journal, .tmp, .temp, .log]
  count: 0
  total_bytes: 0
  entries: []
added: []
modified: []
deleted: []
```

空manifest没有可填写的逐文件路径、大小、SHA-256或mtime，故`entries: []`是完整值而非省略。原始执行raw给出前后业务/sidecar合并扫描计数与差异0；17:17:30首次完成清理确认，17:22:14的最新机器复核再次分开输出`BUSINESS_COUNT=0`、`SIDECAR_COUNT=0`及两个`ENTRIES=[]`，并验证OpenClaw临时根0、Node临时根0、项目`.codex-temp`不存在、有效EV编号碰撞0。

调用者状态恢复测试退出0。验证使用的Node运行时位于系统临时目录，不参与项目术语扫描；成功执行后独立复核发现该Node临时根尚未清理，随后只删除本轮精确临时根，并在17:17:30首次验证为0、17:22:14再次验证为0。此延后清理被如实记录，不能把17:00的原始命令误述为已完成Node工具清理；清理不改变项目或业务数据。

### 6.1 本轮发现、诊断和修复的失败

1. 初始环境没有PATH可用npm；Codex随附Node为24.14.0，低于OpenClaw 2026.7.1要求的24.15.0。处理：从Node官方固定URL获取24.15.0 zip，先校验SHA-256再使用，不修改用户PATH。
2. B/C旧`node_modules`链接不完整，真实Vitest最初缺`@vitest/utils`。在EV-009新鲜成功运行之前，曾使用pnpm 11.16.0恢复两路线依赖链接且未生成项目锁文件；该准备步骤没有独立raw，所以不计入EV-009的完成命令或退出码，只作为诊断背景。EV-009只证明修复后受控入口可重现B/C各7/7、构建和插件验证。
3. 第一次EV-009尝试把隔离Node临时展开到项目内`.codex-temp`，A/B/C功能检查均通过，但末尾术语扫描把`node.exe`二进制中的偶然字节序列误识别成禁用中文术语，命令退出1。处理：把已校验运行时移到系统临时根、移走项目内临时文件，再从头重跑全部命令；最终退出0。该失败未创建业务数据，也未被改写成成功证据。

以上修复只解决本轮可执行环境和误扫；验证器自身“扫描二进制、失败路径不保证后置扫描、源码内构建”等结构性盲区仍明确留给`SH-SAFE-BASE-001`，不得因本轮PASS而隐藏。

本证据只证明当前foundation及空业务数据基线，不证明完整饮食业务已实现，也不关闭以下缺口：预置正式数据哈希、任一前置命令失败后的强制扫描、删除临时状态前审计、源码树外构建。它们继续由`SH-SAFE-BASE-001`在G1前关闭。
