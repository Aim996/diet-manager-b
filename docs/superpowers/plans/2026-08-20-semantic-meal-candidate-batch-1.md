# 饮食管家 0.2.2 结构化餐食候选第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立独立的 0.2.2 产品根，并让 Agent 可提交经过确定性安全验证的结构化餐食候选，使普通省略主语的本人餐食能够写入，同时明确他人、缺失数量和契约冲突保持零写入。

**Architecture:** 0.2.2 从五环境实际部署的 0.2.1 候选工作树建立可追踪基线，但不携带构建产物、依赖目录或运行数据。新增 `semantic/candidate.ts` 定义只覆盖餐食的 v1 候选契约，`semantic/validate-candidate.ts` 只做无数据库验证并把通过的候选转换为现有 `CoreMealCommandCandidate`；`core-runtime.ts` 在请求带候选时走新网关，否则继续走原 parser，两个入口复用同一 Application/Domain/Repository 写入链。

**Tech Stack:** Node.js 24.15.x、TypeScript 5、Vitest 2、TypeBox 1、OpenClaw Plugin SDK、node:sqlite、PowerShell、Git。

**Spec:** `0.2.2/0.2.2-智能语义架构设计.md`

## Global Constraints

- 所有新增产品代码、测试和版本元数据只写入 `0.2.2/version-b-lite-plugin/`；`0.2.1` 从本批开始只读。
- 0.2.1 未提交的候选修复已部署到五个测试环境，建立基线时必须保留；不得用 HEAD 内容覆盖这些工作树文件。
- 不复制或提交 `dist/`、`node_modules/`、`.tmp/`、SQLite、authority secret、备份、Token 或容器运行文件。
- 第一批只支持 `record_meal` 结构化候选；饮水、撤销、pending candidate、库存和回复三方门禁保持后续独立批次。
- Agent 不得提供数据库主键、权威消息 ID、权威接收时间或会话 ID；这些继续由宿主七字段请求提供。
- `source_text` 必须逐字保留；候选的证据片段必须真实存在于原话中。
- 私人 Agent 中无明确他人、否定、计划或假设证据时可默认本人；明确同事、家人、孩子、室友或第三人称时必须 `ignored/non_self_subject` 且零写入。
- 候选缺少数量或单位时返回 `needs_clarification/amount_ambiguous`，不得将未知转为 0 或估算值。
- 候选与请求动作、原话或证据冲突时返回专门的 `SEMANTIC_*` 错误，不删除现有旧 parser 的 `ACTION_CONFLICT` 守卫。
- 不新增运行时依赖，不迁移 SQLite schema，不复制写库逻辑。
- 每个功能任务先看到红灯，再做最小实现；每次提交只暂存当前任务列出的 0.2.2 文件。

## 标准命令

以下命令从 `E:\codx\skill\饮食管家\0.2.2\version-b-lite-plugin` 执行。先确认 `node --version` 为 `v24.15.x`；使用工作区提供的 Node 24，不下载或替换依赖。

```powershell
node .\node_modules\vitest\vitest.mjs run <test-file> --maxWorkers=1 --minWorkers=1
node .\node_modules\vitest\vitest.mjs run --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
git -c safe.directory=E:/codx/skill/饮食管家 -C E:/codx/skill/饮食管家 diff --check
```

0.2.2 不提交依赖目录。若本机离线安装不能复用锁文件缓存，可在验证期间创建指向 0.2.1 既有 `node_modules` 的本地目录联接；创建前必须确认源目录是普通目录、目标不存在且目标位于 `0.2.2/version-b-lite-plugin`，联接仍受 `.gitignore` 排除。

## 文件责任图

