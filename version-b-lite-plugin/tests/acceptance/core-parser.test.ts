import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import fixturesCatalog from "../../../shared/acceptance-cases/fixtures/core-v1.json";
import { parseCoreCommand } from "../../src/parser/parse-command.js";
import type { CoreParseResult } from "../../src/parser/types.js";

const SELECTED_IDS = Object.freeze([
  "CASE-MEAL-001", "CASE-MEAL-021", "CASE-MEAL-017", "CASE-MEAL-009",
  "CASE-WATER-001", "CASE-SCOPE-001", "CASE-MEAL-002", "CASE-PURCHASE-004",
  "CASE-RECEIPT-002", "CASE-MEAL-010", "CASE-MEAL-011", "CASE-MEAL-012",
  "CASE-MEAL-013", "CASE-MEAL-014", "CASE-MEAL-015", "CASE-MEAL-016",
  "CASE-MEAL-018", "CASE-MEAL-019", "CASE-MEAL-020", "CASE-WATER-003",
  "CASE-WATER-004",
] as const);

type CatalogCase = (typeof casesCatalog.cases)[number];

const byId = new Map(casesCatalog.cases.map((entry) => [entry.id, entry]));
const environments = new Map(
  fixturesCatalog.environments.map((entry) => [entry.fixture_id, entry]),
);

function selectedCase(id: string): CatalogCase {
  const entry = byId.get(id);
  if (entry === undefined) throw new Error(`missing selected case: ${id}`);
  return entry;
}

function parseInput(entry: CatalogCase) {
  const environment = environments.get(entry.setup.environment_fixture);
  if (environment === undefined) {
    throw new Error(`missing environment: ${entry.setup.environment_fixture}`);
  }
  return {
    source_text: entry.source_text,
    received_at: environment.clock,
    timezone: environment.timezone,
    operation_id: `operation-${entry.id.toLowerCase()}`,
    source_message_id: `message-${entry.id.toLowerCase()}`,
    conversation_id: "conversation-core-v1",
    prior_context: entry.setup.prior_context,
  };
}

