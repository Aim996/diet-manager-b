# SH-CASE-002 Candidate Report

## Candidate identity

- task: `SH-CASE-002`
- status: implementation, local regression and independent review PASS
- product line: B-only shared Oracle
- catalog version: `1.1.0`
- cumulative cases: `14` = original core `5` + domain/failure `9`
- fixture objects: `12` = environment `1` + goals `1` + query view `1` + domain scenarios `9`
- database or business file created: no
- OpenClaw/MCP production adapter executed: no
- product installable after this task: no

## Implemented

1. Preserved the original five core cases and their three fixture objects, while extending the same single catalogs instead of creating a second Oracle.
2. Added nine exact cases for purchase packaging, ambiguous inventory, exact product-label nutrition, consolidated Issues, append-only correction, ordered mixed commands, EffectBundle failure, finalizer failure with a concurrent contribution, and idempotency conflict.
3. Added nine deterministic `domain_scenarios` with fixed quantities, product identities, state vectors, hashes, failure points and retry results.
4. Frozen the business rule that a failed FactCommit may emit a separate redacted technical log but must create zero dietary/business artifacts.
5. Added a separate ASCII Windows PowerShell 5.1 domain validator with literal expectations and eleven anti-weakening mutations.
6. Updated the original core validator only for cumulative IDs/root shape/version; all original five case assertions and eight original mutations remain active.

## TDD record

### RED

The new validator passed Parser/ASCII/CR/NUL gates and rejected the old five-case catalog with:

```text
DOMAIN_CASE_SET_VERSION_INVALID:expected=1.1.0:actual=1.0.0
```

### Initial GREEN

```text
DOMAIN_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=9|scenarios=9|mutations=0
CORE_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=5|fixtures=3|mutations=8
```

### Mutation GREEN

The domain validator rejected all eleven named mutations:

```text
MUT-DOMAIN-DROP-REQUIRED-CASE
MUT-DOMAIN-COLLAPSE-PACKAGE-QUANTITIES
MUT-DOMAIN-AUTOSELECT-INVENTORY
MUT-DOMAIN-OVERRIDE-EXACT-LABEL
MUT-DOMAIN-SERIALIZE-ISSUES
MUT-DOMAIN-OVERWRITE-CORRECTION-TARGET
MUT-DOMAIN-REORDER-MIXED-CHILDREN
MUT-DOMAIN-ROLLBACK-FACT-ON-EFFECT-FAILURE
MUT-DOMAIN-EXPOSE-FINALIZER-SUCCESS
MUT-DOMAIN-REUSE-IDEMPOTENCY-RESULT
MUT-DOMAIN-ALLOW-FAILED-FACT-BUSINESS-WRITE
DOMAIN_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=9|scenarios=9|mutations=11
```

## Business behavior frozen by this package

- `2 boxes * 12 cartons * 250 ml` remains four separate facts and totals 6000 ml; no expiry is invented.
- A meal can commit while two different products remain plausible: matching is `multiple`, inventory impact is exactly `skipped_ambiguous`, and one `inventory_multiple_candidates` Issue remains open.
- Exact product-label nutrition uses `source_type=product_label`; the label outranks lower sources and missing fiber remains unknown.
- Quantity and inventory ambiguity create two ordered Issues but one consolidated prompt, without rolling back the recognizable meal fact.
- Corrections append a `change_amount` event; they do not overwrite or delete the original meal and retry does not duplicate compensation.
- A mixed purchase/drink command preserves child order `purchase -> meal`, stock sequence `0 -> 24 -> 23`, and one envelope finalization.
- EffectBundle failure preserves the FactCommit, rolls back the whole failed effect bundle, exposes no success/progress/terminal result, and retries only the missing effect.
- Finalizer failure preserves facts/effects and concurrent contribution; retry finalizes once with current increment 100 and committed total 650.
- Reusing one idempotency key with changed digest, subject or command fails with zero business writes and never returns the old result as the new request's result.

## Regression

Eight allowed validators passed serially:

