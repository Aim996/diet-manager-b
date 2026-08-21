import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import { handleCoreRequestAsync } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { assertDietManagerOutcome } from "../../src/contracts.js";
import {
  adoptNutritionAmount,
  buildNutritionRecords,
  nutritionOutcomeItem,
} from "../../src/nutrition/nutrition-service.js";
import { createBuiltinNutritionAdapters } from "../../src/nutrition/builtin.js";
import { persistNutritionRecords, readNutritionRecordsForMeal } from "../../src/nutrition/nutrition-repository.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import {
  unknownNutritionEvidence,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
} from "../../src/nutrition/types.js";
import { openDietDatabase } from "../../src/storage/database.js";
import { MIGRATION_V1_TABLE_STATEMENTS } from "../../src/storage/migration-v1.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");

function evidence(overrides: Partial<ResolvedNutritionEvidence> = {}): ResolvedNutritionEvidence {
  return {
    source_id: "public.usda_fooddata_central",
    source_type: "authoritative_public_database",
    source_ref: "fdc:rice-001",
    source_version: "2026.08",
    basis_kind: "per_100g",
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "116", protein_g: "2.6", fat_g: "0.3", carbohydrate_g: "25.9", fiber_g: "0.4",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
    field_evidence: [],
    coverage_status: "partial",
    adopted_amount: "200",
    adopted_unit: "g",
    amount_range: null,
    formula: "profile_value * consumed_amount / basis_amount",
    ...overrides,
  };
}

const identity = {
  operation_id: "operation-meal-001",
  meal_event_id: "event-meal-001",
  intake_item_id: "item-rice-001",
  item_name: "rice",
  subject_type: "food" as const,
  subject_id: "food-rice-cooked",
  created_at: "2026-08-14T12:00:00.000Z",
};

it("builds deterministic known, inferred-range, and unknown nutrition records", () => {
  const explicit = buildNutritionRecords(identity, evidence());
  expect(explicit.profile.nutrition_profile_id).toMatch(/^nutrition-profile-/);
  expect(explicit.snapshot.nutrient_values).toMatchObject({
    energy_kcal: "232", protein_g: "5.2", carbohydrate_g: "51.8",
  });
  expect(explicit.snapshot.consumed_amount).toBe("200");
  expect(nutritionOutcomeItem(identity.item_name, explicit)).toMatchObject({
    adopted_amount: "200", adopted_unit: "g", amount_range: null,
    quantity_evidence: "explicit", source_label: "public_reference",
  });

  const inferred = buildNutritionRecords(
    { ...identity, intake_item_id: "item-rice-half-bowl" },
    evidence({
      adopted_amount: "150",
      amount_range: { min: "100", max: "150", adopted: "150", unit: "g", rule_version: "bowl-upper-v1" },
    }),
  );
  expect(inferred.snapshot.nutrient_values.energy_kcal).toBe("174");
  expect(nutritionOutcomeItem("half bowl rice", inferred)).toMatchObject({
    adopted_amount: "150", quantity_evidence: "field_inference",
    amount_range: { min: "100", max: "150", adopted: "150", unit: "g", rule_version: "bowl-upper-v1" },
  });

  const unknown = buildNutritionRecords(
    { ...identity, intake_item_id: "item-combo-unknown", item_name: "unknown combo" },
    evidence({
      source_id: "terminal.unknown", source_type: "unknown", source_ref: "terminal.unknown",
      source_version: "2026-08-09.1", nutrient_values: {
        energy_kcal: null, protein_g: null, fat_g: null, carbohydrate_g: null, fiber_g: null,
        energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
      },
      coverage_status: "unknown", adopted_amount: null, adopted_unit: null, amount_range: null, formula: "unknown",
    }),
  );
  expect(unknown.snapshot).toMatchObject({
    schema_version: "1.1.0", consumed_amount: null, consumed_unit: null,
    coverage_status: "unknown",
  });
  expect(Object.values(unknown.snapshot.nutrient_values).every((value) => value === null)).toBe(true);
  expect(nutritionOutcomeItem("unknown combo", unknown)).toMatchObject({
    adopted_amount: null, adopted_unit: null, quantity_evidence: "unknown", source_label: "unknown",
  });
  expect(Object.isFrozen(unknown.snapshot.nutrient_values)).toBe(true);
});

