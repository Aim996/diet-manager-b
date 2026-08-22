import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const secret = Buffer.from("DM-03 dual inventory authority key 001", "utf8");
const roots = new Set<string>();

function testRoot(): string {
  const root = join(tmpdir(), `diet-manager-dual-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(root);
  roots.add(root);
  return root;
}

afterEach(() => {
  for (const root of [...roots]) {
    roots.delete(root);
    rmSync(root, { recursive: true, force: false });
  }
});

function execute(service: ReturnType<typeof createDietDomainService>, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  return service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision });
}

function purchase(suffix: string, options: Readonly<{
  batch: string;
  received: string;
  count: number;
  packageUnit: string;
  capacity: number | null;
  capacityUnit: string | null;
}>): DomainEnvelopeInput {
  const quantity = options.count * 1_000_000;
  const totalCapacity = options.capacity === null ? null : options.count * options.capacity;
  return {
    envelope_id: `envelope-dual-purchase-${suffix}`,
    idempotency_key: `idem-dual-purchase-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-dual-purchase-${suffix}`,
    conversation_id: "conversation-dual",
    received_at: options.received,
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: `operation-dual-purchase-${suffix}`,
      product: { product_id: "product-dual-milk", normalized_name: "milk", product_type: "nutrition_drink" },
      batch_id: options.batch,
      amount: {
        unit: options.packageUnit,
        observed_microunits: quantity,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [],
      pantry_evidence: {
        schema_version: "diet-manager/pantry-evidence/v1",
        product_identity: {
          raw_name: "牛奶", normalized_name: "milk", brand: "brand-a", variant_or_flavor: "whole",
          specification: options.capacity === null ? null : { value: options.capacity, unit: options.capacityUnit! },
          evidence_kind: "explicit",
        },
        package_quantity: {
          outer_count: options.count, outer_unit: options.packageUnit,
          inner_per_outer: null, inner_unit: null,
          capacity_per_inner: options.capacity, capacity_unit: options.capacityUnit,
          total_inner: null, total_capacity: totalCapacity,
          formula: options.capacity === null ? null : `${options.count}*${options.capacity}=${totalCapacity}`,
        },
        location: { value: "home", evidence_kind: "configured_home_default", rule_version: "diet-manager/home-default/v1" },
        opening: null,
        expiration: { explicit_at: null, effective_at: null, basis: "unknown", rule_version: null },
      },
    }],
  };
}

function meal(suffix: string, amount: number, unit: string, withNutrition = false): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-dual-meal-${suffix}`,
    idempotency_key: `idem-dual-meal-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-dual-meal-${suffix}`,
    conversation_id: "conversation-dual",
    received_at: "2026-08-21T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: `operation-dual-meal-${suffix}`,
      occurred_at: "2026-08-21T02:00:00.000Z",
      meal_slot: "breakfast",
      location: "home",
      inventory_policy: { mode: "pantry_v2", missing_candidate_behavior: "skip_insufficient", rule_version: "diet-manager/pantry-allocation-v1" },
      items: [{
        normalized_name: "milk", item_type: "nutrition_drink",
        amount: {
          unit, observed_microunits: amount, nutrition_adoption_microunits: amount,
          inventory_deduction_microunits: amount, template_reference_microunits: null, evidence: "explicit",
        },
        nutrition_sources: withNutrition ? [{
          source_type: "public_fixture",
          source_ref: "fixture-dual-milk-v1",
          profile_version: 1,
          applicable_product_id: null,
          basis_kind: unit === "ml" ? "per_100ml" : "per_package",
          basis_microunits: unit === "ml" ? 100_000_000 : 1_000_000,
          basis_unit: unit,
          nutrients: {
            energy_kcal_milli: 150_000, protein_mg: 8_000, fat_mg: 8_000,
            carbohydrate_mg: 12_000, fiber_mg: 0, water_ml_milli: 220_000,
          },
        }] : [],
      }],
    }],
  };
}

function undo(suffix: string, targetEventId: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-dual-undo-${suffix}`,
    idempotency_key: `idem-dual-undo-${suffix}`,
    command_type: "undo_record",
    subject_scope: "user:self",
    source_message_id: `message-dual-undo-${suffix}`,
    conversation_id: "conversation-dual",
    received_at: "2026-08-21T02:10:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "undo_record",
      operation_id: `operation-dual-undo-${suffix}`,
      target_event_id: targetEventId,
      base_revision: 1,
    }],
  };
}

function correctAmount(
  suffix: string,
  targetEventId: string,
  amount: number,
  unit: string,
): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-dual-correction-${suffix}`,
    idempotency_key: `idem-dual-correction-${suffix}`,
    command_type: "correct_record",
    subject_scope: "user:self",
    source_message_id: `message-dual-correction-${suffix}`,
    conversation_id: "conversation-dual",
    received_at: "2026-08-21T02:10:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "correct_record",
      operation_id: `operation-dual-correction-${suffix}`,
      target_event_id: targetEventId,
      base_revision: 1,
      item_order: 0,
      replacement_amount: {
        unit,
        observed_microunits: amount,
        nutrition_adoption_microunits: amount,
        inventory_deduction_microunits: amount,
        template_reference_microunits: null,
        evidence: "explicit",
      },
    }],
  };
}

