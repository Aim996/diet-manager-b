import { describe, expect, it } from "vitest";

import {
  nutritionSourceStage,
  orderNutritionSourceCapabilities,
} from "../../src/domain/nutrition-source-policy.js";
import type { SourceCapability } from "../../src/nutrition/types.js";

function capability(
  source_id: string,
  tier: SourceCapability["tier"],
  rank: SourceCapability["rank"],
  network: boolean,
): SourceCapability {
  return {
    source_id,
    tier,
    rank,
    backend_id: source_id,
    backend_version: "test-v1",
    network,
    request_fields: ["normalized_food_name"],
  };
}

describe("0.3 nutrition source policy", () => {
  it("orders exact local labels, common library, traceable web, estimates, then unknown", () => {
    const values = [
      capability("local.generic_estimate", "generic_estimate", 7, false),
      capability("public.usda_fooddata_central", "authoritative_public_database", 4, true),
      capability("terminal.unknown", "unknown", 8, false),
      capability("public.usda_fooddata_central_bundled", "authoritative_public_database", 4, false),
      capability("local.current_exact_label", "current_exact_label", 1, false),
      capability("local.versioned_common_dish_template", "versioned_common_dish_template", 6, false),
    ];

    expect(orderNutritionSourceCapabilities(values).map(({ source_id }) => source_id)).toEqual([
      "local.current_exact_label",
      "local.versioned_common_dish_template",
      "public.usda_fooddata_central_bundled",
      "public.usda_fooddata_central",
      "local.generic_estimate",
      "terminal.unknown",
    ]);
    expect(values.map(nutritionSourceStage)).toEqual([
      "estimate", "traceable_web", "unknown", "common_library", "product_label", "common_library",
    ]);
  });

  it("treats a network exact-product provider as web, never as a local product label", () => {
    expect(nutritionSourceStage(capability(
      "conditional.manufacturer_exact",
      "manufacturer_or_exact_product",
      2,
      true,
    ))).toBe("traceable_web");
  });
});
