import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { deriveDomainId } from "../src/domain/identity.js";
import {
  createDietDomainService,
  type DietDomainService,
} from "../src/domain/service.js";
import type {
  DomainEnvelopeInput,
  MealItemInput,
  NutritionSourceCandidate,
} from "../src/domain/types.js";
import { resolveCorrectionTarget } from "../src/repository/correction-target.js";
import { openDietDatabase } from "../src/storage/database.js";

const secret = Buffer.from("B-SLICE-001 correction target secret 0001", "utf8");
const ownedRoots = new Set<string>();

function newTestRoot(): string {
  const root = join(tmpdir(), `diet-manager-b-correction-target-${randomUUID().replaceAll("-", "")}`);
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

function nutritionSource(sourceRef: string): NutritionSourceCandidate {
  return {
    source_type: "public_fixture",
    source_ref: sourceRef,
    profile_version: 1,
    applicable_product_id: null,
    basis_kind: "per_item",
    basis_microunits: 1_000_000,
    basis_unit: "piece",
    nutrients: {
      energy_kcal_milli: 100_000,
      protein_mg: 5_000,
      fat_mg: 2_000,
      carbohydrate_mg: 12_000,
      fiber_mg: null,
      water_ml_milli: null,
    },
  };
}

function mealItem(options: {
  name: string;
  sources: readonly NutritionSourceCandidate[];
  deducted?: number | null;
}): MealItemInput {
  return {
    normalized_name: options.name,
    item_type: "food",
    amount: {
      unit: "piece",
      observed_microunits: 1_000_000,
      nutrition_adoption_microunits: 1_000_000,
      inventory_deduction_microunits: options.deducted ?? null,
      template_reference_microunits: null,
      evidence: "explicit",
    },
    nutrition_sources: options.sources,
  };
}

function mealEnvelope(options: {
  suffix: string;
  conversationId: string;
  receivedAt?: string;
  name?: string;
  deducted?: number | null;
}): DomainEnvelopeInput {
  const name = options.name ?? "apple";
  return {
    envelope_id: `envelope-meal-${options.suffix}`,
    idempotency_key: `idem-meal-${options.suffix}`,
    command_type: "record_meal",
    subject_scope: "user:self",
    source_message_id: `message-meal-${options.suffix}`,
    conversation_id: options.conversationId,
    received_at: options.receivedAt ?? "2026-08-12T04:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "record_meal",
        operation_id: `operation-meal-${options.suffix}`,
        occurred_at: "2026-08-12T12:00:00.000Z",
        meal_slot: "lunch",
        location: "outside",
        items: [mealItem({
          name,
          sources: [nutritionSource(`fixture-${name}-${options.suffix}-v1`)],
          ...(options.deducted === undefined ? {} : { deducted: options.deducted }),
        })],
      },
    ],
  };
}

function undoEnvelope(options: {
  suffix: string;
  targetEventId: string;
  baseRevision: number;
}): DomainEnvelopeInput {
  return {
    envelope_id: `envelope-undo-${options.suffix}`,
    idempotency_key: `idem-undo-${options.suffix}`,
    command_type: "undo_record",
    subject_scope: "user:self",
    source_message_id: `message-undo-${options.suffix}`,
    conversation_id: "conversation-undo-matrix",
    received_at: "2026-08-12T06:00:00.000Z",
    timezone: "Asia/Shanghai",
    operations: [
      {
        kind: "undo_record",
        operation_id: `operation-undo-${options.suffix}`,
        target_event_id: options.targetEventId,
        base_revision: options.baseRevision,
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

function seedMeal(
  service: DietDomainService,
  envelope: DomainEnvelopeInput,
): string {
  expect(previewAndExecute(service, envelope).status).toBe("committed");
  return deriveDomainId("event", envelope.idempotency_key, 0);
}

describe("CORE-UNDO-001 correction target resolution", () => {
  it("resolves the latest meal in a conversation to its exact event id", () => {
    const fixture = createFixture();
    try {
      const meal = mealEnvelope({ suffix: "latest-a", conversationId: "conversation-a" });
      const mealId = seedMeal(fixture.service, meal);

      expect(resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "latest_meal_in_conversation" },
      })).toMatchObject({ target_event_id: mealId, base_revision: 1, active: true });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("resolves an explicit event_id reference for a meal in the same conversation", () => {
    const fixture = createFixture();
    try {
      const meal = mealEnvelope({ suffix: "explicit-a", conversationId: "conversation-a" });
      const mealId = seedMeal(fixture.service, meal);

      expect(resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "event_id", event_id: mealId },
      })).toMatchObject({ target_event_id: mealId, base_revision: 1, active: true });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects an event_id reference scoped to a different conversation", () => {
    const fixture = createFixture();
    try {
      const meal = mealEnvelope({ suffix: "cross-a", conversationId: "conversation-a" });
      const mealId = seedMeal(fixture.service, meal);

      expect(() => resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-b",
        reference: { kind: "event_id", event_id: mealId },
      })).toThrow("CORRECTION_TARGET_NOT_FOUND");
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a missing event_id reference", () => {
    const fixture = createFixture();
    try {
      expect(() => resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "event_id", event_id: "no-such-event-000" },
      })).toThrow("CORRECTION_TARGET_NOT_FOUND");
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("resolves a voided meal as inactive", () => {
    const fixture = createFixture();
    try {
      const meal = mealEnvelope({
        suffix: "void-a",
        conversationId: "conversation-a",
        deducted: 0,
      });
      const mealId = seedMeal(fixture.service, meal);
      expect(previewAndExecute(fixture.service, undoEnvelope({
        suffix: "void-a",
        targetEventId: mealId,
        baseRevision: 1,
      })).status).toBe("committed");

      expect(resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "event_id", event_id: mealId },
      })).toMatchObject({ target_event_id: mealId, active: false });
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects a tampered preview payload", () => {
    const fixture = createFixture();
    try {
      const meal = mealEnvelope({ suffix: "tampered-a", conversationId: "conversation-a" });
      const mealId = seedMeal(fixture.service, meal);
      fixture.runtime.database.prepare(
        "UPDATE command_envelopes SET payload_json = '{}' WHERE envelope_id = ?",
      ).run(meal.envelope_id);

      expect(() => resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "event_id", event_id: mealId },
      })).toThrow("CORRECTION_TARGET_INVALID:event_preview");
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });

  it("rejects an ambiguous latest reference when two meals share a received_at", () => {
    const fixture = createFixture();
    try {
      seedMeal(fixture.service, mealEnvelope({
        suffix: "ambiguous-one",
        conversationId: "conversation-a",
        receivedAt: "2026-08-12T04:00:00.000Z",
        name: "apple",
      }));
      seedMeal(fixture.service, mealEnvelope({
        suffix: "ambiguous-two",
        conversationId: "conversation-a",
        receivedAt: "2026-08-12T04:00:00.000Z",
        name: "banana",
      }));

      expect(() => resolveCorrectionTarget({
        database: fixture.runtime.database,
        authoritySecret: secret,
        conversationId: "conversation-a",
        reference: { kind: "latest_meal_in_conversation" },
      })).toThrow("CORRECTION_TARGET_AMBIGUOUS");
    } finally {
      fixture.runtime.close();
      removeOwnedRoot(fixture.root);
    }
  });
});
