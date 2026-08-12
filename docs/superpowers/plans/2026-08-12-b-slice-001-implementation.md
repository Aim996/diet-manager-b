# B-SLICE-001 Vertical Product Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real B-route dietary workflow: inventory purchase, meal recording, inventory deduction, nutrition/progress, receipt, append-only correction/undo, and current-view queries for the fixed 17-case G2 slice.

**Architecture:** Add an internal structured `DietDomainService` above the already-verified preview, FactCommit, inventory effect, and EnvelopeFinalize repositories. Keep OpenClaw's public tool non-writing; run the service through B integration tests and a G2 acceptance driver. Reuse SQLite migration v1 unchanged and preserve the three-stage `FactCommit -> EffectBundle -> EnvelopeFinalize` boundary.

**Tech Stack:** Node `>=24.15.0 <25`, TypeScript 5.9.3, `node:sqlite`, Vitest 2.1.9, OpenClaw 2026.7.1 local build/validation.

## Global Constraints

- The authority is `总功能开发计划0.3.md` §26.5/§31.5 plus `docs/superpowers/specs/2026-08-12-b-slice-001-design.md`.
- Work only on branch `agent/b-slice-001-vertical` in `E:\codx\skill\.worktrees\diet-manager-b-b-slice-001`.
- Do not read, hash, modify, track, or execute the five protected domain lease files named in the workspace instructions.
- Do not modify `version-b-lite-plugin/src/storage/migration-v1.ts` or the migration v1 hash.
- Do not add runtime or development dependencies.
- Keep `version-b-lite-plugin/src/index.ts` non-writing and keep `handleFoundationAction()` returning `foundation_not_implemented`.
- Do not create `shared/selected-route-map.json`, do not install or publish PRODUCT-0.1, and do not add MCP.
- A technical failure may emit a separate redacted log entry, but no failed FactCommit may leave dietary, inventory, nutrition, Issue, business-outbox, progress, receipt, or terminal-result rows.
- Preserve canonical JSON, server-authoritative preview binding, idempotency conflict behavior, append-only facts, nonnegative inventory, and frozen terminal replay.
- The fixed responsibility set is exactly 17 IDs: `CASE-MIXED-001`, `CASE-CORR-001`, `CASE-QUERY-001`, `CASE-EFFECT-001`, `CASE-MEAL-006`, `CASE-NUTR-008`, `CASE-MEAL-003`, `CASE-MEAL-004`, `CASE-INVENTORY-003`, `CASE-INVENTORY-004`, `CASE-NUTR-001`, `CASE-NUTR-002`, `CASE-NUTR-005`, `CASE-STORAGE-001`, `CASE-RECEIPT-001`, `CASE-RECEIPT-003`, `CASE-PROGRESS-010`.
- `record_water`, real network nutrition lookup, model parsing, rich weekly review, templates, installer, release, and the complete fault matrix remain outside this task.
- Use the verified Node executable `C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe` for every local Node gate.
- Before running any command block, set `$nodeExe = 'C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe'` and verify `& $nodeExe --version` prints `v24.15.0`.

---

## File Map

| Path | Responsibility |
|---|---|
| `version-b-lite-plugin/src/domain/types.ts` | Exact internal envelope, operation, quantity, nutrition, result, Issue, progress, and receipt DTOs |
| `version-b-lite-plugin/src/domain/identity.ts` | Deterministic IDs, canonical digest, fixed-clock validation, natural-day calculation |
| `version-b-lite-plugin/src/domain/rules.ts` | Pure inventory matching, amount separation, nutrition source selection, and progress arithmetic |
| `version-b-lite-plugin/src/domain/effect-bundle.ts` | Per-operation atomic nutrition/inventory/Issue effects and envelope-stability transition |
| `version-b-lite-plugin/src/domain/read-model.ts` | Current inventory, effective meal view, correction chain, and daily aggregation queries |
| `version-b-lite-plugin/src/domain/receipt.ts` | Structured receipt and stable quick-option DTOs from frozen results |
| `version-b-lite-plugin/src/domain/service.ts` | Preview/execute/query API and ordered envelope orchestration |
| `version-b-lite-plugin/src/repository/fact-commit.ts` | Preserve single-operation API; add multi-operation FactCommit support without breaking current callers |
| `version-b-lite-plugin/src/repository/inventory-effects.ts` | Finalize an operation bundle independently and mark the envelope stable only after every outbox is terminal |
| `version-b-lite-plugin/src/repository/query.ts` | Add strict read-only inventory-list, effective-meal, and daily-progress queries |
| `version-b-lite-plugin/src/repository/envelope-finalize.ts` | Persist ordered `mixed_item_results` and the single frozen envelope progress/receipt result |
| `version-b-lite-plugin/tests/domain-rules.test.ts` | Pure amount, match, nutrition, date, and identity TDD |
| `version-b-lite-plugin/tests/vertical-slice.test.ts` | Real SQLite end-to-end slice, corrections, replay, and failure boundaries |
| `version-b-lite-plugin/tests/helpers/b-slice-fixtures.ts` | Fixed clocks, test database lifecycle, structured envelopes, SQL row counters, and sanitized result readers used by focused tests |
| `shared/acceptance-cases/g2-b-slice-matrix.json` | Frozen 17-case ID/requirement/observation responsibility matrix; no raw chat or Oracle leakage to the driver |
| `shared/acceptance-cases/adapters/b-slice-driver.ts` | Convert frozen public case setup into structured domain inputs and sanitized observations |
| `shared/acceptance-cases/tests/b-slice.test.ts` | Run exactly 17 cases against B and compare exact observations |
| `docs/work-items/B-SLICE-001-{brief,report,review-package,review}.md` | Work scope, evidence, independent review package, final findings |
| `docs/evidence/EV-20260812-031-b-slice-001.md` | Fresh E-STOR+E-CASE evidence after all gates pass |
| `docs/开发进度.md`, `总功能开发计划0.3.md` | Status/progress update only after candidate and review are frozen |

