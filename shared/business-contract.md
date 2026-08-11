# CONTRACT-v2：饮食管家可移植 Skill 与 B 后端共同业务契约

## 1. 契约身份、适用范围与规范词

本文件是饮食管家可移植 Skill、唯一 B 写入后端及其薄适配器共同遵守的 **CONTRACT-v2**。它把已确认的业务语义固定为可实现、可验证的边界；它不是可安装产品的承诺，也不替代后端实现、Schema、案例 Oracle、来源注册表或回执文案。A 只保留受控只读/无插件降级边界，C 不再形成独立产品，其服务端安全控制并入 B。

- **MUST（必须）**表示 Skill、B 后端和所有适配器都必须实现或保留的可观察语义；**MUST NOT（不得）**表示禁止行为；**SHOULD（应）**只有存在已登记且生效的例外决定时才可偏离；**MAY（可以）**表示许可而非义务。
- 实现 MUST NOT 以存储技术、智能体、UI、模型能力或便利性改变本契约的事实、审计、幂等、隐私或降级语义。OpenClaw、未来 MCP 和其他智能体集成只能是同一 B 后端的薄适配器，不能复制或重释业务提交逻辑。〔REQ-EVENT-004, REQ-EVENT-005, REQ-EVENT-007〕
- 本契约与需求计划冲突时，以计划的已确认业务正文为准；变更 MUST 先更新共同契约、追踪和对应 companion contract，再由 B 后端和适配器实现。契约版本变更 MUST 记录兼容性与迁移影响，且 MUST NOT 静默重释既有事实。〔REQ-EVENT-005, REQ-TIME-007〕

### 1.1 机器可读协议摘要

下面的 JSON 是 CONTRACT-v2 的机器可读协议摘要，供后续 Schema、SQLite mapping、共同 harness 和适配器校验使用。它冻结阶段、状态和失败边界，不冻结数据库表名或物理索引。

<!-- BEGIN CONTRACT-V2-MACHINE -->
```json
{
  "contract_id": "diet-manager/contract-v2",
  "contract_version": 2,
  "product_write_route": "B",
  "skill_surface": "portable",
  "command_statuses": [
    "committed",
    "committed_with_issues",
    "needs_clarification",
    "ignored",
    "failed"
  ],
  "record_lifecycle": [
    "active",
    "superseded",
    "voided"
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
  "protocol": [
    {
      "stage": "FactCommit",
      "technical_failure": "rollback_all_business_rows",
      "technical_log": "allowed_separate_only"
    },
    {
      "stage": "EffectBundle",
      "technical_failure": "keep_fact_and_retry_effect",
      "technical_log": "allowed_separate_only"
    },
    {
      "stage": "EnvelopeFinalize",
      "technical_failure": "rollback_finalizer_keep_effects_pending",
      "technical_log": "allowed_separate_only"
    }
  ],
  "technical_log": {
    "business_visible": false,
    "counts_as_record": false
  },
  "fact_commit_failure_forbids": [
    "meal_or_water_fact",
    "inventory_change",
    "nutrition_snapshot",
    "issue",
    "business_outbox",
    "daily_progress",
    "success_receipt",
    "terminal_idempotency_result"
  ],
  "idempotency": {
    "identity_fields": [
      "idempotency_key",
      "input_digest",
      "subject_scope",
      "command_type"
    ],
    "same_terminal": "return_frozen_terminal",
    "same_nonterminal": "resume_pending_effects_or_finalizer",
    "different_input_error": "idempotency_conflict",
    "different_input_write_effect": "zero_new_business_writes"
  },
  "finalizer_atomic_outputs": [
    "MixedCommitResult",
    "ReceiptData",
    "daily_progress_by_date",
    "daily_progress",
    "terminal_idempotency_result"
  ],
  "preview_binding": [
    "input_digest",
    "subject_scope",
    "command_type",
    "data_revision"
  ],
  "caller_state_trusted": false,
  "location_evidence_priority": [
    "user_explicit",
    "package_or_manufacturer_storage_condition",
    "confirmed_same_product_rule",
    "product_type_default_rule",
    "evidence_based_model_inference",
    "unknown"
  ],
  "expiration_anchor_priority": [
    "user_explicit_expiration",
    "label_expiration",
    "production_date_plus_shelf_life",
    "manufacturer_product_data",
    "confirmed_same_product_rule",
    "purchase_time_plus_reliable_rule",
    "stocked_time_plus_default_rule",
    "unknown"
  ],
  "nutrition_source_priority": [
    "current_exact_label",
    "current_package_or_barcode_data",
    "manufacturer_exact_product_data",
    "confirmed_same_product_history",
    "authoritative_public_food_database",
    "configured_trusted_internet_data",
    "active_personal_recipe_template",
    "generic_recipe_template",
    "bounded_reasonable_estimate",
    "unknown"
  ],
  "fact_commit_technical_log_requirement": "should_write_separate_redacted",
  "missing_time_default": "received_at_with_default_received_at",
  "public_database_explicit_amount_display": "reference_database_not_estimated",
  "shared_meal_unknown_personal_amount": "record_participation_keep_amount_unknown_or_ask",
  "partial_deduction": {
    "status": "partially_deducted",
    "enabled_from": "PRODUCT-0.2",
    "authorization": "per_event_explicit_user",
    "enabled_in_product_0_1": false
  },
  "single_day_progress_alias": {
    "required_for_one_date": true,
    "equality": "field_equal_to_only_array_item",
    "present_for_multiple_dates": false
  },
  "legacy_rule_guards": {
    "inventory_requires_explicit_home": false,
    "water_in_scope": true,
    "correction_supported": true,
    "vague_quantity_forces_preview": false,
    "inventory_problem_blocks_fact": false,
    "trusted_external_nutrition_allowed": true,
    "bounded_estimate_allowed": true,
    "nutrition_source_model": "ordered_registry",
    "same_product_multi_batch_is_ambiguity": false,
    "nutrition_amount_drives_inventory": false
  }
}
```
<!-- END CONTRACT-V2-MACHINE -->

