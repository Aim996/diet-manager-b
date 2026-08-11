# SH-CONTRACT-004 Issue/Correction v2 Brief

## Objective

Upgrade the existing companion contract to total-plan 0.3 and CONTRACT-v2 semantics for Issue, quick resolution, append-only Correction/void/restore, inventory compensation, outbox retry, mixed ordering, and cross-day final results.

## Normative inputs

- `总功能开发计划0.3.md`
- `shared/business-contract.md` (`diet-manager/contract-v2`)
- `shared/contracts/receipt-and-date-contract.md` (`diet-manager/receipt-date-contract-v2`)

Old no-`-v2` work-item files and `EV-20260809-008` are CONTRACT-v1 history and cannot close the current task.

## Current task scope

Exactly six current requirement IDs:

```text
REQ-ISSUE-001
REQ-ISSUE-002
REQ-QUICK-001
REQ-CORR-001
REQ-CORR-002
REQ-CORR-003
```

Supporting upstream SAFE/EVENT/PROGRESS semantics remain authoritative but are not duplicated as new SH-CONTRACT-004 trace IDs.

## Required v2 semantics

1. Issue status is exactly `open/awaiting_user/resolved/dismissed`; v1 `offered/deferred/invalidated` cannot remain normative.
2. Issue types and 23 stable codes match total plan 0.3; command/storage failure reasons are not persisted Issues. Non-blocking Issues are presented together after fact commit, remain queryable, and continue to affect coverage.
3. Resolution application outcome is exactly `applied/no_change/rejected`; reasons and rejection reasons are separate fixed enums.
4. Quick prompts bind prompt/Issue/options/revision/time/expiry, show 2–4 choices with a safe exit when justified, support natural language, reject stale/conflicting choices, and end with the exact free-text line.
5. Correction is append-only and supports exactly 13 operations including `restore_event`; original events, snapshots, deductions, and evidence stay auditable.
6. Correction follows `FactCommit → EffectBundle → EnvelopeFinalize`: correction fact/idempotency/outbox, then nutrition/inventory/Issue contribution, then progress/receipt/terminal result. Later technical failure keeps the committed correction fact and resumes only pending layers.
7. Inventory insufficiency never creates negative stock or fake deduction. The corrected fact and nutrition remain authoritative; the unsafe delta is skipped with an Issue and `committed_with_issues`.
8. Cross-day correction finalizes all affected dates through `daily_progress_by_date[]`; no single-day alias is emitted for two or more dates.
9. Mixed input preserves narrative order and per-event idempotency; later failure does not roll back earlier committed facts.
10. PRODUCT-0.2 cross-meal/cross-day batch correction or void requires a zero-write preview, revision-bound confirmation, per-target append-only execution, and one final EnvelopeFinalize; cancel/stale/range-change is zero-write.
11. FactCommit failure may write only an independent redacted technical log and creates zero dietary business rows/results.
12. B is the only product write route; Skill/OpenClaw/MCP remain thin adapters.

## Exclusions

- No Schema/table/index/migration/repository implementation.
- No threshold or policy values.
- No platform-specific business fields.
- No product installation or real dietary data.
- No access to the five protected lease files.

## Acceptance

- Genuine validator RED before contract mutation.
- Windows PowerShell 5.1 validator GREEN with exact machine identity and counts.
- Six current trace IDs are singletons; v1-only trace IDs are absent.
- Independent OpenClaw semantic PASS and `Ready for SH-CONTRACT-004 completion: Yes`.
- Final local audit, EV-015, total-plan completion registration, GitHub push, and clone reproduction.

## Machine traceability

case_assertion_paths:
  CASE-ISSUE-001:
    - /contract/issue/lifecycle
  CASE-ISSUE-003:
    - /contract/issue/resolution
  CASE-CORR-001:
    - /contract/correction/append_only
  CASE-EFFECT-002:
    - /contract/effect_bundle/compensation
full_case_set: none
