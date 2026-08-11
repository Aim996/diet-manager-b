---
contract_id: ISSUE-CORRECTION-CONTRACT-v2
upstream_contract: diet-manager/contract-v2
upstream_sha256: 632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E
receipt_date_contract: diet-manager/receipt-date-contract-v2
receipt_date_sha256: F33E34D6B9EA9B1212208D75C5025FA86BB07923248E3B4929A1EF0BB7A375DD
status_source: 总功能开发计划0.3.md
product_write_route: B
---

# ISSUE-CORRECTION-CONTRACT-v2：问题、快捷解决与追加纠错契约

## 1. 身份、范围与机器协议

本契约冻结饮食管家的 Issue、快捷解决、追加纠错、补偿、跨日最终结果和 mixed 顺序语义。它是 `diet-manager/contract-v2` 与 `diet-manager/receipt-date-contract-v2` 的伴随契约，不创建第二套事务或显示权威。

产品写入只有 B 路线。Skill、OpenClaw、MCP 和未来智能体只负责输入输出适配，不得自行判断事务结果、重新计算营养/库存/进度，或制造成功回执。

<!-- BEGIN ISSUE-CORRECTION-V2-MACHINE -->
```json
{
  "contract_id": "diet-manager/issue-correction-contract-v2",
  "contract_version": 2,
  "upstream_contract": "diet-manager/contract-v2",
  "receipt_date_contract": "diet-manager/receipt-date-contract-v2",
  "product_write_route": "B",
  "adapter_surface": "thin",
  "issue": {
    "statuses": [
      "open",
      "awaiting_user",
      "resolved",
      "dismissed"
    ],
    "types": [
      "blocking_fact",
      "non_blocking_business",
      "non_blocking_technical",
      "optional"
    ],
    "priorities": [
      "critical",
      "high",
      "normal",
      "low"
    ],
    "codes": [
      "reference_ambiguous",
      "consumption_state_ambiguous",
      "negation_scope_conflict",
      "food_identity_unrecognized",
      "quantity_missing",
      "quantity_estimated",
      "quantity_vague_unresolved",
      "composition_unknown",
      "nutrition_missing",
      "nutrition_estimated",
      "missing_package_content",
      "inventory_no_match",
      "inventory_multiple_candidates",
      "inventory_insufficient",
      "inventory_unit_unconvertible",
      "inventory_batch_uncertain",
      "occurred_time_defaulted",
      "meal_slot_inferred",
      "storage_location_uncertain",
      "shelf_life_unknown",
      "possible_duplicate",
      "effect_processing_failed",
      "progress_projection_pending"
    ],
    "required_fields": [
      "issue_id",
      "issue_code",
      "issue_type",
      "priority",
      "entity_type",
      "entity_id",
      "field_path",
      "detected_at",
      "source_message_id",
      "source_text",
      "known_facts",
      "missing_or_conflicting_facts",
      "impact",
      "candidate_values",
      "candidate_actions",
      "status",
      "revision",
      "last_presented_at",
      "resolved_at",
      "resolution_source",
      "resolution_reason",
      "resolution_event_id"
    ],
    "resolution_reasons": [
      "user_supplied",
      "user_confirmed",
      "reliable_evidence_resolved",
      "kept_estimate",
      "deferred_by_user",
      "dismissed_by_user",
      "event_superseded",
      "effect_retry_succeeded"
    ],
    "resolution_sources": [
      "user",
      "reliable_context",
      "system_retry",
      "event_lifecycle"
    ],
    "presentation_mode": "consolidated_after_fact_commit",
    "defer_transition": "awaiting_user_to_open",
    "queryable_unresolved": true,
    "coverage_impact_preserved": true
  },
  "resolution": {
    "application_outcomes": [
      "applied",
      "no_change",
      "rejected"
    ],
    "rejection_reasons": [
      "stale_revision",
      "expired_prompt",
      "conflicting_selection",
      "prompt_target_revision_stale",
      "business_validation_failed"
    ],
    "persist_technical_failure_outcome": false
  },
  "quick_prompt": {
    "required_fields": [
      "prompt_id",
      "issue_id",
      "option_ids",
      "generated_from_revision",
      "generated_at",
      "expires_at"
    ],
    "min_options": 2,
    "max_options": 4,
    "natural_language_equivalent": "same_business_operation",
    "stale_choice_application_outcome": "rejected",
    "stale_choice_rejection_reason": "expired_prompt",
    "conflicting_choice_application_outcome": "rejected",
    "conflicting_choice_rejection_reason": "conflicting_selection",
    "safe_exit_required": true,
    "free_text_line": "也可以直接说明实际情况，不必选择以上选项。"
  },
  "correction": {
    "operations": [
      "change_amount",
      "change_unit",
      "change_time",
      "change_meal_slot",
      "change_item_name",
      "change_food_type",
      "change_components",
      "add_item",
      "remove_item",
      "change_inventory_link",
      "change_nutrition_source",
      "void_event",
      "restore_event"
    ],
    "required_fields": [
      "correction_id",
      "target_event_id",
      "base_revision",
      "request_id",
      "source_text",
      "operation",
      "before_snapshot",
      "change_set",
      "after_snapshot",
      "nutrition_delta",
      "inventory_effects",
      "affected_dates",
      "created_at",
      "timezone"
    ],
    "append_only": true,
    "overwrite_original_event": false,
    "physical_delete_original_event": false,
    "ambiguous_target": "needs_clarification_zero_writes",
    "stale_base_revision": "rejected_stale_revision_zero_effects",
    "no_change": "no_change_no_new_version",
    "concurrent_conflict": "needs_clarification_current_view_zero_effects"
  },
  "transaction": {
    "stages": [
      "FactCommit",
      "EffectBundle",
      "EnvelopeFinalize"
    ],
    "envelope_states": [
      "received",
      "fact_committed",
      "effects_pending",
      "terminal",
      "failed_fact"
    ],
    "outbox_states": [
      "pending",
      "processing",
      "succeeded",
      "retryable_failed",
      "permanent_business_skip"
    ],
    "fact_commit_failure_business_writes": 0,
    "fact_commit_technical_log": "allowed_separate_redacted_only",
    "effect_bundle_failure": "keep_fact_retry_effect",
    "finalizer_failure": "keep_effects_pending_no_success_receipt",
    "correction_fact_commit": "CorrectionEvent_idempotency_child_key_effect_outbox",
    "correction_effect_bundle": "nutrition_inventory_issue_projection_contribution",
    "correction_envelope_finalize": "daily_progress_receipt_terminal_result"
  },
  "inventory_insufficient": {
    "command_status": "committed_with_issues",
    "corrected_fact_committed": true,
    "nutrition_recalculated": true,
    "preserve_prior_real_deduction": true,
    "unsafe_delta": "skipped_insufficient",
    "issue_code": "inventory_insufficient",
    "negative_inventory": false,
    "receipt_authority": "successful_EnvelopeFinalize_only"
  },
  "cross_day": {
    "canonical_collection": "daily_progress_by_date",
    "multiple_dates_single_alias": false,
    "authority": "EnvelopeFinalize"
  },
  "bulk_correction": {
    "product_version": "PRODUCT-0.2",
    "preview_required": true,
    "preview_fields": [
      "date_scope",
      "match_count",
      "current_effective_content",
      "planned_corrections_or_voids",
      "inventory_compensation",
      "affected_dates"
    ],
    "confirmation_fields": [
      "preview_revision",
      "target_revisions"
    ],
    "preview_business_writes": 0,
    "per_target_append_only": true,
    "cancel_or_stale_business_writes": 0,
    "finalizer": "single_EnvelopeFinalize"
  },
  "mixed": {
    "ordered": true,
    "per_event_idempotent": true,
    "command_statuses": [
      "committed",
      "committed_with_issues",
      "needs_clarification",
      "ignored",
      "failed"
    ],
    "later_failure_rolls_back_earlier": false
  },
  "trace_ids": [
    "REQ-ISSUE-001",
    "REQ-ISSUE-002",
    "REQ-QUICK-001",
    "REQ-CORR-001",
    "REQ-CORR-002",
    "REQ-CORR-003"
  ],
  "legacy_rule_guards": {
    "issue_offered_status": false,
    "issue_deferred_status": false,
    "issue_invalidated_status": false,
    "issue_kind_axis": false,
    "twelve_correction_operations": false,
    "change_item_type_operation": false,
    "overwrite_original_event": false,
    "physical_delete_original_event": false,
    "single_big_transaction": false,
    "rollback_fact_on_effect_failure": false,
    "persisted_failed_resolution": false,
    "mixed_legacy_statuses": false
  }
}
```
<!-- END ISSUE-CORRECTION-V2-MACHINE -->

