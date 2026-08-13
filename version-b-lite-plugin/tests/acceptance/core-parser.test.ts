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

const PARSER_ORACLE_IDS = Object.freeze([
  "CASE-MEAL-001", "CASE-MEAL-021", "CASE-MEAL-017", "CASE-MEAL-009",
  "CASE-WATER-001", "CASE-SCOPE-001", "CASE-MEAL-002", "CASE-PURCHASE-004",
  "CASE-MEAL-010", "CASE-MEAL-011", "CASE-MEAL-012", "CASE-MEAL-013",
  "CASE-MEAL-014", "CASE-MEAL-015", "CASE-MEAL-016", "CASE-MEAL-018",
  "CASE-MEAL-019", "CASE-MEAL-020", "CASE-WATER-003", "CASE-WATER-004",
] as const);

const REACHABILITY_ONLY_ID = "CASE-RECEIPT-002" as const;

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

function parserOracle(entry: CatalogCase) {
  const parsing = "parsing" in entry.oracle ? entry.oracle.parsing : undefined;
  const command = "command" in entry.oracle ? entry.oracle.command : undefined;
  if (parsing === undefined && command === undefined) {
    throw new Error(`CORE_PARSER_TEST_ORACLE_MISSING:${entry.id}`);
  }
  return { parsing, command };
}

function parserDisposition(entry: CatalogCase): string {
  const { parsing, command } = parserOracle(entry);
  if (parsing !== undefined && "disposition" in parsing) {
    return parsing.disposition;
  }
  if (command === undefined || !("status" in command)) {
    throw new Error(`CORE_PARSER_TEST_DISPOSITION_MISSING:${entry.id}`);
  }
  return command.status === "committed" ? "candidate" : command.status;
}

