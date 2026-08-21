import type { DietManagerAction } from "../contracts/actions.js";
import type {
  ExactAmountEvidence,
  GoalProposalV2,
  InventoryProposalV2,
  MealProposalV2,
  ProfileProposalV2,
  RecordMutationProposalV2,
  SemanticProposalV2,
  SubjectEvidence,
  TimeEvidence,
  WaterProposalV2,
} from "../contracts/semantic-proposal-v2.js";
import { classifySemanticCompletion } from "../parser/completion.js";
import { normalizeMealLexeme, resolveMealFrames } from "../parser/meal.js";
import { parseCoreCommand } from "../parser/parse-command.js";
import { detectExplicitOtherSubject } from "../parser/subject.js";
import { resolveOccurredTime } from "../parser/time.js";
import type {
  CoreCommandCandidate,
  CoreContextEntry,
  CoreGoalCommandCandidate,
  CoreMealCommandCandidate,
  CoreMealItem,
  CoreParseResult,
  CoreProfileCommandCandidate,
  CorePurchaseCommandCandidate,
  CorePurchaseItemCandidate,
  CoreSubjectEvidence,
  CoreWaterCommandCandidate,
  OffsetIsoTimestamp,
} from "../parser/types.js";
import { cloneSemanticProposalV2 } from "./candidate.js";
import {
  evidenceContainsNumber,
  exactAmountEvidenceAgrees,
  isAuthorityShapedReference,
  normalizedLiquidMillilitres,
} from "./evidence.js";

const SEMANTIC_PARSER_VERSION = "diet-manager/semantic-proposal/v2" as const;

export interface SemanticProposalV2ValidationInput {
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly semantic_proposal: SemanticProposalV2;
  readonly received_at: OffsetIsoTimestamp;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly prior_context?: readonly CoreContextEntry[];
}

export type SemanticProposalV2RejectionCode =
  | "SEMANTIC_ACTION_MISMATCH"
  | "SEMANTIC_ENTITY_MISMATCH"
  | "SEMANTIC_AMOUNT_MISMATCH"
  | "SEMANTIC_SUBJECT_MISMATCH"
  | "SEMANTIC_AUTHORITY_REFERENCE"
  | "SEMANTIC_EVIDENCE_INVALID"
  | "SEMANTIC_PROPOSAL_INVALID";

export type SemanticProposalV2ValidationResult =
  | CoreParseResult
  | Readonly<{
      readonly disposition: "rejected";
      readonly error_code: SemanticProposalV2RejectionCode;
    }>
  | Readonly<{
      readonly disposition: "needs_clarification";
      readonly action: "correct_record";
      readonly reason_code: "target_ambiguous";
      readonly question: string;
    }>;

type Rejection = Extract<SemanticProposalV2ValidationResult, { disposition: "rejected" }>;

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function rejected(errorCode: SemanticProposalV2RejectionCode): Rejection {
  return frozen({ disposition: "rejected" as const, error_code: errorCode });
}

function expectedAction(proposal: SemanticProposalV2): DietManagerAction {
  if (proposal.kind === "meal") return "record_meal";
  if (proposal.kind === "water") return "record_water";
  if (proposal.kind === "inventory") return "add_inventory";
  if (proposal.kind === "profile") return "set_profile";
  if (proposal.kind === "goal") return "set_goal";
  if (proposal.operation === "correct") return "correct_record";
  if (proposal.operation === "undo") return "undo_record";
  return "restore_record";
}

function containsAuthorityReference(value: unknown): boolean {
  if (typeof value === "string") return isAuthorityShapedReference(value);
  if (Array.isArray(value)) return value.some(containsAuthorityReference);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(containsAuthorityReference);
}

function validSubject(subject: SubjectEvidence): boolean {
  if (subject.basis === "private_agent_default") return subject.evidence_span === null;
  return subject.evidence_span !== null &&
    /^(?:我|本人|自己|我自己|咱|咱们)$/u.test(subject.evidence_span);
}

