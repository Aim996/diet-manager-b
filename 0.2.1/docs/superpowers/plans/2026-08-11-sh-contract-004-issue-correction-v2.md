# SH-CONTRACT-004 Issue/Correction v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze total-plan 0.3 Issue, quick-option, correction, compensation, batch-preview, outbox, mixed-result, and cross-day semantics as a machine-checkable companion to CONTRACT-v2.

**Architecture:** Upgrade `shared/contracts/issue-correction-contract.md` in place and add one embedded machine block. The portable Skill and thin adapters consume B backend results; they never implement Issue/Correction transactions or reconstruct final progress.

**Tech Stack:** Markdown, embedded JSON, Windows PowerShell 5.1 validation.

## Global Constraints

- Product write route is B only; no A/B/C parallel product implementations.
- Upstream contracts are `diet-manager/contract-v2` and `diet-manager/receipt-date-contract-v2`.
- Do not create production business tables, migrations, repository code, or business data.
- Do not read, hash, edit, or execute the five protected lease files.
- `FactCommit` failure permits only a separate redacted technical log and produces zero dietary business data.
- `EffectBundle` or `EnvelopeFinalize` technical failure preserves committed facts and forbids a fabricated success receipt/progress snapshot.
- Use TDD: validator RED before contract mutation, then GREEN.
- Git is delivery/history; SHA-256 checkpoints remain the contract freeze authority.

---

### Task 1: Freeze the v2 machine protocol

**Files:**
- Create: `shared/tests/validate-issue-correction-contract-v2.ps1`
- Create: `docs/work-items/SH-CONTRACT-004-v2-brief.md`
- Modify: `shared/contracts/issue-correction-contract.md`

**Interfaces:**
- Consumes: `diet-manager/contract-v2`, `diet-manager/receipt-date-contract-v2`.
- Produces: `diet-manager/issue-correction-contract-v2` machine JSON for model, mapping, harness, and adapters.

- [x] **Step 1: Write the failing validator**

The validator must require exact identity/version/upstreams/B-only surface; 4 Issue statuses; 4 Issue types; 23 stable Issue codes; consolidated presentation/query/coverage rules; 8 resolution reasons; 4 resolution sources; the `applied/no_change/rejected` result triad; 5 rejection reasons; 6 quick-prompt fields plus a safe exit; 13 Correction operations; 14 Correction fields; target/concurrency/no-change behavior; exact correction ownership across the three-layer protocol; five outbox states; correction-insufficient behavior; PRODUCT-0.2 batch preview/confirmation; five mixed result statuses; six trace IDs; and 12 legacy guards.

- [x] **Step 2: Run the validator and verify RED**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-issue-correction-contract-v2.ps1
```

Expected first semantic failure:

```text
ISSUE-CORRECTION-CONTRACT-v2 machine block is missing
```

- [x] **Step 3: Add the minimal v2 machine block and align identity/body**

Use these exact current values:

```text
IssueStatus = open | awaiting_user | resolved | dismissed
application_outcome = applied | no_change | rejected
correction operations = change_amount | change_unit | change_time | change_meal_slot |
  change_item_name | change_food_type | change_components | add_item | remove_item |
  change_inventory_link | change_nutrition_source | void_event | restore_event