---

### Task 1: Freeze the internal domain protocol and pure helpers

**Files:**
- Create: `version-b-lite-plugin/src/domain/types.ts`
- Create: `version-b-lite-plugin/src/domain/identity.ts`
- Create: `version-b-lite-plugin/src/domain/rules.ts`
- Create: `version-b-lite-plugin/tests/domain-rules.test.ts`
- Create: `version-b-lite-plugin/tests/helpers/b-slice-fixtures.ts`

**Interfaces:**
- Consumes: `canonicalJson()` and `canonicalSha256()` from `src/authority/canonical-json.ts`.
- Produces: `DomainEnvelopeInput`, `DomainOperation`, `NutritionVector`, `InventoryMatchDecision`, `DomainExecutionResult`, `deriveDomainId()`, `digestDomainEnvelope()`, `resolveInventoryMatch()`, `selectNutritionSource()`, and `addNutritionVectors()`.
- Test helpers produced: `sampleEnvelope()`, `riceBatch()`, `outsideApple()`, `twoMilkCandidates()`, `insufficientEggs()`, `labelAndPublicSource()`, `preparedMixedMilkEnvelope()`, `processAllOperationEffects()`, `mixedFinalizationInput()`, `createTestService()`, `previewAndExecute()`, `purchaseMilkEnvelope()`, `queryInventory()`, `countRows()`, `readEnvelopeState()`, `readMixedSequences()`, `readFinalPayload()`, `readInventorySequence()`, `readReceiptProgressBlockCount()`, `seedTwoEggMeal()`, `readEventBytes()`, `correctEggsToThree()`, `readCompensationMicrounits()`, `queryTodayMeals()`, `mixedPurchaseAndDrink()`, `frozenMultiDishResult()`, `ambiguousInventoryIssue()`, and `testRuntimeFactory()`.

- [x] **Step 1: Write failing tests for exact DTOs, deterministic IDs, and four-amount separation**

```ts
import { describe, expect, it } from "vitest";
import {
  addNutritionVectors,
  resolveInventoryMatch,
  selectNutritionSource,
} from "../src/domain/rules.js";
import { deriveDomainId, digestDomainEnvelope } from "../src/domain/identity.js";

describe("B-SLICE-001 pure domain rules", () => {
  it("derives stable IDs and uppercase canonical digests", () => {
    expect(deriveDomainId("event", "idem-001", 0)).toBe(
      deriveDomainId("event", "idem-001", 0),
    );
    expect(digestDomainEnvelope(sampleEnvelope())).toMatch(/^[A-F0-9]{64}$/);
  });

  it("does not use nutrition adoption amount as inventory deduction", () => {
    const decision = resolveInventoryMatch({
      location: "home",
      requested_unit: "bowl",
      requested_microunits: 1_000_000,
      nutrition_adoption_microunits: 150_000_000,
      candidates: [riceBatch({ available_microunits: 3_000_000 })],
    });
    expect(decision.deduction_microunits).toBe(1_000_000);
  });

  it("skips outside, ambiguous, and insufficient matches", () => {
    expect(resolveInventoryMatch(outsideApple()).status).toBe("skipped_outside");
    expect(resolveInventoryMatch(twoMilkCandidates()).status).toBe("skipped_ambiguous");
    expect(resolveInventoryMatch(insufficientEggs()).status).toBe("skipped_insufficient");
  });

  it("prefers an exact product label and preserves unknown nutrients", () => {
    const source = selectNutritionSource(labelAndPublicSource());
    expect(source.source_type).toBe("product_label");
    expect(source.nutrients.fiber_mg).toBeNull();
  });
});
```

- [x] **Step 2: Run the focused test and verify the missing-module RED**

Run:

```powershell
& $nodeExe .\node_modules\vitest\vitest.mjs run tests/domain-rules.test.ts
```

Expected: FAIL because `src/domain/identity.ts` and `src/domain/rules.ts` do not exist.

- [x] **Step 3: Add the exact internal types**

```ts
import type { DietManagerAction } from "../contracts.js";

export interface NutritionVector {
  readonly energy_kcal_milli: number | null;
  readonly protein_mg: number | null;
  readonly fat_mg: number | null;
  readonly carbohydrate_mg: number | null;
  readonly fiber_mg: number | null;
  readonly water_ml_milli: number | null;
}

export type DomainWriteOperation =
  | AddInventoryOperation
  | RecordMealOperation
  | CorrectRecordOperation
  | UndoRecordOperation;

export type DomainQueryOperation =
  | QueryInventoryOperation
  | QueryMealsOperation
  | QueryDailySummaryOperation;

export interface DomainEnvelopeInput {
  readonly envelope_id: string;
  readonly idempotency_key: string;
  readonly command_type: DietManagerAction;
  readonly subject_scope: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operations: readonly (DomainWriteOperation | DomainQueryOperation)[];
}
```

