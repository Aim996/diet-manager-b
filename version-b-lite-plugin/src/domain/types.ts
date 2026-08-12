import type { DietManagerAction } from "../contracts.js";

export interface NutritionVector {
  readonly energy_kcal_milli: number | null;
  readonly protein_mg: number | null;
  readonly fat_mg: number | null;
  readonly carbohydrate_mg: number | null;
  readonly fiber_mg: number | null;
  readonly water_ml_milli: number | null;
}

export interface StructuredAmount {
  readonly unit: string;
  readonly observed_microunits: number;
  readonly nutrition_adoption_microunits: number | null;
  readonly inventory_deduction_microunits: number | null;
  readonly template_reference_microunits: number | null;
  readonly evidence: "explicit" | "estimated_upper_bound";
}

export interface InventoryCandidate {
  readonly batch_id: string;
  readonly product_id: string;
  readonly available_microunits: number;
  readonly unit: string;
}

export interface InventoryMatchInput {
  readonly location: "home" | "outside";
  readonly requested_unit: string;
  readonly observed_microunits: number;
  readonly nutrition_adoption_microunits: number | null;
  readonly inventory_deduction_microunits: number;
  readonly template_reference_microunits: number | null;
  readonly candidates: readonly InventoryCandidate[];
}

export type InventoryMatchStatus =
  | "matched"
  | "skipped_outside"
  | "skipped_ambiguous"
  | "skipped_insufficient"
  | "skipped_unit_incompatible";

export interface InventoryMatchDecision {
  readonly status: InventoryMatchStatus;
  readonly batch_id: string | null;
  readonly product_id: string | null;
  readonly deduction_microunits: number;
  readonly unit: string;
  readonly issue_code:
    | "inventory_multiple_candidates"
    | "inventory_insufficient"
    | "inventory_unit_incompatible"
    | null;
}

export interface NutritionSourceCandidate {
  readonly source_type: "product_label" | "public_fixture";
  readonly source_ref: string;
  readonly profile_version: number;
  readonly applicable_product_id: string | null;
  readonly nutrients: NutritionVector;
}

export interface NutritionSelection {
  readonly source_type: "product_label" | "public_fixture" | "unknown";
  readonly source_ref: string;
  readonly profile_version: number;
  readonly applicable_product_id: string | null;
  readonly nutrients: NutritionVector;
}

export interface ProductInput {
  readonly product_id: string;
  readonly normalized_name: string;
  readonly product_type: string;
}

export interface AddInventoryOperation {
  readonly kind: "add_inventory";
  readonly operation_id: string;
  readonly product: ProductInput;
  readonly batch_id: string;
  readonly amount: StructuredAmount;
  readonly nutrition_sources: readonly NutritionSourceCandidate[];
}

export interface MealItemInput {
  readonly normalized_name: string;
  readonly item_type: "dish" | "food" | "nutrition_drink";
  readonly amount: StructuredAmount;
  readonly nutrition_sources: readonly NutritionSourceCandidate[];
}

export interface RecordMealOperation {
  readonly kind: "record_meal";
  readonly operation_id: string;
  readonly occurred_at: string;
  readonly meal_slot: string;
  readonly location: "home" | "outside";
  readonly items: readonly MealItemInput[];
}

export interface CorrectRecordOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly item_order: number;
  readonly replacement_amount: StructuredAmount;
}

export interface UndoRecordOperation {
  readonly kind: "undo_record";
  readonly operation_id: string;
  readonly target_event_id: string;
  readonly base_revision: number;
}

export interface QueryInventoryOperation {
  readonly kind: "query_inventory";
  readonly operation_id: string;
}

export interface QueryMealsOperation {
  readonly kind: "query_meals";
  readonly operation_id: string;
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
}

export interface QueryDailySummaryOperation {
  readonly kind: "query_daily_summary";
  readonly operation_id: string;
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
}

export type DomainWriteOperation =
  | AddInventoryOperation
  | RecordMealOperation
  | CorrectRecordOperation
  | UndoRecordOperation;

export type DomainQueryOperation =
  | QueryInventoryOperation
  | QueryMealsOperation
  | QueryDailySummaryOperation;

export type DomainOperation = DomainWriteOperation | DomainQueryOperation;

export interface DomainEnvelopeInput {
  readonly envelope_id: string;
  readonly idempotency_key: string;
  readonly command_type: DietManagerAction;
  readonly subject_scope: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operations: readonly DomainOperation[];
}

export interface DomainOperationResult {
  readonly sequence: number;
  readonly operation_id: string;
  readonly status:
    | "committed"
    | "committed_with_issues"
    | "needs_clarification"
    | "ignored"
    | "failed";
  readonly error_code: string | null;
}

export interface DomainExecutionResult {
  readonly envelope_id: string;
  readonly input_digest: string;
  readonly status: "committed" | "committed_with_issues" | "effects_pending";
  readonly items: readonly DomainOperationResult[];
  readonly payload: unknown;
}
