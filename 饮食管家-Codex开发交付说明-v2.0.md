# 饮食管家 B — Codex 开发交付说明 v2.0

| 项 | 值 |
|---|---|
| 文档版本 | **v2.0**（取代 v1.0） |
| 目标产品版本 | **0.1.1**（已冻结发布的是 0.1.0） |
| 编写时间 | 2026-08-16 |
| 仓库 | `E:\codx\skill\饮食管家`（git，分支 `main`） |
| 基线 commit | `0294d67 docs: unify product 0.1.1 authority` |

> ## ⛔ 关于 v1.0
> `饮食管家-Codex开发交付说明-v1.0.md` 的 §3.4 结论（"疑似 pwsh 7 环境问题，建议查 locale/编码，可能归类为 ENVIRONMENT_BLOCKED"）**已被实测推翻**。真实原因是产品缺陷 CORE-SECRET-ACL-001（见 §4）。
> **不要读 v1.0。以本文档为准。**

---

# 第一部分：铁律（先读这一节，再读别的）

这个仓库的价值不在代码量，在**可审计性**。它有完整的需求权威、19 任务执行主干、机器可校验的治理门和证据链。你的任务是**在这套框架内推进**，不是重新设计它。

## 1.1 十条禁止（违反即返工，不接受任何理由）

| # | 禁止 | 为什么 |
|---|---|---|
| 1 | **禁止另写计划、重排任务、改任务边界** | 主干计划已批准。第二份权威 = 治理崩塌 |
| 2 | **禁止一次做多个任务**（WIP=1） | 台账必须恰好一个 `IN_PROGRESS`；混合提交无法回溯 |
| 3 | **禁止先写实现后补测试**，禁止把测试改成适配错误行为 | 测试是唯一防线。测试红了就修实现，或停下报告 |
| 4 | **禁止顺手重构 / 顺手修别的 / 顺手格式化** | 提交范围必须恰好等于任务清单 |
| 5 | **禁止新增运行时依赖** | 需要就先提 DEC 等批准，再重开受影响任务 |
| 6 | **禁止写入 `releases/`、`docs/archive/`** | 只读。发布物不可变 |
| 7 | **禁止改契约文件而不同步 SKILL.md 哈希** | 契约变更必须先有 DEC |
| 8 | **禁止 AI 生成任何营养数值** | 只能来自白名单来源，否则 `unknown`（DEC-029） |
| 9 | **禁止 secret 进入 argv / 日志 / 环境清单 / Git / 发布包** | authority secret、FDC_API_KEY、Gateway 凭据、备份口令 |
| 10 | **禁止 push 到 GitHub、禁止推 tag、禁止改系统环境**（PATH、装软件） | 需用户逐次明示 |

## 1.2 必须停下来问用户的六种情况

不要"合理推断"后继续。停下，说清事实，等回答。

1. 主干计划说 X，但代码/现实是 Y（**这已经发生过一次**，见 §1.4）。
2. 任务需要新增运行时依赖。
3. 任务需要改契约文件或 SKILL.md 哈希。
4. 需要真实凭据（FDC_API_KEY、Gateway）。
5. 全量测试基线数字下降（`< 31 文件` 或 `< 959 用例`）而你不确定原因。
6. 你想做的事不在当前任务的文件清单里。

## 1.3 每个任务的固定七步（不可跳、不可换顺序）

```
1. 读主干计划里那一个任务的原文。只注入这一个任务的上下文
2. 写失败测试 → 跑它 → 确认失败原因是"行为缺失"
   ⚠️ 不是编译错误、不是导入错误、不是环境错误。错的 RED 什么都证明不了
3. 写最小实现到 GREEN
4. 跑四道门：定向测试 → 邻接回归（计划里每任务都列了）→ tsc --noEmit → git diff --check
5. git add 恰好是任务列出的范围 → 按计划给定格式 commit
6. 阶段最后一个任务：跑 product:validate 出证据 JSON → 更新台账 → 一并提交
7. 汇报事实：测试数字、commit SHA、证据路径。不确定就说不确定
```

## 1.4 一个必须读的真实案例（说明第 2 步为什么不能省）

这是我刚做完的 CORE-SECRET-ACL-001，完整展示了"按流程走"和"凭直觉改"的差别：

- **症状**：全量测试在 pwsh 7 下 45 例失败，PS 5.1 下全绿。
- **错误的第一反应**（v1.0 文档里写的）：环境问题，归类 `ENVIRONMENT_BLOCKED`，绕过。
- **实测**：拿到真实错误码 `CORE_RUNTIME_SECRET_INVALID` → 子进程 stderr 是 `Set-Acl : 找不到 Set-Acl 命令` → **是真产品缺陷**，从 pwsh 7 终端启动产品会完全不可用。
- **写 RED**：构造一个自建的 Core-only 假模块清单来复现，做到**与机器无关**（在 PS 5.1 下也能红，不依赖本机装了 pwsh 7）。
- **第一版修复**：`{ ...process.env, PSModulePath: pinned }`。看起来完全正确。
- **测试把它打回来了**：进程里原有的键名是大写 `PSMODULEPATH`，JS 对象展开是大小写敏感的，于是子进程里出现两个同名变量，**大写那个生效**。

