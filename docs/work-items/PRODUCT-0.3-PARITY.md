# PRODUCT-0.3 功能对齐基线

- 基线日期：2026-08-14
- 上次冻结基线提交：`5b243a7e38ade42c29c593b0a0e81ed7459cee04`
- 当前实现基线：`61d11f71af15389a31b6e21b00a1243c21d0b7c0` 之后的
  SEL-PANTRY Task 9 候选（本文与实现同批复审）
- 正式项目目录：`E:\codx\skill\饮食管家`
- 产品需求唯一权威：`总功能开发计划0.3.md`
- 增强参考：`总功能开发计划0.4.md`
- 状态说明：本文是实现差距清单，不替代 0.3 的需求、案例或 Oracle。

## 1. 版本裁决

1. PRODUCT-0.1 和 PRODUCT-0.2 的功能范围、用户行为、数据语义与完成标准以
   `总功能开发计划0.3.md` 为准。
2. 0.4 中已经实现且不改变 0.3 行为的安全、证据、解析和事务增强保留，不回退。
3. 0.4 中新增的研究型营养能力、Watchlist 等不得挤占 0.3 未完成基础功能的顺序，
   也不得成为 0.3 完成的前置条件。
4. 当前代码中的内部领域能力不等于用户可用能力；只有 OpenClaw 公共入口、真实提交、
   可查询回读、安装生命周期和对应验收同时闭合，才算产品功能完成。
5. 不建设诊断、治疗、药物建议、疾病风险判断或未经请求的健康评价。

## 2. 当前总体判断

当前项目已经从 foundation 进入“可靠的核心事实记录引擎”，但尚未成为完整的 0.3
日常产品。按 0.3 PRODUCT-0.1 的用户功能面进行保守估算，当前约完成 40%–45%；
这个比例只是排期辅助，不是验收证据。由于正式安装、升级、备份、恢复和卸载尚未实现，
“可安装日常使用”的发布完成度仍为 0%。

已经形成的强基础包括：SQLite v1 存储、server-preview 权威、FactCommit/outbox/
EffectBundle/EnvelopeFinalize、幂等与故障恢复、本人/否定/时间/上下文解析、饮食事实、
白水事实、最小库存与营养快照、内部纠正和只读投影，以及 OpenClaw 真实插件入口。

尚未闭合的主链包括：Pantry 最终证据闭环、营养来源、Issue 中心、餐食纠错/撤销、六项进度、
公开查询、标准回执、完整可靠性矩阵、正式安装运维和全部 PRODUCT-0.2 便利层。

## 3. 0.3 PRODUCT-0.1 对齐矩阵

状态含义：

- `已实现`：当前公共路径和持久化闭环已经由独立证据覆盖。
- `部分实现`：存在可靠内部能力或窄切片，但 0.3 用户闭环尚未完成。
- `未实现`：只有契约/Schema/计划，或当前公共入口明确返回未实现。

