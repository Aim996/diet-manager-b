import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  assertEffectTransition,
  assertEnvelopeTransition,
} from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import {
  createPantryProjectionPayload,
  parseBatchPayload,
  parseProjectionPayload,
  parseProductPayload,
} from "../storage/inventory-repository.js";
import type { PantryPurchaseEvidence } from "../domain/types.js";
import { validateAndFreezeInventoryLocationCorrectionFactPayload } from "../domain/inventory-service.js";
import {
  parseInventoryProjectionRow,
  type InventoryProjectionResult,
} from "./query.js";
import { computeRepositoryDataRevision } from "./revision.js";
import { reservationFromEventPayload } from "./progress-reservation.js";

const INPUT_FIELDS = ["database", "now", "outboxId"] as const;
const LEGACY_ADD_FIELDS = [
  "batch",
  "kind",
  "product",
  "quantity_microunits",
  "reason_code",
  "transaction_id",
  "unit",
] as const;
const ADD_FIELDS = [...LEGACY_ADD_FIELDS, "nutrition_profile"] as const;
const DEDUCT_FIELDS = [
  "batch_id",
  "kind",
  "product_id",
  "quantity_microunits",
  "reason_code",
  "transaction_id",
  "unit",
] as const;
const LOCATION_CORRECTION_FIELDS = [
  "kind", "batch_id", "base_revision", "previous_last_event_id", "previous_last_changed_at",
  "previous_projection_json", "next_projection_json",
] as const;
const PRODUCT_FIELDS = [
  "normalized_name",
  "payload",
  "product_id",
  "product_type",
  "schema_version",
] as const;
const BATCH_FIELDS = [
  "batch_id",
  "explicit_expiration_at",
  "payload",
  "quantity_unit",
  "schema_version",
  "stocked_at",
] as const;
const LEGACY_NUTRITION_PROFILE_FIELDS = [
  "applicable_product_id",
  "nutrients",
  "nutrition_profile_id",
  "profile_version",
  "source_ref",
  "source_type",
] as const;
const NUTRITION_PROFILE_FIELDS = [
  "applicable_product_id",
  "basis_kind",
  "basis_microunits",
  "basis_unit",
  "nutrients",
  "nutrition_profile_id",
  "profile_version",
  "source_ref",
  "source_type",
] as const;
const NUTRITION_BASIS_KINDS = new Set([
  "per_100g",
  "per_100ml",
  "per_serving",
  "per_item",
  "per_package",
  "custom_recipe",
]);
const NUTRIENT_FIELDS = [
  "carbohydrate_mg",
  "energy_kcal_milli",
  "fat_mg",
  "fiber_mg",
  "protein_mg",
  "water_ml_milli",
] as const;

export interface InventoryEffectInput {
  database: DatabaseSync;
  outboxId: string;
  now: string;
}

export interface PendingInventoryEffectsInput {
  database: DatabaseSync;
  limit: number;
}

export interface PendingInventoryEffect {
  outbox_id: string;
  envelope_id: string;
  operation_id: string;
  effect_id: string;
  effect_kind: "inventory_add" | "inventory_deduct" | "inventory_location_correction";
  state: "pending" | "retryable_failed";
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

export type InventoryEffectFault =
  | "after_claim"
  | "after_business_writes"
  | "after_outbox"
  | "after_bundle"
  | "before_commit"
  | "after_commit_before_reply";

export interface InventoryEffectOptions {
  fault?: InventoryEffectFault;
  deferEnvelopeStability?: boolean;
}

interface FrozenInventoryEffectOptions {
  fault?: InventoryEffectFault;
  deferEnvelopeStability: boolean;
}

export interface InventoryEffectResult {
  outbox_id: string;
  effect_id: string;
  effect_state: "succeeded" | "permanent_business_skip";
  result_status: "applied" | "insufficient_inventory";
  batch_id: string;
  transaction_id: string | null;
  quantity_microunits: number | null;
  unit: string;
}

interface FrozenInput {
  database: DatabaseSync;
  outboxId: string;
  now: string;
}

interface OutboxEventRow {
  outbox_id: string;
  envelope_id: string;
  operation_id: string;
  effect_id: string;
  effect_kind: string;
  previous_state: string | null;
  state: string;
  attempt_count: number;
  reason: string | null;
  created_at: string;
  updated_at: string;
  event_id: string;
  event_type: string;
  source_message_id: string;
  conversation_id: string;
  received_at: string;
  committed_at: string;
  event_payload_json: string;
}

interface AddIntent {
  kind: "inventory_add";
  transactionId: string;
  reasonCode: string;
  quantityMicrounits: number | null;
  unit: string;
  product: {
    productId: string;
    schemaVersion: string;
    normalizedName: string;
    productType: string;
    payloadJson: string;
    payloadVersion: 1 | 2;
    brand: string | null;
  };
  batch: {
    batchId: string;
    schemaVersion: string;
    stockedAt: string;
    explicitExpirationAt: string | null;
    quantityUnit: string;
    payloadJson: string;
    pantryEvidence: Readonly<PantryPurchaseEvidence> | null;
    effectiveExpirationAt: string | null;
  };
  nutritionProfile: PreparedNutritionProfile | null;
}

interface PreparedNutritionProfile {
  nutritionProfileId: string;
  profileVersion: number;
  sourceType: "product_label" | "public_fixture";
  sourceRef: string;
  coverageStatus: "complete" | "partial";
  payloadJson: string;
  legacy: boolean;
}

interface DeductIntent {
  kind: "inventory_deduct";
  transactionId: string;
  reasonCode: string;
  productId: string;
  batchId: string;
  quantityMicrounits: number;
  unit: string;
}

interface LocationCorrectionIntent {
  kind: "inventory_location_correction";
  batchId: string;
  baseRevision: number;
  previousLastEventId: string;
  previousLastChangedAt: string;
  previousProjectionJson: string;
  nextProjectionJson: string;
}

type InventoryIntent = AddIntent | DeductIntent | LocationCorrectionIntent;

interface TransactionRow {
  transaction_id: string;
  event_id: string;
  product_id: string;
  batch_id: string;
  direction: string;
  unit: string;
  payload_json: string;
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

interface BundleCheckpointRow {
  operation_id: string;
  effect_state: string;
  result_status: string;
  completed_at: string | null;
  payload_json: string;
}

function invalid(reason: string): never {
  throw new TypeError(`INVENTORY_EFFECT_REQUEST_INVALID:${reason}`);
}

function authorityInvalid(reason: string): never {
  throw new Error(`INVENTORY_EFFECT_AUTHORITY_INVALID:${reason}`);
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

function exactJsonObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return authorityInvalid("effect_shape");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    return authorityInvalid("effect_shape");
  }
  return record;
}

function ascii(value: unknown, field: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[\x20-\x7E]+$/.test(value)
  ) {
    return authorityInvalid(field);
  }
  return value;
}