protocol = FactCommit | EffectBundle | EnvelopeFinalize
```

Remove six-state Issue and twelve-operation v1 semantics from the normative body. Retain them only in a clearly superseded audit section.

- [x] **Step 4: Run validator GREEN**

Expected:

```text
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
```

- [x] **Step 5: Record SHA checkpoint and commit**

Record candidate, validator, brief, design, plan, upstream contracts, and total-plan hashes. Commit only the scoped files after verification.

### Task 2: Freeze failure and golden matrices

**Files:**
- Modify: `shared/tests/validate-issue-correction-contract-v2.ps1`
- Modify: `shared/contracts/issue-correction-contract.md`
- Create: `docs/work-items/SH-CONTRACT-004-v2-report.md`

**Interfaces:**
- Consumes: Task 1 machine protocol.
- Produces: exact fact/effect/finalizer failure, stale quick option, correction compensation, cross-day, restore, and mixed-result rules.

- [x] **Step 1: Add failing body/golden assertions**

Require body anchors for:

```text
ISSUE-FOUR-STATUS
RESOLUTION-OUTCOME-TRIAD
QUICK-STALE-REJECT
CORRECTION-FACT-FIRST
CORRECTION-INVENTORY-INSUFFICIENT
CROSS-DAY-FINALIZED
BULK-CORRECTION-PREVIEW
OUTBOX-LAYERED
MIXED-ORDERED
FACT-COMMIT-FAILURE-ZERO-BUSINESS
```

Require exact insufficient-inventory outcomes: corrected fact committed; new nutrition snapshot; prior real deduction preserved; unsafe delta `skipped_insufficient`; Issue created; command `committed_with_issues`; final receipt only from a successful finalizer.

- [x] **Step 2: Verify RED against missing current semantics**

Run the same validator and capture the first missing anchor/property. A parser/encoding error is not a valid RED.

- [x] **Step 3: Apply only missing normative and golden corrections**

Do not add database names, table fields, index details, UI widgets, agent-specific payloads, or threshold values.

- [x] **Step 4: Run validator and static audit GREEN**

Verify the machine block parses, the six current IDs are trace singletons (`REQ-ISSUE-001/002`, `REQ-QUICK-001`, `REQ-CORR-001/002/003`), v1-only trace IDs are absent, Markdown fences are paired, and business data candidates remain zero.

- [x] **Step 5: Record RED/GREEN and commit**

Update the v2 report with exact output and fresh hashes, then commit the scoped files.

### Task 3: Independent review and closure

**Files:**
- Create: `docs/work-items/SH-CONTRACT-004-v2-review-package.md`
- Create: `docs/work-items/SH-CONTRACT-004-v2-review.md`
- Create: `docs/evidence/EV-20260811-015-sh-contract-004-v2.md`
- Modify: `总功能开发计划0.3.md`
- Modify: `docs/开发进度.md`

**Interfaces:**
- Consumes: frozen candidate/validator/report hashes.
- Produces: independent PASS or actionable FAIL; only PASS may close the task.

- [x] **Step 1: Build the read-only review package**

Require semantic review of all six current IDs, Issue/result state axes, quick-option expiry/conflicts, FactCommit/EffectBundle/EnvelopeFinalize boundaries, compensation truth, cross-day finalization, mixed ordering, B-only, and zero-business-data FactCommit failure.

- [x] **Step 2: Run independent OpenClaw review**

The reviewer must not treat validator GREEN as semantic proof. A FAIL reopens Task 1 or Task 2 with a new RED.

- [x] **Step 3: Run final local verification**

Require validator PASS, Parser 0, ASCII-only validator, six trace singletons, v1 current hits 0, paired fences, frozen hashes, independent ready marker, and business candidates 0.

- [x] **Step 4: Register completion and push**

Add EV-015, mark `SH-CONTRACT-004` completed, update the readable progress snapshot, push to the private GitHub repository, and verify the independent clone. Product/G1/G2/G3 remain incomplete.

## Self-Review

- Spec coverage: Issue classification/status/reasons/presentation/query, Resolution triad/rejections, quick prompt binding/conflict/safe exit, 13 correction operations, compensation, restore, batch preview/confirm, cross-day progress, mixed ordering, three-layer failures, outbox/idempotency, B-only, and zero-business FactCommit failure are assigned.
- Placeholder scan: no unresolved markers or vague deferred steps remain.
- Type consistency: six trace IDs, four Issue statuses, three application outcomes, thirteen operations, five command statuses, and three protocol stages use the same names in every task.