机器块是后续模型、映射和测试的固定输入。正文解释行为和失败边界，但不得新增与机器块冲突的状态、操作或写入路线。

## 2. Issue 模型和四状态

<!-- ISSUE-FOUR-STATUS -->

Issue 状态只有 `open`、`awaiting_user`、`resolved`、`dismissed`：

- `open`：问题存在，但当前不要求用户立即选择；
- `awaiting_user`：已生成与当前 revision 绑定的提示，等待用户补充或选择；
- `resolved`：问题通过用户、可靠上下文、系统重试或事件生命周期得到解决；
- `dismissed`：用户明确选择不处理，且该选择本身已完成持久化。

`open -> awaiting_user | resolved | dismissed`；`awaiting_user -> open | resolved | dismissed`。终态不得原地重开；同类问题再次出现时必须创建新 Issue 并引用新事实。用户选择“稍后处理”使用 `resolution_reason=deferred_by_user`，Issue 回到或保持 `open`，并通过 `last_presented_at` 控制再次呈现，不创造第五种状态。

Issue 类型只有 `blocking_fact`、`non_blocking_business`、`non_blocking_technical`、`optional`。只有无法安全形成核心事实的歧义才可使用 `blocking_fact`。数量估计、营养缺失、库存匹配或效果处理失败不得回滚已经可安全提交的饮食事实。

