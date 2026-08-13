import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  createMealFactIdentity,
  mealFactIdentityEquals,
} from "../authority/meal-fact-identity.js";
import { createWaterFactIdentity, waterFactIdentityEquals } from "../authority/water-fact-identity.js";
import { validateAndFreezeMealFactPayload } from "../authority/meal-fact.js";
import { authenticateStoredPreviewAuthority } from "../preview/store.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const QUERY_FIELDS = ["batchId", "database"] as const;
const LIST_QUERY_FIELDS = ["database"] as const;
const DATE_QUERY_FIELDS = ["authoritySecret", "database", "date", "timezone"] as const;
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

export interface DateRangeQuery {
  authoritySecret: Uint8Array;
  database: DatabaseSync;
  date: string;
  timezone: "Asia/Shanghai";
}

export interface MealListItem {
  readonly occurred_at: string;
  readonly meal_slot: string;
  readonly location: "home" | "outside";
  readonly items: readonly {
    readonly item_order: number;
    readonly item_type: string;
    readonly normalized_name: string;
    readonly amount: Readonly<Record<string, unknown>>;
  }[];
}

export interface WaterListItem {
  readonly occurred_at: string;
  readonly source_text: string;
  readonly plain_water_ml_milli: number;
  readonly estimated: false;
  readonly amount_evidence: unknown;
}