function parseSelected(id: string): CoreParseResult {
  return parseCoreCommand(parseInput(selectedCase(id)));
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  if (!Array.isArray(value)) expect(Object.getPrototypeOf(value)).toBeNull();
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

function parserDisposition(entry: CatalogCase): string {
  const parsing = "parsing" in entry.oracle ? entry.oracle.parsing : undefined;
  if (parsing !== undefined && "disposition" in parsing) {
    return parsing.disposition;
  }
  const command = "command" in entry.oracle ? entry.oracle.command : undefined;
  return command !== undefined && "status" in command && command.status !== "committed"
    ? command.status
    : "candidate";
}

function commandIntent(entry: CatalogCase): string | undefined {
  const command = "command" in entry.oracle ? entry.oracle.command : undefined;
  if (command === undefined || !("intent" in command)) return undefined;
  return command.intent === "record_purchase" ? "add_inventory" : command.intent;
}

function assertParserOracle(entry: CatalogCase, result: CoreParseResult): void {
  expect(result.disposition).toBe(parserDisposition(entry));
  const expectedIntent = commandIntent(entry);

  if (result.disposition !== "candidate") {
    const parsing = "parsing" in entry.oracle ? entry.oracle.parsing : undefined;
    if (parsing !== undefined && "disposition" in parsing) {
      expect(result).toMatchObject(parsing);
    }
    return;
  }

  expect(result.command.action).toBe(expectedIntent ?? "record_meal");
  expect(result.command.operation_id).toBe(`operation-${entry.id.toLowerCase()}`);
  expect(result.command.source_text).toBe(entry.source_text);
  expect(result.command.parser_version).toBe("diet-manager/core-parser-v1");
  if (result.command.action === "record_meal") {
    expect(result.command.meal_identity_seed).toBe(result.command.operation_id);
  } else {
    expect(Object.hasOwn(result.command, "meal_identity_seed")).toBe(false);
  }

  const parsing = "parsing" in entry.oracle ? entry.oracle.parsing : undefined;
  if (parsing === undefined) return;
  if ("items" in parsing && parsing.items !== undefined) {
    expect("items" in result.command ? result.command.items : undefined).toEqual(
      parsing.items,
    );
  }
  if ("occurred_time" in parsing && parsing.occurred_time !== undefined) {
    expect("occurred_time" in result.command ? result.command.occurred_time : undefined)
      .toEqual(parsing.occurred_time);
  }
  if ("subject" in parsing && parsing.subject !== undefined) {
    expect("subject" in result.command ? result.command.subject : undefined)
      .toMatchObject(parsing.subject);
  }
  if ("completion_evidence" in parsing && parsing.completion_evidence !== undefined) {
    expect("completion_evidence" in result.command
      ? result.command.completion_evidence
      : undefined).toMatchObject(parsing.completion_evidence);
  }
  if ("excluded_items" in parsing && parsing.excluded_items !== undefined) {
    expect("excluded_items" in result.command ? result.command.excluded_items : undefined)
      .toMatchObject(parsing.excluded_items);
  }
  if ("group_amount_evidence" in parsing && parsing.group_amount_evidence !== undefined) {
    expect("group_amount_evidence" in result.command
      ? result.command.group_amount_evidence
      : undefined).toMatchObject(parsing.group_amount_evidence);
  }
  if ("purchase_evidence" in parsing && parsing.purchase_evidence !== undefined) {
    expect("purchase_evidence" in result.command
      ? result.command.purchase_evidence
      : undefined).toEqual(parsing.purchase_evidence);
  }
  if ("liquid_classification" in parsing && parsing.liquid_classification !== undefined) {
    expect("liquid_classification" in result.command
      ? result.command.liquid_classification
      : undefined).toEqual(parsing.liquid_classification);
  }
  if ("context" in parsing && parsing.context !== undefined) {
    expect("context" in result.command ? result.command.context : undefined)
      .toMatchObject(parsing.context);
  }
  if ("time_anchors" in parsing && parsing.time_anchors !== undefined) {
    expect(result.command).toMatchObject({
      action: "add_inventory",
      stocked_at: parsing.time_anchors.stocked_at,
      received_at: parsing.time_anchors.received_at,
      ingestion_at: parsing.time_anchors.ingestion_at,
      estimated_expires_at: parsing.time_anchors.estimated_expires_at,
      expiration_resolution_basis: parsing.time_anchors.expiration_resolution_basis,
      shelf_life_rule_version: parsing.time_anchors.rule_version,
    });
  }
}

function assertParserForbidden(entry: CatalogCase, result: CoreParseResult): void {
  const forbidden = new Set(entry.forbidden);
  if (forbidden.has("milk_as_plain_water_event")) {
    expect(result.disposition === "candidate" && result.command.action === "record_water")
      .toBe(false);
  }
  if (forbidden.has("unknown_amount_coerced_to_zero") && result.disposition === "candidate" && "items" in result.command) {
    for (const item of result.command.items) {
      if (item.quantity === null) expect(item.quantity).not.toBe(0);
    }
  }
  if (forbidden.has("group_total_assigned_to_self") && result.disposition === "candidate" && "items" in result.command) {
    expect(result.command.items.some((item) => item.quantity === 2)).toBe(false);
  }
  if (forbidden.has("expired_company_scene_reused") && result.disposition === "candidate" && "context" in result.command) {
    expect(result.command.context?.scene).not.toBe("company");
  }
  if (forbidden.has("plain_water_contribution_nonzero") && result.disposition === "candidate" && "liquid_classification" in result.command) {
    expect(result.command.liquid_classification?.plain_water_contribution_ml).toBe(0);
  }
  if (forbidden.has("purchase_date_used_as_ingestion_date") && result.disposition === "candidate" && "purchase_evidence" in result.command) {
    expect(result.command.purchase_evidence?.affects_ingestion_date).toBe(false);
  }
  if (forbidden.has("ingestion_time_used_as_expiration_anchor") && result.disposition === "candidate" && result.command.action === "add_inventory") {
    expect(result.command.expiration_resolution_basis).toBe("stocked_at");
    expect(result.command.ingestion_at).toBeNull();
  }
  if (forbidden.has("medical_diagnosis_generated")) {
    expect(result).toMatchObject({
      disposition: "ignored",
      action: "health_advice",
      reason_code: "unsupported_health_advice",
    });
  }
}

describe("selected core command composition", () => {
  it.each(SELECTED_IDS)("matches the single catalog Oracle for %s", (id) => {
    const entry = selectedCase(id);
    const input = parseInput(entry);
    const inputSnapshot = structuredClone(input);

    const first = parseCoreCommand(input);
    const replay = parseCoreCommand(input);

    assertParserOracle(entry, first);
    assertParserForbidden(entry, first);
    expect(replay).toEqual(first);
    expect(input).toEqual(inputSnapshot);
    expectDeepFrozen(first);
  });

  it("creates an explicit WaterEvent candidate only for CASE-WATER-001", () => {
    const entry = selectedCase("CASE-WATER-001");
    const result = parseSelected(entry.id);
    const water = "fact_commit" in entry.oracle && "water_event" in entry.oracle.fact_commit
      ? entry.oracle.fact_commit.water_event
      : undefined;
    if (water === undefined) throw new Error("missing water Oracle");

    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_water",
        plain_water_ml_milli: water.plain_water_ml * 1_000,
        amount_evidence: {
          quantity: water.plain_water_ml,
          unit: "ml",
          estimated: water.estimated,
        },
      },
    });
  });

  it("uses only authority-frozen operation identity as the stable meal seed", () => {
    const input = parseInput(selectedCase("CASE-MEAL-021"));
    const first = parseCoreCommand(input);
    const changedSource = parseCoreCommand({
      ...input,
      source_text: "吃了一个苹果。 ",
    });
    const changedOperation = parseCoreCommand({
      ...input,
      operation_id: `${input.operation_id}-changed`,
    });

    expect(first).toMatchObject({
      disposition: "candidate",
      command: { meal_identity_seed: input.operation_id },
    });
    expect(changedSource).toMatchObject({
      disposition: "candidate",
      command: { meal_identity_seed: input.operation_id },
    });
    expect(changedOperation).toMatchObject({
      disposition: "candidate",
      command: { meal_identity_seed: `${input.operation_id}-changed` },
    });
  });

  it("keeps receipt meal evidence reachable without inventing a catalog parsing Oracle", () => {
    const result = parseSelected("CASE-RECEIPT-002");

    expect(result).toMatchObject({
      disposition: "candidate",
      command: {
        action: "record_meal",
        items: [
          { order: 0, normalized_name: "rice", quantity: null },
          { order: 1, normalized_name: "chicken", quantity: 1, unit: "piece" },
        ],
      },
    });
  });

  it("lets ambiguous occurrence time win before omitted-subject fallback", () => {
    const result = parseSelected("CASE-MEAL-013");

    expect(result).toMatchObject({
      disposition: "needs_clarification",
      action: "record_meal",
      reason_code: "occurred_date_ambiguous",
    });
    expect(Object.hasOwn(result, "command")).toBe(false);
  });

  it("rejects non-ordinary input through the clone authority before parsing text", () => {
    let getterExecutions = 0;
    const input = parseInput(selectedCase("CASE-MEAL-021"));
    Object.defineProperty(input, "source_text", {
      enumerable: true,
      get() {
        getterExecutions += 1;
        return "吃了一个苹果。";
      },
    });

    expect(() => parseCoreCommand(input)).toThrowError(
      "CORE_INPUT_AUTHORITY_INVALID:input.source_text:descriptor",
    );
    expect(getterExecutions).toBe(0);
  });

  it("applies current-user subject authority before creating a water candidate", () => {
    const input = {
      ...parseInput(selectedCase("CASE-WATER-001")),
      source_text: "朋友喝了500ml白水。",
    };

    expect(parseCoreCommand(input)).toMatchObject({
      disposition: "ignored",
      action: "record_water",
      reason_code: "non_self_subject",
    });
  });

  it("never invents an empty meal candidate outside the bounded lexicon", () => {
    const input = {
      ...parseInput(selectedCase("CASE-MEAL-021")),
      source_text: "吃了。",
    };

    const result = parseCoreCommand(input);

    expect(result.disposition).toBe("needs_clarification");
    expect(Object.hasOwn(result, "command")).toBe(false);
  });
});
