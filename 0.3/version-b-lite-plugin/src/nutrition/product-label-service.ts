import type { DatabaseSync } from "node:sqlite";

import { canonicalSha256 } from "../authority/canonical-json.js";
import {
  persistNutritionProfile,
  readNutritionProfilesBySourceType,
} from "./nutrition-repository.js";
import {
  NUTRITION_FIELDS,
  type NutritionAmountCandidate,
  type NutritionProfileV11,
} from "./nutrition-service.js";
import {
  freezeNutritionData,
  type ResolvedNutritionEvidence,
} from "./types.js";

type NutrientValues = ResolvedNutritionEvidence["nutrient_values"];

export interface SaveProductLabelInput {
  readonly product_id: string;
  readonly normalized_name: string;
  readonly brand: string;
  readonly variant: string;
  readonly package_unit: string;
  readonly package_content_amount: string;
  readonly package_content_unit: string;
  readonly basis_kind: ResolvedNutritionEvidence["basis_kind"];
  readonly basis_amount: string;
  readonly basis_unit: string;
  readonly nutrient_values: NutrientValues;
  readonly source_ref: string;
  readonly source_version: string;
  readonly evidence_reference: string;
  readonly confirmed_at: string;
}

function invalid(reason: string): never {
  throw new TypeError(`PRODUCT_LABEL_INVALID:${reason}`);
}

function text(value: unknown, reason: string, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum ||
      /[\u0000-\u001F\u007F]/u.test(value)) return invalid(reason);
  return value;
}

function decimal(value: unknown, reason: string): string {
  const result = text(value, reason, 32);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(result) || Number(result) <= 0) {
    return invalid(reason);
  }
  return result;
}

function exactNutrients(value: NutrientValues): NutrientValues {
  if (Object.keys(value).sort().join("\0") !== [...NUTRITION_FIELDS].sort().join("\0")) {
    return invalid("nutrients");
  }
  const copy = Object.fromEntries(NUTRITION_FIELDS.map((field) => {
    const current = value[field];
    if (current !== null) decimal(current, `nutrients.${field}`);
    return [field, current];
  })) as NutrientValues;
  return freezeNutritionData(copy);
}

function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) return invalid("confirmed_at");
  return value;
}

function numberDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return invalid("quantity");
  const direct = String(value);
  return /[eE]/u.test(direct)
    ? value.toFixed(12).replace(/(?:\.0+|(?<fraction>\.[0-9]*?)0+)$/u, "$<fraction>")
    : direct;
}

function multiplyDecimal(left: string, right: string): string {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = leftFraction.length + rightFraction.length;
  const product = BigInt(`${leftWhole}${leftFraction}`) * BigInt(`${rightWhole}${rightFraction}`);
  const digits = product.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const result = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, "");
  return result.length === 0 ? "0" : result;
}

function storedLabelValues(
  profile: Readonly<NutritionProfileV11>,
): Readonly<Record<string, string>> | undefined {
  const value: unknown = profile.raw_label_values;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const label = value as Record<string, unknown>;
  for (const field of [
    "normalized_name", "brand", "variant", "package_unit", "package_content_amount",
    "package_content_unit", "evidence_reference",
  ]) {
    if (typeof label[field] !== "string") return undefined;
  }
  return label as Readonly<Record<string, string>>;
}

