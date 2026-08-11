import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import { createServerPreview } from "../src/preview/store.js";
import {
  commitPreparedFact,
  type FactCommitFailureEntry,
  type PreparedFactCommit,
} from "../src/repository/fact-commit.js";
import {
  listPendingInventoryEffects,
  processInventoryEffect,
  type InventoryEffectInput,
} from "../src/repository/inventory-effects.js";
import {
  finalizeEnvelope,
  type FinalizeEnvelopeInput,
} from "../src/repository/envelope-finalize.js";
import { getInventoryProjection } from "../src/repository/query.js";
import { computeRepositoryDataRevision } from "../src/repository/revision.js";
import {
  assertDietDatabaseIdentity,
  DIET_DATABASE_FILENAME,
  openDietDatabase,
} from "../src/storage/database.js";

const secret = Buffer.from("B-STOR-002 synthetic repository test key 0001", "utf8");
const requireNode = createRequire(import.meta.url);
const { backup } = requireNode("node:sqlite") as typeof import("node:sqlite");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(
    tmpdir(),
    `diet-manager-b-B-STOR-002-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function scalar(database: DatabaseSync, sql: string, ...values: unknown[]): number {
  const row = database.prepare(sql).get(...values) as Record<string, number>;
  return Number(Object.values(row)[0]);
}

function tableCounts(database: DatabaseSync): Record<string, number> {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables.map(({ name }) => [name, scalar(database, `SELECT COUNT(*) FROM "${name}"`)]),
  );
}

function businessCounts(counts: Record<string, number>): Record<string, number> {
  const control = new Set(["schema_migrations", "command_envelopes", "idempotency_records"]);
  return Object.fromEntries(Object.entries(counts).filter(([name]) => !control.has(name)));
}

function expectIntegrity(database: DatabaseSync): void {
  expect(database.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
  expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  assertDietDatabaseIdentity(database);
}

interface Fixture {
  root: string;
  runtime: ReturnType<typeof openDietDatabase>;
  input: PreparedFactCommit;
}

function createFixture(): Fixture {
  const root = newTestRoot();
  const runtime = openDietDatabase({
    privateRuntimeRoot: root,
    now: () => "2026-08-12T01:00:00.000Z",
  });
  const dataRevision = computeRepositoryDataRevision(runtime.database);
  const preview = createServerPreview({
    database: runtime.database,
    secret,
    previewId: "preview-repository-001",
    idempotencyKey: "idem-repository-001",
    inputDigest: "A".repeat(64),
    subjectScope: "user:synthetic-subject",
    commandType: "record_meal",
    dataRevision,
    sourceMessageId: "message-synthetic-001",
    conversationId: "conversation-synthetic-001",
    previewMaterial: {
      action: "record_meal",
      item_count: 2,
      synthetic: true,
    },
    now: "2026-08-12T01:00:01.000Z",
  });

  return {
    root,
    runtime,
    input: {
      database: runtime.database,
      secret,
      token: preview.token,
      inputDigest: "A".repeat(64),
      subjectScope: "user:synthetic-subject",
      commandType: "record_meal",
      dataRevision,
      traceId: "trace-repository-001",
      event: {
        eventId: "event-repository-001",
        operationId: "operation-repository-001",
        schemaVersion: "domain/v2",
        eventType: "diet_meal",
        factKind: "meal",
        sourceMessageId: "message-synthetic-001",
        conversationId: "conversation-synthetic-001",
        receivedAt: "2026-08-12T01:00:01.000Z",
        committedAt: "2026-08-12T01:00:02.000Z",
        occurredAtText: "2026-08-12T08:00:00+08:00",
        mealId: "meal-repository-001",
        mealSlot: "breakfast",
        payload: {
          contract: "B-STOR-002/synthetic-fact/v1",
          effect_inputs: {
            "effect-repository-001": {
              kind: "inventory_deduct",
              batch_id: "batch-synthetic-001",
              quantity_microunits: 1_000_000,
              unit: "synthetic-unit",
            },
          },
        },
      },
      items: [
        {
          itemId: "item-repository-001",
          itemOrder: 0,
          itemType: "synthetic_item",
          normalizedName: "fixture-item-a",
          payload: { synthetic: true, ordinal: 0 },
        },
        {
          itemId: "item-repository-002",
          itemOrder: 1,
          itemType: "synthetic_item",
          normalizedName: "fixture-item-b",
          payload: { synthetic: true, ordinal: 1 },
        },
      ],
      effects: [
        {
          outboxId: "outbox-repository-001",
          effectId: "effect-repository-001",
          effectKind: "inventory_deduct",
          previousState: null,
          reason: null,
        },
      ],
    },
  };
}

interface InventoryFactOptions {
  sequence: string;
  commandType: "add_inventory" | "record_meal";
  digestCharacter: string;
  effectInput: Record<string, unknown>;
}

function createInventoryFact(
  database: DatabaseSync,
  options: InventoryFactOptions,
): PreparedFactCommit {
  const previewId = `preview-inventory-${options.sequence}`;
  const idempotencyKey = `idem-inventory-${options.sequence}`;
  const eventId = `event-inventory-${options.sequence}`;
  const effectId = `effect-inventory-${options.sequence}`;
  const digest = options.digestCharacter.repeat(64);
  const isMeal = options.commandType === "record_meal";
  const dataRevision = computeRepositoryDataRevision(database);
  const preview = createServerPreview({
    database,
    secret,
    previewId,
    idempotencyKey,
    inputDigest: digest,
    subjectScope: "user:synthetic-subject",
    commandType: options.commandType,
    dataRevision,
    sourceMessageId: `message-inventory-${options.sequence}`,
    conversationId: "conversation-inventory-fixture",
    previewMaterial: {
      action: options.commandType,
      effect_id: effectId,
      synthetic: true,
    },
    now: `2026-08-12T02:0${options.sequence}:00.000Z`,
  });

  return {
    database,
    secret,
    token: preview.token,
    inputDigest: digest,
    subjectScope: "user:synthetic-subject",
    commandType: options.commandType,
    dataRevision,
    traceId: `trace-inventory-${options.sequence}`,
    event: {
      eventId,
      operationId: `operation-inventory-${options.sequence}`,
      schemaVersion: "domain/v2",
      eventType: isMeal ? "diet_meal" : "inventory_stock",
      factKind: isMeal ? "meal" : "inventory",
      sourceMessageId: `message-inventory-${options.sequence}`,
      conversationId: "conversation-inventory-fixture",
      receivedAt: `2026-08-12T02:0${options.sequence}:00.000Z`,
      committedAt: `2026-08-12T02:0${options.sequence}:01.000Z`,
      occurredAtText: `2026-08-12T10:0${options.sequence}:00+08:00`,
      mealId: isMeal ? `meal-inventory-${options.sequence}` : null,
      mealSlot: isMeal ? "synthetic-slot" : null,
      payload: {
        contract: "B-STOR-002/synthetic-inventory/v1",
        effect_inputs: { [effectId]: options.effectInput },
      },
    },
    items: isMeal
      ? [
          {
            itemId: `item-inventory-${options.sequence}`,
            itemOrder: 0,
            itemType: "synthetic_item",
            normalizedName: "fixture-inventory-item",
            payload: { synthetic: true },
          },
        ]
      : [],
    effects: [
      {
        outboxId: `outbox-inventory-${options.sequence}`,
        effectId,
        effectKind: String(options.effectInput.kind),
        previousState: null,
        reason: null,
      },
    ],
  };
}

function addFact(database: DatabaseSync): PreparedFactCommit {
  return createInventoryFact(database, {
    sequence: "1",
    commandType: "add_inventory",
    digestCharacter: "B",
    effectInput: {
      kind: "inventory_add",
      transaction_id: "transaction-inventory-add-001",
      reason_code: "initial_stock",
      quantity_microunits: 10_000_000,
      unit: "synthetic-unit",
      product: {
        product_id: "product-synthetic-001",
        schema_version: "domain/v2",
        normalized_name: "fixture-product",
        product_type: "synthetic_product",
        payload: { synthetic: true, authority: "fixture" },
      },
      batch: {
        batch_id: "batch-synthetic-001",
        schema_version: "domain/v2",
        stocked_at: "2026-08-12T02:01:00.000Z",
        explicit_expiration_at: null,
        quantity_unit: "synthetic-unit",
        payload: { synthetic: true, seal_status: "unknown" },
      },
    },
  });
}

function deductFact(
  database: DatabaseSync,
  sequence: "2" | "3",
  quantityMicrounits: number,
): PreparedFactCommit {
  return createInventoryFact(database, {
    sequence,
    commandType: "record_meal",
    digestCharacter: sequence === "2" ? "C" : "D",
    effectInput: {
      kind: "inventory_deduct",
      transaction_id: `transaction-inventory-deduct-00${sequence}`,
      reason_code: "meal_consumption",
      product_id: "product-synthetic-001",
      batch_id: "batch-synthetic-001",
      quantity_microunits: quantityMicrounits,
      unit: "synthetic-unit",
    },
  });
}

function effectInput(database: DatabaseSync, sequence: "1" | "2" | "3"): InventoryEffectInput {
  return {
    database,
    outboxId: `outbox-inventory-${sequence}`,
    now: `2026-08-12T03:0${sequence}:00.000Z`,
  };
}

function finalizerInput(
  database: DatabaseSync,
  add: PreparedFactCommit,
): FinalizeEnvelopeInput {
  return {
    database,
    secret,
    token: add.token,
    inputDigest: add.inputDigest,
    subjectScope: add.subjectScope,
    commandType: add.commandType,
    dataRevision: add.dataRevision,
    traceId: "trace-finalize-001",
    resultStatus: "committed",
    receiptId: "receipt-synthetic-001",
    finalizedAt: "2026-08-12T04:00:00.000Z",
    frozenAt: "2026-08-12T04:00:00.000Z",
    payload: {
      contract: "B-STOR-002/synthetic-terminal/v1",
      items: [],
      synthetic: true,
    },
  };
}

function disposeFixture(fixture: Fixture): void {
  fixture.runtime.close();
  removeOwnedRoot(fixture.root);
}

describe("B-STOR-002 FactCommit", () => {
  test("commits one complete fact and durable effect checkpoint atomically", () => {
    const fixture = createFixture();
    try {
      const before = tableCounts(fixture.runtime.database);
      const result = commitPreparedFact(fixture.input);
      const after = tableCounts(fixture.runtime.database);

      expect(result).toEqual({
        envelope_id: "preview-repository-001",
        event_id: "event-repository-001",
        operation_id: "operation-repository-001",
        idempotency_key: "idem-repository-001",
        input_digest: "A".repeat(64),
        envelope_state: "effects_pending",
        result_status: "facts_committed_effects_pending",
        item_ids: ["item-repository-001", "item-repository-002"],
        effect_ids: ["effect-repository-001"],
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(after.event_records - before.event_records).toBe(1);
      expect(after.meal_items - before.meal_items).toBe(2);
      expect(after.effect_outbox - before.effect_outbox).toBe(1);
      expect(after.command_envelopes).toBe(before.command_envelopes);
      expect(after.idempotency_records).toBe(before.idempotency_records);
      expect(
        fixture.runtime.database
          .prepare(
            "SELECT state, result_status, committed_at FROM command_envelopes WHERE envelope_id = ?",
          )
          .get("preview-repository-001"),
      ).toEqual({
        state: "effects_pending",
        result_status: "facts_committed_effects_pending",
        committed_at: "2026-08-12T01:00:02.000Z",
      });
      expect(
        fixture.runtime.database
          .prepare(
            "SELECT state, terminal_result_json FROM idempotency_records WHERE idempotency_key = ?",
          )
          .get("idem-repository-001"),
      ).toEqual({
        state: "effects_pending",
        terminal_result_json: null,
      });
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rolls back every new business row before emitting one redacted failure diagnostic", () => {
    const fixture = createFixture();
    const diagnostics: FactCommitFailureEntry[] = [];
    const diagnosticPath = join(fixture.root, "technical-failures.log");
    try {
      const before = tableCounts(fixture.runtime.database);
      expect(() =>
        commitPreparedFact(fixture.input, {
          fault: "before_commit",
          failureSink(entry) {
            diagnostics.push(entry);
            appendFileSync(diagnosticPath, `${JSON.stringify(entry)}\n`, "utf8");
          },
        }),
      ).toThrow("FACT_COMMIT_FAILED:before_commit");
      const after = tableCounts(fixture.runtime.database);

      expect(after).toEqual(before);
      expect(Object.values(businessCounts(after)).every((count) => count === 0)).toBe(true);
      expect(diagnostics).toEqual([
        {
          phase: "fact_commit",
          error_code: "FACT_COMMIT_FAILED",
          trace_id: "trace-repository-001",
          input_digest: "A".repeat(64),
        },
      ]);
      expect(Object.isFrozen(diagnostics[0])).toBe(true);
      expect(readFileSync(diagnosticPath, "utf8")).toBe(
        `${JSON.stringify(diagnostics[0])}\n`,
      );
      expect(JSON.stringify(diagnostics[0])).not.toMatch(
        /fixture-item|synthetic-unit|preview-repository|token|secret|sqlite/i,
      );
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("preserves the primary rollback failure when the external diagnostic sink also fails", () => {
    const fixture = createFixture();
    try {
      const before = tableCounts(fixture.runtime.database);
      expect(() =>
        commitPreparedFact(fixture.input, {
          fault: "before_commit",
          failureSink() {
            throw new Error("synthetic diagnostic sink unavailable");
          },
        }),
      ).toThrow("FACT_COMMIT_FAILED:before_commit");
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rolls back every partial FactCommit write point without leaving a half record", () => {
    const faults = [
      "after_event",
      "after_items",
      "after_effects",
      "after_facts_transition",
      "after_pending_transition",
      "after_idempotency",
      "before_commit",
    ] as const;
    for (const fault of faults) {
      const fixture = createFixture();
      try {
        const before = tableCounts(fixture.runtime.database);
        expect(() => commitPreparedFact(fixture.input, { fault })).toThrow(
          `FACT_COMMIT_FAILED:${fault}`,
        );
        expect(tableCounts(fixture.runtime.database)).toEqual(before);
        expect(Object.values(businessCounts(before)).every((count) => count === 0)).toBe(
          true,
        );
        expectIntegrity(fixture.runtime.database);
      } finally {
        disposeFixture(fixture);
      }
    }
  });

  test("recovers an authoritative exact replay after commit response loss", () => {
    const fixture = createFixture();
    try {
      expect(() =>
        commitPreparedFact(fixture.input, { fault: "after_commit_before_reply" }),
      ).toThrow("FACT_COMMIT_RESPONSE_LOST");
      const committedCounts = tableCounts(fixture.runtime.database);
      const replay = commitPreparedFact(fixture.input);

      expect(replay).toEqual({
        envelope_id: "preview-repository-001",
        event_id: "event-repository-001",
        operation_id: "operation-repository-001",
        idempotency_key: "idem-repository-001",
        input_digest: "A".repeat(64),
        envelope_state: "effects_pending",
        result_status: "facts_committed_effects_pending",
        item_ids: ["item-repository-001", "item-repository-002"],
        effect_ids: ["effect-repository-001"],
      });
      expect(tableCounts(fixture.runtime.database)).toEqual(committedCounts);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("recovers the committed fact from SQLite after closing and reopening the process connection", () => {
    const fixture = createFixture();
    let reopened: ReturnType<typeof openDietDatabase> | undefined;
    try {
      expect(() =>
        commitPreparedFact(fixture.input, { fault: "after_commit_before_reply" }),
      ).toThrow("FACT_COMMIT_RESPONSE_LOST");
      fixture.runtime.close();
      reopened = openDietDatabase({ privateRuntimeRoot: fixture.root });
      const counts = tableCounts(reopened.database);

      expect(
        commitPreparedFact({ ...fixture.input, database: reopened.database }),
      ).toEqual({
        envelope_id: "preview-repository-001",
        event_id: "event-repository-001",
        operation_id: "operation-repository-001",
        idempotency_key: "idem-repository-001",
        input_digest: "A".repeat(64),
        envelope_state: "effects_pending",
        result_status: "facts_committed_effects_pending",
        item_ids: ["item-repository-001", "item-repository-002"],
        effect_ids: ["effect-repository-001"],
      });
      expect(tableCounts(reopened.database)).toEqual(counts);
      expectIntegrity(reopened.database);
    } finally {
      reopened?.close();
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  test("rejects a changed deterministic fact under the same authority with zero mutation", () => {
    const fixture = createFixture();
    try {
      commitPreparedFact(fixture.input);
      const before = tableCounts(fixture.runtime.database);
      const conflicting = {
        ...fixture.input,
        event: { ...fixture.input.event, eventId: "event-repository-conflict" },
      };

      expect(() => commitPreparedFact(conflicting)).toThrow(
        "IDEMPOTENCY_CONFLICT:fact_identity",
      );
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
      expect(scalar(fixture.runtime.database, "SELECT COUNT(*) FROM event_records")).toBe(1);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rejects an unused preview after another fact changes the server repository revision", () => {
    const fixture = createFixture();
    try {
      const laterFact = addFact(fixture.runtime.database);
      commitPreparedFact(laterFact);
      const before = tableCounts(fixture.runtime.database);

      expect(() => commitPreparedFact(fixture.input)).toThrow(
        "PREVIEW_STALE:data_revision",
      );
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
      expect(
        scalar(
          fixture.runtime.database,
          "SELECT COUNT(*) FROM event_records WHERE envelope_id = 'preview-repository-001'",
        ),
      ).toBe(0);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("includes authoritative product rows in the server repository revision", () => {
    const fixture = createFixture();
    try {
      const previewRevision = fixture.input.dataRevision;
      fixture.runtime.database
        .prepare(
          `INSERT INTO products(
             product_id, schema_version, normalized_name, product_type,
             brand, manufacturer, barcode, sku, payload_json
           ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
        )
        .run(
          "product-revision-only-001",
          "domain/v2",
          "revision-only-product",
          "synthetic_product",
          JSON.stringify({ contract: "B-STOR-002/revision-product/v1" }),
        );

      expect(computeRepositoryDataRevision(fixture.runtime.database)).not.toBe(
        previewRevision,
      );
      const before = tableCounts(fixture.runtime.database);
      expect(() => commitPreparedFact(fixture.input)).toThrow(
        "PREVIEW_STALE:data_revision",
      );
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
      expect(
        scalar(
          fixture.runtime.database,
          "SELECT COUNT(*) FROM event_records WHERE envelope_id = 'preview-repository-001'",
        ),
      ).toBe(0);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rejects active request members before reading them or opening SQL", () => {
    const fixture = createFixture();
    let getterCalls = 0;
    try {
      const dynamic = { ...fixture.input } as Record<string, unknown>;
      Object.defineProperty(dynamic, "traceId", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "unsafe";
        },
      });
      const before = tableCounts(fixture.runtime.database);

      expect(() => commitPreparedFact(dynamic as unknown as PreparedFactCommit)).toThrow(
        "FACT_COMMIT_REQUEST_INVALID:descriptor",
      );
      expect(getterCalls).toBe(0);
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rejects a fact with no durable effect checkpoint instead of leaving a stuck envelope", () => {
    const fixture = createFixture();
    try {
      const before = tableCounts(fixture.runtime.database);
      expect(() => commitPreparedFact({ ...fixture.input, effects: [] })).toThrow(
        "FACT_COMMIT_REQUEST_INVALID:effects",
      );
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
    } finally {
      disposeFixture(fixture);
    }
  });
});

