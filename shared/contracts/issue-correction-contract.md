---
contract_id: ISSUE-CORRECTION-CONTRACT-v1
upstream_contract: CONTRACT-v1
upstream_sha256: CFECD8F825DB07E9283723D79A17C43CD41EEF42F01FB7083C22A14E5B7BC60D
display_contract: RECEIPT-DATE-CONTRACT-v1
display_contract_sha256: D0A83553653A528785BEF4CCF7E7B5DE53E167881E61287B54580987D4787968
status_source: 总功能开发计划0.2.md §22 唯一任务台账
---

# ISSUE-CORRECTION-CONTRACT-v1：问题、快捷解决与追加纠错共同契约

## 1. 身份、范围与规范词

本契约是饮食管家 A/B/C 三条路线共同遵守的 Issue、IssueResolution、Correction 与 void 行为协议。它细化问题分类、解决载体、纠错载体、有效视图、事务结果和用户可见的纠错专属文字；它不定义物理 Schema、JSONL/SQLite 映射、来源客户端或路线内部实现。

- **MUST（必须）**、**MUST NOT（不得）**、**SHOULD（应）**和 **MAY（可以）**沿用 CONTRACT-v1 的规范含义。
- 本契约 MUST 保留 CONTRACT-v1 已冻结的 fact-first、append-only、单一可靠事务、库存真实效果、营养不可变快照、受影响日期进度更新和历史审计语义，MUST NOT 以 Issue 或纠错流程缩窄这些语义。
- 本文所列食品、日期、数量和候选均为黄金文本测试值，MUST NOT 成为默认事实、默认数量、默认库存或默认目标。
- 本契约的动态任务状态只以总计划 §22 为准；文件本身 MUST NOT 冒充任务状态台账。

## 2. 命令结果、记录生命周期与事实优先

### 2.1 两组状态绝不混用

命令结果只允许 `preview`、`committed`、`ignored`、`failed`，分别表达一次命令等待确认、已完整持久化、根事实不具备正式入账资格或持久化失败。记录生命周期只允许 `active`、`corrected`、`voided`，表达已持久化根事件在最新有效视图中的状态。实现 MUST 分字段表达两组状态，MUST NOT 用 `committed` 代替 `active`，也 MUST NOT 用 `failed`、`preview` 描述已持久化记录的生命周期。

`ignored` MUST 仅用于计划、假设、明确否定、发生前取消或明确非本人事实，且 MUST 不产生业务写入。它 MUST NOT 用于已经 `committed` 的事实或其 Issue：用户对已提交事实回复“暂不处理”“先别扣”“以后再说”时，系统 MUST 追加 `IssueResolutionEvent(outcome=deferred)`、将 Issue 转为 `deferred`，并在完整持久化后返回命令 `committed`；用户明确选择“永不关联”“不关联库存”时，系统 MUST 追加 `IssueResolutionEvent(outcome=dismissed)`、将 Issue 转为 `dismissed`，并在完整持久化后返回命令 `committed`。这些安全出口都 MUST NOT 返回 `ignored`。

只有事务要求的事件、实际效果、跳过效果、Issue、幂等结果和最终快照全部持久化后，命令才 MUST 返回 `committed`。存储前置失败、事务回滚或无法证明写入完成时 MUST 返回 `failed`，MUST NOT 声称成功。多候选纠错目标、冲突快捷组合或核心事实本身不能安全确定时 MUST 返回 `preview` 或待选择结果，且该待定操作 MUST NOT 产生业务效果。

### 2.2 Issue 不等于命令失败

已经发生且核心事实足够的饮食 MUST 先原子提交。数量、单位、库存匹配、库存不足、营养或补充资料问题只 MUST 使对应附加效果进入稳定的跳过/未知状态并创建 Issue，MUST NOT 把已识别事实降为 `preview` 或 `failed`。只有核心事实本身不能安全形成，或相应事实未能持久化，才 MAY 阻止该事实提交。

附加库存效果无法安全完成不是存储失败：实现 MUST 提交核心事实或纠错，并在同一事务保存 `skipped_effects` 与 Issue。Issue 是已提交事实旁的可处理缺口，不是命令状态。

## 3. Issue 模型、分类、代码与状态机

### 3.1 三种 `issue_kind`

`issue_kind` MUST 且只能取以下三值：

- `anomaly`：影响事实准确性、库存效果、营养或聚合可靠性的待处理问题；
- `enrichment`：不阻止事实提交、可以后续补齐的资料；
- `blocking`：核心事实不能安全形成，或待执行的解决/纠错目标不能安全确定。

