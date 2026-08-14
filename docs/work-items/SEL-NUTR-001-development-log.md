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