function coreSubject(subject: SubjectEvidence): Readonly<CoreSubjectEvidence> {
  const mixed = subject.basis === "explicit" && subject.explicit_other_spans.length > 0;
  return frozen({
    kind: "self" as const,
    resolution_basis: mixed
      ? "explicit_self_share" as const
      : subject.basis === "explicit"
        ? "explicit_self" as const
        : "omitted_subject_default" as const,
    subject_entity_created: false as const,
    ...(mixed ? { excluded_non_self_share_count: subject.explicit_other_spans.length } : {}),
    matched_span: subject.evidence_span,
    rule_version: "diet-manager/subject-v1" as const,
  });
}

function parserInput(input: SemanticProposalV2ValidationInput) {
  return {
    source_text: input.source_text,
    received_at: input.received_at,
    timezone: input.timezone,
    operation_id: input.operation_id,
    source_message_id: input.source_message_id,
    conversation_id: input.conversation_id,
    prior_context: input.prior_context ?? Object.freeze([]),
  };
}

function safetyFallback(
  input: SemanticProposalV2ValidationInput,
  subject: SubjectEvidence,
): CoreParseResult | null {
  const explicitSelfShare = subject.basis === "explicit" && subject.explicit_other_spans.length > 0;
  if (detectExplicitOtherSubject(input.source_text) !== null && !explicitSelfShare) {
    return frozen({
      disposition: "ignored" as const,
      action: input.action as "record_meal" | "record_water",
      reason_code: "non_self_subject" as const,
    });
  }
  if (input.action === "record_meal") {
    const authority = resolveMealFrames(input.source_text);
    const completion = classifySemanticCompletion(input.source_text, authority.proposed_items);
    if (/^(?:如果|假如|要是).*(?:会怎样|会怎么样|会如何|怎么样|如何|吗|呢)\s*[？?]?$/u
      .test(input.source_text)) {
      return frozen({
        disposition: "ignored" as const,
        action: "record_meal" as const,
        reason_code: "future_plan" as const,
      });
    }
    if (completion.disposition === "ignored") {
      return frozen({
        disposition: "ignored" as const,
        action: "record_meal" as const,
        reason_code: completion.reason_code,
      });
    }
    if (completion.disposition === "needs_clarification") {
      return frozen({
        disposition: "needs_clarification" as const,
        action: "record_meal" as const,
        reason_code: "unsupported_command" as const,
        question: completion.question,
      });
    }
  }
  const legacy = parseCoreCommand(parserInput(input));
  if (legacy.disposition !== "ignored") return null;
  if (legacy.action !== input.action) return null;
  if (legacy.reason_code === "non_self_subject") return null;
  return legacy;
}

function validTimeEvidence(time: TimeEvidence): boolean {
  return time.kind === "source_text"
    ? time.evidence_span.length > 0
    : time.evidence_span === null;
}

function nutritiousDrink(rawName: string, unit: string): boolean {
  return normalizedLiquidMillilitres(1, unit) !== null &&
    /(?:奶|豆浆|酸奶|饮料|饮品|果汁|咖啡|茶)/u.test(rawName);
}

