import { describe, expect, it } from "vitest";

import casesCatalog from "../../../shared/acceptance-cases/cases.json";
import { classifyCompletion } from "../../src/parser/completion.js";
import {
  resolveSubject,
  type ProposedSubjectItem,
} from "../../src/parser/subject.js";

interface CatalogCase {
  readonly id: string;
  readonly source_text: string;
  readonly oracle: {
    readonly parsing?: {
      readonly items?: readonly {
        readonly normalized_name: string;
        readonly quantity: number | null;
        readonly unit: string | null;
        readonly estimated: boolean | null;
      }[];
      readonly group_amount_evidence?: {
        readonly quantity: number;
        readonly unit: string;
        readonly assigned_to_self: false;
      };
    };
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

function proposedItems(
  id: string,
  rawTexts: readonly string[],
): readonly ProposedSubjectItem[] {
  const entry = catalogCase(id);
  const items = entry.oracle.parsing?.items;
  if (items === undefined || items.length !== rawTexts.length) {
    throw new Error(`invalid item oracle for ${id}`);
  }
  return items.map((item, index) => ({
    normalized_name: item.normalized_name,
    raw_text: rawTexts[index],
    amount_evidence: {
      raw_text: item.quantity === null ? null : rawTexts[index],
      quantity: item.quantity,
      unit: item.unit,
      estimated: item.estimated,
    },
  }));
}

function proposedCollectiveItems(id: string): readonly ProposedSubjectItem[] {
  const entry = catalogCase(id);
  const items = entry.oracle.parsing?.items;
  const groupAmount = entry.oracle.parsing?.group_amount_evidence;
  if (items?.length !== 1 || groupAmount === undefined) {
    throw new Error(`invalid collective oracle for ${id}`);
  }
  return [{
    normalized_name: items[0].normalized_name,
    raw_text: items[0].normalized_name,
    amount_evidence: {
      raw_text: `${groupAmount.quantity}:${groupAmount.unit}`,
      quantity: groupAmount.quantity,
      unit: groupAmount.unit,
      estimated: false,
    },
  }];
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

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject({
      disposition: "proceed",
      completion_evidence: null,
      excluded_items: [
        {
          normalized_name: "egg",
          reason_code: "item_scoped_negation",
        },
      ],
    });
    if (result.disposition !== "proceed") throw new Error("expected proceed");
    expectMatchedSpan(
      sourceText,
      result.excluded_items[0].matched_evidence,
      "completion.item-negation.egg",
      "diet-manager/completion-v1",
    );
  });

  it("lets the final completed fact beat prior reluctance in CASE-MEAL-010", () => {
    const sourceText = catalogCase("CASE-MEAL-010").source_text;

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject({
      disposition: "proceed",
      excluded_items: [],
      completion_evidence: {
        initial_state: "reluctance",
        final_state: "completed",
        winning_span: "后来还是吃了",
        rule_version: "diet-manager/completion-v1",
      },
    });
    if (
      result.disposition !== "proceed" ||
      result.completion_evidence === null
    ) {
      throw new Error("expected completion evidence");
    }
    expectMatchedSpan(
      sourceText,
      result.completion_evidence.matched_evidence,
      "completion.adversative-completed",
      "diet-manager/completion-v1",
    );
  });

  it("ignores the future plan in CASE-MEAL-015 before item parsing", () => {
    const sourceText = catalogCase("CASE-MEAL-015").source_text;

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "future_plan",
    });
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

    const result = classifyCompletion(sourceText);

    expect(result).toMatchObject({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "not_occurred",
    });
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
});

describe("bounded current-user subject rules", () => {
  it("ignores the explicit non-self subject in CASE-MEAL-011", () => {
    const sourceText = catalogCase("CASE-MEAL-011").source_text;

    const result = resolveSubject(
      sourceText,
      [],
    );

    expect(result).toMatchObject({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
    });
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

    const result = resolveSubject(
      sourceText,
      proposedItems("CASE-MEAL-017", ["鸡蛋"]),
    );

    expect(result).toMatchObject({
      disposition: "resolved",
      subject: {
        kind: "self",
        resolution_basis: "omitted_subject_default",
        subject_entity_created: false,
        matched_span: null,
        matched_evidence: null,
        rule_version: "diet-manager/subject-v1",
      },
      items: [
        {
          normalized_name: "egg",
          amount_evidence: {
            quantity: 2,
            unit: "piece",
            estimated: false,
          },
        },
      ],
    });
  });

  it("retains only the known self bottle and excludes the friend share in CASE-MEAL-018", () => {
    const sourceText = catalogCase("CASE-MEAL-018").source_text;

    const result = resolveSubject(
      sourceText,
      proposedItems("CASE-MEAL-018", ["牛奶"]),
    );

    expect(result).toMatchObject({
      disposition: "resolved",
      subject: {
        kind: "self",
        resolution_basis: "explicit_self_share",
        subject_entity_created: false,
        excluded_non_self_share_count: 1,
        matched_span: "我和朋友",
        rule_version: "diet-manager/subject-v1",
      },
      items: [
        {
          normalized_name: "milk",
          amount_evidence: {
            quantity: 1,
            unit: "bottle",
            estimated: false,
          },
        },
      ],
    });
    if (result.disposition !== "resolved") throw new Error("expected resolved");
    expectMatchedSpan(
      sourceText,
      result.subject.matched_evidence!,
      "subject.explicit-self-share.friend",
      "diet-manager/subject-v1",
    );
    expect(result.items[0].amount_evidence.quantity).not.toBe(2);
  });

  it("keeps self participation but never assigns the group total in CASE-MEAL-019", () => {
    const sourceText = catalogCase("CASE-MEAL-019").source_text;

    const result = resolveSubject(
      sourceText,
      proposedCollectiveItems("CASE-MEAL-019"),
    );

    expect(result).toMatchObject({
      disposition: "resolved",
      subject: {
        kind: "self",
        resolution_basis: "collective_self_participation",
        subject_entity_created: false,
        self_participated: true,
        matched_span: "我们",
        rule_version: "diet-manager/subject-v1",
      },
      items: [
        {
          normalized_name: "fried_rice",
          amount_evidence: {
            raw_text: null,
            quantity: null,
            unit: null,
            estimated: null,
          },
        },
      ],
      group_amount_evidence: {
        quantity: 2,
        unit: "plate",
        assigned_to_self: false,
      },
    });
    if (result.disposition !== "resolved") throw new Error("expected resolved");
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
    expect(result.items[0].amount_evidence).not.toMatchObject({ quantity: 2 });
  });
});
