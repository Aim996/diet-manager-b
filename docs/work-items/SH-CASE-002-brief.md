# SH-CASE-002 Work-Item Brief

## Identity and state

- task_id: `SH-CASE-002`
- milestone: `M2`
- type: `cases`
- product_line: `B-only shared Oracle`
- status: `in_progress`
- owner: `Codex /root`
- reviewer: `OpenClaw independent domain/failure case review`
- full_case_set: `none`

## Objective

Extend the single cumulative acceptance catalog with nine deterministic cases for purchase quantities, ambiguous inventory, exact label nutrition, consolidated Issues, append-only correction, ordered mixed operations, EffectBundle failure, EnvelopeFinalize failure and idempotency conflict. The task freezes Oracle and fixtures only; it does not execute a B adapter or create business storage.

## Dependencies

- `SH-CONTRACT-001`
- `SH-CONTRACT-002`
- `SH-CONTRACT-003`
- `SH-CONTRACT-004`
- `SH-MODEL-001`
- `SH-MODEL-002`
- `SH-MODEL-003`
- `SH-CASE-001`

All dependencies are completed in DOC-0.3.

## Requirements and cases

- requirement_ids: `REQ-PURCHASE-001`, `REQ-PANTRY-002`, `REQ-NUTR-001`, `REQ-ISSUE-001`, `REQ-CORR-001`, `REQ-MIXED-001`, `REQ-SAFE-002`, `REQ-SAFE-003`
- case_ids: `CASE-PURCHASE-001`, `CASE-INVENTORY-003`, `CASE-NUTR-001`, `CASE-ISSUE-001`, `CASE-CORR-001`, `CASE-MIXED-001`, `CASE-EFFECT-001`, `CASE-EFFECT-003`, `CASE-STORAGE-007`
- stage: `PRODUCT-0.1`

## Deliverables

- update `shared/acceptance-cases/cases.json` to cumulative version `1.1.0`
- update `shared/acceptance-cases/fixtures/core-v1.json` to cumulative version `1.1.0`
- create `shared/tests/validate-domain-acceptance-cases.ps1`
- update `shared/tests/validate-core-acceptance-cases.ps1` for registered cumulative suffix compatibility
- create `docs/work-items/SH-CASE-002-report.md`
- create `docs/work-items/SH-CASE-002-review-package.md`
- after independent PASS: `docs/work-items/SH-CASE-002-review.md`
- after independent PASS: `docs/evidence/EV-20260811-022-sh-case-002.md`

## Case assertion paths

```yaml
case_assertion_paths:
  CASE-PURCHASE-001:
    - /setup/domain_scenario_fixture
    - /oracle/fact_commit/purchase_event
    - /oracle/effect_bundle/inventory_batch
    - /oracle/quantity_equation
    - /forbidden
  CASE-INVENTORY-003:
    - /setup/domain_scenario_fixture
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/issue
    - /forbidden
  CASE-NUTR-001:
    - /setup/domain_scenario_fixture
    - /oracle/effect_bundle/nutrition_profile
    - /oracle/effect_bundle/nutrition_snapshot
    - /forbidden
  CASE-ISSUE-001:
    - /setup/domain_scenario_fixture
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/issues
    - /oracle/presentation
    - /forbidden
  CASE-CORR-001:
    - /setup/domain_scenario_fixture
    - /oracle/fact_commit/correction_event
    - /oracle/effect_bundle/nutrition_delta
    - /oracle/effect_bundle/inventory_effect
    - /oracle/finalization/affected_dates
    - /oracle/idempotency
    - /forbidden
  CASE-MIXED-001:
    - /setup/domain_scenario_fixture
    - /oracle/mixed/operation_results
    - /oracle/effect_bundle/inventory_sequence
    - /oracle/finalization
    - /forbidden
  CASE-EFFECT-001:
    - /setup/domain_scenario_fixture
    - /oracle/failure
    - /oracle/state_after_restart
    - /oracle/same_key_retry
    - /forbidden
  CASE-EFFECT-003:
    - /setup/domain_scenario_fixture
    - /oracle/failure
    - /oracle/state_after_restart
    - /oracle/same_key_retry
    - /forbidden
  CASE-STORAGE-007:
    - /setup/domain_scenario_fixture
    - /oracle/idempotency/conflicts
    - /oracle/idempotency/business_write_count
    - /forbidden
full_case_set: none
```