function mealResult(
  input: SemanticProposalV2ValidationInput,
  proposal: MealProposalV2,
): SemanticProposalV2ValidationResult {
  if (!validSubject(proposal.subject)) return rejected("SEMANTIC_SUBJECT_MISMATCH");
  const safety = safetyFallback(input, proposal.subject);
  if (safety !== null) return safety;

  const items: CoreMealItem[] = [];
  const missing: string[] = [];
  for (const item of proposal.items) {
    if (!input.source_text.includes(item.raw_name) ||
        (item.amount.kind === "exact" && !item.amount.evidence_span.includes(item.raw_name))) {
      return rejected("SEMANTIC_ENTITY_MISMATCH");
    }
    const normalizedName = normalizeMealLexeme(item.raw_name) ?? item.normalized_hint;
    if (item.amount.kind === "unknown") {
      missing.push(item.raw_name);
      continue;
    }
    if (!exactAmountEvidenceAgrees(
      item.amount.evidence_span,
      item.amount.value,
      item.amount.unit,
    )) return rejected("SEMANTIC_AMOUNT_MISMATCH");
    items.push(frozen({
      order: items.length,
      kind: nutritiousDrink(item.raw_name, item.amount.unit)
        ? "nutritious_drink" as const
        : "food" as const,
      normalized_name: normalizedName,
      quantity: item.amount.value,
      unit: item.amount.unit,
      estimated: false as const,
    }));
  }
  if (missing.length > 0) {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_meal" as const,
      reason_code: "amount_ambiguous" as const,
      question: `请说明${missing.join("、")}各吃了多少。`,
      missing_items: Object.freeze(missing),
    });
  }
  if (!validTimeEvidence(proposal.occurred_at)) return rejected("SEMANTIC_EVIDENCE_INVALID");
  const occurredTime = resolveOccurredTime(input.source_text, input.received_at);
  if (occurredTime.resolution_basis === "needs_clarification") {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_meal" as const,
      reason_code: "occurred_date_ambiguous" as const,
      question: "请明确这顿饭的日期。",
      occurred_time: occurredTime,
    });
  }
  const command: CoreMealCommandCandidate = frozen({
    action: "record_meal" as const,
    operation_id: input.operation_id,
    meal_identity_seed: input.operation_id,
    source_text: input.source_text,
    parser_version: SEMANTIC_PARSER_VERSION,
    semantic_meal_slot: proposal.meal_slot,
    occurred_time: occurredTime,
    subject: coreSubject(proposal.subject),
    items: Object.freeze(items),
  });
  return frozen({ disposition: "candidate" as const, command });
}

function waterResult(
  input: SemanticProposalV2ValidationInput,
  proposal: WaterProposalV2,
): SemanticProposalV2ValidationResult {
  if (!validSubject(proposal.subject)) return rejected("SEMANTIC_SUBJECT_MISMATCH");
  const safety = safetyFallback(input, proposal.subject);
  if (safety !== null) return safety;
  if (proposal.amount.kind === "unknown") {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_water" as const,
      reason_code: "amount_ambiguous" as const,
      question: "请说明喝了多少水。",
    });
  }
  if (!exactAmountEvidenceAgrees(
    proposal.amount.evidence_span,
    proposal.amount.value,
    proposal.amount.unit,
  )) return rejected("SEMANTIC_AMOUNT_MISMATCH");
  const millilitres = normalizedLiquidMillilitres(proposal.amount.value, proposal.amount.unit);
  if (millilitres === null) {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "record_water" as const,
      reason_code: "amount_ambiguous" as const,
      question: "请用毫升或升说明饮水量。",
    });
  }
  if (!validTimeEvidence(proposal.occurred_at)) return rejected("SEMANTIC_EVIDENCE_INVALID");
  const occurredTime = resolveOccurredTime(input.source_text, input.received_at);
  const command: CoreWaterCommandCandidate = frozen({
    action: "record_water" as const,
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: SEMANTIC_PARSER_VERSION,
    occurred_time: occurredTime,
    plain_water_ml_milli: millilitres * 1_000,
    amount_evidence: frozen({
      raw_text: proposal.amount.evidence_span,
      quantity: proposal.amount.value,
      unit: proposal.amount.unit,
      estimated: false as const,
    }),
  });
  return frozen({ disposition: "candidate" as const, command });
}

function validExactAmount(amount: ExactAmountEvidence): boolean {
  return exactAmountEvidenceAgrees(amount.evidence_span, amount.value, amount.unit);
}

