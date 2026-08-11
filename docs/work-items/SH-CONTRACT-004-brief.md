# SH-CONTRACT-004 实施简报：Issue、快捷解决与追加纠错契约

## 1. 任务身份

- 任务 ID：`SH-CONTRACT-004`
- 唯一状态来源：`总功能开发计划0.2.md` 第 22 节
- 交付物：`shared/contracts/issue-correction-contract.md`
- 上游核心契约：`shared/business-contract.md`
- 上游 SHA-256：`CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D`
- 展示接口契约：`shared/contracts/receipt-and-date-contract.md`
- 展示契约 SHA-256：`D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968`
- 启动时计划 SHA-256：`C25EE2A374C5CF66118E298CF1140BFD005F2B7A48441A2F48954E9B6BFABCA8`
- 范围：`REQ-ISSUE-001~006`、`REQ-QUICK-001~008`、`REQ-CORR-001~008`、`REQ-SAFE-001~010`，共 32 条。
- 不在范围：物理 Schema、JSONL/SQLite 映射、来源客户端、A/B/C 路线实现、完整验收案例集、任意历史物理改写。

## 2. 目标与不可突破边界

本契约必须让三条路线对以下行为得到同一个答案：

1. 已发生且核心事实足够时，Issue 只能描述资料缺口或被跳过的附加效果，不能把事实降为失败；
2. 同一记录的多个问题统一摘要、可组合解决、可延后且不反复骚扰；
3. 快捷选项只是高效入口，自由文本具有同等能力；旧选项执行前必须重校验；
4. 已提交记录只能通过 append-only correction/void 改变有效视图，原事实、旧快照和旧依据永久可审计；
5. 纠错同步处理库存已应用效果、营养快照、有效视图和受影响日期 `daily_progress`；
6. 库存补扣不足不得产生负库存，也不得否认用户纠正后的饮食事实；
7. 幂等、故障关闭、逐事件原子、路径固定、有效视图和精确数值在所有路线一致。

本契约只细化 Issue/Resolution/Correction/void 的载体、状态、字段、展示与事务结果，绝不能缩窄上游已冻结的事实优先、单一可靠事务、库存补偿、营养重算、进度更新和历史审计。

## 3. 32 条需求逐项口径

### 3.1 Issue（6 条）

| 需求 | 必须冻结的行为 |
| --- | --- |
| `REQ-ISSUE-001` | Issue 不等于命令失败。核心事实足够时先原子提交事实；数量、库存、营养或资料问题分别登记并保持稳定原因。只有核心事实本身不能安全形成或持久化失败时才可阻止相应提交。 |
| `REQ-ISSUE-002` | 同一消息/记录的多个问题必须统一摘要并按影响排序；不得为每个可选字段连续追问。一次提示可以关联多个 issue。 |
| `REQ-ISSUE-003` | 用户选择稍后处理后转为 `deferred`，正常对话不反复打扰；仅在用户主动查看异常、日回顾、相关商品/记录操作或问题影响升级时再提示。 |
| `REQ-ISSUE-004` | 在审计存储可用时，解决、放弃、延后、前置条件拒绝或失效都以追加 `IssueResolutionEvent`/状态事件表达，不能静默覆盖原 Issue 或业务事实；若补充同时改变已提交事实，必须在同一事务追加对应 CorrectionEvent，二者不能互相代替。审计存储本身失败时返回 `failed`，不声称已追加失败事件，Issue 与业务效果保持原状。 |
| `REQ-ISSUE-005` | 任何延迟库存关联、扣减、返还或补偿都必须重新读取当前 Issue、目标记录、批次、库存、版本和适用规则；陈旧时不得按旧快照执行。 |
| `REQ-ISSUE-006` | 原记录或相关项目被 void 后，其仍开放/已提供/已延后的相关 Issue 在同一事务中转为 `invalidated`；已终结 Issue 不被反复终结。 |

### 3.2 快捷选项（8 条）

