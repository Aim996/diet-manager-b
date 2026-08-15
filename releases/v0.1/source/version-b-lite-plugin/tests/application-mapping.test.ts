import { describe, expect, it } from "vitest";

import casesCatalog from "../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../shared/acceptance-cases/fixtures/core-v1.json";
import type { CoreApplicationRequest } from "../src/contracts.js";
import { mapCoreCandidateToEnvelope } from "../src/application/mapping.js";
import { parseCoreCommand } from "../src/parser/parse-command.js";

function candidate(id: string, action: "record_meal" | "record_water") {
  const entry = casesCatalog.cases.find((value) => value.id === id)!;
  const environment = fixturesCatalog.environments.find(
    (value) => value.fixture_id === entry.setup.environment_fixture,
  )!;
  const request: CoreApplicationRequest = {
    action,
    source_text: entry.source_text,
    received_at: environment.clock,
    timezone: "Asia/Shanghai",
    operation_id: `operation-${id.toLowerCase()}`,
    source_message_id: `message-${id.toLowerCase()}`,
    conversation_id: "conversation-mapping",
    prior_context: entry.setup.prior_context,
  };
  const parsed = parseCoreCommand({
    source_text: request.source_text, received_at: request.received_at,
    timezone: request.timezone, operation_id: request.operation_id,
    source_message_id: request.source_message_id,
    conversation_id: request.conversation_id, prior_context: request.prior_context,
  });
  if (parsed.disposition !== "candidate") throw new Error("expected candidate");
  return { request, command: parsed.command };
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("Task 8 production parser-to-domain mapping", () => {
  it("maps and recursively freezes the exact catalog meal payload and item order", () => {
    const input = candidate("CASE-MEAL-001", "record_meal");
    const envelope = mapCoreCandidateToEnvelope(input.request, input.command);
    expectDeepFrozen(envelope);
    expect(envelope.received_at).toBe(input.request.received_at);
    expect(envelope.operations).toEqual([{
      kind: "record_meal", operation_id: input.request.operation_id,
      meal_slot: "早餐", location: "home", source_text: input.request.source_text,
      inventory_policy: {
        mode: "pantry_v2", missing_candidate_behavior: "skip_insufficient",
        rule_version: "diet-manager/pantry-allocation-v1",
      },
      items: [
        { normalized_name: "egg", item_type: "food", amount: { unit: "piece",
          observed_microunits: 2_000_000, nutrition_adoption_microunits: null,
          inventory_deduction_microunits: 2_000_000, template_reference_microunits: null,
          evidence: "explicit" }, nutrition_sources: [] },
        { normalized_name: "bread", item_type: "food", amount: { unit: "slice",
          observed_microunits: 2_000_000, nutrition_adoption_microunits: null,
          inventory_deduction_microunits: 2_000_000, template_reference_microunits: null,
          evidence: "explicit" }, nutrition_sources: [] },
        { normalized_name: "milk", item_type: "nutrition_drink", amount: { unit: "ml",
          observed_microunits: 250_000_000, nutrition_adoption_microunits: null,
          inventory_deduction_microunits: 250_000_000, template_reference_microunits: null,
          evidence: "explicit" }, nutrition_sources: [] },
      ],
      occurred_at: "2026-08-11T00:30:00.000Z",
      occurred_time: input.command.occurred_time,
      subject: input.command.subject,
    }]);
  });

  it("maps and recursively freezes exact water occurrence and amount evidence", () => {
    const input = candidate("CASE-WATER-001", "record_water");
    const envelope = mapCoreCandidateToEnvelope(input.request, input.command);
    expectDeepFrozen(envelope);
    expect(envelope.operations).toEqual([{
      kind: "record_water", operation_id: input.request.operation_id,
      source_text: input.request.source_text, plain_water_ml_milli: 500_000,
      amount_evidence: { raw_text: "喝了500ml白水", quantity: 500,
        unit: "ml", estimated: false },
      occurred_time: input.command.occurred_time,
    }]);
  });
});