## 2. 产品边界与非目标

- 系统 MUST 只记录当前用户本人的饮食、白水和购买事实；MUST NOT 建立家庭成员、主体切换、多人账户或他人档案。用户明确说明为他人食用时，该事实 MUST NOT 写入本人账本。多人共同进食但本人份量不明时，只保存本人确实参与的事实，个人数量保持 `unknown` 或询问最少必要信息。家庭库存只是本人记录的默认库存来源，不构成多人能力。〔REQ-SCOPE-001, REQ-SCOPE-002, REQ-SCOPE-003〕
- 产品是可靠的日常饮食账本与记录/回顾助手。它 MUST NOT 提供饮食评分、自动改善或减重方案，也 MUST NOT 提供诊断、治疗、用药建议或替代专业医疗意见；“0.3 非医疗健康管理助手”不在范围内。〔REQ-SCOPE-004, REQ-SCOPE-005, REQ-SCOPE-008〕
- 用户目标仅用于已配置目标的进度记录；系统 MUST NOT 自行生成目标、百分比或据此评价用户。白水、追加式纠正及有目标时的进度属于产品能力，其细节由 companion contracts 冻结。〔REQ-SCOPE-006〕
- 云同步、多人、可穿戴/健康平台和图像、条码、发票识别不进入 0.1。未经授权的分享或上传 MUST NOT 发生；联网资料 MUST 有可信、可追溯且可版本化的来源；MUST NOT 无依据拆解内容不明的套餐、拼盘或自定义复合食品；MUST NOT 物理覆盖、静默删除或批量重写历史。〔REQ-SCOPE-007, REQ-SCOPE-009, REQ-SCOPE-010, REQ-SCOPE-011, REQ-SCOPE-012〕

## 3. 术语与领域边界

- **用户事实**是用户报告且可确认已经发生的饮食、白水或购买；它保留原话、原始名称和时间证据。**系统推导**包括规范化、时间解析、单位换算、餐次、模板、库存匹配及营养选择，MUST 保留采用值、来源与规则版本。〔REQ-EVENT-004, REQ-EVENT-005〕
- **附加副作用**是事实之外的库存读取/扣减、营养计算和进度更新。事实可提交而副作用降级；副作用失败 MUST NOT 反向否认已经发生且可识别的饮食。〔REQ-EVENT-003〕
- **命令结果**为 `committed`、`committed_with_issues`、`needs_clarification`、`ignored`、`failed`，说明本次命令的处理结果；**记录生命周期**为 `active`、`superseded`、`voided`，说明已持久化记录的有效状态。两组概念 MUST NOT 混用。`idempotency_conflict`是 `failed` 的稳定错误码，不是第六种成功状态；`foundation_not_implemented`只允许出现在尚未接入后端的开发期适配器，不属于业务提交终态。〔REQ-EVENT-006, REQ-MIXED-001, REQ-SAFE-003〕
- `unknown` 表示未知或资料不足，**unknown != 0**；`complete` 表示要求的核心营养字段均有可靠结果；`partial` 表示部分字段或项目未知；`estimated` 表示关键值来自有依据的估算；`unknown`（营养覆盖）表示没有可靠营养结果。缺失值、未知余量或未知营养 MUST NOT 被填为零。〔REQ-PANTRY-013, REQ-NUTR-005〕

