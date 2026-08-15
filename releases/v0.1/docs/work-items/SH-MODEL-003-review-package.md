# SH-MODEL-003 Independent Review Package

Review status: round-2 candidate after an independent round-1 FAIL; do not infer PASS from the local validator output.

## Frozen candidate

- Source base commit: `e5002e3c4f499e8bc65f2e262c6fe08dd352edfe`; review fixes are a working-tree candidate until round-2 PASS.
- Schema: `shared/schemas/issue-correction-mixed.schema.json`
- Schema SHA-256: `EDBB15A38543431DD66564B696F7EA956F725E241E628D8EF36E1B9B0D3B511F`
- Fixture: `shared/tests/fixtures/issue-correction-mixed-cases.json`
- Fixture SHA-256: `FAD2104BACD46D831D51F72B7B4395923BC5B9BB007E05AA76903330408EE1F7`
- Validator: `shared/tests/validate-issue-correction-mixed-schemas.ps1`
- Validator SHA-256: `4E27245EEF89966D04DEEDE628E2B2010DB3C746F9AE15B50801DDCE95B35CC8`
- Schema ID: `https://diet-manager.local/schemas/issue-correction-mixed/v1`
- Version: `1.0.0`
- Fixture set: `diet-manager/issue-correction-mixed-cases/v1`

## Scope and exclusions

Review only the candidate schema, fixture, validator, public v2 contracts, and existing Event/Nutrition public schema identities. Do not read or hash protected lease files. This task does not implement SQLite, a repository, an outbox worker, OpenClaw, MCP, Docker, or production business writes.

## Required public definitions

Exactly 12:

```text
Issue
IssueResolutionEvent
QuickPrompt
CorrectionSnapshot
CorrectionEvent
EffectOutboxEntry
FactCommitResult
EffectBundleResult
ReceiptData
EnvelopeFinalizeResult
MixedItemResult
MixedCommitResult
```

## Independent questions

1. Is the schema valid JSON Schema 2020-12 and are its two absolute external references resolvable by exact `$id`?
2. Are all public objects exact-shape and route-neutral?
3. Does failed FactCommit require zero business writes and zero business references while allowing technical logging only outside the business model?
4. Does the outbox transition model prove terminal states cannot reopen?
5. Can an effects-pending or failed response expose ReceiptData, progress, or a terminal idempotency result?
6. Does the Schema enforce the expressible void/restore lifecycle, and does the independent semantic layer enforce target identity, before/after change, revision match/increment, and ordered unique affected dates?
7. Do single-day progress results require an equal alias while cross-day results forbid that alias?
8. Does mixed processing preserve input order and prevent failed/ignored/clarification children from carrying committed facts or correction references?
9. Are terminal retry, pending resume, and idempotency conflict represented without creating duplicate business writes?
10. Do all 65 fixture cases independently match their two-layer outcome, and do the four named mutations fail in the layer that owns the invariant?

## Required independent execution

Prefer Ajv 8 with `ajv-formats` or another standards-compliant 2020-12 implementation. Register these exact public schemas before compiling the candidate:

```text
https://diet-manager.local/schemas/event-and-amount/v1
https://diet-manager.local/schemas/nutrition-progress/v1
https://diet-manager.local/schemas/issue-correction-mixed/v1
```

Resolve each fixture template to a complete object and apply its named mutations. Then perform two independent checks:

1. **Schema layer:** compile the exact target under `#/$defs/<target>`. The expected Schema outcome is `expected_valid`, except every ID listed in top-level `semantic_only_case_ids` is expected to be Schema-valid and semantic-invalid. Require the exact 65-ID set, the exact 10-ID semantic-only set, no duplicate, and no unlisted mismatch.
2. **Semantic layer:** independently implement the 10 IDs in `x-semantic-contract.invariants` and compare the combined structure+semantic result with `expected_valid`. Do not call the PowerShell validator or copy its observed outputs as the expected values.

The split is deliberate: JSON Schema 2020-12 cannot compare two arbitrary values, require an integer to equal its array index, or require array-member property uniqueness. Such cases are not Schema failures; they are mandatory B-runtime semantic failures. Conversely, lifecycle and alias-presence rules that JSON Schema can express must be rejected by the Schema layer.

## Must-reject mutations

```text
MUT-FAILED-FACT-ALLOW-BUSINESS
MUT-OUTBOX-ALLOW-TERMINAL-REOPEN
MUT-PENDING-ALLOW-RECEIPT
MUT-MIXED-ALLOW-REORDER
```

The first three mutations must be rejected at both Schema and semantic layers. `MUT-MIXED-ALLOW-REORDER` must be rejected by the independent semantic layer; it is intentionally listed in `semantic_only_case_ids` because standard JSON Schema cannot express `sequence == array index`.

## Verdict format

Return:

```text
SH-MODEL-003-INDEPENDENT-REVIEW|PASS|p0=0|p1=0|cases=65|semantic_only=10|mutations=4
```

or FAIL with each P0/P1 finding, exact file/definition/case, why a correct implementation is blocked or an incorrect implementation can pass, and the smallest contract-preserving fix. Optional P2 items must be clearly separated and cannot be used to claim PASS if any P0/P1 remains.
