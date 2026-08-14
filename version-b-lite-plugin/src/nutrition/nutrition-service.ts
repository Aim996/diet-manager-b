import { canonicalSha256 } from "../authority/canonical-json.js";
import type { NutritionOutcomeItem } from "../contracts.js";
import { freezeNutritionData, type ResolvedNutritionEvidence } from "./types.js";

export const NUTRITION_FIELDS = Object.freeze([
  "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g",
  "energy_kj", "sodium_mg", "sugar_g", "saturated_fat_g", "water_ml",
] as const);

type NutritionField = typeof NUTRITION_FIELDS[number];
type NutritionValues = Readonly<Record<NutritionField, string | null>>;

export interface NutritionRecordIdentity {
  readonly operation_id: string;
  readonly meal_event_id: string;
  readonly intake_item_id: string;
  readonly item_name: string;
  readonly subject_type: "food" | "product";
  readonly subject_id: string;
  readonly created_at: string;
}

export interface NutritionProfileV11 {
  readonly nutrition_profile_id: string;
  readonly schema_version: "1.1.0";
  readonly subject_type: "food" | "product";
  readonly subject_id: string;
  readonly applicable_variant: string | null;
  readonly profile_version: string;
  readonly source_type: ResolvedNutritionEvidence["source_type"];
  readonly source_name: string;
  readonly source_ref: string;
  readonly source_version: string;
  readonly retrieved_at: string;
  readonly basis_kind: ResolvedNutritionEvidence["basis_kind"];
  readonly basis_amount: string;
  readonly basis_unit: string;
  readonly serving_name: string | null;
  readonly serving_size: string | null;
  readonly servings_per_package: string | null;
  readonly nutrient_values: NutritionValues;
  readonly raw_label_values: Readonly<Record<string, string>>;
  readonly parsed_fields: readonly NutritionField[];
  readonly field_evidence: readonly Readonly<Record<string, unknown>>[];
  readonly coverage_status: ResolvedNutritionEvidence["coverage_status"];
  readonly issues: readonly string[];
  readonly created_at: string;
  readonly supersedes_profile_id: string | null;
}

export interface NutritionSnapshotV11 {
  readonly snapshot_id: string;
  readonly schema_version: "1.1.0";
  readonly meal_event_id: string;
  readonly intake_item_id: string;
  readonly nutrition_profile_id: string;
  readonly profile_version: string;
  readonly source_type: ResolvedNutritionEvidence["source_type"];
  readonly source_ref: string;
  readonly basis_amount: string;
  readonly basis_unit: string;
  readonly consumed_amount: string | null;
  readonly consumed_unit: string | null;
  readonly nutrient_values: NutritionValues;
  readonly formula: string;
  readonly rounding_rule: "stable_decimal_then_display_half_up";
  readonly estimated_fields: readonly NutritionField[];
  readonly uncertainty: "none" | "bounded" | "unknown";
  readonly known_fields: readonly NutritionField[];
  readonly missing_fields: readonly NutritionField[];
  readonly coverage_status: ResolvedNutritionEvidence["coverage_status"];
  readonly created_at: string;
}

export interface NutritionRecords {
  readonly profile: Readonly<NutritionProfileV11>;
  readonly snapshot: Readonly<NutritionSnapshotV11>;
  readonly quantity_evidence: "explicit" | "field_inference" | "unknown";
  readonly source_label: NutritionOutcomeItem["source_label"];
  readonly amount_range: ResolvedNutritionEvidence["amount_range"];
}

export interface NutritionAmountCandidate {
  readonly normalized_name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly estimated: boolean | null;
}

function invalid(reason: string): never {
  throw new TypeError(`NUTRITION_RECORD_INVALID:${reason}`);
}

function parseDecimal(value: string, reason: string): readonly [bigint, bigint] {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) || value.length > 32) return invalid(reason);
  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return [BigInt(`${whole}${fraction}`), denominator];
}

function formatRatio(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n || numerator < 0n) return invalid("decimal_ratio");
  const precision = 1_000_000n;
  const scaled = numerator * precision;
  let rounded = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
  const whole = rounded / precision;
  const fraction = (rounded % precision).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function scaleDecimal(value: string, consumed: string, basis: string): string {
  const [valueNumerator, valueDenominator] = parseDecimal(value, "nutrient");
  const [consumedNumerator, consumedDenominator] = parseDecimal(consumed, "consumed_amount");
  const [basisNumerator, basisDenominator] = parseDecimal(basis, "basis_amount");
  if (basisNumerator === 0n) return invalid("basis_zero");
  return formatRatio(
    valueNumerator * consumedNumerator * basisDenominator,
    valueDenominator * consumedDenominator * basisNumerator,
  );
}

