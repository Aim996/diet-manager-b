# SH-SAFE-BASE-001 实施简报

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:test-driven-development` while implementing this brief and `superpowers:verification-before-completion` before reporting completion. Execute the RED matrix before changing production code.

**Goal:** 加固三路线 foundation 统一验证器，使固定正式数据根在成功、任一物理命令失败和清理失败时都保持零新增、零修改、零删除，并为命令、manifest、临时根、子进程洁净环境、调用者环境不变和源码外构建生成可机器复核的原始证据。

**Architecture:** 生产入口只从脚本自身位置解析项目根和固定数据根；可测试 core 负责路径安全、manifest、九个物理阶段、外层 `finally`、子进程 clean-room 环境、调用者环境前后不变校验、审计清理和 JSON 报告。测试通过内部 adapter 注入命令及清理失败，不调用真实 npm、Node、Vitest、TypeScript 或 OpenClaw；GREEN 后再以显式冻结的真实运行时执行一次生产入口。

**Tech Stack:** Windows PowerShell 5.1、.NET Framework 4.x、SHA-256、JSON、现有 Node/Vitest/TypeScript/OpenClaw 运行时。

## 1. 任务身份与追踪

- `task_id`: `SH-SAFE-BASE-001`
- 阶段/类型/范围：`M1/safety/shared`
- 需求：`R[REQ-SAFE-001,REQ-SAFE-004]`
- 案例：`C[CASE-STORAGE-004,CASE-FOUNDATION-002]`
- `full_case_set`: `none`
- 依赖：`DOC-003-002`
- 根配置：`ROOT-SHARED`
- 证据类型：`E-STOR`
- 风险：`RISK-011`
- 决定：`DEC-026`
- 技术债：`DEBT-001`、`DEBT-006`
- change IDs：空集合；本任务不创建或暗示新的 `CHG-*`。
- owner/主协调者：`Codex /root`。
- 测试实现者：`Codex /root/doc003002_reviewer`；只负责RED测试，不负责最终独立复核。
- 独立安全复核者：`Codex /root/plan_consistency_audit`；不得编写本任务生产实现。
- 状态、总计划任务行和 `actual_evidence_ids` 只允许主协调者在独立复核通过后回写；实施者不得修改总计划。

本简报的规范来源是 `总功能开发计划0.3.md` 的 §21.2、§21.10—§21.15、§24.4—§24.5、§25 的 `CASE-STORAGE-004`/`CASE-FOUNDATION-002`、§27 的 `DEC-026`/`RISK-011`/`DEBT-001`/`DEBT-006`、§28.1、§29.3/§29.5 和 §31 的 `SH-SAFE-BASE-001` 行。若本简报与总计划冲突，以总计划为准并停止实施，不能在代码中自行发明第二套根或证据规则。

## 2. 案例断言责任边界

本任务只产生验证设施和安全包装器直接负责的局部断言，不认领任一案例整案，不产生 G1 路线通过结论：

```yaml
case_assertion_paths:
  CASE-STORAGE-004:
    - /oracle/path_safety/official_roots_source
    - /oracle/path_safety/traversal_rejected
    - /oracle/path_safety/absolute_external_path_rejected
    - /oracle/path_safety/prefix_collision_rejected
    - /oracle/path_safety/reparse_point_escape_rejected
    - /oracle/path_safety/out_of_root_write_count
  CASE-FOUNDATION-002:
    - /oracle/official_manifest/diff/added
    - /oracle/official_manifest/diff/modified
    - /oracle/official_manifest/diff/deleted
    - /oracle/project_business_candidates/diff/added
    - /oracle/project_business_candidates/diff/modified
    - /oracle/project_business_candidates/diff/deleted
    - /oracle/failure_path/after_manifest_generated
    - /oracle/environment/restored
    - /oracle/openclaw_state/pre_delete_audit
    - /oracle/temporary_roots/residual_count
    - /oracle/source_dist/diff