```
ENVKEYS = [["PSMODULEPATH", "<poison>;…"],   ← 原有键，大写
           ["PSModulePath", "<pinned>"]]     ← 覆盖成了第二个键
CHILD_PSMP = <poison>…                        ← 大写那个生效
```

**教训**：如果我跳过第 2 步、直接写"看起来对"的修复，就会提交一个假修复，并且在 pwsh 7 环境下依然全挂。失败测试不是仪式，它是唯一发现这层问题的手段。

**顺带记住这条 Windows 坑**：`{ ...process.env, KEY: v }` 在 Windows 上**不是可靠的环境变量覆盖**。必须先按大小写无关剔除同名键。

---

# 第二部分：权威与当前状态

## 2.1 权威优先级（冲突时按此服从，不要自行折中）

```
1. 仓库根《饮食管家-开发约束与需求-v1.0.md》
   → 需求与不变式的唯一权威（PRODUCT-0.1、0.1.0 冻结子集、I-1..I-8、REQ-*、SLICE-0..7、DoD、M0–M9、营养白名单 §9）
2. docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md
   → 执行主干，1529 行，19 任务的文件清单/接口/失败测试代码/命令/提交范围都已写死
3. docs/work-items/PRODUCT-0.1.1-ledger.json
   → 阶段状态的机器权威
4. 本文档 v2.0
   → 思路、机制、交接现状
```

本文档**不复制**主干计划的任务原文。执行时以主干计划原文为准，本文档负责让你理解"为什么这么排"和"在这台机器上怎么跑得通"。

## 2.2 已提交的历史

| commit | 内容 |
|---|---|
| `0294d67` | **阶段 0 Task 1 完成**：归档 4 份历史计划到 `docs/archive/legacy-plans/`、建立 `PRODUCT-0.1.1-ledger.json`、治理测试 `shared/tests/validate-product-0.1.1-governance.mjs`、README/START-HERE/开发进度统一指向 v1.0 权威（11 文件 / 94 插入） |
| `01b1f8e` | MIXED-LIQUID-001 已修复（"喝了豆浆和白水"丢失白水） |
| `6772061` | 0.1.0 发布装配（`releases/v0.1`，**只读**） |

**已验证基线**：全量 vitest `31 文件 / 959 用例 全绿`（PS 5.1 环境）。这是 `expected-gates.json` 里 `min_test_files: 31` / `min_tests: 959` 的来源。

## 2.3 工作树未提交内容（接手时应逐项核对一致）

```
 M version-b-lite-plugin/package.json                          新增 "product:validate" 脚本
 M version-b-lite-plugin/src/application/core-runtime.ts       ★ CORE-SECRET-ACL-001 修复（见 §4）
?? version-b-lite-plugin/tests/runtime-secret-acl-module-path.test.ts  ★ 该修复的回归测试（GREEN）
?? shared/validate-product-0.1.ps1                             产品门禁验证器，主体已写完
?? shared/tests/validate-product-0.1-contract.ps1              验证器契约测试，当前 PASS
?? shared/tests/fixtures/product-validation/expected-gates.json 门清单与基线阈值
?? docs/架构与开发思路.md                                      交付文档初版
?? docs/维护与迭代路线图.md                                    交付文档初版
?? docs/AI协作开发手册.md                                      交付文档初版
?? 饮食管家-Codex开发交付说明-v1.0.md                          ⛔ 已过期，见文首
?? 饮食管家-Codex开发交付说明-v2.0.md                          本文档
```

台账阶段 0 = `IN_PROGRESS`，其余 `NOT_STARTED`。状态自洽，续接零损失。

## 2.4 四个已知缺陷 + 一个新缺陷

| ID | 现象 | 状态 | 归属 |
|---|---|---|---|
| MIXED-LIQUID-001 | "喝了豆浆和白水"静默丢弃白水 | ✅ 已修复已提交（`01b1f8e`） | — |
| **CORE-SECRET-ACL-001** | 从 pwsh 7 启动 → `CORE_RUNTIME_SECRET_INVALID`，产品完全不可用 | 🔶 **实现已改完 + 单测 GREEN + tsc 通过，但未跑回归、未登记、未提交** | §4，你的第一件事 |
| CORE-UNDO-001 | `undo_record` 未接通，被 `ACTION_NOT_IMPLEMENTED` 拦住 | 待做（领域/存储层 `void_event` 已完整，缺 parser + runtime 接线） | 阶段 1 Task 3–6 |
| PURCHASE-MULTI-001 | 多商品采购解析失败（现状是冻结例句正则） | 待做 | 阶段 2 Task 7–9 |
| CLARIFICATION-001 | 澄清只覆盖两条硬编码句子 | 待做 | 阶段 2 Task 7–8 |

