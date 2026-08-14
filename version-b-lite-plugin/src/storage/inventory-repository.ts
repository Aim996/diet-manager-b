import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../authority/canonical-json.js";
import {
  productIdentityFingerprint,
  validateAndFreezePantryPurchaseEvidence,
  validateAndFreezeProductIdentityEvidence,
} from "../domain/inventory-service.js";
import type {
  InventoryAllocationCandidate,
} from "../domain/inventory-service.js";
import type {
  InventoryAllocationPlan,
  PantryPurchaseEvidence,
  ProductIdentityEvidence,
} from "../domain/types.js";
import { deriveDomainId } from "../domain/identity.js";
import type { PreparedEnvelopeOperation } from "../repository/fact-commit.js";
import { assertCurrentMigrationAuthority } from "./migration-guard.js";

export interface PreparePantryPurchaseInput {
  readonly evidence: Readonly<PantryPurchaseEvidence>;
  readonly product_id: string;
  readonly normalized_name: string;
  readonly batch_id: string;
  readonly quantity_microunits: number | null;
  readonly unit: string;
  readonly template_reference_microunits: number | null;
}

export interface PreparedPantryPurchase {
  readonly evidence: Readonly<PantryPurchaseEvidence>;
  readonly identity_fingerprint: string;
  readonly product_payload: Readonly<{
    readonly authority_kind: "diet-manager/product/v2";
    readonly identity: Readonly<ProductIdentityEvidence>;
    readonly identity_fingerprint: string;
  }>;
  readonly batch_payload: Readonly<{
    readonly authority_kind: "diet-manager/inventory-batch/v2";
    readonly pantry_evidence: Readonly<PantryPurchaseEvidence>;
    readonly template_reference_microunits: number | null;
  }>;
  readonly explicit_expiration_at: string | null;
  readonly effective_expiration_at: string | null;
}

export interface ParsedProductPayload {
  readonly version: 1 | 2;
  readonly canonical_json: string;
  readonly identity: Readonly<ProductIdentityEvidence> | null;
  readonly identity_fingerprint: string | null;
}

export interface ParsedBatchPayload {
  readonly version: 1 | 2;
  readonly canonical_json: string;
  readonly pantry_evidence: Readonly<PantryPurchaseEvidence> | null;
  readonly template_reference_microunits: number | null;
}

export interface ParsedProjectionPayload {
  readonly version: 1 | 2;
  readonly canonical_json: string;
  readonly batch_id: string;
  readonly product_id: string;
  readonly quantity_microunits: number | null;
  readonly unit: string;
  readonly pantry_evidence: Readonly<PantryPurchaseEvidence> | null;
}

export interface ParsedPurchaseFactPayload {
  readonly version: 1 | 2;
  readonly canonical_json: string;
  readonly pantry_evidence: Readonly<PantryPurchaseEvidence> | null;
  readonly effect_inputs: Readonly<Record<string, unknown>>;
  readonly result: unknown;
}

export interface PantryAllocationCandidateRead {
  readonly candidates: readonly Readonly<InventoryAllocationCandidate>[];
}

export interface AppliedPantryAllocation {
  readonly transaction_id: string;
  readonly product_id: string;
  readonly batch_id: string;
  readonly before_microunits: number;
  readonly deducted_microunits: number;
  readonly after_microunits: number;
  readonly unit: string;
  readonly selection_basis: "explicit_batch" | "fefo" | "fifo";
}

function invalid(reason: string): never {
  throw new Error(`PANTRY_REPOSITORY_AUTHORITY_INVALID:${reason}`);
}

function exact(value: unknown, keys: readonly string[], reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(reason);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return invalid(reason);
  }
  return value as Record<string, unknown>;
}

function safeText(value: unknown, reason: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 256 ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) return invalid(reason);
  return value;
}

function nullableSafeNonnegativeInteger(value: unknown, reason: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid(reason);
  return value;
}

function positiveSafeInteger(value: unknown, reason: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid(reason);
  return value;
}

function parsedJson(value: string, reason: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return invalid(reason);
  }
  if (canonicalJson(parsed) !== value) return invalid(`${reason}_canonical`);
  return parsed;
}

