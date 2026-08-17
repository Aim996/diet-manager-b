# 阶段 4 真机安装/验收 交接文档（2026-08-17）

> 交付对象：**购物袋**（接手继续执行后续修复与验收的 agent）。
> 本文是「安装包在哪 + 开发思路 + 后续路线」的统一交接，读完即可无缝续跑。深度设计细节已沉淀在仓库既有三份文档（见文末 §8），此处只保留当前状态与行动指令，避免重复。

---

## 一、当前状态快照（截至 2026-08-17）

**已完成并提交**（阶段 0/1/2，即主干计划 Task 1–12）：
- 阶段 0：权威统一 + 可重复产品基线（Task 1–2）。
- 阶段 1：0.1.0 合规闭环——撤销 undo_record 全链路（Task 3–6）。
- 阶段 2：完整 0.1 业务——采购/多商品/澄清/数量·时间·白水·位置纠正/查询收口（Task 7–12）。

**本次（阶段 4 真机验收中）新发现并已修复、已提交**（commit `6f24e83352fdb8d151e0a7442806152b3bf8060e`，即 `6f24e83`）：
- `correct_record`（餐食数量/时间纠正）在真实 OpenClaw 网关上一提交就报 `PLUGIN_RUNTIME_UNAVAILABLE`。
- 根因：`src/contracts.ts` 的 `assertDietManagerOutcome` 只允许 `undo_record` 返回 `correction` 视图，把 `correct_record` 的 `correction` 也误判为非法契约字段。结果：落库其实已成功，但插件在落库**之后**做契约校验时抛错，被外层捕获成 `PLUGIN_RUNTIME_UNAVAILABLE`。
- 修复：契约校验放行 `correct_record` 的 `correction`（与 `undo_record` 同级）。
- 验证：2 条定向测试 RED→GREEN，邻接回归通过，全量 vitest 40 文件 / 1000 例全绿，`tsc` 构建通过。

**待办（交给购物袋）**：见 §六。工作树当前状态与提交策略见 §六-1。

---

## 二、安装包（整合）

**唯一权威位置（本机，已重新打包干净、含本次修复）：**

```
E:\codx\skill\饮食管家\version-b-lite-plugin\diet-manager-b-0.1.0.tgz
```

- 大小 211.8 kB，74 个文件，解包约 1.2 MB。
- npm shasum（SHA-1）：`c126c211e2c5e7cd1966fc590e5baeb247a5f9c8`
- SHA-256：`e91defe24df477aee8411e33c6bf40f2c1ac84c467014f281e355d01e3cdbc16`
- 内容：`dist/`（编译产物，含修复）、`skills/diet-manager-b/`（SKILL.md）、`openclaw.plugin.json`、`package.json`。`.npmignore` 已排除 `src/ tests/ scripts/ data/ docs/ node_modules/` 等。

> ⚠️ 宿主机 `192.168.100.10` 的 `/tmp/diet-manager-b-0.1.0.tgz` 是**旧包**（含临时探针日志的脏版本），已废弃，勿再用。

**打包方式（以后改代码后重新出包用）**：
```bash
# 在本机，Node 用验证专用 24.15.0（见 AI协作开发手册）
node node_modules/typescript/bin/tsc -p tsconfig.json     # 重新编译 dist
node <npm-cli.js> pack --ignore-scripts                   # 重新出 tgz
```

**安装命令（7 个网关容器每个都要装，容器内 openclaw CLI 在 `/usr/local/bin/openclaw`）**：
```bash
docker cp diet-manager-b-0.1.0.tgz <容器>:/tmp/
docker exec <容器> openclaw plugins install --force npm-pack:/tmp/diet-manager-b-0.1.0.tgz
```
网关：宿主 `192.168.100.10`，外部端口 18791–18797，容器内工具调用端口 18789。装完确认 `diet_manager` 工具出现在插件工具列表。

---

## 三、开发思路（架构 + 工程原则）

### 3.1 分层架构（Skill → OpenClaw → 应用 → 解析 → 领域/仓储 → 存储）

```
SKILL.md（对模型的约束：动作选择/结果回执/不兜底）
  └─ openclaw/plugin.ts（defineToolPlugin，cloneToolRequest 收 7 字段）
       └─ application/core-runtime.ts + command-handler.ts（分发、事务、幂等）
            ├─ parser/*（冻结例句 → 有界语法，逐字原话解析）
            ├─ domain/*（FactCommit 事实提交 + Effect/Projection 投影 + Receipt 回执）
            └─ repository/* + storage/*（node:sqlite，WAL 模式，事件溯源）
```

要点：
- **用户原话逐字进 `source_text`**，由解析器提取事实；模型不得自行改写或补造结构化事实。
- **`official_data_root` 与 `prior_context` 由后端管理**，公开入口不接受调用方构造的 `prior_context`。
- **幂等**：以 `operation_id` 为幂等键；重复 `operation_id` 直接返回 `idempotency_conflict`。

### 3.2 冻结契约

