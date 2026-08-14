import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/authority/canonical-json.js";
import {
  PantryEvidenceAuthorityError,
  resolveInventoryAllocation,
  type InventoryAllocationInput,
} from "../../src/domain/inventory-service.js";
import { resolveInventoryMatch } from "../../src/domain/rules.js";
import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

const secret = Buffer.from("SEL-PANTRY-001 allocation secret 01", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-pantry-allocation-${randomUUID().replaceAll("-", "")}`);
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

function executeEnvelope(
  service: ReturnType<typeof createDietDomainService>,
  envelope: DomainEnvelopeInput,
) {
  const preview = service.preview(envelope);
  return service.execute({
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

function purchaseEnvelope(
  suffix: string,
  batchId: string,
  receivedAt: string,
  expirationAt: string | null,
  options: Readonly<{
    productId?: string;
    brand?: string;
    variant?: string;
    quantityMicrounits?: number;
  }> = {},
): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-pantry-allocation-purchase-${suffix}`,
    idempotency_key: `idem-pantry-allocation-purchase-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-pantry-allocation-purchase-${suffix}`,
    conversation_id: "conversation-pantry-allocation",
    received_at: receivedAt,
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: `operation-pantry-allocation-purchase-${suffix}`,
      product: {
        product_id: options.productId ?? "fixture-product-milk-whole-250",
        normalized_name: "milk",
        product_type: "nutrition_drink",
      },
      batch_id: batchId,
      amount: {
        unit: "carton",
        observed_microunits: options.quantityMicrounits ?? 1_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [],
      pantry_evidence: {
        schema_version: "diet-manager/pantry-evidence/v1",
        product_identity: {
          raw_name: "milk",
          normalized_name: "milk",
          brand: options.brand ?? "brand-a",
          variant_or_flavor: options.variant ?? "whole",
          specification: { value: 250, unit: "ml" },
          evidence_kind: "explicit",
        },
        package_quantity: {
          outer_count: 1,
          outer_unit: "carton",
          inner_per_outer: 1,
          inner_unit: "carton",
          capacity_per_inner: 250,
          capacity_unit: "ml",
          total_inner: 1,
          total_capacity: 250,
          formula: "1*1*250=250",
        },
        location: {
          value: "home",
          evidence_kind: "configured_home_default",
          rule_version: "diet-manager/home-default/v1",
        },
        opening: null,
        expiration: expirationAt === null
          ? { explicit_at: null, effective_at: null, basis: "unknown", rule_version: null }
          : { explicit_at: expirationAt, effective_at: expirationAt, basis: "explicit", rule_version: null },
      },
    }],
  };
}

function mealEnvelope(options: Readonly<{
  suffix?: string;
  requestedMicrounits?: number | null;
  location?: "home" | "outside";
  unit?: string;
  explicitInventorySkip?: boolean;
}> = {}): DomainEnvelopeInput {
  const suffix = options.suffix ?? "001";
  const requested = options.requestedMicrounits === undefined ? 2_000_000 : options.requestedMicrounits;
  return {
    envelope_id: `envelope-pantry-allocation-meal-${suffix}`,
    idempotency_key: `idem-pantry-allocation-meal-${suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-pantry-allocation-meal-${suffix}`,
    conversation_id: "conversation-pantry-allocation",
    received_at: "2026-08-14T09:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "record_meal",
      operation_id: `operation-pantry-allocation-meal-${suffix}`,
      occurred_at: "2026-08-14T09:00:00.000Z",
      meal_slot: "breakfast",
      location: options.location ?? "home",
      items: [{
        normalized_name: "milk",
        item_type: "nutrition_drink",
        ...(options.explicitInventorySkip
          ? {
              inventory_directive: {
                mode: "skip",
                evidence_kind: "explicit",
                matched_span: "只记录别扣库存",
                rule_version: "diet-manager/inventory-directive/v1",
              },
            }
          : {}),
        amount: {
          unit: options.unit ?? "carton",
          observed_microunits: requested,
          nutrition_adoption_microunits: requested,
          inventory_deduction_microunits: requested,
          template_reference_microunits: null,
          evidence: requested === null ? "unknown" : "explicit",
        },
        nutrition_sources: [],
      }],
    }],
  } as unknown as DomainEnvelopeInput;
}

