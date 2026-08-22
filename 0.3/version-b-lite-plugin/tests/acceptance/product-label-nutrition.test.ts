import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequestAsync } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import {
  saveProductLabel,
  type SaveProductLabelInput,
} from "../../src/nutrition/product-label-service.js";
import type { SemanticMealCandidateV1 } from "../../src/semantic/candidate.js";
import { openDietDatabase } from "../../src/storage/database.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";

const roots = new Set<string>();

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-manager-product-label-"));
  roots.add(value);
  return value;
}

afterEach(() => {
  for (const value of [...roots]) {
    roots.delete(value);
    rmSync(value, { recursive: true, force: false });
  }
});

function candidate(): SemanticMealCandidateV1 {
  return {
    schema_version: "diet-manager/semantic-candidate/v1",
    intent: "record_meal",
    source_text: "刚吃了半盒小象饼干",
    subject: { kind: "self", basis: "private_agent_default", evidence_span: null, explicit_other_spans: [] },
    items: [{
      raw_name: "小象饼干",
      normalized_hint: "little_elephant_biscuit",
      amount: { kind: "exact", value: 0.5, unit: "carton", evidence_span: "半盒小象饼干" },
    }],
    time: { kind: "unspecified", evidence_span: null },
  };
}

function labelInput(overrides: Partial<SaveProductLabelInput> = {}): SaveProductLabelInput {
  return {
    product_id: "product-little-elephant-biscuit-100g",
    normalized_name: "little_elephant_biscuit",
    brand: "little-elephant",
    variant: "original",
    package_unit: "carton",
    package_content_amount: "100",
    package_content_unit: "g",
    basis_kind: "per_100g",
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "480", protein_g: "6", fat_g: "20", carbohydrate_g: "68", fiber_g: "3",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
    source_ref: "user-label:little-elephant-biscuit:front-photo",
    source_version: "label-v1",
    evidence_reference: "private-image:label-001",
    confirmed_at: "2026-08-21T06:00:00.000Z",
    ...overrides,
  };
}

