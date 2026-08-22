# SH-CONTRACT-004 独立复核记录

## 1. 第 1 轮结论（历史）

- 复核者：`/root/issue_correction_review`，不是实现者。
- 结论：**FAIL**。
- 高严重度发现：0；中严重度发现：2；低严重度发现：0。
- 32 条范围需求：30/32 PASS，2 FAIL。
- 20 项复核标准：16/20 PASS，4 FAIL。
- 13 个必做语义场景：12/13 PASS，1 FAIL。
- 剩余阻断数：2。
- Q-004 边界：候选只冻结正常/不足的简洁文案与事务语义，没有宣称 Q-004 已关闭；总计划中的 Q-004 仍为“开放”，后续仍需正常、自由文本、陈旧候选与幂等 Oracle。

## 2. 冻结输入与身份检查

| 输入 | 冻结 SHA-256 | 独立实测 SHA-256 | 结果 |
| --- | --- | --- | --- |
| `docs/work-items/SH-CONTRACT-004-brief.md` | `317D0930E96006374FAE9EE9F98049AEDA821875074DE1BD45F08833EB98D145` | `317D0930E96006374FAE9EE9F98049AEDA821875074DE1BD45F08833EB98D145` | PASS |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | PASS |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | PASS |
| `shared/contracts/issue-correction-contract.md` | `1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325` | `1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325` | PASS |
| `docs/work-items/SH-CONTRACT-004-report.md` | `B554DF32E4B1557D74B1B70BA63FF0C35B0062885611388A453707BEFBD631B9` | `B554DF32E4B1557D74B1B70BA63FF0C35B0062885611388A453707BEFBD631B9` | PASS |

候选 front matter 只给出 `status_source`，没有动态 `status` 或“任务已完成”声明；§1 第 14—19 行明确 companion contract 边界、上游优先级和非状态台账身份。上游两份契约已完整阅读；append-only、同次最终进度、日期和进度块最后等边界一致，但命令 `ignored` 边界与存储失败事件的语义存在两处中严重度歧义，详见 F-01、F-02。

## 3. 业务数据前后快照

扫描范围：`E:\codx\skill\饮食管家` 下全部 `.jsonl`、`.sqlite`、`.sqlite3`、`.db` 文件；对每个匹配文件比较路径、大小、SHA-256 与 UTC mtime。

| 时点 | 文件数 | 明细 | 结果 |
| --- | ---: | --- | --- |
| 复核写入前 | 0 | 无 | PASS |
| 复核主体写入后（2026-08-09 16:19:06 +08:00） | 0 | 无 | PASS |

复核过程没有执行任何业务写入、迁移、构建或案例运行；唯一允许写入是本复核记录。

## 4. 32 条需求逐项复核