function text(value: unknown, field: string, maxLength = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return authorityInvalid(field);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") return authorityInvalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return authorityInvalid(field);
  }
  return value;
}

function positiveMicrounits(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return authorityInvalid("quantity_microunits");
  }
  return value as number;
}

function nullablePurchaseMicrounits(value: unknown, version: 1 | 2): number | null {
  if (value === null && version === 2) return null;
  return positiveMicrounits(value);
}

function nullableNutrient(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return authorityInvalid(field);
  }
  return value as number;
}

function freezeInput(value: InventoryEffectInput): FrozenInput {
  const fields = exactDataProperties(value, INPUT_FIELDS);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  return Object.freeze({
    database: fields.database.value as DatabaseSync,
    outboxId: ascii(fields.outboxId.value, "outbox_id"),
    now: timestamp(fields.now.value, "now"),
  });
}

function freezeOptions(
  value: InventoryEffectOptions | undefined,
): Readonly<FrozenInventoryEffectOptions> {
  if (value === undefined) return Object.freeze({ deferEnvelopeStability: false });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("options");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).some(
      (key) => key !== "fault" && key !== "deferEnvelopeStability",
    )
  ) {
    return invalid("options");
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid("options");
    }
  }
  const fault = descriptors.fault?.value;
  if (
    fault !== undefined &&
    ![
      "after_claim",
      "after_business_writes",
      "after_outbox",
      "after_bundle",
      "before_commit",
      "after_commit_before_reply",
    ].includes(String(fault))
  ) {
    return invalid("fault");
  }
  const deferEnvelopeStability = descriptors.deferEnvelopeStability?.value ?? false;
  if (typeof deferEnvelopeStability !== "boolean") {
    return invalid("defer_envelope_stability");
  }
  return Object.freeze({
    ...(fault === undefined ? {} : { fault: fault as InventoryEffectFault }),
    deferEnvelopeStability,
  });
}

function injectFault(
  options: Readonly<FrozenInventoryEffectOptions>,
  point: Exclude<InventoryEffectFault, "after_commit_before_reply">,
): void {
  if (options.fault === point) throw new Error(`INVENTORY_EFFECT_FAILED:${point}`);
}

function readOutbox(database: DatabaseSync, outboxId: string): OutboxEventRow {
  const rows = database
    .prepare(
      `SELECT
        o.*, e.event_id, e.event_type, e.source_message_id, e.conversation_id,
        e.received_at, e.committed_at, e.payload_json AS event_payload_json
       FROM effect_outbox o
       JOIN event_records e
         ON e.envelope_id = o.envelope_id AND e.operation_id = o.operation_id
       WHERE o.outbox_id = ?
       ORDER BY e.event_id`,
    )
    .all(outboxId) as unknown as OutboxEventRow[];
  if (rows.length !== 1) return authorityInvalid("outbox");
  return rows[0];
}

function effectValue(row: OutboxEventRow): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(row.event_payload_json) as unknown;
  } catch {
    return authorityInvalid("event_payload");
  }
  if (canonicalJson(payload) !== row.event_payload_json) {
    return authorityInvalid("event_payload_canonical");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return authorityInvalid("event_payload");
  }
  reservationFromEventPayload(payload, row.event_type);
  const effectInputs = (payload as Record<string, unknown>).effect_inputs;
  if (
    typeof effectInputs !== "object" ||
    effectInputs === null ||
    Array.isArray(effectInputs) ||
    !Object.hasOwn(effectInputs, row.effect_id)
  ) {
    return authorityInvalid("effect_input");
  }
  return (effectInputs as Record<string, unknown>)[row.effect_id];
}

function parseAdd(value: unknown): AddIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return authorityInvalid("effect_shape");
  }
  const sourceRecord = value as Record<string, unknown>;
  const source = exactJsonObject(
    value,
    Object.hasOwn(sourceRecord, "nutrition_profile") ? ADD_FIELDS : LEGACY_ADD_FIELDS,
  );
  if (source.kind !== "inventory_add") return authorityInvalid("effect_kind");
  const product = exactJsonObject(source.product, PRODUCT_FIELDS);
  const batch = exactJsonObject(source.batch, BATCH_FIELDS);
  const productId = ascii(product.product_id, "product_id");
  let parsedProduct;
  let parsedBatch;
  try {
    parsedProduct = parseProductPayload(product.payload);
    parsedBatch = parseBatchPayload(batch.payload);
  } catch {
    return authorityInvalid("pantry_payload");
  }
  if (parsedProduct.version !== parsedBatch.version) return authorityInvalid("pantry_payload_version");
  if (parsedProduct.version === 2) {
    if (
      parsedProduct.identity === null || parsedBatch.pantry_evidence === null ||
      canonicalJson(parsedProduct.identity) !== canonicalJson(parsedBatch.pantry_evidence.product_identity) ||
      parsedProduct.identity.normalized_name !== product.normalized_name
    ) return authorityInvalid("pantry_identity");
  }
  const explicitExpirationAt =
    batch.explicit_expiration_at === null
      ? null
      : timestamp(batch.explicit_expiration_at, "explicit_expiration_at");
  if (
    parsedBatch.pantry_evidence !== null &&
    explicitExpirationAt !== parsedBatch.pantry_evidence.expiration.explicit_at
  ) return authorityInvalid("explicit_expiration_at");
  const quantityMicrounits = nullablePurchaseMicrounits(
    source.quantity_microunits,
    parsedProduct.version,
  );
  if (
    quantityMicrounits === null &&
    (
      parsedBatch.pantry_evidence === null || source.unit !== "unknown" ||
      parsedBatch.pantry_evidence.package_quantity.total_inner !== null ||
      parsedBatch.pantry_evidence.package_quantity.total_capacity !== null
    )
  ) return authorityInvalid("quantity_microunits");
  return Object.freeze({
    kind: "inventory_add",
    transactionId: ascii(source.transaction_id, "transaction_id"),
    reasonCode: ascii(source.reason_code, "reason_code", 128),
    quantityMicrounits,
    unit: ascii(source.unit, "unit", 128),
    product: Object.freeze({
      productId,
      schemaVersion: ascii(product.schema_version, "product_schema_version", 128),
      normalizedName: text(product.normalized_name, "normalized_name"),
      productType: ascii(product.product_type, "product_type", 128),
      payloadJson: parsedProduct.canonical_json,
      payloadVersion: parsedProduct.version,
      brand: parsedProduct.identity?.brand ?? null,
    }),
    batch: Object.freeze({
      batchId: ascii(batch.batch_id, "batch_id"),
      schemaVersion: ascii(batch.schema_version, "batch_schema_version", 128),
      stockedAt: timestamp(batch.stocked_at, "stocked_at"),
      explicitExpirationAt,
      quantityUnit: ascii(batch.quantity_unit, "quantity_unit", 128),
      payloadJson: parsedBatch.canonical_json,
      pantryEvidence: parsedBatch.pantry_evidence,
      effectiveExpirationAt: parsedBatch.pantry_evidence?.expiration.effective_at ?? null,
    }),
    nutritionProfile: Object.hasOwn(sourceRecord, "nutrition_profile")
      ? parsePreparedNutritionProfile(source.nutrition_profile, productId)
      : null,
  });
}

