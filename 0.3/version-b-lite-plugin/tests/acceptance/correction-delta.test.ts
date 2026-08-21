import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import type { CoreApplicationRequest, DietManagerAction } from "../../src/contracts.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-correction-delta-${randomUUID()}-`));
  ownedRoots.add(root);
  return root;
}

function removeRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeRoot(root);
});

function request(
  action: DietManagerAction,
  sourceText: string,
  operationId: string,
  receivedAt: string,
  conversationId = "conversation-correction-delta",
): CoreApplicationRequest {
  return {
    action,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: conversationId,
    prior_context: [],
  };
}

function homeMealRequest(
  sourceText: string,
  operationId: string,
  receivedAt: string,
): CoreApplicationRequest {
  return {
    ...request("record_meal", sourceText, operationId, receivedAt),
    prior_context: [{
      context_id: `context-${operationId}`,
      conversation_id: "conversation-correction-delta",
      revision: 1,
      generated_at: "2026-08-22T07:55:00+08:00",
      valid_until: "2026-08-22T08:30:00+08:00",
      source_message_id: `context-message-${operationId}`,
      rule_version: "diet-manager/context-v1",
      scope: "meal",
      scene: "home",
    }],
  };
}

function eggAdapter(): NutritionSourceAdapter {
  return {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.correction-delta-egg",
      backend_version: "1",
      network: false,
      request_fields: Object.freeze(["normalized_food_name"]),
    }),
    probe: async () => Object.freeze({
      source_id: "public.usda_fooddata_central", status: "ok", reason: null,
    }),
    resolve: async () => Object.freeze({
      status: "partial" as const,
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database" as const,
      source_record_id: "test:correction-delta-egg:v1",
      source_version: "1",
      retained_fields_sha256: "A".repeat(64),
      evidence: Object.freeze({
        source_id: "public.usda_fooddata_central",
        source_type: "authoritative_public_database" as const,
        source_ref: "test:correction-delta-egg:v1",
        source_version: "1",
        basis_kind: "per_item" as const,
        basis_amount: "1",
        basis_unit: "piece",
        nutrient_values: Object.freeze({
          energy_kcal: "70",
          protein_g: "6",
          fat_g: "5",
          carbohydrate_g: "0.5",
          fiber_g: "0",
          energy_kj: null,
          sodium_mg: null,
          sugar_g: null,
          saturated_fat_g: null,
          water_ml: null,
        }),
        field_evidence: Object.freeze([]),
        coverage_status: "partial" as const,
        adopted_amount: "1",
        adopted_unit: "piece",
        amount_range: null,
        formula: "profile_value * consumed_amount / basis_amount",
      }),
      reason: null,
    }),
  };
}

function metricValue(
  outcome: ReturnType<typeof handleCoreRequest>,
  key: string,
  field: "current" | "delta",
): string | null {
  const metric = outcome.progress?.flatMap((date) => date.metrics).find((candidate) => candidate.key === key);
  const value = metric?.[field];
  return value !== undefined && "value" in value ? value.value : null;
}

describe("Task 10 correction deltas", () => {
  it("applies only the +1 egg inventory and nutrition delta without creating a duplicate meal fact", async () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T00:10:01.000Z",
      nutritionConfig: cloneNutritionRuntimeConfig({
        policy_version: "2026-08-22.1",
        resolution_deadline_ms: 2_000,
        sources: [{
          source_id: "public.usda_fooddata_central",
          enabled: true,
          backend_id: "test.correction-delta-egg",
          backend_version: "1",
        }],
      }),
      nutritionAdapters: [eggAdapter()],
    });
    try {
      expect(handleCoreRequest(runtime, request(
        "add_inventory",
        "买了1盒鸡蛋，每盒12个",
        "operation-delta-purchase",
        "2026-08-22T08:00:00+08:00",
      ))).toMatchObject({ status: "committed", committed: true });

      const meal = await handleCoreRequestAsync(runtime, homeMealRequest(
        "吃了一个鸡蛋。",
        "operation-delta-meal",
        "2026-08-22T08:05:00+08:00",
      ));
      expect(meal, JSON.stringify(meal)).toMatchObject({ committed: true });
      const originalEnergy = metricValue(meal, "energy_kcal", "current");
      expect(originalEnergy).not.toBeNull();

      const correction = handleCoreRequest(runtime, request(
        "correct_record",
        "鸡蛋不是一个，是两个",
        "operation-delta-correction",
        "2026-08-22T08:10:00+08:00",
      ));
      expect(correction, JSON.stringify(correction)).toMatchObject({
        status: "committed",
        committed: true,
        correction: {
          operation: "change_amount",
          target_event_id: meal.record_id,
          revision: 2,
        },
      });
      expect(metricValue(correction, "energy_kcal", "delta")).toBe(originalEnergy);
      expect(metricValue(correction, "energy_kcal", "current"))
        .toBe(String(Number(originalEnergy) * 2));

      expect(handleCoreRequest(runtime, request(
        "correct_record",
        "把刚才鸡蛋改成3个",
        "operation-delta-correction",
        "2026-08-22T08:10:00+08:00",
      ))).toEqual({
        action: "correct_record",
        status: "failed",
        committed: false,
        operation_id: "operation-delta-correction",
        error_code: "idempotency_conflict",
      });

      const inventory = handleCoreRequest(runtime, request(
        "query_inventory",
        "查询库存",
        "operation-delta-inventory-query",
        "2026-08-22T08:11:00+08:00",
        "conversation-new-query",
      ));
      expect(inventory, JSON.stringify(inventory)).toMatchObject({
        status: "ignored",
        inventory_view: {
          batches: [{ name: "egg", quantity_microunits: 10_000_000, unit: "piece" }],
        },
      });

      const meals = handleCoreRequest(runtime, request(
        "query_meals",
        "查询今天饮食",
        "operation-delta-meal-query",
        "2026-08-22T08:12:00+08:00",
        "conversation-new-query",
      ));
      expect(meals, JSON.stringify(meals)).toMatchObject({
        meal_history: {
          meals: [{
            audit_ref: {
              original_event_id: meal.record_id,
              latest_correction_id: correction.correction?.correction_id,
            },
            items: [{ name: "egg", quantity_microunits: 2_000_000, unit: "个" }],
          }],
        },
      });

      const stored = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(stored.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'",
        ).get()).toEqual({ count: 1 });
        expect(stored.database.prepare(
          "SELECT COUNT(*) AS count FROM correction_events WHERE target_event_id = ?",
        ).get(meal.record_id)).toEqual({ count: 1 });
        expect(stored.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
        ).get()).toEqual({ count: 2 });
      } finally {
        stored.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("returns two stable ascending date progress blocks for a cross-date correction", async () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-22T04:10:01.000Z",
    });
    try {
      const meal = await handleCoreRequestAsync(runtime, request(
        "record_meal",
        "吃了150克苹果。",
        "operation-cross-date-meal",
        "2026-08-22T12:00:00+08:00",
        "conversation-cross-date",
      ));
      expect(meal, JSON.stringify(meal)).toMatchObject({ committed: true });

      const correction = handleCoreRequest(runtime, request(
        "correct_record",
        "刚才那顿其实是昨天晚饭",
        "operation-cross-date-correction",
        "2026-08-22T12:10:00+08:00",
        "conversation-cross-date",
      ));
      expect(correction, JSON.stringify(correction)).toMatchObject({
        status: "committed",
        correction: { operation: "change_time", target_event_id: meal.record_id },
      });
      expect(correction.progress?.map((date) => date.date)).toEqual([
        "2026-08-21",
        "2026-08-22",
      ]);
      expect(correction.progress).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });
});
