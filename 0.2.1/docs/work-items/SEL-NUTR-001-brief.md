# SEL-NUTR-001 执行简报

## 身份与范围

- task_id: `SEL-NUTR-001`
- product_scope: `PRODUCT-0.1` 营养来源、Profile/Snapshot、unknown、采用量与来源可见性；0.4 只增强来源可靠性
- milestone: `M5`
- task_kind: `nutrition`
- route: `B only`
- objective: 完成 0.3 八层营养来源、可追溯 Profile/Snapshot、数量与覆盖语义、缓存/离线降级、真实 Probe/Doctor 和公开营养结果
- dependencies: `SEL-CORE-001`、`SEL-PANTRY-001`、`SH-CONTRACT-003`、`SH-MODEL-002`（均已完成）
- owner: `Codex /root`
- reviewer: 两名独立来源与安全复核者
- status: `in_progress`
- blocker: `none`
- next_action: 按批次 A—C 连续开发并维护开发日志，模块完成后统一测试

```json trace-active-task
{
  "task_id": "SEL-NUTR-001",
  "product_scope": "PRODUCT-0.1 营养来源、Profile/Snapshot、unknown、采用量与来源可见性；0.4 只增强来源可靠性",
  "milestone": "M5",
  "task_kind": "nutrition",
  "route": "B",
  "objective": "来源适配器/主备后端/Tier、真实Probe/Doctor、安全配置、缓存、Profile/Snapshot、估算和unknown",
  "requirement_ids": ["REQ-NUTR-001", "REQ-NUTR-002", "REQ-NUTR-003", "REQ-NUTR-004", "REQ-NUTR-005", "REQ-NUTR-006", "REQ-SOURCE-001", "REQ-MEAL-003"],
  "case_ids": ["CASE-NUTR-001", "CASE-NUTR-002", "CASE-NUTR-003", "CASE-NUTR-004", "CASE-NUTR-005", "CASE-NUTR-006", "CASE-NUTR-008", "CASE-NUTR-009", "CASE-MEAL-003", "CASE-MEAL-006", "CASE-MEAL-007", "CASE-MEAL-008", "CASE-SOURCE-001", "CASE-SOURCE-002", "CASE-SOURCE-003"],
  "dependency_task_ids": ["SEL-CORE-001", "SEL-PANTRY-001", "SH-CONTRACT-003", "SH-MODEL-002"],
  "dependency_evidence_ids": [],
  "deliverables": ["selected nutrition service+source capability contract+doctor"],
  "verification_commands": [
    "Set-Location -LiteralPath $projectRoot",
    "& $nodeExe shared/tests/validate-sel-nutr-cases.mjs",
    "& $nodeExe shared/tests/validate-sel-nutr-cases.mjs --self-test",
    "& $nodeExe shared/tests/validate-sel-pantry-roots.mjs --official-manifest-root $officialVerificationRoot --isolated-root-base $isolatedTestRootBase",
    "Set-Location -LiteralPath $pluginRoot",
    "& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/nutrition-contract.test.ts tests/acceptance/nutrition-source.test.ts tests/acceptance/nutrition-doctor.test.ts tests/acceptance/nutrition-resolution.test.ts tests/acceptance/nutrition-application.test.ts tests/acceptance/nutrition-supplement.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism",
    "& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-application.test.ts tests/acceptance/openclaw-core.test.ts tests/domain-rules.test.ts tests/server-authority.test.ts tests/repository.test.ts tests/fault-matrix.test.ts tests/vertical-slice.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism",
    "& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit"
  ],
  "acceptance_oracle_case_ids": ["CASE-NUTR-001", "CASE-NUTR-002", "CASE-NUTR-003", "CASE-NUTR-004", "CASE-NUTR-005", "CASE-NUTR-006", "CASE-NUTR-008", "CASE-NUTR-009", "CASE-MEAL-003", "CASE-MEAL-006", "CASE-MEAL-007", "CASE-MEAL-008", "CASE-SOURCE-001", "CASE-SOURCE-002", "CASE-SOURCE-003"],
  "forbidden_oracle_enforced": true,
  "required_evidence_types": ["E-CASE", "E-STOR"],
  "actual_evidence_ids": [],
  "risk_ids": ["RISK-005", "RISK-006", "RISK-013", "RISK-019"],
  "decision_ids": ["DEC-005", "DEC-006", "DEC-007", "DEC-009", "DEC-023", "DEC-027", "DEC-029"],
  "change_ids": ["CHG-20260809-001", "CHG-20260813-001", "CHG-20260813-002"],
  "project_root": "E:\\codx\\skill\\饮食管家",
  "plugin_root": "E:\\codx\\skill\\饮食管家\\version-b-lite-plugin",
  "node_exe": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe",
  "official_data_roots": ["E:\\codx\\skill\\饮食管家\\.tmp\\official-manifest-sentinel\\SEL-NUTR-001"],
  "isolated_test_roots": ["E:\\codx\\skill\\饮食管家\\.tmp\\isolated-test-roots\\SEL-NUTR-001"],
  "owner": "Codex /root",
  "reviewer": "两名独立来源与安全复核者",
  "status": "进行中",
  "blocker": "none",
  "next_action": "按批次A—C连续开发并维护开发日志",
  "reopen_condition": "来源/后端/Tier、Schema、公开结果或事务身份变化重开"
}
```