function parseDeduct(value: unknown): DeductIntent {
  const source = exactJsonObject(value, DEDUCT_FIELDS);
  if (source.kind !== "inventory_deduct") return authorityInvalid("effect_kind");
  return Object.freeze({
    kind: "inventory_deduct",
    transactionId: ascii(source.transaction_id, "transaction_id"),
    reasonCode: ascii(source.reason_code, "reason_code", 128),
    productId: ascii(source.product_id, "product_id"),
    batchId: ascii(source.batch_id, "batch_id"),
    quantityMicrounits: positiveMicrounits(source.quantity_microunits),
    unit: ascii(source.unit, "unit", 128),
  });
}

function parseLocationCorrection(value: unknown): LocationCorrectionIntent {
  const source = exactJsonObject(value, LOCATION_CORRECTION_FIELDS);
  if (source.kind !== "inventory_location_correction") return authorityInvalid("effect_kind");
  if (!Number.isSafeInteger(source.base_revision) || (source.base_revision as number) < 1) {
    return authorityInvalid("base_revision");
  }
  const previousProjectionJson = text(source.previous_projection_json, "previous_projection_json", 65_536);
  const nextProjectionJson = text(source.next_projection_json, "next_projection_json", 65_536);
  let previousProjection: unknown;
  let nextProjection: unknown;
  try {
    previousProjection = JSON.parse(previousProjectionJson) as unknown;
    nextProjection = JSON.parse(nextProjectionJson) as unknown;
  } catch {
    return authorityInvalid("projection_payload");
  }
  if (
    canonicalJson(previousProjection) !== previousProjectionJson ||
    canonicalJson(nextProjection) !== nextProjectionJson
  ) return authorityInvalid("projection_payload");
  const previous = parseProjectionPayload(previousProjection);
  const next = parseProjectionPayload(nextProjection);
  if (
    previous.version !== 2 || next.version !== 2 || previous.pantry_evidence === null ||
    next.pantry_evidence === null || previous.batch_id !== next.batch_id ||
    previous.product_id !== next.product_id || previous.quantity_microunits !== next.quantity_microunits ||
    previous.unit !== next.unit || previous.batch_id !== source.batch_id ||
    canonicalJson(previous.pantry_evidence.product_identity) !== canonicalJson(next.pantry_evidence.product_identity) ||
    canonicalJson(previous.pantry_evidence.package_quantity) !== canonicalJson(next.pantry_evidence.package_quantity) ||
    canonicalJson(previous.pantry_evidence.opening) !== canonicalJson(next.pantry_evidence.opening) ||
    (canonicalJson(previous.pantry_evidence.expiration) === canonicalJson(next.pantry_evidence.expiration) &&
      previous.pantry_evidence.expiration.basis !== "explicit") ||
    previous.pantry_evidence.location.value === next.pantry_evidence.location.value ||
    next.pantry_evidence.location.evidence_kind !== "corrected_explicit"
  ) return authorityInvalid("projection_transition");
  return Object.freeze({
    kind: "inventory_location_correction",
    batchId: ascii(source.batch_id, "batch_id"),
    baseRevision: source.base_revision as number,
    previousLastEventId: ascii(source.previous_last_event_id, "previous_last_event_id"),
    previousLastChangedAt: timestamp(source.previous_last_changed_at, "previous_last_changed_at"),
    previousProjectionJson,
    nextProjectionJson,
  });
}

function parseIntent(row: OutboxEventRow): InventoryIntent {
  const value = effectValue(row);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return authorityInvalid("effect_input");
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "inventory_location_correction") {
    if (row.event_type !== "inventory_adjusted") return authorityInvalid("event_type");
    let eventPayload: unknown;
    try {
      eventPayload = JSON.parse(row.event_payload_json) as unknown;
      validateAndFreezeInventoryLocationCorrectionFactPayload(eventPayload);
    } catch {
      return authorityInvalid("location_correction_fact");
    }
  }
  const intent = kind === "inventory_add"
    ? parseAdd(value)
    : kind === "inventory_location_correction"
      ? parseLocationCorrection(value)
      : parseDeduct(value);
  if (row.effect_kind !== intent.kind) return authorityInvalid("outbox_effect_kind");
  return intent;
}

function parsePreparedNutritionProfile(
  value: unknown,
  productId: string,
): PreparedNutritionProfile | null {
  if (value === null) return null;
  const sourceRecord = value as Record<string, unknown>;
  const hasBasis = Object.hasOwn(sourceRecord, "basis_kind");
  const profile = exactJsonObject(
    value,
    hasBasis ? NUTRITION_PROFILE_FIELDS : LEGACY_NUTRITION_PROFILE_FIELDS,
  );
  const nutrients = exactJsonObject(profile.nutrients, NUTRIENT_FIELDS);
  if (
    profile.source_type !== "product_label" &&
    profile.source_type !== "public_fixture"
  ) {
    return authorityInvalid("nutrition_source_type");
  }
  if (profile.applicable_product_id !== productId) {
    return authorityInvalid("nutrition_product_id");
  }
  if (!Number.isSafeInteger(profile.profile_version) || (profile.profile_version as number) < 1) {
    return authorityInvalid("nutrition_profile_version");
  }
  let basis: { kind: string; microunits: number; unit: string } | null = null;
  if (hasBasis) {
    if (!NUTRITION_BASIS_KINDS.has(String(profile.basis_kind))) {
      return authorityInvalid("nutrition_basis_kind");
    }
    if (!Number.isSafeInteger(profile.basis_microunits) || (profile.basis_microunits as number) <= 0) {
      return authorityInvalid("nutrition_basis_microunits");
    }
    basis = {
      kind: String(profile.basis_kind),
      microunits: profile.basis_microunits as number,
      unit: ascii(profile.basis_unit, "nutrition_basis_unit", 128),
    };
  }
  const frozenNutrients = Object.freeze({
    carbohydrate_mg: nullableNutrient(nutrients.carbohydrate_mg, "carbohydrate_mg"),
    energy_kcal_milli: nullableNutrient(nutrients.energy_kcal_milli, "energy_kcal_milli"),
    fat_mg: nullableNutrient(nutrients.fat_mg, "fat_mg"),
    fiber_mg: nullableNutrient(nutrients.fiber_mg, "fiber_mg"),
    protein_mg: nullableNutrient(nutrients.protein_mg, "protein_mg"),
    water_ml_milli: nullableNutrient(nutrients.water_ml_milli, "water_ml_milli"),
  });
  const payloadJson = canonicalJson({
    applicable_product_id: productId,
    authority_kind: "diet-manager/nutrition-profile/v1",
    ...(basis === null ? {} : { basis }),
    nutrients: frozenNutrients,
    source_ref: ascii(profile.source_ref, "nutrition_source_ref"),
    source_type: profile.source_type,
  });
  return Object.freeze({
    nutritionProfileId: ascii(profile.nutrition_profile_id, "nutrition_profile_id"),
    profileVersion: profile.profile_version as number,
    sourceType: profile.source_type,
    sourceRef: ascii(profile.source_ref, "nutrition_source_ref"),
    coverageStatus: Object.values(frozenNutrients).every((value) => value !== null)
      ? "complete"
      : "partial",
    payloadJson,
    legacy: !hasBasis,
  });
}

