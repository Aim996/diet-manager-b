# SEL-NUTR-001 开发日志

> 状态：前置 Pantry 已关闭，NUTR 是唯一 WIP；Batch A 契约与兼容 Schema 已实现并通过定向 smoke。

### Preconditions / 2026-08-14

- 目标：关闭 `SEL-PANTRY-001`，登记 `EV-20260814-038`，创建完整 NUTR active brief。
- 起始 HEAD：`3f7d4fd`。
- 真实 RED：trace self-test 报 `TRACE_EVIDENCE_FILE_ORPHAN:EV-20260814-038-sel-pantry-001.md`。
- 改动范围：只改计划、brief、report/evidence引用、trace validator 与派生镜像；不改产品源码。
- 测试策略：本批只跑 trace write/normal/self 与 diff-check；产品全量测试延期到营养模块实现完成。

### Batch A / 2026-08-14

- 目标：冻结 15 个选中案例、八层来源能力契约、营养 Snapshot v1.1、补充事件类型和公开字段级营养结果。
- 绑定 REQ：`REQ-NUTR-001`—`REQ-NUTR-006`、`REQ-SOURCE-001`、`REQ-MEAL-003`。
- 绑定 CASE：`CASE-NUTR-001/002/003/004/005/006/008/009`、`CASE-MEAL-003/006/007/008`、`CASE-SOURCE-001/002/003`。
- 起始 HEAD：`3621a49`。
- 改动文件：共享 source capability contract、case/fixture catalog、harness manifest、Nutrition/Event Schema 与 validator、公开 `contracts/outcome/index`、定向 contract test、trace 派生镜像。
- 行为变化：提交成功结果可选返回递归冻结的 `nutrition_items`；unknown 摄入量可在 Snapshot v1.1 中以 `null/null + unknown` 表达；新增 `nutrition_supplemented` 事件枚举。尚未接入来源网络、FactCommit 或补全写路径。
- 接口/Schema/authority 决策：`nutrition_items` 只允许 committed outcome；十字段集合与证据枚举 exact；数值必须是最长 32 字符的 canonical finite decimal；v1.0 Profile/Snapshot 继续可读，v1.1 的 null 仅限全 unknown；SQLite migration 保持 v1。
- 兼容边界：全局案例目录增量升级到 `1.7.0/73`，fixture 升级到 `1.5.0`；Pantry 17 案选择与顺序保持不变；共享 harness 锁定新增 source contract。
- 真实 RED：新 Vitest 先以缺少 `validate-sel-nutr-cases.mjs` 和 committed outcome 丢失 `nutrition_items` 共 2 条失败；Schema validator 随后暴露 PowerShell 7 JSON timestamp/array mutation 兼容问题并在同批修正。
- 定向 smoke：selected nutrition normal/self `15 / mutations=10`；Nutrition Schema `43`；core model Schema `42`；public contract Vitest `2/2`；shared harness `15/15`；Pantry selection `17`；trace write/normal/self `74/153/63/70/38, mutations=17`；`git diff --check` PASS。
- 延期到模块末的测试：插件 full、`tsc --noEmit`、source/Doctor、resolution concurrency、supplement/replay/tamper、全部旧共享族 validator；本批不 build、不访问网络。
- 已知风险/假设：来源实现、可信 config、deadline、durable single-flight 和公开 readback 尚未接线；目录升级后旧的累计型共享 validator 需在最终统一测试前做一次版本前移，不在每个开发批反复运行。
- 后续修复索引：无产品运行时缺陷；PowerShell 7 `ConvertFrom-Json -DateKind String` 与 mutation setter 兼容修复已包含在本批。
- 批次提交：`feat: freeze nutrition contracts`（本段日志与实现同一提交）。

### Batch B1 / 2026-08-14

