# SEL-PANTRY-001 实施报告

## 结果

`SEL-PANTRY-001` 的产品候选为
`36b1c6d30375c7d5369c42f22ce498086d50f25c`。该切片在既有 SEL-CORE
基础上完成公开商品入库、商品身份、包装四量、批次投影、位置/开封/保质证据、
家庭库存匹配与扣减、多商品购买、身份澄清，以及追加式库存位置纠正。

源码候选已通过真实 OpenClaw 工具注册边界执行 `add_inventory`；带库存效果的
`record_meal` 和 Pantry 范围的 `correct_record` 已通过公开 source core runtime。
安装态 OpenClaw 仍加载上一次正式构建的 `dist`，所以用户可安装使用必须等后续唯一
正式 build/release 验证。源码写路径保持
FactCommit → outbox → effect transaction → EnvelopeFinalize 四阶段；餐食事实不会因
库存未知、不足、歧义或技术重试而丢失。

## 17 个选中 CASE 与断言路径

`full_case_set` 为 `none`。本报告证明下列 17 个选中 CASE 的绑定断言路径，不把它们
扩张为完整 PRODUCT-0.1 或安装发布证明。

| CASE | 绑定 Oracle 路径 | 精确 source 测试标题 |
|---|---|---|
| `CASE-PURCHASE-001` | `/oracle/fact_commit/purchase_event`; `/oracle/effect_bundle/inventory_batch`; `/oracle/quantity_equation` | `preserves the exact package equation for CASE-PURCHASE-001`; `commits exact CASE-PURCHASE-001 through the public core runtime` |
| `CASE-PURCHASE-003` | `/oracle/fact_commit/purchase_event`; `/oracle/product/location_evidence`; `/oracle/receipt/inferred_fields_labeled` | `labels configured location inference and keeps explicit locations unlabelled as rules`; `persists canonical v2 fact, product, batch and projection evidence and replays exactly` |
| `CASE-PURCHASE-007` | `/oracle/fact_commit/purchase_event`; `/oracle/product_identity`; `/oracle/inventory_batch`; `/oracle/nutrition_profile_reuse` | `reuses one exact historical identity and never auto-selects among same-name variants`; `reuses one exact historical identity while creating a distinct batch` |
| `CASE-INVENTORY-001` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/inventory_transactions` | `deducts a matching Pantry batch and honors explicit skip without inventory reads`; `allocates one sufficient exact batch` |
| `CASE-INVENTORY-002` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/batch_allocations` | `commits one meal and atomically allocates two cartons across FEFO then FIFO batches`; `allocates across same-product batches in FEFO then FIFO order` |
| `CASE-INVENTORY-003` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/issue` | `commits the meal fact but skips two distinct product identities with one stable issue`; `CASE-INVENTORY-003 commits the meal but opens an issue for two candidates` |
| `CASE-INVENTORY-005` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/issue`; `/oracle/amount_authority` | `keeps nutrition grams isolated from carton inventory when conversion is unproven`; `rejects unit-incompatible stock without converting nutrition amounts` |
| `CASE-INVENTORY-004` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/issue`; `/oracle/business_effects/inventory_nonnegative` | `uses all-or-none persistence when Pantry stock is insufficient`; `CASE-INVENTORY-004 commits insufficient eggs without a negative inventory row` |
| `CASE-INVENTORY-009` | `/oracle/fact_commit/meal_event`; `/oracle/effect_bundle/inventory_match`; `/oracle/effect_bundle/batch_allocations`; `/oracle/business_effects/expired_batch_unchanged` | `excludes an expired Pantry batch and deducts only the fresh batch`; `excludes expired batches and leaves them unchanged` |
| `CASE-MEAL-004` | `/oracle/fact_commit/meal_event`; `/oracle/parsing/context`; `/oracle/effect_bundle/inventory_match`; `/oracle/business_effects/inventory_read_count` | `keeps company ingestion self-owned while marking inventory outside`; `CASE-MEAL-004 records a company apple without reading or deducting home inventory` |
| `CASE-MEAL-005` | `/oracle/fact_commit/meal_event`; `/oracle/parsing/inventory_directive`; `/oracle/effect_bundle/inventory_match`; `/oracle/business_effects/inventory_read_count` | `attaches explicit skip evidence to CASE-MEAL-005 only`; `persists an explicit inventory skip and never reads a malformed Pantry projection` |
| `CASE-PURCHASE-002` | `/oracle/fact_commit/purchase_event`; `/oracle/quantity_equation`; `/oracle/effect_bundle/inventory_batch` | `keeps outer-only eggs unknown instead of inventing an inner count`; `preserves outer-only package unknowns without inventing inner egg counts` |
| `CASE-PURCHASE-005` | `/oracle/fact_commit/purchase_event`; `/oracle/product/expiration_evidence`; `/oracle/receipt/time_anchor` | `keeps unreliable expiration null and performs safe Shanghai calendar addition`; `rejects invented or unsafe expiration rules` |
| `CASE-PURCHASE-006` | `/oracle/fact_commit/purchase_events`; `/oracle/effect_bundle/inventory_batches`; `/oracle/receipt/items`; `/oracle/receipt/shared_issues` | `commits CASE-PURCHASE-006 as three ordered child events and truthful record IDs`; `replays multi-product outcomes live and after reopen without duplicate facts` |
| `CASE-PURCHASE-008` | `/oracle/command`; `/oracle/product_identity`; `/oracle/clarification/options`; `/oracle/business_effects` | `returns bounded identity clarification without adding business rows`; `reuses one exact historical identity and never auto-selects among same-name variants` |
| `CASE-PURCHASE-009` | `/oracle/fact_commit/purchase_event`; `/oracle/product/opening_evidence`; `/oracle/product/expiration_evidence` | `turns explicit partial use into versioned opening evidence`; `persists partial-opening evidence and its labeled one-day expiry rule` |
| `CASE-PURCHASE-010` | `/oracle/fact_commit/location_correction_event`; `/oracle/product/location_evidence`; `/oracle/product/expiration_evidence`; `/oracle/audit/previous_value_visible` | `commits CASE-PURCHASE-010 through the public runtime as one append-only correction`; `recovers the append-only correction across FactCommit, effect, and finalizer seams` |

目录 `shared/acceptance-cases/cases.json` 是唯一业务 Oracle；测试不维护第二份结果目录。
目录版本为 `1.6.0`，选中 CASE 与 fixture 均为 `17`，目录自测拒绝 `15` 个突变并
通过 `1` 个正控制。

## 已交付行为

- 购买命令保存 ProductIdentity、品牌/口味/规格、包装外层/内层/容量/总量四量，未知值保持 `null`。
- 单商品和多商品购买使用稳定父子 identity，创建真实 purchase events、products、batches、projections、transactions 与 record IDs。
- 同名多变体返回 2–4 个有界澄清选项和自由文本；选择前业务写入为零。
- 餐食库存效果支持显式批次、FEFO/FIFO、跨批次全有或全无分配、过期排除、外食/显式跳过零读取、未知/单位不兼容零扣减。
- Pantry 失败不回滚已经发生的餐食事实；不足、歧义和单位不明形成稳定非阻塞 issue。
- 位置纠正使用公开 `correct_record`，追加 `inventory_adjusted` 事实，保留旧值审计，重算规则型到期时间但保留制造商明确到期日。
- 纠正事实、效果与最终器可分别崩溃恢复；同键重放相同，不同键陈旧写失败且不追加第二事实。
- purchase v4 与 correction v5 私有预览签名、完整 envelope event set、purchase/meal sibling、商品/批次/交易/outbox/bundle/投影形成精确权威链。
- 后续 meal 写入与 pending correction 双向串行；已终态业务跳过不会永久阻塞纠正。

## 验证证据

在产品提交 `36b1c6d30375c7d5369c42f22ce498086d50f25c` 上，使用 pinned
Node.js `v24.15.0` 串行执行：

- Pantry 目录 normal：`cases=17 / catalog=1.6.0 / fixtures=17`；self-test：`mutations=15 / controls=1`。
- 根权威 normal：`official_delta=0 / isolated_removed=true`；任务自有正式验证根和隔离根均为 `0 → 0` 条目。
- Pantry focused：`4 files / 137 tests` 通过。
- repository/fault/vertical focused：`3 files / 187 tests` 通过。
- 完整 source Vitest：`24 files / 926 tests` 通过，单 worker、无文件并行。
- TypeScript `--noEmit`：exit `0`。
- trace normal/self：`74 requirements / 153 cases / 63 tasks / 70 governance / 37 evidence`；self `17` mutations。
- `git diff --check`：exit `0`；private endpoint、credential assignment 扫描均为 `0`；pinned Node residue 为 `0`。

`dist/**` 仍是 SEL-CORE Task 9 的已验证正式构建产物，本任务没有 emit 或 build，
没有修改 dist、schema、migration、`package.json` 或 OpenClaw plugin manifest；
`shared/acceptance-cases/harness-manifest.json` 随目录从 44 案更新为 59 案。没有执行 stale-dist 的
repository-concurrency、progress-reservation 或 crash harness。它们明确留给后续
`SEL-RELIABILITY-001`/release 正式候选，不作为本 source 切片的声明。

## RED → GREEN 与精确变更

从 Pantry closure 基线 `becded5` 到产品候选 `36b1c6d` 的精确变更为 `54` 个路径。
TDD 非 amend 提交依次包括：

- 设计/计划：`91e1985`、`72eb814`、`22edce7`；
- 17 案目录与 fixture authority：`b5cbb4f`、`3c02fe0`、`f95a6b1`；
- 根身份、原生监控、helper 生命周期与主目录绑定：`9d6bf36`、`c0a1426`、`0488175`、`5b243a7`、`7ce1d3e`；
- 0.3 偏差矩阵：`019c0c3`；
- Pantry evidence/rules/allocation/purchase/deduction/public runtime：`7ad1898`、`6517891`、`c60f19d`、`f2076a0`、`9b68dae`、`61d11f7`；
- 位置纠正、私有 purchase/correction authority 与全部复审修复：`36b1c6d`。

关键真实 RED 包括：缺失 15 个 CASE、fixture 业务 Oracle 泄漏、外来根删除与瞬时根替换、
helper 提前退出/溢出/STOP 不响应、缺失公开购买/扣减/位置纠正、FactCommit/effect/finalizer
故障、陈旧并发、伪造 purchase/correction/projection/outbox/transaction、未签 sibling/额外
event、时间基准协同篡改。每项均先失败再由最小生产修复转绿。

## 数据根与隐私

- 未读取或写入用户正式数据根；只使用任务自有 `official-manifest-sentinel/SEL-PANTRY-001` 做空清单验证。
- 每个 SQLite 测试使用新的隔离子目录；DB/WAL/SHM/secret/state 在边界后清理。
- 正式验证根与隔离根在 Task 10 前后均为空；PowerShell/Node owned residue 为零。
- 没有远程请求、用户凭据、私网 endpoint、npm install、push 或 deploy。

## 独立复审

- 规格/领域复审最终结论：`P0=0 / P1=0 / P2=0 / READY=YES`。
- 质量/事务/安全复审最终结论：`P0=0 / P1=0 / P2=0 / READY=YES`。
- 复审修复覆盖保质期显式证据、FEFO current projection、pending writer 双向串行、
  v4/v5 私有锚、完整 purchase/meal event set、terminal outbox/bundle/transaction 与服务时间基准。

## 明确非声明

本切片不声明完整 PRODUCT-0.1，不实现营养来源/Profile/Doctor、统一 Issue 中心、餐食/饮水
全面纠正与 undo/restore、六项目标、公开日/周查询、统一标准回执、安装、迁移、备份、恢复、
导出、卸载或发布。本切片没有刷新正式 dist，也不把 17 个 CASE 宣称为 17 条完整端到端产品旅程。

唯一下一 WIP 是 `SEL-NUTR-001`，只实现 0.3 所需来源/Profile/Snapshot/unknown/降级；
0.4 Research/Watchlist 继续后置。
