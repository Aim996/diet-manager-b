# SEL-CORE-001 执行简报

## 身份与范围

- task_id: `SEL-CORE-001`
- product_scope: `PRODUCT-0.1` 核心命令切片；不代表完整 PRODUCT-0.1
- milestone: `M5`
- task_kind: `core parser + meal/water application slice`
- route: `B only`
- objective: 确定性处理当前用户本人的餐食、白水、时间、完成/否定/计划与有界上下文，并通过现有 B 事务权威保存真实终态
- dependencies: `X-GATE-002`（`EV-20260813-036`，`bind_b_ready`）
- contract: `diet-manager/contract-v2` / `2` / `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- owner: `Codex /root`
- reviewer: 两名独立复核者；一名负责规格/案例/公开行为，一名负责事务/安全/source-dist/OpenClaw质量
- status: `in_progress`
- blocker: `none`
- next_action: 按 `docs/superpowers/plans/2026-08-13-sel-core-001.md` 的 Task 2—10 逐项 TDD

## 权威 ID

requirement_ids:

- `REQ-SCOPE-001`
- `REQ-SCOPE-002`
- `REQ-CORE-002`
- `REQ-TIME-001`
- `REQ-TIME-003`
- `REQ-CONTEXT-001`
- `REQ-CONTEXT-002`
- `REQ-MEAL-001`
- `REQ-WATER-001`

case_ids（顺序与计划行完全一致）:

1. `CASE-MEAL-001`
2. `CASE-MEAL-021`
3. `CASE-MEAL-017`
4. `CASE-MEAL-009`
5. `CASE-WATER-001`
6. `CASE-SCOPE-001`
7. `CASE-MEAL-002`
8. `CASE-PURCHASE-004`
9. `CASE-RECEIPT-002`
10. `CASE-MEAL-010`
11. `CASE-MEAL-011`
12. `CASE-MEAL-012`
13. `CASE-MEAL-013`
14. `CASE-MEAL-014`
15. `CASE-MEAL-015`
16. `CASE-MEAL-016`
17. `CASE-MEAL-018`
18. `CASE-MEAL-019`
19. `CASE-MEAL-020`
20. `CASE-WATER-003`
21. `CASE-WATER-004`

`shared/acceptance-cases/cases.json` 是唯一业务 Oracle；实现测试必须读取它，禁止复制出第二套 SEL 期望目录。`full_case_set: none`，本任务只负责上列 21 案的声明路径，不外推 124 案发布集合。

## 断言级责任

```yaml
case_assertion_paths:
  CASE-MEAL-001:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
  CASE-MEAL-021:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
  CASE-MEAL-017:
    - /oracle/command
    - /oracle/parsing/subject
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
  CASE-MEAL-009:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/excluded_items
    - /oracle/fact_commit/meal_event
  CASE-WATER-001:
    - /oracle/command
    - /oracle/fact_commit/water_event
  CASE-SCOPE-001:
    - /oracle/command
    - /oracle/parsing
    - /oracle/factual_query
    - /oracle/business_effects
  CASE-MEAL-002:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/occurred_time
    - /oracle/parsing/purchase_evidence
    - /oracle/fact_commit/meal_event
  CASE-PURCHASE-004:
    - /oracle/parsing/time_anchors
  CASE-RECEIPT-002:
    - /oracle/receipt/explicit_fields_unlabeled
    - /oracle/receipt/inferred_fields_labeled
  CASE-MEAL-010:
    - /oracle/command
    - /oracle/parsing/completion_evidence
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
  CASE-MEAL-011:
    - /oracle/command
    - /oracle/parsing
    - /oracle/business_effects
  CASE-MEAL-012:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/occurred_time
    - /oracle/fact_commit/meal_event
  CASE-MEAL-013:
    - /oracle/command
    - /oracle/parsing
    - /oracle/business_effects
  CASE-MEAL-014:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/occurred_time
    - /oracle/fact_commit/meal_event
  CASE-MEAL-015:
    - /oracle/command
    - /oracle/parsing
    - /oracle/business_effects
  CASE-MEAL-016:
    - /oracle/command
    - /oracle/parsing
    - /oracle/business_effects
  CASE-MEAL-018:
    - /oracle/command
    - /oracle/parsing/subject
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
  CASE-MEAL-019:
    - /oracle/command
    - /oracle/parsing/subject
    - /oracle/parsing/items
    - /oracle/parsing/group_amount_evidence
    - /oracle/fact_commit/meal_event
  CASE-MEAL-020:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/context
    - /oracle/fact_commit/meal_event
  CASE-WATER-003:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/liquid_classification
    - /oracle/fact_commit/meal_event
  CASE-WATER-004:
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/parsing/liquid_classification
    - /oracle/fact_commit/meal_event
