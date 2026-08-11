# SH-MODEL-003 实施报告

> 状态：第二轮独立复核 PASS；等待 GitHub 推送、独立 clone 复验和 EV-019 最终冻结。
>
> 日期：2026-08-11
>
> 当前候选提交：`d41321a`（完整提交将在 GitHub/clone 复验后由 EV-019 冻结）。

## 1. 本任务解决什么问题

`SH-MODEL-003` 把 Issue、纠正事件、效果 outbox、三阶段提交结果、成功回执和 mixed 批次结果收敛为一套 route-neutral 共享模型。Skill、未来 B SQLite 后端、OpenClaw 和 MCP 适配器只能消费这套契约，不得复制或发明另一套业务状态机。

本任务最重要的业务边界是：

- `FactCommit` 写失败时可以产生业务系统之外的脱敏技术日志；
- 但失败响应必须是 `failed_fact + failed + business_writes=0`；
- 事件、纠正、outbox、Issue、营养、库存、进度、回执和终态幂等引用必须全部为空；
- 技术日志不进入饮食 Schema、业务查询、成功回执或 mixed 结果。

## 2. 已实现内容

### 2.1 单一共享 Schema

文件：`shared/schemas/issue-correction-mixed.schema.json`

- JSON Schema 2020-12；
- `$id=https://diet-manager.local/schemas/issue-correction-mixed/v1`；
- `x-schema-version=1.0.0`；
- 12 个公共定义：Issue、IssueResolutionEvent、QuickPrompt、CorrectionSnapshot、CorrectionEvent、EffectOutboxEntry、FactCommitResult、EffectBundleResult、ReceiptData、EnvelopeFinalizeResult、MixedItemResult、MixedCommitResult；
- 复用 Event/Amount 与 Nutrition/Progress 的冻结绝对 `$ref`；
- 通过 `x-semantic-contract` 明确区分 JSON Schema 可表达约束和配套语义验证器负责的跨字段约束；
- 不含 OpenClaw、Docker、MCP、SQLite 或路由专属字段。

### 2.2 关键状态与事务边界

- Issue 固定 22 字段和 23 个 issue code；open/awaiting 与 resolved/dismissed 使用不同 closure 约束。
- IssueResolutionEvent 只允许 `applied|no_change|rejected`，没有可持久化的 technical `failed` outcome。
- QuickPrompt 固定 2–4 个唯一选项并要求 safe-exit 选项。
- CorrectionEvent 固定 14 字段、13 种操作；Schema 直接约束 void/restore 生命周期，配套语义层约束目标身份、版本匹配/递增、摘要变化和日期顺序。
- EffectOutboxEntry 使用 `previous_state + state` 证明精确状态转换，终态不得重开。
- FactCommitResult、EffectBundleResult、EnvelopeFinalizeResult 分别负责事实、效果和最终成功输出，禁止跨层伪造成功。
- mixed 子项保持原始顺序并要求 operation/idempotency 身份唯一；后项失败不回滚前项；失败/忽略/待澄清子项不得携带已提交事实或纠正引用。

### 2.3 固定 fixture 与验证器

文件：

- `shared/tests/fixtures/issue-correction-mixed-cases.json`
- `shared/tests/validate-issue-correction-mixed-schemas.ps1`

验证器冻结：

- Schema/fixture 精确 SHA-256；
- 12 个精确定义名；
- 65 个精确 case ID；
- 10 个 `semantic_only_case_ids`，明确标注标准 JSON Schema 2020-12 不能单独表达、必须由配套语义层拒绝的跨字段反例；
- exact-shape、枚举、时间、摘要、日期排序、版本、状态转换、失败原子性、别名、mixed 顺序和幂等语义；
- 4 个反弱化 mutation check。

## 3. TDD 过程

### RED

在 schema 和 fixture 尚未创建时先完成 validator 和固定 ID，首次运行精确失败：

```text
ISSUE_CORRECTION_MIXED_SCHEMA_FILE_MISSING
```

这证明测试不是从候选文件自适应生成期望。

### GREEN

第一版实现输出 58/58 PASS，但独立标准引擎发现 Schema 与语义层边界未声明。修复后 Windows PowerShell 5.1 输出：

