import { describe, expect, it } from "vitest";

import { deriveDomainId, digestDomainEnvelope, toNaturalDate } from "../src/domain/identity.js";
import {
  addNutritionVectors,
  resolveInventoryMatch,
  selectNutritionSource,
} from "../src/domain/rules.js";
import {
  ambiguousMilkMatch,
  homeRiceMatch,
  insufficientEggMatch,
  labelAndPublicNutrition,
  outsideAppleMatch,
  sampleEnvelope,
} from "./helpers/b-slice-fixtures.js";

describe("B-SLICE-001 pure domain rules", () => {
  it("derives the frozen deterministic ID and canonical envelope digest", () => {
    expect(deriveDomainId("event", "idem-001", 0)).toBe(
      "event-53346d58ee84be0e8129d52465b83b61",
    );
    expect(digestDomainEnvelope(sampleEnvelope())).toBe(
      "9AF47081EA9945D14C773FF8F0979B866ADB946C8F8C8FFA52AF57422227D7FF",
    );
  });

  it("maps an instant to the Asia Shanghai natural date", () => {
    expect(toNaturalDate("2026-08-11T16:30:00.000Z", "Asia/Shanghai")).toBe(
      "2026-08-12",
    );
  });

  it("uses the inventory amount instead of the nutrition adoption amount", () => {
    expect(resolveInventoryMatch(homeRiceMatch())).toEqual({
      status: "matched",
      batch_id: "batch-rice-001",
      product_id: "product-rice-001",
      deduction_microunits: 1_000_000,
      unit: "bowl",
      issue_code: null,
    });
  });

  it("does not read or deduct home inventory for an outside meal", () => {
    expect(resolveInventoryMatch(outsideAppleMatch())).toEqual({
      status: "skipped_outside",
      batch_id: null,
      product_id: null,
      deduction_microunits: 0,
      unit: "piece",
      issue_code: null,
    });
  });

  it("does not choose between two inventory candidates", () => {
    expect(resolveInventoryMatch(ambiguousMilkMatch())).toEqual({
      status: "skipped_ambiguous",
      batch_id: null,
      product_id: null,
      deduction_microunits: 0,
      unit: "carton",
      issue_code: "inventory_multiple_candidates",
    });
  });

  it("does not partially deduct an insufficient batch", () => {
    expect(resolveInventoryMatch(insufficientEggMatch())).toEqual({
      status: "skipped_insufficient",
      batch_id: "batch-eggs-001",
      product_id: "product-eggs-001",
      deduction_microunits: 0,
      unit: "piece",
      issue_code: "inventory_insufficient",
    });
  });

  it("prefers an exact product label and preserves unknown nutrient fields", () => {
    expect(selectNutritionSource(labelAndPublicNutrition(), "product-milk-001")).toEqual({
      source_type: "product_label",
      source_ref: "label-whole-milk-250-v1",
      profile_version: 1,
      applicable_product_id: "product-milk-001",
      nutrients: {
        energy_kcal_milli: 160_000,
        protein_mg: 8_000,
        fat_mg: 9_000,
        carbohydrate_mg: 12_000,
        fiber_mg: null,
        water_ml_milli: null,
      },
    });
  });

  it("keeps a total unknown when either nutrient contribution is unknown", () => {
    expect(
      addNutritionVectors(
        {
          energy_kcal_milli: 100_000,
          protein_mg: 2_000,
          fat_mg: null,
          carbohydrate_mg: 5_000,
          fiber_mg: 500,
          water_ml_milli: 20_000,
        },
        {
          energy_kcal_milli: 50_000,
          protein_mg: 1_000,
          fat_mg: 1_000,
          carbohydrate_mg: 2_000,
          fiber_mg: null,
          water_ml_milli: 5_000,
        },
      ),
    ).toEqual({
      energy_kcal_milli: 150_000,
      protein_mg: 3_000,
      fat_mg: null,
      carbohydrate_mg: 7_000,
      fiber_mg: null,
      water_ml_milli: 25_000,
    });
  });
});