function digest(value: unknown, reason: string): string {
  if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) return invalid(reason);
  return value;
}

export function preparePantryPurchase(input: Readonly<PreparePantryPurchaseInput>): Readonly<PreparedPantryPurchase> {
  const evidence = validateAndFreezePantryPurchaseEvidence(input.evidence);
  safeText(input.product_id, "product_id");
  safeText(input.batch_id, "batch_id");
  safeText(input.unit, "unit");
  if (input.quantity_microunits !== null) positiveSafeInteger(input.quantity_microunits, "quantity_microunits");
  nullableSafeNonnegativeInteger(input.template_reference_microunits, "template_reference_microunits");
  if (evidence.product_identity.normalized_name !== input.normalized_name) {
    return invalid("normalized_name");
  }
  const identityFingerprint = productIdentityFingerprint(evidence.product_identity);
  return Object.freeze({
    evidence,
    identity_fingerprint: identityFingerprint,
    product_payload: Object.freeze({
      authority_kind: "diet-manager/product/v2",
      identity: evidence.product_identity,
      identity_fingerprint: identityFingerprint,
    }),
    batch_payload: Object.freeze({
      authority_kind: "diet-manager/inventory-batch/v2",
      pantry_evidence: evidence,
      template_reference_microunits: input.template_reference_microunits,
    }),
    explicit_expiration_at: evidence.expiration.explicit_at,
    effective_expiration_at: evidence.expiration.effective_at,
  });
}

export function createPantryProjectionPayload(input: Readonly<{
  readonly batch_id: string;
  readonly product_id: string;
  readonly quantity_microunits: number | null;
  readonly unit: string;
  readonly pantry_evidence: Readonly<PantryPurchaseEvidence>;
}>): Readonly<Record<string, unknown>> {
  safeText(input.batch_id, "projection_batch_id");
  safeText(input.product_id, "projection_product_id");
  const quantity = nullableSafeNonnegativeInteger(input.quantity_microunits, "projection_quantity");
  safeText(input.unit, "projection_unit");
  const evidence = validateAndFreezePantryPurchaseEvidence(input.pantry_evidence);
  return Object.freeze({
    authority_kind: "diet-manager/inventory-projection/v2",
    batch_id: input.batch_id,
    product_id: input.product_id,
    quantity_microunits: quantity,
    unit: input.unit,
    pantry_evidence: evidence,
  });
}

export function parseProductPayload(value: unknown): Readonly<ParsedProductPayload> {
  const hasIdentity = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.hasOwn(value, "identity");
  if (!hasIdentity) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("product_payload");
    return Object.freeze({
      version: 1,
      canonical_json: canonicalJson(value),
      identity: null,
      identity_fingerprint: null,
    });
  }
  const record = exact(
    value,
    ["authority_kind", "identity", "identity_fingerprint"],
    "product_payload",
  );
  if (record.authority_kind !== "diet-manager/product/v2") return invalid("product_payload_kind");
  const identity = validateAndFreezeProductIdentityEvidence(record.identity);
  const fingerprint = digest(record.identity_fingerprint, "product_identity_fingerprint");
  if (productIdentityFingerprint(identity) !== fingerprint) return invalid("product_identity_fingerprint");
  return Object.freeze({
    version: 2,
    canonical_json: canonicalJson(record),
    identity,
    identity_fingerprint: fingerprint,
  });
}

export function parseProductPayloadJson(value: string): Readonly<ParsedProductPayload> {
  return parseProductPayload(parsedJson(value, "product_payload"));
}

export function parseBatchPayload(value: unknown): Readonly<ParsedBatchPayload> {
  const hasEvidence = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.hasOwn(value, "pantry_evidence");
  if (!hasEvidence) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("batch_payload");
    const legacy = value as Record<string, unknown>;
    const template = Object.hasOwn(legacy, "template_reference_microunits")
      ? nullableSafeNonnegativeInteger(legacy.template_reference_microunits, "template_reference_microunits")
      : null;
    return Object.freeze({
      version: 1,
      canonical_json: canonicalJson(legacy),
      pantry_evidence: null,
      template_reference_microunits: template,
    });
  }
  const record = exact(
    value,
    ["authority_kind", "pantry_evidence", "template_reference_microunits"],
    "batch_payload",
  );
  const template = nullableSafeNonnegativeInteger(record.template_reference_microunits, "template_reference_microunits");
  if (record.authority_kind !== "diet-manager/inventory-batch/v2") {
    return invalid("batch_payload_kind");
  }
  const evidence = validateAndFreezePantryPurchaseEvidence(record.pantry_evidence);
  return Object.freeze({
    version: 2,
    canonical_json: canonicalJson(record),
    pantry_evidence: evidence,
    template_reference_microunits: template,
  });
}

