import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import { classifyCompletion } from "../../src/parser/completion.js";
import {
  resolveSubject,
  type ProposedSubjectItem,
} from "../../src/parser/subject.js";

interface CatalogParsingItem {
  readonly order: number;
  readonly kind: "food" | "nutritious_drink";
  readonly normalized_name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly estimated: boolean | null;
}

interface CatalogExcludedItem {
  readonly normalized_name: string;
  readonly reason_code: "item_scoped_negation";
}

interface CatalogCompletionEvidence {
  readonly initial_state: "reluctance";
  readonly final_state: "completed";
  readonly winning_span: string;
}

interface CatalogSubjectEvidence {
  readonly kind: "self";
  readonly resolution_basis:
    | "omitted_subject_default"
    | "explicit_self_share"
    | "collective_self_participation";
  readonly subject_entity_created?: false;
  readonly excluded_non_self_share_count?: number;
  readonly self_participated?: true;
}

interface CatalogGroupAmountEvidence {
  readonly quantity: number;
  readonly unit: string;
  readonly assigned_to_self: false;
}

interface CatalogParsingOracle {
  readonly disposition: "candidate" | "ignored";
  readonly action?: "record_meal";
  readonly reason_code?: "non_self_subject" | "future_plan" | "not_occurred";
  readonly context_id?: string;
  readonly items?: readonly CatalogParsingItem[];
  readonly excluded_items?: readonly CatalogExcludedItem[];
  readonly completion_evidence?: CatalogCompletionEvidence;
  readonly subject?: CatalogSubjectEvidence;
  readonly group_amount_evidence?: CatalogGroupAmountEvidence;
}

interface CatalogCase {
  readonly id: string;
  readonly source_text: string;
  readonly oracle: {
    readonly parsing?: CatalogParsingOracle;
  };
}

const selectedCases = new Map(
  (casesCatalog.cases as readonly CatalogCase[]).map((entry) => [entry.id, entry]),
);

function catalogCase(id: string): CatalogCase {
  const entry = selectedCases.get(id);
  if (entry === undefined) throw new Error(`missing acceptance case: ${id}`);
  return entry;
}

function parsingOracle(id: string): CatalogParsingOracle {
  const parsing = catalogCase(id).oracle.parsing;
  if (parsing === undefined) throw new Error(`missing parsing oracle for ${id}`);
  return parsing;
}

function candidateOracle(id: string): CatalogParsingOracle & {
  readonly disposition: "candidate";
} {
  const parsing = parsingOracle(id);
  if (parsing.disposition !== "candidate") {
    throw new Error(`expected candidate oracle for ${id}`);
  }
  return parsing;
}

function adaptCatalogDisposition(
  oracle: CatalogParsingOracle,
  module: "completion" | "subject",
): "proceed" | "resolved" | "ignored" {
  if (oracle.disposition === "candidate") {
    return module === "completion" ? "proceed" : "resolved";
  }
  return oracle.disposition;
}

function ignoredDecisionOracle(id: string): {
  readonly disposition: "ignored";
  readonly action: "record_meal";
  readonly reason_code: "non_self_subject" | "future_plan" | "not_occurred";
} {
  const parsing = parsingOracle(id);
  if (
    parsing.disposition !== "ignored" ||
    parsing.action !== "record_meal" ||
    parsing.reason_code === undefined
  ) {
    throw new Error(`invalid ignored parsing oracle for ${id}`);
  }
  return {
    disposition: parsing.disposition,
    action: parsing.action,
    reason_code: parsing.reason_code,
  };
}

function requiredItems(id: string): readonly CatalogParsingItem[] {
  const items = candidateOracle(id).items;
  if (items === undefined) throw new Error(`missing item oracle for ${id}`);
  return items;
}

function requiredSubject(id: string): CatalogSubjectEvidence {
  const subject = candidateOracle(id).subject;
  if (subject === undefined) throw new Error(`missing subject oracle for ${id}`);
  return subject;
}

function subjectItemProjection(items: readonly ProposedSubjectItem[]) {
  return items.map((item) => ({
    normalized_name: item.normalized_name,
    quantity: item.amount_evidence.quantity,
    unit: item.amount_evidence.unit,
    estimated: item.amount_evidence.estimated,
  }));
}