23 个稳定代码按机器块顺序分为：核心事实歧义 4 项、数量/组成/营养 7 项、库存 5 项、时间与餐次 2 项、存放与保质 2 项、重复 1 项、效果/进度技术降级 2 项。代码只描述问题，不代替命令状态或存储错误。品牌、变体、备注、存放确认等可选资料使用同一 Issue 模型和 `optional` 类型，但不临场创造机器块之外的持久代码。

每个 Issue 使用机器块冻结的 22 个字段。`known_facts` 与 `missing_or_conflicting_facts` 必须保留发现时证据；`candidate_values`、`candidate_actions` 只能来自可靠数据或安全选项；内部 ID 不得展示给用户。

一次输入产生多个非阻塞问题时，必须先提交能确定的事实，再集中展示重点问题，不得把记录流程变成连续问卷。用户延期后本轮不重复追问；未解决 Issue 必须可按日期和记录查询，并继续影响数据覆盖说明，不能被当成已完整。

`open` 或 `awaiting_user` 时，除延期后的 `resolution_reason=deferred_by_user` 外，关闭字段必须为空；`resolved` 或 `dismissed` 必须具备时间、来源和匹配原因。被纠正或 void 的目标以 `resolved + event_superseded` 终结，不创造 invalidated 状态。

## 3. Resolution 与快捷解决

<!-- RESOLUTION-OUTCOME-TRIAD -->

一次解决申请的业务应用结果只有：

- `applied`：申请改变了 Issue 或关联业务事实；
- `no_change`：申请合法但当前权威状态已经相同；
- `rejected`：申请因固定业务前置条件被拒绝，且没有业务效果。