export function parseBatchPayloadJson(value: string): Readonly<ParsedBatchPayload> {
  return parseBatchPayload(parsedJson(value, "batch_payload"));
}

export function parseProjectionPayload(value: unknown): Readonly<ParsedProjectionPayload> {
  const hasEvidence = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.hasOwn(value, "pantry_evidence");
  const record = exact(value, hasEvidence
    ? ["authority_kind", "batch_id", "product_id", "quantity_microunits", "unit", "pantry_evidence"]
    : ["authority_kind", "batch_id", "product_id", "quantity_microunits", "unit"], "projection_payload");
  const quantity = nullableSafeNonnegativeInteger(record.quantity_microunits, "projection_quantity");
  const common = {
    batch_id: safeText(record.batch_id, "projection_batch_id"),
    product_id: safeText(record.product_id, "projection_product_id"),
    quantity_microunits: quantity,
    unit: safeText(record.unit, "projection_unit"),
  };
  if (record.authority_kind === "diet-manager/inventory-projection/v1" && !hasEvidence) {
    if (quantity === null) return invalid("projection_quantity");
    return Object.freeze({ version: 1, canonical_json: canonicalJson(record), ...common, pantry_evidence: null });
  }
  if (record.authority_kind !== "diet-manager/inventory-projection/v2" || !hasEvidence) {
    return invalid("projection_payload_kind");
  }
  return Object.freeze({
    version: 2,
    canonical_json: canonicalJson(record),
    ...common,
    pantry_evidence: validateAndFreezePantryPurchaseEvidence(record.pantry_evidence),
  });
}

export function parseProjectionPayloadJson(value: string): Readonly<ParsedProjectionPayload> {
  return parseProjectionPayload(parsedJson(value, "projection_payload"));
}

export function parsePurchaseFactPayload(value: unknown): Readonly<ParsedPurchaseFactPayload> {
  const hasEvidence = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.hasOwn(value, "pantry_evidence");
  const hasReservation = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.hasOwn(value, "progress_reservation");
  const fields = [
    "authority_kind",
    "effect_inputs",
    ...(hasEvidence ? ["pantry_evidence"] : []),
    ...(hasReservation ? ["progress_reservation"] : []),
    "result",
  ];
  const record = exact(value, fields, "purchase_fact_payload");
  if (
    typeof record.effect_inputs !== "object" || record.effect_inputs === null ||
    Array.isArray(record.effect_inputs)
  ) return invalid("purchase_effect_inputs");
  const effects = exact(
    record.effect_inputs,
    Object.keys(record.effect_inputs),
    "purchase_effect_inputs",
  );
  if (Object.keys(effects).length !== 1) return invalid("purchase_effect_inputs");
  if (record.authority_kind === "diet-manager/purchase-fact/v1" && !hasEvidence) {
    return Object.freeze({
      version: 1,
      canonical_json: canonicalJson(record),
      pantry_evidence: null,
      effect_inputs: Object.freeze({ ...effects }),
      result: record.result,
    });
  }
  if (record.authority_kind !== "diet-manager/purchase-fact/v2" || !hasEvidence) {
    return invalid("purchase_fact_payload_kind");
  }
  return Object.freeze({
    version: 2,
    canonical_json: canonicalJson(record),
    pantry_evidence: validateAndFreezePantryPurchaseEvidence(record.pantry_evidence),
    effect_inputs: Object.freeze({ ...effects }),
    result: record.result,
  });
}

export function parsePurchaseFactPayloadJson(value: string): Readonly<ParsedPurchaseFactPayload> {
  return parsePurchaseFactPayload(parsedJson(value, "purchase_fact_payload"));
}

