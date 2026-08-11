# SH-MODEL-002 Independent Review Package

## Review objective

Independently decide whether the frozen SH-MODEL-002 candidate is a complete, contract-consistent shared model for nutrition profiles, immutable nutrition snapshots, user-confirmed goal versions and daily/cross-day progress. Do not trust local GREEN or candidate descriptions.

## Frozen inputs

| File | SHA-256 |
|---|---|
| `shared/schemas/nutrition-progress.schema.json` | `E8F0C95006529D5D6F9C388E657EA1F834C567D975577C5903B2B28D79C26DE8` |
| `shared/tests/fixtures/nutrition-progress-cases.json` | `0686975A30F8F74ECD8866F5F0D795F226E1AA374B9165ECB2CE44F12F498623` |
| `shared/tests/validate-nutrition-progress-schemas.ps1` | `1C0C63BD3A99BD8884B7C87F3B58E8FF44C9818BEAF0B241C2AD63E4B68556C7` |
| `docs/work-items/SH-MODEL-002-brief.md` | `4A598C77F3D210208A9ED00CED7A509574709EDB2ACDE3F39840E458243CF8DE` |
| `docs/work-items/SH-MODEL-002-report.md` | `93E03D7EF4036C1289E73B26C4EF6389CD9DA86730592C7A6B419C2733007177` |

## Required independent checks

1. The schema has exactly the ten frozen public definitions and one four-value `CoverageStatus`: `complete | partial | unknown | not_applicable`.
2. All persisted quantities are canonical decimal strings or null; JSON numbers fail and unknown is never represented as numeric zero.
3. `NutritionProfile` is immutable/versioned, exact-shape, retains source/basis/evidence, and supersession does not rewrite the profile used by an existing snapshot.
4. `NutritionSnapshot` binds the exact profile ID/version, preserves known/missing/estimated partitions and rejects null/value inconsistencies.
5. Complete, partial, unknown and not-applicable coverage have coherent cross-field meaning; `estimated` exists only in field evidence.
6. `GoalVersion` is append-only/user-confirmed, has no population-derived defaults, and owns exactly the six nullable progress metric keys.
7. The metric order is exactly energy, protein, fat, carbohydrate, fiber and water; no seventh metric or generic `status` is accepted.
8. `DailyProgress` keeps committed totals/goals/current-turn increments/coverage distinct, permits signed corrections only in increments, and keeps totals/goals nonnegative.
9. Water lower bounds and unknown nutrients remain distinguishable from exact zero and from complete measurement.
10. Direct query results require null current-turn increments and do not pretend a write occurred.
11. Single-date results require a deep-identical `daily_progress` alias; multi-date results forbid that alias and require sorted unique dates.
12. The 42 case IDs and four mutations are fixed, non-adaptive and sufficient; identify any important missing boundary or false-positive oracle.
13. Standard draft 2020-12 loading can resolve the absolute decimal `$ref` against the frozen Event/Amount schema `$id`; identify schema/runtime mismatches.
14. Failure semantics remain zero dietary business objects: a failed FactCommit/finalization may emit only a separate redacted technical log.
15. Confirm consistency with CONTRACT-v2, receipt/date v2, issue/correction v2, decision policy v1 and SH-MODEL-001 without asking for protected lease files.
16. Confirm no SQLite/database/repository, route A/C implementation, OpenClaw/MCP business handler, installable Skill or product-readiness claim is present.

## Known scope limits

- Issue/Correction/Mixed shared schemas belong to SH-MODEL-003.
- SQLite mapping, repository transactions and runtime validation belong to later work items.
- A later route-neutral runtime validator must execute draft 2020-12 validation plus the cross-field semantic rules; this freeze does not claim production write-boundary enforcement.
- No health evaluation, medical advice, remaining-budget advice, food recommendation or notification engine is in scope.
- The five protected lease files are unavailable and must not be requested.

## Response contract

First line exactly `PASS` or `FAIL`.

Then list P0/P1/P2 findings, report each of the sixteen checks, and name any required fixture/schema/validator correction. Do not grant PASS merely because hashes or the local validator pass.

Explicitly state whether SH-MODEL-002 can close as a schema-freeze work item without claiming a production runtime.

Final line exactly one of:

```text
Ready for SH-MODEL-002 completion: Yes
```

```text
Ready for SH-MODEL-002 completion: No
```