## 权威 ID 与断言路径

```yaml
case_assertion_paths:
  CASE-NUTR-001:
    - /oracle/effect_bundle/nutrition_profile
    - /oracle/effect_bundle/nutrition_snapshot
  CASE-NUTR-002:
    - /oracle/source_resolution/authority
    - /oracle/effect_bundle/nutrition_snapshot
  CASE-NUTR-003:
    - /oracle/template/components
    - /oracle/business_effects/no_double_count
  CASE-NUTR-004:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/coverage
  CASE-NUTR-005:
    - /oracle/nutrition_profile/version_history
    - /oracle/nutrition_snapshot/profile_version
  CASE-NUTR-006:
    - /oracle/nutrition_snapshot/nutrient_values
    - /oracle/nutrition_snapshot/coverage
  CASE-NUTR-008:
    - /oracle/quantity/adopted_amount
    - /oracle/receipt/estimated_fields_labeled
  CASE-NUTR-009:
    - /oracle/quantity/explicit_amount
    - /oracle/receipt/source_label
  CASE-MEAL-003:
    - /oracle/fact_commit/meal_event
    - /oracle/nutrition/adopted_upper_bound
    - /oracle/inventory/amount_isolation
  CASE-MEAL-006:
    - /oracle/quantity/explicit_grams
    - /oracle/nutrition/source_trace
  CASE-MEAL-007:
    - /oracle/template/components
    - /oracle/business_effects/no_double_count
  CASE-MEAL-008:
    - /oracle/fact_commit/meal_event
    - /oracle/clarification/key_components
    - /oracle/nutrition/unknown
  CASE-SOURCE-001:
    - /oracle/source_registry/tier_traversal
    - /oracle/source_registry/capability
  CASE-SOURCE-002:
    - /oracle/source_probe/real_health
    - /oracle/doctor/sanitized_status
  CASE-SOURCE-003:
    - /oracle/config/secret_isolation
    - /oracle/source_resolution/offline_degradation
full_case_set: none
```

所有 selected `forbidden[]` token 都是验收责任；目录是唯一业务 Oracle，测试不维护第二份结果目录。

## 完整验收 Oracle

| Case | Exact source/setup | Required result | Forbidden result |
|---|---|---|---|
| `CASE-NUTR-001` | 精确包装牛奶标签 | 标签优先，保存原值、解析、版本、适用商品；缺失纤维保持 unknown | 低层覆盖标签；未知补零 |
| `CASE-NUTR-002` | 鸡蛋、米饭、苹果无标签 | 自动使用权威公共库或其合规缓存，不要求用户上传 | 模型记忆伪装数据库；无故询问 |
| `CASE-NUTR-003` | 普通蛋炒饭 | 使用透明版本化通用模板并列出组件 | 整菜与组件重复计入 |
| `CASE-NUTR-004` | 奇亚籽牛油果青瓜液体沙拉 | 先保存事实；组成和营养保持 unknown 或请求关键配方 | 套用普通果蔬汁数据 |
| `CASE-NUTR-005` | 同商品标签 v1 后出现 v2 | 新记录使用 v2，历史 Snapshot 永久保留 v1 | 重写历史 Profile/Snapshot |
| `CASE-NUTR-006` | 来源只有部分营养字段 | 已知字段保存，未知为 null，coverage=partial | 未知补零；宣称完整 |
| `CASE-NUTR-008` | 橙子 1 个 | 保存自然单位、可食克重范围和采用值；仅推定字段标 estimated | 把全部字段标估算或隐藏克重 |
| `CASE-NUTR-009` | 明确 200g 米饭并命中公共库 | 数量保持 explicit；营养详情标参考数据库 | 把明确克重标估算 |
| `CASE-MEAL-003` | 午饭半碗米饭，fixture 给出 100–150g | 饮食提交；营养采用 150g 合理上界并公开范围；库存不借用该克重 | 发明精确量；营养量用于库存 |
| `CASE-MEAL-006` | 米饭 200g、鸡胸 150g | 两项明确克重不标估算，来源可追溯 | 改写明确数量或隐藏来源 |
| `CASE-MEAL-007` | 一碗牛肉面 | 使用透明版本化通用模板和逐组件证据 | 重复贡献或隐藏模板版本 |
| `CASE-MEAL-008` | 一个肉夹馍套餐 | 保存已知事实，组成/营养 unknown，并只问关键组成 | 套普通套餐估值或丢失事实 |
| `CASE-SOURCE-001` | 注册表含本地、公共库、可信精确商品来源 | 严格按 rank/tier 和层内 local→cache→network 遍历 | 低层缓存抢占；开放网页搜索 |
| `CASE-SOURCE-002` | enabled/disabled/misconfigured/unavailable 来源 | Probe 真实执行；Doctor 返回脱敏、稳定、可行动状态 | 假健康；泄漏 secret 或私有 endpoint |
| `CASE-SOURCE-003` | 无凭据、超时、503、缓存可用/过期组合 | 配置 exact；最小披露；缓存/离线稳定降级，事实仍可提交 | 模型传 secret；无限等待；技术失败回滚事实 |