实现 MUST NOT 用 `blocking` 阻止已经足够明确的饮食事实；若仅附加效果不安全，MUST 使用 `anomaly` 或 `enrichment` 并提交事实。

### 3.2 十七个稳定 `issue_code`

本版本支持且最低代码集恰为以下十七项：

1. `missing_quantity`
2. `vague_quantity`
3. `quantity_range`
4. `missing_unit`
5. `missing_package_content`
6. `conflicting_package_spec`
7. `unknown_product_type`
8. `unconvertible_unit`
9. `ambiguous_inventory_match`
10. `insufficient_inventory`
11. `missing_nutrition`
12. `partial_nutrition`
13. `missing_expiration`
14. `uncertain_event_time`
15. `possible_duplicate`
16. `stale_preview`
17. `correction_target_not_found`

代码含义 MUST 在历史中稳定。新增代码 MUST 随契约/规则版本显式扩展，MUST NOT 改写上述代码的既有含义。纠错补扣不足 MUST 使用 `insufficient_inventory`，并保存 `context=correction_increment`、所需新增差量与实际应用差量，MUST NOT 创造含义重复的代码。

### 3.3 Issue 必要语义

每个 Issue MUST 至少表达：

`issue_id`、`issue_version`、`issue_kind`、`issue_code`、`entity_type`、`entity_id`、`field_path`、`known_facts`、`missing_or_conflicting_facts`、`impact`、`allowed_resolutions[]`、`status`、`attention_policy`、`detected_at`、`last_offered_at`、`deferred_until_or_trigger`、`resolved_at`、`resolution_event_id`、`invalidated_by_event_id` 和 `rule_version`。

内部 ID 只用于持久化和关联，任何用户回执 MUST NOT 暴露 Issue、事件、记录、批次或数据库内部 ID。

### 3.4 六状态与允许转换

Issue `status` MUST 且只能取：`open`、`offered`、`deferred`、`resolved`、`dismissed`、`invalidated`。

允许的转换只有：

`open -> offered | deferred | resolved | dismissed | invalidated`  
`offered -> offered(new version) | deferred | resolved | dismissed | invalidated`  
`deferred -> offered | resolved | dismissed | invalidated`  
`resolved | dismissed | invalidated -> terminal`

实现 MUST 以追加状态事件或 `IssueResolutionEvent` 表达转换，MUST NOT 原地覆盖原 Issue。目标被 void、目标版本被替代或问题不再适用于最新有效记录时，所有非终态相关 Issue MUST 在同一事务转为 `invalidated`；终态 Issue MUST NOT 被重复终结或原地重开。后续新事实再次出现同类问题时 MUST 创建新 Issue 并引用旧 Issue。

用户选择稍后处理时 Issue MUST 转为 `deferred`。正常对话 MUST NOT 反复提示；只有用户主动查看异常、日回顾、操作相关商品/记录，或问题影响升级时才 MAY 再次提供，并更新提示版本。

同一消息或记录的多个问题 MUST 形成一个按影响排序的统一摘要，MUST NOT 为每个可选字段连续追问。一个提示 MAY 关联多个 Issue。

## 4. IssueResolutionEvent 与解决事务

### 4.1 必要语义和结果

`IssueResolutionEvent` MUST 至少表达：

`resolution_event_id`、`resolution_group_id`、`issue_id`、`expected_issue_version`、`prompt_id`、`selected_option_ids[]`、`supplied_facts`、`source_text`、`operation`、`revalidated_versions`、`outcome`、`applied_effects[]`、`skipped_effects[]`、`resulting_issue_status`、`idempotency_key` 和 `created_at`。

已经持久化的 `IssueResolutionEvent.outcome` MUST 至少区分 `applied`、`deferred`、`dismissed`、`rejected_expired`、`rejected_stale`、`rejected_conflict` 与 `rejected_effect`。只有前三种应用/延后/放弃结果 MAY 推动对应状态；拒绝结果 MUST NOT 伪装成业务效果成功。`failed_storage` 只能是未持久化的命令错误码/结果，MUST NOT 成为已经持久化的 `IssueResolutionEvent.outcome`，也 MUST NOT 伴随声称已生成的 `resolution_event_id`。

