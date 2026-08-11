import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const QUERY_FIELDS = ["batchId", "database"] as const;
const PROJECTION_PAYLOAD_FIELDS = [
  "authority_kind",
  "batch_id",
  "product_id",
  "quantity_microunits",
  "unit",
] as const;

export interface InventoryProjectionQuery {
  database: DatabaseSync;
  batchId: string;
}

export interface InventoryProjectionResult {
  batch_id: string;
  product_id: string;
  quantity_microunits: number;
  unit: string;
  quantity_status: "available" | "empty";
  effective_status: "active" | "empty";
  last_event_id: string;
  last_changed_at: string;
}

interface ProjectionRow {
  batch_id: string;
  last_event_id: string;
  last_changed_at: string;
  last_verified_at: string | null;
  quantity_status: string;
  seal_status: string;
  expiry_status: string;
  effective_status: string;
  effective_expiration_at: string | null;
  payload_json: string;
}

function invalid(reason: string): never {
  throw new Error(`INVENTORY_PROJECTION_INVALID:${reason}`);
}

function exactDataProperties<T extends readonly string[]>(
  value: unknown,
  fields: T,
): Record<T[number], PropertyDescriptor & { value: unknown }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== [...fields].sort().join("\u0000")
  ) {
    return invalid("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid("descriptor");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid("prototype");
  return descriptors as Record<T[number], PropertyDescriptor & { value: unknown }>;
}

function ordinaryJsonObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("payload_shape");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    return invalid("payload_shape");
  }
  return record;
}

function parseProjection(row: ProjectionRow): InventoryProjectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json) as unknown;
  } catch {
    return invalid("payload_json");
  }
  if (canonicalJson(parsed) !== row.payload_json) return invalid("payload_canonical");
  const payload = ordinaryJsonObject(parsed, PROJECTION_PAYLOAD_FIELDS);
  if (
    payload.authority_kind !== "diet-manager/inventory-projection/v1" ||
    payload.batch_id !== row.batch_id ||
    typeof payload.product_id !== "string" ||
    typeof payload.unit !== "string" ||
    !Number.isSafeInteger(payload.quantity_microunits) ||
    (payload.quantity_microunits as number) < 0
  ) {
    return invalid("payload_authority");
  }
  const quantityMicrounits = payload.quantity_microunits as number;
  const empty = quantityMicrounits === 0;
  if (
    row.quantity_status !== (empty ? "empty" : "available") ||
    row.effective_status !== (empty ? "empty" : "active")
  ) {
    return invalid("status");
  }
  return Object.freeze({
    batch_id: row.batch_id,
    product_id: payload.product_id,
    quantity_microunits: quantityMicrounits,
    unit: payload.unit,
    quantity_status: row.quantity_status as "available" | "empty",
    effective_status: row.effective_status as "active" | "empty",
    last_event_id: row.last_event_id,
    last_changed_at: row.last_changed_at,
  });
}

export function getInventoryProjection(
  input: InventoryProjectionQuery,
): InventoryProjectionResult | null {
  const fields = exactDataProperties(input, QUERY_FIELDS);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  if (
    typeof fields.batchId.value !== "string" ||
    fields.batchId.value.length === 0 ||
    fields.batchId.value.length > 256 ||
    !/^[\x20-\x7E]+$/.test(fields.batchId.value)
  ) {
    return invalid("batch_id");
  }
  const database = fields.database.value as DatabaseSync;
  assertCurrentMigrationAuthority(database);
  const row = database
    .prepare("SELECT * FROM inventory_batch_projections WHERE batch_id = ?")
    .get(fields.batchId.value) as unknown as ProjectionRow | undefined;
  return row ? parseProjection(row) : null;
}

export function parseInventoryProjectionRow(
  row: ProjectionRow,
): InventoryProjectionResult {
  return parseProjection(row);
}
