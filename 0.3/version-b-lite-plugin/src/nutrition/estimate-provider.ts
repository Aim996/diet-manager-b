import { canonicalSha256 } from "../authority/canonical-json.js";
import { LocalEvidenceAdapter } from "./adapters/local-evidence.js";
import {
  freezeNutritionData,
  type NutritionSourceAdapter,
  type ResolvedNutritionEvidence,
  type SourceRequest,
  type SourceResolution,
} from "./types.js";

const ESTIMATE_VERSION = "diet-manager/explicit-estimate/2026-08-21.1";

const MULTIGRAIN_CONGEE: ResolvedNutritionEvidence["nutrient_values"] = freezeNutritionData({
  energy_kcal: "72", protein_g: "2.4", fat_g: "0.8", carbohydrate_g: "14.5", fiber_g: "1.3",
  energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
});

function resolveEstimate(request: Readonly<SourceRequest>): Readonly<SourceResolution> {
  if (request.normalized_food_name !== "multigrain_congee") return freezeNutritionData({
    status: "no_results",
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    source_record_id: null,
    source_version: ESTIMATE_VERSION,
    retained_fields_sha256: null,
    evidence: null,
    reason: "no_explicit_estimate",
  });
  const evidence: ResolvedNutritionEvidence = {
    source_id: "local.generic_estimate",
    source_type: "generic_estimate",
    source_ref: "diet-manager/estimate/multigrain-congee/per-100g/v1",
    source_version: ESTIMATE_VERSION,
    basis_kind: "per_100g",
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: MULTIGRAIN_CONGEE,
    field_evidence: [{
      evidence_kind: "explicit_bounded_food_estimate",
      estimate_name: "multigrain_congee",
      rule_version: ESTIMATE_VERSION,
    }],
    coverage_status: "partial",
    adopted_amount: null,
    adopted_unit: null,
    amount_range: null,
    formula: "estimated_profile_value * consumed_amount / basis_amount",
  };
  return freezeNutritionData({
    status: "partial",
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    source_record_id: evidence.source_ref,
    source_version: ESTIMATE_VERSION,
    retained_fields_sha256: canonicalSha256(evidence),
    evidence,
    reason: null,
  });
}

export function createEstimateProvider(): NutritionSourceAdapter {
  return new LocalEvidenceAdapter({
    source_id: "local.generic_estimate",
    tier: "generic_estimate",
    backend_id: "diet-manager-explicit-estimate",
    backend_version: ESTIMATE_VERSION,
    request_fields: Object.freeze(["normalized_food_name"]),
    resolve: resolveEstimate,
  });
}
