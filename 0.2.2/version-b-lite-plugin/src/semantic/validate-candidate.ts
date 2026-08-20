import type { DietManagerAction } from "../contracts.js";
import { classifySemanticCompletion } from "../parser/completion.js";
import {
  mealLexemeAllowsUnit,
  mealLexemeAmountQuestion,
  mealLexemeKind,
  normalizeMealLexeme,
  resolveMealFrames,
} from "../parser/meal.js";
import { detectExplicitOtherSubject } from "../parser/subject.js";
import {
  isOccurredTimeEvidenceSpan,
  resolveOccurredTime,
} from "../parser/time.js";
import type {
  CoreClarificationResult,
  CoreIgnoredResult,
  CoreMealCommandCandidate,
  CoreMealItem,
  OffsetIsoTimestamp,
} from "../parser/types.js";
import {
  cloneSemanticCandidate,
  type SemanticMealCandidateV1,
} from "./candidate.js";

export interface SemanticMealValidationInput {
  readonly candidate: SemanticMealCandidateV1;
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly received_at: OffsetIsoTimestamp;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
}

export type SemanticMealValidationResult =
  | Readonly<{ readonly disposition: "candidate"; readonly command: CoreMealCommandCandidate }>
  | CoreIgnoredResult
  | CoreClarificationResult
  | Readonly<{ readonly disposition: "rejected"; readonly error_code:
      | "SEMANTIC_SOURCE_MISMATCH"
      | "SEMANTIC_ACTION_MISMATCH"
      | "SEMANTIC_ITEM_MISMATCH"
      | "SEMANTIC_EVIDENCE_INVALID"
      | "SEMANTIC_CANDIDATE_INVALID" }>;

type RejectionCode = Extract<
  SemanticMealValidationResult,
  { disposition: "rejected" }
>["error_code"];

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function rejected(errorCode: RejectionCode): SemanticMealValidationResult {
  return frozen({ disposition: "rejected" as const, error_code: errorCode });
}

function containsEvidence(sourceText: string, evidence: string | null): boolean {
  return evidence !== null && sourceText.includes(evidence);
}

function isExplicitSelfEvidence(sourceText: string, evidence: string): boolean {
  const sourceSubject = resolveMealFrames(sourceText).subject;
  if (sourceSubject?.resolution_basis !== "explicit_self") return false;
  const evidenceSubject = resolveMealFrames(`${evidence}吃了一个鸡蛋`).subject;
  return evidenceSubject?.resolution_basis === "explicit_self";
}

function amountEvidenceAgrees(
  rawName: string,
  normalizedName: string,
  value: number,
  unit: string,
  evidenceSpan: string,
): boolean {
  const evidenceItems = resolveMealFrames(`吃了${evidenceSpan}`).proposed_items
    .filter((item) =>
      item.raw_text === rawName && item.normalized_name === normalizedName
    );
  if (evidenceItems.length !== 1) return false;
  const evidenceItem = evidenceItems[0];
  return evidenceItem?.amount_resolution === "resolved" &&
    evidenceItem.amount_evidence.quantity === value &&
    evidenceItem.amount_evidence.unit === unit &&
    evidenceItem.amount_evidence.estimated === false;
}