function writeNutritionProfile(
  database: DatabaseSync,
  intent: AddIntent,
  profile: PreparedNutritionProfile | null,
  now: string,
): void {
  if (!profile) return;
  const previous = database.prepare(
    `SELECT nutrition_profile_id FROM nutrition_profiles
     WHERE subject_type = 'product' AND subject_id = ? AND CAST(profile_version AS INTEGER) < ?
     ORDER BY CAST(profile_version AS INTEGER) DESC LIMIT 1`,
  ).get(intent.product.productId, profile.profileVersion) as
    { nutrition_profile_id: string } | undefined;
  const supersedesProfileId = previous?.nutrition_profile_id ?? null;
  const existing = database
    .prepare(
      `SELECT * FROM nutrition_profiles
       WHERE subject_type = 'product' AND subject_id = ? AND profile_version = ?`,
    )
    .get(intent.product.productId, String(profile.profileVersion)) as
    | Record<string, unknown>
    | undefined;
  if (existing) {
    if (
      existing.nutrition_profile_id !== profile.nutritionProfileId ||
      existing.schema_version !== "domain/v2" ||
      existing.source_type !== profile.sourceType ||
      existing.source_ref !== profile.sourceRef ||
      existing.source_version !== String(profile.profileVersion) ||
      existing.coverage_status !== profile.coverageStatus ||
      (
        existing.supersedes_profile_id !== supersedesProfileId &&
        !(profile.legacy && existing.supersedes_profile_id === null)
      ) ||
      existing.payload_json !== profile.payloadJson
    ) {
      return authorityInvalid("nutrition_profile_conflict");
    }
    return;
  }
  database
    .prepare(
      `INSERT INTO nutrition_profiles(
        nutrition_profile_id, schema_version, subject_type, subject_id,
        profile_version, source_type, source_ref, source_version, retrieved_at,
        coverage_status, created_at, supersedes_profile_id, payload_json
      ) VALUES (?, 'domain/v2', 'product', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      profile.nutritionProfileId,
      intent.product.productId,
      String(profile.profileVersion),
      profile.sourceType,
      profile.sourceRef,
      String(profile.profileVersion),
      now,
      profile.coverageStatus,
      now,
      supersedesProfileId,
      profile.payloadJson,
    );
}

function projectionPayload(
  batchId: string,
  productId: string,
  quantityMicrounits: number | null,
  unit: string,
  pantryEvidence: Readonly<PantryPurchaseEvidence> | null,
): string {
  if (pantryEvidence === null && quantityMicrounits === null) return authorityInvalid("projection_quantity");
  return canonicalJson(pantryEvidence === null
    ? {
        authority_kind: "diet-manager/inventory-projection/v1",
        batch_id: batchId,
        product_id: productId,
        quantity_microunits: quantityMicrounits,
        unit,
      }
    : createPantryProjectionPayload({
        batch_id: batchId,
        product_id: productId,
        quantity_microunits: quantityMicrounits,
        unit,
        pantry_evidence: pantryEvidence,
      }));
}

function transactionPayload(
  deltaMicrounits: number | null,
  quantityAfterMicrounits: number | null,
  unit: string,
): string {
  return canonicalJson({
    authority_kind: deltaMicrounits === null
      ? "diet-manager/inventory-transaction/v2"
      : "diet-manager/inventory-transaction/v1",
    quantity_after_microunits: quantityAfterMicrounits,
    quantity_delta_microunits: deltaMicrounits,
    unit,
  });
}

function insertTransaction(
  database: DatabaseSync,
  row: OutboxEventRow,
  intent: AddIntent | DeductIntent,
  productId: string,
  batchId: string,
  direction: "in" | "out",
  deltaMicrounits: number | null,
  quantityAfterMicrounits: number | null,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO inventory_transactions(
        transaction_id, event_id, product_id, batch_id, idempotency_key,
        schema_version, direction, reason_code, unit, related_event_id,
        related_transaction_id, source_message_id, conversation_id, received_at,
        committed_at, result_status, lifecycle_status, payload_json
      ) VALUES (?, ?, ?, ?, ?, 'domain/v2', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'applied', 'active', ?)`,
    )
    .run(
      intent.transactionId,
      row.event_id,
      productId,
      batchId,
      row.effect_id,
      direction,
      intent.reasonCode,
      intent.unit,
      row.source_message_id,
      row.conversation_id,
      row.received_at,
      now,
      transactionPayload(deltaMicrounits, quantityAfterMicrounits, intent.unit),
    );
}

function writeProjection(
  database: DatabaseSync,
  batchId: string,
  productId: string,
  eventId: string,
  now: string,
  quantityMicrounits: number | null,
  unit: string,
  explicitExpirationAt: string | null,
  effectiveExpirationAt: string | null,
  pantryEvidence: Readonly<PantryPurchaseEvidence> | null,
): void {
  const empty = quantityMicrounits === 0;
  const unknown = quantityMicrounits === null;
  const sealStatus = pantryEvidence?.opening?.status ?? "unknown";
  const expiryStatus = effectiveExpirationAt === null ? "unknown" : "known";
  database
    .prepare(
      `INSERT INTO inventory_batch_projections(
        batch_id, last_event_id, last_changed_at, last_verified_at,
        quantity_status, seal_status, expiry_status, effective_status,
        effective_expiration_at, payload_json
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        last_changed_at = excluded.last_changed_at,
        quantity_status = excluded.quantity_status,
        effective_status = excluded.effective_status,
        effective_expiration_at = excluded.effective_expiration_at,
        payload_json = excluded.payload_json`,
    )
    .run(
      batchId,
      eventId,
      now,
      unknown ? "unknown" : empty ? "empty" : "available",
      sealStatus,
      expiryStatus,
      empty ? "empty" : "active",
      effectiveExpirationAt ?? explicitExpirationAt,
      projectionPayload(batchId, productId, quantityMicrounits, unit, pantryEvidence),
    );
}

