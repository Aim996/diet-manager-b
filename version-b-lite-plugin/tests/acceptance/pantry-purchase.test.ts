import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/authority/canonical-json.js";
import { digestDomainEnvelope } from "../../src/domain/identity.js";
import {
  PantryEvidenceAuthorityError,
  productIdentityFingerprint,
  resolveExpiration,
  resolveOpening,
  resolvePackageQuantity,
  resolveProductIdentity,
  resolveStorageLocation,
  validateAndFreezePantryPurchaseEvidence,
} from "../../src/domain/inventory-service.js";
import { createDietDomainService } from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";
import {
  MIGRATION_V1_ID,
  MIGRATION_V1_MAPPING_SHA256,
  MIGRATION_V1_TABLE_STATEMENTS,
} from "../../src/storage/migration-v1.js";

const secret = Buffer.from("SEL-PANTRY-001 authority secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-pantry-${randomUUID().replaceAll("-", "")}`);
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

function pantryEvidence(): Record<string, unknown> {
  return {
    schema_version: "diet-manager/pantry-evidence/v1",
    product_identity: {
      raw_name: "牛奶",
      normalized_name: "milk",
      brand: "brand-a",
      variant_or_flavor: "whole",
      specification: { value: 250, unit: "ml" },
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
      value: "home",
      evidence_kind: "configured_home_default",
      rule_version: "diet-manager/home-default/v1",
    },
    opening: null,
    expiration: {
      explicit_at: null,
      effective_at: null,
      basis: "unknown",
      rule_version: null,
    },
  };
}

function purchaseEnvelope(): DomainEnvelopeInput {
  return {
    envelope_id: "envelope-pantry-authority-001",
    idempotency_key: "idem-pantry-authority-001",
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: "message-pantry-authority-001",
    conversation_id: "conversation-pantry-authority-001",
    received_at: "2026-08-14T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: "operation-pantry-authority-001",
      product: {
        product_id: "product-milk-brand-a-whole-250ml",
        normalized_name: "milk",
        product_type: "nutrition_drink",
      },
      batch_id: "batch-pantry-authority-001",
      amount: {
        unit: "carton",
        observed_microunits: 24_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [],
      pantry_evidence: pantryEvidence(),
    } as never],
  };
}

function legacyPurchaseEnvelope(): DomainEnvelopeInput {
  return {
    envelope_id: "envelope-pantry-legacy-001",
    idempotency_key: "idem-pantry-legacy-001",
    command_type: "add_inventory",
    subject_scope: "user:self",
    source_message_id: "message-pantry-legacy-001",
    conversation_id: "conversation-pantry-legacy-001",
    received_at: "2026-08-14T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [{
      kind: "add_inventory",
      operation_id: "operation-pantry-legacy-001",
      product: {
        product_id: "product-milk-legacy",
        normalized_name: "milk",
        product_type: "nutrition_drink",
      },
      batch_id: "batch-pantry-legacy-001",
      amount: {
        unit: "carton",
        observed_microunits: 24_000_000,
        nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null,
        template_reference_microunits: null,
        evidence: "explicit",
      },
      nutrition_sources: [],
    }],
  };
}

function mutableEvidence(): Record<string, unknown> {
  return structuredClone(pantryEvidence());
}

function expectAuthorityFailure(value: unknown): void {
  expect(() => validateAndFreezePantryPurchaseEvidence(value)).toThrow(PantryEvidenceAuthorityError);
}

