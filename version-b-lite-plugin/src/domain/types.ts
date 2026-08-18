import type { DietManagerAction } from "../contracts.js";
import type {
  CoreContextEvidence,
  CoreSubjectEvidence,
  OccurredTimeEvidence,
} from "../parser/types.js";
import type { ResolvedNutritionEvidence } from "../nutrition/types.js";
import type {
  ConfiguredGoals,
  GoalOverrides,
  SixGoalValues,
} from "./goal-derivation.js";

export interface NutritionVector {
  readonly energy_kcal_milli: number | null;
  readonly protein_mg: number | null;
  readonly fat_mg: number | null;
  readonly carbohydrate_mg: number | null;
  readonly fiber_mg: number | null;
  readonly water_ml_milli: number | null;
}

export type NutritionBasisKind =
  | "per_100g"
  | "per_100ml"
  | "per_serving"
  | "per_item"
  | "per_package"
  | "custom_recipe";

export interface StructuredAmount {
  readonly unit: string;
  readonly observed_microunits: number | null;
  readonly nutrition_adoption_microunits: number | null;
  readonly inventory_deduction_microunits: number | null;
  readonly template_reference_microunits: number | null;
  readonly evidence: "explicit" | "estimated_upper_bound" | "unknown";
}

export interface KnownStructuredAmount extends StructuredAmount {
  readonly observed_microunits: number;
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
  readonly observed_microunits: number | null;
  readonly nutrition_adoption_microunits: number | null;
  readonly inventory_deduction_microunits: number | null;
  readonly template_reference_microunits: number | null;
  readonly candidates: readonly InventoryCandidate[];
}

export type InventoryMatchStatus =
  | "matched"
  | "skipped_outside"
  | "skipped_ambiguous"
  | "skipped_insufficient"
  | "skipped_unit_incompatible"
  | "skipped_amount_unknown";

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
    | "inventory_amount_unknown"
    | null;
}

export interface NutritionSourceCandidate {
  readonly source_type: "product_label" | "public_fixture";
  readonly source_ref: string;
  readonly profile_version: number;
  readonly applicable_product_id: string | null;
  readonly basis_kind: NutritionBasisKind;
  readonly basis_microunits: number;
  readonly basis_unit: string;
  readonly nutrients: NutritionVector;
}

export interface NutritionSelection {
  readonly source_type: "product_label" | "public_fixture" | "unknown";
  readonly source_ref: string;
  readonly profile_version: number;
  readonly applicable_product_id: string | null;
  readonly basis_kind: NutritionBasisKind | null;
  readonly basis_microunits: number | null;
  readonly basis_unit: string | null;
  readonly nutrients: NutritionVector;
}

export interface ProductInput {
  readonly product_id: string;
  readonly normalized_name: string;
  readonly product_type: string;
}

export interface ProductSpecificationEvidence {
  readonly value: number;
  readonly unit: string;
}

export interface ProductIdentityEvidence {
  readonly raw_name: string;
  readonly normalized_name: string;
  readonly brand: string | null;
  readonly variant_or_flavor: string | null;
  readonly specification: Readonly<ProductSpecificationEvidence> | null;
  readonly evidence_kind: "explicit" | "inherited_exact" | "unknown";
}

export interface PackageQuantityEvidence {
  readonly outer_count: number | null;
  readonly outer_unit: string | null;
  readonly inner_per_outer: number | null;
  readonly inner_unit: string | null;
  readonly capacity_per_inner: number | null;
  readonly capacity_unit: string | null;
  readonly total_inner: number | null;
  readonly total_capacity: number | null;
  readonly formula: string | null;
}

export interface StorageLocationEvidence {
  readonly value: string;
  readonly evidence_kind: "explicit" | "configured_home_default" | "corrected_explicit";
  readonly rule_version: string | null;
}

export interface OpeningEvidence {
  readonly status: "sealed" | "opened";
  readonly opened_at: string | null;
  readonly evidence_kind: "explicit" | "rule";
  readonly rule_version: string | null;
}

export interface ExpirationEvidence {
  readonly explicit_at: string | null;
  readonly effective_at: string | null;
  readonly basis: "explicit" | "rule" | "unknown";
  readonly rule_version: string | null;
}

