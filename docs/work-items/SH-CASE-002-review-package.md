# SH-CASE-002 Independent Review Package

## Objective

Determine whether the candidate is a strong, implementation-neutral Oracle for the nine domain/failure cases while preserving the original five core cases. Do not execute the candidate domain validator to generate expected values.

Required verdict:

```text
SH-CASE-002-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=9|scenarios=9|mutations=<independent-count>
```

Return `FAIL` with concrete P0/P1 findings if a correct future B implementation would be rejected, a materially wrong implementation could pass, expected values are candidate-derived, or the cumulative catalog weakens the original five cases.

## Exact candidate hashes

| File | SHA-256 |
|---|---|
| `shared/acceptance-cases/cases.json` | `FA0CEE85856E41EA632D1E8C536417846F73470BEA81771BE21A5D83BF065111` |
| `shared/acceptance-cases/fixtures/core-v1.json` | `7FD8CD5C6F981152A74EFD5C74AFEA6FFD404E21E1FC9E028EAFA26EA4DEF39D` |
| `shared/tests/validate-domain-acceptance-cases.ps1` | `E32615BA0CB14E1BC9FE2B2FB47785291C5B6BCCEB238A8559A270A2E4425775` |
| `shared/tests/validate-core-acceptance-cases.ps1` | `315980F2A4C4569AD5C383C9F9EF523C3AE4101ED4CAFA1F2B93E88C5AA292C9` |
| `docs/superpowers/specs/2026-08-11-sh-case-002-design.md` | `F2F18D2D99D1EEF52067E944DB2617B12B618DABC9134C96F6093C5ADFD86F18` |
| `docs/work-items/SH-CASE-002-brief.md` | `9AC29469C46A6F119EAA82D6A7F5D1670125DA68F17A897D035667CCB4C53165` |

The five protected lease files are out of scope and must not be requested, read, hashed or executed.

## Independent checks

1. Parse both JSON files independently and require exact cumulative ordered IDs: original five first, exact nine-case suffix second.
2. Require 1 environment, 1 goal version, 1 query view and exactly 9 domain scenarios with unique IDs and correct case references.
3. Confirm original five case values remain semantically unchanged and their original eight mutations still pass.
4. Recompute the three frozen state-vector hashes independently from UTF-8 bytes.
5. Check purchase values `2`, `12`, `250`, `24`, `6000` and formula; reject collapsed quantities or invented expiry.
6. Check two distinct inventory candidates, unchanged before/after quantities, committed meal, skipped deduction and one open non-blocking Issue.
7. Check nutrition `source_type=product_label`, exact product/profile binding, raw and parsed values, and unknown fiber without lower-tier override.
8. Check ordered Issue codes and one consolidated prompt while preserving the meal fact.
9. Check correction `change_amount`, append-only history, +1 nutrition/inventory compensation, affected date and retry uniqueness.
10. Check mixed order `purchase -> meal`, stock `0 -> 24 -> 23`, one finalization and earlier-fact isolation.
11. Check EffectBundle failure preserves fact/outbox, rolls back all effect business writes and exposes no receipt/progress/terminal result.
12. Check finalizer failure preserves facts/effects, exposes no success layer, includes concurrent `50`, current increment `100`, and final total `650` exactly once.
13. Check all three idempotency conflicts fail with zero writes and never reuse the old result as the new result.
14. Check the failed-FactCommit invariant permits only separate redacted technical logging and no dietary/business artifact.
15. Independently mutate at least the eleven categories named in the candidate report; use expected literals independent of candidate validator output.
16. Confirm no database/runtime/installability claim and no protected/business-data payload in the review package.

## Severity

- P0: destructive scope escape, protected-data access, business data creation, or fundamental unsafe Oracle design.
- P1: correct B implementation cannot satisfy the Oracle, materially wrong behavior can pass, expectation is candidate-derived, or a required invariant is untested.
- P2: useful future expansion that does not weaken or block this nine-case package.

## Independence

The reviewer may write a private checker in an isolated temporary area. It must not import expected values from the candidate validator or treat candidate PASS output as evidence. Report its own mutation count and concrete findings.
