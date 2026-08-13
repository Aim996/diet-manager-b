import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/authority/canonical-json.js";
import {
  applyCorrectionEffects,
  applyMealEffects,
  prepareCorrectionOperation,
  prepareMealOperation,
  preparePurchaseOperation,
} from "../src/domain/effect-bundle.js";
import { deriveDomainId } from "../src/domain/identity.js";
import { createServerPreview } from "../src/preview/store.js";
import { buildQuickPrompt, buildReceiptData } from "../src/domain/receipt.js";
import {
  createDietDomainService,
  type DietDomainFailureEntry,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
  QueryInventoryOperation,
} from "../src/domain/types.js";
import { finalizeEnvelope } from "../src/repository/envelope-finalize.js";
import {
  appendPreparedOperationFact,
  commitPreparedFact,
  sealPreparedEnvelopeFacts,
} from "../src/repository/fact-commit.js";
import { computeRepositoryDataRevision } from "../src/repository/revision.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-SLICE-001 purchase test secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-b-slice-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function canonicalBusinessSnapshot(database: DatabaseSync): Record<string, unknown> {
  const tables = database.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
     ORDER BY name`,
  ).all() as Array<{ name: string }>;
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]));
}

const failureDiagnosticKeys = ["error_code", "input_digest", "stage", "trace_id"];

function installRepositoryAppendFailure(
  database: DatabaseSync,
  operationId: string,
  detail: string,
): void {
  if (!/^[a-z0-9-]+$/.test(operationId) || !/^[a-z0-9_]+$/.test(detail)) {
    throw new Error("test repository fault identity invalid");
  }
  database.exec(`
    CREATE TEMP TRIGGER "fail_${detail}"
    AFTER INSERT ON main.event_records
    WHEN NEW.operation_id = '${operationId}'
    BEGIN
      SELECT RAISE(ABORT, 'FACT_COMMIT_FAILED:${detail}');
    END
  `);
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected test operation to fail");
}

function expectSafeMixedFailure(
  entry: DietDomainFailureEntry,
  expected: {
    readonly stage: DietDomainFailureEntry["stage"];
    readonly errorCode: string;
    readonly traceId: string;
    readonly inputDigest: string;
  },
  forbidden: readonly string[],
): void {
  expect(Object.keys(entry).sort()).toEqual(failureDiagnosticKeys);
  expect(entry).toEqual({
    stage: expected.stage,
    error_code: expected.errorCode,
    trace_id: expected.traceId,
    input_digest: expected.inputDigest,
  });
  expect(Object.isFrozen(entry)).toBe(true);
  const serialized = JSON.stringify(entry).toLowerCase();
  for (const value of forbidden) expect(serialized).not.toContain(value.toLowerCase());
}

describe("B-FAULT-001 single-meal stable finalization recovery", () => {
  it("finalizes an already sealed home meal without rewriting its Fact or Effect rows", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      previewAndExecute(service, purchaseMilkEnvelope({ suffix: "stable-meal-stock" }));
      const envelope = mealEnvelope({
        suffix: "stable-finalization-recovery",
        location: "home",
        items: [mealItem({
          name: "whole milk 250ml", unit: "carton", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "stable-finalization-home-milk-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "carton" })],
        })],
      });
      const preview = service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "record_meal") throw new Error("test operation mismatch");
      const factTime = (runtime.database.prepare(
        "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { received_at: string }).received_at;
      const prepared = prepareMealOperation({
        database: runtime.database, secret, token: preview.token,
        inputDigest: preview.input_digest, dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope, commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key, sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id, receivedAt: envelope.received_at,
        committedAt: factTime, sequence: 0, operation,
      });
      appendPreparedOperationFact(prepared.fact);
      applyMealEffects({
        database: runtime.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
        operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: envelope.received_at,
        location: operation.location,
      });
      sealPreparedEnvelopeFacts({
        database: runtime.database, secret, token: preview.token, inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope, commandType: envelope.command_type,
        dataRevision: preview.data_revision, traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]), sealedAt: envelope.received_at,
      });
      expect(runtime.database.prepare(
        "SELECT received_at, committed_at FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ received_at: envelope.received_at, committed_at: factTime });
      const unrelatedBase = mealEnvelope({
        suffix: "stable-finalization-later",
        location: "outside",
        items: [mealItem({
          name: "later pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: null,
          sources: [nutritionSource("public_fixture", "stable-finalization-later-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      });
      const unrelated = {
        ...unrelatedBase,
        operations: [{
          ...unrelatedBase.operations[0],
          occurred_at: "2026-08-13T12:00:00.000Z",
        }],
      };
      expect(previewAndExecute(service, unrelated).status).toBe("committed");
      expect(runtime.database.prepare(
        "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ received_at: factTime });
      const rows = (sql: string) => runtime.database.prepare(sql).all(envelope.envelope_id);
      const before = canonicalJson({
        events: rows("SELECT * FROM event_records WHERE envelope_id = ? ORDER BY event_id"),
        items: rows("SELECT m.* FROM meal_items m JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ? ORDER BY m.item_id"),
        profiles: rows("SELECT p.* FROM nutrition_profiles p JOIN nutrition_snapshots n ON n.nutrition_profile_id = p.nutrition_profile_id JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ? ORDER BY p.nutrition_profile_id"),
        snapshots: rows("SELECT n.* FROM nutrition_snapshots n JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ? ORDER BY n.snapshot_id"),
        transactions: rows("SELECT t.* FROM inventory_transactions t JOIN event_records e ON e.event_id = t.event_id WHERE e.envelope_id = ? ORDER BY t.transaction_id"),
        issues: rows("SELECT i.* FROM issues i JOIN meal_items m ON m.item_id = i.entity_id JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ? ORDER BY i.issue_id"),
        outbox: rows("SELECT * FROM effect_outbox WHERE envelope_id = ? ORDER BY outbox_id"),
        bundles: rows("SELECT * FROM effect_bundle_commits WHERE envelope_id = ? ORDER BY operation_id"),
      });
      const input = { envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision } as const;
      const beforeRecovery = canonicalBusinessSnapshot(runtime.database);

      const recovered = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:02.000Z" }).execute(input);
      expect(recovered.status).toBe("committed");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?").get(envelope.envelope_id)).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 2 });
      expect((recovered.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } }).daily_progress.nutrients.energy_kcal_milli).toBe(100_000);
      expect(canonicalJson({
        events: rows("SELECT * FROM event_records WHERE envelope_id = ? ORDER BY event_id"),
        items: rows("SELECT m.* FROM meal_items m JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ? ORDER BY m.item_id"),
        profiles: rows("SELECT p.* FROM nutrition_profiles p JOIN nutrition_snapshots n ON n.nutrition_profile_id = p.nutrition_profile_id JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ? ORDER BY p.nutrition_profile_id"),
        snapshots: rows("SELECT n.* FROM nutrition_snapshots n JOIN event_records e ON e.event_id = n.meal_event_id WHERE e.envelope_id = ? ORDER BY n.snapshot_id"),
        transactions: rows("SELECT t.* FROM inventory_transactions t JOIN event_records e ON e.event_id = t.event_id WHERE e.envelope_id = ? ORDER BY t.transaction_id"),
        issues: rows("SELECT i.* FROM issues i JOIN meal_items m ON m.item_id = i.entity_id JOIN event_records e ON e.event_id = m.event_id WHERE e.envelope_id = ? ORDER BY i.issue_id"),
        outbox: rows("SELECT * FROM effect_outbox WHERE envelope_id = ? ORDER BY outbox_id"),
        bundles: rows("SELECT * FROM effect_bundle_commits WHERE envelope_id = ? ORDER BY operation_id"),
      })).toBe(before);
      const afterRecovery = canonicalBusinessSnapshot(runtime.database);
      const finalizerTables = new Set([
        "command_envelopes",
        "daily_progress_snapshots",
        "envelope_finalizations",
        "idempotency_records",
      ]);
      for (const [table, rowsBefore] of Object.entries(beforeRecovery)) {
        if (!finalizerTables.has(table)) expect(afterRecovery[table]).toEqual(rowsBefore);
      }
      const beforeFrozenReplay = canonicalJson(afterRecovery);
      const frozen = service.execute(input);
      expect(frozen).toEqual(recovered);
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?").get(envelope.envelope_id)).toEqual({ count: 1 });
      expect(canonicalJson(canonicalBusinessSnapshot(runtime.database))).toBe(beforeFrozenReplay);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rejects tampered stable meal event, item, effect, and bundle authority", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      const envelope = mealEnvelope({
        suffix: "stable-terminal-event-tamper",
        location: "outside",
        items: [mealItem({
          name: "tampered terminal pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: null,
          sources: [nutritionSource("public_fixture", "stable-terminal-tamper-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      });
      const preview = service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "record_meal") throw new Error("test operation mismatch");
      const factTime = (runtime.database.prepare(
        "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { received_at: string }).received_at;
      const prepared = prepareMealOperation({
        database: runtime.database, secret, token: preview.token,
        inputDigest: preview.input_digest, dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope, commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key, sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id, receivedAt: envelope.received_at,
        committedAt: factTime, sequence: 0, operation,
      });
      appendPreparedOperationFact(prepared.fact);
      applyMealEffects({
        database: runtime.database, envelopeId: envelope.envelope_id, operationId: operation.operation_id,
        operationSequence: 0, idempotencyKey: envelope.idempotency_key, now: factTime,
        location: operation.location,
      });
      sealPreparedEnvelopeFacts({
        database: runtime.database, secret, token: preview.token, inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope, commandType: envelope.command_type,
        dataRevision: preview.data_revision, traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]), sealedAt: factTime,
      });
      runtime.database.prepare(
        "UPDATE event_records SET source_message_id = ? WHERE envelope_id = ?",
      ).run("tampered-source", envelope.envelope_id);

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_source");
      runtime.database.prepare(
        "UPDATE event_records SET source_message_id = ? WHERE envelope_id = ?",
      ).run(envelope.source_message_id, envelope.envelope_id);
      runtime.database.prepare(
        "UPDATE meal_items SET normalized_name = ? WHERE event_id = ?",
      ).run("tampered-item", prepared.fact.event.eventId);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:terminal_item");
      runtime.database.prepare(
        "UPDATE meal_items SET normalized_name = ? WHERE event_id = ?",
      ).run(operation.items[0].normalized_name, prepared.fact.event.eventId);
      runtime.database.prepare(
        `UPDATE effect_outbox SET effect_kind = 'tampered_effect'
         WHERE envelope_id = ? AND effect_kind = 'nutrition_snapshot'`,
      ).run(envelope.envelope_id);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:terminal_effects");
      runtime.database.prepare(
        `UPDATE effect_outbox SET effect_kind = 'nutrition_snapshot'
         WHERE envelope_id = ? AND effect_kind = 'tampered_effect'`,
      ).run(envelope.envelope_id);
      runtime.database.prepare(
        `UPDATE effect_bundle_commits
         SET payload_json = REPLACE(payload_json, 'diet-manager/effect-bundle/v1', 'tampered/bundle')
         WHERE envelope_id = ?`,
      ).run(envelope.envelope_id);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:terminal_checkpoint");
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

function purchaseMilkEnvelope(
  options: {
    suffix?: string;
    batchId?: string;
    profileVersion?: number;
    sourceRef?: string;
  } = {},
): DomainEnvelopeInput {
  const suffix = options.suffix ?? "001";
  return {
    envelope_id: `envelope-purchase-milk-${suffix}`,
    idempotency_key: `idem-purchase-milk-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-purchase-milk-${suffix}`,
    conversation_id: "conversation-purchase-milk-001",
    received_at: "2026-08-12T01:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "add_inventory",
        operation_id: `operation-purchase-milk-${suffix}`,
        product: {
          product_id: "fixture-product-milk-whole-250",
          normalized_name: "whole milk 250ml",
          product_type: "nutrition_drink",
        },
        batch_id: options.batchId ?? `batch-purchase-milk-${suffix}`,
        amount: {
          unit: "carton",
          observed_microunits: 24_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: 12_000_000,
          evidence: "explicit",
        },
        nutrition_sources: [
          {
            source_type: "product_label",
            source_ref: options.sourceRef ?? "label-whole-milk-250-v1",
            profile_version: options.profileVersion ?? 1,
            applicable_product_id: "fixture-product-milk-whole-250",
            basis_kind: "per_package",
            basis_microunits: 1_000_000,
            basis_unit: "carton",
            nutrients: {
              energy_kcal_milli: 160_000,
              protein_mg: 8_000,
              fat_mg: 9_000,
              carbohydrate_mg: 12_000,
              fiber_mg: null,
              water_ml_milli: null,
            },
          },
        ],
      },
    ],
  };
}

function queryInventory(): QueryInventoryOperation {
  return { kind: "query_inventory", operation_id: "query-inventory-001" };
}

function nutritionSource(
  sourceType: "product_label" | "public_fixture",
  sourceRef: string,
  profileVersion: number,
  productId: string | null,
  basis: {
    kind: NutritionSourceCandidate["basis_kind"];
    microunits: number;
    unit: string;
  },
) : NutritionSourceCandidate {
  return {
    source_type: sourceType,
    source_ref: sourceRef,
    profile_version: profileVersion,
    applicable_product_id: productId,
    basis_kind: basis.kind,
    basis_microunits: basis.microunits,
    basis_unit: basis.unit,
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: null,
      water_ml_milli: null,
    },
  };
}

function overflowingPublicNutritionSource(sourceRef: string): NutritionSourceCandidate {
  return {
    ...nutritionSource(
      "public_fixture",
      sourceRef,
      1,
      null,
      { kind: "per_item", microunits: 1_000_000, unit: "piece" },
    ),
    nutrients: {
      energy_kcal_milli: Number.MAX_SAFE_INTEGER,
      protein_mg: 0,
      fat_mg: 0,
      carbohydrate_mg: 0,
      fiber_mg: 0,
      water_ml_milli: 0,
    },
  };
}

function purchaseStockEnvelope(options: {
  suffix: string;
  productId: string;
  normalizedName: string;
  batchId: string;
  quantityMicrounits: number;
  unit: string;
  nutritionBasis?: {
    kind: NutritionSourceCandidate["basis_kind"];
    microunits: number;
    unit: string;
  };
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-stock-${options.suffix}`,
    idempotency_key: `idem-stock-${options.suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-stock-${options.suffix}`,
    conversation_id: "conversation-meal-matrix",
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "add_inventory",
        operation_id: `operation-stock-${options.suffix}`,
        product: {
          product_id: options.productId,
          normalized_name: options.normalizedName,
          product_type: "food",
        },
        batch_id: options.batchId,
        amount: {
          unit: options.unit,
          observed_microunits: options.quantityMicrounits,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "explicit",
        },
        nutrition_sources: [
          nutritionSource(
            "product_label",
            `label-${options.productId}-v1`,
            1,
            options.productId,
            options.nutritionBasis ?? (options.unit === "g"
              ? { kind: "per_100g", microunits: 100_000_000, unit: "g" }
              : { kind: "per_item", microunits: 1_000_000, unit: options.unit }),
          ),
        ],
      },
    ],
  };
}

