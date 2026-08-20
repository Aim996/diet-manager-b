# 0.2.1 Iteration 1 Profile and Goal Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 0.2.1 独立副本中修复真机暴露的档案、热量目标、饮水目标和单项清除自然表达，并证明请求 action、parser action、数据库写入三者一致。

**Architecture:** 从当前 `version-b-lite-plugin` 与 `shared` 建立不含依赖、构建产物和运行数据的 0.2.1 基线。保持 `parseCoreCommand` 的专用 parser 优先顺序和 `ACTION_CONFLICT` 守卫，只扩展 `profile.ts` 与 `goal.ts` 的有界语法，并在 parser 与 application 两层验证真实原话。

**Tech Stack:** TypeScript 5、Vitest、Node.js 24、SQLite/better-sqlite3、pnpm。

**Spec:** `0.2.1/0.2.1-整合修复总计划-08-20-13.06.md`

## Global Constraints

- 所有新增或修改的源码、测试、计划和迭代记录必须位于 `0.2.1/`。
- 不修改根级 `version-b-lite-plugin/`、`shared/` 或现有 0.2.0 冻结材料。
- 不复制 `node_modules/`、`dist/`、`data/`、coverage、SQLite、secret、日志或临时证据。
- 不删除 `ACTION_CONFLICT` 守卫，不让模型 action 成为唯一权威。
- parser 保持确定性、fail-closed，并保留明确非本人和普通餐食反例。
- 每项生产行为必须先看到对应测试因缺少该行为而失败，再写最小实现。
- 第一轮只处理 profile 与 goal；subject/water ingestion、correction、purchase、安装器和结构债进入后续迭代。

---

### Task 1: Establish the 0.2.1 isolated baseline

**Files:**
- Create: `0.2.1/version-b-lite-plugin/**`
- Create: `0.2.1/shared/**`
- Preserve: `version-b-lite-plugin/**`
- Preserve: `shared/**`

**Interfaces:**
- Consumes: 当前主线源码、测试、package metadata 与 shared 验收资产。
- Produces: 相对路径仍为 `version-b-lite-plugin/../shared` 的独立、可测试 0.2.1 工作副本。

- [ ] **Step 1: Copy the source baseline**

  复制 `version-b-lite-plugin`，排除 `node_modules`、`dist`、`data`、`coverage`、数据库、日志和压缩包；复制 `shared`，排除机器本地 route map、临时文件、数据库、日志和原始会话证据。

- [ ] **Step 2: Verify the baseline inventory**

  Run:

  ```powershell
  rg --files 0.2.1/version-b-lite-plugin/src | Measure-Object
  rg --files 0.2.1/version-b-lite-plugin/tests | Measure-Object
  Test-Path 0.2.1/version-b-lite-plugin/node_modules
  Test-Path 0.2.1/version-b-lite-plugin/dist
  Test-Path 0.2.1/version-b-lite-plugin/data
  ```

  Expected: source count 76, test count at least 69, and all three excluded directories return `False`.

- [ ] **Step 3: Install dependencies without changing the root project**

  Run:

  ```powershell
  pnpm install --frozen-lockfile
  ```

  Workdir: `0.2.1/version-b-lite-plugin`

  Expected: exit 0 and dependencies materialize only below the 0.2.1 copy.

- [ ] **Step 4: Verify the copied baseline builds**

  Run:

  ```powershell
  pnpm build
  pnpm exec vitest run tests/acceptance/core-profile-parser.test.ts tests/acceptance/core-goal-parser.test.ts
  ```

  Expected: build and the pre-existing canonical profile/goal tests pass.

- [ ] **Step 5: Commit the isolated baseline**

  ```powershell
  git add 0.2.1/version-b-lite-plugin 0.2.1/shared
  git commit -m "chore: establish 0.2.1 isolated baseline"
  ```

### Task 2: Prove the real gateway phrases fail for the intended reasons