| 需求 | 结论 | 独立语义证据 |
| --- | --- | --- |
| REQ-ISSUE-001 | PASS | §2.2 第 31—33 行：可识别已发生事实必须 committed，资料/库存/营养缺口只形成跳过效果与 Issue。 |
| REQ-ISSUE-002 | PASS | §3.4 第 94 行：同消息/记录多问题按影响排序统一摘要，禁止逐字段连问。 |
| REQ-ISSUE-003 | PASS | §3.4 第 92 行：deferred 后只允许在四类触发场景再次提供。 |
| REQ-ISSUE-004 | FAIL | §3.4 第 90 行及 §4.1 第 106 行要求失败追加表达，但没有为审计存储本身不可用时定义例外；与 §7.2 第 251 行形成 F-02。 |
| REQ-ISSUE-005 | PASS | §4.2 第 110 行：延迟库存效果执行前重读 Issue、有效记录、版本、批次、库存和规则。 |
| REQ-ISSUE-006 | PASS | §3.4 第 90 行、§6.5 第 191 行：void/版本替代令非终态 Issue 同事务 invalidated，终态不重复终结。 |
| REQ-QUICK-001 | PASS | §5.1 第 118 行：只有关键不确定性或真实候选实质影响结果时提供，明确判断禁止提供。 |
| REQ-QUICK-002 | PASS | §5.1 第 118 行：受规范词定义约束的 SHOULD 优先 2–4 个高价值选项，并禁止低价值笛卡尔组合。 |
| REQ-QUICK-003 | PASS | §5.1 第 120 行、§5.2 第 124 行：选项需有当前依据，并表达真实效果、非效果和受影响 Issue。 |
| REQ-QUICK-004 | PASS | §5.1 第 120 行：每组有保持原样/暂不处理/不关联出口，且不能默认或暗改。 |
| REQ-QUICK-005 | PASS | §5.3 第 130—132 行：支持字母、组合、顺序和自然语言；冲突先拒绝，兼容项有序逐事件原子。 |
| REQ-QUICK-006 | PASS | §5.2 第 124 行：prompt、Issue、option、效果、冲突组、各版本、规则与有效期齐全。 |
| REQ-QUICK-007 | PASS | §5.2 第 126 行、§5.3 第 132 行：旧选项和消歧后执行均重校验，陈旧结果不得执行。 |
| REQ-QUICK-008 | PASS | §5.3 第 134—140 行：固定末行逐字符正确，之后禁止追加同组内容。 |
| REQ-CORR-001 | PASS | §6.1 第 146 行：committed 只追加 correction/void；preview 只产生新 preview 版本。 |
| REQ-CORR-002 | PASS | §6.3 第 173 行：默认只看 committed 最新有效视图，详情保留全链和真实库存依据。 |
| REQ-CORR-003 | PASS | §6.4 第 179—185 行：按原真实已应用效果到新安全目标效果做差量，创建新不可变营养快照。 |
| REQ-CORR-004 | PASS | §6.5 第 189 行：remove_item 只移除目标项并只返还该项真实扣减。 |
| REQ-CORR-005 | PASS | §6.5 第 191 行：void 整条、只返还真实扣减、Issue 失效、从聚合移除但历史可查。 |
| REQ-CORR-006 | PASS | §6.5 第 193 行：按用户时区判断跨日，同事务重算旧日/新日；同日只更新一次。 |
| REQ-CORR-007 | PASS | §6.3 第 175 行：多候选不猜，按展示契约给人类日期/餐次/食品/数量且不暴露 ID。 |
| REQ-CORR-008 | PASS | §6.2 第 169 行：事务内 CAS；拒绝陈旧、循环、重复补偿/void/remove。 |
| REQ-SAFE-001 | PASS | §2.1 第 27 行、§7.2 第 247—251 行：只有完整持久化可 committed，半写/错路径/不可证明提交均失败关闭。 |
| REQ-SAFE-002 | PASS | §7.1 第 239—243 行：根命令、Resolution、Correction/void 各有幂等键；同键返回原结果和最终进度引用。 |
| REQ-SAFE-003 | PASS | §6.6 第 205—231 行、§7.2 第 249 行：不足时提交纠错事实、跳过增量并开 Issue，禁止负库存。 |
| REQ-SAFE-004 | PASS | §4.1 第 106 行、§7.2 第 247—249 行：领域事件、真实/跳过效果、营养、Issue/Resolution、幂等和最终进度同一原子边界。 |
| REQ-SAFE-005 | PASS | §7.3 第 255 行：自然语言和各类输入不能指定路径；测试根仅适配器显式注入且隔离。 |
| REQ-SAFE-006 | FAIL | §7.1 第 241 行、§7.2 第 251 行虽要求失败关闭，但 §4.1 第 104/106 行仍无条件要求 `failed_storage`/失败追加事件，失败结果能否持久化存在双重解释，见 F-02。 |
| REQ-SAFE-007 | PASS | §6.3 第 173 行：查询、进度、Issue 和回顾只读 committed 最新有效视图。 |
| REQ-SAFE-008 | PASS | §5.3 第 132 行、§7.4 第 259—263 行：兼容组合与 mixed 有序、逐事件原子、独立幂等，后失败不回滚前成功。 |
| REQ-SAFE-009 | PASS | §7.5 第 267 行：数值单位成组，unknown 不变 0/空串/默认份/猜测单位。 |
| REQ-SAFE-010 | PASS | §7.5 第 269 行：规范十进制字符串/整数最小单位，JSONL/SQLite 投影禁止浮点漂移。 |

追踪表独立解析结果：`TOTAL=32`、`UNIQUE=32`、`MISSING=0`、`EXTRA=0`、`DUPLICATE=0`；全文范围 ID 也为 32 个且各出现一次。每个映射章节均有真实规范词，不存在结构性空映射；但 REQ-ISSUE-004 与 REQ-SAFE-006 的规范句相互作用后不能得到唯一可执行结果，因此语义验收为 FAIL。

## 5. 20 项标准复核