- 每个 outcome 都经 `assertDietManagerOutcome`（`validatedJsonOutcome`）发布；契约身份必须匹配，否则视为未确认成功。
- `contract_id=diet-manager/contract-v2`，`contract_version=2`，`contract_sha256=632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`。
- **本次 bug 就是契约校验字段白名单漏了 `correct_record.correction`** —— 教训：新增动作返回视图时，务必同步更新 `contracts.ts` 的字段白名单。

### 3.3 工程纪律（不可破）

- **WIP=1**：任一时刻恰好一个任务 IN_PROGRESS，状态机权威在 `docs/work-items/PRODUCT-0.1.1-ledger.json`。
- **TDD 先红后绿**：先写失败测试、确认失败原因，再写最小实现；**禁止把测试改成适配错误行为**。
- **DoD 8 条 + EV 证据链**：每任务提交要有 commit SHA、测试输出、脱敏证据，写进 `docs/evidence/`。
- **secret 零泄露**：authority secret、FDC_API_KEY、Gateway 凭据、备份口令、真实饮食内容**不得进入**参数列表、清单、日志、Git 或发布包。改代码时先自查。
- **releases/v0.1 只读**：任何测试/构建/验收不得改该目录。
- **不加运行时依赖**：确需依赖先新增并批准 DEC，再重开任务。

---

## 四、本次修复的 bug（correct_record 契约校验）——复现与验证

**现象**：真实网关调 `correct_record`，返回 `{"status":"failed","error_code":"PLUGIN_RUNTIME_UNAVAILABLE"}`，但数据库里其实已写入。

**根因链路**：
1. `core-runtime.ts` 纠正分支成功落库，产出 `committedOutcome(..., correctionView)`。
2. `plugin.ts` 的 `executeDietManager` 用 `validatedJsonOutcome(...)` 发布，内部调 `assertDietManagerOutcome`。
3. `assertDietManagerOutcome` 见 `correction` 字段只放行 `undo_record`，对 `correct_record` 抛 `DIET_MANAGER_OUTCOME_INVALID:correction_action`。
4. 抛错发生在 commit **之后**，被外层 catch 成 `PLUGIN_RUNTIME_UNAVAILABLE`——用户看到「失败」，但事实已写库，属**假失败**。

**修复**（`src/contracts.ts`，约 647–650 行）：
```ts
if (candidate.correction !== undefined) {
  if (candidate.action !== "correct_record" && candidate.action !== "undo_record") {
    return invalidOutcome("correction_action");
  }
  assertCorrection(candidate.correction);
}
```

**测试**（`tests/acceptance/core-correction-application.test.ts`）：在两条 correct_record 的 `toMatchObject` 断言后新增 `expect(assertDietManagerOutcome(outcome)).toBe(outcome);`，确保纠正视图能通过契约校验。RED→GREEN 已验证，全量 1000 例绿。

---

## 五、真机测试需求（8 动作 + 7 字段 + 唯一 ID）

工具名 `diet_manager`，**8 个动作**：

| action | 用途 | 示例 source_text |
|---|---|---|
| `record_meal` | 已吃/已喝含营养食物 | 我吃了150克苹果 |
| `record_water` | 已喝白水 | 我刚喝了500毫升白水 |
| `add_inventory` | 入库食材/商品 | 买了一箱牛奶 |
| `query_inventory` | 查库存 | 看看库存 |
| `query_meals` | 查饮食记录 | 我今天吃了什么 |
| `query_daily_summary` | 查当天汇总 | 今天营养汇总 |
| `correct_record` | 更正已有记录 | 把刚才苹果改成200克 |
| `undo_record` | 撤销记录 | 撤销刚才那条饮食记录 |

**每次调用必须带齐 7 个字段**：`action`、`source_text`（用户原话逐字）、`received_at`、`timezone`（固定 `"Asia/Shanghai"`）、`operation_id`、`source_message_id`、`conversation_id`。查询请求也用同一组完整元数据。

**⚠️ 最重要**：`operation_id` 与 `source_message_id` **每次操作必须唯一**（幂等键）。上一轮测试脚本复用了 `o1`/`m1`，第二次调用就返回 `idempotency_conflict`——**这是测试脚本复用 ID 导致的假失败，不是产品 bug**。真机测试请每次用新 ID（时间戳/自增后缀）。

**HTTP 调用方式**：
```
POST /tools/invoke          # 容器内 18789，宿主外部 18791
Authorization: Bearer <token>   # 从容器环境 OPENCLAW_GATEWAY_TOKEN 读，绝不回显进日志
Content-Type: application/json
{ "tool": "diet_manager", "action": "json", "args": { …7 字段… } }
```
结果在 `result.content[0].text`（JSON 字符串）。写入类判定：`status == "committed"` 且 `committed == true`。

**建议端到端序列**（验证本次修复 + 8 动作全链路）：
1. `record_meal`「我吃了150克苹果」→ `committed=true`
2. `correct_record`「把刚才苹果改成200克」→ `committed=true` + `correction.operation=change_amount`（**本次修复点**）
3. `query_meals` → 看到该记录（150→200）
4. `undo_record`「撤销刚才那条饮食记录」→ `committed=true`
5. `record_water` / `add_inventory` / `query_inventory` / `query_daily_summary` 各验证一次