export function validateSemanticMealCandidate(
  input: SemanticMealValidationInput,
): SemanticMealValidationResult {
  let candidate: SemanticMealCandidateV1;
  try {
    candidate = cloneSemanticCandidate(input.candidate);
  } catch {
    return rejected("SEMANTIC_CANDIDATE_INVALID");
  }

  if (input.action !== "record_meal" || candidate.intent !== input.action) {
    return rejected("SEMANTIC_ACTION_MISMATCH");
  }
  if (candidate.source_text !== input.source_text) {
    return rejected("SEMANTIC_SOURCE_MISMATCH");
  }

  const declaredOther = candidate.subject.explicit_other_spans.find((span) =>
    input.source_text.includes(span)
  );
  if (detectExplicitOtherSubject(input.source_text) !== null || declaredOther !== undefined) {
    return frozen({
      disposition: "ignored" as const,
      action: "record_meal" as const,
      reason_code: "non_self_subject" as const,
    });
  }

  const mealAuthority = resolveMealFrames(input.source_text);
  const completion = classifySemanticCompletion(
    input.source_text,
    mealAuthority.proposed_items,
  );
  if (completion.disposition === "needs_clarification") {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_meal" as const,
      reason_code: "unsupported_command" as const,
      question: completion.question,
    });
  }
  if (completion.disposition === "ignored") {
    return frozen({
      disposition: "ignored" as const,
      action: "record_meal" as const,
      reason_code: completion.reason_code,
    });
  }
  if (
    (candidate.subject.basis === "explicit" &&
      (!containsEvidence(input.source_text, candidate.subject.evidence_span) ||
        !isExplicitSelfEvidence(
          input.source_text,
          candidate.subject.evidence_span ?? "",
        ))) ||
    (candidate.subject.basis === "private_agent_default" &&
      candidate.subject.evidence_span !== null) ||
    candidate.subject.explicit_other_spans.some((span) => !input.source_text.includes(span))
  ) {
    return rejected("SEMANTIC_EVIDENCE_INVALID");
  }

  const items: CoreMealItem[] = [];
  const missingItems: string[] = [];
  for (const item of candidate.items) {
    const normalizedName = normalizeMealLexeme(item.raw_name);
    const kind = mealLexemeKind(item.raw_name);
    if (
      normalizedName === null || kind === null ||
      normalizedName !== item.normalized_hint ||
      !input.source_text.includes(item.raw_name)
    ) {
      return rejected("SEMANTIC_ITEM_MISMATCH");
    }
    if (item.amount.kind === "unknown") {
      missingItems.push(item.raw_name);
      continue;
    }
    if (!mealLexemeAllowsUnit(item.raw_name, item.amount.unit)) {
      return rejected("SEMANTIC_CANDIDATE_INVALID");
    }
    if (
      !input.source_text.includes(item.amount.evidence_span) ||
      !amountEvidenceAgrees(
        item.raw_name,
        normalizedName,
        item.amount.value,
        item.amount.unit,
        item.amount.evidence_span,
      )
    ) {
      return rejected("SEMANTIC_EVIDENCE_INVALID");
    }
    items.push(frozen({
      order: items.length,
      kind,
      normalized_name: normalizedName,
      quantity: item.amount.value,
      unit: item.amount.unit,
      estimated: false as const,
    }));
  }

  if (missingItems.length > 0) {
    const question = missingItems.length === 1
      ? mealLexemeAmountQuestion(missingItems[0]!)
      : `请说明${missingItems.join("、")}各吃了多少。`;
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_meal" as const,
      reason_code: "amount_ambiguous" as const,
      question,
      missing_items: Object.freeze(missingItems),
    });
  }

  if (
    (candidate.time.kind === "source_text" &&
      (candidate.time.evidence_span === null ||
        !isOccurredTimeEvidenceSpan(
          input.source_text,
          candidate.time.evidence_span,
        ))) ||
    (candidate.time.kind === "unspecified" && candidate.time.evidence_span !== null)
  ) {
    return rejected("SEMANTIC_EVIDENCE_INVALID");
  }

  const occurredTime = resolveOccurredTime(input.source_text, input.received_at);
  if (occurredTime.resolution_basis === "needs_clarification") {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_meal" as const,
      reason_code: "occurred_date_ambiguous" as const,
      question: "请明确这顿夜宵的日期。",
      occurred_time: occurredTime,
    });
  }

  const command: CoreMealCommandCandidate = frozen({
    action: "record_meal" as const,
    operation_id: input.operation_id,
    meal_identity_seed: input.operation_id,
    source_text: input.source_text,
    parser_version: "diet-manager/semantic-candidate-v1" as const,
    occurred_time: occurredTime,
    subject: frozen({
      kind: "self" as const,
      resolution_basis: candidate.subject.basis === "explicit"
        ? "explicit_self" as const
        : "omitted_subject_default" as const,
      subject_entity_created: false as const,
      matched_span: candidate.subject.evidence_span,
      rule_version: "diet-manager/subject-v1" as const,
    }),
    items: Object.freeze(items),
  });
  return frozen({ disposition: "candidate" as const, command });
}
