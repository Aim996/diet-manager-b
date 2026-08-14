import { canonicalSha256 } from "../authority/canonical-json.js";
import { LocalEvidenceAdapter } from "./adapters/local-evidence.js";
import {
  freezeNutritionData,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
  type SourceRequest,
  type SourceResolution,
} from "./types.js";

const BUILTIN_VERSION = "2026-08-14.1";

const COMMON_FOODS: Readonly<Record<string, Readonly<{
  basis_kind: "per_100g" | "per_100ml";
  basis_unit: "g" | "ml";
  nutrient_values: Readonly<Record<string, string | null>>;
}>>> = freezeNutritionData({
  milk: {
    basis_kind: "per_100ml",
    basis_unit: "ml",
    nutrient_values: {
      energy_kcal: "64", protein_g: "3.2", fat_g: "3.2", carbohydrate_g: "4.8", fiber_g: null,
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
});

function resolveBuiltin(request: Readonly<SourceRequest>): Readonly<SourceResolution> {
  const entry = COMMON_FOODS[request.normalized_food_name];
  if (entry === undefined) return freezeNutritionData({
    status: "no_results",
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    source_record_id: null,
    source_version: BUILTIN_VERSION,
    retained_fields_sha256: null,
    evidence: null,
    reason: "no_match",
  });
  const evidence: Readonly<ResolvedNutritionEvidence> = freezeNutritionData({
    source_id: "local.generic_estimate",
    source_type: "generic_estimate",
    source_ref: `diet-manager/builtin-common-food/${request.normalized_food_name}/v1`,
    source_version: BUILTIN_VERSION,
    basis_kind: entry.basis_kind,
    basis_amount: "100",
    basis_unit: entry.basis_unit,
    nutrient_values: entry.nutrient_values,
    field_evidence: [{
      evidence_kind: "versioned_generic_estimate",
      rule_version: BUILTIN_VERSION,
    }],
    coverage_status: "partial",
    adopted_amount: null,
    adopted_unit: null,
    amount_range: null,
    formula: "profile_value * consumed_amount / basis_amount",
  });
  return freezeNutritionData({
    status: "partial",
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    source_record_id: evidence.source_ref,
    source_version: BUILTIN_VERSION,
    retained_fields_sha256: canonicalSha256(evidence),
    evidence,
    reason: null,
  });
}

export function createBuiltinNutritionAdapters(): readonly NutritionSourceAdapter[] {
  return Object.freeze([new LocalEvidenceAdapter({
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    backend_id: "diet-manager-builtin-nutrition",
    backend_version: BUILTIN_VERSION,
    request_fields: Object.freeze(["normalized_food_name"]),
    resolve: resolveBuiltin,
  })]);
}