**Files:**
- Modify: `0.2.1/version-b-lite-plugin/tests/acceptance/natural-language-regressions-0.2.1.test.ts`
- Modify: `0.2.1/version-b-lite-plugin/tests/acceptance/core-profile-parser.test.ts`
- Modify: `0.2.1/version-b-lite-plugin/tests/acceptance/core-goal-parser.test.ts`

**Interfaces:**
- Consumes: `parseCoreCommand(value: unknown): CoreParseResult`.
- Produces: literal parser expectations for the real 02/04 gateway phrases and bounded negative examples.

- [ ] **Step 1: Make test message identifiers collision-free**

  Replace length-derived identifiers in the regression helper with a monotonic local sequence so distinct equal-length phrases do not share `operation_id` or `source_message_id`:

  ```ts
  let inputSequence = 0;

  function parse(sourceText: string) {
    inputSequence += 1;
    return parseCoreCommand({
      source_text: sourceText,
      received_at: "2026-08-20T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: `operation-natural-${inputSequence}`,
      source_message_id: `message-natural-${inputSequence}`,
      conversation_id: "conversation-natural-regressions-021",
      prior_context: [],
    });
  }
  ```

- [ ] **Step 2: Add profile boundary cases**

  Add literal expectations that these are `set_profile/candidate`: `想开始减脂了，我28岁女生，175高，65公斤。` and `我的身高是175，体重差不多65公斤。` Add negative cases showing `175高` alone and `65公斤` alone yield `set_profile/profile_incomplete`, while `吃了175克米饭和65克鸡蛋` remains `record_meal`.

- [ ] **Step 3: Add goal boundary cases**

  Add literal expectations for `以后每天热量按1900大卡算就行。` → `energy_kcal: 1900`, `每天喝水先按1200毫升算。` → `water_ml: 1200`, and `蛋白质这一栏暂时不用给我定。` → `protein_g: null`. Add negative cases for a named goal without a value and for one message that both clears and sets the same dimension; both must return `set_goal/goal_incomplete`.

- [ ] **Step 4: Run the focused tests and verify RED**

  Run:

  ```powershell
  pnpm exec vitest run tests/acceptance/natural-language-regressions-0.2.1.test.ts tests/acceptance/core-profile-parser.test.ts tests/acceptance/core-goal-parser.test.ts
  ```

  Expected: existing canonical cases pass; new natural profile and goal cases fail because they currently fall through or return incomplete. Negative meal and ambiguous mixed-goal cases must not be the source of unexpected failures.

- [ ] **Step 5: Commit the failing characterization tests**

  ```powershell
  git add 0.2.1/version-b-lite-plugin/tests/acceptance
  git commit -m "test: characterize 0.2.1 profile and goal language gaps"
  ```

### Task 3: Implement bounded natural profile parsing

**Files:**
- Modify: `0.2.1/version-b-lite-plugin/src/parser/profile.ts`
- Test: `0.2.1/version-b-lite-plugin/tests/acceptance/core-profile-parser.test.ts`
- Test: `0.2.1/version-b-lite-plugin/tests/acceptance/natural-language-regressions-0.2.1.test.ts`

**Interfaces:**
- Consumes: `CoreParseInput.source_text`.
- Produces: existing `CoreProfileCommandCandidate` with `height_cm`, `weight_kg`, optional `sex`, `age`, and `goal_state`; incomplete profile evidence returns the existing `profile_incomplete` contract.

- [ ] **Step 1: Extend only the bounded profile evidence patterns**

  Use label-aware alternatives that accept connectors without matching ordinary food quantities:

  ```ts
  const HEIGHT_PATTERN = /(?:身高\s*(?:是|为|差不多|大概|约|左右)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:厘米|公分|cm|CM|Cm)?|(\d{1,3}(?:\.\d{1,2})?)\s*(?:厘米|公分|cm|CM|Cm)?\s*高)/u;
  const WEIGHT_PATTERN = /(?:体重\s*(?:是|为|差不多|大概|约)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:公斤|千克|kg|KG|Kg)(?:左右)?|(?:^|[，,。；;\s])\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:公斤|千克|kg|KG|Kg)(?:左右)?(?=$|[，,。；;\s]))/u;
  ```

  Read the first defined capture from each match, keep the existing numeric ranges, and treat either height or weight evidence as profile intent. The unlabeled weight alternative is only eligible when the same message has height evidence, age/sex evidence, or a profile goal-state word.