- 目标：实现可信营养配置、三类来源 adapter、八层顺序 client、统一 deadline 和只读 Doctor。
- 绑定 REQ：`REQ-NUTR-001/002/003/005`、`REQ-SOURCE-001`。
- 绑定 CASE：`CASE-NUTR-001/004/005`、`CASE-SOURCE-001/002/003`。
- 起始 HEAD：`fab7961`。
- 改动文件：新增 `src/nutrition/{types,config,source-client,doctor}.ts` 与三个 `adapters/*`；扩展 OpenClaw backend-only nutrition config；新增两份 acceptance test。
- 行为变化：可信配置默认 deadline 2000ms、仅允许 500—5000ms；source entry 按 registry rank/source ID 排序；resolution 使用单一 aggregate AbortSignal，首个较高层可靠证据获胜，超时/错误最终保留 unknown；Doctor 只调用 Probe，不 resolve 用户数据、不打开 DB。
- 接口/Schema/authority 决策：来源请求只含七个规范化 allowlist 字段；config clone 在数组/反射前拒绝 Proxy、getter 和非普通对象；digest 不含 credential ref 文本，只绑定“是否已配置”；runtime identity 已增加 `source_config_digest` 冲突检查，真正营养 runtime 注入留给下一批 async application 接线。
- 兼容边界：`nutrition` 是 OpenClaw config 的可选 backend-only 字段；旧配置自动使用空来源、固定 policy 和 2000ms，不改变八个 action 或模型参数。
- 真实 RED：两份新 Vitest 在收集阶段均以 `src/nutrition/config.js` missing module 失败；首个 Doctor GREEN 运行又暴露同 rank 必须按 source ID 排序，修正测试期望后通过。
- 定向 smoke：`nutrition-source.test.ts` 3/3、`nutrition-doctor.test.ts` 1/1；总计 4/4，约 1.1 秒。
- 延期到模块末的测试：插件 config 兼容全集、三个 adapter fixture transport 的扩展矩阵、`tsc --noEmit`、application/full/trace；不 build、不真实联网。
- 已知风险/假设：adapter 目前只提供安全注入接口，没有实际 FDC/OFF HTTP transport；持久单飞与异步 application 尚未实现；timeout 后迟到 Promise 不取得任何写能力。
- 后续修复索引：无；后续 Batch B2 将把 config/adapters 注入 v6 claim 与异步 handler。
- 批次提交：`feat: add nutrition source capability`（本段日志与实现同一提交）。

### Batch B2 / 2026-08-14

- 目标：在 migration-v1 现有两表上建立受 HMAC 保护的营养 resolution claim、lease takeover 与动态证据赢家复用。
- 绑定 REQ：`REQ-NUTR-001/002/005`、`REQ-SOURCE-001`。
- 绑定 CASE：`CASE-NUTR-001/004/005`、`CASE-SOURCE-001/002/003` 的并发/降级前置权威。
- 起始 HEAD：`5085823`。
- 改动文件：新增 `src/nutrition/resolution-claim.ts` 与 `nutrition-resolution.test.ts`；增加 `handleCoreRequestAsync` 兼容入口，OpenClaw execute 改为 await；保留内部同步入口供 0.3 既有调用兼容。
- 行为变化：`command_envelopes + idempotency_records` 可保存 `nutrition_resolving` pending authority；同 key/base 的活跃 lease 返回 pending，过期 generation CAS takeover；完成后两表原子切换 `preview_ready`；迟到 owner 读取认证后的赢家 material，不比较自己的动态数值。
- 接口/Schema/authority 决策：pending HMAC 绑定 base/config/owner/generation/lease/operation/message/conversation；final v6 HMAC 绑定 base/evidence digest/config/meal/effect identities；不同 base 在认证既有行后稳定 conflict；不新增 migration/表。
- 兼容边界：旧同步 `handleCoreRequest` 未删除；新增 async wrapper 供 OpenClaw 和后续 nutrition await 使用，因此 0.3 现有测试调用无需在本批整体改写。
- 真实 RED：`nutrition-resolution.test.ts` 先因缺少 `resolution-claim.js` 在收集阶段失败；修复测试自身 Node SQLite 导入方式后，生产模块仍 missing，再进入 GREEN。
- 定向 smoke：resolution 2/2；覆盖 owner/pending/final reuse、changed base conflict、lease takeover、late-owner CAS loser。
- 延期到模块末的测试：真实两个 request 的 adapter barrier、单次网络调用、meal/Profile/Snapshot exactly-once、v6 与 server preview/domain execute 接线、tamper/full/noEmit。
- 已知风险/假设：当前是持久 claim 底座，不等于营养业务闭环；`nutrition_resolving` 行只能由后续 Task 5 application orchestration 创建/完成；未集成前不会被旧同步路径触发。
- 后续修复索引：Task 5 必须在签 v6 前解析来源，并在赢家完成后走既有 FactCommit→EffectBundle→Finalize；Task 7 再统一验证跨进程并发/崩溃。
- 批次提交：`feat: serialize nutrition resolution`（本段日志与实现同一提交）。