Define every operation as an exact discriminated union with explicit fields; do not use `Record<string, unknown>` for accepted input. Quantity fields must keep `observed_microunits`, `nutrition_adoption_microunits`, `inventory_deduction_microunits`, and `template_reference_microunits` separate.

Create the test helper module in the same step. Every helper must return a fresh plain DTO or fresh test-owned database; it may not read expected values from a production result. `createTestService()` registers its database path for `afterEach` cleanup, and `countRows()` accepts only the frozen migration v1 table-name allowlist.

- [x] **Step 4: Implement deterministic helpers and pure rules**

```ts
export function deriveDomainId(
  kind: string,
  idempotencyKey: string,
  sequence: number,
): string {
  const digest = createHash("sha256")
    .update(`${kind}\u0000${idempotencyKey}\u0000${sequence}`, "utf8")
    .digest("hex");
  return `${kind}-${digest.slice(0, 32)}`;
}

export function digestDomainEnvelope(input: DomainEnvelopeInput): string {
  return canonicalSha256(input);
}
```

`resolveInventoryMatch()` must return exactly one of `matched`, `skipped_outside`, `skipped_ambiguous`, `skipped_insufficient`, or `skipped_unit_incompatible`. `selectNutritionSource()` must choose exact label, then frozen public fixture, then unknown; it must never replace `null` with zero.

- [x] **Step 5: Run focused tests, TypeScript, and the existing 69 tests**

Expected: new tests PASS, `tsc --noEmit` PASS, and 69 existing tests PASS.

- [x] **Step 6: Commit the protocol slice**

```powershell
git add version-b-lite-plugin/src/domain version-b-lite-plugin/tests/domain-rules.test.ts version-b-lite-plugin/tests/helpers/b-slice-fixtures.ts
git commit -m "feat: define B slice domain protocol"
```

---

### Task 2: Generalize repository operation grouping without changing migration v1

**Files:**
- Modify: `version-b-lite-plugin/src/repository/fact-commit.ts`
- Modify: `version-b-lite-plugin/src/repository/inventory-effects.ts`
- Modify: `version-b-lite-plugin/src/repository/envelope-finalize.ts`
- Modify: `version-b-lite-plugin/tests/repository.test.ts`

**Interfaces:**
- Consumes: current `PreparedFactCommit`, `PreparedEffectIntent`, `commitPreparedFact()`, `processInventoryEffect()`, and `finalizeEnvelope()`.
- Produces: `PreparedEnvelopeOperation`, `appendPreparedOperationFact()`, `sealPreparedEnvelopeFacts()`, operation-scoped EffectBundle rows, deferred envelope-stability support, and `FinalizeEnvelopeInput.mixedItems`.

- [x] **Step 1: Add repository RED tests for two ordered operations in one envelope**

```ts
it("commits two ordered child facts and freezes one envelope result", () => {
  const prepared = preparedMixedMilkEnvelope();
  appendPreparedOperationFact(prepared.operations[0]);
  processAllOperationEffects(db, "op-purchase", { deferEnvelopeStability: true });
  appendPreparedOperationFact(prepared.operations[1]);
  processAllOperationEffects(db, "op-meal", { deferEnvelopeStability: true });
  const committed = sealPreparedEnvelopeFacts(prepared.seal);
  expect(committed.operation_ids).toEqual(["op-purchase", "op-meal"]);
  expect(countRows(db, "event_records")).toBe(2);
  expect(countRows(db, "idempotency_records")).toBe(1);

  expect(readEnvelopeState(db)).toBe("effects_stable");

  finalizeEnvelope(mixedFinalizationInput());
  expect(countRows(db, "envelope_finalizations")).toBe(1);
  expect(readMixedSequences(db)).toEqual([0, 1]);
});
```

Add failure assertions: an append fault rolls back only that child transaction and leaves every earlier committed child byte-identical; an operation EffectBundle fault preserves prior facts/effects, rolls back only that operation's nutrition/inventory/Issue writes, and prevents success finalization.

- [x] **Step 2: Run the repository test and verify the API RED**

Expected: FAIL because `appendPreparedOperationFact()`, `sealPreparedEnvelopeFacts()`, and operation grouping are absent.

- [x] **Step 3: Add the multi-operation FactCommit input without breaking the old API**

```ts
export interface PreparedEnvelopeOperation {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly token: string;
  readonly inputDigest: string;
  readonly subjectScope: string;
  readonly commandType: DietManagerAction;
  readonly dataRevision: string;
  readonly traceId: string;
  readonly sequence: number;
  readonly operationId: string;
  readonly event: PreparedFactEvent;
  readonly items: readonly PreparedMealItem[];
  readonly effects: readonly PreparedEffectIntent[];
}

export interface PreparedEnvelopeSeal {
  readonly database: DatabaseSync;
  readonly secret: Uint8Array;
  readonly token: string;
  readonly inputDigest: string;
  readonly subjectScope: string;
  readonly commandType: DietManagerAction;
  readonly dataRevision: string;
  readonly traceId: string;
  readonly expectedOperationIds: readonly string[];
  readonly sealedAt: string;
}
```

