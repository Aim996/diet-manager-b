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

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-cross-session-query-${randomUUID()}-`));
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

function appleAdapter(): NutritionSourceAdapter {
  return {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.cross-session-apple",
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
      source_record_id: "test:cross-session-apple:v1",
      source_version: "1",
      retained_fields_sha256: "A".repeat(64),
      evidence: Object.freeze({
        source_id: "public.usda_fooddata_central",
        source_type: "authoritative_public_database" as const,
        source_ref: "test:cross-session-apple:v1",
        source_version: "1",
        basis_kind: "per_100g" as const,
        basis_amount: "100",
        basis_unit: "g",
        nutrient_values: Object.freeze({
          energy_kcal: "52",
          protein_g: "0.3",
          fat_g: "0.2",
          carbohydrate_g: "14",
          fiber_g: "2.4",
          energy_kj: null,
          sodium_mg: null,
          sugar_g: null,
          saturated_fat_g: null,
          water_ml: null,
        }),
        field_evidence: Object.freeze([]),
        coverage_status: "partial" as const,
        adopted_amount: "150",
        adopted_unit: "g",
        amount_range: null,
        formula: "profile_value * consumed_amount / basis_amount",
      }),
      reason: null,
    }),
  };
}

const nutritionConfig = cloneNutritionRuntimeConfig({
  policy_version: "2026-08-22.1",
  resolution_deadline_ms: 2_000,
  sources: [{
    source_id: "public.usda_fooddata_central",
    enabled: true,
    backend_id: "test.cross-session-apple",
    backend_version: "1",
  }],
});

function runtime(root: string) {
  return createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-22T04:00:01.000Z",
    nutritionConfig,
    nutritionAdapters: [appleAdapter()],
  });
}

function request(
  action: DietManagerAction,
  sourceText: string,
  operationId: string,
  receivedAt: string,
  conversationId: string,
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

describe("Task 10 cross-session SQLite query", () => {
  it("reopens with empty context and reads meals, inventory, nutrition source, goal version and progress", async () => {
    const root = newRoot();
    const writer = runtime(root);
    let mealId: string;
    try {
      expect(handleCoreRequest(writer, request(
        "add_inventory",
        "买了1盒鸡蛋，每盒12个",
        "operation-cross-session-purchase",
        "2026-08-22T12:00:00+08:00",
        "conversation-writer",
      ))).toMatchObject({ status: "committed" });
      expect(handleCoreRequest(writer, request(
        "set_goal",
        "热量目标2000千卡",
        "operation-cross-session-goal",
        "2026-08-22T12:01:00+08:00",
        "conversation-writer",
      ))).toMatchObject({ status: "committed", goal_update: { goals: { energy_kcal: 2000 } } });
      const meal = await handleCoreRequestAsync(writer, request(
        "record_meal",
        "吃了150克苹果。",
        "operation-cross-session-meal",
        "2026-08-22T12:02:00+08:00",
        "conversation-writer",
      ));
      expect(meal, JSON.stringify(meal)).toMatchObject({ committed: true });
      mealId = meal.record_id!;
    } finally {
      writer.close();
    }

    const reader = runtime(root);
    try {
      const meals = handleCoreRequest(reader, request(
        "query_meals",
        "查询今天饮食",
        "operation-cross-session-query-meals",
        "2026-08-22T12:10:00+08:00",
        "conversation-reader-new",
      ));
      expect(meals, JSON.stringify(meals)).toMatchObject({
        status: "ignored",
        reason_code: "read_only_result",
        meal_history: {
          meals: [{
            audit_ref: { original_event_id: mealId, latest_correction_id: null },
            items: [{
              name: "apple",
              quantity_microunits: 150_000_000,
              nutrition_source: {
                source_id: "public.usda_fooddata_central",
                source_type: "authoritative_public_database",
                source_ref: "test:cross-session-apple:v1",
                source_version: "1",
                coverage_status: "partial",
              },
            }],
          }],
        },
      });

      const inventory = handleCoreRequest(reader, request(
        "query_inventory",
        "查询库存",
        "operation-cross-session-query-inventory",
        "2026-08-22T12:11:00+08:00",
        "conversation-reader-new",
      ));
      expect(inventory, JSON.stringify(inventory)).toMatchObject({
        status: "ignored",
        inventory_view: { batches: [{ name: "egg", quantity_microunits: 12_000_000 }] },
      });

      const summary = handleCoreRequest(reader, request(
        "query_daily_summary",
        "查询今天进度",
        "operation-cross-session-query-summary",
        "2026-08-22T12:12:00+08:00",
        "conversation-reader-new",
      ));
      expect(summary, JSON.stringify(summary)).toMatchObject({
        status: "ignored",
        daily_progress: {
          meals: { count: 1 },
          configured_goals: { energy_kcal: 2000 },
          progress: { energy_kcal: { current: 78, target: 2000 } },
        },
        progress: [{
          goal_version_id: expect.any(String),
          metrics: expect.arrayContaining([expect.objectContaining({
            key: "energy_kcal",
            current: { kind: "exact", value: "78" },
            target: "2000",
          })]),
        }],
      });
    } finally {
      reader.close();
    }
  });
});
