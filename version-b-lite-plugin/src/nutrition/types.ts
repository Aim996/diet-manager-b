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

const V1_ALLOWED_NUTRITION_SOURCE_TYPES: Readonly<Record<string, ResolvedNutritionEvidence["source_type"]>> =
  Object.freeze({
    "local.current_exact_label": "product_label",
    "local.personal_template": "personal_template",
    "public.usda_fooddata_central": "authoritative_public_database",
    "public.china_cdc_phscience_food_composition": "authoritative_public_database",
    "terminal.unknown": "unknown",
  });

export function assertV1NutritionSource(
  sourceId: string,
  sourceType?: ResolvedNutritionEvidence["source_type"],
): void {
  const expectedType = V1_ALLOWED_NUTRITION_SOURCE_TYPES[sourceId];
  if (expectedType === undefined || (sourceType !== undefined && sourceType !== expectedType)) {
    throw new TypeError(`NUTRITION_SOURCE_NOT_ALLOWED:${sourceId}`);
  }
}

const NUTRITION_EVIDENCE_FIELDS = [
  "adopted_amount", "adopted_unit", "amount_range", "basis_amount", "basis_kind", "basis_unit",
  "coverage_status", "field_evidence", "formula", "nutrient_values", "source_id", "source_ref",
  "source_type", "source_version",
] as const;

const NUTRIENT_VALUE_FIELDS = [
  "carbohydrate_g", "energy_kcal", "energy_kj", "fat_g", "fiber_g",
  "protein_g", "saturated_fat_g", "sodium_mg", "sugar_g", "water_ml",
] as const;

function evidenceInvalid(reason: string): never {
  throw new TypeError(`NUTRITION_EVIDENCE_INVALID:${reason}`);
}

function exactObject(value: unknown, fields: readonly string[], reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) {
    return evidenceInvalid(reason);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0") ||
    keys.some((key) => {
      const descriptor = descriptors[key as string];
      return descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true;
    })
  ) return evidenceInvalid(reason);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return evidenceInvalid(reason);
  return value as Record<string, unknown>;
}

function evidenceText(value: unknown, reason: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 512 ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) return evidenceInvalid(reason);
  return value;
}

function evidenceDecimal(value: unknown, reason: string): string {
  const result = evidenceText(value, reason);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(result) || result.length > 32) {
    return evidenceInvalid(reason);
  }
  return result;
}

function compareEvidenceDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

export function validateAndFreezeResolvedNutritionEvidence(
  value: unknown,
): Readonly<ResolvedNutritionEvidence> {
  const evidence = exactObject(value, NUTRITION_EVIDENCE_FIELDS, "shape");
  evidenceText(evidence.source_id, "source_id");
  evidenceText(evidence.source_ref, "source_ref");
  evidenceText(evidence.source_version, "source_version");
  evidenceText(evidence.basis_unit, "basis_unit");
  evidenceText(evidence.formula, "formula");
  const sourceTypes = [
    "product_label", "confirmed_same_product_history", "authoritative_public_database",
    "trusted_public_web", "personal_template", "generic_template", "generic_estimate", "unknown",
  ];
  const basisKinds = ["per_100g", "per_100ml", "per_serving", "per_item", "per_package", "custom_recipe"];
  const coverageStatuses = ["complete", "partial", "unknown"];
  if (!sourceTypes.includes(String(evidence.source_type))) return evidenceInvalid("source_type");
  if (!basisKinds.includes(String(evidence.basis_kind))) return evidenceInvalid("basis_kind");
  if (!coverageStatuses.includes(String(evidence.coverage_status))) return evidenceInvalid("coverage_status");
  evidenceDecimal(evidence.basis_amount, "basis_amount");
  const nutrients = exactObject(evidence.nutrient_values, NUTRIENT_VALUE_FIELDS, "nutrients");
  for (const field of NUTRIENT_VALUE_FIELDS) {
    if (nutrients[field] !== null) evidenceDecimal(nutrients[field], `nutrients.${field}`);
  }
  if (!Array.isArray(evidence.field_evidence) || isProxy(evidence.field_evidence)) {
    return evidenceInvalid("field_evidence");
  }
  const adoptedAmount = evidence.adopted_amount === null
    ? null : evidenceDecimal(evidence.adopted_amount, "adopted_amount");
  const adoptedUnit = evidence.adopted_unit === null
    ? null : evidenceText(evidence.adopted_unit, "adopted_unit");
  if ((adoptedAmount === null) !== (adoptedUnit === null)) return evidenceInvalid("adopted_pair");
  if (evidence.amount_range !== null) {
    const range = exactObject(
      evidence.amount_range,
      ["adopted", "max", "min", "rule_version", "unit"],
      "amount_range",
    );
    const min = evidenceDecimal(range.min, "amount_range.min");
    const max = evidenceDecimal(range.max, "amount_range.max");
    const adopted = evidenceDecimal(range.adopted, "amount_range.adopted");
    const unit = evidenceText(range.unit, "amount_range.unit");
    evidenceText(range.rule_version, "amount_range.rule_version");
    if (
      compareEvidenceDecimal(min, adopted) > 0 ||
      compareEvidenceDecimal(adopted, max) > 0 ||
      adopted !== adoptedAmount || unit !== adoptedUnit
    ) {
      return evidenceInvalid("amount_range_order");
    }
  }
  if (evidence.source_type === "unknown" && (
    evidence.coverage_status !== "unknown" || adoptedAmount !== null || evidence.amount_range !== null ||
    Object.values(nutrients).some((candidate) => candidate !== null)
  )) return evidenceInvalid("unknown_invariant");
  return freezeNutritionData(evidence) as Readonly<ResolvedNutritionEvidence>;
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
