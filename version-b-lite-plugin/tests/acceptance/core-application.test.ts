import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../../shared/acceptance-cases/fixtures/core-v1.json";
import { canonicalJson, canonicalSha256 } from "../../src/authority/canonical-json.js";
import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { listMealProjection } from "../../src/repository/query.js";
import { openDietDatabase } from "../../src/storage/database.js";

const nodeSecret = Buffer.from("SEL-CORE-001 Task 8 nullable amount", "utf8");

function ordinaryClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogInput(id: string) {
  const catalogCase = casesCatalog.cases.find((entry) => entry.id === id);
  if (catalogCase === undefined) throw new Error(`missing catalog case ${id}`);
  const environment = fixturesCatalog.environments.find(
    (entry) => entry.fixture_id === catalogCase.setup.environment_fixture,
  );
  if (environment === undefined) throw new Error(`missing environment for ${id}`);
  return {
    source_text: catalogCase.source_text,
    received_at: environment.clock,
    timezone: environment.timezone,
    operation_id: `operation-${id.toLowerCase()}`,
    source_message_id: `message-${id.toLowerCase()}`,
    conversation_id: "conversation-core-v1",
    prior_context: catalogCase.setup.prior_context,
  };
}

function catalogMealEnvelope(id: string): DomainEnvelopeInput {
  const input = catalogInput(id);
  const parsed = parseCoreCommand(input);
  if (
    parsed.disposition !== "candidate" ||
    parsed.command.action !== "record_meal" ||
    parsed.command.occurred_time.resolved_start === null
  ) throw new Error(`${id} did not parse as an executable meal`);
  const command = parsed.command;
  return {
    envelope_id: `envelope-${id.toLowerCase()}`,
    idempotency_key: `idempotency-${id.toLowerCase()}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: input.source_message_id,
    conversation_id: input.conversation_id,
    received_at: new Date(input.received_at).toISOString(),
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: command.operation_id,
      occurred_at: new Date(command.occurred_time.resolved_start).toISOString(),
      meal_slot: "unknown",
      location: "home",
      items: command.items.map((item) => ({
        normalized_name: item.normalized_name,
        item_type: item.kind === "food" ? "food" : "nutrition_drink",
        amount: {
          unit: item.unit ?? "unknown",
          observed_microunits: item.quantity === null
            ? null
            : item.quantity * 1_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: item.quantity === null
            ? "unknown"
            : item.estimated === false
              ? "explicit"
              : "estimated_upper_bound",
        },
        nutrition_sources: [],
      })),
      source_text: command.source_text,
      occurred_time: ordinaryClone(command.occurred_time),
      subject: ordinaryClone(command.subject),
      ...(command.context === undefined
        ? {}
        : { context: ordinaryClone(command.context) }),
    }],
  } as unknown as DomainEnvelopeInput;
}

function businessSnapshot(database: ReturnType<typeof openDietDatabase>["database"]): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function allNullNutrition() {
  return {
    energy_kcal_milli: null,
    protein_mg: null,
    fat_mg: null,
    carbohydrate_mg: null,
    fiber_mg: null,
    water_ml_milli: null,
  };
}

describe("SEL-CORE Task 8 nullable meal authority", () => {
  it("commits the actual CASE-MEAL-019 parser fact without inventing an amount", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-019");
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });

      const preview = service.preview(envelope);
      const result = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });

      expect(result.status).toBe("committed_with_issues");
      expect(runtime.database.prepare(
        "SELECT payload_json FROM meal_items ORDER BY item_order",
      ).all()).toEqual([{
        payload_json: expect.stringContaining('"observed_microunits":null'),
      }]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    ["CASE-MEAL-019", 1],
    ["CASE-MEAL-020", 1],
    ["CASE-WATER-004", 4],
  ] as const)(
    "preserves every actual %s unknown amount through fact, effects, receipt, replay and query",
    (id, itemCount) => {
      const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const envelope = catalogMealEnvelope(id);
        const operation = envelope.operations[0];
        if (operation?.kind !== "record_meal") throw new Error("expected meal operation");
        const service = createDietDomainService({
          database: runtime.database,
          secret: nodeSecret,
          now: () => "2026-08-11T00:30:01.000Z",
        });
        const preview = service.preview(envelope);
        const input = {
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        };
        const first = service.execute(input);

        expect(first.status).toBe("committed_with_issues");
        expect(first.items).toEqual([expect.objectContaining({
          status: "committed_with_issues",
          meal_items: operation.items.map((item, item_order) => expect.objectContaining({
            item_order,
            normalized_name: item.normalized_name,
            unit: "unknown",
            observed_microunits: null,
            amount_evidence: "unknown",
            nutrition_adoption_microunits: null,
            inventory_deduction_microunits: null,
            inventory_match: "skipped_amount_unknown",
            issue_codes: ["inventory_amount_unknown"],
            nutrients: allNullNutrition(),
          })),
          daily_progress: expect.objectContaining({
            coverage_status: "partial",
            nutrients: allNullNutrition(),
          }),
        })]);
        const itemRows = runtime.database.prepare(
          "SELECT item_order, payload_json FROM meal_items ORDER BY item_order",
        ).all() as Array<{ item_order: number; payload_json: string }>;
        expect(itemRows).toHaveLength(itemCount);
        expect(itemRows.map(({ payload_json }) => JSON.parse(payload_json))).toEqual(
          operation.items.map((item) => ({
            amount: {
              evidence: "unknown",
              inventory_deduction_microunits: null,
              nutrition_adoption_microunits: null,
              observed_microunits: null,
              template_reference_microunits: null,
              unit: "unknown",
            },
            authority_kind: "diet-manager/meal-item/v1",
            nutrition_sources: [],
          })),
        );
        const eventPayload = JSON.parse((runtime.database.prepare(
          "SELECT payload_json FROM event_records",
        ).get() as { payload_json: string }).payload_json);
        expect(eventPayload).toMatchObject({
          authority_kind: "diet-manager/meal-fact/v1",
          source_text: operation.source_text,
          occurred_time: operation.occurred_time,
          subject: operation.subject,
          location: "home",
          timezone: "Asia/Shanghai",
        });
        if (operation.context !== undefined) {
          expect(eventPayload.context).toEqual(operation.context);
        }
        expect(runtime.database.prepare(
          "SELECT issue_code FROM issues ORDER BY issue_id",
        ).all()).toEqual(Array.from({ length: itemCount }, () => ({
          issue_code: "inventory_amount_unknown",
        })));
        expect(runtime.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions",
        ).get()).toEqual({ count: 0 });
        expect(JSON.parse((runtime.database.prepare(
          "SELECT payload_json FROM daily_progress_snapshots",
        ).get() as { payload_json: string }).payload_json)).toMatchObject({
          coverage_status: "partial",
          nutrients: allNullNutrition(),
        });
        const receipt = (first.payload as { receipt_data: { blocks: unknown[] } }).receipt_data;
        expect(receipt.blocks.filter((block): block is {
          kind: string;
          amount: unknown;
        } => typeof block === "object" && block !== null &&
          (block as { kind?: unknown }).kind === "item").map((block) => block.amount))
          .toEqual(Array.from({ length: itemCount }, () => ({
            evidence: "unknown",
            observed_microunits: null,
            unit: "unknown",
          })));

        const beforeReplay = businessSnapshot(runtime.database);
        const replay = service.execute(input);
        expect(replay).toEqual(first);
        expect(businessSnapshot(runtime.database)).toBe(beforeReplay);

        const date = operation.occurred_at.slice(0, 10);
        const query = listMealProjection({
          database: runtime.database,
          authoritySecret: nodeSecret,
          date,
          timezone: "Asia/Shanghai",
        });
        expect(query).toEqual([expect.objectContaining({
          occurred_at: operation.occurred_at,
          items: operation.items.map((item, item_order) => ({
            item_order,
            item_type: item.item_type,
            normalized_name: item.normalized_name,
            amount: item.amount,
          })),
        })]);
        expect(businessSnapshot(runtime.database)).toBe(beforeReplay);
      } finally {
        runtime.close();
        rmSync(root, { recursive: true, force: false });
      }
    },
  );

  it("keeps the known CASE-MEAL-021 preview, fact and result canonical bytes frozen", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-11T00:30:00.000Z",
    });
    try {
      const envelope = catalogMealEnvelope("CASE-MEAL-021");
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      const preview = service.preview(envelope);
      const result = service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      const factBytes = (runtime.database.prepare(
        `SELECT e.payload_json AS event_payload_json, i.payload_json AS item_payload_json
         FROM event_records e JOIN meal_items i ON i.event_id = e.event_id`,
      ).get() as { event_payload_json: string; item_payload_json: string });

      expect({
        preview: canonicalSha256(preview),
        fact: canonicalSha256(factBytes),
        result: canonicalSha256(result),
      }).toEqual({
        preview: "B5B05B42125FBA459BD65DD0B830FC0C2E85CAFDE6DFB7640EDC0C0384FAC6D6",
        fact: "97B92A38E73341B82E51726BF82E3AC40670DEB02C0EB4A56ABD87652B3396A3",
        result: "26DDFD7260A4D89FCEC971F3B1124E9DB656910B70DE37EE5F9DF28BCE574330",
      });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it.each([
    [{
      observed_microunits: null,
      nutrition_adoption_microunits: 1,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "unknown",
    }, "nutrition_adoption_microunits"],
    [{
      observed_microunits: null,
      nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "explicit",
    }, "evidence"],
    [{
      observed_microunits: 1,
      nutrition_adoption_microunits: null,
      inventory_deduction_microunits: null,
      template_reference_microunits: null,
      evidence: "unknown",
    }, "evidence"],
  ] as const)("rejects injected invalid nullable amount %s before business writes", (amount, field) => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = ordinaryClone(catalogMealEnvelope("CASE-MEAL-019"));
      const operation = envelope.operations[0];
      if (operation?.kind !== "record_meal") throw new Error("expected meal operation");
      Object.assign(operation.items[0]!.amount, amount);
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(() => service.preview(envelope)).toThrow(
        `DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.items.0.amount.${field}`,
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM command_envelopes",
      ).get()).toEqual({ count: 0 });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });

  it("keeps correction replacement amounts known-only before business writes", () => {
    const root = mkdtempSync(join(tmpdir(), `diet-manager-task8-${randomUUID()}-`));
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = ordinaryClone(catalogMealEnvelope("CASE-MEAL-019"));
      envelope.command_type = "correct_record";
      envelope.operations = [{
        kind: "correct_record",
        operation_id: "operation-null-correction",
        target_event_id: "event-null-correction-target",
        base_revision: 0,
        item_order: 0,
        replacement_amount: {
          unit: "unknown",
          observed_microunits: null,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "unknown",
        },
      } as never];
      const service = createDietDomainService({
        database: runtime.database,
        secret: nodeSecret,
        now: () => "2026-08-11T00:30:01.000Z",
      });
      expect(() => service.preview(envelope)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.replacement_amount.observed_microunits",
      );
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM command_envelopes",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: false });
    }
  });
});