it("persists Profile and Snapshot atomically and reuses exact bytes", () => {
  const db: DatabaseSyncType = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const statement of MIGRATION_V1_TABLE_STATEMENTS) db.exec(statement);
    db.prepare(`INSERT INTO command_envelopes(
      envelope_id,idempotency_key,input_digest,source_message_id,conversation_id,state,result_status,
      received_at,committed_at,payload_json
    ) VALUES (?, ?, ?, ?, ?, 'finalized', 'committed', ?, ?, '{}')`)
      .run("env-meal-001", "idem-meal-001", "A".repeat(64), "msg-001", "conv-001",
        identity.created_at, identity.created_at);
    db.prepare(`INSERT INTO event_records(
      event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,source_message_id,conversation_id,
      received_at,committed_at,occurred_at_text,result_status,lifecycle_status,meal_id,meal_slot,payload_json
    ) VALUES (?, ?, ?, '1.0.0', 'diet_meal', 'observed', ?, ?, ?, ?, ?, 'committed', 'active', ?, 'lunch', '{}')`)
      .run(identity.meal_event_id, "env-meal-001", identity.operation_id, "msg-001", "conv-001",
        identity.created_at, identity.created_at, identity.created_at, "meal-001");
    db.prepare(`INSERT INTO meal_items(item_id,event_id,item_order,item_type,normalized_name,payload_json)
      VALUES (?, ?, 0, 'solid', 'rice', '{}')`).run(identity.intake_item_id, identity.meal_event_id);
    const records = buildNutritionRecords(identity, evidence());
    persistNutritionRecords(db, [records]);
    persistNutritionRecords(db, [records]);
    expect(db.prepare("SELECT count(*) AS count FROM nutrition_profiles").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 1 });
    const readback = readNutritionRecordsForMeal(db, identity.meal_event_id);
    expect(readback).toHaveLength(1);
    expect(readback[0]?.snapshot.snapshot_id).toBe(records.snapshot.snapshot_id);
    expect(Object.isFrozen(readback[0]?.snapshot)).toBe(true);
  } finally {
    db.close();
  }
});

it("returns persisted nutrition evidence through the real asynchronous meal path", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-nutrition-app-${randomUUID()}-`));
  const adapter: NutritionSourceAdapter = {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.fooddata-central",
      backend_version: "1",
      network: false,
      request_fields: Object.freeze(["normalized_food_name"]),
    }),
    probe: async () => Object.freeze({
      source_id: "public.usda_fooddata_central", status: "ok", reason: null,
    }),
    resolve: async () => Object.freeze({
      status: "ok",
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      source_record_id: "fdc:rice-001",
      source_version: "2026.08",
      retained_fields_sha256: "A".repeat(64),
      evidence: evidence({ adopted_amount: null, adopted_unit: null }),
      reason: null,
    }),
  };
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-11T04:00:01.000Z",
    nutritionConfig: cloneNutritionRuntimeConfig({
      policy_version: "2026-08-09.1",
      resolution_deadline_ms: 2_000,
      sources: [{
        source_id: "public.usda_fooddata_central",
        enabled: true,
        backend_id: "test.fooddata-central",
        backend_version: "1",
      }],
    }),
    nutritionAdapters: [adapter],
  });
  try {
    const outcome = await handleCoreRequestAsync(runtime, {
      action: "record_meal",
      source_text: "我们吃了两盘炒饭。",
      received_at: "2026-08-11T12:00:00.000+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-nutrition-application-001",
      source_message_id: "message-nutrition-application-001",
      conversation_id: "conversation-nutrition-application-001",
      prior_context: [],
    });
    expect(outcome.committed, JSON.stringify(outcome)).toBe(true);
    expect(outcome).toMatchObject({
      committed: true,
      nutrition_items: [{
        adopted_amount: null,
        adopted_unit: null,
        source_label: "public_reference",
      }],
    });
    expect(assertDietManagerOutcome(outcome)).toBe(outcome);
    expect(Object.isFrozen(outcome.receipt?.items[0]?.nutrition)).toBe(true);
    const stored = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const itemPayload = JSON.parse((stored.database.prepare(
        "SELECT payload_json FROM meal_items WHERE event_id = ?",
      ).get(outcome.record_id) as { payload_json: string }).payload_json) as Record<string, unknown>;
      expect(itemPayload).toMatchObject({
        nutrition_evidence: {
          source_ref: "fdc:rice-001",
          coverage_status: "partial",
        },
      });
      expect(stored.database.prepare(
        "SELECT count(*) AS count FROM nutrition_profiles WHERE schema_version = '1.1.0'",
      ).get()).toEqual({ count: 1 });
      expect(stored.database.prepare(
        "SELECT count(*) AS count FROM nutrition_snapshots WHERE schema_version = '1.1.0'",
      ).get()).toEqual({ count: 1 });
    } finally {
      stored.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});

it("stores unknown nutrition when no allowlisted source is configured", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-nutrition-default-${randomUUID()}-`));
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-11T04:00:01.000Z",
  });
  try {
    const outcome = await handleCoreRequestAsync(runtime, {
      action: "record_meal",
      source_text: "喝了250ml牛奶。",
      received_at: "2026-08-11T12:00:00.000+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-nutrition-default-001",
      source_message_id: "message-nutrition-default-001",
      conversation_id: "conversation-nutrition-default-001",
      prior_context: [],
    });
    expect(outcome.committed, JSON.stringify(outcome)).toBe(true);
    expect(outcome).toMatchObject({
      receipt: {
        raw_text: "喝了250ml牛奶。",
        items: [{
          name: "milk",
          quantity: 250,
          unit: "ml",
          derived: false,
          nutrition: { status: "unknown", source: "unknown" },
          inventory: {
            status: "skipped_insufficient",
            deducted_quantity: 0,
            deducted_unit: null,
            shortage_quantity: 250,
            message: "未匹配有效库存",
          },
        }],
      },
      nutrition_items: [{
        name: "milk",
        adopted_amount: null,
        adopted_unit: null,
        amount_range: null,
        quantity_evidence: "unknown",
        source_label: "unknown",
        coverage_status: "unknown",
      }],
    });
    const stored = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const row = stored.database.prepare(
        "SELECT source_ref, payload_json FROM nutrition_snapshots WHERE schema_version = 'domain/v2'",
      ).get() as { source_ref: string; payload_json: string };
      expect(row.source_ref).toBe("unknown");
      expect(JSON.parse(row.payload_json)).toMatchObject({
        nutrients: { energy_kcal_milli: null, protein_mg: null },
        source_nutrients: { energy_kcal_milli: null, protein_mg: null },
      });
    } finally {
      stored.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});

