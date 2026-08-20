import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

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
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = join(tmpdir(), `diet-manager-location-correction-${randomUUID().replaceAll("-", "")}`);
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

function correctionRequest(sourceText: string, operationId: string): CoreApplicationRequest {
  return {
    action: "correct_record",
    source_text: sourceText,
    received_at: "2026-08-11T08:35:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-location-correction",
    prior_context: [],
  };
}

function tableSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function seedMilkBatch(
  root: string,
  secret: Uint8Array,
  opts: { batchId: string; productId: string; envelopeId: string; idempotencyKey: string; operationId: string },
): void {
  const setup = openDietDatabase({ privateRuntimeRoot: root });
  try {
    const service = createDietDomainService({
      database: setup.database,
      secret,
      now: () => "2026-08-11T08:30:00.500Z",
    });
    const envelope: DomainEnvelopeInput = {
      envelope_id: opts.envelopeId,
      idempotency_key: opts.idempotencyKey,
      command_type: "add_inventory",
      subject_scope: "user:self",
      source_message_id: `message-${opts.operationId}`,
      conversation_id: "conversation-location-correction",
      received_at: "2026-08-11T00:30:00.000Z",
      timezone: "Asia/Shanghai",
      operations: [{
        kind: "add_inventory",
        operation_id: opts.operationId,
        product: {
          product_id: opts.productId,
          normalized_name: "milk",
          product_type: "nutrition_drink",
        },
        batch_id: opts.batchId,
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
          location: {
            value: "room_temperature_cabinet",
            evidence_kind: "explicit",
            rule_version: null,
          },
          opening: null,
          expiration: {
            explicit_at: null,
            effective_at: "2026-08-12T08:30:00+08:00",
            basis: "rule",
            rule_version: "diet-manager/room-temperature-milk-shelf-life/v1",
          },
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
  } finally {
    setup.close();
  }
}

/** Seed two active milk batches both located in the room-temperature cabinet. */
function seedTwoMilkBatches(runtime: CoreRuntime, root: string): { batchA: string; batchB: string } {
  // Force the private authority secret onto disk (mirrors the domain-service seed path).
  expect(handleCoreRequest(runtime, {
    action: "record_water",
    source_text: "喝了500ml白水。",
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-location-seed-water",
    source_message_id: "message-location-seed-water",
    conversation_id: "conversation-location-correction",
    prior_context: [],
  })).toMatchObject({ committed: true });

  const secret = readFileSync(join(root, CORE_RUNTIME_SECRET_FILENAME));
  const batchA = "batch-loc-milk-a";
  const batchB = "batch-loc-milk-b";
  seedMilkBatch(root, secret, {
    batchId: batchA, productId: "product-loc-milk-a",
    envelopeId: "envelope-loc-milk-a", idempotencyKey: "idem-loc-milk-a", operationId: "operation-loc-milk-a",
  });
  seedMilkBatch(root, secret, {
    batchId: batchB, productId: "product-loc-milk-b",
    envelopeId: "envelope-loc-milk-b", idempotencyKey: "idem-loc-milk-b", operationId: "operation-loc-milk-b",
  });
  return { batchA, batchB };
}

describe("SEL-PANTRY-001 generalized inventory location correction", () => {
  it("returns a bounded clarification with zero writes when deictic '这批' matches two milk batches", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const { batchA, batchB } = seedTwoMilkBatches(runtime, root);
      const before = openDietDatabase({ privateRuntimeRoot: root });
      let snapshot: string;
      try {
        snapshot = tableSnapshot(before.database);
      } finally {
        before.close();
      }

      const outcome = handleCoreRequest(runtime, correctionRequest(
        "更正：这批牛奶放在冷藏室，不是常温柜。", "operation-loc-correction-deictic"));

      expect(outcome, JSON.stringify(outcome)).toEqual({
        action: "correct_record",
        status: "needs_clarification",
        committed: false,
        operation_id: "operation-loc-correction-deictic",
        reason_code: "location_correction_ambiguous",
        clarification: {
          kind: "product_identity",
          options: [
            { key: "A", label: `批次 ${batchA}` },
            { key: "B", label: `批次 ${batchB}` },
          ],
          free_text_allowed: true,
        },
      });
      assertDietManagerOutcome(outcome);

      const after = openDietDatabase({ privateRuntimeRoot: root });
      try {
        expect(tableSnapshot(after.database)).toBe(snapshot);
      } finally {
        after.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("resolves an exact batch id, recomputes location and expiration, and retains the old projection", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-11T08:30:01.000Z" });
    try {
      const { batchA, batchB } = seedTwoMilkBatches(runtime, root);

      const outcome = handleCoreRequest(runtime, correctionRequest(
        `更正：批次 ${batchA} 放在冷藏室，不是常温柜。`, "operation-loc-correction-exact"));

      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        action: "correct_record",
        status: "committed",
        committed: true,
        operation_id: "operation-loc-correction-exact",
        record_id: expect.any(String),
      });

      const inspection = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const projectionA = inspection.database.prepare(
          "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
        ).get(batchA) as { payload_json: string };
        expect(JSON.parse(projectionA.payload_json)).toMatchObject({
          pantry_evidence: {
            location: { value: "refrigerator", evidence_kind: "corrected_explicit" },
            expiration: { rule_version: "diet-manager/fresh-milk-shelf-life-v1" },
          },
        });

        const projectionB = inspection.database.prepare(
          "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
        ).get(batchB) as { payload_json: string };
        expect(JSON.parse(projectionB.payload_json)).toMatchObject({
          pantry_evidence: { location: { value: "room_temperature_cabinet" } },
        });

        const correction = inspection.database.prepare(
          "SELECT payload_json FROM event_records WHERE event_type = 'inventory_adjusted'",
        ).get() as { payload_json: string };
        const fact = JSON.parse(correction.payload_json) as Record<string, unknown>;
        expect(fact.previous_location).toMatchObject({ value: "room_temperature_cabinet" });
        expect(fact.next_location).toMatchObject({ value: "refrigerator" });
        expect(fact.previous_projection_json).toContain("room_temperature_cabinet");
        expect(fact.next_projection_json).toContain("refrigerator");
      } finally {
        inspection.close();
      }
    } finally {
      runtime.close();
    }
  });
});
