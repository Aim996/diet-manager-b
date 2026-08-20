import { describe, expect, it } from "vitest";

import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import { createCommonDishTemplateAdapters } from "../../src/nutrition/builtin.js";
import { OfflineUsdaAdapter } from "../../src/nutrition/offline-usda.js";
import { resolveNutrition } from "../../src/nutrition/source-client.js";
import { adoptNutritionAmount } from "../../src/nutrition/nutrition-service.js";
import type { SourceContext, SourceRequest } from "../../src/nutrition/types.js";

// DEC-032：离线权威数据集无条件接通，网络/代理/key 一律不参与解析链。

const LEXICON = [
  "chicken", "soy_milk", "fried_rice", "banana", "bread", "coffee",
  "apple", "milk", "egg", "rice", "soup", "tea",
] as const;

const AUTHORITATIVE = new Set([
  "milk", "egg", "apple", "banana", "bread", "rice", "chicken", "coffee", "tea", "soy_milk",
]);

const TEMPLATE = new Set(["fried_rice", "soup"]);

function request(normalizedName: string, kind: "food" | "nutritious_drink"): SourceRequest {
  return Object.freeze({
    normalized_food_name: normalizedName,
    brand: null,
    variant: null,
    package_specification: null,
    processing_state: null,
    minimum_food_category: kind === "nutritious_drink" ? "processed_beverage" : "food",
    locale: "zh-CN" as const,
  });
}

function context(): SourceContext {
  return Object.freeze({
    signal: new AbortController().signal,
    deadline_at: new Date(Date.now() + 5_000).toISOString(),
    now: () => new Date().toISOString(),
    credential: () => undefined,
  });
}

describe("offline nutrition authority (DEC-032)", () => {
  it("resolves milk to the bundled USDA FDC record with no key and no network", async () => {
    const resolved = await resolveNutrition(request("milk", "nutritious_drink"), context(), {
      adapters: [new OfflineUsdaAdapter()],
    });
    expect(resolved).toMatchObject({
      source_id: "public.usda_fooddata_central_bundled",
      source_type: "authoritative_public_database",
      source_ref: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/171265/nutrients",
      source_version: "2019-04-01",
      basis_kind: "per_100g",
      basis_amount: "100",
      basis_unit: "g",
      nutrient_values: {
        energy_kcal: "61",
        protein_g: "3.15",
        fat_g: "3.25",
        carbohydrate_g: "4.8",
        fiber_g: "0",
      },
      coverage_status: "complete",
    });
    expect(Object.isFrozen(resolved.nutrient_values)).toBe(true);
  });

  it("resolves every closed-lexicon item without network, key, or config", async () => {
    const adapters = [new OfflineUsdaAdapter(), ...createCommonDishTemplateAdapters()];
    for (const name of LEXICON) {
      const kind = ["milk", "soy_milk", "coffee", "tea", "soup"].includes(name)
        ? "nutritious_drink" as const
        : "food" as const;
      const resolved = await resolveNutrition(request(name, kind), context(), { adapters });
      expect(resolved.source_type, name).not.toBe("unknown");
      if (AUTHORITATIVE.has(name)) {
        expect(resolved.source_id, name).toBe("public.usda_fooddata_central_bundled");
        expect(resolved.source_type, name).toBe("authoritative_public_database");
      } else if (TEMPLATE.has(name)) {
        expect(resolved.source_id, name).toBe("local.versioned_common_dish_template");
        expect(resolved.source_type, name).toBe("generic_template");
      }
    }
  });

  it("uses the lexicon key `chicken` (not `chicken_breast`) for the bundled record", async () => {
    const resolved = await resolveNutrition(request("chicken", "food"), context(), {
      adapters: [new OfflineUsdaAdapter()],
    });
    expect(resolved).toMatchObject({
      source_type: "authoritative_public_database",
      nutrient_values: { energy_kcal: "165", protein_g: "31" },
    });
  });

  it("adopts gram amounts for a per-100g bundled record", async () => {
    const adapter = new OfflineUsdaAdapter();
    const rice = await adapter.resolve(request("rice", "food"), context());
    const adopted = adoptNutritionAmount({
      normalized_name: "rice", quantity: 200, unit: "g", estimated: false,
    }, rice.evidence!);
    expect(adopted).toMatchObject({
      source_id: "public.usda_fooddata_central_bundled",
      adopted_amount: "200",
      adopted_unit: "g",
    });
  });

  it("keeps network FDC optional: empty source config still resolves offline", async () => {
    const adapters = [new OfflineUsdaAdapter(), ...createCommonDishTemplateAdapters()];
    const config = cloneNutritionRuntimeConfig({
      policy_version: "2026-08-14.1",
      sources: [],
    });
    const resolved = await resolveNutrition(request("milk", "nutritious_drink"), context(), {
      adapters,
      config,
    });
    expect(resolved.source_id).toBe("public.usda_fooddata_central_bundled");
    expect(resolved.source_type).toBe("authoritative_public_database");
  });
});
