import { canonicalJson, canonicalSha256 } from "./canonical-json.js";

const DIGEST = /^[A-F0-9]{64}$/u;

export interface WaterFactIdentity {
  readonly sequence: number;
  readonly event_id: string;
  readonly operation_id: string;
  readonly schema_version: "domain/v2";
  readonly event_type: "diet_water";
  readonly fact_kind: "water";
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly occurred_at_text: string;
  readonly meal_id: null;
  readonly meal_slot: null;
  readonly payload_digest: string;
  readonly items: readonly [];
}

export interface WaterFactPreviewMaterial {
  readonly authority_kind: "diet-manager/domain-preview/v3";
  readonly input_digest: string;
  readonly meal_fact_identities: readonly unknown[];
  readonly water_fact_identities: readonly WaterFactIdentity[];
}

function invalid(reason: string): never { throw new TypeError(`WATER_FACT_IDENTITY_INVALID:${reason}`); }
function text(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\0")) return invalid(reason);
  return value;
}

export function createWaterFactIdentity(input: {
  readonly sequence: number; readonly event_id: string; readonly operation_id: string;
  readonly schema_version: "domain/v2"; readonly event_type: "diet_water"; readonly fact_kind: "water";
  readonly source_message_id: string; readonly conversation_id: string; readonly received_at: string;
  readonly occurred_at_text: string; readonly meal_id: null; readonly meal_slot: null; readonly payload: unknown;
}): WaterFactIdentity {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.schema_version !== "domain/v2" ||
      input.event_type !== "diet_water" || input.fact_kind !== "water" || input.meal_id !== null || input.meal_slot !== null ||
      typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) return invalid("shape");
  const payload = { ...(input.payload as Record<string, unknown>) };
  delete payload.progress_reservation;
  return Object.freeze({
    sequence: input.sequence, event_id: text(input.event_id, "event_id"), operation_id: text(input.operation_id, "operation_id"),
    schema_version: "domain/v2", event_type: "diet_water", fact_kind: "water",
    source_message_id: text(input.source_message_id, "source_message_id"), conversation_id: text(input.conversation_id, "conversation_id"),
    received_at: text(input.received_at, "received_at"), occurred_at_text: text(input.occurred_at_text, "occurred_at_text"),
    meal_id: null, meal_slot: null, payload_digest: canonicalSha256(payload), items: Object.freeze([]) as readonly [],
  });
}

export function waterFactIdentityEquals(left: WaterFactIdentity, right: WaterFactIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function parseWaterFactPreviewMaterial(value: unknown): WaterFactPreviewMaterial {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("material");
  const record = value as Record<string, unknown>;
  const fields = ["authority_kind", "input_digest", "meal_fact_identities", "water_fact_identities"];
  if (Object.keys(record).sort().join("\0") !== fields.sort().join("\0") || record.authority_kind !== "diet-manager/domain-preview/v3" ||
      typeof record.input_digest !== "string" || !DIGEST.test(record.input_digest) || !Array.isArray(record.meal_fact_identities) || record.meal_fact_identities.length !== 0 ||
      !Array.isArray(record.water_fact_identities) || record.water_fact_identities.length !== 1) return invalid("material");
  const identity = record.water_fact_identities[0] as Record<string, unknown>;
  const identityFields = ["sequence", "event_id", "operation_id", "schema_version", "event_type", "fact_kind", "source_message_id", "conversation_id", "received_at", "occurred_at_text", "meal_id", "meal_slot", "payload_digest", "items"];
  if (typeof identity !== "object" || identity === null || Array.isArray(identity) ||
      Object.keys(identity).sort().join("\0") !== identityFields.sort().join("\0") ||
      !Number.isSafeInteger(identity.sequence) || (identity.sequence as number) < 0 || identity.schema_version !== "domain/v2" ||
      identity.event_type !== "diet_water" || identity.fact_kind !== "water" || identity.meal_id !== null || identity.meal_slot !== null ||
      !DIGEST.test(String(identity.payload_digest)) || !Array.isArray(identity.items) || identity.items.length !== 0) return invalid("identity");
  const frozenIdentity = Object.freeze({
    sequence: identity.sequence as number, event_id: text(identity.event_id, "event_id"), operation_id: text(identity.operation_id, "operation_id"),
    schema_version: "domain/v2" as const, event_type: "diet_water" as const, fact_kind: "water" as const,
    source_message_id: text(identity.source_message_id, "source_message_id"), conversation_id: text(identity.conversation_id, "conversation_id"),
    received_at: text(identity.received_at, "received_at"), occurred_at_text: text(identity.occurred_at_text, "occurred_at_text"),
    meal_id: null, meal_slot: null, payload_digest: String(identity.payload_digest), items: Object.freeze([]) as readonly [],
  });
  return Object.freeze({ authority_kind: "diet-manager/domain-preview/v3", input_digest: record.input_digest,
    meal_fact_identities: Object.freeze([...record.meal_fact_identities]), water_fact_identities: Object.freeze([frozenIdentity]) });
}