权威审计存储可用时，解决、放弃、延后、前置条件拒绝、业务副作用拒绝和失效 MUST 通过追加 `IssueResolutionEvent` 或状态事件表达，MUST NOT 静默覆盖 Issue 或业务事实。若补充事实改变已经提交的数量、单位、组件、时间、项目、库存关联或营养来源，事务 MUST 同时追加 `IssueResolutionEvent` 和对应 `CorrectionEvent`；二者用途不同，MUST NOT 互相代替。若权威审计/事务存储本身不可用、提交回滚或提交结果未知，命令 MUST 返回 `failed` 并失败关闭；Issue 和业务效果 MUST 保持原状，系统 MUST NOT 声称已追加 Resolution、Correction、状态事件、幂等成功结果或任何事件 ID。

### 4.2 重校验与纯副作用失败

任何延迟库存关联、扣减、返还或补偿在执行前 MUST 重新读取当前 Issue、目标有效记录、目标版本、商品、批次、库存版本和当前规则。陈旧、过期、目标不存在或版本变化时 MUST 追加相应拒绝结果，MUST NOT 按旧快照执行，并 MUST 保持 Issue 当前非终态或生成新提示/新版本。

只改变副作用的解决，例如把既有记录关联到另一库存批次，若扣减、返还或补偿不能安全完成，MUST NOT 将 Issue 标为 `resolved`，原有效库存效果 MUST 保持不变。权威审计存储可用时，系统 MUST 原子追加 `IssueResolutionEvent(outcome=rejected_effect)`，不应用业务效果，并保持 Issue 开放或重新提供；权威审计存储不可用或提交结果未知时，命令 MUST 返回 `failed`，且 MUST NOT 声称追加了拒绝事件。若解决同时改变用户事实，则按 §6.4 的事实优先规则提交纠错及安全可应用的效果。

## 5. 快捷提示、组合解析与固定末行

### 5.1 何时提供

快捷选项 MUST 只在关键不确定性，或多个真实类别/候选会实质影响位置、保质、营养、库存或纠错目标时提供；明确判断 MUST NOT 提供。每个问题 SHOULD 优先给 2–4 个最有价值选项；统一提示 MAY 覆盖多个 Issue，但 MUST NOT 枚举低价值笛卡尔组合。

每个选项 MUST 来自当前数据、可靠换算或明确估算，且 MUST 说明执行后真实会发生的效果、不会发生的效果和受影响 Issue。每组 MUST 包含“保持原样”“暂不处理”或“不关联”等安全出口；安全出口 MUST NOT 被默认选中，也 MUST NOT 暗中改写数据。对已提交事实，“暂不处理/以后再说”MUST 映射为已提交的 `deferred` Resolution；明确永久“不关联”MUST 映射为已提交的 `dismissed` Resolution；二者 MUST NOT 映射为 `ignored`。

### 5.2 提示持久化

快捷提示 MUST 持久化 `prompt_id`、`issue_ids[]`、每个 `option_id`、`effect_summary`、`non_effect_summary`、`affected_issue_ids[]`、`conflict_group`、生成时目标/Issue/商品/库存/preview 或记录版本、规则版本、`generated_at` 和 `expires_at`。

执行旧选项前 MUST 重校验目标、Issue、商品、库存、preview/记录版本及选项兼容性。过期或版本变化 MUST 追加拒绝/失效结果并重生选项，MUST NOT 直接执行旧效果。

### 5.3 输入等价、组合冲突与有序执行

系统 MUST 支持单字母、组合字母、顺序指代和自由自然语言；模板 MUST NOT 成为唯一输入格式。自然语言若唯一指向某个选项，MUST 产生与该选项相同的业务操作；无法唯一解析时 MUST 只澄清，不执行。

组合选择在任何效果前 MUST 判断兼容性。两个选项若改变同一事实或库存效果且无法证明兼容，整个冲突组合 MUST 以 `rejected_conflict` 拒绝并请求消歧，MUST NOT 部分执行；消歧后仍 MUST 重新校验。兼容组合 MUST 按用户回复顺序拆为有序 `resolution_group`，每个 `IssueResolutionEvent` 逐事件原子；较后独立项失败 MUST NOT 回滚较早已提交项，总回执 MUST 逐项报告。

每组快捷选项的最后一行 MUST 原样为：

```text
也可以直接说明实际情况，不必选择以上选项。
```

该行之后 MUST NOT 再追加同组说明、按钮限制或建议。

## 6. CorrectionEvent、有效视图与库存差量

### 6.1 追加模型与十二种操作