| # | 结论 | 复核结果 |
| ---: | --- | --- |
| 1 | FAIL | 身份、`status_source` 和上游 SHA 正确，但第 25 行的 `ignored=明确不处理` 未显式受上游仅根事实资格边界限制，见 F-01。 |
| 2 | PASS | 32 个 ID 各且仅一次，0 缺失、0 额外、0 重复，映射均有规范语义。 |
| 3 | FAIL | 两组状态字段已分离，但“先别扣库存”等 Issue 解决输入可被第 25 行解释为 `ignored`，也可被第 104/106 行解释为已追加的 committed resolution，命令结果不唯一。 |
| 4 | PASS | 恰有 3 kind、17 code、6 status；转换、终态、新 Issue 引用旧 Issue、deferred 提示与 invalidated 完整。 |
| 5 | FAIL | 字段和 outcome 齐全，但 `failed_storage` 是否必须形成已追加事件在审计存储不可用时不可能同时满足，追加语义不完整，见 F-02。 |
| 6 | PASS | 多 Issue 统一摘要但保留 `issue_ids[]` 身份；高价值选项、效果/非效果、安全出口及四类输入明确。 |
| 7 | PASS | 冲突组合任何效果前整体拒绝；兼容组合按回复顺序逐事件原子；旧版本全部重校验。 |
| 8 | PASS | 固定自由文本末行精确命中 2 处（规则与黄金文本），末行后禁止同组内容；进度规则引用展示契约。 |
| 9 | PASS | 固定 12 operation；Correction 字段完整、append-only、preview/CAS/循环/重复保护明确。 |
| 10 | PASS | 默认最新有效视图，详情全链；多候选仅展示人类日期/餐次/食品/数量，不暴露 ID。 |
| 11 | PASS | 增减、改关联、remove、void、跨日全部以真实应用效果为基准，禁止半补偿、虚假返还和错日聚合。 |
| 12 | PASS | 新有效事实创建新不可变营养快照；旧快照保留；进度来自纠正有效视图和同次最终事务结果。 |
| 13 | PASS | 两段黄金文本精确匹配；不足时 Correction committed、保留旧扣、增量跳过、不负库存并生成带 context 的 Issue。 |
| 14 | PASS | 替代批次选项仅在重校验确认真实足量候选时出现；无候选禁止编造；deferred、dismissed、不关联有不同结果；自然语言等价。 |
| 15 | PASS | 根命令、Resolution、Correction/void 幂等；响应丢失和 possible_duplicate 不会重演/合并副作用。 |
| 16 | FAIL | 正常事务边界完整；但审计存储自身失败时，第 106 行“失败必须追加”和第 251 行“存储失败失败关闭”之间缺少唯一优先规则，见 F-02。 |
| 17 | PASS | mixed 是顺序信封；子项独立键/原子，后失败不回滚前项，purchase 失败不丢可识别 meal，总结果逐项。 |
| 18 | PASS | 路径不受自然语言控制；数值/单位成组；unknown 保留；跨 JSONL/SQLite 使用精确数值语义。 |
| 19 | PASS | 旧规则只在 §8 非规范性审计中作为明确禁令出现；正文没有许可其复活。 |
| 20 | PASS | 复核写入前业务数据为 0；复核主体写入后仍为 0，无新增、修改或删除。 |

## 6. 13 个必做场景的唯一结果

| 场景 | 唯一合法结果 | 依据 | 结论 |
| --- | --- | --- | --- |
| 已记录 2 个鸡蛋改 3 个，库存足 | 同事务 committed Correction；保留原扣 2 个，只补扣 1 个；创建新营养快照并更新进度；用固定正常文案。 | §6.4、§6.6 | PASS |
| 同样纠正，库存不足且无候选 | Correction 仍 committed；事实/营养/进度按 3 个；原扣 2 个保留；新增 1 个 `skipped_insufficient`；建立带 `context=correction_increment` 的 Issue；只给“不关联/稍后”与固定末行。 | §6.6 | PASS |
| 同样纠正，有另一真实候选 | 先重校验；只有该候选真实且足量才增加“关联另一批次”选项，执行前再次校验；不能编造。 | §4.2、§6.6 | PASS |
| 三项餐只删除牛奶 | append `remove_item`；仅牛奶无效，只返还牛奶真实扣减，其他两项及整餐继续有效，营养/进度去除牛奶。 | §6.5 | PASS |
| void 整餐，一项原先未扣 | append `void_event`；整条 voided；只返还真正扣过的项目，未扣项绝不返还；相关非终态 Issue invalidated。 | §6.4、§6.5 | PASS |
| 今天改昨天 | append `change_time`；按用户时区同事务重算今天与昨天有效聚合/进度；不靠两次报告做差。 | §6.5 | PASS |
| 快捷回复 `A+C` 效果冲突 | 在任何效果前将整个组合记为 `rejected_conflict` 并消歧；不得先执行 A；消歧后再重校验。 | §5.3 | PASS |
| 自由文本“先别扣库存，以后再说” | 按 §3.4、§5.3 应唯一形成已持久化的 Resolution、命令 committed、Issue deferred；但 §2.1 第 25 行又把 `ignored` 定义为“明确不处理”，没有排除把本句当成 ignored，存在两个合法实现结果。 | §2.1、§3.4、§4.1、§5.3 | FAIL |
| 旧 prompt 在库存版本变化后执行 | 重新读取当前版本，追加 `rejected_stale`/失效结果并重生选项；旧效果绝不执行，Issue 保持非终态。 | §4.2、§5.2 | PASS |
| 同一纠错幂等键重试和响应丢失 | 返回原 CommitResult、原事件和原最终进度引用；不重复 Correction、补偿、营养、Issue 或进度；未知提交先失败关闭，再用同键读取。 | §7.1 | PASS |
| 两条相似内容但不同键 | 不自动合并、覆盖或删除；只提示/创建 `possible_duplicate`；用户确认独立事件后正常新提交。 | §7.1 | PASS |
| mixed：purchase 成功、meal 失败 | purchase 保持 committed；meal 独立 failed；总结果按原顺序逐项显示，不能以总成功隐藏 meal 失败。 | §7.4 | PASS |
| mixed：purchase 失败、meal 是明确已发生事实 | purchase failed；meal 仍 fact-first 独立 committed；依赖该 purchase 的库存效果只可 skipped + Issue，不能丢 meal。 | §7.4 | PASS |