describe("B-STOR-002 inventory EffectBundle", () => {
  test("adds one batch, applies one deduction and preserves the projection after reopen", () => {
    const root = newTestRoot();
    let runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T02:00:00.000Z",
    });
    try {
      const add = addFact(runtime.database);
      commitPreparedFact(add);
      expect(processInventoryEffect(effectInput(runtime.database, "1"))).toEqual({
        outbox_id: "outbox-inventory-1",
        effect_id: "effect-inventory-1",
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: "batch-synthetic-001",
        transaction_id: "transaction-inventory-add-001",
        quantity_microunits: 10_000_000,
        unit: "synthetic-unit",
      });
      expect(getInventoryProjection({
        database: runtime.database,
        batchId: "batch-synthetic-001",
      })).toEqual({
        batch_id: "batch-synthetic-001",
        product_id: "product-synthetic-001",
        quantity_microunits: 10_000_000,
        unit: "synthetic-unit",
        quantity_status: "available",
        effective_status: "active",
        last_event_id: "event-inventory-1",
        last_changed_at: "2026-08-12T03:01:00.000Z",
      });

      const deduct = deductFact(runtime.database, "2", 4_000_000);
      commitPreparedFact(deduct);
      expect(processInventoryEffect(effectInput(runtime.database, "2"))).toEqual({
        outbox_id: "outbox-inventory-2",
        effect_id: "effect-inventory-2",
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: "batch-synthetic-001",
        transaction_id: "transaction-inventory-deduct-002",
        quantity_microunits: 6_000_000,
        unit: "synthetic-unit",
      });
      expect(processInventoryEffect(effectInput(runtime.database, "1"))).toEqual({
        outbox_id: "outbox-inventory-1",
        effect_id: "effect-inventory-1",
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: "batch-synthetic-001",
        transaction_id: "transaction-inventory-add-001",
        quantity_microunits: 10_000_000,
        unit: "synthetic-unit",
      });

      const beforeClose = getInventoryProjection({
        database: runtime.database,
        batchId: "batch-synthetic-001",
      });
      runtime.close();
      runtime = openDietDatabase({ privateRuntimeRoot: root });
      expect(getInventoryProjection({
        database: runtime.database,
        batchId: "batch-synthetic-001",
      })).toEqual(beforeClose);
      expectIntegrity(runtime.database);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  test("commits insufficient inventory as a business skip without a negative projection", () => {
    const fixture = createFixture();
    try {
      commitPreparedFact(addFact(fixture.runtime.database));
      processInventoryEffect(effectInput(fixture.runtime.database, "1"));
      commitPreparedFact(deductFact(fixture.runtime.database, "2", 4_000_000));
      processInventoryEffect(effectInput(fixture.runtime.database, "2"));
      commitPreparedFact(deductFact(fixture.runtime.database, "3", 7_000_000));
      const beforeProjection = getInventoryProjection({
        database: fixture.runtime.database,
        batchId: "batch-synthetic-001",
      });
      const beforeTransactions = scalar(
        fixture.runtime.database,
        "SELECT COUNT(*) FROM inventory_transactions",
      );

      expect(processInventoryEffect(effectInput(fixture.runtime.database, "3"))).toEqual({
        outbox_id: "outbox-inventory-3",
        effect_id: "effect-inventory-3",
        effect_state: "permanent_business_skip",
        result_status: "insufficient_inventory",
        batch_id: "batch-synthetic-001",
        transaction_id: null,
        quantity_microunits: 6_000_000,
        unit: "synthetic-unit",
      });
      expect(
        scalar(fixture.runtime.database, "SELECT COUNT(*) FROM inventory_transactions"),
      ).toBe(beforeTransactions);
      expect(getInventoryProjection({
        database: fixture.runtime.database,
        batchId: "batch-synthetic-001",
      })).toEqual(beforeProjection);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rolls a technical effect failure back to pending while preserving the committed fact", () => {
    const fixture = createFixture();
    try {
      commitPreparedFact(addFact(fixture.runtime.database));
      const before = tableCounts(fixture.runtime.database);

      expect(() =>
        processInventoryEffect(effectInput(fixture.runtime.database, "1"), {
          fault: "before_commit",
        }),
      ).toThrow("INVENTORY_EFFECT_FAILED:before_commit");
      const after = tableCounts(fixture.runtime.database);
      expect(after).toEqual(before);
      expect(
        fixture.runtime.database
          .prepare("SELECT state, attempt_count FROM effect_outbox WHERE outbox_id = ?")
          .get("outbox-inventory-1"),
      ).toEqual({ state: "pending", attempt_count: 0 });
      expect(after.event_records).toBe(1);
      expect(after.products).toBe(0);
      expect(after.inventory_batches).toBe(0);
      expect(after.inventory_batch_projections).toBe(0);
      expect(after.inventory_transactions).toBe(0);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("discovers pending inventory work deterministically after database reopen", () => {
    const fixture = createFixture();
    let reopened: ReturnType<typeof openDietDatabase> | undefined;
    try {
      commitPreparedFact(addFact(fixture.runtime.database));
      fixture.runtime.close();
      reopened = openDietDatabase({ privateRuntimeRoot: fixture.root });

      const pending = listPendingInventoryEffects({
        database: reopened.database,
        limit: 10,
      });
      expect(pending).toEqual([
        {
          outbox_id: "outbox-inventory-1",
          envelope_id: "preview-inventory-1",
          operation_id: "operation-inventory-1",
          effect_id: "effect-inventory-1",
          effect_kind: "inventory_add",
          state: "pending",
          attempt_count: 0,
          created_at: "2026-08-12T02:01:01.000Z",
          updated_at: "2026-08-12T02:01:01.000Z",
        },
      ]);
      expect(Object.isFrozen(pending)).toBe(true);
      expect(Object.isFrozen(pending[0])).toBe(true);
      expectIntegrity(reopened.database);
    } finally {
      reopened?.close();
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  test("rolls back every partial inventory effect write point", () => {
    const faults = [
      "after_claim",
      "after_business_writes",
      "after_outbox",
      "after_bundle",
      "before_commit",
    ] as const;
    for (const fault of faults) {
      const fixture = createFixture();
      try {
        commitPreparedFact(addFact(fixture.runtime.database));
        const before = tableCounts(fixture.runtime.database);
        expect(() =>
          processInventoryEffect(effectInput(fixture.runtime.database, "1"), { fault }),
        ).toThrow(`INVENTORY_EFFECT_FAILED:${fault}`);
        expect(tableCounts(fixture.runtime.database)).toEqual(before);
        expect(
          fixture.runtime.database
            .prepare("SELECT state, attempt_count FROM effect_outbox WHERE outbox_id = ?")
            .get("outbox-inventory-1"),
        ).toEqual({ state: "pending", attempt_count: 0 });
        expectIntegrity(fixture.runtime.database);
      } finally {
        disposeFixture(fixture);
      }
    }
  });

  test("replays one applied effect after response loss without a second inventory mutation", () => {
    const fixture = createFixture();
    try {
      const add = addFact(fixture.runtime.database);
      const factResult = commitPreparedFact(add);
      expect(() =>
        processInventoryEffect(effectInput(fixture.runtime.database, "1"), {
          fault: "after_commit_before_reply",
        }),
      ).toThrow("INVENTORY_EFFECT_RESPONSE_LOST");
      const afterCommit = tableCounts(fixture.runtime.database);
      const replay = processInventoryEffect(effectInput(fixture.runtime.database, "1"));

      expect(replay).toEqual({
        outbox_id: "outbox-inventory-1",
        effect_id: "effect-inventory-1",
        effect_state: "succeeded",
        result_status: "applied",
        batch_id: "batch-synthetic-001",
        transaction_id: "transaction-inventory-add-001",
        quantity_microunits: 10_000_000,
        unit: "synthetic-unit",
      });
      expect(tableCounts(fixture.runtime.database)).toEqual(afterCommit);
      expect(commitPreparedFact(add)).toEqual(factResult);
      expect(tableCounts(fixture.runtime.database)).toEqual(afterCommit);
      expect(
        scalar(fixture.runtime.database, "SELECT COUNT(*) FROM inventory_transactions"),
      ).toBe(1);
      expect(
        fixture.runtime.database
          .prepare("SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?")
          .get("preview-inventory-1"),
      ).toEqual({ state: "effects_stable", result_status: "effects_stable" });
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });
});

describe("B-STOR-002 EnvelopeFinalize", () => {
  test("rolls back every finalizer write while preserving the committed fact and stable effect", () => {
    const fixture = createFixture();
    try {
      const add = addFact(fixture.runtime.database);
      commitPreparedFact(add);
      processInventoryEffect(effectInput(fixture.runtime.database, "1"));
      const before = tableCounts(fixture.runtime.database);

      expect(() =>
        finalizeEnvelope(finalizerInput(fixture.runtime.database, add), {
          fault: "before_commit",
        }),
      ).toThrow("ENVELOPE_FINALIZE_FAILED:before_commit");
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
      expect(before.event_records).toBe(1);
      expect(before.inventory_transactions).toBe(1);
      expect(before.envelope_finalizations).toBe(0);
      expect(
        fixture.runtime.database
          .prepare("SELECT state, result_status FROM command_envelopes WHERE envelope_id = ?")
          .get("preview-inventory-1"),
      ).toEqual({ state: "effects_stable", result_status: "effects_stable" });
      expect(
        fixture.runtime.database
          .prepare("SELECT state, terminal_result_json FROM idempotency_records WHERE operation_id = ?")
          .get("preview-inventory-1"),
      ).toEqual({ state: "effects_stable", terminal_result_json: null });
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });

  test("rolls back every partial finalizer write point", () => {
    const faults = [
      "after_finalization_row",
      "after_envelope",
      "after_idempotency",
      "before_commit",
    ] as const;
    for (const fault of faults) {
      const fixture = createFixture();
      try {
        const add = addFact(fixture.runtime.database);
        commitPreparedFact(add);
        processInventoryEffect(effectInput(fixture.runtime.database, "1"));
        const before = tableCounts(fixture.runtime.database);
        expect(() =>
          finalizeEnvelope(finalizerInput(fixture.runtime.database, add), { fault }),
        ).toThrow(`ENVELOPE_FINALIZE_FAILED:${fault}`);
        expect(tableCounts(fixture.runtime.database)).toEqual(before);
        expect(
          fixture.runtime.database
            .prepare("SELECT state FROM command_envelopes WHERE envelope_id = ?")
            .get("preview-inventory-1"),
        ).toEqual({ state: "effects_stable" });
        expectIntegrity(fixture.runtime.database);
      } finally {
        disposeFixture(fixture);
      }
    }
  });

  test("replays the original frozen terminal result after response loss and a later fact", () => {
    const fixture = createFixture();
    try {
      const add = addFact(fixture.runtime.database);
      commitPreparedFact(add);
      processInventoryEffect(effectInput(fixture.runtime.database, "1"));
      const finalize = finalizerInput(fixture.runtime.database, add);

      expect(() =>
        finalizeEnvelope(finalize, { fault: "after_commit_before_reply" }),
      ).toThrow("ENVELOPE_FINALIZE_RESPONSE_LOST");
      const terminalCounts = tableCounts(fixture.runtime.database);
      const later = deductFact(fixture.runtime.database, "2", 1_000_000);
      commitPreparedFact(later);
      const afterLaterFact = tableCounts(fixture.runtime.database);
      expect(afterLaterFact.event_records).toBe(terminalCounts.event_records + 1);

      expect(finalizeEnvelope(finalize)).toEqual({
        envelope_id: "preview-inventory-1",
        idempotency_key: "idem-inventory-1",
        input_digest: "B".repeat(64),
        envelope_state: "finalized",
        result_status: "committed",
        receipt_id: "receipt-synthetic-001",
        finalized_at: "2026-08-12T04:00:00.000Z",
        frozen_at: "2026-08-12T04:00:00.000Z",
        payload: {
          contract: "B-STOR-002/synthetic-terminal/v1",
          items: [],
          synthetic: true,
        },
      });
      expect(tableCounts(fixture.runtime.database)).toEqual(afterLaterFact);
      expect(
        scalar(
          fixture.runtime.database,
          "SELECT COUNT(*) FROM envelope_finalizations WHERE envelope_id = 'preview-inventory-1'",
        ),
      ).toBe(1);
      expectIntegrity(fixture.runtime.database);
    } finally {
      disposeFixture(fixture);
    }
  });
});

describe("B-STOR-002 repository backup compatibility", () => {
  test("produces a separately opened integrity-valid candidate with the committed projection", async () => {
    const source = createFixture();
    const backupRoot = newTestRoot();
    let restored: ReturnType<typeof openDietDatabase> | undefined;
    try {
      const add = addFact(source.runtime.database);
      commitPreparedFact(add);
      processInventoryEffect(effectInput(source.runtime.database, "1"));
      const expectedProjection = getInventoryProjection({
        database: source.runtime.database,
        batchId: "batch-synthetic-001",
      });

      await backup(
        source.runtime.database,
        join(backupRoot, DIET_DATABASE_FILENAME),
      );
      restored = openDietDatabase({ privateRuntimeRoot: backupRoot });
      expect(getInventoryProjection({
        database: restored.database,
        batchId: "batch-synthetic-001",
      })).toEqual(expectedProjection);
      expect(tableCounts(restored.database)).toEqual(tableCounts(source.runtime.database));
      expectIntegrity(restored.database);
    } finally {
      restored?.close();
      source.runtime.close();
      removeOwnedRoot(source.root);
      removeOwnedRoot(backupRoot);
    }
  });
});
