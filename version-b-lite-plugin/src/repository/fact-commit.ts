import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  dietManagerActions,
  type DietManagerAction,
} from "../contracts.js";
import { authorizeRepositoryPreview } from "../preview/store.js";
import { assertEnvelopeTransition } from "../state/transition-guard.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

const INPUT_FIELDS = [
  "commandType",
  "dataRevision",
  "database",
  "effects",
  "event",
  "inputDigest",
  "items",
  "secret",
  "subjectScope",
  "token",
  "traceId",
] as const;

const EVENT_FIELDS = [
  "committedAt",
  "conversationId",
  "eventId",
  "eventType",
  "factKind",
  "mealId",
  "mealSlot",
  "occurredAtText",
  "operationId",
  "payload",
  "receivedAt",
  "schemaVersion",
  "sourceMessageId",
] as const;

const ITEM_FIELDS = [
  "itemId",
  "itemOrder",
  "itemType",
  "normalizedName",
  "payload",
] as const;

const EFFECT_FIELDS = [
  "effectId",
  "effectKind",
  "outboxId",
  "previousState",
  "reason",
] as const;

export interface PreparedFactEvent {
  eventId: string;
  operationId: string;
  schemaVersion: string;
  eventType: string;
  factKind: string;
  sourceMessageId: string;
  conversationId: string;
  receivedAt: string;
  committedAt: string;
  occurredAtText: string | null;
  mealId: string | null;
  mealSlot: string | null;
  payload: unknown;
}

export interface PreparedMealItem {
  itemId: string;
  itemOrder: number;
  itemType: string;
  normalizedName: string;
  payload: unknown;
}

export interface PreparedEffectIntent {
  outboxId: string;
  effectId: string;
  effectKind: string;
  previousState: string | null;
  reason: string | null;
}

export interface PreparedFactCommit {
  database: DatabaseSync;
  secret: Uint8Array;
  token: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
  traceId: string;
  event: PreparedFactEvent;
  items: PreparedMealItem[];
  effects: PreparedEffectIntent[];
}

export type FactCommitFault = "before_commit" | "after_commit_before_reply";

export interface FactCommitFailureEntry {
  phase: "fact_commit";
  error_code: string;
  trace_id: string;
  input_digest: string;
}

export interface FactCommitOptions {
  fault?: FactCommitFault;
  failureSink?: (entry: FactCommitFailureEntry) => void;
}

export interface FactCommitResult {
  envelope_id: string;
  event_id: string;
  operation_id: string;
  idempotency_key: string;
  input_digest: string;
  envelope_state: "effects_pending";
  result_status: "facts_committed_effects_pending";
  item_ids: readonly string[];
  effect_ids: readonly string[];
}

interface FrozenFactEvent extends Omit<PreparedFactEvent, "payload"> {
  payloadJson: string;
}

interface FrozenMealItem extends Omit<PreparedMealItem, "payload"> {
  payloadJson: string;
}

interface FrozenFactCommit {
  database: DatabaseSync;
  secret: Uint8Array;
  token: string;
  inputDigest: string;
  subjectScope: string;
  commandType: DietManagerAction;
  dataRevision: string;
  traceId: string;
  event: FrozenFactEvent;
  items: readonly FrozenMealItem[];
  effects: readonly Readonly<PreparedEffectIntent>[];
}

interface ExistingEventRow {
  event_id: string;
  envelope_id: string;
  operation_id: string;
  schema_version: string;
  event_type: string;
  fact_kind: string;
  source_message_id: string;
  conversation_id: string;
  received_at: string;
  committed_at: string;
  occurred_at_text: string | null;
  result_status: string;
  lifecycle_status: string;
  meal_id: string | null;
  meal_slot: string | null;
  payload_json: string;
}

interface ExistingItemRow {
  item_id: string;
  event_id: string;
  item_order: number;
  item_type: string;
  normalized_name: string;
  payload_json: string;
}

interface ExistingEffectRow {
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
}

function requestInvalid(reason: string): never {
  throw new TypeError(`FACT_COMMIT_REQUEST_INVALID:${reason}`);
}

