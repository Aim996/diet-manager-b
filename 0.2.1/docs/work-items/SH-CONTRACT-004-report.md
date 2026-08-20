# SH-CONTRACT-004 实施报告

## 1. 报告身份

- 任务：SH-CONTRACT-004
- 实施者：`/root/issue_correction_impl`
- 交付状态用语：首轮独立复核为 FAIL；F-01/F-02 已形成修复候选并完成实施者复测。本报告不宣告修复后独立复核结论或任务完成。
- 契约候选：`shared/contracts/issue-correction-contract.md`
- 当前修复候选 SHA-256：`45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA`

## 2. 输入与范围核验

| 输入 | 预期 SHA-256 | 实际 SHA-256 | 结果 |
| --- | --- | --- | --- |
| `docs/work-items/SH-CONTRACT-004-brief.md` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` | 一致 |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | 一致 |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | 一致 |

本次只创建了授权的契约候选与本报告；未修改总计划、上游契约、展示契约、来源注册表、案例、Schema 或路线实现。

## 3. 32 条实施追踪

| 需求 | 候选章节 | 自检要点 |
| --- | --- | --- |
| REQ-ISSUE-001 | §2.2 | 事实优先；Issue 不等于 preview/failed |
| REQ-ISSUE-002 | §3.4 | 多问题统一摘要并按影响排序 |
| REQ-ISSUE-003 | §3.4 | deferred 触发式再提示 |
| REQ-ISSUE-004 | §3.4、§4.1 | 追加 Resolution；改变事实时同事务 Correction；不能互代 |
| REQ-ISSUE-005 | §4.2 | 延迟库存效果重新读取当前状态与版本 |
| REQ-ISSUE-006 | §3.4、§6.5 | void 同事务 invalidated，终态不重复终结 |
| REQ-QUICK-001 | §5.1 | 仅关键不确定性提供 |
| REQ-QUICK-002 | §5.1 | 2–4 个高价值选项，不做笛卡尔组合 |
| REQ-QUICK-003 | §5.1 | 真实效果、非效果与关联 Issue |
| REQ-QUICK-004 | §5.1 | 安全出口且不默认、不暗改 |
| REQ-QUICK-005 | §5.3 | 字母/组合/顺序/自然语言；冲突先拒绝消歧 |
| REQ-QUICK-006 | §5.2 | prompt、option、版本、规则与有效期持久化 |
| REQ-QUICK-007 | §5.2、§5.3 | 旧选项执行前重校验，过期/陈旧不执行 |
| REQ-QUICK-008 | §5.3 | 固定自由文本末行及末行后禁止追加 |
| REQ-CORR-001 | §6.1 | committed 只追加 correction/void；preview 只出新版本 |
| REQ-CORR-002 | §6.3 | 默认最新有效视图，详情保留完整审计 |
| REQ-CORR-003 | §6.4 | 真实已应用库存效果到新目标效果的差量 |
| REQ-CORR-004 | §6.5 | remove_item 只移除单项 |
| REQ-CORR-005 | §6.5 | void 整条、真实返还、Issue 失效 |
| REQ-CORR-006 | §6.5 | 跨自然日同事务重算旧日/新日 |
| REQ-CORR-007 | §6.3 | 多候选不猜且不暴露内部 ID |
| REQ-CORR-008 | §6.2 | target_version/CAS 与重复/循环防护 |
| REQ-SAFE-001 | §2.1、§7.2 | 完整持久化后才 committed |
| REQ-SAFE-002 | §7.1 | 原 CommitResult/进度引用幂等返回 |
| REQ-SAFE-003 | §6.6、§7.2 | 不负库存；不足提交事实、跳过新增效果 |
| REQ-SAFE-004 | §4.1、§7.2 | 单一事件的全部结果在原子边界 |
| REQ-SAFE-005 | §7.3 | 输入不能指定路径，测试根显式隔离 |
| REQ-SAFE-006 | §7.1、§7.2 | 存储损坏/不确定响应失败关闭 |
| REQ-SAFE-007 | §6.3 | 聚合只读 committed 最新有效视图 |
| REQ-SAFE-008 | §5.3、§7.4 | 兼容组合/ mixed 按序逐事件原子 |
| REQ-SAFE-009 | §7.5 | 数值单位成组；unknown 不替成 0 |
| REQ-SAFE-010 | §7.5 | 规范十进制/整数最小单位，禁止浮点漂移 |

契约候选自己的规范性追踪表中上述 32 个 ID 各且仅出现一次。

## 4. 关键枚举与场景覆盖

- Issue：3 个 kind、17 个稳定 code、6 个 status，并冻结完整允许转换与终态规则。
- Resolution：字段、七类最低 outcome、追加表达、重校验、拒绝语义、纯副作用失败不能 resolved。
- 快捷输入：字母、组合、顺序指代、自由文本等价；冲突组合在任何效果前整体拒绝；兼容组合按回复顺序逐事件原子；固定末行原样落文。
- Correction：12 个固定 operation、追加审计、CAS、实际库存效果差量、新营养快照和最终有效进度。
- 场景：正常补扣、补扣不足、单项移除、整条 void、跨日修改、多候选目标、响应丢失、possible_duplicate。
- 补扣不足：Correction 仍 committed；营养/进度按新事实；原真实扣减保留；新增差量 `skipped_insufficient`；Issue 使用 `insufficient_inventory` 与 `context=correction_increment`。
- mixed：按叙述顺序拆分；purchase 失败不丢后一条可识别 meal；总结果逐项列状态。
- 展示边界：成功纠错如展示进度，只引用同次最终事务 `daily_progress` 并引用 RECEIPT-DATE-CONTRACT-v1，不重复定义进度格式。
- 旧行为：明确禁止用 preview/failed 否认可提交事实，以及覆盖历史、负库存、猜目标、旧选项直执行、幂等副作用重演等行为。

## 5. 首次实施者自检（修复前历史）

### 5.1 业务数据前后扫描

修改前和修改后均执行：

```powershell
$ext=@('.jsonl','.sqlite','.sqlite3','.db')
@(Get-ChildItem -LiteralPath 'E:\codx\skill\饮食管家' -Recurse -File |
  Where-Object { $ext -contains $_.Extension.ToLowerInvariant() }).Count
