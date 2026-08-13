import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const expectedIdsFromBrief = [
  "CASE-PURCHASE-001", "CASE-PURCHASE-003", "CASE-PURCHASE-007",
  "CASE-INVENTORY-001", "CASE-INVENTORY-002", "CASE-INVENTORY-003",
  "CASE-INVENTORY-005", "CASE-INVENTORY-004", "CASE-INVENTORY-009",
  "CASE-MEAL-004", "CASE-MEAL-005", "CASE-PURCHASE-002",
  "CASE-PURCHASE-005", "CASE-PURCHASE-006", "CASE-PURCHASE-008",
  "CASE-PURCHASE-009", "CASE-PURCHASE-010",
] as const;

type CatalogCase = { id: string; stage: string; [key: string]: unknown };

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadSelectedPantryCatalog(): readonly CatalogCase[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const catalog = JSON.parse(readFileSync(join(root, "shared", "acceptance-cases", "cases.json"), "utf8")) as { cases: CatalogCase[] };
  const byId = new Map(catalog.cases.map((entry) => [entry.id, entry]));
  const selected = expectedIdsFromBrief.map((id) => byId.get(id));
  if (selected.some((entry) => entry === undefined)) throw new Error("selected pantry catalog is incomplete");
  return deepFreeze(JSON.parse(JSON.stringify(selected)) as CatalogCase[]);
}

describe("SEL-PANTRY-001 catalog authority", () => {
  it("selects the brief-owned 17 cases in brief order", () => {
    const selected = loadSelectedPantryCatalog();

    expect(selected.map(({ id }) => id)).toEqual(expectedIdsFromBrief);
    expect(selected).toHaveLength(17);
    expect(selected.every((entry) => entry.stage === "PRODUCT-0.1")).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.every((entry) => Object.isFrozen(entry))).toBe(true);
  });
});
