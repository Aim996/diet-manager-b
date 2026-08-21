import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const secret = Buffer.from("DM-03 ingestion inventory key 001", "utf8");
const roots = new Set<string>();

function root(): string {
  const value = join(tmpdir(), `diet-manager-ingestion-${randomUUID().replaceAll("-", "")}`);
  mkdirSync(value);
  roots.add(value);
  return value;
}

afterEach(() => {
  for (const value of [...roots]) {
    roots.delete(value);
    rmSync(value, { recursive: true, force: false });
  }
});

function execute(service: ReturnType<typeof createDietDomainService>, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  return service.execute({ envelope, token: preview.token, input_digest: preview.input_digest, data_revision: preview.data_revision });
}

function purchase(suffix: string, batch: string, received: string): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-link-purchase-${suffix}`, idempotency_key: `idem-link-purchase-${suffix}`,
    command_type: "add_inventory", subject_scope: "user:self",
    source_message_id: `message-link-purchase-${suffix}`, conversation_id: "conversation-link",
    received_at: received, timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory", operation_id: `operation-link-purchase-${suffix}`,
      product: { product_id: "product-link-bread", normalized_name: "bread", product_type: "food" },
      batch_id: batch,
      amount: {
        unit: "slice", observed_microunits: 1_000_000, nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null, template_reference_microunits: null, evidence: "explicit",
      },
      nutrition_sources: [],
      pantry_evidence: {
        schema_version: "diet-manager/pantry-evidence/v1",
        product_identity: {
          raw_name: "全麦面包", normalized_name: "bread", brand: "brand-a", variant_or_flavor: "wholegrain",
          specification: null, evidence_kind: "explicit",
        },
        package_quantity: {
          outer_count: 1, outer_unit: "slice", inner_per_outer: null, inner_unit: null,
          capacity_per_inner: null, capacity_unit: null, total_inner: null, total_capacity: null, formula: null,
        },
        location: { value: "home", evidence_kind: "configured_home_default", rule_version: "diet-manager/home-default/v1" },
        opening: null,
        expiration: { explicit_at: null, effective_at: null, basis: "unknown", rule_version: null },
      },
    }],
  };
}

function meal(suffix: string, name = "bread", amount = 2_000_000): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-link-meal-${suffix}`, idempotency_key: `idem-link-meal-${suffix}`,
    command_type: "record_meal", subject_scope: "user:self",
    source_message_id: `message-link-meal-${suffix}`, conversation_id: "conversation-link",
    received_at: "2026-08-21T03:00:00.000Z", timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal", operation_id: `operation-link-meal-${suffix}`,
      occurred_at: "2026-08-21T03:00:00.000Z", meal_slot: "breakfast", location: "home",
      inventory_policy: { mode: "pantry_v2", missing_candidate_behavior: "skip_insufficient", rule_version: "diet-manager/pantry-allocation-v1" },
      items: [{
        normalized_name: name, item_type: "food",
        amount: {
          unit: "slice", observed_microunits: amount, nutrition_adoption_microunits: amount,
          inventory_deduction_microunits: amount, template_reference_microunits: null, evidence: "explicit",
        },
        nutrition_sources: [],
      }],
    }],
  };
}

describe("ingestion and inventory linkage", () => {
  it("uses FIFO and partially deducts available stock without shrinking the meal fact", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: root() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T03:00:01.000Z" });
      execute(service, purchase("early", "batch-link-early", "2026-08-21T01:00:00.000Z"));
      execute(service, purchase("late", "batch-link-late", "2026-08-21T02:00:00.000Z"));
      const result = execute(service, meal("partial", "bread", 3_000_000));
      expect(result).toMatchObject({
        status: "committed_with_issues",
        items: [{
          inventory_match: "matched",
          issue_codes: ["inventory_insufficient"],
          meal_items: [{ observed_microunits: 3_000_000, inventory_deduction_microunits: 3_000_000 }],
        }],
      });
      expect(runtime.database.prepare("SELECT batch_id FROM inventory_transactions WHERE direction = 'out' ORDER BY rowid").all())
        .toEqual([{ batch_id: "batch-link-early" }, { batch_id: "batch-link-late" }]);
      expect(runtime.database.prepare("SELECT MIN(json_extract(payload_json, '$.quantity_microunits')) AS minimum FROM inventory_batch_projections").get())
        .toEqual({ minimum: 0 });
      expect(runtime.database.prepare("SELECT json_extract(payload_json, '$.amount.observed_microunits') AS amount FROM meal_items").get())
        .toEqual({ amount: 3_000_000 });
    } finally {
      runtime.close();
    }
  });

  it("commits intake and nutrition when no valid inventory can be matched", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: root() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-21T03:00:01.000Z" });
      expect(execute(service, meal("none", "apple", 1_000_000))).toMatchObject({
        status: "committed_with_issues",
        items: [{
          inventory_match: "skipped_insufficient",
          issue_codes: ["inventory_insufficient"],
          meal_items: [{ observed_microunits: 1_000_000 }],
        }],
      });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM meal_items").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });
});
