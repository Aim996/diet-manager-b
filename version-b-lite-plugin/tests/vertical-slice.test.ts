import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/authority/canonical-json.js";
import { applyMealEffects, prepareMealOperation } from "../src/domain/effect-bundle.js";
import { deriveDomainId } from "../src/domain/identity.js";
import {
  createDietDomainService,
  type DietDomainFailureEntry,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
  QueryInventoryOperation,
} from "../src/domain/types.js";
import { finalizeEnvelope } from "../src/repository/envelope-finalize.js";
import {
  appendPreparedOperationFact,
  sealPreparedEnvelopeFacts,
} from "../src/repository/fact-commit.js";
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
            basis_kind: "per_package",
            basis_microunits: 1_000_000,
            basis_unit: "carton",
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

function nutritionSource(
  sourceType: "product_label" | "public_fixture",
  sourceRef: string,
  profileVersion: number,
  productId: string | null,
  basis: {
    kind: NutritionSourceCandidate["basis_kind"];
    microunits: number;
    unit: string;
  },
) : NutritionSourceCandidate {
  return {
    source_type: sourceType,
    source_ref: sourceRef,
    profile_version: profileVersion,
    applicable_product_id: productId,
    basis_kind: basis.kind,
    basis_microunits: basis.microunits,
    basis_unit: basis.unit,
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: null,
      water_ml_milli: null,
    },
  };
}

function purchaseStockEnvelope(options: {
  suffix: string;
  productId: string;
  normalizedName: string;
  batchId: string;
  quantityMicrounits: number;
  unit: string;
  nutritionBasis?: {
    kind: NutritionSourceCandidate["basis_kind"];
    microunits: number;
    unit: string;
  };
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-stock-${options.suffix}`,
    idempotency_key: `idem-stock-${options.suffix}`,
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: `message-stock-${options.suffix}`,
    conversation_id: "conversation-meal-matrix",
    received_at: "2026-08-12T02:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "add_inventory",
        operation_id: `operation-stock-${options.suffix}`,
        product: {
          product_id: options.productId,
          normalized_name: options.normalizedName,
          product_type: "food",
        },
        batch_id: options.batchId,
        amount: {
          unit: options.unit,
          observed_microunits: options.quantityMicrounits,
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          template_reference_microunits: null,
          evidence: "explicit",
        },
        nutrition_sources: [
          nutritionSource(
            "product_label",
            `label-${options.productId}-v1`,
            1,
            options.productId,
            options.nutritionBasis ?? (options.unit === "g"
              ? { kind: "per_100g", microunits: 100_000_000, unit: "g" }
              : { kind: "per_item", microunits: 1_000_000, unit: options.unit }),
          ),
        ],
      },
    ],
  };
}

function mealItem(options: {
  name: string;
  unit: string;
  observed: number;
  adopted: number | null;
  deducted: number | null;
  evidence?: "explicit" | "estimated_upper_bound";
  sources: readonly NutritionSourceCandidate[];
}): MealItemInput {
  return {
    normalized_name: options.name,
    item_type: "food",
    amount: {
      unit: options.unit,
      observed_microunits: options.observed,
      nutrition_adoption_microunits: options.adopted,
      inventory_deduction_microunits: options.deducted,
      template_reference_microunits: null,
      evidence: options.evidence ?? "explicit",
    },
    nutrition_sources: options.sources,
  };
}

function mealEnvelope(options: {
  suffix: string;
  location: "home" | "outside";
  items: readonly MealItemInput[];
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-meal-${options.suffix}`,
    idempotency_key: `idem-meal-${options.suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-meal-${options.suffix}`,
    conversation_id: "conversation-meal-matrix",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "record_meal",
        operation_id: `operation-meal-${options.suffix}`,
        occurred_at: "2026-08-12T12:00:00.000Z",
        meal_slot: "lunch",
        location: options.location,
        items: options.items,
      },
    ],
  };
}