从用户意图本身，“先别扣库存，以后再说”应是 deferred；“永不关联/不关联库存”应是 dismissed。问题不在自然语言分类，而在候选第 25 行没有明确规定：这两类 Issue Resolution 都必须持久化并返回 `committed`，绝不能因“明确不处理库存效果”返回根命令级 `ignored`。因此当前正文不能保证三路线唯一结果。

## 7. 独立检查命令与结果

### 7.1 哈希

```powershell
Get-FileHash -Algorithm SHA256 <brief, upstreams, candidate, report>
```

结果：五份冻结输入全部与复核包一致；候选和报告分别为 `1F492C...AB325`、`B554DF...31B9`。

### 7.2 追踪与枚举

对 §9 单独提取 `REQ-(ISSUE|QUICK|CORR|SAFE)-\d{3}`，并与 6+8+8+10 个预期 ID 做集合和分组比较；另在全文复核 ID 次数。结果：

```text
TRACE_TOTAL=32
TRACE_UNIQUE=32
TRACE_MISSING=0
TRACE_EXTRA=0
TRACE_DUP=0
FULLDOC_REQ_TOTAL=32
FULLDOC_REQ_UNIQUE=32
KINDS_DEFINED=3 MISSING=0
CODES_DEFINED=17 MISSING=0
STATUSES_DEFINED=6 MISSING=0
OPS_DEFINED=12 MISSING=0
```

状态转换四行全部精确命中；`applied/deferred/dismissed/rejected_expired/rejected_stale/rejected_conflict/failed_storage` 七个最低 outcome 全部命中。

### 7.3 规范词、固定文本和旧语义

全文计数 `MUST=151`、`MUST NOT=56`。固定自由文本行逐字符命中 2 次。对两个 `text` 代码块按 CRLF/LF 归一后与简报固定文本精确比较，`NORMAL_EXACT=True`、`INSUFFICIENT_EXACT=True`。

对“所有歧义 preview、库存异常导致 failed/preview、禁止纠错、静默覆盖/物理删除、单项等于整餐 void、mixed 全局回滚、旧选项直接执行、模板唯一输入、营养估算量补偿、默认一份、浮点漂移”等模式逐条检查：只出现明确 MUST NOT 或 §8 superseded 审计，没有现行许可。

### 7.4 业务数据

```powershell
$ext=@('.jsonl','.sqlite','.sqlite3','.db')
Get-ChildItem -LiteralPath 'E:\codx\skill\饮食管家' -Recurse -File |
  Where-Object { $ext -contains $_.Extension.ToLowerInvariant() }
```

写入前：`BUSINESS_DATA_BEFORE_COUNT=0`。写入后结果见 §3 最终行。

## 8. 发现与初审历史

### 初审历史

机械结构、枚举、黄金文本与最初 13 场景推演均通过后，复核曾形成“暂定 PASS、0 发现”。在对第 25 行命令状态和第 104/106/251 行失败语义做交叉复核后，发现以下两处双重解释；按复核包“任一高/中发现或双重解释必须 FAIL”，最终结论改为 FAIL。该历史保留，修复后必须在同一文件追加复审，不得删除。

### F-01：`ignored` 的“明确不处理”会放宽上游边界

- 严重度：中。
- 位置：候选 §2.1 第 25 行；对照 §1 第 17 行、§4.1 第 104/106 行、§6.6 第 220—231 行；上游 CONTRACT-v1 §4。
- 现象：第 25 行把 `ignored` 概括为命令“明确不处理”，没有限定它只适用于上游定义的计划、假设、明确否定、发生前取消和明确非本人根事实。于是“先别扣库存，以后再说”既可按第 92、104、106、130 行追加 Resolution、返回 committed 并将 Issue 设为 deferred，也可被实现者依据第 25 行判为 ignored、不追加 Resolution。“不关联库存”同样可能错误落到 ignored，而不是 committed resolution + dismissed。
- 影响：A/B/C 可产生不同命令结果、Issue 状态和审计事件；延后/放弃可能不被持久化，后续重复提示和幂等结果不一致。
- 最小修复：在 §2.1 明确写出：`ignored` 仅沿用 CONTRACT-v1 对未进入本人正式账本的根事实资格判定；“暂不处理/不关联/保持原样”属于 IssueResolution，必须追加 Resolution，完整持久化后命令返回 `committed`，Issue 分别进入 `deferred/dismissed`，绝不能返回 `ignored`。同时把“明确不处理”改成不会涵盖附加副作用的定义。

### F-02：`failed_storage` 与“失败必须追加事件”在存储本身失败时矛盾