### Batch C1 / 2026-08-14

- 目标：把已认证的 v6 营养证据接到真实餐食入口，生成并持久化 Profile/Snapshot v1.1，并在 committed outcome 返回字段级营养结果。
- 绑定 REQ：`REQ-NUTR-001/002/004/005/006`、`REQ-MEAL-003`。
- 绑定 CASE：本批代表性覆盖 `CASE-MEAL-003` 的范围换算规则、`CASE-MEAL-019` 的 unknown amount 保留；15 案完整矩阵延期到模块最终 Gate。
- 起始 HEAD：`0b77d52`。
- 改动文件：新增 `nutrition-service.ts`、`nutrition-repository.ts`、`nutrition-application.test.ts`；修改异步 core runtime/OpenClaw 接线、nutrition outcome 类型校验和 Profile/Snapshot v1.1 Schema source enum。
- 行为变化：OpenClaw 的异步餐食入口先复用 durable resolution claim，再调用既有 0.3 FactCommit/EffectBundle/Finalize；成功后用真实 event/item identity 生成十字段 Profile/Snapshot，并返回递归冻结的 `nutrition_items`。同步 `handleCoreRequest` 继续保留，旧调用无需改成 Promise。
- 接口/Schema/authority 决策：Profile version 由 subject/source/version/字段值派生，Snapshot ID 由 operation/event/item/profile 派生；换算使用 BigInt 固定六位、half-up；unknown amount 保持 `null/null`，绝不转 0；`generic_estimate` 作为 v1.1 来源类型加入兼容 Schema。
- 兼容边界：本批没有 migration、没有正式 build、没有真实网络；旧同步入口和已有餐食/库存 effect 不改。新增营养来源为空时仍降级 unknown 并提交餐食。
- 真实 RED：新应用测试先缺少 service/repository；接线后代表性真实入口暴露三个测试夹具问题（营养 Oracle 文本并非 parser candidate、当前 Windows PowerShell 模块路径继承错误、表内已有 legacy Profile 使全表计数不等于 v1.1 计数），均在测试/命令边界修正，没有放宽产品 authority。类型检查另捕获 claim union narrowing、outcome 数组 narrowing 和 generic freeze cast 三处静态错误并做窄修。
- 定向 smoke：`nutrition-application + nutrition-resolution` 2 files / 5 tests PASS；Nutrition Profile/Snapshot Schema `43` cases / `4` mutations PASS；`tsc --noEmit` PASS；`git diff --check` PASS。
- 延期到模块末的测试：15 案 table、旧插件/full、跨进程并发、tamper/fault、补充事件、trace。按 B 模式不在本批重复运行这些族。
- 已知风险/假设：当前 Profile/Snapshot 写入发生在既有 meal finalize 之后的独立 SQLite savepoint；若该写失败，已提交餐食返回 `committed_with_issues`。这满足 fact-first，但尚未达到计划 Task 5 的“营养 Snapshot + progress 同一 EffectBundle 事务”，后续 C2 必须接入原子 effect/replay 后才能关闭 Task 5。
- 后续修复索引：C2 接 exact progress contribution、terminal replay 与同事务 rollback；Task 6 再实现 append-only `nutrition_supplemented`。
- 批次提交：`feat: connect nutrition application results`（阶段性 C1；Task 5 尚未关闭）。

### Batch C2 / 2026-08-14