```text
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4
```

4 个独立 mutation 输出：

```text
MUT-FAILED-FACT-ALLOW-BUSINESS|PASS
MUT-OUTBOX-ALLOW-TERMINAL-REOPEN|PASS
MUT-PENDING-ALLOW-RECEIPT|PASS
MUT-MIXED-ALLOW-REORDER|PASS
```

## 4. 上游回归

以下六项在同一候选上串行 exit 0：

```text
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4
```

## 5. 文件身份

| 文件 | SHA-256 |
|---|---|
| `shared/schemas/issue-correction-mixed.schema.json` | `EDBB15A38543431DD66564B696F7EA956F725E241E628D8EF36E1B9B0D3B511F` |
| `shared/tests/fixtures/issue-correction-mixed-cases.json` | `FAD2104BACD46D831D51F72B7B4395923BC5B9BB007E05AA76903330408EE1F7` |
| `shared/tests/validate-issue-correction-mixed-schemas.ps1` | `4E27245EEF89966D04DEEDE628E2B2010DB3C746F9AE15B50801DDCE95B35CC8` |

## 6. 数据与安全边界

- 本任务未创建 SQLite 表、repository、worker 或业务数据。
- `.jsonl/.sqlite/.sqlite3/.db/-wal/-shm/-journal` 业务候选扫描为 0。
- 未读取、哈希、编辑、跟踪或执行五个受保护 lease 文件。
- 未修改必要安全底座、生产入口或 OpenClaw 插件。
- 失败日志只作为未来运行时的独立脱敏技术日志政策，当前 Schema 没有技术日志字段。

## 7. 未完成与后续

结构和语义开发已经通过独立复核，剩余交付门：

1. 推送私有 GitHub；
2. 从独立 clone 重跑六项验证并确认 clean；
3. 写 `EV-20260811-019`、更新总计划并冻结最终提交身份。

完成后进入 `SH-MAP-001`，再把共享模型映射到 B SQLite；当前不提前创建生产业务表。

## 8. 第一轮独立复核与处置

第一轮使用 Ajv 8.20.0 与符合 2020-12 语义的 Hyperjump 独立解析模板并执行。结论为 `FAIL|p0=0|p1=3`：标准引擎对第一版只有 52/58 与端到端语义期望一致，原因是 6 个跨字段反例被错误当成“Schema 本身应拒绝”。这不是失败原子性失效，而是验证分层描述错误。

处置如下：

1. Schema 新增可表达的 void/restore 生命周期和进度别名存在/禁止规则；
2. fixture 新增 `semantic_only_case_ids`，把 Schema 结构结果与端到端语义结果分开；
3. 增加 7 个反例，覆盖 lifecycle、target/revision、mixed 双身份唯一性和单日别名相等；总数由 58 增至 65；
4. Schema 顶层新增 10 项 `x-semantic-contract.invariants`，明确这些不变量必须由未来 B 后端和当前语义 validator 共同承担；
5. mutation 结果分层陈述：前三项必须被 Schema 和语义层拒绝；mixed reorder 必须被语义层拒绝，不能虚称标准 Schema 能表达 `sequence == index`。

第一轮还发现 Ajv 8.20.0 在本次加载方式下未正确执行 `prefixItems + items:false` 的 2020-12 语义；因此第二轮以通过该官方语义用例的实现为判定引擎，并把 Ajv 结果保留为兼容性观察，不拿错误引擎行为修改正确的上游 Nutrition Schema。

## 9. 第二轮独立复核

第二轮使用独立的 Node reviewer 解析模板和 mutation，并分别计算 Schema 结果与 10 项跨字段语义结果。正式结论：

```text
SH-MODEL-003-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=65|semantic_only=10|mutations=4
```

复核器重新执行 65 个 case、10 个 semantic-only case、10 个 invariant、4 个 mutation 和 25 个结构门；Ajv 2020-12 与 Hyperjump 对 Schema 结果交叉一致。第一轮三个 P1 均已关闭，没有新增 P0/P1。聊天转录不能证明候选字节身份，因此最终文件哈希仍交由本地 validator、GitHub 和独立 clone 复验。