- 严重度：中。
- 位置：候选 §4.1 第 104、106 行；§7.1 第 241 行；§7.2 第 247、251 行。
- 现象：第 104 行把 `failed_storage` 定义为 IssueResolutionEvent outcome，第 106 行又无条件要求“重试失败和失效 MUST 通过追加事件表达”；但第 251 行规定 JSONL 损坏、SQLite 事务/迁移或其他存储错误必须失败关闭。若失败的是承载 IssueResolutionEvent 的同一可靠存储，系统无法追加 `failed_storage` 事件；正文没有区分“业务副作用失败但审计存储仍可用”和“审计/事务存储自身不可用”，也没有说明未持久化的失败响应不得声称产生 resolution_event_id。
- 影响：实现可能为了满足第 106 行谎称失败事件已持久化，或为了失败关闭不追加事件却违反第 106 行；响应丢失后的重试也无法判断应返回已保存 `failed_storage` 还是普通 `failed`。
- 最小修复：明确两层失败。若业务副作用或外部依赖失败、但权威事务存储可用，则可以原子追加带精确 outcome 的 ResolutionEvent，命令结果按契约定义；若权威审计/事务存储本身不可用或提交未知，则命令返回 `failed` 并失败关闭，MUST NOT 声称已经追加任何事件、事件 ID 或幂等结果。恢复后只允许用同一幂等键查询/重试；只有确认原事务未提交且新事务可用时，才能持久化新的尝试结果。相应限定第 106 行的“失败必须追加”范围。

## 9. 最终判定

在候选 SHA-256 保持 `1F492CC141062B50E32EAB83797177B58677D0A3E5CDDFF4222ACC33A96AB325`、实施报告 SHA-256 保持 `B554DF32E4B1557D74B1B70BA63FF0C35B0062885611388A453707BEFBD631B9` 的前提下，SH-CONTRACT-004 独立复核判定为 **FAIL**。候选需先修复 F-01、F-02，再以新哈希重新冻结并独立复审；当前不得进入完成状态。

---

## 10. 第 2 轮完整独立复审

### 10.1 第 2 轮最终结论

- 复审者：`/root/issue_correction_review`，与第 1 轮相同，仍不是实现者。
- 第 2 轮结论：**PASS**。
- 第 1 轮 F-01：已修复并通过复验。
- 第 1 轮 F-02：已修复并通过复验。
- 第 2 轮新发现：0。
- 高/中/低严重度未解决发现：0/0/0。
- 32 条范围需求：32/32 PASS。
- 20 项复核标准：20/20 PASS。
- 13 个必做语义场景：13/13 PASS。
- 剩余阻断数：0。
- Q-004：仍为“开放”；当前候选没有越权宣称关闭，后续仍需案例 Oracle。

### 10.2 第 2 轮冻结输入

| 输入 | 第 2 轮冻结 SHA-256 | 独立实测 SHA-256 | 结论 |
| --- | --- | --- | --- |
| `docs/work-items/SH-CONTRACT-004-brief.md` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` | `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` | PASS |
| `shared/business-contract.md` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | `CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D` | PASS |
| `shared/contracts/receipt-and-date-contract.md` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | `D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968` | PASS |
| `shared/contracts/issue-correction-contract.md` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` | `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA` | PASS |
| `docs/work-items/SH-CONTRACT-004-report.md` | `439AE4CDA608565C4D3EC1E7A16E6B9BB511435440EDBAA7465CE31B09B60C4D` | `439AE4CDA608565C4D3EC1E7A16E6B9BB511435440EDBAA7465CE31B09B60C4D` | PASS |

复审重新完整阅读了修订简报、两份上游、修复候选和实施报告，而非只看差异。候选 front matter 仍只有 `status_source`，没有动态状态或提前完成声明；上游哈希未变。

### 10.3 F-01、F-02 定向复验

#### F-01：PASS

- 第 25 行把 `ignored` 定义为“根事实不具备正式入账资格”，不再使用可能涵盖副作用选择的“明确不处理”。
- 第 27 行以 MUST 明确 `ignored` 仅限计划、假设、明确否定、发生前取消、明确非本人事实，且不得产生业务写入。
- 对已提交事实，“暂不处理/先别扣/以后再说”必须追加 `IssueResolutionEvent(outcome=deferred)`，Issue 为 `deferred`，完整持久化后命令为 `committed`。
- “永不关联/不关联库存”必须追加 `IssueResolutionEvent(outcome=dismissed)`，Issue 为 `dismissed`，完整持久化后命令为 `committed`。
- 第 122 行在快捷出口再次冻结相同边界，第 235 行把黄金选项 A/B 和等价自由文本逐项映射到 dismissed/deferred，且明确绝不能返回 `ignored`。

因此“不处理根事实”与“对已提交事实延后/放弃附加效果”已有唯一、互斥的命令语义，F-01 关闭。

#### F-02：PASS

