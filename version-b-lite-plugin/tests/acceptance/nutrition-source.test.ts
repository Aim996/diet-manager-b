import { describe, expect, it } from "vitest";

import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
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
  tier: rank === 1 ? "current_exact_label" : rank === 2 ? "manufacturer_or_exact_product" : "generic_estimate",
  rank,
  backend_id: source_id,
  backend_version: "v1",
  network: rank === 2,
  request_fields: ["normalized_food_name"],
});

describe("nutrition source authority", () => {
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
    const noResult = (sourceId: string, rank: 1 | 2): SourceResolution => ({
      status: "no_results", source_id: sourceId,
      tier: rank === 1 ? "current_exact_label" : "manufacturer_or_exact_product",
      source_record_id: null, source_version: null, retained_fields_sha256: null,
      evidence: null, reason: "no_match",
    });
    const winnerId = "conditional.manufacturer_exact";
    const winner: SourceResolution = {
      status: "ok", source_id: winnerId, tier: "manufacturer_or_exact_product",
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
        adapter(capability("local.generic_estimate", 7), calls, noResult("local.generic_estimate", 2)),
        adapter(capability(winnerId, 2), calls, winner),
        adapter(capability("local.current_exact_label", 1), calls, noResult("local.current_exact_label", 1)),
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
