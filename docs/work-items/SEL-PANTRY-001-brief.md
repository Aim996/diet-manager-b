# SEL-PANTRY-001 执行简报

## 身份与范围

- task_id: `SEL-PANTRY-001`
- product_scope: `PRODUCT-0.1` 商品、入库、家庭库存与批次切片；不代表完整 PRODUCT-0.1
- milestone: `M5`
- task_kind: `product + purchase + pantry domain slice`
- route: `B only`
- objective: 保存商品身份、包装四量、位置/开封/保质证据和追加式批次事件；在已发生饮食事实之后，以家庭/外食/显式跳过边界做稳定库存匹配与非负扣减
- dependencies: `SEL-CORE-001`（`EV-20260813-037`，`PASS`）
- contract: `diet-manager/contract-v2` / `2` / `632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E`
- owner: `Codex /root`
- reviewer: 一名独立领域/规格复核者与一名独立事务/安全复核者
- status: `in_progress`
- blocker: `none`
- next_action: 先按本简报冻结17个选中案例的机器Oracle和夹具；目录门全绿前不修改生产库存逻辑

```json trace-active-task
{
  "task_id": "SEL-PANTRY-001",
  "product_scope": "PRODUCT-0.1 商品、入库、家庭库存与批次切片；不代表完整 PRODUCT-0.1",
  "milestone": "M5",
  "task_kind": "pantry",
  "route": "B",
  "objective": "入库、商品、包装、位置、开封/保质投影、默认库存与批次",
  "requirement_ids": ["REQ-PURCHASE-001", "REQ-PURCHASE-002", "REQ-PURCHASE-003", "REQ-PRODUCT-001", "REQ-PRODUCT-002", "REQ-PRODUCT-003", "REQ-PRODUCT-004", "REQ-PANTRY-001", "REQ-PANTRY-002", "REQ-PANTRY-003", "REQ-PANTRY-004"],
  "case_ids": ["CASE-PURCHASE-001", "CASE-PURCHASE-003", "CASE-PURCHASE-007", "CASE-INVENTORY-001", "CASE-INVENTORY-002", "CASE-INVENTORY-003", "CASE-INVENTORY-005", "CASE-INVENTORY-004", "CASE-INVENTORY-009", "CASE-MEAL-004", "CASE-MEAL-005", "CASE-PURCHASE-002", "CASE-PURCHASE-005", "CASE-PURCHASE-006", "CASE-PURCHASE-008", "CASE-PURCHASE-009", "CASE-PURCHASE-010"],
  "dependency_task_ids": ["SEL-CORE-001"],
  "dependency_evidence_ids": [],
  "deliverables": ["selected product/inventory service"],
  "verification_commands": [
    "Set-Location -LiteralPath $projectRoot",
    "& $nodeExe shared/tests/validate-sel-pantry-cases.mjs",
    "& $nodeExe shared/tests/validate-sel-pantry-cases.mjs --self-test",
    "& $nodeExe shared/tests/validate-sel-pantry-roots.mjs --official-manifest-root $officialVerificationRoot --isolated-root-base $isolatedTestRootBase",
    "Set-Location -LiteralPath $pluginRoot",
    "& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/pantry-catalog.test.ts tests/acceptance/pantry-purchase.test.ts tests/acceptance/pantry-inventory.test.ts tests/acceptance/pantry-application.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism",
    "& $nodeExe node_modules/vitest/vitest.mjs run tests/repository.test.ts tests/fault-matrix.test.ts tests/vertical-slice.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism",
    "& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit"
  ],
  "acceptance_oracle_case_ids": ["CASE-PURCHASE-001", "CASE-PURCHASE-003", "CASE-PURCHASE-007", "CASE-INVENTORY-001", "CASE-INVENTORY-002", "CASE-INVENTORY-003", "CASE-INVENTORY-005", "CASE-INVENTORY-004", "CASE-INVENTORY-009", "CASE-MEAL-004", "CASE-MEAL-005", "CASE-PURCHASE-002", "CASE-PURCHASE-005", "CASE-PURCHASE-006", "CASE-PURCHASE-008", "CASE-PURCHASE-009", "CASE-PURCHASE-010"],
  "forbidden_oracle_enforced": true,
  "required_evidence_types": ["E-CASE", "E-STOR"],
  "actual_evidence_ids": [],
  "risk_ids": ["RISK-005", "RISK-010", "RISK-011", "RISK-012", "RISK-013", "RISK-016", "RISK-017"],
  "decision_ids": ["DEC-004", "DEC-005", "DEC-009", "DEC-011", "DEC-012", "DEC-023", "DEC-024", "DEC-027", "DEC-028"],
  "change_ids": ["CHG-20260810-001", "CHG-20260811-001", "CHG-20260811-002", "CHG-20260813-001", "CHG-20260813-002"],
  "project_root": "E:\\codx\\skill\\.worktrees\\diet-manager-b-b-slice-001",
  "plugin_root": "E:\\codx\\skill\\.worktrees\\diet-manager-b-b-slice-001\\version-b-lite-plugin",
  "node_exe": "C:\\Users\\10481\\AppData\\Local\\Temp\\diet-manager-validation-node-24.15.0\\node-v24.15.0-win-x64\\node.exe",
  "official_data_roots": ["E:\\codx\\skill\\.worktrees\\diet-manager-b-b-slice-001\\.tmp\\official-manifest-sentinel\\SEL-PANTRY-001"],
  "isolated_test_roots": ["E:\\codx\\skill\\.worktrees\\diet-manager-b-b-slice-001\\.tmp\\isolated-test-roots\\SEL-PANTRY-001"],
  "owner": "Codex /root",
  "reviewer": "待分配独立领域复核",
  "status": "进行中",
  "blocker": "none",
  "next_action": "先补齐§4.5 brief和实施计划，再做四量、模板库存隔离与并发TDD",
  "reopen_condition": "规则变化重开"
}
```

