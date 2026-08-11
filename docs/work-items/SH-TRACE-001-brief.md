# SH-TRACE-001 Work-Item Brief

## Identity

- task_id: `SH-TRACE-001`
- milestone: `M2`
- type: `governance`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `unassigned; one bounded independent governance review at final candidate`
- requirements: `[]`
- cases: `[]`
- case_assertion_paths: `{}`
- full_case_set: `none`
- roots: `ROOT-DOC`

## Objective

Generate deterministic machine mirrors for the approved Plan 0.3 requirement, task, governance and evidence registries, and fail closed on drift or orphaned references.

This is a governance task. It does not assert that any unimplemented business case passes and does not authorize SQLite or product installation.

## Dependencies

- `DOC-003-002`
- `SH-CONTRACT-001`
- `SH-CONTRACT-002`
- `SH-CONTRACT-003`
- `SH-CONTRACT-004`
- `SH-CASE-004`
- `SH-HARNESS-001`

All dependencies are recorded complete in §31 with registered evidence.

## Deliverables

- `shared/traceability/requirements.json`
- `shared/traceability/tasks.json`
- `shared/traceability/decisions.json`
- `shared/traceability/evidence-index.json`
- `shared/tests/validate-traceability.mjs`
- design, implementation plan, report, review package, review and evidence
- synchronized Plan 0.3 and development-progress status

## Verification commands

```powershell
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' shared/tests/validate-traceability.mjs --self-test
& 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' shared/tests/validate-traceability.mjs
```

The absolute executable is an execution instruction only and must not be written into generated mirrors or reports.

## Completion Oracle

- exact counts: 71 requirements, 144 cases, 59 tasks, 63 governance entries;
- selector counts: G1=13, G2=17, release 0.1=121, release 0.2=143;
- requirement case union equals task C[] union;
- every formal reference resolves and no formal composite pseudo-ID exists;
- completed task evidence resolves to §28.2 and a fresh evidence file, except the two explicit plan-only historical EV rows;
- fixed full-case responsibility assignments exactly match §24.4.1;
- tracked mirrors equal fresh generator bytes;
- mutations for duplicate/orphan/composite/status/evidence/selector drift all fail;
- protected-file delta, business-data candidates and temporary residuals remain zero.

## Risk, decision and change IDs

- risk_ids: `RISK-010`, `RISK-015`
- decision_ids: `DEC-002`, `DEC-020`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260809-001`, `CHG-20260810-001`, `CHG-20260811-002`

## Reopen conditions

Reopen when Plan 0.3 registry structure, requirement/case mappings, task rows, selector definitions, evidence registry rules or generated-mirror schema changes.
