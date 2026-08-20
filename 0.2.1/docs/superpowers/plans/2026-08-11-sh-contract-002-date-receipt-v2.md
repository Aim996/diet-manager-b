# SH-CONTRACT-002 Date and Receipt v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the current 0.3 `OccurredTime`, field-level evidence labels, single-day/cross-day progress outputs, and final receipt rules as a machine-checkable companion to CONTRACT-v2.

**Architecture:** Keep `shared/contracts/receipt-and-date-contract.md` as the only normative date/receipt document. Add one embedded machine block for adapters and validators, while preserving the existing human-readable golden examples. The portable Skill renders only the B backend's frozen `EnvelopeFinalize` result; OpenClaw, MCP, and future agents may adapt transport but cannot recompute business results.

**Tech Stack:** Markdown, embedded JSON, Windows PowerShell 5.1 validation.

## Global Constraints

- Product write route is B only; no A/B/C parallel product implementations.
- Do not create production business tables or business data in this task.
- Do not read, hash, edit, or execute the five protected lease files.
- `FactCommit` failure has zero dietary business data; an independent redacted technical log is not a receipt or dietary record.
- `effects_pending` and finalizer failure cannot produce a success receipt or progress block.
- Use TDD: validator RED before contract mutation, then GREEN.
- The workspace now has a private Git repository; keep SHA-256 checkpoints as the contract freeze authority and use Git only as an additional delivery/history layer.

---

### Task 1: Freeze the v2 machine protocol

**Files:**
- Create: `shared/tests/validate-receipt-and-date-contract-v2.ps1`
- Create: `docs/work-items/SH-CONTRACT-002-v2-brief.md`
- Modify: `shared/contracts/receipt-and-date-contract.md`

**Interfaces:**
- Consumes: `diet-manager/contract-v2` final `EnvelopeFinalize` output.
- Produces: `diet-manager/receipt-date-contract-v2` machine JSON and human-readable companion rules.

- [x] **Step 1: Write the failing validator**

Assert exact identity/version/upstream, the `OccurredTime` fields and precision values, B-only write route, success status set, `daily_progress_by_date[]` authority, single-day alias equality, multi-day alias absence, six progress metrics, decimal `round_half_up`, field-level evidence labels, receipt block order, and forbidden success output for `effects_pending`.

- [x] **Step 2: Run the validator and verify RED**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-receipt-and-date-contract-v2.ps1
```

Expected: non-zero with `RECEIPT-DATE-CONTRACT-v2 machine block is missing` against the current v1 file.

- [x] **Step 3: Add the minimal v2 machine block and align the body**

The machine block must expose exact plain values rather than free prose. Update the front matter and introduction from CONTRACT-v1/A-B-C to CONTRACT-v2/portable Skill+B+thin adapters. Preserve valid golden rules and replace old aggregate estimate labels or stale inventory effects with the exact total-plan 0.3 examples.

- [x] **Step 4: Run validator GREEN**

Expected:

```text
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
```

- [x] **Step 5: Record SHA checkpoint**

Record SHA-256 for candidate, validator, brief, report, review package, and current total plan in the work-item report.

### Task 2: Freeze golden single-day and cross-day output

**Files:**
- Modify: `shared/tests/validate-receipt-and-date-contract-v2.ps1`
- Modify: `shared/contracts/receipt-and-date-contract.md`
- Create: `docs/work-items/SH-CONTRACT-002-v2-report.md`

**Interfaces:**
- Consumes: machine protocol from Task 1.
- Produces: exact date examples, progress formulas, single-day alias and cross-day receipt examples.

- [x] **Step 1: Add failing golden assertions**

Assert fixed clock `2026-08-09 10:00 Asia/Shanghai`, date outputs `5号`, `7月15号`, `2025年12月31号`, no `00:00`, single-day alias equality text, cross-day dated blocks, no success progress while `effects_pending`, and field-level labels `按个人模板/沿用历史营养表/参考数据库/估算`.

- [x] **Step 2: Verify RED against any missing current-0.3 semantics**

Run the same validator and capture the first missing golden anchor.

- [x] **Step 3: Apply only the missing normative text/golden corrections**

Do not add Schema fields, storage logic, UI framework behavior, agent-specific fields, or new product capabilities.

- [x] **Step 4: Run validator and static audit GREEN**

Verify the machine block parses, the 11 current task-scope IDs are each present exactly once in the trace table, old v1-only `REQ-UX-*` trace IDs are absent, Markdown fences are paired, and business data candidates remain zero.

- [x] **Step 5: Record SHA checkpoint**

Update the v2 report with RED/GREEN output and the fresh hashes.

### Task 3: Independent review and task closure

**Files:**
- Create: `docs/work-items/SH-CONTRACT-002-v2-review-package.md`
- Create: `docs/work-items/SH-CONTRACT-002-v2-review.md`
- Create: `docs/evidence/EV-20260811-014-sh-contract-002-v2.md`
- Modify: `总功能开发计划0.3.md`
- Modify: `docs/开发进度.md`

**Interfaces:**
- Consumes: frozen candidate/validator/report hashes.
- Produces: independent PASS or actionable FAIL; only PASS may close the task.

- [x] **Step 1: Build a read-only review package**

Require semantic review of all 11 current task-scope IDs, machine/body consistency, exact golden calculations, cross-day behavior, B-only boundary, and zero-business-data failure behavior.

- [x] **Step 2: Run independent OpenClaw review**

The reviewer must not treat implementation tests as semantic proof. A FAIL reopens Task 1 or Task 2 with TDD.

- [x] **Step 3: Run final local verification**

Require validator PASS, parser error count 0, 11/11 trace singleton, legacy current hits 0, paired fences, frozen SHA values, and business candidates 0.

- [x] **Step 4: Register completion only after both gates pass**

Add EV-014, mark `SH-CONTRACT-002` completed, update the readable progress snapshot, and leave product/G1/G2/G3 status unchanged.

## Self-Review

- Spec coverage: OccurredTime, date display, field evidence, receipt ordering, six metrics, rounding, unknown coverage, single/multi-day outputs, finalizer/idempotency boundaries, B-only and thin adapters are assigned to Tasks 1–2.
- Placeholder scan: no TBD/TODO/“similar to” steps remain.
- Type consistency: the canonical collection is always `daily_progress_by_date[]`; `daily_progress` is only the one-date field-equal alias; `ReceiptData` is only emitted by terminal `EnvelopeFinalize`.