已提交记录只能追加 `CorrectionEvent` 或 `void_event`，MUST NOT 覆盖或物理删除根事件、旧纠错版本、旧营养快照、旧库存效果或旧依据。未提交 preview 的修改只 MUST 产生新 preview 版本，MUST NOT 伪造 `CorrectionEvent`。

`operation` MUST 且只能取本版本固定的十二种：

1. `change_amount`
2. `change_unit`
3. `change_time`
4. `change_meal_slot`
5. `change_item_name`
6. `change_item_type`
7. `change_components`
8. `add_item`
9. `remove_item`
10. `change_inventory_link`
11. `change_nutrition_source`
12. `void_event`

### 6.2 CorrectionEvent 必要语义

`CorrectionEvent` MUST 至少表达：

`correction_id`、`root_event_id`、`target_event_id`、`target_item_id`、`target_version`、`operation`、`before_snapshot`、`supplied_facts`、`source_text`、`inventory_compensation`、`nutrition_recalculation`、`affected_local_dates[]`、`resulting_version`、`idempotency_key` 和 `created_at`。

`target_version` 或等价 CAS MUST 在事务内校验。陈旧提交、纠错链循环、重复补偿、重复 void，以及对已经无效的项目再次移除 MUST 被拒绝且不得产生业务效果。

### 6.3 最新有效视图与可审计详情

默认查询、进度、Issue 关联和回顾 MUST 只读取 `committed` 的最新有效视图，排除 preview、failed、ignored、被后续纠错替代的版本和 voided 根事件。详情查询 MUST 能查看根事件、每个纠错版本、void、旧营养快照、每次真实库存效果和依据。

多候选纠错目标 MUST NOT 猜测。系统 MUST 按 RECEIPT-DATE-CONTRACT-v1 展示人类可读的日期/时间、餐次、食品和数量供选择，MUST NOT 暴露任何内部 ID。

### 6.4 实际库存效果差量

涉及数量、单位、组件、名称、类型、增项、库存关联或营养来源变化时，库存补偿 MUST 以“原有效版本真实已应用的库存效果 → 新有效版本可安全应用的目标效果”计算，MUST NOT 以记录数量或预期效果冒充已应用效果。

- 下调、移除或 void 时，MUST 只返还原来真实扣过的数量；原来跳过或未扣的数量 MUST NOT 被返还。
- 上调时，原来真实扣减 MUST 保留；系统 MUST 只对新增差量重新校验商品、批次、单位和足量后尝试扣减。
- 改库存关联时，MUST 计算原关联的真实返还及新关联可安全扣减，并与 Correction 在同一事务提交；任一不能安全形成时按该操作语义拒绝，或在改变用户事实的场景按事实优先提交安全子集与 Issue，MUST NOT 留下不可证明的半补偿。
- 营养 MUST 始终按纠正后的有效事实创建新的不可变 `NutritionSnapshot`，旧快照 MUST 保留。
- `daily_progress` MUST 从纠正后的有效视图重算，MUST NOT 由两个独立查询结果相减。

### 6.5 单项移除、整条 void 与跨日

`remove_item` MUST 只使目标项目在新版本中无效，返还该项目真实已扣库存，并从营养与进度有效视图移除该项目；其他项目及整餐 MUST 保持有效。

`void_event` MUST 使整条根事件生命周期成为 `voided`，返还全部且仅限真实已扣效果，使相关非终态 Issue 在同一事务 `invalidated`，并从当前聚合移除；历史 MUST 仍可查询。

`change_time` 若跨用户时区的自然日，MUST 在同一事务中重算旧日与新日的有效聚合/进度；若仍在同一自然日，只 MUST 更新该日一次。日期计算 MUST 使用用户时区。

### 6.6 纠错补扣正常与库存不足

正常补扣的固定简洁黄金文本为：

```text
已更正：9号早餐
鸡蛋｜2个 → 3个
库存：已补扣鸡蛋1个
```

用户明确把已记录数量上调而新增库存差量不足时，系统 MUST 在同一事务：

1. 追加已提交的 CorrectionEvent，使饮食最新有效视图、营养新快照和受影响日期进度按用户纠正后的事实更新；
2. 保留原来真实应用的库存扣减；
3. 不产生负库存，不伪造新增扣减；
4. 把新增差量保存为 `skipped_insufficient`，创建 `insufficient_inventory` Issue，保存 `context=correction_increment`、所需差量和已应用差量；
5. 在回执中明确区分“饮食已更正”和“新增库存尚未扣”，并在后续解决前重新校验。

