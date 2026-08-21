import { describe, expect, it } from "vitest";

import type {
  DietManagerOutcome,
  FrozenDateProgressV1,
  NutritionOutcomeItem,
} from "../../src/contracts.js";
import { buildReceiptRenderModel } from "../../src/domain/receipt-render-model.js";

const METRICS = [
  ["energy_kcal", "热量", "kcal", "400"],
  ["protein_g", "蛋白", "g", "20"],
  ["fat_g", "脂肪", "g", "10"],
  ["carbohydrate_g", "碳水", "g", "55"],
  ["fiber_g", "纤维", "g", null],
  ["water_ml", "饮水", "ml", "500"],
] as const;

function noGoalProgress(): FrozenDateProgressV1 {
  return {
    schema_version: "diet-manager/frozen-date-progress/v1",
    date: "2026-08-21",
    timezone: "Asia/Shanghai",
    goal_version_id: null,
    goal_notice: "目标未配置，进度条不可用。",
    metrics: METRICS.map(([key, displayName, unit, current]) => ({
      key,
      display_name: displayName,
      unit,
      current: current === null ? { kind: "unknown" as const } : { kind: "exact" as const, value: current },
      target: null,
      delta: { kind: "none" as const },
      percent: null,
      filled_cells: null,
      bar_text: null,
      increment_percent: null,
      increment_percent_text: null,
      coverage_status: current === null ? "unknown" as const : "known" as const,
      unknown_sources: current === null ? ["apple:fiber_g"] : [],
      unknown_source_count: current === null ? 1 : 0,
    })),
    generated_at: "2026-08-21T11:30:01.000Z",
    idempotency_key: "receipt-render-progress-001",
  };
}

function nutritionItem(
  index: number,
  source: NutritionOutcomeItem["source_label"],
): NutritionOutcomeItem {
  return {
    item_id: `item-${index}`,
    name: `item ${index}`,
    adopted_amount: "1",
    adopted_unit: "piece",
    amount_range: null,
    quantity_evidence: "explicit",
    source_label: source,
    coverage_status: source === "unknown" ? "unknown" : "complete",
    known_fields: source === "unknown" ? [] : ["energy_kcal"],
    missing_fields: source === "unknown" ? ["energy_kcal"] : [],
    estimated_fields: source === "estimate" ? ["energy_kcal"] : [],
  };
}

function ac005Outcome(): DietManagerOutcome {
  return {
    action: "record_meal",
    status: "committed_with_issues",
    committed: true,
    operation_id: "operation-receipt-ac005",
    record_id: "meal-receipt-ac005",
    nutrition_items: [
      nutritionItem(0, "field_inference"),
      nutritionItem(1, "field_inference"),
    ],
    receipt: {
      raw_text: "晚饭吃了两片全麦面包和一个苹果。",
      meal_slot: "dinner",
      items: [{
        item_id: "item-0",
        name: "全麦面包",
        quantity: 2,
        unit: "slice",
        derived: false,
        nutrition: { status: "complete", source: "field_inference" },
        inventory: {
          status: "matched",
          deducted_quantity: 1,
          deducted_unit: "slice",
          shortage_quantity: 1,
          message: "库存不足，已扣减现有量",
        },
      }, {
        item_id: "item-1",
        name: "苹果",
        quantity: 1,
        unit: "piece",
        derived: false,
        nutrition: { status: "complete", source: "field_inference" },
        inventory: {
          status: "skipped_insufficient",
          deducted_quantity: 0,
          deducted_unit: null,
          shortage_quantity: 1,
          message: "未匹配有效库存",
        },
      }],
    },
    progress: [noGoalProgress()],
  } as DietManagerOutcome;
}

describe("Task 11 receipt render model", () => {
  it("renders AC-005 with the approved concise body and one frozen six-metric block at the end", () => {
    const model = buildReceiptRenderModel(ac005Outcome());

    expect(model.body).toBe(
      "已记录晚饭：全麦面包 2 片、苹果 1 个。面包库存仅 1 片，已扣减，当前库存 0；苹果未匹配有效库存。",
    );
    expect(model.progress_blocks).toHaveLength(1);
    expect(model.progress_blocks[0]).toBe([
      "目标未配置，进度条不可用。",
      "🔥 热量 400 kcal",
      "🥩 蛋白 20 g",
      "🧈 脂肪 10 g",
      "🌾 碳水 55 g",
      "🥬 纤维 未知",
      "💧 饮水 500ml",
    ].join("\n"));
    expect(model.text).toBe(`${model.body}\n\n${model.progress_blocks[0]}`);
    expect(model.text.endsWith(model.progress_blocks[0]!)).toBe(true);
    expect(model.text.match(/🥩 蛋白/g)).toHaveLength(1);
    expect(model.text).not.toContain("蛋白质");
  });

  it("keeps the five approved nutrition-source labels concise and structured", () => {
    const outcome = {
      ...ac005Outcome(),
      nutrition_items: [
        nutritionItem(0, "explicit"),
        nutritionItem(1, "field_inference"),
        nutritionItem(2, "public_reference"),
        nutritionItem(3, "estimate"),
        nutritionItem(4, "unknown"),
      ],
    } as DietManagerOutcome;

    const model = buildReceiptRenderModel(outcome);

    expect(model.nutrition_source_labels.map(({ label }) => label)).toEqual([
      "包装营养表",
      "本地通用营养库",
      "互联网来源",
      "估算数据",
      "未知",
    ]);
    expect(model.body).not.toContain("营养");
  });

  it.each([
    [{ action: "record_meal", status: "failed", committed: false, error_code: "INVALID_REQUEST" }, "未记录：处理失败（INVALID_REQUEST）。"],
    [{ action: "record_meal", status: "ignored", committed: false, operation_id: "ignored-001", reason_code: "future_plan" }, "未记录：future_plan。"],
    [{ action: "record_meal", status: "needs_clarification", committed: false, operation_id: "clarify-001", reason_code: "amount_ambiguous", question: "请说明苹果吃了多少。" }, "尚未记录。请说明苹果吃了多少。"],
  ] as const)("does not show success or formal progress for %s", (outcome, expected) => {
    const model = buildReceiptRenderModel(outcome as DietManagerOutcome);

    expect(model.text).toBe(expected);
    expect(model.progress_blocks).toEqual([]);
    expect(model.text).not.toMatch(/已记录|已提交|[█░]{10}|🥩 蛋白/u);
  });
});
