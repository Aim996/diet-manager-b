import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveSixGoals } from "../../src/domain/goal-derivation.js";
import {
  createDietDomainService,
  type DietDomainService,
} from "../../src/domain/service.js";
import type { DomainEnvelopeInput } from "../../src/domain/types.js";
import { openDietDatabase } from "../../src/storage/database.js";

// DEC-030 C-3：set_goal 领域写路径 —— 任意子集覆盖、null 清除、追加版本化、幂等。
// 直接以 DomainEnvelopeInput 驱动 preview → execute，验证 goal_versions 的写入与合并。

const secret = Buffer.from("DEC-030 C-3 set_goal secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(
    tmpdir(),
    `diet-manager-b-set-goal-${randomUUID().replaceAll("-", "")}`,
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
  receivedAt: string;
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
    conversation_id: "conversation-goal-matrix",
    received_at: options.receivedAt,
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

function setGoalEnvelope(options: {
  suffix: string;
  receivedAt: string;
  goals: Readonly<Record<string, number | null>>;
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-goal-${options.suffix}`,
    idempotency_key: `idem-goal-${options.suffix}`,
    command_type: "set_goal",
    subject_scope: "user:self",
    source_message_id: `message-goal-${options.suffix}`,
    conversation_id: "conversation-goal-matrix",
    received_at: options.receivedAt,
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "set_goal",
        operation_id: `operation-goal-${options.suffix}`,
        goals: options.goals,
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
  setClock: (iso: string) => void;
}

function createFixture(): Fixture {
  const root = newTestRoot();
  const runtime = openDietDatabase({ privateRuntimeRoot: root });
  let clock = "2026-08-12T04:00:00.000Z";
  const service = createDietDomainService({
    database: runtime.database,
    secret,
    now: () => clock,
  });
  return {
    root,
    runtime,
    service,
    setClock: (iso: string) => {
      clock = iso;
    },
  };
}

function goalVersions(
  fixture: Fixture,
): Array<Record<string, unknown>> {
  return fixture.runtime.database.prepare(
    "SELECT * FROM goal_versions WHERE user_id = ? ORDER BY effective_from",
  ).all("user:self") as Array<Record<string, unknown>>;
}

describe("DEC-030 C-3 set_goal domain write path", () => {
  it("merges an arbitrary subset onto current formal goals and versions the change", () => {
    const fixture = createFixture();
    try {
      fixture.setClock("2026-08-12T04:00:01.000Z");
      previewAndExecute(fixture.service, profileEnvelope({
        suffix: "base-a",
        receivedAt: "2026-08-12T04:00:01.000Z",
        heightCm: 180,
        weightKg: 70,
        sex: "male",
        age: 30,
        goalState: "cut",
      }));

      const derived = deriveSixGoals({
        height_cm: 180,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "cut",
      });

      fixture.setClock("2026-08-12T04:00:02.000Z");
      previewAndExecute(fixture.service, setGoalEnvelope({
        suffix: "confirm-a",
        receivedAt: "2026-08-12T04:00:02.000Z",
        goals: derived,
      }));

      fixture.setClock("2026-08-12T04:00:03.000Z");
      const result = previewAndExecute(fixture.service, setGoalEnvelope({
        suffix: "override-a",
        receivedAt: "2026-08-12T04:00:03.000Z",
        goals: { energy_kcal: 1800 },
      }));

      expect(result.status).toBe("committed");
      expect(result.items.length).toBe(1);
      expect(result.items[0]).toMatchObject({
        sequence: 0,
        operation_id: "operation-goal-override-a",
        status: "committed",
        error_code: null,
        fact_status: "committed",
      });

      const item = result.items[0] as Record<string, unknown>;
      expect(item.goal_version_id).toEqual(expect.any(String));
      expect(item.goals).toEqual({ ...derived, energy_kcal: 1800 });

      const versions = goalVersions(fixture);
      expect(versions.length).toBe(2);
      // 旧的正式版本已被本次更新关闭；pending 推荐从未成为版本。
      expect(versions[0]!.effective_to).toBe("2026-08-12T04:00:03.000Z");
      expect(JSON.parse(versions[0]!.payload_json as string)).toEqual({
        authority_kind: "diet-manager/goal-version/v1",
        goals: derived,
      });
      // 新版本（合并后）当前生效，effective_to 为空。
      expect(versions[1]!.effective_from).toBe("2026-08-12T04:00:03.000Z");
      expect(versions[1]!.effective_to).toBeNull();
      expect(JSON.parse(versions[1]!.payload_json as string)).toEqual({
        authority_kind: "diet-manager/goal-version/v1",
        goals: { ...derived, energy_kcal: 1800 },
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("clears a dimension with null and keeps the rest unchanged", () => {
    const fixture = createFixture();
    try {
      fixture.setClock("2026-08-12T04:00:01.000Z");
      previewAndExecute(fixture.service, profileEnvelope({
        suffix: "base-b",
        receivedAt: "2026-08-12T04:00:01.000Z",
        heightCm: 175,
        weightKg: 68,
      }));

      const derived = deriveSixGoals({ height_cm: 175, weight_kg: 68 });

      fixture.setClock("2026-08-12T04:00:02.000Z");
      previewAndExecute(fixture.service, setGoalEnvelope({
        suffix: "formal-b",
        receivedAt: "2026-08-12T04:00:02.000Z",
        goals: derived,
      }));

      fixture.setClock("2026-08-12T04:00:03.000Z");
      const result = previewAndExecute(fixture.service, setGoalEnvelope({
        suffix: "clear-b",
        receivedAt: "2026-08-12T04:00:03.000Z",
        goals: { protein_g: null },
      }));

      expect(result.status).toBe("committed");
      const item = result.items[0] as Record<string, unknown>;
      expect(item.goals).toEqual({ ...derived, protein_g: null });

      const versions = goalVersions(fixture);
      expect(versions.length).toBe(2);
      expect(JSON.parse(versions[1]!.payload_json as string)).toEqual({
        authority_kind: "diet-manager/goal-version/v1",
        goals: { ...derived, protein_g: null },
      });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("starts from an all-null baseline when no prior goals exist", () => {
    const fixture = createFixture();
    try {
      const result = previewAndExecute(fixture.service, setGoalEnvelope({
        suffix: "standalone-c",
        receivedAt: "2026-08-12T04:00:01.000Z",
        goals: { energy_kcal: 1800 },
      }));

      expect(result.status).toBe("committed");
      const item = result.items[0] as Record<string, unknown>;
      expect(item.goals).toEqual({
        energy_kcal: 1800,
        protein_g: null,
        fat_g: null,
        carbohydrate_g: null,
        fiber_g: null,
        water_ml: null,
      });

      const versions = goalVersions(fixture);
      expect(versions.length).toBe(1);
      expect(versions[0]!.effective_to).toBeNull();
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
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("replays the same set_goal envelope idempotently without appending a second version", () => {
    const fixture = createFixture();
    try {
      const envelope = setGoalEnvelope({
        suffix: "idem-d",
        receivedAt: "2026-08-12T04:00:01.000Z",
        goals: { energy_kcal: 1800 },
      });

      const first = previewAndExecute(fixture.service, envelope);
      expect(first.status).toBe("committed");

      const second = previewAndExecute(fixture.service, envelope);
      expect(second.status).toBe("committed");
      expect(second.items[0]).toEqual(first.items[0]);

      const versions = goalVersions(fixture);
      expect(versions.length).toBe(1);
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });
});
