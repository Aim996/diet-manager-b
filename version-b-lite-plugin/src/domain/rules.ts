import type {
  InventoryMatchDecision,
  InventoryMatchInput,
  NutritionSelection,
  NutritionSourceCandidate,
  NutritionVector,
} from "./types.js";

function invalid(reason: string): never {
  throw new TypeError(`DOMAIN_RULE_INVALID:${reason}`);
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) return invalid(field);
  return value;
}

function nonemptyText(value: string, field: string): string {
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) {
    return invalid(field);
  }
  return value;
}

function decision(value: InventoryMatchDecision): InventoryMatchDecision {
  return Object.freeze(value);
}

export function resolveInventoryMatch(
  input: InventoryMatchInput,
): InventoryMatchDecision {
  const unit = nonemptyText(input.requested_unit, "requested_unit");
  nonnegativeInteger(input.observed_microunits, "observed_microunits");
  nonnegativeInteger(
    input.inventory_deduction_microunits,
    "inventory_deduction_microunits",
  );
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
  if (input.location !== "home") return invalid("location");
  if (input.candidates.length === 0) return invalid("candidates");
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

function freezeNutritionVector(value: NutritionVector): NutritionVector {
  for (const [field, candidate] of Object.entries(value)) {
    if (candidate !== null) nonnegativeInteger(candidate, field);
  }
  return Object.freeze({ ...value });
}

function freezeNutritionSelection(
  value: NutritionSourceCandidate | NutritionSelection,
): NutritionSelection {
  return Object.freeze({
    source_type: value.source_type,
    source_ref: value.source_ref,
    profile_version: value.profile_version,
    applicable_product_id: value.applicable_product_id,
    nutrients: freezeNutritionVector(value.nutrients),
  });
}

export function selectNutritionSource(
  candidates: readonly NutritionSourceCandidate[],
  productId: string | null,
): NutritionSelection {
  const labels = candidates
    .filter(
      (candidate) =>
        candidate.source_type === "product_label" &&
        productId !== null &&
        candidate.applicable_product_id === productId,
    )
    .sort((left, right) => right.profile_version - left.profile_version);
  if (labels[0]) return freezeNutritionSelection(labels[0]);
  const publicFixtures = candidates
    .filter((candidate) => candidate.source_type === "public_fixture")
    .sort((left, right) => right.profile_version - left.profile_version);
  if (publicFixtures[0]) return freezeNutritionSelection(publicFixtures[0]);
  return freezeNutritionSelection({
    source_type: "unknown",
    source_ref: "unknown",
    profile_version: 1,
    applicable_product_id: productId,
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

function addKnown(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  const sum = left + right;
  return nonnegativeInteger(sum, "nutrition_sum");
}

export function addNutritionVectors(
  left: NutritionVector,
  right: NutritionVector,
): NutritionVector {
  return Object.freeze({
    energy_kcal_milli: addKnown(left.energy_kcal_milli, right.energy_kcal_milli),
    protein_mg: addKnown(left.protein_mg, right.protein_mg),
    fat_mg: addKnown(left.fat_mg, right.fat_mg),
    carbohydrate_mg: addKnown(left.carbohydrate_mg, right.carbohydrate_mg),
    fiber_mg: addKnown(left.fiber_mg, right.fiber_mg),
    water_ml_milli: addKnown(left.water_ml_milli, right.water_ml_milli),
  });
}
