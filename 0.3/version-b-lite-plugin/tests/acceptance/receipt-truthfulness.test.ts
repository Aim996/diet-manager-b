import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreRuntime } from "../../src/application/runtime.js";
import { buildReceiptRenderModel } from "../../src/domain/receipt-render-model.js";
import { executeAgentCommand } from "../../src/public/execute.js";
import { buildPublicAdapterResult } from "../../src/public/receipt-adapter.js";
import { openDietDatabase } from "../../src/storage/database.js";
import type { DietManagerOutcome, FrozenDateProgressV1 } from "../../src/contracts.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: false });
    roots.delete(root);
  }
});

function testRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `diet-receipt-truth-${randomUUID()}-`));
  roots.add(root);
  return root;
}

function configuredProgress(): FrozenDateProgressV1 {
  const rows = [
    ["energy_kcal", "热量", "kcal", "1000", "2000", 50, "█████░░░░░"],
    ["protein_g", "蛋白", "g", "60", "100", 60, "██████░░░░"],
    ["fat_g", "脂肪", "g", "30", null, null, null],
    ["carbohydrate_g", "碳水", "g", "120", null, null, null],
    ["fiber_g", "纤维", "g", null, null, null, null],
    ["water_ml", "饮水", "ml", "500", "2500", 20, "██░░░░░░░░"],
  ] as const;
  return {
    schema_version: "diet-manager/frozen-date-progress/v1",
    date: "2026-08-21",
    timezone: "Asia/Shanghai",
    goal_version_id: "goal-v1",
    goal_notice: null,
    metrics: rows.map(([key, displayName, unit, current, target, percent, bar]) => ({
      key,
      display_name: displayName,
      unit,
      current: current === null ? { kind: "unknown" as const } : { kind: "exact" as const, value: current },
      target,
      delta: key === "energy_kcal"
        ? { kind: "exact" as const, value: "200" }
        : { kind: "none" as const },
      percent,
      filled_cells: bar === null ? null : bar.indexOf("░"),
      bar_text: bar,
      increment_percent: key === "energy_kcal" ? 10 : null,
      increment_percent_text: key === "energy_kcal" ? "+10%" : null,
      coverage_status: current === null ? "unknown" as const : "known" as const,
      unknown_sources: current === null ? ["meal:fiber_g"] : [],
      unknown_source_count: current === null ? 1 : 0,
    })),
    generated_at: "2026-08-21T12:00:01.000Z",
    idempotency_key: "receipt-adapter-progress-001",
  };
}

function committedWater(): DietManagerOutcome {
  return {
    action: "record_water",
    status: "committed",
    committed: true,
    operation_id: "operation-render-water-001",
    record_id: "water-render-001",
    progress: [configuredProgress()],
  };
}

