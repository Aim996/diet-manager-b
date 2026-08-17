import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

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

interface SeedResult {
  mealId: string;
  root: string;
  runtime: ReturnType<typeof createCoreRuntime>;
}

async function seedAppleMeal(): Promise<SeedResult> {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-correction-${randomUUID()}-`));
  const runtime = createRuntime(root);
  const meal = await handleCoreRequestAsync(runtime, {
    action: "record_meal",
    source_text: "吃了150克苹果。",
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-correction-seed-001",
    source_message_id: "message-correction-seed-001",
    conversation_id: "conversation-correction-001",
    prior_context: [],
  });
  expect(meal.committed, JSON.stringify(meal)).toBe(true);
  return { mealId: meal.record_id, root, runtime };
}

it("corrects the latest meal amount to an explicit new amount", async () => {
  const { mealId, root, runtime } = await seedAppleMeal();
  try {
    const before = openDietDatabase({ privateRuntimeRoot: root });
    const originalPayload = before.database.prepare(
      "SELECT payload_json FROM event_records WHERE event_id = ?",
    ).get(mealId) as { payload_json: string };
    before.close();

    const outcome = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "把刚才苹果改成200克",
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-amount-correction-001",
      source_message_id: "message-amount-correction-001",
      conversation_id: "conversation-correction-001",
      prior_context: [],
    });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "committed",
      correction: { operation: "change_amount", target_event_id: mealId },
    });

    const after = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(after.database.prepare(
        "SELECT payload_json FROM event_records WHERE event_id = ?",
      ).get(mealId)).toEqual(originalPayload);
    } finally {
      after.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});

it("corrects the latest meal occurrence time to yesterday dinner", async () => {
  const { mealId, root, runtime } = await seedAppleMeal();
  try {
    const before = openDietDatabase({ privateRuntimeRoot: root });
    const originalPayload = before.database.prepare(
      "SELECT payload_json FROM event_records WHERE event_id = ?",
    ).get(mealId) as { payload_json: string };
    const snapshotCountBefore = (before.database.prepare(
      "SELECT COUNT(*) AS count FROM nutrition_snapshots WHERE meal_event_id = ?",
    ).get(mealId) as { count: number }).count;
    before.close();

    const outcome = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "刚才那顿其实是昨天晚饭",
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-time-correction-001",
      source_message_id: "message-time-correction-001",
      conversation_id: "conversation-correction-001",
      prior_context: [],
    });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "committed",
      correction: { operation: "change_time", target_event_id: mealId },
    });

    const after = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(after.database.prepare(
        "SELECT payload_json FROM event_records WHERE event_id = ?",
      ).get(mealId)).toEqual(originalPayload);
      // Time correction must not rewrite historical nutrition snapshots.
      expect(after.database.prepare(
        "SELECT COUNT(*) AS count FROM nutrition_snapshots WHERE meal_event_id = ?",
      ).get(mealId)).toEqual({ count: snapshotCountBefore });
    } finally {
      after.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