describe("SEL-PANTRY-001 purchase evidence authority", () => {
  it("admits an exact detached purchase evidence object", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:00:01.000Z",
      });

      expect(() => service.preview(purchaseEnvelope())).not.toThrow();
    } finally {
      runtime.close();
    }
  });

  it("returns an ordinary detached recursively frozen authority object", () => {
    const input = mutableEvidence();
    const validated = validateAndFreezePantryPurchaseEvidence(input);

    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(Object.getPrototypeOf(validated)).toBe(Object.prototype);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.product_identity)).toBe(true);
    expect(Object.isFrozen(validated.product_identity.specification)).toBe(true);
    expect(Object.isFrozen(validated.package_quantity)).toBe(true);
    expect(Object.isFrozen(validated.location)).toBe(true);
    expect(Object.isFrozen(validated.expiration)).toBe(true);

    (input.product_identity as Record<string, unknown>).raw_name = "tampered";
    expect(validated.product_identity.raw_name).toBe("牛奶");
  });

  it("rejects proxies before reflection and accessors without invoking them", () => {
    let traps = 0;
    const rootProxy = new Proxy(mutableEvidence(), {
      getPrototypeOf() { traps += 1; return Object.prototype; },
      ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, property) {
        traps += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expectAuthorityFailure(rootProxy);
    expect(traps).toBe(0);

    const nestedInput = mutableEvidence();
    nestedInput.product_identity = new Proxy(nestedInput.product_identity as Record<string, unknown>, {
      getPrototypeOf(target) { traps += 1; return Reflect.getPrototypeOf(target); },
    });
    expectAuthorityFailure(nestedInput);
    expect(traps).toBe(0);

    let getterCalls = 0;
    const accessorInput = mutableEvidence();
    Object.defineProperty(accessorInput, "product_identity", {
      get() { getterCalls += 1; return pantryEvidence().product_identity; },
      enumerable: true,
    });
    expectAuthorityFailure(accessorInput);
    expect(getterCalls).toBe(0);
  });

  it("rejects unknown and missing fields at every exact boundary", () => {
    const extraRoot = mutableEvidence();
    extraRoot.extra = true;
    expectAuthorityFailure(extraRoot);

    const missingNested = mutableEvidence();
    delete (missingNested.product_identity as Record<string, unknown>).brand;
    expectAuthorityFailure(missingNested);

    const partialSpecification = mutableEvidence();
    delete ((partialSpecification.product_identity as Record<string, unknown>).specification as Record<string, unknown>).unit;
    expectAuthorityFailure(partialSpecification);
  });

  it.each([
    ["zero quantity", (value: Record<string, unknown>) => {
      (value.package_quantity as Record<string, unknown>).outer_count = 0;
    }],
    ["unsafe quantity", (value: Record<string, unknown>) => {
      (value.package_quantity as Record<string, unknown>).total_capacity = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["inconsistent total", (value: Record<string, unknown>) => {
      (value.package_quantity as Record<string, unknown>).total_inner = 23;
    }],
    ["inconsistent formula", (value: Record<string, unknown>) => {
      (value.package_quantity as Record<string, unknown>).formula = "2*12*250=5999";
    }],
    ["unknown identity with asserted variant", (value: Record<string, unknown>) => {
      (value.product_identity as Record<string, unknown>).evidence_kind = "unknown";
    }],
    ["default location without rule", (value: Record<string, unknown>) => {
      (value.location as Record<string, unknown>).rule_version = null;
    }],
    ["invalid explicit expiration", (value: Record<string, unknown>) => {
      value.expiration = {
        explicit_at: "2026-08-20T08:00:00+08:00",
        effective_at: "2026-08-21T08:00:00+08:00",
        basis: "explicit",
        rule_version: null,
      };
    }],
    ["opened without time", (value: Record<string, unknown>) => {
      value.opening = { status: "opened", opened_at: null, evidence_kind: "explicit", rule_version: null };
    }],
  ] as const)("rejects semantically invalid evidence: %s", (_label, mutate) => {
    const value = mutableEvidence();
    mutate(value);
    expectAuthorityFailure(value);
  });

  it("keeps legacy add-inventory bytes and digest exact while requiring known amounts", () => {
    const envelope = legacyPurchaseEnvelope();
    expect(digestDomainEnvelope(envelope)).toBe(
      "A8F36F8858A801021F70CFA3DBB9A9C8DDDD8EB2CE2A21F65F045A5F94476693",
    );
    expect(Object.hasOwn(envelope.operations[0]!, "pantry_evidence")).toBe(false);

    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:00:01.000Z",
      });
      expect(service.preview(envelope).input_digest).toBe(
        "A8F36F8858A801021F70CFA3DBB9A9C8DDDD8EB2CE2A21F65F045A5F94476693",
      );
      const invalid = structuredClone(envelope) as unknown as {
        operations: Array<{ amount: { observed_microunits: number | null; evidence: string } }>;
      };
      invalid.operations[0]!.amount.observed_microunits = null;
      invalid.operations[0]!.amount.evidence = "unknown";
      expect(() => service.preview(invalid as unknown as DomainEnvelopeInput)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.amount.observed_microunits",
      );
    } finally {
      runtime.close();
    }
  });

  it("rejects malformed evidence before any preview row is written", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:00:01.000Z",
      });
      const envelope = structuredClone(purchaseEnvelope()) as unknown as {
        operations: Array<{ pantry_evidence: Record<string, unknown> }>;
      };
      (envelope.operations[0]!.pantry_evidence.package_quantity as Record<string, unknown>).formula = "unsafe";
      expect(() => service.preview(envelope as unknown as DomainEnvelopeInput)).toThrow(
        "DIET_DOMAIN_REQUEST_INVALID:envelope.operations.0.pantry_evidence.package_quantity.formula",
      );
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM command_envelopes").get()).toEqual({ count: 0 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get()).toEqual({ count: 0 });
    } finally {
      runtime.close();
    }
  });

  it("characterizes v1 schema as sufficient for canonical pantry evidence without migration drift", () => {
    expect(MIGRATION_V1_ID).toBe("diet-manager/b-sqlite-migration/0001");
    expect(MIGRATION_V1_MAPPING_SHA256).toBe(
      "19A74F1FB131CDCC1799653043EE707F6CC765369F4997811E62815ABED99D2F",
    );
    expect(MIGRATION_V1_TABLE_STATEMENTS.find((sql) => sql.includes('CREATE TABLE "products"'))).toContain('"payload_json" TEXT NOT NULL');
    expect(MIGRATION_V1_TABLE_STATEMENTS.find((sql) => sql.includes('CREATE TABLE "inventory_batches"'))).toContain('"payload_json" TEXT NOT NULL');

    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const evidenceJson = canonicalJson(validateAndFreezePantryPurchaseEvidence(pantryEvidence()));
      runtime.database.prepare(
        `INSERT INTO command_envelopes(
          envelope_id,idempotency_key,input_digest,source_message_id,conversation_id,state,result_status,
          received_at,committed_at,payload_json
        ) VALUES (?,?,?,?,?,'received','received',?,NULL,'{}')`,
      ).run("schema-envelope", "schema-idem", "A".repeat(64), "schema-message", "schema-conversation", "2026-08-14T08:00:00.000Z");
      runtime.database.prepare(
        `INSERT INTO event_records(
          event_id,envelope_id,operation_id,schema_version,event_type,fact_kind,source_message_id,
          conversation_id,received_at,committed_at,occurred_at_text,result_status,lifecycle_status,
          meal_id,meal_slot,payload_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)`,
      ).run(
        "schema-event", "schema-envelope", "schema-operation", "domain/v2", "inventory_stock", "inventory",
        "schema-message", "schema-conversation", "2026-08-14T08:00:00.000Z", "2026-08-14T08:00:01.000Z",
        "2026-08-14T08:00:00.000Z", "committed", "active", evidenceJson,
      );
      runtime.database.prepare(
        `INSERT INTO products(
          product_id,schema_version,normalized_name,product_type,brand,manufacturer,barcode,sku,payload_json
        ) VALUES (?,?,?,?,?,NULL,NULL,NULL,?)`,
      ).run("schema-product", "domain/v2", "milk", "nutrition_drink", "brand-a", evidenceJson);
      runtime.database.prepare(
        `INSERT INTO inventory_batches(
          batch_id,product_id,stock_event_id,schema_version,committed_at,stocked_at,
          explicit_expiration_at,quantity_unit,payload_json
        ) VALUES (?,?,?,?,?,?,NULL,?,?)`,
      ).run(
        "schema-batch", "schema-product", "schema-event", "domain/v2", "2026-08-14T08:00:01.000Z",
        "2026-08-14T08:00:00.000Z", "carton", evidenceJson,
      );

      expect(runtime.database.prepare(
        "SELECT product_id,batch_id,stocked_at,quantity_unit,payload_json FROM inventory_batches WHERE batch_id = ?",
      ).get("schema-batch")).toEqual({
        product_id: "schema-product",
        batch_id: "schema-batch",
        stocked_at: "2026-08-14T08:00:00.000Z",
        quantity_unit: "carton",
        payload_json: evidenceJson,
      });
    } finally {
      runtime.close();
    }
  });
});