export interface DailyNutritionSummary {
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

interface MealQueryRow {
  event_id: string;
  envelope_id: string;
  operation_id: string;
  schema_version: "domain/v2";
  event_type: "diet_meal";
  fact_kind: "meal";
  source_message_id: string;
  conversation_id: string;
  received_at: string;
  occurred_at_text: string;
  meal_id: string;
  meal_slot: string;
  payload_json: string;
  input_digest: string;
  idempotency_input_digest: string;
  preview_payload_json: string;
}

interface MealItemQueryRow {
  item_id: string;
  item_order: number;
  item_type: string;
  normalized_name: string;
  payload_json: string;
}

interface EffectiveMealSnapshotRow {
  active: boolean;
  occurred_at: string;
  meal_slot: string;
  location: "home" | "outside";
  timezone: "Asia/Shanghai";
  items: Array<{
    item_order: number;
    item_type: string;
    normalized_name: string;
    amount: Record<string, unknown>;
  }>;
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

function dateQuery(
  input: DateRangeQuery,
): {
  authoritySecret: Uint8Array;
  database: DatabaseSync;
  date: string;
  timezone: "Asia/Shanghai";
  start: string;
  end: string;
} {
  const fields = exactDataProperties(input, DATE_QUERY_FIELDS);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  if (
    !(fields.authoritySecret.value instanceof Uint8Array) ||
    fields.authoritySecret.value.byteLength < 32 ||
    fields.authoritySecret.value.byteLength > 1024
  ) return invalid("authority_secret");
  if (
    typeof fields.date.value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.date.value) ||
    fields.timezone.value !== "Asia/Shanghai"
  ) {
    return invalid("date_query");
  }
  const dateProbe = new Date(`${fields.date.value}T00:00:00.000Z`);
  if (
    !Number.isFinite(dateProbe.valueOf()) ||
    dateProbe.toISOString().slice(0, 10) !== fields.date.value
  ) return invalid("date");
  const startMilliseconds = Date.parse(`${fields.date.value}T00:00:00+08:00`);
  if (!Number.isFinite(startMilliseconds)) return invalid("date");
  const start = new Date(startMilliseconds).toISOString();
  const end = new Date(startMilliseconds + 86_400_000).toISOString();
  if (start.slice(0, 10) === end.slice(0, 10)) return invalid("date_range");
  return {
    authoritySecret: Uint8Array.from(fields.authoritySecret.value),
    database: fields.database.value as DatabaseSync,
    date: fields.date.value,
    timezone: "Asia/Shanghai",
    start,
    end,
  };
}

function readOnly<T>(database: DatabaseSync, action: () => T): T {
  let transactionOpen = false;
  try {
    database.exec("BEGIN DEFERRED");
    transactionOpen = true;
    assertCurrentMigrationAuthority(database);
    const result = action();
    database.exec("ROLLBACK");
    transactionOpen = false;
    return result;
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

function parseCanonicalRecord(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return invalid(`${label}_json`);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    canonicalJson(parsed) !== value
  ) return invalid(`${label}_canonical`);
  return parsed as Record<string, unknown>;
}

export function listMealProjection(input: DateRangeQuery): readonly MealListItem[] {
  const query = dateQuery(input);
  return readOnly(query.database, () => {
    const rows = query.database.prepare(
      `SELECT e.event_id, e.envelope_id, e.operation_id, e.schema_version, e.event_type,
              e.fact_kind, e.source_message_id, e.conversation_id, e.received_at,
              e.occurred_at_text, e.meal_id, e.meal_slot, e.payload_json,
              c.input_digest, i.input_digest AS idempotency_input_digest,
              c.payload_json AS preview_payload_json
       FROM event_records e
       JOIN command_envelopes c ON c.envelope_id = e.envelope_id
       JOIN idempotency_records i
         ON i.operation_id = c.envelope_id AND i.idempotency_key = c.idempotency_key
       WHERE e.event_type = 'diet_meal' AND e.lifecycle_status = 'active'
         AND e.occurred_at_text >= ? AND e.occurred_at_text < ?
       ORDER BY e.occurred_at_text, e.event_id`,
    ).all(query.start, query.end) as unknown as MealQueryRow[];
    return Object.freeze(rows.flatMap((row) => {
      const parsedEventPayload = parseCanonicalRecord(row.payload_json, "meal_event");
      let eventPayload: Readonly<Record<string, unknown>>;
      try {
        eventPayload = validateAndFreezeMealFactPayload(parsedEventPayload, {
          occurredAt: row.occurred_at_text,
          path: "meal_event",
        });
      } catch {
        return invalid("meal_event_authority");
      }
      const itemRows = query.database.prepare(
        `SELECT item_id, item_order, item_type, normalized_name, payload_json
         FROM meal_items WHERE event_id = ? ORDER BY item_order`,
      ).all(row.event_id) as unknown as MealItemQueryRow[];
      try {
        const previewAuthority = authenticateStoredPreviewAuthority(
          row.preview_payload_json,
          query.authoritySecret,
        );
        if (row.input_digest !== row.idempotency_input_digest) {
          return invalid("meal_event_identity");
        }
        const binding = previewAuthority.binding;
        if (
          binding.preview_id !== row.envelope_id ||
          binding.input_digest !== row.input_digest
        ) return invalid("meal_event_identity");
        if (previewAuthority.preview_authority_kind === "diet-manager/server-preview/v2") {
          const material = previewAuthority.meal_fact_preview_material;
          if (material === undefined || material.input_digest !== row.input_digest) {
            return invalid("meal_event_identity");
          }
          const storedMealIds = query.database.prepare(
            `SELECT event_id FROM event_records
             WHERE envelope_id = ? AND event_type = 'diet_meal'
             ORDER BY event_id`,
          ).all(row.envelope_id) as Array<{ event_id: string }>;
          const expectedMealIds = material.meal_fact_identities
            .map((identity) => identity.event_id)
            .sort();
          if (
            storedMealIds.length !== expectedMealIds.length ||
            storedMealIds.some((stored, index) => stored.event_id !== expectedMealIds[index])
          ) return invalid("meal_event_identity");
          const expected = material.meal_fact_identities.find((identity) =>
            identity.event_id === row.event_id && identity.operation_id === row.operation_id);
          if (!expected) return invalid("meal_event_identity");
          const actual = createMealFactIdentity({
            sequence: expected.sequence,
            event_id: row.event_id,
            operation_id: row.operation_id,
            schema_version: row.schema_version,
            event_type: row.event_type,
            fact_kind: row.fact_kind,
            source_message_id: row.source_message_id,
            conversation_id: row.conversation_id,
            received_at: row.received_at,
            occurred_at_text: row.occurred_at_text,
            meal_id: row.meal_id,
            meal_slot: row.meal_slot,
            payload: eventPayload,
            items: itemRows.map((item) => ({
              item_id: item.item_id,
              item_order: item.item_order,
              item_type: item.item_type,
              normalized_name: item.normalized_name,
              payload: parseCanonicalRecord(item.payload_json, "meal_item"),
            })),
          });
          if (!mealFactIdentityEquals(actual, expected)) return invalid("meal_event_identity");
        } else {
          if (
            ["source_text", "occurred_time", "subject", "context"].some((field) =>
              Object.hasOwn(eventPayload, field))
          ) return invalid("meal_event_identity");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("INVENTORY_PROJECTION_INVALID:")
        ) throw error;
        return invalid("meal_event_identity");
      }
      const latestCorrection = query.database.prepare(
        `SELECT c.base_revision, c.payload_json
         FROM correction_events c
         JOIN event_records e ON e.operation_id = c.request_id AND e.event_type = 'diet_correction'
         JOIN effect_bundle_commits b
           ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
         WHERE c.target_event_id = ? AND (
           (b.effect_state = 'succeeded' AND b.result_status = 'applied') OR
           (b.effect_state = 'permanent_business_skip' AND b.result_status = 'applied_with_issues')
         )
         ORDER BY c.base_revision DESC LIMIT 1`,
      ).get(row.event_id) as { base_revision: number; payload_json: string } | undefined;
      if (latestCorrection) {
        const correction = parseCanonicalRecord(latestCorrection.payload_json, "meal_correction");
        if (
          correction.authority_kind !== "diet-manager/correction-fact/v1" ||
          correction.target_event_id !== row.event_id ||
          correction.base_revision !== latestCorrection.base_revision ||
          typeof correction.after_snapshot !== "object" || correction.after_snapshot === null ||
          Array.isArray(correction.after_snapshot)
        ) return invalid("meal_correction_authority");
        const snapshot = correction.after_snapshot as unknown as EffectiveMealSnapshotRow;
        if (!snapshot.active) return [];
        if (
          snapshot.occurred_at !== row.occurred_at_text ||
          snapshot.meal_slot !== row.meal_slot ||
          snapshot.location !== eventPayload.location ||
          snapshot.timezone !== "Asia/Shanghai" ||
          !Array.isArray(snapshot.items)
        ) return invalid("meal_correction_snapshot");
        const items = snapshot.items.map((item, index) => {
          if (
            item.item_order !== index || typeof item.item_type !== "string" ||
            typeof item.normalized_name !== "string" || typeof item.amount !== "object" ||
            item.amount === null || Array.isArray(item.amount)
          ) return invalid("meal_correction_item");
          return Object.freeze({
            item_order: item.item_order,
            item_type: item.item_type,
            normalized_name: item.normalized_name,
            amount: Object.freeze({ ...item.amount }),
          });
        });
        return [Object.freeze({
          occurred_at: snapshot.occurred_at,
          meal_slot: snapshot.meal_slot,
          location: snapshot.location,
          items: Object.freeze(items),
        }) as MealListItem];
      }
      const items = itemRows.map((item, index) => {
        if (item.item_order !== index) return invalid("meal_item_order");
        const payload = parseCanonicalRecord(item.payload_json, "meal_item");
        if (
          payload.authority_kind !== "diet-manager/meal-item/v1" ||
          typeof payload.amount !== "object" || payload.amount === null ||
          Array.isArray(payload.amount)
        ) return invalid("meal_item_authority");
        return Object.freeze({
          item_order: item.item_order,
          item_type: item.item_type,
          normalized_name: item.normalized_name,
          amount: Object.freeze({ ...(payload.amount as Record<string, unknown>) }),
        });
      });
      return [Object.freeze({
        occurred_at: row.occurred_at_text,
        meal_slot: row.meal_slot,
        location: eventPayload.location,
        items: Object.freeze(items),
      }) as MealListItem];
    }));
  });
}

/** Read immutable white-water facts without conflating them with meal projections. */
export function listWaterEvents(input: DateRangeQuery): readonly WaterListItem[] {
  const query = dateQuery(input);
  return readOnly(query.database, () => {
    const rows = query.database.prepare(
      `SELECT e.envelope_id, e.event_id, e.operation_id, e.schema_version, e.event_type, e.fact_kind, e.source_message_id,
       e.conversation_id, e.received_at, e.occurred_at_text, e.meal_id, e.meal_slot, e.payload_json,
       c.input_digest, c.payload_json AS preview_payload_json, i.input_digest AS idempotency_input_digest
       FROM event_records e JOIN command_envelopes c ON c.envelope_id = e.envelope_id
       JOIN idempotency_records i ON i.operation_id = c.envelope_id AND i.idempotency_key = c.idempotency_key
       WHERE event_type = 'diet_water' AND fact_kind = 'water' AND lifecycle_status = 'active'
         AND e.occurred_at_text >= ? AND e.occurred_at_text < ?
       ORDER BY e.occurred_at_text, e.event_id`,
    ).all(query.start, query.end) as Array<{
      envelope_id: string; event_id: string; operation_id: string; schema_version: "domain/v2"; event_type: "diet_water"; fact_kind: "water";
      source_message_id: string; conversation_id: string; received_at: string; occurred_at_text: string;
      meal_id: string | null; meal_slot: string | null; payload_json: string; input_digest: string;
      preview_payload_json: string; idempotency_input_digest: string;
    }>;
    return Object.freeze(rows.map((row) => {
      if (row.meal_id !== null || row.meal_slot !== null) return invalid("water_event_meal");
      const payload = parseCanonicalRecord(row.payload_json, "water_event");
      const hasReservation = Object.hasOwn(payload, "progress_reservation");
      const expectedPayloadFields = hasReservation
        ? ["amount_evidence", "authority_kind", "estimated", "plain_water_ml_milli", "progress_reservation", "source_text", "timezone"]
        : ["amount_evidence", "authority_kind", "estimated", "plain_water_ml_milli", "source_text", "timezone"];
      if (
        Object.keys(payload).sort().join("\u0000") !== expectedPayloadFields.sort().join("\u0000") ||
        payload.authority_kind !== "diet-manager/water-fact/v1" || payload.estimated !== false ||
        payload.timezone !== "Asia/Shanghai" || typeof payload.source_text !== "string" ||
        !Number.isSafeInteger(payload.plain_water_ml_milli) || (payload.plain_water_ml_milli as number) <= 0
      ) return invalid("water_event_authority");
      const evidence = payload.amount_evidence;
      if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence) ||
          Object.keys(evidence).sort().join("\u0000") !== ["estimated", "quantity", "raw_text", "unit"].join("\u0000") ||
          typeof (evidence as Record<string, unknown>).raw_text !== "string" ||
          !Number.isSafeInteger((evidence as Record<string, unknown>).quantity) ||
          (evidence as Record<string, unknown>).unit !== "ml" || (evidence as Record<string, unknown>).estimated !== false ||
          ((evidence as Record<string, unknown>).quantity as number) * 1_000 !== payload.plain_water_ml_milli) return invalid("water_event_evidence");
      const preview = authenticateStoredPreviewAuthority(row.preview_payload_json, query.authoritySecret);
      if (preview.preview_authority_kind !== "diet-manager/server-preview/v3" ||
          preview.water_fact_preview_material === undefined || row.input_digest !== row.idempotency_input_digest ||
          preview.binding.preview_id !== row.envelope_id ||
          preview.binding.input_digest !== row.input_digest) return invalid("water_event_identity");
      const identity = createWaterFactIdentity({
        sequence: 0, event_id: row.event_id, operation_id: row.operation_id, schema_version: row.schema_version,
        event_type: row.event_type, fact_kind: row.fact_kind, source_message_id: row.source_message_id,
        conversation_id: row.conversation_id, received_at: row.received_at, occurred_at_text: row.occurred_at_text,
        meal_id: row.meal_id, meal_slot: row.meal_slot, payload,
      });
      const expectedIdentities = preview.water_fact_preview_material.water_fact_identities;
      if (expectedIdentities.length !== 1 || !waterFactIdentityEquals(identity, expectedIdentities[0]!)) return invalid("water_event_identity");
      if (preview.water_fact_preview_material.meal_fact_identities.length !== 0) return invalid("water_event_identity");
      const storedSet = query.database.prepare(
        "SELECT event_id, event_type, fact_kind FROM event_records WHERE envelope_id = ? ORDER BY event_id",
      ).all(row.envelope_id) as Array<{ event_id: string; event_type: string; fact_kind: string }>;
      if (
        storedSet.length !== 1 ||
        storedSet[0]?.event_id !== expectedIdentities[0]!.event_id ||
        storedSet[0]?.event_type !== "diet_water" ||
        storedSet[0]?.fact_kind !== "water"
      ) return invalid("water_event_identity");
      return Object.freeze({
        occurred_at: row.occurred_at_text,
        source_text: payload.source_text,
        plain_water_ml_milli: payload.plain_water_ml_milli as number,
        estimated: false as const,
        amount_evidence: Object.freeze(JSON.parse(canonicalJson(payload.amount_evidence))),
      });
    }));
  });
}

