import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../../shared/acceptance-cases/fixtures/core-v1.json";
import { canonicalJson } from "../../src/authority/canonical-json.js";
import {
  CORE_RUNTIME_SECRET_FILENAME,
  createCoreRuntime,
  handleCoreRequest,
  type CoreRuntime,
} from "../../src/application/core-runtime.js";
import { assertDietManagerOutcome, type CoreApplicationRequest } from "../../src/contracts.js";
import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { assertAuthenticatedPurchaseEventAuthority } from "../../src/repository/purchase-event-authority.js";
import {
  assertCurrentInventoryLocationCorrectionLineage,
  parseBatchPayloadJson,
  parseProductPayloadJson,
  parseProjectionPayloadJson,
  parsePurchaseFactPayloadJson,
} from "../../src/storage/inventory-repository.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { openDietDatabase } from "../../src/storage/database.js";

const EXPECTED_ACTIONS = Object.freeze({
  "CASE-PURCHASE-001": "add_inventory",
  "CASE-PURCHASE-003": "add_inventory",
  "CASE-PURCHASE-007": "add_inventory",
  "CASE-INVENTORY-001": "record_meal",
  "CASE-INVENTORY-002": "record_meal",
  "CASE-INVENTORY-003": "record_meal",
  "CASE-INVENTORY-005": "record_meal",
  "CASE-INVENTORY-004": "record_meal",
  "CASE-INVENTORY-009": "record_meal",
  "CASE-MEAL-004": "record_meal",
  "CASE-MEAL-005": "record_meal",
  "CASE-PURCHASE-002": "add_inventory",
  "CASE-PURCHASE-005": "add_inventory",
  "CASE-PURCHASE-006": "add_inventory",
  "CASE-PURCHASE-008": "add_inventory",
  "CASE-PURCHASE-009": "add_inventory",
  "CASE-PURCHASE-010": "correct_record",
} as const);