function exactDataProperties<T extends readonly string[]>(
  value: unknown,
  fields: T,
): Record<T[number], PropertyDescriptor & { value: unknown }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return requestInvalid("shape");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\u0000") !== [...fields].sort().join("\u0000")
  ) {
    return requestInvalid("shape");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return requestInvalid("descriptor");
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return requestInvalid("prototype");
  }
  return descriptors as Record<T[number], PropertyDescriptor & { value: unknown }>;
}

function exactOptions(value: FactCommitOptions | undefined): Readonly<FactCommitOptions> {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return requestInvalid("options");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return requestInvalid("options");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return requestInvalid("options");
  for (const key of keys as string[]) {
    if (key !== "fault" && key !== "failureSink") return requestInvalid("options");
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return requestInvalid("options");
    }
  }
  const fault = descriptors.fault?.value;
  if (
    fault !== undefined &&
    fault !== "before_commit" &&
    fault !== "after_commit_before_reply"
  ) {
    return requestInvalid("fault");
  }
  const failureSink = descriptors.failureSink?.value;
  if (failureSink !== undefined && typeof failureSink !== "function") {
    return requestInvalid("failure_sink");
  }
  return Object.freeze({
    ...(fault === undefined ? {} : { fault }),
    ...(failureSink === undefined ? {} : { failureSink }),
  });
}

function ascii(value: unknown, field: string, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[\x20-\x7E]+$/.test(value)
  ) {
    return requestInvalid(field);
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
    return requestInvalid(field);
  }
  return value;
}

function nullableText(value: unknown, field: string, maxLength = 512): string | null {
  return value === null ? null : text(value, field, maxLength);
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) {
    return requestInvalid("input_digest");
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") return requestInvalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return requestInvalid(field);
  }
  return value;
}

function database(value: unknown): DatabaseSync {
  if (typeof value !== "object" || value === null) return requestInvalid("database");
  return value as DatabaseSync;
}

function secret(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) return requestInvalid("secret");
  return Uint8Array.from(value);
}

function command(value: unknown): DietManagerAction {
  if (
    typeof value !== "string" ||
    !dietManagerActions.includes(value as DietManagerAction)
  ) {
    return requestInvalid("command_type");
  }
  return value as DietManagerAction;
}

function denseArray(value: unknown, field: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) return requestInvalid(field);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return requestInvalid(field);
  }
  return value;
}

function freezeEvent(value: unknown): FrozenFactEvent {
  const fields = exactDataProperties(value, EVENT_FIELDS);
  const eventType = ascii(fields.eventType.value, "event_type", 128);
  const mealId = nullableText(fields.mealId.value, "meal_id", 256);
  const mealSlot = nullableText(fields.mealSlot.value, "meal_slot", 128);
  if (eventType === "diet_meal" && (mealId === null || mealSlot === null)) {
    return requestInvalid("meal_identity");
  }
  return Object.freeze({
    eventId: ascii(fields.eventId.value, "event_id"),
    operationId: ascii(fields.operationId.value, "operation_id"),
    schemaVersion: ascii(fields.schemaVersion.value, "schema_version", 128),
    eventType,
    factKind: ascii(fields.factKind.value, "fact_kind", 128),
    sourceMessageId: ascii(fields.sourceMessageId.value, "source_message_id"),
    conversationId: ascii(fields.conversationId.value, "conversation_id"),
    receivedAt: timestamp(fields.receivedAt.value, "received_at"),
    committedAt: timestamp(fields.committedAt.value, "committed_at"),
    occurredAtText: nullableText(fields.occurredAtText.value, "occurred_at_text", 128),
    mealId,
    mealSlot,
    payloadJson: canonicalJson(fields.payload.value),
  });
}

