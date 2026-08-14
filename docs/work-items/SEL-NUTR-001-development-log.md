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