function commandIntent(entry: CatalogCase): string {
  const { command } = parserOracle(entry);
  if (command === undefined || !("intent" in command)) {
    throw new Error(`CORE_PARSER_TEST_INTENT_MISSING:${entry.id}`);
  }
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

  expect(result.command.action).toBe(expectedIntent);
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

const PARSER_ENFORCEABLE_FORBIDDEN = new Set<string>([
  "alternate_single_item_schema",
  "ambiguous_date_guessed",
  "automatic_weight_loss_advice",
  "banana_omitted",
  "cancelled_meal_recorded",
  "child_meal_recorded_as_self",
  "coffee_as_plain_water_event",
  "completed_fact_discarded",
  "cross_day_shifted_forward",
  "default_time_without_basis",
  "estimated_explicit_amount",
  "expired_company_scene_reused",
  "food_context_lost",
  "food_water_above_liquid_volume",
  "friend_share_recorded",
  "future_plan_recorded_as_fact",
  "group_total_assigned_to_self",
  "group_total_recorded_as_self",
  "host_clock_used",
  "host_timezone_used",
  "ingestion_time_used_as_expiration_anchor",
  "initial_reluctance_treated_as_final",
  "invented_explicit_expiration",
  "invented_user_fact",
  "liquid_recorded_twice",
  "meal_fact_discarded",
  "medical_diagnosis_generated",
  "milk_as_plain_water_event",
  "missing_expiration_coerced_to_received_at",
  "negated_egg_recorded",
  "negation_scope_reversed",
  "non_self_fact_recorded",
  "occurred_time_evidence_dropped",
  "omitted_subject_rejected",
  "plain_water_contribution_nonzero",
  "purchase_date_used_as_ingestion_date",
  "purchase_evidence_discarded",
  "received_date_silently_selected",
  "received_date_used_without_relative_resolution",
  "self_participation_discarded",
  "soup_as_plain_water_event",
  "soy_milk_as_plain_water_event",
  "subject_entity_created",
  "tea_as_plain_water_event",
  "unknown_amount_coerced_to_zero",
  "unknown_scene_skips_inventory_read",
  "unversioned_shelf_life_rule",
  "water_as_meal_event",
  "whole_utterance_rejected",
]);

const DEFERRED_FORBIDDEN = new Set<string>([
  "duplicate_hydration_contribution",
  "explicit_field_marked_as_estimate",
  "factual_data_deleted",
  "family_member_created",
  "forced_option_selection",
  "health_record_created",
  "inferred_field_without_evidence_label",
  "internal_id_in_receipt",
  "inventory_effect_created",
  "meal_event_created",
  "meal_event_created_before_clarification",
  "missing_meal_id",
  "non_self_fact_committed",
  "prior_candidate_committed",
  "progress_from_extra_query",
  "progress_not_last",
  "success_from_nonterminal_state",
  "success_receipt_visible",
  "unbounded_quick_options",
]);

function requiredCandidate(result: CoreParseResult) {
  expect(result.disposition).toBe("candidate");
  if (result.disposition !== "candidate") {
    throw new Error("CORE_PARSER_TEST_EXPECTED_CANDIDATE");
  }
  return result.command;
}

function requiredMeal(result: CoreParseResult) {
  const command = requiredCandidate(result);
  expect(command.action).toBe("record_meal");
  if (command.action !== "record_meal") {
    throw new Error("CORE_PARSER_TEST_EXPECTED_MEAL");
  }
  return command;
}

function requiredParsing(entry: CatalogCase) {
  const { parsing } = parserOracle(entry);
  if (parsing === undefined) {
    throw new Error(`CORE_PARSER_TEST_PARSING_MISSING:${entry.id}`);
  }
  return parsing;
}

function requiredParsingItems(entry: CatalogCase) {
  const parsing = requiredParsing(entry);
  if (!("items" in parsing) || parsing.items === undefined) {
    throw new Error(`CORE_PARSER_TEST_ITEMS_MISSING:${entry.id}`);
  }
  return parsing.items;
}

function requiredOccurredTime(entry: CatalogCase) {
  const parsing = requiredParsing(entry);
  if (!("occurred_time" in parsing) || parsing.occurred_time === undefined) {
    throw new Error(`CORE_PARSER_TEST_TIME_MISSING:${entry.id}`);
  }
  return parsing.occurred_time;
}

function assertIgnored(
  result: CoreParseResult,
  reasonCode: "unsupported_health_advice" | "non_self_subject" | "future_plan" | "not_occurred",
): void {
  expect(result).toMatchObject({
    disposition: "ignored",
    reason_code: reasonCode,
  });
}

function assertNutritionLiquid(result: CoreParseResult, normalizedName?: string): void {
  const command = requiredMeal(result);
  expect(command.liquid_classification).toMatchObject({
    plain_water: false,
    plain_water_contribution_ml: 0,
  });
  expect(Object.hasOwn(command, "plain_water_ml_milli")).toBe(false);
  if (normalizedName !== undefined) {
    expect(command.items.map((item) => item.normalized_name)).toContain(
      normalizedName,
    );
  }
}

function assertParserForbiddenToken(
  token: string,
  entry: CatalogCase,
  result: CoreParseResult,
): void {
  switch (token) {
    case "alternate_single_item_schema":
    case "invented_user_fact": {
      const command = requiredMeal(result);
      expect(Array.isArray(command.items)).toBe(true);
      expect(command.items).toEqual(requiredParsingItems(entry));
      return;
    }
    case "milk_as_plain_water_event":
      assertNutritionLiquid(result, "milk");
      return;
    case "soup_as_plain_water_event":
      assertNutritionLiquid(result, "soup");
      return;
    case "soy_milk_as_plain_water_event":
      assertNutritionLiquid(result, "soy_milk");
      return;
    case "coffee_as_plain_water_event":
      assertNutritionLiquid(result, "coffee");
      return;
    case "tea_as_plain_water_event":
      assertNutritionLiquid(result, "tea");
      return;
    case "omitted_subject_rejected": {
      const command = requiredMeal(result);
      expect(command.subject.resolution_basis).toBe("omitted_subject_default");
      return;
    }
    case "subject_entity_created": {
      const command = requiredMeal(result);
      expect(command.subject.subject_entity_created).toBe(false);
      return;
    }
    case "child_meal_recorded_as_self":
      assertIgnored(result, "non_self_subject");
      return;
    case "non_self_fact_recorded": {
      const command = requiredMeal(result);
      expect(command.subject.kind).toBe("self");
      return;
    }
    case "negated_egg_recorded":
    case "negation_scope_reversed": {
      const command = requiredMeal(result);
      expect(command.items).toEqual(requiredParsingItems(entry));
      expect(command.items.map((item) => item.normalized_name)).not.toContain("egg");
      expect(command.excluded_items).toMatchObject([
        { normalized_name: "egg", reason_code: "item_scoped_negation" },
      ]);
      return;
    }
    case "banana_omitted": {
      const command = requiredMeal(result);
      expect(command.items.map((item) => item.normalized_name)).toContain("banana");
      return;
    }
    case "whole_utterance_rejected":
    case "completed_fact_discarded":
    case "meal_fact_discarded":
      requiredCandidate(result);
      return;
    case "water_as_meal_event": {
      const command = requiredCandidate(result);
      expect(command.action).toBe("record_water");
      return;
    }
    case "estimated_explicit_amount": {
      const command = requiredCandidate(result);
      if (command.action !== "record_water") {
        throw new Error("CORE_PARSER_TEST_EXPECTED_WATER");
      }
      expect(command.amount_evidence.estimated).toBe(false);
      expect(command.plain_water_ml_milli).toBe(
        command.amount_evidence.quantity * 1_000,
      );
      return;
    }
    case "medical_diagnosis_generated":
    case "automatic_weight_loss_advice":
      assertIgnored(result, "unsupported_health_advice");
      return;
    case "purchase_date_used_as_ingestion_date": {
      const command = requiredMeal(result);
      expect(command.purchase_evidence?.affects_ingestion_date).toBe(false);
      expect(command.occurred_time.resolution_basis).toBe("default_received_at");
      return;
    }
    case "purchase_evidence_discarded": {
      const command = requiredMeal(result);
      expect(command.purchase_evidence).toEqual(
        (requiredParsing(entry) as { readonly purchase_evidence: unknown })
          .purchase_evidence,
      );
      return;
    }
    case "unknown_amount_coerced_to_zero": {
      const command = requiredMeal(result);
      const expectedItems = requiredParsingItems(entry);
      const unknownNames = expectedItems
        .filter((item) => item.quantity === null)
        .map((item) => item.normalized_name);
      expect(unknownNames.length).toBeGreaterThan(0);
      for (const name of unknownNames) {
        expect(command.items.find((item) => item.normalized_name === name))
          .toMatchObject({ quantity: null, unit: null, estimated: null });
      }
      return;
    }
    case "ingestion_time_used_as_expiration_anchor": {
      const command = requiredCandidate(result);
      if (command.action !== "add_inventory") {
        throw new Error("CORE_PARSER_TEST_EXPECTED_INVENTORY");
      }
      expect(command.expiration_resolution_basis).toBe("stocked_at");
      expect(command.ingestion_at).toBeNull();
      return;
    }
    case "missing_expiration_coerced_to_received_at": {
      const command = requiredCandidate(result);
      if (command.action !== "add_inventory") {
        throw new Error("CORE_PARSER_TEST_EXPECTED_INVENTORY");
      }
      expect(command.estimated_expires_at).not.toBe(command.received_at);
      return;
    }
    case "unversioned_shelf_life_rule": {
      const command = requiredCandidate(result);
      if (command.action !== "add_inventory") {
        throw new Error("CORE_PARSER_TEST_EXPECTED_INVENTORY");
      }
      expect(command.shelf_life_rule_version).toBe(
        requiredParsing(entry).time_anchors.rule_version,
      );
      return;
    }
    case "invented_explicit_expiration": {
      const command = requiredCandidate(result);
      if (command.action !== "add_inventory") {
        throw new Error("CORE_PARSER_TEST_EXPECTED_INVENTORY");
      }
      expect(Object.hasOwn(command, "explicit_expires_at")).toBe(false);
      expect(command.estimated_expires_at).toBe(
        requiredParsing(entry).time_anchors.estimated_expires_at,
      );
      return;
    }
    case "initial_reluctance_treated_as_final": {
      const command = requiredMeal(result);
      expect(command.completion_evidence).toMatchObject({
        initial_state: "reluctance",
        final_state: "completed",
      });
      return;
    }
    case "food_context_lost": {
      const command = requiredMeal(result);
      expect(command.items.map((item) => item.normalized_name)).toContain("egg");
      return;
    }
    case "host_timezone_used": {
      const command = requiredMeal(result);
      expect(command.occurred_time.timezone).toBe("Asia/Shanghai");
      return;
    }
    case "received_date_used_without_relative_resolution": {
      const command = requiredMeal(result);
      expect(command.occurred_time.resolution_basis).toBe(
        "relative_to_received_at",
      );
      return;
    }
    case "occurred_time_evidence_dropped": {
      const command = requiredMeal(result);
      expect(command.occurred_time).toEqual(requiredOccurredTime(entry));
      return;
    }
    case "cross_day_shifted_forward": {
      const command = requiredMeal(result);
      expect(command.occurred_time.resolved_start).toBe(
        requiredOccurredTime(entry).resolved_start,
      );
      return;
    }
    case "ambiguous_date_guessed":
    case "received_date_silently_selected":
      expect(result).toMatchObject({
        disposition: "needs_clarification",
        reason_code: "occurred_date_ambiguous",
        occurred_time: { resolved_start: null, resolved_end: null },
      });
      return;
    case "default_time_without_basis": {
      const command = requiredMeal(result);
      expect(command.occurred_time.resolution_basis).toBe("default_received_at");
      return;
    }
    case "host_clock_used": {
      const command = requiredMeal(result);
      expect(command.occurred_time.resolution_anchor).toBe(
        requiredOccurredTime(entry).resolution_anchor,
      );
      return;
    }
    case "future_plan_recorded_as_fact":
      assertIgnored(result, "future_plan");
      return;
    case "cancelled_meal_recorded":
      assertIgnored(result, "not_occurred");
      return;
    case "friend_share_recorded": {
      const command = requiredMeal(result);
      expect(command.subject.excluded_non_self_share_count).toBe(1);
      return;
    }
    case "group_total_recorded_as_self": {
      const command = requiredMeal(result);
      expect(command.items).toMatchObject([{ quantity: 1, unit: "bottle" }]);
      expect(command.subject.excluded_non_self_share_count).toBe(1);
      return;
    }
    case "group_total_assigned_to_self": {
      const command = requiredMeal(result);
      expect(command.group_amount_evidence?.assigned_to_self).toBe(false);
      expect(command.items).toMatchObject([
        { quantity: null, unit: null, estimated: null },
      ]);
      return;
    }
    case "self_participation_discarded": {
      const command = requiredMeal(result);
      expect(command.subject).toMatchObject({
        resolution_basis: "collective_self_participation",
        self_participated: true,
      });
      return;
    }
    case "expired_company_scene_reused": {
      const command = requiredMeal(result);
      expect(command.context).toMatchObject({
        scene: "unknown",
        expired_context_ids: ["context-meal-020-expired-v1"],
      });
      return;
    }
    case "unknown_scene_skips_inventory_read": {
      const command = requiredMeal(result);
      expect(command.context).toMatchObject({
        scene: "unknown",
        inventory_read: true,
      });
      return;
    }
    case "plain_water_contribution_nonzero": {
      const command = requiredMeal(result);
      expect(command.liquid_classification?.plain_water_contribution_ml).toBe(0);
      return;
    }
    case "liquid_recorded_twice": {
      const command = requiredMeal(result);
      expect(Object.hasOwn(command, "plain_water_ml_milli")).toBe(false);
      expect(command.items).toEqual(requiredParsingItems(entry));
      return;
    }
    case "food_water_above_liquid_volume": {
      const command = requiredMeal(result);
      const liquidVolume = command.items
        .filter((item) => item.kind === "nutritious_drink" && item.unit === "ml")
        .reduce((total, item) => total + (item.quantity ?? 0), 0);
      expect(command.liquid_classification?.food_water_upper_bound_ml)
        .toBeLessThanOrEqual(liquidVolume);
      return;
    }
    default:
      throw new Error(`CORE_PARSER_FORBIDDEN_ASSERTION_MISSING:${token}`);
  }
}

function assertParserForbidden(entry: CatalogCase, result: CoreParseResult): void {
  for (const token of entry.forbidden) {
    const parserClass = assertForbiddenClassification(token);
    if (parserClass) assertParserForbiddenToken(token, entry, result);
  }
}

function assertForbiddenClassification(token: string): boolean {
  const parserClass = PARSER_ENFORCEABLE_FORBIDDEN.has(token);
  const deferredClass = DEFERRED_FORBIDDEN.has(token);
  if (Number(parserClass) + Number(deferredClass) !== 1) {
    throw new Error(`CORE_PARSER_FORBIDDEN_CLASSIFICATION_INVALID:${token}`);
  }
  return parserClass;
}

function assertSelectedForbiddenClassification(): Readonly<{
  readonly unique: number;
  readonly parser: number;
  readonly deferred: number;
}> {
  const observed = new Set<string>();
  for (const id of SELECTED_IDS) {
    const entry = selectedCase(id);
    for (const token of entry.forbidden) observed.add(token);
    assertParserForbidden(entry, parseSelected(id));
  }
  const parser = [...observed].filter((token) =>
    PARSER_ENFORCEABLE_FORBIDDEN.has(token)
  ).length;
  const deferred = [...observed].filter((token) =>
    DEFERRED_FORBIDDEN.has(token)
  ).length;
  return Object.freeze({ unique: observed.size, parser, deferred });
}

describe("selected core command composition", () => {
  it("classifies every selected forbidden token exactly once", () => {
    expect(assertSelectedForbiddenClassification()).toEqual({
      unique: 68,
      parser: 49,
      deferred: 19,
    });
  });

  it("fails closed for an unknown or multiply classified forbidden token", () => {
    expect(() => assertForbiddenClassification("future_forbidden_token"))
      .toThrowError(
        "CORE_PARSER_FORBIDDEN_CLASSIFICATION_INVALID:future_forbidden_token",
      );

    DEFERRED_FORBIDDEN.add("milk_as_plain_water_event");
    try {
      expect(() => assertForbiddenClassification("milk_as_plain_water_event"))
        .toThrowError(
          "CORE_PARSER_FORBIDDEN_CLASSIFICATION_INVALID:milk_as_plain_water_event",
        );
    } finally {
      DEFERRED_FORBIDDEN.delete("milk_as_plain_water_event");
    }
  });

  it("fails closed instead of defaulting a case without a parser Oracle", () => {
    const entry = selectedCase("CASE-RECEIPT-002");
    const result = parseSelected(entry.id);

    expect(() => assertParserOracle(entry, result)).toThrowError(
      "CORE_PARSER_TEST_ORACLE_MISSING:CASE-RECEIPT-002",
    );
  });

  it.each(PARSER_ORACLE_IDS)("matches the single catalog Oracle for %s", (id) => {
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

  it("keeps the non-Oracle receipt case reachable without creating an expected result", () => {
    const entry = selectedCase(REACHABILITY_ONLY_ID);

    expect(entry.id).toBe(REACHABILITY_ONLY_ID);
    const result = parseCoreCommand(parseInput(entry));
    expect(["candidate", "ignored", "needs_clarification"]).toContain(
      result.disposition,
    );
    if (result.disposition === "candidate") {
      expect(result.command.action).not.toBe("record_water");
    } else {
      expect(result.action).not.toBe("health_advice");
    }
    expectDeepFrozen(result);
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