- [ ] **Step 2: Run profile tests and verify GREEN**

  Run:

  ```powershell
  pnpm exec vitest run tests/acceptance/core-profile-parser.test.ts tests/acceptance/natural-language-regressions-0.2.1.test.ts
  ```

  Expected: profile natural phrases pass; ordinary meal quantities remain meal candidates.

- [ ] **Step 3: Refactor duplicated capture selection**

  Add a private helper that returns the first defined numeric capture from a `RegExpExecArray`, use it in height and weight parsing, and rerun the same tests.

- [ ] **Step 4: Commit the profile parser fix**

  ```powershell
  git add 0.2.1/version-b-lite-plugin/src/parser/profile.ts 0.2.1/version-b-lite-plugin/tests/acceptance
  git commit -m "fix: parse bounded natural profile phrases"
  ```

### Task 4: Implement bounded natural goal parsing

**Files:**
- Modify: `0.2.1/version-b-lite-plugin/src/parser/goal.ts`
- Test: `0.2.1/version-b-lite-plugin/tests/acceptance/core-goal-parser.test.ts`
- Test: `0.2.1/version-b-lite-plugin/tests/acceptance/natural-language-regressions-0.2.1.test.ts`

**Interfaces:**
- Consumes: `CoreParseInput.source_text` and the existing six `GoalField` dimensions.
- Produces: existing `CoreGoalCommandCandidate.goals` values or the existing `goal_incomplete` clarification contract.

- [ ] **Step 1: Broaden bounded goal intent detection**

  Replace the single `目标` entry gate with explicit goal-intent evidence: the word `目标`, a daily-setting frame such as `每天…按…算/定`, or a named dimension with a bounded clear phrase such as `这一栏先不设/不用定/去掉`.

- [ ] **Step 2: Add per-dimension natural set and clear forms**

  In `extractGoal`, preserve canonical `维度目标数值` parsing and add:

  ```ts
  const dailySet = new RegExp(`每天\\s*(?:${keywords})?\\s*(?:先\\s*)?按\\s*${GOAL_NUMBER}\\s*(?:大卡|千卡|毫升|ml|ML)?\\s*(?:算|定)`, "u");
  const dimensionDailySet = new RegExp(`每天\\s*(?:${keywords})\\s*(?:先\\s*)?按\\s*${GOAL_NUMBER}`, "u");
  const naturalClear = new RegExp(`(?:${keywords})(?:\\s*这一栏)?\\s*(?:暂时|先)?\\s*(?:不用|不需要|不要)(?:\\s*给我)?\\s*(?:设|定)|(?:去掉|清掉|取消)\\s*(?:${keywords})(?:\\s*目标)?`, "u");
  ```

  Energy may omit the dimension only when an energy unit (`大卡/千卡`) is present; water may omit the dimension only when `喝水/饮水/水` is present. If the same dimension has both clear and set evidence, return `"incomplete"` so the caller asks one deterministic clarification question.

- [ ] **Step 3: Run goal tests and verify GREEN**

  Run:

  ```powershell
  pnpm exec vitest run tests/acceptance/core-goal-parser.test.ts tests/acceptance/natural-language-regressions-0.2.1.test.ts
  ```

  Expected: natural calorie, water, and protein-clear cases pass; canonical forms still pass; mixed clear/set remains fail-closed.

