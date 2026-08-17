# 饮食管家 B — Codex 开发交付说明 v1.0

> ⛔ **本文件已过期，不要使用。** 请改读 `饮食管家-Codex开发交付说明-v2.0.md`。
> 特别提醒两处已过时的硬事实：
> 1. 正文多处引用的 `core-runtime.ts:1110`（`ACTION_NOT_IMPLEMENTED` 白名单闸门）行号，已因 CORE-SECRET-ACL-001 修复新增 `childEnvironment()` 助手而漂移到 **`:1127`**；`core-runtime.ts` 当前 **1744 行**（原文写 1733）。
> 2. §3.4 关于"疑似 pwsh 7 环境问题、建议排查 locale、可能归类 ENVIRONMENT_BLOCKED"的结论**已被实测推翻**——真实原因是产品缺陷 CORE-SECRET-ACL-001（PSModulePath 继承 + `{...process.env}` 在 Windows 的键名大小写陷阱）。

| 项 | 值 |
|---|---|
| 文档版本 | **v1.0** |
| 目标产品版本 | **0.1.1**（当前已发布并冻结的是 0.1.0） |
| 编写时间 | 2026-08-16 |
| 编写者 | Claude Code（会话 `aed1a179`）交接给 Codex |
| 仓库 | `E:\codx\skill\饮食管家`（git，分支 `main`） |
| 交接基线 commit | `0294d67 docs: unify product 0.1.1 authority` |

---

## 0. 这份文档是什么，怎么用

这是一份**交接开发说明**，写给接手继续开发的 AI（Codex）。它回答五个问题：

1. **要做什么**（目标与范围）→ §1、§2
2. **需要做什么**（剩余工作清单，逐阶段逐任务）→ §5
3. **我原本打算怎么做**（方法论与判断依据）→ §4
4. **具体该怎么做**（可直接执行的机制、命令、踩坑规避）→ §6、§7
5. **约束是什么**（红线，违反即返工）→ §8

**权威优先级（冲突时按此顺序服从，不要自行折中）：**

```
1. 仓库根《饮食管家-开发约束与需求-v1.0.md》        ← 需求与不变式的唯一权威
2. docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md  ← 执行主干（19 任务原文，含测试代码与提交范围）
3. docs/work-items/PRODUCT-0.1.1-ledger.json         ← 阶段状态的机器权威
4. 本文档（v1.0）                                     ← 思路、机制、交接现状
```

本文档**不复制**主干计划的任务原文。主干计划已把每个任务的文件清单、接口签名、失败测试代码、执行命令、提交范围逐条写死，共 1529 行。**执行时以主干计划原文为准**，本文档负责让你理解"为什么这么排"以及"在这台机器上怎么跑得通"。

---

## 1. 产品是什么（一句话到一段话）

**饮食管家 B** 是一个"Skill 即入口 + SQLite 唯一业务后端"的个人饮食记录助手。用户用自然语言说"我早上吃了两个鸡蛋"、"买了两箱牛奶每箱12盒"、"撤销刚才那条"，系统把它变成**可审计、可撤销、可追溯**的结构化事实，并维护库存扣减、饮水、营养进度。

分层（严格单向依赖，上层不得被下层引用）：

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

**核心设计立场**：适配层永远是薄的。OpenClaw / MCP 任何一层都不得重复业务判断，否则同一语义会在两处漂移。这条立场是不可协商的架构约束，不是风格偏好。

### 1.1 八条不变式 I-1..I-8（机器可校验，每条都有测试）

| ID | 不变式 | 为什么 |
|---|---|---|
| I-1 | 事实优先：先落事实，再算派生 | 派生值可重算，事实不可重建 |
| I-2 | 绝不写未发生的事：撤销用 append-only `void_event`，不 DELETE | 审计链不能有空洞 |
| I-3 | unknown ≠ 0 | `Number(null) === 0` 会把"未知营养"写成"零热量"，是最危险的静默错误 |
| I-4 | 库存非负 + 仅唯一匹配才扣减 | 歧义时宁可澄清，不可猜着扣 |
| I-5 | 原文逐字保留 | 任何解析都可能错，原文是唯一可回溯的真值 |
| I-6 | 幂等来自业务语义，不来自请求 ID | 同一事实重复提交必须被业务语义识别 |
| I-7 | 有界原子性（见 §1.2） | 全局大事务会把可恢复失败升级成不可恢复失败 |
| I-8 | 全链可追溯 | 每条派生值都能回溯到事实与原文 |

