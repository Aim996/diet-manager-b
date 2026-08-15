import { describe, expect, it } from "vitest";

import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import { FoodDataCentralAdapter } from "../../src/nutrition/adapters/fooddata-central.js";
import { FoodDataCentralHttpTransport } from "../../src/nutrition/adapters/fooddata-central-http.js";
import { resolveNutrition } from "../../src/nutrition/source-client.js";
import type {
  NutritionSourceAdapter,
  ResolvedNutritionEvidence,
  SourceCapability,
  SourceContext,
  SourceRequest,
  SourceResolution,
} from "../../src/nutrition/types.js";

const request: SourceRequest = Object.freeze({
  normalized_food_name: "milk",
  brand: "example",
  variant: "whole",
  package_specification: "250ml",
  processing_state: "ready_to_drink",
  minimum_food_category: "dairy",
  locale: "zh-CN",
});

function evidence(sourceId: string): ResolvedNutritionEvidence {
  return {
    source_id: sourceId,
    source_type: "authoritative_public_database",
    source_ref: `${sourceId}:record-1`,
    source_version: "2026.08",
    basis_kind: "per_100ml",
    basis_amount: "100",
    basis_unit: "ml",
    nutrient_values: {
      energy_kcal: "65", protein_g: "3.2", fat_g: "3.6", carbohydrate_g: "4.8",
      fiber_g: "0", energy_kj: "272", sodium_mg: "50", sugar_g: null,
      saturated_fat_g: null, water_ml: "87",
    },
    field_evidence: [],
    coverage_status: "complete",
    adopted_amount: "250",
    adopted_unit: "ml",
    amount_range: null,
    formula: "profile_value * 250 / 100",
  };
}

function adapter(
  capability: SourceCapability,
  calls: string[],
  result: SourceResolution | ((context: SourceContext) => Promise<SourceResolution>),
): NutritionSourceAdapter {
  return {
    describe: () => capability,
    probe: async () => ({ source_id: capability.source_id, status: "ok", reason: null }),
    resolve: async (_request, context) => {
      calls.push(capability.source_id);
      return typeof result === "function" ? result(context) : result;
    },
  };
}

const capability = (source_id: string, rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): SourceCapability => ({
  source_id,
  tier: source_id === "local.current_exact_label" ? "current_exact_label"
    : source_id === "public.usda_fooddata_central" ? "authoritative_public_database"
      : source_id === "local.personal_template" ? "versioned_common_dish_template"
        : "generic_estimate",
  rank,
  backend_id: source_id,
  backend_version: "v1",
  network: rank === 2,
  request_fields: ["normalized_food_name"],
});