const NUTRIENT_FIELDS = [
  "energy_kcal_milli",
  "protein_mg",
  "fat_mg",
  "carbohydrate_mg",
  "fiber_mg",
  "water_ml_milli",
] as const;

export function summarizeDailyProgress(input: DateRangeQuery): DailyNutritionSummary {
  const query = dateQuery(input);
  return readOnly(query.database, () => {
    const rows = query.database.prepare(
      `SELECT coverage_status, payload_json FROM daily_progress_snapshots
       WHERE date = ? AND timezone = ?
       ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`,
    ).all(query.date, query.timezone) as Array<{ coverage_status: string; payload_json: string }>;
    const sums: Record<(typeof NUTRIENT_FIELDS)[number], number | null> = {
      energy_kcal_milli: rows.length === 0 ? null : 0,
      protein_mg: rows.length === 0 ? null : 0,
      fat_mg: rows.length === 0 ? null : 0,
      carbohydrate_mg: rows.length === 0 ? null : 0,
      fiber_mg: rows.length === 0 ? null : 0,
      water_ml_milli: rows.length === 0 ? null : 0,
    };
    let partial = rows.length === 0;
    for (const row of rows) {
      const payload = parseCanonicalRecord(row.payload_json, "daily_progress");
      if (
        payload.authority_kind !== "diet-manager/daily-progress/v1" ||
        payload.date !== query.date || payload.timezone !== query.timezone ||
        typeof payload.nutrients !== "object" || payload.nutrients === null ||
        Array.isArray(payload.nutrients) ||
        (row.coverage_status !== "complete" && row.coverage_status !== "partial") ||
        payload.coverage_status !== row.coverage_status
      ) return invalid("daily_progress_authority");
      if (row.coverage_status === "partial") partial = true;
      const nutrients = payload.nutrients as Record<string, unknown>;
      if (Object.keys(nutrients).sort().join("\u0000") !== [...NUTRIENT_FIELDS].sort().join("\u0000")) {
        return invalid("daily_progress_nutrients");
      }
      for (const field of NUTRIENT_FIELDS) {
        const value = nutrients[field];
        if (value !== null && (!Number.isSafeInteger(value) || (value as number) < 0)) {
          return invalid(`daily_progress_${field}`);
        }
        sums[field] = sums[field] === null || value === null
          ? null
          : (sums[field] as number) + (value as number);
        if (sums[field] !== null && !Number.isSafeInteger(sums[field])) {
          return invalid(`daily_progress_${field}_sum`);
        }
      }
    }
    return Object.freeze({
      coverage_status: rows.length === 0 ? "unknown" as const : partial ? "partial" as const : "complete" as const,
      nutrients: Object.freeze({ ...sums }),
    });
  });
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
