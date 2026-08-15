import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { validateAndFreezeMealFactPayload } from "./meal-fact.js";

const DIGEST_PATTERN = /^[A-F0-9]{64}$/u;

export interface MealFactItemIdentity {
  readonly item_id: string;
  readonly item_order: number;
  readonly item_type: string;
  readonly normalized_name_digest: string;
  readonly payload_digest: string;
}

export interface MealFactIdentity {
  readonly sequence: number;
  readonly event_id: string;
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
  readonly location: "home" | "outside";
  readonly payload_digest: string;
  readonly items: readonly MealFactItemIdentity[];
}

export interface MealFactPreviewMaterial {
  readonly authority_kind: "diet-manager/domain-preview/v2";
  readonly input_digest: string;
  readonly meal_fact_identities: readonly MealFactIdentity[];
}

interface MealFactIdentityInput {
  readonly sequence: number;
  readonly event_id: string;
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
  readonly payload: unknown;
  readonly items: readonly {
    readonly item_id: string;
    readonly item_order: number;
    readonly item_type: string;
    readonly normalized_name: string;
    readonly payload: unknown;
  }[];
}

function invalid(reason: string): never {
  throw new TypeError(`MEAL_FACT_IDENTITY_INVALID:${reason}`);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  reason: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(reason);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return invalid(reason);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, reason: string, maxLength = 256): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    value.includes("\u0000")
  ) return invalid(reason);
  return value;
}

function digest(value: unknown, reason: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) return invalid(reason);
  return value;
}

function sequence(value: unknown, reason: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(reason);
  }
  return value;
}

function canonicalClone(value: unknown): unknown {
  return JSON.parse(canonicalJson(value)) as unknown;
}

function payloadWithoutReservation(
  value: unknown,
  occurredAt: string,
): Readonly<Record<string, unknown>> {
  const payload = validateAndFreezeMealFactPayload(value, { occurredAt });
  return Object.freeze(Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== "progress_reservation"),
  ));
}

export function createMealFactIdentity(input: MealFactIdentityInput): MealFactIdentity {
  const stablePayload = payloadWithoutReservation(input.payload, input.occurred_at_text);
  const itemIdentities = input.items.map((item, index) => {
    if (item.item_order !== index) return invalid("item_order");
    return Object.freeze({
      item_id: text(item.item_id, "item_id"),
      item_order: item.item_order,
      item_type: text(item.item_type, "item_type"),
      normalized_name_digest: canonicalSha256(text(item.normalized_name, "normalized_name")),
      payload_digest: canonicalSha256(item.payload),
    });
  });
  return Object.freeze({
    sequence: sequence(input.sequence, "sequence"),
    event_id: text(input.event_id, "event_id"),
    operation_id: text(input.operation_id, "operation_id"),
    schema_version: input.schema_version === "domain/v2"
      ? input.schema_version
      : invalid("schema_version"),
    event_type: input.event_type === "diet_meal" ? input.event_type : invalid("event_type"),
    fact_kind: input.fact_kind === "meal" ? input.fact_kind : invalid("fact_kind"),
    source_message_id: text(input.source_message_id, "source_message_id"),
    conversation_id: text(input.conversation_id, "conversation_id"),
    received_at: text(input.received_at, "received_at"),
    occurred_at_text: text(input.occurred_at_text, "occurred_at_text"),
    meal_id: text(input.meal_id, "meal_id"),
    meal_slot: text(input.meal_slot, "meal_slot"),
    location: stablePayload.location === "home" || stablePayload.location === "outside"
      ? stablePayload.location
      : invalid("location"),
    payload_digest: canonicalSha256(stablePayload),
    items: Object.freeze(itemIdentities),
  });
}

function parseItemIdentity(value: unknown, expectedOrder: number): MealFactItemIdentity {
  const item = exactRecord(value, [
    "item_id", "item_order", "item_type", "normalized_name_digest", "payload_digest",
  ], "item");
  if (sequence(item.item_order, "item_order") !== expectedOrder) return invalid("item_order");
  return Object.freeze({
    item_id: text(item.item_id, "item_id"),
    item_order: expectedOrder,
    item_type: text(item.item_type, "item_type"),
    normalized_name_digest: digest(item.normalized_name_digest, "normalized_name_digest"),
    payload_digest: digest(item.payload_digest, "payload_digest"),
  });
}

function parseIdentity(value: unknown): MealFactIdentity {
  const identity = exactRecord(value, [
    "sequence", "event_id", "operation_id", "schema_version", "event_type", "fact_kind",
    "source_message_id", "conversation_id", "received_at", "occurred_at_text", "meal_id",
    "meal_slot", "location", "payload_digest", "items",
  ], "identity");
  const operationSequence = sequence(identity.sequence, "sequence");
  if (!Array.isArray(identity.items) || identity.items.length === 0 || identity.items.length > 64) {
    return invalid("items");
  }
  return Object.freeze({
    sequence: operationSequence,
    event_id: text(identity.event_id, "event_id"),
    operation_id: text(identity.operation_id, "operation_id"),
    schema_version: identity.schema_version === "domain/v2"
      ? identity.schema_version
      : invalid("schema_version"),
    event_type: identity.event_type === "diet_meal" ? identity.event_type : invalid("event_type"),
    fact_kind: identity.fact_kind === "meal" ? identity.fact_kind : invalid("fact_kind"),
    source_message_id: text(identity.source_message_id, "source_message_id"),
    conversation_id: text(identity.conversation_id, "conversation_id"),
    received_at: text(identity.received_at, "received_at"),
    occurred_at_text: text(identity.occurred_at_text, "occurred_at_text"),
    meal_id: text(identity.meal_id, "meal_id"),
    meal_slot: text(identity.meal_slot, "meal_slot"),
    location: identity.location === "home" || identity.location === "outside"
      ? identity.location
      : invalid("location"),
    payload_digest: digest(identity.payload_digest, "payload_digest"),
    items: Object.freeze(identity.items.map(parseItemIdentity)),
  });
}

export function parseMealFactPreviewMaterial(value: unknown): MealFactPreviewMaterial {
  const material = exactRecord(canonicalClone(value), [
    "authority_kind", "input_digest", "meal_fact_identities",
  ], "preview_material");
  if (material.authority_kind !== "diet-manager/domain-preview/v2") {
    return invalid("authority_kind");
  }
  if (
    !Array.isArray(material.meal_fact_identities) ||
    material.meal_fact_identities.length === 0 ||
    material.meal_fact_identities.length > 2
  ) return invalid("meal_fact_identities");
  const identities = material.meal_fact_identities.map(parseIdentity);
  if (
    new Set(identities.map((identity) => identity.sequence)).size !== identities.length ||
    identities.some((identity, index) => index > 0 &&
      identity.sequence <= identities[index - 1]!.sequence)
  ) return invalid("sequence");
  return Object.freeze({
    authority_kind: "diet-manager/domain-preview/v2",
    input_digest: digest(material.input_digest, "input_digest"),
    meal_fact_identities: Object.freeze(identities),
  });
}

export function mealFactIdentityEquals(left: MealFactIdentity, right: MealFactIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
