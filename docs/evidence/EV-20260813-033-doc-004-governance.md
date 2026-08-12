# EV-20260813-033 — DOC-004 Governance and Approval Closure

## Identity

- evidence_id: `EV-20260813-033`
- task_ids: [`DOC-004-001`, `DOC-004-002`]
- date: `2026-08-13` (Asia/Shanghai)
- executor: Codex `/root`
- evidence type: `E-DOC`
- scope: DOC-0.4 structure and the recorded user approval only

## Immutable inputs checked

- frozen historical baseline: `总功能开发计划0.3.md`, SHA-256 `9914C27DD653AF757DDF58FAC3273C11E91AAC7C9D5D1D95583FF27CDACC8C79`;
- approval record: `docs/work-items/DOC-004-approval.md`, SHA-256 `35C17777022E11F50FB5AE8A34477ED655267CD562511F52DEEE2373556D6239`;
- current authority: `总功能开发计划0.4.md`.

The evidence intentionally does not record a DOC-0.4 file hash: this EV is indexed by DOC-0.4 itself, so embedding that final plan hash here would create a self-referential identity. The committed file identity is instead verified by the repository commit that contains the final plan and this evidence.

## Executed structural checks

All checks ran read-only in the repository root with Windows PowerShell. Each command exited `0`.

```text
REQ unique: 74
CASE unique: 153
TASK rows: 63
completed: 27
in_progress: 1 (SH-TRACE-001 only)
unstarted: 27
blocked: 0
cancelled: 8
DOC-0.3 SHA-256: 9914C27DD653AF757DDF58FAC3273C11E91AAC7C9D5D1D95583FF27CDACC8C79
X-GATE-002 explicit SH-TRACE-001 dependency: 1
stale DOC-0.3 trace mirror rows: 4
git diff --check: PASS
```

The review also confirmed that `DEC-002` names DOC-0.4 as the sole current authority, `DEC-020` and `RISK-001` both register 50/50 session coverage, and `RISK-010` remains open pending trace regeneration and independent review.

## Boundary

This E-DOC closes only the DOC-004 document and approval tasks. It does not regenerate trace JSON, close `SH-TRACE-001`, start or pass `X-GATE-002`, create a selected-route map, implement product functionality, or establish installation or release readiness.