export function saveProductLabel(
  database: DatabaseSync,
  input: Readonly<SaveProductLabelInput>,
): Readonly<NutritionProfileV11> {
  const productId = text(input.product_id, "product_id", 128);
  const normalizedName = text(input.normalized_name, "normalized_name", 256);
  const confirmedAt = canonicalTimestamp(input.confirmed_at);
  const nutrients = exactNutrients(input.nutrient_values);
  const known = NUTRITION_FIELDS.filter((field) => nutrients[field] !== null);
  const missing = NUTRITION_FIELDS.filter((field) => nutrients[field] === null);
  const rawLabelValues = freezeNutritionData({
    normalized_name: normalizedName,
    brand: text(input.brand, "brand", 128),
    variant: text(input.variant, "variant", 128),
    package_unit: text(input.package_unit, "package_unit", 64),
    package_content_amount: decimal(input.package_content_amount, "package_content_amount"),
    package_content_unit: text(input.package_content_unit, "package_content_unit", 64),
    evidence_reference: text(input.evidence_reference, "evidence_reference"),
  });
  const profileVersion = `product-label-${canonicalSha256({
    product_id: productId,
    source_version: input.source_version,
    raw_label_values: rawLabelValues,
    nutrients,
  }).slice(0, 24).toLowerCase()}`;
  const profile = freezeNutritionData({
    nutrition_profile_id: `nutrition-profile-${canonicalSha256({
      product_id: productId,
      profile_version: profileVersion,
    }).slice(0, 32).toLowerCase()}`,
    schema_version: "1.1.0",
    subject_type: "product",
    subject_id: productId,
    applicable_variant: rawLabelValues.variant,
    profile_version: profileVersion,
    source_type: "product_label",
    source_name: rawLabelValues.brand,
    source_ref: text(input.source_ref, "source_ref"),
    source_version: text(input.source_version, "source_version", 128),
    retrieved_at: confirmedAt,
    basis_kind: input.basis_kind,
    basis_amount: decimal(input.basis_amount, "basis_amount"),
    basis_unit: text(input.basis_unit, "basis_unit", 64),
    serving_name: null,
    serving_size: null,
    servings_per_package: null,
    nutrient_values: nutrients,
    raw_label_values: rawLabelValues,
    parsed_fields: known,
    field_evidence: [{
      evidence_kind: "confirmed_product_label",
      evidence_reference: rawLabelValues.evidence_reference,
      product_id: productId,
    }],
    coverage_status: missing.length === 0 ? "complete" : "partial",
    issues: missing.map((field) => `${field}_unknown`),
    created_at: confirmedAt,
    supersedes_profile_id: null,
  }) as Readonly<NutritionProfileV11>;
  persistNutritionProfile(database, profile);
  return profile;
}

export function resolveProductLabelEvidence(
  database: DatabaseSync,
  item: Readonly<NutritionAmountCandidate>,
): Readonly<ResolvedNutritionEvidence> | undefined {
  if (item.quantity === null || item.unit === null) return undefined;
  const quantity = numberDecimal(item.quantity);
  const matches = readNutritionProfilesBySourceType(database, "product_label").filter((profile) => {
    const label = storedLabelValues(profile);
    if (label === undefined) return false;
    return label.normalized_name === item.normalized_name && label.package_unit === item.unit;
  });
  if (new Set(matches.map((profile) => profile.subject_id)).size !== 1) return undefined;
  for (const profile of matches) {
    const label = storedLabelValues(profile);
    if (label === undefined) continue;
    const packageAmount = label.package_content_amount;
    const packageUnit = label.package_content_unit;
    if (packageAmount === undefined || packageUnit === undefined) continue;
    const adoptedAmount = multiplyDecimal(quantity, decimal(packageAmount, "stored_package_content_amount"));
    return freezeNutritionData({
      source_id: "local.current_exact_label",
      source_type: "product_label",
      source_ref: profile.source_ref,
      source_version: profile.source_version,
      applicable_product_id: profile.subject_id,
      basis_kind: profile.basis_kind,
      basis_amount: profile.basis_amount,
      basis_unit: profile.basis_unit,
      nutrient_values: profile.nutrient_values,
      field_evidence: [...profile.field_evidence, {
        evidence_kind: "exact_product_package_conversion",
        product_id: profile.subject_id,
        profile_version: profile.profile_version,
        package_quantity: quantity,
        package_unit: item.unit,
        package_content_amount: packageAmount,
        package_content_unit: packageUnit,
      }],
      coverage_status: profile.coverage_status,
      adopted_amount: adoptedAmount,
      adopted_unit: packageUnit,
      amount_range: null,
      formula: "profile_value * package_quantity * package_content_amount / basis_amount",
    });
  }
  return undefined;
}