| 需求 | 必须冻结的行为 |
| --- | --- |
| `REQ-QUICK-001` | 只在关键不确定性或多个真实类别/候选会实质影响位置、保质、营养、库存或纠错目标时提供；明确判断不提供。 |
| `REQ-QUICK-002` | 每个问题优先 2–4 个最有价值选项；统一提示可覆盖多个 Issue，但不得枚举低价值笛卡尔组合。 |
| `REQ-QUICK-003` | 每个选项来自当前数据、可靠换算或明确估算，并写明执行后的真实效果、不会发生的效果和涉及的 Issue。 |
| `REQ-QUICK-004` | 每组包含“保持原样”“暂不处理”或“不关联”等安全出口；安全出口不能被默认选中或暗中改写数据。 |
| `REQ-QUICK-005` | 支持单字母、组合字母、顺序指代和自然语言。组合选择必须先判断兼容性；互斥/冲突选项不执行，先消歧。模板不是唯一输入格式。 |
| `REQ-QUICK-006` | 持久化 `prompt_id`、关联 `issue_ids[]`、`option_id`、选项效果、生成时目标/Issue/库存版本、规则版本、生成时间和有效期。 |
| `REQ-QUICK-007` | 执行前重校验目标、Issue、商品、库存、预览/记录版本和选项兼容性；过期或版本变化时追加拒绝/失效结果并重生选项，不直接执行旧效果。 |
| `REQ-QUICK-008` | 每组最后一行必须原样为“也可以直接说明实际情况，不必选择以上选项。” |

### 3.3 Correction/void（8 条）

| 需求 | 必须冻结的行为 |
| --- | --- |
| `REQ-CORR-001` | 已提交记录只追加 `CorrectionEvent`/`void_event`；不覆盖、不物理删除原事件和旧快照。未提交 preview 的修改只产生新 preview 版本，不伪造 CorrectionEvent。 |
| `REQ-CORR-002` | 默认查询只显示最新有效视图；详情可查看根事件、每个纠错版本、void、旧营养快照、库存效果和依据。 |
| `REQ-CORR-003` | 数量、单位、组件、名称、类型、增项、库存关联或营养来源变化时，按“原已应用库存效果 → 新目标效果”的差量补偿，并创建新营养快照；只返还/补扣真实已应用效果。 |
| `REQ-CORR-004` | `remove_item` 只使目标项目无效，返还该项目真实已扣库存并从营养/进度有效视图移除；其他项目和整餐保持有效。 |
| `REQ-CORR-005` | `void_event` 使整条根事件有效状态为 `voided`，返还全部真实已扣效果、使相关开放 Issue 失效，并从当前聚合移除；历史仍可查。 |
| `REQ-CORR-006` | 时间从一个自然日改到另一个自然日时，在同一事务中重算旧日和新日的有效聚合/进度；同日只更新一次。日期按用户时区。 |
| `REQ-CORR-007` | 多候选目标不猜，展示符合日期契约的人类可读时间、餐次、食品和数量；绝不暴露事件/记录/数据库内部 ID。 |
| `REQ-CORR-008` | 使用 `target_version`/等价 CAS 拒绝陈旧提交；禁止纠错链循环、重复补偿、重复 void 和对已无效项目再次移除。 |

### 3.4 安全（10 条）

| 需求 | 必须冻结的行为 |
| --- | --- |
| `REQ-SAFE-001` | 只有所定义事务结果完整持久化后才返回 `committed`；未写、半写、错路径都不能报成功。 |
| `REQ-SAFE-002` | 相同 `idempotency_key` 返回原 `CommitResult` 和原最终进度快照引用；不得重复事件、扣减/返还、Issue、模板学习或累计。Issue 解决和 Correction 也各有幂等键。 |
| `REQ-SAFE-003` | 并发、纠错和延迟处理永不负库存；不足时提交可识别饮食/纠错事实，跳过无法安全完成的新增扣减并登记 Issue。 |
| `REQ-SAFE-004` | 单一业务事件的事件、真实库存效果、营养快照、Issue/Resolution、幂等结果和最终进度在同一可证明原子边界；“跳过效果+Issue”也是明确事务结果，不是半事务。 |
| `REQ-SAFE-005` | 普通自然语言、Issue 选项和 Correction 输入都不能指定数据路径；正式根固定配置，测试根只能由测试适配器显式注入。 |
| `REQ-SAFE-006` | JSONL 损坏尾部、SQLite 事务/迁移失败或无法判定响应是否提交时失败关闭；不猜提交成功。响应丢失后的同幂等键重试读取原结果。 |
| `REQ-SAFE-007` | 查询、进度、Issue 关联和回顾只读取 `committed` 的最新有效视图；排除 preview、failed、ignored、旧纠错版本和 voided。 |
| `REQ-SAFE-008` | mixed 信封按叙述顺序拆分并逐事件原子提交；后一事件失败不回滚前一独立成功事件；总结果逐项报告。 |
| `REQ-SAFE-009` | 数值与单位成组校验；未知保持缺失/`unknown`，不能用 0、空字符串或默认一份代替。 |
| `REQ-SAFE-010` | 业务关键数值使用规范十进制字符串/整数最小单位或等价精确方案；JSONL/SQLite 投影不得产生二进制浮点漂移。 |

