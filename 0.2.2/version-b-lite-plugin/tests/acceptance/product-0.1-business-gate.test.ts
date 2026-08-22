import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DatabaseSync } from "node:sqlite";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { canonicalJson } from "../../src/authority/canonical-json.js";
import { assertDietManagerOutcome, type CoreApplicationRequest, type DietManagerAction } from "../../src/contracts.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const CONVERSATION_ID = "conversation-business-gate";

// A nutrition adapter that always resolves a per-100g apple profile with an
// explicit adopted amount, so the seeded meal carries non-null nutrition
// adoption and inventory deduction (both required for amount correction).
function appleAdapter(): NutritionSourceAdapter {
  return {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.apple",
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
      source_record_id: "test:apple:v1",
      source_version: "1",
      retained_fields_sha256: "A".repeat(64),
      evidence: Object.freeze({
        source_id: "public.usda_fooddata_central",
        source_type: "authoritative_public_database" as const,
        source_ref: "test:apple:v1",
        source_version: "1",
        basis_kind: "per_100g" as const,
        basis_amount: "100",
        basis_unit: "g",
        nutrient_values: Object.freeze({
          energy_kcal: "52", protein_g: "0.3", fat_g: "0.2", carbohydrate_g: "14",
          fiber_g: "2.4", energy_kj: null, sodium_mg: null, sugar_g: null,
          saturated_fat_g: null, water_ml: null,
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

function createRuntime(root: string) {
  return createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-14T12:00:01.000Z",
    nutritionConfig: cloneNutritionRuntimeConfig({
      policy_version: "2026-08-14.1",
      resolution_deadline_ms: 2_000,
      sources: [{
        source_id: "public.usda_fooddata_central",
        enabled: true,
        backend_id: "test.apple",
        backend_version: "1",
      }],
    }),
    nutritionAdapters: [appleAdapter()],
  });
}

function writeRequest(
  action: DietManagerAction,
  sourceText: string,
  operationId: string,
  receivedAt: string,
): CoreApplicationRequest {
  return {
    action,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: CONVERSATION_ID,
    prior_context: [],
  };
}

function queryRequest(
  action: "query_daily_summary" | "query_meals" | "query_inventory",
  operationId: string,
  receivedAt: string,
): CoreApplicationRequest {
  // Queries bypass parsing but the request shape still requires a non-empty
  // source_text (cloneRequest validates the full input envelope).
  return writeRequest(action, "查询", operationId, receivedAt);
}

function businessSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function storedBusinessSnapshot(root: string): string {
  const opened = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return businessSnapshot(opened.database);
  } finally {
    opened.close();
  }
}

it("records purchase, meal, water, amount correction, location correction and undo into truthful six-domain progress", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-gate-${randomUUID()}-`));
  const runtime = createRuntime(root);
  try {
    const purchase = handleCoreRequest(runtime, writeRequest(
      "add_inventory", "买了两箱牛奶，每箱12盒，每盒250ml。", "op-purchase", "2026-08-14T12:00:00+08:00",
    ));
    expect(purchase.committed, JSON.stringify(purchase)).toBe(true);

    const meal = await handleCoreRequestAsync(runtime, writeRequest(
      "record_meal", "吃了150克苹果。", "op-meal", "2026-08-14T12:01:00+08:00",
    ));
    expect(meal.committed, JSON.stringify(meal)).toBe(true);

    const water = handleCoreRequest(runtime, writeRequest(
      "record_water", "喝了500ml白水。", "op-water", "2026-08-14T12:02:00+08:00",
    ));
    expect(water.committed, JSON.stringify(water)).toBe(true);

    const amount = handleCoreRequest(runtime, writeRequest(
      "correct_record", "把刚才苹果改成200克", "op-amount", "2026-08-14T12:03:00+08:00",
    ));
    expect(amount, JSON.stringify(amount)).toMatchObject({
      status: "committed", correction: { operation: "change_amount" },
    });

    const location = handleCoreRequest(runtime, writeRequest(
      "correct_record", "更正：这批牛奶放在常温柜，不是冷藏室。", "op-location", "2026-08-14T12:04:00+08:00",
    ));
    expect(location, JSON.stringify(location)).toMatchObject({
      status: "committed", committed: true,
    });

    const undo = handleCoreRequest(runtime, writeRequest(
      "undo_record", "撤销刚才那条饮食记录", "op-undo", "2026-08-14T12:05:00+08:00",
    ));
    expect(undo, JSON.stringify(undo)).toMatchObject({
      status: "committed", correction: { operation: "void_event" },
    });

    const before = storedBusinessSnapshot(root);

    const summary = handleCoreRequest(runtime, queryRequest(
      "query_daily_summary", "op-query-summary", "2026-08-14T12:06:00+08:00",
    ));
    expect(summary, JSON.stringify(summary)).toMatchObject({
      action: "query_daily_summary",
      status: "ignored",
      committed: false,
      reason_code: "read_only_result",
      daily_progress: {
        date: "2026-08-14",
        timezone: "Asia/Shanghai",
        meals: { count: 0 },
        water: { count: 1, plain_water_ml_milli: 500_000 },
        inventory: { deduction_count: 0 },
        purchases: { count: 1 },
        corrections: { count: 3 },
      },
    });
    expect(assertDietManagerOutcome(summary)).toBe(summary);

    const meals = handleCoreRequest(runtime, queryRequest(
      "query_meals", "op-query-meals", "2026-08-14T12:06:00+08:00",
    ));
    expect(meals, JSON.stringify(meals)).toMatchObject({
      action: "query_meals",
      status: "ignored",
      committed: false,
      reason_code: "read_only_result",
      meal_history: { date: "2026-08-14", timezone: "Asia/Shanghai", meals: [] },
    });
    expect(assertDietManagerOutcome(meals)).toBe(meals);

    const inventory = handleCoreRequest(runtime, queryRequest(
      "query_inventory", "op-query-inventory", "2026-08-14T12:06:00+08:00",
    ));
    expect(inventory, JSON.stringify(inventory)).toMatchObject({
      action: "query_inventory",
      status: "ignored",
      committed: false,
      reason_code: "read_only_result",
      inventory_view: { batches: [{
        name: "milk",
        location: "room_temperature_cabinet",
      }] },
    });
    expect(assertDietManagerOutcome(inventory)).toBe(inventory);

    expect(storedBusinessSnapshot(root)).toBe(before);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});

it("returns audit_ref on a corrected meal without leaking authority tokens", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-audit-${randomUUID()}-`));
  const runtime = createRuntime(root);
  try {
    const meal = await handleCoreRequestAsync(runtime, writeRequest(
      "record_meal", "吃了150克苹果。", "op-meal", "2026-08-14T12:01:00+08:00",
    ));
    expect(meal.committed, JSON.stringify(meal)).toBe(true);
    const mealId = meal.record_id;

    const amount = handleCoreRequest(runtime, writeRequest(
      "correct_record", "把刚才苹果改成200克", "op-amount", "2026-08-14T12:03:00+08:00",
    ));
    expect(amount, JSON.stringify(amount)).toMatchObject({
      status: "committed", correction: { operation: "change_amount", target_event_id: mealId },
    });
    const correctionId = amount.correction?.correction_id;
    expect(typeof correctionId).toBe("string");

    const before = storedBusinessSnapshot(root);
    const meals = handleCoreRequest(runtime, queryRequest(
      "query_meals", "op-query-meals", "2026-08-14T12:06:00+08:00",
    ));
    expect(meals, JSON.stringify(meals)).toMatchObject({
      status: "ignored",
      committed: false,
      reason_code: "read_only_result",
      meal_history: {
        date: "2026-08-14",
        timezone: "Asia/Shanghai",
        meals: [{
          audit_ref: { original_event_id: mealId, latest_correction_id: correctionId },
          items: [{ name: "apple", quantity_microunits: 200_000_000, unit: "克" }],
        }],
      },
    });
    expect(assertDietManagerOutcome(meals)).toBe(meals);
    expect(storedBusinessSnapshot(root)).toBe(before);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});

it("excludes reclassified water from the water domain while keeping the correction count", () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-water-${randomUUID()}-`));
  const runtime = createRuntime(root);
  try {
    const water = handleCoreRequest(runtime, writeRequest(
      "record_water", "喝了500ml白水。", "op-water", "2026-08-14T12:02:00+08:00",
    ));
    expect(water.committed, JSON.stringify(water)).toBe(true);

    const reclassify = handleCoreRequest(runtime, writeRequest(
      "correct_record", "刚才那杯不是白水，是牛奶", "op-reclassify", "2026-08-14T12:03:00+08:00",
    ));
    expect(reclassify, JSON.stringify(reclassify)).toMatchObject({
      status: "committed", correction: { operation: "change_water_classification" },
    });

    const before = storedBusinessSnapshot(root);
    const summary = handleCoreRequest(runtime, queryRequest(
      "query_daily_summary", "op-query-summary", "2026-08-14T12:06:00+08:00",
    ));
    expect(summary, JSON.stringify(summary)).toMatchObject({
      status: "ignored",
      committed: false,
      reason_code: "read_only_result",
      daily_progress: {
        date: "2026-08-14",
        water: { count: 0, plain_water_ml_milli: 0 },
        corrections: { count: 1 },
      },
    });
    expect(assertDietManagerOutcome(summary)).toBe(summary);
    expect(storedBusinessSnapshot(root)).toBe(before);
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