| 0.3 能力 | 当前状态 | 已有内容 | 仍缺内容 / 下一任务 |
|---|---|---|---|
| §5 本人、事实优先、未知保留、非医疗边界 | 已实现 | parser、application 和 domain 已执行本人/非本人、否定、已发生/计划、unknown 非零化规则 | 后续所有新功能必须复用，不得绕开 |
| §6 日常饮食记录 | 已实现（核心范围） | `record_meal` 支持多项、未知数量、完整 source/time/subject/context 证据，真实 event/items/outbox/finalization | 组合菜品、公开标准回执仍在 RECEIPT/NUTR 范围 |
| §16 白水记录 | 已实现（核心范围） | `record_water` 独立 WaterEvent、完整时间与容量证据、真实进度贡献、只读回读 | 六项目标和标准回执由 PROGRESS/RECEIPT 补齐 |
| §20 时间、否定、本人、上下文 | 已实现（核心范围） | 0.4 安全增强后的 parser 覆盖绝对/相对时间、分句否定、谓词归属、混合液体边界 | 继续保持 0.3 语义，不把 0.4 新推理扩大为产品事实 |
| §7 商品入库 | 已实现（Pantry 核心范围） | 公共 `add_inventory` 已连接 parser→application→FactCommit→effect→finalizer；支持单/多商品、稳定父子 identity、真实 `record_id/record_ids` 和重开重放 | SEL-PANTRY Task 10 仍需冻结最终案例/证据与治理闭环；更丰富交互属于后续 Receipt/Issue |
| §9 库存匹配与扣减 | 已实现（Pantry 核心范围） | 确定性候选、FEFO/FIFO、全有或全无分配、显式跳过零读取、餐食扣减、补偿事务、陈旧并发和篡改拒绝均有真实测试 | 跨 Pantry/Nutrition 的全产品可靠性汇总由 SEL-FACTEFFECT/RELIABILITY 补齐 |
| §11 商品/批次/位置/保质期 | 已实现（Pantry 核心范围） | ProductIdentity、InventoryBatch、包装方程、位置/保质期证据、开封规则、过期排除、只读投影，以及追加式位置更正均已落库 | 主动临期提醒、延期和个人位置库属于 PRODUCT-0.2 `SEL-LIFE-001`；Pantry Task 10 尚需闭环 |
| §12 入库回执 | 已实现（Pantry 核心范围） | 单/多商品结果保留顺序、位置/到期证据、真实 record IDs；位置更正回执明确 previous/current location | 全产品统一标准回执布局和 Issue 快捷项仍属 `SEL-RECEIPT-001` |
| §13 营养来源与计算 | 部分实现 | NutritionVector、候选选择、不可变 meal snapshot、unknown/估算基础与事务传播 | 缺来源适配器、许可/缓存、Profile、真实 Probe/Doctor、主备降级；SEL-NUTR-001 |
| §8 Issue 与待补全 | 部分实现（内部 issue 行） | 库存未知/不足等内部 issue 可随事实保存 | 缺统一 Issue 生命周期、公开查询、快捷选项、解决事件和执行前复核；SEL-ISSUE-001 |
| §15 纠正、撤销、恢复 | 部分实现（库存位置更正已公开） | `correct_record` 已公开执行库存批次位置更正，采用独立 preview v5 身份、追加事实、effect、finalizer、只读投影和故障恢复；既有餐食纠正内部状态机保留 | 餐食/饮水公开纠正、`undo_record`、完整目标定位和快捷交互仍由 `SEL-CORR-001` 闭合 |
| §17 daily_progress | 部分实现 | daily_progress contribution、并发 reservation、按日存储、饮水/饮食增量基础存在 | 缺 GoalVersion、六项目标、unknown 下界、固定展示和直接公共查询；SEL-PROGRESS-001 |
| §19 查询与日/周回顾 | 部分实现 | repository 有 meal/water/daily projection，严格只读和 preview identity 验证 | application 对 `query_inventory/query_meals/query_daily_summary` 仍返回 `ACTION_NOT_IMPLEMENTED`；SEL-QUERY-001 |
| §18 成功回执 | 部分实现 | 内部 receipt/execution result 和黄金回执基础存在 | 公共 outcome 目前只有净化 status/record_id；缺逐菜、证据标签、Issue 快捷项、最终进度块；SEL-RECEIPT-001 |
| §21 安全、隐私、事务 | 部分实现（核心引擎强） | SQLite、迁移守卫、preview HMAC、FactCommit→effect→finalize、并发/崩溃/响应丢失、官方根零写验证 | 需对新增全部功能重跑完整可靠性矩阵并形成 SEL-RELIABILITY-001 发布证据 |
| §22 安装、迁移、备份、恢复、导出、卸载 | 未实现 | 当前只有开发插件构建、验证和 runtime 懒加载 | SEL-INSTALL/MIGRATE/BACKUP/EXPORT-BASE/RELEASE 全部未开始 |

## 4. PRODUCT-0.2 对齐矩阵

PRODUCT-0.2 必须建立在已发布且不退化的 PRODUCT-0.1 上；当前不得提前宣称完成。

| 0.3 PRODUCT-0.2 能力 | 当前状态 | 计划任务 |
|---|---|---|
| §14 个人菜品模板与复用 | 未实现（契约基础存在） | `SEL-TEMPLATE-001` |
| §19 丰富周回顾、快速复用、批量补录 | 未实现 | `SEL-REVIEW-001` |
| §11 主动临期提醒、延期、库存调整、个人位置 | 未实现 | `SEL-LIFE-001` |
| Rich CSV/分析/匿名化导出 | 未实现 | `SEL-EXPORT-001` |
| 0.1→0.2 升级、回滚与兼容 | 未实现 | `SEL-UPGRADE-002` |
| 0.2 不可变发布 | 未实现 | `SEL-RELEASE-002` |

0.4 新增的 `SEL-RESEARCH-001` 与 `SEL-NUTR-WATCH-001` 作为后续增强候选保留，
但不属于 0.3 PRODUCT-0.1/0.2 基础功能，不得阻塞上述任务。

## 5. 已实现内容的精确边界

### 5.1 公共入口

OpenClaw 契约目前声明八个 action，application 真实执行已有：

- `record_meal`
- `record_water`
- `add_inventory`
- `correct_record`（当前仅接受 parser 权威产生的库存位置更正）