## 权威 ID

requirement_ids:

- `REQ-PURCHASE-001`
- `REQ-PURCHASE-002`
- `REQ-PURCHASE-003`
- `REQ-PRODUCT-001`
- `REQ-PRODUCT-002`
- `REQ-PRODUCT-003`
- `REQ-PRODUCT-004`
- `REQ-PANTRY-001`
- `REQ-PANTRY-002`
- `REQ-PANTRY-003`
- `REQ-PANTRY-004`

case_ids（顺序与§31.6任务行一致）:

1. `CASE-PURCHASE-001`
2. `CASE-PURCHASE-003`
3. `CASE-PURCHASE-007`
4. `CASE-INVENTORY-001`
5. `CASE-INVENTORY-002`
6. `CASE-INVENTORY-003`
7. `CASE-INVENTORY-005`
8. `CASE-INVENTORY-004`
9. `CASE-INVENTORY-009`
10. `CASE-MEAL-004`
11. `CASE-MEAL-005`
12. `CASE-PURCHASE-002`
13. `CASE-PURCHASE-005`
14. `CASE-PURCHASE-006`
15. `CASE-PURCHASE-008`
16. `CASE-PURCHASE-009`
17. `CASE-PURCHASE-010`

`shared/acceptance-cases/cases.json` remains the only executable business Oracle. It currently contains complete machine entries for `CASE-PURCHASE-001` and `CASE-INVENTORY-003`; Task 1 must add the other 15 entries from the exact Oracle below, reject ID/order/fixture drift, and update the trace catalog identity before production work. Tests may not embed a second expected catalog. `full_case_set: none`.

## 断言级责任