- [ ] **Step 4: Commit the goal parser fix**

  ```powershell
  git add 0.2.1/version-b-lite-plugin/src/parser/goal.ts 0.2.1/version-b-lite-plugin/tests/acceptance
  git commit -m "fix: parse bounded natural goal phrases"
  ```

### Task 5: Prove application and database consistency

**Files:**
- Modify: `0.2.1/version-b-lite-plugin/tests/acceptance/set-profile-application.test.ts`
- Modify: `0.2.1/version-b-lite-plugin/tests/acceptance/set-goal-application.test.ts`

**Interfaces:**
- Consumes: `handleCoreRequest`, `createCoreRuntime`, and SQLite tables `user_profiles` / `goal_versions`.
- Produces: regression proof that real natural phrases do not return `ACTION_CONFLICT` and persist the intended values.

- [ ] **Step 1: Add natural profile application coverage**

  Add a test using `想开始减脂了，我28岁女生，175高，65公斤。`; assert `status: "committed"`, `committed: true`, one profile row with height 175, weight 65, sex female, age 28, state cut, and one derived goal version.

- [ ] **Step 2: Add natural goal application coverage**

  Starting from a canonical profile, submit `以后每天热量按1900大卡算就行。`, then `蛋白质这一栏暂时不用给我定。`; assert both commit and the latest `goal_versions.payload_json` contains `energy_kcal: 1900` and `protein_g: null`.

- [ ] **Step 3: Run application tests**

  Run:

  ```powershell
  pnpm exec vitest run tests/acceptance/set-profile-application.test.ts tests/acceptance/set-goal-application.test.ts
  ```

  Expected: all application tests pass with real SQLite writes; no outcome has reason code `ACTION_CONFLICT`.

- [ ] **Step 4: Commit application coverage**

  ```powershell
  git add 0.2.1/version-b-lite-plugin/tests/acceptance/set-profile-application.test.ts 0.2.1/version-b-lite-plugin/tests/acceptance/set-goal-application.test.ts
  git commit -m "test: verify natural profile and goal database writes"
  ```

### Task 6: Verify iteration 1 and record the handoff

**Files:**
- Create: `0.2.1/迭代记录-01-profile-goal.md`

**Interfaces:**
- Consumes: all Task 1–5 changes and test results.
- Produces: reproducible test commands, pass counts, remaining P0 scope, and any known platform skips.

- [ ] **Step 1: Run focused regression and build**

  ```powershell
  pnpm build
  pnpm exec vitest run tests/acceptance/core-profile-parser.test.ts tests/acceptance/core-goal-parser.test.ts tests/acceptance/set-profile-application.test.ts tests/acceptance/set-goal-application.test.ts
  pnpm exec vitest run tests/acceptance/natural-language-regressions-0.2.1.test.ts -t "profile|goal"
  ```

  Expected: exit 0 with no warnings or unhandled errors.

- [ ] **Step 2: Confirm the remaining natural-language characterization failures**

  ```powershell
  pnpm exec vitest run tests/acceptance/natural-language-regressions-0.2.1.test.ts
  ```

  Expected: the 11 profile/goal/non-self assertions pass; exactly 7 subject/water-ingestion, correction, and purchase assertions remain red for later iterations. Any profile or goal failure blocks completion of this iteration.

- [ ] **Step 3: Run the portable candidate suite available on this host**

  Until `test:portable` is introduced by the installation/platform iteration, run the TypeScript build plus the parser/application acceptance groups that do not require PowerShell native guards. Record every skipped Windows-only group explicitly; do not report a mixed platform run as fully green.

- [ ] **Step 4: Write the iteration record**

  Record the exact commands, exit codes, test counts, fixed phrases, preserved negative cases, and remaining work: subject/water, correction, purchase, setup false-green, reply/DB consistency, installation/persistence, and structural debt.

- [ ] **Step 5: Commit the verified iteration**

  ```powershell
  git add 0.2.1/迭代记录-01-profile-goal.md
  git commit -m "docs: record 0.2.1 profile goal iteration"
  ```