- 目标：让未配置网络/密钥的真实插件也具备最小可用营养能力，而不是永远落到 unknown。
- 绑定 REQ：`REQ-NUTR-002/004/005/006`、`REQ-SOURCE-001`。
- 绑定 CASE：代表性覆盖 `CASE-WATER-003` 的 250ml 营养饮品路径；完整常用食物/模板矩阵延期到模块最终 Gate。
- 起始 HEAD：`dd3198c`。
- 改动文件：新增 `src/nutrition/builtin.ts`；修改默认 nutrition config、runtime 默认 adapter、明确数量采用逻辑与应用 acceptance。
- 行为变化：默认启用版本化 `local.generic_estimate`，当前只含 milk 的 per-100ml 部分字段；明确 250ml 由 parser quantity authority 合并到来源证据并稳定换算，公开标签为 `field_inference`。没有可靠条目时仍按 tier 8 unknown 提交事实。
- 接口/Schema/authority 决策：内置表是本地、无网络、版本化、partial coverage；不声称当前包装标签或政府数据库。数量只在 basis/unit 可证明兼容时采用，禁止 bottle 被当作 ml、bowl 被当作 g。
- 兼容边界：显式可信配置可关闭/替换默认来源；旧同步入口不触发营养解析；没有新增 credential、网络 origin、migration 或正式 build。
- 真实 RED：真实 async 入口已提交 milk meal，但营养结果为 `adopted=null/source=unknown`；实现默认本地 adapter 和单位兼容采用后转 GREEN。
- 定向 smoke：`nutrition-application + nutrition-source` 2 files / 7 tests PASS；`tsc --noEmit` PASS。其余测试延期。
- 延期到模块末的测试：egg/rice/apple/orange/chicken、common dish、unknown combo、插件 full、fault/tamper/concurrency/trace。
- 已知风险/假设：内置表当前只有 milk，且仍通过 C1 的 post-finalize Snapshot 写路径；常用食物扩表和同一 EffectBundle 原子化仍待后续批次。
- 后续修复索引：下一批先补 0.3 核心常用食物与半碗/可食部范围，再集中接 atomic effect/replay。
- 批次提交：`feat: add offline nutrition fallback`。

### Batch C3 / 2026-08-14

- 目标：补齐 0.3 核心常用食物的离线营养底座和最小份量推断，不依赖网络可用性。
- 绑定 REQ：`REQ-NUTR-002/004/005/006/010/011`。
- 绑定 CASE：`CASE-MEAL-003/006`、`CASE-NUTR-002/008/009` 的来源/份量基础；公开 parser 未承诺的自由文本不作为本批 acceptance。
- 起始 HEAD：`b4d776b`。
- 改动文件：扩展 `nutrition/builtin.ts`、`nutrition-service.ts` 和单一 application 表驱动测试。
- 行为变化：内置版本表新增 cooked rice、chicken breast、egg、apple、orange；明确 g/ml 直接采用；半碗米饭采用 100—150g 范围的上界 150g；apple/orange/egg 的自然单位规则已实现但留待最终案例矩阵统一验证。
- 接口/Schema/authority 决策：全部仍标记 `generic_estimate/field_inference`，不冒充精确标签或公共数据库；每个范围保留 rule_version；单位不兼容继续 unknown。
- 真实 RED：内置 adapter 对 rice/chicken 返回 `no_results`；扩表后同一 test 转 GREEN。曾尝试用两种未冻结自由文本走公开 parser，均在 subject/amount authority 前被拒，已停止猜测并改在来源/采用边界测试，避免把 parser 扩权混入营养任务。
- 定向 smoke：offline core food table 1/1 PASS；`tsc --noEmit` PASS；`git diff --check` PASS。
- 延期到模块末的测试：自然单位三案完整 Oracle、common dish、unknown combo、插件/full/fault/trace。
- 已知风险/假设：通用数值是版本化估算，仅用于无更高优先级证据时；本批没有引入网络、缓存或产品精确身份。
- 后续修复索引：下一批处理 common dish/unknown combo，再进入 supplementation 或 atomic effect 收口。
- 批次提交：`feat: extend offline nutrition rules`。

### Batch C4 / 2026-08-14

