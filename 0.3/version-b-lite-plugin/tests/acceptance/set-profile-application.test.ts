import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { deriveGoalRecommendation } from "../../src/domain/goal-recommendation.js";
import { openDietDatabase } from "../../src/storage/database.js";

// Task 8：set_profile 应用层端到端 —— 自然语言解析 → 映射 → 运行时落库
// user_profiles + pending goal_recommendations，且不自动写正式 goal_versions。

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-b-set-profile-app-"));
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

function request(sourceText: string, operationId: string) {
  return {
    action: "set_profile" as const,
    source_text: sourceText,
    received_at: "2026-08-12T12:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-set-profile-app",
    prior_context: [],
  };
}

describe("Task 8 set_profile application path", () => {
  it("commits a profile and persists six pending recommendations without active goals", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const outcome = handleCoreRequest(
      runtime,
      request("身高180体重70公斤男30岁减脂", "operation-profile-app-001"),
    );
    expect(outcome).toMatchObject({
      action: "set_profile",
      status: "committed",
      committed: true,
      operation_id: "operation-profile-app-001",
      record_id: expect.any(String),
    });
    runtime.close();

    const dbRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const profiles = dbRuntime.database.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(profiles.length).toBe(1);
      expect(profiles[0]).toMatchObject({
        height_cm: 180,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "cut",
        schema_version: "domain/v2",
      });

      const goalVersions = dbRuntime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(goalVersions).toHaveLength(0);
      const recommendations = dbRuntime.database.prepare(
        "SELECT * FROM goal_recommendations WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]!.status).toBe("pending");
      expect(JSON.parse(recommendations[0]!.goals_json as string)).toEqual(
        deriveGoalRecommendation({
          height_cm: 180,
          weight_kg: 70,
          sex: "male",
          age: 30,
          goal_state: "cut",
        }).goals,
      );
    } finally {
      dbRuntime.close();
    }
  });

  it("commits the real natural profile phrase without an action conflict", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-12T04:00:01.000Z",
    });
    const outcome = handleCoreRequest(
      runtime,
      request(
        "想开始减脂了，我28岁女生，175高，65公斤。",
        "operation-profile-app-natural-001",
      ),
    );
    expect(outcome).toMatchObject({
      action: "set_profile",
      status: "committed",
      committed: true,
      operation_id: "operation-profile-app-natural-001",
      record_id: expect.any(String),
    });
    expect(outcome).not.toMatchObject({ reason_code: "ACTION_CONFLICT" });
    runtime.close();

    const dbRuntime = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const profiles = dbRuntime.database.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({
        height_cm: 175,
        weight_kg: 65,
        sex: "female",
        age: 28,
        goal_state: "cut",
      });

      const goalVersions = dbRuntime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(goalVersions).toHaveLength(0);
      const recommendations = dbRuntime.database.prepare(
        "SELECT status FROM goal_recommendations WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(recommendations).toEqual([{ status: "pending" }]);
    } finally {
      dbRuntime.close();
    }
  });
});
