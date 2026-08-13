export const COMPLETION_RULE_VERSION = "diet-manager/completion-v1" as const;

export interface CompletionMatchedEvidence {
  readonly rule_id:
    | "completion.final-non-occurrence"
    | "completion.future-plan.tomorrow-prepare-eat"
    | "completion.adversative-completed"
    | "completion.interrogative"
    | "completion.conditional"
    | `completion.item-negation.${string}`;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly rule_version: typeof COMPLETION_RULE_VERSION;
}

export interface CompletionEvidence {
  readonly initial_state: "reluctance";
  readonly final_state: "completed";
  readonly winning_span: string;
  readonly matched_evidence: CompletionMatchedEvidence;
  readonly rule_version: typeof COMPLETION_RULE_VERSION;
}

export interface CompletionExcludedItem {
  readonly normalized_name: string;
  readonly reason_code: "item_scoped_negation";
  readonly matched_span: string;
  readonly matched_evidence: CompletionMatchedEvidence;
  readonly rule_version: typeof COMPLETION_RULE_VERSION;
}

export type CompletionClassification =
  | Readonly<{
      disposition: "needs_clarification";
      action: "record_meal" | "record_water";
      reason_code: "unsupported_command";
      question: string;
      matched_evidence: CompletionMatchedEvidence;
    }>
  | Readonly<{
      disposition: "ignored";
      action: "record_meal";
      reason_code: "not_occurred" | "future_plan";
      matched_evidence: CompletionMatchedEvidence;
    }>
  | Readonly<{
      disposition: "proceed";
      completion_evidence: Readonly<CompletionEvidence> | null;
      excluded_items: readonly Readonly<CompletionExcludedItem>[];
    }>;

interface CompletionRule {
  readonly rule_id: CompletionMatchedEvidence["rule_id"];
  readonly pattern: RegExp;
}

// This is deliberately a frozen PRODUCT-0.1 catalog, not a general NLP lexicon.
const FINAL_NON_OCCURRENCE_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.final-non-occurrence",
  pattern: /最后\s*没\s*吃(?:了)?(?=[\s。！!？?]*$)/u,
});

const FUTURE_PLAN_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.future-plan.tomorrow-prepare-eat",
  pattern: /明天\s*准备\s*吃/u,
});

const ADVERSATIVE_COMPLETED_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.adversative-completed",
  pattern: /后来\s*还是\s*吃了/u,
});

const INTERROGATIVE_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.interrogative",
  pattern: /(?:吗|么)?\s*[？?]\s*$/u,
});

const CONDITIONAL_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.conditional",
  pattern: /^\s*(?:如果|假如|要是)(?=[^。！？!?]*(?:吃|喝))/u,
});

function clarificationAction(sourceText: string): "record_meal" | "record_water" {
  return /喝(?:了)?[^。！？!?]*(?:白水|水)(?=$|[\s,，。；;！!？?、和与吗么])/u
      .test(sourceText)
    ? "record_water"
    : "record_meal";
}

interface ItemNegationRule extends CompletionRule {
  readonly normalized_name: string;
}

const ITEM_NEGATION_RULES = Object.freeze([
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.egg",
    normalized_name: "egg",
    pattern: /没\s*吃\s*鸡蛋(?!糕)/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.apple",
    normalized_name: "apple",
    pattern: /没\s*吃\s*苹果(?!派)/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.banana",
    normalized_name: "banana",
    pattern: /没\s*吃\s*香蕉(?!船)/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.bread",
    normalized_name: "bread",
    pattern: /没\s*吃\s*面包(?!虫)/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.rice",
    normalized_name: "rice",
    pattern: /没\s*吃\s*米饭/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.fried_rice",
    normalized_name: "fried_rice",
    pattern: /没\s*吃\s*炒饭/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.noodle",
    normalized_name: "noodle",
    pattern: /没\s*吃\s*面(?!包)/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.chicken",
    normalized_name: "chicken",
    pattern: /没\s*吃\s*鸡胸肉/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.milk",
    normalized_name: "milk",
    pattern: /没\s*喝\s*牛奶/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.soup",
    normalized_name: "soup",
    pattern: /没\s*喝\s*汤/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.soy_milk",
    normalized_name: "soy_milk",
    pattern: /没\s*喝\s*豆浆/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.coffee",
    normalized_name: "coffee",
    pattern: /没\s*喝\s*咖啡/u,
  }),
  Object.freeze<ItemNegationRule>({
    rule_id: "completion.item-negation.tea",
    normalized_name: "tea",
    pattern: /没\s*喝\s*茶/u,
  }),
]);

function matchEvidence(
  sourceText: string,
  rule: CompletionRule,
): CompletionMatchedEvidence | null {
  const match = rule.pattern.exec(sourceText);
  if (match === null || match.index < 0) return null;
  return Object.freeze({
    rule_id: rule.rule_id,
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length,
    rule_version: COMPLETION_RULE_VERSION,
  });
}

export function classifyCompletion(
  sourceText: string,
): CompletionClassification {
  const interrogative = matchEvidence(sourceText, INTERROGATIVE_RULE);
  if (interrogative !== null) {
    return Object.freeze({
      disposition: "needs_clarification",
      action: clarificationAction(sourceText),
      reason_code: "unsupported_command",
      question: "这是在询问，还是要记录已经发生的饮食？",
      matched_evidence: interrogative,
    });
  }

  const conditional = matchEvidence(sourceText, CONDITIONAL_RULE);
  if (conditional !== null) {
    return Object.freeze({
      disposition: "needs_clarification",
      action: clarificationAction(sourceText),
      reason_code: "unsupported_command",
      question: "这是条件描述，还是要记录已经发生的饮食？",
      matched_evidence: conditional,
    });
  }

  const finalNonOccurrence = matchEvidence(
    sourceText,
    FINAL_NON_OCCURRENCE_RULE,
  );
  if (finalNonOccurrence !== null) {
    return Object.freeze({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "not_occurred",
      matched_evidence: finalNonOccurrence,
    });
  }

  const futurePlan = matchEvidence(sourceText, FUTURE_PLAN_RULE);
  if (futurePlan !== null) {
    return Object.freeze({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "future_plan",
      matched_evidence: futurePlan,
    });
  }

  const completed = matchEvidence(sourceText, ADVERSATIVE_COMPLETED_RULE);
  const completionEvidence = completed === null
    ? null
    : Object.freeze({
        initial_state: "reluctance" as const,
        final_state: "completed" as const,
        winning_span: completed.raw,
        matched_evidence: completed,
        rule_version: COMPLETION_RULE_VERSION,
      });

  const excludedItems = ITEM_NEGATION_RULES.flatMap((rule) => {
    const evidence = matchEvidence(sourceText, rule);
    if (evidence === null) return [];
    return [Object.freeze({
      normalized_name: rule.normalized_name,
      reason_code: "item_scoped_negation" as const,
      matched_span: evidence.raw,
      matched_evidence: evidence,
      rule_version: COMPLETION_RULE_VERSION,
    })];
  });

  return Object.freeze({
    disposition: "proceed",
    completion_evidence: completionEvidence,
    excluded_items: Object.freeze(excludedItems),
  });
}