```

结果：

```text
BUSINESS_DATA_BEFORE=0
BUSINESS_DATA_AFTER=0
```

本次未创建、修改或删除 JSONL/SQLite 业务数据。

### 5.2 结构与语义检查

自检从候选全文提取任务范围 ID，构造 6+8+8+10 个预期 ID，按组检查总数、唯一数、缺失、额外和重复；同时断言 3 kind、17 code、6 status、12 operation、MUST/MUST NOT 密度、两处黄金文本、固定末行、展示契约引用、上游哈希与业务数据扫描。

首轮内联检查器误用了 PowerShell 自动变量 `$Matches` 作为需求命中集合；后续 `-match` 覆盖了该变量，因此误报 `REQ_TRACE`。该轮其他输出已经显示 `UNIQUE=32`、`MISSING=0`、`EXTRA=0`、`BAD_COUNTS=0`，属于检查器缺陷，不是候选缺陷。候选未因此修改。

将变量改为普通数组 `$reqHits` 后完整重跑，退出码 0：

```text
REQ_MATCHES=32 UNIQUE=32 MISSING=0 EXTRA=0 BAD_COUNTS=0
KINDS=3 MISSING=0 CODES=17 MISSING=0 STATUSES=6 MISSING=0 OPS=12 MISSING=0
MUST_TOKENS=151 FREE_TEXT_LINE_COUNT=2 GOLDEN_NORMAL=True GOLDEN_INSUFFICIENT=True PROGRESS_REFERENCE=True
UPSTREAM_HASH_MISMATCH=0 BUSINESS_DATA_AFTER=0
CONTRACT_SHA256=1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325
SELF_CHECK=CANDIDATE_OK
```

## 6. 首轮候选哈希与当时剩余风险（历史）

- 契约候选 SHA-256：`1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325`
- 上游三份输入在自检时均保持预期哈希。
- 剩余风险 1：尚未经过独立规范复核；实施者自检不能替代独立复核。
- 剩余风险 2：本任务不实现物理 Schema、JSONL/SQLite 映射、路线代码或完整案例 Oracle；这些后续实现仍需证明三路线等价。
- 剩余风险 3：黄金文本中的示例值仅冻结版式；后续案例需要确认所有动态日期、真实候选和同次最终进度引用。

## 7. 第 1 轮独立 FAIL 与修复审计

### 7.1 冻结的首轮结果

- 独立复核记录：`docs/work-items/SH-CONTRACT-004-review.md`
- 复核记录 SHA-256：`B3BAA887DE1AD3FC5ED11F0D7E2307737F5304699FFB329654342D58C5772B2C`
- 首轮候选 SHA-256：`1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325`
- 首轮报告 SHA-256：`B554DF32E4B1557D74B1B70BA63FF0C35B0062885611388A453707BEFBD631B9`
- 首轮独立结论：`FAIL`；32 条需求为 30 PASS / 2 FAIL；中严重度发现 F-01、F-02。
- 初版简报 SHA-256：`317D0930E96006374FAE9EE9F98049AEDA821875074DE1BD45F08833EB98D145`。
- 修订简报 SHA-256：`05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48`；实施者已完整重读后修复。

### 7.2 F-01：`ignored` 边界修复

首轮问题是“明确不处理”可能同时被解释为根命令 `ignored` 或 Issue Resolution，导致路线结果不唯一。

修复候选现在明确：

- `ignored` MUST 仅用于计划、假设、明确否定、发生前取消和明确非本人事实，且无业务写入；
- 已 `committed` 事实上的“暂不处理/先别扣/以后再说”MUST 追加 `IssueResolutionEvent(outcome=deferred)`，Issue 进入 `deferred`，命令为 `committed`；
- “永不关联/不关联库存”MUST 追加 `IssueResolutionEvent(outcome=dismissed)`，Issue 进入 `dismissed`，命令为 `committed`；
- 补扣不足黄金选项 A/B 及等价自由文本已分别显式映射到 `dismissed/deferred`，两者绝不能返回 `ignored`。

### 7.3 F-02：审计可用与审计存储失败分层

首轮问题是把 `failed_storage` 同时描述成已持久化 outcome，又要求存储失败关闭，导致审计存储自身失败时不可能同时满足。

修复候选现在明确：

- 已持久化 `IssueResolutionEvent.outcome` 的最低集合改为 `applied/deferred/dismissed/rejected_expired/rejected_stale/rejected_conflict/rejected_effect`；
- 业务副作用或前置条件拒绝、但权威审计存储可用时，MUST 追加对应 `rejected_*`；纯副作用失败使用 `rejected_effect`，Issue 不得 `resolved`；
- `failed_storage` 只能是未持久化的命令错误码/结果，MUST NOT 成为已持久化 Resolution outcome；
- 权威审计/事务存储不可用、回滚或提交结果未知时，命令 MUST 为 `failed`；Issue 与业务效果原样；不得声称存在 Resolution、Correction、状态事件、事件 ID 或幂等成功结果；
- 恢复后只可使用原幂等键查询/重试，只有确认原事务未提交且新事务可用时才可持久化新的尝试。

## 8. 修复后实施者自检

### 8.1 检查范围

修复后重新运行以下检查：

1. 32 条范围 ID 总数、唯一数、缺失、额外与重复；
2. 3 kind、17 code、6 status、12 operation 与 7 个已持久化 Resolution outcome；
3. `ignored` 的五类根事实边界及 deferred/dismissed Resolution；
4. 权威审计存储可用的 `rejected_effect` 与审计存储失败的“command failed + 无事件”；
5. 正常补扣、库存不足、真实替代批次、单项移除、整条 void、跨日、冲突组合、自由文本延后、陈旧 prompt、幂等/响应丢失、possible duplicate、两类 mixed，共 13 个场景；
6. §8 的 10 条被取代规则、两段黄金文本、固定自由文本末行；
7. 三份当前输入哈希与 JSONL/SQLite 业务数据扫描。

修复后检查器首次调用因 PowerShell 字符串中的 `$name:` 被解释成无效变量引用而在解析阶段退出；该调用没有运行断言，也没有修改候选。改为 `${name}:` 后完整重跑，候选未因检查器问题修改。

### 8.2 修复后结果

```text
STATUSES=6 MISSING=0
OPS=12 MISSING=0
OUTCOMES=7 MISSING=0
KINDS=3 MISSING=0
CODES=17 MISSING=0
SCENARIO_01_normal_increment=True
SCENARIO_02_insufficient=True
SCENARIO_03_alt_batch=True
SCENARIO_04_remove_one=True
SCENARIO_05_void=True
SCENARIO_06_cross_day=True
SCENARIO_07_conflict=True
SCENARIO_08_free_defer=True
SCENARIO_09_stale_prompt=True
SCENARIO_10_idempotent=True
SCENARIO_11_duplicate=True
SCENARIO_12_mixed_later_fail=True
SCENARIO_13_purchase_fail_meal=True
TRACE=32/32 MISSING=0 EXTRA=0 DUP=0
IGNORED_SCENE=True STORAGE_FAILURE_SCENE=True SCENARIOS=13/13 OLD_RULE_BULLETS=10
FREE_LINE=2 NORMAL_EXACT=True INSUFFICIENT_EXACT=True INPUT_HASHES=True BUSINESS_DATA=0
CONTRACT_SHA256=45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA
FIX_SELF_CHECK=CANDIDATE_OK
```

### 8.3 修复周期业务数据扫描

| 时点 | JSONL/SQLite 业务数据文件数 | 明细 |
| --- | ---: | --- |
| F-01/F-02 修复前 | 0 | 无 |
| 契约修复并完成自检后 | 0 | 无 |
| 本报告更新后（2026-08-09 16:27:13 +08:00） | 0 | 无 |

## 9. 当前修复候选与剩余风险

- 当前契约候选 SHA-256：`45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA`。
- 当前三份输入在修复后自检时均保持预期哈希。
- F-01/F-02 已由实施者按修订简报形成候选修复，但仍需原独立复核者复审；本报告不自行宣告独立 PASS。
- 物理 Schema、JSONL/SQLite 映射、路线代码、完整案例 Oracle 与 Q-004 关闭不在本任务范围。