`appendPreparedOperationFact()` validates one child completely before SQL, then performs one `BEGIN IMMEDIATE` that inserts only that child's immutable event/items/outboxes and creates or checks the parent idempotency identity. The parent stays `received` while more children may append. Every child commit is durable before the next child starts, so a later child failure cannot roll back an earlier child.

The first child must still match the signed preview `data_revision`. Its append transaction creates that operation's single `effect_bundle_commits` checkpoint in a pending state with the post-fact revision; the EffectBundle transaction verifies this revision before business writes and atomically upgrades the same row to the terminal post-effect revision. Each completed child therefore freezes its post-effect `data_revision` in that child's existing checkpoint payload. A later child is accepted only when all earlier sequences have exact terminal operation-scoped bundle markers and the current repository revision equals the immediately preceding marker. This is the parent-local revision handoff: it permits the previous child's own committed inventory/nutrition changes, rejects unrelated writes inserted between FactCommit/EffectBundle or between children, does not mutate the signed preview payload, and requires no migration-v1 change. A child with no durable effect creates the same operation-scoped checkpoint directly in its terminal state during append.

`sealPreparedEnvelopeFacts()` verifies the exact dense operation sequence against committed rows, rejects missing/extra/reordered children, then moves the parent through the existing fact states. If every outbox is already terminal it ends at `effects_stable`; otherwise it ends at `effects_pending`. `commitPreparedFact()` remains the compatibility API with its existing one-child transaction, replay identity, fault points, and legacy terminal bundle bytes; the new checkpoint/revision fields are emitted only when the multi-operation staged API created the operation checkpoint.

- [x] **Step 4: Make EffectBundle completion operation-scoped**

Change the terminal check to query `WHERE envelope_id = ? AND operation_id = ?`, insert exactly one `effect_bundle_commits` row per `(envelope_id, operation_id)`, freeze the operation sequence and post-effect repository revision in its canonical payload, then query all envelope outboxes. Add `deferEnvelopeStability?: boolean` to the strict options DTO. With `true`, the operation transaction commits without changing the parent; `sealPreparedEnvelopeFacts()` performs the final parent transition. With `false`, preserve current single-operation behavior. Only when every committed operation is sealed and every outbox is terminal may the parent move to `effects_stable`.

```sql
SELECT effect_id, state
FROM effect_outbox
WHERE envelope_id = ? AND operation_id = ?
ORDER BY effect_id;
```

- [x] **Step 5: Extend finalization to persist ordered mixed rows atomically**

Add exact `mixedItems` input with `sequence`, `operation_id`, `idempotency_key`, `command_type`, `status`, `error_code`, and payload. Validate dense zero-based ordering and insert `mixed_item_results` inside the existing finalization transaction before the injected `before_commit` point.

- [x] **Step 6: Run repository focused tests and all 69+ regressions**

Expected: existing single-operation identities and replay remain byte-for-byte equal; new mixed tests PASS.

- [x] **Step 7: Commit repository grouping**

```powershell
git add version-b-lite-plugin/src/repository version-b-lite-plugin/tests/repository.test.ts
git commit -m "feat: support ordered envelope operations"
```

---

### Task 3: Implement purchase, batch creation, and inventory queries

**Files:**
- Create: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Create: `version-b-lite-plugin/src/domain/read-model.ts`
- Create: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/src/repository/query.ts`
- Create: `version-b-lite-plugin/tests/vertical-slice.test.ts`

**Interfaces:**
- Consumes: Task 1 domain types and Task 2 repository grouping.
- Produces: `createDietDomainService()`, `DietDomainService.preview()`, `DietDomainService.execute()`, `DietDomainService.query()`, `listInventoryProjection()`, and purchase result DTOs.

- [x] **Step 1: Write purchase/query RED tests**

```ts
it("adds two boxes of 12 milk cartons and queries one 24-carton batch", () => {
  const service = createTestService();
  const result = previewAndExecute(service, purchaseMilkEnvelope());
  expect(result.status).toBe("committed");
  expect(result.items[0].inventory_quantity_microunits).toBe(24_000_000);
  expect(service.query(queryInventory()).batches).toEqual([
    expect.objectContaining({
      product_id: "fixture-product-milk-whole-250",
      quantity_microunits: 24_000_000,
      unit: "carton",
    }),
  ]);
});
```

Also assert exact-label profile v1 is saved, a query creates zero business rows, same-key replay creates zero rows, and a pre-FactCommit injected failure produces only one redacted sink entry.

- [x] **Step 2: Run focused tests and verify the service RED**

Expected: FAIL because `createDietDomainService()` is absent.

- [x] **Step 3: Implement the two-step service API**

```ts
export interface DietDomainService {
  preview(input: DomainEnvelopeInput): DomainPreviewResult;
  execute(input: DomainExecuteInput): DomainExecutionResult;
  query(input: DomainQueryOperation): DomainQueryResult;
}

