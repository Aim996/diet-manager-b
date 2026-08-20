import { resolveMealFrames } from "./meal.js";
import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import type { PositionedMealItem } from "./meal.js";

export const COMPLETION_RULE_VERSION = "diet-manager/completion-v1" as const;

export interface CompletionMatchedEvidence {
  readonly rule_id:
    | "completion.final-non-occurrence"
    | "completion.future-plan.tomorrow-prepare-eat"
    | "completion.adversative-completed"
    | "completion.interrogative"
    | "completion.conditional"
    | "completion.semantic-direct-non-occurrence"
    | "completion.semantic-stated-plan"
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

const CONDITIONAL_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.conditional",
  pattern: /^\s*(?:如果|假如|要是)(?=[^。！？!?]*(?:吃|喝))/u,
});

const SEMANTIC_DIRECT_NON_OCCURRENCE_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.semantic-direct-non-occurrence",
  pattern: /(?:没(?:有)?|不)\s*(?:吃|喝)/u,
});

const SEMANTIC_STATED_PLAN_RULE = Object.freeze<CompletionRule>({
  rule_id: "completion.semantic-stated-plan",
  pattern: /(?:(?:打算|计划)\s*(?:(?:明天|后天)\s*)?(?:吃|喝)|准备\s*(?:吃|喝))/u,
});

function clarificationAction(sourceText: string): "record_meal" | "record_water" {
  return /喝(?:了)?[^。！？!?]*(?:白水|水)(?=$|[\s,，。；;！!？?、和与吗么嘛呢])/u
      .test(sourceText)
    ? "record_water"
    : "record_meal";
}

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

const TRAILING_QUESTION_TAIL = /[\s"'。.!！?？]|\p{Pe}|\p{Pf}/u;
const FINAL_QUESTION_PARTICLE = /[吗么嘛呢]/u;

function matchInterrogativeEvidence(
  sourceText: string,
): CompletionMatchedEvidence | null {
  let normalizedEnd = sourceText.length;
  let terminalQuestionMark = -1;
  while (normalizedEnd > 0) {
    const character = sourceText[normalizedEnd - 1];
    if (character === undefined || !TRAILING_QUESTION_TAIL.test(character)) break;
    if (character === "?" || character === "？") {
      terminalQuestionMark = normalizedEnd - 1;
    }
    normalizedEnd -= 1;
  }

  const particlePosition = normalizedEnd - 1;
  const particle = particlePosition < 0
    ? undefined
    : sourceText[particlePosition];
  const start = particle !== undefined && FINAL_QUESTION_PARTICLE.test(particle)
    ? particlePosition
    : terminalQuestionMark;
  if (start < 0) return null;
  return Object.freeze({
    rule_id: "completion.interrogative",
    raw: sourceText.slice(start),
    start,
    end: sourceText.length,
    rule_version: COMPLETION_RULE_VERSION,
  });
}

export function classifyCompletion(
  sourceText: string,
  parsedOccurrences?: readonly Readonly<PositionedMealItem>[],
): CompletionClassification {
  const interrogative = matchInterrogativeEvidence(sourceText);
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

  const occurrences = parsedOccurrences ?? resolveMealFrames(sourceText).proposed_items;
  const negatedEvents = new Map<string, number>();
  for (const frame of parseIngestionPredicateFrames(sourceText)) {
    const negation = /没(?:有)?\s*$/u.exec(frame.subject_prefix_span.raw);
    if (negation === null) continue;
    negatedEvents.set(
      frame.event_id,
      frame.subject_prefix_span.start + negation.index,
    );
  }
  const excludedItems = occurrences.flatMap((occurrence) => {
    const negationStart = negatedEvents.get(occurrence.event_id);
    if (negationStart === undefined) return [];
    const evidence = Object.freeze({
      rule_id: `completion.item-negation.${occurrence.normalized_name}` as const,
      raw: sourceText.slice(negationStart, occurrence.end),
      start: negationStart,
      end: occurrence.end,
      rule_version: COMPLETION_RULE_VERSION,
    });
    return [Object.freeze({
      normalized_name: occurrence.normalized_name,
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

export function classifySemanticCompletion(
  sourceText: string,
  parsedOccurrences?: readonly Readonly<PositionedMealItem>[],
): CompletionClassification {
  const standard = classifyCompletion(sourceText, parsedOccurrences);
  if (standard.disposition !== "proceed") return standard;

  const directNonOccurrence = matchEvidence(
    sourceText,
    SEMANTIC_DIRECT_NON_OCCURRENCE_RULE,
  );
  if (directNonOccurrence !== null || standard.excluded_items.length > 0) {
    return Object.freeze({
      disposition: "ignored" as const,
      action: "record_meal" as const,
      reason_code: "not_occurred" as const,
      matched_evidence: directNonOccurrence ??
        standard.excluded_items[0]!.matched_evidence,
    });
  }

  const statedPlan = matchEvidence(sourceText, SEMANTIC_STATED_PLAN_RULE);
  if (statedPlan !== null) {
    return Object.freeze({
      disposition: "ignored" as const,
      action: "record_meal" as const,
      reason_code: "future_plan" as const,
      matched_evidence: statedPlan,
    });
  }
  return standard;
}