## 4. 事件识别、事实优先、结果与生命周期

- 只有已经发生的 `meal`、`water`、`purchase` 事实可以进入正式账本；计划、假设、明确否定、发生前取消和明确非本人事实 MUST 返回 `ignored` 且 MUST NOT 写入。已写入记录的“取消/删除” MUST 追加 `void_event`，而非作为未发生事实忽略。〔REQ-EVENT-001, REQ-EVENT-002〕
- 每个正式事件 MUST 保存用户原话、消息来源、接收时间、提交时间、Schema 版本和稳定事件 ID；所有系统推导 MUST 有来源与规则版本。〔REQ-EVENT-004, REQ-EVENT-005〕
- 对“已发生且至少一个食物可识别”的饮食，系统 MUST fact-first：先持久化核心事实。数量不清、库存多候选/不足/不可换算、营养未知只可使相应副作用处于稳定 `skipped_*`、`partial` 或 `unknown` 状态并登记问题，MUST NOT 导致该饮食事实丢失。〔REQ-EVENT-003, REQ-MEAL-005, REQ-MEAL-006, REQ-MEAL-009〕
- 更正 MUST 以 `append-only correction/void` 中的 `correction` 追加，并保留原事实；冲销 MUST 以同一追加模型的 `void` 追加。任何改变有效摄入、数量、组成或库存效果的 correction/void，MUST 在单一可靠事务边界追加相应事件、执行适用的库存补偿和营养重算，并更新受影响日期的有效 `daily_progress`；原事件、旧营养快照及旧依据 MUST 保留可审计。〔REQ-SCOPE-012, REQ-EVENT-003, REQ-MEAL-018〕
- 存储不可用、事务回滚或提交结果未知且事实未明确持久化时 MUST 返回 `failed`、`committed=false`，MUST NOT 携带业务 `record_id` 或声称已记录。此失败 SHOULD 写入独立、脱敏且不进入业务查询的技术日志，但饮食/饮水事实、库存变化、营养快照、Issue、业务 outbox、日进度、成功回执和终态幂等结果必须全部为零。基础验证、构建和测试 MUST 使用明确的临时或隔离数据根，MUST NOT 接触正式数据路径。〔REQ-EVENT-011, REQ-EVENT-012, REQ-SAFE-002〕

## 5. 时间、餐次、上下文与数量

- 事件 MUST 同时保留原始时间文本、解析结果、接收时间、提交时间、用户时区、解析依据与规则版本。未给时间时 MUST 采用接收时间并标记 `default_received_at`；“中午”等不精确时间 MUST 保留范围或餐段，MUST NOT 伪造精确时刻。〔REQ-EVENT-004, REQ-TIME-001, REQ-TIME-002, REQ-TIME-003, REQ-TIME-007〕
- 相对时间 MUST 以可注入时钟、用户时区和解析锚点解析；查询日期 MUST 按用户时区的日开始至次日开始半开区间处理。测试 MUST 固定时钟、时区和 locale，并覆盖跨午夜、跨月。〔REQ-TIME-004, REQ-TIME-005, REQ-TIME-006〕
- 餐次 MUST 分别保存原文、规范值和来源；用户明确餐次优先，系统推断 MUST 标识 `system_inferred`。餐次与发生时间相互独立，MUST NOT 因凌晨时间伪称用户说过夜宵。一餐多项 MUST 共享一个 `meal_event_id` 并保持项目叙述顺序。〔REQ-MEAL-001, REQ-MEAL-002, REQ-MEAL-003, REQ-MEAL-004〕
- 用餐上下文可为 `home_default`、`external_explicit`、`delivery_explicit`、`skip_inventory_explicit` 或 `unknown`。无明确非家庭证据时 MUST 采用 `home_default`，并记录它是默认策略；只有明确外食/餐馆/食堂/朋友家/堂食/外卖，或明确“只记录/别扣库存”时，才 **explicit outside: skip inventory read/deduct**。〔REQ-PANTRY-001, REQ-PANTRY-002, REQ-PANTRY-003〕
- 数量 MUST 独立保留原文、`exact`/`approximate`/`range`/`vague`/`missing` 类型、数值或范围、单位和证据。用户摄入量、营养计算采用量、实际库存扣减量、包装/单件规格 MUST 分开；只有可靠换算才 MAY 产生克重或毫升。分数、小数、范围、近似和自然单位 MUST 可保留。〔REQ-MEAL-015, REQ-MEAL-013〕
- 数量模糊或缺失时 MUST 仍保存饮食事实并创建问题。营养存在可靠合理范围时 SHOULD 使用 `upper_plausible_bound`，该上界 MUST 是合理范围而非理论极端，并保留范围、来源及规则版本；没有可信范围时营养 MUST 保持 `unknown`。〔REQ-MEAL-010, REQ-MEAL-011, REQ-MEAL-012, REQ-MEAL-014〕

