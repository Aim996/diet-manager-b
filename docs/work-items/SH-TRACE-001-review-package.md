# SH-TRACE-001 Independent Review Package

## Review target

- repository: `https://github.com/Aim996/diet-manager-b`
- branch: `agent/sh-trace-001-machine-mirror`
- implementation candidate: `423a2d067394606858895bd015cfcebc8f7b24bc`
- base: `945a0ecc3dbcb38769f63121beab2e140d8ac667`
- product route: B only

Review the exact implementation candidate. Later closure changes may add only review/evidence/status text and regenerated source-identity fields.

## In scope

- `shared/tests/validate-traceability.mjs`
- `shared/traceability/*.json`
- `总功能开发计划0.3.md` formal registry deltas
- machine-traceability blocks appended to the nine current completed briefs
- SH-TRACE design, plan, brief and implementation report

## Required review questions

1. Is Plan 0.3 still the only editable authority, with mirrors fully derivable and byte-checked?
2. Are the 71/144/59/63/25 registries parsed from the correct formal sections rather than prose or §29.6 templates?
3. Do all formal REQ/CASE/TASK/EV/DEC/Q/RISK/DEBT/CHG references resolve, with composite pseudo-IDs rejected?
4. Does the task-case union equal the requirement-case union, and is every case assigned at least one producing task?
5. Are fixed G1/G2/release selectors and five full-case owners exact, with only `CASE-STORAGE-003` excluded?
6. Can a completed task pass without registered present evidence or declared assertion paths, apart from the two explicit legacy foundation migrations?
7. Are evidence files exact ordinary repository files with deterministic byte length/SHA-256 and no path guessing?
8. Are generated outputs deterministic, path/secret/Oracle free and compatible with Node 24 plus Windows PowerShell 5.1 JSON parsing?
9. Do mutation tests actually distinguish broken implementations instead of checking self-derived expected data only?
10. Has scope stayed governance-only, without SQLite, business records or production adapters?

Report `P0`, `P1` and optional `P2` findings with exact file/line evidence. PASS requires P0=0 and P1=0.

## Reproduction

```powershell
$node = 'C:\Users\10481\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node shared/tests/validate-traceability.mjs --self-test
& $node shared/tests/validate-traceability.mjs
git diff --check 945a0ecc3dbcb38769f63121beab2e140d8ac667..423a2d067394606858895bd015cfcebc8f7b24bc
```

Expected validator identity:

```text
TRACEABILITY|PASS|mode=validate|requirements=71|cases=144|tasks=59|governance=63|evidence=25|mutations=7
```

The reviewer must not read, hash, edit or execute protected lease files and must not run real business writes or external model-heavy product tests.
