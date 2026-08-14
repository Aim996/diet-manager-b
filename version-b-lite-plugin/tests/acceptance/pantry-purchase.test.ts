import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, canonicalSha256 } from "../../src/authority/canonical-json.js";
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

function tableSnapshot(database: DatabaseSync): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return canonicalJson(Object.fromEntries(tables.map(({ name }) => [
    name,
    database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ])));
}

function previewAndExecute(
  service: ReturnType<typeof createDietDomainService>,
  envelope: DomainEnvelopeInput,
) {
  const preview = service.preview(envelope);
  return {
    preview,
    result: service.execute({
      envelope,
      token: preview.token,
      input_digest: preview.input_digest,
      data_revision: preview.data_revision,
    }),
  };
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

describe("SEL-PANTRY-001 purchase evidence vertical persistence", () => {
  it("persists canonical v2 fact, product, batch and projection evidence and replays exactly", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:00:01.000Z",
      });
      const envelope = purchaseEnvelope();
      const { preview, result } = previewAndExecute(service, envelope);
      expect(result.status).toBe("committed");
      expect(result.items[0]).toMatchObject({
        pantry_evidence: pantryEvidence(),
        receipt_item: {
          product_id: "product-milk-brand-a-whole-250ml",
          batch_id: "batch-pantry-authority-001",
          name: "milk",
          stocked_at: "2026-08-14T08:00:00.000Z",
          location: { value: "home", evidence_kind: "configured_home_default" },
          inferred_fields: ["location"],
        },
      });

      const event = runtime.database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const product = runtime.database.prepare(
        "SELECT brand,payload_json FROM products WHERE product_id = ?",
      ).get("product-milk-brand-a-whole-250ml") as { brand: string; payload_json: string };
      const batch = runtime.database.prepare(
        "SELECT explicit_expiration_at,quantity_unit,payload_json FROM inventory_batches WHERE batch_id = ?",
      ).get("batch-pantry-authority-001") as { explicit_expiration_at: string | null; quantity_unit: string; payload_json: string };
      const projection = runtime.database.prepare(
        "SELECT seal_status,expiry_status,effective_expiration_at,payload_json FROM inventory_batch_projections WHERE batch_id = ?",
      ).get("batch-pantry-authority-001") as {
        seal_status: string; expiry_status: string; effective_expiration_at: string | null; payload_json: string;
      };
      const previewAuthority = runtime.database.prepare(
        "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      expect(JSON.parse(previewAuthority.payload_json)).toMatchObject({
        authority_kind: "diet-manager/server-preview/v4",
        input_digest: preview.input_digest,
        meal_fact_identities: [],
        purchase_fact_identities: [{
          event_id: expect.any(String),
          operation_id: "operation-pantry-authority-001",
          payload_digest: expect.stringMatching(/^[A-F0-9]{64}$/),
        }],
        fact_identity_mac: expect.stringMatching(/^[A-F0-9]{64}$/),
      });
      expect(previewAuthority.payload_json).not.toContain("brand-a");
      expect(JSON.parse(event.payload_json)).toMatchObject({
        authority_kind: "diet-manager/purchase-fact/v2",
        pantry_evidence: pantryEvidence(),
      });
      expect(product.brand).toBe("brand-a");
      expect(JSON.parse(product.payload_json)).toMatchObject({
        authority_kind: "diet-manager/product/v2",
        identity: pantryEvidence().product_identity,
      });
      expect(batch.explicit_expiration_at).toBeNull();
      expect(batch.quantity_unit).toBe("carton");
      expect(JSON.parse(batch.payload_json)).toEqual({
        authority_kind: "diet-manager/inventory-batch/v2",
        pantry_evidence: pantryEvidence(),
        template_reference_microunits: null,
      });
      expect(projection).toMatchObject({
        seal_status: "unknown",
        expiry_status: "unknown",
        effective_expiration_at: null,
      });
      expect(JSON.parse(projection.payload_json)).toMatchObject({
        authority_kind: "diet-manager/inventory-projection/v2",
        pantry_evidence: pantryEvidence(),
        quantity_microunits: 24_000_000,
        unit: "carton",
      });
      expect(runtime.database.prepare(
        "SELECT direction,reason_code,unit,payload_json FROM inventory_transactions WHERE batch_id = ?",
      ).get("batch-pantry-authority-001")).toMatchObject({
        direction: "in",
        reason_code: "purchase",
        unit: "carton",
      });
      expect(service.query({ kind: "query_inventory", operation_id: "query-pantry-v2" })).toMatchObject({
        kind: "inventory",
        batches: [{
          batch_id: "batch-pantry-authority-001",
          pantry_evidence: pantryEvidence(),
        }],
      });

      const beforeReplay = tableSnapshot(runtime.database);
      expect(service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toEqual(result);
      expect(tableSnapshot(runtime.database)).toBe(beforeReplay);
    } finally {
      runtime.close();
    }
  });

  it("preserves outer-only package unknowns without inventing inner egg counts", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:10:01.000Z",
      });
      const base = purchaseEnvelope();
      const evidence = pantryEvidence();
      evidence.product_identity = {
        ...(evidence.product_identity as Record<string, unknown>),
        raw_name: "鸡蛋",
        normalized_name: "egg",
        brand: null,
        variant_or_flavor: null,
        specification: null,
      };
      evidence.package_quantity = {
        outer_count: 1,
        outer_unit: "bag",
        inner_per_outer: null,
        inner_unit: null,
        capacity_per_inner: null,
        capacity_unit: null,
        total_inner: null,
        total_capacity: null,
        formula: null,
      };
      const operation = structuredClone(base.operations[0]!) as Record<string, unknown>;
      operation.operation_id = "operation-pantry-eggs-outer-only";
      operation.product = { product_id: "product-eggs", normalized_name: "egg", product_type: "food" };
      operation.batch_id = "batch-pantry-eggs-outer-only";
      operation.amount = {
        unit: "unknown", observed_microunits: null, nutrition_adoption_microunits: null,
        inventory_deduction_microunits: null, template_reference_microunits: null, evidence: "unknown",
      };
      operation.pantry_evidence = evidence;
      const envelope = {
        ...base,
        envelope_id: "envelope-pantry-eggs-outer-only",
        idempotency_key: "idem-pantry-eggs-outer-only",
        source_message_id: "message-pantry-eggs-outer-only",
        operations: [operation],
      } as unknown as DomainEnvelopeInput;
      const committed = previewAndExecute(service, envelope);
      expect(committed.result.status).toBe("committed");
      const query = service.query({ kind: "query_inventory", operation_id: "query-eggs-outer-only" });
      expect(query).toMatchObject({ batches: [{
        batch_id: "batch-pantry-eggs-outer-only",
        quantity_microunits: null,
        quantity_status: "unknown",
        pantry_evidence: { package_quantity: {
          outer_count: 1,
          inner_per_outer: null,
          capacity_per_inner: null,
          total_inner: null,
          total_capacity: null,
          formula: null,
        } },
      }] });
      expect(runtime.database.prepare(
        "SELECT payload_json FROM inventory_transactions WHERE batch_id = ?",
      ).get("batch-pantry-eggs-outer-only")).toMatchObject({
        payload_json: canonicalJson({
          authority_kind: "diet-manager/inventory-transaction/v2",
          quantity_delta_microunits: null,
          quantity_after_microunits: null,
          unit: "unknown",
        }),
      });
      const beforeReplay = tableSnapshot(runtime.database);
      expect(service.execute({
        envelope,
        token: committed.preview.token,
        input_digest: committed.preview.input_digest,
        data_revision: committed.preview.data_revision,
      })).toEqual(committed.result);
      expect(tableSnapshot(runtime.database)).toBe(beforeReplay);
    } finally {
      runtime.close();
    }
  });

  it("reuses one exact product identity and frozen nutrition profile across new batches", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:15:01.000Z",
      });
      const first = structuredClone(purchaseEnvelope()) as DomainEnvelopeInput;
      const firstOperation = first.operations[0] as unknown as Record<string, unknown>;
      firstOperation.nutrition_sources = [{
        source_type: "product_label",
        source_ref: "label-brand-a-whole-250-v2",
        profile_version: 2,
        applicable_product_id: "product-milk-brand-a-whole-250ml",
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
      }];
      expect(previewAndExecute(service, first).result.status).toBe("committed");
      const second = structuredClone(first) as DomainEnvelopeInput;
      (second as unknown as Record<string, unknown>).envelope_id = "envelope-pantry-authority-002";
      (second as unknown as Record<string, unknown>).idempotency_key = "idem-pantry-authority-002";
      (second as unknown as Record<string, unknown>).source_message_id = "message-pantry-authority-002";
      const secondOperation = second.operations[0] as unknown as Record<string, unknown>;
      secondOperation.operation_id = "operation-pantry-authority-002";
      secondOperation.batch_id = "batch-pantry-authority-002";
      expect(previewAndExecute(service, second).result.status).toBe("committed");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_batches").get()).toEqual({ count: 2 });
      expect(runtime.database.prepare(
        "SELECT subject_id,profile_version,source_ref FROM nutrition_profiles",
      ).all()).toEqual([{
        subject_id: "product-milk-brand-a-whole-250ml",
        profile_version: "2",
        source_ref: "label-brand-a-whole-250-v2",
      }]);
    } finally {
      runtime.close();
    }
  });

  it("persists rule-labeled opening and expiration evidence without rewriting the source anchor", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:18:01.000Z",
      });
      const envelope = structuredClone(purchaseEnvelope()) as DomainEnvelopeInput;
      const operation = envelope.operations[0] as unknown as Record<string, unknown>;
      const evidence = operation.pantry_evidence as Record<string, unknown>;
      evidence.opening = {
        status: "opened",
        opened_at: "2026-08-14T16:00:00+08:00",
        evidence_kind: "rule",
        rule_version: "diet-manager/opening-evidence-v1",
      };
      evidence.expiration = {
        explicit_at: null,
        effective_at: "2026-08-15T16:00:00+08:00",
        basis: "rule",
        rule_version: "diet-manager/shelf-life-v1",
      };
      const committed = previewAndExecute(service, envelope).result;
      expect(committed.items[0]).toMatchObject({
        receipt_item: {
          stocked_at: envelope.received_at,
          opening: evidence.opening,
          expiration: evidence.expiration,
          inferred_fields: ["location", "opening", "expiration"],
        },
      });
      expect(runtime.database.prepare(
        `SELECT seal_status,expiry_status,effective_expiration_at
         FROM inventory_batch_projections WHERE batch_id = ?`,
      ).get("batch-pantry-authority-001")).toEqual({
        seal_status: "opened",
        expiry_status: "known",
        effective_expiration_at: "2026-08-15T16:00:00+08:00",
      });
    } finally {
      runtime.close();
    }
  });

  it("resumes a staged purchase from the immutable fact without duplicating business rows", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const envelope = purchaseEnvelope();
      const failing = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:19:01.000Z",
        fault: "after_inventory_business_writes",
      });
      const preview = failing.preview(envelope);
      expect(() => failing.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("INVENTORY_EFFECT_FAILED:after_business_writes");
      expect(runtime.database.prepare(
        "SELECT state,result_status FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id)).toEqual({
        state: "received",
        result_status: "preview_ready",
      });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 0 });
      const resumed = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:20:01.000Z",
      }).execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      });
      expect(resumed.status).toBe("committed");
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM event_records").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM products").get()).toEqual({ count: 1 });
      expect(runtime.database.prepare("SELECT COUNT(*) AS count FROM inventory_transactions").get()).toEqual({ count: 1 });
    } finally {
      runtime.close();
    }
  });

  it("rejects a schema-valid stored purchase-event evidence mutation on retry and query with zero added writes", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:20:01.000Z",
      });
      const envelope = purchaseEnvelope();
      const { preview } = previewAndExecute(service, envelope);
      const row = runtime.database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      ((payload.pantry_evidence as Record<string, unknown>).product_identity as Record<string, unknown>).brand = "brand-tampered";
      runtime.database.prepare(
        "UPDATE event_records SET payload_json = ? WHERE envelope_id = ?",
      ).run(canonicalJson(payload), envelope.envelope_id);
      const tampered = tableSnapshot(runtime.database);

      expect(() => service.execute({
        envelope,
        token: preview.token,
        input_digest: preview.input_digest,
        data_revision: preview.data_revision,
      })).toThrow("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_event_payload");
      expect(() => service.query({ kind: "query_inventory", operation_id: "query-tampered-purchase" })).toThrow(
        "INVENTORY_PROJECTION_INVALID:purchase_event_evidence",
      );
      expect(tableSnapshot(runtime.database)).toBe(tampered);
    } finally {
      runtime.close();
    }
  });

  it.each(["product", "batch", "projection"] as const)(
    "rejects a coordinated schema-valid %s evidence mutation on retry and query",
    (target) => {
      const root = newTestRoot();
      const runtime = openDietDatabase({ privateRuntimeRoot: root });
      try {
        const service = createDietDomainService({
          database: runtime.database,
          secret,
          now: () => "2026-08-14T08:30:01.000Z",
        });
        const envelope = purchaseEnvelope();
        const { preview } = previewAndExecute(service, envelope);
        if (target === "product") {
          const row = runtime.database.prepare(
            "SELECT payload_json FROM products WHERE product_id = ?",
          ).get("product-milk-brand-a-whole-250ml") as { payload_json: string };
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          const identity = payload.identity as Record<string, unknown>;
          identity.brand = "brand-tampered";
          payload.identity_fingerprint = productIdentityFingerprint(identity as never);
          runtime.database.prepare(
            "UPDATE products SET brand = ?, payload_json = ? WHERE product_id = ?",
          ).run("brand-tampered", canonicalJson(payload), "product-milk-brand-a-whole-250ml");
        } else if (target === "batch") {
          const row = runtime.database.prepare(
            "SELECT payload_json FROM inventory_batches WHERE batch_id = ?",
          ).get("batch-pantry-authority-001") as { payload_json: string };
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          (((payload.pantry_evidence as Record<string, unknown>).product_identity) as Record<string, unknown>).brand =
            "brand-tampered";
          runtime.database.prepare(
            "UPDATE inventory_batches SET payload_json = ? WHERE batch_id = ?",
          ).run(canonicalJson(payload), "batch-pantry-authority-001");
        } else {
          const row = runtime.database.prepare(
            "SELECT payload_json FROM inventory_batch_projections WHERE batch_id = ?",
          ).get("batch-pantry-authority-001") as { payload_json: string };
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          (((payload.pantry_evidence as Record<string, unknown>).product_identity) as Record<string, unknown>).brand =
            "brand-tampered";
          runtime.database.prepare(
            "UPDATE inventory_batch_projections SET payload_json = ? WHERE batch_id = ?",
          ).run(canonicalJson(payload), "batch-pantry-authority-001");
        }
        const tampered = tableSnapshot(runtime.database);
        expect(() => service.execute({
          envelope,
          token: preview.token,
          input_digest: preview.input_digest,
          data_revision: preview.data_revision,
        })).toThrow("PURCHASE_EFFECT_AUTHORITY_INVALID:terminal_business_payload");
        expect(() => service.query({
          kind: "query_inventory",
          operation_id: `query-tampered-${target}`,
        })).toThrow("INVENTORY_PROJECTION_INVALID:purchase_event_evidence");
        expect(tableSnapshot(runtime.database)).toBe(tampered);
      } finally {
        runtime.close();
      }
    },
  );

  it("rejects a public-hash purchase event and manifest forge without the private MAC", () => {
    const root = newTestRoot();
    const runtime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const service = createDietDomainService({
        database: runtime.database,
        secret,
        now: () => "2026-08-14T08:40:01.000Z",
      });
      const envelope = purchaseEnvelope();
      const committed = previewAndExecute(service, envelope);
      const eventRow = runtime.database.prepare(
        "SELECT payload_json FROM event_records WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const eventPayload = JSON.parse(eventRow.payload_json) as Record<string, unknown>;
      (((eventPayload.pantry_evidence as Record<string, unknown>).product_identity) as Record<string, unknown>).brand =
        "brand-public-forge";
      runtime.database.prepare(
        "UPDATE event_records SET payload_json = ? WHERE envelope_id = ?",
      ).run(canonicalJson(eventPayload), envelope.envelope_id);
      const productRow = runtime.database.prepare(
        "SELECT payload_json FROM products WHERE product_id = ?",
      ).get("product-milk-brand-a-whole-250ml") as { payload_json: string };
      const productPayload = JSON.parse(productRow.payload_json) as Record<string, unknown>;
      const productIdentity = productPayload.identity as Record<string, unknown>;
      productIdentity.brand = "brand-public-forge";
      productPayload.identity_fingerprint = productIdentityFingerprint(productIdentity as never);
      runtime.database.prepare(
        "UPDATE products SET brand = ?, payload_json = ? WHERE product_id = ?",
      ).run("brand-public-forge", canonicalJson(productPayload), "product-milk-brand-a-whole-250ml");
      for (const [table, idColumn] of [
        ["inventory_batches", "batch_id"],
        ["inventory_batch_projections", "batch_id"],
      ] as const) {
        const row = runtime.database.prepare(
          `SELECT payload_json FROM ${table} WHERE ${idColumn} = ?`,
        ).get("batch-pantry-authority-001") as { payload_json: string };
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        (((payload.pantry_evidence as Record<string, unknown>).product_identity) as Record<string, unknown>).brand =
          "brand-public-forge";
        runtime.database.prepare(
          `UPDATE ${table} SET payload_json = ? WHERE ${idColumn} = ?`,
        ).run(canonicalJson(payload), "batch-pantry-authority-001");
      }

      const previewRow = runtime.database.prepare(
        "SELECT payload_json FROM command_envelopes WHERE envelope_id = ?",
      ).get(envelope.envelope_id) as { payload_json: string };
      const previewPayload = JSON.parse(previewRow.payload_json) as Record<string, unknown>;
      const identities = previewPayload.purchase_fact_identities as Array<Record<string, unknown>>;
      const stableEventPayload = { ...eventPayload };
      delete stableEventPayload.progress_reservation;
      identities[0]!.payload_digest = canonicalSha256(stableEventPayload);
      const material = {
        authority_kind: "diet-manager/domain-preview/v4",
        input_digest: previewPayload.input_digest,
        meal_fact_identities: previewPayload.meal_fact_identities,
        purchase_fact_identities: identities,
      };
      (previewPayload.binding as Record<string, unknown>).preview_hash = canonicalSha256(material);
      runtime.database.prepare(
        "UPDATE command_envelopes SET payload_json = ? WHERE envelope_id = ?",
      ).run(canonicalJson(previewPayload), envelope.envelope_id);
      const forged = tableSnapshot(runtime.database);
      expect(() => service.execute({
        envelope,
        token: committed.preview.token,
        input_digest: committed.preview.input_digest,
        data_revision: committed.preview.data_revision,
      })).toThrow("PREVIEW_AUTHORITY_INVALID:binding");
      expect(() => service.query({
        kind: "query_inventory",
        operation_id: "query-public-purchase-forge",
      })).toThrow("INVENTORY_PROJECTION_INVALID:purchase_event_identity");
      expect(tableSnapshot(runtime.database)).toBe(forged);
    } finally {
      runtime.close();
    }
  });
});