function freezeItems(value: unknown): readonly FrozenMealItem[] {
  const items = denseArray(value, "items", 256).map((candidate, index) => {
    const fields = exactDataProperties(candidate, ITEM_FIELDS);
    if (!Number.isSafeInteger(fields.itemOrder.value) || fields.itemOrder.value !== index) {
      return requestInvalid("item_order");
    }
    return Object.freeze({
      itemId: ascii(fields.itemId.value, "item_id"),
      itemOrder: index,
      itemType: ascii(fields.itemType.value, "item_type", 128),
      normalizedName: text(fields.normalizedName.value, "normalized_name"),
      payloadJson: canonicalJson(fields.payload.value),
    });
  });
  if (new Set(items.map((item) => item.itemId)).size !== items.length) {
    return requestInvalid("item_id_duplicate");
  }
  return Object.freeze(items);
}

function freezeEffects(value: unknown): readonly Readonly<PreparedEffectIntent>[] {
  const effects = denseArray(value, "effects", 256).map((candidate) => {
    const fields = exactDataProperties(candidate, EFFECT_FIELDS);
    return Object.freeze({
      outboxId: ascii(fields.outboxId.value, "outbox_id"),
      effectId: ascii(fields.effectId.value, "effect_id"),
      effectKind: ascii(fields.effectKind.value, "effect_kind", 128),
      previousState: nullableText(fields.previousState.value, "previous_state", 128),
      reason: nullableText(fields.reason.value, "reason", 512),
    });
  });
  if (new Set(effects.map((effect) => effect.outboxId)).size !== effects.length) {
    return requestInvalid("outbox_id_duplicate");
  }
  if (new Set(effects.map((effect) => effect.effectId)).size !== effects.length) {
    return requestInvalid("effect_id_duplicate");
  }
  return Object.freeze(effects);
}

function freezeInput(value: PreparedFactCommit): FrozenFactCommit {
  const fields = exactDataProperties(value, INPUT_FIELDS);
  const event = freezeEvent(fields.event.value);
  const items = freezeItems(fields.items.value);
  if (event.eventType === "diet_meal" && items.length === 0) {
    return requestInvalid("items");
  }
  return Object.freeze({
    database: database(fields.database.value),
    secret: secret(fields.secret.value),
    token: ascii(fields.token.value, "token", 4096),
    inputDigest: digest(fields.inputDigest.value),
    subjectScope: ascii(fields.subjectScope.value, "subject_scope"),
    commandType: command(fields.commandType.value),
    dataRevision: ascii(fields.dataRevision.value, "data_revision"),
    traceId: ascii(fields.traceId.value, "trace_id"),
    event,
    items,
    effects: freezeEffects(fields.effects.value),
  });
}

function resultFor(
  input: FrozenFactCommit,
  envelopeId: string,
  idempotencyKey: string,
): FactCommitResult {
  return Object.freeze({
    envelope_id: envelopeId,
    event_id: input.event.eventId,
    operation_id: input.event.operationId,
    idempotency_key: idempotencyKey,
    input_digest: input.inputDigest,
    envelope_state: "effects_pending",
    result_status: "facts_committed_effects_pending",
    item_ids: Object.freeze(input.items.map((item) => item.itemId)),
    effect_ids: Object.freeze(input.effects.map((effect) => effect.effectId)),
  });
}

function sameValue(actual: unknown, expected: unknown): boolean {
  return actual === expected;
}

