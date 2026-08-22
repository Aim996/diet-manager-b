import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { openDietDatabase } from "../../src/storage/database.js";

// DEC-030 C-3：set_goal 应用层端到端 —— 自然语言解析 → 映射 → 运行时落库
// goal_versions。与 domain 层测试互补，覆盖 parser 与 core-runtime 的 set_goal 接线。

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-set-goal-app-"));
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
  action: "set_profile" | "set_goal",
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
    conversation_id: "conversation-set-goal-app",
    prior_context: [],
  };
}

describe("DEC-030 C-3 set_goal application path", () => {
  it("parses a natural-language subset override and persists the merged goals", () => {
    const root = newRoot();
    let clock = "2026-08-12T04:00:01.000Z";
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => clock,
    });

    const profileOutcome = handleCoreRequest(
      runtime,
      request("set_profile", "身高180体重70公斤男30岁减脂", "operation-profile-app-001"),
    );
    expect(profileOutcome).toMatchObject({
      action: "set_profile",
      status: "committed",
      committed: true,
    });

    clock = "2026-08-12T04:00:02.000Z";
    const outcome = handleCoreRequest(
      runtime,
      request("set_goal", "热量目标1800千卡", "operation-goal-app-002"),
    );
    expect(outcome).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
      operation_id: "operation-goal-app-002",
      record_id: expect.any(String),
    });
    runtime.close();

    const dbRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const versions = dbRuntime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ? ORDER BY effective_from",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(versions.length).toBe(1);
      expect(JSON.parse(versions[0]!.payload_json as string)).toEqual({
        authority_kind: "diet-manager/goal-version/v1",
        goals: {
          energy_kcal: 1800,
          protein_g: null,
          fat_g: null,
          carbohydrate_g: null,
          fiber_g: null,
          water_ml: null,
        },
      });
    } finally {
      dbRuntime.close();
    }
  });

  it("parses a null clear and drops the dimension from the configured goals", () => {
    const root = newRoot();
    let clock = "2026-08-12T04:00:01.000Z";
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => clock,
    });

    handleCoreRequest(
      runtime,
      request("set_profile", "身高175体重68公斤", "operation-profile-app-003"),
    );

    clock = "2026-08-12T04:00:02.000Z";
    const outcome = handleCoreRequest(
      runtime,
      request("set_goal", "清除蛋白质目标", "operation-goal-app-004"),
    );
    expect(outcome).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
    });
    runtime.close();

    const dbRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const versions = dbRuntime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ? ORDER BY effective_from",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(versions.length).toBe(1);
      expect(JSON.parse(versions[0]!.payload_json as string)).toEqual({
        authority_kind: "diet-manager/goal-version/v1",
        goals: {
          energy_kcal: null,
          protein_g: null,
          fat_g: null,
          carbohydrate_g: null,
          fiber_g: null,
          water_ml: null,
        },
      });
    } finally {
      dbRuntime.close();
    }
  });

  it("commits natural calorie and protein-clear phrases into successive goal versions", () => {
    const root = newRoot();
    let clock = "2026-08-12T04:00:01.000Z";
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => clock,
    });

    const profileOutcome = handleCoreRequest(
      runtime,
      request("set_profile", "身高175体重68公斤", "operation-profile-natural-goal-001"),
    );
    expect(profileOutcome).toMatchObject({ status: "committed", committed: true });

    clock = "2026-08-12T04:00:02.000Z";
    const calorieOutcome = handleCoreRequest(
      runtime,
      request(
        "set_goal",
        "以后每天热量按1900大卡算就行。",
        "operation-goal-natural-calorie-002",
      ),
    );
    expect(calorieOutcome).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
    });
    expect(calorieOutcome).not.toMatchObject({ reason_code: "ACTION_CONFLICT" });

    clock = "2026-08-12T04:00:03.000Z";
    const clearOutcome = handleCoreRequest(
      runtime,
      request(
        "set_goal",
        "蛋白质这一栏暂时不用给我定。",
        "operation-goal-natural-clear-003",
      ),
    );
    expect(clearOutcome).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
    });
    expect(clearOutcome).not.toMatchObject({ reason_code: "ACTION_CONFLICT" });
    runtime.close();

    const dbRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const versions = dbRuntime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ? ORDER BY effective_from",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(versions).toHaveLength(2);
      const latest = JSON.parse(versions[1]!.payload_json as string) as {
        authority_kind: string;
        goals: Record<string, number | null>;
      };
      expect(latest.authority_kind).toBe("diet-manager/goal-version/v1");
      expect(latest.goals).toMatchObject({
        energy_kcal: 1900,
        protein_g: null,
      });
    } finally {
      dbRuntime.close();
    }
  });
});
