# MIXED-LIQUID-001 根因调查与 TDD RED

## 状态

- 调查结论：根因已确认。
- TDD：已添加一个最小回归测试并观察到方向正确的 RED。
- 生产修复：未实施；本任务未修改任何生产文件、未构建、未提交。
- 外部边界：未连接真实 OpenClaw 实例，未访问正式数据根、配置或密钥。所有只读探针均针对仓库代码/现有 `dist`，测试仅使用 Vitest parser 路径。

## 真实症状

OpenClaw 实例 07 的公开调用：

```text
action=record_meal
source_text=喝了豆浆和白水。
数量=未提供
```

业务测试记录的实际结果为 `committed_with_issues`，只生成 `soy_milk` meal event；白水没有 WaterEvent，也没有 `needs_clarification`。现有现场记录见 `docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md` 的 MIXED-LIQUID-001。

## 设计期望

存在两层设计期望，当前修复应先满足较小、已发布的保守契约：

1. 产品长期期望：`总功能开发计划0.4.md:568-584` 要求 PRODUCT-0.1 支持“白水与营养饮品在同一句话中分别处理”，有数量的示例应形成 meal items 加独立 `diet_water`；`总功能开发计划0.4.md:2538-2554` 又明确豆浆归 meal、白水归 water，且不得重复计水。
2. 当前 B Skill 的可执行期望：`version-b-lite-plugin/skills/diet-manager-b/SKILL.md:22` 指示 Agent 对同句营养饮品+白水保留整句、只调用一次 `record_meal`；在本阶段后端不能自动拆分时，应返回 `needs_clarification`，Agent 再如实说明未记录并请用户拆分。Agent 不得自行改写成两次调用。

因此，对于本缺陷的无数量输入，当前最小安全行为是：

```json
{
  "action": "record_meal",
  "status": "needs_clarification",
  "committed": false,
  "reason_code": "unsupported_command"
}
```

且不得产生 candidate/FactCommit。长期的单请求 meal+water 多操作自动提交可以另立增强任务，不能用只提交豆浆代替。

`总功能开发计划0.4.md:715-719` 也确认：`committed_with_issues` 表示事实已经提交、业务待补充或附加效果待重试；`needs_clarification` 才表示最小安全事实无法确定且本次不写。当前返回的 `committed_with_issues` 只是豆浆事实的终态，不能表达白水被遗漏。

## 复现与组件边界证据

### 1. Parser 实际输出

使用仓库已存在的 Node 24.15.0 对现有 `dist` 做只读调用，输入完整普通 authority（含空 `prior_context`）。实际输出摘要：

```text
PARSED.disposition = candidate
PARSED.command.action = record_meal
PARSED.command.items = [
  { kind: nutritious_drink, normalized_name: soy_milk,
    quantity: null, unit: null, estimated: null }
]
PARSED.command.liquid_classification = {
  plain_water: false,
  plain_water_contribution_ml: 0
}
```

同一探针对照：

```text
喝了250ml豆浆和300ml白水。
  => needs_clarification / record_meal / unsupported_command

喝了豆浆和白水。
  => candidate / record_meal / soy_milk only
```

数量的存在与否是触发差异的单一变量。

### 2. Parser → application mapping

对上述实际 candidate 调用 `mapCoreCandidateToEnvelope`，输出只有一个 operation：

```text
operations.length = 1
operations[0].kind = record_meal
operations[0].items[0].normalized_name = soy_milk
operations[0].items[0].amount.evidence = unknown
```

不存在 `record_water` operation，也不存在可供 application 层恢复白水语义的结构化字段。虽然 `source_text` 仍完整保留，但 mapping 不是第二个自然语言解析器。

### 3. Application → public outcome → Skill

数据流如下：

```text
OpenClaw tool execute
  -> handleCoreRequestAsync
  -> parseCoreCommand
  -> candidate(record_meal, soy_milk only)
  -> mapCoreCandidateToEnvelope
  -> one record_meal DomainOperation
  -> FactCommit / EffectBundle / EnvelopeFinalize
  -> committed_with_issues(record_id = soy_milk meal event)
  -> assertDietManagerOutcome
  -> Skill 按 committed=true 告知“事实已记录”且不得重复提交
```