export function parseInventoryAllocationPlan(value: unknown): Readonly<InventoryAllocationPlan> {
  const record = exact(value, [
    "allocations", "candidate_count", "issue_code", "read_required",
    "requested_microunits", "status", "unit",
  ], "inventory_allocation_plan");
  const statuses = [
    "matched", "skipped_outside", "skipped_by_user", "skipped_amount_unknown",
    "skipped_ambiguous", "skipped_unit_incompatible", "skipped_insufficient",
  ];
  if (typeof record.status !== "string" || !statuses.includes(record.status)) {
    return invalid("inventory_allocation_status");
  }
  const requested = record.requested_microunits === null
    ? null
    : positiveSafeInteger(record.requested_microunits, "inventory_allocation_requested");
  const unit = safeText(record.unit, "inventory_allocation_unit");
  const candidateCount = nullableSafeNonnegativeInteger(record.candidate_count, "inventory_allocation_candidates");
  if (candidateCount === null || typeof record.read_required !== "boolean" || !Array.isArray(record.allocations)) {
    return invalid("inventory_allocation_plan");
  }
  const allocations = record.allocations.map((candidate, index) => {
    const allocation = exact(candidate, [
      "after_microunits", "batch_id", "before_microunits", "deducted_microunits",
      "product_id", "selection_basis", "unit",
    ], `inventory_allocation_${index}`);
    const before = nullableSafeNonnegativeInteger(allocation.before_microunits, `inventory_allocation_${index}_before`);
    const deducted = positiveSafeInteger(allocation.deducted_microunits, `inventory_allocation_${index}_deducted`);
    const after = nullableSafeNonnegativeInteger(allocation.after_microunits, `inventory_allocation_${index}_after`);
    if (
      before === null || after === null || before - deducted !== after ||
      allocation.unit !== unit ||
      !["explicit_batch", "fefo", "fifo"].includes(String(allocation.selection_basis))
    ) return invalid(`inventory_allocation_${index}`);
    return Object.freeze({
      product_id: safeText(allocation.product_id, `inventory_allocation_${index}_product`),
      batch_id: safeText(allocation.batch_id, `inventory_allocation_${index}_batch`),
      before_microunits: before,
      deducted_microunits: deducted,
      after_microunits: after,
      unit,
      selection_basis: allocation.selection_basis as "explicit_batch" | "fefo" | "fifo",
    });
  });
  if (new Set(allocations.map(({ batch_id }) => batch_id)).size !== allocations.length) {
    return invalid("inventory_allocation_batches");
  }
  const issueByStatus: Readonly<Record<string, InventoryAllocationPlan["issue_code"]>> = Object.freeze({
    matched: null,
    skipped_outside: null,
    skipped_by_user: null,
    skipped_amount_unknown: "inventory_amount_unknown",
    skipped_ambiguous: "inventory_multiple_candidates",
    skipped_unit_incompatible: "inventory_unit_conversion_unproven",
    skipped_insufficient: "inventory_insufficient",
  });
  const issue = record.issue_code;
  if (issue !== issueByStatus[record.status]) return invalid("inventory_allocation_issue");
  const noRead = record.status === "skipped_outside" || record.status === "skipped_by_user" ||
    record.status === "skipped_amount_unknown";
  if (record.read_required !== !noRead) return invalid("inventory_allocation_read_required");
  if (record.status === "matched") {
    if (requested === null || allocations.length === 0 || candidateCount < allocations.length) {
      return invalid("inventory_allocation_matched");
    }
    const total = allocations.reduce((sum, allocation) => sum + BigInt(allocation.deducted_microunits), 0n);
    if (total !== BigInt(requested)) return invalid("inventory_allocation_total");
  } else if (allocations.length !== 0) {
    return invalid("inventory_allocation_skipped");
  }
  if ((record.status === "skipped_amount_unknown") !== (requested === null)) {
    return invalid("inventory_allocation_requested");
  }
  return Object.freeze({
    status: record.status as InventoryAllocationPlan["status"],
    requested_microunits: requested,
    unit,
    allocations: Object.freeze(allocations),
    candidate_count: candidateCount,
    issue_code: issue as InventoryAllocationPlan["issue_code"],
    read_required: record.read_required,
  });
}

