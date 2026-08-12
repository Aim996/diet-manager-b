import type { DatabaseSync } from "node:sqlite";

import {
  listInventoryProjection,
  type InventoryListItem,
} from "../repository/query.js";
import type { DomainQueryOperation } from "./types.js";

export interface InventoryQueryResult {
  readonly kind: "inventory";
  readonly batches: readonly InventoryListItem[];
}

export type DomainQueryResult = InventoryQueryResult;

export function queryDomainReadModel(
  database: DatabaseSync,
  operation: DomainQueryOperation,
): DomainQueryResult {
  if (operation.kind !== "query_inventory") {
    throw new Error(`DOMAIN_QUERY_NOT_IMPLEMENTED:${operation.kind}`);
  }
  return Object.freeze({
    kind: "inventory" as const,
    batches: listInventoryProjection({ database }),
  });
}