`applied` 必须带匹配的 `resolution_reason` 且 `rejection_reason=null`；`no_change` 的两个原因字段都为空；`rejected` 必须带机器块中的一个 `rejection_reason` 且 `resolution_reason=null`。`prompt_target_revision_stale` 只表示提示绑定的 revision 失效、目标事件仍有效；目标事件已被纠正或 void 时使用 `resolved + event_superseded`。权威审计存储不可用、事务回滚或提交未知时，命令返回 `failed`；不得伪造已持久化的 Resolution 或把技术失败写成 application outcome。

快捷提示绑定 `prompt_id`、`issue_id`、`option_ids`、`generated_from_revision`、`generated_at`、`expires_at`。有可靠选项时只提供 2–4 个安全选项，同时接受能唯一映射到同一业务操作的自然语言。每组必须包含“保持原样”“稍后处理”或“不关联”等至少一个安全出口；安全出口不得被默认选中。

<!-- QUICK-STALE-REJECT -->

执行前必须重新校验 Issue、目标事实、revision、有效期和组合兼容性。过期提示返回 `application_outcome=rejected`、`rejection_reason=expired_prompt`；冲突组合返回 `application_outcome=rejected`、`rejection_reason=conflicting_selection`。两者均不得部分执行或复用旧快照。

每组快捷选项的最后一行必须原样为：

```text
也可以直接说明实际情况，不必选择以上选项。
```

该行之后不得追加同组选项说明。

## 4. 追加纠错与事实优先

纠错只追加 `CorrectionEvent`，不得覆盖或物理删除原事件、旧纠错、营养快照、库存效果或证据。机器块冻结 13 种操作；`change_food_type` 取代旧命名，`restore_event` 用新事件恢复被 void 的事实，不能删除或改写 void 历史。

每个 CorrectionEvent 使用机器块冻结的 14 个字段。`base_revision` 在 FactCommit 内校验；`before_snapshot`、`change_set`、`after_snapshot` 共同证明变化；`affected_dates` 使用用户时区。相同 `request_id` 重试必须读取原结果，不得重复补偿。

纠错目标按当前活动记录、最近成功提交、日期/餐次/食品/数量组合和当前有效视图中的唯一候选依次定位。多个候选时返回 `needs_clarification` 并零写入，展示可读内容而非内部 ID。陈旧 `base_revision` 零业务效果；并发冲突展示当前有效内容重新确认；结果已经相同时返回 `no_change` 且不创建无意义版本。

<!-- CORRECTION-FACT-FIRST -->

纠错遵循 `FactCommit -> EffectBundle -> EnvelopeFinalize`：FactCommit 只原子提交 CorrectionEvent、幂等子键和待处理效果 outbox；EffectBundle 原子处理营养重算、真实库存补偿、Issue 和本子操作的投影贡献；EnvelopeFinalize 冻结跨日进度、mixed 结果、回执和终态幂等结果。后两层技术失败不得回滚已经提交的 CorrectionEvent，也不得把旧营养、库存或进度冒充为已同步完成。

`remove_item` 只使目标项目在新版本中失效，并只返还该项目真实扣过的库存。`void_event` 使整条根事实的当前有效视图失效，并只返还真实扣过的效果。`restore_event` 追加新版本并基于恢复时的当前库存重新计算效果，不复活旧扣减。

## 5. 库存不足纠错与补偿真相

<!-- CORRECTION-INVENTORY-INSUFFICIENT -->

用户把已记录数量从 2 个改为 3 个，而新增 1 个库存不足时：

1. FactCommit 提交纠正后的事实、幂等子键和待处理效果 outbox；
2. EffectBundle 按纠正后的事实提交新的营养快照；
3. 原先真实扣过的 2 个保持不变；
4. 新增 1 个效果保存为 `skipped_insufficient`，不得产生负库存或伪造扣减；
5. 创建 `issue_code=inventory_insufficient` 的 Issue，记录所需差量与实际应用差量；
6. 命令状态为 `committed_with_issues`；
7. 只有 EffectBundle 已稳定完成或形成永久业务跳过，且 EnvelopeFinalize 成功后，才可生成正常成功回执。

固定黄金语义为：饮食已按 3 个更正，营养和进度按 3 个计算，库存明确说明“原已扣 2 个；新增 1 个未扣”。系统不得为了库存一致而回滚用户已确认的饮食事实，也不得把未发生的库存效果写成成功。

