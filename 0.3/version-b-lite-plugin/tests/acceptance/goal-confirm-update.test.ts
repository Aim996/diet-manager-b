import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleCoreRequest } from "../../src/application/command-handler.js";
import { createCoreRuntime } from "../../src/application/runtime.js";
import { assertDietManagerOutcome } from "../../src/contracts.js";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import {
  createGoalRecommendation,
  transitionGoalRecommendation,
} from "../../src/repository/goal-recommendation-repository.js";
import { openDietDatabase } from "../../src/storage/database.js";

const ownedRoots = new Set<string>();

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diet-manager-goal-recommendation-"));
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
  action: "set_profile" | "set_goal" | "query_daily_summary",
  sourceText: string,
  operationId: string,
) {
  return {
    action,
    source_text: sourceText,
    received_at: "2026-08-21T12:00:00+08:00",
    timezone: "Asia/Shanghai" as const,
    operation_id: operationId,
    source_message_id: `message-${operationId}`,
    conversation_id: "conversation-goal-recommendation",
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

describe("Task 8 recommendation confirmation and goal version updates", () => {
  it("parses one multi-goal confirmation and natural update phrases", () => {
    const { action: _confirmationAction, ...confirmation } = request(
      "set_goal",
      "热量就按每天1714千卡，蛋白质140克，脂肪70克，碳水131克，纤维24克，水2.45升吧。",
      "operation-goal-parser-confirm",
    );
    expect(parseCoreCommand(confirmation)).toMatchObject({
      disposition: "candidate",
      command: {
        action: "set_goal",
        goals: {
          energy_kcal: 1714,
          protein_g: 140,
          fat_g: 70,
          carbohydrate_g: 131,
          fiber_g: 24,
          water_ml: 2450,
        },
      },
    });
    const { action: _updateAction, ...update } = request(
      "set_goal",
      "热量目标调整为每天2100千卡，其他不变。",
      "operation-goal-parser-update",
    );
    expect(parseCoreCommand(update)).toMatchObject({
      disposition: "candidate",
      command: { action: "set_goal", goals: { energy_kcal: 2100 } },
    });
  });

  it.each([
    "热量目标2100克",
    "蛋白质目标2000大卡",
    "饮水目标60克",
    "脂肪目标60.555克",
    "热量目标2100千焦",
    "热量目标2100kJ",
    "热量目标2100k",
    "饮水目标2公斤",
    "饮水目标2kg",
  ])("fails closed when a goal has an incompatible unit or truncated number: %s", (sourceText) => {
    const { action: _action, ...input } = request(
      "set_goal",
      sourceText,
      `operation-goal-parser-invalid-${sourceText}`,
    );
    expect(parseCoreCommand(input)).toMatchObject({
      disposition: "needs_clarification",
      action: "set_goal",
      reason_code: "goal_incomplete",
    });
  });

  it("publishes a contract-valid five-slot recommendation for an incomplete profile", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:00:01.000Z",
    });
    const outcome = handleCoreRequest(runtime, request(
      "set_profile",
      "身高175体重68公斤",
      "operation-profile-partial-contract-001",
    ));
    runtime.close();

    expect(assertDietManagerOutcome(outcome)).toBe(outcome);
    expect(outcome).toMatchObject({
      status: "committed",
      goal_recommendation: {
        status: "pending",
        goals: {
          energy_kcal: null,
          protein_g: null,
          fat_g: expect.any(Number),
          carbohydrate_g: null,
          fiber_g: null,
        },
        unavailable_reasons: {
          energy_kcal: expect.any(String),
          protein_g: expect.any(String),
          carbohydrate_g: expect.any(String),
          fiber_g: expect.any(String),
          water_ml: expect.any(String),
        },
      },
    });
  });

  it("stores a complete profile as one pending recommendation without activating goals", () => {
    const root = newRoot();
    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:00:01.000Z",
    });
    const profileOutcome = handleCoreRequest(runtime, request(
      "set_profile",
      "身高180体重70公斤男30岁减脂",
      "operation-profile-pending-001",
    ));
    expect(assertDietManagerOutcome(profileOutcome)).toBe(profileOutcome);
    const { profile_saved: _profileSaved, ...profileWithoutSavedMarker } = profileOutcome as typeof profileOutcome & {
      profile_saved: unknown;
    };
    expect(() => assertDietManagerOutcome(profileWithoutSavedMarker)).toThrow(
      "DIET_MANAGER_OUTCOME_INVALID:profile_goal_details_status",
    );
    expect(profileOutcome).toMatchObject({
      status: "committed",
      committed: true,
      profile_saved: { profile_id: expect.any(String) },
      goal_recommendation: {
        recommendation_id: expect.any(String),
        status: "pending",
        goals: {
          energy_kcal: 1714,
          protein_g: 140,
          fat_g: 70,
          carbohydrate_g: 131,
          fiber_g: 24,
          water_ml: 2450,
        },
      },
    });
    runtime.close();

    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const recommendations = database.database.prepare(
        "SELECT * FROM goal_recommendations WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]).toMatchObject({ status: "pending", profile_version: expect.any(String) });
      expect(JSON.parse(recommendations[0]!.goals_json as string)).toEqual({
        energy_kcal: 1714,
        protein_g: 140,
        fat_g: 70,
        carbohydrate_g: 131,
        fiber_g: 24,
        water_ml: 2450,
      });
      expect(database.database.prepare(
        "SELECT COUNT(*) AS count FROM goal_versions WHERE user_id = ?",
      ).get("user:self")).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("confirms six recommended values in one version, replays idempotently, then updates only energy", () => {
    const root = newRoot();
    let clock = "2026-08-21T04:00:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => clock });

    expect(handleCoreRequest(runtime, request(
      "set_profile",
      "身高180体重70公斤男30岁减脂",
      "operation-profile-confirm-001",
    ))).toMatchObject({ status: "committed", committed: true });

    clock = "2026-08-21T04:00:02.000Z";
    const confirmRequest = request(
      "set_goal",
      "热量就按每天1714千卡，蛋白质140克，脂肪70克，碳水131克，纤维24克，水2.45升吧。",
      "operation-goal-confirm-002",
    );
    const first = handleCoreRequest(runtime, confirmRequest);
    expect(assertDietManagerOutcome(first)).toBe(first);
    const { goal_update: _goalUpdate, ...goalWithoutFrozenUpdate } = first as typeof first & {
      goal_update: unknown;
    };
    expect(() => assertDietManagerOutcome(goalWithoutFrozenUpdate)).toThrow(
      "DIET_MANAGER_OUTCOME_INVALID:goal_update_status",
    );
    expect(first).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
      goal_update: {
        goal_version_id: expect.any(String),
        effective_from: "2026-08-21T04:00:02.000Z",
        confirmed_recommendation_id: expect.any(String),
        previous_goals: NULL_GOALS,
        goals: {
          energy_kcal: 1714,
          protein_g: 140,
          fat_g: 70,
          carbohydrate_g: 131,
          fiber_g: 24,
          water_ml: 2450,
        },
      },
    });
    expect(handleCoreRequest(runtime, confirmRequest)).toEqual(first);

    clock = "2026-08-21T04:00:03.000Z";
    const update = handleCoreRequest(runtime, request(
      "set_goal",
      "热量目标改成每天2100千卡，其他不变。",
      "operation-goal-update-003",
    ));
    expect(assertDietManagerOutcome(update)).toBe(update);
    expect(update).toMatchObject({
      action: "set_goal",
      status: "committed",
      committed: true,
      goal_update: {
        effective_from: "2026-08-21T04:00:03.000Z",
        previous_goals: {
          energy_kcal: 1714,
          protein_g: 140,
          fat_g: 70,
          carbohydrate_g: 131,
          fiber_g: 24,
          water_ml: 2450,
        },
        goals: {
          energy_kcal: 2100,
          protein_g: 140,
          fat_g: 70,
          carbohydrate_g: 131,
          fiber_g: 24,
          water_ml: 2450,
        },
      },
    });
    expect(update).not.toMatchObject({ reason_code: "ACTION_CONFLICT" });
    runtime.close();

    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const recommendation = database.database.prepare(
        "SELECT status, confirmed_at FROM goal_recommendations WHERE user_id = ?",
      ).get("user:self") as Record<string, unknown>;
      expect(recommendation).toEqual({
        status: "confirmed",
        confirmed_at: "2026-08-21T04:00:02.000Z",
      });

      const versions = database.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ? ORDER BY effective_from",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({
        effective_from: "2026-08-21T04:00:02.000Z",
        effective_to: "2026-08-21T04:00:03.000Z",
      });
      expect(JSON.parse(versions[0]!.payload_json as string).goals).toEqual({
        energy_kcal: 1714,
        protein_g: 140,
        fat_g: 70,
        carbohydrate_g: 131,
        fiber_g: 24,
        water_ml: 2450,
      });
      expect(JSON.parse(versions[1]!.payload_json as string).goals).toEqual({
        energy_kcal: 2100,
        protein_g: 140,
        fat_g: 70,
        carbohydrate_g: 131,
        fiber_g: 24,
        water_ml: 2450,
      });
    } finally {
      database.close();
    }
  });

  it("keeps profile versions strictly monotonic across equal and rolled-back clocks", () => {
    const root = newRoot();
    let clock = "2026-08-21T04:00:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => clock });
    try {
      expect(handleCoreRequest(runtime, request(
        "set_profile",
        "身高175体重68公斤",
        "operation-profile-monotonic-001",
      ))).toMatchObject({ status: "committed" });
      expect(handleCoreRequest(runtime, request(
        "set_profile",
        "身高176体重69公斤",
        "operation-profile-monotonic-002",
      ))).toMatchObject({ status: "committed" });
      clock = "2026-08-21T04:00:00.000Z";
      expect(handleCoreRequest(runtime, request(
        "set_profile",
        "身高177体重70公斤",
        "operation-profile-monotonic-003",
      ))).toMatchObject({ status: "committed" });
    } finally {
      runtime.close();
    }

    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const versions = database.database.prepare(
        `SELECT effective_from, effective_to FROM user_profiles
         WHERE user_id = ? ORDER BY effective_from`,
      ).all("user:self") as Array<{ effective_from: string; effective_to: string | null }>;
      expect(versions).toHaveLength(3);
      expect(versions[0]!.effective_from).toBe("2026-08-21T04:00:01.000Z");
      expect(versions[1]!.effective_from).toBe("2026-08-21T04:00:01.001Z");
      expect(versions[2]!.effective_from).toBe("2026-08-21T04:00:01.002Z");
      expect(versions[0]!.effective_to).toBe(versions[1]!.effective_from);
      expect(versions[1]!.effective_to).toBe(versions[2]!.effective_from);
      expect(versions[2]!.effective_to).toBeNull();
    } finally {
      database.close();
    }
  });

  it("freezes strictly monotonic goal effective times across equal and rolled-back clocks", () => {
    const root = newRoot();
    let clock = "2026-08-21T04:00:01.000Z";
    const runtime = createCoreRuntime({ officialDataRoot: root, now: () => clock });
    const outcomes: unknown[] = [];
    try {
      outcomes.push(handleCoreRequest(runtime, request(
        "set_goal",
        "热量目标1800千卡",
        "operation-goal-monotonic-001",
      )));
      outcomes.push(handleCoreRequest(runtime, request(
        "set_goal",
        "热量目标1900千卡",
        "operation-goal-monotonic-002",
      )));
      clock = "2026-08-21T04:00:00.000Z";
      outcomes.push(handleCoreRequest(runtime, request(
        "set_goal",
        "热量目标2000千卡",
        "operation-goal-monotonic-003",
      )));
    } finally {
      runtime.close();
    }

    expect(outcomes).toMatchObject([
      { goal_update: { effective_from: "2026-08-21T04:00:01.000Z" } },
      { goal_update: { effective_from: "2026-08-21T04:00:01.001Z" } },
      { goal_update: { effective_from: "2026-08-21T04:00:01.002Z" } },
    ]);
    for (const outcome of outcomes) expect(assertDietManagerOutcome(outcome)).toBe(outcome);

    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const versions = database.database.prepare(
        `SELECT effective_from, effective_to FROM goal_versions
         WHERE user_id = ? ORDER BY effective_from`,
      ).all("user:self") as Array<{ effective_from: string; effective_to: string | null }>;
      expect(versions).toEqual([
        { effective_from: "2026-08-21T04:00:01.000Z", effective_to: "2026-08-21T04:00:01.001Z" },
        { effective_from: "2026-08-21T04:00:01.001Z", effective_to: "2026-08-21T04:00:01.002Z" },
        { effective_from: "2026-08-21T04:00:01.002Z", effective_to: null },
      ]);
    } finally {
      database.close();
    }
  });

  it("confirms a five-value recommendation in one formal version", () => {
    const root = newRoot();
    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      createGoalRecommendation(database.database, {
        recommendation_id: "recommendation-five-values",
        user_id: "user:self",
        profile_version: "profile-five-values",
        goals: {
          energy_kcal: 1800,
          protein_g: 120,
          fat_g: 60,
          carbohydrate_g: 180,
          fiber_g: 25,
        },
        basis: {
          authority_kind: "diet-manager/goal-recommendation-basis/v1",
          formula_version: "diet-manager/goal-recommendation-v1",
          unavailable_reasons: { water_ml: "profile_information_insufficient" },
        },
        created_at: "2026-08-21T04:00:01.000Z",
      });
    } finally {
      database.close();
    }

    const runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:00:02.000Z",
    });
    const outcome = handleCoreRequest(runtime, request(
      "set_goal",
      "热量就按每天1800千卡，蛋白质120克，脂肪60克，碳水180克，纤维25克。",
      "operation-goal-confirm-five-001",
    ));
    expect(outcome).toMatchObject({
      status: "committed",
      goal_update: {
        confirmed_recommendation_id: "recommendation-five-values",
        goals: {
          energy_kcal: 1800,
          protein_g: 120,
          fat_g: 60,
          carbohydrate_g: 180,
          fiber_g: 25,
          water_ml: null,
        },
      },
    });
    runtime.close();

    const verification = openDietDatabase({ privateRuntimeRoot: root });
    try {
      expect(verification.database.prepare(
        "SELECT status FROM goal_recommendations WHERE recommendation_id = ?",
      ).get("recommendation-five-values")).toEqual({ status: "confirmed" });
      expect(verification.database.prepare(
        "SELECT COUNT(*) AS count FROM goal_versions WHERE user_id = ?",
      ).get("user:self")).toEqual({ count: 1 });
    } finally {
      verification.close();
    }
  });

  it("never uses pending, rejected, or ignored recommendation values as formal progress goals", () => {
    const root = newRoot();
    let runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:00:01.000Z",
    });
    expect(handleCoreRequest(runtime, request(
      "set_profile",
      "身高180体重70公斤男30岁减脂",
      "operation-profile-reject-001",
    ))).toMatchObject({ status: "committed", committed: true });
    expect(handleCoreRequest(runtime, request(
      "query_daily_summary",
      "查询今天进度",
      "operation-query-pending-002",
    ))).toMatchObject({
      daily_progress: { configured_goals: NULL_GOALS },
    });
    runtime.close();

    const database = openDietDatabase({ privateRuntimeRoot: root });
    try {
      const pending = database.database.prepare(
        "SELECT recommendation_id, revision FROM goal_recommendations WHERE user_id = ?",
      ).get("user:self") as { recommendation_id: string; revision: number };
      transitionGoalRecommendation(database.database, {
        recommendation_id: pending.recommendation_id,
        expected_revision: pending.revision,
        status: "rejected",
        changed_at: "2026-08-21T04:00:02.000Z",
      });
    } finally {
      database.close();
    }

    runtime = createCoreRuntime({
      officialDataRoot: root,
      now: () => "2026-08-21T04:00:03.000Z",
    });
    expect(handleCoreRequest(runtime, request(
      "query_daily_summary",
      "查询今天进度",
      "operation-query-rejected-003",
    ))).toMatchObject({
      daily_progress: { configured_goals: NULL_GOALS },
    });
    runtime.close();
  });
});