function catalogItemProjection(items: readonly CatalogParsingItem[]) {
  return items.map((item) => ({
    normalized_name: item.normalized_name,
    quantity: item.quantity,
    unit: item.unit,
    estimated: item.estimated,
  }));
}

const TEST_ONLY_RAW_ITEM_LEXICON = Object.freeze([
  Object.freeze({ raw_text: "鸡蛋", normalized_name: "egg" }),
  Object.freeze({ raw_text: "牛奶", normalized_name: "milk" }),
  Object.freeze({ raw_text: "炒饭", normalized_name: "fried_rice" }),
]);

// This supplies only source-derived raw candidates to the subject stage. It
// intentionally carries no output-Oracle amount or subject/share decision.
function lexicalSeed(sourceText: string): readonly ProposedSubjectItem[] {
  return TEST_ONLY_RAW_ITEM_LEXICON
    .filter((entry) => sourceText.includes(entry.raw_text))
    .map((entry) => ({
      normalized_name: entry.normalized_name,
      raw_text: entry.raw_text,
      amount_evidence: {
        raw_text: null,
        quantity: null,
        unit: null,
        estimated: null,
      },
    }));
}

function withoutFinalPunctuation(sourceText: string): string {
  return sourceText.replace(/[。！!？?]+$/u, "");
}

function expectMatchedSpan(
  sourceText: string,
  evidence: {
    readonly rule_id: string;
    readonly raw: string;
    readonly start: number;
    readonly end: number;
    readonly rule_version: string;
  },
  expectedRuleId: string,
  expectedVersion: string,
): void {
  expect(evidence).toMatchObject({
    rule_id: expectedRuleId,
    rule_version: expectedVersion,
  });
  expect(evidence.start).toBeGreaterThanOrEqual(0);
  expect(evidence.end).toBeGreaterThan(evidence.start);
  expect(sourceText.slice(evidence.start, evidence.end)).toBe(evidence.raw);
}