- 目标：实现版本化常见菜模板优先于通用估算，并保持未知套餐不拆分、不臆造组件。
- 绑定 REQ：`REQ-NUTR-002/004/005/010/011`。
- 绑定 CASE：`CASE-NUTR-003`、`CASE-MEAL-007/008`。
- 起始 HEAD：`7747e45`。
- 改动文件：`nutrition/builtin.ts`、默认 config、份量采用规则和既有快速 application test。
- 行为变化：新增 rank 6 `local.versioned_common_dish_template`，当前覆盖 fried rice 与 beef noodle；rank 7 generic estimate 仍只在 rank 6 无结果时适用。碗/份可采用 1 serving 并标记 `common-dish-serving-v1`；未注册组合继续无结果并最终 unknown。
- 接口/Schema/authority 决策：模板字段是 partial、source_type=`generic_template`、公开标签 `field_inference`；来源顺序由 registry rank 决定，不由代码调用次序暗改。
- 真实 RED：默认 adapter 集合不存在 common-dish source；加入版本化模板和默认配置后转 GREEN。
- 定向 smoke：offline core food/common dish 1/1 PASS；`tsc --noEmit` PASS；`git diff --check` PASS。
- 延期到模块末的测试：unknown combo 全链、插件/full/fault/tamper/trace。
- 已知风险/假设：模板当前只覆盖两个明确边界菜品，不尝试从任意菜名拆成食材；模板数值是版本化估算而非精确食谱。
- 后续修复索引：接下来实现 nutrition supplement append-only 路径；Task 5 atomic effect 仍保留为关闭前必修项。
- 批次提交：`feat: add common dish nutrition templates`。

### Batch C5a / 2026-08-14

- 目标：先冻结营养补充的窄 `correct_record` 解析入口，避免在事务实现时同时猜测自然语言与业务状态机。
- 绑定 REQ：`REQ-NUTR-006`。
- 绑定 CASE：`CASE-NUTR-004/005` 的补充入口前置语法；追加事实与网络恢复语义尚未在本小批完成。
- 起始 HEAD：`8a8606f`。
- 改动文件：新增 `nutrition-supplement.test.ts`；修改 parser candidate/type、core runtime 未实现边界及 mapping fail-closed 分支。
- 行为变化：精确文本 `补充营养记录 <event-id>` 解析为当前用户的 `nutrition_supplement` candidate；record ID 只接受 `event-` 加 32 位小写十六进制。事务链尚未接入时，应用入口在打开数据库前稳定返回 `ACTION_NOT_IMPLEMENTED`，不会误走库存位置纠正。
- 接口/Schema/authority 决策：所有 Core candidate 保持统一的 `operation_id/parser_version` 字段；计划示例缺少这两个现有必需字段，本实现按既有候选兼容约束补齐。目标日期/项目保持 `null`，禁止由文本猜测。
- 真实 RED：旧 parser 将精确补充请求误判为 `record_meal/non_self_subject`；新候选分支后转 GREEN。
- 定向 smoke：`nutrition-supplement.test.ts` 1/1 PASS；`tsc --noEmit` PASS。
- 延期到模块末的测试：缺失/歧义目标、真实 DB 目标解析、FactCommit/effect/finalize、same-key replay、网络恢复、tamper/fault/concurrency 与 full。
- 已知风险/假设：这只是 Task 6 的解析子批，不代表 supplementation 已可用；下一批必须先做目标 readback 与 append-only fact，不允许直接覆盖旧 Snapshot。
- 后续修复索引：C5b 从一条真实 unknown meal + exact record ID RED 开始，先固定事件/修订身份，再接 effect。
- 批次提交：`feat: parse nutrition supplement targets`。

## 使用规则

- 每个开发批次追加一段，不覆盖旧记录。
- 记录“为什么改、改了什么、哪些测试延期到模块末”，不粘贴重复的完整控制台输出。
- 不记录 secret、credential ref、私有绝对路径、用户原始饮食内容或真实网络响应。
- 小改动只跑定向 smoke；模块完成后统一跑验收、full source、trace 和复审。

## 批次记录模板

### Batch <A|B|C> / <日期时间>

- 目标：
- 绑定 REQ：
- 绑定 CASE：
- 起始 HEAD：
- 改动文件：
- 行为变化：
- 接口/Schema/authority 决策：
- 兼容边界：
- 真实 RED：
- 定向 smoke：
- 延期到模块末的测试：
- 已知风险/假设：
- 后续修复索引：
- 批次提交：

## 模块最终 Gate

- 15 CASE：待运行
- source/Doctor：待运行
- Profile/Snapshot：待运行
- supplementation：待运行
- fault/replay/tamper/concurrency：待运行
- public outcome：待运行
- `tsc --noEmit`：待运行
- full source：待运行
- trace normal/self：待运行
- 双独立复审：待运行
- formal build：本任务禁止；留给最终发布阶段唯一一次构建