关键代码边界：

- `src/openclaw/plugin.ts:328-363`：公开 tool 克隆请求并转交 `handleCoreRequestAsync`，不重解析遗漏项。
- `src/application/core-runtime.ts:1636-1679`：异步 meal 路径接受 parser candidate、解析营养并执行 candidate。
- `src/application/mapping.ts:120-172,391-413`：meal/water 是互斥的单 candidate 分支；非 purchase/correction 只创建一个 `mealOrWaterOperation`。
- `src/application/outcome.ts:90-119`：只把领域终态映射为 committed outcome，不检查原话是否仍含未映射实体。
- `skills/diet-manager-b/SKILL.md:42`：`committed_with_issues` 后必须告知事实已记录且不得重复提交，所以遗漏一旦越过 parser 就无法由 Agent 安全补写。

豆浆数量为 unknown 时，mapping 将库存扣减量保留为 null；既有领域规则会产生 `skipped_amount_unknown` / `inventory_amount_unknown`，这足以使豆浆 fact 成为 `committed_with_issues`。该状态解释了现场结果，但不是白水丢失的根因。

## 根因

直接根因位于 `version-b-lite-plugin/src/parser/liquid.ts:18`：

```ts
const DIRECT_OR_COORDINATED_WATER =
  /(?:^|和|与|、)\s*([0-9]+)\s*ml\s*(白水|水).../gu;
```

该扫描器把数字和 `ml` 设为 PlainWaterMatch 的必要组成；`PlainWaterMatch.quantity_ml` 也只能是已知正整数。因此“白水”虽然是明确类别，但没有数量时完全不会进入 `resolveWaterFrames(...).self_matches`，而不是以“已识别、数量未知/需澄清”的形式保留下来。

随后：

1. `meal.ts:26-39` 的词典仍识别“豆浆”为 `nutritious_drink`，数量按 unknown 保存。
2. `parse-command.ts:320-324` 只用 meal item 或成功的 water match 判断摄入 occurrence。
3. `parse-command.ts:453-470` 的混合 meal+water fail-closed 分支只有 `waters[0]` 非空才可达；本输入中它不可达。
4. `parse-command.ts:502`（最终 `mealCandidate`）据此返回豆浆单项 candidate。
5. mapping 与公开 outcome 忠实处理这个已经截断的 candidate，后续层没有足够结构化证据发现白水遗漏。

历史检查显示，强制数量的 water regex 与混合 fail-closed 分支由不同变更引入，但当前组合从未覆盖“明确白水类别、数量缺失”的混合输入；这不是 application 或 Skill 把已识别 water 删除，而是 parser 在应用映射之前没有形成 water evidence。

一句话根因：**白水扫描器把“可识别为白水”和“具有可提交的 ml 数量”错误地合并为同一条件，导致无数量白水在混合语句中于 parser 边界消失，豆浆 candidate 随后被正常提交。**

## TDD RED

### 选择的最小现有测试文件

修改：`version-b-lite-plugin/tests/acceptance/core-parser.test.ts`

新增唯一测试：

```text
fails closed instead of dropping unquantified plain water from a mixed drink
```

选择理由：该文件已在相邻位置覆盖“有数量白水+牛奶必须 fail closed”和多次水记录边界；新测试直接调用真实 `parseCoreCommand`，无 mock、无数据库、无外部服务，最小化单一变量并准确锁住根因。生产变更若让 owned unquantified water evidence 到达现有混合保护分支，该测试即可由 RED 转 GREEN。

### RED 命令

工作目录：`version-b-lite-plugin`

```powershell
$nodeExe='C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
& $nodeExe node_modules\vitest\vitest.mjs run tests\acceptance\core-parser.test.ts `
  -t 'fails closed instead of dropping unquantified plain water from a mixed drink' `
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

### RED 输出摘要

```text
Test Files  1 failed (1)
Tests       1 failed | 193 skipped (194)
Exit code   1

Expected:
  disposition = needs_clarification
  action = record_meal
  reason_code = unsupported_command

Received:
  disposition = candidate
