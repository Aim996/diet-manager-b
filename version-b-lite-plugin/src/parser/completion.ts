export const COMPLETION_RULE_VERSION = "diet-manager/completion-v1" as const;

export interface CompletionMatchedEvidence {
  readonly rule_id:
    | "completion.final-non-occurrence"
    | "completion.future-plan.tomorrow-prepare-eat"
    | "completion.adversative-completed"
    | "completion.item-negation.egg";
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
  readonly normalized_name: "egg";
  readonly reason_code: "item_scoped_negation";
  readonly matched_span: string;
  readonly matched_evidence: CompletionMatchedEvidence;
  readonly rule_version: typeof COMPLETION_RULE_VERSION;
}

export type CompletionClassification =
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

const ITEM_NEGATION_RULES = Object.freeze([
  Object.freeze<CompletionRule>({
    rule_id: "completion.item-negation.egg",
    pattern: /没\s*吃\s*鸡蛋/u,
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
      normalized_name: "egg" as const,
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
