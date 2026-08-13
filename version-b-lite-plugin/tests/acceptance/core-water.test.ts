import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput, MealItemInput } from "../../src/domain/types.js";
import { listWaterEvents } from "../../src/repository/query.js";
import { parseWaterFactPreviewMaterial } from "../../src/authority/water-fact-identity.js";
import { canonicalJson } from "../../src/authority/canonical-json.js";
import { openDietDatabase } from "../../src/storage/database.js";

const secret = Buffer.from("SEL-CORE-001 water acceptance secret", "utf8");
const roots = new Set<string>();

function newRoot(): string {
  const root = join(tmpdir(), `diet-manager-water-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  roots.add(root);
  return root;
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: false });
    expect(existsSync(root)).toBe(false);
    roots.delete(root);
  }
});

function waterEnvelope(suffix: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-water-${suffix}`,
    idempotency_key: `idem-water-${suffix}`,
    command_type: "record_water",
    subject_scope: "user:self",
    source_message_id: `message-water-${suffix}`,
    conversation_id: "conversation-water-001",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_water",
      operation_id: `operation-water-${suffix}`,
      occurred_time: "2026-08-12T12:00:00.000Z",
      source_text: "喝了500ml白水。",
      plain_water_ml_milli: 500_000,
      amount_evidence: { raw_text: "500ml", quantity: 500, unit: "ml", estimated: false },
    }],
  } as unknown as DomainEnvelopeInput;
}

function liquidMealEnvelope(suffix: string, name: string): DomainEnvelopeInput {
  const item: MealItemInput = {
    normalized_name: name,
    item_type: "nutrition_drink",
    amount: {
      unit: "ml", observed_microunits: 250_000, nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null, template_reference_microunits: null, evidence: "explicit",
    },
    nutrition_sources: [],
  };
  return {
    envelope_id: `envelope-liquid-${suffix}`, idempotency_key: `idem-liquid-${suffix}`,
    command_type: "record_meal", subject_scope: "user:self", source_message_id: `message-liquid-${suffix}`,
    conversation_id: "conversation-water-001", received_at: "2026-08-12T04:00:00.000Z", timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal", operation_id: `operation-liquid-${suffix}`,
      occurred_at: "2026-08-12T12:00:00.000Z", meal_slot: "lunch", location: "outside", items: [item],
    }],
  };
}

function resignWaterAuthority(payload: Record<string, unknown>): void {
  const material = {
    input_digest: payload.input_digest,
    meal_fact_identities: payload.meal_fact_identities,
    water_fact_identities: payload.water_fact_identities,
  };
  payload.fact_identity_mac = createHmac("sha256", secret)
    .update("diet-manager/fact-preview-authority/v3\n", "ascii")
    .update(canonicalJson({ authority_kind: "diet-manager/server-preview/v3", binding: payload.binding, ...material }), "utf8")
    .digest("hex").toUpperCase();
}