| 路径 | 单一责任 |
|---|---|
| `0.2.2/version-b-lite-plugin/src/semantic/candidate.ts` | 定义并深度克隆 `SemanticMealCandidateV1`，拒绝代理、访问器、额外字段和越界值 |
| `0.2.2/version-b-lite-plugin/src/semantic/validate-candidate.ts` | 验证动作、原话、主体、条目、数量、时间证据；转换为现有 parser 候选，不访问数据库 |
| `0.2.2/version-b-lite-plugin/src/parser/subject.ts` | 导出明确他人检测器，供旧 parser 和新验证网关共同使用 |
| `0.2.2/version-b-lite-plugin/src/parser/meal.ts` | 复用单一餐食词表，导出原始食物名与规范名称/类型的确定性查询 |
| `0.2.2/version-b-lite-plugin/src/contracts.ts` | 将可选结构化候选加入工具请求类型，保持旧七字段请求兼容 |
| `0.2.2/version-b-lite-plugin/src/application/core-runtime.ts` | 选择语义候选或旧 parser 入口，并把两者汇合到现有执行链 |
| `0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts` | 暴露 TypeBox 候选 schema，安全克隆嵌套参数并更新 Agent 工具说明 |
| `0.2.2/version-b-lite-plugin/tests/semantic/validate-meal-candidate.test.ts` | 无数据库验证器的契约、安全边界和转换单测 |
| `0.2.2/version-b-lite-plugin/tests/acceptance/semantic-meal-application.test.ts` | 结构化候选到 SQLite 的应用验收和旧入口兼容回归 |
| `0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-semantic-candidate.test.ts` | OpenClaw schema、嵌套输入克隆和真实工具执行验收 |

---

### Task 1: 建立 0.2.2 可追踪基线并证明迁移不改行为

**Files:**

- Create: `0.2.2/version-b-lite-plugin/`（从当前 0.2.1 候选复制受控产品文件）
- Modify: `0.2.2/version-b-lite-plugin/package.json`
- Modify: `0.2.2/version-b-lite-plugin/openclaw.plugin.json`
- Modify: `0.2.2/version-b-lite-plugin/tests/release-version.test.ts`

**Interfaces:**

- Consumes: 当前工作树中 `0.2.1/version-b-lite-plugin` 的 `.npmignore`、根层配置/模板、`scripts/`、`skills/`、`src/`、`tests/`；包括候选 parser 修复和三个未跟踪候选测试。
- Produces: 不含 `dist` 与 `node_modules`、版本统一为 0.2.2、完整旧回归通过的 `0.2.2/version-b-lite-plugin`。

- [ ] **Step 1: 记录候选来源清单并检查目标为空**

运行：

```powershell
$repo = 'E:\codx\skill\饮食管家'
$source = Join-Path $repo '0.2.1\version-b-lite-plugin'
$target = Join-Path $repo '0.2.2\version-b-lite-plugin'
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'BASELINE_SOURCE_MISSING' }
if (Test-Path -LiteralPath $target) { throw 'BASELINE_TARGET_ALREADY_EXISTS' }
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo status --short
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo diff -- `
  0.2.1/version-b-lite-plugin/openclaw.plugin.json `
  0.2.1/version-b-lite-plugin/package.json `
  0.2.1/version-b-lite-plugin/src/parser/correction.ts `
  0.2.1/version-b-lite-plugin/src/parser/meal.ts `
  0.2.1/version-b-lite-plugin/src/parser/predicate-frame.ts `
  0.2.1/version-b-lite-plugin/src/parser/subject.ts `
  0.2.1/version-b-lite-plugin/tests/acceptance/natural-undo-application.test.ts
