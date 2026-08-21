import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { openDietDatabase } from "../../src/storage/database.js";

interface SeedResult {
  waterId: string;
  root: string;
  runtime: ReturnType<typeof createCoreRuntime>;
}

function seedWater(runtime: ReturnType<typeof createCoreRuntime>): { waterId: string } {
  const outcome = handleCoreRequest(runtime, {
    action: "record_water",
    source_text: "喝了500ml白水。",
    received_at: "2026-08-14T12:00:00+08:00",
    timezone: "Asia/Shanghai",
    operation_id: "operation-water-correction-seed-001",
    source_message_id: "message-water-correction-seed-001",
    conversation_id: "conversation-water-correction-001",
    prior_context: [],
  });
  expect(outcome.committed, JSON.stringify(outcome)).toBe(true);
  return { waterId: outcome.record_id };
}

it("reclassifies plain water as milk, removes the plain-water tally, and keeps the original immutable", () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-water-correction-${randomUUID()}-`));
  const runtime = createCoreRuntime({ officialDataRoot: root, now: () => "2026-08-14T12:00:01.000Z" });
  try {
    const { waterId } = seedWater(runtime);

    const before = openDietDatabase({ privateRuntimeRoot: root });
    const originalPayload = before.database.prepare(
      "SELECT payload_json FROM event_records WHERE event_id = ?",
    ).get(waterId) as { payload_json: string };
    before.close();

    const outcome = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "刚才那杯不是白水，是牛奶",
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "operation-water-classification-001",
      source_message_id: "message-water-classification-001",
      conversation_id: "conversation-water-correction-001",
      prior_context: [],
    });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      status: "committed",
      correction: { operation: "change_water_classification", target_event_id: waterId },
      progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
        key: "water_ml",
        current: { kind: "unknown" },
      })]) }],
    });

    const after = openDietDatabase({ privateRuntimeRoot: root });
    try {
      // The original water fact remains byte-identical (append-only, never overwritten).
      expect(after.database.prepare(
        "SELECT payload_json FROM event_records WHERE event_id = ?",
      ).get(waterId)).toEqual(originalPayload);

      // The reclassification does not append a second occurrence fact: no new
      // diet_meal row is written. Milk nutrition lives in the correction's
      // after_snapshot, not as an additional meal occurrence.
      const mealRows = after.database.prepare(
        `SELECT event_id FROM event_records
         WHERE conversation_id = ? AND event_type = 'diet_meal'`,
      ).all("conversation-water-correction-001") as Array<{ event_id: string }>;
      expect(mealRows.length).toBe(0);

      // The correction fact is appended as an append-only diet_correction using
      // the existing change_food_type schema value.
      const correctionRows = after.database.prepare(
        `SELECT operation, target_event_id, base_revision FROM correction_events
         WHERE target_event_id = ?`,
      ).all(waterId) as Array<{ operation: string; target_event_id: string; base_revision: number }>;
      expect(correctionRows.length).toBe(1);
      expect(correctionRows[0]).toMatchObject({
        operation: "change_food_type",
        target_event_id: waterId,
        base_revision: 1,
      });

      // The legacy plain-water tally returns to zero; the frozen six-metric
      // view separately keeps the milk's unverified water content unknown.
      const progress = after.database.prepare(
        `SELECT payload_json FROM daily_progress_snapshots
         WHERE date = ? AND timezone = 'Asia/Shanghai'
         ORDER BY generated_at DESC, progress_snapshot_id DESC LIMIT 1`,
      ).get("2026-08-14") as { payload_json: string } | undefined;
      expect(progress).toBeDefined();
      expect((JSON.parse(progress!.payload_json) as { nutrients: { water_ml_milli: number | null } })
        .nutrients.water_ml_milli).toBe(0);
    } finally {
      after.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
