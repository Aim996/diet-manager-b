import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequestAsync } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { assertDietManagerOutcome } from "../../src/contracts.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import { listNutritionSearchAudit } from "../../src/repository/nutrition-search-audit-repository.js";
import type {
  NutritionSourceAdapter,
  ResolvedNutritionEvidence,
  SourceResolution,
} from "../../src/nutrition/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const roots = new Set<string>();

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-manager-web-fallback-"));
  roots.add(value);
  return value;
}

afterEach(() => {
  for (const value of [...roots]) {
    roots.delete(value);
    rmSync(value, { recursive: true, force: false });
  }
});

const config = cloneNutritionRuntimeConfig({
  policy_version: "diet-manager/nutrition-source-policy/v1",
  resolution_deadline_ms: 500,
  sources: [{
    source_id: "trusted.traceable_web",
    enabled: true,
    backend_id: "test-traceable-web",
    backend_version: "v1",
  }],
});

function semanticRequest(name: string, sourceText: string, operation: string, amount = 100, unit = "g") {
  const rawNames: Readonly<Record<string, string>> = {
    traceable_snack: "可追溯点心",
    multigrain_congee: "杂粮粥",
    unsupported_mystery_food: "未知混合物",
  };
  const semanticProposal = {
    kind: "meal" as const,
    subject: { kind: "self", basis: "private_agent_default", evidence_span: null, explicit_other_spans: [] },
    occurrence: "completed" as const,
    meal_slot: "unknown" as const,
    items: [{
      raw_name: rawNames[name]!,
      normalized_hint: name,
      amount: { kind: "exact", value: amount, unit, evidence_span: `${amount}${unit}${rawNames[name]!}` },
    }],
    occurred_at: { kind: "unspecified" as const, evidence_span: null },
  };
  return {
    action: "record_meal" as const,
    source_text: sourceText,
    received_at: "2026-08-21T15:00:00+08:00" as const,
    timezone: "Asia/Shanghai" as const,
    operation_id: operation,
    source_message_id: `message-${operation}`,
    conversation_id: "conversation-web-fallback",
    prior_context: [],
    semantic_proposal: semanticProposal,
  };
}

function evidence(version = "web-v1"): ResolvedNutritionEvidence {
  return {
    source_id: "trusted.traceable_web",
    source_type: "trusted_public_web",
    source_ref: "https://nutrition.example.test/foods/traceable-snack",
    source_version: version,
    basis_kind: "per_100g",
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "320", protein_g: "8", fat_g: "12", carbohydrate_g: "45", fiber_g: "4",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
    field_evidence: [{ evidence_kind: "traceable_web_match", match_basis: "normalized_name" }],
    coverage_status: "partial",
    adopted_amount: null,
    adopted_unit: null,
    amount_range: null,
    formula: "profile_value * consumed_amount / basis_amount",
  };
}

function webAdapter(
  calls: { value: number },
  cacheDecision: "cache_allowed" | "cache_forbidden",
  fail = false,
  auditOverride: Readonly<{
    confidence_microunits?: number;
    match_basis?: string;
  }> = {},
): NutritionSourceAdapter {
  return {
    describe: () => ({
      source_id: "trusted.traceable_web",
      tier: "allowlisted_trusted_internet",
      rank: 5,
      backend_id: "test-traceable-web",
      backend_version: "v1",
      network: true,
      request_fields: ["normalized_food_name"],
    }),
    probe: async () => ({ source_id: "trusted.traceable_web", status: "ok", reason: null }),
    resolve: async (_request, context): Promise<SourceResolution> => {
      calls.value += 1;
      if (fail) throw new Error("provider timeout");
      const resolvedEvidence = evidence(`web-v${calls.value}`);
      return {
        status: "partial",
        source_id: "trusted.traceable_web",
        tier: "allowlisted_trusted_internet",
        source_record_id: `web-record-${calls.value}`,
        source_version: resolvedEvidence.source_version,
        retained_fields_sha256: "A".repeat(64),
        evidence: resolvedEvidence,
        reason: null,
        audit: {
          source_name: "Nutrition Example",
          source_url: resolvedEvidence.source_ref,
          retrieved_at: context.now(),
          match_basis: auditOverride.match_basis ?? "normalized_name_exact",
          confidence_microunits: auditOverride.confidence_microunits ?? 920_000,
          license_decision: "redistribution_allowed",
          cache_decision: cacheDecision,
        },
      };
    },
  };
}

