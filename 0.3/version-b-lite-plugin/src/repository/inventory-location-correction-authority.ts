import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  createInventoryAdjustmentFactIdentity,
  inventoryAdjustmentFactIdentityEquals,
} from "../authority/inventory-adjustment-fact-identity.js";
import { deriveDomainId } from "../domain/identity.js";
import { validateAndFreezeInventoryLocationCorrectionFactPayload } from "../domain/inventory-service.js";
import type { InventoryLocationCorrectionFactPayload } from "../domain/types.js";
import { authenticateStoredPreviewAuthority } from "../preview/store.js";

function invalid(reason: string): never {
  throw new Error(`INVENTORY_LOCATION_CORRECTION_AUTHORITY_INVALID:${reason}`);
}

export function assertAuthenticatedInventoryLocationCorrectionFactAuthority(
  database: DatabaseSync,
  authoritySecret: Uint8Array,
  envelopeId: string,
  operationId: string,
  eventId: string,
): Readonly<InventoryLocationCorrectionFactPayload> {
  const rows = database.prepare(
    `SELECT e.event_id, e.envelope_id, e.operation_id, e.schema_version,
            e.event_type, e.fact_kind, e.source_message_id, e.conversation_id,
            e.received_at, e.occurred_at_text, e.meal_id, e.meal_slot, e.payload_json,
            c.payload_json AS preview_payload_json, c.input_digest AS envelope_input_digest
     FROM event_records e
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     WHERE e.envelope_id = ? AND e.operation_id = ?`,
  ).all(envelopeId, operationId) as Array<{
    event_id: string;
    envelope_id: string;
    operation_id: string;
    schema_version: "domain/v2";
    event_type: "inventory_adjusted";
    fact_kind: "inventory";
    source_message_id: string;
    conversation_id: string;
    received_at: string;
    occurred_at_text: string | null;
    meal_id: string | null;
    meal_slot: string | null;
    payload_json: string;
    preview_payload_json: string;
    envelope_input_digest: string;
  }>;
  const row = rows[0];
  if (
    rows.length !== 1 || !row || row.event_id !== eventId ||
    row.event_type !== "inventory_adjusted" || row.fact_kind !== "inventory" ||
    row.schema_version !== "domain/v2" || row.occurred_at_text === null ||
    row.meal_id !== null || row.meal_slot !== null
  ) return invalid("preview_event");
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (canonicalJson(parsed) !== row.payload_json) throw new Error("canonical");
    const authority = authenticateStoredPreviewAuthority(
      row.preview_payload_json,
      authoritySecret,
    );
    const material = authority.inventory_adjustment_fact_preview_material;
    if (
      authority.preview_authority_kind !== "diet-manager/server-preview/v5" ||
      material === undefined || material.input_digest !== row.envelope_input_digest ||
      authority.binding.preview_id !== row.envelope_id ||
      authority.binding.input_digest !== row.envelope_input_digest ||
      authority.binding.command_type !== "correct_record"
    ) return invalid("preview_binding");
    const envelopeEvents = database.prepare(
      "SELECT event_id FROM event_records WHERE envelope_id = ? ORDER BY event_id",
    ).all(row.envelope_id) as Array<{ event_id: string }>;
    const expectedIds = material.inventory_adjustment_fact_identities
      .map((identity) => identity.event_id)
      .sort();
    if (
      envelopeEvents.length !== expectedIds.length ||
      envelopeEvents.some((event, index) => event.event_id !== expectedIds[index])
    ) return invalid("preview_event_set");
    const expected = material.inventory_adjustment_fact_identities.find((identity) =>
      identity.event_id === row.event_id && identity.operation_id === row.operation_id);
    if (expected === undefined) return invalid("preview_identity");
    const actual = createInventoryAdjustmentFactIdentity({
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
      meal_id: null,
      meal_slot: null,
      payload: parsed,
    });
    if (!inventoryAdjustmentFactIdentityEquals(actual, expected)) {
      return invalid("preview_identity");
    }
    return validateAndFreezeInventoryLocationCorrectionFactPayload(parsed);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("INVENTORY_LOCATION_CORRECTION_AUTHORITY_INVALID:")
    ) throw error;
    return invalid("preview_identity");
  }
}