setup_fixture_bindings:
  CASE-MEAL-001:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-021:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-017:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-009:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-WATER-001:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-SCOPE-001:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: null
    query_view_fixture: query-current-day-meals-v1
  CASE-MEAL-002:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-PURCHASE-004:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: null
    query_view_fixture: null
    domain_scenario_fixture: core-purchase-no-expiration-v1
  CASE-RECEIPT-002:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-010:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-011:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: null
    query_view_fixture: null
  CASE-MEAL-012:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-013:
    environment_fixture: env-zh-cn-20260811-0100
    goals_fixture: null
    query_view_fixture: null
  CASE-MEAL-014:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-015:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: null
    query_view_fixture: null
  CASE-MEAL-016:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: null
    query_view_fixture: null
  CASE-MEAL-018:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-019:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-MEAL-020:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-WATER-003:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
  CASE-WATER-004:
    environment_fixture: env-zh-cn-20260811
    goals_fixture: goals-six-metric-v1
    query_view_fixture: null
full_case_set: none
```

每个案例的 `forbidden[]` 同时属于验收责任；它们机械拒绝反向危险行为，不得只验证正向字段。

## 交付物

- 权威案例与夹具：`shared/acceptance-cases/cases.json`、`fixtures/core-v1.json`、`harness-manifest.json`
- 目录门：`shared/tests/validate-sel-core-cases.mjs`
- 解析层：`version-b-lite-plugin/src/parser/**`
- 领域兼容扩展与 WaterEvent：`version-b-lite-plugin/src/domain/**`、`src/repository/**`
- 应用层：`version-b-lite-plugin/src/application/**`
- OpenClaw 工具/Skill：`version-b-lite-plugin/src/index.ts`、`openclaw.plugin.json`、`skills/diet-manager-b/SKILL.md`
- 测试：`version-b-lite-plugin/tests/acceptance/core*.test.ts` 及明确列入计划的兼容测试
- 正式构建产物：Task 9 唯一一次 TypeScript emit 生成的 `version-b-lite-plugin/dist/**`
- 报告与证据：`docs/work-items/SEL-CORE-001-report.md`、`docs/evidence/EV-20260813-037-sel-core-001.md`

## 六组 focused 命令

以下 PowerShell 变量固定为：

```powershell
$nodeExe = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
$pluginRoot = 'E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\version-b-lite-plugin'
```

1. Catalog：`& $nodeExe shared/tests/validate-sel-core-cases.mjs; & $nodeExe shared/tests/validate-sel-core-cases.mjs --self-test`
2. 输入权威：在 `$pluginRoot` 运行 `& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-input.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
3. 完成状态/本人：`& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-completion-subject.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
4. 时间/上下文：`& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-time-context.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
5. 组合解析：`& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-parser.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
6. 事实/应用/OpenClaw：`& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-meal-fact.test.ts tests/acceptance/core-water.test.ts tests/acceptance/core-application.test.ts tests/acceptance/openclaw-core.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism`

## 全量命令

在仓库根：

```powershell
& $nodeExe shared/tests/validate-sel-core-cases.mjs --self-test
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-core-acceptance-cases.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-domain-acceptance-cases.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-ops-security-acceptance-cases.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-golden-receipts.ps1
& $nodeExe --test --experimental-strip-types shared/acceptance-cases/tests/harness.test.ts
& $nodeExe shared/tests/validate-traceability.mjs --self-test
& $nodeExe shared/tests/validate-x-gate-002.mjs --self-test
```

在 `$pluginRoot`：

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe ../../shared/tests/validate-x-gate-002.mjs
```

正式 emit 只允许在 Task 9 focused/noEmit 已全绿后执行一次；复核修订只跑 noEmit 与 build-check，不重复构建。

## 数据根与执行约束

- official_data_roots: 每个部署由 OpenClaw 插件配置解析为一个后端拥有的、现有绝对 `official_data_root`；模型参数不能提供，实际绝对值只能在该部署的执行证据中冻结，不能在仓库内伪造。本地 Task 1—10 测试不得打开用户正式根，正式根前后 manifest 必须零差异。
- isolated_test_roots: 当前机器解析基址为 `C:\Users\10481\AppData\Local\Temp\diet-manager-b\SEL-CORE-001\<run-guid>`，每次使用新的绝对直接子目录；数据库固定叶为 `diet-manager-b.sqlite3`，测试结束清除 DB/WAL/SHM/secret/临时状态。
- 当前工作树绝对路径：`E:\codx\skill\.worktrees\diet-manager-b-b-slice-001`
- 不新增 schema migration；WaterEvent 使用现有 `event_records.payload_json`、outbox 和 finalizer。
- Task 1—9 不访问远程 OpenClaw，也不读取、输出、持久化任何 gateway 凭据。

## 验收 Oracle

1. 21 个 ID 与计划行顺序完全一致；删除、添加、重排、改 ID、删必要 Oracle 字段或引用未知 fixture 均稳定非零。
2. 普通输入权威在执行 getter、iterator 或动态代码前拒绝非普通值；解析层只声明有界中文规则，不冒充通用 NLP。
3. 只有当前用户已经发生的事实可成为 candidate；他人、未来计划、最终未发生、健康建议与日期歧义在打开写事务前结束，所有业务表零变化。
4. 时间证据保留原文、`[start,end)`、精度、Asia/Shanghai、依据、锚点和版本；unknown 永不转 0。
5. 只有明确白水生成 WaterEvent；牛奶、汤、豆浆、咖啡和茶仍为 meal，白水贡献为 0，液体不双写。
6. 餐食/白水只通过现有 preview → FactCommit → EffectBundle → EnvelopeFinalize 权威；失败可有脱敏技术日志，但饮食记录不得出现半条数据。
7. 只有已提交且已冻结终态可返回 `committed=true` 与 `record_id`；同 token 相同输入返回相同冻结结果，不同输入零写冲突。
8. OpenClaw `diet_manager` 从诚实的 foundation 状态切换为上述真实核心能力；未实现 action 仍明确失败，不伪成功。

required_evidence_types: `E-CASE`, `E-STOR`

actual_evidence_ids: `none`（任务完成后只能填写绑定同一候选的 `EV-20260813-037`）

## 风险、决定与变更

- risk_ids: `RISK-005`, `RISK-008`, `RISK-010`, `RISK-011`, `RISK-012`, `RISK-016`, `RISK-017`
- decision_ids: `DEC-003`, `DEC-004`, `DEC-005`, `DEC-015`, `DEC-018`, `DEC-023`, `DEC-024`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260810-001`, `CHG-20260811-001`, `CHG-20260811-002`, `CHG-20260813-001`, `CHG-20260813-002`

## 非目标与重开条件

本任务不实现库存匹配/扣减完整闭环、营养来源/Doctor、完整六项进度、Issue 快捷 UX、安装、迁移、备份、发布或远程 OpenClaw 验收；这些保持后续唯一任务顺序。

reopen_condition: 任一需求/案例/forbidden/fixture、本人范围、完成或否定规则、OccurredTime、上下文有效期、液体分类、WaterEvent 载荷、事务阶段、幂等身份、公开工具结果、contract hash、Node/OpenClaw API 或正式/隔离根边界变化时重开；任一 P0/P1 独立复核问题未关闭时不得完成。
