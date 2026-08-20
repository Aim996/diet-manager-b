import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import { validateAndFreezeMealFactPayload } from "../authority/meal-fact.js";
import {
  createMealFactIdentity,
  mealFactIdentityEquals,
  type MealFactIdentity,
} from "../authority/meal-fact-identity.js";
import {
  validateAndFreezeResolvedNutritionEvidence,
  type ResolvedNutritionEvidence,
} from "../nutrition/types.js";
import type { CoreCorrectionTargetReference } from "../parser/types.js";
import { authenticateStoredPreviewAuthority, type StoredPreviewAuthority } from "../preview/store.js";
import type { NutritionVector, StructuredAmount } from "../domain/types.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
import { reservationFromEventPayload } from "./progress-reservation.js";

export interface EffectiveMealItemSnapshot {
  readonly item_id: string;
  readonly item_order: number;
  readonly item_type: string;
  readonly normalized_name: string;
  readonly amount: StructuredAmount;
  readonly nutrition_sources: readonly unknown[];
  readonly nutrition_evidence?: Readonly<ResolvedNutritionEvidence>;
}

export interface EffectiveMealSnapshot {
  readonly active: boolean;
  readonly occurred_at: string;
  readonly meal_slot: string;
  readonly location: "home" | "outside";
  readonly timezone: "Asia/Shanghai";
  readonly items: readonly EffectiveMealItemSnapshot[];
}

export interface EffectiveMealState {
  readonly revision: number;
  readonly snapshot: EffectiveMealSnapshot;
}

export interface ResolveCorrectionTargetInput {
  readonly database: DatabaseSync;
  readonly authoritySecret: Uint8Array;
  readonly conversationId: string;
  readonly reference: CoreCorrectionTargetReference;
}

export interface ResolvedCorrectionTarget {
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly active: boolean;
  readonly event_kind: "diet_meal";
}

// 以下两个解析辅助与 effect-bundle.ts 内同名实现保持逐字一致，以稳定既有错误码语义。
// 单独复制（而非 import effect-bundle）是为了避免 domain → repository → domain 的循环依赖：
// effect-bundle.ts 需要 import 本文件的 readEffectiveMealState。
function parseCanonical(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}_json`);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    canonicalJson(parsed) !== value
  ) {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}_canonical`);
  }
  return parsed as Record<string, unknown>;
}

function validatedMealFactPayload(
  value: unknown,
  occurredAt: string,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    return validateAndFreezeMealFactPayload(value, {
      occurredAt,
      path: label,
    });
  } catch {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  }
}

function exactKeys(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  if (Object.keys(value).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  }
}

function storedNullableMicrounits(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  }
  return value as number;
}

function storedStructuredAmount(value: unknown, label: string): StructuredAmount {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  }
  const amount = value as Record<string, unknown>;
  exactKeys(amount, [
    "evidence",
    "inventory_deduction_microunits",
    "nutrition_adoption_microunits",
    "observed_microunits",
    "template_reference_microunits",
    "unit",
  ], label);
  if (
    typeof amount.unit !== "string" || amount.unit.length === 0 ||
    amount.unit.length > 256 || /[\u0000-\u001f\x7f]/.test(amount.unit)
  ) throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  const observed = storedNullableMicrounits(amount.observed_microunits, `${label}_observed`);
  const adoption = storedNullableMicrounits(amount.nutrition_adoption_microunits, `${label}_adoption`);
  const deduction = storedNullableMicrounits(amount.inventory_deduction_microunits, `${label}_deduction`);
  const template = storedNullableMicrounits(amount.template_reference_microunits, `${label}_template`);
  if (observed === null) {
    if (
      adoption !== null || deduction !== null || template !== null ||
      amount.evidence !== "unknown"
    ) throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  } else if (
    amount.evidence !== "explicit" && amount.evidence !== "estimated_upper_bound"
  ) throw new Error(`MEAL_EFFECT_AUTHORITY_INVALID:${label}`);
  return Object.freeze({
    unit: amount.unit,
    observed_microunits: observed,
    nutrition_adoption_microunits: adoption,
    inventory_deduction_microunits: deduction,
    template_reference_microunits: template,
    evidence: amount.evidence,
  }) as StructuredAmount;
}

function freezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeJson(child);
    return Object.freeze(value);
  }
  return value;
}

export interface MealEventIdentityRow {
  readonly envelope_id: string;
  readonly operation_id: string;
  readonly schema_version: "domain/v2";
  readonly event_type: "diet_meal";
  readonly fact_kind: "meal";
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly occurred_at_text: string;
  readonly meal_id: string;
  readonly meal_slot: string;
  readonly input_digest: string;
  readonly idempotency_input_digest: string;
  readonly preview_payload_json: string;
}

export interface InitialMealEventAuthenticationInput {
  readonly database: DatabaseSync;
  readonly authoritySecret: Uint8Array;
  readonly eventId: string;
  readonly row: MealEventIdentityRow;
  readonly eventPayload: Readonly<Record<string, unknown>>;
  readonly items: readonly {
    readonly item_id: string;
    readonly item_order: number;
    readonly item_type: string;
    readonly normalized_name: string;
    readonly payload: Record<string, unknown>;
  }[];
}

/**
 * 认证单个初始 meal 事件的存储预览：校验预览 MAC、绑定（envelope/input_digest）以及
 * 与预览材料中 meal_fact_identities 的逐字段一致性。任何失败统一抛
 * MEAL_EVENT_AUTHENTICATION_INVALID:*，由调用方映射为各自的对外错误码。
 * 这是 query.ts 与 correction-target.ts 共享的"签名规则"单一来源。
 */
export function authenticateInitialMealEvent(input: InitialMealEventAuthenticationInput): void {
  let previewAuthority: StoredPreviewAuthority;
  try {
    previewAuthority = authenticateStoredPreviewAuthority(
      input.row.preview_payload_json,
      input.authoritySecret,
    );
  } catch {
    throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:preview_authority");
  }
  if (input.row.input_digest !== input.row.idempotency_input_digest) {
    throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
  }
  const binding = previewAuthority.binding;
  if (binding.preview_id !== input.row.envelope_id || binding.input_digest !== input.row.input_digest) {
    throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
  }
  if (
    previewAuthority.preview_authority_kind === "diet-manager/server-preview/v2" ||
    previewAuthority.preview_authority_kind === "diet-manager/server-preview/v4"
  ) {
    const material = previewAuthority.preview_authority_kind === "diet-manager/server-preview/v2"
      ? previewAuthority.meal_fact_preview_material
      : previewAuthority.purchase_fact_preview_material;
    if (material === undefined || material.input_digest !== input.row.input_digest) {
      throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
    }
    const storedMealIds = input.database.prepare(
      `SELECT event_id FROM event_records
       WHERE envelope_id = ? AND event_type = 'diet_meal'
       ORDER BY event_id`,
    ).all(input.row.envelope_id) as Array<{ event_id: string }>;
    const expectedMealIds = material.meal_fact_identities
      .map((identity) => identity.event_id)
      .sort();
    if (
      storedMealIds.length !== expectedMealIds.length ||
      storedMealIds.some((stored, index) => stored.event_id !== expectedMealIds[index])
    ) throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
    const expected = material.meal_fact_identities.find((identity) =>
      identity.event_id === input.eventId && identity.operation_id === input.row.operation_id);
    if (!expected) throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
    let actual: MealFactIdentity;
    try {
      actual = createMealFactIdentity({
        sequence: expected.sequence,
        event_id: input.eventId,
        operation_id: input.row.operation_id,
        schema_version: input.row.schema_version,
        event_type: input.row.event_type,
        fact_kind: input.row.fact_kind,
        source_message_id: input.row.source_message_id,
        conversation_id: input.row.conversation_id,
        received_at: input.row.received_at,
        occurred_at_text: input.row.occurred_at_text,
        meal_id: input.row.meal_id,
        meal_slot: input.row.meal_slot,
        payload: input.eventPayload,
        items: input.items,
      });
    } catch {
      throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
    }
    if (!mealFactIdentityEquals(actual, expected)) {
      throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
    }
  } else if (
    ["source_text", "occurred_time", "subject", "context"].some((field) =>
      Object.hasOwn(input.eventPayload, field))
  ) {
    throw new Error("MEAL_EVENT_AUTHENTICATION_INVALID:identity");
  }
}