### 1.2 三层事务模型（DEC-023，**有界启用**）

```
FactCommit        单个 BEGIN IMMEDIATE，只写事实           ← 默认，优先只用这一层
EffectBundle      必要副作用原子化（如库存扣减 + 事实）      ← 仅当副作用与事实必须同生共死
EnvelopeFinalize  累计量/回执冻结，重放稳定                 ← 仅当需要可重放的对外回执
```

**规则：能只用一层就只用一层。** 见到任务要求"单一 BEGIN IMMEDIATE"（如 Task 9），就是这条规则的具体化。

### 1.3 五种 Outcome 语义（Skill 与测试都依赖它的精确含义）

| status | 含义 | 是否已写入 | 能否重试 |
|---|---|---|---|
| `committed` | 事实已提交，副作用完整 | 是 | 不需要 |
| `committed_with_issues` | **事实已提交**，副作用降级 | 是 | **绝对不可重复提交同一事实** |
| `needs_clarification` | 零写入 + 一个具体问题 | 否 | 用户补充后重提 |
| `ignored` | 计划/否定/只读语句，零写入 | 否 | — |
| `failed` | 技术失败，零业务写入，允许脱敏技术日志 | 否 | 可重试 |

`committed_with_issues` 被误当成"失败可重试"是最容易造成重复记账的坑，已列入手册第 9 条。

### 1.4 营养白名单（DEC-029，红线）

营养数值**只能**来自三个来源：权威数据库（USDA FoodData Central 已接入，CFCT 规划中）、用户自建库、标签 OCR。**AI 永远不得凭知识生成任何营养数字**；解析不到就是 `unknown`，展示层写"未知"。这条一旦破防，整个产品的可信度归零。

### 1.5 冻结契约

```
contract_id      = diet-manager/contract-v2
contract_version = 2
contract_sha256  = 632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E
```

哈希硬编码在 SKILL.md 里。**改契约文件 = 契约变更**，必须先有 DEC 决策记录，并同步更新 SKILL.md 中的哈希。不要顺手改。

---

## 2. 本轮目标：0.1.1 要交付什么

用户已明确批准的范围是"**全部推到底**"：

1. **修完真实验收发现的 4 个缺陷**（§3 有状态表）
2. **补齐完整 0.1 业务**：撤销、纠正、多商品采购、查询与回执收口
3. **完成安装 / 升级 / 加密灾备闭环**
4. **通过真实环境验收**（真实 OpenClaw + 真实 USDA Gateway）
5. **发布不可变 0.1.1**（逐字节晋级 + tag）

同时用户要求过程"**完整遵循**"仓库既有严格流程：WIP=1、DoD 8 条、EV 证据链、复核报告、TDD 先红后绿。这不是可选的仪式——它是这个仓库能在长上下文断裂后无损续接的唯一机制。

### 最终完成判定（八条，全部成立才算完）

见主干计划第 1518 行"最终完成判定"。摘要：六阶段全 DONE / 真实证据绑定候选 SHA / 用户签收 / `releases/v0.1.1` 与候选逐字节一致 / 工作树干净 / tag 就位 / 零 secret 泄露。

---

## 3. 交接时的真实状态（**必须先核对，不要假设**）

### 3.1 已完成并提交

| commit | 内容 |
|---|---|
| `0294d67` | **阶段 0 Task 1 完成**：归档 4 份历史计划到 `docs/archive/legacy-plans/`、建立 `PRODUCT-0.1.1-ledger.json`、治理测试 `shared/tests/validate-product-0.1.1-governance.mjs`、README/START-HERE/开发进度 统一指向 v1.0 权威（11 文件 / 94 插入） |
| `01b1f8e` | **MIXED-LIQUID-001 已修复**（"喝了豆浆和白水"丢失白水） |
| `6772061` | 0.1.0 发布装配（`releases/v0.1`，**只读**） |