function applyAdd(
  database: DatabaseSync,
  row: OutboxEventRow,
  intent: AddIntent,
  now: string,
): InventoryEffectResult {
  if (intent.batch.quantityUnit !== intent.unit) return authorityInvalid("quantity_unit");
  const product = database
    .prepare("SELECT * FROM products WHERE product_id = ?")
    .get(intent.product.productId) as Record<string, unknown> | undefined;
  if (product) {
    if (
      product.schema_version !== intent.product.schemaVersion ||
      product.normalized_name !== intent.product.normalizedName ||
      product.product_type !== intent.product.productType ||
      product.brand !== intent.product.brand ||
      product.manufacturer !== null ||
      product.barcode !== null ||
      product.sku !== null ||
      (intent.product.payloadVersion === 2 && product.payload_json !== intent.product.payloadJson)
    ) {
      return authorityInvalid("product_conflict");
    }
  } else {
    database
      .prepare(
        `INSERT INTO products(
          product_id, schema_version, normalized_name, product_type,
          brand, manufacturer, barcode, sku, payload_json
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      )
      .run(
        intent.product.productId,
        intent.product.schemaVersion,
        intent.product.normalizedName,
        intent.product.productType,
        intent.product.brand,
        intent.product.payloadJson,
      );
  }
  writeNutritionProfile(database, intent, intent.nutritionProfile, now);
  const existingBatch = database
    .prepare("SELECT batch_id FROM inventory_batches WHERE batch_id = ?")
    .get(intent.batch.batchId);
  if (existingBatch) return authorityInvalid("batch_conflict");
  database
    .prepare(
      `INSERT INTO inventory_batches(
        batch_id, product_id, stock_event_id, schema_version, committed_at,
        stocked_at, explicit_expiration_at, quantity_unit, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      intent.batch.batchId,
      intent.product.productId,
      row.event_id,
      intent.batch.schemaVersion,
      now,
      intent.batch.stockedAt,
      intent.batch.explicitExpirationAt,
      intent.batch.quantityUnit,
      intent.batch.payloadJson,
    );
  insertTransaction(
    database,
    row,
    intent,
    intent.product.productId,
    intent.batch.batchId,
    "in",
    intent.quantityMicrounits,
    intent.quantityMicrounits,
    now,
  );
  writeProjection(
    database,
    intent.batch.batchId,
    intent.product.productId,
    row.event_id,
    now,
    intent.quantityMicrounits,
    intent.unit,
    intent.batch.explicitExpirationAt,
    intent.batch.effectiveExpirationAt,
    intent.batch.pantryEvidence,
  );
  return Object.freeze({
    outbox_id: row.outbox_id,
    effect_id: row.effect_id,
    effect_state: "succeeded",
    result_status: "applied",
    batch_id: intent.batch.batchId,
    transaction_id: intent.transactionId,
    quantity_microunits: intent.quantityMicrounits,
    unit: intent.unit,
  });
}

function currentProjection(database: DatabaseSync, batchId: string): InventoryProjectionResult {
  const row = database
    .prepare("SELECT * FROM inventory_batch_projections WHERE batch_id = ?")
    .get(batchId) as unknown as ProjectionRow | undefined;
  if (!row) return authorityInvalid("projection_missing");
  return parseInventoryProjectionRow(row);
}

function skipReason(projection: InventoryProjectionResult): string {
  return canonicalJson({
    code: "INSUFFICIENT_INVENTORY",
    quantity_microunits: projection.quantity_microunits,
    unit: projection.unit,
  });
}

function applyDeduct(
  database: DatabaseSync,
  row: OutboxEventRow,
  intent: DeductIntent,
  now: string,
): InventoryEffectResult {
  const batch = database
    .prepare(
      "SELECT product_id, quantity_unit, explicit_expiration_at FROM inventory_batches WHERE batch_id = ?",
    )
    .get(intent.batchId) as
    | { product_id: string; quantity_unit: string | null; explicit_expiration_at: string | null }
    | undefined;
  if (!batch) return authorityInvalid("batch_missing");
  if (batch.product_id !== intent.productId) return authorityInvalid("product_id");
  if (batch.quantity_unit !== intent.unit) return authorityInvalid("quantity_unit");
  const projection = currentProjection(database, intent.batchId);
  if (projection.product_id !== intent.productId || projection.unit !== intent.unit) {
    return authorityInvalid("projection_identity");
  }
  if (projection.quantity_microunits === null) return authorityInvalid("projection_quantity_unknown");
  if (projection.quantity_microunits < intent.quantityMicrounits) {
    return Object.freeze({
      outbox_id: row.outbox_id,
      effect_id: row.effect_id,
      effect_state: "permanent_business_skip",
      result_status: "insufficient_inventory",
      batch_id: intent.batchId,
      transaction_id: null,
      quantity_microunits: projection.quantity_microunits,
      unit: intent.unit,
    });
  }
  const remaining = projection.quantity_microunits - intent.quantityMicrounits;
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    return authorityInvalid("negative_quantity");
  }
  insertTransaction(
    database,
    row,
    intent,
    intent.productId,
    intent.batchId,
    "out",
    -intent.quantityMicrounits,
    remaining,
    now,
  );
  writeProjection(
    database,
    intent.batchId,
    intent.productId,
    row.event_id,
    now,
    remaining,
    intent.unit,
    batch.explicit_expiration_at,
    projection.effective_expiration_at ?? batch.explicit_expiration_at,
    projection.pantry_evidence ?? null,
  );
  return Object.freeze({
    outbox_id: row.outbox_id,
    effect_id: row.effect_id,
    effect_state: "succeeded",
    result_status: "applied",
    batch_id: intent.batchId,
    transaction_id: intent.transactionId,
    quantity_microunits: remaining,
    unit: intent.unit,
  });
}

function applyLocationCorrection(
  database: DatabaseSync,
  row: OutboxEventRow,
  intent: LocationCorrectionIntent,
  now: string,
): InventoryEffectResult {
  const current = database.prepare(
    `SELECT i.*, b.product_id, b.quantity_unit, b.explicit_expiration_at
     FROM inventory_batch_projections i
     JOIN inventory_batches b ON b.batch_id = i.batch_id
     WHERE i.batch_id = ?`,
  ).get(intent.batchId) as (ProjectionRow & {
    product_id: string;
    quantity_unit: string | null;
    explicit_expiration_at: string | null;
  }) | undefined;
  if (!current) return authorityInvalid("projection_missing");
  if (
    current.last_event_id !== intent.previousLastEventId ||
    current.last_changed_at !== intent.previousLastChangedAt ||
    current.payload_json !== intent.previousProjectionJson
  ) return authorityInvalid("projection_compare_and_set");
  const previous = parseProjectionPayload(JSON.parse(intent.previousProjectionJson) as unknown);
  const next = parseProjectionPayload(JSON.parse(intent.nextProjectionJson) as unknown);
  if (
    previous.version !== 2 || next.version !== 2 || next.pantry_evidence === null ||
    current.product_id !== next.product_id || current.quantity_unit !== next.unit
  ) return authorityInvalid("projection_identity");
  const effectiveExpiration = next.pantry_evidence.expiration.effective_at ??
    next.pantry_evidence.expiration.explicit_at;
  const sealStatus = next.pantry_evidence.opening?.status ?? "unknown";
  const expiryStatus = effectiveExpiration === null ? "unknown" : "known";
  database.prepare(
    `UPDATE inventory_batch_projections
     SET last_event_id = ?, last_changed_at = ?, seal_status = ?, expiry_status = ?,
         effective_expiration_at = ?, payload_json = ?
     WHERE batch_id = ? AND last_event_id = ? AND last_changed_at = ? AND payload_json = ?`,
  ).run(
    row.event_id,
    now,
    sealStatus,
    expiryStatus,
    effectiveExpiration,
    intent.nextProjectionJson,
    intent.batchId,
    intent.previousLastEventId,
    intent.previousLastChangedAt,
    intent.previousProjectionJson,
  );
  const changes = database.prepare("SELECT changes() AS count").get() as { count: number };
  if (changes.count !== 1) return authorityInvalid("projection_compare_and_set");
  return Object.freeze({
    outbox_id: row.outbox_id,
    effect_id: row.effect_id,
    effect_state: "succeeded",
    result_status: "applied",
    batch_id: intent.batchId,
    transaction_id: null,
    quantity_microunits: next.quantity_microunits,
    unit: next.unit,
  });
}

function updateOutbox(
  database: DatabaseSync,
  result: InventoryEffectResult,
  now: string,
): void {
  assertEffectTransition("processing", result.effect_state);
  const reason =
    result.effect_state === "permanent_business_skip"
      ? skipReason({
          batch_id: result.batch_id,
          product_id: "unused",
          quantity_microunits: result.quantity_microunits,
          unit: result.unit,
          quantity_status: result.quantity_microunits === 0 ? "empty" : "available",
          effective_status: result.quantity_microunits === 0 ? "empty" : "active",
          last_event_id: "unused",
          last_changed_at: now,
        })
      : null;
  database
    .prepare(
      `UPDATE effect_outbox
       SET state = ?, reason = ?, updated_at = ?
       WHERE outbox_id = ? AND state = 'processing'`,
    )
    .run(result.effect_state, reason, now, result.outbox_id);
  const changes = database.prepare("SELECT changes() AS count").get() as { count: number };
  if (changes.count !== 1) return authorityInvalid("outbox_compare_and_set");
}

function operationSequence(database: DatabaseSync, row: OutboxEventRow): number {
  const operations = database
    .prepare(
      `SELECT operation_id FROM event_records
       WHERE envelope_id = ?
       ORDER BY committed_at, event_id`,
    )
    .all(row.envelope_id) as Array<{ operation_id: string }>;
  const sequence = operations.findIndex(
    (candidate) => candidate.operation_id === row.operation_id,
  );
  if (
    sequence < 0 ||
    operations.filter((candidate) => candidate.operation_id === row.operation_id).length !== 1
  ) {
    return authorityInvalid("operation_sequence");
  }
  return sequence;
}

function readBundleCheckpoint(
  database: DatabaseSync,
  row: OutboxEventRow,
): BundleCheckpointRow | undefined {
  return database
    .prepare(
      `SELECT operation_id, effect_state, result_status, completed_at, payload_json
       FROM effect_bundle_commits
       WHERE envelope_id = ? AND operation_id = ?`,
    )
    .get(row.envelope_id, row.operation_id) as unknown as BundleCheckpointRow | undefined;
}

function parseBundleCheckpoint(
  checkpoint: BundleCheckpointRow,
  expectedAuthorityKind: string,
  expectedSequence: number,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(checkpoint.payload_json) as unknown;
  } catch {
    return authorityInvalid("bundle_checkpoint_payload");
  }
  if (canonicalJson(parsed) !== checkpoint.payload_json) {
    return authorityInvalid("bundle_checkpoint_payload");
  }
  const payload = exactJsonObject(parsed, [
    "authority_kind",
    "data_revision",
    "effects",
    "operation_sequence",
  ]);
  if (
    payload.authority_kind !== expectedAuthorityKind ||
    typeof payload.data_revision !== "string" ||
    !(payload.data_revision as string).startsWith("repository-v1:") ||
    !Array.isArray(payload.effects) ||
    payload.operation_sequence !== expectedSequence
  ) {
    return authorityInvalid("bundle_checkpoint_payload");
  }
  return payload;
}

