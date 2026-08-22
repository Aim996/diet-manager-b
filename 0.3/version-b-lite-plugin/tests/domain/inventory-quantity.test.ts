import { describe, expect, it } from "vitest";

import {
  consumeInventoryQuantity,
  createInventoryQuantity,
  createInventoryQuantityFromPackageEvidence,
  inventoryQuantityBalance,
  restoreInventoryQuantity,
} from "../../src/domain/inventory-quantity.js";

describe("dual-unit inventory quantity", () => {
  it("keeps package milliunits and volume microlitres on one exact balance", () => {
    const initial = createInventoryQuantity({
      package_count: 2,
      package_unit: "carton",
      per_package: { value: 250, unit: "ml" },
    });
    expect(initial).toEqual({
      package_unit: "carton",
      original_package_microunits: 2_000,
      per_package_base_microunits: 250_000,
      base_unit: "ml",
      remaining_base_microunits: 500_000,
      conversion_source: "explicit",
    });

    const oneCarton = consumeInventoryQuantity(initial, {
      requested_microunits: 1_000_000,
      unit: "carton",
    });
    expect(oneCarton).toMatchObject({
      disposition: "applied",
      deducted_microunits: 1_000_000,
      deducted_unit: "carton",
      quantity: { remaining_base_microunits: 250_000 },
    });
    if (oneCarton.disposition !== "applied") throw new Error("expected applied");
    expect(inventoryQuantityBalance(oneCarton.quantity)).toEqual({
      package_unit: "carton",
      package_milliunits: 1_000,
      whole_packages: 1,
      base_unit: "ml",
      remaining_base_microunits: 250_000,
      remainder_base_microunits: 0,
    });

    const oneHundredMl = consumeInventoryQuantity(oneCarton.quantity, {
      requested_microunits: 100_000_000,
      unit: "ml",
    });
    expect(oneHundredMl).toMatchObject({
      disposition: "applied",
      quantity: { remaining_base_microunits: 150_000 },
    });
    if (oneHundredMl.disposition !== "applied") throw new Error("expected applied");
    expect(inventoryQuantityBalance(oneHundredMl.quantity)).toEqual({
      package_unit: "carton",
      package_milliunits: 600,
      whole_packages: 0,
      base_unit: "ml",
      remaining_base_microunits: 150_000,
      remainder_base_microunits: 150_000,
    });
  });

  it("allows package-only stock but refuses unproven package/base and mass/volume conversions", () => {
    const packageOnly = createInventoryQuantity({
      package_count: 2,
      package_unit: "carton",
      per_package: null,
    });
    expect(consumeInventoryQuantity(packageOnly, {
      requested_microunits: 1_000_000,
      unit: "carton",
    })).toMatchObject({ disposition: "applied", remaining_package_milliunits: 1_000 });
    expect(consumeInventoryQuantity(packageOnly, {
      requested_microunits: 100_000_000,
      unit: "ml",
    })).toEqual({
      disposition: "needs_clarification",
      reason_code: "inventory_unit_conversion_unproven",
    });

    const mass = createInventoryQuantity({
      package_count: 1,
      package_unit: "bag",
      per_package: { value: 500, unit: "g" },
    });
    expect(consumeInventoryQuantity(mass, {
      requested_microunits: 100_000_000,
      unit: "ml",
    })).toEqual({
      disposition: "needs_clarification",
      reason_code: "inventory_unit_conversion_unproven",
    });
  });

  it("deducts only the available exact integer amount and never goes negative", () => {
    const quantity = createInventoryQuantity({
      package_count: 1,
      package_unit: "bag",
      per_package: { value: 100, unit: "g" },
    });
    const result = consumeInventoryQuantity(quantity, {
      requested_microunits: 150_000_000,
      unit: "g",
    });
    expect(result).toMatchObject({
      disposition: "partially_applied",
      requested_microunits: 150_000_000,
      deducted_microunits: 100_000_000,
      shortage_microunits: 50_000_000,
      quantity: { remaining_base_microunits: 0 },
    });
  });

  it("restores a consumed package into both package and base balances", () => {
    const initial = createInventoryQuantity({
      package_count: 2,
      package_unit: "carton",
      per_package: { value: 250, unit: "ml" },
    });
    const consumed = consumeInventoryQuantity(initial, {
      requested_microunits: 1_000_000,
      unit: "carton",
    });
    if (consumed.disposition !== "applied") throw new Error("expected applied");
    expect(restoreInventoryQuantity(consumed.quantity, {
      restored_microunits: 1_000_000,
      unit: "carton",
      available_package_microunits: 1_000_000,
    })).toMatchObject({
      disposition: "applied",
      remaining_package_milliunits: 2_000,
      quantity: { remaining_base_microunits: 500_000 },
    });
  });

  it("uses the consumable inner package when outer cases contain cartons", () => {
    expect(createInventoryQuantityFromPackageEvidence({
      outer_count: 2,
      outer_unit: "case",
      inner_per_outer: 12,
      inner_unit: "carton",
      capacity_per_inner: 250,
      capacity_unit: "ml",
      total_inner: 24,
      total_capacity: 6_000,
      formula: "2*12*250=6000",
    })).toEqual({
      package_unit: "carton",
      original_package_microunits: 24_000,
      per_package_base_microunits: 250_000,
      base_unit: "ml",
      remaining_base_microunits: 6_000_000,
      conversion_source: "explicit",
    });
  });
});