describe("bounded completion rules", () => {
  it("keeps the completed item while exposing the item-scoped negation in CASE-MEAL-009", () => {
    const sourceText = catalogCase("CASE-MEAL-009").source_text;
    const oracle = candidateOracle("CASE-MEAL-009");
    if (oracle.excluded_items === undefined || oracle.items === undefined) {
      throw new Error("CASE-MEAL-009 requires items and excluded_items");
    }

    const result = classifyCompletion(sourceText);

    expect(result.disposition).toBe(
      adaptCatalogDisposition(oracle, "completion"),
    );
    if (result.disposition !== "proceed") throw new Error("expected proceed");
    expect(result.completion_evidence).toBe(oracle.completion_evidence ?? null);
    expect(result.excluded_items).toHaveLength(oracle.excluded_items.length);
    expect(result.excluded_items[0]).toMatchObject(oracle.excluded_items[0]);
    expect(oracle.items.map((item) => item.normalized_name)).not.toContain(
      oracle.excluded_items[0].normalized_name,
    );
    expectMatchedSpan(
      sourceText,
      result.excluded_items[0].matched_evidence,
      "completion.item-negation.egg",
      "diet-manager/completion-v1",
    );
  });

  it("lets the final completed fact beat prior reluctance in CASE-MEAL-010", () => {
    const sourceText = catalogCase("CASE-MEAL-010").source_text;
    const oracle = candidateOracle("CASE-MEAL-010");
    if (oracle.completion_evidence === undefined) {
      throw new Error("CASE-MEAL-010 requires completion_evidence");
    }

    const result = classifyCompletion(sourceText);

    expect(result.disposition).toBe(
      adaptCatalogDisposition(oracle, "completion"),
    );
    if (
      result.disposition !== "proceed" ||
      result.completion_evidence === null
    ) {
      throw new Error("expected completion evidence");
    }
    expect(result.completion_evidence).toMatchObject(oracle.completion_evidence);
    expect(result.excluded_items).toMatchObject(oracle.excluded_items ?? []);
    expect(result.completion_evidence.rule_version).toBe(
      "diet-manager/completion-v1",
    );
    expectMatchedSpan(
      sourceText,
      result.completion_evidence.matched_evidence,
      "completion.adversative-completed",
      "diet-manager/completion-v1",
    );
  });

  it("ignores the future plan in CASE-MEAL-015 before item parsing", () => {
    const sourceText = catalogCase("CASE-MEAL-015").source_text;
    const oracle = ignoredDecisionOracle("CASE-MEAL-015");

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject(oracle);
    if (result.disposition !== "ignored") throw new Error("expected ignored");
    expectMatchedSpan(
      sourceText,
      result.matched_evidence,
      "completion.future-plan.tomorrow-prepare-eat",
      "diet-manager/completion-v1",
    );
  });

  it("gives the final explicit non-occurrence priority in CASE-MEAL-016", () => {
    const sourceText = catalogCase("CASE-MEAL-016").source_text;
    const oracle = ignoredDecisionOracle("CASE-MEAL-016");

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject(oracle);
    if (result.disposition !== "ignored") throw new Error("expected ignored");
    expectMatchedSpan(
      sourceText,
      result.matched_evidence,
      "completion.final-non-occurrence",
      "diet-manager/completion-v1",
    );
  });

  it("keeps offsets truthful when catalog punctuation is combined with added whitespace", () => {
    const catalogSource = catalogCase("CASE-MEAL-009").source_text;
    const sourceText = catalogSource.replace("没吃", "没  吃");

    const result = classifyCompletion(sourceText);

    if (result.disposition !== "proceed") throw new Error("expected proceed");
    const evidence = result.excluded_items[0].matched_evidence;
    expect(sourceText.slice(evidence.start, evidence.end)).toBe(evidence.raw);
    expect(evidence.raw).toContain("  ");
  });

  it("keeps final non-occurrence ahead of future, completed, and item-negation rules", () => {
    const sourceText = [
      catalogCase("CASE-MEAL-015").source_text,
      catalogCase("CASE-MEAL-010").source_text,
      catalogCase("CASE-MEAL-009").source_text,
      catalogCase("CASE-MEAL-016").source_text,
    ].map(withoutFinalPunctuation).join("，");

    const result = classifyCompletion(sourceText);
    const oracle = ignoredDecisionOracle("CASE-MEAL-016");

    expect(result).toMatchObject({
      ...oracle,
      matched_evidence: { rule_id: "completion.final-non-occurrence" },
    });
  });

  it("keeps a future plan ahead of adversative completion and item negation", () => {
    const sourceText = [
      catalogCase("CASE-MEAL-015").source_text,
      catalogCase("CASE-MEAL-010").source_text,
      catalogCase("CASE-MEAL-009").source_text,
    ].map(withoutFinalPunctuation).join("，");

    const result = classifyCompletion(sourceText);
    const oracle = ignoredDecisionOracle("CASE-MEAL-015");

    expect(result).toMatchObject({
      ...oracle,
      matched_evidence: {
        rule_id: "completion.future-plan.tomorrow-prepare-eat",
      },
    });
    expect(Object.hasOwn(result, "items")).toBe(false);
    expect(Object.hasOwn(result, "completion_evidence")).toBe(false);
    expect(Object.hasOwn(result, "excluded_items")).toBe(false);
  });

  it("retains both completed and item-negation evidence when those later rules overlap", () => {
    const sourceText = [
      catalogCase("CASE-MEAL-010").source_text,
      catalogCase("CASE-MEAL-009").source_text,
    ].map(withoutFinalPunctuation).join("，");

    const result = classifyCompletion(sourceText);
    const completedOracle = candidateOracle("CASE-MEAL-010");
    const negationOracle = candidateOracle("CASE-MEAL-009");
    if (
      completedOracle.completion_evidence === undefined ||
      negationOracle.excluded_items === undefined
    ) {
      throw new Error("overlap requires completion and exclusion Oracles");
    }

    expect(result).toMatchObject({
      disposition: adaptCatalogDisposition(completedOracle, "completion"),
      completion_evidence: {
        ...completedOracle.completion_evidence,
        matched_evidence: { rule_id: "completion.adversative-completed" },
      },
      excluded_items: [{
        ...negationOracle.excluded_items[0],
        matched_evidence: { rule_id: "completion.item-negation.egg" },
      }],
    });
  });
});