function assertReplayRows(
  input: FrozenFactCommit,
  envelopeId: string,
  idempotencyKey: string,
): FactCommitResult {
  const eventRows = input.database
    .prepare("SELECT * FROM event_records WHERE envelope_id = ? ORDER BY event_id")
    .all(envelopeId) as unknown as ExistingEventRow[];
  if (eventRows.length !== 1) throw new Error("FACT_COMMIT_AUTHORITY_INVALID:event_count");
  const row = eventRows[0];
  const event = input.event;
  const eventMatches =
    sameValue(row.event_id, event.eventId) &&
    sameValue(row.operation_id, event.operationId) &&
    sameValue(row.schema_version, event.schemaVersion) &&
    sameValue(row.event_type, event.eventType) &&
    sameValue(row.fact_kind, event.factKind) &&
    sameValue(row.source_message_id, event.sourceMessageId) &&
    sameValue(row.conversation_id, event.conversationId) &&
    sameValue(row.received_at, event.receivedAt) &&
    sameValue(row.committed_at, event.committedAt) &&
    sameValue(row.occurred_at_text, event.occurredAtText) &&
    sameValue(row.result_status, "facts_committed_effects_pending") &&
    sameValue(row.lifecycle_status, "active") &&
    sameValue(row.meal_id, event.mealId) &&
    sameValue(row.meal_slot, event.mealSlot) &&
    sameValue(row.payload_json, event.payloadJson);
  if (!eventMatches) throw new Error("IDEMPOTENCY_CONFLICT:fact_identity");

  const itemRows = input.database
    .prepare("SELECT * FROM meal_items WHERE event_id = ? ORDER BY item_order")
    .all(event.eventId) as unknown as ExistingItemRow[];
  if (
    itemRows.length !== input.items.length ||
    itemRows.some((itemRow, index) => {
      const expected = input.items[index];
      return !(
        itemRow.item_id === expected.itemId &&
        itemRow.event_id === event.eventId &&
        itemRow.item_order === expected.itemOrder &&
        itemRow.item_type === expected.itemType &&
        itemRow.normalized_name === expected.normalizedName &&
        itemRow.payload_json === expected.payloadJson
      );
    })
  ) {
    throw new Error("IDEMPOTENCY_CONFLICT:fact_items");
  }

  const effectRows = input.database
    .prepare("SELECT * FROM effect_outbox WHERE envelope_id = ? ORDER BY outbox_id")
    .all(envelopeId) as unknown as ExistingEffectRow[];
  const expectedEffects = [...input.effects].sort((left, right) =>
    left.outboxId.localeCompare(right.outboxId, "en-US"),
  );
  if (
    effectRows.length !== expectedEffects.length ||
    effectRows.some((effectRow, index) => {
      const expected = expectedEffects[index];
      return !(
        effectRow.outbox_id === expected.outboxId &&
        effectRow.envelope_id === envelopeId &&
        effectRow.operation_id === event.operationId &&
        effectRow.effect_id === expected.effectId &&
        effectRow.effect_kind === expected.effectKind &&
        effectRow.previous_state === expected.previousState &&
        effectRow.state === "pending" &&
        effectRow.attempt_count === 0 &&
        effectRow.reason === expected.reason &&
        effectRow.created_at === event.committedAt &&
        effectRow.updated_at === event.committedAt
      );
    })
  ) {
    throw new Error("IDEMPOTENCY_CONFLICT:fact_effects");
  }
  return resultFor(input, envelopeId, idempotencyKey);
}

function changed(database: DatabaseSync): number {
  const row = database.prepare("SELECT changes() AS count").get() as { count: number };
  return row.count;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error) || error.message.length === 0) return "FACT_COMMIT_FAILED";
  const code = error.message.split(":", 1)[0];
  return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "FACT_COMMIT_FAILED";
}

function emitFailure(
  sink: FactCommitOptions["failureSink"],
  input: FrozenFactCommit,
  error: unknown,
): void {
  if (!sink) return;
  const entry = Object.freeze({
    phase: "fact_commit" as const,
    error_code: errorCode(error),
    trace_id: input.traceId,
    input_digest: input.inputDigest,
  });
  try {
    sink(entry);
  } catch {
    // A diagnostic sink is outside the business transaction and never replaces its error.
  }
}