## 4. Issue 模型与状态机

### 4.1 分类和稳定代码

`issue_kind` 只允许：

- `anomaly`：影响库存、营养或事实准确性的待处理问题；
- `enrichment`：不阻止事实、可后续补齐的资料；
- `blocking`：核心事实本身不能安全形成，或纠错/解决目标不能安全确定。不得用 blocking 阻止已经足够明确的饮食事实。

最低代码必须恰含计划中的 17 项：`missing_quantity`、`vague_quantity`、`quantity_range`、`missing_unit`、`missing_package_content`、`conflicting_package_spec`、`unknown_product_type`、`unconvertible_unit`、`ambiguous_inventory_match`、`insufficient_inventory`、`missing_nutrition`、`partial_nutrition`、`missing_expiration`、`uncertain_event_time`、`possible_duplicate`、`stale_preview`、`correction_target_not_found`。纠错补扣不足使用 `insufficient_inventory` 并保存 `context=correction_increment`、所需差量和已应用差量，不另造语义重复代码。后续扩展代码必须版本化，不能改变历史含义。

### 4.2 字段

Issue 至少表达：

```text
issue_id
issue_version
issue_kind
issue_code
entity_type
entity_id
field_path
known_facts
missing_or_conflicting_facts
impact
allowed_resolutions[]
status
attention_policy
detected_at
last_offered_at
deferred_until_or_trigger
resolved_at
resolution_event_id
invalidated_by_event_id
rule_version
```

内部 ID 只用于持久化/关联，用户回执不得暴露。

### 4.3 状态和转换

状态只允许：`open`、`offered`、`deferred`、`resolved`、`dismissed`、`invalidated`。

允许转换：

```text
open -> offered | deferred | resolved | dismissed | invalidated
offered -> offered(new version) | deferred | resolved | dismissed | invalidated
deferred -> offered | resolved | dismissed | invalidated
resolved/dismissed/invalidated -> terminal
```

目标被冲销、目标版本被替代或问题不再适用于当前有效记录时，任何未终结状态都必须转为 `invalidated`。陈旧、过期或冲突的解决尝试追加 `IssueResolutionEvent(outcome=rejected_*)`，不应用业务效果；Issue 保持当前非终态或生成新版本/新提示。终态不得原地重开；新事实需要处理时创建新 Issue 并引用旧 Issue。

## 5. IssueResolutionEvent 与快捷提示

`IssueResolutionEvent` 至少表达：

```text
resolution_event_id
resolution_group_id
issue_id
expected_issue_version
prompt_id
selected_option_ids[]
supplied_facts
source_text
operation
revalidated_versions
outcome
applied_effects[]
skipped_effects[]
resulting_issue_status
idempotency_key
created_at
```

已持久化 `IssueResolutionEvent.outcome` 至少区分 `applied`、`deferred`、`dismissed`、`rejected_expired`、`rejected_stale`、`rejected_conflict`、`rejected_effect`。只有 `applied/deferred/dismissed` 可推动相应终态或延后状态；拒绝结果不伪装成成功。`failed_storage` 只能是命令错误码/结果，表示审计事务本身没有可靠持久化，绝不是一个已经持久化的 IssueResolutionEvent outcome。