export function listPantryAllocationCandidates(
  database: DatabaseSync,
  normalizedName: string,
  occurredAt: string,
): Readonly<PantryAllocationCandidateRead> | null {
  safeText(normalizedName, "inventory_candidate_name");
  const occurredEpoch = Date.parse(occurredAt);
  if (!Number.isFinite(occurredEpoch)) return invalid("inventory_candidate_time");
  const rows = database.prepare(
    `SELECT p.product_id, p.payload_json AS product_payload_json,
            b.batch_id, b.stocked_at, b.payload_json AS batch_payload_json,
            i.quantity_status, i.effective_status, i.payload_json AS projection_payload_json
     FROM products p
     JOIN inventory_batches b ON b.product_id = p.product_id
     JOIN inventory_batch_projections i ON i.batch_id = b.batch_id
     WHERE p.normalized_name = ?
     ORDER BY b.batch_id`,
  ).all(normalizedName) as Array<{
    product_id: string;
    product_payload_json: string;
    batch_id: string;
    stocked_at: string;
    batch_payload_json: string;
    quantity_status: string;
    effective_status: string;
    projection_payload_json: string;
  }>;
  if (rows.length === 0) return null;
  const candidates: InventoryAllocationCandidate[] = [];
  for (const row of rows) {
    const product = parseProductPayloadJson(row.product_payload_json);
    const batch = parseBatchPayloadJson(row.batch_payload_json);
    const projection = parseProjectionPayloadJson(row.projection_payload_json);
    if (product.version !== 2 || batch.version !== 2 || projection.version !== 2) return null;
    if (
      product.identity_fingerprint === null || batch.pantry_evidence === null ||
      projection.pantry_evidence === null || projection.product_id !== row.product_id ||
      projection.batch_id !== row.batch_id ||
      canonicalJson(batch.pantry_evidence) !== canonicalJson(projection.pantry_evidence)
    ) return invalid("inventory_candidate_evidence");
    const expiration = batch.pantry_evidence.expiration.effective_at;
    const expired = expiration !== null && Date.parse(expiration) <= occurredEpoch;
    const available = projection.quantity_microunits ?? 0;
    const status = expired || row.effective_status === "expired"
      ? "expired" as const
      : row.effective_status === "active" && row.quantity_status === "available" && available > 0
        ? "available" as const
        : "unavailable" as const;
    candidates.push(Object.freeze({
      product_id: row.product_id,
      product_identity_fingerprint: product.identity_fingerprint,
      batch_id: row.batch_id,
      available_microunits: available,
      unit: projection.unit,
      effective_expiration_at: expiration,
      stocked_at: row.stocked_at,
      effective_status: status,
    }));
  }
  return Object.freeze({ candidates: Object.freeze(candidates) });
}

