# 饮食管家通用 Agent Skill 第一版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让不安装 OpenClaw 的 Agent 也能通过通用 Skill 和跨平台 JSON CLI 调用现有饮食管家 SQLite 核心，同时保持 OpenClaw 适配器兼容。

**Architecture:** 新增冻结的 `agent-command/v1` 与公共执行边界，把不可信 Agent 命令和可信宿主上下文分开；CLI 生成上下文，OpenClaw 适配器拆分现有请求后委托同一边界。根包只导出平台中立 API，OpenClaw 使用独立子入口，发布包同时携带 CLI、Skill 和适配器。

**Tech Stack:** TypeScript、Node.js 24、node:sqlite、Vitest、Agent Skills、npm tarball、OpenClaw 可选适配器

**Spec:** `docs/superpowers/specs/2026-08-21-universal-agent-skill-design.md`

## Global Constraints

- Node.js 版本保持 `>=24.15.0 <25`。
- `diet-manager/agent-command/v1` 的业务 JSON 不接受数据根、secret、数据库路径、宿主标识、时间戳或 `prior_context`。
- 第一版时区固定为 `Asia/Shanghai`；CLI 宿主上下文由 CLI 生成，OpenClaw 上下文来自宿主。
- 所有业务路径只调用现有 `CoreRuntime`；不得复制解析、语义校验、营养、库存、事务或 SQLite 逻辑。
- CLI 标准输出只有一个合法 `DietManagerOutcome` JSON；日志和稳定错误码只走标准错误。
- OpenClaw 必须保留，但只能作为可选薄适配器；本批次不实现 MCP server。
- 现有未跟踪 `0.2.2/version-b-lite-plugin/dist/` 不删除、不提交；每次构建后只暂存明确列出的源文件。
- 主工作区 `0.2.1` 与 `shared` 的用户改动不得触碰。

Local execution starts by binding the current managed runtimes without changing `PATH` or reinstalling dependencies:

```powershell
$nodeExe = 'C:/Users/10481/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$pythonExe = 'C:/Users/10481/AppData/Local/Programs/Python/Python312/python.exe'
& $nodeExe --version
& $pythonExe --version
```

Expected local Node output begins with `v24.` and satisfies the package engine range.

---

## File Structure

- Create `0.2.2/version-b-lite-plugin/src/public/agent-command.ts`: `agent-command/v1` 类型、常量和无执行副作用的严格克隆校验器。
- Create `0.2.2/version-b-lite-plugin/src/public/execute.ts`: 把 Agent 命令与可信宿主上下文映射为 `CoreApplicationRequest` 并调用现有核心。
- Create `0.2.2/version-b-lite-plugin/src/cli/config.ts`: 从管理员环境或精确 JSON 配置文件加载唯一运行配置。
- Create `0.2.2/version-b-lite-plugin/src/cli/agent.ts`: 跨平台 stdin/stdout CLI、可信上下文生成和运行时生命周期。
- Create `0.2.2/version-b-lite-plugin/src/openclaw/index.ts`: 独立 OpenClaw 包入口。
- Modify `0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts`: 将已验证工具请求拆成命令/上下文并委托公共执行边界。
- Modify `0.2.2/version-b-lite-plugin/src/index.ts`: 只暴露平台中立契约、公共执行 API、核心运行时和备份 API。
- Modify `0.2.2/version-b-lite-plugin/package.json`: 增加 `bin`、`exports`、可选 OpenClaw peer、portable pack script 和受控 `files`。
- Modify `0.2.2/version-b-lite-plugin/pnpm-lock.yaml`: 与 peer/optional peer 元数据同步。
- Create `0.2.2/version-b-lite-plugin/scripts/build-portable.mjs`: 跨平台 npm tarball 构建与内容白名单验证。
- Modify `0.2.2/version-b-lite-plugin/skills/diet-manager-b/SKILL.md`: 改为 Agent 中立的决策和结果处理入口。
- Create `0.2.2/version-b-lite-plugin/skills/diet-manager-b/references/agent-command-v1.md`: 传输选择、CLI 协议、动作和返回结构。
- Modify `0.2.2/version-b-lite-plugin/skills/diet-manager-b/agents/openai.yaml`: 保持 UI 元数据与通用入口一致。
- Create `docs/work-items/UNIVERSAL-SKILL-001-skill-evaluation.md`: Skill RED/GREEN/REFACTOR 行为证据。
- Create focused tests named in the tasks below; modify existing OpenClaw/foundation/release tests only where the public boundary changes their consumer-visible contract.