## Frozen Oracle

### Catalog

- case set: `diet-manager/core-acceptance-cases-v1`, version `1.1.0`
- fixture catalog: `diet-manager/core-fixtures-v1`, version `1.1.0`
- cumulative case count: `14`
- original core cases: first `5`, values unchanged
- domain cases: next `9`, exact order from this brief
- cumulative fixture objects: `12` = 1 environment + 1 goal version + 1 query view + 9 domain scenarios
- adapters may rewrite Oracle: `false`

### CASE-PURCHASE-001

- source: `买了两箱牛奶，每箱12盒，每盒250ml。`
- command status: `committed`
- outer quantity: `2 box`
- inner quantity: `24 carton`
- capacity: `250 ml/carton`
- total quantity: `6000 ml`
- formula: `2*12*250=6000`
- one purchase/inventory-stocked fact and one new inventory batch
- no invented expiry date and no collapsed single-total representation

### CASE-INVENTORY-003

- source: `早餐喝了一盒牛奶。`
- two different products are plausible inventory candidates
- meal fact commits with one packaged-product item
- inventory result: `skipped_multiple_candidates`; before and after quantities equal
- one open non-blocking Issue with code `inventory_multiple_candidates`
- no automatic product selection, no negative inventory and no failed FactCommit

### CASE-NUTR-001

- source: `喝了一盒这个牛奶。`
- exact product/variant and package label fixture
- source type: `package_label`; label wins over lower tiers
- raw label, parsed values, profile version and applicable product are retained
- one NutritionSnapshot references the frozen profile/version
- missing label fields remain unknown; no public-source override

### CASE-ISSUE-001

- source: `早餐吃了大概一碗麦片，用的是家里的牛奶。`
- recognizable meal fact commits with status `committed_with_issues`
- ordered Issue codes: `quantity_estimated`, `inventory_multiple_candidates`
- both Issues are `non_blocking_business`, `open` and presented once in one consolidated prompt
- no serial questionnaire, no meal rollback and no claimed inventory deduction

### CASE-CORR-001

- source: `刚才鸡蛋不是2个，是3个。`
- append one `change_amount` CorrectionEvent; original meal remains auditable
- effective quantity becomes 3 eggs; nutrition delta is +1 egg
- inventory effect requests one additional egg from the applicable original batch
- affected date: `2026-08-11`
- same child idempotency key does not duplicate correction or inventory effect

### CASE-MIXED-001

- source: `买了一箱牛奶，又喝了一盒。`
- child order: purchase sequence 0, meal sequence 1
- purchase adds 24 cartons; meal deducts 1; final quantity 23
- both child facts commit, the meal matches the just-stocked product
- one envelope finalization; later-child failure may not roll back the purchase fact

### CASE-EFFECT-001

- failure injection: nutrition snapshot write inside EffectBundle after successful FactCommit
- expected error: `nutrition_effect_write_failed`
- pre-state vector: `meal_events=1|nutrition_snapshots=0|inventory_effects=0|issues=0|outbox=pending|envelope=fact_committed|receipt=0|daily_progress=0|terminal_idempotency=0`
- pre-state SHA-256: `389EA70606C4DE90C1E7821FC614DAC037E38E58522310A75A65416DA44D823A`
- post-state vector: `meal_events=1|nutrition_snapshots=0|inventory_effects=0|issues=0|outbox=retryable_failed|envelope=effects_pending|receipt=0|daily_progress=0|terminal_idempotency=0`
- post-state SHA-256: `6112F8CB61105FB25C41D0BE590A487CA514D673FE2C14BA9C6A2C4F70E6C47E`
- meal fact and durable outbox remain; all EffectBundle business writes roll back
- envelope: `effects_pending`; effect: `retryable_failed`
- success receipt, authoritative progress and terminal idempotency result: absent
- restart preserves the fact and retryable effect; same-key retry writes only the missing effect and finalizes once

