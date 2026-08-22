import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../src/authority/canonical-json.js";
import { preparePurchaseOperation } from "../src/domain/effect-bundle.js";
import { deriveDomainId } from "../src/domain/identity.js";
import { createDietDomainService } from "../src/domain/service.js";
import type { AddInventoryOperation, DomainEnvelopeInput, NutritionSourceCandidate } from "../src/domain/types.js";
import type { PreparedEnvelopeOperation, PreparedEnvelopeSeal } from "../src/repository/fact-commit.js";
import { commitPreparedPurchaseEnvelope } from "../src/repository/purchase-envelope-commit.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-PURCHASE-ENVELOPE test secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = join(tmpdir(), `diet-manager-purchase-envelope-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  ownedRoots.delete(root);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function tableSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function nutritionSource(sourceRef: string, productId: string): NutritionSourceCandidate {
  return {
    source_type: "product_label",
    source_ref: sourceRef,
    profile_version: 1,
    applicable_product_id: productId,
    basis_kind: "per_item",
    basis_microunits: 1_000_000,
    basis_unit: "piece",
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: 1_000,
      water_ml_milli: 50_000,
    },
  };
}

function purchaseOperation(suffix: string, name: string, productId: string) {
  return {
    kind: "add_inventory" as const,
    operation_id: `operation-envelope-${suffix}`,
    product: { product_id: productId, normalized_name: name, product_type: "food" },
    batch_id: `batch-envelope-${suffix}`,
    amount: {
      unit: "piece",
      observed_microunits: 10_000_000,
      nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "explicit",
    },
    nutrition_sources: [nutritionSource(`label-${productId}-v1`, productId)],
  };
}

function multiPurchaseEnvelope(): DomainEnvelopeInput {
  return {
    envelope_id: "envelope-multi-purchase-atomic",
    idempotency_key: "idem-multi-purchase-atomic",
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: "message-multi-purchase-atomic",
    conversation_id: "conversation-multi-purchase-atomic",
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      purchaseOperation("milk", "milk", "product-milk"),
      purchaseOperation("egg", "egg", "product-egg"),
      purchaseOperation("apple", "apple", "product-apple"),
    ],
  };
}

function timestampAfter(value: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(value) + offsetMilliseconds).toISOString();
}