describe("dual-unit inventory persistence", () => {
  it("persists 2 cartons/500 ml and consumes one carton then 100 ml from the same batch", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: testRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T02:00:01.000Z" });
      expect(execute(service, purchase("milk", {
        batch: "batch-dual-milk", received: "2026-08-21T01:00:00.000Z", count: 2,
        packageUnit: "carton", capacity: 250, capacityUnit: "ml",
      })).status).toBe("committed");
      expect(runtime.database.prepare("SELECT * FROM inventory_quantity_models WHERE batch_id = ?").get("batch-dual-milk")).toMatchObject({
        package_unit: "carton",
        original_package_microunits: 2_000,
        per_package_base_microunits: 250_000,
        base_unit: "ml",
        remaining_base_microunits: 500_000,
        conversion_source: "explicit",
        revision: 1,
      });

      expect(execute(service, meal("carton", 1_000_000, "carton"))).toMatchObject({ status: "committed", items: [{ inventory_match: "matched" }] });
      expect(execute(service, meal("ml", 100_000_000, "ml"))).toMatchObject({ status: "committed", items: [{ inventory_match: "matched" }] });
      expect(runtime.database.prepare("SELECT remaining_base_microunits, revision FROM inventory_quantity_models WHERE batch_id = ?").get("batch-dual-milk"))
        .toEqual({ remaining_base_microunits: 150_000, revision: 3 });
      expect(runtime.database.prepare("SELECT quantity_unit FROM inventory_batches WHERE batch_id = ?").get("batch-dual-milk"))
        .toEqual({ quantity_unit: "carton" });
      expect(runtime.database.prepare("SELECT json_extract(payload_json, '$.quantity_microunits') AS quantity, json_extract(payload_json, '$.unit') AS unit FROM inventory_batch_projections WHERE batch_id = ?").get("batch-dual-milk"))
        .toEqual({ quantity: 600_000, unit: "carton" });
      expect(runtime.database.prepare("SELECT unit FROM inventory_transactions WHERE direction = 'out' ORDER BY rowid").all())
        .toEqual([{ unit: "carton" }, { unit: "ml" }]);
    } finally {
      runtime.close();
    }
  });

  it("deducts package-only inventory by package and rejects an unproven ml conversion", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: testRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T02:00:01.000Z" });
      execute(service, purchase("unknown", {
        batch: "batch-dual-unknown", received: "2026-08-21T00:30:00.000Z", count: 2,
        packageUnit: "carton", capacity: null, capacityUnit: null,
      }));
      expect(execute(service, meal("unknown-carton", 1_000_000, "carton"))).toMatchObject({
        status: "committed", items: [{ inventory_match: "matched" }],
      });
      expect(execute(service, meal("unknown-ml", 100_000_000, "ml"))).toMatchObject({
        status: "committed_with_issues",
        items: [{ inventory_match: "skipped_unit_incompatible", issue_codes: ["inventory_unit_conversion_unproven"] }],
      });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'").get()).toEqual({ count: 1 });
    } finally {
      runtime.close();
    }
  });

  it("does not convert a stored mass specification to volume without density", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: testRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T02:00:01.000Z" });
      execute(service, purchase("mass", {
        batch: "batch-dual-mass", received: "2026-08-21T00:30:00.000Z", count: 1,
        packageUnit: "carton", capacity: 500, capacityUnit: "g",
      }));
      expect(execute(service, meal("mass-ml", 100_000_000, "ml"))).toMatchObject({
        status: "committed_with_issues",
        items: [{ inventory_match: "skipped_unit_incompatible", issue_codes: ["inventory_unit_conversion_unproven"] }],
      });
      expect(runtime.database.prepare("SELECT remaining_base_microunits FROM inventory_quantity_models WHERE batch_id = ?").get("batch-dual-mass"))
        .toEqual({ remaining_base_microunits: 500_000 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });

  it("restores both package and base balances when a linked intake is undone", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: testRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T02:10:01.000Z" });
      execute(service, purchase("undo", {
        batch: "batch-dual-undo", received: "2026-08-21T01:00:00.000Z", count: 2,
        packageUnit: "carton", capacity: 250, capacityUnit: "ml",
      }));
      execute(service, meal("undo", 1_000_000, "carton", true));
      const target = runtime.database.prepare(
        "SELECT event_id FROM event_records WHERE event_type = 'diet_meal' ORDER BY committed_at DESC LIMIT 1",
      ).get() as { event_id: string };

      expect(execute(service, undo("meal", target.event_id))).toMatchObject({ status: "committed" });
      expect(runtime.database.prepare("SELECT remaining_base_microunits, revision FROM inventory_quantity_models WHERE batch_id = ?").get("batch-dual-undo"))
        .toEqual({ remaining_base_microunits: 500_000, revision: 3 });
      expect(runtime.database.prepare("SELECT quantity_status, json_extract(payload_json, '$.quantity_microunits') AS quantity, json_extract(payload_json, '$.unit') AS unit FROM inventory_batch_projections WHERE batch_id = ?").get("batch-dual-undo"))
        .toEqual({ quantity_status: "available", quantity: 2_000_000, unit: "carton" });
      expect(runtime.database.prepare("SELECT direction FROM inventory_transactions WHERE reason_code = 'correction_compensation'").all())
        .toEqual([{ direction: "in" }]);
    } finally {
      runtime.close();
    }
  });

  it("applies an additional base-unit correction against the authoritative base balance", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: testRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T02:10:01.000Z" });
      execute(service, purchase("correction", {
        batch: "batch-dual-correction", received: "2026-08-21T01:00:00.000Z", count: 2,
        packageUnit: "carton", capacity: 250, capacityUnit: "ml",
      }));
      execute(service, meal("correction", 100_000_000, "ml", true));
      const target = runtime.database.prepare(
        "SELECT event_id FROM event_records WHERE event_type = 'diet_meal' ORDER BY committed_at DESC LIMIT 1",
      ).get() as { event_id: string };

      expect(execute(service, correctAmount("ml", target.event_id, 150_000_000, "ml")))
        .toMatchObject({ status: "committed" });
      expect(runtime.database.prepare(
        "SELECT remaining_base_microunits, revision FROM inventory_quantity_models WHERE batch_id = ?",
      ).get("batch-dual-correction")).toEqual({ remaining_base_microunits: 350_000, revision: 3 });
      expect(runtime.database.prepare(
        "SELECT direction, unit FROM inventory_transactions WHERE reason_code = 'correction_compensation'",
      ).all()).toEqual([{ direction: "out", unit: "ml" }]);
    } finally {
      runtime.close();
    }
  });

  it("rejects a stale concurrent deduction and keeps the integer balance nonnegative", () => {
    const sharedRoot = testRoot();
    const firstRuntime = openDietDatabase({ privateRuntimeRoot: sharedRoot });
    const secondRuntime = openDietDatabase({ privateRuntimeRoot: sharedRoot });
    try {
      const first = createDietDomainService({ database: firstRuntime.database, secret, now: () => "2026-08-21T02:20:01.000Z" });
      const second = createDietDomainService({ database: secondRuntime.database, secret, now: () => "2026-08-21T02:20:01.000Z" });
      execute(first, purchase("concurrent", {
        batch: "batch-dual-concurrent", received: "2026-08-21T01:00:00.000Z", count: 1,
        packageUnit: "carton", capacity: 250, capacityUnit: "ml",
      }));
      const firstMeal = meal("concurrent-a", 1_000_000, "carton");
      const secondMeal = meal("concurrent-b", 1_000_000, "carton");
      const firstPreview = first.preview(firstMeal);
      const secondPreview = second.preview(secondMeal);
      expect(first.execute({
        envelope: firstMeal,
        token: firstPreview.token,
        input_digest: firstPreview.input_digest,
        data_revision: firstPreview.data_revision,
      })).toMatchObject({ status: "committed" });
      expect(() => second.execute({
        envelope: secondMeal,
        token: secondPreview.token,
        input_digest: secondPreview.input_digest,
        data_revision: secondPreview.data_revision,
      })).toThrow(/PREVIEW_(?:STALE:data_revision|AUTHORITY_INVALID:meal_fact_identity)/);
      expect(firstRuntime.database.prepare("SELECT remaining_base_microunits, revision FROM inventory_quantity_models WHERE batch_id = ?").get("batch-dual-concurrent"))
        .toEqual({ remaining_base_microunits: 0, revision: 2 });
      expect(firstRuntime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'").get())
        .toEqual({ count: 1 });
      expect(firstRuntime.database.prepare("SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'diet_meal'").get())
        .toEqual({ count: 1 });
    } finally {
      secondRuntime.close();
      firstRuntime.close();
    }
  });
});