export interface PantryPurchaseEvidence {
  readonly schema_version: "diet-manager/pantry-evidence/v1";
  readonly product_identity: Readonly<ProductIdentityEvidence>;
  readonly package_quantity: Readonly<PackageQuantityEvidence>;
  readonly location: Readonly<StorageLocationEvidence>;
  readonly opening: Readonly<OpeningEvidence> | null;
  readonly expiration: Readonly<ExpirationEvidence>;
}

export interface InventoryAllocation {
  readonly product_id: string;
  readonly batch_id: string;
  readonly before_microunits: number;
  readonly deducted_microunits: number;
  readonly after_microunits: number;
  readonly unit: string;
  readonly selection_basis: "explicit_batch" | "fefo" | "fifo";
}

export interface InventoryAllocationPlan {
  readonly status:
    | "matched"
    | "skipped_outside"
    | "skipped_by_user"
    | "skipped_amount_unknown"
    | "skipped_ambiguous"
    | "skipped_unit_incompatible"
    | "skipped_insufficient";
  readonly requested_microunits: number | null;
  readonly unit: string;
  readonly allocations: readonly Readonly<InventoryAllocation>[];
  readonly candidate_count: number;
  readonly issue_code:
    | "inventory_amount_unknown"
    | "inventory_multiple_candidates"
    | "inventory_unit_conversion_unproven"
    | "inventory_insufficient"
    | null;
  readonly read_required: boolean;
}

export interface AddInventoryOperation {
  readonly kind: "add_inventory";
  readonly operation_id: string;
  readonly product: ProductInput;
  readonly batch_id: string;
  readonly amount: StructuredAmount;
  readonly nutrition_sources: readonly NutritionSourceCandidate[];
  readonly pantry_evidence?: Readonly<PantryPurchaseEvidence>;
}

export interface InventoryDirectiveEvidence {
  readonly mode: "skip";
  readonly evidence_kind: "explicit";
  readonly matched_span: string;
  readonly rule_version: string;
}

export interface PantryInventoryPolicy {
  readonly mode: "pantry_v2";
  readonly missing_candidate_behavior: "skip_insufficient";
  readonly rule_version: "diet-manager/pantry-allocation-v1";
}

export interface MealItemInput {
  readonly normalized_name: string;
  readonly item_type: "dish" | "food" | "nutrition_drink";
  readonly inventory_directive?: Readonly<InventoryDirectiveEvidence>;
  readonly amount: StructuredAmount;
  readonly nutrition_sources: readonly NutritionSourceCandidate[];
  readonly nutrition_evidence?: Readonly<ResolvedNutritionEvidence>;
}

export interface RecordMealOperation {
  readonly kind: "record_meal";
  readonly operation_id: string;
  readonly occurred_at: string;
  readonly meal_slot: string;
  readonly location: "home" | "outside";
  readonly inventory_policy?: Readonly<PantryInventoryPolicy>;
  readonly items: readonly MealItemInput[];
  readonly source_text?: string;
  readonly occurred_time?: Readonly<OccurredTimeEvidence>;
  readonly subject?: Readonly<CoreSubjectEvidence>;
  readonly context?: Readonly<CoreContextEvidence>;
}

export interface RecordWaterOperation {
  readonly kind: "record_water";
  readonly operation_id: string;
  readonly occurred_time: Readonly<OccurredTimeEvidence>;
  readonly source_text: string;
  readonly plain_water_ml_milli: number;
  readonly amount_evidence: unknown;
}

export interface CorrectMealRecordOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly item_order: number;
  readonly replacement_amount: KnownStructuredAmount;
}

export interface CorrectInventoryLocationOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly correction_kind: "inventory_location";
  readonly batch_id: string;
  readonly base_revision: number;
  readonly previous_location: Readonly<StorageLocationEvidence>;
  readonly previous_expiration: Readonly<ExpirationEvidence>;
  readonly next_location: Readonly<StorageLocationEvidence>;
  readonly expected_expiration: Readonly<ExpirationEvidence>;
  readonly source_text: string;
  readonly matched_span: string;
  readonly rule_version: "diet-manager/location-correction/v1";
}

export interface CorrectNutritionSupplementOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly correction_kind: "nutrition_supplement";
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly item_order: number;
  readonly previous_snapshot_id: string;
  readonly replacement_amount: Readonly<KnownStructuredAmount>;
  readonly replacement_nutrition_source: Readonly<NutritionSourceCandidate>;
  readonly replacement_nutrition_evidence: Readonly<ResolvedNutritionEvidence>;
}

