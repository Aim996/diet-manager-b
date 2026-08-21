import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveGoalRecommendation } from "../../src/domain/goal-recommendation.js";
import {
  createDietDomainService,
  type DietDomainService,
} from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

// Task 8：set_profile 领域写路径 —— user_profiles + pending 推荐落库，正式目标零写入。

const secret = Buffer.from("DEC-030 C-2 set_profile secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(
    tmpdir(),
    `diet-manager-b-set-profile-${randomUUID().replaceAll("-", "")}`,
  );
  mkdirSync(root, { recursive: false });
  ownedRoots.add(root);
  return root;
}

function removeOwnedRoot(root: string): void {
  if (!ownedRoots.delete(root)) throw new Error(`unregistered test root: ${root}`);
  rmSync(root, { recursive: true, force: false });
  expect(existsSync(root)).toBe(false);
}

afterEach(() => {
  for (const root of [...ownedRoots]) removeOwnedRoot(root);
});

function profileEnvelope(options: {
  suffix: string;
  heightCm: number;
  weightKg: number;
  sex?: "male" | "female" | null;
  age?: number | null;
  goalState?: "cut" | "maintain" | "bulk" | null;
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-profile-${options.suffix}`,
    idempotency_key: `idem-profile-${options.suffix}`,
    command_type: "set_profile",
    subject_scope: "user:self",
    source_message_id: `message-profile-${options.suffix}`,
    conversation_id: "conversation-profile-matrix",
    received_at: "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "set_profile",
        operation_id: `operation-profile-${options.suffix}`,
        height_cm: options.heightCm,
        weight_kg: options.weightKg,
        sex: options.sex ?? null,
        age: options.age ?? null,
        goal_state: options.goalState ?? null,
      },
    ],
  };
}

function previewAndExecute(service: DietDomainService, envelope: DomainEnvelopeInput) {
  const preview = service.preview(envelope);
  return service.execute({
    envelope,
    token: preview.token,
    input_digest: preview.input_digest,
    data_revision: preview.data_revision,
  });
}

interface Fixture {
  root: string;
  runtime: ReturnType<typeof openDietDatabase>;
  service: DietDomainService;
}

function createFixture(): Fixture {
  const root = newTestRoot();
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  const service = createDietDomainService({
    database: runtime.database,
    secret,
    now: () => "2026-08-12T04:00:01.000Z",
  });
  return { root, runtime, service };
}

describe("Task 8 set_profile domain write path", () => {
  it("persists a full profile and six pending recommendations", () => {
    const fixture = createFixture();
    try {
      const envelope = profileEnvelope({
        suffix: "cut-a",
        heightCm: 180,
        weightKg: 70,
        sex: "male",
        age: 30,
        goalState: "cut",
      });
      const result = previewAndExecute(fixture.service, envelope);

      expect(result.status).toBe("committed");
      expect(result.items.length).toBe(1);
      expect(result.items[0]).toMatchObject({
        sequence: 0,
        operation_id: "operation-profile-cut-a",
        status: "committed",
        error_code: null,
        fact_status: "committed",
      });

      const expectedRecommendation = deriveGoalRecommendation({
        height_cm: 180,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "cut",
      });

      const item = result.items[0] as Record<string, unknown>;
      expect(item.recommendation_goals).toEqual(expectedRecommendation.goals);
      expect(item.recommendation_basis).toEqual(expectedRecommendation.basis);
      expect(item.recommendation_status).toBe("pending");
      expect(item.profile_id).toEqual(expect.any(String));
      expect(item.recommendation_id).toEqual(expect.any(String));

      const profiles = fixture.runtime.database.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(profiles.length).toBe(1);
      const profile = profiles[0]!;
      expect(profile.height_cm).toBe(180);
      expect(profile.weight_kg).toBe(70);
      expect(profile.sex).toBe("male");
      expect(profile.age).toBe(30);
      expect(profile.goal_state).toBe("cut");
      expect(profile.schema_version).toBe("domain/v2");
      expect(profile.effective_to).toBeNull();
      expect(JSON.parse(profile.payload_json as string)).toEqual({
        authority_kind: "diet-manager/profile/v1",
        height_cm: 180,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "cut",
      });

      const goalVersions = fixture.runtime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(goalVersions).toHaveLength(0);
      const recommendations = fixture.runtime.database.prepare(
        "SELECT * FROM goal_recommendations WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]!.status).toBe("pending");
      expect(JSON.parse(recommendations[0]!.goals_json as string)).toEqual(expectedRecommendation.goals);
      expect(JSON.parse(recommendations[0]!.basis_json as string)).toEqual(expectedRecommendation.basis);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("does not invent omitted sex, age or goal_state in recommendations", () => {
    const fixture = createFixture();
    try {
      const envelope = profileEnvelope({
        suffix: "bare-a",
        heightCm: 175,
        weightKg: 68,
      });
      const result = previewAndExecute(fixture.service, envelope);

      expect(result.status).toBe("committed");

      const profiles = fixture.runtime.database.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(profiles.length).toBe(1);
      expect(profiles[0]!.sex).toBeNull();
      expect(profiles[0]!.age).toBeNull();
      expect(profiles[0]!.goal_state).toBeNull();

      const goalVersions = fixture.runtime.database.prepare(
        "SELECT * FROM goal_versions WHERE user_id = ?",
      ).all("user:self") as Array<Record<string, unknown>>;
      expect(goalVersions).toHaveLength(0);
      const recommendation = fixture.runtime.database.prepare(
        "SELECT goals_json, basis_json, status FROM goal_recommendations WHERE user_id = ?",
      ).get("user:self") as Record<string, unknown>;
      const expectedRecommendation = deriveGoalRecommendation({ height_cm: 175, weight_kg: 68 });
      expect(recommendation.status).toBe("pending");
      expect(JSON.parse(recommendation.goals_json as string)).toEqual(expectedRecommendation.goals);
      expect(JSON.parse(recommendation.basis_json as string)).toEqual(expectedRecommendation.basis);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });
});