```

Expected: 目标不存在；diff 与 0.2.2 Agent 交接中的候选清单一致；没有已暂存文件。

- [ ] **Step 2: 受控复制产品基线**

复制以下根文件与目录，保留当前工作树内容而不是只复制 Git HEAD：

```text
.npmignore
openclaw.plugin.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
release-changelog.template.md
release-manifest.template.json
release-readme.template.md
tsconfig.json
scripts/
skills/
src/
tests/
```

复制完成后断言以下目标不存在：

```powershell
@('dist', 'node_modules', '.tmp') | ForEach-Object {
  if (Test-Path -LiteralPath (Join-Path $target $_)) { throw "BASELINE_FORBIDDEN_PATH:$_" }
}
```

- [ ] **Step 3: 先写版本一致性红灯**

将 `tests/release-version.test.ts` 的断言改为：

```ts
describe("install-facing release metadata", () => {
  it("publishes the 0.2.2 candidate consistently to npm and OpenClaw", () => {
    const packageMetadata = readJson(join(projectRoot, "package.json"));
    const pluginMetadata = readJson(join(projectRoot, "openclaw.plugin.json"));

    expect(packageMetadata.version).toBe("0.2.2");
    expect(pluginMetadata.version).toBe(packageMetadata.version);
  });
});
```

- [ ] **Step 4: 运行版本测试确认红灯**

Run: `node .\node_modules\vitest\vitest.mjs run tests/release-version.test.ts --maxWorkers=1 --minWorkers=1`

Expected: FAIL，实际版本仍为 `0.2.1`。

- [ ] **Step 5: 最小修改两个版本字段**

将 `package.json.version` 和 `openclaw.plugin.json.version` 均改为 `0.2.2`；不改变插件 ID、契约哈希、依赖或安装脚本。

- [ ] **Step 6: 运行基线验证**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run tests/release-version.test.ts --maxWorkers=1 --minWorkers=1
node .\node_modules\vitest\vitest.mjs run --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Expected: 版本测试、完整 portable 回归和 TypeScript 构建全绿；若测试总数与交接记录的 1173 不同，先用复制来源与测试清单解释差异，不开始 Task 2。

- [ ] **Step 7: 检查污染并提交基线**

Run:

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo status --short -- 0.2.2/version-b-lite-plugin
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo diff --check -- 0.2.2/version-b-lite-plugin
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo add -- 0.2.2/version-b-lite-plugin
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo commit -m "chore: establish diet manager 0.2.2 baseline"
```

Expected: 暂存区只含 0.2.2 基线；0.2.1 和 shared 的历史改动未暂存。

---

### Task 2: 定义语义餐食候选与纯验证网关

**Files:**

- Create: `0.2.2/version-b-lite-plugin/src/semantic/candidate.ts`
- Create: `0.2.2/version-b-lite-plugin/src/semantic/validate-candidate.ts`
- Create: `0.2.2/version-b-lite-plugin/tests/semantic/validate-meal-candidate.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/parser/meal.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/parser/subject.ts`

**Interfaces:**

- Consumes: `normalizeMealLexeme(rawText: string): string | null`、`resolveOccurredTime(...)`、`CoreMealCommandCandidate`、宿主提供的 operation/message/conversation/time 元数据。
- Produces: `cloneSemanticCandidate(value: unknown): SemanticMealCandidateV1`；`validateSemanticMealCandidate(input: SemanticMealValidationInput): SemanticMealValidationResult`；`detectExplicitOtherSubject(sourceText: string): string | null`；`mealLexemeKind(rawText: string): CoreMealItem["kind"] | null`。

- [ ] **Step 1: 写候选契约和安全边界红灯**

创建 `tests/semantic/validate-meal-candidate.test.ts`，使用下列候选工厂：

```ts
function candidate(
  sourceText: string,
  items: SemanticMealCandidateV1["items"],
): SemanticMealCandidateV1 {
  return {
    schema_version: "diet-manager/semantic-candidate/v1",
    intent: "record_meal",
    source_text: sourceText,
    subject: {
      kind: "self",
      basis: "private_agent_default",
      evidence_span: null,
      explicit_other_spans: [],
    },
    items,
    time: { kind: "source_text", evidence_span: "中午" },
  };
}
```

测试至少精确断言：

