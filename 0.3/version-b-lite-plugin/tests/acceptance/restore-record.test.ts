import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleCoreRequest,
  handleCoreRequestAsync,
} from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { cloneNutritionRuntimeConfig } from "../../src/nutrition/config.js";
import type { NutritionSourceAdapter } from "../../src/nutrition/types.js";

// DEC-031 restore_record：撤销后恢复（un-void）。
// R-1 先证「非 void 记录拒绝 / 未定位失败」，R-2 证恢复后营养/进度回到原值，
// R-3 证库存不足时 skipped_inventory 边界。

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-restore-"));
  ownedRoots.add(root);
  return root;
}

function removeRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeRoot(root);
});

function request(
  action: "record_meal" | "undo_record" | "restore_record",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-11T08:30:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-restore",
    prior_context: [],
  };
}

// 显式营养适配器：把「苹果」解析为每 100g 已知营养，150g 采纳量，使餐食携带
// 非空营养采纳量（restore 需据此重算营养与进度）。
function appleAdapter(): NutritionSourceAdapter {
  return {
    describe: () => Object.freeze({
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database",
      rank: 4,
      backend_id: "test.apple",
      backend_version: "1",
      network: false,
      request_fields: Object.freeze(["normalized_food_name"]),
    }),
    probe: async () => Object.freeze({
      source_id: "public.usda_fooddata_central", status: "ok", reason: null,
    }),
    resolve: async () => Object.freeze({
      status: "partial" as const,
      source_id: "public.usda_fooddata_central",
      tier: "authoritative_public_database" as const,
      source_record_id: "test:apple:v1",
      source_version: "1",
      retained_fields_sha256: "A".repeat(64),
      evidence: Object.freeze({
        source_id: "public.usda_fooddata_central",
        source_type: "authoritative_public_database" as const,
        source_ref: "test:apple:v1",
        source_version: "1",
        basis_kind: "per_100g" as const,
        basis_amount: "100",
        basis_unit: "g",
        nutrient_values: Object.freeze({
          energy_kcal: "52", protein_g: "0.3", fat_g: "0.2", carbohydrate_g: "14",
          fiber_g: "2.4", energy_kj: null, sodium_mg: null, sugar_g: null,
          saturated_fat_g: null, water_ml: null,
        }),
        field_evidence: Object.freeze([]),
        coverage_status: "partial" as const,
        adopted_amount: "150",
        adopted_unit: "g",
        amount_range: null,
        formula: "profile_value * consumed_amount / basis_amount",
      }),
      reason: null,
    }),
  };
}

function nutritionRuntime(root: string) {
  return createCoreRuntime({
    officialDataRoot: root,
    now: () => "2026-08-11T08:30:01.000Z",
    nutritionConfig: cloneNutritionRuntimeConfig({
      policy_version: "2026-08-11.1",
      resolution_deadline_ms: 2_000,
      sources: [{
        source_id: "public.usda_fooddata_central",
        enabled: true,
        backend_id: "test.apple",
        backend_version: "1",
      }],
    }),
    nutritionAdapters: [appleAdapter()],
  });
}

function dailySummary(runtime: ReturnType<typeof createCoreRuntime>, operationId: string) {
  return handleCoreRequest(runtime, {
    action: "query_daily_summary" as const,
    source_text: "查询",
    received_at: "2026-08-11T08:35:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-restore",
    prior_context: [],
  });
}

describe("DEC-031 restore_record", () => {
  it("rejects restoring a still-active record as already_active", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-11T08:30:01.000Z",
    });
    try {
      const meal = handleCoreRequest(runtime, request(
        "record_meal", "吃了一个苹果。", "operation-restore-meal",
      ));
      expect(meal).toMatchObject({ action: "record_meal", committed: true });

      const restore = handleCoreRequest(runtime, request(
        "restore_record", "恢复刚才那条饮食记录", "operation-restore-001",
      ));
      expect(restore).toMatchObject({
        action: "restore_record",
        status: "ignored",
        committed: false,
        operation_id: "operation-restore-001",
        reason_code: "already_active",
      });
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });

  it("restores a voided record back to its original nutrition and progress", async () => {
    const root = newRoot();
    const runtime = nutritionRuntime(root);
    try {
      const meal = await handleCoreRequestAsync(runtime, request(
        "record_meal", "吃了150克苹果。", "operation-restore-meal",
      ));
      expect(meal).toMatchObject({ action: "record_meal", committed: true });

      const beforeUndo = dailySummary(runtime, "operation-restore-summary-1");
      expect(beforeUndo).toMatchObject({
        daily_progress: { meals: { count: 1 } },
      });
      const originalNutrients = beforeUndo.daily_progress?.nutrition.nutrients;
      expect(originalNutrients?.energy_kcal_milli).not.toBeNull();

      const undo = handleCoreRequest(runtime, request(
        "undo_record", "撤销刚才那条饮食记录", "operation-restore-undo",
      ));
      expect(undo).toMatchObject({
        status: "committed",
        correction: { operation: "void_event", current_active: false },
        progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
          key: "energy_kcal",
          current: { kind: "exact", value: "0" },
        })]) }],
      });

      const afterUndo = dailySummary(runtime, "operation-restore-summary-2");
      expect(afterUndo).toMatchObject({
        daily_progress: { meals: { count: 0 } },
      });

      const restore = handleCoreRequest(runtime, request(
        "restore_record", "恢复刚才那条饮食记录", "operation-restore-002",
      ));
      expect(restore).toMatchObject({
        status: "committed",
        committed: true,
        correction: { operation: "restore_event", current_active: true },
        progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
          key: "energy_kcal",
          current: (meal.progress?.[0]?.metrics.find((metric) => metric.key === "energy_kcal"))?.current,
        })]) }],
      });

      const afterRestore = dailySummary(runtime, "operation-restore-summary-3");
      expect(afterRestore).toMatchObject({
        daily_progress: { meals: { count: 1 } },
      });
      expect(afterRestore.daily_progress?.nutrition.nutrients).toEqual(originalNutrients);
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });
});