库存不足无真实候选时的固定黄金文本为：

```text
已更正：9号晚餐
鸡蛋｜2个 → 3个
库存：原已扣2个；新增1个未扣（当前库存不足）
待补充：新增1个鸡蛋的库存关联
A. 不关联库存｜保持饮食、营养和进度按3个计算
B. 稍后处理｜保留待补充
也可以直接说明实际情况，不必选择以上选项。
```

只有重校验后确有另一个真实且足量候选时，系统才 MAY 在安全出口前增加并按顺序重排：

```text
A. 关联另一可用批次1个｜重新校验后扣减1个
```

没有真实候选时 MUST NOT 伪造该选项。库存不足纠错的命令结果仍 MUST 是 `committed`，而非 preview/failed，因为纠正后的饮食事实已提交；待补扣是可后续处理的独立 Issue。

在上述库存不足黄金选项中，选择 `A. 不关联库存` 或等价自由文本 MUST 原子提交 `IssueResolutionEvent(outcome=dismissed)`、将待补扣 Issue 转为 `dismissed`，保持饮食、营养和进度按 3 个计算，且 MUST NOT 补扣库存；选择 `B. 稍后处理` 或等价自由文本 MUST 原子提交 `IssueResolutionEvent(outcome=deferred)`、将 Issue 转为 `deferred` 并保留待补充。两种选择完整持久化后的命令结果都 MUST 是 `committed`，绝不能是 `ignored`。

成功纠错回执若展示目标进度，MUST 只引用同次最终事务结果中的 `daily_progress`，并完整遵守 RECEIPT-DATE-CONTRACT-v1 的固定六项、进度块最后、日期格式及无后置建议规则；本契约 MUST NOT 重定义、重算或额外查询其进度格式。

## 7. 幂等、原子边界、故障关闭与 mixed

### 7.1 幂等、响应丢失与疑似重复

meal/purchase 等根命令、Issue 解决和 Correction/void 都 MUST 具有各自的 `idempotency_key`。相同键的并发请求或重试 MUST 返回原 `CommitResult`、原事件引用与原最终进度快照引用，MUST NOT 重演事件、扣减、返还、Issue、营养、模板学习或累计。

响应丢失后，客户端 MUST 用相同幂等键重试并读取原结果。系统无法判定先前事务是否提交时 MUST 失败关闭，MUST NOT 猜测成功或换键重演。

语义相似但幂等键不同的两次输入 MUST NOT 自动合并、覆盖或删除；系统只能创建或提示 `possible_duplicate`。用户确认是另一次时 MUST 正常提交新事件。

### 7.2 单一事件原子可见

单一业务事件的领域事件、真实库存效果、营养快照、Issue/Resolution、幂等结果和最终 `daily_progress` MUST 位于一个可证明的原子边界；“跳过效果 + Issue”同样 MUST 是明确、原子、可重放的事务结果，MUST NOT 成为半事务。

纯副作用 Issue 解决若不能完成全部必要副作用，Issue MUST 不得 `resolved`：权威审计存储可用时 MUST 原子提交 `IssueResolutionEvent(outcome=rejected_effect)` 且不应用业务效果；权威审计存储不可用、事务回滚或提交结果未知时 MUST 返回命令 `failed`，Issue 与业务效果保持原状，并且 MUST NOT 声称存在 Resolution、Correction 或幂等成功结果。改变用户事实的纠错若附加库存新增效果不安全，则 MUST 原子提交“纠错事实 + 营养/进度 + 保留旧真实扣减 + 跳过新增效果 + Issue”。

JSONL 损坏尾部、SQLite 事务/迁移失败或其他权威审计存储错误 MUST 失败关闭。只有完整事务可证明持久化才可报告 `committed`；错路径、半写或只写回执 MUST NOT 报成功。审计存储失败时 `failed_storage` MAY 作为命令错误码返回，但 MUST NOT 被描述为已经追加的事件；存储恢复后只能以原幂等键查询或重试，只有确认原事务未提交且新事务可用时才 MAY 持久化新的尝试结果。

### 7.3 固定数据路径与测试隔离

普通自然语言、快捷选项、Issue 解决和 Correction 输入 MUST NOT 指定或改变数据路径。正式数据根 MUST 来自固定配置；测试根只能由测试适配器显式注入。验证、测试和构建 MUST 使用隔离的临时根，MUST NOT 读取、写入、迁移或清理正式业务数据。