export interface DomainExecuteInput {
  readonly envelope: DomainEnvelopeInput;
  readonly token: string;
  readonly input_digest: string;
  readonly data_revision: string;
}
```

`preview()` computes the canonical digest and current repository revision, then calls `createServerPreview()`. `execute()` recomputes the digest, calls repository authorization, prepares the purchase fact/effect, commits it, runs the inventory add effect, and finalizes once.

- [x] **Step 4: Implement strict read-only inventory listing**

`listInventoryProjection()` must query products, batches, and projections in one read transaction, parse every canonical payload through repository parsers, sort by normalized name then batch ID using ordinal comparison, and perform no writes.

- [x] **Step 5: Run focused tests, all plugin tests, and TypeScript**

Expected: purchase/query tests PASS; previous tests remain green.

- [x] **Step 6: Commit the purchase slice**

```powershell
git add version-b-lite-plugin/src/domain version-b-lite-plugin/src/repository/query.ts version-b-lite-plugin/tests/vertical-slice.test.ts
git commit -m "feat: add purchase and inventory slice"
```

---

### Task 4: Add meal facts, inventory decisions, nutrition snapshots, and progress

**Files:**
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Modify: `version-b-lite-plugin/src/domain/read-model.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/tests/domain-rules.test.ts`
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`

**Interfaces:**
- Consumes: `resolveInventoryMatch()`, purchase projections, repository effect grouping.
- Produces: meal execution, `query_meals`, `query_daily_summary`, nutrition snapshots, and one frozen single-day progress block.

- [x] **Step 1: Write the meal matrix RED tests**

Add named tests for:

```text
CASE-MEAL-006       explicit rice 200g + chicken 150g, no estimated flags
CASE-NUTR-008       one orange, edible-weight estimate marks inferred fields only
CASE-MEAL-003       half bowl rice uses 150g nutrition upper bound, not inventory grams
CASE-MEAL-004       company apple reads/deducts no home inventory
CASE-INVENTORY-003  two product candidates, fact commits, deduction skipped, Issue open
CASE-INVENTORY-004  insufficient eggs, fact commits, whole item not deducted, no negative row
CASE-NUTR-002       no label selects frozen public fixture
CASE-NUTR-005       new meal uses profile v2 while old snapshot remains v1
CASE-PROGRESS-010   same-day operations freeze one envelope increment
```

Example assertion:

```ts
expect(result.items[0]).toMatchObject({
  fact_status: "committed",
  inventory_match: "skipped_ambiguous",
  inventory_transaction_id: null,
  issue_codes: ["inventory_multiple_candidates"],
});
expect(countRows(db, "nutrition_snapshots")).toBe(1);
expect(readFinalPayload(db).daily_progress_by_date).toHaveLength(1);
expect(readFinalPayload(db).daily_progress).toEqual(
  readFinalPayload(db).daily_progress_by_date[0],
);
```

- [x] **Step 2: Run focused tests and verify they fail at missing meal effects**

Expected: purchase tests stay green; meal tests fail without meal EffectBundle behavior.

- [x] **Step 3: Implement meal FactCommit preparation**

Prepare one immutable `diet_meal` event and ordered `meal_items`. Each item payload stores all four amount roles and evidence. Create outboxes only for the effects that the item requires: `inventory_deduct`, `nutrition_snapshot`, `issue_projection`, and `daily_progress_contribution`.

- [x] **Step 4: Implement one atomic operation EffectBundle**

Within `BEGIN IMMEDIATE`, load the committed fact and authoritative current projections, recompute the match decision, write inventory transaction or stable skip reason, write nutrition profile/snapshot, write Issues, write the operation contribution to `effect_bundle_commits.payload_json`, and mark all operation outboxes terminal together. Injected nutrition failure must roll back every effect write from this operation.

- [x] **Step 5: Implement current meal and daily queries**

`query_meals` uses `[start,end)` in `Asia/Shanghai`, excludes voided/superseded records, orders by resolved occurrence then event ID, and returns no internal IDs in the user-facing view. `query_daily_summary` aggregates the six metrics once and sets unknown fields to `null`, never zero.

- [x] **Step 6: Run the focused matrix and regression suite**

Expected: all named meal/nutrition/inventory/progress tests PASS; no negative inventory; no query writes.

- [x] **Step 7: Commit the meal slice**

```powershell
git add version-b-lite-plugin/src/domain version-b-lite-plugin/tests
git commit -m "feat: add meal nutrition and progress slice"
```

---

### Task 5: Generate structured receipts and stable Issue quick options

**Files:**
- Create: `version-b-lite-plugin/src/domain/receipt.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`

**Interfaces:**
- Consumes: frozen operation results, Issue rows, and single-envelope progress.
- Produces: `buildReceiptData()` and `buildQuickPrompt()`.

- [x] **Step 1: Write receipt RED tests**

```ts
it("builds one title, one line per dish or item, and progress last", () => {
  const receipt = buildReceiptData(frozenMultiDishResult());
  expect(receipt.blocks.map((block) => block.kind)).toEqual([
    "title",
    "item",
    "item",
    "progress",
  ]);
  expect(receipt.blocks.every((block) => !JSON.stringify(block).includes("event-"))).toBe(true);
});

it("offers 2-4 stable options with free text last", () => {
  const prompt = buildQuickPrompt(ambiguousInventoryIssue());
  expect(prompt.options.length).toBeGreaterThanOrEqual(2);
  expect(prompt.options.length).toBeLessThanOrEqual(4);
  expect(prompt.options.at(-1)?.kind).toBe("free_text");
});
```

- [x] **Step 2: Run tests and verify missing receipt module RED**

- [x] **Step 3: Implement pure receipt builders**

Builders accept only frozen result DTOs. Explicit values have no estimate marker; inferred fields carry `estimated`; technical pending returns a pending status object and no success title/progress. Never include raw source text, internal IDs, SQL, secret, or file path.