export function readEffectiveMealState(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  targetEventId: string,
): EffectiveMealState {
  const event = database.prepare(
    `SELECT e.event_id, e.envelope_id, e.operation_id, e.schema_version, e.event_type,
            e.fact_kind, e.source_message_id, e.conversation_id, e.received_at,
            e.occurred_at_text, e.meal_id, e.meal_slot, e.payload_json,
            c.input_digest, i.input_digest AS idempotency_input_digest,
            c.payload_json AS preview_payload_json
     FROM event_records e
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     JOIN idempotency_records i ON i.operation_id = c.envelope_id AND i.idempotency_key = c.idempotency_key
     WHERE e.event_id = ? AND e.event_type = 'diet_meal'`,
  ).get(targetEventId) as ({
    event_id: string;
    occurred_at_text: string;
    meal_slot: string;
    payload_json: string;
  } & MealEventIdentityRow) | undefined;
  if (!event) throw new Error("CORRECTION_TARGET_INVALID:event");
  const parsedEventPayload = parseCanonical(event.payload_json, "correction_target_event");
  const eventPayload = validatedMealFactPayload(
    parsedEventPayload,
    event.occurred_at_text,
    "correction_target_event",
  );
  reservationFromEventPayload(eventPayload, "diet_meal");
  if (
    eventPayload.authority_kind !== "diet-manager/meal-fact/v1" ||
    (eventPayload.location !== "home" && eventPayload.location !== "outside") ||
    eventPayload.timezone !== "Asia/Shanghai"
  ) throw new Error("CORRECTION_TARGET_INVALID:event_payload");
  const itemRows = database.prepare(
    `SELECT item_id, item_order, item_type, normalized_name, payload_json
     FROM meal_items WHERE event_id = ? ORDER BY item_order`,
  ).all(targetEventId) as Array<{
    item_id: string;
    item_order: number;
    item_type: string;
    normalized_name: string;
    payload_json: string;
  }>;
  if (itemRows.length === 0) throw new Error("CORRECTION_TARGET_INVALID:items");
  const items: EffectiveMealItemSnapshot[] = [];
  const identityItems: Array<InitialMealEventAuthenticationInput["items"][number]> = [];
  for (let index = 0; index < itemRows.length; index += 1) {
    const item = itemRows[index]!;
    if (item.item_order !== index) throw new Error("CORRECTION_TARGET_INVALID:item_order");
    const payload = parseCanonical(item.payload_json, "correction_target_item");
    if (
      payload.authority_kind !== "diet-manager/meal-item/v1" ||
      typeof payload.amount !== "object" || payload.amount === null || Array.isArray(payload.amount) ||
      !Array.isArray(payload.nutrition_sources)
    ) throw new Error("CORRECTION_TARGET_INVALID:item_payload");
    items.push({
      item_id: item.item_id,
      item_order: item.item_order,
      item_type: item.item_type,
      normalized_name: item.normalized_name,
      amount: storedStructuredAmount(payload.amount, "effective_meal_amount"),
      nutrition_sources: payload.nutrition_sources,
      ...(payload.nutrition_evidence === undefined
        ? {}
        : { nutrition_evidence: validateAndFreezeResolvedNutritionEvidence(payload.nutrition_evidence) }),
    });
    identityItems.push({
      item_id: item.item_id,
      item_order: item.item_order,
      item_type: item.item_type,
      normalized_name: item.normalized_name,
      payload,
    });
  }
  try {
    authenticateInitialMealEvent({
      database,
      authoritySecret,
      eventId: targetEventId,
      row: event,
      eventPayload,
      items: identityItems,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MEAL_EVENT_AUTHENTICATION_INVALID:")) {
      throw new Error("CORRECTION_TARGET_INVALID:event_preview");
    }
    throw error;
  }
  let snapshot = freezeJson({
    active: true,
    occurred_at: event.occurred_at_text,
    meal_slot: event.meal_slot,
    location: eventPayload.location,
    timezone: "Asia/Shanghai" as const,
    items,
  }) as EffectiveMealSnapshot;
  let revision = 1;
  const corrections = database.prepare(
    `SELECT c.base_revision, c.payload_json, e.event_type, b.effect_state, b.result_status
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id
       AND e.event_type IN ('diet_correction','nutrition_supplemented')
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE c.target_event_id = ? ORDER BY c.base_revision`,
  ).all(targetEventId) as Array<{
    base_revision: number;
    payload_json: string;
    event_type: "diet_correction" | "nutrition_supplemented";
    effect_state: string;
    result_status: string;
  }>;
  for (const correction of corrections) {
    if (correction.effect_state === "pending") {
      throw new Error("CORRECTION_TARGET_INVALID:pending_correction");
    }
    if (
      !(
        (correction.effect_state === "succeeded" && correction.result_status === "applied") ||
        (correction.effect_state === "permanent_business_skip" &&
          correction.result_status === "applied_with_issues")
      )
    ) {
      throw new Error("CORRECTION_TARGET_INVALID:chain_state");
    }
    const payload = parseCanonical(correction.payload_json, "correction_chain");
    reservationFromEventPayload(payload, correction.event_type);
    if (
      correction.base_revision !== revision || payload.base_revision !== revision ||
      payload.target_event_id !== targetEventId ||
      payload.authority_kind !== "diet-manager/correction-fact/v1" ||
      canonicalJson(payload.before_snapshot) !== canonicalJson(snapshot) ||
      typeof payload.after_snapshot !== "object" || payload.after_snapshot === null ||
      Array.isArray(payload.after_snapshot)
    ) throw new Error("CORRECTION_TARGET_INVALID:chain");
    snapshot = freezeJson(JSON.parse(canonicalJson(payload.after_snapshot))) as EffectiveMealSnapshot;
    revision += 1;
  }
  return Object.freeze({ revision, snapshot });
}

function invalid(reason: string): never {
  throw new Error(`CORRECTION_TARGET_INVALID:${reason}`);
}

function resolveLatestMealEventId(database: DatabaseSync, conversationId: string): string {
  const rows = database.prepare(
    `SELECT event_id, received_at
     FROM event_records
     WHERE conversation_id = ? AND event_type = 'diet_meal'
     ORDER BY received_at DESC, event_id DESC LIMIT 2`,
  ).all(conversationId) as Array<{ event_id: string; received_at: string }>;
  if (rows.length === 0) throw new Error("CORRECTION_TARGET_NOT_FOUND");
  if (rows.length === 2 && rows[0]!.received_at === rows[1]!.received_at) {
    throw new Error("CORRECTION_TARGET_AMBIGUOUS");
  }
  return rows[0]!.event_id;
}

function resolveSoleActiveMealEventId(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  conversationId: string,
): string {
  const rows = database.prepare(
    `SELECT event_id FROM event_records
     WHERE conversation_id = ? AND event_type = 'diet_meal'
     ORDER BY received_at DESC, event_id DESC`,
  ).all(conversationId) as Array<{ event_id: string }>;
  let activeEventId: string | undefined;
  for (const row of rows) {
    const state = readEffectiveMealState(database, authoritySecret, row.event_id);
    if (!state.snapshot.active) continue;
    if (activeEventId !== undefined) throw new Error("CORRECTION_TARGET_AMBIGUOUS");
    activeEventId = row.event_id;
  }
  if (activeEventId === undefined) throw new Error("CORRECTION_TARGET_NOT_FOUND");
  return activeEventId;
}

export function resolveCorrectionTarget(input: ResolveCorrectionTargetInput): ResolvedCorrectionTarget {
  if (typeof input.database !== "object" || input.database === null) return invalid("database");
  if (
    !(input.authoritySecret instanceof Uint8Array) ||
    input.authoritySecret.byteLength < 32 ||
    input.authoritySecret.byteLength > 1024
  ) return invalid("authority_secret");
  if (
    typeof input.conversationId !== "string" ||
    input.conversationId.length === 0 ||
    input.conversationId.length > 256
  ) return invalid("conversation_id");
  const reference = input.reference;
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
    return invalid("reference");
  }
  assertCurrentMigrationAuthority(input.database);
  let targetEventId: string;
  if (reference.kind === "event_id") {
    if (
      typeof reference.event_id !== "string" ||
      reference.event_id.length === 0 ||
      reference.event_id.length > 256
    ) return invalid("reference");
    const row = input.database.prepare(
      `SELECT event_id FROM event_records
       WHERE event_id = ? AND conversation_id = ? AND event_type = 'diet_meal'`,
    ).get(reference.event_id, input.conversationId) as { event_id: string } | undefined;
    if (row === undefined) throw new Error("CORRECTION_TARGET_NOT_FOUND");
    targetEventId = reference.event_id;
  } else if (reference.kind === "latest_meal_in_conversation") {
    targetEventId = resolveLatestMealEventId(input.database, input.conversationId);
  } else if (reference.kind === "sole_active_meal_in_conversation") {
    targetEventId = resolveSoleActiveMealEventId(
      input.database,
      input.authoritySecret,
      input.conversationId,
    );
  } else {
    return invalid("reference");
  }
  const state = readEffectiveMealState(input.database, input.authoritySecret, targetEventId);
  return Object.freeze({
    target_event_id: targetEventId,
    base_revision: state.revision,
    active: state.snapshot.active,
    event_kind: "diet_meal",
  });
}

