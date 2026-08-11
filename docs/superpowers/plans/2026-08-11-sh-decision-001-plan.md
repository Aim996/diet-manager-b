# SH-DECISION-001 Deterministic Policy Implementation Plan

> **Execution rule:** follow this plan in the current task with test-driven development. Do not start model or storage work from this plan.

**Goal:** Freeze candidate, near-expiry, template tolerance, decimal rounding, and B-only gate conditions as a versioned policy with fixed boundary fixtures.

**Architecture:** A JSON policy is normative. A separate JSON fixture set supplies below/equal/above cases. An ASCII Windows PowerShell 5.1 validator checks exact shape, approved hash, full fixture coverage, deterministic results, and fail-closed mutations.

**Tech stack:** JSON, Markdown, Windows PowerShell 5.1, SHA-256.

## Global constraints

- B is the only product route; do not restore route scoring.
- Near-expiry thresholds are reminder/query windows after a known expiration, not shelf-life or safety guidance.
- Missing category/location/seal rules produce `unknown`.
- Do not create `selected-route-map.json`, business tables, migrations, repository code, or product data.
- Do not read, hash, edit, or execute the five protected lease files.

### Task 1: Freeze brief and RED validator

**Files:**
- Create: `docs/work-items/SH-DECISION-001-brief.md`
- Create: `shared/tests/validate-decision-thresholds.ps1`

- [x] Write exact identity, shape, boundary-case IDs, stable errors, and exclusions into the brief.
- [x] Write the validator before the policy/fixture exists.
- [x] Run it in Windows PowerShell 5.1 and capture the first semantic RED: missing policy file.

### Task 2: Implement the minimum policy and boundary fixtures

**Files:**
- Create: `shared/policies/decision-thresholds.json`
- Create: `shared/tests/fixtures/decision-threshold-cases.json`
- Modify: `shared/tests/validate-decision-thresholds.ps1`

- [x] Add exact policy identity/version/B-only route.
- [x] Add hard-conflict product and 2–4 quick-option predicates.
- [x] Add explicit-source expiration policy and eight near-expiry reminder rules.
- [x] Add `max(10g,10%)`, explicit-confirmation states, and decimal rounding.
- [x] Add all-required predicates and exact outputs for G1/G2.
- [x] Add fixed below/equal/above fixtures and pin the final policy SHA-256.
- [x] Add mutations for missing version, wrong hash, missing fixture, and legacy score fields.
- [x] Run validator GREEN plus Parser/ASCII/business-candidate checks.

### Task 3: Independent review and closure

**Files:**
- Create: `docs/work-items/SH-DECISION-001-report.md`
- Create: `docs/work-items/SH-DECISION-001-review-package.md`
- Create: `docs/work-items/SH-DECISION-001-review.md`
- Create: `docs/evidence/EV-20260811-016-sh-decision-001.md`
- Modify: `总功能开发计划0.3.md`
- Modify: `docs/开发进度.md`

- [x] Obtain an independent semantic review that does not trust validator GREEN.
- [x] Record RED/GREEN, exact hashes, review limitations, and B-only/no-safety-advice boundaries.
- [x] Close `Q-005` only for the v1 policy coverage actually frozen.
- [x] Mark `SH-DECISION-001` completed without claiming G1/G2 or product readiness.
- [x] Push to the private GitHub main delivery chain and reproduce validation in the independent clone.

## Verification commands

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File shared/tests/validate-decision-thresholds.ps1
git diff --check
```

Expected GREEN prefix:

```text
DECISION_THRESHOLDS|PASS|id=diet-manager/decision-thresholds/v1
```
