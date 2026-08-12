import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDietDomainService,
  type DietDomainFailureEntry,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  QueryInventoryOperation,
} from "../src/domain/types.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-SLICE-001 purchase test secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-b-slice-${randomUUID().replaceAll("-", "")}`);
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

function purchaseMilkEnvelope(
  options: {
    suffix?: string;
    batchId?: string;
    profileVersion?: number;
    sourceRef?: string;
  } = {},
): DomainEnvelopeInput {
  const suffix = options.suffix ?? "001";
  return {
    envelope_id: `envelope-purchase-milk-${suffix}`,
    idempotency_key: `idem-purchase-milk-${suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-purchase-milk-${suffix}`,
    conversation_id: "conversation-purchase-milk-001",
    received_at: "2026-08-12T01:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "add_inventory",
        operation_id: `operation-purchase-milk-${suffix}`,
        product: {
          product_id: "fixture-product-milk-whole-250",
          normalized_name: "whole milk 250ml",
          product_type: "nutrition_drink",
        },
        batch_id: options.batchId ?? `batch-purchase-milk-${suffix}`,
        amount: {
          unit: "carton",
          observed_microunits: 24_000_000,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: 12_000_000,
          evidence: "explicit",
        },
        nutrition_sources: [
          {
            source_type: "product_label",
            source_ref: options.sourceRef ?? "label-whole-milk-250-v1",
            profile_version: options.profileVersion ?? 1,
            applicable_product_id: "fixture-product-milk-whole-250",
            nutrients: {
              energy_kcal_milli: 160_000,
              protein_mg: 8_000,
              fat_mg: 9_000,
              carbohydrate_mg: 12_000,
              fiber_mg: null,
              water_ml_milli: null,
            },
          },
        ],
      },
    ],
  };
}

function queryInventory(): QueryInventoryOperation {
  return { kind: "query_inventory", operation_id: "query-inventory-001" };
}

function tableCounts(database: DatabaseSync): Record<string, number> {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables.map(({ name }) => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as {
        count: number;
      };
      return [name, row.count];
    }),
  );
}

function businessCounts(database: DatabaseSync): Record<string, number> {
  const control = new Set(["schema_migrations", "command_envelopes", "idempotency_records"]);
  return Object.fromEntries(
    Object.entries(tableCounts(database)).filter(([name]) => !control.has(name)),
  );
}