function assertDeferredRevisionCheckpoint(
  database: DatabaseSync,
  row: OutboxEventRow,
): void {
  const sequence = operationSequence(database, row);
  const checkpoint = readBundleCheckpoint(database, row);
  if (
    !checkpoint ||
    checkpoint.operation_id !== row.operation_id ||
    checkpoint.effect_state !== "pending" ||
    checkpoint.result_status !== "facts_committed_effects_pending" ||
    checkpoint.completed_at !== null
  ) {
    return authorityInvalid("bundle_checkpoint");
  }
  const payload = parseBundleCheckpoint(
    checkpoint,
    "diet-manager/effect-bundle-checkpoint/v1",
    sequence,
  );
  if (computeRepositoryDataRevision(database) !== payload.data_revision) {
    throw new Error("PREVIEW_STALE:data_revision");
  }
}

function finalizeBundleIfTerminal(
  database: DatabaseSync,
  row: OutboxEventRow,
  now: string,
  deferEnvelopeStability: boolean,
): void {
  const effects = database
    .prepare(
      `SELECT effect_id, state FROM effect_outbox
       WHERE envelope_id = ? AND operation_id = ?
       ORDER BY effect_id`,
    )
    .all(row.envelope_id, row.operation_id) as Array<{ effect_id: string; state: string }>;
  const checkpoint = readBundleCheckpoint(database, row);
  if (
    effects.some(
      (effect) =>
        effect.state !== "succeeded" && effect.state !== "permanent_business_skip",
    )
  ) {
    if (checkpoint) {
      const sequence = operationSequence(database, row);
      if (
        checkpoint.effect_state !== "pending" ||
        checkpoint.result_status !== "facts_committed_effects_pending" ||
        checkpoint.completed_at !== null
      ) {
        return authorityInvalid("bundle_checkpoint_state");
      }
      parseBundleCheckpoint(
        checkpoint,
        "diet-manager/effect-bundle-checkpoint/v1",
        sequence,
      );
      database
        .prepare(
          `UPDATE effect_bundle_commits
           SET payload_json = ?
           WHERE envelope_id = ? AND operation_id = ?
             AND effect_state = 'pending'
             AND result_status = 'facts_committed_effects_pending'
             AND completed_at IS NULL`,
        )
        .run(
          canonicalJson({
            authority_kind: "diet-manager/effect-bundle-checkpoint/v1",
            data_revision: computeRepositoryDataRevision(database),
            effects,
            operation_sequence: sequence,
          }),
          row.envelope_id,
          row.operation_id,
        );
      const changes = database.prepare("SELECT changes() AS count").get() as {
        count: number;
      };
      if (changes.count !== 1) return authorityInvalid("bundle_compare_and_set");
    }
    return;
  }
  const skipped = effects.some((effect) => effect.state === "permanent_business_skip");
  if (checkpoint) {
    const sequence = operationSequence(database, row);
    const payloadJson = canonicalJson({
      authority_kind: "diet-manager/effect-bundle/v1",
      data_revision: computeRepositoryDataRevision(database),
      effects,
      operation_sequence: sequence,
    });
    if (
      checkpoint.effect_state !== "pending" ||
      checkpoint.result_status !== "facts_committed_effects_pending" ||
      checkpoint.completed_at !== null
    ) {
      return authorityInvalid("bundle_checkpoint_state");
    }
    parseBundleCheckpoint(
      checkpoint,
      "diet-manager/effect-bundle-checkpoint/v1",
      sequence,
    );
    database
      .prepare(
        `UPDATE effect_bundle_commits
         SET effect_state = ?, result_status = ?, completed_at = ?, payload_json = ?
         WHERE envelope_id = ? AND operation_id = ?
           AND effect_state = 'pending'
           AND result_status = 'facts_committed_effects_pending'
           AND completed_at IS NULL`,
      )
      .run(
        skipped ? "permanent_business_skip" : "succeeded",
        skipped ? "applied_with_issues" : "applied",
        now,
        payloadJson,
        row.envelope_id,
        row.operation_id,
      );
    const changes = database.prepare("SELECT changes() AS count").get() as { count: number };
    if (changes.count !== 1) return authorityInvalid("bundle_compare_and_set");
  } else {
    const payloadJson = canonicalJson({
      authority_kind: "diet-manager/effect-bundle/v1",
      effects,
    });
    database
      .prepare(
        `INSERT INTO effect_bundle_commits(
          envelope_id, operation_id, stage, effect_state, result_status,
          completed_at, payload_json
        ) VALUES (?, ?, 'EffectBundle', ?, ?, ?, ?)`,
      )
      .run(
        row.envelope_id,
        row.operation_id,
        skipped ? "permanent_business_skip" : "succeeded",
        skipped ? "applied_with_issues" : "applied",
        now,
        payloadJson,
      );
  }
  if (deferEnvelopeStability) return;

  const envelopeEffects = database
    .prepare("SELECT state FROM effect_outbox WHERE envelope_id = ?")
    .all(row.envelope_id) as Array<{ state: string }>;
  if (
    envelopeEffects.some(
      (effect) =>
        effect.state !== "succeeded" && effect.state !== "permanent_business_skip",
    )
  ) {
    return;
  }
  const eventCount = (
    database
      .prepare("SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?")
      .get(row.envelope_id) as { count: number }
  ).count;
  const bundleCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM effect_bundle_commits
         WHERE envelope_id = ? AND completed_at IS NOT NULL`,
      )
      .get(row.envelope_id) as { count: number }
  ).count;
  if (bundleCount !== eventCount) return;
  assertEnvelopeTransition("effects_pending", "effects_stable");
  database
    .prepare(
      `UPDATE command_envelopes
       SET state = 'effects_stable', result_status = 'effects_stable'
       WHERE envelope_id = ? AND state = 'effects_pending'
         AND result_status = 'facts_committed_effects_pending'`,
    )
    .run(row.envelope_id);
  let changes = database.prepare("SELECT changes() AS count").get() as { count: number };
  if (changes.count !== 1) return authorityInvalid("envelope_compare_and_set");
  database
    .prepare(
      `UPDATE idempotency_records
       SET state = 'effects_stable', updated_at = ?
       WHERE operation_id = ? AND state = 'effects_pending'
         AND terminal_result_json IS NULL`,
    )
    .run(now, row.envelope_id);
  changes = database.prepare("SELECT changes() AS count").get() as { count: number };
  if (changes.count !== 1) return authorityInvalid("idempotency_compare_and_set");
}

function transactionResult(
  row: OutboxEventRow,
  transaction: TransactionRow,
): InventoryEffectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(transaction.payload_json) as unknown;
  } catch {
    return authorityInvalid("transaction_payload");
  }
  if (canonicalJson(parsed) !== transaction.payload_json) {
    return authorityInvalid("transaction_payload_canonical");
  }
  const payload = exactJsonObject(parsed, [
    "authority_kind",
    "quantity_after_microunits",
    "quantity_delta_microunits",
    "unit",
  ]);
  const unknown = payload.authority_kind === "diet-manager/inventory-transaction/v2";
  if (payload.unit !== transaction.unit || (
    unknown
      ? payload.quantity_after_microunits !== null || payload.quantity_delta_microunits !== null
      : payload.authority_kind !== "diet-manager/inventory-transaction/v1" ||
        !Number.isSafeInteger(payload.quantity_after_microunits) ||
        (payload.quantity_after_microunits as number) < 0 ||
        !Number.isSafeInteger(payload.quantity_delta_microunits)
  )) {
    return authorityInvalid("transaction_payload_authority");
  }
  return Object.freeze({
    outbox_id: row.outbox_id,
    effect_id: row.effect_id,
    effect_state: "succeeded",
    result_status: "applied",
    batch_id: transaction.batch_id,
    transaction_id: transaction.transaction_id,
    quantity_microunits: unknown ? null : payload.quantity_after_microunits as number,
    unit: transaction.unit,
  });
}

function replayResult(database: DatabaseSync, row: OutboxEventRow): InventoryEffectResult {
  if (row.state === "succeeded") {
    const intent = parseIntent(row);
    if (intent.kind === "inventory_location_correction") {
      const projection = database.prepare(
        "SELECT last_event_id, last_changed_at, payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get(intent.batchId) as { last_event_id: string; last_changed_at: string; payload_json: string } | undefined;
      if (
        !projection || projection.last_event_id !== row.event_id ||
        projection.last_changed_at !== row.committed_at || projection.payload_json !== intent.nextProjectionJson
      ) return authorityInvalid("location_correction_replay");
      const parsed = parseProjectionPayload(JSON.parse(intent.nextProjectionJson) as unknown);
      return Object.freeze({
        outbox_id: row.outbox_id,
        effect_id: row.effect_id,
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: intent.batchId,
        transaction_id: null,
        quantity_microunits: parsed.quantity_microunits,
        unit: parsed.unit,
      });
    }
    const transaction = database
      .prepare("SELECT * FROM inventory_transactions WHERE transaction_id = ?")
      .get(row.effect_id) as unknown as TransactionRow | undefined;
    if (!transaction) {
      const byIntent = database
        .prepare("SELECT * FROM inventory_transactions WHERE transaction_id = ?")
        .get(intent.transactionId) as unknown as TransactionRow | undefined;
      if (!byIntent) return authorityInvalid("transaction_missing");
      return transactionResult(row, byIntent);
    }
    return transactionResult(row, transaction);
  }
  if (row.state !== "permanent_business_skip" || row.reason === null) {
    return authorityInvalid("replay_state");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.reason) as unknown;
  } catch {
    return authorityInvalid("skip_reason");
  }
  const reason = exactJsonObject(parsed, ["code", "quantity_microunits", "unit"]);
  const intent = parseIntent(row);
  if (intent.kind === "inventory_location_correction") return authorityInvalid("skip_reason");
  if (
    reason.code !== "INSUFFICIENT_INVENTORY" ||
    !Number.isSafeInteger(reason.quantity_microunits) ||
    (reason.quantity_microunits as number) < 0 ||
    reason.unit !== intent.unit
  ) {
    return authorityInvalid("skip_reason");
  }
  return Object.freeze({
    outbox_id: row.outbox_id,
    effect_id: row.effect_id,
    effect_state: "permanent_business_skip",
    result_status: "insufficient_inventory",
    batch_id: intent.kind === "inventory_add" ? intent.batch.batchId : intent.batchId,
    transaction_id: null,
    quantity_microunits: reason.quantity_microunits as number,
    unit: intent.unit,
  });
}

export function listPendingInventoryEffects(
  input: PendingInventoryEffectsInput,
): readonly PendingInventoryEffect[] {
  const fields = exactDataProperties(input, ["database", "limit"] as const);
  if (typeof fields.database.value !== "object" || fields.database.value === null) {
    return invalid("database");
  }
  if (
    !Number.isSafeInteger(fields.limit.value) ||
    (fields.limit.value as number) < 1 ||
    (fields.limit.value as number) > 1_000
  ) {
    return invalid("limit");
  }
  const database = fields.database.value as DatabaseSync;
  assertCurrentMigrationAuthority(database);
  const rows = database
    .prepare(
      `SELECT
        outbox_id, envelope_id, operation_id, effect_id, effect_kind,
        state, attempt_count, created_at, updated_at
       FROM effect_outbox
       WHERE state IN ('pending', 'retryable_failed')
          AND effect_kind IN ('inventory_add', 'inventory_deduct', 'inventory_location_correction')
       ORDER BY created_at, outbox_id
       LIMIT ?`,
    )
    .all(fields.limit.value) as unknown as PendingInventoryEffect[];
  for (const row of rows) {
    if (
      (row.effect_kind !== "inventory_add" && row.effect_kind !== "inventory_deduct" &&
        row.effect_kind !== "inventory_location_correction") ||
      (row.state !== "pending" && row.state !== "retryable_failed") ||
      !Number.isSafeInteger(row.attempt_count) ||
      row.attempt_count < 0
    ) {
      return authorityInvalid("pending_row");
    }
    Object.freeze(row);
  }
  return Object.freeze(rows);
}

export function processInventoryEffect(
  input: InventoryEffectInput,
  options?: InventoryEffectOptions,
): InventoryEffectResult {
  const frozen = freezeInput(input);
  const frozenOptions = freezeOptions(options);
  let transactionOpen = false;
  let committed = false;
  try {
    frozen.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(frozen.database);
    const row = readOutbox(frozen.database, frozen.outboxId);
    if (row.state === "succeeded" || row.state === "permanent_business_skip") {
      const replay = replayResult(frozen.database, row);
      frozen.database.exec("ROLLBACK");
      transactionOpen = false;
      return replay;
    }
    if (row.state !== "pending" && row.state !== "retryable_failed") {
      return authorityInvalid("state");
    }
    if (
      frozenOptions.deferEnvelopeStability ||
      readBundleCheckpoint(frozen.database, row) !== undefined
    ) {
      assertDeferredRevisionCheckpoint(frozen.database, row);
    }
    assertEffectTransition(row.state, "processing");
    frozen.database
      .prepare(
        `UPDATE effect_outbox
         SET state = 'processing', attempt_count = attempt_count + 1, updated_at = ?
         WHERE outbox_id = ? AND state = ?`,
      )
      .run(frozen.now, row.outbox_id, row.state);
    const changes = frozen.database.prepare("SELECT changes() AS count").get() as {
      count: number;
    };
    if (changes.count !== 1) return authorityInvalid("claim_compare_and_set");
    injectFault(frozenOptions, "after_claim");

    const intent = parseIntent(row);
    const result = intent.kind === "inventory_add"
      ? applyAdd(frozen.database, row, intent, frozen.now)
      : intent.kind === "inventory_location_correction"
        ? applyLocationCorrection(frozen.database, row, intent, frozen.now)
        : applyDeduct(frozen.database, row, intent, frozen.now);
    injectFault(frozenOptions, "after_business_writes");
    updateOutbox(frozen.database, result, frozen.now);
    injectFault(frozenOptions, "after_outbox");
    finalizeBundleIfTerminal(
      frozen.database,
      row,
      frozen.now,
      frozenOptions.deferEnvelopeStability,
    );
    injectFault(frozenOptions, "after_bundle");
    injectFault(frozenOptions, "before_commit");
    frozen.database.exec("COMMIT");
    transactionOpen = false;
    committed = true;
    if (frozenOptions.fault === "after_commit_before_reply") {
      throw new Error("INVENTORY_EFFECT_RESPONSE_LOST:after_commit_before_reply");
    }
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        frozen.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary effect failure.
      }
    }
    if (committed) throw error;
    throw error;
  }
}

export function processInventoryEffectInOpenTransaction(
  input: InventoryEffectInput,
  options?: InventoryEffectOptions,
): InventoryEffectResult {
  const frozen = freezeInput(input);
  const frozenOptions = freezeOptions(options);
  assertCurrentMigrationAuthority(frozen.database);
  const row = readOutbox(frozen.database, frozen.outboxId);
  if (row.state !== "pending" && row.state !== "retryable_failed") {
    return authorityInvalid("state");
  }
  if (
    frozenOptions.deferEnvelopeStability ||
    readBundleCheckpoint(frozen.database, row) !== undefined
  ) {
    assertDeferredRevisionCheckpoint(frozen.database, row);
  }
  assertEffectTransition(row.state, "processing");
  frozen.database
    .prepare(
      `UPDATE effect_outbox
       SET state = 'processing', attempt_count = attempt_count + 1, updated_at = ?
       WHERE outbox_id = ? AND state = ?`,
    )
    .run(frozen.now, row.outbox_id, row.state);
  const changes = frozen.database.prepare("SELECT changes() AS count").get() as {
    count: number;
  };
  if (changes.count !== 1) return authorityInvalid("claim_compare_and_set");
  injectFault(frozenOptions, "after_claim");

  const intent = parseIntent(row);
  const result = intent.kind === "inventory_add"
    ? applyAdd(frozen.database, row, intent, frozen.now)
    : intent.kind === "inventory_location_correction"
      ? applyLocationCorrection(frozen.database, row, intent, frozen.now)
      : applyDeduct(frozen.database, row, intent, frozen.now);
  injectFault(frozenOptions, "after_business_writes");
  updateOutbox(frozen.database, result, frozen.now);
  injectFault(frozenOptions, "after_outbox");
  finalizeBundleIfTerminal(
    frozen.database,
    row,
    frozen.now,
    frozenOptions.deferEnvelopeStability,
  );
  injectFault(frozenOptions, "after_bundle");
  injectFault(frozenOptions, "before_commit");
  return result;
}