- [x] **Step 4: Store receipt only through EnvelopeFinalize**

Pass the structured receipt and progress in `FinalizeEnvelopeInput.payload`; do not write a second receipt table or query progress after finalization.

- [x] **Step 5: Run receipt, replay, and privacy assertions**

Expected: exact structured assertions for `CASE-RECEIPT-001` and `CASE-RECEIPT-003` PASS; same-key replay returns the identical frozen payload.

- [x] **Step 6: Commit receipt behavior**

```powershell
git add version-b-lite-plugin/src/domain/receipt.ts version-b-lite-plugin/src/domain/service.ts version-b-lite-plugin/tests/vertical-slice.test.ts
git commit -m "feat: add slice receipt data"
```

---

### Task 6: Add append-only correction, undo, compensation, and effective views

**Files:**
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Modify: `version-b-lite-plugin/src/domain/read-model.ts`
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`

**Interfaces:**
- Consumes: committed meal facts and real prior inventory transaction IDs.
- Produces: `correct_record`, `undo_record`, append-only correction rows, compensation effects, and effective-view queries.

- [x] **Step 1: Write `CASE-CORR-001` and undo RED tests**

```ts
it("changes two eggs to three by appending one correction and one-unit compensation", () => {
  seedTwoEggMeal(service);
  const beforeEvent = readEventBytes(db, "event-eggs");
  const result = previewAndExecute(service, correctEggsToThree());

  expect(result.status).toBe("committed");
  expect(countRows(db, "correction_events")).toBe(1);
  expect(readEventBytes(db, "event-eggs")).toEqual(beforeEvent);
  expect(readCompensationMicrounits(db)).toBe(1_000_000);
  expect(service.query(queryTodayMeals()).items[0].quantity_microunits).toBe(3_000_000);
});
```

Also assert same-key retry adds no correction/compensation, `undo_record` appends `void_event`, and undo never physically deletes the original meal.

- [x] **Step 2: Run focused tests and verify correction RED**

- [x] **Step 3: Commit CorrectionEvent in FactCommit**

Create an immutable correction fact with `before_snapshot`, `after_snapshot`, `change_set`, `affected_dates`, nutrition delta, and inventory compensation intent. Reject ambiguous target, stale base revision, and no-change before any business write.

- [x] **Step 4: Apply compensation in one EffectBundle**

Only compensate inventory that the original active fact actually changed. Add quantity uses an inventory-out compensation of one egg; void returns exactly the prior real deduction; restore reevaluates current inventory and does not reactivate old transactions.

- [x] **Step 5: Project current effective meals and progress**

Fold the correction chain by `base_revision` and correction order, keep the complete audit chain, generate a new nutrition snapshot, and recalculate every `affected_dates` entry before finalization.

- [x] **Step 6: Run correction, query, replay, and regression tests**

Expected: `CASE-CORR-001` PASS; original bytes unchanged; effective view shows three eggs; no duplicate compensation.

- [x] **Step 7: Commit correction behavior**

```powershell
git add version-b-lite-plugin/src/domain version-b-lite-plugin/tests/vertical-slice.test.ts
git commit -m "feat: add append-only dietary corrections"
```

---

### Task 7: Complete ordered mixed purchase-plus-meal orchestration

**Files:**
- Modify: `version-b-lite-plugin/src/domain/service.ts`
- Modify: `version-b-lite-plugin/src/domain/effect-bundle.ts`
- Modify: `version-b-lite-plugin/src/domain/receipt.ts`
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`

**Interfaces:**
- Consumes: multi-operation FactCommit, per-operation EffectBundle, and single finalizer from Tasks 2–6.
- Produces: `CASE-MIXED-001` ordered execution and `CASE-PROGRESS-010` envelope-level progress.

- [x] **Step 1: Write the full mixed RED test**

```ts
it("adds 24 milk cartons, drinks one, then finalizes once at 23", () => {
  const result = previewAndExecute(service, mixedPurchaseAndDrink());
  expect(result.items.map((item) => [item.sequence, item.status])).toEqual([
    [0, "committed"],
    [1, "committed"],
  ]);
  expect(readInventorySequence(db)).toEqual([0, 24_000_000, 23_000_000]);
  expect(countRows(db, "envelope_finalizations")).toBe(1);
  expect(readFinalPayload(db).daily_progress_by_date).toHaveLength(1);
  expect(readReceiptProgressBlockCount(db)).toBe(1);
});
```

Add a local non-G2 regression that a later `needs_clarification` item does not remove an earlier committed fact and that ordered statuses remain explicit.

- [x] **Step 2: Run the mixed test and verify ordering RED**

- [x] **Step 3: Execute effects in operation order**

After the multi-operation FactCommit, process every operation's outboxes in sequence. The meal operation queries inventory only after the purchase operation commits its EffectBundle, so it observes 24 cartons and deducts one.

- [x] **Step 4: Freeze one parent result**

Build ordered `mixedItems`, aggregate current-turn contributions from every succeeded child, and call `finalizeEnvelope()` once. A business-skip child remains an explicit item and may produce `committed_with_issues`; a technical pending child prevents parent success finalization.

- [x] **Step 5: Run mixed, progress, replay, and crash-near-reply tests**