```ts
it("accepts private-agent default self when evidence is complete", () => {
  const sourceText = "中午扒了两碗米饭，这会儿还撑着";
  const result = validateSemanticMealCandidate({
    candidate: candidate(sourceText, [{
      raw_name: "米饭",
      normalized_hint: "rice",
      amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" },
    }]),
    action: "record_meal",
    source_text: sourceText,
    received_at: "2026-08-20T12:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "semantic-rice-001",
  });
  expect(result).toMatchObject({
    disposition: "candidate",
    command: {
      action: "record_meal",
      parser_version: "diet-manager/semantic-candidate-v1",
      subject: { kind: "self", resolution_basis: "omitted_subject_default" },
      items: [{ normalized_name: "rice", quantity: 2, unit: "bowl", estimated: false }],
    },
  });
});

it("lets explicit-other evidence override a false self claim", () => {
  const sourceText = "我同事吃了一个鸡蛋";
  expect(validateSemanticMealCandidate({
    candidate: candidate(sourceText, [{
      raw_name: "鸡蛋",
      normalized_hint: "egg",
      amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" },
    }]),
    action: "record_meal",
    source_text: sourceText,
    received_at: "2026-08-20T08:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "semantic-other-002",
  })).toEqual({ disposition: "ignored", action: "record_meal", reason_code: "non_self_subject" });
});

it("asks only for a missing amount", () => {
  const sourceText = "早上顺手吃了鸡蛋";
  const value = candidate(sourceText, [{
    raw_name: "鸡蛋",
    normalized_hint: "egg",
    amount: { kind: "unknown" },
  }]);
  expect(validateSemanticMealCandidate({
    candidate: value,
    action: "record_meal",
    source_text: sourceText,
    received_at: "2026-08-20T08:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "semantic-amount-003",
  })).toEqual({
    disposition: "needs_clarification",
    action: "record_meal",
    reason_code: "amount_ambiguous",
    question: "鸡蛋吃了多少个？",
    missing_items: ["鸡蛋"],
  });
});
```

再加入原话不一致、`normalized_hint` 不一致、证据片段不存在、动作不一致、额外字段、嵌套 accessor/proxy、非正数和不允许单位的拒绝测试。错误结果分别固定为 `SEMANTIC_SOURCE_MISMATCH`、`SEMANTIC_ITEM_MISMATCH`、`SEMANTIC_EVIDENCE_INVALID`、`SEMANTIC_ACTION_MISMATCH` 或 `SEMANTIC_CANDIDATE_INVALID`。

- [ ] **Step 2: 运行测试确认红灯**

Run: `node .\node_modules\vitest\vitest.mjs run tests/semantic/validate-meal-candidate.test.ts --maxWorkers=1 --minWorkers=1`

Expected: FAIL，`src/semantic/candidate.ts` 尚不存在。

- [ ] **Step 3: 实现封闭的 v1 候选类型与深度克隆**

在 `src/semantic/candidate.ts` 定义：

```ts
export interface SemanticMealCandidateV1 {
  readonly schema_version: "diet-manager/semantic-candidate/v1";
  readonly intent: "record_meal";
  readonly source_text: string;
  readonly subject: Readonly<{
    readonly kind: "self";
    readonly basis: "explicit" | "private_agent_default";
    readonly evidence_span: string | null;
    readonly explicit_other_spans: readonly string[];
  }>;
  readonly items: readonly Readonly<{
    readonly raw_name: string;
    readonly normalized_hint: string;
    readonly amount:
      | Readonly<{ readonly kind: "exact"; readonly value: number; readonly unit: string; readonly evidence_span: string }>
      | Readonly<{ readonly kind: "unknown" }>;
  }>[];
  readonly time: Readonly<{
    readonly kind: "source_text" | "unspecified";
    readonly evidence_span: string | null;
  }>;
}

export function cloneSemanticCandidate(value: unknown): SemanticMealCandidateV1;
```

`cloneSemanticCandidate` 对每层执行普通对象、确切键集合、数据属性、长度和数量边界检查；`source_text` 最大 4096 字符，items 为 1–64 个，证据片段为 1–256 字符，exact amount 必须有限且大于 0。返回的数组和对象全部冻结。

- [ ] **Step 4: 导出可复用的词表和明确他人安全检测**

在 `meal.ts` 从现有 `LEXICON` 导出只读查询：

```ts
export function mealLexemeKind(rawText: string): CoreMealItem["kind"] | null {
  const lexeme = LEXICON.find((candidate) => candidate.raw_text === rawText);
  return lexeme?.kind ?? null;
}
```