```yaml
case_assertion_paths:
  CASE-PURCHASE-001:
    - /oracle/fact_commit/purchase_event
    - /oracle/effect_bundle/inventory_batch
    - /oracle/quantity_equation
  CASE-PURCHASE-003:
    - /oracle/fact_commit/purchase_event
    - /oracle/product/location_evidence
    - /oracle/receipt/inferred_fields_labeled
  CASE-PURCHASE-007:
    - /oracle/fact_commit/purchase_event
    - /oracle/product_identity
    - /oracle/inventory_batch
    - /oracle/nutrition_profile_reuse
  CASE-INVENTORY-001:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/inventory_transactions
  CASE-INVENTORY-002:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/batch_allocations
  CASE-INVENTORY-003:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/issue
  CASE-INVENTORY-005:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/issue
    - /oracle/amount_authority
  CASE-INVENTORY-004:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/issue
    - /oracle/business_effects/inventory_nonnegative
  CASE-INVENTORY-009:
    - /oracle/fact_commit/meal_event
    - /oracle/effect_bundle/inventory_match
    - /oracle/effect_bundle/batch_allocations
    - /oracle/business_effects/expired_batch_unchanged
  CASE-MEAL-004:
    - /oracle/fact_commit/meal_event
    - /oracle/parsing/context
    - /oracle/effect_bundle/inventory_match
    - /oracle/business_effects/inventory_read_count
  CASE-MEAL-005:
    - /oracle/fact_commit/meal_event
    - /oracle/parsing/inventory_directive
    - /oracle/effect_bundle/inventory_match
    - /oracle/business_effects/inventory_read_count
  CASE-PURCHASE-002:
    - /oracle/fact_commit/purchase_event
    - /oracle/quantity_equation
    - /oracle/effect_bundle/inventory_batch
  CASE-PURCHASE-005:
    - /oracle/fact_commit/purchase_event
    - /oracle/product/expiration_evidence
    - /oracle/receipt/time_anchor
  CASE-PURCHASE-006:
    - /oracle/fact_commit/purchase_events
    - /oracle/effect_bundle/inventory_batches
    - /oracle/receipt/items
    - /oracle/receipt/shared_issues
  CASE-PURCHASE-008:
    - /oracle/command
    - /oracle/product_identity
    - /oracle/clarification/options
    - /oracle/business_effects
  CASE-PURCHASE-009:
    - /oracle/fact_commit/purchase_event
    - /oracle/product/opening_evidence
    - /oracle/product/expiration_evidence
  CASE-PURCHASE-010:
    - /oracle/fact_commit/location_correction_event
    - /oracle/product/location_evidence
    - /oracle/product/expiration_evidence
    - /oracle/audit/previous_value_visible
full_case_set: none
```

Every selected `forbidden[]` token is part of acceptance responsibility. Missing/extra/reordered IDs, absent Oracle paths, unknown fixture IDs and unclassified prohibitions must fail the catalog gate.

## 完整验收 Oracle

All cases use timezone `Asia/Shanghai`, an injectable received clock, ordinary frozen input, and exact zero/positive business-row counts. Task 1 freezes the following source text, setup and structured values into the catalog before implementation:

