# SH-HARNESS-001 Independent Review Package

## Candidate

- public repository: `https://github.com/Aim996/diet-manager-b.git`
- stacked base branch: `agent/sh-case-004-golden-receipts`
- candidate branch: `agent/sh-harness-001-shared-runner`
- candidate commit: `6601db6320078c264dfa4c481cc66d82fe360f4b`
- draft PR: `#4`
- review status: `PASS / P0=0 / P1=0 / P2=2 / cleanup=1`

## Independent review questions

1. Are the prior 26 cases unchanged, with only `CASE-STORAGE-001` appended as catalog `1.4.0 / 27`?
2. Are all six source hashes independently literal-locked rather than read back as self-generated expectations?
3. Can any adapter receive `oracle` or `forbidden`, including through dynamic members or resolved setup?
4. Are Proxy/accessor/nonplain DTOs rejected before getter execution, then recursively cloned and frozen?
5. Does A have exactly zero writer behavior and an honest degradation result?
6. Does B default to `backend_pending`, and does failed execution require zero dietary business writes?
7. Is `nutritious_drink -> nutrition_drink` one-way without mutating the shared Oracle?
8. Does the comparator reject missing/extra/reordered values outside adapters?
9. Is the default report deterministic and free of Oracle payload, actual business observation, mismatch path, machine path and product-PASS claims?
10. Is C adapter absent, with no SQLite or production OpenClaw/MCP adapter introduced?

## Protected exclusions

The reviewer must not read, hash, execute, fetch into the sparse checkout, or modify:

- `shared/contracts/data-model.md`
- `shared/schemas/domain.schema.json`
- `shared/schemas/fixtures/domain-cases.json`
- `shared/tests/validate-domain-schema.mjs`
- `shared/tests/validate-domain-schema.ps1`

## Required verdict

- report P0/P1/P2 separately;
- every P0/P1 requires an exact file/line and reproducible reason;
- delete the isolated clone and confirm residual zero;
- final line:

```text
SH_HARNESS_001_REVIEW|PASS-or-FAIL|P0=n|P1=n|P2=n|sha=6601db6320078c264dfa4c481cc66d82fe360f4b|cleanup=1
```