## 6. 饮食与组合菜语义

- 一个最低饮食事实 MUST 同时满足：已经发生、至少一个可识别食物/菜品、用户原话和原始名称、用户时间或带来源的默认时间。数量、餐次、库存与营养可各自不完整且有独立状态。〔REQ-MEAL-005, REQ-MEAL-006, REQ-MEAL-007, REQ-MEAL-008, REQ-MEAL-009〕
- 常见单一食物、基础食品和边界清晰的常见菜 MAY 使用可追溯资料或透明的版本化模板；精确包装食品 SHOULD 优先精确资料；高度自定义复合食品 SHOULD 请求配方、用量或标签但可只保存事实。内容不明套餐/拼盘 MUST 保存“已吃该套餐”的事实、保持营养 `unknown` 并创建组合内容问题，MUST NOT 擅自拆解。〔REQ-SCOPE-011, REQ-MEAL-019, REQ-NUTR-003, REQ-NUTR-004〕
- 同一营养汇总中，组合菜 MUST 仅按整菜或组件之一计算，MUST NOT 两者重复计入。通用模板 MUST 显示主要组成和采用份量，并保留模板版本与来源；用户更正组成后 MUST 重算当前有效视图，而旧快照保留可追溯性。〔REQ-MEAL-016, REQ-MEAL-017, REQ-MEAL-018〕

## 7. 库存默认、匹配、扣减与并发

- 在 `home_default` 场景系统 MUST 默认读取、尝试关联并尝试扣减家庭库存；所有跳过库存的原因 MUST 形成稳定状态而非只写在回复文字中。〔REQ-PANTRY-001, REQ-PANTRY-004〕
- 匹配 MUST 依次考察精确身份/条码、规范名+品牌+变体+规格、用户确认别名、原名的唯一历史、可靠当前指代，再到名称相似候选；每次匹配 MUST 保留候选、所选身份（若有）、证据、规则及规则版本。置信度只能辅助解释，不得替代证据。〔REQ-EVENT-005〕
- 匹配结果 MUST 至少表达 `unique`、`multiple`、`none`、`insufficient`、`unconvertible`。当且仅当为 `unique`、可可靠换算且足量时 MUST 扣减；其他前置条件不满足时 MUST 提交饮食、稳定跳过扣减并登记相应问题，且库存 MUST NOT 为负。库存影响 MUST 区分 `deducted`、`skipped_external`、`skipped_by_user`、`skipped_no_match`、`skipped_ambiguous`、`skipped_insufficient`、`skipped_vague_quantity`、`skipped_unconvertible_unit` 与 `reversed`。〔REQ-EVENT-003, REQ-PANTRY-001, REQ-PANTRY-004〕
- `partially_deducted` 是 PRODUCT-0.2 的库存影响状态，只能在用户针对本事件、数量和批次明确授权“先扣现有部分”时使用；该授权 MUST NOT 继承到下一事件。PRODUCT-0.1 MUST NOT 启用部分扣减，库存不足仍整项不扣。〔REQ-PANTRY-004〕
- 同一商品身份的多个批次 MUST NOT 被当成 `multiple` 商品歧义。用户指定批次时 MUST 优先；否则有可靠到期依据时 MUST FEFO，无可靠到期依据时 MUST FIFO。一次摄入 MAY 跨同一商品多批次作 per-event atomic 分配；并发扣减 MUST NOT 共同超扣。过期批次默认 MUST NOT 静默自动选择；用户明确选择时 MUST 提示状态并保留证据。〔REQ-PANTRY-005, REQ-PANTRY-006, REQ-PANTRY-007, REQ-PANTRY-008, REQ-PANTRY-009, REQ-PANTRY-010〕