### 7.4 mixed 顺序与逐事件结果

`mixed` 只是输入信封，MUST 先按用户叙述顺序拆成 meal、water、purchase、correction、ignore、query 等领域事件，再逐事件原子处理。每项 MUST 有独立幂等键，或由信封键稳定派生且可重放的子键。

前项 `committed` 后，后项 MAY 读取前项新状态；后项失败 MUST NOT 回滚前项独立成功项。前一 purchase 失败时，后一已经发生且可识别的 meal 仍 MUST 按事实优先独立提交；只有无法安全完成的库存关联/扣减 MUST 降级为跳过效果和 Issue，MUST NOT 丢失该 meal。

总 `CommitResult` MUST 按原顺序列出每项 `preview/committed/ignored/failed` 与关联问题，MUST NOT 用一个总 `committed` 隐藏部分失败。mixed 重试 MUST 读取每个已提交子键的原结果，MUST NOT 重演已完成副作用。

### 7.5 数值、单位与精度

所有业务数值与单位 MUST 成组校验。未知值 MUST 保持缺失或 `unknown`，MUST NOT 用 0、空字符串、默认一份或猜测单位代替。

业务关键数值 MUST 使用规范十进制字符串、整数最小单位或等价精确方案。JSONL 与 SQLite 投影 MUST 得到相同精确语义，MUST NOT 因二进制浮点产生累计、补偿、库存或营养漂移。

## 8. 被取代且禁止复活的旧语义

以下仅为非规范性审计，均已被取代，MUST NOT 作为默认、兜底或实现许可：

- 数量模糊、库存多候选/不足或营养未知令已发生且可识别的饮食返回 preview/failed；
- Issue 解决、Correction 或 void 静默覆盖/物理删除原记录；
- 纠错上调库存不足时产生负库存、回滚饮食纠正，或谎称新增库存已经补扣；
- 删除一项误冲销整餐，或 void 返还从未实际扣过的库存；
- 多候选纠错目标静默猜测或向用户暴露内部 ID；
- 旧 prompt/option、陈旧 `issue_version` 或 `target_version` 直接执行；
- 同一幂等键重演任一业务或学习副作用；
- mixed 后项失败回滚前项，或用总成功隐藏部分失败；
- 快捷选项缺少安全出口、把模板当唯一输入，或遗漏固定自由文本末行；
- 用 0、空字符串、默认一份或二进制浮点近似代替 unknown/规范十进制。

## 9. 32 条规范性需求追踪表

本表是 SH-CONTRACT-004 的唯一规范性需求 ID 列表。每个任务范围 ID 在本表恰出现一次；对应正文均含可测试的 MUST/MUST NOT 语义。

| 需求 ID | 规范性正文 |
| --- | --- |
| REQ-ISSUE-001 | §2.2 |
| REQ-ISSUE-002 | §3.4 |
| REQ-ISSUE-003 | §3.4 |
| REQ-ISSUE-004 | §3.4、§4.1 |
| REQ-ISSUE-005 | §4.2 |
| REQ-ISSUE-006 | §3.4、§6.5 |
| REQ-QUICK-001 | §5.1 |
| REQ-QUICK-002 | §5.1 |
| REQ-QUICK-003 | §5.1 |
| REQ-QUICK-004 | §5.1 |
| REQ-QUICK-005 | §5.3 |
| REQ-QUICK-006 | §5.2 |
| REQ-QUICK-007 | §5.2、§5.3 |
| REQ-QUICK-008 | §5.3 |
| REQ-CORR-001 | §6.1 |
| REQ-CORR-002 | §6.3 |
| REQ-CORR-003 | §6.4 |
| REQ-CORR-004 | §6.5 |
| REQ-CORR-005 | §6.5 |
| REQ-CORR-006 | §6.5 |
| REQ-CORR-007 | §6.3 |
| REQ-CORR-008 | §6.2 |
| REQ-SAFE-001 | §2.1、§7.2 |
| REQ-SAFE-002 | §7.1 |
| REQ-SAFE-003 | §6.6、§7.2 |
| REQ-SAFE-004 | §4.1、§7.2 |
| REQ-SAFE-005 | §7.3 |
| REQ-SAFE-006 | §7.1、§7.2 |
| REQ-SAFE-007 | §6.3 |
| REQ-SAFE-008 | §5.3、§7.4 |
| REQ-SAFE-009 | §7.5 |
| REQ-SAFE-010 | §7.5 |