describe("nutrition source authority", () => {
  it("maps the fixed USDA FDC HTTPS response without exposing its credential", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const transport = new FoodDataCentralHttpTransport(async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({
        foods: [{
          fdcId: 12345,
          description: "Milk, whole",
          dataType: "Foundation",
          publicationDate: "2026-04-01",
          foodNutrients: [
            { nutrientId: 1008, unitName: "kcal", value: 61 },
            { nutrientId: 1003, unitName: "g", value: 3.15 },
            { nutrientId: 1004, unitName: "g", value: 3.25 },
            { nutrientId: 1005, unitName: "g", value: 4.8 },
            { nutrientId: 1079, unitName: "g", value: 0 },
          ],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const resolved = await resolveNutrition(request, {
      signal: new AbortController().signal,
      deadline_at: new Date(Date.now() + 5_000).toISOString(),
      now: () => new Date().toISOString(),
      credential: (reference) => reference === "env:FDC_API_KEY"
        ? Object.freeze({ value: new TextEncoder().encode("test-key-123") })
        : undefined,
    }, {
      config: cloneNutritionRuntimeConfig({
        policy_version: "2026-08-14.1",
        sources: [{
          source_id: "public.usda_fooddata_central",
          enabled: true,
          backend_id: "fooddata-central",
          backend_version: "api-v1",
        }],
        credential_refs: { "public.usda_fooddata_central": "env:FDC_API_KEY" },
      }),
      adapters: [new FoodDataCentralAdapter(transport, "env:FDC_API_KEY")],
    });

    expect(resolved).toMatchObject({
      source_id: "public.usda_fooddata_central",
      source_type: "authoritative_public_database",
      source_ref: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/12345/nutrients",
      source_version: "2026-04-01",
      basis_kind: "per_100g",
      nutrient_values: {
        energy_kcal: "61",
        protein_g: "3.15",
        fat_g: "3.25",
        carbohydrate_g: "4.8",
        fiber_g: "0",
      },
      coverage_status: "complete",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.nal.usda.gov/fdc/v1/foods/search");
    expect(calls[0]?.url).not.toContain("test-key-123");
    expect(String(calls[0]?.init.body)).not.toContain("test-key-123");
    expect(new Headers(calls[0]?.init.headers).get("X-Api-Key")).toBe("test-key-123");
    expect(Object.isFrozen(resolved.nutrient_values)).toBe(true);
  });

  it("rejects a generic numeric source before calling its adapter", async () => {
    const calls: string[] = [];
    const sourceId = "local.generic_estimate";
    const context: SourceContext = {
      signal: new AbortController().signal,
      deadline_at: new Date(Date.now() + 5_000).toISOString(),
      now: () => new Date().toISOString(),
      credential: () => undefined,
    };
    await expect(resolveNutrition(request, context, {
      adapters: [adapter(capability(sourceId, 7), calls, {
        status: "ok", source_id: sourceId, tier: "generic_estimate",
        source_record_id: "record-1", source_version: "v1", retained_fields_sha256: "A".repeat(64),
        evidence: { ...evidence(sourceId), source_type: "generic_estimate" }, reason: null,
      })],
    })).rejects.toThrow("NUTRITION_SOURCE_NOT_ALLOWED:local.generic_estimate");
    expect(calls).toEqual([]);
  });

  it("clones hostile config trap-free and hashes no credential reference", () => {
    let traps = 0;
    const hostile = new Proxy({}, { get: () => { traps += 1; throw new Error("trap"); } });
    expect(() => cloneNutritionRuntimeConfig(hostile)).toThrow("NUTRITION_CONFIG_INVALID:proxy");
    expect(traps).toBe(0);

    const first = cloneNutritionRuntimeConfig({
      policy_version: "2026-08-09.1",
      resolution_deadline_ms: 2000,
      sources: [
        { source_id: "public.usda_fooddata_central", enabled: true, backend_id: "fdc", backend_version: "v1" },
      ],
      credential_refs: { "public.usda_fooddata_central": "private-ref-a" },
    });
    const second = cloneNutritionRuntimeConfig({
      policy_version: "2026-08-09.1",
      resolution_deadline_ms: 2000,
      sources: [
        { source_id: "public.usda_fooddata_central", enabled: true, backend_id: "fdc", backend_version: "v1" },
      ],
      credential_refs: { "public.usda_fooddata_central": "private-ref-b" },
    });
    expect(first.source_config_digest).toBe(second.source_config_digest);
    expect(Object.isFrozen(first.sources)).toBe(true);
  });

  it("traverses exact rank order and stops before lower-tier preemption", async () => {
    const calls: string[] = [];
    const noResult = (sourceId: string, tier: SourceCapability["tier"]): SourceResolution => ({
      status: "no_results", source_id: sourceId,
      tier,
      source_record_id: null, source_version: null, retained_fields_sha256: null,
      evidence: null, reason: "no_match",
    });
    const winnerId = "public.usda_fooddata_central";
    const winner: SourceResolution = {
      status: "ok", source_id: winnerId, tier: "authoritative_public_database",
      source_record_id: "record-1", source_version: "v1", retained_fields_sha256: "A".repeat(64),
      evidence: evidence(winnerId), reason: null,
    };
    const context: SourceContext = {
      signal: new AbortController().signal,
      deadline_at: new Date(Date.now() + 5_000).toISOString(),
      now: () => new Date().toISOString(),
      credential: () => undefined,
    };
    const resolved = await resolveNutrition(request, context, {
      adapters: [
        adapter(capability("local.personal_template", 6), calls,
          noResult("local.personal_template", "versioned_common_dish_template")),
        adapter(capability(winnerId, 4), calls, winner),
        adapter(capability("local.current_exact_label", 1), calls,
          noResult("local.current_exact_label", "current_exact_label")),
      ],
    });
    expect(calls).toEqual(["local.current_exact_label", winnerId]);
    expect(resolved.source_id).toBe(winnerId);
    expect(Object.isFrozen(resolved.nutrient_values)).toBe(true);
  });

  it("uses one aggregate AbortSignal and degrades timeout to unknown", async () => {
    const calls: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const hanging = adapter(capability("local.current_exact_label", 1), calls, async (context) => {
      observedSignal = context.signal;
      await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      return {
        status: "timeout", source_id: "local.current_exact_label", tier: "current_exact_label",
        source_record_id: null, source_version: null, retained_fields_sha256: null,
        evidence: null, reason: "source_unavailable",
      };
    });
    const context: SourceContext = {
      signal: new AbortController().signal,
      deadline_at: new Date(Date.now() + 25).toISOString(),
      now: () => new Date().toISOString(),
      credential: () => undefined,
    };
    const resolved = await resolveNutrition(request, context, { adapters: [hanging] });
    expect(observedSignal?.aborted).toBe(true);
    expect(resolved.source_type).toBe("unknown");
    expect(resolved.nutrient_values.energy_kcal).toBeNull();
  });
});