```text
DOMAIN_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=9|scenarios=9|mutations=11
CORE_ACCEPTANCE_CASES|PASS|version=1.1.0|cases=5|fixtures=3|mutations=8
CONTRACT_V2|PASS|id=diet-manager/contract-v2|statuses=5|protocol=3|legacy_guards=10
RECEIPT_DATE_V2|PASS|id=diet-manager/receipt-date-contract-v2|metrics=6|trace=11|legacy_guards=10
ISSUE_CORRECTION_V2|PASS|id=diet-manager/issue-correction-contract-v2|statuses=4|codes=23|operations=13|trace=6|legacy_guards=12
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
NUTRITION_PROGRESS_SCHEMAS|PASS|version=1.0.0|cases=42|definitions=10|mutations=4
ISSUE_CORRECTION_MIXED_SCHEMAS|PASS|version=1.0.0|cases=65|definitions=12|semantic_only=10|mutations=4
```

The five protected lease files were not read, hashed, edited or executed.

## Independent review

Round 1 independently caught all eleven mutations but correctly returned `FAIL|p0=0|p1=1` for the inventory-status token drift. After the focused RED and minimal correction, Round 2 verified the fresh 177207-byte/15-file package, all six declared candidate hashes, both corrected inventory statuses, the unchanged Issue code, the original five cases and all eleven independent mutations:

```text
SH-CASE-002-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=9|scenarios=9|mutations=11
```

## Candidate hashes

| File | SHA-256 |
|---|---|
| `shared/acceptance-cases/cases.json` | `0C15E7A74C754E1B4ACFEACABBA8D2CA988DF08C22B8F190625958E855231702` |
| `shared/acceptance-cases/fixtures/core-v1.json` | `7FD8CD5C6F981152A74EFD5C74AFEA6FFD404E21E1FC9E028EAFA26EA4DEF39D` |
| `shared/tests/validate-domain-acceptance-cases.ps1` | `E090ED528025F3D7E1BD43DED5DCB863D31DEB5BF98C36471297D1D555BBC5A0` |
| `shared/tests/validate-core-acceptance-cases.ps1` | `315980F2A4C4569AD5C383C9F9EF523C3AE4101ED4CAFA1F2B93E88C5AA292C9` |
| `docs/superpowers/specs/2026-08-11-sh-case-002-design.md` | `12F4BEB068238227ADC077C7275E1CD01689FE10EF5EEF11CB0A9411DAAFA14B` |
| `docs/superpowers/plans/2026-08-11-sh-case-002-plan.md` | `361169AA128FEE1C43E937DBF2DFFF1AA2791C53895D85B757C5ABC732A7CC92` |
| `docs/work-items/SH-CASE-002-brief.md` | `B5651A7D1D183E85141FC21C3E6C0A93FA11BD90C127F6BA2932351C295E2189` |

## Discovered and corrected

- The first brief draft used `package_label`; the frozen nutrition Schema uses `product_label`. The brief and implementation were corrected before fixture data was written.
- Independent review round 1 found an inventory-status token drift: the candidate used `skipped_multiple_candidates`, while the frozen contract requires `skipped_ambiguous`. A focused RED reproduced the mismatch, both affected cases and their independent assertions were corrected, and the Issue code remains `inventory_multiple_candidates`.
- The selected cumulative-catalog design avoids a second domain Oracle and keeps the original core validator responsible for the first five cases.

## Completion boundary

The shared Oracle package is complete. Candidate commit `eedc1c367d6a0ab7abf84c107f50bb9606332f31` was pushed to private `origin/main`; the independent clone fast-forwarded to the same commit, reran all eight allowed validators and remained clean. SQLite DDL, repository/outbox runtime, a real B adapter and OpenClaw/MCP production integration remain separate future tasks and are not implied by this result.

## Deliberately deferred

- SQLite DDL/repository/outbox worker and transaction-level fault injection;
- executable B adapter and real OpenClaw/MCP business run;
- golden receipt prose and full-day scenarios;
- G1/G2/G3, installation and release claims.
