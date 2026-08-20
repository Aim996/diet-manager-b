# SH-DECISION-001 RED/GREEN Report

## Scope

Freeze the total-plan 0.3 deterministic policy for product candidate uniqueness, quick-option eligibility, near-expiry reminder windows, template tolerance, decimal rounding, and the two B-only gates. No model Schema, table, repository, route map, gate PASS, notification service, or product data was created.

## Frozen inputs

| Input | SHA-256 |
|---|---|
| `总功能开发计划0.3.md` | `A13468CCF04445935EB8F7A7386C8611FFFDF1E13AD97FA470C8E121C6E762F1` |
| `shared/business-contract.md` | `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E` |
| `shared/contracts/issue-correction-contract.md` | `41E4A18D4D72644641D66A58F918616EBB0A6189E7F0BE1E836741E057298FDB` |

## TDD evidence

The full ASCII-only Windows PowerShell 5.1 validator was written while the policy file was absent.

Initial RED:

```text
STATIC_RED|parser=0|ascii_nonzero=0|bytes=22345
RED|exit=1|first=POLICY_FILE_MISSING:E:\codx\skill\饮食管家\shared\policies\decision-thresholds.json
```

Initial minimal GREEN:

```text
DECISION_THRESHOLDS|PASS|id=diet-manager/decision-thresholds/v1|version=1.0.0|cases=37|expiry_rules=8|gates=2|mutations=4
```

Good-test review found that only one of eight near-expiry rules had explicit at/above fixtures. The validator was strengthened first; the old policy/fixture candidate then produced a second real RED:

```text
QUALITY_RED|exit=1|first=POLICY_IDENTITY_INVALID:required_fixture_ids_order
```

After adding fixed at/above cases for all eight rules and exact gate-condition assertions, a second quality review added explicit one-candidate similarity-only, unresolved-conflict, and missing-safe-exit negatives. The candidate again went RED before those policy/fixture changes:

```text
QUALITY_RED2|exit=1|first=POLICY_IDENTITY_INVALID:candidate_rules:properties
```

Final GREEN:

```text
DECISION_THRESHOLDS|PASS|id=diet-manager/decision-thresholds/v1|version=1.0.0|cases=54|expiry_rules=8|gates=2|mutations=4
QUALITY_GREEN2|parser=0|ascii_nonzero=0
```

## Candidate checkpoints

| File | SHA-256 |
|---|---|
| `shared/policies/decision-thresholds.json` | `8B15BAF36474B10E0F4FD6CA925B3E30A85FC1058E5A870E6E9EBF2585DDBCC7` |
| `shared/tests/fixtures/decision-threshold-cases.json` | `CA3D867CBF58C6D4B4B4A42AB90C77234DC0059E1E07E44D6D81603C28ABD5EF` |
| `shared/tests/validate-decision-thresholds.ps1` | `A41F61FC1DCA5FC13BEB2DF42747B16D4F38E2165FB512B57BA44B6E8DD94C11` |
| `docs/work-items/SH-DECISION-001-brief.md` | `3F77AA42370234375BA6DEDAA58542400734BAA91A4D616DC3D9691FF35BC998` |
| `docs/superpowers/specs/2026-08-11-sh-decision-001-design.md` | `7E736B1FA38E5827EC2D7820D9C9403CC3F35854F72D8AFA5B8710245F941E65` |
| `docs/superpowers/plans/2026-08-11-sh-decision-001-plan.md` | `6FBC658C098423F7DFB2A9A85F5A4C644634CEB15685357C4F150B3D8A8C5319` |

## Semantics frozen

- Product uniqueness is count-after-hard-conflict-filter; similarity-only or unresolved conflicts return `needs_confirmation`, never a unique result.
- Quick options require 2–4 complete safe actions, a live target revision, and a safe exit.
- Expiration is derived only from ranked explicit/product/manufacturer/confirmed sources; generic category shelf-life invention is disabled.
- Eight category/location/open-state rules control only near-expiry reminder/query urgency after an effective expiration is known. Unlisted combinations are `unknown`.
- Template consistency is `same major components` plus every amount difference `<= max(10g,10%)`; only explicit confirmations count toward candidate/active/stable.
- Rounding is decimal `round_half_up` with no early internal rounding.
- G1/G2 are all-required B-only predicates with exact return outcomes. They do not score routes, do not accept A/C implementation evidence, and do not create a route map in this task.

## Failure-closed evidence

The validator positively checks policy ID/version/hash, fixture hash, exact required case set, exact policy property sets, every fixture result, and absence of legacy score keys. It also runs four direct mutation checks: unsupported version, wrong hash, missing fixture coverage, and injected `route_scores`.

## Deferred implementation

Runtime policy loading, model fields, SQLite mapping, actual gate reports, notification delivery, and selected-route-map creation remain assigned to later total-plan tasks. The current policy cannot be cited as G1/G2 PASS or product readiness.
