import type { DatabaseSync } from "node:sqlite";

import {
  listMealProjection,
  listInventoryProjection,
  summarizeDailyProgress,
  type InventoryListItem,
  type MealListItem,
} from "../repository/query.js";
import type { DomainQueryOperation } from "./types.js";

export interface InventoryQueryResult {
  readonly kind: "inventory";
  readonly batches: readonly InventoryListItem[];
}

export interface MealQueryResult {
  readonly kind: "meals";
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly meals: readonly MealListItem[];
}

export interface DailySummaryQueryResult {
  readonly kind: "daily_summary";
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly coverage_status: "complete" | "partial" | "unknown";
  readonly nutrients: {
    readonly energy_kcal_milli: number | null;
    readonly protein_mg: number | null;
    readonly fat_mg: number | null;
    readonly carbohydrate_mg: number | null;
    readonly fiber_mg: number | null;
    readonly water_ml_milli: number | null;
  };
}

export type DomainQueryResult =
  | InventoryQueryResult
  | MealQueryResult
  | DailySummaryQueryResult;

export function queryDomainReadModel(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  operation: DomainQueryOperation,
): DomainQueryResult {
  if (operation.kind === "query_inventory") {
    return Object.freeze({
      kind: "inventory" as const,
      batches: listInventoryProjection({ database }),
    });
  }
  if (operation.kind === "query_meals") {
    return Object.freeze({
      kind: "meals" as const,
      date: operation.date,
      timezone: operation.timezone,
      meals: listMealProjection({
        authoritySecret,
        database,
        date: operation.date,
        timezone: operation.timezone,
      }),
    });
  }
  const summary = summarizeDailyProgress({
    authoritySecret,
    database,
    date: operation.date,
    timezone: operation.timezone,
  });
  return Object.freeze({
    kind: "daily_summary" as const,
    date: operation.date,
    timezone: operation.timezone,
    coverage_status: summary.coverage_status,
    nutrients: summary.nutrients,
  });
}