在 `subject.ts` 将现有明确他人称谓集合收敛为单一检测函数：

```ts
export function detectExplicitOtherSubject(sourceText: string): string | null;
```

它返回命中的原文片段而不是 boolean；至少覆盖同事、妈妈/我妈、爸爸/我爸、孩子、室友、朋友、他、她、小王等现有安全词。旧 `resolvePredicateFrameSubject` 复用该检测逻辑，确保新旧入口不会形成两套他人边界。

- [ ] **Step 5: 实现纯验证和转换**

在 `validate-candidate.ts` 定义：

```ts
export interface SemanticMealValidationInput {
  readonly candidate: SemanticMealCandidateV1;
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly received_at: OffsetIsoTimestamp;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
}

export type SemanticMealValidationResult =
  | Readonly<{ readonly disposition: "candidate"; readonly command: CoreMealCommandCandidate }>
  | CoreIgnoredResult
  | CoreClarificationResult
  | Readonly<{ readonly disposition: "rejected"; readonly error_code:
      | "SEMANTIC_SOURCE_MISMATCH"
      | "SEMANTIC_ACTION_MISMATCH"
      | "SEMANTIC_ITEM_MISMATCH"
      | "SEMANTIC_EVIDENCE_INVALID"
      | "SEMANTIC_CANDIDATE_INVALID" }>;

export function validateSemanticMealCandidate(
  input: SemanticMealValidationInput,
): SemanticMealValidationResult;
```

验证顺序固定为：契约深克隆 → action/intent → 原话逐字相等 → 明确他人优先 → subject 证据 → item 原名/规范名 → amount evidence → time evidence。通过后使用 `resolveOccurredTime` 解析时间，生成 `parser_version: "diet-manager/semantic-candidate-v1"`、`meal_identity_seed: operation_id` 和现有 `CoreMealItem[]`；不得访问 runtime 或数据库。

- [ ] **Step 6: 运行聚焦和相邻 parser 测试**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run tests/semantic/validate-meal-candidate.test.ts --maxWorkers=1 --minWorkers=1
node .\node_modules\vitest\vitest.mjs run tests/acceptance/stranger-natural-subject.test.ts tests/acceptance/core-completion-subject.test.ts tests/acceptance/core-parser.test.ts --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Expected: 全绿；旧明确他人和默认本人 parser 用例不回归。

- [ ] **Step 7: 提交纯语义边界**

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo add -- `
  0.2.2/version-b-lite-plugin/src/semantic/candidate.ts `
  0.2.2/version-b-lite-plugin/src/semantic/validate-candidate.ts `
  0.2.2/version-b-lite-plugin/src/parser/meal.ts `
  0.2.2/version-b-lite-plugin/src/parser/subject.ts `
  0.2.2/version-b-lite-plugin/tests/semantic/validate-meal-candidate.test.ts
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo commit -m "feat: validate structured meal candidates"
```

---

### Task 3: 将结构化候选接入 Application 并保留旧入口

**Files:**

