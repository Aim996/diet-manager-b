# SH-DECISION-001 Independent Review Package

## Review role

Perform a read-only semantic review. Do not trust validator GREEN as proof, do not edit files, and do not infer missing thresholds. Return `PASS` only if the policy and fixtures faithfully implement the exact total-plan requirement below without restoring A/B/C scoring or making food-safety claims.

## Frozen candidate

| File | SHA-256 |
|---|---|
| `shared/policies/decision-thresholds.json` | `8B15BAF36474B10E0F4FD6CA925B3E30A85FC1058E5A870E6E9EBF2585DDBCC7` |
| `shared/tests/fixtures/decision-threshold-cases.json` | `CA3D867CBF58C6D4B4B4A42AB90C77234DC0059E1E07E44D6D81603C28ABD5EF` |
| `shared/tests/validate-decision-thresholds.ps1` | `A41F61FC1DCA5FC13BEB2DF42747B16D4F38E2165FB512B57BA44B6E8DD94C11` |
| `docs/work-items/SH-DECISION-001-brief.md` | `3F77AA42370234375BA6DEDAA58542400734BAA91A4D616DC3D9691FF35BC998` |
| `docs/work-items/SH-DECISION-001-report.md` | `6AF01590502DE1D143B7E942FE7875EBD6EE4D657E2C4A44E207440EB8A08A39` |

## Exact source requirement

`REQ-NFR-003`: candidate, threshold, rounding, and B-only gate conditions use a versioned policy rather than model-time judgment; no three-route scoring remains.

`CASE-POLICY-001`: immediately below, at, and above candidate/near-expiry/template/rounding/B-only boundaries produce deterministic results under one fixed policy version.

`CASE-POLICY-002`: missing version, wrong hash, or missing fixture coverage fails closed and requires a controlled policy update; the model cannot supply a replacement threshold.

`DEC-025`: `unique reliable`, `materially different`, `near expiry`, and `within tolerance` are machine rules. Any threshold change is L3 with a new change record, version, fixtures, and regression.

`DEC-027`: B is the only product route. G1/G2 are B safety/readiness predicates, not route-selection scores. User selection of B does not mean either gate passed.

## Required semantic review

1. Confirm product uniqueness requires exactly one candidate after all five hard-conflict dimensions; similarity-only or unresolved conflicts return `needs_confirmation` even when one candidate remains.
2. Confirm lettered quick options require 2–4 complete safe actions, a live revision, and a safe exit.
3. Confirm v1 never invents a generic shelf-life or opened duration. Ranked sources must be explicit/product/manufacturer/confirmed; missing evidence is unknown.
4. Confirm near-expiry rules only determine reminder/query urgency after known effective expiration and are explicitly not edibility, medical, or food-safety guidance.
5. Independently inspect all eight rule tuples and the 16 at/above fixtures; unlisted combinations must return unknown.
6. Confirm `max(10g,10%)` is inclusive at the boundary and material above it; system estimates do not count as explicit confirmations.
7. Independently recompute the five rounding fixtures using decimal half-up.
8. Confirm G1/G2 exact outcome sets, all-required condition lists, no score/weight/winner semantics, no route map, and no current gate PASS claim.
9. Confirm policy/fixture/validator agree on 54 exact case IDs and that failure-closed mutations are real independent negative checks rather than expected values read back from the candidate.
10. Identify any omitted total-plan rule, self-generated oracle, unsafe default, or public-shape ambiguity as a blocking FAIL.

## Scope limits

- This is a policy contract task, not runtime implementation.
- No database, business data, notification scheduler, gate report, or route map is in scope.
- The five protected lease files are unavailable and irrelevant to this review.

## Response contract

First line exactly `PASS` or `FAIL`.

Then provide:

- blocking findings, if any;
- a short independent result for each of the ten review points;
- explicit confirmation whether Q-005 is safely closed only to v1 source/reminder coverage;
- explicit confirmation that no G1/G2/product-readiness claim was made.

Final line exactly:

```text
Ready for SH-DECISION-001 completion: Yes
```

or

```text
Ready for SH-DECISION-001 completion: No
```