**已验证基线**：全量 vitest `31 文件 / 959 用例 全绿`（在 Windows PowerShell 5.1 + 直接 node 环境下）。这是 `expected-gates.json` 里 `min_test_files: 31` / `min_tests: 959` 的来源。

### 3.2 未提交的工作树内容（阶段 0 Task 2 的半成品，**可安全接续**）

```
 M version-b-lite-plugin/package.json                        （新增 "product:validate" 脚本）
?? shared/validate-product-0.1.ps1                            （产品门禁验证器，主体已写完）
?? shared/tests/validate-product-0.1-contract.ps1             （验证器契约测试，当前 PASS）
?? shared/tests/fixtures/product-validation/expected-gates.json（门清单与基线阈值）
?? docs/架构与开发思路.md                                     （交付文档初版）
?? docs/维护与迭代路线图.md                                   （交付文档初版）
?? docs/AI协作开发手册.md                                     （交付文档初版，**接手先读这份**）
```

台账 `PRODUCT-0.1.1-ledger.json` 中阶段 0 仍是 `IN_PROGRESS`，其余 `NOT_STARTED`。状态是自洽的，续接零损失。

### 3.3 四个已知缺陷的当前状态

| 缺陷 ID | 现象 | 状态 | 归属任务 |
|---|---|---|---|
| MIXED-LIQUID-001 | "喝了豆浆和白水" 静默丢弃白水 | **已修复已提交**（`01b1f8e`） | — |
| CORE-UNDO-001 | `undo_record` 未接通，被 `ACTION_NOT_IMPLEMENTED` 拦住 | 待做（领域/存储层 `void_event` 已完整，缺 parser + runtime 接线） | 阶段 1 Task 3–6 |
| PURCHASE-MULTI-001 | 多商品采购解析失败（当前是冻结例句正则） | 待做 | 阶段 2 Task 7–9 |
| CLARIFICATION-001 | 澄清只覆盖两条硬编码句子 | 待做 | 阶段 2 Task 7–8 |

缺陷来源：`docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md`（真实 6 实例 OpenClaw 验收）。

### 3.4 ⚠️ 唯一未解决的阻塞点（阶段 0 Task 2）

**现象**：全量 vitest 在 **pwsh 7** 下运行会出现 45 例假失败，同样的命令在 **Windows PowerShell 5.1** 下全绿。

```
pwsh 7:   Test Files  8 failed | 23 passed (31)
          Tests      45 failed | 914 passed (959)
典型失败: tests/acceptance/pantry-application.test.ts:757
          > rejects a tampered child purchase fact on finalized replay without another write
          AssertionError: expected false to be true
```

**已做的隔离实验（结论明确，不要重做）**：

| 组合 | 结果 |
|---|---|
| A) PS 5.1 + 直接调 node | **PASS** |
| B) pwsh 7 + 直接调 node | **FAIL**（同样 45 例） |
| C) PS 5.1 + `cmd /c pnpm exec` | **PASS** |

→ 触发因素是 **pwsh 7 这个执行环境本身**，与 pnpm、cmd shim、文件并行度（已试 `--no-file-parallelism`，无效）都无关。

**建议排查路径**：
1. 对比两种 shell 的进程环境差异（`Get-ChildItem Env:` 逐项 diff），重点看 locale/代码页（`chcp`）、`NODE_OPTIONS`、`TMP`/`TEMP`、`PSModulePath`。失败用例是"重放篡改检测"，高度怀疑与**编码/规范化**（中文 → 规范摘要 SHA-256）或**临时目录路径**相关。
2. 若确认是环境差异（编码/临时路径）而非产品缺陷，**按主干计划的既定分类处理为 `ENVIRONMENT_BLOCKED:*`**，由验证器显式报告并拒绝出证据，而不是把它当产品 bug 去改实现，更不是放宽测试。
3. 若排查后发现是真实产品缺陷（例如实现确实依赖了进程 locale），那就**登记为新缺陷 + 写失败测试 + 修实现**，并把它插进阶段 0 之后、阶段 1 之前。

**判据**：`shared/validate-product-0.1.ps1` 自身要求 pwsh ≥ 7（`ENVIRONMENT_BLOCKED:powershell`），所以这个问题必须解决，否则阶段 0 出不了门。这是接手后的**第一个待办**。

---

