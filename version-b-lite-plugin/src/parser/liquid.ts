import type {
  CoreLiquidClassification,
  CoreMealItem,
} from "./types.js";

export interface PlainWaterMatch {
  readonly raw_text: string;
  readonly quantity_ml: number;
}

const EXPLICIT_PLAIN_WATER = /喝(?:了)?\s*([0-9]+)\s*ml\s*(白水|水)(?=$|[\s,，。；;！!？?、和与吗么])/u;

/** Recognize only explicit drinking of plain water in the frozen core grammar. */
export function matchExplicitPlainWater(sourceText: string): Readonly<PlainWaterMatch> | null {
  const match = EXPLICIT_PLAIN_WATER.exec(sourceText);
  if (match === null) return null;
  const quantity = Number(match[1]);
  if (
    !Number.isSafeInteger(quantity) || quantity <= 0 ||
    !Number.isSafeInteger(quantity * 1_000)
  ) return null;
  return Object.freeze({ raw_text: match[0], quantity_ml: quantity });
}

/** Classify nutrition liquids as food and never as plain-water events. */
export function classifyMealLiquid(
  items: readonly CoreMealItem[],
): Readonly<CoreLiquidClassification> | null {
  const liquids = items.filter((item) => item.kind === "nutritious_drink");
  if (liquids.length === 0) return null;
  const knownMl = liquids.every((item) =>
    item.unit === "ml" && item.quantity !== null
  )
    ? liquids.reduce((total, item) => total + (item.quantity ?? 0), 0)
    : null;
  return Object.freeze({
    plain_water: false,
    plain_water_contribution_ml: 0,
    ...(knownMl === null ? {} : { food_water_upper_bound_ml: knownMl }),
  });
}