前四个的现场来源：`docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md`（真实 6 实例 OpenClaw 验收）。

---

# 第三部分：产品是什么（够你安全动手的最小理解）

## 3.1 一段话

**饮食管家 B** 是"Skill 即入口 + SQLite 唯一业务后端"的个人饮食记录助手。用户说"我早上吃了两个鸡蛋"、"买了两箱牛奶每箱12盒"、"撤销刚才那条"，系统把它变成**可审计、可撤销、可追溯**的结构化事实，并维护库存扣减、饮水与营养进度。

## 3.2 分层（严格单向依赖）

```
Skill（SKILL.md，硬编码冻结契约哈希）
  ↓
OpenClaw 插件适配层（src/openclaw/plugin.ts）—— 只做协议转换，零业务逻辑
  ↓
应用层（core-runtime.ts / mapping.ts / outcome.ts）—— 编排、事务分层、Outcome 归一
  ↓
解析层（src/parser/*.ts）—— 纯函数，无 IO，输入原文输出候选帧
  ↓
领域 + 仓储层（src/domain, src/repository）—— 不变式守卫、幂等、事实提交
  ↓
存储层（node:sqlite）—— 单文件数据库，append-only 事实表 + void_event
```

**不可协商的架构立场：适配层永远是薄的。** OpenClaw / MCP 任何一层都不得重复业务判断，否则同一语义会在两处漂移。

注意 `src/application/runtime.ts` 和 `command-handler.ts` 都只是 `core-runtime.ts` 的**再导出**（各 1–6 行），真正的实现只有一份。

## 3.3 八条不变式 I-1..I-8（每条都有测试）

| ID | 不变式 | 为什么 |
|---|---|---|
| I-1 | 事实优先：先落事实，再算派生 | 派生值可重算，事实不可重建 |
| I-2 | 绝不写未发生的事：撤销用 append-only `void_event`，**不 DELETE** | 审计链不能有空洞 |
| I-3 | **unknown ≠ 0** | `Number(null) === 0` 会把"未知营养"写成"零热量" |
| I-4 | 库存非负 + **仅唯一匹配才扣减** | 歧义时宁可澄清，不可猜着扣 |
| I-5 | 原文逐字保留 | 任何解析都可能错，原文是唯一可回溯真值 |
| I-6 | 幂等来自业务语义，不来自请求 ID | 同一事实重复提交必须被业务语义识别 |
| I-7 | 有界原子性（见 3.4） | 全局大事务把可恢复失败升级成不可恢复失败 |
| I-8 | 全链可追溯 | 每条派生值都能回溯到事实与原文 |

## 3.4 三层事务模型（DEC-023，**有界启用**）

```
FactCommit        单个 BEGIN IMMEDIATE，只写事实           ← 默认，优先只用这一层
EffectBundle      必要副作用原子化（库存扣减 + 事实）        ← 仅当副作用与事实必须同生共死
EnvelopeFinalize  累计量/回执冻结，重放稳定                 ← 仅当需要可重放的对外回执
```

**规则：能只用一层就只用一层。** Task 9 要求"单一 BEGIN IMMEDIATE"就是这条规则的具体化。

## 3.5 五种 Outcome 语义（Skill 与测试都依赖精确含义）

| status | 含义 | 已写入 | 能否重试 |
|---|---|---|---|
| `committed` | 事实已提交，副作用完整 | 是 | 不需要 |
| `committed_with_issues` | **事实已提交**，副作用降级 | 是 | **绝对不可重复提交同一事实** |
| `needs_clarification` | 零写入 + 一个具体问题 | 否 | 用户补充后重提 |
| `ignored` | 计划/否定/只读语句，零写入 | 否 | — |
| `failed` | 技术失败，零业务写入，允许脱敏技术日志 | 否 | 可重试 |

把 `committed_with_issues` 当成"失败可重试"是最容易造成重复记账的坑。

## 3.6 营养白名单（DEC-029，红线）

营养数值**只能**来自三个来源：权威数据库（USDA FoodData Central 已接入，CFCT 规划中）、用户自建库、标签 OCR。**AI 永远不得凭知识生成任何营养数字**；解析不到就是 `unknown`，展示层写"未知"。这条一旦破防，产品可信度归零。

## 3.7 冻结契约

```
contract_id      = diet-manager/contract-v2
contract_version = 2
contract_sha256  = 632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E
```

哈希硬编码在 SKILL.md。**改契约文件 = 契约变更**，必须先有 DEC 并同步哈希。不要顺手改。

## 3.8 其他既有决策

- **DEC-027**：路线 B 是唯一主线；A 只读参考，C 的语义已并入 B。
- 稳定 ID（`REQ-* CASE-* DEC-* I-* CHG-* EV-* RISK-* DEBT-*`）**一旦分配永不重命名、永不复用**。

---

