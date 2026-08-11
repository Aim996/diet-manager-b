# SH-CASE-001 Work-Item Brief

## Identity and state

- task_id: `SH-CASE-001`
- milestone: `M2`
- type: `cases`
- product_line: `B-only shared Oracle`
- status: `completed`
- owner: `Codex /root`
- reviewer: `OpenClaw independent product-case review`
- full_case_set: `none`

## Objective

Freeze the first five executable common cases for meal grouping, the canonical single-item shape, exact plain water, receipt structure and current-day meal query behavior. Every case must carry a fixed environment, test-owned expected values and explicit forbidden outcomes.

## Dependencies

- `SH-CONTRACT-001`
- `SH-CONTRACT-002`
- `SH-CONTRACT-003`
- `SH-CONTRACT-004`
- `SH-MODEL-001`
- `SH-MODEL-002`
- `SH-MODEL-003`

All dependencies are recorded as completed in DOC-0.3. `SH-MAP-001` is complete but is not used to turn this task into a database implementation.

## Requirements and cases

- requirement_ids: `REQ-MEAL-001`, `REQ-TIME-001`, `REQ-WATER-001`, `REQ-RECEIPT-001`, `REQ-QUERY-001`
- case_ids: `CASE-MEAL-001`, `CASE-MEAL-021`, `CASE-WATER-001`, `CASE-RECEIPT-001`, `CASE-QUERY-001`
- stage: `PRODUCT-0.1`

## Deliverables

- `shared/acceptance-cases/cases.json`
- `shared/acceptance-cases/fixtures/core-v1.json`
- `shared/tests/validate-core-acceptance-cases.ps1`
- `docs/work-items/SH-CASE-001-report.md`
- `docs/work-items/SH-CASE-001-review-package.md`
- after independent PASS: `docs/work-items/SH-CASE-001-review.md`
- after independent PASS: `docs/evidence/EV-20260811-021-sh-case-001.md`

## Case assertion paths

```yaml
case_assertion_paths:
  CASE-MEAL-001:
    - /setup/environment_fixture
    - /oracle/command
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
    - /oracle/finalization/daily_progress
    - /forbidden
  CASE-MEAL-021:
    - /setup/environment_fixture
    - /oracle/parsing/items
    - /oracle/fact_commit/meal_event
    - /forbidden
  CASE-WATER-001:
    - /setup/environment_fixture
    - /oracle/command
    - /oracle/fact_commit/water_event
    - /oracle/finalization/daily_progress
    - /forbidden
  CASE-RECEIPT-001:
    - /setup/environment_fixture
    - /oracle/receipt/blocks
    - /oracle/receipt/item_line_policy
    - /oracle/receipt/authority
    - /forbidden
  CASE-QUERY-001:
    - /setup/environment_fixture
    - /setup/query_view_fixture
    - /oracle/query/date_range
    - /oracle/query/record_filter
    - /oracle/query/result_order
    - /oracle/query/business_write_count
    - /forbidden
full_case_set: none
```

These paths define the case package. Passing this task does not mean a B adapter has executed the full cases.

## Frozen Oracle

### Package

- case set: `diet-manager/core-acceptance-cases-v1`
- version: `1.0.0`
- contract: `diet-manager/contract-v2`, version `2`
- fixture catalog: `shared/acceptance-cases/fixtures/core-v1.json`
- adapters may rewrite Oracle: `false`
- failed FactCommit technical log: separate redacted log allowed
- failed FactCommit business artifacts: exactly zero

### CASE-MEAL-001

- input: `早餐吃了两个鸡蛋、两片面包，喝了250ml牛奶。`
- result: `committed`
- ordered items: egg x2, bread slice x2, milk 250 ml
- one `meal_id`, one MealEvent, zero WaterEvents
- milk is a meal item; its liquid content is not plain-water intake
- one same-envelope finalized daily-progress result

### CASE-MEAL-021

- input: `吃了一个苹果。`
- result: `committed`
- exactly one ordered item inside `items[]`
- one `meal_id`; no alternate single-item event shape

### CASE-WATER-001

- input: `喝了500ml白水。`
- result: `committed`
- one WaterEvent, exact 500 ml, zero estimated fields
- zero MealEvents and no duplicate hydration contribution

### CASE-RECEIPT-001

- input: reuse the committed meal result from `CASE-MEAL-001`
- ordered blocks: title, item lines, progress
- every dish/food/drink has one line; components remain on their dish line
- progress is the final block and uses the same finalized envelope
- exact prose belongs to `SH-CASE-004`

### CASE-QUERY-001

- input: `今天吃了什么？`
- user natural date: `2026-08-11` in `Asia/Shanghai`
- current active view only; superseded and voided records excluded
- records ordered by occurred time with readable time labels
- business writes: `0`

## Stable forbidden outcomes

- invented user facts or quantities
- internal IDs in receipt/query output
- milk represented as a plain-water event
- explicit 500 ml water marked estimated
- single-item alternate schema
- receipt progress not last or reconstructed from another query
- query returning superseded/voided rows or writing business state
- technical log counted as a record or success evidence
- failed FactCommit leaving any meal, water, inventory, nutrition, Issue, outbox, progress, receipt or terminal idempotency artifact

## Absolute roots

- source_root: `E:\codx\skill\饮食管家`
- shared_root: `E:\codx\skill\饮食管家\shared`
- cases_root: `E:\codx\skill\饮食管家\shared\acceptance-cases`
- isolated_clone_root: `E:\codx\skill\github\diet-manager-b`
- product_data_root: not created by this task
- isolated_test_data_root: not needed; validator is read-only

## Governance links

- risk_ids: `RISK-010`
- debt_ids: `DEBT-002`
- decision_ids: `DEC-015`, `DEC-016`, `DEC-027`, `DEC-028`
- change_ids: none
- evidence_class: `E-CASE`
- actual_evidence_ids: `EV-20260811-021`

## Verification commands

```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-core-acceptance-cases.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-business-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-receipt-and-date-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-issue-correction-contract-v2.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-core-model-schemas.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-nutrition-progress-schemas.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:\codx\skill\饮食管家\shared\tests\validate-issue-correction-mixed-schemas.ps1
```

Additional gates: strict JSON parse, exact IDs, Parser=0, validator ASCII, CR/NUL=0, `git diff --check`, protected delta=0, business candidate count=0, independent P0=0/P1=0 and clean source/origin/clone equality.

## Completion and reopen

Completion requires focused GREEN, eight mutation rejections, six upstream regressions, independent P0=0/P1=0, EV-021 and private clone reproduction. Reopen if any of the five case inputs, Oracle values, fixture identities, relevant contract/Schema hashes, receipt structure, water classification or query-view semantics change.