export function commitPreparedFact(
  input: PreparedFactCommit,
  options?: FactCommitOptions,
): FactCommitResult {
  const frozen = freezeInput(input);
  const frozenOptions = exactOptions(options);
  let transactionOpen = false;
  let transactionCommitted = false;

  try {
    frozen.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertCurrentMigrationAuthority(frozen.database);
    const authority = authorizeRepositoryPreview({
      database: frozen.database,
      secret: frozen.secret,
      token: frozen.token,
      inputDigest: frozen.inputDigest,
      subjectScope: frozen.subjectScope,
      commandType: frozen.commandType,
      dataRevision: frozen.dataRevision,
    });

    if (authority.envelope_state === "effects_pending") {
      const replay = assertReplayRows(
        frozen,
        authority.binding.preview_id,
        authority.idempotency_key,
      );
      frozen.database.exec("ROLLBACK");
      transactionOpen = false;
      return replay;
    }

    const event = frozen.event;
    frozen.database
      .prepare(
        `INSERT INTO event_records(
          event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
          source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
          result_status, lifecycle_status, meal_id, meal_slot, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        authority.binding.preview_id,
        event.operationId,
        event.schemaVersion,
        event.eventType,
        event.factKind,
        event.sourceMessageId,
        event.conversationId,
        event.receivedAt,
        event.committedAt,
        event.occurredAtText,
        "facts_committed_effects_pending",
        "active",
        event.mealId,
        event.mealSlot,
        event.payloadJson,
      );

    const insertItem = frozen.database.prepare(
      `INSERT INTO meal_items(
        item_id, event_id, item_order, item_type, normalized_name, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of frozen.items) {
      insertItem.run(
        item.itemId,
        event.eventId,
        item.itemOrder,
        item.itemType,
        item.normalizedName,
        item.payloadJson,
      );
    }

    const insertEffect = frozen.database.prepare(
      `INSERT INTO effect_outbox(
        outbox_id, envelope_id, operation_id, effect_id, effect_kind,
        previous_state, state, attempt_count, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    );
    for (const effect of frozen.effects) {
      insertEffect.run(
        effect.outboxId,
        authority.binding.preview_id,
        event.operationId,
        effect.effectId,
        effect.effectKind,
        effect.previousState,
        effect.reason,
        event.committedAt,
        event.committedAt,
      );
    }

    assertEnvelopeTransition("received", "facts_committed");
    frozen.database
      .prepare(
        `UPDATE command_envelopes
         SET state = 'facts_committed', result_status = 'facts_committed', committed_at = ?
         WHERE envelope_id = ? AND state = 'received' AND result_status = 'preview_ready'`,
      )
      .run(event.committedAt, authority.binding.preview_id);
    if (changed(frozen.database) !== 1) {
      throw new Error("FACT_COMMIT_AUTHORITY_INVALID:received_compare_and_set");
    }

    assertEnvelopeTransition("facts_committed", "effects_pending");
    frozen.database
      .prepare(
        `UPDATE command_envelopes
         SET state = 'effects_pending', result_status = 'facts_committed_effects_pending'
         WHERE envelope_id = ? AND state = 'facts_committed' AND result_status = 'facts_committed'`,
      )
      .run(authority.binding.preview_id);
    if (changed(frozen.database) !== 1) {
      throw new Error("FACT_COMMIT_AUTHORITY_INVALID:effects_compare_and_set");
    }

    frozen.database
      .prepare(
        `UPDATE idempotency_records
         SET state = 'effects_pending', updated_at = ?
         WHERE idempotency_key = ? AND operation_id = ? AND input_digest = ?
           AND state = 'preview_ready' AND terminal_result_json IS NULL`,
      )
      .run(
        event.committedAt,
        authority.idempotency_key,
        authority.binding.preview_id,
        frozen.inputDigest,
      );
    if (changed(frozen.database) !== 1) {
      throw new Error("FACT_COMMIT_AUTHORITY_INVALID:idempotency_compare_and_set");
    }

    if (frozenOptions.fault === "before_commit") {
      throw new Error("FACT_COMMIT_FAILED:before_commit");
    }

    frozen.database.exec("COMMIT");
    transactionOpen = false;
    transactionCommitted = true;
    const result = resultFor(
      frozen,
      authority.binding.preview_id,
      authority.idempotency_key,
    );
    if (frozenOptions.fault === "after_commit_before_reply") {
      throw new Error("FACT_COMMIT_RESPONSE_LOST:after_commit_before_reply");
    }
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        frozen.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary repository failure.
      }
    }
    if (!transactionCommitted) emitFailure(frozenOptions.failureSink, frozen, error);
    throw error;
  }
}