full_case_set: none
```

这些路径的本任务 Oracle 固定如下：

| Oracle path | 本任务通过值 |
| --- | --- |
| `/oracle/path_safety/official_roots_source` | `fixed_project_layout`，且正好解析 A/B/C 三个版本根下的 `data` 目录 |
| `/oracle/path_safety/*_rejected` | 对应恶意路径被拒绝，错误码稳定，目标外部目录零写入 |
| `/oracle/path_safety/out_of_root_write_count` | `0` |
| `/oracle/official_manifest/diff/added` | `[]` |
| `/oracle/official_manifest/diff/modified` | `[]` |
| `/oracle/official_manifest/diff/deleted` | `[]` |
| `/oracle/project_business_candidates/diff/added` | `[]`；固定project/A/B/C范围内无新增业务或sidecar候选 |
| `/oracle/project_business_candidates/diff/modified` | `[]`；固定project/A/B/C范围内无修改业务或sidecar候选 |
| `/oracle/project_business_candidates/diff/deleted` | `[]`；固定project/A/B/C范围内无删除业务或sidecar候选 |
| `/oracle/failure_path/after_manifest_generated` | 按§5.1.5的结构谓词计算；任一命令或清理失败时仍须为`true`。该值只表示本轮fresh after观察已形成，不表示`coverage_complete=true`、diff为空或验证通过 |
| `/oracle/environment/restored` | `true`；兼容名称表示调用者进程环境前后完全相同。实现不得修改调用者环境，因此不执行“先改后恢复”；报告同时写`mutation_attempted=false`、`caller_unchanged=true` |
| `/oracle/openclaw_state/pre_delete_audit` | 删除前完成且全部内容进入报告；`business_candidate_count=0`；OpenClaw 2026.7.1精确内部状态单列并在随后清理 |
| `/oracle/temporary_roots/residual_count` | `0`；任何残留使验证失败 |
| `/oracle/source_dist/diff` | B/C 源码树 `dist` 的 added/modified/deleted 全为空 |

`CASE-STORAGE-004` 的真实业务 handler、A JSONL 写入事务和 B/C SQLite 写入路径仍由路线存储任务产生；逐路线风险任务只提供真实候选输入，`CASE-FOUNDATION-002` 的固定整案责任唯一属于 `X-GATE-001`。本任务的 mock EV 不得被表述为完整 CASE 或 G1 证据。

## 3. 唯一授权文件与职责

本任务的实现差异只允许创建或修改以下四个交付路径：

1. `shared/validate-foundations.ps1`
   - 生产薄入口；只从 `$PSScriptRoot` 解析项目根；装配真实命令 adapter；选择固定 evidence root；调用 core；最后以报告 verdict 返回进程退出码。
2. `shared/private/foundation-validation-core.ps1`
   - 路径规范化与 containment、reparse-point 拒绝、manifest、diff、九阶段调度、进程捕获、子进程环境白名单、调用者环境前后快照、临时根审计/清理、JSON/raw 日志写入。
3. `shared/tests/validate-data-manifests.ps1`
   - 固定根、路径注入、sidecar、预置数据不变、九阶段失败、源码外构建、报告字段和临时残留的参数化 RED 测试。
4. `shared/tests/validate-foundations-state-isolation.ps1`
   - 调用者环境变量存在/不存在、OpenClaw 临时根、删除前审计、命令失败和清理失败的集中回归。

上述四个路径已同时登记到总计划§29.3文件责任图和§31任务交付物。证据产物是唯一例外：实际RED/GREEN/真实运行后，主协调者可在`docs/evidence/raw/`新建不可覆盖的命令raw与机器JSON；独立复核后可在`docs/evidence/`新建一个EV-v2报告。它们不属于实现差异，不得预先伪造PASS，也不得覆盖历史EV/raw。除此之外，不得修改 B/C `package.json`、`tsconfig.json`、A 路线结构脚本、三路线源代码/测试、共同案例、Schema、现有证据或其他 work item；总计划状态只由主协调者按重开/完成规则回写。测试脚本自身只写系统临时目录，命令结束后由主协调者冻结控制台raw/hash。

并发基线说明：本团队之外的工作正在修改另一任务的五个精确交付路径。`concurrent_external_lease_paths`唯一集合为：`shared/contracts/data-model.md`、`shared/schemas/domain.schema.json`、`shared/schemas/fixtures/domain-cases.json`、`shared/tests/validate-domain-schema.mjs`、`shared/tests/validate-domain-schema.ps1`。路径以规范相对路径和`OrdinalIgnoreCase`去重；禁止目录、通配、前缀或后代扩展。该集合只是dirty-worktree外部租约，不是SH-SAFE授权：本任务owner、测试者、core、生产入口和runner均不得创建、编辑、删除、重命名、清理、复制到staging、执行或把它们作为实现、RED、真实运行输入。若新增任何依赖，立即暂停重新设计。

五项外部租约的best-effort启动身份保存在`docs/evidence/raw/SH-SAFE-BASE-001-concurrent-external-lease-start-20260809T202357+0800.txt`，SHA-256 `2085EAE053693E379BECAEC4D345DF98C29691E34B7F71DB3F1E141F4A8A28EC`。Task5结束时另建不可覆盖的end identity，字段固定为`exists/path/size/SHA-256/mtime/read_error`；变化只分类为`external_concurrent_diff`，不计入SH-SAFE verdict、交付物或业务影响，也不证明内容正确。读取不一致或共享冲突只记录，不重试写、不锁定、不回退。最终EV必须披露起止身份、外部归属未确认以及SH-SAFE零归因/零正确性结论。

权威`protected_source_manifest`为`docs/evidence/raw/SH-SAFE-BASE-001-protected-source-authoritative-20260809T202357+0800.txt`，SHA-256 `A0DAE4030F49B8B76348B74EBBFCC73BDDCAB87D19D5102DD4CB2A51A7676343`，恰含其余27项，启动前fresh差异0。最初32项清单`7A287D...`及两次被外部续写失效的捕获`153988...`、`EC8585...`只保留历史，禁止用于PASS。27项范围是项目内`shared`与A/B/C路线，排除`node_modules`、`data`、`dist`、evidence、四个授权实现路径和上述五个精确外部租约文件；Task5后按同一OrdinalIgnoreCase算法比较path/size/SHA/mtime，added/modified/deleted必须全空。这里“任何第六个非授权路径”精确指`shared`或A/B/C运行/源码范围内、既不在27项基线也不在既定专门manifest/guard/四授权路径/五租约中的新变化；出现即失败暂停。`docs/work-items`中的其他任务文档不属于运行输入或protected-source集合，外部并发修改按dirty-worktree记录但不扩充运行时租约、不影响SH-SAFE verdict；SH-SAFE代理仍不得编辑或归因这些文档。`data`、源码`dist`、依赖cache guards、四类运行根及四个授权文件的现有门不受租约豁免；五项外部工作若产生额外运行/源码路径或业务类JSONL/SQLite，仍由对应全局扫描失败。

## 4. 固定根与路径安全设计

### 4.1 固定数据根

生产入口必须以 `shared/validate-foundations.ps1` 的 `$PSScriptRoot` 为锚点，计算：

```text
project_root = parent(shared)
A data root = project_root/version-a-skill-only/data
B data root = project_root/version-b-lite-plugin/data
C data root = project_root/version-c-strict-plugin/data
```

- A 的固定 JSONL 文件名已由现有存储文字契约冻结。
- B/C 当前只冻结到各自版本运行时 `data` 根，精确 SQLite 文件名尚未由 G1 存储任务冻结；本任务扫描该根内全部匹配文件，但不得在报告中虚构正式数据库文件名。
- 生产入口不得接受 `OfficialDataRoot`、`ProjectRoot` 或同义公共参数，不得从聊天文本或 `DIET_MANAGER_*OFFICIAL*` 环境变量替换固定根。
- core 可接受内部 `ProjectRoot`/adapter 以运行临时 fixture，但该接口不得由生产入口透传用户输入。

### 4.2 规范化与逃逸拒绝

路径 helper 必须：

1. 对可信项目锚点使用绝对路径；对不存在的固定叶目录先解析最近存在的父目录，再组合固定叶名。
2. 使用 `[System.IO.Path]::GetFullPath()` 规范化，不依赖 .NET Framework 不存在的 `Path.GetRelativePath()`。
3. containment 使用带尾目录分隔符的规范路径和 `StringComparison.OrdinalIgnoreCase`；裸 `StartsWith` 不合格。
4. 拒绝 `..` 穿越、绝对外部路径、盘符切换、UNC以及Windows device/NT namespace；`\\server\share`、`\\?\`、`\\.\`、`\??\`及规范化后等价形式统一按`PATH_OUTSIDE_ALLOWED_ROOT`失败关闭。拒绝`data`/`data-evil`前缀碰撞。
5. 对正式根、四类执行根、guard和任意`Resolve-FoundationChildPath`目标及其所有已存在祖先检查`FileAttributes.ReparsePoint`；“所有祖先”必须从candidate逐级覆盖`trusted_parent`并继续到对应卷根，不能在`trusted_parent`提前停止。caller/candidate出现junction/symlink一律失败关闭，不递归跟随，也不得把NT/device substitute name转换成可接受路径。唯一例外是§4.7/§6固定dependency resolver：它只对已经按§4.6 no-follow打开的冻结tool junction读取raw substitute name并执行一次严格转换；精确`\??\X:\...`只去掉`\??\`得到本地盘符路径，`\??\UNC\server\share\...`转换成UNC后立即因local-only失败，GLOBALROOT、device、volume GUID、其他NT前缀、相对target、链式reparse全部拒绝。若交叉读取handle final path，只允许把精确`\\?\X:\...`转换为`X:\...`后比较；`\\?\UNC`仍立即拒绝，其他prefix不得清洗。两结果须OrdinalIgnoreCase一致，再验证target存在、ordinary且位于冻结精确`.pnpm`；该转换函数不得被通用root/child/manifest/evidence/cleanup或typebox physical path调用，也不能扩展到caller路径。
6. 逐段创建只授权给本轮明确可写的四个临时执行根及其预登记build/staging、runtime-snapshot、policy-attestation后代，以及固定evidence根内预登记的raw/JSON父目录与唯一目标；这些可写路径尚不存在时，必须先检查最近已存在祖先直至卷根，再从上到下逐段创建，每创建一段立即重新检查完整祖先链。禁止裸递归`Directory.CreateDirectory`跨越未验证多段。official/project/source-dist/guard/dependency source只读根只观察绝不创建。`Resolve-FoundationChildPath`保持零写；使用前/cleanup前复核完整链，祖先reparse/identity变化即失败关闭。
7. 删除只能使用§4.6自写Windows no-follow walker；禁止`Remove-Item -Recurse`、`Directory.Delete(path,true)`或先枚举字符串路径再交给另一递归删除器。删除前再次验证目标是本次`run_id`下的精确临时根；禁止删除caller `%TEMP%`、§4.4 `temporary_parent`本身、项目根、用户目录或未解析变量。
8. 三个data根互不包含；四个临时根是同一冻结`temporary_parent`下的四个类型兄弟，彼此双向不包含。完整根矩阵按§4.5执行，不能用“都是绝对路径”代替。

### 4.3 四类临时兄弟根

每次运行生成同一个`task_id/run_id`，四根使用类型前缀形成互不包含的兄弟目录；生产入口不得读取、采用或规范化caller的`TEMP/TMP/TMPDIR`来选择根，生产`temporary_parent`必须精确等于§4.4字面值并作为`Runtime.temporary_parent`传入core。`isolated_test_root`保持总计划`ROOT-SHARED`的精确模式：

```text
C:\Users\10481\AppData\Local\Temp\diet-manager-shared\isolated-test\SH-SAFE-BASE-001\<guid>
C:\Users\10481\AppData\Local\Temp\diet-manager-shared\validation\SH-SAFE-BASE-001\<guid>
C:\Users\10481\AppData\Local\Temp\diet-manager-shared\build\SH-SAFE-BASE-001\<guid>
C:\Users\10481\AppData\Local\Temp\diet-manager-shared\openclaw\SH-SAFE-BASE-001\<guid>
```

它们依次映射 `isolated_test_root`、`validation_root`、`build_root`、`openclaw_state_root`。任何创建、审计或删除失败都进入机器报告并使 verdict 失败。

### 4.4 本轮启动前已解析的绝对根、运行时和命令

```yaml
official_data_roots:
  A: E:\codx\skill\饮食管家\version-a-skill-only\data
  B: E:\codx\skill\饮食管家\version-b-lite-plugin\data
  C: E:\codx\skill\饮食管家\version-c-strict-plugin\data
evidence_root: E:\codx\skill\饮食管家\docs\evidence
temporary_parent: C:\Users\10481\AppData\Local\Temp\diet-manager-shared
isolated_test_root_template: <temporary_parent>\isolated-test\SH-SAFE-BASE-001\<run_id>
validation_root_template: <temporary_parent>\validation\SH-SAFE-BASE-001\<run_id>
build_root_template: <temporary_parent>\build\SH-SAFE-BASE-001\<run_id>
openclaw_state_root_template: <temporary_parent>\openclaw\SH-SAFE-BASE-001\<run_id>
runtime_snapshot_root_template: <validation_root>\runtime-snapshot
runtime_snapshot_node_root_template: <validation_root>\runtime-snapshot\node
runtime_snapshot_pnpm_root_template: <validation_root>\runtime-snapshot\pnpm
runtime_policy_bootstrap_template: <validation_root>\runtime-snapshot\policy\foundation-node-policy.mjs
dependency_source_roots:
  node_24_15_0: C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0
  tool_modules: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules
runtime:
  temporary_parent: C:\Users\10481\AppData\Local\Temp\diet-manager-shared
  node_path: C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe
  tool_modules_path: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules
  vitest_path: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\vitest\vitest.mjs
  typescript_path: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\typescript\bin\tsc
  openclaw_path: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs
  dependency_source_roots:
    node_root: C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0
    tool_modules_root: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules
    pnpm_root: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm
    typebox_root: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\typebox@1.3.11\node_modules\typebox
  protected_external_paths:
    jiti_openclaw_cache_guard: C:\Users\10481\AppData\Local\Temp\jiti\openclaw
    node_compile_cache_guard: C:\Users\10481\AppData\Local\Temp\node-compile-cache\openclaw
    inherited_openclaw_temp_guard: C:\Users\10481\AppData\Local\Temp\openclaw
    vitest_b_cache_guard: E:\codx\skill\饮食管家\version-b-lite-plugin\node_modules\.vite\vitest
    vitest_c_cache_guard: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.vite\vitest
production_command_timeout_ms: 120000
production_environment_mapping:
  DIET_MANAGER_NODE: runtime.node_path
  DIET_MANAGER_TOOL_MODULES: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules
  DIET_MANAGER_OPENCLAW_ENTRY: runtime.openclaw_path
protected_external_paths:
  jiti_openclaw_cache_guard: C:\Users\10481\AppData\Local\Temp\jiti\openclaw
  node_compile_cache_guard: C:\Users\10481\AppData\Local\Temp\node-compile-cache\openclaw
  inherited_openclaw_temp_guard: C:\Users\10481\AppData\Local\Temp\openclaw
  vitest_b_cache_guard: E:\codx\skill\饮食管家\version-b-lite-plugin\node_modules\.vite\vitest
  vitest_c_cache_guard: E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.vite\vitest
```

`dependency_source_roots`是启动前只读工具**来源**，不属于四个执行根，生产验证器不得清理。`tool_modules_root`只允许core no-follow读取三个冻结top junction的元数据以解析source physical targets；它和B/C live node_modules都不是child module/permission root，八Node不得读取。core必须先按§4.6/§4.7把完整Node source root与完整C `.pnpm`复制为本轮`validation_root\runtime-snapshot`私有快照，并把942个junction的target全部重写到该快照内部；真实八Node只执行snapshot Node和snapshot内三个physical tool entry，绝不按live source路径执行或解析模块。staging内另有从source physical typebox复制的普通副本，只供路线插件代码解析。`protected_external_paths`也不是执行根：不得创建/删除，只做before/after完整manifest。冻结source身份：Node zip `CC5149EABD53779CE1E7BDC5401643622D0C7E6800ADE18928A767E940BB0E62`、Node executable `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`、Vitest入口 `39DB22F579ACF5639BBB17A261408DEBBDE03F4692C0C439E77E7F13AEBA74D6`、TypeScript入口 `8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0`、OpenClaw入口 `F643B005D6DB233A0B45204E8D8E943256874CCC6897B8A6E0CF42A9B376A188`。Task5前fresh校验，不一致失败关闭且不联网替换。

### 4.5 根关系矩阵与production/test边界

根关系在任何创建、manifest、命令、发布或cleanup之前一次性计算，并在每次正式使用前复核：

- `temporary_parent`及四个本轮writable roots与`ProjectRoot`、`EvidenceRoot`、三个official data roots、`Runtime.dependency_source_roots`四项（node/tool两个顶层来源及其固定pnpm/typebox后代）和五个guard中的每一项都必须双向不包含；四个writable roots彼此也必须双向不包含并具有同一个冻结parent、`task_id`和`run_id`，只允许类型段`isolated-test/validation/build/openclaw`不同。唯一登记的内部包含关系是`runtime_snapshot_root`精确位于本轮`validation_root`下；它不得位于或包含其他三类运行根、project/evidence/official/source/guard。
- `temporary_parent`不得等于或位于caller的`TEMP/TMP/TMPDIR`推导结果之下这一事实本身不作为信任依据；production只接受§4.4字面路径。caller恰好把这些变量设成别处、UNC、device path、项目内、data内或evidence内时，生产根仍不改变，调用者环境仍只读。
- `ProjectRoot`合法包含固定`EvidenceRoot`、A/B/C路线根、三个official data根以及项目内`tool_modules`只读依赖根；这是固定布局关系，不是路径逃逸。除EvidencePublisher对固定evidence目标的专用写协议外，ProjectRoot及其路线/official/dependency后代在本任务中全部只读。不得把“ProjectRoot包含EvidenceRoot”误判为四临时根矩阵失败，也不得据此允许任意项目内可写根。
- `EvidenceRoot`只允许包含本轮预登记的evidence临时文件和最终artifact目标；不得包含四临时根，四临时根也不得包含它。Node source dependency root、source `.pnpm`/tool target与guards只读且与四临时根双向不包含；private runtime snapshot是validation root内的本轮可清理产物，不得反向解释为source root可写。
- production入口从固定字面构造完整`Runtime`：除三个环境入口和`temporary_parent`外，`dependency_source_roots`与五项`protected_external_paths`必须逐键等于§4.4，`identity_expectations`必须等于§4.7；`DIET_MANAGER_NODE`、`DIET_MANAGER_TOOL_MODULES`、`DIET_MANAGER_OPENCLAW_ENTRY`分别与§4.4三个production映射字面值精确路径等值。仅“存在”“绝对”或hash相同但路径不同均不合格。入口不得暴露`TemporaryParent`、`Runtime`、`TestMode`或adapter公共参数，也不得用额外环境变量开启测试分支。
- 直接core测试必须传同一exact shape的fixture `Runtime`：test-owned sibling `temporary_parent`与fixture project/evidence/official/dependency/guards及`fixture.guard_parent`双向不包含，temporary parent与guard parent本身也是fixture顶层兄弟；三个系统型guard恰为`fixture.guard_parent`下的`jiti-openclaw/node-compile-openclaw/openclaw`三个互不包含兄弟，B/C Vitest guard分别位于fixture B/C route的`node_modules\.vite\vitest`。测试dependency roots、五guard和identity expectation全部指向fixture自有路径；core不得探测、manifest、创建、清理或报告§4.4 production guards。该能力只存在于内部调用对象，不改变production字面值规则，也不通过生产入口暴露模式开关。

根矩阵任一非法关系使用稳定`PATH_ROOT_RELATION_INVALID`并在创建任何本轮目录或启动任何命令前失败；UNC/device输入仍使用§4.2的`PATH_OUTSIDE_ALLOWED_ROOT`。

### 4.6 Windows no-follow PathIdentity、handle pin与所有可写操作

Windows existing path身份固定为`PathIdentity={volume_serial,file_id}`。每个可能由外部状态改变的existing祖先、parent、root、source或cleanup entry必须用`CreateFileW` no-follow打开：目录带`FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT`，普通文件及reparse leaf都带`FILE_FLAG_OPEN_REPARSE_POINT`。share分成两个不可混用的等级：

1. **immutable input pin**精确只含`FILE_SHARE_READ`，不得含`FILE_SHARE_WRITE|FILE_SHARE_DELETE`。source runtime普通文件/reparse leaf在复制期间、A脚本和system exe、runtime snapshot中全部child-consumed ordinary files/reparse leaves、policy bootstrap、staging只读输入以及build完成后供plugin读取的dist文件都使用此等级；snapshot输入pins从紧邻command启动前一直保持到parent与Job descendants全部退出。这样现有文件不能在运行中被写入、truncate、rename、delete或替换后还原。
2. **writable operation parent pin**精确为`FILE_SHARE_READ|FILE_SHARE_WRITE`且不得含`FILE_SHARE_DELETE`，只用于已经登记的可写parent、build输出parent、evidence parent与cleanup目录；真正destination/temp/cleanup entry仍由本节专用CreateNew/DELETE handle控制。目录handle的share mode不阻止在目录下新增子项，因此不得把parent pin描述成目录内容沙箱：每条命令前后都必须fresh重算snapshot/staging完整tree与闭包，新增/删除/optional peer出现均失败；能在两次观察间瞬时增删的同账户恶意进程不在本任务威胁边界内。

`volume_serial/file_id/attributes`必须来自同一已打开handle；从卷根到operation目标的全部existing链都要保存`{path,path_identity,attributes,share_write,share_delete}`并持续持有这些pin handle直到该operation完成。普通用户态进程因此不能rename/delete/换祖先链，immutable普通文件也不能in-place overwrite后还原；任一pin/open失败、identity变化、reparse/dangling reparse、handle-bound操作失败或释放前复核失败都稳定为`PATH_IDENTITY_CHANGED`或`PATH_OPERATION_FAILED`，不得回退到path-only操作。所有路径集合、handle链、entry和artifact排序统一使用`StringComparer.OrdinalIgnoreCase`。

可写协议固定如下：

1. safe-create只在已经pin住且身份匹配的parent下逐段创建四根、build/staging、runtime-snapshot、八个Node command各自的`environment_profile_root`及其`home/appdata/roaming/appdata/local/temp/foundation-policy-attestations`后代和evidence父目录；test profile位于对应`V_r`，build profile位于对应`B_r`，plugin profile位于`O`。每次只创建一段，立即no-follow打开并加入pin链；禁止裸递归跨段、释放parent handle后按字符串继续，或为了build journal额外创建validation可写目录。
2. build/staging及runtime snapshot复制由自写handle-pinned copier逐个普通文件执行：source ordinary file/reparse leaf及其祖先先no-follow打开；source leaf使用immutable-input share且保持到该leaf复制/重建、hash复核完成，destination parent链保持writable-parent pin，destination以`CreateNew` file handle创建；字节只从已打开source handle流向destination handle，flush后从同一handle复核长度/hash。禁止`Copy-Item`、路径重开source、目录整体复制或跟随任一junction。
3. evidence每个artifact的唯一临时文件以`CreateNew`且`GENERIC_READ|GENERIC_WRITE|DELETE`的no-follow handle创建，share精确只含`FILE_SHARE_READ`、不得含WRITE/DELETE；可信publisher从同一handle写入、flush并复核冻结bytes/hash，此后同一handle只用于FileRenameInfo或失败清理，外部不能write/delete/replace。evidence parent完整链保持writable-parent pin，final已no-follow确认不存在。发布只能对该temp handle调用一次`SetFileInformationByHandle(FileRenameInfo)`，指定已pin evidence parent、`ReplaceIfExists=false`和预登记final leaf；禁止`MoveFileEx`或pathname rename。rename失败不得覆盖/重试，必须继续使用该DELETE-capable temp handle或重新以share READ-only打开的精确temp DELETE handle清理并留证。
4. production cleanup使用handle-bound no-follow walker：枚举到每个entry后立即以`FILE_FLAG_OPEN_REPARSE_POINT`和DELETE权限打开、保存identity并保持handle；reparse/junction/symlink/dangling项只作为leaf，绝不打开target；普通目录后序遍历，子项完成后从仍持有的directory handle调用`SetFileInformationByHandle(FileDispositionInfo)`删除。普通文件与reparse leaf同样只从其DELETE handle disposition；禁止path-based递归删除。任何identity/pin/disposition变化立即停止该根并报告，物理external target文件集合、长度和hash零变化。
5. cleanup adapter返回后，core必须重新使用同一handle-pinned no-follow物理walker独立产生`physical_residual_entries[]/physical_residual_count`；不得只信adapter的`residual_count`、`Test-Path`或字符串枚举。根不存在且trusted parent pin identity未变时count为0；残留普通项或reparse leaf逐项进入entries并令验证失败。adapter原始error_type/error_text即使物理count为0也永久保留。

以上协议明确覆盖existing ancestor/ordinary-file/reparse-leaf的普通用户态check/use竞态和in-place overwrite/restore；目录中瞬时新增再删除、内核/驱动级篡改与同账户主动攻击者不在本任务边界。所有可比较内容集合仍在start、每命令前/后及finally按tree/manifest失败关闭。本任务不修改official、project、dependency、guard、evidence或系统既有ACL，也不以改ACL充当任意代码沙箱。

### 4.7 冻结source runtime、私有snapshot与canonical-tree-v1/v2

production三个环境值必须精确指向§4.4字面**source配置路径**；它们只用于拒绝caller替换并建立source identity，不是child执行路径。顶层`node_modules\vitest`、`node_modules\typescript`、`node_modules\openclaw`当前均为junction；core只no-follow读取其元数据，要求唯一source target精确等于下表，检查配置路径、junction、target、source entry及全部existing祖先直至卷根。三target本身必须是ordinary目录、内部`reparse_count=0`，source entry为ordinary且入口SHA分别等于§4.4冻结值：

| Tool | version | 唯一source physical target | source physical entry | target files | bytes | target tree SHA-256 |
| --- | --- | --- | --- | ---: | ---: | --- |
| Vitest | `2.1.9` | `E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\vitest@2.1.9_@types+node@26.2.0\node_modules\vitest` | `<target>\vitest.mjs` | 117 | 1661189 | `984D2C82CDCCBFEC623D3CD9F8B9F9F8272BCF49F95467D416B9F90E87F19B2D` |
| TypeScript | `5.9.3` | `E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\typescript@5.9.3\node_modules\typescript` | `<target>\bin\tsc` | 138 | 23633942 | `EC174E8071027E8828402C337BA0FA22AF7491B799DC3E935AB6811300CCBD4F` |
| OpenClaw | `2026.7.1` | `E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm\openclaw@2026.7.1\node_modules\openclaw` | `<target>\openclaw.mjs` | 8589 | 87743888 | `1EE99B0F9B9E3AFA49CB555B0E0406D8617D0231E75006788B10AE66C6D5E10C` |

Node source实际版本固定`24.15.0`，其完整source root身份为`file_count=1807,reparse_count=0,total_bytes=103552528,canonical_tree_v1_sha256=AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61`。source工具store固定为`E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\.pnpm`，身份为`file_count=34624,reparse_count=942,total_bytes=628929762,canonical_tree_v1_sha256=7E85740744869D460D7B4B8F1E9B3C8811698B11DCBF1F8A89726644A1E94055`；942项全为`JUNCTION`，raw target按§4.2 resolver转换后都存在且位于同一source `.pnpm`内。任一外指、UNC/device、未知NT前缀、缺失或链式reparse不合格。

source校验通过后、任何Node command spec形成前，core必须建立唯一`<validation_root>\runtime-snapshot`：

1. `<snapshot>\node`逐个复制完整Node source root的1807个ordinary files；`<snapshot>\pnpm`逐个复制完整source `.pnpm`的34624个ordinary files。每个source leaf在读取、hash、复制期间使用§4.6 immutable-input handle，禁止路径重开或目录整体复制。
2. source `.pnpm`的942个junction只从no-follow handle读取raw target；先按source v1验证target在root内，再把target转换成相对于source `.pnpm`的规范反斜杠路径。core在snapshot对应ordinary空目录handle上用`FSCTL_SET_REPARSE_POINT`创建`JUNCTION`，其NT target只允许指向`<snapshot>\pnpm\<same-relative-target>`；禁止shell/`mklink`、source绝对target、外指、symlink或链式reparse。
3. snapshot Node与snapshot `.pnpm`分别按下述canonical-tree-v2复核；文件/bytes/reparse计数必须与source相同。snapshot Node v2 SHA仍为`AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61`；snapshot `.pnpm` v2 SHA固定为`14E884759CD8BF088CE024809D53ACCA4DA256BE6E9E142B541798DEA05BB8BE`，共35566行，其中942个junction target均存在且位于snapshot `.pnpm`。
4. 八Node的实际executable唯一为`<snapshot>\node\node-v24.15.0-win-x64\node.exe`；实际tool entries唯一为`<snapshot>\pnpm\vitest@2.1.9_@types+node@26.2.0\node_modules\vitest\vitest.mjs`、`<snapshot>\pnpm\typescript@5.9.3\node_modules\typescript\bin\tsc`与`<snapshot>\pnpm\openclaw@2026.7.1\node_modules\openclaw\openclaw.mjs`。source entry只保存在报告的source identity，绝不进入`commands[].executable/arguments/module_resolution_roots`。
5. 紧邻每条Node命令启动前，core重新枚举snapshot Node、snapshot `.pnpm`、policy bootstrap与该命令staging只读输入，先持有所有existing ordinary/reparse leaf的immutable-input handles，再从这些handles复核tree/bytes/hash/闭包；handles保持到parent与Job descendants全部退出。命令返回后、释放handles前再fresh复核；persistent新增/删除、任何existing input写入/换identity、junction target变化或optional peer出现都失败。目录share不阻止瞬时新增，§4.6明确的同账户瞬时增删不在安全承诺内。
6. snapshot只随本轮validation root在outer finally清理。source roots、live `.pnpm`和top junction始终只读且从不进入cleanup；finally仍fresh复核source v1与snapshot v2，二者任一变化均使overall failed。

`canonical-tree-v1` source记录与`canonical-tree-v2` snapshot记录分别为：

```text
v1 F|<relative_path_with_backslash>|<decimal_length>|<UPPER_SHA256>
v1 R|<relative_path_with_backslash>|<reparse_kind>|<normalized_absolute_target>
v2 F|<relative_path_with_backslash>|<decimal_length>|<UPPER_SHA256>
v2 R|<relative_path_with_backslash>|<reparse_kind>|@ROOT\<normalized_relative_target_with_backslash>
```

两版本都不得跟随reparse；`reparse_kind`只允许大写`JUNCTION`或`SYMLINK`，本轮snapshot `.pnpm`又精确要求942项全为`JUNCTION`。`file_count`是F行数，`reparse_count`是R行数，`total_bytes`只累加F长度。所有完整行以`StringComparer.OrdinalIgnoreCase`排序，用UTF-8无BOM、单LF、末尾无LF计算大写SHA-256；普通目录无行。字段含`|/CR/LF`、大小写碰撞、未知tag、多个/dangling target或读取失败均为`RUNTIME_IDENTITY_INVALID`。v2 `@ROOT`永不包含source盘符/绝对路径；§6 typebox仍用其既有无`F|`前缀摘要`BC1E4E...`，禁止与v2的`17AB90...`近义算法混算。

静态package-local闭包也属于snapshot identity，冻结结果如下；`required_gap_count`或`c_top_edge_count`非0、package-local edge改变、missing optional peer出现或实际解析到snapshot外均为`RUNTIME_MODULE_CLOSURE_INVALID`：

| execution entry | reachable packages | manifest edges | required gaps | C_TOP edges | frozen missing optional peers |
| --- | ---: | ---: | ---: | ---: | --- |
| Vitest | 93 | 127 | 0 | 0 | 13 |
| TypeScript | 1 | 0 | 0 | 0 | 0 |
| OpenClaw | 306 | 461 | 0 | 0 | 10 |
| staging `typebox@1.3.11` | 1 | 0 | 0 | 0 | 0 |

Vitest的13个missing optional peers冻结为`vitest→@edge-runtime/vm,happy-dom,jsdom,@vitest/browser,@vitest/ui`、`vite→less,lightningcss,sass,sass-embedded,stylus,sugarss,terser`、`@vitest/mocker→msw`。OpenClaw的10个冻结为`@mistralai/mistralai→@opentelemetry/api`、`@modelcontextprotocol/sdk→@cfworker/json-schema`、`linkedom→canvas`、`openai→@aws-sdk/credential-provider-node,@smithy/hash-node,@smithy/signature-v4`、`tree-sitter-bash→tree-sitter`、`ws→bufferutil,utf-8-validate`、`node-fetch→encoding`。这些只表示manifest显式optional peer未安装；不得通过C top、global search、网络安装或live root补齐，Task5若实际加载、出现或导致fallback立即失败。

本轮命令静态可达的native/process artifact另冻结如下；普通bytes已包含在对应snapshot canonical tree且命令期间使用immutable-input pin：

| artifact | 可达命令 | kind/capability | snapshot relative path | length | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| snapshot Node | `B.test,C.test` | Vitest fork/Rollup helper executable | `node\node-v24.15.0-win-x64\node.exe` | 91694408 | `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5` |
| Rollup MSVC | `B.test,C.test` | Node native addon；需要`--allow-addons` | `pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node` | 2623488 | `397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49` |
| esbuild | `B.test,C.test` | child executable；需要`--allow-child-process` | `pnpm\@esbuild+win32-x64@0.21.5\node_modules\@esbuild\win32-x64\esbuild.exe` | 9913856 | `B868C8D988FFE76006C03C91F856312C312E42E2F3932A6BB56D7F4A1790C8B3` |

`B/C.build`的TypeScript静态native/process闭包为0；四个OpenClaw `plugins build/validate`命令链的package `.node/.dll/.exe`闭包也为0，不到达sqlite-vec/node-pty/pi-tui/tree-sitter native，故都不得取得addons/child能力。OpenClaw launcher在缺少stack flag时可能以snapshot `process.execPath` respawn，所以四plugin parent必须预先带`--stack-size=8192`而非授child。snapshot中条件存在的`pnpm\sqlite-vec-windows-x64@0.1.9\node_modules\sqlite-vec-windows-x64\vec0.dll`（289280 bytes，SHA `FCF98662A7AD9DCE394B96A88F91032047823831B951C76636787C312A6476E6`）仅供未进入本轮的memory/vector功能，Node Permission下extension load仍被拒，不在allowlist。Task5若需要额外artifact必须失败重审。

`A.structure`单独冻结系统入口：配置及实际exe均为`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`，`length=454656`、SHA-256=`7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5`、file/product version均为`10.0.26100.8875`。core须对exe、绝对A脚本及全部existing祖先使用§4.6 immutable pins并保持到A Job结束，从file handles复核身份；不得为A构造`.pnpm`近义字段。

runtime checks的phase只允许`source_start|snapshot_ready|before_command|after_command|finally_before_cleanup|source_final_after_cleanup`。source_start不符时九命令全skipped；snapshot_ready不符时八Node不启动；before/after command不符时当前及后续Node失败关闭。`finally_before_cleanup`必须在validation root仍存在、全部child退出且snapshot immutable handles尚未释放时重算source-v1、snapshot-v2与闭包；冻结结果后才释放handles并cleanup。`source_final_after_cleanup`只复核source-v1且snapshot字段必须为null，禁止检查已删除snapshot。任一不符都failed；每次保存fresh actual layout/tree/闭包和pinned count，禁止复制start结果。

本验证器只执行上述完整冻结、复制后再次验明且package-local闭包为0 required gap的可信toolchain与受保护路线源码；不支持caller runtime、任意恶意Node代码或同账户主动篡改者。private snapshot、immutable existing-input pins、`--no-global-search-paths`、Node Permission、trusted policy bootstrap、Job、clean-room与全套manifest共同失败关闭，但都不构成OS级任意代码沙箱，也不修改系统/official ACL或防火墙。

启动前冻结的验证命令如下；测试阶段只运行前两条，真实运行必须在生产实现完成后才运行第三条：

```text
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-data-manifests.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-foundations-state-isolation.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\validate-foundations.ps1
```

`actual_evidence_ids` 在独立安全复核前保持空集合；测试临时输出不能作为正式 EV。

## 5. Manifest、sidecar 与不可变比较

扫描大小写不敏感，至少匹配：

```text
*.jsonl
*.jsonl.tmp
*.jsonl.journal
*.sqlite
*.sqlite3
*.db
*.sqlite-wal
*.sqlite-shm
*.sqlite-journal
*.sqlite3-wal
*.sqlite3-shm
*.sqlite3-journal
*.db-wal
*.db-shm
*.db-journal
```

这15种大小写不敏感后缀是业务候选全集，但扫描结果必须按职责分层，禁止继续用一个包含`project_root`的“official manifest”同时承担正式data与项目范围审计：

| 机器JSON路径 | 固定扫描根与过滤 | 职责和失败条件 |
| --- | --- | --- |
| `manifests.official.before/after/diff` | 只允许A/B/C三个固定`<route>\data`根；只匹配上述15种后缀 | 使用§5.1 `official-state-observation/v1`证明正式data状态。不得加入`project_root`、路线根、`dist`、临时根或OpenClaw根；任一可比较official diff非空、观察不完整或覆盖不完整均失败 |
| `manifests.project_business_candidates.before/after/diff` | 恰扫描固定`project_root`和A/B/C三个路线根；只匹配上述15种后缀；排除普通`node_modules`的全部后代但必须包含任意`dist` | 发现项目/路线范围内、可能位于正式data之外的业务或sidecar候选。路径重叠须去重并保留全部`root_labels[]`；任一diff非空或扫描不完整均失败 |
| `manifests.source_dist.B/C.before/after/diff` | 分别对B/C源码树固定`dist`根扫描全部普通文件，不做业务后缀过滤 | 证明源码外构建没有改动源码`dist`。其中命中15种后缀的文件仍标为业务候选，但该完整性scope不能替代`project_business_candidates` |
| `temporary_roots[].pre_delete_audit`与`openclaw_state.pre_delete_audit` | isolated、validation、build三根各自独立扫描；OpenClaw只执行一次专用`all_files=true`权威扫描，临时根行保存该专用审计的fresh摘要引用 | 保持§7既有删除前审计、分类、清理和residual语义；不得并入project或official scope，也不得因前两层存在而省略或把OpenClaw白名单内部状态按普通临时业务候选重复计数 |

`manifests.official`的`roots`恰为`official_A/official_B/official_C`对应的三个data根；official entry绝不能出现data根以外的路径。尤其`version-c-strict-plugin\dist\must-scan.SQLITE-WAL`在official before和after中的匹配数必须为0，不能为了满足“包含dist”而扩大official根。

`manifests.project_business_candidates`的四个固定root label恰为`project_root/route_A/route_B/route_C`。扫描器必须对每个根做安全、非跟随reparse的遍历；重叠命中的同一规范绝对路径以`OrdinalIgnoreCase`键只保留一个entry，并把所有命中label按`StringComparer.OrdinalIgnoreCase`去重排序。该scope的`relative_path`统一相对于`project_root`，使用Windows反斜杠；不得因从路线根再次命中而产生第二个entry。普通`node_modules`整棵排除，已有Vitest cache仍由§4.4专门guard负责；`dist`不在排除集合，任何层级名为`dist`的目录只要不位于已排除的`node_modules`内都必须扫描。

project before/after对象分别使用稳定`scope_id=project_business_candidates_before/project_business_candidates_after`，各自包含`completed,roots[],entries[]`；其中`roots[]`保存固定label、规范path、exists、scan_status和error_code。只有四根均安全得到`scanned`或`missing`且entries完成时`completed=true`。provider、I/O、reparse或规范化错误不得用空entries冒充完成；错误进入`errors[]`并令overall failed。after仍须在finally尽力生成。diff只在有效before基线上比较，缺失基线或after未观察时不得伪造added/deleted，并按§5.1.3同类的missing/unobserved/post-only原则失败关闭。

项目候选entry统一写`classification=business_candidate`并额外写`candidate_kind`：主文件`.jsonl/.sqlite/.sqlite3/.db`为`business`；`.jsonl.tmp/.jsonl.journal`及SQLite/SQLite3/DB的`-wal/-shm/-journal`为`sidecar`。匹配必须按最长完整后缀、大小写不敏感进行，不能把`.sqlite-wal`误分为`.sqlite`主文件。source-dist全文件entry中，命中上述后缀者保留相同`classification/candidate_kind`，其他普通文件写`classification=source_file,candidate_kind=null`。

同一项目候选在`project_business_candidates`与`source_dist.C`各出现一次是两个独立Oracle，不是重复错误：前者证明业务候选覆盖，后者证明整个C源码dist完整性。`source_dist.C`中包含某候选绝不允许验证器跳过project scope，也不能把source-dist diff为空解释为项目范围无业务变化。

对official和project两个scope分别计算before/after added/modified/deleted。任何一个scope的任一diff数组非空都进入`errors[]`并令verdict failed；project scope使用稳定错误码`PROJECT_BUSINESS_CANDIDATE_ADDED/MODIFIED/DELETED`，不得塞入`fault.official_business_data_diff`冒充official变化。最终只能在official before/after覆盖完整且official diff为空、project before/after完成且project diff为空、四类临时根无业务候选、OpenClaw无非白名单业务候选时，声明“本轮JSONL或SQLite业务数据新增/修改/删除均为0”。已有候选数量可以非零；零业务影响判断依据是完整覆盖和diff，而不是把before已有文件隐藏或删除。

`openclaw_state_root`必须先以`all_files=true`扫描全部文件，再只允许以下OpenClaw 2026.7.1内部工具状态白名单：相对路径`state\openclaw.sqlite`及同一基名的`-wal`、`-shm`、`-journal`；它们分类为`openclaw_internal_tool_state`，逐项保存path/size/hash/mtime、创建阶段和清理结果，不计入饮食业务数据。任何其他JSONL/SQLite命中（包括`cache.sqlite-wal`、`diet.sqlite`或任意`.jsonl`）仍是`business_candidate`并使验证失败；日志、配置和普通缓存分类为`other`但不得从审计中消失。版本、路径或文件名变化时失败关闭，不能扩展通配白名单。provider抛错、scope/root身份错误或任一文件无法完成留证时必须写`completed=false`，不得用空集合或部分集合冒充完成。

`openclaw_state.pre_delete_audit`唯一结构为`completed,entries[],business_entries[],internal_state_entries[],other_entries[],business_candidate_count,openclaw_internal_tool_state_count,other_count,error_type,error_text`。`entries[]`恰为删除前全部普通文件的去重全集，后三个数组是按`classification=business_candidate|openclaw_internal_tool_state|other`得到的互斥且完备分组；三个count分别等于对应数组长度。每个`internal_state_entries[]`项目在根cleanup结束后追加`cleanup_result={attempted,succeeded,residual_count,error_type,error_text}`：`attempted`与根cleanup一致；该精确文件清理后不存在时`succeeded=true,residual_count=0`，仍存在时`succeeded=false,residual_count=1`；根cleanup异常的类型/文本逐项保留。普通和意外业务文件仍通过全量`entries[]`及根cleanup/residual留证，不得为了显示清理成功而从before审计中删除。

OpenClaw全量entry的创建阶段字段唯一名为`creation_stage`。到达第一条plugin命令前，core必须对本轮OpenClaw根执行一次真实`all_files=true` no-follow baseline，保存`openclaw_state.baseline={completed,entries[],error_code,error_type,error_text}`；baseline中已有的每个规范路径永久写`creation_stage=preexisting`，即使其mtime随后接近plugin时间也不得归因给plugin。baseline观察成功但`entries[]`非空时追加稳定`OPENCLAW_PREEXISTING_STATE`并令overall failed；无论entry最终分类是内部状态、other还是业务候选都不能把非空新运行根当作正常。baseline的I/O、provider、reparse、dangling reparse或manifest验证失败统一为`OPENCLAW_STAGE_OBSERVATION_FAILED`，第一plugin及之后命令均不启动。

`openclaw_state.stage_observations[]`恰有四个稳定槽，command ID顺序为`B.plugin_build_check|B.plugin_validate|C.plugin_build_check|C.plugin_validate`，每项shape为`{command_id,status,completed,entries[],error_code,error_type,error_text}`。每条实际执行的plugin命令返回后、下一命令前立即做fresh `all_files=true`观察并写`status=observed`；因先前失败未执行的槽写`status=skipped,completed=false,error_code=null`且不调用provider。任一实际观察发生I/O、provider、reparse、结果校验或分类异常时写`status=failed,completed=false,error_code=OPENCLAW_STAGE_OBSERVATION_FAILED`，追加同码全局错误并阻止后续命令。观察成功时，baseline不存在且首次出现的路径冻结为该command ID；后续观察不得改写。最终pre-delete audit中既非preexisting、也未被任一成功stage观察的新路径写`post_command_unattributed`并追加`OPENCLAW_CREATION_STAGE_UNKNOWN`、overall failed；不得根据mtime倒推或把全部文件归给最后一条命令。

baseline、四stage与最终权威audit的每个entry都必须先经Manifest DTO边界，再由core按§5白名单重分类。core同时维护`openclaw_state.observed_business_candidates[]`，按规范path `OrdinalIgnoreCase`去重；每项唯一shape为`{path,classification,first_seen_stage,last_seen_stage,final_present,length,sha256}`，classification恒为`business_candidate`，stage值只允许`baseline|B.plugin_build_check|B.plugin_validate|C.plugin_build_check|C.plugin_validate|post_command_unattributed`，`length/sha256`取`last_seen_stage`那次fresh观察。最终audit后逐项填写`final_present`，不存在的历史项仍保留原length/hash。

任一baseline或成功stage观察曾出现非白名单业务候选时，在首次出现处追加一次稳定`OPENCLAW_TRANSIENT_BUSINESS_CANDIDATE`并令overall failed；即使后续删除也不得从累计数组或错误中移除。`business_impact.openclaw_transient_business_candidate_count`精确等于累计数组中曾在`baseline`或四个command stage出现的唯一path数；现有`openclaw_business_candidate_count`只等于最终权威audit当前存在的业务候选数，两者不得替代。仅在最终audit首次出现的候选仍按`post_command_unattributed/OPENCLAW_CREATION_STAGE_UNKNOWN`加入累计数组和final count，但不增加transient count。

机器报告必须同时给OpenClaw的三个count及三组分类entries；最终回执须披露是否创建后清理了OpenClaw内部SQLite。验证器不得删除official或project中的业务候选；OpenClaw内部状态和OpenClaw根内意外候选都在删除前留证，随后随整个本轮临时根清理，但意外候选即使清理成功仍保持failed。

finally阶段的OpenClaw权威pre-delete audit仍只执行一次，唯一provider scope为`openclaw_pre_delete_audit`，其完整结果只存于`openclaw_state.pre_delete_audit`。baseline和四个stage observation只冻结首次/末次观察与累计候选，不属于权威pre-delete audit、不能替代最终全文件audit或最终current count；所有分类在baseline、stage和final中均由core按§5重新计算，provider误分类必须以`MANIFEST_ENTRY_INVALID`失败。`temporary_roots[]`中`root_id=openclaw_state_root`的fresh独立行不得复用权威对象/数组引用，也不得在finally发起第二次provider扫描；它的`pre_delete_audit`唯一为摘要`{completed,audit_ref,business_candidate_count,openclaw_internal_tool_state_count,other_count}`，其中`audit_ref=/openclaw_state/pre_delete_audit`，所有count与权威对象逐值相同。`business_impact.temporary_business_candidate_count`等于isolated/validation/build三根业务候选之和再加OpenClaw最终非白名单`business_candidate_count`；历史已删除候选另由`openclaw_transient_business_candidate_count`表达，两个值都必须为0才能声明临时业务影响为0。

`protected_external_paths.jiti_openclaw_cache_guard`采用单独的全部文件manifest，不使用业务扩展名过滤，也不排除其任何后代；路径不存在时before/after均记录`exists=false, entries=[]`。该guard只读比较，任何新增、修改、删除都失败，cleanup列表不得包含它。

每个 manifest entry 至少包含：

```text
full_path
relative_path
root_labels[]
length
sha256
last_write_time_utc
classification
candidate_kind
```

路径 key 使用 `OrdinalIgnoreCase`。相同路径的长度、SHA-256 或 UTC mtime 任一变化即列入 `modified`；新增和删除分别进入 `added`/`deleted`。各层成功条件都是其三数组均空且扫描覆盖完整，不能跨层替代。测试fixture中预置的JSONL、SQLite/DB、WAL、SHM、journal和JSONL sidecar必须在成功及每个失败矩阵运行中保持path/size/hash/mtime不变。

### 5.1 ROOT-005 正式状态观察契约

`RED-ROOT-005`不能用“路径拒绝后返回空manifest”代替正式状态观察。正式before/after对象的协议固定为`official-state-observation/v1`，分别放在`manifests.official.before`与`manifests.official.after`；两者至少具有以下字段，字段含义不得以近义字段替代：

```text
schema_version = official-state-observation/v1
scope_id = official_before | official_after
completed = bool
coverage_complete = bool
state_digest = UPPER_SHA256 | null
roots = [{route,path,exists,scan_status,error_code}, ...]
entries = [...]
```

#### 5.1.1 三路线独立观察与禁止跟随

- `roots`必须恰含A、B、C三个固定路线，JSON中的稳定顺序也是A、B、C；`path`是由固定项目布局得到的规范绝对`data`路径。不得用项目根的一次递归扫描代替三路线独立观察，也不得因一条路线受阻而跳过另外两条安全路线。
- 每条路线先只检查固定根及其已存在祖先的路径元数据。发现任一junction/symlink/reparse point后，该路线立即写`scan_status=blocked`、`error_code=PATH_REPARSE_POINT_REJECTED`、`entries=[]`；除读取拒绝所需的该路径元数据外，禁止通过该正式路径枚举后代、打开文件、取hash、取mtime、复制、执行或清理，禁止让`ManifestProvider`对该根做递归扫描。
- ROOT-005的固定预期是A为`exists=true,scan_status=blocked,error_code=PATH_REPARSE_POINT_REJECTED`，A无任何entry；B、C仍各自安全扫描并写`scan_status=scanned,error_code=null`及真实entries。任何把A的junction目标内容带入正式entries、或因A受阻而令B/C成为空集合的实现均失败。
- `scan_status`只允许`scanned`、`missing`、`blocked`、`unobserved`。`scanned`要求根存在且完整扫描结束；`missing`要求已安全观察到根不存在；`blocked`只表示reparse安全拒绝；其他I/O、provider或结构错误使用`unobserved`并保存稳定非空`error_code`。`scanned`与`missing`的`error_code=null`；`blocked`与`unobserved`不得携带任何部分entries。`exists`对已安全判定的存在/不存在分别为`true/false`，无法安全判定时为`null`。
- `completed=true`表示本次observer已经形成协议正确的fresh对象：版本与scope正确，A/B/C三个终态root row齐全，entries通过规范化校验且`state_digest`成功生成。逐根错误可以被捕获为`blocked`或`unobserved`而仍使对象完成；若对象只能使用placeholder、复制before、缺少路线、无法规范化或无法生成digest，则`completed=false,state_digest=null`。
- `coverage_complete=true`当且仅当`completed=true`且A/B/C三条路线均为`scanned`或`missing`。任何`blocked`或`unobserved`都令其为`false`。因此ROOT-005的before与after都应是`completed=true,coverage_complete=false`；这能证明观察流程完整结束和B/C已扫描，但绝不能证明A junction目标内容不变。
- official before是九命令的硬门：只要observer整体`completed=false`、`coverage_complete=false`，或A/B/C任一路线为`blocked/unobserved`，core必须追加稳定`OFFICIAL_BASELINE_UNAVAILABLE`并让九个command对象全部保持`skipped`，不得因B/C可扫描、entries为空或稍后after恢复安全而启动任何命令。路径precheck通过后、official observer实际打开root前若被替换为reparse/不同PathIdentity，也属于同一baseline失败；after可以保留恢复后的`post-only`诊断，但不得把其entries列为added或反向补造before。

`entries`只来自`scan_status=scanned`的路线。每项沿用§5的`full_path/relative_path/root_labels[]/length/sha256/last_write_time_utc`，并明确写唯一`route`；`relative_path`相对于该路线固定`data`根，使用Windows反斜杠且无前导分隔符，`sha256`为64位大写十六进制，mtime为UTC round-trip格式。`route+relative_path`按`OrdinalIgnoreCase`必须唯一；重复、逃逸、字段缺失或大小写碰撞使该路线`unobserved`，丢弃该路线所有部分entries并失败关闭。

#### 5.1.2 `state_digest`规范字节序列

观察对象完成时，`state_digest`只由下列规范记录计算；`scope_id`不进入摘要，因此相同状态的before/after摘要可以相等：

```text
V|official-state-observation/v1
R|<route>|<normalized_absolute_root_path>|<exists_token>|<scan_status>|<error_code_or_empty>
F|<route>|<relative_path>|<decimal_length>|<UPPER_SHA256>|<last_write_time_utc>
```

规范序列必须满足：

1. `V`记录恰一条且永远在首行；随后是恰三条`R`记录，严格按A、B、C；最后是`F`记录，先按路线A、B、C分组，再在每组内按完整`relative_path`使用`StringComparer.OrdinalIgnoreCase`排序。
2. `exists_token`只允许小写`true`、`false`、`null`；`error_code=null`编码为空字段。路径保留规范化后的Windows反斜杠表示，十进制长度不带分组符号，时间使用InvariantCulture的UTC round-trip文本。
3. `R`记录无论路线是`scanned`、`missing`、`blocked`或`unobserved`都必须存在；只有`scanned`路线可以有`F`记录。禁止读取blocked目标来补出`F`记录。
4. 所有字段不得含`|`、CR或LF；遇到该类无效值必须令对象`completed=false`，不得自行转义出第二套算法。
5. 将全部记录用单个LF连接，末尾无LF，以显式UTF-8无BOM编码后计算SHA-256，输出恰为大写十六进制。禁止使用PowerShell默认编码、CRLF、区域排序、当前culture数字/时间格式或大小写敏感路径排序。

`pre_state_hash`直接取本轮`official_before.state_digest`，`post_state_hash`直接取本轮`official_after.state_digest`；对象未完成时对应值为`null`，不得对placeholder或空entries计算一个看似有效的空摘要。ROOT-005中两摘要可以相等，但相等只表示“A持续被安全阻断且已观察的B/C状态相同”，不能外推为A目标内容已读取或已证明不变。

#### 5.1.3 before基线、missing、unobserved与post-only

- 比较以before逐路线建立基线；before为`scanned`或`missing`才是该路线的可比较基线。`missing`是已观察到的空状态，不等于`unobserved`，允许参与正常比较。
- before `scanned`、after `missing`时，before entries按正常规则进入`deleted`；before `missing`、after `scanned`时，after entries按正常规则进入`added`；两边均`missing`时该路线diff为空。
- before为`blocked`或`unobserved`时，该路线没有基线。若after变为`scanned`或`missing`，它是`post-only`观察：保留after root/entries供诊断，但不得把after entries伪列为`added`，不得宣称该路线不变，并须以稳定错误表明`OFFICIAL_BASELINE_UNAVAILABLE`。
- before有可比较基线而after为`blocked`或`unobserved`时，不得把before entries伪列为`deleted`；该路线是after未观察，必须失败关闭并保留相应路径/manifest错误。before与after均为`blocked`或`unobserved`时同样不可比较。
- added/modified/deleted只来自两端均可比较的路线。三数组为空不单独构成“正式业务数据零变化”结论；只有before与after均`coverage_complete=true`且所有可比较diff为空，才可给出全三路线零变化结论。ROOT-005允许B/C局部diff为空，但全局coverage必须为false、verdict必须为failed。

#### 5.1.4 ROOT-005测试Oracle边界

测试可直接读取fixture中独立、已知且非reparse的物理`junctionTarget`路径来建立和复核外部目标快照，但一旦正式A `data`路径被替换为junction，测试Oracle、helper和断言都不得再通过该正式junction或其`data\...`后代读取、枚举、取hash或取mtime。不得把仍指向A正式路径的`fixture.seed_paths`传给snapshot helper；A目标before/after均须使用物理target路径，B/C则使用各自安全的正式路径或报告entries。

ROOT-005必须直接断言：A blocked且entries为0；B/C scanned且各自预置entry存在；before/after对象均fresh completed但coverage不完整；`errors[]`含`OFFICIAL_BASELINE_UNAVAILABLE`；两摘要按本节算法可复核；九个物理命令均未执行；物理junctionTarget快照不变；外部写入数为0。另一个同ID子变体须在路径precheck之后、official observer打开之前把A root换成junction，得到相同baseline错误和零命令。测试不得为了获得Oracle而做生产实现被明确禁止的跟随操作。

#### 5.1.5 `after_manifest_generated`精确语义

`fault.after_manifest_generated`不得再用`$null -ne report.manifests.official.after`或“存在placeholder对象”计算。它为`true`当且仅当当前run的`official_after`同时满足：`schema_version=official-state-observation/v1`、`scope_id=official_after`、`completed=true`、A/B/C三个root row恰好各一条、`state_digest`是按§5.1.2生成的64位大写SHA-256，且该对象不是before引用、复制品或`not_generated`占位。该谓词不要求`coverage_complete=true`，也不要求diff为空；所以ROOT-005的A blocked以及普通command/cleanup失败路径仍可为`true`。

若after observer未运行、整体抛错后只剩占位、对象不完整、scope错误、缺路线或digest为空/不可复核，则该字段为`false`。报告发布失败不倒置已经在内存中完成的after观察；反之，JSON成功发布也不能把不完整after变成`true`。

## 6. 九个物理命令阶段与源码外构建

验证器必须把物理命令拆成以下稳定 ID，不能继续把多个命令藏在一个 npm script 中：

| 顺序 | command id | route | stage |
| ---: | --- | --- | --- |
| 1 | `A.structure` | A | `structure` |
| 2 | `B.test` | B | `test` |
| 3 | `B.build` | B | `build` |
| 4 | `B.plugin_build_check` | B | `plugin_build_check` |
| 5 | `B.plugin_validate` | B | `plugin_validate` |
| 6 | `C.test` | C | `test` |
| 7 | `C.build` | C | `build` |
| 8 | `C.plugin_build_check` | C | `plugin_build_check` |
| 9 | `C.plugin_validate` | C | `plugin_validate` |

B/C 的结构断言已包含在各自 Vitest；A 当前没有 npm test/build/plugin，不能为了矩阵对称而伪造不存在的物理阶段。

生产命令要求：

- A固定使用§4.7的`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`运行现有绝对脚本`version-a-skill-only\tests\validate-foundation.ps1`，cwd固定为`<validation_root>\A`；arguments恰为`[-NoLogo,-NoProfile,-NonInteractive,-ExecutionPolicy,Bypass,-File,<absolute A script>]`，顺序、大小写语义和数量固定，不得省略或追加。`inherit_environment=false`，从空集合构造与Node共同的精确19键clean-room；HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/TMPDIR全部位于`<validation_root>\A`，PATH仍为冻结系统三段，`NODE_DISABLE_COMPILE_CACHE=1`只是无害同构键。A exe与脚本在整个process/Job生命周期使用immutable-input handles；A不得带`--permission`或任何Node runtime flag，报告单列system executable identity。
- B/C的test、build、plugin_build_check、plugin_validate共八条Node命令不得从live route源码树执行或解析模块。core先用§4.6 handle-pinned copier分别建立test-owned/run-owned staging：`<build_root>\B\staging`与`<build_root>\C\staging`，只复制对应路线的普通源码、测试、tsconfig、package/plugin manifest、skills及命令所需固定文件；八条cwd分别精确为对应staging。staging中的唯一`node_modules`子项必须是复制为普通目录/普通文件的`node_modules\typebox`，不得存在junction、其他包、lock生成物或嵌套`node_modules`；live B/C route `node_modules`、C顶层`node_modules`和项目其他路径不属于运行依赖闭包。
- B/C test使用§4.7 snapshot Node与snapshot Vitest entry，Node flags固定在tool entry前；Vitest tool参数固定以`run --no-cache --pool=forks --poolOptions.forks.singleFork --no-file-parallelism`开头并只指向staging内测试/config。staging完整树不得含任意basename以`.env`开头的文件，冻结Vitest/Vite config必须得到`userEnv={}`与`ctx.config.env={}`；任一`.env*`、userEnv或config.env注入在fork前失败。两个live route既有`node_modules\.vite\vitest`仅作为Runtime对应guard做before/after全文件零差异，不可读作测试依赖。
- B/C build使用snapshot Node与snapshot TypeScript entry，输入tsconfig来自staging，`--outDir <build_root>\<route>\staging\dist`覆盖源码配置；plugin阶段只读取该staging产物，绝不读取源码`dist`。build开始前锁住staging既有输入，允许只在预登记dist parent下新增输出；build成功后重新完整hash并把dist ordinary files以immutable-input handles锁住供plugin读取。
- 全部八个B/C Node command specs采用clean-room环境：production native runner从空的有序键值集合构造传给`CreateProcessW`的唯一Unicode environment block，拒绝继承、额外键、重复键或隐式追加；不得用宿主`ProcessStartInfo.EnvironmentVariables`作为权威输入。共同键恰为19个：`APPDATA,ComSpec,HOME,HOMEDRIVE,HOMEPATH,LOCALAPPDATA,NODE_DISABLE_COMPILE_CACHE,NUMBER_OF_PROCESSORS,OS,PATH,PATHEXT,PROCESSOR_ARCHITECTURE,SystemRoot,TEMP,TMP,TMPDIR,USERNAME,USERPROFILE,WINDIR`。每条命令先冻结唯一`environment_profile_root=<该命令可写根>\environment\<command_id>`：test的可写根为`V_r`，build为对应`B_r`，plugin为`O`；`HOME=USERPROFILE=<profile>\home`、`APPDATA=<profile>\appdata\roaming`、`LOCALAPPDATA=<profile>\appdata\local`、`TEMP=TMP=TMPDIR=<profile>\temp`，`HOMEDRIVE/HOMEPATH`从该HOME逐值计算。19个`parent_environment.exact_key_values[].source`只允许五个冻结标签：上述7个直接profile路径键为`command_profile_literal`，`HOMEDRIVE/HOMEPATH`为`command_profile_derived`，`NODE_DISABLE_COMPILE_CACHE/PATH`为`contract_literal`，`ComSpec/SystemRoot/WINDIR/OS/PATHEXT`为`validated_system_literal`，`NUMBER_OF_PROCESSORS/PROCESSOR_ARCHITECTURE/USERNAME`为`validated_host_scalar`；不得把caller environment记作来源。`NODE_DISABLE_COMPILE_CACHE=1`；`PATH`恰为`C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0`，不得加入Node目录、npm、npx或corepack；Node/Vitest/TypeScript/OpenClaw四个入口全部使用冻结绝对路径。ComSpec/SystemRoot/WINDIR/OS/PATHEXT使用校验后的系统固定值；处理器/数量/用户名只复制通过枚举或字符约束的非路径值。所有profile目录在对应可写根内预创建、纳入该根audit/cleanup；尤其B/C build的Q journal写入`B_r\environment\<command_id>\temp\foundation-policy-attestations`，不得把validation root加入build write permission。
- clean-room意味着所有未列键天然不存在，包括任意`NODE_*`、`OPENCLAW_*`、coverage、warning、NODE_PATH、compile-cache、diagnostics、raw-stream、代理/证书/测试模式和调用者注入。尤其`NODE_COMPILE_CACHE/NODE_COMPILE_CACHE_PORTABLE/ESBUILD_BINARY_PATH`必须不存在，只有`NODE_DISABLE_COMPILE_CACHE=1`存在；esbuild不得被env改指外部binary。`OPENSSL_CONF/VITEST/HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/JITI_NATIVE_MODULES`也不继承。报告只记录键名/来源/非敏感值或hash，caller环境不变。
- plugin的`--root`指向同一对应staging，`--entry`指向staging内`./dist/index.js`，启动OpenClaw CLI本身使用§4.7 snapshot OpenClaw entry；plugin阶段不得再建立另一份依赖闭包或读取live route。所有staging创建、复制和build写入使用§4.6 handle-pinned协议。
- staging离线依赖闭包只允许`node_modules/typebox`，B/C两份都只能从Runtime中C固定physical `dependency_source_roots.typebox_root`复制；core不得打开或枚举live B/C route `node_modules`来选择依赖。该target冻结`typebox@1.3.11`：package SHA-256 `1E10166E4B3DD7718186CD458EEED35FA674752E51E87663100CA9068DB89E63`，1367文件、1468384 bytes。树摘要每行`relative_path|decimal_length|UPPER_SHA256`、OrdinalIgnoreCase整行排序、UTF-8无BOM、LF且末尾无LF，SHA=`BC1E4E174A7B9DC9AB176ACA0039F96ED9F47F9A722BAF7B8A0D927897A0B7FE`。
- `typebox_root`本身必须是ordinary目录、内部reparse=0并完全位于source C固定`.pnpm`；source ordinary files以immutable-input handles锁住，核验package/tree后从已打开handles复制。B/C top `node_modules/typebox`映射不是dependency source、module root或permission root。§4.2 raw junction转换只用于冻结的top source tool junction；任一typebox pin/identity/版本/count/bytes/hash不符稳定`STAGING_DEPENDENCY_INVALID`或`PATH_IDENTITY_CHANGED`并阻止八Node命令。
- staging allowlist恰为：路线普通源码/测试/tsconfig、`package.json`、`openclaw.plugin.json`、`skills/`、本轮staging内构建的`dist/`和上述普通文件形式的`node_modules/typebox/`；任意basename以`.env`开头的文件、完整`node_modules`、源码`dist`、cache、lock变化或其他隐式依赖均不得复制。八条Node命令不得执行包管理器、安装依赖或主动联网；网络/sqlite边界按下述trusted policy bootstrap与Task5实际观察解释，不得归因给Node Permission Model。
- `plugin_build_check` 与 `plugin_validate` 分开调用并分别保存 exit code；不得调用会再次执行 `npm run build` 的现有复合 `npm run plugin:validate`。
- B/C四个plugin command spec在共同19键上只增加4键：`OPENCLAW_STATE_DIR=<本轮openclaw_state_root>`、`OPENCLAW_CONFIG_PATH=<本轮openclaw_state_root>\openclaw.json`、`OPENCLAW_HOME=<本轮openclaw_state_root>`、`JITI_FS_CACHE=false`，最终键集合恰为23个。所有其他OpenClaw/JITI诊断或外写变量因clean-room不存在；调用者进程不变。
- OpenClaw 2026.7.1默认JITI缓存、Node compile cache和Windows`os.tmpdir()/openclaw`分别可能写入三个§4.4 guard，所以core必须对三个固定guard路径做全部文件before/after manifest并要求零差异。它们不是额外临时根，验证器绝不能创建、清理或“修复”它们。插件child的`os.tmpdir()`必须精确解析为该命令的`<O>\environment\<command_id>\temp`；规范化后必须严格位于`openclaw_state_root`内，并纳入OpenClaw全文件审计及该根cleanup。到达第一条plugin命令前必须先按§5建立OpenClaw真实all-files baseline；每条实际执行的plugin命令返回后、下一条命令开始前必须完成stage observation，观察失败即`OPENCLAW_STAGE_OBSERVATION_FAILED`并阻止后续命令。
- 每次运行前后为 `version-b-lite-plugin/dist` 和 `version-c-strict-plugin/dist` 单独生成完整 manifest；added/modified/deleted 任一非空即失败。

八条Node命令必须把Node 24 Permission Model作为trusted-code seat belt放在snapshot entry前。顺序：`--permission`；read flags；write flags；仅B/C test依次`--allow-child-process`,`--allow-addons`；再`--no-global-search-paths`,`--import=<Q_u>`；四plugin随后还必须有`--stack-size=8192`；最后才是snapshot tool entry。`Q_u`是core从Q绝对路径唯一生成并报告的canonical absolute file URL；禁止`--require`、相对specifier或第二个preload。Node 24.15在tool entry前以ESM+TLA完成Q；全部禁worker/WASI，build/plugin禁addons/child。`NODE_PATH`与`ESBUILD_BINARY_PATH`都不在clean-room。符号：`S_r=<build_root>\r\staging`、`T_r=S_r\node_modules\typebox`、`V_r=<validation_root>\r`、`B_r=<build_root>\r`、`O=<openclaw_state_root>`、`R=<validation_root>\runtime-snapshot`、`P=R\pnpm`、`Q=R\policy\foundation-node-policy.mjs`、`Q_u=canonical file URL(Q)`。

| command | snapshot tool target | `module_resolution_roots[]`稳定顺序 | `fs_read_roots[]`稳定顺序 | `fs_write_roots[]`稳定顺序 | allow_child | allow_addons | allow_worker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B.test` | snapshot Vitest target | `[S_B,T_B,P]` | `[S_B,R,V_B]` | `[V_B]` | `true` | `true` | `false` |
| `B.build` | snapshot TypeScript target | `[S_B,T_B,P]` | `[S_B,R,V_B,B_B]` | `[B_B]` | `false` | `false` | `false` |
| `B.plugin_build_check` | snapshot OpenClaw target | `[S_B,T_B,P]` | `[S_B,R,O]` | `[O]` | `false` | `false` | `false` |
| `B.plugin_validate` | snapshot OpenClaw target | `[S_B,T_B,P]` | `[S_B,R,O]` | `[O]` | `false` | `false` | `false` |
| `C.test` | snapshot Vitest target | `[S_C,T_C,P]` | `[S_C,R,V_C]` | `[V_C]` | `true` | `true` | `false` |
| `C.build` | snapshot TypeScript target | `[S_C,T_C,P]` | `[S_C,R,V_C,B_C]` | `[B_C]` | `false` | `false` | `false` |
| `C.plugin_build_check` | snapshot OpenClaw target | `[S_C,T_C,P]` | `[S_C,R,O]` | `[O]` | `false` | `false` | `false` |
| `C.plugin_validate` | snapshot OpenClaw target | `[S_C,T_C,P]` | `[S_C,R,O]` | `[O]` | `false` | `false` | `false` |

`B.build/C.build`的`fs_write_roots[]`必须仍恰为各自`[B_B]/[B_C]`；对应environment profile、TEMP和Q attestation目录都是该根内后代，因此不得追加`V_B/V_C`或整个validation root来“修复”policy写入。test仍只写`V_r`，plugin仍只写`O`；这些profile/journal文件与其他临时文件一样进入既有validation/build/OpenClaw删除前audit、cleanup和physical residual，不新增外部guard或第五类临时根。

Vitest 2.1.9默认使用forks，故test topology显式冻结为`pool=forks,singleFork=true,fileParallelism=false`；不得改用threads，因为Permission Model不继承到worker。每条test唯一`derived_node_prefix[]`恰等于该direct parent的完整`permission_model.argument_vector[] + node_runtime.argument_vector[]`，从首个`--permission`到唯一`--import=<Q_u>`，不含tool entry/arguments；Q启动即冻结并在所有snapshot Node child调用前使用这一数组。Vitest 2.1.9会过滤parent execArgv并合并`config.env`，但Q采用唯一**受控替换**语义：caller `execArgv`只可为字符串数组且永不传给native，effective `execArgv`无条件重建为完整`derived_node_prefix[]`；不存在另一个“兼容时保留”分支。

唯一Vitest fork module固定为`P\tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js`，tool args为空，execPath为snapshot Node，cwd为对应staging，caller/effective stdio分别固定`pipe`与由Node fork派生的`['pipe','pipe','pipe','ipc']`。Q对incoming `options.env`按`OrdinalIgnoreCase`规范化：同值大小写别名只折叠一次，异值别名、缺项、额外项或非string值拒绝；唯一合法`incoming_request_env`恰为parent19、`TEST=true,VITEST=true,NODE_ENV=test,VITEST_MODE=RUN,TINYPOOL_WORKER_ID=1`及Vite四键`BASE_URL='/',MODE='test',DEV='1',PROD=''`。核验后Q完全丢弃incoming对象及四个Vite键，`q_supplied_env`只从冻结parent19重建并恰加五个Vitest/Tinypool bookkeeping键；`config.env`、`OPENCLAW_STATE_DIR`、`ESBUILD_BINARY_PATH`、`NODE_OPTIONS`及其他键均不得进入该层。`VITEST_WORKER_ID/VITEST_POOL_ID`由Vitest在child启动后设置，不属于fork request或Q supplied层。

只有两条test允许child process。Vitest test-worker恰一个，Rollup snapshot Node helper与esbuild后代数量按Q journal和Job实际记录；任何不能分类为唯一`vitest_single_fork`、精确`snapshot_node_helper`或精确`esbuild`的后代，以及非allowlist executable或Job外进程，都使Task5失败。build/plugin无child/worker。core在每条Node command前按上一段预创建空的`<command TEMP>\foundation-policy-attestations`；Q direct parent及全部snapshot Node descendants分别以`wx`写policy-ready attestation，并为每次child调用在native前写spawn-intent、native返回/抛出后写spawn-result。

fork环境证据固定分四层：`incoming_request_env`为28键规范化caller输入；`q_supplied_env`为parent19+five；`source_derived_createprocess_env`不是观察值，而是按冻结Node 24.15 fork源码从exact stdio推导的q-supplied再加`NODE_CHANNEL_FD='3'`与`NODE_CHANNEL_SERIALIZATION_MODE='json'`，且因effective argv已含`--permission`而无`NODE_OPTIONS`；`bootstrap_visible_env`由fork child中的Q实际attest，Node在运行preload前已消费并删除两IPC键，故必须逐键等于q-supplied。报告必须保存stdio→fd推导、每层key/value digest、`observed|source_derived`标志及child policy-ready关联；不得把第三层称为Q观察到的actual OS environment。Rollup helper的q-supplied/source-derived/bootstrap-visible三层相同且`NODE_OPTIONS=null`；esbuild没有Q bootstrap层，其q-supplied无NODE_OPTIONS而source-derived CreateProcess层仅增加Node 24.15从parent permission flags生成的canonical `NODE_OPTIONS`。

`module_resolution_roots[]`、permission roots、snapshot entry、Q和`Q_u`都保存展开绝对身份，不得含source/live。`permission_model.argument_vector[]`从`--permission`到test可选child+addons结束；test/build的`node_runtime.argument_vector[]`恰为`[--no-global-search-paths,--import=<Q_u>]`，plugin恰为`[--no-global-search-paths,--import=<Q_u>,--stack-size=8192]`；`derived_node_prefix[]`恰为前两数组连接，顶层arguments依次为该prefix、snapshot entry和tool参数。A三数组空。fixture只建fixture snapshot。

core从固定ASCII常量按§4.6 CreateNew写入Q并以immutable-input handle冻结；`policy_bootstrap={schema_version=foundation-trusted-policy/v2,path,module_url,line_count,length,sha256,ascii_only,derived_node_prefixes[],network_hook_set[],network_not_present[],network_self_tests_passed,sqlite_controls,child_invocation_policy,addon_policy,policy_ready[],spawn_intents[],spawn_results[],addon_loads[],installed_fail_closed}`进入报告。bytes/hash在RED中逐字节复核，publisher或child不得改写。Q是单一ESM preload；任何patch、TLA self-test或attestation失败都抛`TRUSTED_POLICY_BOOTSTRAP_FAILED`并阻止tool entry。Q通过`createRequire(import.meta.url)`取得CJS builtin，替换后调用`syncBuiltinESMExports()`，再`await import('node:sqlite')`验证ESM `DatabaseSync/backup`已指向同一guard；属性不可替换或两视图不同必须fail-close，不得降级。

- 对冻结的CJS/ESM builtin公开入口安装精确拒绝集合：现有`net/http/https/http2/tls/dgram/dns`与`dns/promises`top-level函数（含`resolveTlsa`）、global `fetch/WebSocket`及存在时的`EventSource`，并补`net.Socket.prototype.connect`、`net.Server.prototype.listen`、`http.Agent.prototype.createConnection`、`https.Agent.prototype.createConnection`、`tls.TLSSocket.prototype.connect`、`dgram.Socket.prototype.bind/connect/send`以及两种`Resolver.prototype.resolveTlsa`在内的冻结instance方法。Node 24.15未启`--experimental-eventsource`时Q把`globalThis.EventSource`记入`network_not_present[]`而不伪造hook。Q逐个已安装入口调用deny self-test；结论只覆盖报告中的exact hook names及可信runtime，不覆盖native/internal binding、不形成OS级零联网证明。
- 包装`node:sqlite`的`DatabaseSync`：只允许字面`:memory:`；plugin还允许规范化后严格位于其精确`OPENCLAW_STATE_DIR`内的绝对本地路径。在创建任何实例前先全局替换`NativeDatabaseSync.prototype`的控制/SQL入口，避免通过native prototype调用绕过；native constructor只保留在Q闭包，公开guard不继承它，公开prototype是独立冻结副本且`constructor`只指guard，native prototype的`constructor`也被改指guard，构造后实例改挂独立prototype。`Object.getPrototypeOf(sqlite.DatabaseSync)`必须恰为`Function.prototype`，两条公开/私有prototype的`constructor`均不得泄漏native constructor。constructor options由Q强制`allowExtension=false,defensive=true`，实例创建后要求`db.limits.attach=0`成功并用冻结的native `setAuthorizer`对`constants.SQLITE_ATTACH`返回`SQLITE_DENY`。caller调用`setAuthorizer`、`enableLoadExtension/loadExtension`、`enableDefensive(false)`、`createTagStore`及module-level `backup`均硬拒；每次`exec/prepare`先复核`limits.attach===0`，再用固定可信SQL guard拒绝`ATTACH`及`VACUUM ... INTO`。authorizer是ATTACH主边界；SQL文本guard只针对冻结可信toolchain，不声称恶意SQL解析或SQLite沙箱。
- child API只接受三个role。Vitest `fork`按上一段重建module/args/cwd/env/execPath/execArgv。snapshot Node `spawn/spawnSync`只接受Rollup 4.62.4精确caller tail `['-p',"const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));"]`和caller options `{encoding:'utf8',timeout:3000,windowsHide:true}`，Q再把完整`derived_node_prefix[]`插到`-p`前并强制冻结cwd/env/no-shell。esbuild只允许async `spawn` snapshot `esbuild.exe`，args恰为`['--service=0.21.5','--ping']`，cwd恰为staging，env恰为Q启动时冻结env，options恰含`windowsHide=true,stdio=['pipe','pipe','inherit']`；`spawnSync/execFileSync`即使是`--service=0.21.5`也以`TRUSTED_POLICY_NODE_SYNC_ESBUILD_FORBIDDEN`失败并要求重审。Q另包装`ChildProcess.prototype.spawn`：只有上述已验顶层`spawn/fork`在native调用周围建立的一次性、单次消费permit可进入原prototype，直接`new ChildProcess().spawn`稳定拒绝。`exec/execSync/execFile`及其他参数/API/环境一律拒绝，不提供泛化allowlist。
- Q在每个受控child native调用前以`wx`写`foundation-spawn-intent/v1`，保存parent PID、sequence、API/role、effective executable/hash、完整argv/cwd与environment digest；native返回或抛出后写配对`foundation-spawn-result/v1`，成功必须含真实PID，写result失败立即尝试终止child并使command失败。同步Rollup `spawnSync`结果必须含PID；禁止任何允许的`pid=null`。这些journal是受控JS child权威输入，Job completion仅作best-effort telemetry并另行严格对账。
- Q包装`process.dlopen`，只接受恰两个参数并只规范化普通drive path或`\\?\X:\...`；UNC、GLOBALROOT、`\??\`、第三个flags参数和其他path grammar全部拒绝。canonical path只用于identity/length/hash验证；验证成功后向captured native原样传入原始`fileName`，保留namespaced/长路径语义，journal同时保存canonical path与`ordinary_drive|namespaced_drive`。只有带`--allow-addons`的test进程可加载snapshot Rollup MSVC精确path/2623488 bytes/`397EF6...`，调用前后写addon intent/result；其他`.node`稳定拒绝。Task5汇总actual loaded PID/path/hash且集合必须恰为冻结Rollup artifact。该hook仍是trusted-code防御，不是恶意代码/native sandbox。
- 以不可配置marker记录policy version/derived prefix/hook set；direct parent、唯一Vitest fork与Rollup Node helper都必须经同一`--import=<Q_u>`在entry前完成policy-ready attestation。fork/helper的`source_derived_createprocess_env.NODE_OPTIONS`必须为null；仅esbuild intent的source-derived CreateProcess层保存Node 24.15源码生成的规范`NODE_OPTIONS`，而Node后代继承安全前缀的权威来源始终是Q重建的完整argv。

Q的权威bytes就是下列代码块中的ASCII文本，以单LF连接、末尾无LF、UTF-8无BOM编码；固定`line_count=1065,length=43267,sha256=C0C0E478D19C2D3473D165318EEAB689DF0C34E69D8784A8C6B3D0119319D25D`。代码块围栏不属于bytes，任何空白、CRLF、注释或近义实现变化都必须更新简报并重新安全复核，不能由core与测试共同接受一个未冻结变体：

```javascript
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

await (async function installFoundationTrustedPolicy() {
  const VERSION = 'foundation-trusted-policy/v2';
  const MARKER = Symbol.for('diet-manager.foundation-policy');

  function makeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  const prior = globalThis[MARKER];
  if (prior !== undefined) {
    if (!prior || prior.version !== VERSION) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'ESBUILD_BINARY_PATH')) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }

  function deny(code) {
    return function deniedByFoundationPolicy() {
      throw makeError(code);
    };
  }

  function replaceFunction(target, name, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor || typeof target[name] !== 'function' ||
        (descriptor.configurable !== true && descriptor.writable !== true)) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    Object.defineProperty(target, name, {
      value: replacement,
      enumerable: descriptor.enumerable === true,
      configurable: false,
      writable: false
    });
  }

  function replaceFunctions(target, names, code) {
    const replacement = deny(code);
    for (const name of names) {
      replaceFunction(target, name, replacement);
    }
  }

  function replacePublicMethod(target, name, replacement) {
    if (!target || typeof target[name] !== 'function' || !Object.isExtensible(target)) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor && descriptor.configurable !== true && descriptor.writable !== true) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    Object.defineProperty(target, name, {
      value: replacement,
      enumerable: descriptor ? descriptor.enumerable === true : false,
      configurable: false,
      writable: false
    });
  }

  const net = require('node:net');
  const http = require('node:http');
  const https = require('node:https');
  const http2 = require('node:http2');
  const tls = require('node:tls');
  const dgram = require('node:dgram');
  const dns = require('node:dns');
  const dnsPromises = require('node:dns/promises');
  const path = require('node:path');
  const sqlite = require('node:sqlite');
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const networkCode = 'TRUSTED_POLICY_NETWORK_DENIED';

  const networkHooks = [];
  const networkNotPresent = [];
  const networkSelfTests = [];
  function installNetworkFunction(target, name, label) {
    replaceFunction(target, name, deny(networkCode));
    networkHooks.push(label);
    networkSelfTests.push(function networkEntrySelfTest() {
      Reflect.apply(target[name], null, []);
    });
  }
  function installNetworkMethod(target, name, label) {
    replacePublicMethod(target, name, deny(networkCode));
    networkHooks.push(label);
    networkSelfTests.push(function networkMethodSelfTest() {
      Reflect.apply(target[name], null, []);
    });
  }

  for (const [target, names, prefix] of [
    [net, ['connect', 'createConnection', 'createServer'], 'node:net'],
    [http, ['request', 'get', 'createServer'], 'node:http'],
    [https, ['request', 'get', 'createServer'], 'node:https'],
    [http2, ['connect', 'createServer', 'createSecureServer', 'performServerHandshake'], 'node:http2'],
    [tls, ['connect', 'createServer'], 'node:tls'],
    [dgram, ['createSocket'], 'node:dgram']
  ]) {
    for (const name of names) {
      installNetworkFunction(target, name, prefix + '.' + name);
    }
  }
  const dnsModuleNames = [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    'setServers'
  ];
  for (const name of dnsModuleNames) {
    installNetworkFunction(dns, name, 'node:dns.' + name);
    installNetworkFunction(dnsPromises, name, 'node:dns/promises.' + name);
  }
  installNetworkMethod(net.Socket.prototype, 'connect', 'node:net.Socket.prototype.connect');
  installNetworkMethod(net.Server.prototype, 'listen', 'node:net.Server.prototype.listen');
  installNetworkMethod(http.Agent.prototype, 'createConnection', 'node:http.Agent.prototype.createConnection');
  installNetworkMethod(https.Agent.prototype, 'createConnection', 'node:https.Agent.prototype.createConnection');
  installNetworkMethod(tls.TLSSocket.prototype, 'connect', 'node:tls.TLSSocket.prototype.connect');
  for (const name of ['bind', 'connect', 'send']) {
    installNetworkMethod(dgram.Socket.prototype, name, 'node:dgram.Socket.prototype.' + name);
  }
  const resolverNames = [
    'cancel', 'getServers', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    'setLocalAddress', 'setServers'
  ];
  for (const name of resolverNames) {
    installNetworkMethod(dns.Resolver.prototype, name, 'node:dns.Resolver.prototype.' + name);
    installNetworkMethod(dnsPromises.Resolver.prototype, name, 'node:dns/promises.Resolver.prototype.' + name);
  }
  for (const name of ['fetch', 'WebSocket']) {
    installNetworkFunction(globalThis, name, 'globalThis.' + name);
  }
  if (typeof globalThis.EventSource === 'function') {
    installNetworkFunction(globalThis, 'EventSource', 'globalThis.EventSource');
  } else {
    networkNotPresent.push('globalThis.EventSource');
  }

  function localAbsolute(value, code) {
    if (typeof value !== 'string' || !path.win32.isAbsolute(value) ||
        value.startsWith('\\\\') || value.startsWith('\\??\\') ||
        value.indexOf('\u0000') >= 0) {
      throw makeError(code);
    }
    return path.win32.resolve(value);
  }

  function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
  }

  function sha256Text(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
  }

  function arraysEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every(function sameItem(value, index) { return value === right[index]; });
  }

  function sortedKeys(value) {
    return Object.keys(value).sort(function ordinalIgnoreCase(left, right) {
      const upperLeft = left.toUpperCase();
      const upperRight = right.toUpperCase();
      if (upperLeft < upperRight) return -1;
      if (upperLeft > upperRight) return 1;
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
  }

  function freezeEnvironment(source) {
    const target = {};
    for (const name of sortedKeys(source)) {
      if (typeof source[name] !== 'string') {
        throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
      }
      target[name] = source[name];
    }
    return Object.freeze(target);
  }

  function cloneEnvironment(source) {
    const target = {};
    for (const name of sortedKeys(source)) {
      target[name] = source[name];
    }
    return target;
  }

  function environmentDigest(source) {
    const lines = sortedKeys(source).map(function environmentLine(name) {
      return name + '\u0000' + source[name];
    });
    return sha256Text(lines.join('\n'));
  }

  const snapshotRoot = path.win32.dirname(path.win32.dirname(__filename));
  const controlledCwd = localAbsolute(process.cwd(), 'TRUSTED_POLICY_BOOTSTRAP_FAILED');
  const snapshotNode = path.win32.join(snapshotRoot, 'node', 'node-v24.15.0-win-x64', 'node.exe');
  const esbuildExecutable = path.win32.join(
    snapshotRoot, 'pnpm', '@esbuild+win32-x64@0.21.5', 'node_modules',
    '@esbuild', 'win32-x64', 'esbuild.exe'
  );
  const vitestForkModule = path.win32.join(
    snapshotRoot, 'pnpm', 'tinypool@1.1.1', 'node_modules',
    'tinypool', 'dist', 'entry', 'process.js'
  );
  const rollupScript = "const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));";
  const rollupTail = Object.freeze(['-p', rollupScript]);
  const esbuildArgs = Object.freeze(['--service=0.21.5', '--ping']);
  const nodeHash = '3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5';
  const esbuildHash = 'B868C8D988FFE76006C03C91F856312C312E42E2F3932A6BB56D7F4A1790C8B3';
  const observedProcessEnvironment = freezeEnvironment(process.env);

  function assertExactFile(value, expectedPath, expectedLength, expectedHash, code) {
    const resolved = localAbsolute(value, code);
    if (resolved.toUpperCase() !== expectedPath.toUpperCase()) {
      throw makeError(code);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size !== expectedLength || sha256File(resolved) !== expectedHash) {
      throw makeError(code);
    }
    return resolved;
  }

  assertExactFile(process.execPath, snapshotNode, 91694408, nodeHash, 'TRUSTED_POLICY_BOOTSTRAP_FAILED');

  const observedExecArgv = process.execArgv.slice();
  const hasRollupTail = observedExecArgv.length >= rollupTail.length &&
    arraysEqual(observedExecArgv.slice(-rollupTail.length), rollupTail);
  const derivedNodePrefix = Object.freeze((hasRollupTail ?
    observedExecArgv.slice(0, -rollupTail.length) : observedExecArgv).slice());
  const policyFlag = '--import=' + import.meta.url;
  const policyFlagCount = derivedNodePrefix.filter(function isPolicyFlag(value) {
    return value === policyFlag;
  }).length;
  const childEnabled = derivedNodePrefix.includes('--allow-child-process');
  const addonEnabled = derivedNodePrefix.includes('--allow-addons');
  const noGlobalIndex = derivedNodePrefix.indexOf('--no-global-search-paths');
  if (derivedNodePrefix[0] !== '--permission' || policyFlagCount !== 1 ||
      derivedNodePrefix[derivedNodePrefix.indexOf(policyFlag) - 1] !== '--no-global-search-paths' ||
      derivedNodePrefix.some(function forbiddenFlag(value) {
        return value === '--require' || value.startsWith('--require=') ||
          value === '-r' || value === '-e' || value === '--eval' ||
          value === '-p' || value === '--print' || value === '--allow-worker' ||
          value === '--allow-wasi';
      }) || childEnabled !== addonEnabled) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }

  const selfRole = hasRollupTail ? 'snapshot_node_helper' :
    (Object.prototype.hasOwnProperty.call(process.env, 'TINYPOOL_WORKER_ID') ?
      'vitest_single_fork' : 'direct_parent');
  if (hasRollupTail && (!childEnabled || selfRole !== 'snapshot_node_helper')) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  const expectedInjectedNodeOptions = derivedNodePrefix.slice(0, noGlobalIndex).join(' ');
  const observedNodeOptions = Object.prototype.hasOwnProperty.call(
    observedProcessEnvironment, 'NODE_OPTIONS'
  ) ? observedProcessEnvironment.NODE_OPTIONS : null;
  if (observedNodeOptions !== null) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  const requestedEnvironmentSource = cloneEnvironment(observedProcessEnvironment);
  delete requestedEnvironmentSource.NODE_OPTIONS;
  const frozenProcessEnvironment = freezeEnvironment(requestedEnvironmentSource);

  const tempRoot = localAbsolute(process.env.TEMP, 'TRUSTED_POLICY_BOOTSTRAP_FAILED');
  const journalRoot = path.win32.join(tempRoot, 'foundation-policy-attestations');
  const journalStat = fs.lstatSync(journalRoot);
  if (!journalStat.isDirectory() || journalStat.isSymbolicLink()) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  let journalSequence = 0;
  function writeJournal(fileName, payload) {
    fs.writeFileSync(path.win32.join(journalRoot, fileName), JSON.stringify(payload), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
  }
  function nextJournalId() {
    journalSequence += 1;
    return String(process.pid) + '-' + String(journalSequence).padStart(4, '0');
  }
  function environmentLayer(environment, evidenceKind, observed, sourceDerived, nodeOptions) {
    return {
      evidence_kind: evidenceKind,
      observed,
      source_derived: sourceDerived,
      key_names: sortedKeys(environment),
      sha256: environmentDigest(environment),
      node_options: nodeOptions
    };
  }
  function beginChildJournal(plan) {
    const id = nextJournalId();
    const sourceDerivedEnvironment = cloneEnvironment(plan.environment);
    if (plan.expectedNativeNodeOptions !== null) {
      sourceDerivedEnvironment.NODE_OPTIONS = plan.expectedNativeNodeOptions;
    }
    const sourceDerivedExtras = plan.sourceDerivedExtraEnvironment || {};
    for (const name of sortedKeys(sourceDerivedExtras)) {
      if (Object.prototype.hasOwnProperty.call(sourceDerivedEnvironment, name)) {
        throw makeError('TRUSTED_POLICY_CHILD_ENVIRONMENT_DENIED');
      }
      sourceDerivedEnvironment[name] = sourceDerivedExtras[name];
    }
    writeJournal('spawn-' + id + '-intent.json', {
      schema_version: 'foundation-spawn-intent/v1',
      id,
      parent_pid: process.pid,
      api: plan.api,
      role: plan.role,
      executable_path: plan.executable,
      executable_sha256: plan.hash,
      argv: plan.argv,
      cwd: plan.cwd,
      incoming_request_env: plan.incomingRequestEnvironment === null ? null :
        environmentLayer(plan.incomingRequestEnvironment, 'q_observed_normalized_request', true, false, null),
      q_supplied_env: environmentLayer(plan.environment, 'q_constructed_supplied', false, false, null),
      source_derived_createprocess_env: {
        ...environmentLayer(
          sourceDerivedEnvironment,
          plan.sourceDerivedBasis,
          false,
          true,
          plan.expectedNativeNodeOptions
        ),
        stdio: plan.sourceDerivedStdio,
        ipc_fd: plan.sourceDerivedIpcFd
      },
      bootstrap_visible_env: plan.bootstrapVisibleEnvironment === null ? null :
        environmentLayer(
          plan.bootstrapVisibleEnvironment,
          'expected_then_child_policy_ready_observed',
          false,
          false,
          null
        ),
      derived_node_prefix: derivedNodePrefix
    });
    return id;
  }
  function finishChildJournal(id, success, pid, error) {
    const payload = {
      schema_version: 'foundation-spawn-result/v1',
      id,
      parent_pid: process.pid,
      success
    };
    if (success) {
      if (!Number.isInteger(pid) || pid <= 0) {
        throw makeError('TRUSTED_POLICY_CHILD_RESULT_INVALID');
      }
      payload.pid = pid;
    } else {
      payload.error_code = error && error.code ? String(error.code) : 'NATIVE_CHILD_CALL_FAILED';
      payload.error_name = error && error.name ? String(error.name) : 'Error';
    }
    writeJournal('spawn-' + id + '-result.json', payload);
  }
  function invokeAsyncChild(plan, nativeCall) {
    const id = beginChildJournal(plan);
    try {
      const child = nativeCall();
      if (!child || !Number.isInteger(child.pid) || child.pid <= 0) {
        if (child && typeof child.kill === 'function') {
          try { child.kill(); } catch {}
        }
        finishChildJournal(id, false, undefined, makeError('TRUSTED_POLICY_CHILD_RESULT_INVALID'));
        throw makeError('TRUSTED_POLICY_CHILD_RESULT_INVALID');
      }
      try {
        finishChildJournal(id, true, child.pid, null);
      } catch (error) {
        try { child.kill(); } catch {}
        throw error;
      }
      return child;
    } catch (error) {
      const resultPath = path.win32.join(journalRoot, 'spawn-' + id + '-result.json');
      if (!fs.existsSync(resultPath)) {
        finishChildJournal(id, false, undefined, error);
      }
      throw error;
    }
  }
  function invokeSyncChild(plan, nativeCall) {
    const id = beginChildJournal(plan);
    try {
      const result = nativeCall();
      finishChildJournal(id, true, result && result.pid, null);
      return result;
    } catch (error) {
      finishChildJournal(id, false, undefined, error);
      throw error;
    }
  }

  const base19Names = [
    'APPDATA', 'ComSpec', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
    'NODE_DISABLE_COMPILE_CACHE', 'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERNAME',
    'USERPROFILE', 'WINDIR'
  ];
  const vitestChildValues = Object.freeze({
    TEST: 'true',
    VITEST: 'true',
    NODE_ENV: 'test',
    VITEST_MODE: 'RUN',
    TINYPOOL_WORKER_ID: '1'
  });
  const vitestIncomingViteValues = Object.freeze({
    BASE_URL: '/',
    MODE: 'test',
    DEV: '1',
    PROD: ''
  });
  function assertVitestBootstrapVisibleEnvironment(source) {
    const expected = new Map();
    for (const name of base19Names) {
      if (!Object.prototype.hasOwnProperty.call(source, name)) {
        throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
      }
      expected.set(name.toUpperCase(), source[name]);
    }
    for (const name of Object.keys(vitestChildValues)) {
      expected.set(name, vitestChildValues[name]);
    }
    const actualNames = sortedKeys(source);
    const seen = new Set();
    for (const name of actualNames) {
      const upperName = name.toUpperCase();
      if (!expected.has(upperName) || expected.get(upperName) !== source[name] ||
          seen.has(upperName)) {
        throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
      }
      seen.add(upperName);
    }
    if (seen.size !== expected.size) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
  }
  if (selfRole === 'vitest_single_fork') {
    assertVitestBootstrapVisibleEnvironment(frozenProcessEnvironment);
  }
  function buildVitestForkEnvironment(incoming) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      throw makeError('TRUSTED_POLICY_CHILD_ENVIRONMENT_DENIED');
    }
    const expected = new Map();
    for (const name of base19Names) {
      if (!Object.prototype.hasOwnProperty.call(frozenProcessEnvironment, name)) {
        throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
      }
      expected.set(name.toUpperCase(), { name, value: frozenProcessEnvironment[name] });
    }
    for (const name of Object.keys(vitestChildValues)) {
      expected.set(name, { name, value: vitestChildValues[name] });
    }
    for (const name of Object.keys(vitestIncomingViteValues)) {
      expected.set(name, { name, value: vitestIncomingViteValues[name] });
    }
    const seen = new Map();
    for (const name of Object.keys(incoming)) {
      const upperName = name.toUpperCase();
      const item = expected.get(upperName);
      const value = incoming[name];
      if (!item || typeof value !== 'string' || value !== item.value ||
          (seen.has(upperName) && seen.get(upperName) !== value)) {
        throw makeError('TRUSTED_POLICY_CHILD_ENVIRONMENT_DENIED');
      }
      seen.set(upperName, value);
    }
    if (seen.size !== expected.size) {
      throw makeError('TRUSTED_POLICY_CHILD_ENVIRONMENT_DENIED');
    }
    const normalizedIncoming = {};
    for (const item of expected.values()) normalizedIncoming[item.name] = item.value;
    const rebuilt = {};
    for (const name of base19Names) rebuilt[name] = frozenProcessEnvironment[name];
    for (const name of Object.keys(vitestChildValues)) rebuilt[name] = vitestChildValues[name];
    return Object.freeze({
      incomingRequestEnvironment: freezeEnvironment(normalizedIncoming),
      qSuppliedEnvironment: freezeEnvironment(rebuilt)
    });
  }

  const nativeSpawn = childProcess.spawn;
  const nativeSpawnSync = childProcess.spawnSync;
  const nativeFork = childProcess.fork;
  const nativeChildPrototypeSpawn = childProcess.ChildProcess.prototype.spawn;
  let prototypeSpawnPermit = null;
  replacePublicMethod(childProcess.ChildProcess.prototype, 'spawn',
    function guardedChildPrototypeSpawn(options) {
      const permit = prototypeSpawnPermit;
      if (!permit || permit.consumed) {
        throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
      }
      permit.consumed = true;
      return Reflect.apply(nativeChildPrototypeSpawn, this, [options]);
    });
  function withPrototypeSpawnPermit(role, action) {
    if (prototypeSpawnPermit !== null) {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    const permit = { role, consumed: false };
    prototypeSpawnPermit = permit;
    try {
      const result = action();
      if (!permit.consumed) {
        throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
      }
      return result;
    } finally {
      prototypeSpawnPermit = null;
    }
  }
  replaceFunction(childProcess, 'spawn', function guardedSpawn(file, args, options) {
    if (!childEnabled || selfRole === 'snapshot_node_helper') {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    const executable = assertExactFile(
      file, esbuildExecutable, 9913856, esbuildHash,
      'TRUSTED_POLICY_CHILD_PROCESS_DENIED'
    );
    if (!arraysEqual(args, esbuildArgs) || !options || typeof options !== 'object' ||
        !arraysEqual(sortedKeys(options), ['cwd', 'stdio', 'windowsHide']) ||
        options.windowsHide !== true || !arraysEqual(options.stdio, ['pipe', 'pipe', 'inherit']) ||
        localAbsolute(options.cwd, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED').toUpperCase() !==
          controlledCwd.toUpperCase() || options.env !== undefined ||
        options.shell !== undefined) {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    const environment = cloneEnvironment(frozenProcessEnvironment);
    const effectiveOptions = {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: controlledCwd,
      env: environment,
      shell: false
    };
    const plan = {
      api: 'spawn', role: 'esbuild', executable, hash: esbuildHash,
      argv: args.slice(), cwd: controlledCwd, environment,
      expectedNativeNodeOptions: expectedInjectedNodeOptions,
      incomingRequestEnvironment: null,
      sourceDerivedExtraEnvironment: null,
      sourceDerivedBasis: 'node24-permission-node-options-source-derived',
      sourceDerivedStdio: ['pipe', 'pipe', 'inherit'],
      sourceDerivedIpcFd: null,
      bootstrapVisibleEnvironment: null
    };
    return invokeAsyncChild(plan, function invokeEsbuild() {
      return withPrototypeSpawnPermit('esbuild', function permittedEsbuildSpawn() {
        return Reflect.apply(nativeSpawn, childProcess, [executable, args.slice(), effectiveOptions]);
      });
    });
  });
  replaceFunction(childProcess, 'spawnSync', function guardedSpawnSync(file, args, options) {
    if (!childEnabled || selfRole === 'snapshot_node_helper') {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    let resolved;
    try {
      resolved = localAbsolute(file, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    } catch {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    if (resolved.toUpperCase() === esbuildExecutable.toUpperCase()) {
      throw makeError('TRUSTED_POLICY_NODE_SYNC_ESBUILD_FORBIDDEN');
    }
    const executable = assertExactFile(
      resolved, snapshotNode, 91694408, nodeHash,
      'TRUSTED_POLICY_CHILD_PROCESS_DENIED'
    );
    if (!arraysEqual(args, rollupTail) || !options || typeof options !== 'object' ||
        !arraysEqual(sortedKeys(options), ['encoding', 'timeout', 'windowsHide']) ||
        options.encoding !== 'utf8' || options.timeout !== 3000 || options.windowsHide !== true) {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    const environment = cloneEnvironment(frozenProcessEnvironment);
    const effectiveArgs = derivedNodePrefix.concat(rollupTail);
    const effectiveOptions = {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      cwd: controlledCwd,
      env: environment,
      shell: false
    };
    const plan = {
      api: 'spawnSync', role: 'snapshot_node_helper', executable, hash: nodeHash,
      argv: effectiveArgs, cwd: controlledCwd, environment,
      expectedNativeNodeOptions: null,
      incomingRequestEnvironment: null,
      sourceDerivedExtraEnvironment: null,
      sourceDerivedBasis: 'argv-contains-permission-no-node-options-injection',
      sourceDerivedStdio: null,
      sourceDerivedIpcFd: null,
      bootstrapVisibleEnvironment: environment
    };
    return invokeSyncChild(plan, function invokeRollupHelper() {
      return Reflect.apply(nativeSpawnSync, childProcess, [executable, effectiveArgs, effectiveOptions]);
    });
  });
  replaceFunction(childProcess, 'fork', function guardedFork(modulePath, args, options) {
    if (!childEnabled || selfRole !== 'direct_parent') {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    let callerOptions;
    let callerArgs;
    if (Array.isArray(args)) {
      callerArgs = args;
      callerOptions = options || {};
    } else if ((args === undefined || args === null) && options && typeof options === 'object') {
      callerArgs = [];
      callerOptions = options;
    } else {
      callerArgs = [];
      callerOptions = args || {};
    }
    if (callerArgs.length !== 0 || !callerOptions || typeof callerOptions !== 'object' ||
        Array.isArray(callerOptions) ||
        (callerOptions.execArgv !== undefined &&
         (!Array.isArray(callerOptions.execArgv) ||
          !callerOptions.execArgv.every(function stringArg(value) { return typeof value === 'string'; }))) ||
        (callerOptions.execPath !== undefined &&
         localAbsolute(callerOptions.execPath, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED').toUpperCase() !==
           snapshotNode.toUpperCase()) ||
        callerOptions.stdio !== 'pipe' ||
        (callerOptions.cwd !== undefined &&
         localAbsolute(callerOptions.cwd, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED').toUpperCase() !==
           controlledCwd.toUpperCase()) ||
        localAbsolute(modulePath, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED').toUpperCase() !==
          vitestForkModule.toUpperCase()) {
      throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
    }
    const forkEnvironments = buildVitestForkEnvironment(callerOptions.env);
    const environment = forkEnvironments.qSuppliedEnvironment;
    const effectiveOptions = {
      cwd: controlledCwd,
      env: environment,
      execPath: snapshotNode,
      execArgv: derivedNodePrefix.slice(),
      stdio: 'pipe',
      windowsHide: true,
      detached: false,
      serialization: 'json'
    };
    const plan = {
      api: 'fork', role: 'vitest_single_fork', executable: snapshotNode, hash: nodeHash,
      argv: derivedNodePrefix.concat([vitestForkModule]), cwd: controlledCwd, environment,
      expectedNativeNodeOptions: null,
      incomingRequestEnvironment: forkEnvironments.incomingRequestEnvironment,
      sourceDerivedExtraEnvironment: {
        NODE_CHANNEL_FD: '3',
        NODE_CHANNEL_SERIALIZATION_MODE: 'json'
      },
      sourceDerivedBasis: 'node24-fork-ipc-environment-source-derived',
      sourceDerivedStdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      sourceDerivedIpcFd: '3',
      bootstrapVisibleEnvironment: environment
    };
    return invokeAsyncChild(plan, function invokeVitestFork() {
      return withPrototypeSpawnPermit('vitest_single_fork', function permittedVitestFork() {
        return Reflect.apply(nativeFork, childProcess, [vitestForkModule, [], effectiveOptions]);
      });
    });
  });
  replaceFunction(childProcess, 'exec', deny('TRUSTED_POLICY_CHILD_PROCESS_DENIED'));
  replaceFunction(childProcess, 'execSync', deny('TRUSTED_POLICY_CHILD_PROCESS_DENIED'));
  replaceFunction(childProcess, 'execFile', deny('TRUSTED_POLICY_CHILD_PROCESS_DENIED'));
  replaceFunction(childProcess, 'execFileSync', function guardedExecFileSync(file) {
    let resolved = null;
    try { resolved = localAbsolute(file, 'TRUSTED_POLICY_CHILD_PROCESS_DENIED'); } catch {}
    if (resolved && resolved.toUpperCase() === esbuildExecutable.toUpperCase()) {
      throw makeError('TRUSTED_POLICY_NODE_SYNC_ESBUILD_FORBIDDEN');
    }
    throw makeError('TRUSTED_POLICY_CHILD_PROCESS_DENIED');
  });

  function normalizeOpenClawRoot() {
    const value = process.env.OPENCLAW_STATE_DIR;
    if (!value) {
      return null;
    }
    if (!path.win32.isAbsolute(value) || value.startsWith('\\\\') ||
        value.startsWith('\\??\\') || value.indexOf('\u0000') >= 0) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    return path.win32.resolve(value);
  }

  const openClawRoot = normalizeOpenClawRoot();
  function assertSqlitePath(location) {
    if (location === ':memory:') {
      return;
    }
    if (typeof location !== 'string' || !openClawRoot ||
        !path.win32.isAbsolute(location) || location.startsWith('\\\\') ||
        location.startsWith('\\??\\') || location.indexOf('\u0000') >= 0) {
      throw makeError('TRUSTED_POLICY_SQLITE_PATH_DENIED');
    }
    const candidate = path.win32.resolve(location);
    const prefix = openClawRoot.endsWith('\\') ? openClawRoot : openClawRoot + '\\';
    if (!candidate.toUpperCase().startsWith(prefix.toUpperCase())) {
      throw makeError('TRUSTED_POLICY_SQLITE_PATH_DENIED');
    }
  }

  const NativeDatabaseSync = sqlite.DatabaseSync;
  const nativeBackup = sqlite.backup;
  const sqliteConstants = sqlite.constants;
  const nativeDatabasePrototype = NativeDatabaseSync && NativeDatabaseSync.prototype;
  if (typeof NativeDatabaseSync !== 'function' || typeof nativeBackup !== 'function' ||
      !sqliteConstants || !Number.isInteger(sqliteConstants.SQLITE_ATTACH) ||
      !Number.isInteger(sqliteConstants.SQLITE_DENY) ||
      !Number.isInteger(sqliteConstants.SQLITE_OK) || !nativeDatabasePrototype) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  const nativeSetAuthorizer = nativeDatabasePrototype.setAuthorizer;
  const nativeExec = nativeDatabasePrototype.exec;
  const nativePrepare = nativeDatabasePrototype.prepare;
  const nativeEnableDefensive = nativeDatabasePrototype.enableDefensive;
  if (typeof nativeSetAuthorizer !== 'function' || typeof nativeExec !== 'function' ||
      typeof nativePrepare !== 'function' || typeof nativeEnableDefensive !== 'function') {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }

  function assertTrustedSql(sql) {
    if (typeof sql !== 'string') {
      throw makeError('TRUSTED_POLICY_SQLITE_SQL_DENIED');
    }
    const normalized = sql
      .replace(/--[^\r\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (/\bATTACH\b/.test(normalized) || /\bVACUUM\b[\s\S]*\bINTO\b/.test(normalized)) {
      throw makeError('TRUSTED_POLICY_SQLITE_SQL_DENIED');
    }
  }

  function assertAttachLimit(database, bootstrap) {
    if (!database || !database.limits || typeof database.limits !== 'object' ||
        !('attach' in database.limits)) {
      throw makeError(bootstrap ?
        'TRUSTED_POLICY_BOOTSTRAP_FAILED' : 'TRUSTED_POLICY_SQLITE_CONTROL_DENIED');
    }
    if (database.limits.attach !== 0) {
      throw makeError(bootstrap ?
        'TRUSTED_POLICY_BOOTSTRAP_FAILED' : 'TRUSTED_POLICY_SQLITE_CONTROL_DENIED');
    }
  }

  replacePublicMethod(nativeDatabasePrototype, 'exec', function guardedExec(sql) {
    assertAttachLimit(this, false);
    assertTrustedSql(sql);
    return Reflect.apply(nativeExec, this, arguments);
  });
  replacePublicMethod(nativeDatabasePrototype, 'prepare', function guardedPrepare(sql) {
    assertAttachLimit(this, false);
    assertTrustedSql(sql);
    return Reflect.apply(nativePrepare, this, arguments);
  });
  replacePublicMethod(nativeDatabasePrototype, 'setAuthorizer',
    deny('TRUSTED_POLICY_SQLITE_CONTROL_DENIED'));
  replacePublicMethod(nativeDatabasePrototype, 'enableLoadExtension',
    deny('TRUSTED_POLICY_SQLITE_EXTENSION_DENIED'));
  replacePublicMethod(nativeDatabasePrototype, 'loadExtension',
    deny('TRUSTED_POLICY_SQLITE_EXTENSION_DENIED'));
  replacePublicMethod(nativeDatabasePrototype, 'createTagStore',
    deny('TRUSTED_POLICY_SQLITE_SQL_DENIED'));
  replacePublicMethod(nativeDatabasePrototype, 'enableDefensive',
    function guardedEnableDefensive(enabled) {
      assertAttachLimit(this, false);
      if (arguments.length !== 1 || enabled !== true) {
        throw makeError('TRUSTED_POLICY_SQLITE_CONTROL_DENIED');
      }
      return Reflect.apply(nativeEnableDefensive, this, [true]);
    });

  function hardenDatabase(database) {
    if (!database || !database.limits || typeof database.limits !== 'object' ||
        !('attach' in database.limits)) {
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    database.limits.attach = 0;
    assertAttachLimit(database, true);
    Reflect.apply(nativeSetAuthorizer, database, [function foundationSqliteAuthorizer(actionCode) {
      return actionCode === sqliteConstants.SQLITE_ATTACH ?
        sqliteConstants.SQLITE_DENY : sqliteConstants.SQLITE_OK;
    }]);
    return database;
  }

  function GuardedDatabaseSync(location, options) {
    assertSqlitePath(location);
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
      throw makeError('TRUSTED_POLICY_SQLITE_CONTROL_DENIED');
    }
    const effectiveOptions = Object.assign({}, options || {}, {
      allowExtension: false,
      defensive: true
    });
    const database = hardenDatabase(Reflect.construct(
      NativeDatabaseSync,
      [location, effectiveOptions],
      NativeDatabaseSync
    ));
    Object.setPrototypeOf(database, guardedDatabasePrototype);
    if (Object.getPrototypeOf(database) !== guardedDatabasePrototype) {
      try { database.close(); } catch {}
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    return database;
  }
  replacePublicMethod(nativeDatabasePrototype, 'constructor', GuardedDatabaseSync);
  const guardedDatabasePrototype = {};
  for (const name of Reflect.ownKeys(nativeDatabasePrototype)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(nativeDatabasePrototype, name);
    if (!descriptor) throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    Object.defineProperty(guardedDatabasePrototype, name, descriptor);
  }
  Object.defineProperty(guardedDatabasePrototype, 'constructor', {
    value: GuardedDatabaseSync,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.freeze(guardedDatabasePrototype);
  GuardedDatabaseSync.prototype = guardedDatabasePrototype;
  Object.freeze(GuardedDatabaseSync);
  function guardedBackup() {
    throw makeError('TRUSTED_POLICY_SQLITE_BACKUP_DENIED');
  }
  replaceFunction(sqlite, 'DatabaseSync', GuardedDatabaseSync);
  replaceFunction(sqlite, 'backup', guardedBackup);

  const rollupAddon = path.win32.join(
    snapshotRoot, 'pnpm', '@rollup+rollup-win32-x64-msvc@4.62.4',
    'node_modules', '@rollup', 'rollup-win32-x64-msvc',
    'rollup.win32-x64-msvc.node'
  );
  const rollupAddonHash = '397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49';
  const nativeDlopen = process.dlopen;
  function normalizeDlopenPath(value) {
    if (typeof value !== 'string' || value.indexOf('\u0000') >= 0) {
      throw makeError('TRUSTED_POLICY_ADDON_DENIED');
    }
    const slash = String.fromCharCode(92);
    const ordinaryDrive = /^[A-Za-z]:\\/;
    const extendedDrive = /^\\\\\?\\[A-Za-z]:\\/;
    const pathKind = extendedDrive.test(value) ? 'namespaced_drive' :
      (ordinaryDrive.test(value) ? 'ordinary_drive' : null);
    if (pathKind === null) {
      throw makeError('TRUSTED_POLICY_ADDON_DENIED');
    }
    let candidate = value;
    if (candidate.length >= 4 && candidate[0] === slash && candidate[1] === slash &&
        candidate[2] === '?' && candidate[3] === slash) {
      candidate = candidate.slice(4);
    }
    return Object.freeze({
      canonicalPath: localAbsolute(candidate, 'TRUSTED_POLICY_ADDON_DENIED'),
      pathKind
    });
  }
  replaceFunction(process, 'dlopen', function guardedDlopen(moduleObject, fileName, flags) {
    if (!addonEnabled || selfRole === 'snapshot_node_helper' || arguments.length !== 2) {
      throw makeError('TRUSTED_POLICY_ADDON_DENIED');
    }
    const normalizedDlopen = normalizeDlopenPath(fileName);
    const resolved = normalizedDlopen.canonicalPath;
    assertExactFile(
      resolved, rollupAddon, 2623488, rollupAddonHash,
      'TRUSTED_POLICY_ADDON_DENIED'
    );
    const id = nextJournalId();
    writeJournal('addon-' + id + '-intent.json', {
      schema_version: 'foundation-addon-intent/v1',
      id,
      pid: process.pid,
      path: resolved,
      path_kind: normalizedDlopen.pathKind,
      length: 2623488,
      sha256: rollupAddonHash
    });
    try {
      const result = Reflect.apply(nativeDlopen, process, [moduleObject, fileName]);
      writeJournal('addon-' + id + '-result.json', {
        schema_version: 'foundation-addon-result/v1',
        id,
        pid: process.pid,
        success: true,
        path: resolved,
        path_kind: normalizedDlopen.pathKind,
        sha256: rollupAddonHash
      });
      return result;
    } catch (error) {
      writeJournal('addon-' + id + '-result.json', {
        schema_version: 'foundation-addon-result/v1',
        id,
        pid: process.pid,
        success: false,
        error_code: error && error.code ? String(error.code) : 'NATIVE_DLOPEN_FAILED'
      });
      throw error;
    }
  });

  syncBuiltinESMExports();
  const esmSqlite = await import('node:sqlite');
  if (require('node:sqlite').DatabaseSync !== GuardedDatabaseSync ||
      require('node:sqlite').backup !== guardedBackup ||
      esmSqlite.DatabaseSync !== GuardedDatabaseSync ||
      esmSqlite.backup !== guardedBackup) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }

  function expectDenied(code, action) {
    try {
      action();
    } catch (error) {
      if (error && error.code === code) {
        return;
      }
      throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
    }
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }

  for (const action of networkSelfTests) {
    expectDenied(networkCode, action);
  }
  expectDenied('TRUSTED_POLICY_SQLITE_PATH_DENIED', function sqliteSelfTest() {
    assertSqlitePath('\\\\foundation-policy-invalid\\share\\forbidden.db');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_PATH_DENIED', function sqliteConstructorPathSelfTest() {
    new sqlite.DatabaseSync('\\\\foundation-policy-invalid\\share\\forbidden.db');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_SQL_DENIED', function sqliteAttachSelfTest() {
    assertTrustedSql('ATTACH DATABASE ? AS forbidden');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_SQL_DENIED', function sqliteVacuumSelfTest() {
    assertTrustedSql('VACUUM main INTO \'forbidden.db\'');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_BACKUP_DENIED', function sqliteBackupSelfTest() {
    sqlite.backup();
  });
  if (Object.getPrototypeOf(sqlite.DatabaseSync) !== Function.prototype ||
      sqlite.DatabaseSync.prototype.constructor !== sqlite.DatabaseSync ||
      nativeDatabasePrototype.constructor !== sqlite.DatabaseSync) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  const sqliteSelfTestDatabase = new sqlite.DatabaseSync(':memory:');
  if (Object.getPrototypeOf(sqliteSelfTestDatabase) !== sqlite.DatabaseSync.prototype ||
      sqliteSelfTestDatabase.constructor !== sqlite.DatabaseSync) {
    throw makeError('TRUSTED_POLICY_BOOTSTRAP_FAILED');
  }
  expectDenied('TRUSTED_POLICY_SQLITE_CONTROL_DENIED', function sqliteAuthorizerSelfTest() {
    sqliteSelfTestDatabase.setAuthorizer(function deniedReplacement() { return sqliteConstants.SQLITE_OK; });
  });
  expectDenied('TRUSTED_POLICY_SQLITE_CONTROL_DENIED', function sqliteDefensiveSelfTest() {
    sqliteSelfTestDatabase.enableDefensive(false);
  });
  expectDenied('TRUSTED_POLICY_SQLITE_EXTENSION_DENIED', function sqliteExtensionSelfTest() {
    sqliteSelfTestDatabase.enableLoadExtension(true);
  });
  expectDenied('TRUSTED_POLICY_SQLITE_EXTENSION_DENIED', function sqliteLoadExtensionSelfTest() {
    sqliteSelfTestDatabase.loadExtension('forbidden');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_SQL_DENIED', function sqliteExecSelfTest() {
    sqliteSelfTestDatabase.exec('ATTACH DATABASE \'forbidden.db\' AS forbidden');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_SQL_DENIED', function sqlitePrepareSelfTest() {
    sqliteSelfTestDatabase.prepare('VACUUM main INTO \'forbidden.db\'');
  });
  expectDenied('TRUSTED_POLICY_SQLITE_SQL_DENIED', function sqliteTagStoreSelfTest() {
    sqliteSelfTestDatabase.createTagStore();
  });
  sqliteSelfTestDatabase.close();
  expectDenied('TRUSTED_POLICY_CHILD_PROCESS_DENIED', function childSelfTest() {
    childProcess.spawn('C:\\Windows\\System32\\cmd.exe');
  });
  expectDenied('TRUSTED_POLICY_CHILD_PROCESS_DENIED', function childPrototypeSelfTest() {
    new childProcess.ChildProcess().spawn({ file: 'C:\\Windows\\System32\\cmd.exe' });
  });
  expectDenied('TRUSTED_POLICY_ADDON_DENIED', function addonSelfTest() {
    process.dlopen({}, 'C:\\Windows\\System32\\forbidden.node');
  });
  expectDenied('TRUSTED_POLICY_ADDON_DENIED', function addonFlagsSelfTest() {
    process.dlopen({}, rollupAddon, 0);
  });
  if (childEnabled && selfRole !== 'snapshot_node_helper') {
    expectDenied('TRUSTED_POLICY_NODE_SYNC_ESBUILD_FORBIDDEN', function syncEsbuildSelfTest() {
      childProcess.spawnSync(esbuildExecutable, ['--service=0.21.5']);
    });
  }

  const policySha256 = sha256File(__filename);
  writeJournal('policy-ready-' + String(process.pid) + '.json', {
    schema_version: 'foundation-policy-attestation/v2',
    status: 'ready',
    pid: process.pid,
    ppid: process.ppid,
    role: selfRole,
    executable_path: process.execPath,
    exec_argv: process.execArgv,
    argv: process.argv,
    derived_node_prefix: derivedNodePrefix,
    bootstrap_visible_env: environmentLayer(
      observedProcessEnvironment,
      'q_bootstrap_observed',
      true,
      false,
      observedNodeOptions
    ),
    policy_path: __filename,
    policy_module_url: import.meta.url,
    policy_sha256: policySha256,
    network_hook_set: networkHooks,
    network_not_present: networkNotPresent,
    sqlite_cjs_esm_self_test: true,
    child_policy_installed: true,
    addon_policy_installed: true
  });

  Object.defineProperty(globalThis, MARKER, {
    value: Object.freeze({
      version: VERSION,
      derivedNodePrefix,
      networkHooks: Object.freeze(networkHooks.slice()),
      sqlite: 'constructor-authorizer-and-trusted-sql-guard',
      child: 'role-specific-journaled',
      addon: 'rollup-msvc-only',
      policySha256
    }),
    enumerable: false,
    configurable: false,
    writable: false
  });
}());
```

这些hooks只为完整冻结且可信的runtime/staging减少意外网络和SQLite外写；它们不是恶意代码、native addon、`process.binding`或OS网络沙箱。Node Permission本身**不约束网络，也不保证`node:sqlite`文件I/O受fs flags限制**；其权限也不继承worker，故本契约禁止worker。Permission的symlink语义也不作为边界：snapshot junction先全部重写到P内并被identity/tree/immutable existing-input pins约束。Task5是唯一真实Node/Vitest/TypeScript/OpenClaw执行层，必须验证fork topology/flag继承、policy初始化、实际命令成功以及所有契约枚举manifest/guard/out-of-root write观察为0；RED只验证exact bytes/hash/spec、fakes与PowerShell helper，不得声称观察到真实`ERR_ACCESS_DENIED`或OS级网络隔离。

测试不得运行真实 npm。core 的 `CommandRunner` adapter 接收 command spec并返回§6.1冻结的完整结构；其基础及安全字段至少明确列为：

```text
id, route, stage, cwd, executable, arguments[]
started_at, finished_at, status, exit_code
stdout, stderr, exception_type, exception_text
error_code, process_identity, job_control, stream_capture
taskkill, termination_errors[]
```

fake runner 按 command ID 返回设定 exit code，并可在临时 fixture 中创建指定文件。production native runner必须从已保存且身份匹配的parent process handle调用`GetExitCodeProcess`取得exit code；不得改用`System.Diagnostics.Process`另启一套进程、按PID重新打开未核身份的对象，或在脚本块/PowerShell函数返回后读取可能陈旧的`$LASTEXITCODE`。

### 6.1 冻结的内部 core 与 adapter 接口

`shared/private/foundation-validation-core.ps1` 被 dot-source 后冻结一个协调入口及两个由生产实现和安全测试共同复用的内部helper；三者都不能成为 Skill、聊天或安装层公共接口：

```powershell
Invoke-FoundationValidationCore `
  -ProjectRoot <absolute-internal-root> `
  -EvidenceRoot <absolute-evidence-root> `
  -Runtime <hashtable> `
  -CommandRunner <scriptblock> `
  -CleanupRunner <scriptblock> `
  -EnvironmentAdapter <scriptblock> `
  -ManifestProvider <scriptblock> `
  -ReportPublisher <scriptblock> `
  -PathPhaseObserver <scriptblock-or-null> `
  -Clock <scriptblock> `
  -RunIdProvider <scriptblock>

Resolve-FoundationChildPath `
  -TrustedParent <absolute-path> `
  -CandidateRelativePath <untrusted-relative-or-absolute-path> `
  -ExpectedLeaf <fixed-leaf-or-empty>

Invoke-FoundationProcessCommand `
  -CommandSpec <pscustomobject> `
  -TimeoutMs <positive-int> `
  [-TerminationRunner <scriptblock-or-null>] `
  [-ProcessFaultInjector <scriptblock-or-null>]
```

- 生产入口的`ProjectRoot`只能由`$PSScriptRoot`推导，`EvidenceRoot`只能是项目内固定`docs/evidence`；它不声明同名公共参数，也不把用户、聊天或环境值透传到这两个参数。
- `Runtime`顶层恰含`temporary_parent,node_path,tool_modules_path,vitest_path,typescript_path,openclaw_path,dependency_source_roots,protected_external_paths,identity_expectations`。production入口构造的前六个source路径及后两个layout对象必须逐项等于§4.4字面值；`identity_expectations`逐项等于§4.7的A identity、source canonical-v1、snapshot canonical-v2、tool target、package closure、missing optional peers与trusted-policy schema。private snapshot路径只由core从本轮validation root派生，禁止由Runtime/caller传入。内部测试必须提供同shape的test-owned sibling source runtime、fixture dependency roots、§4.5五项fixture guards及真实fixture expectations，再由core建立fixture private snapshot；不存在`mode/is_test/skip_identity/use_production_guards/snapshot_path`字段。
- 除`ProjectRoot`、`EvidenceRoot`、`Runtime`外的八个core scriptblock都是内部测试缝。`CommandRunner`、`CleanupRunner`、只读`EnvironmentAdapter`、`Clock`和`RunIdProvider`生产时必须传真实adapter；`ManifestProvider`与`ReportPublisher`允许传`$null`，其唯一含义是使用core内建真实adapter，正常manifest/report测试必须使用该模式，只有对应故障用例传fake。`PathPhaseObserver`在production装配中必须恒为`$null`。`Invoke-FoundationProcessCommand`的`TerminationRunner/ProcessFaultInjector`只用于直接helper测试；production `CommandRunner`必须两者均省略或显式传`$null`。生产入口不得声明、反射转发或用环境变量启用任一adapter/seam参数。
- core无论成功或预期失败都返回单个`PSCustomObject`报告，至少含`schema_version/task_id/run_id/verdict/exit_code/roots/environment/commands/manifests/openclaw_state/temporary_roots/errors/report_path/raw_paths/raw_sha256/publication`；不得在core内调用`exit`。production入口只根据返回对象的`exit_code`终止。
- 语法错误或无法dot-source属于测试/安装错误，可以抛出；进入core生命周期后的command、manifest、environment、cleanup和publish错误必须聚合到返回对象。
- `Resolve-FoundationChildPath`必须实际使用与生产根解析相同的规范化、尾分隔符containment和reparse检查；返回`allowed,full_path,error_code,error_text`。`RED-ROOT-002/003/004/005`直接调用它注入恶意candidate，分别稳定得到`PATH_TRAVERSAL_REJECTED`、`PATH_OUTSIDE_ALLOWED_ROOT`、prefix false和`PATH_REPARSE_POINT_REJECTED`；不得用恶意run ID间接替代这些测试。
- `Invoke-FoundationProcessCommand`是production `CommandRunner`唯一可用的native进程实现，接受§6.1的command spec与正超时毫秒，返回同一command result字段；production adapter必须对九阶段统一传§4.4冻结的`120000`，并在每个`commands[]`记录`timeout_ms`与`timed_out`；测试可显式传更短正值。`RED-PROCESS-*`直接调用此helper，不能在测试内重写runner后自测测试代码。helper必须用`CreateProcessW(CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT)`取得parent PID/handle/thread和创建时间身份，创建带`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`的Job，并在Resume前通过`CreateIoCompletionPort`+`SetInformationJobObject(JobObjectAssociateCompletionPortInformation)`关联completion port；parent成功assignment后才Resume。job/port/config/assignment失败时payload绝不Resume，helper对原parent handle TerminateProcess并有界确认退出。超时后保留绝对`taskkill.exe /PID <recorded_pid> /T /F`，随后无条件关闭job；禁止按进程名、通配或复用PID终止。

completion port只作为**best-effort telemetry**持续drain `NEW/EXIT/ABNORMAL_EXIT/ACTIVE_PROCESS_ZERO`，不得声称Windows保证每条通知送达或它能单独完整捕获短命后代。每个实际收到的NEW PID必须立即取得process handle、creation time、image path/length/hash并保持身份记录；PID已退出、handle取得失败或identity不全都稳定`PROCESS_DESCENDANT_IDENTITY_UNAVAILABLE`并关Job，不得用PID字符串补猜。B/C.test只允许snapshot Node `3331E1...`或snapshot esbuild `B868C8...`；A/build/plugin不得有descendant。

Q的spawn-intent/result是受控JS child的权威输入。每条test结束并drain至active zero后，core必须读取同一预创建目录中的policy-ready、spawn、addon journal，用no-follow ordinary file/唯一schema/PID/PPID/sequence/Q hash逐项验证；intent/result必须一一配对，所有成功result有唯一正PID，失败result无PID，任何缺失/重复/乱序/未知role为`TRUSTED_POLICY_SPAWN_JOURNAL_INVALID`。随后查询Job `TotalProcesses/ActiveProcesses`累计值：`ActiveProcesses`必须0，`TotalProcesses`必须恰为`1 + distinct successful spawn-result PID count`；去重后的NEW集合也必须恰等于direct parent PID加全部成功result PID，任一消息缺失、额外native/third-party后代、计数差异或PID无法核身份为`PROCESS_COMPLETION_TELEMETRY_INCOMPLETE/PROCESS_JOB_ACCOUNTING_MISMATCH`。这样缺口失败关闭，但仍不把completion机制描述成可靠创建审计。

snapshot Node中恰一个journal/attestation/argv分类为Vitest singleFork worker；Rollup冻结`spawnSync`分类为`snapshot_node_helper`，esbuild冻结async `spawn`分类为`esbuild`，数量按journal/Job实际记录。其他path/hash/live/system、无journal native child或Job外进程立即关Job。singleFork不表示整个Job只有一个descendant；第三方/native后代若不能取得完整身份不会被接受为“已观察”。

`ProcessFaultInjector`接收唯一request `{phase,command_id,process_identity}`，phase只允许`create_before_job|job_setup|job_completion_port|job_assign|pid_identity|stream_stdout_fault|stream_stderr_cancel|job_completion_event|job_accounting_query|job_query|job_close`；直接helper测试可在一个指定phase返回`{inject=true,error_type,error_text}`，其余返回`inject=false`。helper必须在真实前置状态达到该phase后才调用seam，并仍执行同一有界终止/Job/stream状态机；`job_completion_event`只模拟消息缺失/身份错误，`job_accounting_query`只模拟Total/Active读取或不一致，二者都不能伪造真实extra child或PASS。`job_close`注入后仍CloseHandle并确认descendants消失。seam不得伪造OS success、替代真实Job/taskkill/no-follow子变体或被production启用。production固定inactive。

`PathPhaseObserver`接收唯一request `{phase,operation_id,pinned_paths[],target_path}`，phase只允许`root_after_pin_before_create|staging_after_source_pin_before_copy|runtime_snapshot_after_input_pin_before_launch|evidence_after_temp_write_before_rename|cleanup_after_entry_pin_before_dispose`；测试observer可同步尝试把目标/祖先换junction、delete/rename，或对已pin immutable ordinary file执行in-place overwrite再还原。existing leaf的WRITE/DELETE应被系统拒绝，或operation稳定`PATH_IDENTITY_CHANGED/PATH_OPERATION_FAILED`；目录新增只按fresh tree检测，不得虚构parent handle会阻止。observer不能返回“跳过安全检查”的指令，也不能替代真实filesystem race子变体；production恒null且机器报告固定`path_phase_observer_active=false`。

native helper的有界终止协议固定为：主`TimeoutMs`届满后，先复核PID与`process_identity.start_time_filetime_utc`仍匹配，再让`taskkill`命令最多等待`termination_command_timeout_ms=5000`；随后关闭job并让parent/job descendants退出最多等待`parent_exit_grace_ms=5000`；stdout与stderr两个异步捕获最多再共同等待`stream_drain_grace_ms=5000`。因此主超时后的终止/收尾阶段总墙钟上界仍为15000ms；每段即使失败也必须继续进入下一段，禁止在未确认Task状态为`RanToCompletion`时读取`.Result`、无界`ReadToEnd`或无界`WaitForExit()`。PID存在但creation time不匹配时稳定记录`PROCESS_PID_IDENTITY_MISMATCH`，绝不向复用PID发taskkill，仍关闭本helper持有的job handle。

parent在主`TimeoutMs`内正常退出时，helper立即查询job active-process列表。若仍有任一已记录descendant，必须关闭job、在`parent_exit_grace_ms=5000`内确认这些`{pid,start_time_filetime_utc}`身份均已消失，并返回`timed_out=false,status=failed,error_code=PROCESS_DESCENDANT_LEAK_PREVENTED,exception_type=PROCESS_DESCENDANT_LEAK_PREVENTED`；不得把后代留给宿主或只等管道自然关闭。随后只再使用同一个`stream_drain_grace_ms=5000`等待双流；若job已无进程但任一流未关闭，仍按既有`PROCESS_STREAM_DRAIN_TIMEOUT`失败。正常、timeout、非零exit和post-PID exception的所有路径最终都必须关闭job并确认已记录descendants消失。

每个process result及合并后的`commands[]`固定新增`process_identity`与`job_control`。`job_control`至少含`completion_telemetry={best_effort:true,messages[],unique_new_pids[],identity_failures[],active_zero_observed}`、`accounting={total_processes,active_processes,expected_total_processes,matched}`、`spawn_journal={intents[],results[],matched}`；descendant shape为`{pid,start_time_filetime_utc,executable_path,length,sha256,snapshot_manifest_match,role,spawn_journal_id,first_event,last_event,exit_observed}`，production role只允许`vitest_single_fork|snapshot_node_helper|esbuild|unexpected`，direct PowerShell测试可用`test_fixture`。另含既有stream/taskkill/fault/termination。Node命令保存Q `policy_attestations[]/addon_loads[]`；缺失、重复、Q hash/derived prefix、四层environment evidence/observed-source-derived标记/argv/NODE_OPTIONS或PID关联不符为`TRUSTED_POLICY_ATTESTATION_INVALID`。

主超时永远保持`timed_out=true,error_code=PROCESS_TIMEOUT,exception_type=PROCESS_TIMEOUT`；同时发生output limit、capture/job/termination错误时作为附加全局错误保留但不覆盖主timeout。taskkill非零追加`PROCESS_TERMINATION_COMMAND_FAILED`，taskkill自身超时追加`PROCESS_TERMINATION_TIMEOUT`，parent/job宽限后仍存活追加`PROCESS_EXIT_GRACE_EXCEEDED`，任一流未收尾追加`PROCESS_STREAM_DRAIN_TIMEOUT`。进程已成功取得PID后的job查询、捕获、等待、解码或其他异常全部进入同一个有界终止状态机，主错误使用`PROCESS_RUNTIME_FAILED`；只有创建suspended process前失败使用`PROCESS_START_FAILED`，job setup/assignment失败分别使用`PROCESS_JOB_SETUP_FAILED/PROCESS_JOB_ASSIGNMENT_FAILED`且payload未Resume。

`termination_errors[]`每项唯一shape为`{category,error_code,error_type,error_text}`，其中`category`恒为`termination`，`error_code`只允许上一段四个稳定码。taskkill非零的`error_type=NativeCommandExitCode`，文本必须含实际exit code并附非空stderr或固定`no stderr`；其余三个deadline错误的`error_type=System.TimeoutException`，文本分别含阶段名与冻结的5000ms。core按数组顺序把每项一对一映射到全局`errors[]`：`{code=<error_code>,category=termination,command_id=<当前command id>,error_type=<同值>,message=<error_text>}`；局部和全局数量、顺序、码与文本必须相同，不得合并、改名或只留在command对象内。正常成功或普通非超时非零退出时`termination_errors=[]`。

可选`TerminationRunner`签名固定为接收一个request：`path=C:\Windows\System32\taskkill.exe,arguments=[/PID,<recorded_pid>,/T,/F],timeout_ms=5000`，返回与`taskkill`字段同shape的对象。非空fake只允许在`RED-PROCESS-003`直接helper子变体中用于确定性返回非零或超时；helper仍必须验证request的绝对path、精确PID与参数顺序，且测试另一个子变体必须用`$null`实际执行系统taskkill并证明真实树终止。这样fake只注入终止结果，不替代process启动、主timeout、流捕获或错误合并逻辑。

各adapter签名和所有权固定如下：

| Adapter | 调用入参 | 返回/失败语义 |
| --- | --- | --- |
| `CommandRunner` | 单个command spec：`id,route,stage,cwd,executable,arguments[],staging_root,runtime_snapshot_root,module_resolution_roots[],permission_model={enabled,argument_vector[],fs_read_roots[],fs_write_roots[],allow_worker,allow_child_process,allow_addons,allow_wasi},node_runtime={argument_vector[],derived_node_prefix[],no_global_search_paths,policy_module_path,policy_module_url,policy_module_sha256},execution_topology={pool,single_fork,file_parallelism,allowed_descendant_executables[],policy_attestation_root,completion_telemetry_best_effort,job_accounting_required},environment_policy={inherit_environment:false,profile={root,home,appdata,localappdata,temp},parent_environment={exact_key_values=[{name,value,source}...]},derived_child_environment={authority=policy_module,caller_values_allowed=false,incoming_request_env,q_supplied_env,source_derived_createprocess_env,bootstrap_visible_env,observations[]}}`。A的staging/snapshot/topology null或空、permission disabled、common19/exact argv；八Node按§6，且profile/attestation root必须位于同一命令唯一permission write root，build不得加validation write。返回既有process字段并新增`policy_attestations[]/spawn_intents[]/spawn_results[]/addon_loads[]`；拒绝source/live、额外root/capability，保存snapshot/native/policy/topology/accounting；core创建全部skipped结果 |
| `CleanupRunner` | 单个root spec：`root_id,path,trusted_parent,task_id,run_id,path_identity` | 返回adapter原始`attempted,succeeded,residual_count,error_type,error_text`；production adapter只能调用§4.6 no-follow walker，fake只注入结果。core随后独立生成`physical_residual_entries[]/physical_residual_count`，不得以adapter成功或count=0跳过物理复核 |
| `EnvironmentAdapter` | 单个只读request：`operation=snapshot,scope=process` | 成功返回当前进程环境的规范化`entries=[{name,value}...]`，或返回`success=false,error_type,error_text`；core只在内存比较前后快照，报告仅保存键名与值hash/整体fingerprint，不保存原值；禁止`set`、`restore`或任何宿主环境写操作 |
| `ManifestProvider` | 单个request：`scope_id,roots=[{root_id,path}...],exclude_node_modules,include_dist,all_files`；official只传三个data根，project候选只传`project_root/route_A/route_B/route_C`，source-dist按B/C分别传单根 | 返回`scope_id,roots[],entries[]`仅作为候选观察。core必须独立验证scope、fresh对象引用、固定root/path/exists、完整枚举集合及每个entry的containment、ordinary/no-reparse、fresh length/hash/mtime、relative_path、去重root_labels，并由core重算classification/candidate_kind；漏项为`MANIFEST_ENTRY_INCOMPLETE`，多项/outside/字段/hash/分类/label错误为`MANIFEST_ENTRY_INVALID`，二者外层code都为`manifest_failed`。external guard及source-dist使用`all_files=true`，禁止用一个scope结果复制填充另一个scope |
| `ReportPublisher` | 单个request恰为`json_record,raw_records[]`；每个record都由core冻结唯一`artifact_id,artifact_kind,temporary_path,requested_path,expected_sha256,bytes`，两个路径都是evidence内带run_id的预登记唯一绝对路径，`json_record`必须存在且kind=`machine_json`。request不含mutable report | 只能按§4.6将bytes写入该record的`temporary_path`并由temp handle执行一次`FileRenameInfo ReplaceIfExists=false`到`requested_path`；禁止`ConvertTo-Json`、`MoveFileEx`或采用其他temp/final。返回`success,json_path,json_sha256,artifact_results[]`；每项仍为`artifact_id,artifact_kind,requested_path,published_path,status,sha256,error_type,error_text`。失败/抛出归一`report_publish_failed`，core随后独立复核和清理全部预登记temp/final |
| `PathPhaseObserver` | 上述固定phase request；production恒null | 仅测试同步race observation；无返回控制权，异常归一`PATH_OPERATION_FAILED`但仍进入outer finally |
| `Clock` | 无参数 | 返回`DateTimeOffset`；fake必须单调，生产使用`DateTimeOffset.Now` |
| `RunIdProvider` | 无参数 | 返回仅含`[A-Za-z0-9-]`的唯一字符串；生产用GUID N格式 |

默认真实manifest算法仍必须由core实现；`ManifestProvider`只是调度入口，测试`RED-MANIFEST-001/002`必须调用真实provider，只有专门故障用例注入。core分别发出official、project、B/C source-dist、guard和临时审计request并校验固定scope/roots；scope、root ID、规范path或exists集合错误稳定`MANIFEST_RESULT_IDENTITY_INVALID`，任何顶层或nested引用复用都在DTO clone前按下文失败。真实report发布器只使用预登记temp handle→单次FileRenameInfo→唯一final；publish故障通过`ReportPublisher`/PathPhaseObserver注入，不能破坏永久evidence目录。路径/reparse断言使用真实临时文件系统，不允许fake provider直接声称通过。

provider结果不是信任边界。每次调用前后，core都必须以§4.6 no-follow handle复核请求roots的PathIdentity/exists，并独立安全枚举该scope按过滤规则应出现的完整物理文件集合；provider每个entry随后逐项验证：`full_path`位于至少一个请求根内且不是仅字符串前缀，文件和全部祖先均ordinary/nonreparse，physical length/SHA-256/UTC mtime与entry相等，`relative_path`可从固定根唯一重算，`root_labels[]`恰等于所有包含该路径的请求roots并用`StringComparer.OrdinalIgnoreCase`去重排序。core必须按§5最长后缀和OpenClaw 2026.7.1精确白名单重新计算`classification/candidate_kind`，不得信provider声称某SQLite是`other`或内部状态。provider返回空但物理集合非空、漏任一项或根在pre/provider/post间消失/换identity为`MANIFEST_ENTRY_INCOMPLETE`；额外项、outside路径、重复/错误relative或labels、错误length/hash/mtime/分类、ordinary文件变reparse或dangling reparse为`MANIFEST_ENTRY_INVALID`。两者都以外层`manifest_failed`进入errors并令scope未完成，禁止用部分entries继续形成PASS/diff。

provider对象必须通过单次深度clone的`manifest-provider-dto/v1`边界。core为全部scope共用一个引用身份seen registry；顶层result在读取字段前先登记，随后对每个到达的对象先只检查PS member元数据和名称集合，不求值任何成员。每个对象只允许该层预期名称的普通`NoteProperty`；缺失/额外成员按既有identity/entry错误拒绝，`ScriptProperty/CodeProperty/AliasProperty/PropertySet/ParameterizedProperty`及任何会执行getter、转发或动态求值的成员在读取其值之前稳定`MANIFEST_PROVIDER_DYNAMIC_MEMBER`并以外层`manifest_failed`拒绝。

成员元数据合格后，core按固定字段序对每个`NoteProperty.Value`**恰读取一次**到局部变量；若该值是引用类型，必须在把对应节点加入DTO之前先登记其引用身份，任一同scope不同位置或任何先前scope已登记的引用立即稳定`MANIFEST_RESULT_IDENTITY_REUSED`，不得clone该节点；value type/string除外。未复用的`roots`容器、每个root、`entries`容器、每个entry、每个`root_labels`容器及任一nested array/object都递归执行同一“先检查成员元数据、单次读值、先登记再clone”步骤，最终DTO只含core-owned array、value/string和纯`NoteProperty`对象。此后containment、physical length/hash/mtime、classification、diff和JSON全部只读取core DTO，绝不得再次访问provider对象或其collections。provider在clone后突变原array/object、替换entry或改变labels不能改变DTO；若突变同时改变physical root/文件，则fresh physical复核仍按`MANIFEST_ENTRY_INCOMPLETE/INVALID`失败。报告只保存`manifests.provider_dto={schema_version=manifest-provider-dto/v1,dynamic_members_rejected=true,nested_reference_reuse_checked=true,provider_objects_released=true}`，不得另建`provider_dto_version`近义字段。

core在调用`ReportPublisher`前必须为本轮每个预期artifact冻结`artifact_id/artifact_kind/temporary_path/requested_path/expected_sha256`；temp与final都只允许固定evidence根内、带同一`run_id`且互不相同的唯一目标，调用前两者都必须不存在。publisher返回失败、残缺或抛出时，core仍只对这组**预登记精确temp/final路径**执行no-follow存在性、大小和SHA复核，不得扫描目录或采用publisher返回的任意外部路径。final artifact规则保持：只有adapter恰一条published结果且final路径/hash与预期及core复核一致才为`published`；final实际存在但未确认则`partial_unconfirmed`，不存在则`not_published`；overall失败时JSON永不得published，已逐项确认raw不因overall失败自动降级。

publisher对任一record rename失败或异常后必须用§4.6 no-follow DELETE handle尝试清理该精确temp；publisher返回后core逐个独立复核，只在temp仍存在时再进行一次core cleanup attempt，不得扫描或采用新路径。最终`publication`唯一shape为`{status,artifacts[],temporary_artifacts[],evidence_residual_count}`；`temporary_artifacts[]`按artifact顺序恰一项，shape为`{artifact_id,temp_path,cleanup={attempted,succeeded,residual_count,error_type,error_text}}`。rename成功且temp不存在时`attempted=false,succeeded=true,residual_count=0`；rename失败后publisher或core任一实际cleanup使attempted=true，core最终复核不存在则succeeded=true/count0，仍存在则succeeded=false/count1。publisher/core cleanup原始错误都按顺序进入`errors[]`，cleanup error字段保存首个未恢复错误，不能因后一次删除成功抹去历史。`evidence_residual_count`等于预登记temp仍存在数量；大于0令overall failed且publication不得complete。status仅complete|partial|failed：overall成功、全部final published且residual0才complete；任一final或temp实际存在但未满足complete为partial；全部预登记temp/final均不存在才failed。

最终`publication.artifacts[]`的每项shape与adapter结果完全相同且不允许额外近义字段：`artifact_id,artifact_kind,requested_path,published_path,status,sha256,error_type,error_text`。`requested_path`只取core预登记final；文件存在时`published_path`固定等于该规范绝对路径、`sha256`只取core发布后从no-follow file handle读取实际字节得到的大写SHA-256，文件不存在时二者均为`null`。adapter path/hash只用于比较，绝不能原样信任或带入外部路径。`published`的error字段为null；其他状态保存adapter原始错误，缺失时由core分别写稳定`PUBLISHER_RESULT_UNCONFIRMED`或`PUBLISHER_ARTIFACT_NOT_PUBLISHED`。temp的路径和清理状态只进入`temporary_artifacts[]`，不得混入final artifact字段。

发布时序唯一如下：core先为每条raw从冻结bytes计算`expected_sha256`并连同唯一temp/final形成`raw_records[]`，同时预登记JSON唯一temp/final；再构造待序列化机器报告快照，其中`raw_paths/raw_sha256`使用预登记raw final/expected hash、`report_path`使用预登记JSON final，`artifact_plan.json_record.expected_sha256`固定为`null`，且不含最终publication、temporary cleanup结果或JSON自身hash。core用Depth32和UTF-8无BOM只序列化一次，从所得byte[]计算大写hash，再以同一预登记JSON temp/final、该实际hash和byte[]构造独立且不可变的publisher request `json_record`；不得回写报告快照中的null哨兵。随后只把`{json_record,raw_records[]}`交给publisher；publisher只按§4.6 CreateNew temp handle+单次FileRenameInfo写原字节，不得接收/读取/重序列化report。调用结束后，core逐项复核final、清理并复核temp，再重建最终内存`raw_paths/raw_sha256/publication`。禁止用publisher后列表或temp cleanup结果回写已冻结JSON或第二次序列化。

最终内存报告和外层控制台/后置summary必须保存`publication.artifacts[]`全部预登记项目。`raw_paths[]/raw_sha256[]`列出所有实际存在且可哈希的raw项目，包括`partial_unconfirmed`，并保持同索引；不得因后续JSON失败清空已写raw记录。只有总体`complete`且机器JSON项目为`published`时，顶层`report_path`与out-of-band `json_sha256`才可非空；publisher失败时即使发现JSON临时/目标文件，也只能把它登记为`partial_unconfirmed`，顶层`report_path=null`、`json_sha256=null`，不得把它称为有效机器JSON。机器JSON是在最终publication结果产生前冻结的证据主体，因此不自称最终发布成功；最终`publication`只存在于core返回的内存报告和不被该JSON引用的外层控制台/后置summary中，以避免互哈希环。

### 6.2 Windows PowerShell 5.1 production runner契约

production `CommandRunner`必须自行实现CommandLineToArgvW兼容的参数序列化：逐参数处理空字符串、空格、双引号、反斜杠和尾随反斜杠，不能以简单`-join ' '`拼接。环境块从清空后的精确allowlist构造；进程以Win32 `CreateProcessW(CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT)`、显式application path和重定向pipe handles启动，不经shell。stdout/stderr必须以byte stream在进程运行期间并发、有界保留且持续drain；parent、job descendants与双流的所有等待都必须使用§6.1冻结超时/宽限期，不得调用无参数`WaitForExit()`、不得先同步读完一个流再读另一个流，也不得在Task为Faulted/Canceled或未完成时访问`.Result`。

测试可以启动系统自带的绝对`powershell.exe`临时argv回显脚本和大双流脚本，但不得调用npm、Node、Vitest、TypeScript、OpenClaw或网络。argv测试至少覆盖空参数、空格、嵌入引号、连续反斜杠和尾随反斜杠；`RED-PROCESS-002`的大双流介于1MiB与8MiB之间，要求两流bytes完整、truncated=false且固定超时内退出；超过8MiB、capture Faulted/Canceled、normal parent遗留后代及PID identity子变体统一放入既有`RED-PROCESS-003`，不新增顶层ID。

Job Object不是任意代码沙箱：它只限制本次冻结toolchain形成的进程树生命周期。production不得为执行任意caller executable而修改ACL、token、official目录权限或防病毒策略；命令可执行文件和工具entry必须先通过§4.7身份，job assignment完成前payload保持suspended。

机器JSON只能由core在publisher调用前显式使用`ConvertTo-Json -Depth 32 -Compress`或等价深度序列化一次并冻结进`json_record.bytes`。PS5.1回读后要验证`platform/runtime_identity.layout/dependency_trees/system_executables/tools/module_closure/native_execution_allowlist/policy_bootstrap/checks`、`roots.root_matrix/path_security.operations`、`commands[].staging_root/runtime_snapshot_root/module_resolution_roots/permission_model/node_runtime/execution_topology/path_operation_ids/environment_policy/process_identity/job_control/stream_capture/fault_injection`、`manifests.provider_dto/official/project_business_candidates/source_dist`、`openclaw_state.baseline/stage_observations/observed_business_candidates/pre_delete_audit`、`external_guards/test_seams/artifact_plan`、`temporary_roots[].physical_residual_entries`和`errors[]`深层字段未被字符串化或截断；A及四个non-plugin Node direct parent的clean-room keyset精确19，四plugin direct parent是在共同19上加4后精确23；这不伪造fork环境可见性。A permission disabled/exact argv，八Node的snapshot/permission/module/native/policy/topology逐命令等于§6。机器JSON只引用冻结command/raw与artifact plan，禁止互哈希环。

## 7. 外层 finally、环境与清理顺序

总生命周期的最外层`try/catch/finally`必须在**EnvironmentAdapter before snapshot、Clock start、runtime/root preflight、before manifest和任何临时目录创建之前**建立；不存在“before snapshot成功后才进入outer try”的旧边界。catch只登记原始错误，不能立即`exit`。finally的每个编号阶段以及阶段内部各adapter/Clock调用都必须有独立`try/catch`，返回null、错误shape、错误类型、异常或Clock非`DateTimeOffset`只能追加原始错误并把对应字段标为未验证，绝不能截断后续阶段。即使before environment、start Clock或任一before manifest是首个抛错/畸形对象，也必须继续尽力执行全部finally阶段及publisher。finally固定执行：

1. 用只读`EnvironmentAdapter`取得调用者环境after快照，与before快照比较；core及runner全程不得写调用者环境，二者相等时把兼容Oracle`environment.restored`记为`true`，不相等或无法复核时失败关闭；
2. 对 OpenClaw 根执行唯一一次`openclaw_pre_delete_audit`全文件权威审计，并生成OpenClaw临时根行的fresh摘要引用；
3. 分别对 isolated-test、validation、build 三根执行独立删除前审计；四类临时根行至此都必须有审计或摘要，禁止再次扫描OpenClaw；
4. **在validation root cleanup之前**执行§4.7 `finally_before_cleanup`：确认全部parent/Job descendants已退出，保持snapshot/staging immutable handles不释放，从handles及fresh tree重算source-v1、snapshot-v2、942 junction、module/native closure与Q/journal identity并冻结check。检查失败仍记录并继续cleanup；完成该check后才按固定顺序关闭这些immutable handles。禁止把缺失snapshot当作成功或把本阶段延后；
5. 对四根逐一尝试cleanup；每根adapter异常/错误独立保留，前一根失败不得阻止后三根，清理错误不得覆盖先发生的命令错误；validation cleanup必须发生在第4阶段check与handle release之后；
6. 对每个根独立执行§4.6 no-follow physical residual扫描并写`physical_residual_entries[]/physical_residual_count`；不得只调用`Test-Path`或信adapter，扫描本身失败也继续下一根；
7. 分别生成三个固定data根的official after观察及固定project/A/B/C范围的project-business-candidates after manifest，比较added/modified/deleted并生成B/C源码`dist`全文件after/diff；再执行`source_final_after_cleanup`，只fresh复核source-v1并要求snapshot fields为null、`snapshot_check_applicable=false`，绝不访问已删除snapshot。最后best-effort调用Clock冻结待发布快照的`finished_at`；manifest、source终检或Clock任一失败进入verdict但不阻止publication，Clock错误时`finished_at=null`；
8. 在finally内部依次做publication preparation、调用Publisher、publication review/temp cleanup；三小段各自独立catch。preparation冻结带唯一temp/final的`raw_records[]/json_record`，publisher只能写冻结bytes并handle-rename；review按§6.1对全部预登记temp/final逐项no-follow复核、清理temp并冻结`publication.artifacts/temporary_artifacts/evidence_residual_count`。任一小段失败仍保留此前错误和可确认raw，temp residual令partial/failed，未确认JSON不得伪称有效机器报告。禁止在finally结束后另行publisher、目录扫描或第二次序列化；
9. 聚合全部阶段错误和publication review结果，完成最终内存verdict/exit并返回；不得在publisher后再次调用Clock、修改已冻结JSON字段或重新抛出先前阶段异常。

before/after快照必须覆盖整个Process环境并在内存中逐键比较；报告只保存键名集合、逐值hash和整体fingerprint，不得保存敏感原值。至少单独断言调用前`OPENCLAW_STATE_DIR`的存在性/值hash在调用后相同。实现若需要修改`PATH`、`NODE_PATH`、`TEMP`或任何其他调用者环境变量，属于契约违例，必须改为只把child-only值写入§6.2从空集合生成的Unicode environment block；不得通过“事后恢复”掩盖宿主环境写入。

OpenClaw 删除前 audit 发现匹配 §5 的业务类文件时，即使随后删除成功也必须失败；普通配置/缓存文件可以存在，但必须进入审计清单。临时根清理失败或删除后仍存在任何根，本身就是失败。

## 8. 机器 JSON 与原始证据契约

报告最小结构固定为：

```json
{
  "schema_version": "foundation-safety-report/v1",
  "schema_contract_status": "first_formal_authoritative_v1",
  "task_id": "SH-SAFE-BASE-001",
  "run_id": "guid",
  "started_at": "ISO-8601 with offset",
  "finished_at": "ISO-8601 with offset",
  "verdict": "passed|failed",
  "exit_code": 0,
  "platform": {
    "windows": { "version": "actual Windows version" },
    "powershell": {
      "version": "actual PowerShell version",
      "executable_path": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    }
  },
  "runtime_identity": {
    "schema_version": "runtime-identity/v1",
    "canonical_tree_versions": {
      "source": "canonical-tree-v1",
      "snapshot": "canonical-tree-v2"
    },
    "temporary_parent": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-shared",
    "layout": {
      "dependency_source_roots": {
        "node_root": "absolute frozen node root",
        "tool_modules_root": "absolute frozen C node_modules",
        "pnpm_root": "absolute frozen C .pnpm",
        "typebox_root": "absolute frozen C physical typebox target"
      },
      "runtime_snapshot": {
        "root": "absolute validation runtime-snapshot",
        "node_root": "absolute snapshot node",
        "pnpm_root": "absolute snapshot pnpm",
        "policy_module_path": "absolute snapshot foundation-node-policy.mjs",
        "policy_module_url": "canonical absolute file URL"
      },
      "protected_external_paths": {
        "jiti_openclaw_cache_guard": "absolute actual guard",
        "node_compile_cache_guard": "absolute actual guard",
        "inherited_openclaw_temp_guard": "absolute actual guard",
        "vitest_b_cache_guard": "absolute actual guard",
        "vitest_c_cache_guard": "absolute actual guard"
      }
    },
    "environment_paths": {
      "DIET_MANAGER_NODE": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe",
      "DIET_MANAGER_TOOL_MODULES": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules",
      "DIET_MANAGER_OPENCLAW_ENTRY": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\openclaw\\openclaw.mjs"
    },
    "dependency_trees": {
      "source_node_root": {
        "path": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0",
        "canonical_tree_version": "canonical-tree-v1",
        "file_count": 1807,
        "reparse_count": 0,
        "total_bytes": 103552528,
        "tree_sha256": "AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61"
      },
      "source_pnpm_root": {
        "path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm",
        "canonical_tree_version": "canonical-tree-v1",
        "file_count": 34624,
        "reparse_count": 942,
        "total_bytes": 628929762,
        "tree_sha256": "7E85740744869D460D7B4B8F1E9B3C8811698B11DCBF1F8A89726644A1E94055",
        "reparse_targets_existing": 942,
        "reparse_targets_within_root": 942
      },
      "snapshot_node_root": {
        "path": "absolute snapshot node root",
        "canonical_tree_version": "canonical-tree-v2",
        "file_count": 1807,
        "reparse_count": 0,
        "total_bytes": 103552528,
        "tree_sha256": "AC34E5C8473600D6540763EBCC7AFCB6E59CE861122C59C1FD381C744CB29D61"
      },
      "snapshot_pnpm_root": {
        "path": "absolute snapshot pnpm root",
        "canonical_tree_version": "canonical-tree-v2",
        "file_count": 34624,
        "reparse_count": 942,
        "total_bytes": 628929762,
        "tree_sha256": "14E884759CD8BF088CE024809D53ACCA4DA256BE6E9E142B541798DEA05BB8BE",
        "canonical_line_count": 35566,
        "junction_targets_existing": 942,
        "junction_targets_within_snapshot": 942
      }
    },
    "system_executables": {
      "a_structure": {
        "configured_entry_path": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "physical_entry_path": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "script_path": "absolute A validation script",
        "arguments": ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "absolute A validation script"],
        "length": 454656,
        "entry_sha256": "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5",
        "file_version": "10.0.26100.8875",
        "product_version": "10.0.26100.8875"
      }
    },
    "tools": {
      "node": {
        "version": "24.15.0",
        "source_configured_entry_path": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe",
        "source_physical_entry_path": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe",
        "execution_entry_path": "absolute snapshot node.exe",
        "entry_sha256": "3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5"
      },
      "vitest": {
        "version": "2.1.9",
        "source_configured_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\vitest\\vitest.mjs",
        "source_physical_target_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\vitest@2.1.9_@types+node@26.2.0\\node_modules\\vitest",
        "source_physical_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\vitest@2.1.9_@types+node@26.2.0\\node_modules\\vitest\\vitest.mjs",
        "execution_target_path": "absolute snapshot vitest target",
        "execution_entry_path": "absolute snapshot vitest.mjs",
        "entry_sha256": "39DB22F579ACF5639BBB17A261408DEBBDE03F4692C0C439E77E7F13AEBA74D6",
        "file_count": 117,
        "reparse_count": 0,
        "total_bytes": 1661189,
        "tree_sha256": "984D2C82CDCCBFEC623D3CD9F8B9F9F8272BCF49F95467D416B9F90E87F19B2D"
      },
      "typescript": {
        "version": "5.9.3",
        "source_configured_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\typescript\\bin\\tsc",
        "source_physical_target_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\typescript@5.9.3\\node_modules\\typescript",
        "source_physical_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\typescript@5.9.3\\node_modules\\typescript\\bin\\tsc",
        "execution_target_path": "absolute snapshot typescript target",
        "execution_entry_path": "absolute snapshot tsc",
        "entry_sha256": "8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0",
        "file_count": 138,
        "reparse_count": 0,
        "total_bytes": 23633942,
        "tree_sha256": "EC174E8071027E8828402C337BA0FA22AF7491B799DC3E935AB6811300CCBD4F"
      },
      "openclaw": {
        "version": "2026.7.1",
        "source_configured_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\openclaw\\openclaw.mjs",
        "source_physical_target_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\openclaw@2026.7.1\\node_modules\\openclaw",
        "source_physical_entry_path": "E:\\codx\\skill\\饮食管家\\version-c-strict-plugin\\node_modules\\.pnpm\\openclaw@2026.7.1\\node_modules\\openclaw\\openclaw.mjs",
        "execution_target_path": "absolute snapshot openclaw target",
        "execution_entry_path": "absolute snapshot openclaw.mjs",
        "entry_sha256": "F643B005D6DB233A0B45204E8D8E943256874CCC6897B8A6E0CF42A9B376A188",
        "file_count": 8589,
        "reparse_count": 0,
        "total_bytes": 87743888,
        "tree_sha256": "1EE99B0F9B9E3AFA49CB555B0E0406D8617D0231E75006788B10AE66C6D5E10C"
      }
    },
    "module_closure": {
      "vitest": { "reachable_packages": 93, "manifest_edges": 127, "required_gap_count": 0, "c_top_edge_count": 0, "missing_optional_peer_count": 13 },
      "typescript": { "reachable_packages": 1, "manifest_edges": 0, "required_gap_count": 0, "c_top_edge_count": 0, "missing_optional_peer_count": 0 },
      "openclaw": { "reachable_packages": 306, "manifest_edges": 461, "required_gap_count": 0, "c_top_edge_count": 0, "missing_optional_peer_count": 10 },
      "staging_typebox": { "reachable_packages": 1, "manifest_edges": 0, "required_gap_count": 0, "c_top_edge_count": 0, "missing_optional_peer_count": 0 }
    },
    "native_execution_allowlist": {
      "snapshot_node_executable": { "relative_path": "node\\node-v24.15.0-win-x64\\node.exe", "length": 91694408, "sha256": "3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5" },
      "vitest_addon": { "relative_path": "pnpm\\@rollup+rollup-win32-x64-msvc@4.62.4\\node_modules\\@rollup\\rollup-win32-x64-msvc\\rollup.win32-x64-msvc.node", "length": 2623488, "sha256": "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49" },
      "vitest_child": { "relative_path": "pnpm\\@esbuild+win32-x64@0.21.5\\node_modules\\@esbuild\\win32-x64\\esbuild.exe", "length": 9913856, "sha256": "B868C8D988FFE76006C03C91F856312C312E42E2F3932A6BB56D7F4A1790C8B3" },
      "typescript_native_count": 0,
      "openclaw_plugin_native_count": 0,
      "actual_loaded_addons": [],
      "conditional_denied": [{ "relative_path": "pnpm\\sqlite-vec-windows-x64@0.1.9\\node_modules\\sqlite-vec-windows-x64\\vec0.dll", "length": 289280, "sha256": "FCF98662A7AD9DCE394B96A88F91032047823831B951C76636787C312A6476E6" }]
    },
    "policy_bootstrap": {
      "schema_version": "foundation-trusted-policy/v2",
      "path": "absolute snapshot foundation-node-policy.mjs",
      "module_url": "canonical absolute file URL",
      "line_count": 1065,
      "length": 43267,
      "sha256": "C0C0E478D19C2D3473D165318EEAB689DF0C34E69D8784A8C6B3D0119319D25D",
      "ascii_only": true,
      "derived_node_prefixes": [],
      "network_hook_set": [],
      "network_not_present": [],
      "network_self_tests_passed": true,
      "sqlite_controls": {
        "cjs_esm_exports_synchronized": true,
        "native_constructor_private": true,
        "public_prototype_constructor_guarded": true,
        "native_prototype_constructor_guarded": true,
        "allow_extension": false,
        "defensive": true,
        "attach_limit": 0,
        "authorizer_attach_denied": true,
        "backup_denied": true,
        "sql_guarded_entry_points": ["exec", "prepare"],
        "self_tests_passed": true
      },
      "child_invocation_policy": {
        "roles": ["vitest_single_fork", "snapshot_node_helper", "esbuild"],
        "prototype_spawn_one_shot": true,
        "vitest_staging_env_files": 0,
        "vite_user_env": {},
        "vitest_config_env": {},
        "fork_environment_layers": {
          "incoming_request_env": "parent19+five+BASE_URL/MODE/DEV/PROD",
          "q_supplied_env": "parent19+five",
          "source_derived_createprocess_env": "q supplied+NODE_CHANNEL_FD/NODE_CHANNEL_SERIALIZATION_MODE",
          "bootstrap_visible_env": "child Q observed parent19+five"
        },
        "fork_ipc_derivation": { "effective_stdio": ["pipe", "pipe", "pipe", "ipc"], "fd": "3", "serialization": "json", "observed": false },
        "source_derived_node_options_by_role": {
          "vitest_single_fork": null,
          "snapshot_node_helper": null,
          "esbuild": "canonical permission flags"
        },
        "sync_esbuild_forbidden": true
      },
      "addon_policy": {
        "exact_two_argument_dlopen": true,
        "accepted_path_kinds": ["ordinary_drive", "namespaced_drive"],
        "native_original_path_passthrough": true,
        "allowed": [{ "relative_path": "pnpm\\@rollup+rollup-win32-x64-msvc@4.62.4\\node_modules\\@rollup\\rollup-win32-x64-msvc\\rollup.win32-x64-msvc.node", "length": 2623488, "sha256": "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49" }],
        "actual_loaded": []
      },
      "policy_ready": [],
      "spawn_intents": [],
      "spawn_results": [],
      "addon_loads": [],
      "installed_fail_closed": true
    },
    "checks": []
  },
  "roots": {
    "project_root": { "path": "absolute project", "path_identity": { "volume_serial": "hex", "file_id": "hex" } },
    "evidence_root": { "path": "absolute evidence", "path_identity": { "volume_serial": "hex", "file_id": "hex" } },
    "temporary_parent": { "path": "absolute frozen parent", "path_identity": { "volume_serial": "hex", "file_id": "hex" } },
    "official_data_roots": [],
    "writable_roots": [],
    "root_matrix": { "validated": true, "relationships": [] }
  },
  "path_security": {
    "schema_version": "windows-handle-pin/v1",
    "immutable_input_share_mode": ["FILE_SHARE_READ"],
    "writable_parent_share_mode": ["FILE_SHARE_READ", "FILE_SHARE_WRITE"],
    "share_write_for_immutable_inputs": false,
    "share_delete_for_all_pins": false,
    "operations": []
  },
  "environment": {
    "policy": "clean_room_exact_allowlist",
    "command_profiles": [],
    "mutation_attempted": false,
    "caller_unchanged": true,
    "restored": true,
    "verification_status": "verified",
    "before_fingerprint": "SHA-256",
    "after_fingerprint": "SHA-256"
  },
  "commands": [],
  "manifests": {
    "provider_dto": {
      "schema_version": "manifest-provider-dto/v1",
      "dynamic_members_rejected": true,
      "nested_reference_reuse_checked": true,
      "provider_objects_released": true
    },
    "official": {
      "before": {
        "schema_version": "official-state-observation/v1",
        "scope_id": "official_before",
        "completed": true,
        "coverage_complete": true,
        "state_digest": "UPPER_SHA256",
        "roots": [],
        "entries": []
      },
      "after": {
        "schema_version": "official-state-observation/v1",
        "scope_id": "official_after",
        "completed": true,
        "coverage_complete": true,
        "state_digest": "UPPER_SHA256",
        "roots": [],
        "entries": []
      },
      "diff": { "added": [], "modified": [], "deleted": [] }
    },
    "project_business_candidates": {
      "before": {
        "scope_id": "project_business_candidates_before",
        "completed": true,
        "roots": [],
        "entries": []
      },
      "after": {
        "scope_id": "project_business_candidates_after",
        "completed": true,
        "roots": [],
        "entries": []
      },
      "diff": { "added": [], "modified": [], "deleted": [] }
    },
    "source_dist": {
      "B": {
        "path": "absolute B source dist",
        "before": { "scope_id": "source_dist_B_before", "entries": [] },
        "after": { "scope_id": "source_dist_B_after", "entries": [] },
        "diff": { "added": [], "modified": [], "deleted": [] }
      },
      "C": {
        "path": "absolute C source dist",
        "before": { "scope_id": "source_dist_C_before", "entries": [] },
        "after": { "scope_id": "source_dist_C_after", "entries": [] },
        "diff": { "added": [], "modified": [], "deleted": [] }
      }
    }
  },
  "openclaw_state": {
    "baseline": {
      "completed": true,
      "entries": [],
      "error_code": null,
      "error_type": null,
      "error_text": null
    },
    "stage_observations": [],
    "observed_business_candidates": [],
    "pre_delete_audit": {
      "completed": true,
      "entries": [],
      "business_entries": [],
      "internal_state_entries": [],
      "other_entries": [],
      "business_candidate_count": 0,
      "openclaw_internal_tool_state_count": 0,
      "other_count": 0,
      "error_type": null,
      "error_text": null
    },
    "cleanup": {}
  },
  "external_guards": {
    "layout_source": "runtime.protected_external_paths",
    "entries": []
  },
  "temporary_roots": [],
  "test_seams": {
    "process_fault_injector_active": false,
    "path_phase_observer_active": false
  },
  "artifact_plan": {
    "json_record": {
      "artifact_id": "machine_json",
      "artifact_kind": "machine_json",
      "temporary_path": "absolute preregistered JSON temp",
      "requested_path": "absolute preregistered JSON final",
      "expected_sha256": null
    },
    "raw_records": [
      {
        "artifact_id": "raw artifact id",
        "artifact_kind": "raw",
        "temporary_path": "absolute preregistered raw temp",
        "requested_path": "absolute preregistered raw final",
        "expected_sha256": "UPPER_SHA256"
      }
    ]
  },
  "business_impact": {
    "official_added": 0,
    "official_modified": 0,
    "official_deleted": 0,
    "project_candidate_added": 0,
    "project_candidate_modified": 0,
    "project_candidate_deleted": 0,
    "temporary_business_candidate_count": 0,
    "openclaw_business_candidate_count": 0,
    "openclaw_transient_business_candidate_count": 0
  },
  "errors": []
}
```

`foundation-safety-report/v1`是本设施**首个正式权威v1**；此前测试脚本中的草案对象从未发布为权威报告，不是兼容契约、迁移输入或可接受的旧schema。production不得为了兼容草案省略本节字段、读取近义字段或输出第二个v1变体。

`platform`顶层只使用`windows={version}`和`powershell={version,executable_path}`。`runtime_identity.layout`保存source/guard与derived snapshot；`system_executables.a_structure`保存A identity/argv；`tools`把source与snapshot execution分列。`dependency_trees/module_closure/native_execution_allowlist/policy_bootstrap`逐值保存v1/v2、required/optional/native、actual addon与Q的prefix/hook/self-test/journal。`checks[]`shape为`{phase,command_id,matched,error_code,source_tree_sha256,snapshot_tree_sha256,pinned_input_count}`，phase只允许`source_start|snapshot_ready|before_command|after_command|finally_before_cleanup|source_final_after_cleanup`；前五种保存fresh source/snapshot/closure，最后一种snapshot字段必须为null且只复核source-v1，不伪造未到达项。

`roots`保存project/evidence/temporary parent、三个official及四writable root的path/PathIdentity和完整matrix；runtime snapshot作为validation的精确登记后代另存于runtime layout。`path_security.operations[]`每项唯一shape为`{operation_id,operation_kind,phase,pinned_paths[],immutable_input_count,share_write,share_delete,handle_bound,succeeded,error_code}`；operation_kind只允许`runtime_source_read|runtime_snapshot_create|runtime_snapshot_read|manifest_read|root_create|staging_copy|command_launch|evidence_publish|cleanup_dispose|residual_scan`，phase只允许`pin|use|complete`。`pinned_paths[]`每项为`{path,volume_serial,file_id,attributes,share_write,share_delete}`；immutable leaf的share_write/delete均false，writable parent只share_write=true，所有share_delete恒false。必须覆盖source/snapshot/manifest、root create、staging、command inputs、evidence及cleanup/residual。`temporary_roots[]`每项唯一包含`root_id,path,trusted_parent,path_identity,pre_delete_audit,cleanup,physical_residual_entries[],physical_residual_count`；cleanup保留adapter原始返回，兼容residual_count必须等于physical count。

`environment.command_profiles[]`每项唯一shape为`{command_id,route,stage,write_root,root,home,appdata,localappdata,temp,attestation_root,audited_before_cleanup,cleanup_root_id}`；`root`必须等于`<write_root>\environment\<command_id>`，其余路径必须等于§6冻结后代，`write_root`对test/build/plugin分别只能是`V_r/B_r/O`，并逐项与该命令唯一`permission_model.fs_write_roots[]`相符。`parent_environment.exact_key_values[].source`只能采用§6的五个标签；profile与attestation都必须出现在所属既有根的删除前audit、cleanup和physical residual证据中。

每个`commands[]`对象必须有command ID、route、stage、cwd、physical executable/arguments、`staging_root/runtime_snapshot_root/module_resolution_roots[]/permission_model/node_runtime/execution_topology/path_operation_ids[]`、`environment_policy.inherit_environment=false`、上述`profile`、`parent_environment`完整exact key/value/source、`derived_child_environment={authority,caller_values_allowed,incoming_request_env,q_supplied_env,source_derived_createprocess_env,bootstrap_visible_env,observations[]}`、时间/status/timeout/exit/raw/exception，以及§6.1 process/job/stream/taskkill/termination。四个environment层分别保存key/value digest、证据种类与`observed`；fork另保存effective stdio、source-derived IPC fd/serialization及child policy-ready关联，明确不把CreateProcess层写成Q观察到的actual OS environment。`path_operation_ids[]`引用本命令executable/script/staging/snapshot/permission roots对应operations，不得悬空。A的staging/snapshot为null、module/permission/node-runtime arrays空、能力全false且argv精确；八Node保存snapshot entry、permission/read/write、`--no-global-search-paths`、`--import=<Q_u>`、Q path/URL/hash、完整`derived_node_prefix[]`与四能力，四plugin另保存`--stack-size=8192`。B/C test精确forks/singleFork/no-file-parallelism、allow_child/addons=true且worker/WASI=false，其他六条child/addons/worker/WASI均false；test还保存role-specific spawn journal、policy-ready、actual addon、completion telemetry与Job accounting。任何source/live path不得出现。不得维护近义字段；fail-fast后未执行命令仍完整skipped。

`manifests.provider_dto`只允许§6.1四个固定字段；每个scope另保存其DTO validation result/error，不得把provider原对象序列化。`openclaw_state.observed_business_candidates[]`与两个final/transient count按§5精确保留。`external_guards.entries[]`恰五项，每项shape为`{guard_id,path,before,after,diff}`，guard_id采用Runtime五个固定键，before/after为全文件观察、diff含added/modified/deleted；`layout_source=runtime.protected_external_paths`，fixture报告不得含production guard路径。`test_seams`在production两个bool恒false，direct test按实际active值写入，不能隐去seam。

`artifact_plan`在JSON冻结前保存预登记计划；`json_record`唯一shape为`{artifact_id,artifact_kind,temporary_path,requested_path,expected_sha256=null}`，null是防止自哈希环的固定哨兵，`raw_records[]`每项唯一shape为`{artifact_id,artifact_kind,temporary_path,requested_path,expected_sha256=<UPPER_SHA256>}`，两者都不得含bytes。序列化后交给publisher的request `json_record`是独立core-owned DTO：前四项与计划逐值相同，`expected_sha256`换成刚从冻结JSON bytes计算的实际大写hash并新增同一冻结`bytes`；这不会改变已序列化报告。最终内存/后置summary另按§6.1保存`publication.artifacts/temporary_artifacts/evidence_residual_count`；它们不回写本JSON。

每个故障测试结果必须直接采用总计划§24.5的八个精确键：`failure_injection_point`、`pre_state_hash`、`expected_error_code`、`should_rollback`、`post_state_hash`、`state_after_restart`、`same_key_retry_result`、`official_business_data_diff`；不得维护近义字段。另存`observed_error_code`与`after_manifest_generated`用于核对。对本验证设施不适用的`should_rollback/state_after_restart/same_key_retry_result`写`NA`，并在`field_na_reasons`逐键写`not_business_transaction_or_restart_or_idempotency_test`；pre/post hash必须分别直接来自同一轮`official_before/official_after`的规范`state_digest`，一般场景使用同一组预置正式fixture，ROOT-005严格采用§5.1且不得通过受阻junction取Oracle；`official_business_data_diff`仍只引用official三数组，project候选diff固定保存在`manifests.project_business_candidates.diff`和`business_impact.project_candidate_*`，不得混写或省略。

`errors[]`按发生顺序保存原始command、manifest、environment、audit、cleanup和report错误；primary不被覆盖。raw/JSON使用run_id唯一命名及预登记temp/final，禁止覆盖。core最终内存报告另含§6.1唯一`publication={status,artifacts[],temporary_artifacts[],evidence_residual_count}`；该字段及最终发布/cleanup错误由外层控制台或后置summary冻结，不要求也不得回写已发布机器JSON。

机器JSON必须填入 §28.1 在执行时已经存在的适用证据字段：

- Asia/Shanghai 的 started/finished 时间；
- `task_ids[]`、实际局部 `case_ids[]`、REQ、RISK、DEC、DEBT；
- validator/core/tests/contract 的 SHA-256；
- 实际Windows/PowerShell版本与A.structure冻结exe/脚本/argv身份；Node `24.15.0`、Vitest `2.1.9`、TypeScript `5.9.3`、OpenClaw `2026.7.1`的source配置/physical与snapshot execution路径、source-v1/snapshot-v2 tree、942重写junction、闭包/optional peers、trusted policy v2 bytes/hash/hook/sqlite/child/addon字段及全部fresh checks；
- 九个完整命令、staging cwd、逐命令snapshot/module/Node permission/runtime-policy roots与完整derived prefix、Vitest forks/singleFork/no-file-parallelism、逐命令profile及write-root containment、role-specific incoming/Q-supplied/source-derived/bootstrap-visible environment与NODE_OPTIONS、policy-ready/spawn/addon journal、best-effort completion与Job Total/Active对账、exit/route results，以及process PID start identity、Job Object生命周期、8MiB stream和termination结果；
- project/evidence/frozen temporary parent、official/isolated/validation/build/OpenClaw roots、PathIdentity、handle-pin operations及完整root matrix；
- official-state before/after roots、entries、coverage、digest和diff；project-business-candidates before/after四根、entries、分类和diff；B/C source-dist全文件before/after/diff；
- OpenClaw真实baseline、四stage、累计observed/transient业务候选和唯一权威audit；四根cleanup及core独立physical residual；Manifest DTO验证；
- 子进程clean-room exact keyset、调用者环境前后不变结果和明确业务影响；
- 五guard实际layout与diff、seam active状态、raw路径/hash、每artifact预登记temp/final计划及机器JSON自身`report_path`；机器JSON hash与最终temp cleanup/residual只在发布后out-of-band登记；
- 执行者、`review_required: true`；不得预填尚未发生的独立复核者或复核时间。

独立复核完成后另建EV-v2，引用冻结机器JSON/raw的路径和hash，并在EV中填写`independent_reviewer`、`independent_reviewed_at`、结论与证据边界；禁止回写已冻结机器JSON。

当前目录不是 Git 仓库时使用关键文件 SHA-256，不得伪造 commit hash。

## 9. 可执行 RED 测试矩阵

`shared/tests/validate-data-manifests.ps1` 必须以一个临时项目 fixture 运行 core：在 fixture 的 A/B/C data 根预置稳定字节，使用 fake command/cleanup adapters，并在测试自身 finally 中清除 fixture。每一行必须单独输出稳定 test ID、PASS/FAIL 和失败详情。整个RED/GREEN PowerShell测试层**不得启动npm、Node、Vitest、TypeScript或OpenClaw**；它只复核private snapshot构造算法、canonical bytes/hash、policy bootstrap exact ASCII bytes/hash、command specs/fork topology/fake results及真实Windows handle/Job helper。Node/工具可执行性、Permission传播和policy实际加载唯一在Task5真实层观察，不得把fake结果写成`ERR_ACCESS_DENIED`或网络沙箱证据。

| Test ID | 输入/故障注入 | 必须断言 |
| --- | --- | --- |
| `RED-ROOT-001` | 正常test-owned sibling temp；temp位于fixture project/data/evidence；UNC/device；poison caller TEMP；production Runtime env/layout精确或错误；fixture三system guards/两route guards布局 | production完整Runtime逐项等于§4.4且caller TEMP不影响。fixture Runtime同shape，三system guard恰在fixture.guard_parent下为兄弟、B/C Vitest guard在fixture routes；报告只含实际fixture layout且production五guard零访问。非法temp/layout稳定`PATH_ROOT_RELATION_INVALID`、UNC/device为`PATH_OUTSIDE_ALLOWED_ROOT`，零创建/命令；入口无Runtime/TestMode/seam开关 |
| `RED-ROOT-002` | `..` 穿越 | `PATH_TRAVERSAL_REJECTED`；外部目录零写；after guard scan 和 JSON 仍生成 |
| `RED-ROOT-003` | 绝对外部路径、UNC 或盘符切换 | `PATH_OUTSIDE_ALLOWED_ROOT`；外部目录零写 |
| `RED-ROOT-004` | `data` 对 `data-evil` 前缀碰撞 | containment 为 false；不得误判为允许路径 |
| `RED-ROOT-005` | A data预置/observer前真实junction race；`root_after_pin_before_create`尝试rename/delete parent并换junction；`runtime_snapshot_after_input_pin_before_launch`对snapshot ordinary file尝试in-place overwrite后还原；dangling reparse祖先 | official变体仍A blocked/unobserved、B/C扫描、`OFFICIAL_BASELINE_UNAVAILABLE`且九命令skipped，Oracle不经junction。ancestor rename/delete或immutable file WRITE被share拒绝，或operation稳定`PATH_IDENTITY_CHANGED/PATH_OPERATION_FAILED`；不得声称directory pin阻止新增，新增由fresh tree失败。绝不释放pin后继续，dangling只作leaf，physical target集合/长度/hash零变化；after_manifest_generated按§5.1.5 |
| `RED-ROOT-006` | 伪造 official-root 环境变量 | 生产解析明确拒绝或完全不采用；报告仍只有固定三根 |
| `RED-MANIFEST-001` | §5全部15种扩展及大小写变体，其中`version-c-strict-plugin\dist\must-scan.SQLITE-WAL`为唯一dist候选 | official before/after对该dist路径的entry数均为0；project-business-candidates before/after对该规范路径各恰为1、`candidate_kind=sidecar`且去重后的`root_labels`含`project_root`与`route_C`；`source_dist.C`全文件before/after对该路径各恰为1；三个scope对象互不引用，普通node_modules候选为0 |
| `RED-MANIFEST-002` | A预置JSONL/JSONL journal；B预置SQLite/WAL/SHM；C预置DB/journal | 成功运行前后path/size/hash/mtime完全一致；official、project-business-candidates及B/C source-dist各自diff三数组均空且覆盖完成 |
| `RED-MANIFEST-003` | fake runner修改已有JSONL | official与project-business-candidates的`modified`均精确列出同一目标；verdict failed；两个after对象均存在且不可互相替代 |
| `RED-MANIFEST-004` | fake runner新增`.sqlite-wal` | official与project-business-candidates的`added`均精确列出sidecar；project稳定错误码进入`errors[]`；verdict failed |
| `RED-MANIFEST-005` | fake runner删除`.db-journal` | official与project-business-candidates的`deleted`均精确列出sidecar；project稳定错误码进入`errors[]`；verdict failed |
| `RED-MANIFEST-006` | provider抛错、漏/多/outside/错误字段；顶层或nested roots/root/entries/entry/root_labels引用在同scope或跨scope复用；ScriptProperty/CodeProperty/AliasProperty getter；clone后provider mutation；root消失/换identity/reparse | 外层均`manifest_failed`；nested reuse=`MANIFEST_RESULT_IDENTITY_REUSED`，动态成员在getter执行前=`MANIFEST_PROVIDER_DYNAMIC_MEMBER`，漏/root消失=`MANIFEST_ENTRY_INCOMPLETE`，多/物理/分类错误=`MANIFEST_ENTRY_INVALID`。core一次性构造纯NoteProperty DTO，之后不读provider；clone后mutation不改变DTO但physical变化仍失败，finally后续均执行 |
| `RED-FAIL-001` | `A.structure` 返回 41 | 原始 stderr、exit 41、after manifest、调用者环境前后相同、清理结果存在；预置 hash 不变 |
| `RED-FAIL-002` | `B.test` 返回 42 | 同上；后续命令以 skipped 出现在报告 |
| `RED-FAIL-003` | `B.build` 返回 43 | 同上；B/C source dist diff 为空 |
| `RED-FAIL-004` | `B.plugin_build_check` 返回 44 | 同上；OpenClaw 删除前 audit 已完成 |
| `RED-FAIL-005` | `B.plugin_validate` 返回 45 | 同上；C 后续命令为 skipped |
| `RED-FAIL-006` | `C.test` 返回 46 | 同上 |
| `RED-FAIL-007` | `C.build` 返回 47 | 同上；source dist diff 为空 |
| `RED-FAIL-008` | `C.plugin_build_check` 返回 48 | 同上；OpenClaw audit/cleanup 均有记录 |
| `RED-FAIL-009` | `C.plugin_validate` 返回 49 | 同上；九个 command objects 仍齐全 |
| `RED-BUILD-001` | fake build；A/script/argv、source env/junction、v1/v2/tool/closure/native突变；构造八Node snapshot/permission/module/policy specs；live roots放poison但fake不得读 | A exact七段argv；八Node只含staging/snapshot以及唯一完整`derived_node_prefix`，Q为`.mjs`且以`--import=<Q_u>`加载。B/C build profile与`TEMP/TMP/TMPDIR/HOME/USERPROFILE/APPDATA/LOCALAPPDATA`、attestation root全部严格位于对应`B_r`，write roots仍恰`[B_r]`且不含validation；test/plugin分别位于`V_r/O`。required gap/C_TOP/optional变为`RUNTIME_MODULE_CLOSURE_INVALID`；Rollup addon、esbuild与snapshot Node identity精确，仅test child+addons。poison只证spec无live路径；fresh checks阻止后续并保存v1/v2/closure/native/pins |
| `RED-BUILD-002` | B/C build 或 plugin 失败 | build/OpenClaw 根仍被审计和尝试清理，source dist 不变 |
| `RED-STAGING-001` | 构造B/C完整test-owned staging与fixture private snapshot，把八条Node specs交fake runner；source/destination含嵌套ordinary目录 | 八条cwd仅对应staging，executable/tool/package-local解析只指snapshot；staging唯一node_modules为ordinary typebox，1367文件/1468384 bytes/既有无F前缀摘要`BC1E4E...`。copier从immutable source handles到CreateNew destination；snapshot ordinary/reparse inputs在fake process operation保持READ-only pins；无live node_modules读取、其他包、Copy-Item、真实网络/Node或包管理器 |
| `RED-STAGING-002` | source C typebox缺失/篡改/内嵌reparse；冻结source `.pnpm` fixture含junction，重建snapshot并注入UNC/GLOBALROOT/device/外指/链式target；`staging_after_source_pin_before_copy`/`runtime_snapshot_after_input_pin_before_launch`尝试换parent或overwrite/restore leaf | typebox只从source C physical root复制，live B/C node_modules零打开；942 snapshot junction仅重写为snapshot内部target且v2 hash/35566 lines精确。非法target=`STAGING_DEPENDENCY_INVALID/RUNTIME_IDENTITY_INVALID`；observer对existing leaf WRITE/DELETE被拒绝或path error，目录新增只由fresh tree发现；finally仍完成、external target零变化 |
| `RED-CACHE-001` | 检查A/八Node specs，以fake runner回显environment/argv；逐字节复核Q exact ASCII `.mjs` bytes/hash并对policy DTO、hook名与fake journal做正反变体 | A exact argv/common19；八Node profile逐命令位于唯一write root，build attestation实际可由`[B_r]`覆盖且validation不在其write flags；四plugin=23。Permission→test child+addons→no-global→`--import=<Q_u>`→snapshot entry顺序精确。Q逐项含network、SQLite constructor/prototype、role child/prototype、sync esbuild、dlopen与actual load；spawn intent环境使用四层字段而无旧`requested/effective`近义字段，policy-ready保存actual bootstrap-visible层。RED不执行Node且不声称真实sandbox |
| `RED-CACHE-002` | 在fixture的jiti、node-compile-cache和继承openclaw-temp guard各预置sentinel并让fake plugin adapter返回成功 | 三guard before/after全部文件path/size/hash/mtime不变，diff全空；验证器不创建或清理guard；不启动真实Node/plugin |
| `RED-CACHE-003` | fake plugin仍向任一guard新增缓存文件 | 对应external guard `added`精确报告、overall failed；验证器不得删除新增文件来伪装零差异，测试finally再清fixture |
| `RED-CACHE-VITEST-001` | 检查B/C test specs；向staging注入`.env/.env.local/.env.production`，向Vite `userEnv`或`ctx.config.env`注值；fake fork提供filtered/poison execArgv、四Vite键、case alias、额外/缺失/异值键及direct prototype spawn | `.env*`或非空userEnv/config.env在fork前失败。合法incoming规范后恰28键：parent19+five+`BASE_URL=/,MODE=test,DEV=1,PROD=''`；同值case alias折叠，其他变体拒。Q丢四Vite键并供应24键；source-derived CreateProcess层恰再加`NODE_CHANNEL_FD=3/NODE_CHANNEL_SERIALIZATION_MODE=json`、stdio IPC槽3、observed=false、NODE_OPTIONS null；child policy-ready实际bootstrap-visible恰24键且两IPC键已消失。Q强制完整prefix/one-shot；不得把source-derived层写成Q观察到的actual OS env |
| `RED-CACHE-VITEST-002` | 为B/C既有`.vite/vitest`建立before/after全文件manifest | 成功、九阶段失败和真实Task5运行均零差异；任何新增/修改/删除使overall failed且验证器不清理依赖树 |
| `RED-ENV-NODE-001` | 调用者预置`NODE_OPTIONS/NODE_V8_COVERAGE/NODE_REDIRECT_WARNINGS/NODE_PATH/NODE_COMPILE_CACHE/NODE_COMPILE_CACHE_PORTABLE/ESBUILD_BINARY_PATH`、代理/证书/任意未来写路径；并令build validation root不可写但对应build root可写 | 八Node direct parent仍精确19键；profile的HOME相关键和TEMP三键逐命令位于唯一write root，B/C build Q fake attestation写入对应build root成功且不需validation write，audit/cleanup可见。fork四层分别28/24/26/24键，fork/helper NODE_OPTIONS null；esbuild q-supplied无NODE_OPTIONS、source-derived层恰多canonical permission NODE_OPTIONS且无bootstrap层。危险/额外键全拒，外部guards零差异，caller原值/存在性不变 |
| `RED-ENV-OPENCLAW-001` | 调用者预置`OPENCLAW_DIAGNOSTICS/OPENCLAW_DIAGNOSTICS_TIMELINE_PATH/OPENCLAW_RAW_STREAM_PATH/OPENCLAW_TEST_FILE_LOG`、任意`OPENCLAW_FUTURE_WRITE_PATH`和`JITI_FUTURE_WRITE_PATH` | fake runner收到的四个plugin environment键集合仍精确为23，只含四个冻结OpenClaw/JITI键，任意其他键不存在；所有外部sentinel零变化；调用者原值与存在性不变 |
| `RED-OPENCLAW-001` | plugin mock 在 OpenClaw 根创建 `cache.sqlite-wal` 后失败 | pre-delete audit 精确报告文件并使 verdict failed；随后根被删除；after manifest 存在 |
| `RED-OPENCLAW-002` | cleanup adapter 令 OpenClaw 删除失败 | primary command error 保留；追加 cleanup error；residual>0；调用者环境前后相同；verdict failed |
| `RED-OPENCLAW-003` | baseline预置普通log/内部state；四plugin创建内部/other；baseline/stage I/O/provider/reparse失败 | baseline真实all-files且任一非空追加`OPENCLAW_PREEXISTING_STATE`，preexisting不归因plugin；四ordered stage槽与最终唯一audit精确。观察失败=`OPENCLAW_STAGE_OBSERVATION_FAILED`并阻止下一plugin，未执行槽skipped，finally audit/cleanup仍运行 |
| `RED-OPENCLAW-004` | 非白名单候选、provider误分类；plugin stage创建`diet.sqlite`，成功stage观察后在最终audit前删除 | core每次重分类；stage曾见即保留于`observed_business_candidates`并追加`OPENCLAW_TRANSIENT_BUSINESS_CANDIDATE`，first/last stage、final_present=false、last hash/size和transient count精确，删除/cleanup不得改回通过。最终current count仍独立；误分类=`manifest_failed+MANIFEST_ENTRY_INVALID`，final-only固定为`post_command_unattributed/OPENCLAW_CREATION_STAGE_UNKNOWN` |
| `RED-TEMP-001` | 四根cleanup adapter失败/谎报0/遗留普通或reparse leaf/中途换identity；在validation/build/OpenClaw profile及`foundation-policy-attestations`留文件；分别让`finally_before_cleanup`与cleanup后source复核失败 | cleanup前fresh复核snapshot/closure/source；各profile/journal归属既有根的删除前audit且不产生第五根/外部guard，尤其两build journal只归build root。随后按handle协议清四根并独立residual；cleanup后snapshot字段null。任何遗漏profile、残留、pin/disposition/identity/phase错误失败，external target零变化 |
| `RED-ENV-001` | 调用前 `OPENCLAW_STATE_DIR` 存在并为 sentinel | 成功及九阶段失败后调用者值从未变化；fake plugin spec只含本轮受控值；`mutation_attempted=false`、`caller_unchanged=true`、兼容字段`restored=true` |
| `RED-ENV-002` | 调用前 `OPENCLAW_STATE_DIR` 不存在 | 成功、命令失败、清理失败后调用者Env项仍不存在；fake plugin spec仍得到本轮受控值 |
| `RED-ENV-003` | 只读`EnvironmentAdapter`仅在after snapshot返回失败 | `environment.verification_status=failed`、`caller_unchanged=null`、`restored=null`、稳定`environment_snapshot_failed`；after manifest和cleanup仍完成，overall failed；不得尝试写宿主环境 |
| `RED-REPORT-001` | 成功运行 | PS5.1 `ConvertFrom-Json` 可解析；九个 command objects 与逐命令 exit 齐全 |
| `RED-REPORT-002` | stderr 包含引号、换行和运行时生成的非 ASCII 字符 | raw 字节和 SHA 可复核；JSON 不丢原始 exception；cleanup 不覆盖 primary error |
| `RED-REPORT-003` | 首命令+cleanup失败；另让outer try前置的before EnvironmentAdapter、start Clock、root/runtime或before manifest首个调用抛错/畸形，并覆盖各finally adapter错误 | outer try在所有前置调用前已建立；每个错误按发生顺序保留且不覆盖primary。前置失败仍尽力执行after snapshot/audits/after scopes，随后在validation root存在且handles持有时执行`finally_before_cleanup` source/snapshot/closure复核，才释放handles并四cleanup/residual；cleanup后只做source-v1 `source_final_after_cleanup`/guards/residual，最后finally第8阶段publisher。Clock畸形只令时间未验证；不得检查已删snapshot或从finally抛出 |
| `RED-REPORT-004` | partial；预置final；FileRenameInfo/temp cleanup失败；在`evidence_after_temp_write_before_rename`和`cleanup_after_entry_pin_before_dispose`两个PathPhaseObserver phase尝试换junction | 每record唯一temp/final；CreateNew temp handle、无DELETE-share parent pin、单次FileRenameInfo replace=false可审计。失败后handle-bound清temp；temporary_artifacts/evidence residual精确且residual令partial/failed。observer rename/delete被拒绝或稳定path error，external/预存final零变化；第8阶段三小段继续且不扫目录 |
| `RED-REPORT-005` | 深层首个正式v1与冻结json bytes | PS5.1 Depth32精确回读source/snapshot、闭包、A argv、permission/import/prefix、逐命令environment profile/attestation write-root containment、Q v2 hook/sqlite/四层fork env及observed/source-derived标记/journals/actual addon、pins、Job accounting、DTO/transient/phase/seams/artifact plan。旧requested-effective近义字段不接受；JSON自身expected hash为null，publisher request hash与冻结bytes逐字节相符，最终publication/residual仍out-of-band |
| `RED-PROCESS-001` | production runner调用系统PowerShell argv回显fixture | 空参数、空格、引号、连续/尾随反斜杠逐项原样回显，exit code来自身份匹配的原parent handle之`GetExitCodeProcess` |
| `RED-PROCESS-002` | 子进程向stdout/stderr各写大于1MiB且小于8MiB | 两流byte capture并发完整，`bytes`等于实际、`limit=8388608,truncated=false,completed=true,faulted=false,canceled=false`，固定超时内无死锁且raw长度/hash可复核 |
| `RED-PROCESS-003` | 保留真实PowerShell timeout树/normal descendant/taskkill；completion port提供完整/缺失/重复/无法开handle的best-effort fixture消息；伪造Q spawn intent/result/PID/role与Job Total/Active；按ProcessFaultInjector注入job setup/port/assign/PID/stdout/stderr/completion/accounting/query/close；>8MiB；静态复核production Node/esbuild allowlist | 不启动Node/esbuild。assignment前不Resume；每个收到的NEW须立刻完整身份化，无法开handle失败。Q intent/result一一配对且成功PID去重；`ActiveProcesses=0`、`TotalProcesses=1+成功spawn PID数`，NEW集合与parent+spawn集合一致；消息缺失/额外native/third-party后代/计数差异分别稳定`PROCESS_COMPLETION_TELEMETRY_INCOMPLETE/PROCESS_JOB_ACCOUNTING_MISMATCH`并关Job，绝不声称completion单独完整捕获。fake prefix/argv/role-specific NODE_OPTIONS/addon不符=`TRUSTED_POLICY_ATTESTATION_INVALID`；normal leak/output/capture/taskkill码精确，>8MiB持续drain，全部有界 |

`RED-FAIL-001` 至 `RED-FAIL-009` 必须全部复用 `RED-MANIFEST-002` 的预置数据，因此每次失败运行都同时证明失败照扫和预置正式文件不变，不能把两项证据从不同版本或不同运行拼接。

`shared/tests/validate-foundations-state-isolation.ps1` 至少覆盖 `RED-ENV-001`、`RED-ENV-002`、`RED-OPENCLAW-001`、`RED-OPENCLAW-002`；两份测试若覆盖同一断言，必须复用相同错误码和 JSON 字段名。

## 10. TDD 实施顺序

### Task 1: 冻结 RED harness 与 Oracle

**Files:**

- Create: `shared/tests/validate-data-manifests.ps1`
- Modify: `shared/tests/validate-foundations-state-isolation.ps1`

- [ ] 先实现完整fixture Runtime layout、预置字节、fake adapters、统一断言，以及只从direct core/helper传入的`PathPhaseObserver/ProcessFaultInjector`；production入口反射断言不得暴露seam。
- [ ] 保持§9恰好48个顶层RED ID并在既有ID内实现全部handle race、source-v1/snapshot-v2/closure、policy exact bytes/spec poison、nested DTO、job phase、publisher temp、OpenClaw transient与schema子变体；不得新增第49个ID。真实Job/taskkill/no-follow测试仍保留，但整个两份PowerShell suite不得启动Node/Vitest/TypeScript/OpenClaw，测试源码ASCII。
- [ ] 运行两条 RED 命令，确认当前 validator 因缺少 before/after manifest、JSON、sidecar、失败照扫、build root 等能力而失败。
- [ ] 测试进程只把即时输出写到临时目录；命令结束后由主协调者把实际控制台输出按新文件名冻结到`docs/evidence/raw/`并记录hash，作为RED历史证据。不得创建PASS EV或修改源码 data/dist。

### Task 2: 实现 core 的固定根与 manifest

**Files:**

- Create: `shared/private/foundation-validation-core.ps1`
- Test: `shared/tests/validate-data-manifests.ps1`

- [ ] 实现production/fixture exact source Runtime layout、derived private snapshot root matrix、UNC/device拒绝及§4.6全祖先CreateFileW no-follow pin；immutable leaf只share READ、writable parent share READ|WRITE且全无DELETE，逐段create/copy/disposition全handle-bound，PathPhaseObserver overwrite/restore竞态与external target零变化转绿；不得声称目录pin阻止新增。
- [ ] 实现official/project/source-dist分层及`manifest-provider-dto/v1`；在clone前拒dynamic member与任意层引用复用，一次性NoteProperty DTO后物理复核且不再读provider；official baseline不可用时九命令零执行。
- [ ] 只运行 `RED-ROOT-*` 与 `RED-MANIFEST-*`，直到通过；九阶段测试此时仍应保持 RED。

### Task 3: 实现九阶段、Process exit 和源码外构建

**Files:**

- Modify: `shared/private/foundation-validation-core.ps1`
- Modify: `shared/validate-foundations.ps1`
- Test: `shared/tests/validate-data-manifests.ps1`

- [ ] 实现§4.7 A exe/script/exact argv、source canonical-tree-v1；从READ-only source handles构造Node+完整`.pnpm` private snapshot，942 junction改写到snapshot内并匹配canonical-tree-v2 `AC34E5.../14E884...`；实现0 required gap/C_TOP与冻结optional peers、before/after checks。
- [ ] 实现A common19；八Node为每个command建立位于唯一write root的exact environment profile，test/build/plugin分别用`V_r/B_r/O`，B/C build attestation不得靠validation write；profile与journal进入既有根audit/cleanup。八Node只指staging+snapshot/no-global/唯一`--import=<Q_u>`，Vitest固定forks/singleFork/no-file-parallelism且staging无`.env*`、userEnv/config.env为空；全部无worker/WASI，build/plugin无child/addons。RED只验spec/fake。
- [ ] 实现单一ASCII ESM trusted policy的exact bytes/hash与`--import`：完整network与SQLite controls；Vitest incoming 28键规范化后丢四Vite键，Q供应24键，按Node源码冻结26键CreateProcess层和stdio→IPC fd3，child Q实际attest 24键bootstrap层；helper/esbuild按role保存不同层与NODE_OPTIONS；另含prototype one-shot、Rollup dlopen actual load。明确source-derived不是Q观察且policy不是OS sandbox。
- [ ] 实现CreateProcessW suspended、Job Object、PID identity、taskkill、有界8MiB drain；Q intent/result为受控JS child输入，completion只作best-effort telemetry并与Job Total/Active/去重PID严格对账；direct helper实现冻结ProcessFaultInjector phases但production恒null，真实Job/timeout子变体保留。
- [ ] staging用handle-pinned copier，源码dist只读；实现OpenClaw baseline/四stage/唯一audit、preexisting与transient create-delete累计错误。
- [ ] 运行 `RED-FAIL-*` 与 `RED-BUILD-*` 直到通过，并复核源码 dist hash 未变化。

### Task 4: 实现最外层 finally、调用者环境不变校验和机器报告

**Files:**

- Modify: `shared/private/foundation-validation-core.ps1`
- Modify: `shared/validate-foundations.ps1`
- Modify: `shared/tests/validate-foundations-state-isolation.ps1`
- Test: both shared safety test scripts

- [ ] 在before EnvironmentAdapter snapshot、Clock、preflight和before manifest之前建立唯一最外层`try/catch/finally`；首个前置调用失败仍走完整finally/publisher。
- [ ] 实现调用者环境只读before/after、OpenClaw唯一权威audit、四根no-follow cleanup及core独立physical residual entries/count；禁止写宿主环境或official ACL。
- [ ] 让outer finally每个编号和内部Clock/adapter独立catch；validation root存在且immutable handles持有时先做`finally_before_cleanup` source/snapshot/closure复核，再释放handles并cleanup，cleanup后只做`source_final_after_cleanup`/guards/residual；publisher严格位于finally第8阶段且后续阶段不断。
- [ ] core为每artifact冻结唯一temp/final和json bytes；publisher只用CreateNew temp handle+单次FileRenameInfo replace=false，失败后handle cleanup，最终temporary_artifacts/evidence residual准确。完成首个权威v1的source/snapshot/closure/policy/A argv/topology/pin/job/DTO/transient/seam/artifact-plan深层schema。
- [ ] 运行 `RED-OPENCLAW-*`、`RED-TEMP-*`、`RED-ENV-*`、`RED-REPORT-*` 直到通过。
- [ ] 再运行两份完整测试，确认全部矩阵 GREEN。

### Task 5: 真实运行与独立复核输入

**Files:**

- Modify: no additional implementation files
- Produce at execution time: unique raw logs and machine JSON under fixed `evidence_root`

- [ ] 记录四个交付文件和相关契约的 SHA-256。
- [ ] 在任何真实命令前fresh比较权威27项protected manifest，差异必须0；真实运行和最终测试后按相同算法再次比较，差异仍必须0。
- [ ] **Task5是唯一真实Node/Vitest/TypeScript/OpenClaw层。**使用三个精确production source env及§4.4完整Runtime执行入口；确认caller TEMP无关、五production guards正确、seams inactive，private snapshot由core派生且live source不进入command。
- [ ] 解析机器JSON，确认A argv、source/snapshot/闭包；逐命令profile全部位于唯一permission write root，B/C build的HOME/TEMP/journal在各自build root且validation不在write flags，相关文件均进入audit/cleanup。Vitest staging `.env*`=0、userEnv/config.env为空；fork四层环境依次28/24/26/24键，IPC fd3来自exact stdio且第三层`observed=false`，bootstrap层由child Q policy-ready实测；fork/helper NODE_OPTIONS为空，esbuild source-derived层恰有冻结permission串。再确认policy、spawn/addon journal、Job accounting及无unexpected child。
- [ ] 复核全部契约枚举的official/project/source-dist/dependency/五guard/四临时根before/after及protected 27项，实际外写diff全空；该事实与trusted policy只覆盖冻结toolchain的运行，不外推为OS级网络或恶意代码沙箱。out-of-band确认publication temp cleanup/evidence residual=0。
- [ ] 重新运行两份测试，确认真实运行没有污染测试结论。
- [ ] 为五个精确外部租约路径创建不可覆盖end identity并与start identity分类`external_concurrent_diff`；最终EV明确这些变化不属于本任务，也不证明内容正确。
- [ ] 把 raw/JSON 路径、hash 和完整命令交给独立安全复核者；实施者不得自行修改总计划状态。

在第一份授权实现文件（包括`shared/tests/validate-foundations-state-isolation.ps1`）发生实际变化时，主协调者必须立即按总计划reopen条件把`A-FND-001`、`SH-FND-001`与`SH-FND-REFRESH-001`降为`未开始`并注明`reopened_waiting_revalidation`，保留EV-009/011为历史证据；它们不占共享WIP，唯一进行中任务仍是`SH-SAFE-BASE-001`。SH-SAFE终态真实运行的新EV可作为三项后续复验输入，主协调者再遵守WIP=1逐项完成状态流转。测试或实施代理不得自行改总计划。

## 11. PowerShell 5.1 与编码硬约束

当前目标环境是 Windows PowerShell 5.1，全部新建或修改的 `.ps1` 源码必须保持 ASCII；动态路径和 JSON 可以包含 Unicode，但脚本源码不得依赖无 BOM UTF-8 中文可被 `-File` 正确解析。

禁止使用：

- `ConvertFrom-Json -AsHashtable`
- `[System.IO.Path]::GetRelativePath()`
- `ProcessStartInfo.ArgumentList`
- `ForEach-Object -Parallel`
- `??`、`?.`、三元运算符
- 在 PowerShell function/scriptblock 后用陈旧 `$LASTEXITCODE` 代表本次命令结果
- `Write-Host` 作为唯一原始日志来源
- mock 函数内 `exit`
- 裸递归`Directory.CreateDirectory`跨越多个未验证路径段、`Copy-Item`复制staging/runtime snapshot树、shell/`mklink`重建junction、`Remove-Item -Recurse`或`Directory.Delete(path,true)`清理运行根
- culture-sensitive默认排序，或对路径/entry/tree/artifact使用与`StringComparer.OrdinalIgnoreCase`不同的顺序
- `MoveFileEx`、pathname rename/delete、含`FILE_SHARE_DELETE`的安全pin handle，或释放祖先/parent handle后继续同一operation
- provider的`ScriptProperty/CodeProperty/AliasProperty`等动态成员、跨scope nested引用复用，或DTO形成后再次读取provider对象

必须做到：

- 所有 JSON 数组显式包为 `@(...)`，避免 pipeline 单元素展开。
- 原始日志使用显式 `UTF8Encoding($false)` 的 `StreamWriter`/`File.WriteAllText`；不依赖 `Out-File` 默认编码。
- native runner只用`CreateProcessW(CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT)`、显式application path、唯一clean-room Unicode environment block和两个独立pipe handle，不经shell；exit code只从身份匹配的原parent process handle调用`GetExitCodeProcess`取得。
- 保存 exception 的类型、`Exception.ToString()` 和 `ScriptStackTrace`。
- 调用者环境只读快照必须区分变量存在/不存在，并用规范键序与值hash生成fingerprint；core及runner不得对`Env:`执行`Set-Item`、`Remove-Item`或等价宿主写入。
- cleanup exception 进入数组，不能从 finally 直接抛出并覆盖原错误。
- 所有路径/entry/tree/root_labels/artifact集合使用`StringComparer.OrdinalIgnoreCase`；规范摘要按各自版本固定行排序。
- immutable source/snapshot/staging/A输入leaf的handle share精确仅READ且保持整个相应copy或process/Job生命周期；writable operation parent才允许share READ|WRITE；全部pin无DELETE。create/copy/FSCTL_SET_REPARSE_POINT/FileRenameInfo/FileDisposition绑定handle，dangling reparse只作leaf。目录pin不阻止新增子项，必须以fresh tree/manifest失败关闭且不得夸大威胁边界。
- cleanup只接受本次run root，逐entry OPEN_REPARSE_POINT+DELETE handle、目录后序FileDisposition；core在adapter后独立handle-pinned residual扫描。
- 八Node顺序必须为Permission flags→no-global→唯一`--import=<Q_u>`→snapshot entry，四plugin例外在Q后、entry前固定加入`--stack-size=8192`；每条Node命令profile只能位于其唯一write root，build不可把validation加入write flags。Vitest staging拒`.env*`且config env为空；Q强制fork/helper完整prefix，按28键incoming→24键q-supplied→26键source-derived IPC→child Q实测24键bootstrap-visible留证，禁止把source-derived冒充观察。fork/helper NODE_OPTIONS为空，esbuild只在source-derived层含canonical permission串；所有child native前后写journal，直接prototype spawn拒绝。全部禁worker/WASI，build/plugin禁child/addons；Permission/Q不称OS sandbox。
- 两份RED/GREEN PowerShell suite不得启动npm、Node、Vitest、TypeScript或OpenClaw；真实工具执行只属于Task5。
- Process capture保留上限固定8MiB/stream但持续有界drain；Faulted/Canceled Task不得标记completed。

若测试临时保留 global `npm` mock，必须在独立 PowerShell 子进程运行，并在每次调用内用 `cmd.exe /d /c "exit /b <code>"` 明确设置 native exit；不能依赖前一个 A 子进程留下的 `$LASTEXITCODE`。首选方案仍是 core adapter mock，完全不定义或调用 npm。

## 12. 验证命令与预期结果

先运行 RED：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\shared\tests\validate-data-manifests.ps1
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\shared\tests\validate-foundations-state-isolation.ps1
```

修改生产代码前，第一条必须因当前缺少安全能力而非测试语法/fixture 错误失败。实现结束后，两条命令均须 exit `0`，并逐项打印全部 test ID 为 PASS。

真实运行使用显式运行时配置；具体绝对路径必须在 EV 中原样记录：

```powershell
$expectedRuntimeEnvironment = [ordered]@{
    DIET_MANAGER_NODE = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
    DIET_MANAGER_TOOL_MODULES = 'E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules'
    DIET_MANAGER_OPENCLAW_ENTRY = 'E:\codx\skill\饮食管家\version-c-strict-plugin\node_modules\openclaw\openclaw.mjs'
}
foreach ($name in @($expectedRuntimeEnvironment.Keys)) {
    $actual = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
    $expected = [string]$expectedRuntimeEnvironment[$name]
    if (-not [string]::Equals($actual, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Required runtime path does not equal the frozen production path: $name"
    }
}
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\shared\validate-foundations.ps1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

执行者必须在启动前设置并记录三个精确**source配置**环境路径；production入口另从代码字面构造§4.4 source dependency/guard layout和temporary parent，caller TEMP不参与，private snapshot只能由core派生。Task5是唯一真实Node层，必须证明：root matrix/pins、A argv、source-v1/snapshot-v2/闭包均匹配；八Node profile分别位于唯一`V_r/B_r/O` write root，B/C build attestation在对应build root真实写入且不授validation write，所有profile/journal被既有四根audit/cleanup。Vitest staging无`.env*`、userEnv/config.env为空；每条singleFork incoming/q-supplied/source-derived/bootstrap-visible依次28/24/26/24键，IPC fd3/serialization由exact stdio与Node源码推导并明确非观察，child policy-ready实际证明bootstrap-visible，fork/helper无NODE_OPTIONS而esbuild仅source-derived层有冻结值。snapshot Node helper/esbuild/Rollup addon只按冻结identity出现，journal、completion与Job对账一致；policy self-test、Job/stream/exit全通过。最后全部manifest/guard/root diff与residual为0；fake GREEN不能替代，也不外推OS隔离。

## 13. 明确禁止范围

本任务不得：

- 实现或修改 A JSONL 事务、B/C SQLite driver、Schema、迁移、业务 handler、幂等或恢复；
- 为 B/C 发明尚未冻结的正式 SQLite 文件名；
- 用 mock 运行宣称 Node/OpenClaw/driver 兼容或 G1 路线通过；
- 认领 `CASE-STORAGE-004`、`CASE-FOUNDATION-002` 的 `*` 或任何完整案例结论；
- 写入、修复或删除真实 data 根中的现有文件；检测到差异只能失败并报告；
- 把临时根嵌套到正式根、evidence root 或彼此内部；
- 通过删除污染文件把正式数据 diff 伪装为 0；
- 修改现有历史 EV、复用 raw 文件名或预登记未来 EV；
- 修改总计划、任务状态、actual evidence 或 G1 结论；
- 借本任务处理 backup/export/release/install 正式路径，这些属于后续任务。

G1 以后仍需分别证明：A 真实 JSONL 路径和事务的注入/逃逸保护；B/C 精确 SQLite 路径、真实 WAL/SHM、事务/迁移/回滚；每路线真实候选上的完整 foundation/business diff；`X-GATE-001` 的逐路线完整案例。SH-SAFE 的完成不能替代这些证据。

## 14. 完成判据

只有同时满足以下全部条件，实施者才可把结果提交独立复核：

1. SH-SAFE实现差异只修改 §3 的四个交付路径；允许按§3证据例外新建不可覆盖RED/GREEN/真实运行raw、机器JSON和最终EV。五个精确外部租约路径即使变化也只能记`external_concurrent_diff`，不得归因本任务、不得被本任务读取或写入；权威27项protected manifest必须零差异，且没有其他路线代码/package/tsconfig、业务数据或历史 EV 改写。
2. §9顶层RED ID保持恰好48个；新增风险全在既有ID子变体，先RED后GREEN。两份PowerShell suite全程不启动npm/Node/Vitest/TypeScript/OpenClaw；Task5才是真实工具层。
3. production Runtime的temporary parent、三个source env、dependency roots、五guard和identity expectations逐项满足§4.4/§4.7；private snapshot只能从本轮validation root派生。test-owned Runtime同shape但只含fixture sibling source/dependency/guards并建立fixture snapshot，production paths零触碰。root matrix只允许snapshot在validation内的登记关系并拒绝其他非法包含、UNC/device。
4. existing ancestor/leaf均no-follow；immutable source/snapshot/staging/A inputs share仅READ且贯穿copy或process/Job，writable parent才share READ|WRITE，全部无DELETE。逐段create、source-handle copy、FSCTL_SET_REPARSE_POINT、FileRenameInfo、FileDisposition全handle-bound。overwrite/restore、rename、dangling或pin失败稳定关闭；目录pin不被宣称能阻止新增，persistent新增由fresh tree失败，external target/official ACL零变化。
5. A exe/script identity与exact七段argv匹配。三个env只验证source配置；source Node/.pnpm分别匹配canonical-v1 `AC34E5.../7E8574...`，private snapshot匹配v2 `AC34E5.../14E884...`、942 internal junction/35566 lines。Vitest/TS/OpenClaw闭包required gap和C_TOP均0，13/0/10 optional peers保持missing；source/snapshot/closure在固定fresh phases匹配，不符稳定阻断并报告actual layout。
6. A与八Node均inherit=false；A exact argv/common19。八Node每命令profile根与attestation目录严格位于其唯一permission write root，test/build/plugin分别为`V_r/B_r/O`；B/C build write roots恰`[B_r]`且无validation扩权，profile/journal进入既有根audit/cleanup。cwd/entry/module/permission/import/Q/prefix精确；Vitest staging无`.env*`、userEnv/config.env为空，固定forks/singleFork/no-file-parallelism且仅test allow-child+addons。RED只验spec；Task5验证实际写入与policy。
7. Vitest fork incoming env规范后恰28键并允许同值case alias；Q丢弃Vite四键后供应24键。按冻结Node源码与exact `['pipe','pipe','pipe','ipc']`推导的CreateProcess层恰26键、fd3/serialization json/observed=false，child Q policy-ready实际bootstrap-visible恰24键；source-derived不得称actual OS观察。fork/helper NODE_OPTIONS为空，esbuild仅source-derived层含canonical permission串。九命令仍先入KILL_ON_JOB_CLOSE Job再Resume，Q journal、best-effort completion与Job Total/Active/去重PID严格对账；unexpected/外部child为0。normal/timeout/exception关闭Job并确认后代消失，assignment失败不Resume，production seam inactive。
8. ManifestProvider只提供候选；core在clone前拒dynamic members及任意层同/跨scope引用复用，一次读取成pure NoteProperty DTO后不再读provider，再独立复核物理集合/fields/classification。漏/多/outside/mutation/root消失保留稳定inner code并统一manifest_failed；OpenClaw同样重算。
9. official baseline不可用时`OFFICIAL_BASELINE_UNAVAILABLE`且九命令skipped；after post-only。official/project两scope及B/C source-dist覆盖完整、业务/sidecar path/size/hash/mtime在成功及九失败中不变。
10. 调用者环境始终只读；outer try在before EnvironmentAdapter/Clock/preflight/manifest前建立，任一前置或finally adapter畸形都不阻断后续cleanup/audit/publisher，primary不覆盖。
11. OpenClaw baseline为空；四stage与唯一final audit可复核。任何preexisting、stage/transient create-delete、unknown或misclassification分别稳定失败；observed candidates的first/last/final_present/hash/size、transient/final count准确，cleanup不得改回通过。
12. 四根cleanup用OPEN_REPARSE_POINT+DELETE handle后序FileDisposition；adapter原错保留，core独立handle-pinned residual。任一残留/reparse/pin错误失败且不遍历target。
13. B/C test/build/plugin全在staging/build root并从snapshot toolchain执行，source dist diff空；C dist候选在project scope去重。fixed ASCII ESM policy exact bytes/hash与CJS/ESM同步通过；exact network hook/self-test集合、EventSource absent、SQLite私有native constructor/独立guard prototype/authorizer+limits+SQL/backup/extension、role-specific child/prototype permit及dlopen actual allowlist均按trusted-code边界失败关闭，但明确不是OS/恶意代码/恶意SQLsandbox。五actual guards、source dependencies及所有契约枚举scope零diff且fixture/production互不触碰。
14. outer finally在validation root与immutable handles仍有效时先完成fresh `finally_before_cleanup` source/snapshot/closure检查，之后才释放handles并cleanup；cleanup后只允许source-v1/guards/residual，不读取已删snapshot。第8阶段冻结每artifact唯一temp/final与一次JSON bytes；publisher只CreateNew handle+FileRenameInfo，不重序列化。失败temp做handle cleanup，temporary_artifacts/evidence residual精确，residual>0不得complete；partial raw保留且未确认JSON无效。
15. `foundation-safety-report/v1`是首个正式权威v1；PS5.1深回读source/snapshot/v1-v2/closure/Q v2/prefix、逐命令profile/write-root与四层fork environment、observed/source-derived标记、journals/actual addon/A argv/topology/permission/pins/completion+accounting/job/phase/DTO/transient/seams/artifact plan，旧草案不兼容。Task5唯一真实Node运行、四交付hash、27零差异、五租约、raw/JSON/publication交独立复核；报告`full_case_set:none`且不宣称OS sandbox、整案或G1。

实施者完成后只报告事实、命令和 hash。独立复核未通过前，不得把 `RISK-011`、`DEBT-001` 或 `DEBT-006` 标为关闭，也不得把 `SH-SAFE-BASE-001` 标为已完成。
