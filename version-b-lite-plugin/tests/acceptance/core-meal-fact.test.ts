import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/authority/canonical-json.js";
import { prepareMealOperation } from "../../src/domain/effect-bundle.js";
import { createDietDomainService, type DietDomainService } from "../../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  RecordMealOperation,
} from "../../src/domain/types.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { reservationFromEventPayload } from "../../src/repository/progress-reservation.js";
import { openDietDatabase } from "../../src/storage/database.js";

const secret = Buffer.from("SEL-CORE-001 meal evidence test secret", "utf8");
const fixedNow = "2026-08-11T00:30:01.000Z";
const validMealFactEvidence = Object.freeze({
  source_text: "吃了一个苹果。",
  occurred_time: Object.freeze({
    raw_text: null,
    resolved_start: "2026-08-11T08:30:00+08:00",
    resolved_end: "2026-08-11T08:31:00+08:00",
    precision: "exact",
    timezone: "Asia/Shanghai",
    resolution_basis: "default_received_at",
    resolution_anchor: "2026-08-11T08:30:00+08:00",
    resolver_version: "diet-manager/time-parser-v1",
  }),
  subject: Object.freeze({
    kind: "self",
    resolution_basis: "omitted_subject_default",
    subject_entity_created: false,
    matched_span: null,
    rule_version: "diet-manager/subject-v1",
  }),
  context: Object.freeze({
    scene: "unknown",
    expired_context_ids: Object.freeze([]),
    inventory_read: false,
    accepted_context: null,
    rule_version: "diet-manager/context-v1",
  }),
});

function legacyEnvelope(): DomainEnvelopeInput {
  return {
    envelope_id: "envelope-core-meal-fact-legacy",
    idempotency_key: "idem-core-meal-fact-legacy",
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: "message-core-meal-fact-legacy",
    conversation_id: "conversation-core-meal-fact",
    received_at: "2026-08-13T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: "operation-core-meal-fact-legacy",
      occurred_at: "2026-08-13T12:00:00.000Z",
      meal_slot: "lunch",
      location: "outside",
      items: [{
        normalized_name: "apple",
        item_type: "food",
        amount: {
          unit: "piece",
          observed_microunits: 1_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "explicit",
        },
        nutrition_sources: [],
      }],
    }],
  };
}

function ordinaryClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parserMealEnvelope(suffix: string): DomainEnvelopeInput {
  const parsed = parseCoreCommand({
    source_text: "吃了一个苹果。",
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: `operation-core-meal-evidence-${suffix}`,
    source_message_id: `message-core-meal-evidence-${suffix}`,
    conversation_id: "conversation-core-meal-evidence",
    prior_context: [{
      context_id: "context-core-meal-evidence-v1",
      conversation_id: "conversation-core-meal-evidence",
      revision: 1,
      generated_at: "2026-08-11T08:20:00+08:00",
      valid_until: "2026-08-11T08:40:00+08:00",
      source_message_id: "message-core-meal-evidence-prior",
      rule_version: "diet-manager/context-v1",
      scope: "meal",
      items: [{ normalized_name: "apple", quantity: 1, unit: "piece" }],
      scene: "outside",
    }],
  });
  if (
    parsed.disposition !== "candidate" ||
    parsed.command.action !== "record_meal" ||
    parsed.command.context === undefined ||
    parsed.command.occurred_time.resolved_start === null
  ) {
    throw new Error("test parser meal fixture did not produce full evidence");
  }
  const command = parsed.command;
  const operation = {
    kind: "record_meal",
    operation_id: command.operation_id,
    occurred_at: new Date(command.occurred_time.resolved_start).toISOString(),
    meal_slot: "breakfast",
    location: "outside",
    items: command.items.map((item) => ({
      normalized_name: item.normalized_name,
      item_type: item.kind === "food" ? "food" : "nutrition_drink",
      amount: {
        unit: item.unit ?? "piece",
        observed_microunits: (item.quantity ?? 1) * 1_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [],
    })),
    source_text: command.source_text,
    occurred_time: ordinaryClone(command.occurred_time),
    subject: ordinaryClone(command.subject),
    context: ordinaryClone(command.context),
  } as unknown as RecordMealOperation;
  return {
    envelope_id: `envelope-core-meal-evidence-${suffix}`,
    idempotency_key: `idem-core-meal-evidence-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-core-meal-evidence-${suffix}`,
    conversation_id: "conversation-core-meal-evidence",
    received_at: "2026-08-11T00:30:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [operation],
  };
}

function withService<T>(run: (fixture: {
  readonly database: DatabaseSync;
  readonly service: DietDomainService;
}) => T): T {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-core-meal-${randomUUID()}-`));
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  try {
    return run({
      database: runtime.database,
      service: createDietDomainService({
        database: runtime.database,
        secret,
        now: () => fixedNow,
      }),
    });
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
}

function databaseSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return JSON.stringify(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function replaceStoredMealPayload(
  database: DatabaseSync,
  envelopeId: string,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  const row = database.prepare(
    "SELECT payload_json FROM event_records WHERE envelope_id = ?",
  ).get(envelopeId) as { payload_json: string };
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  mutate(payload);
  database.prepare(
    "UPDATE event_records SET payload_json = ? WHERE envelope_id = ?",
  ).run(canonicalJson(payload), envelopeId);
}

function executionInput(
  envelope: DomainEnvelopeInput,
  preview: ReturnType<DietDomainService["preview"]>,
) {
  return {
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  };
}

function businessWriteCounts(database: DatabaseSync): Record<string, number> {
  const tables = [
    "event_records",
    "meal_items",
    "effect_outbox",
    "effect_bundle_commits",
    "nutrition_snapshots",
    "daily_progress_snapshots",
    "inventory_transactions",
    "issues",
  ] as const;
  return Object.fromEntries(tables.map((table) => [
    table,
    (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count,
  ]));
}

function requiredMealOperation(envelope: DomainEnvelopeInput): RecordMealOperation & Record<string, unknown> {
  const operation = envelope.operations[0];
  if (operation?.kind !== "record_meal") throw new Error("test meal operation missing");
  return operation as RecordMealOperation & Record<string, unknown>;
}

describe("SEL-CORE-001 meal fact evidence authority", () => {
  it.each(Array.from({ length: 16 }, (_, mask) => [mask] as const))(
    "lets the reservation reader authenticate optional evidence permutation %i/15",
    (mask) => {
      const evidence = Object.fromEntries(
        Object.entries(validMealFactEvidence).filter((_, index) => (mask & (1 << index)) !== 0),
      );
      expect(reservationFromEventPayload({
        authority_kind: "diet-manager/meal-fact/v1",
        location: "outside",
        ...evidence,
        timezone: "Asia/Shanghai",
      }, "diet_meal")).toBeUndefined();
    },
  );

  it.each([
    ["source_text", 17],
    ["occurred_time", null],
    ["subject", []],
    ["context", 42],
  ])("rejects malformed stored %s evidence in the shared reservation read", (key, evidence) => {
    expect(() => reservationFromEventPayload({
      authority_kind: "diet-manager/meal-fact/v1",
      location: "outside",
      [key]: evidence,
      timezone: "Asia/Shanghai",
    }, "diet_meal")).toThrowError("PROGRESS_RESERVATION_AUTHORITY_INVALID:meal_fact");
  });

  it("rejects a custom stored evidence prototype in the shared reservation read", () => {
    const context = ordinaryClone(validMealFactEvidence.context);
    Object.setPrototypeOf(context, { inherited: true });
    expect(() => reservationFromEventPayload({
      authority_kind: "diet-manager/meal-fact/v1",
      location: "outside",
      context,
      timezone: "Asia/Shanghai",
    }, "diet_meal")).toThrowError("PROGRESS_RESERVATION_AUTHORITY_INVALID:meal_fact");
  });

  it("rejects a stored evidence accessor without executing its getter", () => {
    const subject = ordinaryClone(validMealFactEvidence.subject) as Record<string, unknown>;
    let getterExecutions = 0;
    Object.defineProperty(subject, "matched_span", {
      configurable: true,
      enumerable: true,
      get() {
        getterExecutions += 1;
        return null;
      },
    });
    expect(() => reservationFromEventPayload({
      authority_kind: "diet-manager/meal-fact/v1",
      location: "outside",
      subject,
      timezone: "Asia/Shanghai",
    }, "diet_meal")).toThrowError("PROGRESS_RESERVATION_AUTHORITY_INVALID:meal_fact");
    expect(getterExecutions).toBe(0);
  });

  it("keeps the reservation reader failed closed for an unknown meal fact key", () => {
    expect(() => reservationFromEventPayload({
      authority_kind: "diet-manager/meal-fact/v1",
      location: "outside",
      timezone: "Asia/Shanghai",
      untrusted_extra: true,
    }, "diet_meal")).toThrowError("PROGRESS_RESERVATION_AUTHORITY_INVALID:meal_fact");
  });

  it.each(["source_text", "occurred_time", "subject", "context"] as const)(
    "accepts and maps %s as an independently optional operation field",
    (keptField) => {
      withService(({ database, service }) => {
        const envelope = parserMealEnvelope(`partial-${keptField}`);
        const operation = requiredMealOperation(envelope);
        for (const field of ["source_text", "occurred_time", "subject", "context"] as const) {
          if (field !== keptField) Reflect.deleteProperty(operation, field);
        }
        const preview = service.preview(envelope);
        const prepared = prepareMealOperation({
          database,
          secret,
          token: preview.token,
          inputDigest: preview.input_digest,
          dataRevision: preview.data_revision,
          subjectScope: envelope.subject_scope,
          commandType: envelope.command_type,
          idempotencyKey: envelope.idempotency_key,
          sourceMessageId: envelope.source_message_id,
          conversationId: envelope.conversation_id,
          receivedAt: envelope.received_at,
          committedAt: fixedNow,
          sequence: 0,
          operation,
        });
        expect(Object.keys(prepared.fact.event.payload).sort()).toEqual([
          "authority_kind",
          keptField,
          "location",
          "timezone",
        ].sort());
      });
    },
  );

  it("keeps the legacy prepared digest, payload bytes, and deterministic IDs unchanged", () => {
    withService(({ database, service }) => {
      const envelope = legacyEnvelope();
      const preview = service.preview(envelope);
      const operation = requiredMealOperation(envelope);
      const prepared = prepareMealOperation({
        database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: fixedNow,
        sequence: 0,
        operation,
      });

      expect(preview.input_digest).toBe(
        "63B11485345AF59431DFFA1B48F3AA7E385D51755654A035D7A67EBD30106D2D",
      );
      expect(prepared.event_id).toBe("event-5871a0bc3d8d4565ca39019dd72324fa");
      expect(prepared.fact.traceId).toBe("trace-d8167984bfa92e87b05aa6d910527b76");
      expect(prepared.fact.event.mealId).toBe("meal-de650b75ef3aed863883c868f2a066c2");
      expect(prepared.fact.items[0]?.itemId).toBe("item-5faaeb6d421740bb4bfc18799083d6f5");
      expect(canonicalJson(prepared.fact.event.payload)).toBe(
        '{"authority_kind":"diet-manager/meal-fact/v1","location":"outside","timezone":"Asia/Shanghai"}',
      );
      expect(Object.keys(prepared.fact.event.payload).sort()).toEqual([
        "authority_kind",
        "location",
        "timezone",
      ]);
    });
  });

  it("stores parser occurrence, self-subject, context, and source evidence in the immutable meal fact", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("stored");
      const operation = requiredMealOperation(envelope);
      const preview = service.preview(envelope);
      const prepared = prepareMealOperation({
        database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        dataRevision: preview.data_revision,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        idempotencyKey: envelope.idempotency_key,
        sourceMessageId: envelope.source_message_id,
        conversationId: envelope.conversation_id,
        receivedAt: envelope.received_at,
        committedAt: fixedNow,
        sequence: 0,
        operation,
      });
      const preparedPayload = prepared.fact.event.payload as Record<string, unknown>;
      expect(preparedPayload.occurred_time).not.toBe(operation.occurred_time);
      expect(Object.isFrozen(preparedPayload.occurred_time)).toBe(true);
      expect(Object.isFrozen(preparedPayload.subject)).toBe(true);
      expect(Object.isFrozen(preparedPayload.context)).toBe(true);
      const result = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      const row = database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;

      expect(result.status).toBe("committed");
      expect(payload.source_text).toBe("吃了一个苹果。");
      expect(payload.occurred_time).toEqual({
        raw_text: null,
        resolved_start: "2026-08-11T08:30:00+08:00",
        resolved_end: "2026-08-11T08:31:00+08:00",
        precision: "exact",
        timezone: "Asia/Shanghai",
        resolution_basis: "default_received_at",
        resolution_anchor: "2026-08-11T08:30:00+08:00",
        resolver_version: "diet-manager/time-parser-v1",
      });
      expect(payload.subject).toEqual({
        kind: "self",
        resolution_basis: "omitted_subject_default",
        subject_entity_created: false,
        matched_span: null,
        rule_version: "diet-manager/subject-v1",
      });
      expect(payload.context).toEqual({
        scene: "outside",
        expired_context_ids: [],
        inventory_read: false,
        accepted_context: {
          context_id: "context-core-meal-evidence-v1",
          conversation_id: "conversation-core-meal-evidence",
          revision: 1,
          generated_at: "2026-08-11T08:20:00+08:00",
          valid_until: "2026-08-11T08:40:00+08:00",
          source_message_id: "message-core-meal-evidence-prior",
          rule_version: "diet-manager/context-v1",
          scope: "meal",
          items: [{ normalized_name: "apple", quantity: 1, unit: "piece" }],
          scene: "outside",
        },
        rule_version: "diet-manager/context-v1",
      });
      expect(canonicalJson(payload)).toBe(row.payload_json);
      expect(Object.keys(payload).sort()).toEqual([
        "authority_kind",
        "context",
        "location",
        "occurred_time",
        "progress_reservation",
        "source_text",
        "subject",
        "timezone",
      ]);
      expect(reservationFromEventPayload(payload, "diet_meal")).toEqual(
        payload.progress_reservation,
      );
    });
  });

  it.each([
    ["source_text", (operation: Record<string, unknown>) => {
      operation.source_text = "吃了两个苹果。";
    }],
    ["occurred_time", (operation: Record<string, unknown>) => {
      (operation.occurred_time as Record<string, unknown>).precision = "approximate";
    }],
    ["subject", (operation: Record<string, unknown>) => {
      operation.subject = {
        kind: "self",
        resolution_basis: "explicit_self",
        subject_entity_created: false,
        matched_span: "我",
        rule_version: "diet-manager/subject-v1",
      };
    }],
    ["context", (operation: Record<string, unknown>) => {
      const context = operation.context as {
        scene: string;
        accepted_context: { scene: string };
      };
      context.scene = "company";
      context.accepted_context.scene = "company";
    }],
    ["accepted_context", (operation: Record<string, unknown>) => {
      const context = operation.context as { accepted_context: Record<string, unknown> };
      context.accepted_context.context_id = "context-core-meal-evidence-v2";
    }],
  ] as const)("binds %s evidence into the preview digest and writes no fact after tampering", (_field, tamper) => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope(`tamper-${_field}`);
      const preview = service.preview(envelope);
      tamper(requiredMealOperation(envelope));

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError("DIET_DOMAIN_REQUEST_INVALID:input_digest");
      expect(businessWriteCounts(database)).toEqual({
        event_records: 0,
        meal_items: 0,
        effect_outbox: 0,
        effect_bundle_commits: 0,
        nutrition_snapshots: 0,
        daily_progress_snapshots: 0,
        inventory_transactions: 0,
        issues: 0,
      });
    });
  });

  it("rejects an extra nested evidence key before any business write", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("extra-key");
      const preview = service.preview(envelope);
      const operation = requiredMealOperation(envelope);
      (operation.occurred_time as Record<string, unknown>).host_timezone = "UTC";

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError(/DIET_DOMAIN_REQUEST_INVALID:/);
      expect(businessWriteCounts(database).event_records).toBe(0);
    });
  });

  it("rejects a custom evidence prototype before any business write", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("prototype");
      const preview = service.preview(envelope);
      const operation = requiredMealOperation(envelope);
      Object.setPrototypeOf(operation.context as object, { inherited_scene: "home" });

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError(/DIET_DOMAIN_REQUEST_INVALID:.*prototype/);
      expect(businessWriteCounts(database).event_records).toBe(0);
    });
  });

  it("rejects an evidence accessor without executing its getter or writing a fact", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("accessor");
      const preview = service.preview(envelope);
      const operation = requiredMealOperation(envelope);
      let getterExecutions = 0;
      Object.defineProperty(operation.subject as object, "matched_span", {
        configurable: true,
        enumerable: true,
        get() {
          getterExecutions += 1;
          return "我";
        },
      });

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError(/DIET_DOMAIN_REQUEST_INVALID:.*descriptor/);
      expect(getterExecutions).toBe(0);
      expect(businessWriteCounts(database).event_records).toBe(0);
    });
  });

  it.each([
    ["source_text", 17],
    ["occurred_time", null],
    ["subject", []],
    ["context", 42],
  ])("rejects finalized stored %s tampering on retry and query without another write", (field, malformed) => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope(`finalized-${field}`);
      const preview = service.preview(envelope);
      expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
      replaceStoredMealPayload(database, envelope.envelope_id, (payload) => {
        payload[field] = malformed;
      });
      const before = databaseSnapshot(database);

      expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
        /^(?:MEAL_EFFECT|PROGRESS_RESERVATION)_AUTHORITY_INVALID:/,
      );
      expect(databaseSnapshot(database)).toBe(before);
      expect(() => service.query({
        kind: "query_meals",
        operation_id: `query-finalized-${field}`,
        date: "2026-08-11",
        timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:meal_event_authority");
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it("rejects evidence injected into a finalized legacy fact before retry or query success", () => {
    withService(({ database, service }) => {
      const envelope = legacyEnvelope();
      const preview = service.preview(envelope);
      expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
      replaceStoredMealPayload(database, envelope.envelope_id, (payload) => {
        payload.source_text = 17;
      });
      const before = databaseSnapshot(database);

      expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
        /^(?:MEAL_EFFECT|PROGRESS_RESERVATION)_AUTHORITY_INVALID:/,
      );
      expect(() => service.query({
        kind: "query_meals",
        operation_id: "query-finalized-legacy-injection",
        date: "2026-08-13",
        timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:meal_event_authority");
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it.each(["source_text", "occurred_time", "subject", "context"] as const)(
    "rejects deletion of finalized stored %s evidence on same-token retry without another write",
    (field) => {
      withService(({ database, service }) => {
        const envelope = parserMealEnvelope(`finalized-delete-${field}`);
        const preview = service.preview(envelope);
        expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
        replaceStoredMealPayload(database, envelope.envelope_id, (payload) => {
          Reflect.deleteProperty(payload, field);
        });
        const before = databaseSnapshot(database);

        expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
          "MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload",
        );
        expect(databaseSnapshot(database)).toBe(before);
      });
    },
  );

  it.each([
    ["source_text", (payload: Record<string, unknown>) => {
      payload.source_text = "changed but valid source text";
    }],
    ["occurred_time", (payload: Record<string, unknown>) => {
      (payload.occurred_time as Record<string, unknown>).raw_text = "just now";
    }],
    ["subject", (payload: Record<string, unknown>) => {
      payload.subject = {
        kind: "self",
        resolution_basis: "explicit_self",
        subject_entity_created: false,
        matched_span: "me",
        rule_version: "diet-manager/subject-v1",
      };
    }],
    ["context", (payload: Record<string, unknown>) => {
      (payload.context as Record<string, unknown>).inventory_read = true;
    }],
  ] as const)(
    "rejects schema-valid finalized stored %s mutation against the prepared fact",
    (field, mutate) => {
      withService(({ database, service }) => {
        const envelope = parserMealEnvelope(`finalized-valid-mutation-${field}`);
        const preview = service.preview(envelope);
        expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
        replaceStoredMealPayload(database, envelope.envelope_id, mutate);
        const before = databaseSnapshot(database);

        expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
          "MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload",
        );
        expect(databaseSnapshot(database)).toBe(before);
      });
    },
  );

  it("rejects a schema-valid evidence insertion into a finalized legacy fact", () => {
    withService(({ database, service }) => {
      const envelope = legacyEnvelope();
      const preview = service.preview(envelope);
      expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
      replaceStoredMealPayload(database, envelope.envelope_id, (payload) => {
        payload.source_text = "injected but structurally valid";
      });
      const before = databaseSnapshot(database);

      expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
        "MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload",
      );
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it("rejects an unknown stored meal-fact key on finalized retry and query", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("finalized-unknown-key");
      const preview = service.preview(envelope);
      expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
      replaceStoredMealPayload(database, envelope.envelope_id, (payload) => {
        payload.untrusted_extra = true;
      });
      const before = databaseSnapshot(database);

      expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
        /^(?:MEAL_EFFECT|PROGRESS_RESERVATION)_AUTHORITY_INVALID:/,
      );
      expect(() => service.query({
        kind: "query_meals",
        operation_id: "query-finalized-unknown-key",
        date: "2026-08-11",
        timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:meal_event_authority");
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it("rejects noncanonical finalized meal fact bytes on retry and query", () => {
    withService(({ database, service }) => {
      const envelope = parserMealEnvelope("finalized-noncanonical");
      const preview = service.preview(envelope);
      expect(service.execute(executionInput(envelope, preview)).status).toBe("committed");
      const row = database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      database.prepare(
        "UPDATE event_records SET payload_json = ? WHERE envelope_id = ?",
      ).run(` ${row.payload_json}`, envelope.envelope_id);
      const before = databaseSnapshot(database);

      expect(() => service.execute(executionInput(envelope, preview))).toThrowError(
        /^(?:MEAL_EFFECT|PROGRESS_RESERVATION)_AUTHORITY_INVALID:/,
      );
      expect(() => service.query({
        kind: "query_meals",
        operation_id: "query-finalized-noncanonical",
        date: "2026-08-11",
        timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:meal_event_canonical");
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it.each([
    ["legacy", () => legacyEnvelope()],
    ["all-evidence", () => parserMealEnvelope("valid-finalized-replay")],
  ] as const)("replays a valid finalized %s meal without changing storage", (_label, envelopeFactory) => {
    withService(({ database, service }) => {
      const envelope = envelopeFactory();
      const preview = service.preview(envelope);
      const first = service.execute(executionInput(envelope, preview));
      const before = databaseSnapshot(database);

      expect(service.execute(executionInput(envelope, preview))).toEqual(first);
      expect(databaseSnapshot(database)).toBe(before);
    });
  });

  it.each(["source_text", "occurred_time", "subject", "context"] as const)(
    "rejects deletion of stored %s evidence during retryable EffectBundle recovery",
    (field) => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-core-recovery-${randomUUID()}-`));
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const envelope = parserMealEnvelope(`recovery-delete-${field}`);
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => fixedNow,
          fault: "after_meal_nutrition",
        });
        const preview = faulting.preview(envelope);
        expect(() => faulting.execute(executionInput(envelope, preview))).toThrowError(
          "NUTRITION_EFFECT_WRITE_FAILED:after_nutrition",
        );
        replaceStoredMealPayload(runtime.database, envelope.envelope_id, (payload) => {
          Reflect.deleteProperty(payload, field);
        });
        const before = databaseSnapshot(runtime.database);
        const recovering = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-11T00:30:02.000Z",
        });

        expect(() => recovering.execute(executionInput(envelope, preview))).toThrowError(
          "MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload",
        );
        expect(databaseSnapshot(runtime.database)).toBe(before);
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
    },
  );

  it.each(["source_text", "occurred_time", "subject", "context"] as const)(
    "rejects deletion of stored %s evidence while resuming effects_stable finalization",
    (field) => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-core-stable-${randomUUID()}-`));
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const envelope = parserMealEnvelope(`stable-delete-${field}`);
        const faulting = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => fixedNow,
          fault: "before_commit",
        });
        const preview = faulting.preview(envelope);
        expect(() => faulting.execute(executionInput(envelope, preview))).toThrowError(
          "ENVELOPE_FINALIZE_FAILED:before_commit",
        );
        expect(runtime.database.prepare(
          "SELECT state FROM command_envelopes WHERE envelope_id = ?",
        ).get(envelope.envelope_id)).toEqual({ state: "effects_stable" });
        replaceStoredMealPayload(runtime.database, envelope.envelope_id, (payload) => {
          Reflect.deleteProperty(payload, field);
        });
        const before = databaseSnapshot(runtime.database);
        const recovering = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-11T00:30:02.000Z",
        });

        expect(() => recovering.execute(executionInput(envelope, preview))).toThrowError(
          "MEAL_EFFECT_AUTHORITY_INVALID:terminal_event_payload",
        );
        expect(databaseSnapshot(runtime.database)).toBe(before);
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
    },
  );
});