export interface EffectiveWaterSnapshot {
  readonly active: boolean;
  readonly classification: "plain_water" | "nutritious_drink";
  readonly replacement_name: string | null;
  readonly occurred_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly plain_water_ml_milli: number;
  readonly nutrients: NutritionVector;
}

export interface EffectiveWaterState {
  readonly revision: number;
  readonly snapshot: EffectiveWaterSnapshot;
}

export interface ResolveWaterCorrectionTargetInput {
  readonly database: DatabaseSync;
  readonly authoritySecret: Uint8Array;
  readonly conversationId: string;
  readonly reference: CoreCorrectionTargetReference;
}

export interface ResolvedWaterCorrectionTarget {
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly active: boolean;
  readonly event_kind: "diet_water";
}

/**
 * 认证单个白水事件及其纠正链的当前有效状态。白水事实权威由
 * reservationFromEventPayload(payload, "diet_water") 校验（精确键 + occurred_time +
 * contribution 保留）。纠正链仅接受 operation='change_food_type'，before/after 快照
 * 为白水快照（分类/替换名/水毫升/营养向量），与 readEffectiveMealState 同构。
 */
export function readEffectiveWaterState(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  targetEventId: string,
): EffectiveWaterState {
  const event = database.prepare(
    `SELECT event_id, occurred_at_text, payload_json
     FROM event_records
     WHERE event_id = ? AND event_type = 'diet_water'`,
  ).get(targetEventId) as { event_id: string; occurred_at_text: string; payload_json: string } | undefined;
  if (!event) throw new Error("CORRECTION_TARGET_INVALID:event");
  const parsedEventPayload = parseCanonical(event.payload_json, "correction_target_event");
  reservationFromEventPayload(parsedEventPayload, "diet_water");
  const eventPayload = parsedEventPayload as Record<string, unknown>;
  if (
    eventPayload.authority_kind !== "diet-manager/water-fact/v1" ||
    eventPayload.timezone !== "Asia/Shanghai" ||
    !Number.isSafeInteger(eventPayload.plain_water_ml_milli) ||
    (eventPayload.plain_water_ml_milli as number) <= 0
  ) throw new Error("CORRECTION_TARGET_INVALID:event_payload");
  const waterMlMilli = eventPayload.plain_water_ml_milli as number;
  let snapshot = freezeJson({
    active: true,
    classification: "plain_water" as const,
    replacement_name: null,
    occurred_at: event.occurred_at_text,
    timezone: "Asia/Shanghai" as const,
    plain_water_ml_milli: waterMlMilli,
    nutrients: {
      energy_kcal_milli: null, protein_mg: null, fat_mg: null,
      carbohydrate_mg: null, fiber_mg: null, water_ml_milli: waterMlMilli,
    },
  }) as EffectiveWaterSnapshot;
  let revision = 1;
  const corrections = database.prepare(
    `SELECT c.base_revision, c.payload_json, e.event_type, b.effect_state, b.result_status
     FROM correction_events c
     JOIN event_records e ON e.operation_id = c.request_id
       AND e.event_type IN ('diet_correction','nutrition_supplemented')
     JOIN effect_bundle_commits b
       ON b.envelope_id = e.envelope_id AND b.operation_id = e.operation_id
     WHERE c.target_event_id = ? ORDER BY c.base_revision`,
  ).all(targetEventId) as Array<{
    base_revision: number;
    payload_json: string;
    event_type: "diet_correction" | "nutrition_supplemented";
    effect_state: string;
    result_status: string;
  }>;
  for (const correction of corrections) {
    if (correction.effect_state === "pending") {
      throw new Error("CORRECTION_TARGET_INVALID:pending_correction");
    }
    if (
      !(
        (correction.effect_state === "succeeded" && correction.result_status === "applied") ||
        (correction.effect_state === "permanent_business_skip" &&
          correction.result_status === "applied_with_issues")
      )
    ) {
      throw new Error("CORRECTION_TARGET_INVALID:chain_state");
    }
    const payload = parseCanonical(correction.payload_json, "correction_chain");
    reservationFromEventPayload(payload, correction.event_type);
    if (
      correction.base_revision !== revision || payload.base_revision !== revision ||
      payload.target_event_id !== targetEventId ||
      payload.authority_kind !== "diet-manager/correction-fact/v1" ||
      payload.operation !== "change_food_type" ||
      canonicalJson(payload.before_snapshot) !== canonicalJson(snapshot) ||
      typeof payload.after_snapshot !== "object" || payload.after_snapshot === null ||
      Array.isArray(payload.after_snapshot)
    ) throw new Error("CORRECTION_TARGET_INVALID:chain");
    snapshot = freezeJson(JSON.parse(canonicalJson(payload.after_snapshot))) as EffectiveWaterSnapshot;
    revision += 1;
  }
  return Object.freeze({ revision, snapshot });
}

