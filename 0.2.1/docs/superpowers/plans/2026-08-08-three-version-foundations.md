# 饮食管家 0.1 三版本基底实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\codx\饮食管家` 建立三个彼此隔离、可审阅和可继续开发的 OpenClaw 0.1 工程基底。

**Architecture:** 根目录保存共同业务契约与验收案例。A 只含 Skill 与固定 JSONL 存储约定；B 使用一个极简 TypeScript OpenClaw 插件与 SQLite 边界；C 使用显式状态类型的强约束 TypeScript 插件与 SQLite 边界。三个版本不共享运行时代码。

**Tech Stack:** Markdown、JSON、TypeScript、Vitest、TypeBox、OpenClaw `defineToolPlugin` 与原生插件清单；B/C 的 SQLite 驱动在完整业务设计确认后选择，基底阶段不引入数据库依赖。

## Global Constraints

- 正式业务只有饮食摄入和商品入库两类写入事件。
- 三个版本只能修改各自目录；公共文件由根任务维护。
- A 的正式存储目标固定为自身 `data/*.jsonl`；B/C 的正式存储目标固定为自身运行时数据目录中的 SQLite 文件。
- 不从旧 `personal-diet-pantry` 复制实现或大段规则。
- 基底只提供可验证的结构、接口和边界，不伪装成已经完成的记账产品。
- 不加入体重、饮水目标、菜谱、健康诊断、推荐、撤销重做或复杂报表。
- B/C 必须由 OpenClaw `plugins validate` 证明可发现与加载；普通 Node import 不能替代该验证。

---

### Task 1: A 版纯 Skill 基底

**Files:**
- Create: `version-a-skill-only/skills/diet-manager-a/SKILL.md`
- Create: `version-a-skill-only/skills/diet-manager-a/agents/openai.yaml`
- Create: `version-a-skill-only/storage-contract.md`
- Create: `version-a-skill-only/data/.gitkeep`
- Create: `version-a-skill-only/tests/validate-foundation.ps1`

**Interfaces:**
- Consumes: `shared/business-contract.md` and `shared/acceptance-cases/cases.json`.
- Produces: a prompt-only OpenClaw Skill whose official records are append-only JSONL under its own data directory.

- [ ] Write a PowerShell structure test that fails while the required files and storage prohibitions are missing.
- [ ] Run `powershell -ExecutionPolicy Bypass -File tests/validate-foundation.ps1` and confirm failure.
- [ ] Add the minimal Skill, UI metadata and storage contract needed for the test to pass.
- [ ] Re-run the same command and confirm exit code 0.

### Task 2: B 版极简插件基底

**Files:**
- Create: `version-b-lite-plugin/package.json`
- Create: `version-b-lite-plugin/tsconfig.json`
- Create: `version-b-lite-plugin/openclaw.plugin.json`
- Create: `version-b-lite-plugin/src/contracts.ts`
- Create: `version-b-lite-plugin/src/index.ts`
- Create: `version-b-lite-plugin/tests/foundation.test.ts`
- Create: `version-b-lite-plugin/skills/diet-manager-b/SKILL.md`
- Create: `version-b-lite-plugin/skills/diet-manager-b/agents/openai.yaml`
- Create: `version-b-lite-plugin/data/.gitkeep`

**Interfaces:**
- Consumes: the shared business contract and acceptance cases.
- Produces: one native OpenClaw `defineToolPlugin` tool named `diet_manager` with exactly four declared actions: `record_meal`, `add_inventory`, `query_inventory`, `query_meals`; action handlers return an explicit not-implemented foundation outcome without writing business data.

- [ ] Write Vitest assertions for the exact tool/action boundary and non-writing foundation outcome.
- [ ] Run `npm test` and confirm the test fails before the implementation exists.
- [ ] Add the smallest compileable TypeScript contracts, plugin entry and Skill needed by the assertions.
- [ ] Run `npm test`, `npm run build`, and `npm run plugin:validate`; all must exit 0.

### Task 3: C 版强约束插件基底

**Files:**
- Create: `version-c-strict-plugin/package.json`
- Create: `version-c-strict-plugin/tsconfig.json`
- Create: `version-c-strict-plugin/openclaw.plugin.json`
- Create: `version-c-strict-plugin/src/contracts.ts`
- Create: `version-c-strict-plugin/src/state-machine.ts`
- Create: `version-c-strict-plugin/src/index.ts`
- Create: `version-c-strict-plugin/tests/foundation.test.ts`
- Create: `version-c-strict-plugin/skills/diet-manager-c/SKILL.md`
- Create: `version-c-strict-plugin/skills/diet-manager-c/agents/openai.yaml`
- Create: `version-c-strict-plugin/data/.gitkeep`

**Interfaces:**
- Consumes: the shared business contract and acceptance cases.
- Produces: one native OpenClaw `defineToolPlugin` tool `diet_manager_strict`; commands distinguish `classify`, `preview_meal`, `commit_meal`, `preview_purchase`, `commit_purchase`, `query_inventory`, and `query_meals`. The foundation state machine permits only idle-to-preview and preview-to-commit declarations; every handler remains non-writing until the complete design is approved.

- [ ] Write Vitest assertions for the exact commands, state names, invalid transition rejection and zero-write foundation behavior.
- [ ] Run `npm test` and confirm failure before implementation.
- [ ] Add minimal compileable contracts, state transition validator, plugin entry and Skill.
- [ ] Run `npm test`, `npm run build`, and `npm run plugin:validate`; all must exit 0.

### Task 4: Root integration verification

**Files:**
- Create: `shared/validate-foundations.ps1`

**Interfaces:**
- Consumes: all three completed version directories.
- Produces: one read-only command that validates shared JSON, runs A's structure check, and runs B/C tests and builds without modifying business data.

- [ ] Write the root validation script with explicit commands and fail-fast behavior.
- [ ] Run it once and inspect every child command's exit code.
- [ ] Confirm the validation creates no JSONL record and no SQLite database.
- [ ] Re-read `docs/0.1-foundation-design.md` and verify every基底完成条件 has direct evidence.