function seedPurchase(service: DietDomainService, envelope: DomainEnvelopeInput): void {
  expect(previewAndExecute(service, envelope).status).toBe("committed");
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

describe("B-SLICE-001 meal, nutrition, inventory and progress matrix", () => {
  function createMealService() {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    return { root, runtime, service };
  }

  it("CASE-MEAL-006 records explicit rice and chicken without estimated flags", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "rice-grams",
        productId: "product-rice-grams",
        normalizedName: "rice",
        batchId: "batch-rice-grams",
        quantityMicrounits: 1_000_000_000,
        unit: "g",
      }));
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "chicken-grams",
        productId: "product-chicken-grams",
        normalizedName: "chicken",
        batchId: "batch-chicken-grams",
        quantityMicrounits: 1_000_000_000,
        unit: "g",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "explicit-rice-chicken",
        location: "home",
        items: [
          mealItem({
            name: "rice", unit: "g", observed: 200_000_000,
            adopted: 200_000_000, deducted: 200_000_000,
            sources: [nutritionSource("product_label", "label-product-rice-grams-v1", 1, "product-rice-grams", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
          mealItem({
            name: "chicken", unit: "g", observed: 150_000_000,
            adopted: 150_000_000, deducted: 150_000_000,
            sources: [nutritionSource("product_label", "label-product-chicken-grams-v1", 1, "product-chicken-grams", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
        ],
      }));
      expect(result.items[0]).toMatchObject({
        fact_status: "committed",
        issue_codes: [],
        meal_items: [
          { normalized_name: "rice", inventory_match: "matched", estimated_fields: [] },
          { normalized_name: "chicken", inventory_match: "matched", estimated_fields: [] },
        ],
      });
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-meals-explicit",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [{ items: [{ normalized_name: "rice" }, { normalized_name: "chicken" }] }] });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-008 marks only the orange edible-weight adoption as estimated", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "orange", productId: "product-orange", normalizedName: "orange",
        batchId: "batch-orange", quantityMicrounits: 5_000_000, unit: "piece",
        nutritionBasis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "orange-estimate", location: "home",
        items: [mealItem({
          name: "orange", unit: "piece", observed: 1_000_000,
          adopted: 130_000_000, deducted: 1_000_000,
          evidence: "estimated_upper_bound",
          sources: [nutritionSource("product_label", "label-product-orange-v1", 1, "product-orange", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          inventory_match: "matched",
          estimated_fields: ["nutrition_adoption_microunits"],
          inventory_deduction_microunits: 1_000_000,
          nutrition_adoption_microunits: 130_000_000,
        }],
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-MEAL-003 uses 150g for nutrition but deducts only half a bowl", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "rice-bowls", productId: "product-rice-bowls", normalizedName: "rice bowl",
        batchId: "batch-rice-bowls", quantityMicrounits: 2_000_000, unit: "bowl",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "half-rice-bowl", location: "home",
        items: [mealItem({
          name: "rice bowl", unit: "bowl", observed: 500_000,
          adopted: 150_000_000, deducted: 500_000,
          evidence: "estimated_upper_bound",
          sources: [nutritionSource("public_fixture", "cn-rice-bowl-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          nutrition_adoption_microunits: 150_000_000,
          inventory_deduction_microunits: 500_000,
          nutrients: {
            energy_kcal_milli: 150_000,
            protein_mg: 7_500,
            fat_mg: 3_000,
            carbohydrate_mg: 18_000,
          },
        }],
      });
      const nutritionSnapshot = fixture.runtime.database.prepare(
        "SELECT payload_json FROM nutrition_snapshots",
      ).get() as { payload_json: string };
      expect(JSON.parse(nutritionSnapshot.payload_json)).toMatchObject({
        basis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
        conversion: {
          adopted_microunits: 150_000_000,
          formula: "round_half_up(nutrient*adopted_microunits/basis_microunits)",
        },
        nutrients: { energy_kcal_milli: 150_000 },
        source_nutrients: { energy_kcal_milli: 100_000 },
      });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(1_500_000);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("uses a legacy product profile for a new meal while freezing the current basis in its snapshot", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "legacy-profile", productId: "product-legacy-profile", normalizedName: "legacy rice",
        batchId: "batch-legacy-profile", quantityMicrounits: 500_000_000, unit: "g",
      }));
      const row = fixture.runtime.database.prepare(
        "SELECT nutrition_profile_id, payload_json FROM nutrition_profiles WHERE subject_id = ?",
      ).get("product-legacy-profile") as { nutrition_profile_id: string; payload_json: string };
      const legacy = JSON.parse(row.payload_json) as Record<string, unknown>;
      delete legacy.basis;
      fixture.runtime.database.prepare(
        "UPDATE nutrition_profiles SET payload_json = ? WHERE nutrition_profile_id = ?",
      ).run(JSON.stringify(legacy), row.nutrition_profile_id);

      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "legacy-profile-meal", location: "home",
        items: [mealItem({
          name: "legacy rice", unit: "g", observed: 150_000_000,
          adopted: 150_000_000, deducted: 150_000_000,
          sources: [nutritionSource("product_label", "label-product-legacy-profile-v1", 1, "product-legacy-profile", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
        })],
      }));
      expect(result.status).toBe("committed");
      const snapshot = fixture.runtime.database.prepare(
        "SELECT payload_json FROM nutrition_snapshots",
      ).get() as { payload_json: string };
      expect(JSON.parse(snapshot.payload_json)).toMatchObject({
        basis: { kind: "per_100g", microunits: 100_000_000, unit: "g" },
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-MEAL-004 records a company apple without reading or deducting home inventory", () => {
    const fixture = createMealService();
    try {
      const before = tableCounts(fixture.runtime.database);
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "company-apple", location: "outside",
        items: [mealItem({
          name: "apple", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-apple-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        inventory_match: "skipped_outside",
        inventory_transaction_id: null,
        issue_codes: [],
      });
      expect(fixture.service.query(queryInventory()).batches).toEqual([]);
      expect(tableCounts(fixture.runtime.database).inventory_transactions).toBe(before.inventory_transactions);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("preserves unknown nutrition and deduction amounts without inventing zero effects", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "unknown-pear", productId: "product-unknown-pear", normalizedName: "unknown pear",
        batchId: "batch-unknown-pear", quantityMicrounits: 2_000_000, unit: "piece",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "unknown-amounts", location: "home",
        items: [mealItem({
          name: "unknown pear", unit: "piece", observed: 1_000_000,
          adopted: null, deducted: null,
          sources: [{
            ...nutritionSource("product_label", "label-product-unknown-pear-v2", 2, "product-unknown-pear", { kind: "per_item", microunits: 1_000_000, unit: "piece" }),
            nutrients: {
              energy_kcal_milli: 100_000,
              protein_mg: 5_000,
              fat_mg: 2_000,
              carbohydrate_mg: 12_000,
              fiber_mg: 3_000,
              water_ml_milli: 80_000,
            },
          }],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        meal_items: [{
          inventory_match: "skipped_amount_unknown",
          inventory_transaction_id: null,
          issue_codes: ["inventory_amount_unknown"],
          nutrition_adoption_microunits: null,
          inventory_deduction_microunits: null,
          nutrients: {
            energy_kcal_milli: null,
            protein_mg: null,
            fat_mg: null,
            carbohydrate_mg: null,
            fiber_mg: null,
            water_ml_milli: null,
          },
        }],
      });
      expect((result.payload as { daily_progress: { nutrients: Record<string, unknown> } })
        .daily_progress.nutrients).toEqual({
        energy_kcal_milli: null,
        protein_mg: null,
        fat_mg: null,
        carbohydrate_mg: null,
        fiber_mg: null,
        water_ml_milli: null,
      });
      expect(fixture.runtime.database.prepare(
        "SELECT coverage_status FROM nutrition_snapshots",
      ).get()).toEqual({ coverage_status: "partial" });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(2_000_000);
      expect(fixture.runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 1 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-INVENTORY-003 commits the meal but opens an issue for two candidates", () => {
    const fixture = createMealService();
    try {
      for (const suffix of ["milk-a", "milk-b"]) {
        seedPurchase(fixture.service, purchaseStockEnvelope({
          suffix, productId: `product-${suffix}`, normalizedName: "milk",
          batchId: `batch-${suffix}`, quantityMicrounits: 6_000_000, unit: "carton",
        }));
      }
      const before = fixture.service.query(queryInventory()).batches.map((batch) => batch.quantity_microunits);
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "ambiguous-milk", location: "home",
        items: [mealItem({
          name: "milk", unit: "carton", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-milk-v1", 1, null, { kind: "per_package", microunits: 1_000_000, unit: "carton" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        fact_status: "committed",
        inventory_match: "skipped_ambiguous",
        inventory_transaction_id: null,
        issue_codes: ["inventory_multiple_candidates"],
      });
      expect(fixture.service.query(queryInventory()).batches.map((batch) => batch.quantity_microunits)).toEqual(before);
      expect(fixture.runtime.database.prepare("SELECT issue_code, status FROM issues").all()).toEqual([
        { issue_code: "inventory_multiple_candidates", status: "open" },
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-INVENTORY-004 commits insufficient eggs without a negative inventory row", () => {
    const fixture = createMealService();
    try {
      seedPurchase(fixture.service, purchaseStockEnvelope({
        suffix: "eggs", productId: "product-eggs", normalizedName: "eggs",
        batchId: "batch-eggs", quantityMicrounits: 2_000_000, unit: "piece",
      }));
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "insufficient-eggs", location: "home",
        items: [mealItem({
          name: "eggs", unit: "piece", observed: 3_000_000,
          adopted: 3_000_000, deducted: 3_000_000,
          sources: [nutritionSource("product_label", "label-product-eggs-v1", 1, "product-eggs", { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(result.items[0]).toMatchObject({
        inventory_match: "skipped_insufficient",
        inventory_transaction_id: null,
        issue_codes: ["inventory_insufficient"],
      });
      expect(fixture.service.query(queryInventory()).batches[0].quantity_microunits).toBe(2_000_000);
      expect(fixture.runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 1 });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-002 saves the frozen public nutrition source when no label exists", () => {
    const fixture = createMealService();
    try {
      previewAndExecute(fixture.service, mealEnvelope({
        suffix: "public-banana", location: "outside",
        items: [mealItem({
          name: "banana", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-banana-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect(fixture.runtime.database.prepare("SELECT source_type, source_ref FROM nutrition_snapshots").all()).toEqual([
        { source_type: "public_fixture", source_ref: "cn-banana-v1" },
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("records a Unicode food name with a frozen public nutrition source", () => {
    const fixture = createMealService();
    try {
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "unicode-rice", location: "outside",
        items: [mealItem({
          name: "米饭", unit: "gram", observed: 150_000_000,
          adopted: 150_000_000, deducted: 0,
          sources: [nutritionSource("public_fixture", "cn-rice-v1", 1, null, { kind: "per_100g", microunits: 100_000_000, unit: "gram" })],
        })],
      }));

      expect(result.status).toBe("committed");
      expect(fixture.runtime.database.prepare(
        "SELECT subject_type, subject_id, profile_version FROM nutrition_profiles",
      ).get()).toEqual({ subject_type: "food", subject_id: "米饭", profile_version: "1" });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-NUTR-005 keeps the old snapshot on v1 while a new meal selects v2", () => {
    const fixture = createMealService();
    try {
      for (const version of [1, 2]) {
        previewAndExecute(fixture.service, mealEnvelope({
          suffix: `yogurt-v${version}`, location: "outside",
          items: [mealItem({
            name: "yogurt", unit: "cup", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", `cn-yogurt-v${version}`, version, null, { kind: "per_serving", microunits: 1_000_000, unit: "cup" })],
          })],
        }));
      }
      expect(fixture.runtime.database.prepare("SELECT profile_version, source_ref FROM nutrition_snapshots ORDER BY CAST(profile_version AS INTEGER)").all()).toEqual([
        { profile_version: "1", source_ref: "cn-yogurt-v1" },
        { profile_version: "2", source_ref: "cn-yogurt-v2" },
      ]);
      const profiles = fixture.runtime.database.prepare(
        `SELECT profile_version, nutrition_profile_id, supersedes_profile_id
         FROM nutrition_profiles ORDER BY CAST(profile_version AS INTEGER)`,
      ).all() as Array<{
        profile_version: string;
        nutrition_profile_id: string;
        supersedes_profile_id: string | null;
      }>;
      expect(profiles[0].supersedes_profile_id).toBeNull();
      expect(profiles[1].supersedes_profile_id).toBe(profiles[0].nutrition_profile_id);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("CASE-PROGRESS-010 freezes one same-day progress block for a multi-item meal", () => {
    const fixture = createMealService();
    try {
      const result = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "multi-progress", location: "outside",
        items: [
          mealItem({
            name: "pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          }),
          mealItem({
            name: "tea", unit: "cup", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-tea-v1", 1, null, { kind: "per_serving", microunits: 1_000_000, unit: "cup" })],
          }),
        ],
      }));
      expect(result.payload).toMatchObject({
        daily_progress_by_date: [expect.objectContaining({ date: "2026-08-12" })],
      });
      expect((result.payload as { daily_progress: unknown; daily_progress_by_date: unknown[] }).daily_progress).toEqual(
        (result.payload as { daily_progress: unknown; daily_progress_by_date: unknown[] }).daily_progress_by_date[0],
      );
      const bundleRow = fixture.runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-multi-progress") as { payload_json: string };
      const bundle = JSON.parse(bundleRow.payload_json) as {
        effects: Array<{ contribution?: unknown; effect_id: string; state: string }>;
      };
      expect(bundle.effects.filter((effect) => effect.contribution !== undefined)).toEqual([
        {
          contribution: (result.payload as { daily_progress: unknown }).daily_progress,
          effect_id: expect.stringMatching(/^effect-[a-f0-9]{32}$/),
          state: "succeeded",
        },
      ]);
      const beforeQueries = tableCounts(fixture.runtime.database);
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-progress-001",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ date: "2026-08-12" });
      expect(fixture.service.query({
        kind: "query_meals", operation_id: "query-meals-progress-001",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ meals: [{ items: [{ normalized_name: "pear" }, { normalized_name: "tea" }] }] });
      expect(() => fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-progress-invalid-date",
        date: "2026-02-31", timezone: "Asia/Shanghai",
      })).toThrowError("INVENTORY_PROJECTION_INVALID:date");
      expect(tableCounts(fixture.runtime.database)).toEqual(beforeQueries);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("replays a finalized meal as the same deeply frozen result without writing rows", () => {
    const fixture = createMealService();
    try {
      const envelope = mealEnvelope({
        suffix: "frozen-replay", location: "outside",
        items: [mealItem({
          name: "replay pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-replay-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      });
      const preview = fixture.service.preview(envelope);
      const first = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      const before = tableCounts(fixture.runtime.database);
      const replay = fixture.service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(replay).toEqual(first);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(Object.isFrozen(replay.items)).toBe(true);
      expect(Object.isFrozen(replay.items[0])).toBe(true);
      expect(Object.isFrozen(replay.payload)).toBe(true);
      expect(Object.isFrozen((replay.payload as { daily_progress: unknown }).daily_progress)).toBe(true);
      expect(tableCounts(fixture.runtime.database)).toEqual(before);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("returns the cumulative same-day progress after a second meal", () => {
    const fixture = createMealService();
    try {
      const first = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-first", location: "outside",
        items: [mealItem({
          name: "first pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-first-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      const second = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-second", location: "outside",
        items: [mealItem({
          name: "second pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-second-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      expect((first.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(100_000);
      expect((second.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(200_000);
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-daily-cumulative",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 200_000 } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("keeps the latest cumulative progress when a later finalization has an earlier received time", () => {
    const fixture = createMealService();
    try {
      const firstService = createDietDomainService({
        database: fixture.runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
      });
      const secondService = createDietDomainService({
        database: fixture.runtime.database,
        secret,
        now: () => "2026-08-12T04:00:01.000Z",
      });
      const firstEnvelope: DomainEnvelopeInput = {
        ...mealEnvelope({
          suffix: "daily-later-time-first", location: "outside",
          items: [mealItem({
            name: "later time pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-later-time-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          })],
        }),
        received_at: "2026-08-12T04:00:02.000Z",
      };
      const secondEnvelope: DomainEnvelopeInput = {
        ...mealEnvelope({
          suffix: "daily-earlier-time-second", location: "outside",
          items: [mealItem({
            name: "earlier time pear", unit: "piece", observed: 1_000_000,
            adopted: 1_000_000, deducted: 1_000_000,
            sources: [nutritionSource("public_fixture", "cn-earlier-time-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
          })],
        }),
        received_at: "2026-08-12T04:00:01.000Z",
      };
      previewAndExecute(firstService, firstEnvelope);
      const second = previewAndExecute(secondService, secondEnvelope);
      expect((second.payload as { daily_progress: { nutrients: { energy_kcal_milli: number } } })
        .daily_progress.nutrients.energy_kcal_milli).toBe(200_000);
      expect(secondService.query({
        kind: "query_daily_summary", operation_id: "query-daily-out-of-order-finalize",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { energy_kcal_milli: 200_000 } });
      const generated = fixture.runtime.database.prepare(
        "SELECT generated_at FROM daily_progress_snapshots ORDER BY generated_at",
      ).all() as Array<{ generated_at: string }>;
      expect(generated).toEqual([
        { generated_at: "2026-08-12T04:00:02.000Z" },
        { generated_at: "2026-08-12T04:00:02.001Z" },
      ]);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("keeps a same-day nutrient unknown when an earlier meal contribution was unknown", () => {
    const fixture = createMealService();
    try {
      previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-unknown-first", location: "outside",
        items: [mealItem({
          name: "unknown fiber pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [nutritionSource("public_fixture", "cn-unknown-fiber-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
        })],
      }));
      const second = previewAndExecute(fixture.service, mealEnvelope({
        suffix: "daily-known-second", location: "outside",
        items: [mealItem({
          name: "known fiber pear", unit: "piece", observed: 1_000_000,
          adopted: 1_000_000, deducted: 1_000_000,
          sources: [{
            ...nutritionSource("public_fixture", "cn-known-fiber-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" }),
            nutrients: {
              energy_kcal_milli: 100_000,
              protein_mg: 5_000,
              fat_mg: 2_000,
              carbohydrate_mg: 12_000,
              fiber_mg: 2_000,
              water_ml_milli: 80_000,
            },
          }],
        })],
      }));
      expect((second.payload as { daily_progress: { nutrients: { fiber_mg: number | null } } })
        .daily_progress.nutrients.fiber_mg).toBeNull();
      expect(fixture.service.query({
        kind: "query_daily_summary", operation_id: "query-daily-unknown",
        date: "2026-08-12", timezone: "Asia/Shanghai",
      })).toMatchObject({ nutrients: { fiber_mg: null } });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a progress contribution moved onto the wrong EffectBundle effect", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const envelope = mealEnvelope({
      suffix: "tampered-progress-effect", location: "outside",
      items: [mealItem({
        name: "tampered progress pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-tampered-progress-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const preview = service.preview(envelope);
      const operation = envelope.operations[0];
      if (operation.kind !== "record_meal") throw new Error("test operation mismatch");
      const prepared = prepareMealOperation({
        database: runtime.database,
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
        committedAt: envelope.received_at,
        sequence: 0,
        operation,
      });
      appendPreparedOperationFact(prepared.fact);
      const mealResult = applyMealEffects({
        database: runtime.database,
        envelopeId: envelope.envelope_id,
        operationId: operation.operation_id,
        operationSequence: 0,
        idempotencyKey: envelope.idempotency_key,
        now: envelope.received_at,
        location: operation.location,
      });
      const bundleRow = runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE envelope_id = ? AND operation_id = ?",
      ).get(envelope.envelope_id, operation.operation_id) as { payload_json: string };
      const bundle = JSON.parse(bundleRow.payload_json) as {
        effects: Array<{ contribution?: unknown; effect_id: string; state: string }>;
      };
      const progressEffect = bundle.effects.find((effect) => effect.contribution !== undefined);
      const otherEffect = bundle.effects.find((effect) => effect.contribution === undefined);
      if (!progressEffect || !otherEffect) throw new Error("test bundle shape mismatch");
      otherEffect.contribution = progressEffect.contribution;
      delete progressEffect.contribution;
      runtime.database.prepare(
        "UPDATE effect_bundle_commits SET payload_json = ? WHERE envelope_id = ? AND operation_id = ?",
      ).run(canonicalJson(bundle), envelope.envelope_id, operation.operation_id);
      sealPreparedEnvelopeFacts({
        database: runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        expectedOperationIds: Object.freeze([operation.operation_id]),
        sealedAt: envelope.received_at,
      });
      const execution = Object.freeze({
        envelope_id: envelope.envelope_id,
        input_digest: preview.input_digest,
        status: mealResult.status,
        items: Object.freeze([mealResult]),
        payload: Object.freeze({
          authority_kind: "diet-manager/domain-execution/v1",
          daily_progress: mealResult.daily_progress,
          daily_progress_by_date: mealResult.daily_progress_by_date,
        }),
      });
      expect(() => finalizeEnvelope({
        database: runtime.database,
        secret,
        token: preview.token,
        inputDigest: preview.input_digest,
        subjectScope: envelope.subject_scope,
        commandType: envelope.command_type,
        dataRevision: preview.data_revision,
        traceId: prepared.fact.traceId,
        resultStatus: mealResult.status,
        receiptId: deriveDomainId("receipt", envelope.idempotency_key, 0),
        finalizedAt: envelope.received_at,
        frozenAt: envelope.received_at,
        payload: execution,
        mixedItems: Object.freeze([]),
      })).toThrow("ENVELOPE_FINALIZE_AUTHORITY_INVALID:daily_progress_bundle");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back a failed meal EffectBundle while retaining only the committed fact and redacted log", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const failures: DietDomainFailureEntry[] = [];
    const service = createDietDomainService({
      database: runtime.database,
      secret,
      now: () => "2026-08-12T04:00:01.000Z",
      fault: "after_meal_nutrition",
      failureSink: (entry) => failures.push(entry),
    });
    const envelope = mealEnvelope({
      suffix: "nutrition-failure",
      location: "outside",
      items: [mealItem({
        name: "failed pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-failed-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const preview = service.preview(envelope);
      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_FAILED:after_nutrition");
      expect(failures).toEqual([{
        stage: "EffectBundle",
        error_code: "MEAL_EFFECT_FAILED",
        trace_id: expect.stringMatching(/^trace-[a-f0-9]{32}$/),
        input_digest: preview.input_digest,
      }]);
      expect(runtime.database.prepare(
        "SELECT event_type, lifecycle_status FROM event_records",
      ).all()).toEqual([{ event_type: "diet_meal", lifecycle_status: "active" }]);
      expect(runtime.database.prepare(
        "SELECT state FROM effect_outbox ORDER BY effect_id",
      ).all()).toEqual([
        { state: "pending" },
        { state: "pending" },
      ]);
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_profiles").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM issues").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM envelope_finalizations").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rolls back first-item nutrition and inventory writes when a later meal step fails", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const seedService = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:03.000Z",
      });
      seedPurchase(seedService, purchaseStockEnvelope({
        suffix: "rollback-rice", productId: "product-rollback-rice", normalizedName: "rollback rice",
        batchId: "batch-rollback-rice", quantityMicrounits: 500_000_000, unit: "g",
      }));
      seedPurchase(seedService, purchaseStockEnvelope({
        suffix: "rollback-chicken", productId: "product-rollback-chicken", normalizedName: "rollback chicken",
        batchId: "batch-rollback-chicken", quantityMicrounits: 500_000_000, unit: "g",
      }));
      const before = tableCounts(runtime.database);
      const quantities = seedService.query(queryInventory()).batches.map((batch) => batch.quantity_microunits);
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:03.000Z",
        fault: "after_meal_first_item",
      });
      const envelope = mealEnvelope({
        suffix: "rollback-two-items", location: "home",
        items: [
          mealItem({
            name: "rollback rice", unit: "g", observed: 100_000_000,
            adopted: 100_000_000, deducted: 100_000_000,
            sources: [nutritionSource("product_label", "label-product-rollback-rice-v1", 1, "product-rollback-rice", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
          mealItem({
            name: "rollback chicken", unit: "g", observed: 100_000_000,
            adopted: 100_000_000, deducted: 100_000_000,
            sources: [nutritionSource("product_label", "label-product-rollback-chicken-v1", 1, "product-rollback-chicken", { kind: "per_100g", microunits: 100_000_000, unit: "g" })],
          }),
        ],
      });
      const preview = failing.preview(envelope);
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_FAILED:after_first_item");
      const after = tableCounts(runtime.database);
      expect(after.inventory_transactions).toBe(before.inventory_transactions);
      expect(after.nutrition_profiles).toBe(before.nutrition_profiles);
      expect(after.nutrition_snapshots).toBe(0);
      expect(after.issues).toBe(0);
      expect(after.daily_progress_snapshots).toBe(0);
      expect(seedService.query(queryInventory()).batches.map((batch) => batch.quantity_microunits)).toEqual(quantities);
      expect(runtime.database.prepare(
        "SELECT effect_state, result_status FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-rollback-two-items")).toEqual({
        effect_state: "pending",
        result_status: "facts_committed_effects_pending",
      });
      expect(runtime.database.prepare(
        "SELECT DISTINCT state FROM effect_outbox WHERE operation_id = ?",
      ).all("operation-meal-rollback-two-items")).toEqual([{ state: "pending" }]);
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });

  it("rejects a tampered pending meal EffectBundle checkpoint before any effect write", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    const envelope = mealEnvelope({
      suffix: "tampered-checkpoint", location: "outside",
      items: [mealItem({
        name: "tampered pear", unit: "piece", observed: 1_000_000,
        adopted: 1_000_000, deducted: 1_000_000,
        sources: [nutritionSource("public_fixture", "cn-tampered-pear-v1", 1, null, { kind: "per_item", microunits: 1_000_000, unit: "piece" })],
      })],
    });
    try {
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
        fault: "after_meal_nutrition",
      });
      const preview = failing.preview(envelope);
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_FAILED:after_nutrition");
      const checkpoint = runtime.database.prepare(
        "SELECT payload_json FROM effect_bundle_commits WHERE operation_id = ?",
      ).get("operation-meal-tampered-checkpoint") as { payload_json: string };
      const payload = JSON.parse(checkpoint.payload_json) as Record<string, unknown>;
      payload.authority_kind = "tampered/checkpoint";
      runtime.database.prepare(
        "UPDATE effect_bundle_commits SET payload_json = ? WHERE operation_id = ?",
      ).run(JSON.stringify(payload), "operation-meal-tampered-checkpoint");

      const retry = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-12T04:00:02.000Z",
      });
      expect(() => retry.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("MEAL_EFFECT_AUTHORITY_INVALID:checkpoint_payload");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM nutrition_snapshots").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM daily_progress_snapshots").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
      removeOwnedRoot(root);
    }
  });
});