# 第四部分：你的第一件事 —— 收尾 CORE-SECRET-ACL-001

## 4.1 缺陷本体

`core-runtime.ts` 的 `powershell()` 会 spawn Windows PowerShell 5.1 去给 authority secret 文件设置并审计严格 ACL（owner=当前用户、ACL protected、恰好 3 条 FullControl 规则：当前用户 / `S-1-5-18` / `S-1-5-32-544`）。

它原来用 `{ ...process.env, DIET_SECRET_PATH: path }` 传环境，**整份继承父进程**。父进程是 pwsh 7 时：

```
PSModulePath 首位 = pwsh 7 的 Core-only Microsoft.PowerShell.Security
  → PS 5.1 命中它并拒绝加载（CouldNotAutoloadMatchingModule）
  → Get-Acl / Set-Acl 从子 shell 消失
  → invalid("secret","permissions") → CORE_RUNTIME_SECRET_INVALID
  → 一切写入路径失败（全量测试 45 例失败）
```

**用户可见影响**：从 pwsh 7 终端启动饮食管家，产品完全不可用。而项目自己的验证器强制要求 pwsh ≥ 7，所以 `product:validate` 在修好之前永远出不了门。

## 4.2 已做的修复（在工作树里，未提交）

`src/application/core-runtime.ts`：

- 新增 `childEnvironment(overrides)` 辅助函数——先按**大小写无关**剔除同名键，再套用覆盖值。这解决了 §1.4 那层 `PSMODULEPATH` vs `PSModulePath` 双键问题。
- `powershell()` 改用 `childEnvironment({ PSModulePath: <5.1 系统模块目录>, DIET_SECRET_PATH: path })`，把模块搜索路径钉到 Windows PowerShell 自己的系统模块目录。

为什么是"钉住"而不是"删除"：删除会让 PS 从注册表重建（也能工作），但钉住是确定性的，并且顺带让用户可写的模块目录无法劫持这个安全审计所依赖的 cmdlet。
（实测 PS 5.1 仍会自行前置 `C:\Program Files\WindowsPowerShell\Modules`，该目录仅管理员可写，可接受，不在本次范围内处理。）

## 4.3 已验证 / 未验证（**如实区分，不要当成已完成**）

| 项 | 状态 |
|---|---|
| RED 观察到且原因正确（`CORE_RUNTIME_SECRET_INVALID`） | ✅ |
| 新回归测试 `tests/runtime-secret-acl-module-path.test.ts` GREEN | ✅ |
| `tsc -p tsconfig.json --noEmit` | ✅ 通过 |
| 邻接回归 | ❌ **未跑** |
| 全量测试（31/959） | ❌ **未跑** |
| pwsh 7 下全量测试 | ❌ **未跑**（这是本修复的真正验收） |
| 缺陷登记文档 | ❌ **未写** |
| commit | ❌ **未提交** |

## 4.4 你要做的（按序）

1. 跑**邻接回归**。已确认包含 `CORE_RUNTIME_SECRET` 断言的文件：
   `tests/runtime-authority-round2.test.ts`、`tests/acceptance/core-application.test.ts`、`tests/acceptance/backup-restore.test.ts`、`tests/acceptance/pantry-application.test.ts`。
   同域建议一并跑（未逐一核对内容）：`tests/runtime-toctou.test.ts`、`tests/server-authority.test.ts`。
2. 跑**全量测试**，在 **PS 5.1 和 pwsh 7 两种 shell 下各跑一次**，都应 `31 文件 / 959+1 用例` 全绿。pwsh 7 那次是本修复的真正验收——历史上它是 45 例失败。
3. 写缺陷登记 `docs/work-items/CORE-SECRET-ACL-001-root-cause.md`，格式参考同目录 `MIXED-LIQUID-001-root-cause.md`（真实症状 / 设计期望 / 根因 / TDD RED / GREEN / 最终验证）。
4. 走 DoD 8 问（§6.2）。
5. 提交，范围恰好是：`src/application/core-runtime.ts`、`tests/runtime-secret-acl-module-path.test.ts`、`docs/work-items/CORE-SECRET-ACL-001-root-cause.md`。
   **不要**把 §2.3 里其他未提交文件混进这个 commit。

---

# 第五部分：剩余任务清单

下面是**索引**，执行时读主干计划原文对应章节（已标行号）。

## 阶段 0 — 权威统一与可重复基线

| Task | 内容 | 行号 | 状态 |
|---|---|---|---|
| 1 | 归档旧计划并建立 0.1.1 阶段台账 | 76 | ✅ `0294d67` |
| 2 | 固化环境预检和完整产品基线 | 160 | 🔶 半成品，原被 CORE-SECRET-ACL-001 阻塞 |

**Task 2 收尾清单**：CORE-SECRET-ACL-001 提交后 → 跑 `product:validate` 全绿 → 产出 `docs/evidence/product-0.1.1/stage-0-baseline.json` → 台账阶段 0 `DONE`、阶段 1 `IN_PROGRESS` → 提交。