查询、餐食/饮水纠正和撤销尚未形成公共可用闭环；不匹配的 `correct_record`
输入会稳定返回 `ACTION_CONFLICT`，不会被当作任意结构化写入口。剩余差异必须逐项关闭，
不能因为 domain type 已存在就标为完成。

### 5.2 内部引擎

以下内部能力应直接复用，不得重写或回退：

- `src/storage/**` 的 SQLite schema、migration guard 和固定数据库叶；
- `src/preview/**` 的 server-preview、token 与 v1/v2/v3 事实清单认证；
- `src/repository/**` 的 FactCommit、progress reservation、finalize 和只读 query；
- `src/domain/effect-bundle.ts` 的 meal/water/correction effect 与恢复状态机；
- `src/application/core-runtime.ts` 的物理根、私钥、ACL、懒加载和 capability 边界；
- `src/parser/**` 的 0.3 核心语义与已证明安全的 0.4 解析增强。

### 5.3 当前治理状态

- `SEL-CORE-001`：已完成，证据 `EV-20260813-037`。
- `SEL-PANTRY-001`：进行中；Task1–Task8 已形成公开采购/批次/扣减主链，Task9
  位置更正候选已通过 926/926 全量测试与 no-emit 类型检查；保质期重算、显式到期日优先、
  纠正后 FEFO、按认证 `base_revision` 串联多次历史纠正、原终态在后续纠正/扣减后精确重放、
  以采购 v4 私有签名为根并覆盖候选读取、扣减写前、首次/后续纠正及已是目标状态判断的
  采购事实、产品/批次关系行、全部同封采购身份→纠正→当前投影完整权威链、活跃与终态 effect 隔离，
  以及不同幂等键的已是目标状态零写入响应均已有针对性回归，
  等待最终独立复审和提交；
  Task10 负责最终 source acceptance、证据与治理闭环。
- PRODUCT-0.1 其余未开始任务：`SEL-NUTR-001`、`SEL-FACTEFFECT-001`、
  `SEL-ISSUE-001`、`SEL-CORR-001`、`SEL-PROGRESS-001`、`SEL-QUERY-001`、
  `SEL-RECEIPT-001`、`SEL-RELIABILITY-001`、`SEL-INSTALL-001`、
  `SEL-MIGRATE-001`、`SEL-BACKUP-001`、`SEL-EXPORT-BASE-001`、
  `SEL-RELEASE-001`。
- PRODUCT-0.2 未开始任务：`SEL-TEMPLATE-001`、`SEL-REVIEW-001`、
  `SEL-LIFE-001`、`SEL-EXPORT-001`、`SEL-UPGRADE-002`、`SEL-RELEASE-002`。
- SEL-PANTRY brief 的旧 worktree 绝对根已在迁入主目录后改为
  `E:\codx\skill\饮食管家` 及其任务自有验证根；继续 Pantry 前仍须用 trace
  normal/self-test 证明四份 mirror 与该绑定逐字节一致。

## 6. 后续强制顺序

1. 完成 SEL-PANTRY Task9 独立复审与提交，再执行 Task10 的最终 source acceptance、
   17 案证据、故障矩阵和治理闭环。
2. 完成 `SEL-NUTR-001`，只实现 0.3 所需来源/Profile/Snapshot/降级；0.4 research/watch 后置。
3. 对累计 Pantry/Nutrition 能力完成 `SEL-FACTEFFECT-001` 事务闭环。
4. 依次完成 Issue、Correction、Progress、Query、Receipt。
5. 完成 `SEL-RELIABILITY-001`，证明全功能的并发、崩溃、响应丢失、隐私和官方根零差异。
6. 完成 PRODUCT-0.1 安装、迁移、备份、恢复、最小导出、卸载和不可变发布。
7. 再实现 PRODUCT-0.2 模板、回顾、生命周期、rich 导出、升级和发布。
8. 最后才评估 0.4 的 Research/Watch 增强，不得删除或改变 0.3 已交付行为。

## 7. 完成判定

只有同时满足以下条件，才可把“0.3 功能完成”反馈给用户：

- 本文所有 PRODUCT-0.1 与 PRODUCT-0.2 行均从 `部分实现/未实现` 变为有证据的 `已实现`；
- 所有公共 action 通过真实 OpenClaw 注册入口可用，不依赖直接调用内部 service；
- 每项写入都有真实 record/event identity、幂等、事务、只读回读和故障恢复证据；
- 正式安装、升级、备份、恢复、导出、默认保留卸载和确认删除卸载均通过隔离 E2E；
- 正式数据根前后清单零差异，测试临时根和进程残留为零；
- 全量测试、trace/X-GATE、source/dist parity、唯一正式 build、OpenClaw check/validate 全绿；
- 至少两路独立复审均无 P0/P1，且最终工作树干净。