describe("auditable nutrition web fallback", () => {
  it("audits an allowed web result and reuses it in a new runtime without another provider call", async () => {
    const dataRoot = root();
    const firstCalls = { value: 0 };
    const first = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:00:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [webAdapter(firstCalls, "cache_allowed")],
    });
    try {
      const outcome = await handleCoreRequestAsync(first, semanticRequest(
        "traceable_snack", "吃了100g可追溯点心", "operation-web-first",
      ));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "public_reference", adopted_amount: "100", adopted_unit: "g" }],
      });
      expect(firstCalls.value).toBe(1);
    } finally {
      first.close();
    }

    const secondCalls = { value: 0 };
    const second = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:05:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [webAdapter(secondCalls, "cache_allowed", true)],
    });
    try {
      const outcome = await handleCoreRequestAsync(second, semanticRequest(
        "traceable_snack", "又吃了100g可追溯点心", "operation-web-reuse",
      ));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "public_reference" }],
      });
      expect(secondCalls.value).toBe(0);
    } finally {
      second.close();
    }

    const stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      expect(listNutritionSearchAudit(stored.database, "traceable_snack")).toMatchObject([{
        source_name: "Nutrition Example",
        source_ref: "https://nutrition.example.test/foods/traceable-snack",
        match_basis: "normalized_name_exact",
        confidence_microunits: 920_000,
        license_decision: "redistribution_allowed",
        cache_decision: "cache_allowed",
        payload: { original_query: "吃了100g可追溯点心" },
      }]);
    } finally {
      stored.close();
    }
  });

  it("does not reuse cache-forbidden results and never promotes them into the common library", async () => {
    const dataRoot = root();
    const calls = { value: 0 };
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:10:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [webAdapter(calls, "cache_forbidden")],
    });
    try {
      await handleCoreRequestAsync(runtime, semanticRequest(
        "traceable_snack", "吃了100g可追溯点心", "operation-web-no-cache-a",
      ));
      await handleCoreRequestAsync(runtime, semanticRequest(
        "traceable_snack", "再吃100g可追溯点心", "operation-web-no-cache-b",
      ));
      expect(calls.value).toBe(2);
    } finally {
      runtime.close();
    }
    const stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      expect(stored.database.prepare(
        "SELECT COUNT(*) AS count FROM nutrition_profiles WHERE source_type = 'generic_template'",
      ).get()).toEqual({ count: 0 });
      expect(listNutritionSearchAudit(stored.database, "traceable_snack")).toHaveLength(2);
    } finally {
      stored.close();
    }
  });

  it.each([
    ["low confidence", { confidence_microunits: 799_999 }, "estimate"],
    ["conflicting sources", { match_basis: "conflicting_sources" }, "unknown"],
  ] as const)("audits but does not reuse %s web results", async (_label, auditOverride, expectedSource) => {
    const dataRoot = root();
    const calls = { value: 0 };
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:15:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [webAdapter(calls, "cache_allowed", false, auditOverride)],
    });
    try {
      const first = await handleCoreRequestAsync(runtime, semanticRequest(
        "traceable_snack", "吃了100g可追溯点心", `operation-web-${calls.value}-a`,
      ));
      const second = await handleCoreRequestAsync(runtime, semanticRequest(
        "traceable_snack", "再吃100g可追溯点心", `operation-web-${calls.value}-b`,
      ));
      expect(first, JSON.stringify(first)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: expectedSource }],
      });
      expect(second, JSON.stringify(second)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: expectedSource }],
      });
      expect(calls.value).toBe(2);
    } finally {
      runtime.close();
    }
    const stored = openDietDatabase({ privateRuntimeRoot: dataRoot });
    try {
      expect(listNutritionSearchAudit(stored.database, "traceable_snack")).toHaveLength(2);
    } finally {
      stored.close();
    }
  });

  it("tries a later exact web source before adopting an earlier low-confidence estimate", async () => {
    const dataRoot = root();
    const lowCalls = { value: 0 };
    const exactCalls = { value: 0 };
    const lowConfidence: NutritionSourceAdapter = {
      describe: () => ({
        source_id: "public.usda_fooddata_central",
        tier: "authoritative_public_database",
        rank: 4,
        backend_id: "test-low-confidence-web",
        backend_version: "v1",
        network: true,
        request_fields: ["normalized_food_name"],
      }),
      probe: async () => ({ source_id: "public.usda_fooddata_central", status: "ok", reason: null }),
      resolve: async (_request, context) => {
        lowCalls.value += 1;
        const lowEvidence: ResolvedNutritionEvidence = {
          ...evidence("low-web-v1"),
          source_id: "public.usda_fooddata_central",
          source_type: "authoritative_public_database",
          source_ref: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/999/nutrients",
        };
        return {
          status: "partial",
          source_id: "public.usda_fooddata_central",
          tier: "authoritative_public_database",
          source_record_id: "fdc:999",
          source_version: lowEvidence.source_version,
          retained_fields_sha256: "B".repeat(64),
          evidence: lowEvidence,
          reason: null,
          audit: {
            source_name: "USDA FoodData Central",
            source_url: lowEvidence.source_ref,
            retrieved_at: context.now(),
            match_basis: "provider_ranked_candidate",
            confidence_microunits: 650_000,
            license_decision: "redistribution_allowed",
            cache_decision: "cache_forbidden" as const,
          },
        };
      },
    };
    const twoWebSources = cloneNutritionRuntimeConfig({
      policy_version: "diet-manager/nutrition-source-policy/v1",
      resolution_deadline_ms: 500,
      sources: [
        {
          source_id: "public.usda_fooddata_central",
          enabled: true,
          backend_id: "test-low-confidence-web",
          backend_version: "v1",
        },
        {
          source_id: "trusted.traceable_web",
          enabled: true,
          backend_id: "test-traceable-web",
          backend_version: "v1",
        },
      ],
    });
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:18:01.000Z",
      nutritionConfig: twoWebSources,
      nutritionAdapters: [lowConfidence, webAdapter(exactCalls, "cache_allowed")],
    });
    try {
      const outcome = await handleCoreRequestAsync(runtime, semanticRequest(
        "traceable_snack", "吃了100g可追溯点心", "operation-web-later-exact",
      ));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "public_reference" }],
      });
      expect(lowCalls.value).toBe(1);
      expect(exactCalls.value).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("uses an explicit estimate for 250g multigrain congee but keeps unsupported foods unknown", async () => {
    const dataRoot = root();
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:20:01.000Z",
    });
    try {
      const estimated = await handleCoreRequestAsync(runtime, semanticRequest(
        "multigrain_congee", "吃了250g杂粮粥", "operation-estimate-congee", 250, "g",
      ));
      expect(estimated, JSON.stringify(estimated)).toMatchObject({
        committed: true,
        nutrition_items: [{
          source_label: "estimate",
          adopted_amount: "250",
          adopted_unit: "g",
          estimated_fields: ["energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g"],
        }],
        receipt: { items: [{ nutrition: { source: "estimate" } }] },
      });
      expect(assertDietManagerOutcome(estimated)).toBe(estimated);

      const unknown = await handleCoreRequestAsync(runtime, semanticRequest(
        "unsupported_mystery_food", "吃了100g未知混合物", "operation-estimate-unknown",
      ));
      expect(unknown, JSON.stringify(unknown)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "unknown", coverage_status: "unknown", adopted_amount: null }],
      });
    } finally {
      runtime.close();
    }
  });

  it("keeps the meal fact when the configured web provider throws", async () => {
    const dataRoot = root();
    const calls = { value: 0 };
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:30:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [webAdapter(calls, "cache_allowed", true)],
    });
    try {
      const outcome = await handleCoreRequestAsync(runtime, semanticRequest(
        "unsupported_mystery_food", "吃了100g未知混合物", "operation-web-failure",
      ));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "unknown", coverage_status: "unknown" }],
      });
      expect(calls.value).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("keeps the meal fact when a provider returns malformed success evidence", async () => {
    const dataRoot = root();
    const calls = { value: 0 };
    const malformed = webAdapter(calls, "cache_allowed");
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T07:35:01.000Z",
      nutritionConfig: config,
      nutritionAdapters: [{
        ...malformed,
        resolve: async (request, context) => {
          const resolution = await malformed.resolve(request, context);
          return {
            ...resolution,
            evidence: { ...resolution.evidence!, basis_amount: "not-a-decimal" },
          } as SourceResolution;
        },
      }],
    });
    try {
      const outcome = await handleCoreRequestAsync(runtime, semanticRequest(
        "unsupported_mystery_food", "吃了100g未知混合物", "operation-web-malformed",
      ));
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        committed: true,
        nutrition_items: [{ source_label: "unknown", coverage_status: "unknown" }],
      });
      expect(calls.value).toBe(1);
    } finally {
      runtime.close();
    }
  });
});