若 IssueResolutionEvent 的补充改变数量、单位、组件、时间、项目、库存关联或营养来源，必须在同一可靠事务中追加对应 CorrectionEvent，并共同提交库存/营养/进度结果。纯副作用解决（例如只把既有 Issue 关联到另一库存）若返还或扣减不能安全完成，不得把 Issue 标成 `resolved`，原有效库存效果保持；审计存储可用时追加 `rejected_effect` 并继续开放或重新提供，审计存储不可用时返回 `failed` 且不声称任何事件已提交。

一个提示可关联多个 Issue。兼容的组合选择按用户回复顺序拆成一个有序 resolution group，每个 IssueResolutionEvent 独立原子；较后项失败不回滚前一独立成功项，总回执逐项说明。若两个选项改变同一事实/库存效果且无法证明兼容，整个冲突组合在任何效果前拒绝并请求消歧。

快捷提示至少保存：`prompt_id`、`issue_ids[]`、每个 `option_id`、`effect_summary`、`affected_issue_ids[]`、`conflict_group`、目标/Issue/库存版本、规则版本、`generated_at`、`expires_at`。自然语言解析必须得到与相同选项一致的业务操作；无法唯一解析时只澄清，不执行。

## 6. CorrectionEvent、有效视图与补偿

### 6.1 操作

固定操作：`change_amount`、`change_unit`、`change_time`、`change_meal_slot`、`change_item_name`、`change_item_type`、`change_components`、`add_item`、`remove_item`、`change_inventory_link`、`change_nutrition_source`、`void_event`。

`CorrectionEvent` 至少表达：

```text
correction_id
root_event_id
target_event_id
target_item_id
target_version
operation
before_snapshot
supplied_facts
source_text
inventory_compensation
nutrition_recalculation
affected_local_dates[]
resulting_version
idempotency_key
created_at
```

### 6.2 差量规则

库存补偿以“原有效版本真实已应用库存效果”和“新有效版本可安全应用的目标效果”计算：

- 下调数量/移除/void：只返还原来真实扣过的数量；原来跳过的数量不能凭空返还。
- 上调数量：原已扣效果保留，只对新增差量尝试扣减；必须重新校验商品、批次、单位和足量。
- 改关联：先计算原关联真实返还，再计算新关联可安全扣减；两者和 Correction 在同一事务中提交。
- 营养始终按纠正后的有效事实创建新不可变快照；旧快照保留。
- 进度以纠正后的有效视图重算，不从两个独立查询结果做差。

### 6.3 库存补扣不足

用户明确把已记录数量上调，而新增库存差量不足时：

1. 追加 CorrectionEvent，饮食有效视图、营养和受影响日期进度按用户纠正后的事实更新；
2. 保留原来已经真实应用的库存扣减；
3. 不产生负库存，不伪造新增扣减；
4. 在同一事务中把新增差量记为 `skipped_insufficient`，创建 `insufficient_inventory` Issue，并保存 `context=correction_increment`；
5. 回执明确区分“饮食已更正”和“新增库存尚未扣”，后续解决前重新校验。

固定正常补扣简洁回执：

```text
已更正：9号早餐
鸡蛋｜2个 → 3个
库存：已补扣鸡蛋1个
```

固定无候选补扣不足简洁回执：

```text
已更正：9号晚餐
鸡蛋｜2个 → 3个
库存：原已扣2个；新增1个未扣（当前库存不足）
待补充：新增1个鸡蛋的库存关联
A. 不关联库存｜保持饮食、营养和进度按3个计算
B. 稍后处理｜保留待补充
也可以直接说明实际情况，不必选择以上选项。
```

若重校验后存在另一个真实且足量候选，可在安全出口前增加：

```text
A. 关联另一可用批次1个｜重新校验后扣减1个
```

并依次重排字母。没有真实候选时不得伪造此项。示例日期、数量和食品只用于黄金文本，不是默认值。

若成功纠错回执展示目标进度，必须只使用同次最终事务结果中的 `daily_progress`，并完整遵循展示契约的固定六项、进度块最后、无后置建议等规则；不得额外查询、复用旧快照或用两次报告相减。本节只冻结纠错专属标题、库存结果和快捷文案，不重复定义日期或进度格式。