```

这是预期的行为失败，不是编译、导入、fixture 或环境错误。

曾尝试把同一断言放在公开 OpenClaw adapter 测试边界，但本机现有的已提交 meal 基线测试也会独立返回 `CORE_RUNTIME_SECRET_INVALID`，无法证明此缺陷的 RED。该试验改动已完全撤回，未保留在工作树；最终只保留 parser 回归测试。

## 候选最小修复范围（未实施）

### 当前 B Skill 的最小安全修复

预计只需生产源文件：

1. `src/parser/liquid.ts`
   - 在 predicate-frame/subject ownership 规则内识别直接或协调出现的无数量 `白水|纯净水|矿泉水|水`。
   - 将“类别已识别但数量未知”与“具有合法 `quantity_ml`、可生成 WaterEvent”分开表示，例如在 `WaterFrameScan` 增加受所有权约束的 unresolved/amount-missing water evidence。
   - 必须继续排除 incidental mention、非本人 subject、`水牛奶` 等既有边界，不能退化为对整句做无上下文 substring 检查。
2. `src/parser/parse-command.ts`
   - 在生成 meal candidate 前，若 retained meal 与本人无数量白水 evidence 同时存在，则返回现有 `needs_clarification / record_meal / unsupported_command`，且不带 command。
   - 单独的本人无数量白水可按产品决策返回 `amount_ambiguous`；不得静默 `ignored` 或伪造容量。

这条路径不需要改 `application/mapping.ts`、`application/outcome.ts` 或 Skill：它们已经能正确传播 parser 的 non-writing outcome。常规交付时需要由正式构建再生 `dist`，但本 RED 任务明确未运行 build、未编辑 dist。

### 非最小的长期自动拆分方案

若选择产品长期目标“一个请求直接提交 meal + water”，范围会明显扩大：parser candidate/types 需表达有序混合子操作；未知容量 WaterEvent 的权威模型需先定义；mapping 要生成多个 operation；领域校验、FactCommit、record_ids、receipt/progress 和幂等重放均需新增案例。它不应伪装成本缺陷的两文件小修。

## 工作树约束核对

- 本任务新增：`docs/work-items/MIXED-LIQUID-001-root-cause.md`
- 本任务修改：`version-b-lite-plugin/tests/acceptance/core-parser.test.ts`
- 生产文件：见下方 GREEN 变更
- commit：无
- full/build/OpenClaw 实例/正式数据根/密钥：均未运行或访问
- 工作树中原有未跟踪文件 `docs/work-items/PRODUCT-v1.0-openclaw-business-test-20260814.md` 属于既存现场记录，本任务只读引用、未修改。

## TDD GREEN

### 生产变更

1. `version-b-lite-plugin/src/parser/liquid.ts`
   - 保留 predicate-frame 与主体归属约束，将直接或并列的无数量白水记录为 `self_unquantified_count`，但不把它伪造成可提交的 `PlainWaterMatch`。
   - 旁观/附带水仍由既有 `ADJUNCT_START` 在 direct object span 外排除；非本人水也不计入本人数。
2. `version-b-lite-plugin/src/parser/parse-command.ts`
   - 仅当已有本人 meal 项且同时有本人无数量白水时，返回既有的 `needs_clarification / record_meal / unsupported_command`，且不带 `command`。
   - 纯豆浆、纯白水及带数量白水的既有 candidate/clarification 路径没有改变。

### GREEN 命令与结果

工作目录：`version-b-lite-plugin`

```powershell
$nodeExe='C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'

# 目标回归
& $nodeExe node_modules\vitest\vitest.mjs run tests\acceptance\core-parser.test.ts `
  -t 'fails closed instead of dropping unquantified plain water from a mixed drink' `
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism

# 同一验收文件
& $nodeExe node_modules\vitest\vitest.mjs run tests\acceptance\core-parser.test.ts `
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism

# 仅类型检查，不生成 dist
& $nodeExe node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
```

```text
目标回归：Test Files 1 passed；Tests 1 passed | 193 skipped（194）；exit 0
core-parser：Test Files 1 passed；Tests 194 passed（194）；exit 0
tsc --noEmit：exit 0
```

未运行 full test、build 或 OpenClaw。`git diff --check` 无输出；未创建 commit。