## 4. 我打算怎么做（方法论与判断依据）

### 4.1 为什么执行仓库既有主干计划，而不另写一份

摸底时发现仓库里已有一份 2026-08-15 批准的分段实施计划（19 任务 / 6 阶段），它与"全部推到底"的目标完全吻合，且已把每任务的文件清单、接口、失败测试代码、命令、提交范围写死。**另起炉灶会制造第二份权威，直接违反"恰好一个执行主干"的治理原则。** 因此本轮的定位是：执行它、在它的框架内补齐环境与文档，不改它的任务边界。

若执行中发现主干计划与代码现实矛盾（例如"计划说 X，代码是 Y"）：**停下来报告用户，不要自行选一边。** 这一条已付过学费——我曾按计划假设 MIXED-LIQUID-001 未提交，实际 git 显示早已提交，差点做重复工作。

### 4.2 单任务节奏（不可简化）

```
1. 读主干计划里那一个任务的原文（只注入这一个任务的上下文，不要一次读 19 个）
2. 写失败测试（RED）→ 跑它 → 确认失败原因是"行为缺失"
   ⚠️ 不是编译错误、不是导入错误、不是环境错误 —— 错误的 RED 什么都证明不了
3. 写最小实现到 GREEN。禁止顺手重构、顺手修别的
4. 跑四道：定向测试 → 邻接回归（主干计划每任务都列了清单）→ tsc --noEmit → git diff --check
5. git add 任务列出的范围（仅此范围）→ 按主干给定格式 commit
6. 若是阶段最后一个任务：跑 product:validate 出证据 JSON → 更新台账（本阶段 DONE，下阶段 IN_PROGRESS）→ 一起提交
```

### 4.3 WIP=1 是怎么落地的

台账 `PRODUCT-0.1.1-ledger.json` 中**恰好一个** stage 为 `IN_PROGRESS`，由 `shared/tests/validate-product-0.1.1-governance.mjs` 机器断言。开新阶段前工作树必须干净。这不是形式主义：它让任何一次上下文中断后，续接者读台账 + `git log` 就能精确恢复到"下一步做什么"。

### 4.4 上下文即将耗尽时怎么办

提交已完成的最小闭环 → 更新台账 → 把"下一步"写进台账或报告。不要留下"改了一半没提交、台账还指向旧状态"的状态。

---

## 5. 需要做什么：剩余 18 个任务

以下是**索引**，执行时读主干计划原文对应章节（已标行号）。

### 阶段 0 — 权威统一与可重复基线（Task 1–2，Task 1 已完成）

| Task | 内容 | 行号 | 状态 |
|---|---|---|---|
| 1 | 归档旧计划并建立 0.1.1 阶段台账 | 76 | ✅ `0294d67` |
| 2 | 固化环境预检和完整产品基线 | 160 | 🔶 半成品，被 §3.4 阻塞 |

**Task 2 收尾清单**：解决 pwsh 7 阻塞 → `validate-product-0.1.ps1` 全绿 → 产出 `docs/evidence/product-0.1.1/stage-0-baseline.json` → 台账阶段 0 → `DONE`、阶段 1 → `IN_PROGRESS` → 按任务范围提交。

### 阶段 1 — 0.1.0 合规闭环（Task 3–6）→ 修 CORE-UNDO-001

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 3 | 增加撤销候选语法和明确目标引用 | 245 | parser 层，纯函数 |
| 4 | 建立认证的同会话纠正目标解析 | 333 | 新文件 `src/repository/correction-target.ts` |
| 5 | 公开接通 `undo_record` 并禁止二次撤销恢复 | 414 | 拆掉 `core-runtime.ts:1110` 的 `ACTION_NOT_IMPLEMENTED` 白名单闸门；**第二次撤销绝不能映射成"恢复"** |
| 6 | 完成撤销故障、重放、并发和阶段门 | 511 | 故障矩阵 + **双进程真并发**撤销 + 阶段出口门 |

`core-runtime.ts:1110` 当前形态：

```ts
if (!["record_meal", "record_water", "add_inventory", "correct_record"].includes(request.action)) {
  return failedOutcome(request.action, request.operation_id, "ACTION_NOT_IMPLEMENTED");
}
```