- 第 106 行把已持久化 Resolution outcome 固定为 `applied/deferred/dismissed/rejected_expired/rejected_stale/rejected_conflict/rejected_effect`；`failed_storage` 仅是未持久化命令错误码，禁止作为已持久化 outcome，也禁止声称 `resolution_event_id`。
- 第 108 行区分两层：权威审计存储可用时，业务拒绝/失效追加事件；审计/事务存储自身不可用、回滚或提交未知时，命令 `failed`、Issue/业务效果原样，并禁止声称 Resolution、Correction、状态事件、幂等成功或任何事件 ID。
- 第 114、253 行把纯副作用失败进一步固定为：审计存储可用时原子追加 `rejected_effect` 且不应用业务效果；审计存储不可用时只返回未持久化 `failed`。
- 第 255 行规定存储恢复后仅以原幂等键查询/重试；只有确认原事务未提交且新事务可用时才可持久化新尝试。

因此不再要求“持久化一个因存储不可用而无法持久化的失败事件”，也不会伪造事件或幂等成功，F-02 关闭。

### 10.4 第 2 轮 32 条需求逐项复审

| 需求 | 结论 | 第 2 轮独立证据 |
| --- | --- | --- |
| REQ-ISSUE-001 | PASS | §2.2 第 33—35 行：事实优先，附加缺口只形成稳定跳过/未知和 Issue。 |
| REQ-ISSUE-002 | PASS | §3.4 第 96 行：多问题统一按影响排序摘要，不逐字段连问。 |
| REQ-ISSUE-003 | PASS | §3.4 第 94 行：deferred 后只按规定触发再次提供。 |
| REQ-ISSUE-004 | PASS | §3.4 第 92 行、§4.1 第 106—108 行：审计可用时追加；审计存储失败时命令 failed 且不伪造事件；改变事实同事务 Correction。 |
| REQ-ISSUE-005 | PASS | §4.2 第 112 行：延迟库存效果执行前重读当前 Issue、有效记录、版本、商品、批次、库存和规则。 |
| REQ-ISSUE-006 | PASS | §3.4 第 92 行、§6.5 第 193 行：void/替代令非终态 Issue 同事务 invalidated，终态不重复。 |
| REQ-QUICK-001 | PASS | §5.1 第 120 行：只在关键不确定性或真实候选实质影响结果时提供。 |
| REQ-QUICK-002 | PASS | §5.1 第 120 行：受 CONTRACT-v1 规范词约束的 SHOULD 优先 2–4 高价值项，禁止笛卡尔组合。 |
| REQ-QUICK-003 | PASS | §5.1 第 122 行、§5.2 第 126 行：选项依据、真实效果、非效果、受影响 Issue 完整。 |
| REQ-QUICK-004 | PASS | §5.1 第 122 行：安全出口不默认、不暗改；deferred/dismissed 明确且不落 ignored。 |
| REQ-QUICK-005 | PASS | §5.3 第 132—134 行：字母、组合、顺序、自由文本等价；冲突先整体拒绝，兼容项有序原子。 |
| REQ-QUICK-006 | PASS | §5.2 第 126 行：prompt/Issue/option/effect/non-effect/冲突组/各版本/规则/有效期齐全。 |
| REQ-QUICK-007 | PASS | §5.2 第 128 行、§5.3 第 134 行：旧选项和消歧后执行均重校验。 |
| REQ-QUICK-008 | PASS | §5.3 第 136—142 行：固定末行逐字符正确，之后禁止同组内容。 |
| REQ-CORR-001 | PASS | §6.1 第 148 行：committed 只追加，preview 只出新 preview 版本。 |
| REQ-CORR-002 | PASS | §6.3 第 175 行：默认 committed 最新有效视图，详情保留全链和真实效果。 |
| REQ-CORR-003 | PASS | §6.4 第 181—187 行：按真实已应用效果做差量，创建新不可变营养快照。 |
| REQ-CORR-004 | PASS | §6.5 第 191 行：remove_item 只移除单项并只返还该项真实扣减。 |
| REQ-CORR-005 | PASS | §6.5 第 193 行：void 整条、只返还真实扣减、Issue 失效、历史可查。 |
| REQ-CORR-006 | PASS | §6.5 第 195 行：用户时区跨日同事务重算旧/新日，同日只一次。 |
| REQ-CORR-007 | PASS | §6.3 第 177 行：多候选不猜，只展示人类日期/餐次/食品/数量，不暴露 ID。 |
| REQ-CORR-008 | PASS | §6.2 第 171 行：事务 CAS；拒绝陈旧、循环、重复补偿/void/remove。 |
| REQ-SAFE-001 | PASS | §2.1 第 29 行、§7.2 第 251—255 行：仅完整可证明持久化才 committed，半写/错路径/未知提交均失败关闭。 |
| REQ-SAFE-002 | PASS | §7.1 第 243—247 行：根命令、Resolution、Correction/void 各有键；同键返回原结果和进度引用，不重演副作用。 |
| REQ-SAFE-003 | PASS | §6.6 第 207—235 行、§7.2 第 253 行：不足时事实 committed、旧扣保留、增量跳过并开 Issue，禁止负库存。 |
| REQ-SAFE-004 | PASS | §4.1 第 108 行、§7.2 第 251—253 行：事件、真实/跳过效果、营养、Issue/Resolution、幂等、最终进度同一原子边界。 |
| REQ-SAFE-005 | PASS | §7.3 第 259 行：输入不能改数据路径，测试根仅适配器显式注入且必须隔离。 |
| REQ-SAFE-006 | PASS | §7.1 第 245 行、§7.2 第 253—255 行：损坏、事务/迁移失败和未知提交均失败关闭；failed_storage 不伪装事件；恢复同键。 |
| REQ-SAFE-007 | PASS | §6.3 第 175 行：查询、进度、Issue 和回顾只读 committed 最新有效视图。 |
| REQ-SAFE-008 | PASS | §5.3 第 134 行、§7.4 第 263—267 行：兼容组合与 mixed 有序逐事件原子，子键稳定，后失败不回滚前成功。 |
| REQ-SAFE-009 | PASS | §7.5 第 271 行：数值/单位成组，unknown 不变 0、空串、默认份或猜测单位。 |
| REQ-SAFE-010 | PASS | §7.5 第 273 行：规范十进制/整数最小单位，JSONL/SQLite 禁止浮点漂移。 |