Expected: inventory ends at 23; one finalization; same-key replay is exact and creates zero rows.

- [x] **Step 6: Commit mixed orchestration**

```powershell
git add version-b-lite-plugin/src/domain version-b-lite-plugin/tests/vertical-slice.test.ts
git commit -m "feat: orchestrate ordered mixed envelopes"
```

---

### Task 8: Bind the exact 17-case B acceptance driver

**Files:**
- Create: `shared/acceptance-cases/g2-b-slice-matrix.json`
- Create: `shared/acceptance-cases/adapters/b-slice-driver.ts`
- Create: `shared/acceptance-cases/tests/b-slice.test.ts`
- Modify: `shared/acceptance-cases/harness-manifest.json`
- Modify: `shared/acceptance-cases/tests/harness.test.ts`

**Interfaces:**
- Consumes: public `CaseExecutionInput`, allowed public case/fixture catalogs, and `createDietDomainService()`.
- Produces: `G2_B_SLICE_CASE_IDS`, `createBSliceDriver()`, and a deterministic 17-case report.

- [x] **Step 1: Freeze the matrix and its exact ID order**

```json
{
  "matrix_id": "diet-manager/g2-b-slice-matrix/v1",
  "case_ids": [
    "CASE-MIXED-001",
    "CASE-CORR-001",
    "CASE-QUERY-001",
    "CASE-EFFECT-001",
    "CASE-MEAL-006",
    "CASE-NUTR-008",
    "CASE-MEAL-003",
    "CASE-MEAL-004",
    "CASE-INVENTORY-003",
    "CASE-INVENTORY-004",
    "CASE-NUTR-001",
    "CASE-NUTR-002",
    "CASE-NUTR-005",
    "CASE-STORAGE-001",
    "CASE-RECEIPT-001",
    "CASE-RECEIPT-003",
    "CASE-PROGRESS-010"
  ],
  "expected_count": 17,
  "adapter_id": "diet-manager/b-slice-execution-adapter-v1",
  "observation_keys": {
    "CASE-MIXED-001": ["mixed", "inventory_sequence", "finalization"],
    "CASE-CORR-001": ["fact_commit", "effect_bundle", "finalization", "idempotency"],
    "CASE-QUERY-001": ["query"],
    "CASE-EFFECT-001": ["failure", "state_after_restart", "same_key_retry"],
    "CASE-MEAL-006": ["fact_commit", "nutrition"],
    "CASE-NUTR-008": ["nutrition", "estimated_fields"],
    "CASE-MEAL-003": ["fact_commit", "nutrition", "inventory"],
    "CASE-MEAL-004": ["fact_commit", "inventory"],
    "CASE-INVENTORY-003": ["fact_commit", "effect_bundle"],
    "CASE-INVENTORY-004": ["fact_commit", "effect_bundle"],
    "CASE-NUTR-001": ["effect_bundle"],
    "CASE-NUTR-002": ["effect_bundle"],
    "CASE-NUTR-005": ["history", "new_record"],
    "CASE-STORAGE-001": ["idempotency"],
    "CASE-RECEIPT-001": ["receipt"],
    "CASE-RECEIPT-003": ["quick_options"],
    "CASE-PROGRESS-010": ["progress"]
  }
}
```

The matrix order and key sets are authority. The tests define the exact expected values for those keys from Plan 0.3 and the allowed public contracts; the driver receives only structured setup and contract hashes. The matrix and driver must not contain raw user text, internal IDs, paths, secrets, or any mechanism that reads expected values from the result under test.

- [x] **Step 2: Write the 17-case harness RED**

```ts
it("executes exactly the G2 B-only responsibility set", async () => {
  const report = await runBSliceCases(createBSliceDriver(testRuntimeFactory));
  expect(report.case_ids).toEqual(G2_B_SLICE_CASE_IDS);
  expect(report.summary).toEqual({
    case_count: 17,
    executed: 17,
    matched: 17,
    mismatched: 0,
    failed: 0,
  });
});
```

- [x] **Step 3: Implement case-to-structured-input mapping**

Use an exhaustive `switch (input.case_id)` with all 17 literal cases and a `never` exhaustiveness assertion. The driver receives only setup and contract hashes, creates a fresh test-owned database per case, executes the domain service, counts real business writes, emits a sanitized observation, closes the database, and removes the test directory.

- [x] **Step 4: Add mutation checks**

Mutations must fail when: mixed operations are reversed; nutrition estimate is used as inventory deduction; outside meal reads inventory; ambiguous inventory is automatically selected; unknown nutrient becomes zero; old nutrition snapshot changes to v2; correction overwrites the original event; same-key replay writes; progress is rebuilt by an extra query; or a failed effect shows a success receipt.

- [x] **Step 5: Run the shared harness and B tests**

Expected: exact 17/17 PASS, the existing 27-case harness protocol tests remain green, and B plugin tests remain green.

- [x] **Step 6: Commit acceptance binding**

```powershell
git add shared/acceptance-cases version-b-lite-plugin
git commit -m "test: bind B vertical slice cases"
```

---

### Task 9: Verify failure logging and formal-root isolation

**Files:**
- Modify: `version-b-lite-plugin/tests/vertical-slice.test.ts`
- Create: `version-b-lite-plugin/tests/b-slice-crash-worker.mjs`
- Create: `version-b-lite-plugin/tests/b-slice-crash-harness.mjs`
- Modify: `version-b-lite-plugin/package.json`