describe("bounded current-user subject rules", () => {
  it("ignores the explicit non-self subject in CASE-MEAL-011", () => {
    const sourceText = catalogCase("CASE-MEAL-011").source_text;
    const oracle = ignoredDecisionOracle("CASE-MEAL-011");

    const result = resolveSubject(
      sourceText,
      [],
    );

    expect(result).toMatchObject(oracle);
    if (result.disposition !== "ignored") throw new Error("expected ignored");
    expectMatchedSpan(
      sourceText,
      result.matched_evidence,
      "subject.explicit-non-self.child",
      "diet-manager/subject-v1",
    );
  });

  it("defaults the omitted subject to self without creating an entity in CASE-MEAL-017", () => {
    const sourceText = catalogCase("CASE-MEAL-017").source_text;
    const oracle = candidateOracle("CASE-MEAL-017");

    const result = resolveSubject(
      sourceText,
      lexicalSeed(sourceText),
    );

    expect(result.disposition).toBe(
      adaptCatalogDisposition(oracle, "subject"),
    );
    if (result.disposition !== "resolved") throw new Error("expected resolved");
    expect(result.subject).toMatchObject(requiredSubject("CASE-MEAL-017"));
    expect(subjectItemProjection(result.items)).toEqual(
      catalogItemProjection(requiredItems("CASE-MEAL-017")),
    );
    expect(result.subject.matched_evidence).toBeNull();
    expect(result.subject.rule_version).toBe("diet-manager/subject-v1");
  });

  it("retains only the known self bottle and excludes the friend share in CASE-MEAL-018", () => {
    const sourceText = catalogCase("CASE-MEAL-018").source_text;
    const oracle = candidateOracle("CASE-MEAL-018");

    const result = resolveSubject(
      sourceText,
      lexicalSeed(sourceText),
    );

    expect(result.disposition).toBe(
      adaptCatalogDisposition(oracle, "subject"),
    );
    if (result.disposition !== "resolved") throw new Error("expected resolved");
    expect(result.subject).toMatchObject(requiredSubject("CASE-MEAL-018"));
    expect(subjectItemProjection(result.items)).toEqual(
      catalogItemProjection(requiredItems("CASE-MEAL-018")),
    );
    expect(result.subject.rule_version).toBe("diet-manager/subject-v1");
    expectMatchedSpan(
      sourceText,
      result.subject.matched_evidence!,
      "subject.explicit-self-share.friend",
      "diet-manager/subject-v1",
    );
  });

  it("keeps self participation but never assigns the group total in CASE-MEAL-019", () => {
    const sourceText = catalogCase("CASE-MEAL-019").source_text;
    const oracle = candidateOracle("CASE-MEAL-019");
    if (oracle.group_amount_evidence === undefined) {
      throw new Error("CASE-MEAL-019 requires group_amount_evidence");
    }

    const result = resolveSubject(
      sourceText,
      lexicalSeed(sourceText),
    );

    expect(result.disposition).toBe(
      adaptCatalogDisposition(oracle, "subject"),
    );
    if (result.disposition !== "resolved") throw new Error("expected resolved");
    expect(result.subject).toMatchObject(requiredSubject("CASE-MEAL-019"));
    expect(subjectItemProjection(result.items)).toEqual(
      catalogItemProjection(requiredItems("CASE-MEAL-019")),
    );
    expect(result.group_amount_evidence).toMatchObject(
      oracle.group_amount_evidence,
    );
    expect(result.subject.rule_version).toBe("diet-manager/subject-v1");
    expectMatchedSpan(
      sourceText,
      result.subject.matched_evidence!,
      "subject.collective-self.we",
      "diet-manager/subject-v1",
    );
    expectMatchedSpan(
      sourceText,
      result.group_amount_evidence!.matched_evidence,
      "subject.group-amount.two-plates",
      "diet-manager/subject-v1",
    );
    expect(result.items[0].amount_evidence.quantity).not.toBe(
      oracle.group_amount_evidence.quantity,
    );
  });

  it("keeps explicit non-self ahead of self-share and collective rules", () => {
    const sourceText = [
      catalogCase("CASE-MEAL-011").source_text,
      catalogCase("CASE-MEAL-018").source_text,
      catalogCase("CASE-MEAL-019").source_text,
    ].map(withoutFinalPunctuation).join("，");

    const result = resolveSubject(sourceText, []);
    const oracle = ignoredDecisionOracle("CASE-MEAL-011");

    expect(result).toMatchObject({
      ...oracle,
      matched_evidence: { rule_id: "subject.explicit-non-self.child" },
    });
  });
});
