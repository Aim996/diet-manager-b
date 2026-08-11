# GitHub and OpenClaw Development Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a truthful, machine-verifiable GitHub development handoff that OpenClaw can clone, validate, install, and safety-test without treating the foundation as a production diet tracker.

**Architecture:** Keep the B plugin and Skill as the only runnable route. Add one machine-readable handoff manifest, one cross-platform validator, one Vitest contract test, and a small set of human entry documents; validate them locally, then on three independent OpenClaw Gateways before merging the delivery branch.

**Tech Stack:** Markdown, JSON, Node.js `>=24.15.0 <25`, TypeScript, Vitest, pnpm, OpenClaw CLI 2026.x, GitHub CLI.

## Global Constraints

- The package status is `foundation_development_only`; it is not PRODUCT-0.1.
- Every write action remains `foundation_not_implemented` with `committed=false`.
- Installation and verification must create zero `.sqlite`, `.sqlite3`, `.db`, and `.jsonl` business files.
- Never persist OpenClaw Gateway tokens, GitHub credentials, user diet data, or raw private diagnostics.
- Do not read, hash, modify, track, or execute the five protected lease files listed in `.gitignore`.
- Only route B is developed; A and C remain excluded from publication.
- Work on `agent/github-openclaw-development-handoff`; merge to `main` only after local and three-Gateway verification.

---

### Task 1: Register the development handoff work item and failing contract

**Files:**
- Create: `docs/work-items/SH-HANDOFF-001-brief.md`
- Create: `version-b-lite-plugin/tests/handoff-contract.test.ts`

**Interfaces:**
- Consumes: existing repository root, `version-b-lite-plugin/package.json`, and OpenClaw plugin/Skill paths.
- Produces: exact required manifest path `delivery/openclaw-development-handoff.json` and validator path `scripts/validate-openclaw-development-handoff.mjs`.

- [ ] **Step 1: Write the work-item brief with exact status and acceptance gates**

```markdown
# SH-HANDOFF-001

- Status: in_progress
- Product status: foundation_development_only
- Branch: agent/github-openclaw-development-handoff
- Required local gates: handoff contract, package tests, build, plugin validate, leak scan
- Required external gates: OpenClaw 02 install, OpenClaw 03 behavior, OpenClaw 04 zero-write cleanup
- Explicit non-goal: PRODUCT-0.1 installer or real business database
```

- [ ] **Step 2: Write a Vitest test that requires the missing handoff files and exact safety fields**

```ts
expect(manifest.schema_version).toBe("diet-manager-openclaw-development-handoff/v1");
expect(manifest.product_status).toBe("foundation_development_only");
expect(manifest.safety.production_ready).toBe(false);
expect(manifest.safety.writes_business_data).toBe(false);
expect(manifest.safety.expected_write_status).toBe("foundation_not_implemented");
expect(manifest.safety.expected_committed).toBe(false);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run from `version-b-lite-plugin`:

```powershell
pnpm vitest run tests/handoff-contract.test.ts
```

Expected: FAIL because `delivery/openclaw-development-handoff.json` and the validator do not exist.

- [ ] **Step 4: Commit only the brief and RED test**

```powershell
git add docs/work-items/SH-HANDOFF-001-brief.md version-b-lite-plugin/tests/handoff-contract.test.ts
git commit -m "test: define GitHub OpenClaw handoff contract"
```

### Task 2: Implement the machine-readable handoff and validator

**Files:**
- Create: `delivery/openclaw-development-handoff.json`
- Create: `scripts/validate-openclaw-development-handoff.mjs`
- Create: `version-b-lite-plugin/pnpm-workspace.yaml`
- Modify: `version-b-lite-plugin/package.json`

**Interfaces:**
- Consumes: exact paths and safety assertions from Task 1.
- Produces: `pnpm handoff:validate` and a JSON manifest containing repository, package root, runtime, commands, and safety policy.

- [ ] **Step 1: Add the manifest with exact development commands**

```json
{
  "schema_version": "diet-manager-openclaw-development-handoff/v1",
  "product_status": "foundation_development_only",
  "repository": {
    "url": "https://github.com/Aim996/diet-manager-b.git",
    "default_branch": "main",
    "private": true
  },
  "package_root": "version-b-lite-plugin",
  "runtime": {
    "node": ">=24.15.0 <25",
    "pnpm": ">=11 <12",
    "openclaw": ">=2026.5.17"
  },
  "commands": {
    "install_dependencies": "pnpm install --frozen-lockfile",
    "test": "pnpm test",
    "build": "pnpm build",
    "validate_handoff": "pnpm handoff:validate",
    "validate_plugin": "pnpm plugin:validate",
    "install_plugin": "openclaw plugins install ./version-b-lite-plugin",
    "install_skill": "openclaw skills install ./version-b-lite-plugin/skills/diet-manager-b --as diet-manager-b"
  },
  "safety": {
    "production_ready": false,
    "writes_business_data": false,
    "expected_write_status": "foundation_not_implemented",
    "expected_committed": false
  }
}
```

- [ ] **Step 2: Implement the validator as a read-only Node CLI**

The validator must resolve the repository from `import.meta.url`, parse the manifest, compare exact keys and commands, verify required tracked files, reject Node versions outside `>=24.15.0 <25`, and scan tracked paths for forbidden secret/business-data suffixes. It must print exactly one final line:

```text
HANDOFF|PASS|status=foundation_development_only|business_writes=false
```

- [ ] **Step 3: Update package engine, scripts, and the pnpm 11 build allowlist**

```json
"engines": { "node": ">=24.15.0 <25" },
"scripts": {
  "handoff:validate": "node ../scripts/validate-openclaw-development-handoff.mjs"
}
```

Keep all existing test/build/plugin scripts.

Use the repository-owned pnpm 11 allowlist instead of an interactive or user-level approval:

```yaml
allowBuilds:
  '@google/genai': true
  esbuild: true
  openclaw: true
  protobufjs: true
  tree-sitter-bash: true