function previewAndExecute(service: DietDomainService, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  return service.execute({
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

describe("B-SLICE-001 purchase and inventory vertical slice", () => {
  it("adds two boxes of 12 milk cartons and queries one 24-carton batch", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({
      privateRuntimeRoot: root,
      now: () => "2026-08-12T01:00:00.000Z",
    });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      const result = previewAndExecute(service, purchaseMilkEnvelope());

      expect(result.status).toBe("committed");
      expect(result.items).toEqual([
        expect.objectContaining({
          sequence: 0,
          operation_id: "operation-purchase-milk-001",
          status: "committed",
          batch_id: "batch-purchase-milk-001",
          product_id: "fixture-product-milk-whole-250",
          inventory_quantity_microunits: 24_000_000,
          unit: "carton",
        }),
      ]);

      const beforeQuery = tableCounts(runtime.database);
      expect(service.query(queryInventory())).toEqual({
        kind: "inventory",
        batches: [
          expect.objectContaining({
            batch_id: "batch-purchase-milk-001",
            product_id: "fixture-product-milk-whole-250",
            normalized_name: "whole milk 250ml",
            quantity_microunits: 24_000_000,
            unit: "carton",
          }),
        ],
      });
      expect(tableCounts(runtime.database)).toEqual(beforeQuery);

      expect(
        runtime.database
          .prepare(
            `SELECT subject_type, subject_id, profile_version, source_type, source_ref,
                    coverage_status
             FROM nutrition_profiles`,
          )
          .all(),
      ).toEqual([
        {
          subject_type: "product",
          subject_id: "fixture-product-milk-whole-250",
          profile_version: "1",
          source_type: "product_label",
          source_ref: "label-whole-milk-250-v1",
          coverage_status: "partial",
        },
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("replays one frozen purchase without creating any new row", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      const envelope = purchaseMilkEnvelope();
      const preview = service.preview(envelope);
      const executeInput = {
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      } as const;
      const first = service.execute(executeInput);
      const beforeReplay = tableCounts(runtime.database);

      expect(service.execute(executeInput)).toEqual(first);
      expect(tableCounts(runtime.database)).toEqual(beforeReplay);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("keeps one stable product while adding a second batch with label profile v2", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });
      previewAndExecute(service, purchaseMilkEnvelope());
      previewAndExecute(
        service,
        purchaseMilkEnvelope({
          suffix: "002",
          batchId: "batch-purchase-milk-002",
          profileVersion: 2,
          sourceRef: "label-whole-milk-250-v2",
        }),
      );

      expect(
        runtime.database.prepare("SELECT COUNT(*) AS count FROM products").get(),
      ).toEqual({ count: 1 });
      expect(
        runtime.database
          .prepare(
            `SELECT profile_version, source_ref FROM nutrition_profiles
             ORDER BY CAST(profile_version AS INTEGER)`,
          )
          .all(),
      ).toEqual([
        { profile_version: "1", source_ref: "label-whole-milk-250-v1" },
        { profile_version: "2", source_ref: "label-whole-milk-250-v2" },
      ]);
      expect(service.query(queryInventory()).batches.map((batch) => batch.batch_id)).toEqual([
        "batch-purchase-milk-001",
        "batch-purchase-milk-002",
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("adds a new batch and label profile without rewriting one legacy product payload", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const legacyPayload = '{"authority":"legacy-fixture","synthetic":true}';
      runtime.database
        .prepare(
          `INSERT INTO products(
            product_id, schema_version, normalized_name, product_type,
            brand, manufacturer, barcode, sku, payload_json
          ) VALUES (?, 'domain/v2', ?, ?, NULL, NULL, NULL, NULL, ?)`,
        )
        .run(
          "fixture-product-milk-whole-250",
          "whole milk 250ml",
          "nutrition_drink",
          legacyPayload,
        );
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
      });

      expect(previewAndExecute(service, purchaseMilkEnvelope()).status).toBe("committed");
      expect(
        runtime.database
          .prepare("SELECT payload_json FROM products WHERE product_id = ?")
          .get("fixture-product-milk-whole-250"),
      ).toEqual({ payload_json: legacyPayload });
      expect(
        runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_profiles").get(),
      ).toEqual({ count: 1 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("logs one redacted technical failure and leaves every business table empty", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: DietDomainFailureEntry[] = [];
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
        fault: "before_fact_commit",
        failureSink: (entry) => failures.push(entry),
      });
      const envelope = purchaseMilkEnvelope();
      const preview = service.preview(envelope);

      expect(() =>
        service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        }),
      ).toThrow("DIET_DOMAIN_EXECUTION_FAILED:before_fact_commit");
      expect(Object.values(businessCounts(runtime.database)).every((count) => count === 0)).toBe(
        true,
      );
      expect(failures).toEqual([
        {
          stage: "FactCommit",
          error_code: "DIET_DOMAIN_EXECUTION_FAILED",
          trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
          input_digest: preview.input_digest,
        },
      ]);
      const serialized = JSON.stringify(failures);
      expect(serialized).not.toContain("milk");
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain(secret.toString("utf8"));
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back the label profile and every inventory row on an EffectBundle failure", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: DietDomainFailureEntry[] = [];
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T01:00:01.000Z",
        fault: "after_inventory_business_writes",
        failureSink: (entry) => failures.push(entry),
      });
      const envelope = purchaseMilkEnvelope();
      const preview = service.preview(envelope);

      expect(() =>
        service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        }),
      ).toThrow("INVENTORY_EFFECT_FAILED:after_business_writes");
      for (const table of [
        "products",
        "nutrition_profiles",
        "inventory_batches",
        "inventory_transactions",
        "inventory_batch_projections",
      ]) {
        expect(runtime.database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()).toEqual({
          count: 0,
        });
      }
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({
        count: 1,
      });
      expect(
        runtime.database
          .prepare("SELECT state, attempt_count FROM effect_outbox")
          .get(),
      ).toEqual({ state: "pending", attempt_count: 0 });
      expect(failures).toEqual([
        {
          stage: "EffectBundle",
          error_code: "INVENTORY_EFFECT_FAILED",
          trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
          input_digest: preview.input_digest,
        },
      ]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});
