import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openDietDatabase } from "../../src/storage/database.js";

const roots: string[] = [];

function runtime() {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-repository-v2-"));
  roots.push(root);
  return openDietDatabase({ privateRuntimeRoot: root });
}

async function repositories() {
  const [pending, inventory, nutrition, goals] = await Promise.all([
    import("../../src/repository/pending-candidate-repository.js"),
    import("../../src/repository/inventory-quantity-repository.js"),
    import("../../src/repository/nutrition-search-audit-repository.js"),
    import("../../src/repository/goal-recommendation-repository.js"),
  ]);
  return { pending, inventory, nutrition, goals };
}

function seedInventoryBatch(database: DatabaseSync): void {
  database.prepare(`INSERT INTO command_envelopes(
    envelope_id,idempotency_key,input_digest,source_message_id,conversation_id,state,
    result_status,received_at,committed_at,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("envelope-v2", "idempotency-v2", "A".repeat(64), "message-v2", "conversation-v2",
      "facts_committed", "committed", "2026-08-21T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z", "{}");
  database.prepare(`INSERT INTO event_records(
    event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,
    source_message_id,conversation_id,received_at,committed_at,occurred_at_text,
    result_status,lifecycle_status,meal_id,meal_slot,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?)`)
    .run("event-v2", "envelope-v2", "operation-v2", "diet-manager/event/v1",
      "inventory_stock", "inventory", "message-v2", "conversation-v2",
      "2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z",
      "committed", "active", "{}");
  database.prepare(`INSERT INTO products(
    product_id,schema_version,normalized_name,product_type,brand,manufacturer,barcode,sku,payload_json
  ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`)
    .run("product-v2", "diet-manager/product/v1", "milk", "drink", "{}");
  database.prepare(`INSERT INTO inventory_batches(
    batch_id,product_id,stock_event_id,schema_version,committed_at,stocked_at,
    explicit_expiration_at,quantity_unit,payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .run("batch-v2", "product-v2", "event-v2", "diet-manager/inventory-batch/v1",
      "2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z", "package", "{}");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: false });
});