const casesById = new Map(casesCatalog.cases.map((entry) => [entry.id, entry]));
const environments = new Map(
  fixturesCatalog.environments.map((entry) => [entry.fixture_id, entry]),
);
const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = join(tmpdir(), `diet-manager-pantry-application-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

afterEach(() => {
  for (const root of [...ownedRoots]) {
    ownedRoots.delete(root);
    rmSync(root, { recursive: true, force: false });
  }
});

function input(caseId: keyof typeof EXPECTED_ACTIONS) {
  const entry = casesById.get(caseId);
  if (entry === undefined) throw new Error(`missing case: ${caseId}`);
  const environment = environments.get(entry.setup.environment_fixture);
  if (environment === undefined) throw new Error(`missing environment: ${caseId}`);
  return {
    source_text: entry.source_text,
    received_at: environment.clock,
    timezone: environment.timezone,
    operation_id: `operation-${caseId.toLowerCase()}`,
    source_message_id: `message-${caseId.toLowerCase()}`,
    conversation_id: "conversation-pantry-application",
    prior_context: entry.setup.prior_context,
  };
}

function command(caseId: keyof typeof EXPECTED_ACTIONS): Record<string, unknown> {
  const result = parseCoreCommand(input(caseId));
  expect(result.disposition).toBe("candidate");
  if (result.disposition !== "candidate") throw new Error(`not candidate: ${caseId}`);
  expect(result.command.action).toBe(EXPECTED_ACTIONS[caseId]);
  expect(result.command.operation_id).toBe(`operation-${caseId.toLowerCase()}`);
  expect(result.command.source_text).toBe(casesById.get(caseId)?.source_text);
  expect(Object.isFrozen(result.command)).toBe(true);
  return result.command as unknown as Record<string, unknown>;
}

function request(caseId: keyof typeof EXPECTED_ACTIONS): CoreApplicationRequest {
  const parseInput = input(caseId);
  return {
    action: EXPECTED_ACTIONS[caseId],
    ...parseInput,
  } as CoreApplicationRequest;
}

function seedSingleBatchEvidence(
  runtime: CoreRuntime,
  root: string,
  location: Readonly<Record<string, unknown>>,
  expiration: Readonly<Record<string, unknown>>,
): void {
  const waterCase = casesById.get("CASE-WATER-001");
  if (waterCase === undefined) throw new Error("missing CASE-WATER-001");
  const environment = environments.get(waterCase.setup.environment_fixture);
  if (environment === undefined) throw new Error("missing CASE-WATER-001 environment");
  expect(handleCoreRequest(runtime, {
    action: "record_water",
    source_text: waterCase.source_text,
    received_at: environment.clock,
    timezone: environment.timezone,
    operation_id: "operation-location-correction-seed-water",
    source_message_id: "message-location-correction-seed-water",
    conversation_id: "conversation-pantry-application",
    prior_context: waterCase.setup.prior_context,
  })).toMatchObject({ committed: true });

  const authoritySecret = readFileSync(join(root, CORE_RUNTIME_SECRET_FILENAME));
  const setup = openDietDatabase({ privateRuntimeRoot: root });
  try {
    const service = createDietDomainService({
      database: setup.database,
      secret: authoritySecret,
      now: () => "2026-08-11T08:30:00.500Z",
    });
    const envelope: DomainEnvelopeInput = {
      envelope_id: "envelope-location-correction-seed-purchase",
      idempotency_key: "idem-location-correction-seed-purchase",
      command_type: "add_inventory",
      subject_scope: "user:self",
      source_message_id: "message-location-correction-seed-purchase",
      conversation_id: "conversation-pantry-application",
      received_at: "2026-08-11T00:30:00.000Z",
      timezone: "Asia/Shanghai",
      operations: [{
        kind: "add_inventory",
        operation_id: "operation-location-correction-seed-purchase",
        product: {
          product_id: "product-location-correction-seed-milk",
          normalized_name: "milk",
          product_type: "nutrition_drink",
        },
        batch_id: "batch-location-correction-seed-milk",
        amount: {
          unit: "carton",
          observed_microunits: 24_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "explicit",
        },
        nutrition_sources: [],
        pantry_evidence: {
          schema_version: "diet-manager/pantry-evidence/v1",
          product_identity: {
            raw_name: "牛奶",
            normalized_name: "milk",
            brand: null,
            variant_or_flavor: null,
            specification: null,
            evidence_kind: "explicit",
          },
          package_quantity: {
            outer_count: 2,
            outer_unit: "box",
            inner_per_outer: 12,
            inner_unit: "carton",
            capacity_per_inner: 250,
            capacity_unit: "ml",
            total_inner: 24,
            total_capacity: 6000,
            formula: "2*12*250=6000",
          },
          location,
          opening: null,
          expiration,
        },
      } as never],
    };
    const preview = service.preview(envelope);
    expect(service.execute({
      envelope,
      token: preview.token,
      input_digest: preview.input_digest,
      data_revision: preview.data_revision,
    }).status).toBe("committed");
    const stored = setup.database.prepare(
      `SELECT b.stock_event_id, b.batch_id, b.product_id,
              b.payload_json AS batch_payload_json,
              pr.payload_json AS product_payload_json,
              p.payload_json AS projection_payload_json,
              e.payload_json AS event_payload_json
       FROM inventory_batches b
       JOIN products pr ON pr.product_id = b.product_id
       JOIN inventory_batch_projections p ON p.batch_id = b.batch_id
       JOIN event_records e ON e.event_id = b.stock_event_id`,
    ).get() as {
      stock_event_id: string;
      batch_id: string;
      product_id: string;
      batch_payload_json: string;
      product_payload_json: string;
      projection_payload_json: string;
      event_payload_json: string;
    };
    expect(() => assertAuthenticatedPurchaseEventAuthority(
      setup.database,
      authoritySecret,
      stored.stock_event_id,
    )).not.toThrow();
    const product = parseProductPayloadJson(stored.product_payload_json);
    const batch = parseBatchPayloadJson(stored.batch_payload_json);
    const fact = parsePurchaseFactPayloadJson(stored.event_payload_json);
    expect(product).toMatchObject({ version: 2, identity: batch.pantry_evidence?.product_identity });
    expect(batch).toMatchObject({
      version: 2,
      pantry_evidence: fact.pantry_evidence,
    });
    const projection = parseProjectionPayloadJson(stored.projection_payload_json);
    if (projection.version !== 2 || projection.pantry_evidence === null) {
      throw new Error("invalid seeded projection");
    }
    expect(() => assertCurrentInventoryLocationCorrectionLineage(
      setup.database,
      authoritySecret,
      stored.batch_id,
      projection.pantry_evidence,
    )).not.toThrow();
  } finally {
    setup.close();
  }
}

describe("SEL-PANTRY-001 parser and application authority", () => {
  it.each(Object.keys(EXPECTED_ACTIONS) as Array<keyof typeof EXPECTED_ACTIONS>)(
    "parses exact selected source %s into its bounded action",
    (caseId) => {
      command(caseId);
    },
  );

  it("preserves the exact package equation for CASE-PURCHASE-001", () => {
    expect(command("CASE-PURCHASE-001")).toMatchObject({
      items: [{
        order: 0,
        raw_name: "牛奶",
        normalized_name: "milk",
        package_quantity: {
          outer_count: 2,
          outer_unit: "箱",
          inner_per_outer: 12,
          inner_unit: "盒",
          capacity_per_inner: 250,
          capacity_unit: "ml",
          total_inner: 24,
          total_capacity: 6000,
          formula: "2*12*250=6000",
        },
      }],
    });
  });

  it("keeps outer-only eggs unknown instead of inventing an inner count", () => {
    expect(command("CASE-PURCHASE-002")).toMatchObject({
      items: [{
        raw_name: "鸡蛋",
        normalized_name: "egg",
        package_quantity: {
          outer_count: 1,
          outer_unit: "袋",
          inner_per_outer: null,
          total_inner: null,
          total_capacity: null,
        },
      }],
    });
  });

  it("preserves ordered multi-product purchase items", () => {
    expect(command("CASE-PURCHASE-006")).toMatchObject({
      items: [
        { order: 0, normalized_name: "milk" },
        { order: 1, normalized_name: "egg" },
        { order: 2, normalized_name: "apple" },
      ],
    });
  });

  it("attaches explicit skip evidence to CASE-MEAL-005 only", () => {
    expect(command("CASE-MEAL-005")).toMatchObject({
      inventory_directive: {
        mode: "skip",
        evidence_kind: "explicit",
        matched_span: "只记录，别扣库存",
        rule_version: "diet-manager/inventory-directive/v1",
      },
    });
    expect(command("CASE-MEAL-004")).not.toHaveProperty("inventory_directive");
  });

  it("preserves deictic carton quantities for inventory allocation", () => {
    expect(command("CASE-INVENTORY-001")).toMatchObject({
      items: [{ normalized_name: "milk", quantity: 1, unit: "carton", estimated: false }],
    });
    expect(command("CASE-INVENTORY-002")).toMatchObject({
      items: [{ normalized_name: "milk", quantity: 2, unit: "carton", estimated: false }],
    });
  });

  it("keeps company ingestion self-owned while marking inventory outside", () => {
    expect(command("CASE-MEAL-004")).toMatchObject({
      subject: { kind: "self", resolution_basis: "omitted_subject_default" },
      context: { scene: "company", inventory_read: false },
    });
  });

  it("commits exact CASE-PURCHASE-001 through the public core runtime", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const outcome = handleCoreRequest(runtime, request("CASE-PURCHASE-001"));
      expect(outcome).toMatchObject({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-case-purchase-001",
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/u),
      });
      expect(outcome).not.toHaveProperty("record_ids");
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT event_type, fact_kind FROM event_records",
        ).all()).toEqual([{ event_type: "inventory_stock", fact_kind: "inventory" }]);
        expect(inspection.database.prepare(
          "SELECT quantity_status, json_extract(payload_json, '$.quantity_microunits') AS quantity FROM inventory_batch_projections",
        ).all()).toEqual([{ quantity_status: "available", quantity: 24_000_000 }]);
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("commits CASE-PURCHASE-006 as three ordered child events and truthful record IDs", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const outcome = handleCoreRequest(runtime, request("CASE-PURCHASE-006"));
      expect(outcome).toMatchObject({
        action: "add_inventory",
        status: "committed",
        committed: true,
        operation_id: "operation-case-purchase-006",
        record_id: expect.stringMatching(/^event-[a-f0-9]{32}$/u),
        record_ids: [
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
          expect.stringMatching(/^event-[a-f0-9]{32}$/u),
        ],
      });
      if (!("record_ids" in outcome) || outcome.record_ids === undefined) throw new Error("missing record_ids");
      expect(outcome.record_ids[0]).toBe(outcome.record_id);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT operation_id FROM event_records ORDER BY rowid",
        ).all()).toEqual([
          { operation_id: "operation-case-purchase-006:item:0" },
          { operation_id: "operation-case-purchase-006:item:1" },
          { operation_id: "operation-case-purchase-006:item:2" },
        ]);
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("reuses one exact historical identity while creating a distinct batch", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-001")).committed).toBe(true);
      const second = handleCoreRequest(runtime, request("CASE-PURCHASE-007"));
      expect(second).toMatchObject({ action: "add_inventory", committed: true });
      expect(second).not.toHaveProperty("record_ids");
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 1 });
        const rows = inspection.database.prepare(
          "SELECT product_id FROM inventory_batches ORDER BY committed_at, batch_id",
        ).all() as Array<{ product_id: string }>;
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map(({ product_id }) => product_id)).size).toBe(1);
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("returns bounded identity clarification without adding business rows", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-001")).committed).toBe(true);
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-003")).committed).toBe(true);
      const before = openDietDatabase({ privateRuntimeRoot: root });
      let counts: unknown;
      try {
        counts = before.database.prepare(
          `SELECT
             (SELECT COUNT(*) FROM event_records) AS events,
             (SELECT COUNT(*) FROM inventory_batches) AS batches,
             (SELECT COUNT(*) FROM inventory_transactions) AS transactions`,
        ).get();
      } finally {
        before.close();
      }
      const outcome = handleCoreRequest(runtime, request("CASE-PURCHASE-008"));
      expect(outcome).toEqual({
        action: "add_inventory",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-case-purchase-008",
        reason_code: "product_identity_ambiguous",
        clarification: {
          kind: "product_identity",
          options: [
            { key: "A", label: expect.any(String) },
            { key: "B", label: expect.any(String) },
          ],
          free_text_allowed: true,
        },
      });
      assertDietManagerOutcome(outcome);
      expect(Object.isFrozen(outcome)).toBe(true);
      if (outcome.status !== "needs_clarification" || outcome.clarification === undefined) {
        throw new Error("missing clarification");
      }
      expect(Object.isFrozen(outcome.clarification)).toBe(true);
      expect(Object.isFrozen(outcome.clarification.options)).toBe(true);
      expect(JSON.stringify(outcome)).not.toMatch(/product-[a-f0-9]{16,}|batch-|token|revision|root/iu);
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-008"))).toEqual(outcome);
      const after = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(after.database.prepare(
          `SELECT
             (SELECT COUNT(*) FROM event_records) AS events,
             (SELECT COUNT(*) FROM inventory_batches) AS batches,
             (SELECT COUNT(*) FROM inventory_transactions) AS transactions`,
        ).get()).toEqual(counts);
      } finally {
        after.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("deducts a matching Pantry batch and honors explicit skip without inventory reads", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-001")).committed).toBe(true);
      expect(handleCoreRequest(runtime, request("CASE-INVENTORY-001")).committed).toBe(true);
      const milk = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(milk.database.prepare(
          "SELECT json_extract(payload_json, '$.quantity_microunits') AS quantity FROM inventory_batch_projections",
        ).get()).toEqual({ quantity: 23_000_000 });
        expect(milk.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
        ).get()).toEqual({ count: 1 });
      } finally {
        milk.close();
      }
    } finally {
      runtime.close();
    }

    const skipRoot = newRoot();
    const skipRuntime = createCoreRuntime({ officialDataRoot: skipRoot, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(skipRuntime, request("CASE-PURCHASE-006")).committed).toBe(true);
      expect(handleCoreRequest(skipRuntime, request("CASE-MEAL-005")).committed).toBe(true);
      const inspection = openDietDatabase({ privateRuntimeRoot: skipRoot });
      try {
        expect(inspection.database.prepare(
          "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
        ).get()).toEqual({ count: 0 });
        const item = inspection.database.prepare(
          "SELECT payload_json FROM meal_items ORDER BY rowid DESC LIMIT 1",
        ).get() as { payload_json: string };
        expect(JSON.parse(item.payload_json)).toMatchObject({
          inventory_directive: { mode: "skip", evidence_kind: "explicit" },
          inventory_plan: { status: "skipped_by_user", read_required: false },
        });
      } finally {
        inspection.close();
      }
    } finally {
      skipRuntime.close();
    }
  });

  it("persists partial-opening evidence and its labeled one-day expiry rule", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-003")).committed).toBe(true);
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-009")).committed).toBe(true);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const event = inspection.database.prepare(
          "SELECT payload_json FROM event_records WHERE operation_id = ?",
        ).get("operation-case-purchase-009") as { payload_json: string };
        expect(JSON.parse(event.payload_json)).toMatchObject({
          pantry_evidence: {
            opening: {
              status: "opened",
              opened_at: "2026-08-11T08:30:00+08:00",
              evidence_kind: "rule",
              rule_version: "diet-manager/opening-evidence/v1",
            },
            expiration: {
              explicit_at: null,
              effective_at: "2026-08-12T08:30:00.000+08:00",
              basis: "rule",
              rule_version: "diet-manager/shelf-life-v1",
            },
          },
        });
        expect(inspection.database.prepare(
          `SELECT seal_status, expiry_status, effective_expiration_at
           FROM inventory_batch_projections p
           JOIN inventory_batches b ON b.batch_id = p.batch_id
           JOIN event_records e ON e.event_id = b.stock_event_id
           WHERE e.operation_id = ?`,
        ).get("operation-case-purchase-009")).toEqual({
          seal_status: "opened",
          expiry_status: "known",
          effective_expiration_at: "2026-08-12T08:30:00.000+08:00",
        });
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("replays multi-product outcomes live and after reopen without duplicate facts", () => {
    const root = newRoot();
    let runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const first = handleCoreRequest(runtime, request("CASE-PURCHASE-006"));
      expect(first.committed).toBe(true);
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-006"))).toEqual(first);
      runtime.close();
      runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:02.000Z" });
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-006"))).toEqual(first);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 3 });
        expect(inspection.database.prepare("SELECT COUNT(*) AS count FROM inventory_batches").get()).toEqual({ count: 3 });
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("commits CASE-PURCHASE-010 through the public runtime as one append-only correction", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      seedSingleBatchEvidence(
        runtime,
        root,
        {
          value: "room_temperature_cabinet",
          evidence_kind: "explicit",
          rule_version: null,
        },
        {
          explicit_at: null,
          effective_at: "2026-08-12T08:30:00+08:00",
          basis: "rule",
          rule_version: "diet-manager/room-temperature-milk-shelf-life/v1",
        },
      );

      const outcome = handleCoreRequest(runtime, request("CASE-PURCHASE-010"));

      expect(outcome).toMatchObject({
        action: "correct_record",
        status: "committed",
        committed: true,
        record_id: expect.any(String),
      });
      const repeatedMeaning = structuredClone(request("CASE-PURCHASE-010"));
      repeatedMeaning.operation_id = "operation-pantry-location-correction-no-change";
      repeatedMeaning.source_message_id = "message-pantry-location-correction-no-change";
      expect(handleCoreRequest(runtime, repeatedMeaning)).toEqual({
        action: "correct_record",
        status: "ignored",
        committed: false,
        operation_id: "operation-pantry-location-correction-no-change",
        reason_code: "location_correction_already_current",
      });
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'inventory_adjusted'",
        ).get()).toEqual({ count: 1 });
        const projection = inspection.database.prepare(
          "SELECT last_event_id, payload_json FROM inventory_batch_projections",
        ).get() as { last_event_id: string; payload_json: string };
        expect(JSON.parse(projection.payload_json)).toMatchObject({
          pantry_evidence: {
            location: { value: "refrigerator", evidence_kind: "corrected_explicit" },
            expiration: {
              explicit_at: null,
              effective_at: "2026-08-18T08:30:00.000+08:00",
              basis: "rule",
              rule_version: "diet-manager/fresh-milk-shelf-life-v1",
            },
          },
        });
        expect(inspection.database.prepare(
          "SELECT event_id FROM event_records WHERE event_type = 'inventory_adjusted'",
        ).get()).toEqual({ event_id: projection.last_event_id });
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("rejects a forged already-current projection before returning a no-write outcome", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      seedSingleBatchEvidence(runtime, root, {
        value: "room_temperature_cabinet",
        evidence_kind: "explicit",
        rule_version: null,
      }, {
        explicit_at: null,
        effective_at: "2026-08-12T08:30:00+08:00",
        basis: "rule",
        rule_version: "diet-manager/room-temperature-milk-shelf-life/v1",
      });
      const tamper = openDietDatabase({ privateRuntimeRoot: root });
      let forgedProjectionJson: string;
      try {
        const row = tamper.database.prepare(
          "SELECT batch_id, payload_json FROM inventory_batch_projections",
        ).get() as { batch_id: string; payload_json: string };
        const projection = JSON.parse(row.payload_json) as Record<string, unknown>;
        (projection.pantry_evidence as Record<string, unknown>).location = {
          value: "refrigerator",
          evidence_kind: "corrected_explicit",
          rule_version: null,
        };
        forgedProjectionJson = canonicalJson(projection);
        tamper.database.prepare(
          "UPDATE inventory_batch_projections SET payload_json = ? WHERE batch_id = ?",
        ).run(forgedProjectionJson, row.batch_id);
      } finally {
        tamper.close();
      }

      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-010"))).toEqual({
        action: "correct_record",
        status: "failed",
        committed: false,
        operation_id: "operation-case-purchase-010",
        error_code: "CORE_APPLICATION_AUTHORITY_INVALID",
      });
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(inspection.database.prepare(
          "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'inventory_adjusted'",
        ).get()).toEqual({ count: 0 });
        expect(inspection.database.prepare(
          "SELECT payload_json FROM inventory_batch_projections",
        ).get()).toEqual({ payload_json: forgedProjectionJson });
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("preserves explicit expiration authority through the public location correction", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const explicitExpiration = {
        explicit_at: "2026-08-20T00:30:00.000Z",
        effective_at: "2026-08-20T00:30:00.000Z",
        basis: "explicit",
        rule_version: null,
      } as const;
      seedSingleBatchEvidence(runtime, root, {
        value: "room_temperature_cabinet",
        evidence_kind: "explicit",
        rule_version: null,
      }, explicitExpiration);

      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-010"))).toMatchObject({
        action: "correct_record",
        status: "committed",
        committed: true,
      });
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const projection = inspection.database.prepare(
          "SELECT payload_json FROM inventory_batch_projections",
        ).get() as { payload_json: string };
        expect(JSON.parse(projection.payload_json)).toMatchObject({
          pantry_evidence: {
            location: { value: "refrigerator", evidence_kind: "corrected_explicit" },
            expiration: explicitExpiration,
          },
        });
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("rejects a tampered child purchase fact on finalized replay without another write", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      expect(handleCoreRequest(runtime, request("CASE-PURCHASE-006")).committed).toBe(true);
      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      let before: unknown;
      try {
        const row = inspection.database.prepare(
          "SELECT event_id, payload_json FROM event_records ORDER BY committed_at LIMIT 1 OFFSET 1",
        ).get() as { event_id: string; payload_json: string };
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const evidence = payload.pantry_evidence as Record<string, unknown>;
        evidence.location = { ...(evidence.location as Record<string, unknown>), value: "freezer" };
        inspection.database.prepare("UPDATE event_records SET payload_json = ? WHERE event_id = ?")
          .run(canonicalJson(payload), row.event_id);
        before = inspection.database.prepare(
          `SELECT
             (SELECT COUNT(*) FROM event_records) AS events,
             (SELECT COUNT(*) FROM inventory_batches) AS batches,
             (SELECT COUNT(*) FROM inventory_transactions) AS transactions,
             (SELECT COUNT(*) FROM envelope_finalizations) AS finalizations`,
        ).get();
      } finally {
        inspection.close();
      }
      const replay = handleCoreRequest(runtime, request("CASE-PURCHASE-006"));
      expect(replay).toMatchObject({ action: "add_inventory", status: "failed", committed: false });
      const after = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(after.database.prepare(
          `SELECT
             (SELECT COUNT(*) FROM event_records) AS events,
             (SELECT COUNT(*) FROM inventory_batches) AS batches,
             (SELECT COUNT(*) FROM inventory_transactions) AS transactions,
             (SELECT COUNT(*) FROM envelope_finalizations) AS finalizations`,
        ).get()).toEqual(before);
      } finally {
        after.close();
      }
    } finally {
      runtime.close();
    }
  });
});