function candidate(options: {
  batch: string;
  product?: string;
  fingerprint?: string;
  available: number;
  unit?: string;
  expiration?: string | null;
  stocked?: string;
  status?: "available" | "expired" | "unavailable";
}) {
  return {
    product_id: options.product ?? "product-milk-whole-250",
    product_identity_fingerprint: options.fingerprint ?? "A".repeat(64),
    batch_id: options.batch,
    available_microunits: options.available,
    unit: options.unit ?? "carton",
    effective_expiration_at: options.expiration ?? null,
    stocked_at: options.stocked ?? "2026-08-10T08:30:00+08:00",
    effective_status: options.status ?? "available",
  } as const;
}

function input(overrides: Partial<InventoryAllocationInput> = {}): InventoryAllocationInput {
  return {
    location: "home",
    explicit_skip: false,
    requested_microunits: 1_000_000,
    unit: "carton",
    specified_batch_id: null,
    candidates: [candidate({ batch: "batch-milk-001", available: 6_000_000 })],
    ...overrides,
  };
}

describe("SEL-PANTRY-001 FEFO/FIFO inventory allocation", () => {
  it("commits one meal and atomically allocates two cartons across FEFO then FIFO batches", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T09:00:01.000Z",
      });
      expect(executeEnvelope(service, purchaseEnvelope(
        "fefo",
        "fixture-batch-milk-fefo-001",
        "2026-08-14T08:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
      )).status).toBe("committed");
      expect(executeEnvelope(service, purchaseEnvelope(
        "fifo",
        "fixture-batch-milk-fifo-001",
        "2026-08-14T08:10:00.000Z",
        null,
      )).status).toBe("committed");

      const result = executeEnvelope(service, mealEnvelope());
      expect(result).toMatchObject({
        status: "committed",
        items: [{
          inventory_match: "matched",
          meal_items: [{ inventory_match: "matched" }],
        }],
      });
      expect(runtime.database.prepare(
        `SELECT batch_id, payload_json FROM inventory_transactions
         WHERE direction = 'out' ORDER BY rowid`,
      ).all()).toMatchObject([
        { batch_id: "fixture-batch-milk-fefo-001" },
        { batch_id: "fixture-batch-milk-fifo-001" },
      ]);
      expect(runtime.database.prepare(
        "SELECT batch_id, quantity_status FROM inventory_batch_projections ORDER BY batch_id",
      ).all()).toEqual([
        { batch_id: "fixture-batch-milk-fefo-001", quantity_status: "empty" },
        { batch_id: "fixture-batch-milk-fifo-001", quantity_status: "empty" },
      ]);
      expect(executeEnvelope(service, mealEnvelope())).toEqual(result);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 2 });
    } finally {
      runtime.close();
    }
  });

  it("rejects a schema-valid stored allocation-plan mutation on retry and query without more writes", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "tamper-fefo", "fixture-batch-milk-tamper-fefo", "2026-08-14T08:00:00.000Z", "2026-08-20T00:00:00.000Z",
      ));
      executeEnvelope(service, purchaseEnvelope(
        "tamper-fifo", "fixture-batch-milk-tamper-fifo", "2026-08-14T08:10:00.000Z", null,
      ));
      const envelope = mealEnvelope({ suffix: "tamper", requestedMicrounits: 2_000_000 });
      const preview = service.preview(envelope);
      expect(service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      }).status).toBe("committed");
      const stored = runtime.database.prepare(
        "SELECT item_id, payload_json FROM meal_items WHERE normalized_name = 'milk' ORDER BY rowid DESC LIMIT 1",
      ).get() as { item_id: string; payload_json: string };
      const payload = JSON.parse(stored.payload_json) as {
        inventory_plan: { allocations: Array<{ selection_basis: string }> };
      };
      payload.inventory_plan.allocations[0]!.selection_basis = "fifo";
      runtime.database.prepare("UPDATE meal_items SET payload_json = ? WHERE item_id = ?").run(
        canonicalJson(payload),
        stored.item_id,
      );
      const before = canonicalJson({
        transactions: runtime.database.prepare(
          "SELECT * FROM inventory_transactions ORDER BY transaction_id",
        ).all(),
        projections: runtime.database.prepare(
          "SELECT * FROM inventory_batch_projections ORDER BY batch_id",
        ).all(),
        issues: runtime.database.prepare("SELECT * FROM issues ORDER BY issue_id").all(),
        finalizations: runtime.database.prepare(
          "SELECT * FROM envelope_finalizations ORDER BY envelope_id",
        ).all(),
      });

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrowError("PREVIEW_AUTHORITY_INVALID:meal_fact_identity");
      expect(() => service.query({
        kind: "query_meals",
        operation_id: "query-pantry-plan-tamper",
        date: "2026-08-14",
        timezone: "Asia/Shanghai",
      })).toThrowError(/INVENTORY_PROJECTION_INVALID:meal_/);
      expect(canonicalJson({
        transactions: runtime.database.prepare(
          "SELECT * FROM inventory_transactions ORDER BY transaction_id",
        ).all(),
        projections: runtime.database.prepare(
          "SELECT * FROM inventory_batch_projections ORDER BY batch_id",
        ).all(),
        issues: runtime.database.prepare("SELECT * FROM issues ORDER BY issue_id").all(),
        finalizations: runtime.database.prepare(
          "SELECT * FROM envelope_finalizations ORDER BY envelope_id",
        ).all(),
      })).toBe(before);
    } finally {
      runtime.close();
    }
  });

  it("commits the meal fact but skips two distinct product identities with one stable issue", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "identity-a", "fixture-batch-milk-identity-a", "2026-08-14T08:00:00.000Z", null,
        { productId: "fixture-product-milk-identity-a", brand: "brand-a" },
      ));
      executeEnvelope(service, purchaseEnvelope(
        "identity-b", "fixture-batch-milk-identity-b", "2026-08-14T08:10:00.000Z", null,
        { productId: "fixture-product-milk-identity-b", brand: "brand-b" },
      ));
      const result = executeEnvelope(service, mealEnvelope({ suffix: "ambiguous", requestedMicrounits: 1_000_000 }));
      expect(result).toMatchObject({
        status: "committed_with_issues",
        items: [{
          inventory_match: "skipped_ambiguous",
          issue_codes: ["inventory_multiple_candidates"],
        }],
      });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });
      expect(runtime.database.prepare(
        "SELECT issue_code, status FROM issues ORDER BY issue_id",
      ).all()).toEqual([{ issue_code: "inventory_multiple_candidates", status: "open" }]);
    } finally {
      runtime.close();
    }
  });

  it("uses all-or-none persistence when Pantry stock is insufficient", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "insufficient", "fixture-batch-milk-insufficient", "2026-08-14T08:00:00.000Z", null,
        { quantityMicrounits: 500_000 },
      ));
      const before = runtime.database.prepare(
        "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get("fixture-batch-milk-insufficient");
      const result = executeEnvelope(service, mealEnvelope({ suffix: "insufficient", requestedMicrounits: 1_000_000 }));
      expect(result).toMatchObject({
        status: "committed_with_issues",
        items: [{ inventory_match: "skipped_insufficient", issue_codes: ["inventory_insufficient"] }],
      });
      expect(runtime.database.prepare(
        "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get("fixture-batch-milk-insufficient")).toEqual(before);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });

  it("keeps nutrition grams isolated from carton inventory when conversion is unproven", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "unit", "fixture-batch-milk-unit", "2026-08-14T08:00:00.000Z", null,
      ));
      const before = runtime.database.prepare(
        "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get("fixture-batch-milk-unit");
      expect(executeEnvelope(service, mealEnvelope({
        suffix: "unit",
        requestedMicrounits: 100_000_000,
        unit: "g",
      }))).toMatchObject({
        status: "committed_with_issues",
        items: [{
          inventory_match: "skipped_unit_incompatible",
          issue_codes: ["inventory_unit_conversion_unproven"],
        }],
      });
      expect(runtime.database.prepare(
        "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get("fixture-batch-milk-unit")).toEqual(before);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });

  it("excludes an expired Pantry batch and deducts only the fresh batch", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "expired", "fixture-batch-milk-expired", "2026-08-14T08:00:00.000Z", "2026-08-13T00:00:00.000Z",
      ));
      executeEnvelope(service, purchaseEnvelope(
        "fresh", "fixture-batch-milk-fresh-001", "2026-08-14T08:10:00.000Z", "2026-08-20T00:00:00.000Z",
      ));
      expect(executeEnvelope(service, mealEnvelope({ suffix: "fresh", requestedMicrounits: 1_000_000 }))).toMatchObject({
        status: "committed",
        items: [{ inventory_match: "matched" }],
      });
      expect(runtime.database.prepare(
        "SELECT batch_id FROM inventory_transactions WHERE direction = 'out' ORDER BY rowid",
      ).all()).toEqual([{ batch_id: "fixture-batch-milk-fresh-001" }]);
      expect(runtime.database.prepare(
        "SELECT batch_id, quantity_status FROM inventory_batch_projections ORDER BY batch_id",
      ).all()).toEqual([
        { batch_id: "fixture-batch-milk-expired", quantity_status: "available" },
        { batch_id: "fixture-batch-milk-fresh-001", quantity_status: "empty" },
      ]);
    } finally {
      runtime.close();
    }
  });

  it("evaluates expiration at the meal occurrence time instead of the later commit time", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const purchaseService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T09:00:01.000Z",
      });
      executeEnvelope(purchaseService, purchaseEnvelope(
        "historical", "fixture-batch-milk-historical", "2026-08-14T08:00:00.000Z", "2026-08-15T00:00:00.000Z",
      ));
      const laterCommitService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-16T09:00:01.000Z",
      });
      expect(executeEnvelope(laterCommitService, mealEnvelope({
        suffix: "historical",
        requestedMicrounits: 1_000_000,
      }))).toMatchObject({
        status: "committed",
        items: [{ inventory_match: "matched" }],
      });
      expect(runtime.database.prepare(
        "SELECT batch_id FROM inventory_transactions WHERE direction = 'out'",
      ).all()).toEqual([{ batch_id: "fixture-batch-milk-historical" }]);
    } finally {
      runtime.close();
    }
  });

  it("does not read a malformed Pantry projection for outside or amount-unknown skips", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "zero-read", "fixture-batch-milk-zero-read", "2026-08-14T08:00:00.000Z", null,
      ));
      runtime.database.prepare(
        "UPDATE inventory_batch_projections SET payload_json = ? WHERE batch_id = ?",
      ).run('{"malformed":true}', "fixture-batch-milk-zero-read");

      expect(executeEnvelope(service, mealEnvelope({
        suffix: "outside-zero-read",
        requestedMicrounits: 1_000_000,
        location: "outside",
      }))).toMatchObject({
        status: "committed",
        items: [{ inventory_match: "skipped_outside", issue_codes: [] }],
      });
      expect(executeEnvelope(service, mealEnvelope({
        suffix: "unknown-zero-read",
        requestedMicrounits: null,
      }))).toMatchObject({
        status: "committed_with_issues",
        items: [{ inventory_match: "skipped_amount_unknown", issue_codes: ["inventory_amount_unknown"] }],
      });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });

  it("persists an explicit inventory skip and never reads a malformed Pantry projection", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const service = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(service, purchaseEnvelope(
        "explicit-skip", "fixture-batch-milk-explicit-skip", "2026-08-14T08:00:00.000Z", null,
      ));
      runtime.database.prepare(
        "UPDATE inventory_batch_projections SET payload_json = ? WHERE batch_id = ?",
      ).run('{"malformed":true}', "fixture-batch-milk-explicit-skip");

      const envelope = mealEnvelope({
        suffix: "explicit-skip",
        requestedMicrounits: 1_000_000,
        explicitInventorySkip: true,
      });
      const result = executeEnvelope(service, envelope);
      expect(result).toMatchObject({
        status: "committed",
        items: [{ inventory_match: "skipped_by_user", issue_codes: [] }],
      });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });
      const item = runtime.database.prepare(
        "SELECT payload_json FROM meal_items WHERE normalized_name = 'milk' ORDER BY rowid DESC LIMIT 1",
      ).get() as { payload_json: string };
      expect(JSON.parse(item.payload_json)).toMatchObject({
        inventory_directive: {
          mode: "skip",
          evidence_kind: "explicit",
          matched_span: "只记录别扣库存",
          rule_version: "diet-manager/inventory-directive/v1",
        },
        inventory_plan: {
          status: "skipped_by_user",
          read_required: false,
          allocations: [],
          issue_code: null,
        },
      });
      expect(executeEnvelope(service, envelope)).toEqual(result);
    } finally {
      runtime.close();
    }
  });

  it("rolls back every staged allocation and transaction before retrying the exact plan", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const healthy = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      executeEnvelope(healthy, purchaseEnvelope(
        "fault-fefo", "fixture-batch-milk-fault-fefo", "2026-08-14T08:00:00.000Z", "2026-08-20T00:00:00.000Z",
      ));
      executeEnvelope(healthy, purchaseEnvelope(
        "fault-fifo", "fixture-batch-milk-fault-fifo", "2026-08-14T08:10:00.000Z", null,
      ));
      const envelope = mealEnvelope({ suffix: "fault", requestedMicrounits: 2_000_000 });
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T09:00:01.000Z",
        fault: "after_meal_first_inventory_allocation",
      });
      const preview = failing.preview(envelope);
      const before = runtime.database.prepare(
        "SELECT batch_id, payload_json FROM inventory_batch_projections ORDER BY batch_id",
      ).all();
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_FAILED:after_first_inventory_allocation");
      expect(runtime.database.prepare(
        "SELECT batch_id, payload_json FROM inventory_batch_projections ORDER BY batch_id",
      ).all()).toEqual(before);
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 0 });

      expect(healthy.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toMatchObject({ status: "committed", items: [{ inventory_match: "matched" }] });
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 2 });
    } finally {
      runtime.close();
    }
  });

  it("lets at most one stale-preview service consume the same two-batch stock", () => {
    const runtime = openDietDatabase({ privateRuntimeRoot: newTestRoot() });
    try {
      const serviceA = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:01.000Z" });
      const serviceB = createDietDomainService({ database: runtime.database, secret, now: () => "2026-08-14T09:00:02.000Z" });
      executeEnvelope(serviceA, purchaseEnvelope(
        "race-fefo", "fixture-batch-milk-race-fefo", "2026-08-14T08:00:00.000Z", "2026-08-20T00:00:00.000Z",
      ));
      executeEnvelope(serviceA, purchaseEnvelope(
        "race-fifo", "fixture-batch-milk-race-fifo", "2026-08-14T08:10:00.000Z", null,
      ));
      const envelopeA = mealEnvelope({ suffix: "race-a", requestedMicrounits: 2_000_000 });
      const envelopeB = mealEnvelope({ suffix: "race-b", requestedMicrounits: 2_000_000 });
      const previewA = serviceA.preview(envelopeA);
      const previewB = serviceB.preview(envelopeB);
      expect(serviceA.execute({
        envelope: envelopeA,
        token: previewA.token,
        input_digest: previewA.input_digest,
        data_revision: previewA.data_revision,
      })).toMatchObject({ status: "committed" });
      expect(() => serviceB.execute({
        envelope: envelopeB,
        token: previewB.token,
        input_digest: previewB.input_digest,
        data_revision: previewB.data_revision,
      })).toThrow();
      expect(runtime.database.prepare(
        "SELECT COUNT(*) AS count FROM inventory_transactions WHERE direction = 'out'",
      ).get()).toEqual({ count: 2 });
      expect(runtime.database.prepare(
        "SELECT MIN(CAST(json_extract(payload_json, '$.quantity_microunits') AS INTEGER)) AS minimum FROM inventory_batch_projections",
      ).get()).toEqual({ minimum: 0 });
    } finally {
      runtime.close();
    }
  });

  it("short-circuits outside, explicit-skip and unknown-amount paths without reading candidates", () => {
    let traps = 0;
    const candidates = new Proxy([], {
      get() { traps += 1; throw new Error("candidate access"); },
      getOwnPropertyDescriptor() { traps += 1; throw new Error("candidate descriptor"); },
      ownKeys() { traps += 1; throw new Error("candidate keys"); },
    });
    expect(resolveInventoryAllocation(input({ location: "outside", candidates }))).toEqual({
      status: "skipped_outside",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: null,
      read_required: false,
    });
    expect(resolveInventoryAllocation(input({ explicit_skip: true, candidates }))).toEqual({
      status: "skipped_by_user",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: null,
      read_required: false,
    });
    expect(resolveInventoryAllocation(input({ requested_microunits: null, candidates }))).toEqual({
      status: "skipped_amount_unknown",
      requested_microunits: null,
      unit: "carton",
      allocations: [],
      candidate_count: 0,
      issue_code: "inventory_amount_unknown",
      read_required: false,
    });
    expect(traps).toBe(0);
  });

  it("allocates one sufficient exact batch", () => {
    expect(resolveInventoryAllocation(input())).toEqual({
      status: "matched",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [{
        product_id: "product-milk-whole-250",
        batch_id: "batch-milk-001",
        before_microunits: 6_000_000,
        deducted_microunits: 1_000_000,
        after_microunits: 5_000_000,
        unit: "carton",
        selection_basis: "fifo",
      }],
      candidate_count: 1,
      issue_code: null,
      read_required: true,
    });
  });

  it("allocates across same-product batches in FEFO then FIFO order", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [
        candidate({ batch: "batch-later", available: 1_000_000, expiration: "2026-08-13T08:30:00+08:00", stocked: "2026-08-09T08:30:00+08:00" }),
        candidate({ batch: "batch-first", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00", stocked: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-no-expiry", available: 1_000_000, expiration: null, stocked: "2026-08-08T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      candidate_count: 3,
      allocations: [
        { batch_id: "batch-first", deducted_microunits: 1_000_000, selection_basis: "fefo" },
        { batch_id: "batch-later", deducted_microunits: 1_000_000, selection_basis: "fefo" },
      ],
    });
  });

  it("uses stocked time then ordinal batch ID as the stable FIFO tie-break", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [
        candidate({ batch: "batch-z", available: 1_000_000, stocked: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-b", available: 1_000_000, stocked: "2026-08-09T08:30:00+08:00" }),
        candidate({ batch: "batch-a", available: 1_000_000, stocked: "2026-08-09T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      allocations: [
        { batch_id: "batch-a", selection_basis: "fifo" },
        { batch_id: "batch-b", selection_basis: "fifo" },
      ],
    });
  });

  it("prioritizes an explicit compatible batch before FEFO", () => {
    expect(resolveInventoryAllocation(input({
      specified_batch_id: "batch-specified",
      candidates: [
        candidate({ batch: "batch-fefo", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00" }),
        candidate({ batch: "batch-specified", available: 1_000_000, expiration: "2026-08-20T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      allocations: [{ batch_id: "batch-specified", selection_basis: "explicit_batch" }],
    });
  });

  it("excludes expired batches and leaves them unchanged", () => {
    expect(resolveInventoryAllocation(input({
      candidates: [
        candidate({ batch: "batch-expired", available: 2_000_000, status: "expired", expiration: "2026-08-10T08:30:00+08:00" }),
        candidate({ batch: "batch-fresh", available: 1_000_000, expiration: "2026-08-12T08:30:00+08:00" }),
      ],
    }))).toMatchObject({
      status: "matched",
      candidate_count: 1,
      allocations: [{ batch_id: "batch-fresh", before_microunits: 1_000_000, after_microunits: 0 }],
    });
  });

  it("rejects multiple exact product identities without allocating", () => {
    expect(resolveInventoryAllocation(input({
      candidates: [
        candidate({ batch: "batch-whole", available: 2_000_000, fingerprint: "A".repeat(64) }),
        candidate({ batch: "batch-lowfat", available: 2_000_000, product: "product-milk-lowfat", fingerprint: "B".repeat(64) }),
      ],
    }))).toEqual({
      status: "skipped_ambiguous",
      requested_microunits: 1_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 2,
      issue_code: "inventory_multiple_candidates",
      read_required: true,
    });
  });

  it("rejects unit-incompatible stock without converting nutrition amounts", () => {
    expect(resolveInventoryAllocation(input({
      unit: "g",
      requested_microunits: 100_000_000,
      candidates: [candidate({ batch: "batch-rice", product: "product-rice", available: 1_000_000, unit: "bag" })],
    }))).toEqual({
      status: "skipped_unit_incompatible",
      requested_microunits: 100_000_000,
      unit: "g",
      allocations: [],
      candidate_count: 1,
      issue_code: "inventory_unit_conversion_unproven",
      read_required: true,
    });
  });

  it("uses all-or-none semantics when total stock is insufficient", () => {
    expect(resolveInventoryAllocation(input({
      requested_microunits: 2_000_000,
      candidates: [candidate({ batch: "batch-half", available: 500_000 })],
    }))).toEqual({
      status: "skipped_insufficient",
      requested_microunits: 2_000_000,
      unit: "carton",
      allocations: [],
      candidate_count: 1,
      issue_code: "inventory_insufficient",
      read_required: true,
    });
  });

  it("keeps the legacy single-match decision object exact", () => {
    expect(resolveInventoryMatch({
      location: "home",
      requested_unit: "carton",
      observed_microunits: 1_000_000,
      nutrition_adoption_microunits: 1_000_000,
      inventory_deduction_microunits: 1_000_000,
      template_reference_microunits: null,
      candidates: [{
        batch_id: "legacy-batch",
        product_id: "legacy-product",
        available_microunits: 2_000_000,
        unit: "carton",
      }],
    })).toEqual({
      status: "matched",
      batch_id: "legacy-batch",
      product_id: "legacy-product",
      deduction_microunits: 1_000_000,
      unit: "carton",
      issue_code: null,
    });
  });

  it("rejects unsafe candidate quantities instead of wrapping or going negative", () => {
    expect(() => resolveInventoryAllocation(input({
      candidates: [candidate({ batch: "unsafe", available: Number.MAX_SAFE_INTEGER + 1 })],
    }))).toThrow(PantryEvidenceAuthorityError);
  });
});