```

- [ ] **Step 4: Run focused GREEN gates**

```powershell
pnpm vitest run tests/handoff-contract.test.ts
pnpm handoff:validate
```

Expected: both commands exit 0 and the validator emits the exact PASS line.

- [ ] **Step 5: Commit the machine contract**

```powershell
git add delivery/openclaw-development-handoff.json scripts/validate-openclaw-development-handoff.mjs version-b-lite-plugin/package.json
git commit -m "feat: add machine-verifiable OpenClaw handoff"
```

### Task 3: Rewrite the human entry and detailed progress documents

**Files:**
- Modify: `README.md`
- Modify: `START-HERE.md`
- Create: `docs/OPENCLAW-DEVELOPMENT-HANDOFF.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/pull_request_template.md`
- Modify: `docs/开发进度.md`
- Modify: `version-b-lite-plugin/tests/handoff-contract.test.ts`

**Interfaces:**
- Consumes: manifest commands from Task 2 and total plan 0.3 status.
- Produces: one consistent human onboarding path and a current detailed progress snapshot.

- [ ] **Step 1: Extend the test with required document anchors**

```ts
for (const anchor of [
  "foundation_development_only",
  "pnpm handoff:validate",
  "foundation_not_implemented",
  "committed=false",
  "OpenClaw 02",
  "OpenClaw 03",
  "OpenClaw 04",
]) {
  expect(handoffDocument).toContain(anchor);
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run tests/handoff-contract.test.ts
```

Expected: FAIL on the first missing document anchor.

- [ ] **Step 3: Rewrite the documents from the same manifest contract**

`README.md` and `START-HERE.md` must state B-only, development-only, exact clone/build/validate commands, and the no-business-write boundary. `docs/OPENCLAW-DEVELOPMENT-HANDOFF.md` must include preflight, private GitHub authentication, clone, dependency install, tests, build, plugin validation, plugin/Skill install, behavior smoke, zero-write audit, and safe cleanup. `CONTRIBUTING.md`, `SECURITY.md`, and `.github/pull_request_template.md` must define feature-branch/PR flow, test gates, zero real-data contribution, private vulnerability reporting, and the current no-PRODUCT support status. `docs/开发进度.md` must contain these exact sections:

```markdown
## 当前结论
## 已开发
## 正在开发
## 待开发
## 本轮新增开发内容
## 发现问题
## 待优化
## 后续可增加的优化
## 验证与 GitHub 状态
```

- [ ] **Step 4: Run document and machine gates**

```powershell
pnpm vitest run tests/handoff-contract.test.ts
pnpm handoff:validate
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the human handoff**

```powershell
git add README.md START-HERE.md CONTRIBUTING.md SECURITY.md .github/pull_request_template.md docs/OPENCLAW-DEVELOPMENT-HANDOFF.md docs/开发进度.md version-b-lite-plugin/tests/handoff-contract.test.ts
git commit -m "docs: publish truthful GitHub OpenClaw handoff"
```

### Task 4: Run the complete local development delivery gate

**Files:**
- Modify only if a gate exposes a defect in Tasks 1-3.

**Interfaces:**
- Consumes: frozen branch contents.
- Produces: local evidence that the exact branch is ready for external pull testing.

- [ ] **Step 1: Run package verification with supported Node**

```powershell
pnpm install --frozen-lockfile
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
```

Expected: every command exits 0.

- [ ] **Step 2: Verify tracked publication scope**

```powershell
git status --short
git ls-files
git grep -n -I -E "OPENCLAW_GATEWAY_TOKEN|gateway[_-]?token|github[_-]?token"
```

Expected: clean worktree after commits; no Gateway token matches; no tracked business database, JSONL, dependency directory, or A/C implementation.

- [ ] **Step 3: Review the branch diff**

```powershell
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: no whitespace errors and only planned handoff files.

- [ ] **Step 4: Push the delivery branch**

```powershell
git push -u origin agent/github-openclaw-development-handoff
```

Expected: the private GitHub branch points to the locally verified commit.

### Task 5: Verify the GitHub pull on OpenClaw 02

**Files:**
- No local project edits unless the environment exposes a reproducible defect.

**Interfaces:**
- Consumes: the pushed delivery branch and only repository documentation.
- Produces: independent clone/install/build report from OpenClaw 02.

- [ ] **Step 1: Open OpenClaw 02 without persisting its token**

Use the Gateway URL with the token in the URL fragment only. Never place the token in a chat prompt, terminal command, repository file, or saved evidence.

- [ ] **Step 2: Ask the agent to clone the exact branch and follow `START-HERE.md`**

The prompt must provide only the repository URL, branch name, and instruction to follow repository documentation. It must not restate the hidden install steps.

- [ ] **Step 3: Require exact results**

OpenClaw 02 must report the resolved commit, Node/pnpm/OpenClaw versions, handoff validator PASS line, test/build/plugin validation exits, installed plugin ID, installed Skill name, and before/after business-file count.

- [ ] **Step 4: Record defects without weakening gates**

Any undocumented prerequisite, wrong command, stale path, missing GitHub authorization, or business-file creation is a failed handoff. Fix the repository on the same branch, rerun local Task 4, push, and repeat only the failed OpenClaw 02 step.

### Task 6: Verify behavior on OpenClaw 03 and safety on OpenClaw 04

**Files:**
- No local project edits unless a reproducible defect is found.

**Interfaces:**
- Consumes: the same verified commit used by OpenClaw 02.
- Produces: behavior and zero-write safety evidence.

- [ ] **Step 1: Open OpenClaw 03 and install the exact commit**

Use its token only in the URL fragment. Confirm the `diet_manager` tool and `$diet-manager-b` Skill are discoverable.

- [ ] **Step 2: Run the eight-action behavior matrix**

Invoke `record_meal`, `record_water`, `add_inventory`, `query_inventory`, `query_meals`, `query_daily_summary`, `correct_record`, and `undo_record`. Every result must preserve the requested action and return `status=foundation_not_implemented`, `committed=false`.

- [ ] **Step 3: Open OpenClaw 04 and freeze the clean baseline**

Record only counts and hashes for the test-owned install directory; do not include tokens, chats, or user data.

- [ ] **Step 4: Run failure and cleanup checks**

Exercise malformed input, a write attempt, plugin disable/removal, and Skill removal. Confirm zero business files, no partial diet record, no external-path deletion, and no remaining test-owned installation files after cleanup.

- [ ] **Step 5: Require commit identity across all three Gateways**

All three reports must name the same Git commit. A commit mismatch invalidates the combined result.

### Task 7: Merge the verified bytes and resume total plan 0.3

**Files:**
- Modify: `docs/work-items/SH-HANDOFF-001-brief.md`
- Modify: `docs/开发进度.md`

**Interfaces:**
- Consumes: local Task 4 PASS and OpenClaw 02/03/04 PASS on one commit.
- Produces: completed development handoff on `main` and a precise next task of `SH-CASE-003`.

- [ ] **Step 1: Mark the work item complete with exact evidence summary**

Set `Status: complete`, record the verified commit, local command exits, and each Gateway role/result. Do not include tokens or raw private logs.

- [ ] **Step 2: Update the progress document**

State that the development handoff is complete, PRODUCT-0.1 remains not installable, and the next functional task is `SH-CASE-003`.

- [ ] **Step 3: Re-run local gates after the documentation-only evidence update**

```powershell
pnpm handoff:validate
pnpm test
pnpm build
pnpm plugin:validate
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Push final branch and merge through GitHub**

```powershell
git push
gh pr create --draft --base main --head agent/github-openclaw-development-handoff --title "feat: add GitHub OpenClaw development handoff" --body-file docs/work-items/SH-HANDOFF-001-brief.md
```

After the final diff and checks are visible, mark the PR ready and merge. Do not create a PRODUCT release or tag.

- [ ] **Step 5: Confirm clean main and resume the product plan**

```powershell
git switch main
git pull --ff-only
git status --short --branch
```

Expected: `main` is clean and matches `origin/main`; continue with `SH-CASE-003`.
