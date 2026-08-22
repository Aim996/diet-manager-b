import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";

// DEC-030 C-4：query_daily_summary 扩展 —— configured_goals + progress 计算（§17.6）。
// 以白水目标为确定性锚点（record_water 同步、量精确、无异步营养解析），
// 覆盖半格、超 100% 满格、未配置三种场景。

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-query-goal-"));
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
  action: "set_goal" | "record_water" | "query_daily_summary",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-12T12:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-query-goal",
    prior_context: [],
  };
}

const NULL_GOALS = {
  energy_kcal: null,
  protein_g: null,
  fat_g: null,
  carbohydrate_g: null,
  fiber_g: null,
  water_ml: null,
};

describe("DEC-030 C-4 query_daily_summary goal progress", () => {
  it("reports a half bar for a configured water goal", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    try {
      expect(handleCoreRequest(runtime, request(
        "set_goal", "饮水目标1000毫升", "operation-goal-001",
      ))).toMatchObject({ status: "committed" });
      expect(handleCoreRequest(runtime, request(
        "record_water", "喝了500ml白水", "operation-water-001",
      ))).toMatchObject({ status: "committed" });

      const outcome = handleCoreRequest(runtime, request(
        "query_daily_summary", "查询今天进度", "operation-query-001",
      ));
      expect(outcome).toMatchObject({
        status: "ignored",
        reason_code: "read_only_result",
        daily_progress: {
          configured_goals: { ...NULL_GOALS, water_ml: 1000 },
          progress: {
            water_ml: {
              current: 500,
              target: 1000,
              percentage: 50,
              filled_cells: 5,
              bar_text: "█████░░░░░",
            },
          },
        },
      });
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });

  it("reports a full bar with a truthful percentage over 100%", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    try {
      expect(handleCoreRequest(runtime, request(
        "set_goal", "饮水目标1000毫升", "operation-goal-002",
      ))).toMatchObject({ status: "committed" });
      expect(handleCoreRequest(runtime, request(
        "record_water", "喝了1500ml白水", "operation-water-002",
      ))).toMatchObject({ status: "committed" });

      const outcome = handleCoreRequest(runtime, request(
        "query_daily_summary", "查询今天进度", "operation-query-002",
      ));
      expect(outcome).toMatchObject({
        status: "ignored",
        reason_code: "read_only_result",
        daily_progress: {
          progress: {
            water_ml: {
              current: 1500,
              target: 1000,
              percentage: 150,
              filled_cells: 10,
              bar_text: "██████████",
            },
          },
        },
      });
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });

  it("reports all-null configured goals and no bars when nothing is configured", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    try {
      expect(handleCoreRequest(runtime, request(
        "record_water", "喝了500ml白水", "operation-water-003",
      ))).toMatchObject({ status: "committed" });

      const outcome = handleCoreRequest(runtime, request(
        "query_daily_summary", "查询今天进度", "operation-query-003",
      ));
      expect(outcome).toMatchObject({
        status: "ignored",
        reason_code: "read_only_result",
        daily_progress: {
          configured_goals: NULL_GOALS,
        },
      });
      const progress = (outcome as {
        daily_progress?: { progress?: Record<string, unknown> };
      }).daily_progress?.progress;
      expect(progress).toBeDefined();
      expect(Object.keys(progress!)).toEqual([]);
    } finally {
      runtime.close();
      removeRoot(root);
    }
  });
});
