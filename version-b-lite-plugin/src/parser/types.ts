import type { DietManagerAction } from "../contracts.js";

export type CoreScene = "home" | "outside" | "company" | "unknown";

export interface CoreContextItem {
  readonly normalized_name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
}

export interface CoreContextEntry {
  readonly context_id: string;
  readonly conversation_id: string;
  readonly revision: number;
  readonly generated_at: string;
  readonly valid_until: string;
  readonly source_message_id: string;
  readonly rule_version: "diet-manager/context-v1";
  readonly scope: "meal" | "meal_date";
  readonly items?: readonly CoreContextItem[];
  readonly scene?: CoreScene;
}

export interface OccurredTimeEvidence {
  readonly raw_text: string | null;
  readonly resolved_start: string | null;
  readonly resolved_end: string | null;
  readonly precision: "exact" | "date" | "meal_period" | "approximate" | "unknown";
  readonly timezone: "Asia/Shanghai";
  readonly resolution_basis:
    | "explicit"
    | "relative_to_received_at"
    | "default_received_at"
    | "needs_clarification";
  readonly resolution_anchor: string;
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

export interface CoreAmountEvidence {
  readonly raw_text: string;
  readonly quantity: number;
  readonly unit: string;
  readonly estimated: false;
}

export interface CoreMealCommandCandidate {
  readonly action: "record_meal";
  readonly operation_id: string;
  readonly source_text: string;
  readonly occurred_time: OccurredTimeEvidence;
  readonly subject: CoreSubjectEvidence;
  readonly items: readonly CoreMealItem[];
  readonly completion_evidence?: CoreCompletionEvidence;
  readonly context?: CoreContextEvidence;
  readonly purchase_evidence?: CorePurchaseEvidence;
  readonly liquid_classification?: CoreLiquidClassification;
}

export interface CoreWaterCommandCandidate {
  readonly action: "record_water";
  readonly operation_id: string;
  readonly source_text: string;
  readonly occurred_time: OccurredTimeEvidence;
  readonly plain_water_ml_milli: number;
  readonly amount_evidence: CoreAmountEvidence;
}

export type CoreCommandCandidate =
  | Readonly<CoreMealCommandCandidate>
  | Readonly<CoreWaterCommandCandidate>;

export interface CoreParseInput {
  readonly source_text: string;
  readonly received_at: string;
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

export type CoreParseResult =
  | Readonly<{ disposition: "candidate"; command: CoreCommandCandidate }>
  | Readonly<{
      disposition: "ignored";
      action: DietManagerAction;
      reason_code: CoreIgnoreReason;
    }>
  | Readonly<{
      disposition: "needs_clarification";
      action: DietManagerAction;
      reason_code: CoreClarificationReason;
      question: string;
    }>;
