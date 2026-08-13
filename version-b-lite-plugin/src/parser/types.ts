import type { DietManagerAction } from "../contracts.js";

export type CoreScene = "home" | "outside" | "company" | "unknown";

type OffsetIsoZone = "Z" | `${"+" | "-"}${number}:${number}`;
// Runtime input authority freezes the exact grammar, including its 0-3 digit
// millisecond limit. TypeScript cannot express that digit bound without an
// unrepresentably large union, so this type checks the broad ISO shape while
// cloneCoreParseInput remains the precision and calendar authority.
export type OffsetIsoTimestamp =
  | `${number}-${number}-${number}T${number}:${number}:${number}${OffsetIsoZone}`
  | `${number}-${number}-${number}T${number}:${number}:${number}.${number}${OffsetIsoZone}`;

export interface CoreContextItem {
  readonly normalized_name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
}

export interface CoreContextEntry {
  readonly context_id: string;
  readonly conversation_id: string;
  readonly revision: number;
  readonly generated_at: OffsetIsoTimestamp;
  readonly valid_until: OffsetIsoTimestamp;
  readonly source_message_id: string;
  readonly rule_version: "diet-manager/context-v1";
  readonly scope: "meal" | "meal_date";
  readonly items?: readonly CoreContextItem[];
  readonly scene?: CoreScene;
}

export interface OccurredTimeEvidence {
  readonly raw_text: string | null;
  readonly resolved_start: OffsetIsoTimestamp | null;
  readonly resolved_end: OffsetIsoTimestamp | null;
  readonly precision: "exact" | "date" | "meal_period" | "approximate" | "unknown";
  readonly timezone: "Asia/Shanghai";
  readonly resolution_basis:
    | "explicit"
    | "relative_to_received_at"
    | "default_received_at"
    | "needs_clarification";
  readonly resolution_anchor: OffsetIsoTimestamp;
  readonly resolver_version: "diet-manager/time-parser-v1";
}

export interface CoreMealItem {
  readonly order: number;
  readonly kind: "food" | "nutritious_drink";
  readonly normalized_name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly estimated: boolean | null;
}

export interface CoreSubjectEvidence {
  readonly kind: "self";
  readonly resolution_basis:
    | "omitted_subject_default"
    | "explicit_self"
    | "explicit_self_share"
    | "collective_self_participation";
  readonly subject_entity_created?: false;
  readonly excluded_non_self_share_count?: number;
  readonly self_participated?: true;
  readonly matched_span: string | null;
  readonly rule_version: "diet-manager/subject-v1";
}

export interface CoreCompletionEvidence {
  readonly initial_state: "reluctance" | "unknown";
  readonly final_state: "completed";
  readonly winning_span: string;
  readonly rule_version: "diet-manager/completion-v1";
}

export interface CoreContextEvidence {
  readonly scene: CoreScene;
  readonly expired_context_ids: readonly string[];
  readonly inventory_read: boolean;
  readonly accepted_context: Readonly<CoreContextEntry> | null;
  readonly rule_version: "diet-manager/context-v1";
}

export interface CorePurchaseEvidence {
  readonly raw_text: string;
  readonly batch_reference_date: string;
  readonly affects_ingestion_date: false;
}

export interface CoreLiquidClassification {
  readonly plain_water: boolean;
  readonly plain_water_contribution_ml: number;
  readonly food_water_upper_bound_ml?: number;
}

export interface CoreExcludedItemEvidence {
  readonly normalized_name: string;
  readonly reason_code: "item_scoped_negation";
  readonly matched_span: string;
  readonly rule_version: "diet-manager/completion-v1";
}

export interface CoreGroupAmountEvidence {
  readonly quantity: number;
  readonly unit: string;
  readonly assigned_to_self: false;
  readonly matched_span: string;
  readonly rule_version: "diet-manager/subject-v1";
}

export interface CoreAmountEvidence {
  readonly raw_text: string;
  readonly quantity: number;
  readonly unit: string;
  readonly estimated: false;
}

export interface CoreMealCommandCandidate {
  readonly action: "record_meal";
  readonly operation_id: string;
  readonly meal_identity_seed: string;
  readonly source_text: string;
  readonly parser_version: "diet-manager/core-parser-v1";
  readonly occurred_time: OccurredTimeEvidence;
  readonly subject: CoreSubjectEvidence;
  readonly items: readonly CoreMealItem[];
  readonly completion_evidence?: CoreCompletionEvidence;
  readonly context?: CoreContextEvidence;
  readonly excluded_items?: readonly CoreExcludedItemEvidence[];
  readonly group_amount_evidence?: CoreGroupAmountEvidence;
  readonly purchase_evidence?: CorePurchaseEvidence;
  readonly liquid_classification?: CoreLiquidClassification;
}

