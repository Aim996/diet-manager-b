import { isProxy } from "node:util/types";
export const SOURCE_TIER_RANK = Object.freeze({
    current_exact_label: 1,
    manufacturer_or_exact_product: 2,
    confirmed_same_product_history: 3,
    authoritative_public_database: 4,
    allowlisted_trusted_internet: 5,
    versioned_common_dish_template: 6,
    generic_estimate: 7,
    unknown: 8,
});
export const REGISTERED_SOURCE_TIERS = Object.freeze({
    "local.current_exact_label": "current_exact_label",
    "conditional.manufacturer_exact": "manufacturer_or_exact_product",
    "local.confirmed_same_product_history": "confirmed_same_product_history",
    "public.usda_fooddata_central": "authoritative_public_database",
    "public.usda_fooddata_central_bundled": "authoritative_public_database",
    "public.china_cdc_phscience_food_composition": "authoritative_public_database",
    "trusted.open_food_facts_read_only": "allowlisted_trusted_internet",
    "local.personal_template": "versioned_common_dish_template",
    "local.versioned_common_dish_template": "versioned_common_dish_template",
    "local.generic_estimate": "generic_estimate",
    "terminal.unknown": "unknown",
});
const V1_ALLOWED_NUTRITION_SOURCE_TYPES = Object.freeze({
    "local.current_exact_label": "product_label",
    "local.personal_template": "personal_template",
    "local.versioned_common_dish_template": "generic_template",
    "public.usda_fooddata_central": "authoritative_public_database",
    "public.usda_fooddata_central_bundled": "authoritative_public_database",
    "public.china_cdc_phscience_food_composition": "authoritative_public_database",
    "terminal.unknown": "unknown",
});
export function assertV1NutritionSource(sourceId, sourceType) {
    const expectedType = V1_ALLOWED_NUTRITION_SOURCE_TYPES[sourceId];
    if (expectedType === undefined || (sourceType !== undefined && sourceType !== expectedType)) {
        throw new TypeError(`NUTRITION_SOURCE_NOT_ALLOWED:${sourceId}`);
    }
}
const NUTRITION_EVIDENCE_FIELDS = [
    "adopted_amount", "adopted_unit", "amount_range", "basis_amount", "basis_kind", "basis_unit",
    "coverage_status", "field_evidence", "formula", "nutrient_values", "source_id", "source_ref",
    "source_type", "source_version",
];
const NUTRIENT_VALUE_FIELDS = [
    "carbohydrate_g", "energy_kcal", "energy_kj", "fat_g", "fiber_g",
    "protein_g", "saturated_fat_g", "sodium_mg", "sugar_g", "water_ml",
];
function evidenceInvalid(reason) {
    throw new TypeError(`NUTRITION_EVIDENCE_INVALID:${reason}`);
}
function exactObject(value, fields, reason) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) {
        return evidenceInvalid(reason);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        keys.sort().join("\0") !== [...fields].sort().join("\0") ||
        keys.some((key) => {
            const descriptor = descriptors[key];
            return descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true;
        }))
        return evidenceInvalid(reason);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return evidenceInvalid(reason);
    return value;
}
function evidenceText(value, reason) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512 ||
        /[\u0000-\u001F\u007F]/u.test(value))
        return evidenceInvalid(reason);
    return value;
}
function evidenceDecimal(value, reason) {
    const result = evidenceText(value, reason);
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(result) || result.length > 32) {
        return evidenceInvalid(reason);
    }
    return result;
}
function compareEvidenceDecimal(left, right) {
    const [leftWhole, leftFraction = ""] = left.split(".");
    const [rightWhole, rightFraction = ""] = right.split(".");
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
    const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
    return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}
export function validateAndFreezeResolvedNutritionEvidence(value) {
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
    if (!sourceTypes.includes(String(evidence.source_type)))
        return evidenceInvalid("source_type");
    if (!basisKinds.includes(String(evidence.basis_kind)))
        return evidenceInvalid("basis_kind");
    if (!coverageStatuses.includes(String(evidence.coverage_status)))
        return evidenceInvalid("coverage_status");
    evidenceDecimal(evidence.basis_amount, "basis_amount");
    const nutrients = exactObject(evidence.nutrient_values, NUTRIENT_VALUE_FIELDS, "nutrients");
    for (const field of NUTRIENT_VALUE_FIELDS) {
        if (nutrients[field] !== null)
            evidenceDecimal(nutrients[field], `nutrients.${field}`);
    }
    if (!Array.isArray(evidence.field_evidence) || isProxy(evidence.field_evidence)) {
        return evidenceInvalid("field_evidence");
    }
    const adoptedAmount = evidence.adopted_amount === null
        ? null : evidenceDecimal(evidence.adopted_amount, "adopted_amount");
    const adoptedUnit = evidence.adopted_unit === null
        ? null : evidenceText(evidence.adopted_unit, "adopted_unit");
    if ((adoptedAmount === null) !== (adoptedUnit === null))
        return evidenceInvalid("adopted_pair");
    if (evidence.amount_range !== null) {
        const range = exactObject(evidence.amount_range, ["adopted", "max", "min", "rule_version", "unit"], "amount_range");
        const min = evidenceDecimal(range.min, "amount_range.min");
        const max = evidenceDecimal(range.max, "amount_range.max");
        const adopted = evidenceDecimal(range.adopted, "amount_range.adopted");
        const unit = evidenceText(range.unit, "amount_range.unit");
        evidenceText(range.rule_version, "amount_range.rule_version");
        if (compareEvidenceDecimal(min, adopted) > 0 ||
            compareEvidenceDecimal(adopted, max) > 0 ||
            adopted !== adoptedAmount || unit !== adoptedUnit) {
            return evidenceInvalid("amount_range_order");
        }
    }
    if (evidence.source_type === "unknown" && (evidence.coverage_status !== "unknown" || adoptedAmount !== null || evidence.amount_range !== null ||
        Object.values(nutrients).some((candidate) => candidate !== null)))
        return evidenceInvalid("unknown_invariant");
    return freezeNutritionData(evidence);
}
export function freezeNutritionData(value, path = "nutrition") {
    if (value === null || typeof value !== "object")
        return value;
    if (isProxy(value))
        throw new TypeError(`NUTRITION_DATA_INVALID:${path}:proxy`);
    if (value instanceof Uint8Array)
        throw new TypeError(`NUTRITION_DATA_INVALID:${path}:binary`);
    if (Array.isArray(value)) {
        return Object.freeze(value.map((item, index) => freezeNutritionData(item, `${path}.${index}`)));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(`NUTRITION_DATA_INVALID:${path}:prototype`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const copy = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string")
            throw new TypeError(`NUTRITION_DATA_INVALID:${path}:symbol`);
        const descriptor = descriptors[key];
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
            throw new TypeError(`NUTRITION_DATA_INVALID:${path}.${key}:descriptor`);
        }
        copy[key] = freezeNutritionData(descriptor.value, `${path}.${key}`);
    }
    return Object.freeze(copy);
}
export function unknownNutritionEvidence() {
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