## 8. 商品身份、营养档案、批次与保质生命周期

- `ProductIdentity/NutritionProfile/InventoryBatch` 分别是长期商品身份、可版本化营养资料和一次实际入库批次，三者 MUST 分离。批次耗尽只能令该批次 `depleted`，MUST NOT 删除商品身份、营养档案、别名或历史证据。〔REQ-PANTRY-005, REQ-PANTRY-015〕
- 商品身份 MUST 保留原始名称、规范名和商品类型，并能够承载品牌、口味/变体、用户确认别名、包装变体、营养档案引用和状态；规范名不得覆盖原名，长期别名必须有可靠证据或用户确认。本契约只冻结这些语义，不冻结字段名、物理 Schema 或索引。〔REQ-EVENT-004, REQ-EVENT-005〕
- 每次购买 MUST 创建独立 `InventoryBatch`，同名再次购买 MUST NOT 覆盖旧批次。批次 MUST 能表达稳定批次/商品关系、原话、购买或制作的时间锚点、接收和提交时间、原始数量及类型、包装层级和换算、原始入库量与当前余量、来源/数据质量、推导和问题；未知余量为 `unknown`，MUST NOT 写作 0。〔REQ-PANTRY-011, REQ-PANTRY-012, REQ-PANTRY-013, REQ-PANTRY-014, REQ-PANTRY-015〕
- “一袋鸡蛋” MUST 表示已购 1 袋；未知的是袋内个数，不能误作全部数量缺失。品牌、营养资料或保质期缺失通常 MUST NOT 阻止入库，未知信息及问题应保留。〔REQ-PANTRY-012, REQ-PANTRY-013, REQ-PANTRY-014〕
- 存放位置证据优先级 MUST 是用户本轮明确位置、商品包装或制造商保存条件、用户确认过的同商品规则、商品类型默认规则、有依据的模型判断、`unknown`。系统 MAY 按该次序推断位置，但 MUST 保存来源和规则版本；入库回执 MUST 显示实际采用的位置，且用户 MUST 可用自然语言纠正位置。仅在多个合理位置会实质影响保质或库存且明显不确定时，才 MAY 提供快捷选项。〔REQ-PANTRY-016, REQ-PANTRY-017, REQ-PANTRY-018〕
- 入库回执的共同边界是：单商品 MAY 提供详细回执；多商品同时入库时 MUST 对每项一行简洁反映其各自结果。逐字中文格式和快捷选项文案不由本契约冻结。〔REQ-PANTRY-017, REQ-PANTRY-018〕
- 开封状态和 `opened_at` MUST 可追溯；只有可靠的首次部分取用才 MAY 推断开封，并注明推断依据。到期锚点 MUST 按用户明确到期日、标签到期日、生产日期+明确保质期、制造商商品资料、用户确认过的同商品规则、购买时间+可靠规则、入库时间+默认规则、`unknown` 的优先级处理。开封时间+标签期限属于 `effective_expiration` 计算规则，MUST 与到期锚点分层保存，不得插入或改写上述锚点证据优先级。〔REQ-PANTRY-019, REQ-PANTRY-020〕
- 推算到期或剩余天数 MUST 标“估算/预计”，并保留锚点、规则版本、时区和存放条件；规则不足时 MUST NOT 编造天数，而应呈现最有价值的时间锚点。“剩余几天”是查询时的动态展示，MUST NOT 每日改写入库事实。位置或开封变化后 MUST 重算当前有效估算，旧估算及其依据 MUST 保留审计；临期提示只是库存管理信息，MUST NOT 保证食品安全。〔REQ-PANTRY-019, REQ-PANTRY-020, REQ-PANTRY-021, REQ-PANTRY-022, REQ-PANTRY-023〕

## 9. 营养来源、联网查询、计算与快照