export interface CoreWaterCommandCandidate {
  readonly action: "record_water";
  readonly operation_id: string;
  readonly source_text: string;
  readonly parser_version: "diet-manager/core-parser-v1";
  readonly occurred_time: OccurredTimeEvidence;
  readonly plain_water_ml_milli: number;
  readonly amount_evidence: CoreAmountEvidence;
}

export interface CoreInventoryCommandCandidate {
  readonly action: "add_inventory";
  readonly operation_id: string;
  readonly source_text: string;
  readonly parser_version: "diet-manager/core-parser-v1";
  readonly product: Readonly<{
    readonly normalized_name: "fresh_milk";
    readonly raw_text: string;
    readonly quantity: null;
    readonly unit: null;
  }>;
  readonly stocked_at: OffsetIsoTimestamp;
  readonly received_at: OffsetIsoTimestamp;
  readonly ingestion_at: null;
  readonly estimated_expires_at: OffsetIsoTimestamp;
  readonly expiration_resolution_basis: "stocked_at";
  readonly shelf_life_rule_version: "diet-manager/fresh-milk-shelf-life-v1";
}

export type CoreCommandCandidate =
  | Readonly<CoreMealCommandCandidate>
  | Readonly<CoreWaterCommandCandidate>
  | Readonly<CoreInventoryCommandCandidate>;

export interface CoreParseInput {
  readonly source_text: string;
  readonly received_at: OffsetIsoTimestamp;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly prior_context: readonly CoreContextEntry[];
}

export type CoreIgnoreReason =
  | "non_self_subject"
  | "future_plan"
  | "not_occurred"
  | "unsupported_health_advice";

export type CoreClarificationReason =
  | "occurred_date_ambiguous"
  | "unsupported_command"
  | "amount_ambiguous";

export type CoreRecognizedAction =
  | Extract<DietManagerAction, "record_meal" | "record_water" | "add_inventory">
  | "health_advice";

export type CoreIgnoredResult =
  | Readonly<{
      disposition: "ignored";
      action: "health_advice";
      reason_code: "unsupported_health_advice";
      context_id?: never;
    }>
  | Readonly<{
      disposition: "ignored";
      action: "record_meal" | "record_water";
      reason_code: "non_self_subject";
      context_id?: never;
    }>
  | Readonly<{
      disposition: "ignored";
      action: "record_meal";
      reason_code: "future_plan";
      context_id?: never;
    }>
  | Readonly<{
      disposition: "ignored";
      action: "record_meal";
      reason_code: "not_occurred";
      context_id?: string;
    }>;

export type CoreClarificationResult =
  | Readonly<{
      disposition: "needs_clarification";
      action: "record_meal";
      reason_code: "occurred_date_ambiguous";
      question: string;
      occurred_time: OccurredTimeEvidence;
      context_id?: never;
    }>
  | Readonly<{
      disposition: "needs_clarification";
      action: "record_meal" | "record_water";
      reason_code: "amount_ambiguous";
      question: string;
      occurred_time?: never;
      context_id?: never;
    }>
  | Readonly<{
      disposition: "needs_clarification";
      action: "record_meal" | "record_water";
      reason_code: "unsupported_command";
      question: string;
      occurred_time?: never;
      context_id?: never;
    }>
  | Readonly<{
      disposition: "needs_clarification";
      action: "add_inventory";
      reason_code: "unsupported_command";
      question: string;
      occurred_time?: never;
      context_id?: never;
    }>
  | Readonly<{
      disposition: "needs_clarification";
      action: "health_advice";
      reason_code: "unsupported_command";
      question: string;
      occurred_time?: never;
      context_id?: never;
    }>;

export type CoreParseResult =
  | Readonly<{ disposition: "candidate"; command: CoreCommandCandidate }>
  | CoreIgnoredResult
  | CoreClarificationResult;

type CoreTypeAssert<T extends true> = T;
type CoreTypeAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type CoreTypeNot<Value extends boolean> = Value extends true ? false : true;

