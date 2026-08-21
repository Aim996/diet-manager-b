import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertDietManagerOutcome,
  type NutritionOutcomeItem,
} from "../../src/contracts.js";
import { committedOutcome } from "../../src/application/outcome.js";

const expectedIds = [
  "CASE-NUTR-001", "CASE-NUTR-002", "CASE-NUTR-003", "CASE-NUTR-004",
  "CASE-NUTR-005", "CASE-NUTR-006", "CASE-NUTR-008", "CASE-NUTR-009",
  "CASE-MEAL-003", "CASE-MEAL-006", "CASE-MEAL-007", "CASE-MEAL-008",
  "CASE-SOURCE-001", "CASE-SOURCE-002", "CASE-SOURCE-003",
] as const;

const nutritionItem: NutritionOutcomeItem = {
  item_id: "item-rice",
  name: "rice",
  adopted_amount: "150",
  adopted_unit: "g",
  amount_range: { min: "100", max: "150", adopted: "150", unit: "g", rule_version: "portion-v1" },
  quantity_evidence: "field_inference",
  source_label: "public_reference",
  coverage_status: "partial",
  known_fields: ["energy_kcal", "protein_g"],
  missing_fields: ["fiber_g"],
  estimated_fields: ["adopted_amount"],
};

describe("SEL-NUTR-001 shared catalog contract", () => {
  it("selects the exact 15 cases in brief order", async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const modulePath = join(projectRoot, "shared", "tests", "validate-sel-nutr-cases.mjs");
    const validator = await import(/* @vite-ignore */ decodeURI(pathToFileURL(modulePath).href)) as {
      validateSelectedNutritionCases: (catalog: unknown, fixtures: unknown) => readonly { id: string }[];
    };
    const catalog = JSON.parse(readFileSync(join(projectRoot, "shared", "acceptance-cases", "cases.json"), "utf8"));
    const fixtures = JSON.parse(readFileSync(join(projectRoot, "shared", "acceptance-cases", "fixtures", "core-v1.json"), "utf8"));

    expect(validator.validateSelectedNutritionCases(catalog, fixtures).map(({ id }) => id)).toEqual(expectedIds);
  });
});

describe("SEL-NUTR-001 public nutrition outcome", () => {
  it("accepts and recursively freezes exact nutrition items only on committed outcomes", () => {
    const outcome = committedOutcome(
      "record_meal", "operation-nutrition", "committed", "event-meal", undefined, [nutritionItem],
    );

    expect(assertDietManagerOutcome(outcome)).toBe(outcome);
    expect(outcome.nutrition_items).toEqual([nutritionItem]);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.nutrition_items)).toBe(true);
    expect(Object.isFrozen(outcome.nutrition_items?.[0])).toBe(true);
    expect(Object.isFrozen(outcome.nutrition_items?.[0]?.amount_range)).toBe(true);

    expect(() => assertDietManagerOutcome({
      action: "record_meal", status: "failed", committed: false,
      error_code: "SOURCE_FAILED", nutrition_items: [nutritionItem],
    })).toThrow("DIET_MANAGER_OUTCOME_INVALID:keys");
  });
});