注意 `expected-gates.json` 的 `min_tests: 959` 在新增测试后要不要抬高：**基线是下限而非等式**，新增用例后全量数会变成 960。是否同步抬高阈值属于 Task 2 的判断，做了就在提交信息里写清。

### 已有的验证器资产（可直接用，不要重写）

`shared/validate-product-0.1.ps1` 已实现：

- **预检（只读）**：pwsh ≥ 7、`Microsoft.PowerShell.Security` 可导入、Node 24 且 minor ≥ 15、pnpm、git、openclaw（PATH 或插件本地 `node_modules\.bin\openclaw.CMD`）、`-EvidencePath` 必须落在 `docs\evidence\product-0.1.1` 之下。任一缺失 → `ENVIRONMENT_BLOCKED:{node|pnpm|openclaw|git|powershell|powershell_security}`
- `-PreflightOnly` 输出压缩 JSON（`schema_version = diet-manager/product-validation/v1`，含 `node_major`、`powershell_security_module`、`secret_value_count = 0`）
- **保护文件前后清单对比**（`*.sqlite` / `*-wal` / `.env` / `*authority-secret*` 等），出现新增即失败
- **有序门**：`typescript_noemit` → `vitest_full` → `build` → `openclaw_build_check` → `openclaw_validate` → `governance`
- 解析 `Test Files N passed` / `Tests N passed` 并对 `expected-gates.json` 阈值断言
- 写脱敏证据 JSON

`shared/tests/validate-product-0.1-contract.ps1` 是它的契约测试（覆盖 `PRODUCT_VALIDATOR_MISSING`、`PRODUCT_VALIDATOR_SCHEMA`、`ENVIRONMENT_BLOCKED:node`、`ENVIRONMENT_BLOCKED:powershell_security`、`PRODUCT_VALIDATOR_SECRET_OUTPUT`、越界 `-EvidencePath` 拒绝），当前 PASS（输出 `PRODUCT_VALIDATOR_CONTRACT_OK`）。

## 阶段 1 — 0.1.0 合规闭环（修 CORE-UNDO-001）

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 3 | 增加撤销候选语法和明确目标引用 | 245 | parser 层，纯函数 |
| 4 | 建立认证的同会话纠正目标解析 | 333 | 新文件 `src/repository/correction-target.ts` |
| 5 | 公开接通 `undo_record` 并禁止二次撤销恢复 | 414 | 拆掉 `core-runtime.ts:1127` 的白名单闸门；**第二次撤销绝不能映射成"恢复"** |
| 6 | 完成撤销故障、重放、并发和阶段门 | 511 | 故障矩阵 + **双进程真并发** + 阶段出口门 |

`core-runtime.ts:1127` 当前形态（Task 5 要动的就是它）：

```ts
if (!["record_meal", "record_water", "add_inventory", "correct_record"].includes(request.action)) {
  return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
}
```

## 阶段 2 — 完整 0.1 业务补齐（修 PURCHASE-MULTI-001 + CLARIFICATION-001）

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 7 | 泛化有界的单层包装采购语法 | 580 | **有界**：1–64 项、整数数量；拒绝 0 / 65 / 2.5 → `amount_ambiguous` |
| 8 | 多商品逐项解析与一次性澄清 | 646 | 全有或全无解析 + `missing_items` 一次性澄清 |
| 9 | 把多商品采购收口到单一 SQLite 事务 | 719 | 新文件 `src/repository/purchase-envelope-commit.ts`，**单个 BEGIN IMMEDIATE** |
| 10 | 公开接通餐食数量和发生时间纠正 | 810 | |
| 11 | 公开接通白水分类与库存位置纠正 | 887 | |
| 12 | 收紧查询、六域进度和 Skill 回执真值并关闭阶段 2 | 943 | 阶段出口门 |

`src/parser/purchase.ts` 现状是**冻结例句正则**，例如：

```ts
if (/^(?:我\s*)?买了两箱牛奶[，,]每箱12盒[，,]每盒250ml[。.]?$/u.test(source)) { ... }
```

Task 7/8 就是把它演进成**有界语法**。三级演进策略（冻结例句 → 有界语法 → 开放语法）与放宽检查清单见 `docs/维护与迭代路线图.md`。

⚠️ **放宽解析边界时必须同步确认 fail-closed 分支仍然可达。** MIXED-LIQUID-001 的根因正是"边界收紧导致 fail-closed 分支不可达，事实被静默吞掉"。

## 阶段 3 — 安装、升级与灾备闭环