type CoreTypeValidHealthIgnore = CoreTypeAssert<CoreTypeAssignable<{
  disposition: "ignored";
  action: "health_advice";
  reason_code: "unsupported_health_advice";
}, CoreParseResult>>;

type CoreTypeRejectHealthMealReason = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  disposition: "ignored";
  action: "health_advice";
  reason_code: "non_self_subject";
}, CoreParseResult>>>;

type CoreTypeRejectSpreadFutureContext = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  readonly disposition: "ignored";
  readonly action: "record_meal";
  readonly reason_code: "future_plan";
  readonly context_id: "context-unrelated";
}, CoreParseResult>>>;

type CoreTypeRejectSpreadNonSelfContext = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  readonly disposition: "ignored";
  readonly action: "record_meal";
  readonly reason_code: "non_self_subject";
  readonly context_id: "context-unrelated";
}, CoreParseResult>>>;

type CoreTypeRejectSpreadHealthContext = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  readonly disposition: "ignored";
  readonly action: "health_advice";
  readonly reason_code: "unsupported_health_advice";
  readonly context_id: "context-unrelated";
}, CoreParseResult>>>;

type CoreTypeAcceptNotOccurredContext = CoreTypeAssert<CoreTypeAssignable<{
  readonly disposition: "ignored";
  readonly action: "record_meal";
  readonly reason_code: "not_occurred";
  readonly context_id: "context-meal-016-v1";
}, CoreParseResult>>;

type CoreTypeAcceptWaterNonSelf = CoreTypeAssert<CoreTypeAssignable<{
  readonly disposition: "ignored";
  readonly action: "record_water";
  readonly reason_code: "non_self_subject";
}, CoreParseResult>>;

type CoreTypeMealIdentitySeed = CoreTypeAssert<CoreTypeAssignable<{
  readonly action: "record_meal";
  readonly operation_id: "operation-core-types-identity";
  readonly meal_identity_seed: "operation-core-types-identity";
  readonly source_text: "吃了一个苹果。";
  readonly parser_version: "diet-manager/core-parser-v1";
  readonly occurred_time: OccurredTimeEvidence;
  readonly subject: CoreSubjectEvidence;
  readonly items: readonly CoreMealItem[];
}, CoreMealCommandCandidate>>;

type CoreTypeAcceptMealUnsupportedClarification = CoreTypeAssert<CoreTypeAssignable<{
  readonly disposition: "needs_clarification";
  readonly action: "record_meal";
  readonly reason_code: "unsupported_command";
  readonly question: "请拆分输入";
}, CoreParseResult>>;

type CoreTypeAcceptWaterUnsupportedClarification = CoreTypeAssert<CoreTypeAssignable<{
  readonly disposition: "needs_clarification";
  readonly action: "record_water";
  readonly reason_code: "unsupported_command";
  readonly question: "请确认是否已发生";
}, CoreParseResult>>;

type CoreTypeAcceptHealthUnsupportedClarification = CoreTypeAssert<CoreTypeAssignable<{
  readonly disposition: "needs_clarification";
  readonly action: "health_advice";
  readonly reason_code: "unsupported_command";
  readonly question: "这是术语解释请求";
}, CoreParseResult>>;

type CoreTypeRejectHealthAmountClarification = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  readonly disposition: "needs_clarification";
  readonly action: "health_advice";
  readonly reason_code: "amount_ambiguous";
  readonly question: "请说明数量";
}, CoreParseResult>>>;

type CoreTypeRejectHealthClarificationContext = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  readonly disposition: "needs_clarification";
  readonly action: "health_advice";
  readonly reason_code: "unsupported_command";
  readonly question: "这是术语解释请求";
  readonly context_id: "context-unrelated";
}, CoreParseResult>>>;

type CoreTypeRejectIncompleteOccurredClarification = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  disposition: "needs_clarification";
  action: "record_meal";
  reason_code: "occurred_date_ambiguous";
  question: "哪一天？";
}, CoreParseResult>>>;

type CoreTypeRejectMalformedOccurredAnchor = CoreTypeAssert<CoreTypeNot<CoreTypeAssignable<{
  raw_text: null;
  resolved_start: null;
  resolved_end: null;
  precision: "unknown";
  timezone: "Asia/Shanghai";
  resolution_basis: "needs_clarification";
  resolution_anchor: "not-iso";
  resolver_version: "diet-manager/time-parser-v1";
}, OccurredTimeEvidence>>>;
