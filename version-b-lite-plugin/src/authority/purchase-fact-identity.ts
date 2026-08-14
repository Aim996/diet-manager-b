import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import {
  parseMealFactPreviewMaterial,
  type MealFactIdentity,
} from "./meal-fact-identity.js";

const DIGEST = /^[A-F0-9]{64}$/u;

export interface PurchaseFactIdentity {
  readonly sequence: number;
  readonly event_id: string;
  readonly operation_id: string;
  readonly schema_version: "domain/v2";
  readonly event_type: "inventory_stock";
  readonly fact_kind: "inventory";
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly occurred_at_text: string;
  readonly meal_id: null;
  readonly meal_slot: null;
  readonly payload_digest: string;
  readonly items: readonly [];
}

export interface PurchaseFactPreviewMaterial {
  readonly authority_kind: "diet-manager/domain-preview/v4";
  readonly input_digest: string;
  readonly meal_fact_identities: readonly MealFactIdentity[];
  readonly purchase_fact_identities: readonly PurchaseFactIdentity[];
}

function invalid(reason: string): never {
  throw new TypeError(`PURCHASE_FACT_IDENTITY_INVALID:${reason}`);
}

function text(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\0")) {
    return invalid(reason);
  }
  return value;
}

function payloadWithoutReservation(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("payload");
  const payload = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  delete payload.progress_reservation;
  return Object.freeze(payload);
}

export function createPurchaseFactIdentity(input: Readonly<{
  readonly sequence: number;
  readonly event_id: string;
  readonly operation_id: string;
  readonly schema_version: "domain/v2";
  readonly event_type: "inventory_stock";
  readonly fact_kind: "inventory";
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly occurred_at_text: string;
  readonly meal_id: null;
  readonly meal_slot: null;
  readonly payload: unknown;
}>): PurchaseFactIdentity {
  if (
    !Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.schema_version !== "domain/v2" ||
    input.event_type !== "inventory_stock" || input.fact_kind !== "inventory" ||
    input.meal_id !== null || input.meal_slot !== null
  ) return invalid("shape");
  return Object.freeze({
    sequence: input.sequence,
    event_id: text(input.event_id, "event_id"),
    operation_id: text(input.operation_id, "operation_id"),
    schema_version: "domain/v2",
    event_type: "inventory_stock",
    fact_kind: "inventory",
    source_message_id: text(input.source_message_id, "source_message_id"),
    conversation_id: text(input.conversation_id, "conversation_id"),
    received_at: text(input.received_at, "received_at"),
    occurred_at_text: text(input.occurred_at_text, "occurred_at_text"),
    meal_id: null,
    meal_slot: null,
    payload_digest: canonicalSha256(payloadWithoutReservation(input.payload)),
    items: Object.freeze([]) as readonly [],
  });
}

export function purchaseFactIdentityEquals(left: PurchaseFactIdentity, right: PurchaseFactIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function parseIdentity(value: unknown): PurchaseFactIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("identity");
  const record = value as Record<string, unknown>;
  const fields = [
    "sequence", "event_id", "operation_id", "schema_version", "event_type", "fact_kind",
    "source_message_id", "conversation_id", "received_at", "occurred_at_text", "meal_id",
    "meal_slot", "payload_digest", "items",
  ];
  if (
    Object.keys(record).sort().join("\0") !== fields.sort().join("\0") ||
    !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0 ||
    record.schema_version !== "domain/v2" || record.event_type !== "inventory_stock" ||
    record.fact_kind !== "inventory" || record.meal_id !== null || record.meal_slot !== null ||
    typeof record.payload_digest !== "string" || !DIGEST.test(record.payload_digest) ||
    !Array.isArray(record.items) || record.items.length !== 0
  ) return invalid("identity");
  return Object.freeze({
    sequence: record.sequence as number,
    event_id: text(record.event_id, "event_id"),
    operation_id: text(record.operation_id, "operation_id"),
    schema_version: "domain/v2",
    event_type: "inventory_stock",
    fact_kind: "inventory",
    source_message_id: text(record.source_message_id, "source_message_id"),
    conversation_id: text(record.conversation_id, "conversation_id"),
    received_at: text(record.received_at, "received_at"),
    occurred_at_text: text(record.occurred_at_text, "occurred_at_text"),
    meal_id: null,
    meal_slot: null,
    payload_digest: record.payload_digest,
    items: Object.freeze([]) as readonly [],
  });
}

export function parsePurchaseFactPreviewMaterial(value: unknown): PurchaseFactPreviewMaterial {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("material");
  const record = value as Record<string, unknown>;
  const fields = ["authority_kind", "input_digest", "meal_fact_identities", "purchase_fact_identities"];
  if (
    Object.keys(record).sort().join("\0") !== fields.sort().join("\0") ||
    record.authority_kind !== "diet-manager/domain-preview/v4" ||
    typeof record.input_digest !== "string" || !DIGEST.test(record.input_digest) ||
    !Array.isArray(record.meal_fact_identities) || record.meal_fact_identities.length > 1 ||
    !Array.isArray(record.purchase_fact_identities) || record.purchase_fact_identities.length !== 1
  ) return invalid("material");
  const meals = record.meal_fact_identities.length === 0
    ? Object.freeze([]) as readonly MealFactIdentity[]
    : parseMealFactPreviewMaterial({
        authority_kind: "diet-manager/domain-preview/v2",
        input_digest: record.input_digest,
        meal_fact_identities: record.meal_fact_identities,
      }).meal_fact_identities;
  return Object.freeze({
    authority_kind: "diet-manager/domain-preview/v4",
    input_digest: record.input_digest,
    meal_fact_identities: meals,
    purchase_fact_identities: Object.freeze([parseIdentity(record.purchase_fact_identities[0])]),
  });
}