- 营养来源优先级 MUST 是本轮用户确认的精确标签、当前包装或条码对应资料、制造商精确商品资料、同商品历史确认资料、权威公共食物数据库、经过配置的可信互联网资料、已激活个人菜品模板、通用菜品组成模板、有限合理估算、`unknown`。高优先级存在且适用时，低优先级 MUST NOT 冒充或覆盖它。〔REQ-NUTR-001〕
- 对常见原始食材和基础食品，系统 SHOULD 主动查询本地可信缓存、权威数据库或可信来源，而非要求用户上传标签。包装、精加工和高度自定义食品 SHOULD 优先精确商品、生产商、标签或用户配方；MUST NOT 将普通资料套用于配方明显不同的加工饮料。没有可靠资料时 MUST 使用 `unknown`，不得编造来源或以 0 填缺失字段。〔REQ-NUTR-002, REQ-NUTR-003, REQ-NUTR-004, REQ-NUTR-005〕
- 外部查询 MUST 先查已确认资料和可信缓存，再查权威数据库、生产商官方资料及白名单站点；每份资料的来源类型、名称/引用、版本、获取时间、匹配对象/变体和适用基准/范围 MUST 可追溯。请求 MUST 最小化，只能发送完成匹配所需名称、品牌、变体和规格，MUST NOT 发送整段原话、完整对话、饮食日期、库存、位置或无关个人资料。〔REQ-SCOPE-009, REQ-SCOPE-010, REQ-EVENT-005〕
- 最小营养表达 MUST 覆盖能量、蛋白质、脂肪、碳水和纤维；资料有钠时 MUST 保存钠。每份资料 MUST 能表达 `per_100g`、`per_100ml`、`per_serving`、`per_item`、`per_package` 或 `custom` 的基准种类，以及基准量、基准单位、份名、每包装份数和换算依据；未提供字段保持缺失。〔REQ-NUTR-005〕
- 用户明确数量、精确包装标签和确定换算 MUST NOT 标为估算；精确同版本历史档案 MUST 标“沿用历史营养表”，激活个人模板 MUST 标“按个人模板”。数量明确而营养基准来自可信公共库时，明确数量 MUST NOT 标为估算，详情 MUST 标为“参考数据库”并可追溯。由自然单位、可食部分、密度、出成率或通用模板推定的字段 MUST 逐字段显示采用值和依据，MUST NOT 笼统标整条。〔REQ-NUTR-006, REQ-NUTR-007, REQ-NUTR-008, REQ-NUTR-009, REQ-NUTR-010, REQ-NUTR-011〕
- 每个饮食项目提交时 MUST 创建不可变 `NutritionSnapshot`，记录来源和档案版本、计量基准、摄入量、换算公式、原始和舍入值、舍入规则、规则版本、估算字段、已知/缺失字段和覆盖状态。内部计算 MUST 使用稳定精度，统一舍入仅用于展示，展示后的舍入值 MUST NOT 回流参与累计。新标签/数据库版本 MUST NOT 静默改写历史；重新计算 MUST 形成营养更正事件。日汇总只能称为已知部分合计并说明覆盖范围；只要存在未计入项目，结果 MUST 为 `partial`，MUST NOT 冒充完整总摄入。〔REQ-EVENT-005, REQ-MEAL-018, REQ-NUTR-005, REQ-NUTR-010, REQ-NUTR-011〕

## 10. 幂等、事务、故障与隐私