| Task | 内容 | 行号 | 关键参数（**不可自行改动**） |
|---|---|---|---|
| 13 | 数据库与 authority secret 的便携加密备份 | 1008 | 新文件 `src/storage/portable-backup.ts`；格式 `diet-manager/portable-backup/v1`；scrypt N=32768 r=8 p=1；AES-256-GCM；32 字节 salt；12 字节 IV；GCM AAD 覆盖规范化明文头；拒绝 >512 MiB；口令 12–1024 UTF-8 字节 |
| 14 | 安全交互式灾备 CLI | 1097 | 新文件 `src/admin/passphrase.ts`；**仅 TTY**；`DIET_ADMIN_TTY_REQUIRED`；口令不得走 argv / 环境变量 |
| 15 | 事务式安装、升级、回滚、保留数据卸载 | 1157 | `scripts/install-diet-manager.ps1`；版本号在此提升到 0.1.1 |

## 阶段 4 — 真实环境产品验收（**需用户参与**）

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 16 | 真实 OpenClaw 验收场景、执行器和证据结构 | 1233 | |
| 17 | 不可变候选构建与校验工具 | 1299 | `build-release.ps1` + `validate-release.ps1`；`candidate-NNN` **永不覆盖** |
| 18 | 构建一次候选并执行真实 Gateway / USDA / 恢复验收 | 1358 | 需**用户提供 FDC_API_KEY**（只进 Gateway 服务进程环境）；需**用户显式签收**；证据覆盖 online / missing-key / offline / timeout / ops |

## 阶段 5 — 不可变候选与正式发布

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 19 | 原样晋级已验收候选并发布 0.1.1 | 1437 | **逐字节**复制到 `releases/v0.1.1` + tag；push 到 GitHub 需用户另行明示 |

## 最终完成判定

见主干计划第 1518 行"最终完成判定"八条：六阶段全 DONE / 真实证据绑定候选 SHA / 用户签收 / `releases/v0.1.1` 与候选逐字节一致 / 工作树干净 / tag 就位 / 零 secret 泄露。

---

# 第六部分：本机执行机制

## 6.1 每个 shell 会话先注入 PATH（工具不在系统 PATH）

```powershell
$nodeDir = 'C:/Users/10481/AppData/Local/Temp/diet-manager-validation-node-24.15.0/node-v24.15.0-win-x64'
$env:Path = "$nodeDir;C:\Program Files\Git\cmd;$env:Path"
```