## 交付物

- `shared/contracts/source-capability-contract.md`、共享 Nutrition Profile/Snapshot 兼容 Schema 更新和目录门。
- B 路线来源适配器、注册表客户端、缓存、真实 Probe/Doctor 与安全配置。
- 持久 single-flight 解析、v6 preview authority、异步 core/OpenClaw 入口。
- Profile/Snapshot、公开 `nutrition_items`、追加式 nutrition supplementation 和故障恢复。
- 设计、实施计划、开发日志、最终报告和证据；本任务不 emit/build。

## 精确验证命令

```powershell
$nodeExe = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
$projectRoot = 'E:\codx\skill\饮食管家'
$pluginRoot = 'E:\codx\skill\饮食管家\version-b-lite-plugin'
$officialVerificationRoot = 'E:\codx\skill\饮食管家\.tmp\official-manifest-sentinel\SEL-NUTR-001'
$isolatedTestRootBase = 'E:\codx\skill\饮食管家\.tmp\isolated-test-roots\SEL-NUTR-001'
Set-Location -LiteralPath $projectRoot
& $nodeExe shared/tests/validate-sel-nutr-cases.mjs
& $nodeExe shared/tests/validate-sel-nutr-cases.mjs --self-test
& $nodeExe shared/tests/validate-sel-pantry-roots.mjs --official-manifest-root $officialVerificationRoot --isolated-root-base $isolatedTestRootBase
Set-Location -LiteralPath $pluginRoot
& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/nutrition-contract.test.ts tests/acceptance/nutrition-source.test.ts tests/acceptance/nutrition-doctor.test.ts tests/acceptance/nutrition-resolution.test.ts tests/acceptance/nutrition-application.test.ts tests/acceptance/nutrition-supplement.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-application.test.ts tests/acceptance/openclaw-core.test.ts tests/domain-rules.test.ts tests/server-authority.test.ts tests/repository.test.ts tests/fault-matrix.test.ts tests/vertical-slice.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

## 数据根、证据与边界

- official_data_roots: 只使用任务自有空 sentinel `E:\codx\skill\饮食管家\.tmp\official-manifest-sentinel\SEL-NUTR-001` 做前后 manifest；不读取部署正式根。
- isolated_test_roots: `E:\codx\skill\饮食管家\.tmp\isolated-test-roots\SEL-NUTR-001`；每族创建唯一普通子目录并精确清理。
- required_evidence_types: `E-CASE`, `E-STOR`; actual_evidence_ids: `none`。
- risk_ids: `RISK-005`, `RISK-006`, `RISK-013`, `RISK-019`。
- decision_ids: `DEC-005`, `DEC-006`, `DEC-007`, `DEC-009`, `DEC-023`, `DEC-027`, `DEC-029`。
- change_ids: `CHG-20260809-001`, `CHG-20260813-001`, `CHG-20260813-002`。
- 不访问真实网络或凭据；fixture transport 覆盖网络行为。Research、Watchlist、个人模板学习、安装、发布和正式构建不在本任务。

reopen_condition: 来源/后端/Tier、Schema、公开结果或事务身份变化重开。