### 阶段 2 — 完整 0.1 业务补齐（Task 7–12）→ 修 PURCHASE-MULTI-001 + CLARIFICATION-001

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 7 | 泛化有界的单层包装采购语法 | 580 | **有界**：1–64 项、整数数量；拒绝 0 / 65 / 2.5 → `amount_ambiguous` |
| 8 | 多商品逐项解析与一次性澄清 | 646 | 全有或全无解析 + `missing_items` 一次性澄清 |
| 9 | 把多商品采购收口到单一 SQLite 事务 | 719 | 新文件 `src/repository/purchase-envelope-commit.ts`，**单个 BEGIN IMMEDIATE** |
| 10 | 公开接通餐食数量和发生时间纠正 | 810 | |
| 11 | 公开接通白水分类与库存位置纠正 | 887 | |
| 12 | 收紧查询、六域进度和 Skill 回执真值并关闭阶段 2 | 943 | 阶段出口门 |

**当前 `src/parser/purchase.ts` 是冻结例句正则**，例如：

```ts
if (/^(?:我\s*)?买了两箱牛奶[，,]每箱12盒[，,]每盒250ml[。.]?$/u.test(source)) { ... }
```

Task 7/8 就是把它演进成**有界语法**。演进策略（三级：冻结例句 → 有界语法 → 开放语法）与放宽检查清单见 `docs/维护与迭代路线图.md`。**放宽解析边界时必须同步确认 fail-closed 分支仍可达**——MIXED-LIQUID-001 的根因正是"边界收紧导致 fail-closed 分支不可达，事实被静默吞掉"。

### 阶段 3 — 安装、升级与灾备闭环（Task 13–15）

| Task | 内容 | 行号 | 关键参数（不可自行改动） |
|---|---|---|---|
| 13 | 数据库与 authority secret 的便携加密备份 | 1008 | 新文件 `src/storage/portable-backup.ts`；格式 `diet-manager/portable-backup/v1`；scrypt N=32768 r=8 p=1；AES-256-GCM；32 字节 salt；12 字节 IV；GCM AAD 覆盖规范化明文头；拒绝 >512 MiB；口令 12–1024 UTF-8 字节 |
| 14 | 安全交互式灾备 CLI | 1097 | 新文件 `src/admin/passphrase.ts`；**仅 TTY**；`DIET_ADMIN_TTY_REQUIRED` |
| 15 | 事务式安装、升级、回滚、保留数据卸载 | 1157 | `scripts/install-diet-manager.ps1`；版本号在此提升到 0.1.1 |

### 阶段 4 — 真实环境产品验收（Task 16–18）**需用户参与**

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 16 | 真实 OpenClaw 验收场景、执行器和证据结构 | 1233 | |
| 17 | 不可变候选构建与校验工具 | 1299 | `build-release.ps1` + `validate-release.ps1`；`candidate-NNN` **永不覆盖** |
| 18 | 构建一次候选并执行真实 Gateway / USDA / 恢复验收 | 1358 | 需**用户提供 FDC_API_KEY**（只进 Gateway 服务进程环境）；需**用户显式签收**；证据覆盖 online / missing-key / offline / timeout / ops |

### 阶段 5 — 不可变候选与正式发布（Task 19）

| Task | 内容 | 行号 | 关键点 |
|---|---|---|---|
| 19 | 原样晋级已验收候选并发布 0.1.1 | 1437 | **逐字节**复制到 `releases/v0.1.1` + tag；push 到 GitHub 需用户另行明示 |

---

## 6. 具体该怎么做：本机执行机制（**照抄，已付过学费**）

### 6.1 每个 shell 会话先注入 PATH（工具不在系统 PATH）

```powershell
$nodeDir = 'C:/Users/10481/AppData/Local/Temp/diet-manager-validation-node-24.15.0/node-v24.15.0-win-x64'
$env:Path = "$nodeDir;C:\Program Files\Git\cmd;$env:Path"
```