## 7. 命令状态、事务与幂等

- `preview/committed/ignored/failed` 是命令结果；`active/corrected/voided` 是记录生命周期，绝不混用。`ignored` 仅用于计划、假设、明确否定、发生前取消或明确非本人事实，并且不产生业务写入；对已经 committed 的事实说“暂不处理/先别扣/不关联”必须是 committed 的 IssueResolutionEvent，分别进入 `deferred` 或 `dismissed`，不得返回 `ignored`。
- 多候选目标、冲突组合或待确认 blocking Issue 返回 preview/待选择且无业务效果；核心事实已足够的原饮食仍可已经 committed。
- 任何声明 committed 的 Issue resolution/Correction 必须连同其真实 effects、skipped effects、Issue、营养、幂等结果和最终 daily_progress 一次持久化。
- 存储前置失败或审计事务本身失败返回 failed，Issue/业务效果保持原状且不得声称已追加 `failed_storage` 事件；附加库存效果不安全但审计事务可用时不是存储 failed，而是 committed 核心事实/Correction + skipped effect + Issue，或纯副作用解决的已持久化 `rejected_effect`。
- 同一幂等键在并发和响应丢失后返回同一 CommitResult、同一事件引用和同一最终进度快照，绝不重演副作用。
- 两条相似但幂等键不同的独立输入只能创建/提示 `possible_duplicate`，不得自动合并、覆盖或删除；用户确认是另一次时正常提交新事件。
- JSONL/SQLite 具体事务和投影由后续 storage mapping 冻结；本契约只冻结必须达到的原子可见结果。

## 8. mixed 信封

- mixed 只是输入信封，不是单个领域业务事件。
- 先按叙述顺序拆为 meal/water/purchase/correction/ignore/query 等事件，再逐项执行。
- 每项具有独立幂等键或由信封键稳定派生的子键；重试 mixed 信封不得重演已提交项。
- 前项 committed 后，后项可以读取前项新状态；后项解析/持久化失败不回滚前项。
- 前一 purchase 失败时，后一已发生且可识别的 meal 仍按事实优先独立处理；只把无法完成的库存关联/扣减降级为 Issue，不能连带丢失饮食事实。
- 总 CommitResult 按原顺序列出每项 `preview/committed/ignored/failed` 和关联问题；不得用一个总 committed 隐藏部分失败。

## 9. 验收与证据

实施者必须提交：

1. `shared/contracts/issue-correction-contract.md`；
2. `docs/work-items/SH-CONTRACT-004-report.md`；
3. 32/32 需求追踪、状态/转换、代码枚举、字段、快捷末行、冲突组合、陈旧重校验、补扣不足黄金文本、单项/整条/跨日纠错、幂等、混合顺序和安全线检查；
4. 修改前后正式业务数据扫描，`.jsonl`、`.sqlite`、`.sqlite3`、`.db` 新增/修改/删除必须为 0。

契约中每个需求 ID 必须各且仅一次出现在规范性追踪表，并映射到有实际语义的章节；不得只贴 ID 而缺少 MUST/MUST NOT 规则。独立复核必须保留首轮发现和修复历史。

## 10. 明确禁止的旧行为

- 数量模糊、库存多候选/不足或营养未知导致已发生饮食事实 preview/failed。
- Issue 解决、Correction 或 void 静默覆盖/物理删除原记录。
- 纠错上调库存不足时产生负库存、回滚饮食纠正或谎称已补扣。
- 删除一项误冲销整餐；void 返还从未实际扣过的库存。
- 多候选纠错目标静默猜测或向用户暴露内部 ID。
- 旧 prompt/option、陈旧 issue_version 或 target_version 直接执行。
- 同幂等键重演扣减、返还、营养、Issue、模板学习或进度增量。
- mixed 后项失败回滚前项，或用总成功隐藏部分失败。
- 快捷选项没有安全出口、把按钮当唯一输入，或遗漏固定自由文本末行。
- 用 0、空字符串、默认一份或二进制浮点近似代替 unknown/规范十进制。