function exactNutritionValues(value: Readonly<Record<string, string | null>>): NutritionValues {
  const keys = Object.keys(value).sort();
  const expected = [...NUTRITION_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return invalid("nutrient_keys");
  const result = {} as Record<NutritionField, string | null>;
  for (const field of NUTRITION_FIELDS) {
    const current = value[field];
    if (current !== null) parseDecimal(current, `nutrient.${field}`);
    result[field] = current;
  }
  return freezeNutritionData(result) as NutritionValues;
}

function sourceLabel(sourceType: ResolvedNutritionEvidence["source_type"]): NutritionOutcomeItem["source_label"] {
  switch (sourceType) {
    case "product_label": return "explicit";
    case "confirmed_same_product_history": return "confirmed_history";
    case "personal_template": return "personal_template";
    case "authoritative_public_database":
    case "trusted_public_web": return "public_reference";
    case "generic_template":
    case "generic_estimate": return "field_inference";
    case "unknown": return "unknown";
  }
}

export function adoptNutritionAmount(
  item: Readonly<NutritionAmountCandidate>,
  evidence: Readonly<ResolvedNutritionEvidence>,
): Readonly<ResolvedNutritionEvidence> {
  if (evidence.adopted_amount !== null || item.quantity === null || item.unit === null) return evidence;
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) return invalid("item_quantity");
  const naturalUnit = ["item", "piece", "个", "枚"].includes(item.unit);
  const range = evidence.basis_kind === "per_serving" && ["bowl", "碗", "serving", "份"].includes(item.unit)
    ? {
        min: String(item.quantity), max: String(item.quantity), adopted: String(item.quantity),
        unit: "serving", rule_version: "common-dish-serving-v1",
      }
    : evidence.basis_kind === "per_100g"
    ? item.normalized_name === "rice" && ["bowl", "碗"].includes(item.unit) && item.quantity === 0.5
      ? { min: "100", max: "150", adopted: "150", unit: "g", rule_version: "portion-rice-bowl-v1" }
      : item.normalized_name === "orange" && naturalUnit && item.quantity === 1
        ? { min: "120", max: "150", adopted: "150", unit: "g", rule_version: "edible-orange-v1" }
        : item.normalized_name === "apple" && naturalUnit && item.quantity === 1
          ? { min: "150", max: "200", adopted: "200", unit: "g", rule_version: "edible-apple-v1" }
          : item.normalized_name === "egg" && naturalUnit && Number.isSafeInteger(item.quantity)
            ? {
                min: String(item.quantity * 45),
                max: String(item.quantity * 55),
                adopted: String(item.quantity * 55),
                unit: "g",
                rule_version: "edible-egg-v1",
              }
            : null
    : null;
  if (range !== null) return freezeNutritionData({
    ...evidence,
    adopted_amount: range.adopted,
    adopted_unit: range.unit,
    amount_range: range,
  }) as Readonly<ResolvedNutritionEvidence>;
  const compatible =
    (evidence.basis_kind === "per_100g" && item.unit === "g") ||
    (evidence.basis_kind === "per_100ml" && item.unit === "ml") ||
    (evidence.basis_kind === "per_item" && ["item", "piece", "个", "枚"].includes(item.unit)) ||
    (evidence.basis_kind === "per_serving" && ["serving", "份"].includes(item.unit)) ||
    (evidence.basis_kind === "per_package" && ["package", "包"].includes(item.unit));
  if (!compatible) return evidence;
  const adopted = String(item.quantity);
  parseDecimal(adopted, "item_quantity");
  return freezeNutritionData({
    ...evidence,
    adopted_amount: adopted,
    adopted_unit: item.unit,
    amount_range: null,
  }) as Readonly<ResolvedNutritionEvidence>;
}