- 每个写命令 MUST 按 `FactCommit → EffectBundle → EnvelopeFinalize` 三层协议执行。`FactCommit`原子保存事实、原话、最小规范化项目、请求与子操作幂等身份以及列明预期效果的 durable outbox；失败时所有业务行回滚，只允许独立且脱敏的技术日志。〔REQ-CORE-001, REQ-SAFE-002〕
- `EffectBundle`引用已提交事实，原子保存营养快照、实际库存效果或稳定跳过原因、Issue、来源版本、子操作投影贡献和`affected_dates[]`。技术失败只回滚该效果包，事实保持可见，outbox进入`pending`或`retryable_failed`；返回`committed_with_issues`且不得显示伪造或旧的权威进度。〔REQ-SAFE-002, CASE-EFFECT-001, CASE-EFFECT-002〕
- 所有效果达到`succeeded`或`permanent_business_skip`后，`EnvelopeFinalize` MUST 在一个原子提交中校验终态、生成`daily_progress_by_date[]`、`MixedCommitResult`、`ReceiptData`与冻结终态幂等结果，并把信封置为`terminal`。恰好影响 1 个自然日时 MUST 同时生成 `daily_progress`，且它与数组唯一对象逐字段相同；影响 2 个或更多自然日时 MUST 只返回数组，不提供单日别名。最终器任一写点失败时该层全部回滚，信封保持`effects_pending`，不得返回普通成功回执；重试只重跑最终器。〔REQ-SAFE-002, CASE-EFFECT-003〕
- 同一幂等身份由`idempotency_key + input_digest + subject_scope + command_type`共同确定。同一身份的终态重试 MUST 返回原冻结结果；非终态重试只能恢复`pending/retryable_failed`效果或最终器，MUST NOT 重做成功的`FactCommit`或效果。同键但摘要、主体/作用域或命令类型不同 MUST 返回`failed`与稳定`idempotency_conflict`，且零新业务写入。幂等键不同但语义相似的消息只能提示可能重复，MUST NOT 自动合并或删除。〔REQ-EVENT-007, REQ-EVENT-008, REQ-SAFE-003, CASE-STORAGE-006, CASE-STORAGE-007〕
- `mixed` 输入 MUST 按叙述顺序拆为有序领域事件；每个事件分别执行上述三层协议。后项失败 MUST NOT 回滚前项独立已提交事实，汇总回执 MUST 逐项说明`committed`、`committed_with_issues`、`needs_clarification`、`ignored`或`failed`。同一食品的库存、营养、Issue和投影属于一个`EffectBundle`，不得半写；库存前置条件变化应形成可解释业务跳过，而不是回滚事实。〔REQ-EVENT-009, REQ-EVENT-010, REQ-EVENT-003, REQ-MIXED-001〕
- B 后端 MUST 保存并校验服务端权威预览，至少绑定`input_digest + subject_scope + command_type`及适用的`data_revision`；调用方自报状态一律不可信。陈旧预览、非法状态转换和非法迁移必须在业务写入前失败关闭。OpenClaw、MCP 或其他适配器不得绕过该门。〔REQ-CORE-003, REQ-CONTEXT-003, REQ-SAFE-003〕
- 查询与回顾 MUST 只读取有效记录并说明完整、部分、估算与未知覆盖，MUST NOT 产生写入副作用。隐私、联网最小披露和测试隔离要求同样适用于 Skill、B 后端和所有适配器。〔REQ-EVENT-011, REQ-SCOPE-009, REQ-SCOPE-010〕

## 11. Companion contracts 的接口边界

本契约只定义共同业务语义。以下内容 MUST 由对应 companion contract 冻结，B 后端和适配器不得自行把未冻结内容冒充共同标准：

- receipt/date contract：只冻结成功回执的精确中文格式、日期展示格式和快捷选项文案；MUST 遵守 §8 已冻结的位置可自然语言纠正，以及单商品 MAY 详细、多商品 MUST 每项一行简洁反映各自结果的共同边界。〔REQ-PANTRY-017, REQ-PANTRY-018〕
- source registry contract：可用来源、白名单、来源版本和撤销治理；本契约仅规定优先级、可追溯与最小披露。〔REQ-SCOPE-010, REQ-NUTR-001〕
- issue/correction contract：只冻结问题分类、Correction/void 的载体、字段和展示；MUST 遵守 §4 已冻结的追加、单一可靠事务、适用库存补偿、营养重算、受影响日期 `daily_progress` 更新及原事件/旧快照/旧依据的审计结果，不得削弱这些共同语义。〔REQ-SCOPE-012, REQ-EVENT-002, REQ-EVENT-003, REQ-MEAL-010, REQ-MEAL-018〕
- Schema/model contract：字段名、约束、索引、迁移和物理存储；本契约仅规定领域对象、状态和不可违背的语义。〔REQ-EVENT-004, REQ-PANTRY-011〕

## 12. 被替代规则（非规范性审计）

以下语义均为 **superseded**，仅为防歧义的审计记录，绝非当前默认、兜底或实现许可：仅明确“在家”才读取/扣减库存；饮水/目标进度/白水不在范围；禁止纠错或冲销；任意数量模糊都必须 `preview`；库存多候选或不足使整条饮食失败；禁止主动查公共营养资料；估算不能用于营养计算；来源只有四级；同一 SKU 多批次必是 `multiple`；以及营养估算量可直接扣库存。当前语义以第 2—10 节为准。〔REQ-EVENT-002, REQ-EVENT-003, REQ-MEAL-010, REQ-MEAL-013, REQ-PANTRY-001, REQ-PANTRY-005, REQ-NUTR-002〕

