# PRODUCT v1.0 OpenClaw 业务测试记录（2026-08-14）

## 测试边界

- 候选源码提交：`1a2784dffeab2de64c8ec007a521b48ddce45cf8`
- 运行环境：OpenClaw 实例 02–07，均使用各自独立的 `diet-manager-b-data` 测试目录。
- 所有业务操作均通过运行中注册的 `diet_manager` 工具发起，不以数据库脚本或 CLI 代替。
- 本轮只做代表性业务验收，不执行全量单元/故障/并发测试。
- 本记录不保存 Gateway 密钥、私钥内容或用户正式业务数据。

## 业务结果

| 实例 | 场景 | 结果 | 业务证据 |
|---|---|---|---|
| 02 | 记录早餐 | 通过（带问题提交） | `committed_with_issues`；记录 `event-3b5caa11f42d49ddb76330a8e3e2a841`；识别鸡蛋 2 个、面包 2 片、牛奶 250ml。未配置营养数据源，因此营养为 `unknown`，库存为 `skipped_insufficient`。 |
| 02 | 查询当天餐食 | 通过 | 只读 `query_meals` 返回 1 条；时间、早餐时段、地点及三项食物数量与写入一致；`committed=false`、`reason_code=read_only_result`。 |
| 03 | 记录 500ml 白水 | 通过 | `committed`；记录 `event-8b0a6f392f91c0f1925bcfecfc3d150e`。 |
| 03 | 查询当天汇总 | 通过 | 只读汇总返回 `water.count=1`、`plain_water_ml_milli=500000`（500ml），与写入一致。 |
| 04 | 查询空库存 | 通过 | `batches=[]`；只读返回，没有业务写入。 |
| 05 | 购买两箱牛奶（每箱 12 盒，每盒 250ml） | 通过 | `committed`；记录 `event-b04b3f20e17107a67cd7c8fe1dcc2a15`。 |
| 05 | 查询库存 | 通过 | 返回 1 个 milk 批次；`quantity_microunits=24000000`、`unit=carton`、状态 active/available、位置 refrigerator；与 24 盒的采购解析一致。 |
| 06 | “明天准备吃鸡蛋” | 通过（零写保护） | `ignored`、`committed=false`、`reason_code=future_plan`，没有生成 record_id，测试目录没有数据库文件。 |
| 07 | “喝了豆浆和白水”且不提供数量 | **发现缺陷** | 返回 `committed_with_issues`，只记录 soy_milk（数量 unknown），白水未记录，也没有 clarification。记录 `event-b6184b2bc0153df6476c5812f3b0ae5b`。 |

## 第二轮循环测试

| 实例 | 场景 | 结果 |
|---|---|---|
| 02 | 完全相同的餐食请求再次提交 | 通过；返回与首次相同的 `event-3b5caa11f42d49ddb76330a8e3e2a841`，没有产生第二条事实。 |
| 03 | “今天没喝水” | 通过零写保护；`committed=false`、`ACTION_CONFLICT`，没有新增饮水事实。 |
| 04 | “买了2盒鸡蛋和3袋面包” | 未实现；`ACTION_CONFLICT`、零写、无 clarification。库存复查仍为空。 |
| 05 | “喝了一盒牛奶” | 通过；生成 `event-cd67bb2ed72b07e09df3a660068ae575`，唯一匹配既有 milk 批次并扣减 1 carton；只读复查从 24 变为 23。 |
| 06 | “买了牛奶”（无数量） | 数据安全通过、交互不足；`ACTION_CONFLICT`、零写，库存复查为空，但没有返回可读 clarification。 |

第二轮证明了幂等、否定句零写、唯一库存匹配扣减和失败请求零半写均能工作；同时新增两个产品缺口：多商品采购未实现，以及缺数量采购没有可读追问。

## 发现的问题

### MIXED-LIQUID-001：同一句豆浆与白水会静默丢失白水

当前 `record_meal` 对“喝了豆浆和白水。”只提交豆浆事实；白水既未转换为 water event，也未触发明确澄清。用户看到 `committed_with_issues`，但如果不阅读详细 receipt，容易误以为整句话都已记录。

建议后续修复满足以下任一稳定语义：

1. 单次请求原子地产生 meal + water 两个记录，并返回 `record_ids`；或
2. 在写入前返回 `needs_clarification`，明确要求分别说明豆浆与白水数量，保持零写。

在修复前，不应宣称混合饮品一句话可以完整记录。

### PURCHASE-MULTI-001：多商品采购被整体拒绝

清晰输入“买了2盒鸡蛋和3袋面包”返回 `ACTION_CONFLICT`，没有写入也没有澄清。零写是安全的，但完整 0.1 的采购能力尚不能处理一句多商品。

### CLARIFICATION-001：缺数量采购只有错误码

输入“买了牛奶”时没有编造数量、也没有写入，这是正确的；但公开 outcome 只有 `ACTION_CONFLICT`，缺少“买了多少/什么规格”的自然语言追问。

### CORE-UNDO-001：权威 v1.0 要求的追加式撤销尚未公开实现

本地覆盖审计确认公开 `undo_record` 当前返回未实现。该项属于 v1.0 `I-2` / `REQ-CORE-004` 的完整 0.1 能力，不属于本轮已通过功能。

## 部署观察

- 实例 02、03 曾保留旧版同名工具的内存注册；仅热重载不足，完整 Gateway 容器进程重启后恢复为新 schema。
- 实例 02–07 的插件均已加载并注册 `diet_manager`。
- 实例 02、03、04、05、07 已创建独立 SQLite 测试库；实例 06 的未来计划被零写拦截，因此其测试目录仍为空。
- 未配置 USDA/FDC 数据源与凭据，所以营养字段保持 unknown；这是当前部署配置限制，不是本轮写入失败。

## 本轮结论

餐食写入与回读、饮水写入与汇总、采购入库与库存查询、未来计划零写保护均已在真实 OpenClaw 运行进程中通过。混合饮品场景存在一项明确业务缺陷，当前候选应标记为“核心链可试用，混合饮品未完成”，而不是全功能完成。