describe("Task 11 truthful adapter receipt", () => {
  it("keeps AC-005 reply, tool details, and SQLite quantities in exact agreement", async () => {
    const root = testRoot();
    let clock = "2026-08-21T11:00:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => clock });
    const baseContext = {
      received_at: "2026-08-21T19:00:01+08:00",
      timezone: "Asia/Shanghai" as const,
      source_message_id: "message-receipt-stock-001",
      conversation_id: "conversation-receipt-truth",
      operation_id: "operation-receipt-stock-001",
    };
    const stock = await executeAgentCommand(runtime, {
      schema_version: "diet-manager/agent-command/v2",
      action: "add_inventory",
      source_text: "买了1片全麦面包",
      semantic_proposal: {
        kind: "inventory",
        product: { raw_name: "全麦面包", normalized_hint: "bread", evidence_span: "全麦面包" },
        package_amount: { kind: "exact", value: 1, unit: "片", evidence_span: "1片" },
        per_package_content: null,
        location: null,
        expires_at: null,
        price: null,
      },
    }, baseContext);
    if (!stock.committed) {
      runtime.close();
      throw new Error(`AC005_STOCK_SETUP_FAILED:${JSON.stringify(stock)}`);
    }
    expect(stock).toMatchObject({ status: "committed", committed: true });

    clock = "2026-08-21T11:00:02.000Z";
    const outcome = await executeAgentCommand(runtime, {
      schema_version: "diet-manager/agent-command/v2",
      action: "record_meal",
      source_text: "晚饭吃了两片全麦面包和一个苹果。",
      semantic_proposal: {
        kind: "meal",
        subject: {
          kind: "self",
          basis: "private_agent_default",
          evidence_span: null,
          explicit_other_spans: [],
        },
        occurrence: "completed",
        meal_slot: "dinner",
        items: [{
          raw_name: "全麦面包",
          normalized_hint: "bread",
          amount: { kind: "exact", value: 2, unit: "片", evidence_span: "两片全麦面包" },
        }, {
          raw_name: "苹果",
          normalized_hint: "apple",
          amount: { kind: "exact", value: 1, unit: "个", evidence_span: "一个苹果" },
        }],
        occurred_at: { kind: "source_text", evidence_span: "晚饭" },
      },
    }, {
      ...baseContext,
      received_at: "2026-08-21T19:00:02+08:00",
      source_message_id: "message-receipt-meal-002",
      operation_id: "operation-receipt-meal-002",
    });
    if (!outcome.committed) {
      runtime.close();
      throw new Error(`AC005_MEAL_FAILED:${JSON.stringify(outcome)}`);
    }
    const adapted = buildPublicAdapterResult(outcome);
    runtime.close();

    expect(outcome).toMatchObject({
      status: "committed_with_issues",
      committed: true,
      receipt: {
        meal_slot: "dinner",
        items: [{
          name: "bread",
          quantity: 2,
          unit: "片",
          inventory: {
            status: "matched",
            deducted_quantity: 1,
            shortage_quantity: 1,
          },
        }, {
          name: "apple",
          quantity: 1,
          unit: "个",
          inventory: {
            status: "skipped_insufficient",
            deducted_quantity: 0,
            shortage_quantity: 1,
          },
        }],
      },
    });
    expect(adapted.render_model.body).toBe(
      "已记录晚饭：全麦面包 2 片、苹果 1 个。面包库存仅 1 片，已扣减，当前库存 0；苹果未匹配有效库存。",
    );
    expect(adapted.content[0]!.text).toBe(adapted.render_model.text);

    const inspection = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(inspection.database.prepare(
        `SELECT normalized_name,
                json_extract(payload_json, '$.amount.observed_microunits') AS observed
         FROM meal_items WHERE event_id = ? ORDER BY item_order`,
      ).all((outcome as { record_id: string }).record_id)).toEqual([
        { normalized_name: "bread", observed: 2_000_000 },
        { normalized_name: "apple", observed: 1_000_000 },
      ]);
      expect(inspection.database.prepare(
        `SELECT unit, json_extract(payload_json, '$.quantity_delta_microunits') AS delta
         FROM inventory_transactions WHERE direction = 'out' ORDER BY rowid`,
      ).all()).toEqual([{ unit: "slice", delta: -1_000_000 }]);
      expect(inspection.database.prepare(
        `SELECT quantity_status, effective_status,
                json_extract(payload_json, '$.quantity_microunits') AS quantity
         FROM inventory_batch_projections`,
      ).get()).toEqual({ quantity_status: "empty", effective_status: "empty", quantity: 0 });
    } finally {
      inspection.close();
    }
  });

  it("uses the backend render model verbatim without adapter-added numbers or advice", () => {
    const outcome = committedWater();
    const backend = buildReceiptRenderModel(outcome);
    const adapted = buildPublicAdapterResult(outcome);

    expect(adapted.render_model).toBe(backend);
    expect(adapted.content).toEqual([{ type: "text", text: backend.text }]);
    expect(adapted.details).toBe(outcome);
    expect(adapted.content[0]!.text).toBe([
      "已记录饮水。",
      "",
      "🔥 热量 █████░░░░░ 50%",
      "🔥 1000 kcal / 2000 kcal｜+200 kcal +10%",
      "",
      "🥩 蛋白 ██████░░░░ 60%",
      "🥩 60 g / 100 g",
      "",
      "🧈 脂肪 目标未配置",
      "🧈 当前 30 g",
      "",
      "🌾 碳水 目标未配置",
      "🌾 当前 120 g",
      "",
      "🥬 纤维 目标未配置",
      "🥬 当前 未知",
      "",
      "💧 饮水 ██░░░░░░░░ 20%",
      "💧 500ml / 2500ml",
    ].join("\n"));
    expect(adapted.content[0]!.text).not.toMatch(/建议|加油|蛋白质/u);
  });

  it("states that a committed-with-issues meal was recorded and reports the actual inventory issue", () => {
    const outcome = {
      action: "record_meal",
      status: "committed_with_issues",
      committed: true,
      operation_id: "operation-render-issue-001",
      record_id: "meal-render-issue-001",
      receipt: {
        raw_text: "吃了一个苹果",
        meal_slot: "snack",
        items: [{
          item_id: "item-apple",
          name: "苹果",
          quantity: 1,
          unit: "piece",
          derived: false,
          nutrition: { status: "unknown", source: "unknown" },
          inventory: {
            status: "skipped_insufficient",
            deducted_quantity: 0,
            deducted_unit: null,
            shortage_quantity: 1,
            message: "未匹配有效库存",
          },
        }],
      },
      progress: [configuredProgress()],
    } as DietManagerOutcome;

    const model = buildReceiptRenderModel(outcome);

    expect(model.body).toBe("已记录加餐：苹果 1 个。苹果未匹配有效库存。");
    expect(model.text).toContain("已记录");
    expect(model.text).toContain("未匹配有效库存");
    expect(model.text.endsWith(model.progress_blocks[0]!)).toBe(true);
  });
});