---

## 六、后续思路（购物袋接下来做什么）

### 6-1. 立即（真机确认 + 复制安装）

1. **修复已提交**（commit `6f24e83`，仅 `src/contracts.ts` + 对应测试两文件）。剩余未提交的是**重编译产物与文档**，购物袋按项目约定收尾即可：
   - 多个 `version-b-lite-plugin/dist/*.js`（M）—— `tsc` 重编译产物（含修复传导 + 阶段 1/2 遗留的 dist 未同步）
   - `version-b-lite-plugin/.npmignore`、`diet-manager-b-0.1.0.tgz`（??）—— 打包配置与产物
   - `version-b-lite-plugin/dist/domain/water-correction.js`、`dist/repository/purchase-envelope-commit.js`（??）—— 阶段 1/2 新增编译产物
   - `docs/work-items/TASK10-handoff.md`、`TASK11-handoff.md`、`STAGE4-handoff.md`、根目录两份《饮食管家-Codex开发交付说明》（??）—— 交接文档
   - 收尾建议：`git add -A` 把重编译 dist + 打包产物 + 交接文档作为一个「build/artifact」提交。若项目约定 dist 不入库，则以 `.gitignore` 决定，别与既有约定冲突。
2. **真机验证修复**：用 §五 的端到端序列（**唯一 ID**），在 gateway-01 上跑一遍，确认 `correct_record` 返回 `committed=true` + `correction`，不再 `PLUGIN_RUNTIME_UNAVAILABLE`。
3. **复制安装到 7 个网关**（18791–18797），逐个 `docker cp` + `plugins install --force`，各自跑一遍 smoke（至少 record_meal + correct_record + query_meals）。

### 6-2. 阶段 3（Task 13–15，安装/升级/灾备闭环）

- AES-256-GCM + scrypt 便携加密备份；TTY 口令 CLI（`admin:backup` / `admin:restore`）；事务式安装/升级/回滚/卸载。
- 关键约束：备份口令不进参数列表/日志/仓库；不改 releases/v0.1；不加运行时依赖。

### 6-3. 阶段 4 剩余（Task 16–18，真实环境验收）

- 真实 OpenClaw 验收场景与执行器；不可变候选构建；真实 Gateway / USDA / 恢复验收。
- **需用户提供 FDC_API_KEY（只进 Gateway 进程环境，不进仓库/日志）+ 验收签收**。这一关要等用户，不能跳过。

### 6-4. 阶段 5（Task 19，发布）

- 已验收候选逐字节晋级 `releases/v0.1.1` + tag；最终判定八条全部成立（六阶段 DONE、证据绑定候选 SHA、用户签收、v0.1.1 与候选逐字节一致、工作树干净、tag 就位、零 secret）。

### 6-5. 长期路线（详见 `docs/维护与迭代路线图.md`）

- 0.1.x 修复线 / 0.2 记录与回顾助手；解析器从冻结例句→有界语法→开放语法的演进；CFCT（中国食物成分表）接入。

---

## 七、关键文件索引

| 文件 | 作用 |
|---|---|
| `docs/superpowers/plans/2026-08-15-complete-0.1x-staged-development.md` | 19 任务/6 阶段执行主干（命令、测试、提交范围逐条写明） |
| `docs/work-items/PRODUCT-0.1.1-ledger.json` | 阶段状态机（恰好一个 IN_PROGRESS） |
| 根目录《饮食管家-开发约束与需求-v1.0.md》 | 权威需求 |
| `version-b-lite-plugin/src/contracts.ts` | 冻结契约实现 + 本次修复点 |
| `version-b-lite-plugin/src/openclaw/plugin.ts` | OpenClaw 适配层（7 字段收口、validatedJsonOutcome） |
| `version-b-lite-plugin/src/application/core-runtime.ts` | 应用分发/事务/幂等 |
| `version-b-lite-plugin/skills/diet-manager-b/SKILL.md` | 对模型的约束（动作表 + 回执规则） |
| `version-b-lite-plugin/tests/acceptance/core-correction-application.test.ts` | 本次修复的 TDD 测试 |

## 八、与既有文档的关系（续跑前先读这三份）

1. **`docs/AI协作开发手册.md`** —— 环境要求与标准命令、WIP=1 与台账操作、TDD 红绿流程、DoD 自查、改动禁区、EV 证据规范、常见坑（PS5.1 语法、dist 再生、secret 边界）。**续接会话第一件事先读它。**
2. **`docs/架构与开发思路.md`** —— 分层图、8 条不变式、事务分层（DEC-023）取舍、营养白名单（DEC-029）防线、契约意义、MIXED-LIQUID-001 教训。
3. **`docs/维护与迭代路线图.md`** —— 版本规划、DEBT/RISK 清单、解析器演进、CFCT 接入。

---

> 交接即止于此。购物袋从 §六-1 开始，按 WIP=1 逐条推进；遇到阶段 4 验收，先向用户要 FDC_API_KEY 并等签收，不要自行替代。
