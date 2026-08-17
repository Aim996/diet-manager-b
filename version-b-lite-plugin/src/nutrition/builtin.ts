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
  rice: {
    basis_kind: "per_100g",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "116", protein_g: "2.6", fat_g: "0.3", carbohydrate_g: "25.9", fiber_g: "0.4",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
  chicken_breast: {
    basis_kind: "per_100g",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "165", protein_g: "31", fat_g: "3.6", carbohydrate_g: "0", fiber_g: "0",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
  egg: {
    basis_kind: "per_100g",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "143", protein_g: "12.6", fat_g: "9.5", carbohydrate_g: "0.7", fiber_g: "0",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
  apple: {
    basis_kind: "per_100g",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "52", protein_g: "0.3", fat_g: "0.2", carbohydrate_g: "13.8", fiber_g: "2.4",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
  orange: {
    basis_kind: "per_100g",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: "47", protein_g: "0.9", fat_g: "0.1", carbohydrate_g: "11.8", fiber_g: "2.4",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
  },
});

const COMMON_DISHES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = freezeNutritionData({
  fried_rice: {
    energy_kcal: "350", protein_g: "10", fat_g: "10", carbohydrate_g: "55", fiber_g: "2",
    energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
  },
  beef_noodle: {
    energy_kcal: "550", protein_g: "25", fat_g: "18", carbohydrate_g: "70", fiber_g: "4",
    energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
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

function resolveCommonDish(request: Readonly<SourceRequest>): Readonly<SourceResolution> {
  const nutrientValues = COMMON_DISHES[request.normalized_food_name];
  if (nutrientValues === undefined) return freezeNutritionData({
    status: "no_results",
    source_id: "local.versioned_common_dish_template",
    tier: "versioned_common_dish_template",
    source_record_id: null,
    source_version: BUILTIN_VERSION,
    retained_fields_sha256: null,
    evidence: null,
    reason: "no_match",
  });
  const evidence: Readonly<ResolvedNutritionEvidence> = freezeNutritionData({
    source_id: "local.versioned_common_dish_template",
    source_type: "generic_template",
    source_ref: `diet-manager/common-dish/${request.normalized_food_name}/v1`,
    source_version: BUILTIN_VERSION,
    basis_kind: "per_serving",
    basis_amount: "1",
    basis_unit: "serving",
    nutrient_values: nutrientValues,
    field_evidence: [{
      evidence_kind: "versioned_common_dish_template",
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
    source_id: "local.versioned_common_dish_template",
    tier: "versioned_common_dish_template",
    source_record_id: evidence.source_ref,
    source_version: BUILTIN_VERSION,
    retained_fields_sha256: canonicalSha256(evidence),
    evidence,
    reason: null,
  });
}

export interface BuiltinNutrientVector {
  readonly energy_kcal_milli: number | null;
  readonly protein_mg: number | null;
  readonly fat_mg: number | null;
  readonly carbohydrate_mg: number | null;
  readonly fiber_mg: number | null;
  readonly water_ml_milli: number | null;
}

/**
 * 同步解析 builtin 常见食物的营养向量（微单位）。COMMON_FOODS 全部按
 * per_100g/per_100ml 登记，故 basis 恒为 100：总微单位 = round(raw * amountMicrounits / 100)，
 * 其中 raw 为每 100 basis 单位的克/千卡值，amountMicrounits 为消耗量的微单位
 * （milli-ml / milli-g）。白水分类纠正需同步取得牛奶营养，故保持有界：未知名抛错。
 */
export function resolveBuiltinNutrientVector(
  normalizedName: string,
  amountMicrounits: number,
): BuiltinNutrientVector {
  const entry = COMMON_FOODS[normalizedName];
  if (entry === undefined) {
    throw new Error(`BUILTIN_NUTRITION_INVALID:unknown_food:${normalizedName}`);
  }
  if (!Number.isSafeInteger(amountMicrounits) || amountMicrounits < 0) {
    throw new Error("BUILTIN_NUTRITION_INVALID:amount");
  }
  const scaled = (
    field: "energy_kcal" | "protein_g" | "fat_g" | "carbohydrate_g" | "fiber_g" | "water_ml",
  ): number | null => {
    const raw = entry.nutrient_values[field];
    if (raw === null || raw === undefined) return null;
    return Math.round(Number(raw) * amountMicrounits / 100);
  };
  return Object.freeze({
    energy_kcal_milli: scaled("energy_kcal"),
    protein_mg: scaled("protein_g"),
    fat_mg: scaled("fat_g"),
    carbohydrate_mg: scaled("carbohydrate_g"),
    fiber_mg: scaled("fiber_g"),
    water_ml_milli: scaled("water_ml"),
  });
}

export function createBuiltinNutritionAdapters(): readonly NutritionSourceAdapter[] {
  return Object.freeze([
    new LocalEvidenceAdapter({
      source_id: "local.versioned_common_dish_template",
      tier: "versioned_common_dish_template",
      backend_id: "diet-manager-common-dish-template",
      backend_version: BUILTIN_VERSION,
      request_fields: Object.freeze(["normalized_food_name"]),
      resolve: resolveCommonDish,
    }),
    new LocalEvidenceAdapter({
      source_id: "local.generic_estimate",
      tier: "generic_estimate",
      backend_id: "diet-manager-builtin-nutrition",
      backend_version: BUILTIN_VERSION,
      request_fields: Object.freeze(["normalized_food_name"]),
      resolve: resolveBuiltin,
    }),
  ]);
}
