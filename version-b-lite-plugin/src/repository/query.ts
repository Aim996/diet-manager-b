import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const QUERY_FIELDS = ["batchId", "database"] as const;
const LIST_QUERY_FIELDS = ["database"] as const;
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

export interface InventoryListItem extends InventoryProjectionResult {
  normalized_name: string;
  product_type: string;
}

export interface InventoryProjectionListQuery {
  database: DatabaseSync;
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

interface InventoryListRow extends ProjectionRow {
  product_id: string;
  normalized_name: string;
  product_type: string;
  product_payload_json: string;
  batch_payload_json: string;
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

function assertCanonicalObject(value: string, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return invalid(`${label}_json`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    canonicalJson(parsed) !== value
  ) {
    return invalid(`${label}_canonical`);
  }
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function listInventoryProjection(
  input: InventoryProjectionListQuery,
): readonly InventoryListItem[] {
  const fields = exactDataProperties(input, LIST_QUERY_FIELDS);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  const database = fields.database.value as DatabaseSync;
  let transactionOpen = false;
  try {
    database.exec("BEGIN DEFERRED");
    transactionOpen = true;
    assertCurrentMigrationAuthority(database);
    const rows = database
      .prepare(
        `SELECT
          p.product_id, p.normalized_name, p.product_type,
          p.payload_json AS product_payload_json,
          b.payload_json AS batch_payload_json,
          i.*
         FROM inventory_batch_projections i
         JOIN inventory_batches b ON b.batch_id = i.batch_id
         JOIN products p ON p.product_id = b.product_id`,
      )
      .all() as unknown as InventoryListRow[];
    const items = rows.map((row) => {
      assertCanonicalObject(row.product_payload_json, "product_payload");
      assertCanonicalObject(row.batch_payload_json, "batch_payload");
      const projection = parseProjection(row);
      if (projection.product_id !== row.product_id) return invalid("product_identity");
      return Object.freeze({
        ...projection,
        normalized_name: row.normalized_name,
        product_type: row.product_type,
      });
    });
    items.sort(
      (left, right) =>
        ordinalCompare(left.normalized_name, right.normalized_name) ||
        ordinalCompare(left.batch_id, right.batch_id),
    );
    database.exec("ROLLBACK");
    transactionOpen = false;
    return Object.freeze(items);
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the primary read-model error.
      }
    }
    throw error;
  }
}
