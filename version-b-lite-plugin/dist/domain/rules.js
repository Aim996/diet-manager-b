function invalid(reason) {
    throw new TypeError(`DOMAIN_RULE_INVALID:${reason}`);
}
function nonnegativeInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 0)
        return invalid(field);
    return value;
}
function nonemptyText(value, field) {
    if (value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
        return invalid(field);
    }
    return value;
}
function decision(value) {
    return Object.freeze(value);
}
export function resolveInventoryMatch(input) {
    const unit = nonemptyText(input.requested_unit, "requested_unit");
    nonnegativeInteger(input.observed_microunits, "observed_microunits");
    if (input.inventory_deduction_microunits !== null) {
        nonnegativeInteger(input.inventory_deduction_microunits, "inventory_deduction_microunits");
    }
    if (input.location === "outside") {
        return decision({
            status: "skipped_outside",
            batch_id: null,
            product_id: null,
            deduction_microunits: 0,
            unit,
            issue_code: null,
        });
    }
    if (input.location !== "home")
        return invalid("location");
    if (input.inventory_deduction_microunits === null) {
        return decision({
            status: "skipped_amount_unknown",
            batch_id: null,
            product_id: null,
            deduction_microunits: 0,
            unit,
            issue_code: "inventory_amount_unknown",
        });
    }
    if (input.candidates.length === 0)
        return invalid("candidates");
    if (input.candidates.length > 1) {
        return decision({
            status: "skipped_ambiguous",
            batch_id: null,
            product_id: null,
            deduction_microunits: 0,
            unit,
            issue_code: "inventory_multiple_candidates",
        });
    }
    const candidate = input.candidates[0];
    nonemptyText(candidate.batch_id, "batch_id");
    nonemptyText(candidate.product_id, "product_id");
    nonnegativeInteger(candidate.available_microunits, "available_microunits");
    if (candidate.unit !== unit) {
        return decision({
            status: "skipped_unit_incompatible",
            batch_id: candidate.batch_id,
            product_id: candidate.product_id,
            deduction_microunits: 0,
            unit,
            issue_code: "inventory_unit_incompatible",
        });
    }
    if (candidate.available_microunits < input.inventory_deduction_microunits) {
        return decision({
            status: "skipped_insufficient",
            batch_id: candidate.batch_id,
            product_id: candidate.product_id,
            deduction_microunits: 0,
            unit,
            issue_code: "inventory_insufficient",
        });
    }
    return decision({
        status: "matched",
        batch_id: candidate.batch_id,
        product_id: candidate.product_id,
        deduction_microunits: input.inventory_deduction_microunits,
        unit,
        issue_code: null,
    });
}
function freezeNutritionVector(value) {
    for (const [field, candidate] of Object.entries(value)) {
        if (candidate !== null)
            nonnegativeInteger(candidate, field);
    }
    return Object.freeze({ ...value });
}
function freezeNutritionSelection(value) {
    if (!Number.isSafeInteger(value.profile_version) || value.profile_version < 1) {
        return invalid("nutrition_profile_version");
    }
    nonemptyText(value.source_ref, "nutrition_source_ref");
    const unknown = value.source_type === "unknown";
    if (unknown) {
        if (value.basis_kind !== null || value.basis_microunits !== null || value.basis_unit !== null) {
            return invalid("nutrition_unknown_basis");
        }
    }
    else {
        if (![
            "per_100g", "per_100ml", "per_serving", "per_item", "per_package", "custom_recipe",
        ].includes(String(value.basis_kind)))
            return invalid("nutrition_basis_kind");
        if (!Number.isSafeInteger(value.basis_microunits) || (value.basis_microunits ?? 0) <= 0) {
            return invalid("nutrition_basis_microunits");
        }
        nonemptyText(String(value.basis_unit), "nutrition_basis_unit");
    }
    return Object.freeze({
        source_type: value.source_type,
        source_ref: value.source_ref,
        profile_version: value.profile_version,
        applicable_product_id: value.applicable_product_id,
        basis_kind: value.basis_kind,
        basis_microunits: value.basis_microunits,
        basis_unit: value.basis_unit,
        nutrients: freezeNutritionVector(value.nutrients),
    });
}
export function selectNutritionSource(candidates, productId) {
    const labels = candidates
        .filter((candidate) => candidate.source_type === "product_label" &&
        productId !== null &&
        candidate.applicable_product_id === productId)
        .sort((left, right) => right.profile_version - left.profile_version);
    if (labels[0])
        return freezeNutritionSelection(labels[0]);
    const publicFixtures = candidates
        .filter((candidate) => candidate.source_type === "public_fixture")
        .sort((left, right) => right.profile_version - left.profile_version);
    if (publicFixtures[0])
        return freezeNutritionSelection(publicFixtures[0]);
    return freezeNutritionSelection({
        source_type: "unknown",
        source_ref: "unknown",
        profile_version: 1,
        applicable_product_id: productId,
        basis_kind: null,
        basis_microunits: null,
        basis_unit: null,
        nutrients: {
            energy_kcal_milli: null,
            protein_mg: null,
            fat_mg: null,
            carbohydrate_mg: null,
            fiber_mg: null,
            water_ml_milli: null,
        },
    });
}
function addKnown(left, right) {
    if (left === null || right === null)
        return null;
    const sum = left + right;
    return nonnegativeInteger(sum, "nutrition_sum");
}
export function addNutritionVectors(left, right) {
    return Object.freeze({
        energy_kcal_milli: addKnown(left.energy_kcal_milli, right.energy_kcal_milli),
        protein_mg: addKnown(left.protein_mg, right.protein_mg),
        fat_mg: addKnown(left.fat_mg, right.fat_mg),
        carbohydrate_mg: addKnown(left.carbohydrate_mg, right.carbohydrate_mg),
        fiber_mg: addKnown(left.fiber_mg, right.fiber_mg),
        water_ml_milli: addKnown(left.water_ml_milli, right.water_ml_milli),
    });
}
function scaleKnown(value, adoptedMicrounits, basisMicrounits) {
    if (value === null)
        return null;
    nonnegativeInteger(value, "nutrition_value");
    const numerator = BigInt(value) * BigInt(adoptedMicrounits);
    const denominator = BigInt(basisMicrounits);
    const scaled = ((numerator * 2n) + denominator) / (denominator * 2n);
    if (scaled > BigInt(Number.MAX_SAFE_INTEGER))
        return invalid("nutrition_scaled");
    return Number(scaled);
}
export function scaleNutritionVector(value, adoptedMicrounits, basisMicrounits) {
    nonnegativeInteger(adoptedMicrounits, "nutrition_adoption_microunits");
    if (!Number.isSafeInteger(basisMicrounits) || basisMicrounits <= 0) {
        return invalid("nutrition_basis_microunits");
    }
    return Object.freeze({
        energy_kcal_milli: scaleKnown(value.energy_kcal_milli, adoptedMicrounits, basisMicrounits),
        protein_mg: scaleKnown(value.protein_mg, adoptedMicrounits, basisMicrounits),
        fat_mg: scaleKnown(value.fat_mg, adoptedMicrounits, basisMicrounits),
        carbohydrate_mg: scaleKnown(value.carbohydrate_mg, adoptedMicrounits, basisMicrounits),
        fiber_mg: scaleKnown(value.fiber_mg, adoptedMicrounits, basisMicrounits),
        water_ml_milli: scaleKnown(value.water_ml_milli, adoptedMicrounits, basisMicrounits),
    });
}