function inventoryResult(
  input: SemanticProposalV2ValidationInput,
  proposal: InventoryProposalV2,
): SemanticProposalV2ValidationResult {
  if (!input.source_text.includes(proposal.product.raw_name) ||
      !proposal.product.evidence_span.includes(proposal.product.raw_name)) {
    return rejected("SEMANTIC_ENTITY_MISMATCH");
  }
  if (!validExactAmount(proposal.package_amount) ||
      (proposal.per_package_content !== null && !validExactAmount(proposal.per_package_content)) ||
      (proposal.price !== null && !evidenceContainsNumber(proposal.price.evidence_span, proposal.price.amount))) {
    return rejected("SEMANTIC_AMOUNT_MISMATCH");
  }
  const outerCount = proposal.package_amount.value;
  const capacity = proposal.per_package_content?.value ?? null;
  if (!Number.isSafeInteger(outerCount) ||
      (capacity !== null && !Number.isSafeInteger(capacity)) ||
      (capacity !== null && outerCount > Number.MAX_SAFE_INTEGER / capacity)) {
    return rejected("SEMANTIC_PROPOSAL_INVALID");
  }
  const totalCapacity = capacity === null ? null : outerCount * capacity;
  const item: CorePurchaseItemCandidate = frozen({
    order: 0,
    raw_name: proposal.product.raw_name,
    normalized_name: proposal.product.normalized_hint,
    product_type: proposal.per_package_content !== null &&
        normalizedLiquidMillilitres(1, proposal.per_package_content.unit) !== null
      ? "nutrition_drink" as const
      : "generic" as const,
    identity_reference: "explicit" as const,
    specification: proposal.per_package_content === null
      ? null
      : frozen({ value: proposal.per_package_content.value, unit: proposal.per_package_content.unit }),
    package_quantity: frozen({
      outer_count: outerCount,
      outer_unit: proposal.package_amount.unit,
      inner_per_outer: null,
      inner_unit: null,
      capacity_per_inner: capacity,
      capacity_unit: proposal.per_package_content?.unit ?? null,
      total_inner: null,
      total_capacity: totalCapacity,
      formula: capacity === null ? null : `${outerCount}*${capacity}=${totalCapacity}`,
    }),
    location: proposal.location === null
      ? frozen({
          value: "home",
          evidence_kind: "configured_home_default" as const,
          rule_version: "diet-manager/default-location-v1" as const,
        })
      : frozen({
          value: proposal.location.value,
          evidence_kind: "explicit" as const,
          rule_version: null,
        }),
    opening: null,
    expiration: frozen({
      reliability: "unknown" as const,
      explicit_at: null,
      matched_span: proposal.expires_at?.evidence_span ?? null,
    }),
  });
  const command: CorePurchaseCommandCandidate = frozen({
    action: "add_inventory" as const,
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: SEMANTIC_PARSER_VERSION,
    stocked_at: input.received_at,
    items: Object.freeze([item]),
  });
  return frozen({ disposition: "candidate" as const, command });
}

function profileNumberValid(value: Readonly<{ value: number; evidence_span: string }> | null | undefined): boolean {
  return value === null || value === undefined || evidenceContainsNumber(value.evidence_span, value.value);
}

function profileResult(
  input: SemanticProposalV2ValidationInput,
  proposal: ProfileProposalV2,
): SemanticProposalV2ValidationResult {
  if (!profileNumberValid(proposal.values.age_years) ||
      !profileNumberValid(proposal.values.height_cm) ||
      !profileNumberValid(proposal.values.weight_kg)) return rejected("SEMANTIC_AMOUNT_MISMATCH");
  const direction = proposal.values.goal_direction?.value;
  if (direction !== undefined && direction !== "cut" && direction !== "maintain" && direction !== "bulk") {
    return rejected("SEMANTIC_PROPOSAL_INVALID");
  }
  const height = proposal.values.height_cm?.value;
  const weight = proposal.values.weight_kg?.value;
  if (proposal.operation === "clear" || height === undefined || weight === undefined) {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "set_profile" as const,
      reason_code: "profile_incomplete" as const,
      question: "请同时提供身高和体重；清空资料将在资料版本任务中处理。",
    });
  }
  const command: CoreProfileCommandCandidate = frozen({
    action: "set_profile" as const,
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: SEMANTIC_PARSER_VERSION,
    height_cm: height,
    weight_kg: weight,
    sex: proposal.values.sex?.value ?? null,
    age: proposal.values.age_years?.value ?? null,
    goal_state: direction ?? null,
  });
  return frozen({ disposition: "candidate" as const, command });
}