describe("local product nutrition labels", () => {
  it("reopens the database and uses the exact product version for half a package before common food", async () => {
    const dataRoot = root();
    const stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      saveProductLabel(stored.database, labelInput());
    } finally {
      stored.close();
    }

    let commonCalls = 0;
    const commonFallback: NutritionSourceAdapter = {
      describe: () => ({
        source_id: "local.versioned_common_dish_template",
        tier: "versioned_common_dish_template",
        rank: 6,
        backend_id: "test-common-biscuit",
        backend_version: "v1",
        network: false,
        request_fields: ["normalized_food_name"],
      }),
      probe: async () => ({ source_id: "local.versioned_common_dish_template", status: "ok", reason: null }),
      resolve: async () => {
        commonCalls += 1;
        return {
          status: "no_results", source_id: "local.versioned_common_dish_template",
          tier: "versioned_common_dish_template", source_record_id: null, source_version: "v1",
          retained_fields_sha256: null, evidence: null, reason: "no_match",
        };
      },
    };
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T06:05:01.000Z",
      nutritionAdapters: [commonFallback],
    });
    try {
      const outcome = await handleCoreRequestAsync(runtime, {
        action: "record_meal",
        source_text: "刚吃了半盒小象饼干",
        received_at: "2026-08-21T14:05:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "operation-product-label-half-carton",
        source_message_id: "message-product-label-half-carton",
        conversation_id: "conversation-product-label-new-session",
        prior_context: [],
        semantic_candidate: candidate(),
      });
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{
          name: "little_elephant_biscuit",
          adopted_amount: "50",
          adopted_unit: "g",
          source_label: "explicit",
        }],
      });
      expect(commonCalls).toBe(0);
    } finally {
      runtime.close();
    }

    const verified = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      expect(verified.database.prepare(
        "SELECT COUNT(*) AS count FROM nutrition_profiles WHERE source_type = 'product_label'",
      ).get()).toEqual({ count: 3 });
      expect(verified.database.prepare(
        "SELECT DISTINCT subject_type, subject_id FROM nutrition_profiles WHERE source_type = 'product_label'",
      ).all()).toEqual([{
        subject_type: "product",
        subject_id: "product-little-elephant-biscuit-100g",
      }]);
      expect(verified.database.prepare(
        "SELECT source_ref FROM nutrition_snapshots WHERE source_type = 'product_label'",
      ).get()).toEqual({ source_ref: "user-label:little-elephant-biscuit:front-photo" });
      const item = verified.database.prepare(
        "SELECT payload_json FROM meal_items WHERE normalized_name = 'little_elephant_biscuit'",
      ).get() as { payload_json: string };
      expect(JSON.parse(item.payload_json)).toMatchObject({
        nutrition_sources: [{
          source_type: "product_label",
          applicable_product_id: "product-little-elephant-biscuit-100g",
        }],
      });
    } finally {
      verified.close();
    }
  });

  it("fails closed to lower stages when two product identities share the same visible name", async () => {
    const dataRoot = root();
    const stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      saveProductLabel(stored.database, labelInput());
      saveProductLabel(stored.database, labelInput({
        product_id: "product-other-elephant-biscuit-100g",
        brand: "other-elephant",
        source_ref: "user-label:other-elephant-biscuit:front-photo",
        source_version: "other-label-v1",
        evidence_reference: "private-image:label-002",
        confirmed_at: "2026-08-21T06:01:00.000Z",
      }));
    } finally {
      stored.close();
    }
    let commonCalls = 0;
    const commonFallback: NutritionSourceAdapter = {
      describe: () => ({
        source_id: "local.versioned_common_dish_template",
        tier: "versioned_common_dish_template",
        rank: 6,
        backend_id: "test-common-biscuit",
        backend_version: "v1",
        network: false,
        request_fields: ["normalized_food_name"],
      }),
      probe: async () => ({ source_id: "local.versioned_common_dish_template", status: "ok", reason: null }),
      resolve: async () => {
        commonCalls += 1;
        return {
          status: "no_results", source_id: "local.versioned_common_dish_template",
          tier: "versioned_common_dish_template", source_record_id: null, source_version: "v1",
          retained_fields_sha256: null, evidence: null, reason: "no_match",
        };
      },
    };
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T06:05:01.000Z",
      nutritionAdapters: [commonFallback],
    });
    try {
      const outcome = await handleCoreRequestAsync(runtime, {
        action: "record_meal",
        source_text: "刚吃了半盒小象饼干",
        received_at: "2026-08-21T14:05:00+08:00",
        timezone: "Asia/Shanghai",
        operation_id: "operation-product-label-ambiguous",
        source_message_id: "message-product-label-ambiguous",
        conversation_id: "conversation-product-label-ambiguous",
        prior_context: [],
        semantic_candidate: candidate(),
      });
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "unknown", adopted_amount: null }],
      });
      expect(commonCalls).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("uses a replacement label only for future meals while preserving the prior snapshot", async () => {
    const dataRoot = root();
    const recordMeal = async (operationId: string, now: string): Promise<void> => {
      const runtime = createCoreRuntime({ officialDataRoot: dataRoot, now: () => now });
      try {
        const outcome = await handleCoreRequestAsync(runtime, {
          action: "record_meal",
          source_text: "刚吃了半盒小象饼干",
          received_at: "2026-08-21T14:05:00+08:00",
          timezone: "Asia/Shanghai",
          operation_id: operationId,
          source_message_id: `message-${operationId}`,
          conversation_id: "conversation-product-label-versioning",
          prior_context: [],
          semantic_candidate: candidate(),
        });
        expect(outcome, JSON.stringify(outcome)).toMatchObject({ committed: true });
      } finally {
        runtime.close();
      }
    };

    let stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try { saveProductLabel(stored.database, labelInput()); } finally { stored.close(); }
    await recordMeal("operation-product-label-v1", "2026-08-21T06:05:01.000Z");

    stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      saveProductLabel(stored.database, labelInput({
        source_ref: "user-label:little-elephant-biscuit:back-photo",
        source_version: "label-v2",
        evidence_reference: "private-image:label-002",
        confirmed_at: "2026-08-21T06:10:00.000Z",
        nutrient_values: {
          ...labelInput().nutrient_values,
          energy_kcal: "500",
        },
      }));
    } finally {
      stored.close();
    }
    await recordMeal("operation-product-label-v2", "2026-08-21T06:15:01.000Z");

    const verified = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      expect(verified.database.prepare(
        "SELECT source_ref, COUNT(*) AS count FROM nutrition_snapshots GROUP BY source_ref ORDER BY MIN(created_at)",
      ).all()).toEqual([
        { source_ref: "user-label:little-elephant-biscuit:front-photo", count: 2 },
        { source_ref: "user-label:little-elephant-biscuit:back-photo", count: 2 },
      ]);
      expect(verified.database.prepare(
        "SELECT DISTINCT subject_id FROM nutrition_profiles WHERE source_type = 'product_label'",
      ).all()).toEqual([{ subject_id: "product-little-elephant-biscuit-100g" }]);
    } finally {
      verified.close();
    }
  });
});
