import { expect, it } from "vitest";

import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import { runNutritionDoctor } from "../../src/nutrition/doctor.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";

it("reports every configured backend as frozen sanitized read-only data", async () => {
  const config = cloneNutritionRuntimeConfig({
    policy_version: "2026-08-09.1",
    resolution_deadline_ms: 500,
    sources: [
      { source_id: "public.usda_fooddata_central", enabled: true, backend_id: "fdc", backend_version: "v1" },
      { source_id: "public.china_cdc_phscience_food_composition", enabled: false, backend_id: "cdc", backend_version: "disabled" },
    ],
    credential_refs: { "public.usda_fooddata_central": "private-fdc-ref" },
  });
  const adapter: NutritionSourceAdapter = {
    describe: () => ({
      source_id: "public.usda_fooddata_central", tier: "authoritative_public_database", rank: 4,
      backend_id: "fdc", backend_version: "v1", network: true,
      request_fields: ["normalized_food_name"],
    }),
    probe: async () => ({ source_id: "public.usda_fooddata_central", status: "ok", reason: null }),
    resolve: async () => { throw new Error("Doctor must not resolve user data"); },
  };
  const result = await runNutritionDoctor(config, [adapter]);
  expect(result.sources.map((source) => [source.source_id, source.health])).toEqual([
    ["public.china_cdc_phscience_food_composition", "missing"],
    ["public.usda_fooddata_central", "ok"],
  ]);
  expect(JSON.stringify(result)).not.toContain("private-fdc-ref");
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.sources)).toBe(true);
  expect(Object.keys(result.sources[0]!).sort()).toEqual([
    "action", "backend_id", "backend_version", "health", "next_backend", "reason", "source_id", "tier",
  ]);
});