**Interfaces:**
- Consumes: service fault seams already defined for tests; no new production fault API.
- Produces: real process-crash/restart evidence and redacted-log assertions.

- [x] **Step 1: Write the failure-boundary RED**

Assert a FactCommit fault leaves zero rows in every business table; the only sink entry is exactly:

```ts
{
  phase: "fact_commit",
  error_code: "FACT_COMMIT_FAILED",
  trace_id: "trace-case-effect-001",
  input_digest: "A".repeat(64)
}
```

Assert it contains no source text, food name, quantity, inventory, SQL, secret, or absolute path.

- [x] **Step 2: Add crash worker modes**

The worker accepts only `after_fact_commit`, `after_effect_bundle`, and `after_finalize_before_reply`; it opens a test-owned database, executes one fixed fixture, exits with code 73 at the selected checkpoint, and never accepts a production database path.

- [x] **Step 3: Add restart assertions**

After `after_fact_commit`, restart processes only pending effects. After `after_effect_bundle`, restart only finalizes. After `after_finalize_before_reply`, same-key replay returns identical frozen JSON and adds zero rows.

- [x] **Step 4: Add the package script and run it**

```json
"test:b-slice-crash": "npm run build && node tests/b-slice-crash-harness.mjs"
```

Run with the verified Node executable. Expected: PASS, no surviving child, and no temporary database/log residue.

- [x] **Step 5: Commit failure evidence harness**

```powershell
git add version-b-lite-plugin/tests version-b-lite-plugin/package.json
git commit -m "test: verify B slice crash recovery"
```

---

### Task 10: Freeze candidate evidence, review, and plan state

**Files:**
- Create: `docs/work-items/B-SLICE-001-brief.md`
- Create: `docs/work-items/B-SLICE-001-report.md`
- Create: `docs/work-items/B-SLICE-001-review-package.md`
- Create: `docs/work-items/B-SLICE-001-review.md`
- Create: `docs/evidence/EV-20260812-031-b-slice-001.md`
- Modify: `docs/开发进度.md`
- Modify: `总功能开发计划0.3.md`
- Modify: `shared/traceability/tasks.json`
- Modify: `shared/traceability/evidence.json`

**Interfaces:**
- Consumes: one frozen candidate SHA and fresh outputs from every prior task.
- Produces: auditable E-STOR+E-CASE evidence; `B-SLICE-001=已完成`; only `B-FAULT-001` becomes the next task.

- [ ] **Step 1: Run the complete local gate on one SHA**

Run, without editing between commands:

```powershell
& $nodeExe .\node_modules\vitest\vitest.mjs run
& $nodeExe .\node_modules\typescript\bin\tsc -p .\tsconfig.json --noEmit
& $nodeExe .\tests\repository-concurrency.mjs
& $nodeExe .\tests\b-slice-crash-harness.mjs
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins build --check --root . --entry .\dist\index.js
& $nodeExe .\node_modules\openclaw\openclaw.mjs plugins validate --root . --entry .\dist\index.js
```

Then run the allowed shared trace, gate, and acceptance validators. Record exact case/test counts, hashes, runtime range, fixture cleanup, and zero model calls.

- [ ] **Step 2: Confirm the public tool remains non-writing**

Run the existing foundation test and assert `handleFoundationAction()` still returns `foundation_not_implemented` with `committed:false`. Confirm no `selected-route-map.json` exists.

- [ ] **Step 3: Write the report and review package**

The report must list all 17 cases, their real assertion paths, candidate SHA, failures discovered and fixed, deferred non-G2 work, and the explicit statement “not installable; public OpenClaw tool remains non-writing.” The review package contains reproducible commands and no tokens, machine-private URLs, user data, or protected file content.

- [ ] **Step 4: Perform independent review and fix all P0/P1 findings**

Review must inspect business semantics, transaction grouping, replay, append-only corrections, query write count, failure logs, public boundary, and open-source hygiene. Any code fix changes the candidate SHA and requires rerunning the affected gate plus final full gate.

- [ ] **Step 5: Update progress and traceability**

Set `B-SLICE-001` to completed only after the fresh evidence and P0=0/P1=0 review exist. Add `EV-20260812-031`; regenerate trace data; verify there are no orphan requirement/case/task/evidence references. Leave `B-FAULT-001` not started and identify it as the only next implementation task.

- [ ] **Step 6: Final verification and commit**

```powershell
git diff --check
git status --short
git add docs shared/traceability 总功能开发计划0.3.md
git commit -m "docs: close B vertical slice"
git push origin agent/b-slice-001-vertical
```

Verify local and remote heads match and the working tree is clean.

---

## Execution Order and Checkpoints

1. Tasks 1–2 establish types and repository grouping; checkpoint review before domain writes.
2. Tasks 3–5 produce a usable purchase/meal/query/receipt slice; checkpoint with fresh SQLite tests.
3. Tasks 6–7 add append-only correction and mixed orchestration; checkpoint against the design and public contracts.
4. Tasks 8–9 bind all 17 cases and crash/failure evidence.
5. Task 10 freezes the candidate, performs independent review, updates plan 0.3, and publishes the branch.

No task may claim completion from static inspection alone. Every task must show its RED, GREEN, regression result, and commit SHA before the next task changes its files.
