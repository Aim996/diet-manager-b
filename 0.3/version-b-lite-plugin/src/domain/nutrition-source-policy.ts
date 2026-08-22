import type { SourceCapability } from "../nutrition/types.js";

export type NutritionSourceStage =
  | "product_label"
  | "common_library"
  | "traceable_web"
  | "estimate"
  | "unknown";

const STAGE_ORDER: Readonly<Record<NutritionSourceStage, number>> = Object.freeze({
  product_label: 0,
  common_library: 1,
  traceable_web: 2,
  estimate: 3,
  unknown: 4,
});

export function nutritionSourceStage(
  capability: Readonly<SourceCapability>,
): NutritionSourceStage {
  if (capability.network) return "traceable_web";
  switch (capability.tier) {
    case "current_exact_label":
    case "manufacturer_or_exact_product":
    case "confirmed_same_product_history":
      return "product_label";
    case "authoritative_public_database":
    case "versioned_common_dish_template":
      return "common_library";
    case "allowlisted_trusted_internet":
      return "traceable_web";
    case "generic_estimate":
      return "estimate";
    case "unknown":
      return "unknown";
  }
}

function commonLibraryOrder(capability: Readonly<SourceCapability>): number {
  return capability.tier === "versioned_common_dish_template" ? 0 : 1;
}

export function orderNutritionSourceCapabilities<T extends Readonly<SourceCapability>>(
  capabilities: readonly T[],
): readonly T[] {
  return Object.freeze([...capabilities].sort((left, right) => {
    const leftStage = nutritionSourceStage(left);
    const rightStage = nutritionSourceStage(right);
    const stage = STAGE_ORDER[leftStage] - STAGE_ORDER[rightStage];
    if (stage !== 0) return stage;
    if (leftStage === "common_library") {
      const library = commonLibraryOrder(left) - commonLibraryOrder(right);
      if (library !== 0) return library;
    }
    const rank = left.rank - right.rank;
    return rank !== 0 ? rank : left.source_id.localeCompare(right.source_id, "en");
  }));
}
