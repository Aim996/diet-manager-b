import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import { createServerPreview } from "../src/preview/store.js";
import {
  commitPreparedFact,
  type FactCommitFailureEntry,
  type PreparedFactCommit,
} from "../src/repository/fact-commit.js";
import { assertDietDatabaseIdentity, openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-STOR-002 synthetic repository test key 0001", "utf8");
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
  const preview = createServerPreview({
    database: runtime.database,
    secret,
    previewId: "preview-repository-001",
    idempotencyKey: "idem-repository-001",
    inputDigest: "A".repeat(64),
    subjectScope: "user:synthetic-subject",
    commandType: "record_meal",
    dataRevision: "events:EMPTY|inventory:EMPTY",
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
      dataRevision: "events:EMPTY|inventory:EMPTY",
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
              quantity: 1,
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
    try {
      const before = tableCounts(fixture.runtime.database);
      expect(() =>
        commitPreparedFact(fixture.input, {
          fault: "before_commit",
          failureSink(entry) {
            diagnostics.push(entry);
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
});
