import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";

// Regression for the real-env change_time failure. The gateway has NO nutrition
// adapters, so every food resolves to "unknown" (all-null nutrients), and multiple
// meals accumulate on a single date before a change_time correction runs.
//
// A change_time correction spans two affected_dates (source and target), producing
// two daily_progress_replacement effects. Their effect_id is a content hash
// (deriveDomainId), so `ORDER BY effect_id` is NOT monotonic in the affected_dates
// sequence. The envelope finalization and the applied-result re-read must therefore
// re-key the effects by date rather than trusting effect_id order; otherwise the
// authority comparison fails with ENVELOPE_FINALIZE_AUTHORITY_INVALID.
function createRuntime(root: string) {
  return createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-14T12:00:01.000Z",
    // No nutritionConfig / nutritionAdapters -> unknown nutrition, matching the gateway.
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
    conversation_id: "conversation-change-time-order",
    prior_context: [],
  });
}

it("commits a change_time correction spanning two dates with unknown nutrition and accumulated meals", async () => {
  const root = mkdtempSync(join(tmpdir(), `diet-manager-change-time-order-${randomUUID()}-`));
  const runtime = createRuntime(root);
  try {
    const meal1 = await seedMeal(runtime, "早餐吃了一个苹果。", "op-seed-1", "2026-08-14T08:00:00+08:00");
    expect(meal1.committed, JSON.stringify(meal1)).toBe(true);

    const meal2 = await seedMeal(runtime, "吃了两个鸡蛋。", "op-seed-2", "2026-08-14T09:00:00+08:00");
    expect(meal2.committed, JSON.stringify(meal2)).toBe(true);

    const meal3 = await seedMeal(runtime, "吃了150克米饭。", "op-seed-3", "2026-08-14T12:00:00+08:00");
    expect(meal3.committed, JSON.stringify(meal3)).toBe(true);

    // Move the latest meal to yesterday dinner: affected_dates = [today, yesterday],
    // whose replacement effect_ids happen to sort in reverse order for this key.
    const outcome = handleCoreRequest(runtime, {
      action: "correct_record",
      source_text: "刚才那顿其实是昨天晚饭。",
      received_at: "2026-08-14T12:05:00+08:00",
      timezone: "Asia/Shanghai",
      operation_id: "op-repro-correction-1",
      source_message_id: "message-op-repro-correction-1",
      conversation_id: "conversation-change-time-order",
      prior_context: [],
    });
    expect(outcome.status).toBe("committed");
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: false });
  }
});