| Case | Exact source/setup | Required result | Forbidden result |
|---|---|---|---|
| `CASE-PURCHASE-001` | `买了两箱牛奶，每箱12盒，每盒250ml。`; existing milk-product fixture | one committed purchase and one batch; outer=2, inner/outer=12, capacity=250ml, total inner=24, total=6000ml, formula retained | collapsed packaging, invented expiry, invented fact |
| `CASE-PURCHASE-003` | `买了鲜牛奶。`; no explicit location | committed purchase; deterministic location rule selects one configured default, stores rule/version/evidence, and labels the inferred location in receipt data | unlabeled location inference, invented user statement |
| `CASE-PURCHASE-007` | `又买了同品牌同口味同规格的250ml牛奶。`; exact exhausted historical identity | one new batch; same product identity and applicable frozen nutrition-profile version reused; prior batch/history retained | merging non-exact variant, deleting identity/history |
| `CASE-INVENTORY-001` | `喝了一盒这个牛奶。`; exactly one compatible product/batch with sufficient stock | meal fact committed first; unique match; one exact deduction; before/after and unit preserved; never negative | duplicate deduction, template amount as stock evidence |
| `CASE-INVENTORY-002` | `喝了两盒这个牛奶。`; same product across two non-expired batches | specified batch first, otherwise FEFO then FIFO; may allocate across batches in order; total deduction exactly two cartons | different-product auto selection, expired-first, negative stock |
| `CASE-INVENTORY-003` | existing catalog source/fixture | meal fact committed; two product candidates cause `skipped_ambiguous`, no quantity change, one open non-blocking issue | automatic selection or fact rollback |
| `CASE-INVENTORY-005` | `吃了半碗米饭。`; nutrition has bounded grams but inventory unit cannot be proven convertible | meal fact committed; nutrition adoption may use its own evidence; inventory deduction stays null/unchanged and one unit-conversion issue is created | nutrition grams reused as inventory quantity, zero invented |
| `CASE-INVENTORY-004` | `喝了一盒这个牛奶。`; unique batch has less than one carton | meal fact committed; `skipped_insufficient`; default whole requested item is not deducted; one insufficiency issue; stock remains nonnegative | partial deduction without authorization, fact rollback |
| `CASE-INVENTORY-009` | `喝了一盒这个牛奶。`; one expired and one non-expired compatible batch | non-expired batch is selected by FEFO; expired batch unchanged; meal fact retained | automatic expired selection, expired batch deletion |
| `CASE-MEAL-004` | `在公司吃了一个苹果。`; current scene outside/company | meal fact committed; inventory read count=0 and deduction=0; outside evidence persisted | home-default inventory access or deduction |
| `CASE-MEAL-005` | `吃了一个苹果，只记录，别扣库存。` | meal fact committed; explicit skip evidence persisted; inventory read count=0 and deduction=0 | ignoring explicit skip or rolling back fact |
| `CASE-PURCHASE-002` | `买了一袋鸡蛋。` | one committed purchase/batch; outer bag count=1 explicit; inner egg count/capacity/total remain null | claiming outer amount missing or inventing eggs per bag |
| `CASE-PURCHASE-005` | `买了这个商品，包装上没有可靠保质期。` | purchase committed; unreliable shelf-life rule produces no invented duration/expiry; retain the most useful known stocked/opened anchor | guessed expiry or days |
| `CASE-PURCHASE-006` | `买了牛奶、鸡蛋和苹果。` | three ordered purchase items/events and batches; receipt has one line per product and consolidates shared issues | one blended product/batch, duplicated shared issue |
| `CASE-PURCHASE-008` | `买了这个牛奶。`; multiple same-name brand/flavour/spec identities | clarification with 2–4 bounded identity candidates plus free text; zero purchase/batch writes before choice | silent identity reuse, forced option, unbounded list |
| `CASE-PURCHASE-009` | `刚买的这瓶牛奶已经喝了一部分。`; previously unopened single unit | purchase fact stores explicit partial-use evidence; opening may be inferred only by the versioned rule and is labeled; expiry anchor recomputed from accepted opening evidence | silent opening without evidence/version, rewriting source text |
| `CASE-PURCHASE-010` | `更正：这批牛奶放在冷藏室，不是常温柜。`; existing batch/location | append one location-correction event; old location remains auditable; current projection and applicable expiry recompute once; same-key retry is identical | physical overwrite, duplicated correction, stale expiry |

Fact-first rules apply only to already-occurred meal facts. An ambiguous purchase identity is not committed until its own identity is resolved. Unknown quantities remain null and never become zero.

## 交付物

- Catalog and fixtures: `shared/acceptance-cases/cases.json`, pantry domain fixtures, and an exact selected-case validator.
- Parser/application bridge for purchase and inventory directives without weakening SEL-CORE authority.
- Domain types/service/rules for product identity, purchase events, batch projections, quantity equations, location/opening/expiration evidence and stable match outcomes.
- Repository/effect integration using existing event, inventory batch/transaction, issue, outbox and finalizer tables; no speculative migration before a schema impact audit.
- Focused acceptance, repository concurrency, fault/replay and public OpenClaw truthfulness tests.
- `docs/superpowers/specs/2026-08-14-sel-pantry-001-design.md`, `docs/superpowers/plans/2026-08-14-sel-pantry-001.md`, final report and the next evidence record.