export function assertAppliedInventoryLocationCorrectionAuthority(
  database: DatabaseSync,
  envelopeId: string,
  operationId: string,
  eventId: string,
  options: Readonly<{ requireCurrentProjection?: boolean }> = {},
): Readonly<InventoryLocationCorrectionFactPayload> {
  const events = database.prepare(
    `SELECT e.event_id, e.operation_id, e.event_type, e.fact_kind, e.committed_at,
            e.payload_json, c.idempotency_key
     FROM event_records e
     JOIN command_envelopes c ON c.envelope_id = e.envelope_id
     WHERE e.envelope_id = ? AND e.operation_id = ?`,
  ).all(envelopeId, operationId) as Array<{
    event_id: string;
    operation_id: string;
    event_type: string;
    fact_kind: string;
    committed_at: string;
    payload_json: string;
    idempotency_key: string;
  }>;
  const event = events[0];
  if (
    events.length !== 1 || !event || event.event_id !== eventId ||
    event.event_type !== "inventory_adjusted" || event.fact_kind !== "inventory"
  ) return invalid("event");
  let fact;
  try {
    const parsed = JSON.parse(event.payload_json) as unknown;
    if (canonicalJson(parsed) !== event.payload_json) throw new Error("canonical");
    fact = validateAndFreezeInventoryLocationCorrectionFactPayload(parsed);
  } catch {
    return invalid("event");
  }
  const effectIds = Object.keys(fact.effect_inputs);
  const expectedEffectId = deriveDomainId("effect", event.idempotency_key, 0);
  const expectedOutboxId = deriveDomainId("outbox", event.idempotency_key, 0);
  if (effectIds.length !== 1 || effectIds[0] !== expectedEffectId) return invalid("effect_identity");

  const outboxes = database.prepare(
    `SELECT outbox_id, effect_id, effect_kind, previous_state, state, attempt_count,
            reason, created_at, updated_at
     FROM effect_outbox WHERE envelope_id = ? AND operation_id = ?`,
  ).all(envelopeId, operationId) as Array<{
    outbox_id: string;
    effect_id: string;
    effect_kind: string;
    previous_state: string | null;
    state: string;
    attempt_count: number;
    reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
  const outbox = outboxes[0];
  if (
    outboxes.length !== 1 || !outbox || outbox.outbox_id !== expectedOutboxId ||
    outbox.effect_id !== expectedEffectId || outbox.effect_kind !== "inventory_location_correction" ||
    outbox.previous_state !== fact.previous_last_event_id || outbox.state !== "succeeded" ||
    outbox.attempt_count !== 1 || outbox.reason !== null ||
    outbox.created_at !== event.committed_at || outbox.updated_at !== event.committed_at
  ) return invalid("outbox");

  const bundles = database.prepare(
    `SELECT stage, effect_state, result_status, completed_at, payload_json
     FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?`,
  ).all(envelopeId, operationId) as Array<{
    stage: string;
    effect_state: string;
    result_status: string;
    completed_at: string | null;
    payload_json: string;
  }>;
  const bundle = bundles[0];
  if (
    bundles.length !== 1 || !bundle || bundle.stage !== "EffectBundle" ||
    bundle.effect_state !== "succeeded" || bundle.result_status !== "applied" ||
    bundle.completed_at !== event.committed_at
  ) return invalid("bundle");
  let bundlePayload: unknown;
  try {
    bundlePayload = JSON.parse(bundle.payload_json) as unknown;
  } catch {
    return invalid("bundle");
  }
  if (
    canonicalJson(bundlePayload) !== bundle.payload_json ||
    typeof bundlePayload !== "object" || bundlePayload === null || Array.isArray(bundlePayload)
  ) return invalid("bundle");
  const record = bundlePayload as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !==
      ["authority_kind", "data_revision", "effects", "operation_sequence"].sort().join("\0") ||
    record.authority_kind !== "diet-manager/effect-bundle/v1" ||
    typeof record.data_revision !== "string" ||
    !record.data_revision.startsWith("repository-v1:") || record.operation_sequence !== 0 ||
    canonicalJson(record.effects) !== canonicalJson([{ effect_id: expectedEffectId, state: "succeeded" }])
  ) return invalid("bundle");

  if (options.requireCurrentProjection === false) return fact;

  const projection = database.prepare(
    `SELECT last_event_id, last_changed_at, effective_expiration_at, payload_json
     FROM inventory_batch_projections WHERE batch_id = ?`,
  ).get(fact.batch_id) as {
    last_event_id: string;
    last_changed_at: string;
    effective_expiration_at: string | null;
    payload_json: string;
  } | undefined;
  if (!projection) return invalid("projection");
  let currentProjection: unknown;
  let expectedProjection: unknown;
  try {
    currentProjection = JSON.parse(projection.payload_json) as unknown;
    expectedProjection = JSON.parse(fact.next_projection_json) as unknown;
  } catch {
    return invalid("projection");
  }
  if (
    canonicalJson(currentProjection) !== projection.payload_json ||
    canonicalJson(expectedProjection) !== fact.next_projection_json ||
    typeof currentProjection !== "object" || currentProjection === null || Array.isArray(currentProjection) ||
    typeof expectedProjection !== "object" || expectedProjection === null || Array.isArray(expectedProjection)
  ) return invalid("projection");
  const current = currentProjection as Record<string, unknown>;
  const expected = expectedProjection as Record<string, unknown>;
  if (
    current.authority_kind !== expected.authority_kind || current.batch_id !== expected.batch_id ||
    current.product_id !== expected.product_id || current.unit !== expected.unit ||
    canonicalJson(current.pantry_evidence) !== canonicalJson(expected.pantry_evidence) ||
    projection.effective_expiration_at !== fact.next_expiration.effective_at
  ) return invalid("projection");
  const currentEvent = database.prepare(
    "SELECT committed_at FROM event_records WHERE event_id = ?",
  ).get(projection.last_event_id) as { committed_at: string } | undefined;
  if (!currentEvent || currentEvent.committed_at !== projection.last_changed_at) {
    return invalid("projection_event");
  }
  return fact;
}