export function applyPantryAllocationsInTransaction(input: Readonly<{
  readonly database: DatabaseSync;
  readonly event_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly committed_at: string;
  readonly occurred_at: string;
  readonly effect_id: string;
  readonly plan: Readonly<InventoryAllocationPlan>;
  readonly afterAllocation?: (index: number) => void;
}>): readonly Readonly<AppliedPantryAllocation>[] {
  const plan = parseInventoryAllocationPlan(input.plan);
  if (plan.status !== "matched") return Object.freeze([]);
  const occurredEpoch = Date.parse(input.occurred_at);
  if (!Number.isFinite(occurredEpoch)) return invalid("inventory_allocation_time");
  const applied = plan.allocations.map((allocation, index) => {
    const row = input.database.prepare(
      `SELECT quantity_status, effective_status, payload_json
       FROM inventory_batch_projections WHERE batch_id = ?`,
    ).get(allocation.batch_id) as {
      quantity_status: string;
      effective_status: string;
      payload_json: string;
    } | undefined;
    if (!row || row.quantity_status !== "available" || row.effective_status !== "active") {
      return invalid("inventory_allocation_projection");
    }
    const projection = parseProjectionPayloadJson(row.payload_json);
    if (
      projection.version !== 2 || projection.pantry_evidence === null ||
      projection.product_id !== allocation.product_id || projection.batch_id !== allocation.batch_id ||
      projection.quantity_microunits !== allocation.before_microunits ||
      projection.unit !== allocation.unit
    ) return invalid("inventory_allocation_projection");
    const expiration = projection.pantry_evidence.expiration.effective_at;
    if (expiration !== null && Date.parse(expiration) <= occurredEpoch) {
      return invalid("inventory_allocation_expired");
    }
    const transactionId = deriveDomainId("transaction", input.effect_id, index);
    input.database.prepare(
      `INSERT INTO inventory_transactions(
        transaction_id, event_id, product_id, batch_id, idempotency_key,
        schema_version, direction, reason_code, unit, related_event_id,
        related_transaction_id, source_message_id, conversation_id, received_at,
        committed_at, result_status, lifecycle_status, payload_json
      ) VALUES (?, ?, ?, ?, ?, 'domain/v2', 'out', 'meal_consumption', ?, NULL,
        NULL, ?, ?, ?, ?, 'applied', 'active', ?)`,
    ).run(
      transactionId,
      input.event_id,
      allocation.product_id,
      allocation.batch_id,
      input.effect_id,
      allocation.unit,
      input.source_message_id,
      input.conversation_id,
      input.received_at,
      input.committed_at,
      canonicalJson({
        allocation_index: index,
        authority_kind: "diet-manager/inventory-transaction/v2",
        quantity_after_microunits: allocation.after_microunits,
        quantity_delta_microunits: -allocation.deducted_microunits,
        selection_basis: allocation.selection_basis,
        unit: allocation.unit,
      }),
    );
    const nextPayload = createPantryProjectionPayload({
      batch_id: allocation.batch_id,
      product_id: allocation.product_id,
      quantity_microunits: allocation.after_microunits,
      unit: allocation.unit,
      pantry_evidence: projection.pantry_evidence,
    });
    input.database.prepare(
      `UPDATE inventory_batch_projections
       SET last_event_id = ?, last_changed_at = ?, quantity_status = ?, effective_status = ?, payload_json = ?
       WHERE batch_id = ? AND quantity_status = 'available' AND effective_status = 'active' AND payload_json = ?`,
    ).run(
      input.event_id,
      input.committed_at,
      allocation.after_microunits === 0 ? "empty" : "available",
      allocation.after_microunits === 0 ? "empty" : "active",
      canonicalJson(nextPayload),
      allocation.batch_id,
      row.payload_json,
    );
    if (Number((input.database.prepare("SELECT changes() AS count").get() as { count: number }).count) !== 1) {
      return invalid("inventory_allocation_compare_and_set");
    }
    input.afterAllocation?.(index);
    return Object.freeze({ transaction_id: transactionId, ...allocation });
  });
  return Object.freeze(applied);
}

