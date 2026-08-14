import { canonicalSha256 } from "../authority/canonical-json.js";
import { freezeNutritionData } from "./types.js";
export const NUTRITION_FIELDS = Object.freeze([
    "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g",
    "energy_kj", "sodium_mg", "sugar_g", "saturated_fat_g", "water_ml",
]);
function invalid(reason) {
    throw new TypeError(`NUTRITION_RECORD_INVALID:${reason}`);
}
function parseDecimal(value, reason) {
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) || value.length > 32)
        return invalid(reason);
    const [whole, fraction = ""] = value.split(".");
    const denominator = 10n ** BigInt(fraction.length);
    return [BigInt(`${whole}${fraction}`), denominator];
}
function formatRatio(numerator, denominator) {
    if (denominator <= 0n || numerator < 0n)
        return invalid("decimal_ratio");
    const precision = 1000000n;
    const scaled = numerator * precision;
    let rounded = scaled / denominator;
    if ((scaled % denominator) * 2n >= denominator)
        rounded += 1n;
    const whole = rounded / precision;
    const fraction = (rounded % precision).toString().padStart(6, "0").replace(/0+$/u, "");
    return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}
function scaleDecimal(value, consumed, basis) {
    const [valueNumerator, valueDenominator] = parseDecimal(value, "nutrient");
    const [consumedNumerator, consumedDenominator] = parseDecimal(consumed, "consumed_amount");
    const [basisNumerator, basisDenominator] = parseDecimal(basis, "basis_amount");
    if (basisNumerator === 0n)
        return invalid("basis_zero");
    return formatRatio(valueNumerator * consumedNumerator * basisDenominator, valueDenominator * consumedDenominator * basisNumerator);
}
function exactNutritionValues(value) {
    const keys = Object.keys(value).sort();
    const expected = [...NUTRITION_FIELDS].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
        return invalid("nutrient_keys");
    const result = {};
    for (const field of NUTRITION_FIELDS) {
        const current = value[field];
        if (current !== null)
            parseDecimal(current, `nutrient.${field}`);
        result[field] = current;
    }
    return freezeNutritionData(result);
}
function sourceLabel(sourceType) {
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
export function adoptNutritionAmount(item, evidence) {
    if (evidence.source_type === "unknown")
        return evidence;
    if (evidence.adopted_amount !== null || item.quantity === null || item.unit === null)
        return evidence;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0)
        return invalid("item_quantity");
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
    if (range !== null)
        return freezeNutritionData({
            ...evidence,
            adopted_amount: range.adopted,
            adopted_unit: range.unit,
            amount_range: range,
        });
    const compatible = (evidence.basis_kind === "per_100g" && item.unit === "g") ||
        (evidence.basis_kind === "per_100ml" && item.unit === "ml") ||
        (evidence.basis_kind === "per_item" && ["item", "piece", "个", "枚"].includes(item.unit)) ||
        (evidence.basis_kind === "per_serving" && ["serving", "份"].includes(item.unit)) ||
        (evidence.basis_kind === "per_package" && ["package", "包"].includes(item.unit));
    if (!compatible)
        return evidence;
    const adopted = String(item.quantity);
    parseDecimal(adopted, "item_quantity");
    return freezeNutritionData({
        ...evidence,
        adopted_amount: adopted,
        adopted_unit: item.unit,
        amount_range: null,
    });
}
export function buildNutritionRecords(identity, evidence) {
    const profileValues = exactNutritionValues(evidence.nutrient_values);
    const knownFields = NUTRITION_FIELDS.filter((field) => profileValues[field] !== null);
    const missingFields = NUTRITION_FIELDS.filter((field) => profileValues[field] === null);
    if (evidence.coverage_status === "unknown" && knownFields.length !== 0)
        return invalid("unknown_coverage");
    if (evidence.adopted_amount === null !== (evidence.adopted_unit === null))
        return invalid("amount_pair");
    if (evidence.amount_range !== null && (evidence.adopted_amount === null || evidence.adopted_unit === null ||
        evidence.amount_range.adopted !== evidence.adopted_amount || evidence.amount_range.unit !== evidence.adopted_unit)) {
        return invalid("amount_range");
    }
    if (evidence.adopted_amount !== null)
        parseDecimal(evidence.adopted_amount, "adopted_amount");
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
    });
    const snapshotValues = evidence.adopted_amount === null
        ? exactNutritionValues(Object.fromEntries(NUTRITION_FIELDS.map((field) => [field, null])))
        : exactNutritionValues(Object.fromEntries(NUTRITION_FIELDS.map((field) => [
            field,
            profileValues[field] === null ? null : scaleDecimal(profileValues[field], evidence.adopted_amount, evidence.basis_amount),
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
    });
    return freezeNutritionData({
        profile,
        snapshot,
        quantity_evidence: evidence.adopted_amount === null ? "unknown" : inferred ? "field_inference" : "explicit",
        source_label: sourceLabel(evidence.source_type),
        amount_range: evidence.amount_range,
    });
}
export function nutritionOutcomeItem(name, records) {
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
    });
}