function resolveLatestWaterEventId(database: DatabaseSync, conversationId: string): string {
  const rows = database.prepare(
    `SELECT event_id, received_at
     FROM event_records
     WHERE conversation_id = ? AND event_type = 'diet_water'
     ORDER BY received_at DESC, event_id DESC LIMIT 2`,
  ).all(conversationId) as Array<{ event_id: string; received_at: string }>;
  if (rows.length === 0) throw new Error("CORRECTION_TARGET_NOT_FOUND");
  if (rows.length === 2 && rows[0]!.received_at === rows[1]!.received_at) {
    throw new Error("CORRECTION_TARGET_AMBIGUOUS");
  }
  return rows[0]!.event_id;
}

export function resolveWaterCorrectionTarget(
  input: ResolveWaterCorrectionTargetInput,
): ResolvedWaterCorrectionTarget {
  if (typeof input.database !== "object" || input.database === null) return invalid("database");
  if (
    !(input.authoritySecret instanceof Uint8Array) ||
    input.authoritySecret.byteLength < 32 ||
    input.authoritySecret.byteLength > 1024
  ) return invalid("authority_secret");
  if (
    typeof input.conversationId !== "string" ||
    input.conversationId.length === 0 ||
    input.conversationId.length > 256
  ) return invalid("conversation_id");
  const reference = input.reference;
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
    return invalid("reference");
  }
  assertCurrentMigrationAuthority(input.database);
  let targetEventId: string;
  if (reference.kind === "event_id") {
    if (
      typeof reference.event_id !== "string" ||
      reference.event_id.length === 0 ||
      reference.event_id.length > 256
    ) return invalid("reference");
    const row = input.database.prepare(
      `SELECT event_id FROM event_records
       WHERE event_id = ? AND conversation_id = ? AND event_type = 'diet_water'`,
    ).get(reference.event_id, input.conversationId) as { event_id: string } | undefined;
    if (row === undefined) throw new Error("CORRECTION_TARGET_NOT_FOUND");
    targetEventId = reference.event_id;
  } else if (reference.kind === "latest_water_in_conversation") {
    targetEventId = resolveLatestWaterEventId(input.database, input.conversationId);
  } else {
    return invalid("reference");
  }
  const state = readEffectiveWaterState(input.database, input.authoritySecret, targetEventId);
  return Object.freeze({
    target_event_id: targetEventId,
    base_revision: state.revision,
    active: state.snapshot.active,
    event_kind: "diet_water",
  });
}
