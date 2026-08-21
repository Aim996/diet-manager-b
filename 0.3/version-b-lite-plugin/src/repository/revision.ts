import type { DatabaseSync } from "node:sqlite";

import { canonicalSha256 } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";

export interface FinalizedCorrectionRevision {
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly operation: string;
}

/**
 * Reads the immutable revision inputs of an already-finalized correction
 * request. Application retries use these original inputs instead of resolving
 * the now-advanced live revision and accidentally turning an exact retry into
 * a new mutation or an `already_active`/`already_voided` response.
 */
export function readFinalizedCorrectionRevision(input: Readonly<{
  database: DatabaseSync;
  envelopeId: string;
  operationId: string;
  sourceMessageId: string;
  conversationId: string;
  receivedAt: string;
  allowedOperations: readonly string[];
}>): FinalizedCorrectionRevision | undefined {
  assertCurrentMigrationAuthority(input.database);
  const envelope = input.database.prepare(
    `SELECT state, source_message_id, conversation_id
     FROM command_envelopes WHERE envelope_id = ?`,
  ).get(input.envelopeId) as {
    state: string;
    source_message_id: string;
    conversation_id: string;
  } | undefined;
  if (envelope === undefined) return undefined;
  if (envelope.source_message_id !== input.sourceMessageId ||
      envelope.conversation_id !== input.conversationId) {
    throw new Error("IDEMPOTENCY_CONFLICT:request_identity");
  }
  if (envelope.state !== "finalized") return undefined;
  const row = input.database.prepare(
    `SELECT c.target_event_id, c.base_revision, c.operation, e.event_type, e.fact_kind,
            e.source_message_id, e.conversation_id, e.received_at, f.result_status
     FROM correction_events c
     JOIN event_records e
       ON e.envelope_id = ? AND e.operation_id = c.request_id
     JOIN envelope_finalizations f ON f.envelope_id = e.envelope_id
     WHERE c.request_id = ?`,
  ).get(input.envelopeId, input.operationId) as {
    target_event_id: string;
    base_revision: number;
    operation: string;
    event_type: string;
    fact_kind: string;
    source_message_id: string;
    conversation_id: string;
    received_at: string;
    result_status: string;
  } | undefined;
  if (row === undefined || row.event_type !== "diet_correction" || row.fact_kind !== "correction" ||
      row.source_message_id !== input.sourceMessageId || row.conversation_id !== input.conversationId ||
      (row.result_status !== "committed" && row.result_status !== "committed_with_issues") ||
      !Number.isSafeInteger(row.base_revision) || row.base_revision < 1) {
    throw new Error("MUTATION_REPLAY_INVALID:revision");
  }
  if (row.received_at !== input.receivedAt) {
    throw new Error("IDEMPOTENCY_CONFLICT:received_at");
  }
  if (!input.allowedOperations.includes(row.operation)) {
    throw new Error("IDEMPOTENCY_CONFLICT:operation");
  }
  return Object.freeze({
    target_event_id: row.target_event_id,
    base_revision: row.base_revision,
    operation: row.operation,
  });
}

export function computeRepositoryDataRevision(database: DatabaseSync): string {
  assertCurrentMigrationAuthority(database);
  const events = database
    .prepare(
      `SELECT
        event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
        committed_at, result_status, lifecycle_status, payload_json
       FROM event_records
       ORDER BY event_id`,
    )
    .all();
  const inventory = database
    .prepare(
      `SELECT
        batch_id, last_event_id, last_changed_at, quantity_status,
        seal_status, expiry_status, effective_status, payload_json
       FROM inventory_batch_projections
       ORDER BY batch_id`,
    )
    .all();
  const products = database
    .prepare(
      `SELECT
        product_id, schema_version, normalized_name, product_type,
        brand, manufacturer, barcode, sku, payload_json
       FROM products
       ORDER BY product_id`,
    )
    .all();
  const batches = database
    .prepare(
      `SELECT
        batch_id, product_id, stock_event_id, schema_version, committed_at,
        stocked_at, explicit_expiration_at, quantity_unit, payload_json
       FROM inventory_batches
       ORDER BY batch_id`,
    )
    .all();
  const issues = database
    .prepare(
      `SELECT issue_id, issue_code, status, revision, resolved_at, payload_json
       FROM issues
       ORDER BY issue_id`,
    )
    .all();
  const inventoryQuantityModels = database
    .prepare(
      `SELECT batch_id, package_unit, original_package_microunits,
              per_package_base_microunits, base_unit, remaining_base_microunits,
              conversion_source, revision
       FROM inventory_quantity_models
       ORDER BY batch_id`,
    )
    .all();
  return `repository-v1:${canonicalSha256({
    authority_kind: "diet-manager/repository-revision/v1",
    events,
    inventory,
    products,
    batches,
    issues,
    ...(inventoryQuantityModels.length === 0
      ? {}
      : { inventory_quantity_models: inventoryQuantityModels }),
  })}`;
}