function mealItem(options: {
  name: string;
  unit: string;
  observed: number;
  adopted: number | null;
  deducted: number | null;
  evidence?: "explicit" | "estimated_upper_bound";
  sources: readonly NutritionSourceCandidate[];
}): MealItemInput {
  return {
    normalized_name: options.name,
    item_type: "food",
    amount: {
      unit: options.unit,
      observed_microunits: options.observed,
      nutrition_adoption_microunits: options.adopted,
      inventory_deduction_microunits: options.deducted,
      template_reference_microunits: null,
      evidence: options.evidence ?? "explicit",
    },
    nutrition_sources: options.sources,
  };
}

function mealEnvelope(options: {
  suffix: string;
  location: "home" | "outside";
  items: readonly MealItemInput[];
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-meal-${options.suffix}`,
    idempotency_key: `idem-meal-${options.suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-meal-${options.suffix}`,
    conversation_id: "conversation-meal-matrix",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "record_meal",
        operation_id: `operation-meal-${options.suffix}`,
        occurred_at: "2026-08-12T12:00:00.000Z",
        meal_slot: "lunch",
        location: options.location,
        items: options.items,
      },
    ],
  };
}

function mixedPurchaseAndDrinkEnvelope(
  options: { suffix?: string; mealUnit?: string } = {},
): DomainEnvelopeInput {
  const suffix = options.suffix ?? "001";
  const purchase = purchaseMilkEnvelope({ suffix: `mixed-${suffix}` });
  const meal = mealEnvelope({
    suffix: `mixed-${suffix}`,
    location: "home",
    items: [mealItem({
      name: "whole milk 250ml",
      unit: options.mealUnit ?? "carton",
      observed: 1_000_000,
      adopted: 1_000_000,
      deducted: 1_000_000,
      sources: [{
        source_type: "product_label",
        source_ref: "label-whole-milk-250-v1",
        profile_version: 1,
        applicable_product_id: "fixture-product-milk-whole-250",
        basis_kind: "per_package",
        basis_microunits: 1_000_000,
        basis_unit: "carton",
        nutrients: {
          energy_kcal_milli: 160_000,
          protein_mg: 8_000,
          fat_mg: 9_000,
          carbohydrate_mg: 12_000,
          fiber_mg: null,
          water_ml_milli: null,
        },
      }],
    })],
  });
  return {
    envelope_id: `envelope-mixed-purchase-drink-${suffix}`,
    idempotency_key: `idem-mixed-purchase-drink-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-mixed-purchase-drink-${suffix}`,
    conversation_id: "conversation-mixed-purchase-drink-001",
    received_at: "2026-08-12T03:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Object.freeze([purchase.operations[0]!, meal.operations[0]!]),
  };
}

function correctionEnvelope(options: {
  suffix: string;
  targetEventId: string;
  baseRevision: number;
  observed: number;
  adopted: number | null;
  deducted: number | null;
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-correction-${options.suffix}`,
    idempotency_key: `idem-correction-${options.suffix}`,
    command_type: "correct_record",
    subject_scope: "user:self",
    source_message_id: `message-correction-${options.suffix}`,
    conversation_id: "conversation-correction-matrix",
    received_at: "2026-08-12T05:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "correct_record",
        operation_id: `operation-correction-${options.suffix}`,
        target_event_id: options.targetEventId,
        base_revision: options.baseRevision,
        item_order: 0,
        replacement_amount: {
          unit: "piece",
          observed_microunits: options.observed,
          nutrition_adoption_microunits: options.adopted,
          inventory_deduction_microunits: options.deducted,
          template_reference_microunits: null,
          evidence: "explicit",
        },
      },
    ],
  };
}