独立解析结果：`TRACE_TOTAL=32`、`UNIQUE=32`、`MISSING=0`、`EXTRA=0`、`DUP=0`；全文范围 ID 仍只有这 32 个且各一次。全部映射章节均有可执行的 MUST/MUST NOT 或受共同例外机制约束的 SHOULD，没有空映射或相互冲突。

### 10.5 第 2 轮 20 项标准

| # | 结论 | 第 2 轮结果 |
| ---: | --- | --- |
| 1 | PASS | 身份、status_source、上游优先级、companion 边界清楚；F-01 后 ignored 与上游一致；无动态状态。 |
| 2 | PASS | 32 ID 各且仅一次，0 缺失、0 额外、0 重复，映射均有规范语义。 |
| 3 | PASS | 四命令结果与三生命周期严格分离；库存/营养异常不否认事实；deferred/dismissed 均 committed Resolution。 |
| 4 | PASS | 3 kind、17 code、6 status、转换/终态/重开/deferred/invalidated 全部完整。 |
| 5 | PASS | Resolution 字段、7 个持久化 outcome、追加语义、同事务 Correction 和纯副作用失败边界完整；failed_storage 明确非事件。 |
| 6 | PASS | 多 Issue 统一摘要且保留身份；2–4 高价值项、效果/非效果、安全出口、四类输入完整。 |
| 7 | PASS | 冲突组合效果前整体拒绝；兼容项按回复顺序逐事件原子；旧版本执行前重校验。 |
| 8 | PASS | 固定自由文本末行精确 2 处，之后无同组建议；进度/日期遵循展示契约。 |
| 9 | PASS | 12 operation、字段、append-only、preview/CAS/循环/重复防护完整。 |
| 10 | PASS | 默认最新有效视图，详情保留全链；多候选人类可读且无内部 ID。 |
| 11 | PASS | 增减、改关联、remove、void、跨日均基于真实效果，无半补偿、虚假返还、错日进度。 |
| 12 | PASS | 纠正事实创建新不可变营养快照，旧快照保留；进度同次最终事务且不做报告差。 |
| 13 | PASS | 两段黄金文本精确；不足时 Correction committed、旧扣保留、增量跳过、不负库存、Issue context 正确。 |
| 14 | PASS | 替代候选仅在真实足量时提供；无候选不编造；deferred/dismissed 分离；自由文本等价。 |
| 15 | PASS | 根命令、Resolution、Correction/void 幂等；响应丢失/可能重复均不重演或合并副作用。 |
| 16 | PASS | 单事件原子边界完整；损坏、迁移、审计存储失败和未知提交结果失败关闭且不伪造失败事件。 |
| 17 | PASS | mixed 顺序信封、独立子键、per-event atomic、后失败不回滚前项、purchase 失败不丢 meal、总结果逐项。 |
| 18 | PASS | 路径不受自然语言控制；数值/单位成组；unknown 保留；跨路线精确十进制语义。 |
| 19 | PASS | 10 条旧规则只在 superseded 审计中作为禁令出现，未在现行语义复活。 |
| 20 | PASS | 第 2 轮复审写入前业务数据为 0；写入后扫描见 §10.8。 |

### 10.6 第 2 轮 13 个场景