## 13. 77 条任务范围 REQ ID 逐 ID 追踪表

本表的每个任务范围 ID 恰出现一次；`REQ-TIME-*` 为计划 §6.2、§10、§11.13、§20.5—§20.7 与 §28 需求台账的支撑性来源，已在正文引用，但不属于本任务要求的 77 条追踪范围。

| REQ ID | CONTRACT-v2 正文小节 |
| --- | --- |
| REQ-SCOPE-001 | §2 |
| REQ-SCOPE-002 | §2 |
| REQ-SCOPE-003 | §2 |
| REQ-SCOPE-004 | §2 |
| REQ-SCOPE-005 | §2 |
| REQ-SCOPE-006 | §2 |
| REQ-SCOPE-007 | §2 |
| REQ-SCOPE-008 | §2 |
| REQ-SCOPE-009 | §2, §9, §10 |
| REQ-SCOPE-010 | §2, §9, §10, §11 |
| REQ-SCOPE-011 | §2, §6 |
| REQ-SCOPE-012 | §2, §4 |
| REQ-EVENT-001 | §4 |
| REQ-EVENT-002 | §4, §11, §12 |
| REQ-EVENT-003 | §3, §4, §7, §10, §12 |
| REQ-EVENT-004 | §1, §3, §4, §5, §8, §11 |
| REQ-EVENT-005 | §1, §3, §4, §7, §8, §9 |
| REQ-EVENT-006 | §3 |
| REQ-EVENT-007 | §1, §10 |
| REQ-EVENT-008 | §10 |
| REQ-EVENT-009 | §10 |
| REQ-EVENT-010 | §10 |
| REQ-EVENT-011 | §4, §10 |
| REQ-EVENT-012 | §4 |
| REQ-MEAL-001 | §5 |
| REQ-MEAL-002 | §5 |
| REQ-MEAL-003 | §5 |
| REQ-MEAL-004 | §5 |
| REQ-MEAL-005 | §4, §6 |
| REQ-MEAL-006 | §4, §6 |
| REQ-MEAL-007 | §6 |
| REQ-MEAL-008 | §6 |
| REQ-MEAL-009 | §4, §6 |
| REQ-MEAL-010 | §5, §11, §12 |
| REQ-MEAL-011 | §5 |
| REQ-MEAL-012 | §5 |
| REQ-MEAL-013 | §5, §12 |
| REQ-MEAL-014 | §5 |
| REQ-MEAL-015 | §5 |
| REQ-MEAL-016 | §6 |
| REQ-MEAL-017 | §6 |
| REQ-MEAL-018 | §4, §6, §9 |
| REQ-MEAL-019 | §6 |
| REQ-PANTRY-001 | §5, §7, §12 |
| REQ-PANTRY-002 | §5 |
| REQ-PANTRY-003 | §5 |
| REQ-PANTRY-004 | §7 |
| REQ-PANTRY-005 | §7, §8, §12 |
| REQ-PANTRY-006 | §7 |
| REQ-PANTRY-007 | §7 |
| REQ-PANTRY-008 | §7 |
| REQ-PANTRY-009 | §7 |
| REQ-PANTRY-010 | §7 |
| REQ-PANTRY-011 | §8, §11 |
| REQ-PANTRY-012 | §8 |
| REQ-PANTRY-013 | §3, §8 |
| REQ-PANTRY-014 | §8 |
| REQ-PANTRY-015 | §8 |
| REQ-PANTRY-016 | §8 |
| REQ-PANTRY-017 | §8, §11 |
| REQ-PANTRY-018 | §8, §11 |
| REQ-PANTRY-019 | §8 |
| REQ-PANTRY-020 | §8 |
| REQ-PANTRY-021 | §8 |
| REQ-PANTRY-022 | §8 |
| REQ-PANTRY-023 | §8 |
| REQ-NUTR-001 | §9, §11 |
| REQ-NUTR-002 | §9, §12 |
| REQ-NUTR-003 | §6, §9 |
| REQ-NUTR-004 | §6, §9 |
| REQ-NUTR-005 | §3, §9 |
| REQ-NUTR-006 | §9 |
| REQ-NUTR-007 | §9 |
| REQ-NUTR-008 | §9 |
| REQ-NUTR-009 | §9 |
| REQ-NUTR-010 | §9 |
| REQ-NUTR-011 | §9 |