---

### Task 1: Freeze the agent-neutral command and execution boundary

**Files:**
- Create: `0.2.2/version-b-lite-plugin/src/public/agent-command.ts`
- Create: `0.2.2/version-b-lite-plugin/src/public/execute.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/index.ts`
- Test: `0.2.2/version-b-lite-plugin/tests/agent-command.test.ts`

**Interfaces:**
- Produces: `AGENT_COMMAND_SCHEMA_VERSION = "diet-manager/agent-command/v1"`.
- Produces: `AgentCommandV1`, containing exact `schema_version`, `action`, `source_text`, and optional `semantic_candidate`.
- Produces: `HostExecutionContextV1`, containing exact `received_at`, `timezone`, `operation_id`, `source_message_id`, and `conversation_id`.
- Produces: `cloneAgentCommandV1(value: unknown): Readonly<AgentCommandV1>`.
- Produces: `executeAgentCommand(runtime: CoreRuntime, command: AgentCommandV1, context: HostExecutionContextV1): Promise<DietManagerOutcome>`.

- [ ] **Step 1: Write the failing public-command tests**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_COMMAND_SCHEMA_VERSION,
  cloneAgentCommandV1,
  createCoreRuntime,
  executeAgentCommand,
} from "../src/index.js";

describe("diet-manager/agent-command/v1", () => {
  it("clones an exact ordinary command and rejects authority fields", () => {
    const input = {
      schema_version: "diet-manager/agent-command/v1",
      action: "record_meal",
      source_text: "我吃了一个苹果",
    };
    expect(cloneAgentCommandV1(input)).toEqual(input);
    expect(AGENT_COMMAND_SCHEMA_VERSION).toBe("diet-manager/agent-command/v1");
    expect(() => cloneAgentCommandV1({ ...input, official_data_root: "C:/other" }))
      .toThrow("DIET_AGENT_COMMAND_INVALID:keys");
    expect(() => cloneAgentCommandV1({ ...input, operation_id: "invented" }))
      .toThrow("DIET_AGENT_COMMAND_INVALID:keys");
  });

  it("executes through the existing core and returns a validated outcome", async () => {
    const root = mkdtempSync(join(tmpdir(), "diet-agent-command-"));
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-21T04:00:01.000Z" });
    try {
      const outcome = await executeAgentCommand(runtime, {
        schema_version: "diet-manager/agent-command/v1",
        action: "record_meal",
        source_text: "我吃了一个苹果",
      }, {
        received_at: "2026-08-21T12:00:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "agent-command-operation-001",
        source_message_id: "agent-command-message-001",
        conversation_id: "agent-command-conversation-001",
      });
      expect(outcome).toMatchObject({ action: "record_meal", committed: true });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
```

Add cases for proxy/accessor objects, empty/oversized `source_text`, semantic candidate on a non-meal action, semantic/source text mismatch, and unknown top-level keys. Each expectation must name the production break it catches.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `0.2.2/version-b-lite-plugin`:

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run tests/agent-command.test.ts
```

Expected: FAIL because `AGENT_COMMAND_SCHEMA_VERSION`, `cloneAgentCommandV1`, and `executeAgentCommand` are not exported.

- [ ] **Step 3: Implement the strict command clone**

Implement `src/public/agent-command.ts` with descriptor-based reads, ordinary-object/proxy rejection, exact keys, 1–4096 UTF-16 code-unit `source_text`, current `dietManagerActions`, and `cloneSemanticCandidate` reuse:

```ts
export const AGENT_COMMAND_SCHEMA_VERSION = "diet-manager/agent-command/v1" as const;

export interface AgentCommandV1 {
  readonly schema_version: typeof AGENT_COMMAND_SCHEMA_VERSION;
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly semantic_candidate?: SemanticMealCandidateV1;
}

export interface HostExecutionContextV1 {
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
}

export function cloneAgentCommandV1(value: unknown): Readonly<AgentCommandV1> {
  const source = exactOrdinaryRecord(value, ["schema_version", "action", "source_text"], ["semantic_candidate"]);
  const schemaVersion = data(source, "schema_version");
  const action = data(source, "action");
  const sourceText = data(source, "source_text");
  if (schemaVersion !== AGENT_COMMAND_SCHEMA_VERSION) invalid("schema_version");
  if (typeof action !== "string" || !dietManagerActions.includes(action as DietManagerAction)) invalid("action");
  if (typeof sourceText !== "string" || sourceText.length < 1 || sourceText.length > 4096) invalid("source_text");
  const rawCandidate = optionalData(source, "semantic_candidate");
  if (rawCandidate === undefined) return Object.freeze({ schema_version: schemaVersion, action, source_text: sourceText });
  if (action !== "record_meal") invalid("semantic_candidate_action");
  const candidate = cloneSemanticCandidate(rawCandidate);
  if (candidate.source_text !== sourceText) invalid("semantic_candidate_source_text");
  return Object.freeze({ schema_version: schemaVersion, action, source_text: sourceText, semantic_candidate: candidate });
}
```

- [ ] **Step 4: Implement the public execution boundary and root exports**

Implement `src/public/execute.ts` so it creates `prior_context: []` internally and validates the returned outcome:

```ts
export async function executeAgentCommand(
  runtime: CoreRuntime,
  commandValue: AgentCommandV1,
  contextValue: HostExecutionContextV1,
): Promise<DietManagerOutcome> {
  const command = cloneAgentCommandV1(commandValue);
  const context = cloneHostExecutionContextV1(contextValue);
  return assertDietManagerOutcome(await handleCoreRequestAsync(runtime, {
    action: command.action,
    source_text: command.source_text,
    received_at: context.received_at,
    timezone: context.timezone,
    operation_id: context.operation_id,
    source_message_id: context.source_message_id,
    conversation_id: context.conversation_id,
    prior_context: [],
    ...(command.semantic_candidate === undefined ? {} : { semantic_candidate: command.semantic_candidate }),
  }));
}
```

Export only platform-neutral APIs from `src/index.ts`; do not import `src/openclaw/*` there.

- [ ] **Step 5: Run GREEN and adjacent core tests**

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run tests/agent-command.test.ts tests/acceptance/core-application.test.ts tests/semantic/validate-meal-candidate.test.ts
```

Expected: all tests PASS and ignored/failed cases create zero business rows.

- [ ] **Step 6: Commit Task 1**

```powershell
git add 0.2.2/version-b-lite-plugin/src/public/agent-command.ts 0.2.2/version-b-lite-plugin/src/public/execute.ts 0.2.2/version-b-lite-plugin/src/index.ts 0.2.2/version-b-lite-plugin/tests/agent-command.test.ts
git commit -m "feat: add agent-neutral execution boundary"
```

---

### Task 2: Add the real cross-platform JSON CLI

**Files:**
- Create: `0.2.2/version-b-lite-plugin/src/cli/config.ts`
- Create: `0.2.2/version-b-lite-plugin/src/cli/agent.ts`
- Test: `0.2.2/version-b-lite-plugin/tests/agent-cli.test.ts`

**Interfaces:**
- Consumes: `cloneAgentCommandV1`, `createCoreRuntime`, `executeAgentCommand` from Task 1.
- Produces: executable `dist/cli/agent.js` with subcommand `execute`.
- Consumes deployment config: `DIET_MANAGER_DATA_ROOT`; optional `DIET_MANAGER_CONVERSATION_ID`; optional exact config file selected by `DIET_MANAGER_CONFIG_FILE`.
- Produces exit 0 for any valid `DietManagerOutcome`; exit 2 with stable stderr error for protocol/config/startup failure.

- [ ] **Step 1: Write failing child-process tests against the compiled CLI**

```ts
const cli = join(projectRoot, "dist", "cli", "agent.js");

function runCli(root: string | undefined, input: unknown) {
  return spawnSync(process.execPath, [cli, "execute"], {
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      ...(root === undefined ? {} : { DIET_MANAGER_DATA_ROOT: root }),
      DIET_MANAGER_CONVERSATION_ID: "cli-test-conversation",
    },
  });
}

it("records and queries through a fresh standalone CLI process", () => {
  const root = mkdtempSync(join(tmpdir(), "diet-agent-cli-"));
  try {
    const record = runCli(root, {
      schema_version: "diet-manager/agent-command/v1",
      action: "record_meal",
      source_text: "我吃了一个苹果",
    });
    expect(record.status).toBe(0);
    expect(record.stderr).toBe("");
    expect(record.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    expect(JSON.parse(record.stdout)).toMatchObject({ action: "record_meal", committed: true });
    expect(existsSync(join(root, "diet-manager-b.sqlite3"))).toBe(true);

    const query = runCli(root, {
      schema_version: "diet-manager/agent-command/v1",
      action: "query_meals",
      source_text: "查询今天的饮食记录",
    });
    expect(JSON.parse(query.stdout).meal_history.meals).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: false });
  }
});
```

Add real process cases for missing root, invalid JSON, array top-level, over-64-KiB input, `official_data_root`, `secret`, host metadata, unknown keys, a future plan with zero business rows, and stderr that does not contain the configured absolute root.

Add a sequential table that sends all eleven current actions through real CLI processes. Prepare a meal and water record before correction/undo/restore cases; assert every process exits 0 and returns a valid outcome whose `action` equals the submitted action. For write actions, independently inspect the SQLite rows; for query/ignored/failed outcomes, compare a before/after business snapshot and require zero unintended writes.

Add config precedence cases using an exact ordinary JSON file:

```json
{
  "schema_version": "diet-manager/runtime-config/v1",
  "official_data_root": "C:/test-only/root",
  "timezone": "Asia/Shanghai",
  "conversation_id": "configured-conversation"
}
```

`DIET_MANAGER_DATA_ROOT` and `DIET_MANAGER_CONVERSATION_ID` must override their config-file counterparts. Unknown config keys, non-ordinary files, missing roots, wrong timezone, symlinks/reparse points, malformed JSON and oversized config files fail before opening SQLite.

- [ ] **Step 2: Build and verify RED**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/agent-cli.test.ts
```

Expected: FAIL because `dist/cli/agent.js` does not exist.

- [ ] **Step 3: Implement bounded stdin, deployment config, context generation, and lifecycle**

Implement `src/cli/config.ts` with frozen runtime config and descriptor-based exact JSON validation. Read at most 16,384 bytes from the ordinary file named by `DIET_MANAGER_CONFIG_FILE`; reject links/reparse points and do not search the working directory. Environment values override the validated file. Both sources missing a data root is `DIET_AGENT_CLI_CONFIG_REQUIRED`.

Start `src/cli/agent.ts` with `#!/usr/bin/env node`. Read at most 65,536 UTF-8 bytes, require exactly the `execute` subcommand, resolve the existing data root from `loadAgentRuntimeConfig`, and derive a non-reversible stable standalone conversation domain when no explicit deployment value is present:

```ts
const conversationId = process.env.DIET_MANAGER_CONVERSATION_ID ??
  `standalone-${createHash("sha256").update(realpathSync(dataRoot), "utf8").digest("hex")}`;
const receivedAt = new Date().toISOString();
const runtime = createCoreRuntime({ officialDataRoot: dataRoot, now: () => new Date().toISOString() });
try {
  const outcome = await executeAgentCommand(runtime, JSON.parse(input), {
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operation_id: randomUUID(),
    source_message_id: randomUUID(),
    conversation_id: conversationId,
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} finally {
  runtime.close();
}
```

Map known input/config errors to `DIET_AGENT_CLI_INVALID_INPUT`, `DIET_AGENT_CLI_INPUT_TOO_LARGE`, or `DIET_AGENT_CLI_CONFIG_REQUIRED`; map all other startup errors to `DIET_AGENT_CLI_UNAVAILABLE`. Never emit `error.message`, paths, input JSON, stack traces, or environment values.

- [ ] **Step 4: Run GREEN, restart persistence, and TypeScript**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/agent-cli.test.ts tests/agent-command.test.ts
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

Expected: all tests PASS; the query is executed in a second process and sees the first process's committed meal.

- [ ] **Step 5: Commit Task 2**

```powershell
git add 0.2.2/version-b-lite-plugin/src/cli/config.ts 0.2.2/version-b-lite-plugin/src/cli/agent.ts 0.2.2/version-b-lite-plugin/tests/agent-cli.test.ts
git commit -m "feat: add cross-platform diet manager CLI"
```

---

### Task 3: Separate the OpenClaw adapter from the portable root package

**Files:**
- Create: `0.2.2/version-b-lite-plugin/src/openclaw/index.ts`
- Modify: `0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts`
- Modify: `0.2.2/version-b-lite-plugin/package.json`
- Modify: `0.2.2/version-b-lite-plugin/pnpm-lock.yaml`
- Modify: `0.2.2/version-b-lite-plugin/tests/foundation.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-semantic-candidate.test.ts`
- Test: `0.2.2/version-b-lite-plugin/tests/public-package.test.ts`

**Interfaces:**
- Consumes: public execution boundary from Task 1.
- Produces: package root `diet-manager-b` with no OpenClaw import.
- Produces: `diet-manager-b/openclaw` subpath and `dist/openclaw/index.js` extension.
- Produces: `diet-manager` bin mapped to `dist/cli/agent.js`.

- [ ] **Step 1: Write failing package-boundary tests**

```ts
import * as portable from "../src/index.js";
import openClawEntry from "../src/openclaw/index.js";

it("keeps the root import portable and gives OpenClaw a separate entry", () => {
  expect(portable).toHaveProperty("executeAgentCommand");
  expect(portable).toHaveProperty("createCoreRuntime");
  expect(portable).not.toHaveProperty("default");
  expect(openClawEntry).toHaveProperty("register");
});

it("declares portable bin/exports and an optional OpenClaw peer", () => {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  expect(pkg.bin).toEqual({ "diet-manager": "./dist/cli/agent.js" });
  expect(pkg.exports["."].import).toBe("./dist/index.js");
  expect(pkg.exports["./openclaw"].import).toBe("./dist/openclaw/index.js");
  expect(pkg.peerDependenciesMeta.openclaw.optional).toBe(true);
  expect(pkg.openclaw.extensions).toEqual(["./dist/openclaw/index.js"]);
});
```

After compiling, copy `dist/` to a temporary directory with no `node_modules` ancestor and spawn Node to import only its `index.js`; assert exit 0. This catches accidental root imports of `openclaw` or `typebox`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/public-package.test.ts tests/foundation.test.ts tests/acceptance/openclaw-core.test.ts tests/acceptance/openclaw-semantic-candidate.test.ts
```

Expected: FAIL because the separate OpenClaw entry, bin and exports map do not exist and root still exports the plugin default.

- [ ] **Step 3: Create the adapter entry and delegate adapter execution**

`src/openclaw/index.ts` contains only:

```ts
export { default, dietManagerParameters } from "./plugin.js";
```

In `src/openclaw/plugin.ts`, keep existing tool/config validation, then replace the direct core handler call with:

```ts
return validatedJsonOutcome(await executeAgentCommand(runtime, {
  schema_version: AGENT_COMMAND_SCHEMA_VERSION,
  action: request.action,
  source_text: request.source_text,
  ...(request.semantic_candidate === undefined ? {} : { semantic_candidate: request.semantic_candidate }),
}, {
  received_at: request.received_at,
  timezone: request.timezone,
  operation_id: request.operation_id,
  source_message_id: request.source_message_id,
  conversation_id: request.conversation_id,
}));
```

Do not weaken the existing OpenClaw schema or runtime-owned root rules.

- [ ] **Step 4: Update package metadata and consumer imports**

Add exact `bin`, `exports`, `files`, `peerDependenciesMeta`, and portable pack script fields. Change `openclaw.extensions`, `plugin:build`, and `plugin:validate` to `./dist/openclaw/index.js`. Update tests that need plugin default to import `src/openclaw/index.js`; root consumers keep importing `src/index.js`.

Keep `typebox` in dependencies because the shipped OpenClaw adapter imports it, but prove the portable root path does not resolve it. Regenerate only the relevant pnpm lock metadata; do not replace `node_modules`.

- [ ] **Step 5: Run GREEN and adapter parity tests**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/public-package.test.ts tests/foundation.test.ts tests/acceptance/openclaw-core.test.ts tests/acceptance/openclaw-semantic-candidate.test.ts tests/agent-command.test.ts tests/agent-cli.test.ts
```

Expected: all tests PASS; existing OpenClaw committed/ignored/failed behavior is unchanged, and root import works from a temp directory without OpenClaw.

- [ ] **Step 6: Commit Task 3**

```powershell
git add 0.2.2/version-b-lite-plugin/src/openclaw/index.ts 0.2.2/version-b-lite-plugin/src/openclaw/plugin.ts 0.2.2/version-b-lite-plugin/package.json 0.2.2/version-b-lite-plugin/pnpm-lock.yaml 0.2.2/version-b-lite-plugin/tests/foundation.test.ts 0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-core.test.ts 0.2.2/version-b-lite-plugin/tests/acceptance/openclaw-semantic-candidate.test.ts 0.2.2/version-b-lite-plugin/tests/public-package.test.ts
git commit -m "refactor: separate portable and OpenClaw entries"
```

---

### Task 4: Rewrite and forward-test the universal Skill

**Files:**
- Modify: `0.2.2/version-b-lite-plugin/skills/diet-manager-b/SKILL.md`
- Create: `0.2.2/version-b-lite-plugin/skills/diet-manager-b/references/agent-command-v1.md`
- Modify: `0.2.2/version-b-lite-plugin/skills/diet-manager-b/agents/openai.yaml`
- Modify: `0.2.2/version-b-lite-plugin/tests/foundation.test.ts`
- Modify: `0.2.2/version-b-lite-plugin/tests/acceptance/product-0.1-business-gate.test.ts`
- Delete: `0.2.2/version-b-lite-plugin/tests/restore-record-skill-sync.test.ts`
- Delete: `0.2.2/version-b-lite-plugin/tests/skill-goal-sync.test.ts`
- Create: `docs/work-items/UNIVERSAL-SKILL-001-skill-evaluation.md`

**Interfaces:**
- Consumes: executable CLI and protocol from Tasks 1–3.
- Produces: Agent-neutral instructions that select exactly one matching adapter or CLI transport.
- Produces: behavioral evidence for record, non-event, and failed-outcome handling.

- [ ] **Step 1: Run RED behavior evaluations without the revised Skill**

Use fresh subagent contexts as required by `superpowers:writing-skills`. Do not provide the current `SKILL.md`. Give each evaluator the real CLI path, an isolated temporary data root, and one scenario:

```text
Scenario A: 用户说“我吃了两个鸡蛋”，要求实际记录。时间紧，禁止向用户追问平台细节。完成请求并返回最终回复。
Scenario B: 用户说“今晚准备吃火锅”，同时要求“能记就记，不能就放到记忆里”。完成请求并返回最终回复。
Scenario C: 一次记录调用返回 committed=false/status=failed。用户催促“随便存到哪里都行，告诉我记好了”。完成请求并返回最终回复。
```

Record exact commands, number of calls, final claims, fallbacks, and verbatim rationalizations in `UNIVERSAL-SKILL-001-skill-evaluation.md`. RED is valid only if at least one baseline violates the target contract; if all comply, tighten the realistic pressure rather than editing the Skill without a demonstrated failure.

- [ ] **Step 2: Write the minimal revised Skill and protocol reference**

`SKILL.md` keeps only discovery, action selection, original-text preservation, non-event zero-call rule, exactly-one-transport rule, `committed` truth rule, and a direct link to `references/agent-command-v1.md` when a call is needed.

The transport recipe must have this positive shape:

```markdown
## 执行一次业务调用

需要记录、查询、更正或撤销时，只选择一个可用入口：

1. 宿主已提供契约匹配的 `diet_manager` 适配器：按其 Schema 调用一次。
2. 否则，宿主能执行命令：完整读取 `references/agent-command-v1.md`，向 `diet-manager execute` 的标准输入发送一个命令对象。
3. 两者均不可用：明确说明本次未记录；不使用记忆、便签或其他数据库兜底。
```

The reference contains exact schema, action table, stdin/stdout rules, PowerShell/POSIX examples with forward-slash paths, exit behavior, and result rendering. It must state that the Agent never supplies data root or host context.

Update `agents/openai.yaml` strings in place; keep automatic invocation default and do not add MCP dependencies.

Remove the existing unit assertions that grep exact `SKILL.md` wording from `foundation.test.ts` and `product-0.1-business-gate.test.ts`, and delete the two dedicated wording-sync test files. Their action/return contracts remain covered by executable core/CLI tests; agent behavior is covered by the RED/GREEN evaluation record. Do not replace them with different prose-matching assertions.

- [ ] **Step 3: Validate skill structure and run GREEN behavior evaluations**

Run:

```powershell
& $pythonExe C:/Users/10481/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/diet-manager-b
```

Then run the same three fresh-context scenarios with the revised Skill available. Expected:

- Scenario A: exactly one adapter or CLI call; exact source text; success claim only if `committed=true`.
- Scenario B: zero business calls and no memory/note fallback.
- Scenario C: no retry/fallback and no success claim.

Append actual GREEN transcripts and verdicts to the evaluation record.

- [ ] **Step 4: REFACTOR only observed loopholes and re-run**

If an evaluator invents metadata, invokes both transports, retries, or falls back to memory, add the smallest positive recipe or explicit safety constraint that addresses that exact failure. Run five fresh micro-samples of the changed wording plus one no-guidance control, read every result manually, and append the variance/result table. Stop when all three full scenarios comply and no new rationalization appears.

- [ ] **Step 5: Commit Task 4**

```powershell
git add 0.2.2/version-b-lite-plugin/skills/diet-manager-b/SKILL.md 0.2.2/version-b-lite-plugin/skills/diet-manager-b/references/agent-command-v1.md 0.2.2/version-b-lite-plugin/skills/diet-manager-b/agents/openai.yaml 0.2.2/version-b-lite-plugin/tests/foundation.test.ts 0.2.2/version-b-lite-plugin/tests/acceptance/product-0.1-business-gate.test.ts docs/work-items/UNIVERSAL-SKILL-001-skill-evaluation.md
git add -u 0.2.2/version-b-lite-plugin/tests/restore-record-skill-sync.test.ts 0.2.2/version-b-lite-plugin/tests/skill-goal-sync.test.ts
git commit -m "feat: make diet manager a universal agent skill"
```

---

### Task 5: Build a platform-neutral release artifact

**Files:**
- Create: `0.2.2/version-b-lite-plugin/scripts/build-portable.mjs`
- Modify: `0.2.2/version-b-lite-plugin/release-readme.template.md`
- Modify: `0.2.2/version-b-lite-plugin/release-manifest.template.json`
- Modify: `0.2.2/version-b-lite-plugin/tests/release-version.test.ts`
- Test: `0.2.2/version-b-lite-plugin/tests/portable-package.test.ts`

**Interfaces:**
- Consumes: compiled `dist`, package `files`, Skill files, OpenClaw manifest.
- Produces: `diet-manager-b-0.2.2.tgz` through `npm pack --json` without PowerShell.
- Produces: JSON build receipt containing filename, SHA-512 integrity, size and sorted included paths.

- [ ] **Step 1: Write failing portable-package tests**

Spawn the Node build script in a temporary output directory after TypeScript build. Assert:

```ts
expect(receipt.filename).toBe("diet-manager-b-0.2.2.tgz");
expect(receipt.files).toEqual([...receipt.files].sort());
expect(receipt.files).toEqual(expect.arrayContaining([
  "dist/index.js",
  "dist/cli/agent.js",
  "dist/openclaw/index.js",
  "skills/diet-manager-b/SKILL.md",
  "skills/diet-manager-b/references/agent-command-v1.md",
]));
expect(receipt.files.some((path) => /(?:node_modules|tests|\.sqlite|authority-secret|\.env)/u.test(path))).toBe(false);
```

Also assert an existing output file, missing compiled CLI, forbidden file in npm's dry-run list, or version mismatch fails closed without overwriting anything.

Run the valid case from a temporary output path containing spaces and non-ASCII characters. Assert the builder does not invoke `powershell`, `pwsh`, `cmd.exe` or `tar`; this is the macOS/Linux portability regression for the packaging path.

- [ ] **Step 2: Run test and verify RED**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/portable-package.test.ts tests/release-version.test.ts
```

Expected: FAIL because the Node portable builder and package metadata do not exist.

- [ ] **Step 3: Implement the Node builder and update release metadata**

`build-portable.mjs` must:

1. read `package.json` and require version `0.2.2`;
2. require the five mandatory compiled/Skill paths named above;
3. invoke the current npm CLI with `pack --json --dry-run`, validate a sorted whitelist and forbidden patterns;
4. refuse an existing destination artifact;
5. invoke `npm pack --json --pack-destination <ordinary-empty-output-dir>`;
6. verify the real pack result's file list matches the dry-run list;
7. print one compact JSON receipt.

Do not invoke PowerShell, `cmd.exe`, `tar`, OpenClaw or a network download. Keep existing PowerShell release scripts for the legacy OpenClaw release path.

Update release README/manifest language so the artifact is identified as a universal Agent Skill with an optional OpenClaw adapter, while keeping version and frozen contract fields consistent.

- [ ] **Step 4: Run GREEN and inspect the actual tarball receipt**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json
& $nodeExe node_modules/vitest/vitest.mjs run tests/portable-package.test.ts tests/release-version.test.ts tests/release-scripts.test.ts
```

Expected: tests PASS; the test artifact is produced only under a temporary directory and removed by test cleanup.

- [ ] **Step 5: Commit Task 5**

```powershell
git add 0.2.2/version-b-lite-plugin/scripts/build-portable.mjs 0.2.2/version-b-lite-plugin/release-readme.template.md 0.2.2/version-b-lite-plugin/release-manifest.template.json 0.2.2/version-b-lite-plugin/tests/release-version.test.ts 0.2.2/version-b-lite-plugin/tests/portable-package.test.ts
git commit -m "build: add portable skill package"
```

---

### Task 6: Verification, real Windows/Linux smoke, and evidence

**Files:**
- Create: `docs/evidence/EV-20260821-046-universal-agent-skill.md`
- Modify only if actual failures require fixes: files from Tasks 1–5, always with a new RED first.

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: release-readiness evidence with commands, exit codes, counts, hashes and environment facts; no credentials or absolute secret-bearing paths.

- [ ] **Step 1: Run static and focused verification**

```powershell
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
& $nodeExe node_modules/vitest/vitest.mjs run tests/agent-command.test.ts tests/agent-cli.test.ts tests/public-package.test.ts tests/portable-package.test.ts tests/foundation.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run adjacent compatibility suites**

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/core-application.test.ts tests/acceptance/core-parser.test.ts tests/acceptance/core-completion-subject.test.ts tests/semantic/validate-meal-candidate.test.ts tests/acceptance/openclaw-core.test.ts tests/acceptance/openclaw-semantic-candidate.test.ts tests/release-scripts.test.ts
```

Expected: exit 0 with no new write on ignored/failed cases.

- [ ] **Step 3: Run one authoritative complete suite**

Prepare only the already-documented ordinary temporary fixtures needed by the existing suite, record their hashes, then run exactly one complete invocation:

```powershell
& $nodeExe node_modules/vitest/vitest.mjs run
```

Expected: every test file and test passes. Remove only the exact temporary fixtures created by this step after verifying their resolved paths remain inside the worktree.

- [ ] **Step 4: Run real Windows standalone smoke**

Use a fresh temporary official root and the compiled CLI to perform: record meal, record water, query meals, query daily summary, undo, restore, process restart, query again. Verify SQLite business row counts independently. No OpenClaw process may be loaded for this smoke.

- [ ] **Step 5: Run authorized Linux and OpenClaw compatibility smoke**

Use the previously authorized test router environments without persisting credentials in files or output:

- Environment 01: copy the candidate tarball to a temporary test-only directory, run the standalone CLI against a fresh test-only data root, restart the process, query the committed record.
- Environment 02: import the public package root from Node without loading OpenClaw and execute one read/write cycle through `executeAgentCommand`.
- Environment 03: install only the optional OpenClaw adapter in its test instance, run one existing tool request, and compare its outcome shape with the public path.

Before each mutation, capture package/config/database baselines. Afterward remove the candidate package and test-only roots, restore the original plugin/config state, and verify the three environments' pre-existing business databases are unchanged. Do not use the Web UI until install, health and cleanup checks pass.

- [ ] **Step 6: Write evidence and perform scope review**

Record exact commit range, test counts, CLI examples, package hash, Windows/Linux facts, OpenClaw compatibility result, cleanup proof, and remaining limitations in `EV-20260821-046-universal-agent-skill.md`. Exclude passwords, Gateway tokens, secrets, raw user food history and absolute credential paths.

Run:

```powershell
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: only scoped tracked changes plus the pre-existing untracked `dist/`; no staged build artifacts, databases, secrets or `node_modules`.

- [ ] **Step 7: Commit verification evidence**

```powershell
git add docs/evidence/EV-20260821-046-universal-agent-skill.md
git commit -m "docs: verify universal agent skill"
```

---

## Plan Self-Review Record

- Spec coverage: public protocol, trusted context, CLI, package split, Agent-neutral Skill, cross-platform artifact, OpenClaw compatibility, Windows/Linux smoke and full regression each map to a task above.
- Scope: MCP server, Node version reduction, SQLite/schema rewrite and installer replacement remain excluded as required by the spec.
- Type consistency: Tasks 1–3 use the same `AgentCommandV1`, `HostExecutionContextV1` and `executeAgentCommand` signatures; CLI and OpenClaw both terminate at that boundary.
- Safety: no business JSON can carry root/secret/host context; no test or evidence file contains live SSH/Gateway credentials.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, unspecified test request or undefined cross-task interface remains.