function purchaseEnvelope(suffix: string, count: number): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-${suffix}`,
    idempotency_key: `idem-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-${suffix}`,
    conversation_id: `conversation-${suffix}`,
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: Array.from({ length: count }, (_, index) =>
      purchaseOperation(`${suffix}-${index}`, `item-${index}`, `product-${suffix}-${index}`)),
  };
}

function preparedPurchaseCommit(
  database: DatabaseSync,
  envelope: DomainEnvelopeInput,
  preview: { token: string; input_digest: string; data_revision: string },
): {
  operations: readonly PreparedEnvelopeOperation[];
  seal: PreparedEnvelopeSeal;
  effect_times: readonly string[];
} {
  const baseTime = (database.prepare(
    "SELECT received_at FROM command_envelopes WHERE envelope_id = ?",
  ).get(envelope.envelope_id) as { received_at: string }).received_at;
  const operations = envelope.operations as readonly AddInventoryOperation[];
  const prepared = operations.map((operation, sequence) => preparePurchaseOperation({
    database,
    secret,
    token: preview.token,
    inputDigest: preview.input_digest,
    dataRevision: preview.data_revision,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    idempotencyKey: envelope.idempotency_key,
    effectIdentityKey: deriveDomainId("idempotency", envelope.idempotency_key, sequence),
    sourceMessageId: envelope.source_message_id,
    conversationId: envelope.conversation_id,
    receivedAt: envelope.received_at,
    committedAt: timestampAfter(baseTime, sequence),
    sequence,
    operation,
  }));
  const seal: PreparedEnvelopeSeal = {
    database,
    secret,
    token: preview.token,
    inputDigest: preview.input_digest,
    subjectScope: envelope.subject_scope,
    commandType: envelope.command_type,
    dataRevision: preview.data_revision,
    traceId: deriveDomainId("trace", envelope.idempotency_key, 0),
    expectedOperationIds: Object.freeze(operations.map((operation) => operation.operation_id)),
    sealedAt: timestampAfter(baseTime, operations.length),
  };
  return {
    operations: Object.freeze(prepared.map((preparedPurchase) => preparedPurchase.fact)),
    seal,
    effect_times: Object.freeze(operations.map((_, sequence) => timestampAfter(baseTime, sequence))),
  };
}

describe("Task 9 multi-purchase atomic commit", () => {
  it("leaves every table unchanged when an operation effect fails mid-envelope", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T02:00:01.000Z",
        fault: "after_inventory_business_writes",
      });
      const envelope = multiPurchaseEnvelope();
      const preview = service.preview(envelope);
      const before = tableSnapshot(runtime.database);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("INVENTORY_EFFECT_FAILED");
      expect(tableSnapshot(runtime.database)).toBe(before);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});

describe("Task 9 purchase-envelope-commit coordinator", () => {
  it("rolls back the whole envelope when a later operation's effect fails (index-1 fault)", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T02:00:01.000Z",
      });
      const envelope = purchaseEnvelope("index1", 3);
      const preview = service.preview(envelope);
      const commit = preparedPurchaseCommit(runtime.database, envelope, preview);
      const before = tableSnapshot(runtime.database);
      expect(() => commitPreparedPurchaseEnvelope(
        commit,
        { fault: "after_operation_effect", faultSequence: 1 },
      )).toThrow("INVENTORY_EFFECT_FAILED:after_business_writes");
      expect(tableSnapshot(runtime.database)).toBe(before);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("commits every operation and returns a stable envelope on success", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T02:00:01.000Z",
      });
      const envelope = purchaseEnvelope("success", 3);
      const preview = service.preview(envelope);
      const commit = preparedPurchaseCommit(runtime.database, envelope, preview);
      const result = commitPreparedPurchaseEnvelope(commit);
      expect(result.envelope_state).toBe("effects_stable");
      expect(result.operation_ids).toEqual(
        envelope.operations.map((operation) => operation.operation_id),
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ count: 3 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_batches",
      ).get()).toEqual({ count: 3 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions",
      ).get()).toEqual({ count: 3 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("commits once and replays the frozen result after response loss", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T02:00:01.000Z",
      });
      const envelope = purchaseEnvelope("replay", 2);
      const preview = service.preview(envelope);
      const commit = preparedPurchaseCommit(runtime.database, envelope, preview);
      expect(() => commitPreparedPurchaseEnvelope(
        commit,
        { fault: "after_commit_before_reply" },
      )).toThrow("PURCHASE_ENVELOPE_RESPONSE_LOST:after_commit_before_reply");
      const replayed = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(replayed.status).toBe("committed");
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({ count: 2 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rejects a different input under the same idempotency key", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T02:00:01.000Z",
      });
      const envelope = purchaseEnvelope("conflict", 2);
      service.preview(envelope);
      const conflicting = {
        ...envelope,
        operations: [
          purchaseOperation("conflict-0", "item-changed", "product-conflict-0"),
          purchaseOperation("conflict-1", "item-1", "product-conflict-1"),
        ],
      };
      expect(() => service.preview(conflicting)).toThrow("IDEMPOTENCY_CONFLICT:input_digest");
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("commits the 64-operation upper bound and rejects 65", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T02:00:01.000Z",
      });
      const sixtyFour = purchaseEnvelope("bound64", 64);
      const preview = service.preview(sixtyFour);
      const executed = service.execute({
        envelope: sixtyFour,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(executed.status).toBe("committed");
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE envelope_id = ?",
      ).get(sixtyFour.envelope_id)).toEqual({ count: 64 });

      expect(() => service.preview(purchaseEnvelope("bound65", 65))).toThrow("operation_count");
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});
