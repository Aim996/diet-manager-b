import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { assertDietManagerOutcome } from "../../src/contracts.js";

const roots = new Set<string>();

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "diet-manager-progress-v03-"));
  roots.add(value);
  return value;
}

afterEach(() => {
  for (const value of roots) {
    rmSync(value, { recursive: true, force: false });
    roots.delete(value);
  }
});

function request(
  action: "set_goal" | "record_meal" | "record_water" | "query_daily_summary" |
    "correct_record" | "undo_record" | "restore_record",
  sourceText: string,
  operationId: string,
  receivedAt = "2026-08-21T12:00:00+08:00",
) {
  return {
    action,
    source_text: sourceText,
    received_at: receivedAt,
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-progress-v03",
    prior_context: [],
  };
}

describe("Task 9 mandatory frozen six-metric progress", () => {
  it("returns all six metrics without invented bars when no formal goals exist", () => {
    const dataRoot = root();
    const runtime = createCoreRuntime({
      officialDataRoot: dataRoot,
      now: () => "2026-08-21T04:00:01.000Z",
    });
    const outcome = handleCoreRequest(runtime, request(
      "record_water",
      "喝了500毫升水",
      "operation-progress-no-goals-001",
    ));
    runtime.close();

    expect(assertDietManagerOutcome(outcome)).toBe(outcome);
    expect(outcome).toMatchObject({
      status: "committed",
      progress: [{
        schema_version: "diet-manager/frozen-date-progress/v1",
        date: "2026-08-21",
        goal_version_id: null,
        goal_notice: "目标未配置，进度条不可用。",
        metrics: [
          { key: "energy_kcal", target: null, percent: null, filled_cells: null, bar_text: null },
          { key: "protein_g", target: null, percent: null, filled_cells: null, bar_text: null },
          { key: "fat_g", target: null, percent: null, filled_cells: null, bar_text: null },
          { key: "carbohydrate_g", target: null, percent: null, filled_cells: null, bar_text: null },
          { key: "fiber_g", target: null, percent: null, filled_cells: null, bar_text: null },
          {
            key: "water_ml",
            current: { kind: "exact", value: "500" },
            target: null,
            delta: { kind: "exact", value: "500" },
            percent: null,
            filled_cells: null,
            bar_text: null,
          },
        ],
      }],
    });
  });

  it("freezes a configured bar once and omits increments from a read-only query", () => {
    const dataRoot = root();
    let clock = "2026-08-21T04:00:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: dataRoot, now: () => clock });
    expect(handleCoreRequest(runtime, request(
      "set_goal",
      "饮水目标1000毫升",
      "operation-progress-goal-001",
    ))).toMatchObject({ status: "committed" });
    clock = "2026-08-21T04:00:02.000Z";
    const write = handleCoreRequest(runtime, request(
      "record_water",
      "喝了500毫升水",
      "operation-progress-water-002",
      "2026-08-21T12:00:02+08:00",
    ));
    clock = "2026-08-21T04:00:03.000Z";
    const updatedGoal = handleCoreRequest(runtime, request(
      "set_goal",
      "饮水目标2000毫升",
      "operation-progress-goal-update-003",
      "2026-08-21T12:00:03+08:00",
    ));
    clock = "2026-08-21T04:00:04.000Z";
    const laterWrite = handleCoreRequest(runtime, request(
      "record_water",
      "喝了100毫升水",
      "operation-progress-water-later-004",
      "2026-08-21T12:00:04+08:00",
    ));
    const replay = handleCoreRequest(runtime, request(
      "record_water",
      "喝了500毫升水",
      "operation-progress-water-002",
      "2026-08-21T12:00:02+08:00",
    ));
    clock = "2026-08-21T04:00:05.000Z";
    const query = handleCoreRequest(runtime, request(
      "query_daily_summary",
      "查询今天进度",
      "operation-progress-query-005",
      "2026-08-21T12:00:05+08:00",
    ));
    runtime.close();

    expect(write).toMatchObject({ status: "committed", committed: true });
    expect(updatedGoal).toMatchObject({ status: "committed", committed: true });
    expect(laterWrite).toMatchObject({
      status: "committed",
      committed: true,
      progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
        key: "water_ml",
        target: "2000",
      })]) }],
    });
    expect(replay).toEqual(write);
    expect(write).toMatchObject({
      progress: [{
        goal_notice: null,
        metrics: expect.arrayContaining([expect.objectContaining({
          key: "water_ml",
          current: { kind: "exact", value: "500" },
          target: "1000",
          delta: { kind: "exact", value: "500" },
          percent: 50,
          filled_cells: 5,
          bar_text: "█████░░░░░",
          increment_percent: 50,
        }), expect.objectContaining({
          key: "energy_kcal",
          target: null,
          percent: null,
          filled_cells: null,
          bar_text: null,
        })]),
      }],
    });
    expect(query).toMatchObject({
      status: "ignored",
      reason_code: "read_only_result",
      progress: [{
        metrics: expect.arrayContaining([expect.objectContaining({
          key: "water_ml",
          current: { kind: "exact", value: "600" },
          target: "2000",
          delta: { kind: "none" },
          increment_percent: null,
        })]),
      }],
    });
  });

  it("keeps pure-water nutrients known and turns an unknown nutritious drink into a water lower bound", () => {
    const dataRoot = root();
    let clock = "2026-08-21T04:10:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: dataRoot, now: () => clock });
    const water = handleCoreRequest(runtime, request(
      "record_water",
      "喝了500毫升水",
      "operation-progress-lower-water-001",
      "2026-08-21T12:10:01+08:00",
    ));
    clock = "2026-08-21T04:10:02.000Z";
    const drinks = handleCoreRequest(runtime, request(
      "record_meal",
      "喝了100毫升汤、100毫升豆浆、100毫升咖啡和100毫升茶。",
      "operation-progress-lower-drinks-002",
      "2026-08-21T12:10:02+08:00",
    ));
    runtime.close();

    expect(water).toMatchObject({
      status: "committed",
      progress: [{ metrics: expect.arrayContaining([
        expect.objectContaining({ key: "energy_kcal", current: { kind: "exact", value: "0" } }),
        expect.objectContaining({ key: "fiber_g", current: { kind: "exact", value: "0" } }),
      ]) }],
    });
    expect(drinks).toMatchObject({
      status: "committed_with_issues",
      progress: [{ metrics: expect.arrayContaining([
        expect.objectContaining({
          key: "fiber_g",
          current: { kind: "unknown" },
          coverage_status: "unknown",
        }),
        expect.objectContaining({
          key: "water_ml",
          current: { kind: "lower_bound", value: "500" },
          coverage_status: "known_min",
        }),
      ]) }],
    });
    expect(drinks.progress).toHaveLength(1);
    expect(assertDietManagerOutcome(drinks)).toBe(drinks);
  });

  it("removes and restores every known and unknown contribution of one mixed meal", () => {
    const dataRoot = root();
    let clock = "2026-08-21T04:20:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: dataRoot, now: () => clock });
    expect(handleCoreRequest(runtime, request(
      "record_water",
      "喝了500毫升水",
      "operation-progress-mixed-water-000",
      "2026-08-21T12:20:00+08:00",
    ))).toMatchObject({ status: "committed" });
    const meal = handleCoreRequest(runtime, request(
      "record_meal",
      "喝了100毫升汤、100毫升豆浆、100毫升咖啡和100毫升茶。",
      "operation-progress-mixed-meal-001",
      "2026-08-21T12:20:01+08:00",
    ));
    clock = "2026-08-21T04:20:02.000Z";
    const undo = handleCoreRequest(runtime, request(
      "undo_record",
      "撤销刚才那条饮食记录",
      "operation-progress-mixed-undo-002",
      "2026-08-21T12:20:02+08:00",
    ));
    clock = "2026-08-21T04:20:03.000Z";
    const restore = handleCoreRequest(runtime, request(
      "restore_record",
      "恢复刚才那条饮食记录",
      "operation-progress-mixed-restore-003",
      "2026-08-21T12:20:03+08:00",
    ));
    runtime.close();

    expect(meal).toMatchObject({ status: "committed_with_issues" });
    const originalWater = meal.progress?.[0]?.metrics.find((metric) => metric.key === "water_ml");
    expect(originalWater?.current).toEqual({ kind: "lower_bound", value: "500" });
    expect(originalWater?.unknown_source_count).toBeGreaterThan(1);
    expect(undo, JSON.stringify(undo)).toMatchObject({
      status: "committed",
      progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
        key: "water_ml",
        current: { kind: "exact", value: "500" },
        coverage_status: "known",
        unknown_source_count: 0,
      })]) }],
    });
    expect(restore).toMatchObject({
      status: "committed",
      progress: [{ metrics: expect.arrayContaining([expect.objectContaining({
        key: "water_ml",
        current: originalWater?.current,
        unknown_source_count: originalWater?.unknown_source_count,
      })]) }],
    });
  });

});