export interface CorrectMealTimeOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly correction_kind: "meal_time";
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly replacement_occurred_at: string;
  readonly replacement_meal_slot: string;
}

export interface CorrectWaterClassificationOperation {
  readonly kind: "correct_record";
  readonly operation_id: string;
  readonly correction_kind: "water_classification";
  readonly target_event_id: string;
  readonly base_revision: number;
  readonly replacement_kind: "nutritious_drink";
  readonly replacement_name: string;
}

export type CorrectRecordOperation =
  | CorrectMealRecordOperation
  | CorrectInventoryLocationOperation
  | CorrectNutritionSupplementOperation
  | CorrectMealTimeOperation
  | CorrectWaterClassificationOperation;

export interface InventoryLocationCorrectionResult {
  readonly sequence: number;
  readonly operation_id: string;
  readonly status: "committed";
  readonly error_code: null;
  readonly batch_id: string;
  readonly adjustment_kind: "location_correction";
  readonly previous_location: Readonly<StorageLocationEvidence>;
  readonly current_location: Readonly<StorageLocationEvidence>;
  readonly expiration: Readonly<ExpirationEvidence>;
  readonly receipt_item: Readonly<InventoryLocationCorrectionReceiptItem>;
}

export interface InventoryLocationCorrectionReceiptItem {
  readonly batch_id: string;
  readonly changed_fields: readonly ["location"];
  readonly previous_location: Readonly<StorageLocationEvidence>;
  readonly current_location: Readonly<StorageLocationEvidence>;
  readonly expiration: Readonly<ExpirationEvidence>;
}

export interface InventoryLocationCorrectionIntent {
  readonly kind: "inventory_location_correction";
  readonly batch_id: string;
  readonly base_revision: number;
  readonly previous_last_event_id: string;
  readonly previous_last_changed_at: string;
  readonly previous_projection_json: string;
  readonly next_projection_json: string;
}

export interface InventoryLocationCorrectionFactPayload {
  readonly authority_kind: "diet-manager/inventory-location-correction-fact/v1";
  readonly adjustment_kind: "location_correction";
  readonly batch_id: string;
  readonly base_revision: number;
  readonly previous_last_event_id: string;
  readonly previous_last_changed_at: string;
  readonly previous_projection_json: string;
  readonly next_projection_json: string;
  readonly previous_location: Readonly<StorageLocationEvidence>;
  readonly next_location: Readonly<StorageLocationEvidence>;
  readonly previous_expiration: Readonly<ExpirationEvidence>;
  readonly next_expiration: Readonly<ExpirationEvidence>;
  readonly source_text: string;
  readonly matched_span: string;
  readonly rule_version: "diet-manager/location-correction/v1";
  readonly effect_inputs: Readonly<Record<string, Readonly<InventoryLocationCorrectionIntent>>>;
  readonly result: Readonly<InventoryLocationCorrectionResult>;
}

export interface UndoRecordOperation {
  readonly kind: "undo_record";
  readonly operation_id: string;
  readonly target_event_id: string;
  readonly base_revision: number;
}

export interface SetProfileOperation {
  readonly kind: "set_profile";
  readonly operation_id: string;
  readonly height_cm: number;
  readonly weight_kg: number;
  readonly sex: "male" | "female" | null;
  readonly age: number | null;
  readonly goal_state: "cut" | "maintain" | "bulk" | null;
}

export interface SetProfileOperationResult {
  readonly sequence: number;
  readonly operation_id: string;
  readonly status: "committed";
  readonly error_code: null;
  readonly fact_status: "committed";
  readonly profile_id: string;
  readonly goal_version_id: string;
  readonly goals: Readonly<SixGoalValues>;
}

export interface SetGoalOperation {
  readonly kind: "set_goal";
  readonly operation_id: string;
  readonly goals: Readonly<GoalOverrides>;
}

export interface SetGoalOperationResult {
  readonly sequence: number;
  readonly operation_id: string;
  readonly status: "committed";
  readonly error_code: null;
  readonly fact_status: "committed";
  readonly goal_version_id: string;
  readonly goals: Readonly<ConfiguredGoals>;
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
  | RecordWaterOperation
  | CorrectRecordOperation
  | UndoRecordOperation
  | SetProfileOperation
  | SetGoalOperation;

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