- 该目录含 node **24.15.0** + corepack 激活的 pnpm **11.22.0**
- git **2.55** 在 `C:\Program Files\Git\cmd\git.exe`
- pwsh **7.6.5** 是 MSIX shim：`C:\Users\10481\AppData\Local\Microsoft\WindowsApps\pwsh.exe`（**不在** `C:\Program Files\PowerShell\7\`）
- ⚠️ **用户级 PATH 持久化被权限策略拒绝**，只能用会话内 `$env:Path`
- ⚠️ **绝不把这个临时 Node 路径写进任何仓库脚本**。脚本只依赖"PATH 里有工具"，缺失时报 `ENVIRONMENT_BLOCKED:*`

### 6.2 标准命令

```powershell
Set-Location 'E:\codx\skill\饮食管家\version-b-lite-plugin'
pnpm exec vitest run <files> --maxWorkers=1 --minWorkers=1 --no-file-parallelism   # 定向测试
pnpm exec vitest run --maxWorkers=1 --minWorkers=1                                  # 全量（约 3 分钟，959 例）
pnpm exec tsc -p tsconfig.json --noEmit                                             # 类型门
pnpm run build                                                                      # 再生 dist（仅任务要求时）
pnpm run plugin:validate                                                            # OpenClaw 插件校验
pnpm run product:validate                                                           # 全产品门禁（阶段出口）
node ..\shared\tests\validate-product-0.1.1-governance.mjs                          # 治理门
```

### 6.3 五个必须规避的机制坑

1. **默认 shell 是 Windows PowerShell 5.1**：没有 `&&` / `||`，没有三元运算符。
2. **中文路径逐个传给 `git add` 会静默失败**（只提交了一部分且不报错）。用 `git add -A`，或先 `Set-Location` 再用相对路径，**提交后必须 `git status` 复核**。曾因此产生残缺提交，靠 `git commit --amend` 补救。
3. **批处理 shim（`pnpm.CMD` 等）从 PowerShell 接收数组参数会被拆坏**（表现为 `'exec' is not recognized` / `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`）。统一走单字符串：
   ```powershell
   $joined = $commandLine -join ' '
   $output = & cmd.exe /d /s /c $joined 2>&1
   ```
4. **中文路径进 `cmd` 有编码风险**：治理门改用**仓库相对路径**调用即可绕过。
5. **git 必须用绝对路径调用**（`C:\Program Files\Git\cmd\git.exe`），除非已注入 PATH。

### 6.4 已有的验证器资产（可直接用，不必重写）

`shared/validate-product-0.1.ps1` 已实现：

- **预检（只读）**：pwsh ≥ 7、`Microsoft.PowerShell.Security` 可导入、Node 24 且 minor ≥ 15、pnpm、git、openclaw（PATH 或插件本地 `node_modules\.bin\openclaw.CMD`）、`-EvidencePath` 必须落在 `docs\evidence\product-0.1.1` 之下。任一缺失 → `ENVIRONMENT_BLOCKED:{node|pnpm|openclaw|git|powershell|powershell_security}`
- `-PreflightOnly` 输出压缩 JSON（`schema_version = diet-manager/product-validation/v1`，含 `node_major`、`powershell_security_module`、`secret_value_count = 0`）
- **保护文件前后清单对比**（`*.sqlite` / `*-wal` / `.env` / `*authority-secret*` 等），出现新增即失败
- **有序门**：`typescript_noemit` → `vitest_full` → `build` → `openclaw_build_check` → `openclaw_validate` → `governance`
- 解析 `Test Files N passed` / `Tests N passed` 并对 `expected-gates.json` 的 `min_test_files: 31` / `min_tests: 959` 做阈值断言
- 写脱敏证据 JSON

`shared/tests/validate-product-0.1-contract.ps1` 是它的契约测试（覆盖 `PRODUCT_VALIDATOR_MISSING`、`PRODUCT_VALIDATOR_SCHEMA`、`ENVIRONMENT_BLOCKED:node`、`ENVIRONMENT_BLOCKED:powershell_security`、`PRODUCT_VALIDATOR_SECRET_OUTPUT`、越界 `-EvidencePath` 拒绝），**当前 PASS**（输出 `PRODUCT_VALIDATOR_CONTRACT_OK`）。

---

## 7. 提交前 DoD 自查（8 问，全部要能答"是"）

1. 涉及的 REQ 的 Given/When/Then 都变成测试且绿了吗？
2. 涉及的不变式 I-1..I-8 断言绿了吗？
3. commit SHA 可定位吗（已提交，范围恰好是任务清单）？
4. 证据指向**真实产物**（测试输出精确数字 / commit SHA / 文件 SHA-256）而不是复述"已通过"吗？
5. 台账仍然**恰好一个** `IN_PROGRESS` 吗？
6. 新增债务了吗？登记了吗？
7. 相关 RISK 复核了吗？
8. 是否动了不该动的文档？

### 证据（EV）书写规范

- 位置：`docs/evidence/EV-YYYYMMDD-NNN-<slug>.md`，或阶段证据 `docs/evidence/product-0.1.1/*.json`
- 必须指向不可变产物：commit SHA、测试输出精确数字（文件数 / 用例数 / exit code）、文件 SHA-256
- 禁止只写"已通过"；禁止把可编辑文本当证据
- **稳定 ID（`REQ-*` `CASE-*` `DEC-*` `I-*` `CHG-*` `EV-*` `RISK-*` `DEBT-*`）一旦分配，永不重命名、永不复用**

---

## 8. 约束（红线，违反即返工）

### 8.1 目录与文件禁区

| 禁区 | 规则 |
|---|---|
| `releases/v0.1` | **只读**。任何测试、构建、验收都不得修改该目录 |
| `docs/archive/` | 只读，且**不得被新任务引用为依据** |
| `shared/contracts/` 契约文件 | 改动 = 契约变更，必须先有 DEC，并同步 SKILL.md 哈希 |
| `dist/` | 不得手改。需要交付产物时由正式 `pnpm run build` 再生 |

### 8.2 过程红线

- **所有功能任务先写失败测试，确认失败原因，再写最小实现。禁止把测试改成适配错误行为。** 测试失败 → 修实现，或报告用户；绝不放宽断言。
- **不增加运行时依赖。** 若实施中确需依赖，先新增并批准 DEC，随后重开受影响任务。
- **WIP=1**：台账恰好一个 `IN_PROGRESS`；开新任务前工作树干净。
- 每个任务**只提交主干计划为它列出的范围**。
- 当前依赖安装采用 `--ignore-scripts`；**不要对来源不明的依赖运行 `pnpm approve-builds`**。

### 8.3 Secret 与数据红线

- **authority secret、`FDC_API_KEY`、Gateway 凭据、备份口令和真实饮食内容不得进入参数列表、普通环境清单、日志、Git 或发布包。**
- API key 不要写入聊天、插件 JSON 或仓库。
- 不要把访问令牌写入 clone URL、配置文件或日志。
- 备份口令只经 TTY 读取（Task 14），不得走 argv / 环境变量。
- **测试只用 `.tmp/` 下的隔离测试根，绝不碰正式数据根。**

### 8.4 业务红线

- **营养数值永不由 AI 生成**；只能是 `unknown` 或白名单来源引用（DEC-029）。
- **`unknown` 必须保持 `null` 直到展示层写"未知"**；所有 nullable 数量显式分支（`Number(null) === 0` 陷阱）。
- 撤销走 append-only `void_event`，**不 DELETE 事实**（I-2）。
- 库存**仅唯一匹配才扣减**，歧义即澄清（I-4）。
- 路线 A 只读参考，路线 C 语义已并入 B；**B 是唯一主线**（DEC-027）。

### 8.5 需要用户参与的节点（不得自行决定）

| 节点 | 需要什么 |
|---|---|
| 阶段 4 真实验收 | 用户提供 `FDC_API_KEY`（只进 Gateway 进程环境） |
| 发布候选接受 | **用户显式签收** |
| push 到 GitHub / 推 tag | 用户另行明示指示 |
| 任何改系统环境的操作（PATH、安装软件） | 执行前确认 |

---

## 9. 已付学费的十个坑（按成本排序）

1. **解析边界吞事实**（MIXED-LIQUID-001）："识别到"和"可提交"是**两个状态**。实体识别到但证据不完整时，必须显式保留证据并 fail-closed，否则下游永远发现不了遗漏。改 parser **必读** `docs/work-items/MIXED-LIQUID-001-root-cause.md`。
   - 根因：`src/parser/liquid.ts:18` 的 `DIRECT_OR_COORDINATED_WATER` 正则把数值 `ml` 设为必需，导致"类别已识别但未量化"的白水从未进入 `resolveWaterFrames(...).self_matches`，`parse-command.ts:453-470` 的混合 fail-closed 分支**不可达**。
2. **`Number(null) === 0`**：把"未知营养"静默变成"零热量"。
3. **重放零写入的证明**：必须对**全部业务表**做规范快照 SHA 比较；行数统计抓不到 UPDATE / DELETE。
4. **假并发**：并发测试必须真 worker threads + 独立 SQLite 连接 + 启动屏障。
5. **JS 日期自动滚动**：2 月 31 日会被 `Date` 悄悄变成 3 月；先做 roundtrip 校验。
6. **中文进 ASCII 幂等键**：中文名称必须用规范摘要（SHA-256）派生内部 ID。
7. **PS 5.1 中文路径逐个传 git**：静默漏提交。
8. **fixture 与生产权威不一致**：修 fixture，**绝不放宽生产校验**。
9. **`committed_with_issues` ≠ 可重试**：事实已提交，不得重复提交同一事实。
10. **dist 与 src 漂移**：改 src 后若任务要求交付产物，必须正式 build 再生 dist。

---

## 10. 接手第一步（照此顺序做）

```
1. 读 docs/AI协作开发手册.md（比本文档更贴近日常操作）
2. 读 START-HERE.md 确认权威链
3. cat docs/work-items/PRODUCT-0.1.1-ledger.json → 确认阶段 0 IN_PROGRESS
4. git status --short → 与本文档 §3.2 逐项核对（应完全一致）
5. git log --oneline -5 → 顶部应为 0294d67
6. 注入 PATH（§6.1），跑一次全量 vitest 在 PS 5.1 下确认 31/959 全绿（确认基线未漂移）
7. 开始处理 §3.4 的 pwsh 7 阻塞 —— 这是阶段 0 Task 2 的唯一剩余障碍
8. Task 2 收尾 → 台账推进 → 进入阶段 1
```

---

## 附录 A：技术栈与版本

| 项 | 版本 |
|---|---|
| Node | 24.15.x（`engines: >=24.15.0 <25`） |
| 数据库 | `node:sqlite`（**无第三方 DB 依赖**） |
| 测试 | Vitest |
| 语言 | TypeScript |
| Shell | PowerShell 7（验证器要求），默认会话是 PS 5.1 |
| OpenClaw | 2026.7.1 |
| 加密 | AES-256-GCM + scrypt（阶段 3 实现） |
| 摘要 | SHA-256 |

## 附录 B：关键文件索引

| 路径 | 作用 |
|---|---|
| `饮食管家-开发约束与需求-v1.0.md` | **需求唯一权威**：PRODUCT-0.1、冻结的 0.1.0 上线子集（5 步）、I-1..I-8、REQ-*、SLICE-0..7、DoD、里程碑 M0–M9、营养白名单 §9 |
| `docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md` | **执行主干**：19 任务全部命令、测试代码、提交范围 |
| `docs/work-items/PRODUCT-0.1.1-ledger.json` | 阶段状态机器权威 |
| `docs/AI协作开发手册.md` | 日常操作手册（接手先读） |
| `docs/架构与开发思路.md` | 架构与设计取舍 |
| `docs/维护与迭代路线图.md` | 0.1.1 之后的版本线、债务清单、解析器演进策略 |
| `docs/work-items/MIXED-LIQUID-001-root-cause.md` | 改 parser 前必读的根因分析 |
| `docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md` | 真实验收报告，4 缺陷来源 |
| `shared/tests/validate-product-0.1.1-governance.mjs` | 治理门（归档、台账、文档权威一致性） |
| `shared/validate-product-0.1.ps1` | 产品门禁验证器 |
| `version-b-lite-plugin/src/application/core-runtime.ts:1110` | `ACTION_NOT_IMPLEMENTED` 闸门（Task 5 要拆） |
| `version-b-lite-plugin/src/parser/purchase.ts` | 冻结例句正则（Task 7/8 要泛化） |

---

**文档结束。版本 v1.0，对应交接基线 `0294d67`。**
若后续状态推进（阶段 0 关闭、缺陷修复），请**新建 v1.1** 而不是原地覆盖——本仓库的惯例是版本化文档不可变。