| 场景 | 唯一合法结果 | 结论 |
| --- | --- | --- |
| 2 个鸡蛋改 3 个，库存足 | committed Correction；保留原扣 2，只补扣 1；新营养快照、最终进度和固定正常文案。 | PASS |
| 同纠正，库存不足且无候选 | Correction committed；事实/营养/进度按 3；原扣 2 保留；新增 1 skipped_insufficient；带 context Issue；A/B 安全出口。 | PASS |
| 同纠正，有另一真实候选 | 重校验确认真实且足量后才显示/执行替代批次；不存在不得编造。 | PASS |
| 三项餐只删除牛奶 | append remove_item；只使牛奶无效并返还其真实扣减；其余项目与整餐有效。 | PASS |
| void 整餐，一项原先未扣 | append void；整条 voided；只返还实际扣过的项目，未扣项不返还；相关非终态 Issue invalidated。 | PASS |
| 今天改昨天 | append change_time；按用户时区同事务重算今天和昨天，不以两报告相减。 | PASS |
| A+C 冲突 | 在任何效果前 rejected_conflict，整体不执行并消歧；消歧后再重校验。 | PASS |
| “先别扣库存，以后再说” | committed IssueResolutionEvent(outcome=deferred)，Issue deferred，库存不扣；绝不 ignored。 | PASS |
| 旧 prompt 遇库存版本变化 | 审计可用时追加 rejected_stale/失效结果并重生；不执行旧效果；审计不可用则未持久化 failed。 | PASS |
| 同纠错键重试/响应丢失 | 返回原 CommitResult/事件/最终进度引用，不重复任何效果；未知提交失败关闭且同键查询。 | PASS |
| 相似内容不同键 | 不自动合并/覆盖/删除；只 possible_duplicate；确认独立后新提交。 | PASS |
| mixed：purchase 成功、meal 失败 | purchase committed 保留；meal failed；总结果逐项且不伪装全成功。 | PASS |
| mixed：purchase 失败、meal 明确已发生 | purchase failed；meal fact-first 独立 committed；库存仅 skipped + Issue，不能丢 meal。 | PASS |

13 个场景均由候选正文得到唯一结果，没有相互冲突的合法解释。特别地，“以后再说”与“不关联库存”分别唯一对应 deferred 与 dismissed，但二者都是已持久化 Resolution 的 committed 命令。

### 10.7 第 2 轮自动与文本检查结果

```text
TRACE_TOTAL=32
TRACE_UNIQUE=32
TRACE_MISSING=0
TRACE_EXTRA=0
TRACE_DUP=0
FULLDOC_REQ_TOTAL=32
FULLDOC_REQ_UNIQUE=32
KINDS=3 MISSING=0
CODES=17 MISSING=0
STATUSES=6 MISSING=0
OPS=12 MISSING=0
PERSISTED_OUTCOMES=7 MISSING=0
FREE_TEXT_EXACT_COUNT=2
MUST_COUNT=175
MUST_NOT_COUNT=66
NORMAL_EXACT=True
INSUFFICIENT_EXACT=True
F01_IGNORED_ROOT_ONLY=True
F01_DEFER_COMMITTED=True
F01_DISMISS_COMMITTED=True
F02_FAILED_NOT_EVENT=True
F02_NO_FALSE_IDS=True
F02_RECOVERY_SAME_KEY=True
```

四行状态转换全部精确命中。对所有歧义 preview、库存异常导致 failed/preview、禁止纠错、静默覆盖/物理删除、单项等于整餐 void、mixed 全局回滚、旧选项直执行、模板唯一输入、营养估算量补偿、默认一份、浮点漂移等旧语义重新扫描；命中项只处于 MUST NOT 或 superseded 禁令中。

### 10.8 第 2 轮业务数据快照

扫描 `E:\codx\skill\饮食管家` 下全部 `.jsonl`、`.sqlite`、`.sqlite3`、`.db`，比较路径、大小、SHA-256 与 UTC mtime。

| 时点 | 文件数 | 明细 | 结论 |
| --- | ---: | --- | --- |
| 第 2 轮复审写入前 | 0 | 无 | PASS |
| 第 2 轮复审主体写入后（2026-08-09 16:33:03 +08:00） | 0 | 无 | PASS |

本轮没有执行业务写入、迁移、构建或案例；唯一写入仍是本复核记录。

### 10.9 第 2 轮发现与最终判定

第 2 轮没有新发现。第 1 轮 F-01、F-02 均已按最小安全语义修复并全量回归通过；旧 FAIL 历史保留于本文件 §1—9。

在候选 SHA-256 保持 `45D6C3E60A12F3AE3E07588AD68F5FB0937A503DB8BE90DA2D216A72CD753EDA`、实施报告 SHA-256 保持 `439AE4CDA608565C4D3EC1E7A16E6B9BB511435440EDBAA7465CE31B09B60C4D`、简报 SHA-256 保持 `05BD4FD967C9CF57352B7E011A5DC0A1AB6BB99547DB6A06B8F0B5775F216A48` 的前提下，SH-CONTRACT-004 第 2 轮独立复审判定为 **PASS**。该结论仅覆盖契约任务，不提前替代 Schema、物理映射、三路线实现、案例 Oracle 或 Q-004 关闭。