## 6. 跨日最终结果

<!-- CROSS-DAY-FINALIZED -->

`change_time` 跨用户时区自然日时，必须在 EnvelopeFinalize 中产生两个受影响日期的最终 `daily_progress_by_date[]`。两个或更多日期时不得同时返回单日 `daily_progress` 别名。单日别名规则完全由 receipt/date v2 契约控制。

进度只能来自本次权威最终结果。Skill、OpenClaw、MCP 和其他适配器不得读取旧快照后自行相减、补算或拼接进度。

<!-- BULK-CORRECTION-PREVIEW -->

PRODUCT-0.2 的某日全部记录、跨餐/跨日批量纠错或撤销，必须先生成零业务写入的服务端预览。预览至少列出日期范围、匹配数量、当前有效内容、预计追加的纠错/撤销、库存补偿和受影响日期。确认必须携带 `preview_revision` 和每个 `target_revision`；执行时逐目标追加事件和真实差量补偿，并由同一个 EnvelopeFinalize 冻结全部受影响日期的最终结果。

用户取消、范围变化、任一目标 revision 变化或确认过期时必须零业务写入并重新预览。技术失败遵守同一分层协议，不得物理删除、半报成功或把未确认预览当成提交。

## 7. 分层事务、outbox 与写入失败

<!-- OUTBOX-LAYERED -->

三层协议及故障语义如下：

| 层 | 成功后状态 | 技术失败 |
| --- | --- | --- |
| `FactCommit` | `fact_committed` | 回滚本次全部饮食业务写入，信封为 `failed_fact` |
| `EffectBundle` | 效果完成或稳定跳过 | 保留事实，信封为 `effects_pending`，只重试未完成效果 |
| `EnvelopeFinalize` | `terminal` | 保留事实与效果，维持 `effects_pending`，不得生成正常成功回执 |

<!-- FACT-COMMIT-FAILURE-ZERO-BUSINESS -->

FactCommit 写入失败可以生成一条独立、脱敏的技术日志，用于排查错误；但饮食记录、库存变化、营养快照、Issue、业务 outbox、daily progress、成功回执和终态幂等结果都必须是零条。技术日志不属于饮食数据，不得包含食品、数量、正文、用户自由文本或其他可还原业务内容。

outbox 状态只有 `pending`、`processing`、`succeeded`、`retryable_failed`、`permanent_business_skip`。重试只处理未完成层；同一幂等身份不得重演已完成事实或效果。永久业务跳过必须保留原因和 Issue，不是假成功效果。

## 8. Mixed 顺序与逐事件结果

<!-- MIXED-ORDERED -->

mixed 只是输入信封。系统必须按用户叙述顺序拆分事件，并为每项使用独立或稳定派生的幂等键。后项可以读取前项已提交状态；后项失败不得回滚前项已经提交的事实。

结果按原顺序列出每项 `committed`、`committed_with_issues`、`needs_clarification`、`ignored` 或 `failed`。不得用一个合成总成功隐藏部分失败，也不得把等待澄清伪装成已提交。

## 9. 被取代的 v1 语义

以下只作为迁移审计，不是规范许可：六状态 Issue、`issue_kind` 轴、十二种纠错操作、`change_item_type`、覆盖/物理删除原事件、单一大事务、效果失败回滚事实、把技术失败持久化为 Resolution，以及 mixed 的旧四状态。实现和测试不得把它们当作默认、兼容兜底或第二套路由。

旧 v1 文档和证据只证明历史工作，不能关闭当前 v2 任务。

## 10. Current 6-ID task trace table

| Requirement ID | Normative sections |
| --- | --- |
| REQ-ISSUE-001 | §2 |
| REQ-ISSUE-002 | §2–§3 |
| REQ-QUICK-001 | §3 |
| REQ-CORR-001 | §4 |
| REQ-CORR-002 | §4–§6 |
| REQ-CORR-003 | §6 |
