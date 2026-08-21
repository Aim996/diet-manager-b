import type { DatabaseSync } from "node:sqlite";

import {
  appendNutritionSearchAudit,
  listNutritionSearchAudit,
} from "./nutrition-search-audit-repository.js";

export const saveNutritionAuditRecord = appendNutritionSearchAudit;

export function findReusableNutritionAuditRecords(database: DatabaseSync, query: string) {
  return Object.freeze([...listNutritionSearchAudit(database, query)].reverse().filter((record) =>
    record.cache_decision === "cache_allowed" &&
    record.license_decision === "redistribution_allowed" &&
    !record.match_basis.toLowerCase().includes("conflict") &&
    record.confidence_microunits >= 800_000));
}