### CASE-EFFECT-003

- failure injection: EnvelopeFinalize write boundary after all effects succeeded
- expected error: `envelope_finalize_write_failed`
- pre/post state vector: `meal_events=1|nutrition_snapshots=1|inventory_effects=1|issues=0|outbox=succeeded|envelope=effects_pending|receipt=0|daily_progress=0|terminal_idempotency=0|projection_energy=500`
- pre/post SHA-256: `885388007517BA51211C12727DA556612A656C7E61587C7D9C0EE8D5F2EFD259`
- complete finalizer layer rolls back; facts/effects remain; envelope stays `effects_pending`
- receipt/progress/terminal idempotency result: absent before retry
- this-envelope energy increment: `100`; projection before concurrent write: `500`; concurrent contribution: `50`
- same-key retry finalizes once with `current_turn_increments.energy_kcal=100` and frozen `committed_totals.energy_kcal=650`

### CASE-STORAGE-007

- original frozen command: key `idem-fixed-001`, subject `user:fixture`, command `record_meal`, digest `digest-apple-v1`
- pre/post state vector: `terminal_records=1|business_writes=0|frozen_key=idem-fixed-001|frozen_digest=digest-apple-v1|frozen_subject=user:fixture|frozen_command=record_meal`
- pre/post SHA-256: `8914D877E31D0575BE22673F17E1F978488148DC28684DE4C3B34FF68711BFD2`
- three conflicts reuse the key with changed input digest, changed subject scope or changed command type
- each returns `failed` with `idempotency_conflict`
- business writes: `0`; original frozen result remains unchanged and is not returned as the conflicting request's result

## Stable forbidden outcomes

- package quantity collapse, invented expiry or invented user facts
- automatic selection among different products or negative inventory
- exact label overridden by lower nutrition tiers or unknown fields filled with zero
- serial Issue questionnaire or Issue used to roll back a recognizable fact
- correction overwrite/physical deletion or duplicate compensation on retry
- mixed child reordering or later-child failure rolling back an earlier fact
- EffectBundle failure rolling back FactCommit or leaving half an EffectBundle
- finalizer failure exposing receipt/progress/terminal result
- idempotency conflict producing a business write or masquerading the old result as the new request
- technical log counted as dietary data or failed FactCommit leaving any business artifact

## Absolute roots

- source_root: `E:\codx\skill\饮食管家`
- shared_root: `E:\codx\skill\饮食管家\shared`
- cases_root: `E:\codx\skill\饮食管家\shared\acceptance-cases`
- isolated_clone_root: `E:\codx\skill\github\diet-manager-b`
- product_data_root: not created by this task
- isolated_test_data_root: not needed; validators are read-only

## Governance links

- risk_ids: `RISK-010`, `RISK-016`
- debt_ids: `DEBT-002`
- decision_ids: `DEC-005`, `DEC-006`, `DEC-010`, `DEC-011`, `DEC-017`, `DEC-019`, `DEC-023`, `DEC-024`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260811-001`
- evidence_class: `E-CASE`

## Verification commands

```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-domain-acceptance-cases.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-core-acceptance-cases.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-business-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-receipt-and-date-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-issue-correction-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-core-model-schemas.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-nutrition-progress-schemas.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-issue-correction-mixed-schemas.ps1
```

Additional gates: strict JSON, exact cumulative IDs, original-five semantic preservation, Parser=0, both validators ASCII, CR/NUL=0, `git diff --check`, protected delta=0, business candidate count=0, independent P0=0/P1=0 and clean source/origin/clone equality.

## Completion and reopen

Completion requires domain GREEN, at least eleven mutation rejections, the original core validator and six upstream validators, independent P0=0/P1=0, EV-022 and private clone reproduction. Reopen if any of the nine case inputs, Oracle values, scenario identities, relevant contracts/Schemas or failure semantics change. Adding future registered cases without changing these fourteen values does not by itself invalidate this evidence.