export function buildNutritionRecords(
  identity: Readonly<NutritionRecordIdentity>,
  evidence: Readonly<ResolvedNutritionEvidence>,
): Readonly<NutritionRecords> {
  const profileValues = exactNutritionValues(evidence.nutrient_values);
  const knownFields = NUTRITION_FIELDS.filter((field) => profileValues[field] !== null);
  const missingFields = NUTRITION_FIELDS.filter((field) => profileValues[field] === null);
  if (evidence.coverage_status === "unknown" && knownFields.length !== 0) return invalid("unknown_coverage");
  if (evidence.adopted_amount === null !== (evidence.adopted_unit === null)) return invalid("amount_pair");
  if (evidence.amount_range !== null && (evidence.adopted_amount === null || evidence.adopted_unit === null ||
      evidence.amount_range.adopted !== evidence.adopted_amount || evidence.amount_range.unit !== evidence.adopted_unit)) {
    return invalid("amount_range");
  }
  if (evidence.adopted_amount !== null) parseDecimal(evidence.adopted_amount, "adopted_amount");
  parseDecimal(evidence.basis_amount, "basis_amount");
  const profileVersion = `profile-${canonicalSha256({
    subject_type: identity.subject_type,
    subject_id: identity.subject_id,
    source_id: evidence.source_id,
    source_ref: evidence.source_ref,
    source_version: evidence.source_version,
    nutrient_values: profileValues,
  }).slice(0, 24)}`;
  const profileId = `nutrition-profile-${canonicalSha256({
    subject_type: identity.subject_type,
    subject_id: identity.subject_id,
    profile_version: profileVersion,
  }).slice(0, 32)}`;
  const profile = freezeNutritionData({
    nutrition_profile_id: profileId,
    schema_version: "1.1.0",
    subject_type: identity.subject_type,
    subject_id: identity.subject_id,
    applicable_variant: null,
    profile_version: profileVersion,
    source_type: evidence.source_type,
    source_name: evidence.source_id,
    source_ref: evidence.source_ref,
    source_version: evidence.source_version,
    retrieved_at: identity.created_at,
    basis_kind: evidence.basis_kind,
    basis_amount: evidence.basis_amount,
    basis_unit: evidence.basis_unit,
    serving_name: null,
    serving_size: null,
    servings_per_package: null,
    nutrient_values: profileValues,
    raw_label_values: {},
    parsed_fields: knownFields,
    field_evidence: evidence.field_evidence,
    coverage_status: evidence.coverage_status,
    issues: missingFields.map((field) => `${field}_unknown`),
    created_at: identity.created_at,
    supersedes_profile_id: null,
  }) as Readonly<NutritionProfileV11>;
  const snapshotValues = evidence.adopted_amount === null
    ? exactNutritionValues(Object.fromEntries(NUTRITION_FIELDS.map((field) => [field, null])))
    : exactNutritionValues(Object.fromEntries(NUTRITION_FIELDS.map((field) => [
      field,
      profileValues[field] === null ? null : scaleDecimal(profileValues[field]!, evidence.adopted_amount!, evidence.basis_amount),
    ])));
  const snapshotId = `nutrition-snapshot-${canonicalSha256({
    operation_id: identity.operation_id,
    meal_event_id: identity.meal_event_id,
    intake_item_id: identity.intake_item_id,
    nutrition_profile_id: profileId,
  }).slice(0, 32)}`;
  const snapshotKnown = NUTRITION_FIELDS.filter((field) => snapshotValues[field] !== null);
  const snapshotMissing = NUTRITION_FIELDS.filter((field) => snapshotValues[field] === null);
  const inferred = evidence.amount_range !== null;
  const snapshot = freezeNutritionData({
    snapshot_id: snapshotId,
    schema_version: "1.1.0",
    meal_event_id: identity.meal_event_id,
    intake_item_id: identity.intake_item_id,
    nutrition_profile_id: profileId,
    profile_version: profileVersion,
    source_type: evidence.source_type,
    source_ref: evidence.source_ref,
    basis_amount: evidence.basis_amount,
    basis_unit: evidence.basis_unit,
    consumed_amount: evidence.adopted_amount,
    consumed_unit: evidence.adopted_unit,
    nutrient_values: snapshotValues,
    formula: evidence.formula,
    rounding_rule: "stable_decimal_then_display_half_up",
    estimated_fields: inferred ? snapshotKnown : [],
    uncertainty: evidence.adopted_amount === null ? "unknown" : inferred ? "bounded" : "none",
    known_fields: snapshotKnown,
    missing_fields: snapshotMissing,
    coverage_status: evidence.coverage_status,
    created_at: identity.created_at,
  }) as Readonly<NutritionSnapshotV11>;
  return freezeNutritionData({
    profile,
    snapshot,
    quantity_evidence: evidence.adopted_amount === null ? "unknown" : inferred ? "field_inference" : "explicit",
    source_label: sourceLabel(evidence.source_type),
    amount_range: evidence.amount_range,
  }) as Readonly<NutritionRecords>;
}

export function nutritionOutcomeItem(
  name: string,
  records: Readonly<NutritionRecords>,
): Readonly<NutritionOutcomeItem> {
  const estimated = records.quantity_evidence === "field_inference"
    ? ["adopted_amount", ...records.snapshot.known_fields]
    : [...records.snapshot.estimated_fields];
  return freezeNutritionData({
    item_id: records.snapshot.intake_item_id,
    name,
    adopted_amount: records.snapshot.consumed_amount,
    adopted_unit: records.snapshot.consumed_unit,
    amount_range: records.amount_range,
    quantity_evidence: records.quantity_evidence,
    source_label: records.source_label,
    coverage_status: records.snapshot.coverage_status,
    known_fields: records.snapshot.known_fields,
    missing_fields: records.snapshot.missing_fields,
    estimated_fields: estimated,
  }) as Readonly<NutritionOutcomeItem>;
}