function undoEnvelope(options: {
  suffix: string;
  targetEventId: string;
  baseRevision: number;
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-undo-${options.suffix}`,
    idempotency_key: `idem-undo-${options.suffix}`,
    command_type: "undo_record",
    subject_scope: "user:self",
    source_message_id: `message-undo-${options.suffix}`,
    conversation_id: "conversation-correction-matrix",
    received_at: "2026-08-12T06:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "undo_record",
        operation_id: `operation-undo-${options.suffix}`,
        target_event_id: options.targetEventId,
        base_revision: options.baseRevision,
      },
    ],
  };
}

function seedPurchase(service: DietDomainService, envelope: DomainEnvelopeInput): void {
  expect(previewAndExecute(service, envelope).status).toBe("committed");
}

function tableCounts(database: DatabaseSync): Record<string, number> {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables.map(({ name }) => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as {
        count: number;
      };
      return [name, row.count];
    }),
  );
}

function businessCounts(database: DatabaseSync): Record<string, number> {
  const control = new Set(["schema_migrations", "command_envelopes", "idempotency_records"]);
  return Object.fromEntries(
    Object.entries(tableCounts(database)).filter(([name]) => !control.has(name)),
  );
}

function previewAndExecute(service: DietDomainService, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  return service.execute({
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

describe("SEL-CORE-001 meal evidence vertical slice", () => {
  it("commits optional occurrence, subject, context, and source evidence with the meal event", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const base = mealEnvelope({
        suffix: "core-evidence-vertical",
        location: "outside",
        items: [mealItem({
          name: "apple",
          unit: "piece",
          observed: 1_000_000,
          adopted: null,
          deducted: null,
          sources: [],
        })],
      });
      const meal = base.operations[0];
      if (meal?.kind !== "record_meal") throw new Error("test meal operation missing");
      const envelope = {
        ...base,
        received_at: "2026-08-11T00:30:00.000Z",
        operations: [{
          ...meal,
          occurred_at: "2026-08-11T00:30:00.000Z",
          source_text: "吃了一个苹果。",
          occurred_time: {
            raw_text: null,
            resolved_start: "2026-08-11T08:30:00+08:00",
            resolved_end: "2026-08-11T08:31:00+08:00",
            precision: "exact",
            timezone: "Asia/Shanghai",
            resolution_basis: "default_received_at",
            resolution_anchor: "2026-08-11T08:30:00+08:00",
            resolver_version: "diet-manager/time-parser-v1",
          },
          subject: {
            kind: "self",
            resolution_basis: "omitted_subject_default",
            subject_entity_created: false,
            matched_span: null,
            rule_version: "diet-manager/subject-v1",
          },
          context: {
            scene: "unknown",
            expired_context_ids: [],
            inventory_read: false,
            accepted_context: null,
            rule_version: "diet-manager/context-v1",
          },
        }],
      } as unknown as DomainEnvelopeInput;

      expect(previewAndExecute(service, envelope).status).toBe("committed");
      const payloadJson = (runtime.database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string }).payload_json;
      expect(JSON.parse(payloadJson)).toMatchObject({
        authority_kind: "diet-manager/meal-fact/v1",
        source_text: "吃了一个苹果。",
        occurred_time: {
          resolved_start: "2026-08-11T08:30:00+08:00",
          resolver_version: "diet-manager/time-parser-v1",
        },
        subject: {
          kind: "self",
          resolution_basis: "omitted_subject_default",
          rule_version: "diet-manager/subject-v1",
        },
        context: {
          scene: "unknown",
          rule_version: "diet-manager/context-v1",
        },
      });
      expect(canonicalJson(JSON.parse(payloadJson))).toBe(payloadJson);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("B-SLICE-001 structured receipt and quick prompt builders", () => {
  const progress = Object.freeze({
    date: "2026-08-12",
    timezone: "Asia/Shanghai" as const,
    coverage_status: "complete" as const,
    nutrients: Object.freeze({
      energy_kcal_milli: 350_000,
      protein_mg: 20_000,
      fat_mg: 8_000,
      carbohydrate_mg: 50_000,
      fiber_mg: 5_000,
      water_ml_milli: 300_000,
    }),
  });

  it("CASE-RECEIPT-001 builds ordered multi-item data without leaking internal IDs", () => {
    const receipt = buildReceiptData(Object.freeze({
      status: "committed" as const,
      date: "2026-08-12",
      meal_slot: "lunch",
      items: Object.freeze([
        Object.freeze({
          item_order: 0,
          normalized_name: "rice",
          unit: "g",
          observed_microunits: 200_000_000,
          nutrition_adoption_microunits: 200_000_000,
          inventory_deduction_microunits: 200_000_000,
          estimated_fields: Object.freeze([]),
          inventory_match: "matched" as const,
          issue_codes: Object.freeze([]),
          inventory_transaction_id: "transaction-must-not-leak",
          nutrition_source_type: "product_label" as const,
          nutrition_profile_version: 1,
          nutrients: progress.nutrients,
        }),
        Object.freeze({
          item_order: 1,
          normalized_name: "chicken",
          unit: "g",
          observed_microunits: 150_000_000,
          nutrition_adoption_microunits: 150_000_000,
          inventory_deduction_microunits: 150_000_000,
          estimated_fields: Object.freeze([]),
          inventory_match: "matched" as const,
          issue_codes: Object.freeze([]),
          inventory_transaction_id: "transaction-also-must-not-leak",
          nutrition_source_type: "product_label" as const,
          nutrition_profile_version: 1,
          nutrients: progress.nutrients,
        }),
      ]),
      quick_prompts: Object.freeze([]),
      daily_progress: progress,
    }));

    expect(receipt.blocks.map((block) => block.kind)).toEqual([
      "title", "item", "item", "progress",
    ]);
    expect(receipt).toMatchObject({
      authority_kind: "diet-manager/receipt-data/v1",
      status: "success",
      blocks: [
        { kind: "title", date: "2026-08-12", meal_slot: "lunch" },
        {
          kind: "item", item_order: 0, name: "rice",
          amount: { observed_microunits: 200_000_000, unit: "g", evidence: "explicit" },
          inventory_effect: { status: "matched" },
        },
        {
          kind: "item", item_order: 1, name: "chicken",
          amount: { observed_microunits: 150_000_000, unit: "g", evidence: "explicit" },
          inventory_effect: { status: "matched" },
        },
        { kind: "progress", daily_progress: progress },
      ],
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("event-");
    expect(serialized).not.toContain("transaction-");
    expect(serialized).not.toContain("batch-");
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.blocks)).toBe(true);
  });

  it("CASE-RECEIPT-003 offers 2-4 stable options with free text last", () => {
    const prompt = buildQuickPrompt(Object.freeze({
      issue_id: "issue-5d86a475fd5359d4827a2ae7c645aeb3",
      issue_code: "inventory_multiple_candidates" as const,
      revision: 1,
      generated_at: "2026-08-12T04:00:01.000Z",
      expires_at: "2026-08-12T05:00:01.000Z",
    }));

    expect(prompt).toMatchObject({
      authority_kind: "diet-manager/quick-prompt/v1",
      issue_id: "issue-5d86a475fd5359d4827a2ae7c645aeb3",
      option_ids: ["keep_original", "defer", "free_text"],
      generated_from_revision: 1,
      generated_at: "2026-08-12T04:00:01.000Z",
      expires_at: "2026-08-12T05:00:01.000Z",
      safe_exit_required: true,
      accepts_combinations: true,
      accepts_natural_language: true,
      free_text_line: "也可以直接说明实际情况，不必选择以上选项。",
    });
    expect(prompt.options).toHaveLength(3);
    expect(prompt.options.length).toBeGreaterThanOrEqual(2);
    expect(prompt.options.length).toBeLessThanOrEqual(4);
    expect(prompt.options.at(-1)).toEqual({
      option_id: "free_text",
      kind: "free_text",
      label: "也可以直接说明实际情况，不必选择以上选项。",
    });
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.options)).toBe(true);
  });

  it("does not turn effects_pending into a success receipt or progress block", () => {
    const receipt = buildReceiptData(Object.freeze({
      status: "effects_pending" as const,
      date: "2026-08-12",
      meal_slot: "lunch",
      items: Object.freeze([]),
      quick_prompts: Object.freeze([]),
      daily_progress: null,
    }));
    expect(receipt).toEqual({
      authority_kind: "diet-manager/receipt-data/v1",
      status: "pending",
      blocks: [{ kind: "pending", code: "effects_pending" }],
    });
    expect(JSON.stringify(receipt)).not.toContain("title");
    expect(JSON.stringify(receipt)).not.toContain("progress");
  });
});

describe("B-SLICE-001 purchase and inventory vertical slice", () => {
  it("adds two boxes of 12 milk cartons and queries one 24-carton batch", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T01:00:00.000Z",
    });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      const result = previewAndExecute(service, purchaseMilkEnvelope());

      expect(result.status).toBe("committed");
      expect(result.items).toEqual([
        expect.objectContaining({
          sequence: 0,
          operation_id: "operation-purchase-milk-001",
          status: "committed",
          batch_id: "batch-purchase-milk-001",
          product_id: "fixture-product-milk-whole-250",
          inventory_quantity_microunits: 24_000_000,
          unit: "carton",
        }),
      ]);

      const beforeQuery = tableCounts(runtime.database);
      expect(service.query(queryInventory())).toEqual({
        kind: "inventory",
        batches: [
          expect.objectContaining({
            batch_id: "batch-purchase-milk-001",
            product_id: "fixture-product-milk-whole-250",
            normalized_name: "whole milk 250ml",
            quantity_microunits: 24_000_000,
            unit: "carton",
          }),
        ],
      });
      expect(tableCounts(runtime.database)).toEqual(beforeQuery);

      expect(
        runtime.database
          .prepare(
            `SELECT subject_type, subject_id, profile_version, source_type, source_ref,
                    coverage_status
             FROM nutrition_profiles`,
          )
          .all(),
      ).toEqual([
        {
          subject_type: "product",
          subject_id: "fixture-product-milk-whole-250",
          profile_version: "1",
          source_type: "product_label",
          source_ref: "label-whole-milk-250-v1",
          coverage_status: "partial",
        },
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("replays one frozen purchase without creating any new row", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      const envelope = purchaseMilkEnvelope();
      const preview = service.preview(envelope);
      const executeInput = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;
      const first = service.execute(executeInput);
      const beforeReplay = tableCounts(runtime.database);

      expect(service.execute(executeInput)).toEqual(first);
      expect(tableCounts(runtime.database)).toEqual(beforeReplay);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps one stable product while adding a second batch with label profile v2", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      previewAndExecute(service, purchaseMilkEnvelope());
      previewAndExecute(
        service,
        purchaseMilkEnvelope({
          suffix: "002",
          batchId: "batch-purchase-milk-002",
          profileVersion: 2,
          sourceRef: "label-whole-milk-250-v2",
        }),
      );

      expect(
        runtime.database.prepare("SELECT COUNT(*) AS count FROM products").get(),
      ).toEqual({ count: 1 });
      expect(
        runtime.database
          .prepare(
            `SELECT profile_version, source_ref FROM nutrition_profiles
             ORDER BY CAST(profile_version AS INTEGER)`,
          )
          .all(),
      ).toEqual([
        { profile_version: "1", source_ref: "label-whole-milk-250-v1" },
        { profile_version: "2", source_ref: "label-whole-milk-250-v2" },
      ]);
      expect(service.query(queryInventory()).batches.map((batch) => batch.batch_id)).toEqual([
        "batch-purchase-milk-001",
        "batch-purchase-milk-002",
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("adds a new batch and label profile without rewriting one legacy product payload", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const legacyPayload = '{"authority":"legacy-fixture","synthetic":true}';
      runtime.database
        .prepare(
          `INSERT INTO products(
            product_id, schema_version, normalized_name, product_type,
            brand, manufacturer, barcode, sku, payload_json
          ) VALUES (?, 'domain/v2', ?, ?, NULL, NULL, NULL, NULL, ?)`,
        )
        .run(
          "fixture-product-milk-whole-250",
          "whole milk 250ml",
          "nutrition_drink",
          legacyPayload,
        );
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });

      expect(previewAndExecute(service, purchaseMilkEnvelope()).status).toBe("committed");
      expect(
        runtime.database
          .prepare("SELECT payload_json FROM products WHERE product_id = ?")
          .get("fixture-product-milk-whole-250"),
      ).toEqual({ payload_json: legacyPayload });
      expect(
        runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_profiles").get(),
      ).toEqual({ count: 1 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("CASE-EFFECT-001 redacts a FactCommit failure and rolls back every business row", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: Array<{
      phase: "fact_commit";
      error_code: string;
      trace_id: string;
      input_digest: string;
    }> = [];
    try {
      const dataRevision = computeRepositoryDataRevision(runtime.database);
      const preview = createServerPreview({
        database: runtime.database,
        secret,
        previewId: "preview-case-effect-001",
        idempotencyKey: "idem-case-effect-001",
        inputDigest: "A".repeat(64),
        subjectScope: "user:self",
        commandType: "add_inventory",
        dataRevision,
        sourceMessageId: "message-case-effect-001",
        conversationId: "conversation-case-effect-001",
        previewMaterial: { action: "add_inventory", synthetic: true },
        now: "2026-08-12T01:00:00.000Z",
      });

      expect(() =>
        commitPreparedFact({
          database: runtime.database,
          secret,
          token: preview.token,
          inputDigest: "A".repeat(64),
          subjectScope: "user:self",
          commandType: "add_inventory",
          dataRevision,
          traceId: "trace-case-effect-001",
          event: {
            eventId: "event-case-effect-001",
            operationId: "operation-case-effect-001",
            schemaVersion: "domain/v2",
            eventType: "inventory_stock",
            factKind: "inventory",
            sourceMessageId: "message-case-effect-001",
            conversationId: "conversation-case-effect-001",
            receivedAt: "2026-08-12T01:00:00.000Z",
            committedAt: "2026-08-12T01:00:01.000Z",
            occurredAtText: "2026-08-12T01:00:00.000Z",
            mealId: null,
            mealSlot: null,
            payload: { authority_kind: "diet-manager/test-fact/v1" },
          },
          items: [],
          effects: [{
            outboxId: "outbox-case-effect-001",
            effectId: "effect-case-effect-001",
            effectKind: "inventory_add",
            previousState: null,
            reason: null,
          }],
        }, {
          fault: "before_commit",
          failureSink: (entry) => failures.push(entry),
        }),
      ).toThrow("FACT_COMMIT_FAILED:before_commit");
      expect(Object.values(businessCounts(runtime.database)).every((count) => count === 0)).toBe(
        true,
      );
      expect(failures).toEqual([
        {
          phase: "fact_commit",
          error_code: "FACT_COMMIT_FAILED",
          trace_id: "trace-case-effect-001",
          input_digest: "A".repeat(64),
        },
      ]);
      const serialized = JSON.stringify(failures);
      for (const forbidden of [
        "milk",
        "whole milk 250ml",
        "24_000_000",
        "inventory",
        "SELECT",
        "INSERT",
        "B-SLICE-001 purchase test secret 0001",
        root,
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back the label profile and every inventory row on an EffectBundle failure", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: DietDomainFailureEntry[] = [];
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
        fault: "after_inventory_business_writes",
        failureSink: (entry) => failures.push(entry),
      });
      const envelope = purchaseMilkEnvelope();
      const preview = service.preview(envelope);

      expect(() =>
        service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        }),
      ).toThrow("INVENTORY_EFFECT_FAILED:after_business_writes");
      for (const table of [
        "products",
        "nutrition_profiles",
        "inventory_batches",
        "inventory_transactions",
        "inventory_batch_projections",
      ]) {
        expect(runtime.database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()).toEqual({
          count: 0,
        });
      }
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({
        count: 1,
      });
      expect(
        runtime.database
          .prepare("SELECT state, attempt_count FROM effect_outbox")
          .get(),
      ).toEqual({ state: "pending", attempt_count: 0 });
      expect(failures).toEqual([
        {
          stage: "EffectBundle",
          error_code: "INVENTORY_EFFECT_FAILED",
          trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
          input_digest: preview.input_digest,
        },
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("B-SLICE-001 ordered mixed purchase and meal orchestration", () => {
  it("preserves legacy purchase effect identities when no scoped child key is supplied", () => {
    const envelope = purchaseMilkEnvelope({ suffix: "legacy-sequence" });
    const operation = envelope.operations[0];
    if (operation?.kind !== "add_inventory") throw new Error("expected purchase operation");
    const sequence = 7;
    const prepared = preparePurchaseOperation({
      database: {} as DatabaseSync,
      secret,
      token: "token-legacy-purchase-sequence",
      inputDigest: "A".repeat(64),
      dataRevision: "B".repeat(64),
      subjectScope: envelope.subject_scope,
      commandType: envelope.command_type,
      idempotencyKey: envelope.idempotency_key,
      sourceMessageId: envelope.source_message_id,
      conversationId: envelope.conversation_id,
      receivedAt: envelope.received_at,
      committedAt: "2026-08-12T03:00:00.000Z",
      sequence,
      operation,
    });

    const expectedEffectId = deriveDomainId("effect", envelope.idempotency_key, sequence);
    expect(prepared.fact.effects).toEqual([
      expect.objectContaining({
        effectId: expectedEffectId,
        outboxId: deriveDomainId("outbox", envelope.idempotency_key, sequence),
      }),
    ]);
    expect(
      (prepared.fact.event.payload as {
        effect_inputs: Record<string, { transaction_id: string }>;
      }).effect_inputs[expectedEffectId]?.transaction_id,
    ).toBe(deriveDomainId("transaction", envelope.idempotency_key, sequence));
  });

  it.each([
    {
      id: "purchase-fact",
      fault: undefined,
      repositoryFailureSequence: 0,
      repositoryFailureDetail: "mixed_purchase_repository_append",
      stage: "FactCommit",
      errorCode: "FACT_COMMIT_FAILED",
      primaryError: "FACT_COMMIT_FAILED:mixed_purchase_repository_append",
      durableEventTypes: [],
    },
    {
      id: "meal-fact",
      fault: undefined,
      repositoryFailureSequence: 1,
      repositoryFailureDetail: "mixed_meal_repository_append",
      stage: "FactCommit",
      errorCode: "FACT_COMMIT_FAILED",
      primaryError: "FACT_COMMIT_FAILED:mixed_meal_repository_append",
      durableEventTypes: ["inventory_stock"],
    },
    {
      id: "purchase-effect",
      fault: "after_inventory_business_writes",
      repositoryFailureSequence: undefined,
      repositoryFailureDetail: undefined,
      stage: "EffectBundle",
      errorCode: "INVENTORY_EFFECT_FAILED",
      primaryError: "INVENTORY_EFFECT_FAILED:after_business_writes",
      durableEventTypes: ["inventory_stock"],
    },
    {
      id: "meal-effect",
      fault: "after_meal_nutrition",
      repositoryFailureSequence: undefined,
      repositoryFailureDetail: undefined,
      stage: "EffectBundle",
      errorCode: "NUTRITION_EFFECT_WRITE_FAILED",
      primaryError: "NUTRITION_EFFECT_WRITE_FAILED:after_nutrition",
      durableEventTypes: ["inventory_stock", "diet_meal"],
    },
  ] as const)(
    "emits one mutation-sensitive safe diagnostic for the mixed $id failure and rolls back its whole transaction",
    (testCase) => {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      const leakFragments = [
        "private source payload",
        "SELECT * FROM secrets",
        "B-SLICE-001 purchase test secret 0001",
        "C:\\Users\\fault\\private.db",
      ] as const;
      const leak = leakFragments.join(" ");
      const originalEnvelope = mixedPurchaseAndDrinkEnvelope({ suffix: `safe-${testCase.id}` });
      const envelope: DomainEnvelopeInput = {
        ...originalEnvelope,
        source_message_id: `${originalEnvelope.source_message_id} ${leak}`,
      };
      const failures: DietDomainFailureEntry[] = [];
      try {
        const service = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T03:00:01.000Z",
          ...(testCase.fault === undefined ? {} : { fault: testCase.fault }),
          failureSink: (entry) => {
            failures.push(entry);
            throw new Error("diagnostic sink must not replace the primary failure");
          },
        });
        const preview = service.preview(envelope);
        const input = {
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        } as const;
        const beforeFirstAttempt = canonicalBusinessSnapshot(runtime.database);
        if (
          testCase.repositoryFailureSequence !== undefined &&
          testCase.repositoryFailureDetail !== undefined
        ) {
          installRepositoryAppendFailure(
            runtime.database,
            envelope.operations[testCase.repositoryFailureSequence]!.operation_id,
            testCase.repositoryFailureDetail,
          );
        }

        expect(captureThrown(() => service.execute(input))).toEqual(
          new Error(testCase.primaryError),
        );
        expect(failures).toHaveLength(1);
        expectSafeMixedFailure(failures[0]!, {
          stage: testCase.stage,
          errorCode: testCase.errorCode,
          traceId: deriveDomainId("trace", envelope.idempotency_key, 0),
          inputDigest: preview.input_digest,
        }, [...leakFragments, root]);

        const afterFirstAttempt = canonicalBusinessSnapshot(runtime.database);
        if (testCase.durableEventTypes.length === 0) {
          expect(afterFirstAttempt).toEqual(beforeFirstAttempt);
        }
        expect(runtime.database.prepare(
          "SELECT event_type FROM event_records WHERE envelope_id = ? ORDER BY committed_at",
        ).all(envelope.envelope_id)).toEqual(
          testCase.durableEventTypes.map((event_type) => ({ event_type })),
        );
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM envelope_finalizations WHERE envelope_id = ?",
        ).get(envelope.envelope_id)).toEqual({ count: 0 });

        failures.length = 0;
        const beforeRetry = canonicalBusinessSnapshot(runtime.database);
        expect(captureThrown(() => service.execute(input))).toEqual(
          new Error(testCase.primaryError),
        );
        expect(failures).toHaveLength(1);
        expectSafeMixedFailure(failures[0]!, {
          stage: testCase.stage,
          errorCode: testCase.errorCode,
          traceId: deriveDomainId("trace", envelope.idempotency_key, 0),
          inputDigest: preview.input_digest,
        }, [...leakFragments, root]);
        expect(canonicalBusinessSnapshot(runtime.database)).toEqual(beforeRetry);
      } finally {
        runtime.close();
        removeOwnedRoot(root);
      }
    },
  );

  it("CASE-MIXED-001 adds 24 cartons, drinks one, and finalizes once at 23", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
      });
      const result = previewAndExecute(service, mixedPurchaseAndDrinkEnvelope());

      expect(result.status).toBe("committed");
      expect(result.items.map((item) => [item.sequence, item.status])).toEqual([
        [0, "committed"],
        [1, "committed"],
      ]);
      expect(service.query(queryInventory())).toEqual({
        kind: "inventory",
        batches: [expect.objectContaining({
          batch_id: "batch-purchase-milk-mixed-001",
          product_id: "fixture-product-milk-whole-250",
          quantity_microunits: 23_000_000,
          unit: "carton",
        })],
      });
      expect(
        runtime.database.prepare(
          "SELECT direction, payload_json FROM inventory_transactions ORDER BY committed_at, transaction_id",
        ).all().map((row) => {
          const transaction = row as { direction: string; payload_json: string };
          return {
            direction: transaction.direction,
            quantity_delta_microunits: (JSON.parse(transaction.payload_json) as {
              quantity_delta_microunits: number;
            }).quantity_delta_microunits,
          };
        }),
      ).toEqual([
        { direction: "in", quantity_delta_microunits: 24_000_000 },
        { direction: "out", quantity_delta_microunits: -1_000_000 },
      ]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
      expect(runtime.database.prepare(
        "SELECT sequence, status FROM mixed_item_results ORDER BY sequence",
      ).all()).toEqual([
        { sequence: 0, status: "committed" },
        { sequence: 1, status: "committed" },
      ]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM daily_progress_snapshots",
      ).get()).toEqual({ count: 1 });
      const payload = result.payload as {
        daily_progress_by_date: readonly unknown[];
        receipt_data: { blocks: readonly { kind: string }[] };
      };
      expect(payload.daily_progress_by_date).toHaveLength(1);
      expect(payload.receipt_data.blocks.filter((block) => block.kind === "progress")).toHaveLength(1);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("replays the frozen mixed result without adding any row", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
      });
      const envelope = mixedPurchaseAndDrinkEnvelope();
      const preview = service.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;
      const first = service.execute(input);
      const beforeReplay = tableCounts(runtime.database);

      expect(service.execute(input)).toEqual(first);
      expect(tableCounts(runtime.database)).toEqual(beforeReplay);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("replays the byte-frozen mixed result without live nutrition preflight after the environment changes", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
      });
      const original = mixedPurchaseAndDrinkEnvelope({ suffix: "environment-frozen" });
      const meal = original.operations[1];
      if (meal?.kind !== "record_meal") throw new Error("mixed meal fixture");
      const envelope: DomainEnvelopeInput = {
        ...original,
        operations: [
          original.operations[0]!,
          {
            ...meal,
            items: [
              {
                ...meal.items[0]!,
                amount: {
                  ...meal.items[0]!.amount,
                  observed_microunits: 2_000_000,
                  nutrition_adoption_microunits: 2_000_000,
                },
                nutrition_sources: [
                  ...meal.items[0]!.nutrition_sources,
                  nutritionSource(
                    "product_label",
                    "label-fixture-product-milk-whole-250-duplicate-v1",
                    1,
                    "fixture-product-milk-whole-250-duplicate",
                    { kind: "per_item", microunits: 1_000_000, unit: "carton" },
                  ),
                  overflowingPublicNutritionSource("fixture-mixed-environment-overflow-v1"),
                ],
              },
            ],
          },
        ],
      };
      const preview = service.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;
      const first = service.execute(input);

      seedPurchase(service, purchaseStockEnvelope({
        suffix: "mixed-environment-duplicate",
        productId: "fixture-product-milk-whole-250-duplicate",
        normalizedName: "whole milk 250ml",
        batchId: "batch-mixed-environment-duplicate",
        quantityMicrounits: 4_000_000,
        unit: "carton",
      }));
      const beforeReplay = tableCounts(runtime.database);
      const replay = service.execute(input);

      expect(canonicalJson(replay)).toBe(canonicalJson(first));
      expect(replay).toEqual(first);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(Object.isFrozen(replay.items)).toBe(true);
      expect(Object.isFrozen(replay.payload)).toBe(true);
      expect(tableCounts(runtime.database)).toEqual(beforeReplay);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps the earlier purchase when the later child needs clarification", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
      });
      const result = previewAndExecute(
        service,
        mixedPurchaseAndDrinkEnvelope({ suffix: "issue", mealUnit: "g" }),
      );

      expect(result.status).toBe("committed_with_issues");
      expect(result.items.map((item) => [item.sequence, item.status])).toEqual([
        [0, "committed"],
        [1, "committed_with_issues"],
      ]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records",
      ).get()).toEqual({ count: 2 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
      expect(service.query(queryInventory())).toEqual({
        kind: "inventory",
        batches: [expect.objectContaining({ quantity_microunits: 24_000_000 })],
      });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("recovers the finalized mixed result after a crash before the reply", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = mixedPurchaseAndDrinkEnvelope({ suffix: "reply-crash" });
      const faultingService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
        fault: "after_mixed_finalize_commit",
      });
      const preview = faultingService.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;

      expect(() => faultingService.execute(input)).toThrow(
        "ENVELOPE_FINALIZE_RESPONSE_LOST:after_commit_before_reply",
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
      const beforeRetry = tableCounts(runtime.database);
      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:02.000Z",
      }).execute(input);

      expect(recovered.status).toBe("committed");
      expect(recovered.items.map((item) => item.sequence)).toEqual([0, 1]);
      expect(tableCounts(runtime.database)).toEqual(beforeRetry);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps a technical child pending without a success result and resumes by the same token", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = mixedPurchaseAndDrinkEnvelope({ suffix: "effect-retry" });
      const faultingService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
        fault: "after_meal_nutrition",
      });
      const preview = faultingService.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;

      expect(() => faultingService.execute(input)).toThrow(
        "NUTRITION_EFFECT_WRITE_FAILED:after_nutrition",
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 0 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM nutrition_snapshots",
      ).get()).toEqual({ count: 0 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records",
      ).get()).toEqual({ count: 2 });
      expect(faultingService.query(queryInventory())).toEqual({
        kind: "inventory",
        batches: [expect.objectContaining({ quantity_microunits: 24_000_000 })],
      });

      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:02.000Z",
      }).execute(input);
      expect(recovered.status).toBe("committed");
      expect(recovered.items.map((item) => item.sequence)).toEqual([0, 1]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions",
      ).get()).toEqual({ count: 2 });
      expect(runtime.database.prepare(
        "SELECT DISTINCT state, reason, attempt_count FROM effect_outbox WHERE envelope_id = ?",
      ).all(envelope.envelope_id)).toEqual([{
        state: "succeeded",
        reason: null,
        attempt_count: 1,
      }]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps a mixed first-child reservation active across failure, retry, and release", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = mixedPurchaseAndDrinkEnvelope({ suffix: "reservation-first-child" });
      const faultingService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
        fault: "after_inventory_business_writes",
      });
      const preview = faultingService.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;

      expect(() => faultingService.execute(input)).toThrow(
        "INVENTORY_EFFECT_FAILED:after_business_writes",
      );
      expect(runtime.database.prepare(
        "SELECT event_type FROM event_records WHERE envelope_id = ? ORDER BY event_id",
      ).all(envelope.envelope_id)).toEqual([{ event_type: "inventory_stock" }]);

      const competingEnvelope = mealEnvelope({
        suffix: "reservation-first-child-competitor",
        location: "outside",
        items: [mealItem({
          name: "reservation competitor pear",
          unit: "piece",
          observed: 1_000_000,
          adopted: 1_000_000,
          deducted: 1_000_000,
          sources: [nutritionSource(
            "public_fixture",
            "cn-reservation-competitor-pear-v1",
            1,
            null,
            { kind: "per_item", microunits: 1_000_000, unit: "piece" },
          )],
        })],
      });
      const competingPreview = faultingService.preview(competingEnvelope);
      const competingInput = {
        envelope: competingEnvelope,
        token: competingPreview.token,
        input_digest: competingPreview.input_digest,
        data_revision: competingPreview.data_revision,
      } as const;
      const beforeConflict = tableCounts(runtime.database);
      expect(() => faultingService.execute(competingInput)).toThrow(
        "PROGRESS_RESERVATION_CONFLICT:active",
      );
      expect(tableCounts(runtime.database)).toEqual(beforeConflict);

      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:02.000Z",
      }).execute(input);
      expect(recovered.status).toBe("committed");
      expect(JSON.stringify(recovered)).not.toContain("progress_reservation");

      const afterRelease = previewAndExecute(
        createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-12T03:00:03.000Z",
        }),
        mealEnvelope({
          suffix: "reservation-first-child-after-release",
          location: "outside",
          items: [mealItem({
            name: "reservation release pear",
            unit: "piece",
            observed: 1_000_000,
            adopted: 1_000_000,
            deducted: 1_000_000,
            sources: [nutritionSource(
              "public_fixture",
              "cn-reservation-release-pear-v1",
              1,
              null,
              { kind: "per_item", microunits: 1_000_000, unit: "piece" },
            )],
          })],
        }),
      );
      expect(afterRelease.status).toBe("committed");
      expect(JSON.stringify(afterRelease)).not.toContain("progress_reservation");
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("resumes after the mixed meal EffectBundle committed before sealing", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = mixedPurchaseAndDrinkEnvelope({ suffix: "effect-commit-crash" });
      const faultingService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
        fault: "after_mixed_meal_effect_commit",
      });
      const preview = faultingService.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;

      expect(() => faultingService.execute(input)).toThrow(
        "DIET_DOMAIN_EXECUTION_FAILED:after_mixed_meal_effect_commit",
      );
      expect(runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "received" });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 0 });

      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:02.000Z",
      }).execute(input);
      expect(recovered.status).toBe("committed");
      expect(recovered.items.map((item) => item.sequence)).toEqual([0, 1]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions",
      ).get()).toEqual({ count: 2 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("resumes an effects_stable mixed envelope directly into finalization", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = mixedPurchaseAndDrinkEnvelope({ suffix: "seal-crash" });
      const faultingService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:01.000Z",
        fault: "after_mixed_seal",
      });
      const preview = faultingService.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;

      expect(() => faultingService.execute(input)).toThrow(
        "DIET_DOMAIN_EXECUTION_FAILED:after_mixed_seal",
      );
      expect(runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "effects_stable" });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 0 });

      const beforeRetryTransactions = runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions",
      ).get();
      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T03:00:02.000Z",
      }).execute(input);
      expect(recovered.status).toBe("committed");
      expect(recovered.items.map((item) => item.sequence)).toEqual([0, 1]);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions",
      ).get()).toEqual(beforeRetryTransactions);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM envelope_finalizations",
      ).get()).toEqual({ count: 1 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("B-SLICE-001 meal, nutrition, inventory and progress matrix", () => {
  function createMealService() {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    return { root, runtime, service };
  }

  it("rejects an invalid meal amount before FactCommit and keeps it query-invisible", () => {
    const fixture = createMealService();
    try {
      const envelope = mealEnvelope({
        suffix: "invalid-negative-before-fact-commit",
        location: "outside",
        items: [mealItem({
          name: "invalid negative meal", unit: "piece", observed: -1,
          adopted: null, deducted: null, sources: [],
        })],
      });
      const before = businessCounts(fixture.runtime.database);

      expect(() => fixture.service.preview(envelope)).toThrowError(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.items.0.amount.observed_microunits",
      );
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-invalid-negative-before-fact-commit",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects nutrition scaling overflow before FactCommit and keeps it query-invisible", () => {
    const fixture = createMealService();
    try {
      const maximum = Number.MAX_SAFE_INTEGER;
      const envelope = mealEnvelope({
        suffix: "nutrition-overflow-before-fact-commit",
        location: "outside",
        items: [mealItem({
          name: "overflow meal", unit: "piece", observed: 1,
          adopted: maximum, deducted: null,
          sources: [{
            ...nutritionSource("public_fixture", "fixture-overflow-v1", 1, null, {
              kind: "per_item", microunits: 1, unit: "piece",
            }),
            nutrients: {
              energy_kcal_milli: maximum,
              protein_mg: maximum,
              fat_mg: maximum,
              carbohydrate_mg: maximum,
              fiber_mg: maximum,
              water_ml_milli: maximum,
            },
          }],
        })],
      });
      const before = businessCounts(fixture.runtime.database);

      expect(() => fixture.service.preview(envelope)).toThrowError("DOMAIN_RULE_INVALID:nutrition_scaled");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-nutrition-overflow-before-fact-commit",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects multi-item nutrition summation overflow before FactCommit and keeps it query-invisible", () => {
    const fixture = createMealService();
    try {
      const maximum = Number.MAX_SAFE_INTEGER;
      const item = (name: string) => mealItem({
        name, unit: "piece", observed: 1, adopted: 1, deducted: null,
        sources: [{
          ...nutritionSource("public_fixture", `fixture-${name}-v1`, 1, null, {
            kind: "per_item", microunits: 1, unit: "piece",
          }),
          nutrients: {
            energy_kcal_milli: maximum, protein_mg: null, fat_mg: null,
            carbohydrate_mg: null, fiber_mg: null, water_ml_milli: null,
          },
        }],
      });
      const envelope = mealEnvelope({
        suffix: "nutrition-sum-overflow-before-fact-commit",
        location: "outside",
        items: [item("overflow one"), item("overflow two")],
      });
      const before = businessCounts(fixture.runtime.database);

      expect(() => fixture.service.preview(envelope)).toThrowError("DOMAIN_RULE_INVALID:nutrition_sum");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-nutrition-sum-overflow",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects an accessor envelope without reading it or writing business rows", () => {
    const fixture = createMealService();
    try {
      const envelope = mealEnvelope({
        suffix: "accessor-envelope", location: "outside",
        items: [mealItem({ name: "accessor meal", unit: "piece", observed: 1, adopted: null, deducted: null, sources: [] })],
      });
      const expectedEnvelopeId = envelope.envelope_id;
      let getterHits = 0;
      Object.defineProperty(envelope, "envelope_id", {
        enumerable: true,
        get: () => {
          getterHits += 1;
          return expectedEnvelopeId;
        },
      });
      const before = businessCounts(fixture.runtime.database);
      let thrown: unknown;
      try { fixture.service.preview(envelope); } catch (error) { thrown = error; }

      expect(getterHits).toBe(0);
      expect((thrown as Error | undefined)?.message).toBe(
        "DIET_DOMAIN_REQUEST_INVALID:envelope_descriptor",
      );
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-accessor-envelope",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a custom operations array prototype without calling entries or writing rows", () => {
    const fixture = createMealService();
    try {
      const envelope = mealEnvelope({
        suffix: "custom-operations-array", location: "outside",
        items: [mealItem({ name: "custom array meal", unit: "piece", observed: 1, adopted: null, deducted: null, sources: [] })],
      });
      let entriesHits = 0;
      const customArrayPrototype = Object.create(Array.prototype) as object;
      Object.defineProperty(customArrayPrototype, "entries", {
        value(this: unknown[]) {
          entriesHits += 1;
          return Array.prototype.entries.call(this);
        },
      });
      Object.setPrototypeOf(envelope.operations, customArrayPrototype);
      const before = businessCounts(fixture.runtime.database);
      let thrown: unknown;
      try { fixture.service.preview(envelope); } catch (error) { thrown = error; }

      expect(entriesHits).toBe(0);
      expect((thrown as Error | undefined)?.message).toBe(
        "DIET_DOMAIN_REQUEST_INVALID:envelope_operations_prototype",
      );
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-custom-operations-array",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects envelope symbols and non-enumerable array indexes before reading or writing", () => {
    const fixture = createMealService();
    try {
      const symbolEnvelope = mealEnvelope({
        suffix: "symbol-envelope", location: "outside",
        items: [mealItem({ name: "symbol meal", unit: "piece", observed: 1, adopted: null, deducted: null, sources: [] })],
      });
      Object.defineProperty(symbolEnvelope, Symbol("untrusted"), { value: "x", enumerable: true });
      const before = businessCounts(fixture.runtime.database);
      expect(() => fixture.service.preview(symbolEnvelope)).toThrowError(
        "DIET_DOMAIN_REQUEST_INVALID:envelope_symbols",
      );

      const descriptorEnvelope = mealEnvelope({
        suffix: "non-enumerable-operation", location: "outside",
        items: [mealItem({ name: "descriptor meal", unit: "piece", observed: 1, adopted: null, deducted: null, sources: [] })],
      });
      const operation = descriptorEnvelope.operations[0]!;
      Object.defineProperty(descriptorEnvelope.operations, "0", {
        value: operation, enumerable: false, configurable: true, writable: true,
      });
      expect(() => fixture.service.preview(descriptorEnvelope)).toThrowError(
        "DIET_DOMAIN_REQUEST_INVALID:envelope_operations_0_descriptor",
      );
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-MEAL-006 records explicit rice and chicken without estimated flags", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "rice-grams",
        productId: "product-rice-grams",
        normalizedName: "rice",
        batchId: "batch-rice-grams",
        quantityMicrounits: 1_000_000_000,
        unit: "g",
      }));
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "chicken-grams",
        productId: "product-chicken-grams",
        normalizedName: "chicken",
        batchId: "batch-chicken-grams",
        quantityMicrounits: 1_000_000_000,
        unit: "g",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "explicit-rice-chicken",
        location: "home",
        items: [
          mealItem({
            name: "rice", unit: "g", observed: 200_000_000,
            adopted: 200_000_000, deducted: 200_000_000,
            sources: [nutritionSource("product_label", "label-product-rice-grams-v1", 1, "product-rice-grams", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
          mealItem({
            name: "chicken", unit: "g", observed: 150_000_000,
            adopted: 150_000_000, deducted: 150_000_000,
            sources: [nutritionSource("product_label", "label-product-chicken-grams-v1", 1, "product-chicken-grams", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
        ],
      }));
      expect(result.items[0]).toMatchObject({
        fact_status: "committed",
        issue_codes: [],
        meal_items: [
          { normalized_name: "rice", inventory_match: "matched", estimated_fields: [] },
          { normalized_name: "chicken", inventory_match: "matched", estimated_fields: [] },
        ],
      });
      const mealPayload = result.payload as {
        daily_progress: unknown;
        receipt_data: { blocks: Array<{ kind: string; daily_progress?: unknown }> };
      };
      expect(mealPayload.receipt_data.blocks.map((block) => block.kind)).toEqual([
        "title", "item", "item", "progress",
      ]);
      expect(mealPayload.receipt_data.blocks.at(-1)?.daily_progress).toEqual(
        mealPayload.daily_progress,
      );
      expect(JSON.stringify(mealPayload.receipt_data)).not.toMatch(
        /(?:event|item|transaction|batch|profile|snapshot)-[a-f0-9]{32}/,
      );
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-meals-explicit",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [{ items: [{ normalized_name: "rice" }, { normalized_name: "chicken" }] }] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-008 marks only the orange edible-weight adoption as estimated", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "orange", productId: "product-orange", normalizedName: "orange",
        batchId: "batch-orange", quantityMicrounits: 5_000_000, unit: "piece",
        nutritionBasis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "orange-estimate", location: "home",
        items: [mealItem({
          name: "orange", unit: "piece", observed: 1_000_000,
          adopted: 130_000_000, deducted: 1_000_000,
          evidence: "estimated_upper_bound",
          sources: [nutritionSource("product_label", "label-product-orange-v1", 1, "product-orange", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          inventory_match: "matched",
          estimated_fields: ["nutrition_adoption_microunits"],
          inventory_deduction_microunits: 1_000_000,
          nutrition_adoption_microunits: 130_000_000,
        }],
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-MEAL-003 uses 150g for nutrition but deducts only half a bowl", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "rice-bowls", productId: "product-rice-bowls", normalizedName: "rice bowl",
        batchId: "batch-rice-bowls", quantityMicrounits: 2_000_000, unit: "bowl",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "half-rice-bowl", location: "home",
        items: [mealItem({
          name: "rice bowl", unit: "bowl", observed: 500_000,
          adopted: 150_000_000, deducted: 500_000,
          evidence: "estimated_upper_bound",
          sources: [nutritionSource("public_fixture", "cn-rice-bowl-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          nutrition_adoption_microunits: 150_000_000,
          inventory_deduction_microunits: 500_000,
          nutrients: {
            energy_kcal_milli: 150_000,
            protein_mg: 7_500,
            fat_mg: 3_000,
            carbohydrate_mg: 18_000,
          },
        }],
      });
      const nutritionSnapshot = fixture.runtime.database.prepare(
        "SELECT payload_json FROM nutrition_snapshots",
      ).get() as { payload_json: string };
      expect(JSON.parse(nutritionSnapshot.payload_json)).toMatchObject({
        basis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
        conversion: {
          adopted_microunits: 150_000_000,
          formula: "round_half_up(nutrient*adopted_microunits/basis_microunits)",
        },
        nutrients: { energy_kcal_milli: 150_000 },
        source_nutrients: { energy_kcal_milli: 100_000 },
      });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(1_500_000);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("uses a legacy product profile for a new meal while freezing the current basis in its snapshot", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "legacy-profile", productId: "product-legacy-profile", normalizedName: "legacy rice",
        batchId: "batch-legacy-profile", quantityMicrounits: 500_000_000, unit: "g",
      }));
      const row = fixture.runtime.database.prepare(
        "SELECT nutrition_profile_id, payload_json FROM nutrition_profiles WHERE subject_id = ?",
      ).get("product-legacy-profile") as { nutrition_profile_id: string; payload_json: string };
      const legacy = JSON.parse(row.payload_json) as Record<string, unknown>;
      delete legacy.basis;
      fixture.runtime.database.prepare(
        "UPDATE nutrition_profiles SET payload_json = ? WHERE nutrition_profile_id = ?",
      ).run(JSON.stringify(legacy), row.nutrition_profile_id);

      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "legacy-profile-meal", location: "home",
        items: [mealItem({
          name: "legacy rice", unit: "g", observed: 150_000_000,
          adopted: 150_000_000, deducted: 150_000_000,
          sources: [nutritionSource("product_label", "label-product-legacy-profile-v1", 1, "product-legacy-profile", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.status).toBe("committed");
      const snapshot = fixture.runtime.database.prepare(
        "SELECT payload_json FROM nutrition_snapshots",
      ).get() as { payload_json: string };
      expect(JSON.parse(snapshot.payload_json)).toMatchObject({
        basis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-MEAL-004 records a company apple without reading or deducting home inventory", () => {
    const fixture = createMealService();
    try {
      const before = tableCounts(fixture.runtime.database);
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "company-apple", location: "outside",
        items: [mealItem({
          name: "apple", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-apple-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        inventory_match: "skipped_outside",
        inventory_transaction_id: null,
        issue_codes: [],
      });
      expect(fixture.service.query(queryInventory()).batches).toEqual([]);
      expect(tableCounts(fixture.runtime.database).inventory_transactions).toBe(before.inventory_transactions);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("preserves unknown nutrition and deduction amounts without inventing zero effects", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "unknown-pear", productId: "product-unknown-pear", normalizedName: "unknown pear",
        batchId: "batch-unknown-pear", quantityMicrounits: 2_000_000, unit: "piece",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "unknown-amounts", location: "home",
        items: [mealItem({
          name: "unknown pear", unit: "piece", observed: 1_000_000,
          adopted: null, deducted: null,
          sources: [{
            ...nutritionSource("product_label", "label-product-unknown-pear-v2", 2, "product-unknown-pear", { kind: "per_item", microunits: 1_000_000, unit: "piece" }),
            nutrients: {
              energy_kcal_milli: 100_000,
              protein_mg: 5_000,
              fat_mg: 2_000,
              carbohydrate_mg: 12_000,
              fiber_mg: 3_000,
              water_ml_milli: 80_000,
            },
          }],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          inventory_match: "skipped_amount_unknown",
          inventory_transaction_id: null,
          issue_codes: ["inventory_amount_unknown"],
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          nutrients: {
            energy_kcal_milli: null,
            protein_mg: null,
            fat_mg: null,
            carbohydrate_mg: null,
            fiber_mg: null,
            water_ml_milli: null,
          },
        }],
      });
      expect((result.payload as { daily_progress: { nutrients: Record<string, unknown> } })
        .daily_progress.nutrients).toEqual({
        energy_kcal_milli: null,
        protein_mg: null,
        fat_mg: null,
        carbohydrate_mg: null,
        fiber_mg: null,
        water_ml_milli: null,
      });
      expect(fixture.runtime.database.prepare(
        "SELECT coverage_status FROM nutrition_snapshots",
      ).get()).toEqual({ coverage_status: "partial" });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(2_000_000);
      expect(fixture.runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 1 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-INVENTORY-003 commits the meal but opens an issue for two candidates", () => {
    const fixture = createMealService();
    try {
      for (const suffix of ["milk-a", "milk-b"]) {
        seedPurchase(fixture.service, purchaseStockEnvelope({
          suffix, productId: `product-${suffix}`, normalizedName: "milk",
          batchId: `batch-${suffix}`, quantityMicrounits: 6_000_000, unit: "carton",
        }));
      }
      const before = fixture.service.query(queryInventory()).batches.map((batch) => batch.quantity_microunits);
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "ambiguous-milk", location: "home",
        items: [mealItem({
          name: "milk", unit: "carton", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-milk-v1", 1, null, { kind: "per_package", microunits: 1_000_000, unit: "carton" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        fact_status: "committed",
        inventory_match: "skipped_ambiguous",
        inventory_transaction_id: null,
        issue_codes: ["inventory_multiple_candidates"],
      });
      expect(fixture.service.query(queryInventory()).batches.map((batch) => batch.quantity_microunits)).toEqual(before);
      expect(fixture.runtime.database.prepare("SELECT issue_code, status FROM issues").all()).toEqual([
        { issue_code: "inventory_multiple_candidates", status: "open" },
      ]);
      const issuePayload = result.payload as {
        quick_prompts: Array<{
          option_ids: string[];
          options: Array<{ kind: string }>;
          free_text_line: string;
        }>;
        receipt_data: { blocks: Array<{ kind: string }> };
      };
      expect(issuePayload.quick_prompts).toHaveLength(1);
      expect(issuePayload.quick_prompts[0]).toMatchObject({
        option_ids: ["keep_original", "defer", "free_text"],
        free_text_line: "也可以直接说明实际情况，不必选择以上选项。",
      });
      expect(issuePayload.quick_prompts[0].options.at(-1)?.kind).toBe("free_text");
      expect(issuePayload.receipt_data.blocks.map((block) => block.kind)).toEqual([
        "title", "item", "issues", "progress",
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-INVENTORY-004 commits insufficient eggs without a negative inventory row", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "eggs", productId: "product-eggs", normalizedName: "eggs",
        batchId: "batch-eggs", quantityMicrounits: 2_000_000, unit: "piece",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "insufficient-eggs", location: "home",
        items: [mealItem({
          name: "eggs", unit: "piece", observed: 3_000_000,
          adopted: 3_000_000, deducted: 3_000_000,
          sources: [nutritionSource("product_label", "label-product-eggs-v1", 1, "product-eggs", { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        inventory_match: "skipped_insufficient",
        inventory_transaction_id: null,
        issue_codes: ["inventory_insufficient"],
      });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(2_000_000);
      expect(fixture.runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 1 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-002 saves the frozen public nutrition source when no label exists", () => {
    const fixture = createMealService();
    try {
      previewAndExecute(fixture.service, mealEnvelope({
        suffix: "public-banana", location: "outside",
        items: [mealItem({
          name: "banana", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-banana-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(fixture.runtime.database.prepare("SELECT source_type, source_ref FROM nutrition_snapshots").all()).toEqual([
        { source_type: "public_fixture", source_ref: "cn-banana-v1" },
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("records a Unicode food name with a frozen public nutrition source", () => {
    const fixture = createMealService();
    try {
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "unicode-rice", location: "outside",
        items: [mealItem({
          name: "米饭", unit: "gram", observed: 150_000_000,
          adopted: 150_000_000, deducted: 0,
          sources: [nutritionSource("public_fixture", "cn-rice-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "gram" })],
        })],
      }));

      expect(result.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT subject_type, subject_id, profile_version FROM nutrition_profiles",
      ).get()).toEqual({ subject_type: "food", subject_id: "米饭", profile_version: "1" });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-005 keeps the old snapshot on v1 while a new meal selects v2", () => {
    const fixture = createMealService();
    try {
      for (const version of [1, 2]) {
        previewAndExecute(fixture.service, mealEnvelope({
          suffix: `yogurt-v${version}`, location: "outside",
          items: [mealItem({
            name: "yogurt", unit: "cup", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", `cn-yogurt-v${version}`, version, null, { kind: "per_serving", microunits: 1_000_000, unit: "cup" })],
          })],
        }));
      }
      expect(fixture.runtime.database.prepare("SELECT profile_version, source_ref FROM nutrition_snapshots ORDER BY CAST(profile_version AS INTEGER)").all()).toEqual([
        { profile_version: "1", source_ref: "cn-yogurt-v1" },
        { profile_version: "2", source_ref: "cn-yogurt-v2" },
      ]);
      const profiles = fixture.runtime.database.prepare(
        `SELECT profile_version, nutrition_profile_id, supersedes_profile_id
         FROM nutrition_profiles ORDER BY CAST(profile_version AS INTEGER)`,
      ).all() as Array<{
        profile_version: string;
        nutrition_profile_id: string;
        supersedes_profile_id: string | null;
      }>;
      expect(profiles[0].supersedes_profile_id).toBeNull();
      expect(profiles[1].supersedes_profile_id).toBe(profiles[0].nutrition_profile_id);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-PROGRESS-010 freezes one same-day progress block for a multi-item meal", () => {
    const fixture = createMealService();
    try {
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "multi-progress", location: "outside",
        items: [
          mealItem({
            name: "pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          }),
          mealItem({
            name: "tea", unit: "cup", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-tea-v1", 1, null, { kind: "per_serving", microunits: 1_000_000, unit: "cup" })],
          }),
        ],
      }));
      expect(result.payload).toMatchObject({
        daily_progress_by_date: [expect.objectContaining({ date: "2026-08-12" })],
      });
      expect((result.payload as { daily_progress: unknown; daily_progress_by_date: unknown[] }).daily_progress).toEqual(
        (result.payload as { daily_progress: unknown; daily_progress_by_date: unknown[] }).daily_progress_by_date[0],
      );
      const bundleRow = fixture.runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-multi-progress") as { payload_json: string };
      const bundle = JSON.parse(bundleRow.payload_json) as {
        effects: Array<{ contribution?: unknown; effect_id: string; state: string }>;
      };
      expect(bundle.effects.filter((effect) => effect.contribution !== undefined)).toEqual([
        {
          contribution: (result.payload as { daily_progress: unknown }).daily_progress,
          effect_id: expect.stringMatching(/^effect-[a-f0-9]{32}$/),
          state: "succeeded",
        },
      ]);
      const beforeQueries = tableCounts(fixture.runtime.database);
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-progress-001",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ date: "2026-08-12" });
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-meals-progress-001",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [{ items: [{ normalized_name: "pear" }, { normalized_name: "tea" }] }] });
      expect(() => fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-progress-invalid-date",
        date: "2026-02-31", timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:date");
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeQueries);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("replays a finalized meal as the same deeply frozen result without writing rows", () => {
    const fixture = createMealService();
    try {
      const envelope = mealEnvelope({
        suffix: "frozen-replay", location: "outside",
        items: [mealItem({
          name: "replay pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-replay-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      });
      const preview = fixture.service.preview(envelope);
      const first = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      const before = tableCounts(fixture.runtime.database);
      const replay = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(replay).toEqual(first);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(Object.isFrozen(replay.items)).toBe(true);
      expect(Object.isFrozen(replay.items[0])).toBe(true);
      expect(Object.isFrozen(replay.payload)).toBe(true);
      expect(Object.isFrozen((replay.payload as { daily_progress: unknown }).daily_progress)).toBe(true);
      expect(Object.isFrozen((replay.payload as { receipt_data: unknown }).receipt_data)).toBe(true);
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("replays the byte-frozen finalized meal without live inventory or nutrition preflight", () => {
    const fixture = createMealService();
    try {
      const normalizedName = "frozen environment shake";
      const productId = "fixture-product-frozen-environment-shake";
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "frozen-environment-primary",
        productId,
        normalizedName,
        batchId: "batch-frozen-environment-primary",
        quantityMicrounits: 10_000_000,
        unit: "piece",
      }));
      const envelope = mealEnvelope({
        suffix: "frozen-environment-replay",
        location: "home",
        items: [mealItem({
          name: normalizedName,
          unit: "piece",
          observed: 2_000_000,
          adopted: 2_000_000,
          deducted: 2_000_000,
          sources: [
            nutritionSource(
              "product_label",
              `label-${productId}-v1`,
              1,
              productId,
              { kind: "per_item", microunits: 1_000_000, unit: "piece" },
            ),
            nutritionSource(
              "product_label",
              "label-fixture-product-frozen-environment-shake-duplicate-v1",
              1,
              "fixture-product-frozen-environment-shake-duplicate",
              { kind: "per_item", microunits: 1_000_000, unit: "piece" },
            ),
            overflowingPublicNutritionSource("fixture-frozen-environment-overflow-v1"),
          ],
        })],
      });
      const preview = fixture.service.preview(envelope);
      const input = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;
      const first = fixture.service.execute(input);

      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "frozen-environment-duplicate",
        productId: "fixture-product-frozen-environment-shake-duplicate",
        normalizedName,
        batchId: "batch-frozen-environment-duplicate",
        quantityMicrounits: 3_000_000,
        unit: "piece",
      }));
      const beforeReplay = tableCounts(fixture.runtime.database);
      const replay = fixture.service.execute(input);

      expect(canonicalJson(replay)).toBe(canonicalJson(first));
      expect(replay).toEqual(first);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(Object.isFrozen(replay.items)).toBe(true);
      expect(Object.isFrozen(replay.payload)).toBe(true);
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeReplay);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("reuses a stored preview without live inventory or nutrition preflight", () => {
    const fixture = createMealService();
    try {
      const normalizedName = "frozen preview shake";
      const productId = "fixture-product-frozen-preview-shake";
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "frozen-preview-primary",
        productId,
        normalizedName,
        batchId: "batch-frozen-preview-primary",
        quantityMicrounits: 10_000_000,
        unit: "piece",
      }));
      const envelope = mealEnvelope({
        suffix: "frozen-preview-reuse",
        location: "home",
        items: [mealItem({
          name: normalizedName,
          unit: "piece",
          observed: 2_000_000,
          adopted: 2_000_000,
          deducted: 2_000_000,
          sources: [
            nutritionSource(
              "product_label",
              `label-${productId}-v1`,
              1,
              productId,
              { kind: "per_item", microunits: 1_000_000, unit: "piece" },
            ),
            nutritionSource(
              "product_label",
              "label-fixture-product-frozen-preview-shake-duplicate-v1",
              1,
              "fixture-product-frozen-preview-shake-duplicate",
              { kind: "per_item", microunits: 1_000_000, unit: "piece" },
            ),
            overflowingPublicNutritionSource("fixture-frozen-preview-overflow-v1"),
          ],
        })],
      });
      const first = fixture.service.preview(envelope);

      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "frozen-preview-duplicate",
        productId: "fixture-product-frozen-preview-shake-duplicate",
        normalizedName,
        batchId: "batch-frozen-preview-duplicate",
        quantityMicrounits: 3_000_000,
        unit: "piece",
      }));
      const beforeReplay = tableCounts(fixture.runtime.database);
      const replay = fixture.service.preview(envelope);

      expect(replay).toEqual({ ...first, reused: true });
      expect(Object.isFrozen(replay)).toBe(true);
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeReplay);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("returns the cumulative same-day progress after a second meal", () => {
    const fixture = createMealService();
    try {
      const first = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-first", location: "outside",
        items: [mealItem({
          name: "first pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-first-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      const second = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-second", location: "outside",
        items: [mealItem({
          name: "second pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-second-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect((first.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(100_000);
      expect((second.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(200_000);
      const secondPayload = second.payload as {
        daily_progress: unknown;
        receipt_data: { blocks: Array<{ kind: string; daily_progress?: unknown }> };
      };
      expect(secondPayload.receipt_data.blocks.at(-1)).toEqual({
        kind: "progress",
        daily_progress: secondPayload.daily_progress,
      });
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-daily-cumulative",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 200_000 } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects cross-envelope daily progress overflow before meal FactCommit and keeps prior meals visible", () => {
    const fixture = createMealService();
    try {
      const energyOnlySource = (sourceRef: string, energy: number): NutritionSourceCandidate => ({
        ...nutritionSource("public_fixture", sourceRef, 1, null, {
          kind: "per_item", microunits: 1, unit: "piece",
        }),
        nutrients: {
          energy_kcal_milli: energy,
          protein_mg: 0,
          fat_mg: 0,
          carbohydrate_mg: 0,
          fiber_mg: 0,
          water_ml_milli: 0,
        },
      });
      previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-progress-maximum-first",
        location: "outside",
        items: [mealItem({
          name: "maximum energy meal", unit: "piece", observed: 1,
          adopted: 1, deducted: null,
          sources: [energyOnlySource("fixture-daily-progress-maximum-v1", Number.MAX_SAFE_INTEGER)],
        })],
      }));
      const overflowing = mealEnvelope({
        suffix: "daily-progress-overflow-second",
        location: "outside",
        items: [mealItem({
          name: "overflowing energy meal", unit: "piece", observed: 1,
          adopted: 1, deducted: null,
          sources: [energyOnlySource("fixture-daily-progress-one-v1", 1)],
        })],
      });
      const preview = fixture.service.preview(overflowing);
      const before = businessCounts(fixture.runtime.database);

      expect(() => fixture.service.execute({
        envelope: overflowing,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError("ENVELOPE_FINALIZE_AUTHORITY_INVALID:daily_progress_sum");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-after-cross-envelope-progress-overflow",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ normalized_name: "maximum energy meal" }] }],
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("keeps the latest cumulative progress when a later finalization has an earlier received time", () => {
    const fixture = createMealService();
    try {
      const firstService = createDietDomainService({
        database: fixture.runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
      });
      const secondService = createDietDomainService({
        database: fixture.runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      const firstEnvelope: DomainEnvelopeInput = {
        ...mealEnvelope({
          suffix: "daily-later-time-first", location: "outside",
          items: [mealItem({
            name: "later time pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-later-time-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          })],
        }),
        received_at: "2026-08-12T04:00:02.000Z",
      };
      const secondEnvelope: DomainEnvelopeInput = {
        ...mealEnvelope({
          suffix: "daily-earlier-time-second", location: "outside",
          items: [mealItem({
            name: "earlier time pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-earlier-time-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          })],
        }),
        received_at: "2026-08-12T04:00:01.000Z",
      };
      previewAndExecute(firstService, firstEnvelope);
      const second = previewAndExecute(secondService, secondEnvelope);
      expect((second.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(200_000);
      expect(secondService.query({
        kind: "query_daily_summary", operation_id: "query-daily-out-of-order-finalize",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 200_000 } });
      const generated = fixture.runtime.database.prepare(
        "SELECT generated_at FROM daily_progress_snapshots ORDER BY generated_at",
      ).all() as Array<{ generated_at: string }>;
      expect(generated).toEqual([
        { generated_at: "2026-08-12T04:00:02.000Z" },
        { generated_at: "2026-08-12T04:00:02.001Z" },
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("keeps a same-day nutrient unknown when an earlier meal contribution was unknown", () => {
    const fixture = createMealService();
    try {
      previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-unknown-first", location: "outside",
        items: [mealItem({
          name: "unknown fiber pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-unknown-fiber-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      const second = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-known-second", location: "outside",
        items: [mealItem({
          name: "known fiber pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [{
            ...nutritionSource("public_fixture", "cn-known-fiber-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" }),
            nutrients: {
              energy_kcal_milli: 100_000,
              protein_mg: 5_000,
              fat_mg: 2_000,
              carbohydrate_mg: 12_000,
              fiber_mg: 2_000,
              water_ml_milli: 80_000,
            },
          }],
        })],
      }));
      expect((second.payload as { daily_progress: { nutrients: { fiber_mg: number | null } } })
        .daily_progress.nutrients.fiber_mg).toBeNull();
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-daily-unknown",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { fiber_mg: null } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a progress contribution moved onto the wrong EffectBundle effect", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const envelope = mealEnvelope({
      suffix: "tampered-progress-effect", location: "outside",
      items: [mealItem({
        name: "tampered progress pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-tampered-progress-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const preview = service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "record_meal") throw new Error("test operation mismatch");
      const prepared = prepareMealOperation({
        database: runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      const mealResult = applyMealEffects({
        database: runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
        location: operation.location,
      });
      const bundleRow = runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?",
      ).get(envelope.envelope_id, operation.operation_id) as { payload_json: string };
      const bundle = JSON.parse(bundleRow.payload_json) as {
        effects: Array<{ contribution?: unknown; effect_id: string; state: string }>;
      };
      const progressEffect = bundle.effects.find((effect) => effect.contribution !== undefined);
      const otherEffect = bundle.effects.find((effect) => effect.contribution === undefined);
      if (!progressEffect || !otherEffect) throw new Error("test bundle shape mismatch");
      otherEffect.contribution = progressEffect.contribution;
      delete progressEffect.contribution;
      runtime.database.prepare(
        "UPDATE effect_bundle_commits SET payload_json = ? WHERE envelope_id = ? AND operation_id = ?",
      ).run(canonicalJson(bundle), envelope.envelope_id, operation.operation_id);
      sealPreparedEnvelopeFacts({
        database: runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]),
        sealedAt: envelope.received_at,
      });
      const execution = Object.freeze({
        envelope_id: envelope.envelope_id,
        input_digest: preview.input_digest,
        status: mealResult.status,
        items: Object.freeze([mealResult]),
        payload: Object.freeze({
          authority_kind: "diet-manager/domain-execution/v1",
          daily_progress: mealResult.daily_progress,
          daily_progress_by_date: mealResult.daily_progress_by_date,
          quick_prompts: Object.freeze([]),
          receipt_data: buildReceiptData({
            status: mealResult.status,
            date: mealResult.daily_progress.date,
            meal_slot: operation.meal_slot,
            items: mealResult.meal_items,
            quick_prompts: Object.freeze([]),
            daily_progress: mealResult.daily_progress,
          }),
        }),
      });
      expect(() => finalizeEnvelope({
        database: runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        resultStatus: mealResult.status,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: envelope.received_at,
        frozenAt: envelope.received_at,
        payload: execution,
        mixedItems: Object.freeze([]),
      })).toThrow("ENVELOPE_FINALIZE_AUTHORITY_INVALID:daily_progress_bundle");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back a failed meal EffectBundle while retaining only the committed fact and redacted log", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: DietDomainFailureEntry[] = [];
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
      fault: "after_meal_nutrition",
      failureSink: (entry) => failures.push(entry),
    });
    const envelope = mealEnvelope({
      suffix: "nutrition-failure",
      location: "outside",
      items: [mealItem({
        name: "failed pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-failed-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const preview = service.preview(envelope);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("NUTRITION_EFFECT_WRITE_FAILED:after_nutrition");
      expect(failures).toEqual([{
        stage: "EffectBundle",
        error_code: "NUTRITION_EFFECT_WRITE_FAILED",
        trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
        input_digest: preview.input_digest,
      }]);
      expect(runtime.database.prepare(
        "SELECT event_type, lifecycle_status FROM event_records",
      ).all()).toEqual([{ event_type: "diet_meal", lifecycle_status: "active" }]);
      expect(runtime.database.prepare(
        "SELECT state, reason FROM effect_outbox ORDER BY effect_id",
      ).all()).toEqual([
        { state: "retryable_failed", reason: "NUTRITION_EFFECT_WRITE_FAILED" },
        { state: "retryable_failed", reason: "NUTRITION_EFFECT_WRITE_FAILED" },
      ]);
      const eventPayload = JSON.parse((runtime.database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string }).payload_json) as {
        progress_reservation?: { authority_kind?: string; mode?: string };
      };
      expect(eventPayload.progress_reservation).toMatchObject({
        authority_kind: "diet-manager/progress-reservation/v1",
        mode: "contribution",
      });
      expect(JSON.stringify(service.query({
        kind: "query_meals",
        operation_id: "query-pending-reservation-not-public",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      }))).not.toContain("progress_reservation");
      expect(runtime.database.prepare(
        "SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({
        state: "effects_pending",
        result_status: "facts_committed_effects_pending",
      });
      expect(runtime.database.prepare(
        "SELECT state, terminal_result_json FROM idempotency_records WHERE idempotency_key = ?",
      ).get(envelope.idempotency_key)).toEqual({
        state: "effects_pending",
        terminal_result_json: null,
      });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_profiles").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM issues").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations").get()).toEqual({ count: 0 });
      const recovered = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
      }).execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(recovered.status).toBe("committed");
      expect(JSON.stringify(recovered)).not.toContain("progress_reservation");
      expect(runtime.database.prepare(
        "SELECT DISTINCT state, reason, attempt_count FROM effect_outbox WHERE envelope_id = ?",
      ).all(envelope.envelope_id)).toEqual([{
        state: "succeeded",
        reason: null,
        attempt_count: 2,
      }]);
      expect(runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "finalized" });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back first-item nutrition and inventory writes when a later meal step fails", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const seedService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:03.000Z",
      });
      seedPurchase(seedService, purchaseStockEnvelope({
        suffix: "rollback-rice", productId: "product-rollback-rice", normalizedName: "rollback rice",
        batchId: "batch-rollback-rice", quantityMicrounits: 500_000_000, unit: "g",
      }));
      seedPurchase(seedService, purchaseStockEnvelope({
        suffix: "rollback-chicken", productId: "product-rollback-chicken", normalizedName: "rollback chicken",
        batchId: "batch-rollback-chicken", quantityMicrounits: 500_000_000, unit: "g",
      }));
      const before = tableCounts(runtime.database);
      const quantities = seedService.query(queryInventory()).batches.map((batch) => batch.quantity_microunits);
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:03.000Z",
        fault: "after_meal_first_item",
      });
      const envelope = mealEnvelope({
        suffix: "rollback-two-items", location: "home",
        items: [
          mealItem({
            name: "rollback rice", unit: "g", observed: 100_000_000,
            adopted: 100_000_000, deducted: 100_000_000,
            sources: [nutritionSource("product_label", "label-product-rollback-rice-v1", 1, "product-rollback-rice", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
          mealItem({
            name: "rollback chicken", unit: "g", observed: 100_000_000,
            adopted: 100_000_000, deducted: 100_000_000,
            sources: [nutritionSource("product_label", "label-product-rollback-chicken-v1", 1, "product-rollback-chicken", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
        ],
      });
      const preview = failing.preview(envelope);
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_FAILED:after_first_item");
      const after = tableCounts(runtime.database);
      expect(after.inventory_transactions).toBe(before.inventory_transactions);
      expect(after.nutrition_profiles).toBe(before.nutrition_profiles);
      expect(after.nutrition_snapshots).toBe(0);
      expect(after.issues).toBe(0);
      expect(after.daily_progress_snapshots).toBe(0);
      expect(seedService.query(queryInventory()).batches.map((batch) => batch.quantity_microunits)).toEqual(quantities);
      expect(runtime.database.prepare(
        "SELECT effect_state, result_status FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-rollback-two-items")).toEqual({
        effect_state: "pending",
        result_status: "facts_committed_effects_pending",
      });
      expect(runtime.database.prepare(
        "SELECT DISTINCT state FROM effect_outbox WHERE operation_id = ?",
      ).all("operation-meal-rollback-two-items")).toEqual([{ state: "retryable_failed" }]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rejects a tampered pending meal EffectBundle checkpoint before any effect write", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const envelope = mealEnvelope({
      suffix: "tampered-checkpoint", location: "outside",
      items: [mealItem({
        name: "tampered pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-tampered-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
        fault: "after_meal_nutrition",
      });
      const preview = failing.preview(envelope);
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("NUTRITION_EFFECT_WRITE_FAILED:after_nutrition");
      const checkpoint = runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-tampered-checkpoint") as { payload_json: string };
      const payload = JSON.parse(checkpoint.payload_json) as Record<string, unknown>;
      payload.authority_kind = "tampered/checkpoint";
      runtime.database.prepare(
        "UPDATE effect_bundle_commits SET payload_json = ? WHERE operation_id = ?",
      ).run(JSON.stringify(payload), "operation-meal-tampered-checkpoint");

      const retry = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
      });
      expect(() => retry.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_payload");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("B-SLICE-001 append-only corrections and effective views", () => {
  function createCorrectionFixture(options: { readonly sourceEnergy?: number } = {}) {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T05:00:00.000Z",
    });
    const purchase = purchaseStockEnvelope({
      suffix: "correction-eggs",
      productId: "product-correction-eggs",
      normalizedName: "eggs",
      batchId: "batch-correction-eggs",
      quantityMicrounits: 10_000_000,
      unit: "piece",
    });
    seedPurchase(service, purchase);
    const meal = mealEnvelope({
      suffix: "correction-two-eggs",
      location: "home",
      items: [mealItem({
        name: "eggs",
        unit: "piece",
        observed: 2_000_000,
        adopted: 2_000_000,
        deducted: 2_000_000,
        sources: [{
          ...nutritionSource(
            "product_label",
            options.sourceEnergy === undefined
              ? "label-product-correction-eggs-v1"
              : "label-product-correction-eggs-overflow-v2",
            options.sourceEnergy === undefined ? 1 : 2,
            "product-correction-eggs",
            { kind: "per_item", microunits: options.sourceEnergy === undefined ? 1_000_000 : 1, unit: "piece" },
          ),
          ...(options.sourceEnergy === undefined ? {} : {
            nutrients: {
              energy_kcal_milli: options.sourceEnergy,
              protein_mg: null, fat_mg: null, carbohydrate_mg: null,
              fiber_mg: null, water_ml_milli: null,
            },
          }),
        }],
      })],
    });
    previewAndExecute(service, meal);
    return {
      root,
      runtime,
      service,
      meal,
      targetEventId: deriveDomainId("event", meal.idempotency_key, 0),
    };
  }

  function preparePendingCorrection(
    fixture: ReturnType<typeof createCorrectionFixture>,
    suffix: string,
  ) {
    const envelope = correctionEnvelope({
      suffix,
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    const preview = fixture.service.preview(envelope);
    const operation = envelope.operations[0];
    if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
    const prepared = prepareCorrectionOperation({
      database: fixture.runtime.database,
      secret,
      token: preview.token,
      inputDigest: preview.input_digest,
      dataRevision: preview.data_revision,
      subjectScope: envelope.subject_scope,
      commandType: envelope.command_type,
      idempotencyKey: envelope.idempotency_key,
      sourceMessageId: envelope.source_message_id,
      conversationId: envelope.conversation_id,
      receivedAt: envelope.received_at,
      committedAt: envelope.received_at,
      sequence: 0,
      operation,
    });
    appendPreparedOperationFact(prepared.fact);
    return { envelope, operation, preview };
  }

  it("claims retryable correction outboxes once, clears the old reason, and finishes attempt two", () => {
    const fixture = createCorrectionFixture();
    try {
      const { envelope, operation, preview } = preparePendingCorrection(
        fixture,
        "retryable-effect-claim",
      );
      fixture.runtime.database.prepare(
        `UPDATE effect_outbox
         SET state = 'retryable_failed', attempt_count = 1, reason = 'old_retryable_reason'
         WHERE envelope_id = ?`,
      ).run(envelope.envelope_id);

      const result = applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      });

      expect(result.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        `SELECT state, attempt_count, reason FROM effect_outbox
         WHERE envelope_id = ? ORDER BY effect_id`,
      ).all(envelope.envelope_id)).toEqual([
        { state: "succeeded", attempt_count: 2, reason: null },
        { state: "succeeded", attempt_count: 2, reason: null },
      ]);
      expect(preview.token).toEqual(expect.any(String));
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rolls back every correction claim and business write when claim injection fails", () => {
    const fixture = createCorrectionFixture();
    try {
      const { envelope, operation } = preparePendingCorrection(fixture, "claim-rollback");
      const before = canonicalJson(canonicalBusinessSnapshot(fixture.runtime.database));

      expect(() => applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
        fault: "after_claim",
      } as unknown as Parameters<typeof applyCorrectionEffects>[0])).toThrow(
        "CORRECTION_EFFECT_FAILED:after_claim",
      );
      expect(canonicalJson(canonicalBusinessSnapshot(fixture.runtime.database))).toBe(before);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-CORR-001 changes two eggs to three with one append-only correction and one-unit compensation", () => {
    const fixture = createCorrectionFixture();
    try {
      const beforeEvent = canonicalJson(fixture.runtime.database.prepare(
        "SELECT * FROM event_records WHERE event_id = ?",
      ).get(fixture.targetEventId));
      const envelope = correctionEnvelope({
        suffix: "eggs-two-to-three",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 3_000_000,
        adopted: 3_000_000,
        deducted: 3_000_000,
      });
      const preview = fixture.service.preview(envelope);
      const result = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(result.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        `SELECT effect_kind, state, attempt_count, reason FROM effect_outbox
         WHERE envelope_id = ? ORDER BY effect_kind`,
      ).all(envelope.envelope_id)).toEqual([
        {
          effect_kind: "correction_inventory_compensation",
          state: "succeeded",
          attempt_count: 1,
          reason: null,
        },
        {
          effect_kind: "daily_progress_replacement",
          state: "succeeded",
          attempt_count: 1,
          reason: null,
        },
      ]);
      expect(fixture.runtime.database.prepare(
        "SELECT operation, base_revision FROM correction_events ORDER BY base_revision",
      ).all()).toEqual([{ operation: "change_amount", base_revision: 1 }]);
      expect(canonicalJson(fixture.runtime.database.prepare(
        "SELECT * FROM event_records WHERE event_id = ?",
      ).get(fixture.targetEventId))).toBe(beforeEvent);
      expect(fixture.runtime.database.prepare(
        `SELECT direction, reason_code, related_event_id, payload_json
         FROM inventory_transactions WHERE reason_code = 'correction_compensation'`,
      ).get()).toMatchObject({
        direction: "out",
        reason_code: "correction_compensation",
        related_event_id: fixture.targetEventId,
        payload_json: expect.stringContaining('"quantity_delta_microunits":-1000000'),
      });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(7_000_000);
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-corrected-eggs",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ amount: { observed_microunits: 3_000_000 } }] }],
      });

      const beforeReplay = tableCounts(fixture.runtime.database);
      expect(fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toEqual(result);
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeReplay);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects correction nutrition scaling overflow before FactCommit and keeps the correction query-invisible", () => {
    const fixture = createCorrectionFixture({ sourceEnergy: 2 });
    try {
      const envelope = correctionEnvelope({
        suffix: "nutrition-overflow-before-fact-commit",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: Number.MAX_SAFE_INTEGER,
        adopted: Number.MAX_SAFE_INTEGER,
        deducted: null,
      });
      const preview = fixture.service.preview(envelope);
      const before = businessCounts(fixture.runtime.database);

      expect(() => fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError("DOMAIN_RULE_INVALID:nutrition_scaled");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM correction_events",
      ).get()).toEqual({ count: 0 });
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-correction-overflow",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [{ items: [{ normalized_name: "eggs" }] }] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects cross-envelope daily progress overflow before correction FactCommit and keeps the correction query-invisible", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T05:00:00.000Z",
    });
    const energyOnlySource = (sourceRef: string, energy: number): NutritionSourceCandidate => ({
      ...nutritionSource("public_fixture", sourceRef, 1, null, {
        kind: "per_item", microunits: 1, unit: "piece",
      }),
      nutrients: {
        energy_kcal_milli: energy,
        protein_mg: 0,
        fat_mg: 0,
        carbohydrate_mg: 0,
        fiber_mg: 0,
        water_ml_milli: 0,
      },
    });
    try {
      const targetMeal = mealEnvelope({
        suffix: "correction-progress-target-one",
        location: "outside",
        items: [mealItem({
          name: "correction progress target", unit: "piece", observed: 1,
          adopted: 1, deducted: 0,
          sources: [energyOnlySource("fixture-correction-progress-one-v1", 1)],
        })],
      });
      previewAndExecute(service, targetMeal);
      previewAndExecute(service, mealEnvelope({
        suffix: "correction-progress-maximum-minus-one",
        location: "outside",
        items: [mealItem({
          name: "correction progress remainder", unit: "piece", observed: 1,
          adopted: 1, deducted: null,
          sources: [energyOnlySource(
            "fixture-correction-progress-maximum-minus-one-v1",
            Number.MAX_SAFE_INTEGER - 1,
          )],
        })],
      }));
      const targetEventId = deriveDomainId("event", targetMeal.idempotency_key, 0);
      const correction = correctionEnvelope({
        suffix: "daily-progress-overflow-before-fact-commit",
        targetEventId,
        baseRevision: 1,
        observed: 2,
        adopted: 2,
        deducted: 0,
      });
      const preview = service.preview(correction);
      const before = businessCounts(runtime.database);
      const beforeMeals = service.query({
        kind: "query_meals",
        operation_id: "query-before-correction-progress-overflow",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      });
      expect(service.query({
        kind: "query_daily_summary",
        operation_id: "query-summary-before-correction-progress-overflow",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        nutrients: { energy_kcal_milli: Number.MAX_SAFE_INTEGER },
      });

      expect(() => service.execute({
        envelope: correction,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError("CORRECTION_EFFECT_INVALID:daily_progress");
      expect(businessCounts(runtime.database)).toEqual(before);
      expect(service.query({
        kind: "query_meals",
        operation_id: "query-after-correction-progress-overflow",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toEqual(beforeMeals);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rejects a stale correction revision before any business write", () => {
    const fixture = createCorrectionFixture();
    try {
      const envelope = correctionEnvelope({
        suffix: "stale-eggs",
        targetEventId: fixture.targetEventId,
        baseRevision: 2,
        observed: 3_000_000,
        adopted: 3_000_000,
        deducted: 3_000_000,
      });
      const preview = fixture.service.preview(envelope);
      const before = businessCounts(fixture.runtime.database);
      expect(() => fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("CORRECTION_TARGET_INVALID:stale_revision");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM correction_events",
      ).get()).toEqual({ count: 0 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a no-change correction before any business write", () => {
    const fixture = createCorrectionFixture();
    try {
      const envelope = correctionEnvelope({
        suffix: "unchanged-eggs",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 2_000_000,
        adopted: 2_000_000,
        deducted: 2_000_000,
      });
      const preview = fixture.service.preview(envelope);
      const before = businessCounts(fixture.runtime.database);
      expect(() => fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("CORRECTION_TARGET_INVALID:no_change");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM correction_events",
      ).get()).toEqual({ count: 0 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("undo appends void_event, returns the real three-egg deduction, and never deletes the meal", () => {
    const fixture = createCorrectionFixture();
    try {
      previewAndExecute(fixture.service, correctionEnvelope({
        suffix: "eggs-before-undo",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 3_000_000,
        adopted: 3_000_000,
        deducted: 3_000_000,
      }));
      const beforeEvent = canonicalJson(fixture.runtime.database.prepare(
        "SELECT * FROM event_records WHERE event_id = ?",
      ).get(fixture.targetEventId));
      const result = previewAndExecute(fixture.service, undoEnvelope({
        suffix: "void-eggs",
        targetEventId: fixture.targetEventId,
        baseRevision: 2,
      }));
      expect(result.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT operation, base_revision FROM correction_events ORDER BY base_revision",
      ).all()).toEqual([
        { operation: "change_amount", base_revision: 1 },
        { operation: "void_event", base_revision: 2 },
      ]);
      expect(canonicalJson(fixture.runtime.database.prepare(
        "SELECT * FROM event_records WHERE event_id = ?",
      ).get(fixture.targetEventId))).toBe(beforeEvent);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE event_id = ?",
      ).get(fixture.targetEventId)).toEqual({ count: 1 });
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-voided-eggs",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(10_000_000);
      const compensationRows = fixture.runtime.database.prepare(
        `SELECT direction, payload_json FROM inventory_transactions
         WHERE reason_code = 'correction_compensation' ORDER BY committed_at`,
      ).all() as Array<{ direction: string; payload_json: string }>;
      expect(compensationRows.map((row) => [
        row.direction,
        JSON.parse(row.payload_json).quantity_delta_microunits,
      ])).toEqual([["out", -1_000_000], ["in", 3_000_000]]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("restores a voided meal by appending restore_event and reevaluating current inventory", () => {
    const fixture = createCorrectionFixture();
    try {
      previewAndExecute(fixture.service, correctionEnvelope({
        suffix: "eggs-before-restore",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 3_000_000,
        adopted: 3_000_000,
        deducted: 3_000_000,
      }));
      previewAndExecute(fixture.service, undoEnvelope({
        suffix: "void-before-restore",
        targetEventId: fixture.targetEventId,
        baseRevision: 2,
      }));
      const restoreEnvelope = undoEnvelope({
        suffix: "restore-eggs",
        targetEventId: fixture.targetEventId,
        baseRevision: 3,
      });
      const restorePreview = fixture.service.preview(restoreEnvelope);
      const restored = fixture.service.execute({
        envelope: restoreEnvelope,
        token: restorePreview.token,
        input_digest: restorePreview.input_digest,
        data_revision: restorePreview.data_revision,
      });

      expect(restored.status).toBe("committed");
      expect(restored.items).toMatchObject([{ operation: "restore_event", revision: 4 }]);
      expect(fixture.runtime.database.prepare(
        "SELECT operation, base_revision FROM correction_events ORDER BY base_revision",
      ).all()).toEqual([
        { operation: "change_amount", base_revision: 1 },
        { operation: "void_event", base_revision: 2 },
        { operation: "restore_event", base_revision: 3 },
      ]);
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(7_000_000);
      expect(fixture.runtime.database.prepare(
        `SELECT direction, payload_json FROM inventory_transactions
         WHERE reason_code = 'correction_compensation' ORDER BY committed_at, transaction_id`,
      ).all()).toHaveLength(3);
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-restored-eggs",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ amount: { observed_microunits: 3_000_000 } }] }],
      });
      expect(fixture.service.query({
        kind: "query_daily_summary",
        operation_id: "query-restored-progress",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 300_000 } });

      const beforeReplay = tableCounts(fixture.runtime.database);
      expect(fixture.service.execute({
        envelope: restoreEnvelope,
        token: restorePreview.token,
        input_digest: restorePreview.input_digest,
        data_revision: restorePreview.data_revision,
      })).toEqual(restored);
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeReplay);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("undo returns every real deduction from a multi-item meal and removes the whole meal contribution", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T07:00:00.000Z",
    });
    try {
      seedPurchase(service, purchaseStockEnvelope({
        suffix: "undo-eggs",
        productId: "product-undo-eggs",
        normalizedName: "undo eggs",
        batchId: "batch-undo-eggs",
        quantityMicrounits: 10_000_000,
        unit: "piece",
      }));
      const meal = mealEnvelope({
        suffix: "undo-multi-item",
        location: "home",
        items: [
          mealItem({
            name: "undo eggs", unit: "piece", observed: 2_000_000,
            adopted: 2_000_000, deducted: 2_000_000,
            sources: [nutritionSource("product_label", "label-product-undo-eggs-v1", 1,
              "product-undo-eggs", { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          }),
          mealItem({
            name: "undo eggs", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("product_label", "label-product-undo-eggs-v1", 1,
              "product-undo-eggs", { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          }),
        ],
      });
      previewAndExecute(service, meal);
      previewAndExecute(service, undoEnvelope({
        suffix: "multi-item-meal",
        targetEventId: deriveDomainId("event", meal.idempotency_key, 0),
        baseRevision: 1,
      }));

      expect(service.query(queryInventory()).batches.map((batch) => [
        batch.batch_id,
        batch.quantity_microunits,
      ])).toEqual([
        ["batch-undo-eggs", 10_000_000],
      ]);
      expect(runtime.database.prepare(
        `SELECT direction, related_transaction_id, payload_json
         FROM inventory_transactions WHERE reason_code = 'correction_compensation'
         ORDER BY related_transaction_id`,
      ).all()).toHaveLength(2);
      expect(service.query({
        kind: "query_daily_summary",
        operation_id: "query-after-multi-undo",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 0 } });
      expect(service.query({
        kind: "query_meals",
        operation_id: "query-after-multi-undo-meals",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [] });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("corrects an outside meal without inventing an inventory compensation transaction", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T08:00:00.000Z",
    });
    const meal = mealEnvelope({
      suffix: "outside-correction",
      location: "outside",
      items: [mealItem({
        name: "outside pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-outside-pear-v1", 1, null,
          { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      previewAndExecute(service, meal);
      const result = previewAndExecute(service, correctionEnvelope({
        suffix: "outside-pear-one-to-two",
        targetEventId: deriveDomainId("event", meal.idempotency_key, 0),
        baseRevision: 1,
        observed: 2_000_000,
        adopted: 2_000_000,
        deducted: 2_000_000,
      }));
      expect(result.status).toBe("committed");
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 0 });
      expect(service.query({
        kind: "query_meals",
        operation_id: "query-corrected-outside-pear",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ amount: { observed_microunits: 2_000_000 } }] }],
      });
      expect(service.query({
        kind: "query_daily_summary",
        operation_id: "query-corrected-outside-progress",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 200_000 } });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps a correction fact and nutrition progress when the inventory delta is insufficient", () => {
    const fixture = createCorrectionFixture();
    try {
      const envelope = correctionEnvelope({
        suffix: "insufficient-correction-delta",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 12_000_000,
        adopted: 12_000_000,
        deducted: 12_000_000,
      });
      const result = previewAndExecute(fixture.service, envelope);

      expect(result.status).toBe("committed_with_issues");
      expect(fixture.runtime.database.prepare(
        `SELECT effect_kind, state, attempt_count, reason FROM effect_outbox
         WHERE envelope_id = ? ORDER BY effect_kind`,
      ).all(envelope.envelope_id)).toEqual([
        {
          effect_kind: "correction_inventory_compensation",
          state: "permanent_business_skip",
          attempt_count: 1,
          reason: "inventory_insufficient",
        },
        {
          effect_kind: "daily_progress_replacement",
          state: "succeeded",
          attempt_count: 1,
          reason: null,
        },
      ]);
      expect(result.items).toMatchObject([{
        status: "committed_with_issues",
        issue_codes: ["inventory_insufficient"],
      }]);
      expect(fixture.runtime.database.prepare(
        "SELECT operation, base_revision FROM correction_events",
      ).get()).toEqual({ operation: "change_amount", base_revision: 1 });
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 0 });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(8_000_000);
      expect(fixture.runtime.database.prepare(
        "SELECT issue_code, status FROM issues WHERE entity_type = 'meal_item'",
      ).get()).toEqual({ issue_code: "inventory_insufficient", status: "open" });
      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-insufficient-correction-meal",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ amount: { observed_microunits: 12_000_000 } }] }],
      });
      expect(fixture.service.query({
        kind: "query_daily_summary",
        operation_id: "query-insufficient-correction-progress",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 1_200_000 } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("bases later correction and undo compensation on the real inventory ledger after an insufficient skip", () => {
    const fixture = createCorrectionFixture();
    try {
      previewAndExecute(fixture.service, correctionEnvelope({
        suffix: "insufficient-ledger-twelve",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 12_000_000,
        adopted: 12_000_000,
        deducted: 12_000_000,
      }));
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(8_000_000);

      previewAndExecute(fixture.service, correctionEnvelope({
        suffix: "insufficient-ledger-back-to-one",
        targetEventId: fixture.targetEventId,
        baseRevision: 2,
        observed: 1_000_000,
        adopted: 1_000_000,
        deducted: 1_000_000,
      }));
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(9_000_000);

      previewAndExecute(fixture.service, undoEnvelope({
        suffix: "insufficient-ledger-undo",
        targetEventId: fixture.targetEventId,
        baseRevision: 3,
      }));
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(10_000_000);
      const deltas = (fixture.runtime.database.prepare(
        `SELECT payload_json FROM inventory_transactions
         WHERE reason_code = 'correction_compensation' ORDER BY committed_at, transaction_id`,
      ).all() as Array<{ payload_json: string }>).map((row) =>
        JSON.parse(row.payload_json).quantity_delta_microunits as number);
      expect(deltas).toEqual([1_000_000, 1_000_000]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a tampered correction checkpoint before any compensation or nutrition write", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "tampered-correction-checkpoint",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      const checkpoint = fixture.runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE operation_id = ?",
      ).get(operation.operation_id) as { payload_json: string };
      const payload = JSON.parse(checkpoint.payload_json) as {
        effects: Array<{ effect_id: string; state: string }>;
      };
      payload.effects[0].effect_id = "effect-tampered-correction-checkpoint";
      fixture.runtime.database.prepare(
        "UPDATE effect_bundle_commits SET payload_json = ? WHERE operation_id = ?",
      ).run(canonicalJson(payload), operation.operation_id);
      const before = businessCounts(fixture.runtime.database);

      expect(() => applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      })).toThrow("CORRECTION_EFFECT_INVALID:checkpoint_payload");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 0 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("keeps a pending correction out of the effective view and blocks a later correction", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "pending-effective-view",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);

      expect(fixture.service.query({
        kind: "query_meals",
        operation_id: "query-before-pending-correction-effect",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({
        meals: [{ items: [{ amount: { observed_microunits: 2_000_000 } }] }],
      });
      const later = correctionEnvelope({
        suffix: "after-pending-correction",
        targetEventId: fixture.targetEventId,
        baseRevision: 1,
        observed: 4_000_000,
        adopted: 4_000_000,
        deducted: 4_000_000,
      });
      const laterPreview = fixture.service.preview(later);
      expect(() => fixture.service.execute({
        envelope: later,
        token: laterPreview.token,
        input_digest: laterPreview.input_digest,
        data_revision: laterPreview.data_revision,
      })).toThrow("CORRECTION_TARGET_INVALID:pending_correction");
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(8_000_000);

      const retried = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(retried.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM correction_events WHERE request_id = ?",
      ).get(operation.operation_id)).toEqual({ count: 1 });
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 1 });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(7_000_000);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("same-token retry seals and finalizes a correction whose EffectBundle already committed", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "retry-after-correction-effect",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      });
      const beforeRetry = businessCounts(fixture.runtime.database);

      const retried = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(retried.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "finalized" });
      expect(businessCounts(fixture.runtime.database)).toMatchObject({
        correction_events: beforeRetry.correction_events,
        inventory_transactions: beforeRetry.inventory_transactions,
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("same-token retry finalizes a correction that was sealed before the reply", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "retry-after-correction-seal",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      });
      sealPreparedEnvelopeFacts({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]),
        sealedAt: envelope.received_at,
      });

      const retried = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(retried.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT state FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ state: "finalized" });
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 1 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects an unrelated committed write between correction FactCommit and EffectBundle", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "stale-correction-handoff",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "unrelated-after-correction-fact",
        productId: "product-unrelated-after-correction-fact",
        normalizedName: "unrelated stock",
        batchId: "batch-unrelated-after-correction-fact",
        quantityMicrounits: 1_000_000,
        unit: "piece",
      }));
      const before = businessCounts(fixture.runtime.database);

      expect(() => applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      })).toThrow("PREVIEW_STALE:data_revision");
      expect(businessCounts(fixture.runtime.database)).toEqual(before);
      expect(fixture.runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).get()).toEqual({ count: 0 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("serializes a later meal behind an active correction reservation and allows retry", () => {
    const fixture = createCorrectionFixture();
    const envelope = correctionEnvelope({
      suffix: "interleaved-progress-finalize",
      targetEventId: fixture.targetEventId,
      baseRevision: 1,
      observed: 3_000_000,
      adopted: 3_000_000,
      deducted: 3_000_000,
    });
    try {
      const preview = fixture.service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "correct_record") throw new Error("test operation mismatch");
      const prepared = prepareCorrectionOperation({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      const correctionResult = applyCorrectionEffects({
        database: fixture.runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
      });
      sealPreparedEnvelopeFacts({
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]),
        sealedAt: envelope.received_at,
      });

      const interleavedEnvelope = mealEnvelope({
        suffix: "between-correction-effect-and-finalize",
        location: "outside",
        items: [mealItem({
          name: "interleaved pear",
          unit: "piece",
          observed: 1_000_000,
          adopted: 1_000_000,
          deducted: 1_000_000,
          sources: [nutritionSource(
            "public_fixture",
            "cn-interleaved-pear-v1",
            1,
            null,
            { kind: "per_item", microunits: 1_000_000, unit: "piece" },
          )],
        })],
      });
      const interleavedPreview = fixture.service.preview(interleavedEnvelope);
      const interleavedInput = {
        envelope: interleavedEnvelope,
        token: interleavedPreview.token,
        input_digest: interleavedPreview.input_digest,
        data_revision: interleavedPreview.data_revision,
      } as const;
      const beforeConflict = tableCounts(fixture.runtime.database);
      expect(() => fixture.service.execute(interleavedInput)).toThrow(
        "PROGRESS_RESERVATION_CONFLICT:active",
      );
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeConflict);

      const execution = Object.freeze({
        envelope_id: envelope.envelope_id,
        input_digest: preview.input_digest,
        status: correctionResult.status,
        items: Object.freeze([correctionResult]),
        payload: Object.freeze({
          authority_kind: "diet-manager/domain-execution/v1",
          daily_progress: correctionResult.daily_progress,
          daily_progress_by_date: correctionResult.daily_progress_by_date,
        }),
      });
      const finalizerBase = {
        database: fixture.runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        resultStatus: correctionResult.status,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: envelope.received_at,
        frozenAt: envelope.received_at,
        mixedItems: Object.freeze([]),
      } as const;
      expect(() => finalizeEnvelope({
        ...finalizerBase,
        payload: Object.freeze({
          ...execution,
          envelope_id: "envelope-forged-correction-result",
          input_digest: "0".repeat(64),
        }),
      })).toThrow("ENVELOPE_FINALIZE_AUTHORITY_INVALID:correction_progress_execution");
      expect(() => finalizeEnvelope({
        ...finalizerBase,
        payload: Object.freeze({
          ...execution,
          items: Object.freeze([Object.freeze({
            ...correctionResult,
            correction_id: "correction-forged-result",
            target_event_id: "event-forged-result",
            revision: 999,
            compensation_transaction_id: "transaction-forged-result",
            issue_codes: Object.freeze(["inventory_insufficient"]),
          })]),
        }),
      })).toThrow("ENVELOPE_FINALIZE_AUTHORITY_INVALID:correction_progress_item");
      const finalized = finalizeEnvelope({
        ...finalizerBase,
        payload: execution,
      });
      expect(finalized.payload).toMatchObject({
        payload: { daily_progress: { nutrients: { energy_kcal_milli: 300_000 } } },
        items: [{ daily_progress: { nutrients: { energy_kcal_milli: 300_000 } } }],
      });
      expect(fixture.service.execute(interleavedInput)).toMatchObject({
        payload: { daily_progress: { nutrients: { energy_kcal_milli: 400_000 } } },
      });
      expect(fixture.service.query({
        kind: "query_daily_summary",
        operation_id: "query-interleaved-correction-progress",
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 400_000 } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });
});