export function assertStoredPurchaseFactMatchesExpected(input: Readonly<{
  readonly database: DatabaseSync;
  readonly envelopeId: string;
  readonly operationId: string;
  readonly operationSequence: number;
  readonly expectedFact: PreparedEnvelopeOperation;
  readonly requireAppliedEffect?: boolean;
}>): void {
  const { expectedFact } = input;
  if (
    expectedFact.database !== input.database || expectedFact.operationId !== input.operationId ||
    expectedFact.sequence !== input.operationSequence || expectedFact.event.operationId !== input.operationId ||
    expectedFact.items.length !== 0 || expectedFact.effects.length !== 1
  ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_expected_fact");
  let transactionOpen = false;
  try {
    input.database.exec("BEGIN DEFERRED");
    transactionOpen = true;
    assertCurrentMigrationAuthority(input.database);
    const events = input.database.prepare(
      `SELECT event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,
              source_message_id,conversation_id,received_at,committed_at,occurred_at_text,
              meal_id,meal_slot,payload_json
       FROM event_records WHERE envelope_id = ? AND operation_id = ?`,
    ).all(input.envelopeId, input.operationId) as Array<{
      event_id: string; envelope_id: string; operation_id: string; schema_version: string;
      event_type: string; fact_kind: string; source_message_id: string; conversation_id: string;
      received_at: string; committed_at: string; occurred_at_text: string | null;
      meal_id: string | null; meal_slot: string | null; payload_json: string;
    }>;
    const event = events[0];
    const expectedEvent = expectedFact.event;
    if (!event || events.length !== 1 ||
      event.event_id !== expectedEvent.eventId || event.envelope_id !== input.envelopeId ||
      event.operation_id !== expectedEvent.operationId || event.schema_version !== expectedEvent.schemaVersion ||
      event.event_type !== expectedEvent.eventType || event.fact_kind !== expectedEvent.factKind ||
      event.source_message_id !== expectedEvent.sourceMessageId ||
      event.conversation_id !== expectedEvent.conversationId || event.received_at !== expectedEvent.receivedAt ||
      event.committed_at !== expectedEvent.committedAt || event.occurred_at_text !== expectedEvent.occurredAtText ||
      event.meal_id !== expectedEvent.mealId || event.meal_slot !== expectedEvent.mealSlot
    ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_event");
    let expectedPayload: Readonly<ParsedPurchaseFactPayload>;
    try {
      parsePurchaseFactPayloadJson(event.payload_json);
      expectedPayload = parsePurchaseFactPayload(expectedEvent.payload);
    } catch {
      throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
    }
    if (event.payload_json !== canonicalJson(expectedEvent.payload)) {
      throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
    }
    if (input.requireAppliedEffect === false) {
      const itemCount = input.database.prepare(
        "SELECT COUNT(*) AS count FROM meal_items WHERE event_id = ?",
      ).get(event.event_id) as { count: number };
      const outboxes = input.database.prepare(
        `SELECT outbox_id,effect_id,effect_kind,previous_state,reason
         FROM effect_outbox WHERE envelope_id = ? AND operation_id = ? ORDER BY outbox_id`,
      ).all(input.envelopeId, input.operationId) as Array<{
        outbox_id: string; effect_id: string; effect_kind: string;
        previous_state: string | null; reason: string | null;
      }>;
      const expectedEffect = expectedFact.effects[0];
      const outbox = outboxes[0];
      if (Number(itemCount.count) !== 0) {
        throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_items");
      }
      if (!outbox || !expectedEffect || outboxes.length !== 1 ||
        outbox.outbox_id !== expectedEffect.outboxId || outbox.effect_id !== expectedEffect.effectId ||
        outbox.effect_kind !== expectedEffect.effectKind ||
        outbox.previous_state !== expectedEffect.previousState || outbox.reason !== expectedEffect.reason
      ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_outbox");
      input.database.exec("ROLLBACK");
      transactionOpen = false;
      return;
    }
    const effectInput = Object.values(expectedPayload.effect_inputs)[0];
    let effect: Record<string, unknown>;
    let product: Record<string, unknown>;
    let batch: Record<string, unknown>;
    try {
      effect = exact(effectInput, [
        "batch", "kind", "nutrition_profile", "product", "quantity_microunits",
        "reason_code", "transaction_id", "unit",
      ], "expected_effect");
      product = exact(effect.product, [
        "normalized_name", "payload", "product_id", "product_type", "schema_version",
      ], "expected_product");
      batch = exact(effect.batch, [
        "batch_id", "explicit_expiration_at", "payload", "quantity_unit", "schema_version", "stocked_at",
      ], "expected_batch");
      parseProductPayload(product.payload);
      parseBatchPayload(batch.payload);
    } catch {
      throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_expected_fact");
    }
    if (
      effect.kind !== "inventory_add" || effect.reason_code !== "purchase" ||
      typeof product.product_id !== "string" || typeof batch.batch_id !== "string"
    ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_expected_fact");
    const storedProduct = input.database.prepare(
      "SELECT brand,payload_json FROM products WHERE product_id = ?",
    ).get(product.product_id) as { brand: string | null; payload_json: string } | undefined;
    const storedBatch = input.database.prepare(
      `SELECT product_id,explicit_expiration_at,quantity_unit,payload_json
       FROM inventory_batches WHERE batch_id = ?`,
    ).get(batch.batch_id) as {
      product_id: string; explicit_expiration_at: string | null; quantity_unit: string; payload_json: string;
    } | undefined;
    const storedProjection = input.database.prepare(
      "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
    ).get(batch.batch_id) as { payload_json: string } | undefined;
    let projectionPayload: Readonly<ParsedProjectionPayload>;
    try {
      if (!storedProduct || storedProduct.payload_json !== canonicalJson(product.payload)) {
        throw new Error("product");
      }
      const expectedIdentity = parseProductPayload(product.payload).identity;
      if (storedProduct.brand !== (expectedIdentity?.brand ?? null)) throw new Error("product_brand");
      if (!storedBatch || storedBatch.product_id !== product.product_id ||
        storedBatch.explicit_expiration_at !== batch.explicit_expiration_at ||
        storedBatch.quantity_unit !== batch.quantity_unit ||
        storedBatch.payload_json !== canonicalJson(batch.payload)
      ) throw new Error("batch");
      if (!storedProjection) throw new Error("projection");
      projectionPayload = parseProjectionPayloadJson(storedProjection.payload_json);
    } catch {
      throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_business_payload");
    }
    if (
      projectionPayload.version !== expectedPayload.version ||
      projectionPayload.product_id !== product.product_id || projectionPayload.batch_id !== batch.batch_id ||
      (expectedPayload.pantry_evidence !== null &&
        canonicalJson(projectionPayload.pantry_evidence) !== canonicalJson(expectedPayload.pantry_evidence))
    ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_business_payload");
    const transactions = input.database.prepare(
      `SELECT transaction_id,event_id,product_id,batch_id,direction,reason_code,unit,
              result_status,lifecycle_status,payload_json
       FROM inventory_transactions WHERE event_id = ? ORDER BY transaction_id`,
    ).all(event.event_id) as Array<{
      transaction_id: string; event_id: string; product_id: string; batch_id: string;
      direction: string; reason_code: string; unit: string; result_status: string;
      lifecycle_status: string; payload_json: string;
    }>;
    const transaction = transactions[0];
    const expectedQuantity = effect.quantity_microunits;
    const expectedTransactionPayload = canonicalJson({
      authority_kind: expectedQuantity === null
        ? "diet-manager/inventory-transaction/v2"
        : "diet-manager/inventory-transaction/v1",
      quantity_after_microunits: expectedQuantity,
      quantity_delta_microunits: expectedQuantity,
      unit: effect.unit,
    });
    if (!transaction || transactions.length !== 1 ||
      transaction.transaction_id !== effect.transaction_id || transaction.event_id !== event.event_id ||
      transaction.product_id !== product.product_id || transaction.batch_id !== batch.batch_id ||
      transaction.direction !== "in" || transaction.reason_code !== "purchase" ||
      transaction.unit !== effect.unit || transaction.result_status !== "applied" ||
      transaction.lifecycle_status !== "active" || transaction.payload_json !== expectedTransactionPayload
    ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_business_payload");
    const itemCount = input.database.prepare(
      "SELECT COUNT(*) AS count FROM meal_items WHERE event_id = ?",
    ).get(event.event_id) as { count: number };
    if (Number(itemCount.count) !== 0) {
      throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_items");
    }
    const outboxes = input.database.prepare(
      `SELECT outbox_id,effect_id,effect_kind,previous_state,reason
       FROM effect_outbox WHERE envelope_id = ? AND operation_id = ? ORDER BY outbox_id`,
    ).all(input.envelopeId, input.operationId) as Array<{
      outbox_id: string; effect_id: string; effect_kind: string;
      previous_state: string | null; reason: string | null;
    }>;
    const expectedEffect = expectedFact.effects[0];
    const outbox = outboxes[0];
    if (!outbox || !expectedEffect || outboxes.length !== 1 ||
      outbox.outbox_id !== expectedEffect.outboxId || outbox.effect_id !== expectedEffect.effectId ||
      outbox.effect_kind !== expectedEffect.effectKind ||
      outbox.previous_state !== expectedEffect.previousState || outbox.reason !== expectedEffect.reason
    ) throw new Error("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_outbox");
    input.database.exec("ROLLBACK");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { input.database.exec("ROLLBACK"); } catch { /* preserve primary error */ }
    }
    throw error;
  }
}