function goalResult(
  input: SemanticProposalV2ValidationInput,
  proposal: GoalProposalV2,
): SemanticProposalV2ValidationResult {
  const fields = [
    "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g", "water_ml",
  ] as const;
  const goals: Record<string, number | null> = {};
  for (const field of fields) {
    const value = proposal.values[field];
    if (value === undefined) continue;
    if (value !== null && !evidenceContainsNumber(value.evidence_span, value.value)) {
      return rejected("SEMANTIC_AMOUNT_MISMATCH");
    }
    goals[field] = value?.value ?? null;
  }
  if (Object.keys(goals).length === 0) {
    return frozen({
      disposition: "needs_clarification" as const,
      action: "set_goal" as const,
      reason_code: "goal_incomplete" as const,
      question: "请说明要确认、更新或清空的目标。",
    });
  }
  const command: CoreGoalCommandCandidate = frozen({
    action: "set_goal" as const,
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: SEMANTIC_PARSER_VERSION,
    goals: frozen(goals),
  });
  return frozen({ disposition: "candidate" as const, command });
}

function mutationResult(
  input: SemanticProposalV2ValidationInput,
  proposal: RecordMutationProposalV2,
): SemanticProposalV2ValidationResult {
  if (isAuthorityShapedReference(proposal.target.description) ||
      isAuthorityShapedReference(proposal.target.evidence_span) ||
      (proposal.replacement !== undefined &&
        (isAuthorityShapedReference(proposal.replacement.description) ||
          isAuthorityShapedReference(proposal.replacement.evidence_span)))) {
    return rejected("SEMANTIC_AUTHORITY_REFERENCE");
  }
  const legacy = parseCoreCommand(parserInput(input));
  if (legacy.disposition === "candidate" && legacy.command.action === input.action) return legacy;
  if (legacy.disposition !== "candidate" && legacy.action === input.action) return legacy;
  if (proposal.operation === "undo" || proposal.operation === "restore") {
    const command = frozen({
      action: input.action,
      operation_id: input.operation_id,
      source_text: input.source_text,
      parser_version: SEMANTIC_PARSER_VERSION,
      target: frozen({ kind: "sole_active_meal_in_conversation" as const }),
    }) as CoreCommandCandidate;
    return frozen({ disposition: "candidate" as const, command });
  }
  return frozen({
    disposition: "needs_clarification" as const,
    action: "correct_record" as const,
    reason_code: "target_ambiguous" as const,
    question: "请说明要修改的最近一条记录及新值。",
  });
}

export function validateSemanticProposalV2(
  input: SemanticProposalV2ValidationInput,
): SemanticProposalV2ValidationResult {
  let proposal: SemanticProposalV2;
  try {
    proposal = cloneSemanticProposalV2(input.semantic_proposal, input.action, input.source_text);
  } catch {
    return rejected("SEMANTIC_PROPOSAL_INVALID");
  }
  if (expectedAction(proposal) !== input.action) return rejected("SEMANTIC_ACTION_MISMATCH");
  if (containsAuthorityReference(proposal)) return rejected("SEMANTIC_AUTHORITY_REFERENCE");

  if (proposal.kind === "meal") return mealResult(input, proposal);
  if (proposal.kind === "water") return waterResult(input, proposal);
  if (proposal.kind === "inventory") return inventoryResult(input, proposal);
  if (proposal.kind === "profile") return profileResult(input, proposal);
  if (proposal.kind === "goal") return goalResult(input, proposal);
  return mutationResult(input, proposal);
}