- Modify: `0.2.2/version-b-lite-plugin/src/contracts.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/parser/types.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/application/core-runtime.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/index.ts`
- Create: `0.2.2/version-b-lite-plugin/tests/acceptance/semantic-meal-application.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `cloneSemanticCandidate` 和 `validateSemanticMealCandidate`。
- Produces: `CoreApplicationRequest.semantic_candidate?: SemanticMealCandidateV1`；新候选与旧 parser 都进入现有 `executeCandidate`、receipt、幂等和 SQLite 事务链。

- [ ] **Step 1: 写应用层红灯**

创建临时官方根并用 `handleCoreRequest` 验证以下矩阵：

```ts
it.each([
  ["中午扒了两碗米饭，这会儿还撑着", [{ raw_name: "米饭", normalized_hint: "rice", amount: { kind: "exact", value: 2, unit: "bowl", evidence_span: "两碗米饭" } }]],
  ["早上顺手吃了一个鸡蛋", [{ raw_name: "鸡蛋", normalized_hint: "egg", amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个鸡蛋" } }]],
  ["我出门前吃了两片面包和一个煮鸡蛋", [
    { raw_name: "面包", normalized_hint: "bread", amount: { kind: "exact", value: 2, unit: "slice", evidence_span: "两片面包" } },
    { raw_name: "鸡蛋", normalized_hint: "egg", amount: { kind: "exact", value: 1, unit: "piece", evidence_span: "一个煮鸡蛋" } },
  ]],
])("commits a validated semantic meal: %s", (sourceText, items) => {
  const outcome = handleCoreRequest(runtime, semanticRequest(sourceText, items));
  expect(outcome).toMatchObject({ action: "record_meal", committed: true });
});
```

另写三条零写入断言：原话为“我同事吃了一个鸡蛋”但候选称 self；amount 为 unknown；候选 source_text 与请求 source_text 不同。每条在调用前后查询 `event_records` 增量，必须为 0。

最后保留兼容断言：不带 `semantic_candidate` 的“我吃了一个苹果。”仍提交，证明旧 `source_text` 路径继续工作。

- [ ] **Step 2: 运行应用测试确认红灯**

Run: `node .\node_modules\vitest\vitest.mjs run tests/acceptance/semantic-meal-application.test.ts --maxWorkers=1 --minWorkers=1`

Expected: FAIL，`CoreApplicationRequest` 和 request authority 尚不接受 `semantic_candidate`。

- [ ] **Step 3: 扩展请求类型而不改变旧调用形状**

在 `contracts.ts` 增加：

```ts
export interface CoreApplicationRequest {
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly prior_context: readonly import("./parser/types.js").CoreContextEntry[];
  readonly semantic_candidate?: import("./semantic/candidate.js").SemanticMealCandidateV1;
}
```

在 `CoreMealCommandCandidate.parser_version` 联合中加入 `"diet-manager/semantic-candidate-v1"`。在 `index.ts` 导出 `SemanticMealCandidateV1` 类型，但不导出内部验证器。

- [ ] **Step 4: 在 request authority 中安全克隆可选候选**

`cloneRequest` 接受恰好八个旧字段，或八个旧字段加 `semantic_candidate`；其他额外字段仍 `INVALID_REQUEST`。若候选存在，调用 `cloneSemanticCandidate` 后再冻结请求；不得把嵌套对象直接穿透到 runtime。

- [ ] **Step 5: 选择入口并复用执行链**

将当前：

```ts
const { action: _action, ...parseInput } = request;
parsed = parseCoreCommand(parseInput);
```

替换为逻辑等价的显式分支：

```ts
if (request.semantic_candidate === undefined) {
  const { action: _action, semantic_candidate: _candidate, ...parseInput } = request;
  parsed = parseCoreCommand(parseInput);
} else {
  parsed = validateSemanticMealCandidate({
    candidate: request.semantic_candidate,
    action: request.action,
    source_text: request.source_text,
    received_at: request.received_at as OffsetIsoTimestamp,
    timezone: request.timezone,
    operation_id: request.operation_id,
  });
}
```

若结果为 `rejected`，返回 `failedOutcome(request.action, request.operation_id, parsed.error_code)`；candidate、ignored 和 needs_clarification 继续走现有分支。不要改 `executeCandidate`、map、domain 或 repository。

- [ ] **Step 6: 运行聚焦、相邻和幂等测试**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run tests/acceptance/semantic-meal-application.test.ts tests/acceptance/subject-default-application.test.ts tests/acceptance/core-application.test.ts tests/runtime-authority-round2.test.ts --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Expected: 新结构化路径、旧 source_text 路径、请求 authority 和幂等行为全绿。

- [ ] **Step 7: 提交 Application 接入**

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo add -- `
  0.2.2/version-b-lite-plugin/src/contracts.ts `
  0.2.2/version-b-lite-plugin/src/parser/types.ts `
  0.2.2/version-b-lite-plugin/src/application/core-runtime.ts `
  0.2.2/version-b-lite-plugin/src/index.ts `
  0.2.2/version-b-lite-plugin/tests/acceptance/semantic-meal-application.test.ts
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo commit -m "feat: accept semantic meal requests"
```

---

### Task 4: 升级 OpenClaw 工具契约和嵌套输入安全

**Files:**

- Modify: `0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts`
- Create: `0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-semantic-candidate.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/skills/diet-manager-b/SKILL.md`

**Interfaces:**

- Consumes: Task 3 的 `CoreApplicationRequest.semantic_candidate` 和 Task 2 的候选克隆器。
- Produces: Agent 可见的可选 `semantic_candidate` TypeBox schema；旧七字段调用继续有效；工具说明明确模型只能提交证据候选，最终状态受工具结果约束。

- [ ] **Step 1: 写 OpenClaw 红灯**

测试注册后的 `dietManagerParameters` 包含：

```ts
semantic_candidate: Type.Optional(Type.Object({
  schema_version: Type.Literal("diet-manager/semantic-candidate/v1"),
  intent: Type.Literal("record_meal"),
  source_text: Type.String(),
  subject: Type.Object({
    kind: Type.Literal("self"),
    basis: Type.Union([Type.Literal("explicit"), Type.Literal("private_agent_default")]),
    evidence_span: Type.Union([Type.String(), Type.Null()]),
    explicit_other_spans: Type.Array(Type.String()),
  }, { additionalProperties: false }),
  items: Type.Array(Type.Object({
    raw_name: Type.String(),
    normalized_hint: Type.String(),
    amount: Type.Union([exactAmountSchema, unknownAmountSchema]),
  }, { additionalProperties: false })),
  time: Type.Object({
    kind: Type.Union([Type.Literal("source_text"), Type.Literal("unspecified")]),
    evidence_span: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false }))
```

再通过注册工具执行一条“中午扒了两碗米饭”，断言 details 为 committed；执行明确同事伪装 self，断言 ignored 且官方根事件数为 0。加入嵌套候选 accessor/proxy 测试，断言 getter 不执行并返回 `INVALID_REQUEST`。

- [ ] **Step 2: 运行 OpenClaw 测试确认红灯**

Run: `node .\node_modules\vitest\vitest.mjs run tests/acceptance/openclaw-semantic-candidate.test.ts --maxWorkers=1 --minWorkers=1`

Expected: FAIL，参数 schema 还没有 `semantic_candidate`。

- [ ] **Step 3: 增加 TypeBox schema 与安全克隆**

在 `plugin.ts` 将 `semantic_candidate` 加入 `PARAMETER_FIELDS`，用 `cloneSemanticCandidate` 复制到 `CoreApplicationRequest`。外层 `dataDescriptors` 与内层候选克隆都必须拒绝代理、访问器和额外字段；旧七个 authority 字段仍必需，模型不能用候选替代宿主元数据。

- [ ] **Step 4: 更新 Agent 工具说明和随包 Skill**

工具说明增加以下约束，保持回复规则不变：

```text
For record_meal, when the user's natural wording is not safely represented by the legacy parser, send semantic_candidate with the exact same source_text, explicit evidence spans, and unknown amounts left unknown. Never invent identifiers, amounts, units, times, people, or normalized food names. An explicit other person overrides private-agent default self. Follow committed/status/reason_code/error_code exactly in the final reply.
```

`skills/diet-manager-b/SKILL.md` 同步中文版规则和一条最小结构化餐食示例；不得加入饮水、撤销、pending 或库存候选示例。

- [ ] **Step 5: 运行 OpenClaw 与 Skill 相邻测试**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run tests/acceptance/openclaw-semantic-candidate.test.ts tests/acceptance/openclaw-core.test.ts tests/skill-goal-sync.test.ts tests/restore-record-skill-sync.test.ts --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Expected: 新旧工具输入、嵌套 authority 防护、Skill 同步和构建全绿。

- [ ] **Step 6: 提交 OpenClaw 契约**

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo add -- `
  0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts `
  0.2.2/version-b-lite-plugin/skills/diet-manager-b/SKILL.md `
  0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-semantic-candidate.test.ts `
  0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo commit -m "feat: expose semantic meal candidates to OpenClaw"
```

---

### Task 5: 第一批本地发布门与证据记录

**Files:**

- Create: `0.2.2/0.2.2-第一批结构化餐食候选验证记录.md`
- Modify only if a real failure requires it: files already owned by Tasks 2–4; any fix receives its own red test and focused commit before this task continues.

**Interfaces:**

- Consumes: Tasks 1–4 的同一提交序列。
- Produces: 本地可发布判定、精确测试数量和下一步五环境部署输入矩阵；本任务不连接 Docker 主机、不部署。

- [ ] **Step 1: 运行聚焦能力矩阵**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run `
  tests/semantic/validate-meal-candidate.test.ts `
  tests/acceptance/semantic-meal-application.test.ts `
  tests/acceptance/openclaw-semantic-candidate.test.ts `
  tests/acceptance/stranger-natural-subject.test.ts `
  tests/acceptance/subject-default-application.test.ts `
  --maxWorkers=1 --minWorkers=1
```

Expected: 全绿；三条本人自然餐食提交，明确他人/缺少数量/契约冲突零写入。

- [ ] **Step 2: 运行相邻回归和构建**

Run:

```powershell
node .\node_modules\vitest\vitest.mjs run `
  tests/acceptance/core-parser.test.ts `
  tests/acceptance/core-application.test.ts `
  tests/acceptance/openclaw-core.test.ts `
  tests/application-mapping.test.ts `
  tests/runtime-authority-round2.test.ts `
  --maxWorkers=1 --minWorkers=1
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Expected: 全绿。

- [ ] **Step 3: 只运行一次完整 portable 回归**

Run: `node .\node_modules\vitest\vitest.mjs run --maxWorkers=1 --minWorkers=1`

Expected: 全绿；记录测试文件数、测试数和耗时。失败时停止，不打包、不部署。

- [ ] **Step 4: 检查 Git 范围和版本污染**

Run:

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo diff --check
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo status --short
rg -n '"version"\s*:\s*"0\.2\.[01]"' E:\codx\skill\饮食管家\0.2.2\version-b-lite-plugin
```

Expected: diff check 通过；0.2.1/shared 的历史改动仍未暂存；0.2.2 发布元数据没有旧版本号（测试夹具中的历史字符串需逐项说明）。

- [ ] **Step 5: 写验证记录**

记录：

- 用户已改善的三种说法及 committed 状态；
- 明确同事、缺少数量、原话冲突三类零写入证据；
- 聚焦、相邻、完整回归和 TypeScript 的精确数量；
- 本批未覆盖饮水、撤销、pending、库存和最终回复门禁；
- 尚未部署五环境；
- 下一次五环境建议输入分别使用米饭、鸡蛋、面包、苹果、香蕉的不同自然说法，并同时核对回复、工具和 SQLite。

- [ ] **Step 6: 提交验证记录**

```powershell
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo add -- 0.2.2/0.2.2-第一批结构化餐食候选验证记录.md
git -c safe.directory=E:/codx/skill/饮食管家 -C $repo commit -m "docs: record semantic meal batch verification"
```

Expected: 本地第一批完成；没有打包或远程部署副作用。

## 计划自审结论

- 规格覆盖：本计划只覆盖交接指定的第一批——新产品根、候选契约、默认本人餐食、明确他人、缺量澄清、旧入口兼容和本地验证；其余六批明确排除。
- 类型一致性：`SemanticMealCandidateV1`、`cloneSemanticCandidate`、`validateSemanticMealCandidate`、`SemanticMealValidationResult` 在 Task 2 定义，并由 Tasks 3–4 使用相同名称和字段。
- 安全边界：新候选不携带权威宿主 ID，不访问数据库，不绕过现有写入链；明确他人优先，unknown 不变成零。
- 提交边界：五个任务均只暂存列出的 0.2.2 文件，不触碰当前 0.2.1/shared 历史改动。