## 精确验证命令

Use pinned Node.js `v24.15.0`, one worker and no file parallelism. Before production edits:

```powershell
$nodeExe = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'
$projectRoot = 'E:\codx\skill\.worktrees\diet-manager-b-b-slice-001'
$pluginRoot = 'E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\version-b-lite-plugin'
$officialVerificationRoot = 'E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\.tmp\official-manifest-sentinel\SEL-PANTRY-001'
$isolatedTestRootBase = 'E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\.tmp\isolated-test-roots\SEL-PANTRY-001'
Set-Location -LiteralPath $projectRoot
& $nodeExe shared/tests/validate-sel-pantry-cases.mjs
& $nodeExe shared/tests/validate-sel-pantry-cases.mjs --self-test
& $nodeExe shared/tests/validate-sel-pantry-roots.mjs --official-manifest-root $officialVerificationRoot --isolated-root-base $isolatedTestRootBase
```

Focused implementation gates in `version-b-lite-plugin`:

```powershell
Set-Location -LiteralPath $pluginRoot
& $nodeExe node_modules/vitest/vitest.mjs run tests/acceptance/pantry-catalog.test.ts tests/acceptance/pantry-purchase.test.ts tests/acceptance/pantry-inventory.test.ts tests/acceptance/pantry-application.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe node_modules/vitest/vitest.mjs run tests/repository.test.ts tests/fault-matrix.test.ts tests/vertical-slice.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
& $nodeExe node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

Closure also runs the full plugin suite, catalog/trace/X-GATE normal and self-tests, repository concurrency, crash/fault gates, source/dist parity and privacy/residue scans. This task does not authorize a formal emit build; a later release/build task owns emitted artifacts.

## 数据根与执行约束

- official_data_roots: local verification uses only the task-owned absolute sentinel `E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\.tmp\official-manifest-sentinel\SEL-PANTRY-001` for before/after manifest and zero-business-write checks; it is not a production data root and must contain no business database. Deployments still resolve their existing absolute production `official_data_root` from trusted plugin config; that private value is never written to tracked files or accepted from model parameters.
- isolated_test_roots: absolute base `E:\codx\skill\.worktrees\diet-manager-b-b-slice-001\.tmp\isolated-test-roots\SEL-PANTRY-001`; every test family creates a new ordinary direct child; fixed database leaf `diet-manager-b.sqlite3`; DB/WAL/SHM/secret/state removed after verification.
- current_worktree: `E:\codx\skill\.worktrees\diet-manager-b-b-slice-001`.
- No remote OpenClaw, network source, gateway credential or user production data is used in this task.

## 所需证据与责任

- required_evidence_types: `E-CASE`, `E-STOR`
- actual_evidence_ids: `none`
- risk_ids: `RISK-005`, `RISK-010`, `RISK-011`, `RISK-012`, `RISK-013`, `RISK-016`, `RISK-017`
- decision_ids: `DEC-004`, `DEC-005`, `DEC-009`, `DEC-011`, `DEC-012`, `DEC-023`, `DEC-024`, `DEC-027`, `DEC-028`
- change_ids: `CHG-20260810-001`, `CHG-20260811-001`, `CHG-20260811-002`, `CHG-20260813-001`, `CHG-20260813-002`

## 非目标与重开条件

This task does not implement nutrition-source selection/Doctor, complete progress, public query/reporting, correction/undo beyond the exact Pantry location event, Issue interaction UX, receipt rendering, installation, migration/release or remote validation. It does not learn personal templates or use nutrition adoption as inventory evidence.

reopen_condition: reopen for any selected requirement/case/fixture/forbidden change; quantity, identity, location, opening, shelf-life, match/FEFO/FIFO, transaction/idempotency, SQLite schema, contract hash, runtime root or public outcome change; any unresolved independent-review P0/P1 blocks completion.