describe("migration v2 repositories", () => {
  it("exposes all four repository boundaries", async () => {
    await expect(repositories()).resolves.toMatchObject({
      pending: { createPendingCandidate: expect.any(Function) },
      inventory: { createInventoryQuantityModel: expect.any(Function) },
      nutrition: { appendNutritionSearchAudit: expect.any(Function) },
      goals: { createGoalRecommendation: expect.any(Function) },
    });
  });

  it("enforces pending-candidate idempotency, revision, TTL, and canonical JSON", async () => {
    const { pending } = await repositories();
    const opened = runtime();
    try {
      const input = {
        candidate_id: "candidate-v2",
        idempotency_key: "candidate-idempotency-v2",
        conversation_id: "conversation-v2",
        action: "record_meal",
        original_proposal: { kind: "meal" },
        current_proposal: { kind: "meal" },
        missing_fields: ["items.0.amount"],
        created_at: "2026-08-21T00:00:00.000Z",
        expires_at: "2026-08-21T00:05:00.000Z",
      } as const;
      expect(pending.createPendingCandidate(opened.database, input)).toMatchObject({ revision: 1 });
      expect(pending.createPendingCandidate(opened.database, input)).toMatchObject({ revision: 1 });
      expect(() => pending.createPendingCandidate(opened.database, {
        ...input,
        candidate_id: "candidate-conflict-v2",
      })).toThrow("PENDING_CANDIDATE_REPOSITORY_INVALID:idempotency_conflict");

      const updated = pending.updatePendingCandidate(opened.database, {
        candidate_id: input.candidate_id,
        expected_revision: 1,
        current_proposal: { kind: "meal", amount: 2 },
        missing_fields: [],
        expires_at: input.expires_at,
      });
      expect(updated).toMatchObject({ revision: 2, missing_fields: [] });
      expect(() => pending.updatePendingCandidate(opened.database, {
        candidate_id: input.candidate_id,
        expected_revision: 1,
        current_proposal: { kind: "meal" },
        missing_fields: [],
        expires_at: input.expires_at,
      })).toThrow("PENDING_CANDIDATE_REPOSITORY_INVALID:revision_conflict");

      expect(pending.listOpenPendingCandidates(
        opened.database,
        input.conversation_id,
        "2026-08-21T00:06:00.000Z",
      )).toEqual([]);
      expect(pending.readPendingCandidate(opened.database, input.candidate_id))
        .toMatchObject({ status: "expired", revision: 3 });
      expect(() => pending.createPendingCandidate(opened.database, {
        ...input,
        candidate_id: "candidate-hostile-v2",
        idempotency_key: "candidate-hostile-idempotency-v2",
        original_proposal: { kind: "meal", value: Number.NaN },
      })).toThrow("AUTHORITY_JSON_INVALID:number");
    } finally {
      opened.close();
    }
  });

  it("uses optimistic revisions for inventory quantities and preserves unknown base amounts", async () => {
    const { inventory } = await repositories();
    const opened = runtime();
    try {
      seedInventoryBatch(opened.database);
      const created = inventory.createInventoryQuantityModel(opened.database, {
        batch_id: "batch-v2",
        package_unit: "package",
        original_package_microunits: 2_000,
        per_package_base_microunits: 250_000,
        base_unit: "ml",
        remaining_base_microunits: 500_000,
        conversion_source: "explicit",
      });
      expect(created).toMatchObject({ revision: 1, remaining_base_microunits: 500_000 });
      expect(inventory.updateInventoryQuantityRemaining(opened.database, {
        batch_id: "batch-v2",
        expected_revision: 1,
        remaining_base_microunits: 350_000,
      })).toMatchObject({ revision: 2, remaining_base_microunits: 350_000 });
      expect(inventory.consumeInventoryQuantityRemaining(opened.database, {
        batch_id: "batch-v2",
        expected_revision: 2,
        expected_remaining_base_microunits: 350_000,
        remaining_base_microunits: 100_000,
      })).toMatchObject({ revision: 3, remaining_base_microunits: 100_000 });
      expect(() => inventory.updateInventoryQuantityRemaining(opened.database, {
        batch_id: "batch-v2",
        expected_revision: 2,
        remaining_base_microunits: 1,
      })).toThrow("INVENTORY_QUANTITY_REPOSITORY_INVALID:revision_conflict");
    } finally {
      opened.close();
    }
  });

  it("stores immutable canonical nutrition search audit rows", async () => {
    const { nutrition } = await repositories();
    const opened = runtime();
    try {
      const input = {
        resolution_id: "resolution-v2",
        query: "whole milk",
        source_type: "public_database",
        source_name: "USDA FoodData Central",
        source_ref: "fdc:746782",
        retrieved_at: "2026-08-21T00:00:00.000Z",
        match_basis: "exact_name",
        confidence_microunits: 950_000,
        license_decision: "allowed",
        cache_decision: "store",
        adopted_profile_id: null,
        payload: { nutrients: ["energy"] },
      } as const;
      expect(nutrition.appendNutritionSearchAudit(opened.database, input)).toEqual(
        nutrition.appendNutritionSearchAudit(opened.database, input),
      );
      expect(() => nutrition.appendNutritionSearchAudit(opened.database, {
        ...input,
        query: "different",
      })).toThrow("NUTRITION_SEARCH_AUDIT_REPOSITORY_INVALID:resolution_conflict");
      expect(nutrition.listNutritionSearchAudit(opened.database, "whole milk"))
        .toHaveLength(1);
    } finally {
      opened.close();
    }
  });

  it("allows one pending goal recommendation per user and transitions with a revision", async () => {
    const { goals } = await repositories();
    const opened = runtime();
    try {
      const input = {
        recommendation_id: "goal-recommendation-v2",
        user_id: "default",
        profile_version: "profile-v1",
        goals: { energy_kcal: 1800 },
        basis: { method: "profile" },
        created_at: "2026-08-21T00:00:00.000Z",
      } as const;
      expect(goals.createGoalRecommendation(opened.database, input))
        .toMatchObject({ status: "pending", revision: 1 });
      expect(() => goals.createGoalRecommendation(opened.database, {
        ...input,
        recommendation_id: "goal-recommendation-second-v2",
      })).toThrow("GOAL_RECOMMENDATION_REPOSITORY_INVALID:pending_conflict");
      expect(goals.transitionGoalRecommendation(opened.database, {
        recommendation_id: input.recommendation_id,
        expected_revision: 1,
        status: "confirmed",
        changed_at: "2026-08-21T00:01:00.000Z",
      })).toMatchObject({ status: "confirmed", revision: 2 });
      expect(() => goals.transitionGoalRecommendation(opened.database, {
        recommendation_id: input.recommendation_id,
        expected_revision: 1,
        status: "rejected",
        changed_at: "2026-08-21T00:02:00.000Z",
      })).toThrow("GOAL_RECOMMENDATION_REPOSITORY_INVALID:revision_conflict");
    } finally {
      opened.close();
    }
  });
});