it("resolves the offline core food table and adopts compatible gram amounts", async () => {
  const adapters = createBuiltinNutritionAdapters();
  const adapter = adapters.find((candidate) => candidate.describe().source_id === "local.generic_estimate")!;
  const commonDish = adapters.find(
    (candidate) => candidate.describe().source_id === "local.versioned_common_dish_template",
  );
  expect(commonDish).toBeDefined();
  const controller = new AbortController();
  const context = Object.freeze({
    signal: controller.signal,
    deadline_at: "2026-08-14T12:00:02.000Z",
    now: () => "2026-08-14T12:00:00.000Z",
    credential: () => undefined,
  });
  for (const [normalizedName, amount] of [["rice", 200], ["chicken", 150]] as const) {
    const resolution = await adapter.resolve(Object.freeze({
      normalized_food_name: normalizedName,
      brand: null,
      variant: null,
      package_specification: null,
      processing_state: null,
      minimum_food_category: "food",
      locale: "zh-CN" as const,
    }), context);
    expect(resolution.status).toBe("partial");
    expect(resolution.evidence).not.toBeNull();
    const adopted = adoptNutritionAmount({
      normalized_name: normalizedName, quantity: amount, unit: "g", estimated: false,
    }, resolution.evidence!);
    expect(adopted).toMatchObject({
      source_type: "generic_estimate",
      basis_kind: "per_100g",
      adopted_amount: String(amount),
      adopted_unit: "g",
    });
  }
  const rice = await adapter.resolve(Object.freeze({
    normalized_food_name: "rice", brand: null, variant: null, package_specification: null,
    processing_state: null, minimum_food_category: "food", locale: "zh-CN" as const,
  }), context);
  expect(adoptNutritionAmount({
    normalized_name: "rice", quantity: 0.5, unit: "bowl", estimated: true,
  }, rice.evidence!)).toMatchObject({
    adopted_amount: "150",
    adopted_unit: "g",
      amount_range: { min: "100", max: "150", adopted: "150", rule_version: "portion-rice-bowl-v1" },
    });
  const beefNoodle = await commonDish!.resolve(Object.freeze({
    normalized_food_name: "beef_noodle", brand: null, variant: null, package_specification: null,
    processing_state: null, minimum_food_category: "food", locale: "zh-CN" as const,
  }), context);
  expect(beefNoodle.status).toBe("partial");
  expect(adoptNutritionAmount({
    normalized_name: "beef_noodle", quantity: 1, unit: "bowl", estimated: true,
  }, beefNoodle.evidence!)).toMatchObject({
    source_type: "generic_template",
    adopted_amount: "1",
    adopted_unit: "serving",
    amount_range: { min: "1", max: "1", adopted: "1", rule_version: "common-dish-serving-v1" },
  });
});

it("keeps terminal unknown nutrition amount-free for an explicit bowl", () => {
  const unknown = unknownNutritionEvidence();
  expect(adoptNutritionAmount({
    normalized_name: "rice",
    quantity: 1,
    unit: "bowl",
    estimated: false,
  }, unknown)).toBe(unknown);
});
