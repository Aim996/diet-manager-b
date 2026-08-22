# SH-DECISION-001 Deterministic Policy Design

## Purpose

Freeze the total-plan 0.3 words `unique reliable`, `quick option`, `near expiry`, `template consistent`, `rounding`, and the two B-only gates as one versioned machine policy. The policy removes model-time threshold invention without creating business tables or route-selection scores.

## Chosen structure

Create one normative policy document, `shared/policies/decision-thresholds.json`, plus one fixed boundary fixture set and one ASCII-only Windows PowerShell 5.1 validator.

The policy owns values and deterministic decision operators. The fixture set owns examples immediately below, at, and above each boundary. The validator owns shape, identity, hash pinning, exact fixture coverage, mutation tests, and pure evaluation of the boundary cases.

Rejected alternatives:

1. Leave thresholds in Markdown prose: rejected because runtime implementations could diverge.
2. Let the Skill or model decide confidence ad hoc: rejected by `REQ-NFR-003` and `DEC-025`.
3. Restore A/B/C scores: rejected by `DEC-027`; B is already the only product route.
4. Hard-code food shelf-life guesses: rejected because reminder urgency is not food-safety evidence. V1 derives expiration only from explicit/product/manufacturer/user-confirmed sources; category rules only select a near-expiry reminder window after an authoritative effective expiration exists.

## Policy boundaries

### Candidate and quick options

- A product is unique only when hard conflicts on brand, variant, specification, food form, and confirmed alias are filtered and exactly one candidate remains.
- Similarity rank alone cannot produce a unique result.
- Lettered quick options appear only for 2–4 complete safe actions with a live target revision and a safe exit.

### Expiration and near-expiry

- V1 accepts explicit user dates, product labels, production plus explicit shelf-life, manufacturer product rules, or confirmed same-product rules.
- V1 has no generic category-derived expiration duration. Missing inputs stay `unknown`.
- Opened expiration uses the minimum of package expiration and an explicitly sourced opened-shelf-life date; it never invents a duration.
- Near-expiry thresholds only affect UI/query urgency after `effective_expiration_at` is known. They are not edibility, medical, or food-safety advice.
- The first reminder groups are prepared refrigerated, refrigerated perishable, frozen, and ambient shelf-stable, split by opened/unopened state. Any unlisted category/location/seal combination is `unknown`.

### Template and rounding

- Major component sets must match.
- Each normalized major amount may differ by at most `max(10g, 10%)`.
- Only components explicitly marked minor seasoning may be ignored by a seasoning-tolerant template category.
- One, two, and three consistent explicit confirmations produce `candidate`, `active`, and `stable`.
- Internal decimal values are never rounded early. Display quantity is at most one decimal; percentages and ten-grid fill use decimal `round_half_up`.

### B-only gates

- `X-GATE-001` returns only `pass_b_safety` or `return_to_b_storage` from an all-required-evidence predicate.
- `X-GATE-002` returns only `bind_b_ready` or `return_to_b_slice`; it requires G1 pass, fresh B slice/fault evidence, frozen contract hashes, exact paths, and an absent pre-existing route map.
- No score, weight, winner, or A/C implementation evidence is accepted.
- This task does not create `shared/selected-route-map.json` and does not claim either gate passed.

## Failure-closed loader contract

Downstream consumers must bind policy ID, semantic version, and approved SHA-256. Missing policy, unsupported version, byte-hash mismatch, missing boundary fixture coverage, legacy scoring keys, or unknown rule references fail closed with a stable policy error; the model cannot supply a replacement value.

## Scope exclusions

- No SQLite tables, migrations, repositories, runtime gate report, or route map.
- No active reminder service or notification scheduler.
- No food-safety or medical recommendation.
- No read, hash, edit, or execution of the five protected lease files.

## Self-review

- All numeric boundaries come from total plan 0.3 except near-expiry reminder windows, which are explicitly classified as product notification policy rather than shelf-life facts.
- Unlisted rules are unknown, never a guessed default.
- B-only decisions are predicates, not scores.
- The design is consumable by later model, mapping, harness, and gate tasks without adapter-specific logic.
