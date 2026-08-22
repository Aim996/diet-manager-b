import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleCoreRequestAsync } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import { openDietDatabase } from "../../src/storage/database.js";

const TARGET_EVENT_ID = "event-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

it("parses an explicit nutrition supplement target as a current-user correction", () => {
  const result = parseCoreCommand({
    source_text: `补充营养记录 ${TARGET_EVENT_ID}。`,
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-nutrition-supplement-001",
    source_message_id: "message-nutrition-supplement-001",
    conversation_id: "conversation-nutrition-supplement-001",
    prior_context: [],
  });

  expect(result).toEqual({
    disposition: "candidate",
    command: {
      action: "correct_record",
      operation_id: "operation-nutrition-supplement-001",
      parser_version: "diet-manager/core-parser-v1",
      kind: "nutrition_supplement",
      target_record_id: TARGET_EVENT_ID,
      target_date_text: null,
      target_item_text: null,
      source_text: `补充营养记录 ${TARGET_EVENT_ID}。`,
      subject: {
        kind: "self",
        resolution_basis: "omitted_subject_default",
        subject_entity_created: false,
        matched_span: null,
        rule_version: "diet-manager/subject-v1",
      },
    },
  });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.disposition === "candidate") {
    expect(Object.isFrozen(result.command)).toBe(true);
    expect(Object.isFrozen(result.command.subject)).toBe(true);
  }
});

it("appends a nutrition supplement fact and preserves the original unknown snapshot", async () => {
  let resolveCalls = 0;
  const adapter: NutritionSourceAdapter = {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.delayed-nutrition",
      backend_version: "1",
      network: false,
      request_fields: Object.freeze(["normalized_food_name"]),
    }),
    probe: async () => Object.freeze({
      source_id: "public.usda_fooddata_central", status: "ok", reason: null,
    }),
    resolve: async () => {
      resolveCalls += 1;
      if (resolveCalls === 1) {
        return Object.freeze({
          status: "no_results" as const,
          source_id: "public.usda_fooddata_central",
          tier: "authoritative_public_database" as const,
          source_record_id: null,
          source_version: "1",
          retained_fields_sha256: null,
          evidence: null,
          reason: "not_available_yet",
        });
      }
      return Object.freeze({
        status: "partial" as const,
        source_id: "public.usda_fooddata_central",
        tier: "authoritative_public_database" as const,
        source_record_id: "test:milk:v1",
        source_version: "1",
        retained_fields_sha256: "A".repeat(64),
        evidence: Object.freeze({
          source_id: "public.usda_fooddata_central",
          source_type: "authoritative_public_database" as const,
          source_ref: "test:milk:v1",
          source_version: "1",
          basis_kind: "per_100ml" as const,
          basis_amount: "100",
          basis_unit: "ml",
          nutrient_values: Object.freeze({
            energy_kcal: "64", protein_g: "3.2", fat_g: "3.2", carbohydrate_g: "4.8", fiber_g: null,
            energy_kj: null, sodium_mg: null, sugar_g: null, saturated_fat_g: null, water_ml: null,
          }),
          field_evidence: Object.freeze([]),
          coverage_status: "partial" as const,
          adopted_amount: null,
          adopted_unit: null,
          amount_range: null,
          formula: "profile_value * consumed_amount / basis_amount",
        }),
        reason: null,
      });
    },
  };
  const root = mkdtempSync(join(tmpdir(), `diet-manager-nutrition-supplement-${randomUUID()}-`));
  const runtime = createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-14T12:00:01.000Z",
    nutritionConfig: cloneNutritionRuntimeConfig({
      policy_version: "2026-08-14.1",
      resolution_deadline_ms: 2_000,
      sources: [{
        source_id: "public.usda_fooddata_central",
        enabled: true,
        backend_id: "test.delayed-nutrition",
        backend_version: "1",
      }],
    }),
    nutritionAdapters: [adapter],
  });
  try {
    const meal = await handleCoreRequestAsync(runtime, {
      action: "record_meal",
      source_text: "喝了250ml牛奶。",
      received_at: "2026-08-14T12:00:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-nutrition-unknown-001",
      source_message_id: "message-nutrition-unknown-001",
      conversation_id: "conversation-nutrition-supplement-001",
      prior_context: [],
    });
    expect(meal.committed, JSON.stringify(meal)).toBe(true);

    const supplementRequest = {
      action: "correct_record",
      source_text: `补充营养记录 ${meal.record_id}。`,
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-nutrition-supplement-002",
      source_message_id: "message-nutrition-supplement-002",
      conversation_id: "conversation-nutrition-supplement-001",
      prior_context: [],
    } as const;
    const supplement = await handleCoreRequestAsync(runtime, supplementRequest);
    expect(supplement.committed, JSON.stringify(supplement)).toBe(true);
    expect(supplement.record_id).not.toBe(meal.record_id);
    const replay = await handleCoreRequestAsync(runtime, supplementRequest);
    expect(replay).toEqual(supplement);
    expect(resolveCalls).toBe(2);

    const beforeNoopDatabase = openDietDatabase({ privateRuntimeRoot: root });
    const beforeNoop = beforeNoopDatabase.database.prepare(`SELECT
      (SELECT COUNT(*) FROM command_envelopes) AS envelopes,
      (SELECT COUNT(*) FROM idempotency_records) AS idempotency,
      (SELECT COUNT(*) FROM event_records) AS events,
      (SELECT COUNT(*) FROM correction_events) AS corrections,
      (SELECT COUNT(*) FROM nutrition_profiles) AS profiles,
      (SELECT COUNT(*) FROM nutrition_snapshots) AS snapshots`).get();
    beforeNoopDatabase.close();
    const alreadyCurrent = await handleCoreRequestAsync(runtime, {
      ...supplementRequest,
      operation_id: "operation-nutrition-supplement-003",
      source_message_id: "message-nutrition-supplement-003",
    });
    expect(alreadyCurrent).toMatchObject({
      status: "ignored",
      committed: false,
      reason_code: "nutrition_already_current",
    });
    expect(resolveCalls).toBe(2);

    const stored = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(stored.database.prepare(`SELECT
        (SELECT COUNT(*) FROM command_envelopes) AS envelopes,
        (SELECT COUNT(*) FROM idempotency_records) AS idempotency,
        (SELECT COUNT(*) FROM event_records) AS events,
        (SELECT COUNT(*) FROM correction_events) AS corrections,
        (SELECT COUNT(*) FROM nutrition_profiles) AS profiles,
        (SELECT COUNT(*) FROM nutrition_snapshots) AS snapshots`).get()).toEqual(beforeNoop);
      expect(stored.database.prepare(
        "SELECT event_type FROM event_records WHERE event_id = ?",
      ).get(supplement.record_id)).toEqual({ event_type: "nutrition_supplemented" });
      expect(stored.database.prepare(
        "SELECT operation FROM correction_events WHERE request_id = ?",
      ).get("operation-nutrition-supplement-002")).toEqual({ operation: "change_nutrition_source" });
      expect(stored.database.prepare(
        "SELECT COUNT(*) AS count FROM event_records WHERE event_type = 'nutrition_supplemented'",
      ).get()).toEqual({ count: 1 });
      const snapshots = stored.database.prepare(
        "SELECT source_ref FROM nutrition_snapshots WHERE meal_event_id = ? ORDER BY rowid",
      ).all(meal.record_id) as Array<{ source_ref: string }>;
      expect(snapshots.map((row) => row.source_ref)).toEqual([
        "unknown", "nutrition-source-registry:terminal.unknown", "test:milk:v1", "test:milk:v1",
      ]);
    } finally {
      stored.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
