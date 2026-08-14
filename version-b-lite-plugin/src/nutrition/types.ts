import { isProxy } from "node:util/types";

export type SourceTier =
  | "current_exact_label"
  | "manufacturer_or_exact_product"
  | "confirmed_same_product_history"
  | "authoritative_public_database"
  | "allowlisted_trusted_internet"
  | "versioned_common_dish_template"
  | "generic_estimate"
  | "unknown";

export type SourceRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SOURCE_TIER_RANK: Readonly<Record<SourceTier, SourceRank>> = Object.freeze({
  current_exact_label: 1,
  manufacturer_or_exact_product: 2,
  confirmed_same_product_history: 3,
  authoritative_public_database: 4,
  allowlisted_trusted_internet: 5,
  versioned_common_dish_template: 6,
  generic_estimate: 7,
  unknown: 8,
});

export const REGISTERED_SOURCE_TIERS: Readonly<Record<string, SourceTier>> = Object.freeze({
  "local.current_exact_label": "current_exact_label",
  "conditional.manufacturer_exact": "manufacturer_or_exact_product",
  "local.confirmed_same_product_history": "confirmed_same_product_history",
  "public.usda_fooddata_central": "authoritative_public_database",
  "public.china_cdc_phscience_food_composition": "authoritative_public_database",
  "trusted.open_food_facts_read_only": "allowlisted_trusted_internet",
  "local.personal_template": "versioned_common_dish_template",
  "local.versioned_common_dish_template": "versioned_common_dish_template",
  "local.generic_estimate": "generic_estimate",
  "terminal.unknown": "unknown",
});

export interface SourceCapability {
  readonly source_id: string;
  readonly tier: SourceTier;
  readonly rank: SourceRank;
  readonly backend_id: string;
  readonly backend_version: string;
  readonly network: boolean;
  readonly request_fields: readonly string[];
}

export interface SourceRequest {
  readonly normalized_food_name: string;
  readonly brand: string | null;
  readonly variant: string | null;
  readonly package_specification: string | null;
  readonly processing_state: string | null;
  readonly minimum_food_category: string | null;
  readonly locale: "zh-CN";
}

export interface SourceContext {
  readonly signal: AbortSignal;
  readonly deadline_at: string;
  readonly now: () => string;
  readonly credential: (reference: string) => Readonly<{ value: Uint8Array }> | undefined;
}

export interface SourceHealth {
  readonly source_id: string;
  readonly status: "missing" | "broken" | "timeout" | "error" | "ok";
  readonly reason: string | null;
}

export type SourceResolutionStatus =
  | "ok" | "no_results" | "partial" | "timeout" | "auth_failed"
  | "skipped_unconfigured" | "source_disabled" | "error";

export interface ResolvedNutritionEvidence {
  readonly source_id: string;
  readonly source_type: "product_label" | "confirmed_same_product_history" |
    "authoritative_public_database" | "trusted_public_web" | "personal_template" |
    "generic_template" | "generic_estimate" | "unknown";
  readonly source_ref: string;
  readonly source_version: string;
  readonly basis_kind: "per_100g" | "per_100ml" | "per_serving" | "per_item" |
    "per_package" | "custom_recipe";
  readonly basis_amount: string;
  readonly basis_unit: string;
  readonly nutrient_values: Readonly<Record<string, string | null>>;
  readonly field_evidence: readonly Readonly<Record<string, unknown>>[];
  readonly coverage_status: "complete" | "partial" | "unknown";
  readonly adopted_amount: string | null;
  readonly adopted_unit: string | null;
  readonly amount_range: Readonly<{
    readonly min: string;
    readonly max: string;
    readonly adopted: string;
    readonly unit: string;
    readonly rule_version: string;
  }> | null;
  readonly formula: string;
}

export interface SourceResolution {
  readonly status: SourceResolutionStatus;
  readonly source_id: string;
  readonly tier: SourceTier;
  readonly source_record_id: string | null;
  readonly source_version: string | null;
  readonly retained_fields_sha256: string | null;
  readonly evidence: Readonly<ResolvedNutritionEvidence> | null;
  readonly reason: string | null;
}

export interface SourceRuntimeEntry {
  readonly source_id: string;
  readonly enabled: boolean;
  readonly backend_id: string;
  readonly backend_version: string;
  readonly credential_ref: string | null;
}

export interface NutritionRuntimeConfig {
  readonly policy_version: string;
  readonly resolution_deadline_ms: number;
  readonly source_config_digest: string;
  readonly sources: readonly Readonly<SourceRuntimeEntry>[];
}

export interface NutritionDoctorSource {
  readonly source_id: string;
  readonly tier: SourceTier;
  readonly backend_id: string;
  readonly backend_version: string;
  readonly health: "missing" | "broken" | "timeout" | "error" | "ok";
  readonly reason: string | null;
  readonly next_backend: string | null;
  readonly action: string | null;
}

export interface NutritionDoctorResult {
  readonly policy_version: string;
  readonly source_config_digest: string;
  readonly sources: readonly Readonly<NutritionDoctorSource>[];
}

export interface NutritionSourceAdapter {
  describe(): Readonly<SourceCapability>;
  probe(context: Readonly<SourceContext>): Promise<Readonly<SourceHealth>>;
  resolve(
    request: Readonly<SourceRequest>,
    context: Readonly<SourceContext>,
  ): Promise<Readonly<SourceResolution>>;
}

export function freezeNutritionData<T>(value: T, path = "nutrition"): Readonly<T> {
  if (value === null || typeof value !== "object") return value as Readonly<T>;
  if (isProxy(value)) throw new TypeError(`NUTRITION_DATA_INVALID:${path}:proxy`);
  if (value instanceof Uint8Array) throw new TypeError(`NUTRITION_DATA_INVALID:${path}:binary`);
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => freezeNutritionData(item, `${path}.${index}`))) as unknown as Readonly<T>;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`NUTRITION_DATA_INVALID:${path}:prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`NUTRITION_DATA_INVALID:${path}:symbol`);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      throw new TypeError(`NUTRITION_DATA_INVALID:${path}.${key}:descriptor`);
    }
    copy[key] = freezeNutritionData(descriptor.value, `${path}.${key}`);
  }
  return Object.freeze(copy) as Readonly<T>;
}

export function unknownNutritionEvidence(): Readonly<ResolvedNutritionEvidence> {
  const nutrientValues = {
    energy_kcal: null, protein_g: null, fat_g: null, carbohydrate_g: null, fiber_g: null,
    energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
  };
  return freezeNutritionData({
    source_id: "terminal.unknown",
    source_type: "unknown",
    source_ref: "nutrition-source-registry:terminal.unknown",
    source_version: "2026-08-09.1",
    basis_kind: "per_serving",
    basis_amount: "1",
    basis_unit: "serving",
    nutrient_values: nutrientValues,
    field_evidence: [],
    coverage_status: "unknown",
    adopted_amount: null,
    adopted_unit: null,
    amount_range: null,
    formula: "unknown",
  });
}