- 该目录含 node **24.15.0** + corepack 激活的 pnpm **11.22.0**
- git **2.55** 在 `C:\Program Files\Git\cmd\git.exe`
- pwsh **7.6.5** 是 MSIX：`C:\Users\10481\AppData\Local\Microsoft\WindowsApps\pwsh.exe`（**不在** `C:\Program Files\PowerShell\7\`）
- ⚠️ **用户级 PATH 持久化被权限策略拒绝**，只能用会话内 `$env:Path`
- ⚠️ **绝不把这个临时 Node 路径写进任何仓库脚本**。脚本只依赖"PATH 里有工具"，缺失时报 `ENVIRONMENT_BLOCKED:*`

## 6.2 标准命令

```powershell
Set-Location 'E:\codx\skill\饮食管家\version-b-lite-plugin'
pnpm exec vitest run <files> --maxWorkers=1 --minWorkers=1 --no-file-parallelism   # 定向测试
pnpm exec vitest run --maxWorkers=1 --minWorkers=1                                  # 全量（约 3 分钟）
pnpm exec tsc -p tsconfig.json --noEmit                                             # 类型门
pnpm run build                                                                      # 再生 dist（仅任务要求时）
pnpm run plugin:validate                                                            # OpenClaw 插件校验
pnpm run product:validate                                                           # 全产品门禁（阶段出口）
node ..\shared\tests\validate-product-0.1.1-governance.mjs                          # 治理门
```

测试环境事实：仓库**没有** vitest 配置文件 → 默认 `forks` 池 + `isolate`，每个测试文件独立子进程。所以在单个测试文件里改 `process.env`（用完在 `finally` 里还原）不会串味到其他文件。

## 6.3 六个必须规避的机制坑

1. **默认 shell 是 Windows PowerShell 5.1**：没有 `&&` / `||`，没有三元运算符。
2. **中文路径逐个传给 `git add` 会静默失败**（只提交一部分且不报错）。用 `git add -A`，或先 `Set-Location` 再用相对路径，**提交后必须 `git status` 复核**。曾因此产生残缺提交，靠 `git commit --amend` 补救。
3. **批处理 shim（`pnpm.CMD` 等）从 PowerShell 接收数组参数会被拆坏**（表现为 `'exec' is not recognized` / `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`）。统一走单字符串：
   ```powershell
   $joined = $commandLine -join ' '
   $output = & cmd.exe /d /s /c $joined 2>&1
   ```
4. **中文路径进 `cmd` 有编码风险**：治理门改用**仓库相对路径**调用即可绕过。
5. **git 用绝对路径调用**（`C:\Program Files\Git\cmd\git.exe`），除非已注入 PATH。
6. **`{ ...process.env, KEY: v }` 在 Windows 上不是可靠覆盖**（§1.4）。必须先按大小写无关剔除同名键。

## 6.4 本机不可用的东西

- **`python` 不可用**（只有 Microsoft Store 的占位 shim）。不要用 python 写脚本或做文本处理。
- 用户级 PATH 修改、装软件：需用户明示。

---

# 第七部分：流程细则

## 7.1 WIP=1 怎么落地

台账 `docs/work-items/PRODUCT-0.1.1-ledger.json` 中**恰好一个** stage 为 `IN_PROGRESS`，由 `shared/tests/validate-product-0.1.1-governance.mjs` 机器断言。开新阶段前工作树必须干净。

这不是形式主义：它让任何一次上下文中断后，续接者读台账 + `git log` 就能精确恢复"下一步做什么"。

## 7.2 DoD 自查（提交前 8 问，全部要能答"是"）

1. 涉及的 REQ 的 Given/When/Then 都变成测试且绿了吗？
2. 涉及的不变式 I-1..I-8 断言绿了吗？
3. commit SHA 可定位吗（已提交，范围恰好是任务清单）？
4. 证据指向**真实产物**（测试输出精确数字 / commit SHA / 文件 SHA-256）而不是复述"已通过"吗？
5. 台账仍然**恰好一个** `IN_PROGRESS` 吗？
6. 新增债务了吗？登记了吗？
7. 相关 RISK 复核了吗？
8. 是否动了不该动的文档？

## 7.3 证据（EV）书写规范

- 位置：`docs/evidence/EV-YYYYMMDD-NNN-<slug>.md`，或阶段证据 `docs/evidence/product-0.1.1/*.json`
- 必须指向不可变产物：commit SHA、测试输出精确数字（文件数 / 用例数 / exit code）、文件 SHA-256
- **禁止只写"已通过"**；禁止把可编辑文本当证据
- 稳定 ID 一旦分配永不重命名、永不复用

## 7.4 上下文即将耗尽时

提交已完成的最小闭环 → 更新台账 → 把"下一步"写进台账或报告。**不要**留下"改了一半没提交、台账还指向旧状态"的状态。

---

# 第八部分：约束全表

## 8.1 目录与文件禁区

| 禁区 | 规则 |
|---|---|
| `releases/v0.1` | **只读**。任何测试、构建、验收都不得修改 |
| `docs/archive/` | 只读，且**不得被新任务引用为依据** |
| `shared/contracts/` 契约文件 | 改动 = 契约变更，必须先有 DEC，并同步 SKILL.md 哈希 |
| `dist/` | **不得手改**。需要交付产物时由正式 `pnpm run build` 再生 |

## 8.2 过程红线

- 先写失败测试，确认失败原因，再写最小实现。**禁止把测试改成适配错误行为。**
- 测试失败 → 修实现，或停下报告用户；**绝不放宽断言**。
- **不增加运行时依赖。** 确需时先新增并批准 DEC，随后重开受影响任务。
- **WIP=1**；开新任务前工作树干净。
- 每个任务**只提交主干计划为它列出的范围**。
- 依赖安装采用 `--ignore-scripts`；**不要对来源不明的依赖运行 `pnpm approve-builds`**。

## 8.3 Secret 与数据红线（原文照录）

> **authority secret、`FDC_API_KEY`、Gateway 凭据、备份口令和真实饮食内容不得进入参数列表、普通环境清单、日志、Git 或发布包。**

- API key 不要写入聊天、插件 JSON 或仓库。
- 不要把访问令牌写入 clone URL、配置文件或日志。
- 备份口令只经 TTY 读取（Task 14），不得走 argv / 环境变量。
- **测试只用 `.tmp/` 或 `os.tmpdir()` 下的隔离测试根，绝不碰正式数据根。**

## 8.4 业务红线

- **营养数值永不由 AI 生成**；只能 `unknown` 或白名单来源引用（DEC-029）。
- `unknown` 必须保持 `null` 直到展示层写"未知"；所有 nullable 数量显式分支。
- 撤销走 append-only `void_event`，**不 DELETE 事实**（I-2）。
- 库存**仅唯一匹配才扣减**，歧义即澄清（I-4）。
- **B 是唯一主线**（DEC-027）。

## 8.5 需要用户参与的节点（不得自行决定）

| 节点 | 需要什么 |
|---|---|
| 阶段 4 真实验收 | 用户提供 `FDC_API_KEY`（只进 Gateway 进程环境） |
| 发布候选接受 | **用户显式签收** |
| push 到 GitHub / 推 tag | 用户另行明示 |
| 改系统环境（PATH、装软件） | 执行前确认 |

---

# 第九部分：已付学费的坑（按成本排序）

1. **解析边界吞事实**（MIXED-LIQUID-001）："识别到"和"可提交"是**两个状态**。实体识别到但证据不完整时，必须显式保留证据并 fail-closed，否则下游永远发现不了遗漏。
   - 根因：`src/parser/liquid.ts:18` 的 `DIRECT_OR_COORDINATED_WATER` 正则把数值 `ml` 设为必需，导致"类别已识别但未量化"的白水从未进入 `resolveWaterFrames(...).self_matches`，`parse-command.ts:453-470` 的混合 fail-closed 分支**不可达**。
   - 改 parser **必读** `docs/work-items/MIXED-LIQUID-001-root-cause.md`。
2. **Windows 环境变量覆盖假象**（CORE-SECRET-ACL-001）：`{ ...process.env, KEY: v }` 会留下大小写不同的原键，子进程解析到旧值。见 §1.4。
3. **`Number(null) === 0`**：把"未知营养"静默变成"零热量"。
4. **重放零写入的证明**：必须对**全部业务表**做规范快照 SHA 比较；行数统计抓不到 UPDATE / DELETE。
5. **假并发**：并发测试必须真 worker threads + 独立 SQLite 连接 + 启动屏障。
6. **JS 日期自动滚动**：2 月 31 日会被 `Date` 悄悄变成 3 月；先做 roundtrip 校验。
7. **中文进 ASCII 幂等键**：中文名称必须用规范摘要（SHA-256）派生内部 ID。
8. **PS 5.1 中文路径逐个传 git**：静默漏提交。
9. **fixture 与生产权威不一致**：修 fixture，**绝不放宽生产校验**。
10. **`committed_with_issues` ≠ 可重试**：事实已提交，不得重复提交同一事实。
11. **dist 与 src 漂移**：改 src 后若任务要求交付产物，必须正式 build 再生 dist。
12. **"环境问题"可能是产品缺陷的伪装**：把失败归因给环境之前，先拿到真实错误码和子进程 stderr。CORE-SECRET-ACL-001 差一步就被误判掉。

---

# 第十部分：接手第一步（照此顺序）

```
1. 读 docs/AI协作开发手册.md（比本文档更贴近日常操作）
2. 读 START-HERE.md 确认权威链
3. 看 docs/work-items/PRODUCT-0.1.1-ledger.json → 确认阶段 0 IN_PROGRESS
4. git status --short → 与本文档 §2.3 逐项核对（应完全一致）
5. git log --oneline -5 → 顶部应为 0294d67
6. 注入 PATH（§6.1），在 PS 5.1 下跑一次全量测试确认基线未漂移
7. 执行第四部分：收尾 CORE-SECRET-ACL-001（含 pwsh 7 下全量验收）→ 提交
8. 收尾阶段 0 Task 2 → 台账推进 → 进入阶段 1
```

**开工前请确认你能回答**：本次要做哪一个任务？它在主干计划第几行？它列出的文件清单是什么？失败测试打算怎么写？
四个问题里有任何一个答不上来，就不要开始改代码。

---

## 附录 A：技术栈与版本

| 项 | 版本 |
|---|---|
| Node | 24.15.x（`engines: >=24.15.0 <25`） |
| 数据库 | `node:sqlite`（**无第三方 DB 依赖**） |
| 测试 | Vitest 2.1.9（无配置文件，默认 forks + isolate） |
| 语言 | TypeScript |
| Shell | 验证器要求 PowerShell 7；默认会话是 PS 5.1 |
| OpenClaw | 2026.7.1 |
| 加密 | AES-256-GCM + scrypt（阶段 3 实现） |
| 摘要 | SHA-256 |

## 附录 B：关键文件索引

| 路径 | 作用 |
|---|---|
| `饮食管家-开发约束与需求-v1.0.md` | **需求唯一权威** |
| `docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md` | **执行主干**，19 任务全部命令/测试代码/提交范围 |
| `docs/work-items/PRODUCT-0.1.1-ledger.json` | 阶段状态机器权威 |
| `docs/AI协作开发手册.md` | 日常操作手册（接手先读） |
| `docs/架构与开发思路.md` | 架构与设计取舍 |
| `docs/维护与迭代路线图.md` | 0.1.1 之后版本线、债务清单、解析器演进策略 |
| `docs/work-items/MIXED-LIQUID-001-root-cause.md` | 改 parser 前必读 |
| `docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md` | 真实验收报告，4 缺陷来源 |
| `shared/tests/validate-product-0.1.1-governance.mjs` | 治理门 |
| `shared/validate-product-0.1.ps1` | 产品门禁验证器 |
| `version-b-lite-plugin/src/application/core-runtime.ts` | 应用层唯一实现（1744 行）；`:1127` 是 Task 5 要拆的闸门；`powershell()` 是 CORE-SECRET-ACL-001 现场 |
| `version-b-lite-plugin/src/parser/purchase.ts` | 冻结例句正则（Task 7/8 要泛化） |
| `version-b-lite-plugin/tests/runtime-secret-acl-module-path.test.ts` | CORE-SECRET-ACL-001 回归测试 |

---

**文档结束。v2.0，对应基线 `0294d67` + 工作树中的 CORE-SECRET-ACL-001 修复。**
状态推进后请新建 v2.1，不要原地覆盖——本仓库惯例是版本化文档不可变。
