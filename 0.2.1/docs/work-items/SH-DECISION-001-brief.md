# SH-DECISION-001 Brief

## Objective

Create the versioned machine policy required by `REQ-NFR-003` and `DEC-025`, with fixed boundary fixtures for `CASE-POLICY-001/002`, while preserving the B-only route decision in `DEC-027`.

## Normative inputs

- `总功能开发计划0.3.md` §§23.6, 26.2–26.5, 31.3
- `shared/business-contract.md` (`diet-manager/contract-v2`)
- `shared/contracts/issue-correction-contract.md` (`diet-manager/issue-correction-contract-v2`)

## Deliverables

- `shared/policies/decision-thresholds.json`
- `shared/tests/fixtures/decision-threshold-cases.json`
- `shared/tests/validate-decision-thresholds.ps1`
- design, implementation plan, report, review package/review, and EV-016

## Required machine identity

```text
policy_id = diet-manager/decision-thresholds/v1
policy_version = 1.0.0
change_level = L3
product_write_route = B
route_selection_mode = fixed_b_only
score_based_selection = false
```

## Required rules

1. `unique_reliable_product`: after hard-conflict filtering on brand, variant, specification, food form, and confirmed alias, count 1 is unique; count 0/2+ is not. Similarity rank cannot override this.
2. `quick_option_candidate`: show only 2–4 complete safe actions with a live target revision and safe exit; 0/1/5+, stale, incomplete, or unsafe is hidden/fail-closed.
3. `reliable_expiry`: accept only ranked explicit/product/manufacturer/confirmed-same-product sources. V1 does not invent generic category shelf-life or opened duration.
4. `near_expiry`: exactly `0 < remaining_hours <= threshold_hours`. Eight exact rules cover prepared refrigerated, refrigerated perishable, frozen, and ambient shelf-stable in opened/unopened states. Any absent rule is `unknown`.
5. Reminder thresholds affect only query/reminder urgency after effective expiration is known; they never decide edibility or safety.
6. `template_consistent`: same major components and every normalized major amount difference `<= max(10g,10%)`; an added/removed major component or any difference above the boundary is material.
7. Confirmation count 1/2/3 maps to `candidate/active/stable`; system estimates do not count.
8. `rounding`: internal decimal has no early round; displayed quantity has at most one decimal; percentages and 10-grid use decimal `round_half_up`.
9. `X-GATE-001`: exact outcomes `pass_b_safety/return_to_b_storage`; pass requires every listed fresh B safety input.
10. `X-GATE-002`: exact outcomes `bind_b_ready/return_to_b_slice`; bind requires G1 pass, fresh B slice/fault evidence, frozen contract versions/hashes, exact paths, and no pre-existing route map.
11. Neither gate accepts score/weight/winner fields or A/C implementation evidence. This task cannot produce a passing gate report or route map.

## First expiration/reminder coverage (`Q-005`)

- Source coverage: user explicit date, current product label date, production plus explicit shelf-life, manufacturer product rule, confirmed same-product rule.
- Opened shelf-life source coverage: user explicit, product label, manufacturer product rule, confirmed same-product rule.
- Reminder groups: `prepared_food/refrigerated`, `refrigerated_perishable/refrigerated`, `frozen_food/frozen`, `shelf_stable/ambient`, each split by `opened/unopened`.
- Unlisted category/location/seal or missing effective expiration: `unknown`.
- Category-derived expiration duration remains disabled in v1. This closes the policy question without claiming unsupported food-safety facts.

## Stable loader failures

```text
POLICY_FILE_MISSING
POLICY_JSON_INVALID
POLICY_IDENTITY_INVALID
POLICY_VERSION_INVALID
POLICY_HASH_MISMATCH
POLICY_FIXTURE_COVERAGE_INVALID
POLICY_LEGACY_SCORE_INVALID
POLICY_CASE_RESULT_INVALID
```

The model cannot replace a missing value after any stable loader failure.

## Case assertion paths

```text
CASE-POLICY-001:
  $.candidate_rules
  $.quick_option_rules
  $.expiry_policy
  $.template_policy
  $.rounding_policy
  $.b_only_gates
  $.fixtures.boundary_results

CASE-POLICY-002:
  $.identity
  $.approved_sha256
  $.fixtures.required_case_ids
  $.failure_closed_mutations
  $.legacy_score_absence
```

## Verification commands

```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File shared\tests\validate-decision-thresholds.ps1
git diff --check
```

## Full case set

`none`. This component freezes policy and boundary fixtures; later B gate/integration tasks execute full storage and slice cases.

## Acceptance oracle

- Genuine missing-file RED before policy creation.
- Windows PowerShell 5.1 Parser 0 and ASCII-only validator/policy/fixture.
- Every required boundary fixture evaluated exactly once with its expected result.
- Four fail-closed mutations produce their stable error family.
- No score/weight/winner key, no route map, no business data candidate.
- Independent semantic `PASS` and explicit ready marker.
- EV-016, task registration, GitHub push, and independent clone reproduction.

## Risks / decisions / changes

- Requirements: `REQ-NFR-003`
- Cases: `CASE-POLICY-001`, `CASE-POLICY-002`
- Decisions: `DEC-025`, `DEC-027`
- Risks: `RISK-015`, `RISK-017`
- Open question: `Q-005` closes only to the exact v1 coverage above

## Exclusions

- No business Schema/table/repository/runtime gate report.
- No `selected-route-map.json`.
- No active reminder delivery.
- No food-safety or medical advice.
- No protected lease access.

## Machine traceability

case_assertion_paths:
  CASE-POLICY-001:
    - /policy/threshold_boundaries
    - /policy/decimal_rounding
  CASE-POLICY-002:
    - /policy/b_only_gate
    - /policy/version_change
full_case_set: none