describe("SEL-PANTRY-001 deterministic purchase rules", () => {
  it("derives the exact four-quantity package equation with safe integer arithmetic", () => {
    expect(resolvePackageQuantity({
      outer_count: 2,
      outer_unit: "box",
      inner_per_outer: 12,
      inner_unit: "carton",
      capacity_per_inner: 250,
      capacity_unit: "ml",
      total_inner: null,
      total_capacity: null,
    })).toEqual({
      outer_count: 2,
      outer_unit: "box",
      inner_per_outer: 12,
      inner_unit: "carton",
      capacity_per_inner: 250,
      capacity_unit: "ml",
      total_inner: 24,
      total_capacity: 6000,
      formula: "2*12*250=6000",
    });
  });

  it("keeps an outer-only egg bag unknown instead of inventing inner quantities", () => {
    expect(resolvePackageQuantity({
      outer_count: 1,
      outer_unit: "bag",
      inner_per_outer: null,
      inner_unit: null,
      capacity_per_inner: null,
      capacity_unit: null,
      total_inner: null,
      total_capacity: null,
    })).toEqual({
      outer_count: 1,
      outer_unit: "bag",
      inner_per_outer: null,
      inner_unit: null,
      capacity_per_inner: null,
      capacity_unit: null,
      total_inner: null,
      total_capacity: null,
      formula: null,
    });
  });

  it.each([
    ["zero", { outer_count: 0 }],
    ["negative", { inner_per_outer: -1 }],
    ["decimal", { capacity_per_inner: 0.5 }],
    ["unsafe", { inner_per_outer: Number.MAX_SAFE_INTEGER }],
    ["conflicting inner total", { total_inner: 25 }],
    ["conflicting capacity total", { total_capacity: 6001 }],
    ["invented inner", { inner_per_outer: null, inner_unit: null, total_inner: 24, total_capacity: null }],
  ] as const)("rejects invalid package arithmetic: %s", (_label, change) => {
    const input = {
      outer_count: 2,
      outer_unit: "box",
      inner_per_outer: 12,
      inner_unit: "carton",
      capacity_per_inner: 250,
      capacity_unit: "ml",
      total_inner: null,
      total_capacity: null,
      ...change,
    };
    expect(() => resolvePackageQuantity(input)).toThrow(PantryEvidenceAuthorityError);
  });

  it("creates stable exact product fingerprints and changes on every identity field", () => {
    const identity = {
      raw_name: "牛奶",
      normalized_name: "milk",
      brand: "brand-a",
      variant_or_flavor: "whole",
      specification: { value: 250, unit: "ml" },
      evidence_kind: "explicit" as const,
    };
    const fingerprint = productIdentityFingerprint(identity);
    expect(fingerprint).toMatch(/^[A-F0-9]{64}$/);
    expect(productIdentityFingerprint(structuredClone(identity))).toBe(fingerprint);
    expect(productIdentityFingerprint({ ...identity, normalized_name: "fresh milk" })).not.toBe(fingerprint);
    expect(productIdentityFingerprint({ ...identity, brand: "brand-b" })).not.toBe(fingerprint);
    expect(productIdentityFingerprint({ ...identity, variant_or_flavor: "low-fat" })).not.toBe(fingerprint);
    expect(productIdentityFingerprint({ ...identity, specification: { value: 251, unit: "ml" } })).not.toBe(fingerprint);
  });

  it("reuses one exact historical identity and never auto-selects among same-name variants", () => {
    const requested = {
      raw_name: "牛奶",
      normalized_name: "milk",
      brand: "brand-a",
      variant_or_flavor: "whole",
      specification: { value: 250, unit: "ml" },
      evidence_kind: "explicit" as const,
    };
    expect(resolveProductIdentity({
      requested,
      candidates: [{ product_id: "product-exact", identity: structuredClone(requested) }],
    })).toEqual({ status: "reuse_exact", product_id: "product-exact" });

    const ambiguous = resolveProductIdentity({
      requested,
      candidates: [
        { product_id: "product-z", identity: { ...requested, brand: "brand-z", variant_or_flavor: "whole" } },
        { product_id: "product-c", identity: { ...requested, brand: "brand-a", variant_or_flavor: "low-fat" } },
        { product_id: "product-a", identity: { ...requested, brand: "brand-a", variant_or_flavor: null } },
        { product_id: "product-y", identity: { ...requested, brand: "brand-y", variant_or_flavor: "skim" } },
        { product_id: "product-x", identity: { ...requested, brand: "brand-x", variant_or_flavor: "skim" } },
      ],
    });
    expect(ambiguous).toEqual({
      status: "needs_clarification",
      candidate_product_ids: ["product-a", "product-c", "product-z", "product-x"],
    });
    expect(Object.isFrozen(ambiguous)).toBe(true);
    expect(Object.isFrozen((ambiguous as { candidate_product_ids: readonly string[] }).candidate_product_ids)).toBe(true);
  });

  it("derives a stable new product id when no same-name identity needs clarification", () => {
    const requested = {
      raw_name: "苹果",
      normalized_name: "apple",
      brand: null,
      variant_or_flavor: null,
      specification: null,
      evidence_kind: "explicit" as const,
    };
    const first = resolveProductIdentity({ requested, candidates: [] });
    const second = resolveProductIdentity({ requested: structuredClone(requested), candidates: [] });
    expect(first).toEqual(second);
    expect(first.status).toBe("new");
  });

  it("labels configured location inference and keeps explicit locations unlabelled as rules", () => {
    expect(resolveStorageLocation({
      explicit_location: null,
      configured_home_default: {
        value: "refrigerator",
        rule_version: "diet-manager/default-location-v1",
      },
    })).toEqual({
      value: "refrigerator",
      evidence_kind: "configured_home_default",
      rule_version: "diet-manager/default-location-v1",
    });
    expect(resolveStorageLocation({
      explicit_location: "room_temperature_cabinet",
      configured_home_default: {
        value: "refrigerator",
        rule_version: "diet-manager/default-location-v1",
      },
    })).toEqual({
      value: "room_temperature_cabinet",
      evidence_kind: "explicit",
      rule_version: null,
    });
    expect(() => resolveStorageLocation({
      explicit_location: null,
      configured_home_default: null,
    })).toThrow(PantryEvidenceAuthorityError);
  });

  it("turns explicit partial use into versioned opening evidence", () => {
    expect(resolveOpening({
      partial_use_explicit: true,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: "diet-manager/opening-evidence-v1",
    })).toEqual({
      status: "opened",
      opened_at: "2026-08-11T08:30:00+08:00",
      evidence_kind: "rule",
      rule_version: "diet-manager/opening-evidence-v1",
    });
    expect(resolveOpening({
      partial_use_explicit: false,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: "diet-manager/opening-evidence-v1",
    })).toBeNull();
  });

  it("keeps unreliable expiration null and performs safe Shanghai calendar addition", () => {
    expect(resolveExpiration({
      reliability: "unreliable",
      explicit_at: null,
      duration_days: null,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: null,
    })).toEqual({ explicit_at: null, effective_at: null, basis: "unknown", rule_version: null });

    expect(resolveExpiration({
      reliability: "reliable_rule",
      explicit_at: null,
      duration_days: 1,
      anchor_at: "2024-02-28T08:30:00+08:00",
      rule_version: "diet-manager/shelf-life-v1",
    })).toEqual({
      explicit_at: null,
      effective_at: "2024-02-29T08:30:00.000+08:00",
      basis: "rule",
      rule_version: "diet-manager/shelf-life-v1",
    });
    expect(resolveExpiration({
      reliability: "reliable_rule",
      explicit_at: null,
      duration_days: 1,
      anchor_at: "2023-12-31T08:30:00+08:00",
      rule_version: "diet-manager/shelf-life-v1",
    }).effective_at).toBe("2024-01-01T08:30:00.000+08:00");

    expect(resolveExpiration({
      reliability: "explicit",
      explicit_at: "2026-08-20T08:30:00+08:00",
      duration_days: null,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: null,
    })).toEqual({
      explicit_at: "2026-08-20T08:30:00+08:00",
      effective_at: "2026-08-20T08:30:00+08:00",
      basis: "explicit",
      rule_version: null,
    });
  });

  it("rejects invented or unsafe expiration rules", () => {
    expect(() => resolveExpiration({
      reliability: "unreliable",
      explicit_at: null,
      duration_days: 3,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: null,
    })).toThrow(PantryEvidenceAuthorityError);
    expect(() => resolveExpiration({
      reliability: "reliable_rule",
      explicit_at: null,
      duration_days: 0,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: "diet-manager/shelf-life-v1",
    })).toThrow(PantryEvidenceAuthorityError);
    expect(() => resolveExpiration({
      reliability: "reliable_rule",
      explicit_at: null,
      duration_days: Number.MAX_SAFE_INTEGER,
      anchor_at: "2026-08-11T08:30:00+08:00",
      rule_version: "diet-manager/shelf-life-v1",
    })).toThrow(PantryEvidenceAuthorityError);
  });
});