function businessSnapshot(database: ReturnType<typeof openDietDatabase>["database"]): Record<string, unknown> {
  const tables = database.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
     ORDER BY name`,
  ).all() as Array<{ name: string }>;
  return Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]));
}

describe("CASE-WATER-001", () => {
  it("requires exactly one water identity in a v3 manifest", () => {
    const identity = {
      sequence: 0, event_id: "event", operation_id: "operation", schema_version: "domain/v2",
      event_type: "diet_water", fact_kind: "water", source_message_id: "message", conversation_id: "conversation",
      received_at: "2026-08-12T04:00:00.000Z", occurred_at_text: "2026-08-12T12:00:00.000Z",
      meal_id: null, meal_slot: null, payload_digest: "A".repeat(64), items: [],
    };
    for (const water_fact_identities of [[], [identity, identity]]) {
      expect(() => parseWaterFactPreviewMaterial({
        authority_kind: "diet-manager/domain-preview/v3", input_digest: "B".repeat(64),
        meal_fact_identities: [], water_fact_identities,
      })).toThrow("WATER_FACT_IDENTITY_INVALID");
    }
  });
  it("stores record_water preview authority as a redacted v3 water identity manifest", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope("v3-preview");
      service.preview(envelope);
      const payload = JSON.parse((runtime.database.prepare(
        "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string }).payload_json) as Record<string, unknown>;
      expect(payload).toMatchObject({
        authority_kind: "diet-manager/server-preview/v3",
        input_digest: expect.stringMatching(/^[A-F0-9]{64}$/),
        meal_fact_identities: [],
        water_fact_identities: [expect.objectContaining({
          sequence: 0, event_type: "diet_water", fact_kind: "water", meal_id: null, meal_slot: null,
        })],
        fact_identity_mac: expect.stringMatching(/^[A-F0-9]{64}$/),
      });
      expect(JSON.stringify(payload)).not.toContain("500ml");
      expect(JSON.stringify(payload)).not.toContain("喝了");
    } finally { runtime.database.close(); }
  });

  it.each([
    ["fact_identity_mac", "00".repeat(32)],
    ["water_fact_identities", []],
  ])("fails closed when v3 preview %s is tampered", (field, value) => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope(`tamper-${field}`);
      const preview = service.preview(envelope);
      const payload = JSON.parse((runtime.database.prepare("SELECT payload_json FROM command_envelopes WHERE envelope_id = ?").get(envelope.envelope_id) as { payload_json: string }).payload_json) as Record<string, unknown>;
      payload[field] = value;
      runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?").run(JSON.stringify(payload), envelope.envelope_id);
      const before = runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get();
      expect(() => service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision })).toThrow("PREVIEW_AUTHORITY_INVALID");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual(before);
    } finally { runtime.database.close(); }
  });

  it.each([
    ["missing", (payload: Record<string, unknown>) => { delete payload.fact_identity_mac; }],
    ["extra", (payload: Record<string, unknown>) => { payload.unknown = true; }],
    ["wrong-case-mac", (payload: Record<string, unknown>) => { payload.fact_identity_mac = String(payload.fact_identity_mac).toLowerCase(); }],
    ["identity-sequence", (payload: Record<string, unknown>) => { ((payload.water_fact_identities as Record<string, unknown>[])[0]!).sequence = 1; }],
    ["identity-operation", (payload: Record<string, unknown>) => { ((payload.water_fact_identities as Record<string, unknown>[])[0]!).operation_id = "different"; }],
  ] as const)("rejects stored v3 %s before any WaterEvent write", (_name, mutate) => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope(`v3-${_name}`);
      const preview = service.preview(envelope);
      const row = runtime.database.prepare("SELECT payload_json FROM command_envelopes WHERE envelope_id = ?").get(envelope.envelope_id) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      mutate(payload);
      runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?").run(JSON.stringify(payload), envelope.envelope_id);
      const counts = runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get();
      expect(() => service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision })).toThrow("PREVIEW_AUTHORITY_INVALID");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual(counts);
    } finally { runtime.database.close(); }
  });

  it.each(["diet-manager/server-preview/v1", "diet-manager/server-preview/v2"])(
    "rejects downgraded %s water authority with zero business facts",
    (authorityKind) => {
      const root = newRoot(); const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
        const envelope = waterEnvelope(`downgrade-${authorityKind.slice(-2)}`); const preview = service.preview(envelope);
        const payload = authorityKind.endsWith("v1") ? { authority_kind: authorityKind, binding: {} } : { authority_kind: authorityKind };
        runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?").run(JSON.stringify(payload), envelope.envelope_id);
        expect(() => service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision })).toThrow("PREVIEW_AUTHORITY_INVALID");
        expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 0 });
      } finally { runtime.database.close(); }
    },
  );

  it.each([
    ["re-signed payload digest", (first: Record<string, unknown>, _second: Record<string, unknown>) => {
      ((first.water_fact_identities as Array<Record<string, unknown>>)[0]!).payload_digest = "A".repeat(64);
    }],
    ["re-signed cross-envelope splice", (first: Record<string, unknown>, second: Record<string, unknown>) => {
      first.water_fact_identities = second.water_fact_identities;
    }],
  ] as const)("rejects valid-MAC %s without business writes", (_name, mutate) => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const suffix = _name.replaceAll(" ", "-");
      const firstEnvelope = waterEnvelope(`signed-${suffix}`);
      const secondEnvelope = waterEnvelope(`signed-other-${suffix}`);
      const firstPreview = service.preview(firstEnvelope);
      service.preview(secondEnvelope);
      const read = (envelopeId: string) => JSON.parse((runtime.database.prepare(
        "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelopeId) as { payload_json: string }).payload_json) as Record<string, unknown>;
      const firstPayload = read(firstEnvelope.envelope_id);
      mutate(firstPayload, read(secondEnvelope.envelope_id));
      resignWaterAuthority(firstPayload);
      runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?")
        .run(canonicalJson(firstPayload), firstEnvelope.envelope_id);
      const before = runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get();
      expect(() => service.execute({ envelope: firstEnvelope, token: firstPreview.token, input_digest: firstPreview.input_digest, data_revision: firstPreview.data_revision }))
        .toThrow("PREVIEW_AUTHORITY_INVALID");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual(before);
    } finally { runtime.database.close(); }
  });

  it("makes a valid-secret re-signed terminal identity mutation fail in both query and replay", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope("signed-terminal-query");
      const preview = service.preview(envelope);
      const input = { envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision };
      expect(service.execute(input).status).toBe("committed");
      const row = runtime.database.prepare("SELECT payload_json FROM command_envelopes WHERE envelope_id = ?")
        .get(envelope.envelope_id) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      ((payload.water_fact_identities as Array<Record<string, unknown>>)[0]!).payload_digest = "A".repeat(64);
      resignWaterAuthority(payload);
      runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?")
        .run(canonicalJson(payload), envelope.envelope_id);
      const before = businessSnapshot(runtime.database);
      expect(() => listWaterEvents({ database: runtime.database, authoritySecret: secret, date: "2026-08-12", timezone: "Asia/Shanghai" }))
        .toThrow("PREVIEW_AUTHORITY_INVALID");
      expect(() => service.execute(input)).toThrow("PREVIEW_AUTHORITY_INVALID");
      expect(businessSnapshot(runtime.database)).toEqual(before);
    } finally { runtime.database.close(); }
  });

  it("rejects a validly re-signed water query authority bound to another preview id without writes", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope("query-preview-id-binding");
      const preview = service.preview(envelope);
      service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision });
      const row = runtime.database.prepare("SELECT payload_json FROM command_envelopes WHERE envelope_id = ?")
        .get(envelope.envelope_id) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      (payload.binding as Record<string, unknown>).preview_id = "envelope-water-valid-different-preview";
      resignWaterAuthority(payload);
      runtime.database.prepare("UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?")
        .run(canonicalJson(payload), envelope.envelope_id);
      const before = businessSnapshot(runtime.database);
      expect(() => listWaterEvents({
        database: runtime.database,
        authoritySecret: secret,
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toThrow("INVENTORY_PROJECTION_INVALID:water_event_identity");
      expect(businessSnapshot(runtime.database)).toEqual(before);
    } finally {
      runtime.database.close();
    }
  });

  it("persists one explicit frozen WaterEvent and contributes hydration exactly once", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      const envelope = waterEnvelope("explicit-001");
      const preview = service.preview(envelope);
      const first = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });

      expect(first.status).toBe("committed");
      expect(Object.isFrozen(first)).toBe(true);
      expect(runtime.database.prepare(
        "SELECT event_type, fact_kind, meal_id, meal_slot, payload_json FROM event_records",
      ).all()).toEqual([expect.objectContaining({
        event_type: "diet_water", fact_kind: "water", meal_id: null, meal_slot: null,
      })]);
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM meal_items").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 1 });
      expect(JSON.parse((runtime.database.prepare(
        "SELECT payload_json FROM event_records",
      ).get() as { payload_json: string }).payload_json)).toMatchObject({
        authority_kind: "diet-manager/water-fact/v1",
        plain_water_ml_milli: 500_000,
        estimated: false,
      });
      expect(JSON.parse((runtime.database.prepare(
        "SELECT payload_json FROM daily_progress_snapshots",
      ).get() as { payload_json: string }).payload_json).nutrients).toEqual({
        energy_kcal_milli: null,
        protein_mg: null,
        fat_mg: null,
        carbohydrate_mg: null,
        fiber_mg: null,
        water_ml_milli: 500_000,
      });
      const waters = listWaterEvents({
        database: runtime.database,
        authoritySecret: secret,
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      });
      expect(waters).toEqual([expect.objectContaining({
        plain_water_ml_milli: 500_000,
        estimated: false,
      })]);
      expect(Object.isFrozen(waters[0]!)).toBe(true);

      const replay = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(replay).toEqual(first);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 1 });
    } finally {
      runtime.database.close();
    }
  });

  it("rejects an undeclared same-envelope meal event outside the requested date without writes", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      const envelope = waterEnvelope("query-complete-event-set");
      const preview = service.preview(envelope);
      service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      runtime.database.prepare(
        `INSERT INTO event_records(
          event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
          source_message_id, conversation_id, received_at, committed_at, occurred_at_text,
          result_status, lifecycle_status, meal_id, meal_slot, payload_json
        )
        SELECT ?, envelope_id, ?, schema_version, 'diet_meal', 'meal', source_message_id,
          conversation_id, received_at, committed_at, ?, result_status, lifecycle_status, ?, 'lunch', ?
        FROM event_records WHERE envelope_id = ? AND event_type = 'diet_water'`,
      ).run(
        "event-water-query-extra-meal",
        "operation-water-query-extra-meal",
        "2026-08-13T12:00:00.000Z",
        "meal-water-query-extra-meal",
        canonicalJson({ authority_kind: "diet-manager/meal-fact/v1", location: "outside", timezone: "Asia/Shanghai" }),
        envelope.envelope_id,
      );
      const before = businessSnapshot(runtime.database);
      expect(() => listWaterEvents({
        database: runtime.database,
        authoritySecret: secret,
        date: "2026-08-12",
        timezone: "Asia/Shanghai",
      })).toThrow("INVENTORY_PROJECTION_INVALID:water_event_identity");
      expect(businessSnapshot(runtime.database)).toEqual(before);
    } finally {
      runtime.database.close();
    }
  });

  it("rejects a water contribution overflow before FactCommit without creating fact rows", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const nutrients = {
        carbohydrate_mg: null, energy_kcal_milli: null, fat_mg: null, fiber_mg: null,
        protein_mg: null, water_ml_milli: Number.MAX_SAFE_INTEGER - 100_000,
      };
      runtime.database.prepare(
        `INSERT INTO daily_progress_snapshots(
          progress_snapshot_id, idempotency_result_id, date, timezone, goal_version_id,
          coverage_status, generated_at, payload_json
        ) VALUES (?, NULL, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        "progress-water-near-maximum", "2026-08-12", "Asia/Shanghai", "partial",
        "2026-08-12T03:59:59.000Z",
        canonicalJson({ authority_kind: "diet-manager/daily-progress/v1", coverage_status: "partial",
          date: "2026-08-12", nutrients, timezone: "Asia/Shanghai" }),
      );
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      const envelope = waterEnvelope("pre-fact-overflow");
      const preview = service.preview(envelope);
      expect(() => service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision }))
        .toThrow("PROGRESS_RESERVATION_AUTHORITY_INVALID:daily_progress_sum");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM effect_outbox").get()).toEqual({ count: 0 });
    } finally { runtime.database.close(); }
  });

  it("rejects a canonical pending checkpoint revision tamper without further business writes", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = waterEnvelope("pending-revision-tamper");
      const failedService = createDietDomainService({
        database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z",
        fault: "after_water_progress_contribution_prepared" as never,
      });
      const preview = failedService.preview(envelope);
      const input = { envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision };
      expect(() => failedService.execute(input)).toThrow("WATER_EFFECT_FAILED:after_progress_contribution_prepared");
      const row = runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const checkpoint = JSON.parse(row.payload_json) as Record<string, unknown>;
      checkpoint.data_revision = "F".repeat(64);
      runtime.database.prepare("UPDATE effect_bundle_commits SET payload_json = ? WHERE envelope_id = ?")
        .run(canonicalJson(checkpoint), envelope.envelope_id);
      const before = businessSnapshot(runtime.database);
      const retry = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:02.000Z" });
      expect(() => retry.execute(input)).toThrow("WATER_EFFECT_AUTHORITY_INVALID");
      expect(businessSnapshot(runtime.database)).toEqual(before);
    } finally { runtime.database.close(); }
  });

  it("rejects accessor-shaped explicit-water input without invoking the getter", () => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      let getterCount = 0;
      const envelope = waterEnvelope("accessor");
      const operation = envelope.operations[0] as unknown as Record<string, unknown>;
      Object.defineProperty(operation, "plain_water_ml_milli", {
        enumerable: true,
        get() { getterCount += 1; return 500_000; },
      });
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      expect(() => service.preview(envelope)).toThrow("DIET_DOMAIN_REQUEST_INVALID:envelope_operations_0_descriptor");
      expect(getterCount).toBe(0);
    } finally { runtime.database.close(); }
  });

  it.each([
    [{}, "missing"],
    [{ raw_text: "500ml", quantity: 500, unit: "ml", estimated: false, extra: true }, "extra"],
    [{ raw_text: "500ml", quantity: 500, unit: "cup", estimated: false }, "unit"],
    [{ raw_text: "500ml", quantity: 500, unit: "ml", estimated: true }, "estimated"],
  ])("rejects malformed amount evidence (%s)", (amountEvidence) => {
    const root = newRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = waterEnvelope("invalid-evidence");
      (envelope.operations[0] as unknown as { amount_evidence: unknown }).amount_evidence = amountEvidence;
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
      expect(() => service.preview(envelope)).toThrow("DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.amount_evidence");
    } finally { runtime.database.close(); }
  });

  it.each(["milk", "soup", "soy milk", "coffee", "tea"])(
    "keeps CASE-WATER-003/004 liquid %s as one meal and never a WaterEvent",
    (name) => {
      const root = newRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-12T04:00:01.000Z" });
        const envelope = liquidMealEnvelope(name.replaceAll(" ", "-"), name);
        const preview = service.preview(envelope);
        expect(service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision }).status).toBe("committed");
        expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'").get()).toEqual({ count: 1 });
        expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_water'").get()).toEqual({ count: 0 });
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM effect_outbox WHERE effect_kind = 'daily_progress_contribution'",
        ).get()).toEqual({ count: 1 });
        expect(listWaterEvents({ database: runtime.database, authoritySecret: secret, date: "2026-08-12", timezone: "Asia/Shanghai" })).toEqual([]);
      } finally { runtime.database.close(); }
    },
  );
});
