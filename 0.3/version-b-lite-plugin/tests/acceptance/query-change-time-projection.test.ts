import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { listMealProjection } from "../../src/repository/query.js";
import { openDietDatabase } from "../../src/storage/database.js";

const SECRET_FILENAME = ".diet-manager-b.authority-secret";

// Regression for the real-env query failure after a change_time correction.
// A change_time correction moves a meal as a whole to a different date (e.g.
// "刚才那顿其实是昨天晚饭"), leaving event_records.occurred_at_text at the
// ORIGINAL date (the fact is immutable; the correction after_snapshot carries
// the effective occurred_at). The meal read-model must therefore filter by the
// EFFECTIVE occurred_at, not the original occurred_at_text, and must not treat
// the after_snapshot's diverged occurred_at/meal_slot as an authority fault.
function createRuntime(root: string) {
  return createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-14T12:00:01.000Z",
  });
}

async function seedMeal(
  runtime: ReturnType<typeof createCoreRuntime>,
  text: string,
  opId: string,
  at: string,
) {
  return handleCoreRequestAsync(runtime, {
    action: "record_meal",
    source_text: text,
    received_at: at,
    timezone: "Asia/Shanghai",
    operation_id: opId,
    source_message_id: `message-${opId}`,
    conversation_id: "conversation-query-change-time",
    prior_context: [],
  });
}

it("filters a change_time-corrected meal by its effective date, not the original", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-query-change-time-${randomUUID()}-`));
  const runtime = createRuntime(root);
  try {
    const meal = await seedMeal(runtime, "早餐吃了一个苹果。", "op-seed-1", "2026-08-14T08:00:00+08:00");
    expect(meal.committed, JSON.stringify(meal)).toBe(true);

    const correction = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "刚才那顿其实是昨天晚饭。",
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "op-correction-1",
      source_message_id: "message-op-correction-1",
      conversation_id: "conversation-query-change-time",
      prior_context: [],
    });
    expect(correction.status, JSON.stringify(correction)).toBe("committed");

    const db = openDietDatabase({ privateRuntimeRoot: root });
    const secret = readFileSync(join(root, SECRET_FILENAME));
    try {
      // The meal has been moved to yesterday dinner; today's projection must not
      // crash (regression: INVENTORY_PROJECTION_INVALID:meal_correction_snapshot)
      // and must be empty.
      const today = listMealProjection({
        database: db.database,
        authoritySecret: secret,
        date: "2026-08-14",
        timezone: "Asia/Shanghai",
      });
      expect(today).toEqual([]);

      const yesterday = listMealProjection({
        database: db.database,
        authoritySecret: secret,
        date: "2026-08-13",
        timezone: "Asia/Shanghai",
      });
      expect(yesterday).toHaveLength(1);
      expect(yesterday[0]).toMatchObject({ meal_slot: "晚餐" });
      expect(yesterday[0]!.occurred_at.slice(0, 10)).toBe("2026-08-13");
    } finally {
      db.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
