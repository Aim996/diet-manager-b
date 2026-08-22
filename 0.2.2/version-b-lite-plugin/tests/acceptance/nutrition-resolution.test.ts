import { canonicalSha256 } from "../../src/authority/canonical-json.js";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { afterEach, expect, it } from "vitest";

import {
  claimNutritionResolution,
  completeNutritionResolution,
  type ClaimInput,
  type NutritionPreviewMaterialV6,
} from "../../src/nutrition/resolution-claim.js";
import { MIGRATION_V1_TABLE_STATEMENTS } from "../../src/storage/migration-v1.js";

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as typeof import("node:sqlite");
const databases: DatabaseSyncType[] = [];

function database(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const statement of MIGRATION_V1_TABLE_STATEMENTS) db.exec(statement);
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

const secret = new Uint8Array(32).fill(7);

function input(db: DatabaseSync, owner: string, now: string, lease: string): ClaimInput {
  return {
    database: db,
    authority_secret: secret,
    envelope_id: "env-nutrition-001",
    idempotency_key: "idem-nutrition-001",
    operation_id: "operation-nutrition-001",
    base_input_digest: "A".repeat(64),
    source_message_id: "message-nutrition-001",
    conversation_id: "conversation-nutrition-001",
    source_config_digest: "B".repeat(64),
    owner_nonce: owner,
    now,
    lease_expires_at: lease,
  };
}

function material(energy: string): NutritionPreviewMaterialV6 {
  const nutritionEvidence = [{
    source_id: "public.usda_fooddata_central",
    source_type: "authoritative_public_database" as const,
    source_ref: "fdc:1",
    source_version: "2026.08",
    basis_kind: "per_100g" as const,
    basis_amount: "100",
    basis_unit: "g",
    nutrient_values: {
      energy_kcal: energy, protein_g: "3", fat_g: "1", carbohydrate_g: "20", fiber_g: "2",
      energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
    },
    field_evidence: [], coverage_status: "partial" as const,
    adopted_amount: "100", adopted_unit: "g", amount_range: null,
    formula: "profile_value * 100 / 100",
  }];
  return {
    authority_kind: "diet-manager/domain-preview/v6",
    base_input_digest: "A".repeat(64),
    resolved_evidence_digest: canonicalSha256(nutritionEvidence),
    source_config_digest: "B".repeat(64),
    operation_id: "operation-nutrition-001",
    source_message_id: "message-nutrition-001",
    conversation_id: "conversation-nutrition-001",
    meal_fact_identities: [],
    nutrition_evidence: nutritionEvidence,
    effect_identities: [],
  };
}

it("serializes one owner and reuses its authenticated dynamic evidence", () => {
  const db = database();
  const first = claimNutritionResolution(input(db, "owner-a", "2026-08-14T10:00:00.000Z", "2026-08-14T10:00:05.000Z"));
  const second = claimNutritionResolution(input(db, "owner-b", "2026-08-14T10:00:01.000Z", "2026-08-14T10:00:06.000Z"));
  expect(first).toMatchObject({ kind: "owner", generation: 1 });
  expect(second).toEqual({ kind: "pending", envelope_id: "env-nutrition-001", retry_after_ms: 4000 });

  const completed = completeNutritionResolution({
    database: db, authority_secret: secret, envelope_id: "env-nutrition-001",
    owner_nonce: "owner-a", generation: 1, material: material("116"), now: "2026-08-14T10:00:02.000Z",
  });
  expect(completed.won).toBe(true);
  const replay = claimNutritionResolution(input(db, "owner-b", "2026-08-14T10:00:03.000Z", "2026-08-14T10:00:08.000Z"));
  expect(replay.kind).toBe("complete");
  if (replay.kind === "complete") expect(replay.material.nutrition_evidence[0]?.nutrient_values.energy_kcal).toBe("116");

  expect(() => claimNutritionResolution({
    ...input(db, "owner-c", "2026-08-14T10:00:03.000Z", "2026-08-14T10:00:08.000Z"),
    base_input_digest: "C".repeat(64),
  })).toThrow("IDEMPOTENCY_CONFLICT:base_input_digest");
});

it("allows lease takeover and makes a late owner reuse the winner", () => {
  const db = database();
  claimNutritionResolution(input(db, "owner-a", "2026-08-14T10:00:00.000Z", "2026-08-14T10:00:01.000Z"));
  const takeover = claimNutritionResolution(input(db, "owner-b", "2026-08-14T10:00:02.000Z", "2026-08-14T10:00:07.000Z"));
  expect(takeover).toMatchObject({ kind: "owner", generation: 2 });
  completeNutritionResolution({
    database: db, authority_secret: secret, envelope_id: "env-nutrition-001",
    owner_nonce: "owner-b", generation: 2, material: material("130"), now: "2026-08-14T10:00:03.000Z",
  });
  const late = completeNutritionResolution({
    database: db, authority_secret: secret, envelope_id: "env-nutrition-001",
    owner_nonce: "owner-a", generation: 1, material: material("999"), now: "2026-08-14T10:00:04.000Z",
  });
  expect(late.won).toBe(false);
  expect(late.material.nutrition_evidence[0]?.nutrient_values.energy_kcal).toBe("130");
});
