import {
  dietManagerActions,
  type DietManagerAction,
} from "./contracts/actions.js";

export { dietManagerActions } from "./contracts/actions.js";
export type { DietManagerAction } from "./contracts/actions.js";
export { dietManagerContract } from "./contracts/identity.js";
export * from "./contracts/agent-command-v2.js";
export * from "./contracts/semantic-proposal-v2.js";
export * from "./contracts/outcome-v2.js";
export * from "./contracts/progress-receipt-v1.js";

export const dietManagerStatuses = [
  "committed",
  "committed_with_issues",
  "needs_clarification",
  "ignored",
  "failed",
] as const;

export type DietManagerStatus = (typeof dietManagerStatuses)[number];

export interface DietManagerItem {
  name: string;
  quantity?: number;
  unit?: string;
  per_item_amount?: number;
  per_item_unit?: string;
}

export interface DietManagerRequest {
  action: DietManagerAction;
  operation_id?: string;
  source_text?: string;
  occurred_at_text?: string;
  items?: DietManagerItem[];
  received_at?: string;
  timezone?: "Asia/Shanghai";
  source_message_id?: string;
  conversation_id?: string;
}

export interface CoreApplicationRequest {
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly prior_context: readonly import("./parser/types.js").CoreContextEntry[];
  readonly semantic_candidate?: import("./semantic/candidate.js").SemanticMealCandidateV1;
  readonly semantic_proposal?: import("./contracts/semantic-proposal-v2.js").SemanticProposalV2;
}

export interface FailedOutcome {
  action: DietManagerAction;
  status: "failed";
  committed: false;
  operation_id?: string;
  error_code: string;
  record_id?: never;
}

export interface NonWritingOutcome {
  action: DietManagerAction;
  status: "needs_clarification" | "ignored";
  committed: false;
  operation_id?: string;
  reason_code: string;
  question?: string;
  missing_items?: readonly string[];
  clarification?: ProductIdentityClarification;
  daily_progress?: Readonly<DailyProgressView>;
  meal_history?: Readonly<MealHistoryView>;
  inventory_view?: Readonly<InventoryView>;
  correction?: Readonly<CorrectionOutcomeView>;
  pending_candidate?: Readonly<PendingCandidateOutcomeView>;
  record_id?: never;
  record_ids?: never;
}

export interface PendingCandidateOutcomeView {
  readonly missing_field: string;
  readonly expires_at: string;
  readonly revision: number;
}

export interface MealHistoryView {
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly meals: readonly Readonly<{
    readonly occurred_at: string;
    readonly meal_slot: string;
    readonly location: "home" | "outside";
    readonly audit_ref: Readonly<{
      readonly original_event_id: string;
      readonly latest_correction_id: string | null;
    }>;
    readonly items: readonly Readonly<{
      readonly item_order: number;
      readonly item_type: string;
      readonly name: string;
      readonly quantity_microunits: number | null;
      readonly unit: string;
      readonly quantity_evidence: "explicit" | "estimated_upper_bound" | "unknown";
    }>[];
  }>[];
}

export interface InventoryView {
  readonly batches: readonly Readonly<{
    readonly batch_id: string;
    readonly product_id: string;
    readonly name: string;
    readonly product_type: string;
    readonly quantity_microunits: number | null;
    readonly unit: string;
    readonly quantity_status: "available" | "empty" | "unknown";
    readonly effective_status: "active" | "empty";
    readonly expiration_at: string | null;
    readonly location: string;
    readonly quantity_balance?: Readonly<{
      readonly package_unit: string;
      readonly package_milliunits: number;
      readonly whole_packages: number;
      readonly base_unit: string | null;
      readonly remaining_base_microunits: number | null;
      readonly remainder_base_microunits: number | null;
      readonly revision: number;
    }>;
  }>[];
}

export interface DailyProgressConfiguredGoalsView {
  readonly energy_kcal: number | null;
  readonly protein_g: number | null;
  readonly fat_g: number | null;
  readonly carbohydrate_g: number | null;
  readonly fiber_g: number | null;
  readonly water_ml: number | null;
}

export interface DailyProgressBarView {
  readonly current: number;
  readonly target: number;
  readonly percentage: number;
  readonly filled_cells: number;
  readonly bar_text: string;
}

export interface DailyProgressBarsView {
  readonly energy_kcal?: Readonly<DailyProgressBarView>;
  readonly protein_g?: Readonly<DailyProgressBarView>;
  readonly fat_g?: Readonly<DailyProgressBarView>;
  readonly carbohydrate_g?: Readonly<DailyProgressBarView>;
  readonly fiber_g?: Readonly<DailyProgressBarView>;
  readonly water_ml?: Readonly<DailyProgressBarView>;
}

export interface DailyProgressView {
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly meals: Readonly<{ readonly count: number }>;
  readonly water: Readonly<{ readonly count: number; readonly plain_water_ml_milli: number }>;
  readonly nutrition: Readonly<{
    readonly coverage_status: "complete" | "partial" | "unknown";
    readonly nutrients: Readonly<{
      readonly energy_kcal_milli: number | null;
      readonly protein_mg: number | null;
      readonly fat_mg: number | null;
      readonly carbohydrate_mg: number | null;
      readonly fiber_mg: number | null;
      readonly water_ml_milli: number | null;
    }>;
  }>;
  readonly inventory: Readonly<{ readonly deduction_count: number }>;
  readonly purchases: Readonly<{ readonly count: number }>;
  readonly corrections: Readonly<{ readonly count: number }>;
  readonly configured_goals?: Readonly<DailyProgressConfiguredGoalsView>;
  readonly progress?: Readonly<DailyProgressBarsView>;
}

export interface ProductIdentityClarificationOption {
  readonly key: "A" | "B" | "C" | "D";
  readonly label: string;
}

export interface ProductIdentityClarification {
  readonly kind: "product_identity";
  readonly options: readonly ProductIdentityClarificationOption[];
  readonly free_text_allowed: true;
}

export interface NutritionOutcomeAmountRange {
  readonly min: string;
  readonly max: string;
  readonly adopted: string;
  readonly unit: string;
  readonly rule_version: string;
}

export interface NutritionOutcomeItem {
  readonly item_id: string;
  readonly name: string;
  readonly adopted_amount: string | null;
  readonly adopted_unit: string | null;
  readonly amount_range: Readonly<NutritionOutcomeAmountRange> | null;
  readonly quantity_evidence: "explicit" | "field_inference" | "unknown";
  readonly source_label: "explicit" | "confirmed_history" | "personal_template" |
    "public_reference" | "field_inference" | "estimate" | "unknown";
  readonly coverage_status: "complete" | "partial" | "unknown";
  readonly known_fields: readonly string[];
  readonly missing_fields: readonly string[];
  readonly estimated_fields: readonly string[];
}

export type MealReceiptInventoryStatus =
  | "matched"
  | "skipped_outside"
  | "skipped_by_user"
  | "skipped_ambiguous"
  | "skipped_insufficient"
  | "skipped_unit_incompatible"
  | "skipped_amount_unknown";

export interface MealReceiptItem {
  readonly item_id: string;
  readonly name: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly derived: boolean;
  readonly nutrition: Readonly<{
    readonly status: NutritionOutcomeItem["coverage_status"];
    readonly source: NutritionOutcomeItem["source_label"];
  }>;
  readonly inventory: Readonly<{
    readonly status: MealReceiptInventoryStatus;
    readonly deducted_quantity: number;
    readonly deducted_unit: string | null;
    readonly shortage_quantity: number | null;
    readonly message: string;
  }>;
}

export interface MealReceipt {
  readonly raw_text: string;
  readonly items: readonly MealReceiptItem[];
}

export interface CorrectionOutcomeView {
  readonly correction_id: string;
  readonly target_event_id: string;
  readonly revision: number;
  readonly operation: "void_event" | "change_amount" | "change_time" | "change_water_classification" | "restore_event";
  readonly current_active: boolean;
  readonly compensation_transaction_id: string | null;
}

export interface CommittedOutcome {
  action: DietManagerAction;
  status: "committed" | "committed_with_issues";
  committed: true;
  operation_id: string;
  record_id: string;
  record_ids?: readonly string[];
  nutrition_items?: readonly NutritionOutcomeItem[];
  receipt?: Readonly<MealReceipt>;
  correction?: Readonly<CorrectionOutcomeView>;
}

export type DietManagerOutcome =
  | FailedOutcome
  | NonWritingOutcome
  | CommittedOutcome;

function invalidOutcome(reason: string): never {
  throw new TypeError(`DIET_MANAGER_OUTCOME_INVALID:${reason}`);
}

function exactOutcomeKeys(candidate: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  const keys = Object.keys(candidate).sort();
  const expected = [...required, ...optional.filter((key) => Object.hasOwn(candidate, key))].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return invalidOutcome("keys");
  }
}

function assertClarification(value: unknown): asserts value is ProductIdentityClarification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidOutcome("clarification");
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join("\0") !== "free_text_allowed\0kind\0options" ||
      candidate.kind !== "product_identity" || candidate.free_text_allowed !== true ||
      !Array.isArray(candidate.options) || candidate.options.length < 2 || candidate.options.length > 4) {
    return invalidOutcome("clarification");
  }
  const keys = ["A", "B", "C", "D"];
  for (const [index, option] of candidate.options.entries()) {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      return invalidOutcome("clarification_option");
    }
    const record = option as Record<string, unknown>;
    if (Object.keys(record).sort().join("\0") !== "key\0label" || record.key !== keys[index] ||
        typeof record.label !== "string" || record.label.length === 0 || record.label.length > 128 ||
        /[\u0000-\u001F\u007F]/u.test(record.label)) {
      return invalidOutcome("clarification_option");
    }
  }
}

const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
function isCanonicalFiniteDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && CANONICAL_DECIMAL.test(value) &&
    Number.isFinite(Number(value));
}
const NUTRITION_FIELD_NAMES = new Set([
  "energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g",
  "energy_kj", "sodium_mg", "sugar_g", "saturated_fat_g", "water_ml",
  "adopted_amount",
]);

function assertExactStringSet(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length ||
      value.some((item) => typeof item !== "string" || !NUTRITION_FIELD_NAMES.has(item))) {
    return invalidOutcome(label);
  }
}

function assertNutritionItem(value: unknown): asserts value is NutritionOutcomeItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("nutrition_item");
  const item = value as Record<string, unknown>;
  const keys = [
    "adopted_amount", "adopted_unit", "amount_range", "coverage_status", "estimated_fields",
    "item_id", "known_fields", "missing_fields", "name", "quantity_evidence", "source_label",
  ];
  if (Object.keys(item).sort().join("\0") !== keys.join("\0") ||
      typeof item.item_id !== "string" || item.item_id.length === 0 || item.item_id.length > 128 ||
      typeof item.name !== "string" || item.name.length === 0 || item.name.length > 256 ||
      !["explicit", "field_inference", "unknown"].includes(item.quantity_evidence as string) ||
      !["explicit", "confirmed_history", "personal_template", "public_reference", "field_inference", "estimate", "unknown"].includes(item.source_label as string) ||
      !["complete", "partial", "unknown"].includes(item.coverage_status as string)) {
    return invalidOutcome("nutrition_item");
  }
  if (item.adopted_amount === null || item.adopted_unit === null) {
    if (item.adopted_amount !== null || item.adopted_unit !== null || item.quantity_evidence !== "unknown" || item.amount_range !== null) {
      return invalidOutcome("nutrition_amount");
    }
  } else if (!isCanonicalFiniteDecimal(item.adopted_amount) ||
      typeof item.adopted_unit !== "string" || item.adopted_unit.length === 0 || item.adopted_unit.length > 32) {
    return invalidOutcome("nutrition_amount");
  }
  if (item.amount_range !== null) {
    if (typeof item.amount_range !== "object" || Array.isArray(item.amount_range)) return invalidOutcome("nutrition_amount_range");
    const range = item.amount_range as Record<string, unknown>;
    if (Object.keys(range).sort().join("\0") !== "adopted\0max\0min\0rule_version\0unit" ||
        !isCanonicalFiniteDecimal(range.min) ||
        !isCanonicalFiniteDecimal(range.max) ||
        !isCanonicalFiniteDecimal(range.adopted) ||
        typeof range.unit !== "string" || range.unit.length === 0 || range.unit !== item.adopted_unit ||
        typeof range.rule_version !== "string" || range.rule_version.length === 0 ||
        Number(range.min) > Number(range.adopted) || Number(range.adopted) > Number(range.max) ||
        range.adopted !== item.adopted_amount || item.quantity_evidence !== "field_inference") {
      return invalidOutcome("nutrition_amount_range");
    }
  }
  const knownFields = item.known_fields;
  const missingFields = item.missing_fields;
  const estimatedFields = item.estimated_fields;
  assertExactStringSet(knownFields, "nutrition_known_fields");
  assertExactStringSet(missingFields, "nutrition_missing_fields");
  assertExactStringSet(estimatedFields, "nutrition_estimated_fields");
  if (knownFields.some((field) => missingFields.includes(field))) return invalidOutcome("nutrition_field_overlap");
}

function assertMealReceipt(value: unknown): asserts value is MealReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("receipt");
  const receipt = value as Record<string, unknown>;
  if (Object.keys(receipt).sort().join("\0") !== "items\0raw_text" ||
      typeof receipt.raw_text !== "string" || receipt.raw_text.length === 0 || receipt.raw_text.length > 4_096 ||
      !Array.isArray(receipt.items) || receipt.items.length === 0 || receipt.items.length > 64) {
    return invalidOutcome("receipt");
  }
  const inventoryStatuses = [
    "matched", "skipped_outside", "skipped_by_user", "skipped_ambiguous",
    "skipped_insufficient", "skipped_unit_incompatible", "skipped_amount_unknown",
  ];
  for (const value of receipt.items) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("receipt_item");
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join("\0") !== "derived\0inventory\0item_id\0name\0nutrition\0quantity\0unit" ||
        typeof item.item_id !== "string" || item.item_id.length === 0 ||
        typeof item.name !== "string" || item.name.length === 0 ||
        typeof item.derived !== "boolean" ||
        (item.quantity !== null && (!Number.isFinite(item.quantity) || Number(item.quantity) <= 0)) ||
        (item.unit !== null && (typeof item.unit !== "string" || item.unit.length === 0)) ||
        (item.quantity === null) !== (item.unit === null)) return invalidOutcome("receipt_item");
    const nutrition = item.nutrition as Record<string, unknown> | null;
    const inventory = item.inventory as Record<string, unknown> | null;
    if (typeof nutrition !== "object" || nutrition === null || Array.isArray(nutrition) ||
        Object.keys(nutrition).sort().join("\0") !== "source\0status" ||
        !["complete", "partial", "unknown"].includes(String(nutrition.status)) ||
        !["explicit", "confirmed_history", "personal_template", "public_reference", "field_inference", "estimate", "unknown"]
          .includes(String(nutrition.source)) ||
        typeof inventory !== "object" || inventory === null || Array.isArray(inventory) ||
        Object.keys(inventory).sort().join("\0") !==
          "deducted_quantity\0deducted_unit\0message\0shortage_quantity\0status" ||
        !inventoryStatuses.includes(String(inventory.status)) ||
        !Number.isFinite(inventory.deducted_quantity) || Number(inventory.deducted_quantity) < 0 ||
        (Number(inventory.deducted_quantity) === 0) !== (inventory.deducted_unit === null) ||
        (inventory.deducted_unit !== null &&
          (typeof inventory.deducted_unit !== "string" || inventory.deducted_unit.length < 1)) ||
        (inventory.shortage_quantity !== null &&
          (!Number.isFinite(inventory.shortage_quantity) || Number(inventory.shortage_quantity) < 0)) ||
        typeof inventory.message !== "string" || inventory.message.length < 1 || inventory.message.length > 128) {
      return invalidOutcome("receipt_item_effects");
    }
  }
}

const GOAL_DIMENSIONS = ["energy_kcal", "protein_g", "fat_g", "carbohydrate_g", "fiber_g", "water_ml"] as const;

function assertConfiguredGoals(value: unknown): asserts value is DailyProgressConfiguredGoalsView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("configured_goals");
  const goals = value as Record<string, unknown>;
  if (Object.keys(goals).sort().join("\0") !== [...GOAL_DIMENSIONS].sort().join("\0")) return invalidOutcome("configured_goals");
  for (const field of GOAL_DIMENSIONS) {
    const entry = goals[field];
    if (entry !== null && (!Number.isFinite(entry) || Number(entry) <= 0)) return invalidOutcome("configured_goals_value");
  }
}

function assertProgressBar(value: unknown): asserts value is DailyProgressBarView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("progress_bar");
  const bar = value as Record<string, unknown>;
  if (Object.keys(bar).sort().join("\0") !== "bar_text\0current\0filled_cells\0percentage\0target") {
    return invalidOutcome("progress_bar");
  }
  if (!Number.isFinite(bar.current) || Number(bar.current) < 0 ||
      !Number.isFinite(bar.target) || Number(bar.target) <= 0 ||
      !Number.isFinite(bar.percentage) ||
      !Number.isInteger(bar.filled_cells) || Number(bar.filled_cells) < 0 || Number(bar.filled_cells) > 10 ||
      typeof bar.bar_text !== "string" || !/^[█░]{10}$/u.test(bar.bar_text)) {
    return invalidOutcome("progress_bar");
  }
}

function assertProgressBars(value: unknown): asserts value is DailyProgressBarsView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("progress");
  const bars = value as Record<string, unknown>;
  if (Object.keys(bars).some((key) => !GOAL_DIMENSIONS.includes(key as (typeof GOAL_DIMENSIONS)[number]))) {
    return invalidOutcome("progress");
  }
  for (const key of Object.keys(bars)) assertProgressBar(bars[key]);
}

function assertDailyProgress(value: unknown): asserts value is DailyProgressView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("daily_progress");
  const progress = value as Record<string, unknown>;
  const baseKeys = ["corrections", "date", "inventory", "meals", "nutrition", "purchases", "timezone", "water"];
  const optionalKeys = ["configured_goals", "progress"];
  const keys = Object.keys(progress).sort();
  const expectedKeys = [...baseKeys, ...optionalKeys.filter((key) => Object.hasOwn(progress, key))].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) ||
      typeof progress.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(progress.date) ||
      progress.timezone !== "Asia/Shanghai") return invalidOutcome("daily_progress");
  const exactCount = (entry: unknown, key: "count" | "deduction_count"): number => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return invalidOutcome("daily_progress_count");
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).join("\0") !== key || !Number.isSafeInteger(record[key]) || Number(record[key]) < 0) {
      return invalidOutcome("daily_progress_count");
    }
    return Number(record[key]);
  };
  exactCount(progress.meals, "count");
  exactCount(progress.purchases, "count");
  exactCount(progress.corrections, "count");
  exactCount(progress.inventory, "deduction_count");
  if (typeof progress.water !== "object" || progress.water === null || Array.isArray(progress.water)) {
    return invalidOutcome("daily_progress_water");
  }
  const water = progress.water as Record<string, unknown>;
  if (Object.keys(water).sort().join("\0") !== "count\0plain_water_ml_milli" ||
      !Number.isSafeInteger(water.count) || Number(water.count) < 0 ||
      !Number.isSafeInteger(water.plain_water_ml_milli) || Number(water.plain_water_ml_milli) < 0) {
    return invalidOutcome("daily_progress_water");
  }
  if (typeof progress.nutrition !== "object" || progress.nutrition === null || Array.isArray(progress.nutrition)) {
    return invalidOutcome("daily_progress_nutrition");
  }
  const nutrition = progress.nutrition as Record<string, unknown>;
  if (Object.keys(nutrition).sort().join("\0") !== "coverage_status\0nutrients" ||
      !["complete", "partial", "unknown"].includes(String(nutrition.coverage_status)) ||
      typeof nutrition.nutrients !== "object" || nutrition.nutrients === null || Array.isArray(nutrition.nutrients)) {
    return invalidOutcome("daily_progress_nutrition");
  }
  const nutrients = nutrition.nutrients as Record<string, unknown>;
  const fields = ["carbohydrate_mg", "energy_kcal_milli", "fat_mg", "fiber_mg", "protein_mg", "water_ml_milli"];
  if (Object.keys(nutrients).sort().join("\0") !== fields.join("\0") ||
      fields.some((field) => nutrients[field] !== null &&
        (!Number.isSafeInteger(nutrients[field]) || Number(nutrients[field]) < 0))) {
    return invalidOutcome("daily_progress_nutrients");
  }
  if (progress.configured_goals !== undefined) assertConfiguredGoals(progress.configured_goals);
  if (progress.progress !== undefined) assertProgressBars(progress.progress);
}

function boundedText(value: unknown, reason: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      /[\u0000-\u001F\u007F]/u.test(value)) return invalidOutcome(reason);
  return value;
}

function assertMealHistory(value: unknown): asserts value is MealHistoryView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("meal_history");
  const view = value as Record<string, unknown>;
  if (Object.keys(view).sort().join("\0") !== "date\0meals\0timezone" ||
      typeof view.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(view.date) ||
      view.timezone !== "Asia/Shanghai" || !Array.isArray(view.meals) || view.meals.length > 512) {
    return invalidOutcome("meal_history");
  }
  for (const mealValue of view.meals) {
    if (typeof mealValue !== "object" || mealValue === null || Array.isArray(mealValue)) {
      return invalidOutcome("meal_history_meal");
    }
    const meal = mealValue as Record<string, unknown>;
    if (Object.keys(meal).sort().join("\0") !== "audit_ref\0items\0location\0meal_slot\0occurred_at" ||
        !Number.isFinite(Date.parse(String(meal.occurred_at))) ||
        !["home", "outside"].includes(String(meal.location)) ||
        !Array.isArray(meal.items) || meal.items.length > 64) return invalidOutcome("meal_history_meal");
    boundedText(meal.meal_slot, "meal_history_slot", 64);
    const auditRef = meal.audit_ref as Record<string, unknown> | undefined;
    if (typeof auditRef !== "object" || auditRef === null || Array.isArray(auditRef) ||
        Object.keys(auditRef).sort().join("\0") !== "latest_correction_id\0original_event_id" ||
        typeof auditRef.original_event_id !== "string" || auditRef.original_event_id.length === 0 ||
        auditRef.original_event_id.length > 128 ||
        (auditRef.latest_correction_id !== null &&
          (typeof auditRef.latest_correction_id !== "string" ||
           auditRef.latest_correction_id.length === 0 || auditRef.latest_correction_id.length > 128))) {
      return invalidOutcome("meal_history_meal");
    }
    for (const [index, itemValue] of meal.items.entries()) {
      if (typeof itemValue !== "object" || itemValue === null || Array.isArray(itemValue)) {
        return invalidOutcome("meal_history_item");
      }
      const item = itemValue as Record<string, unknown>;
      if (Object.keys(item).sort().join("\0") !==
          "item_order\0item_type\0name\0quantity_evidence\0quantity_microunits\0unit" ||
          item.item_order !== index ||
          (item.quantity_microunits !== null &&
            (!Number.isSafeInteger(item.quantity_microunits) || Number(item.quantity_microunits) <= 0)) ||
          !["explicit", "estimated_upper_bound", "unknown"].includes(String(item.quantity_evidence)) ||
          (item.quantity_microunits === null) !== (item.quantity_evidence === "unknown")) {
        return invalidOutcome("meal_history_item");
      }
      boundedText(item.item_type, "meal_history_item_type", 64);
      boundedText(item.name, "meal_history_item_name", 256);
      boundedText(item.unit, "meal_history_item_unit", 64);
    }
  }
}

function assertInventoryView(value: unknown): asserts value is InventoryView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidOutcome("inventory_view");
  const view = value as Record<string, unknown>;
  if (Object.keys(view).join("\0") !== "batches" || !Array.isArray(view.batches) || view.batches.length > 2_048) {
    return invalidOutcome("inventory_view");
  }
  for (const batchValue of view.batches) {
    if (typeof batchValue !== "object" || batchValue === null || Array.isArray(batchValue)) {
      return invalidOutcome("inventory_batch");
    }
    const batch = batchValue as Record<string, unknown>;
    const batchKeys = Object.keys(batch).sort().join("\0");
    if (batchKeys !==
          "batch_id\0effective_status\0expiration_at\0location\0name\0product_id\0product_type\0quantity_microunits\0quantity_status\0unit" &&
        batchKeys !==
          "batch_id\0effective_status\0expiration_at\0location\0name\0product_id\0product_type\0quantity_balance\0quantity_microunits\0quantity_status\0unit" ||
        (batch.quantity_microunits !== null &&
          (!Number.isSafeInteger(batch.quantity_microunits) || Number(batch.quantity_microunits) < 0)) ||
        !["available", "empty", "unknown"].includes(String(batch.quantity_status)) ||
        !["active", "empty"].includes(String(batch.effective_status)) ||
        (batch.expiration_at !== null && !Number.isFinite(Date.parse(String(batch.expiration_at))))) {
      return invalidOutcome("inventory_batch");
    }
    boundedText(batch.batch_id, "inventory_batch_id", 128);
    boundedText(batch.product_id, "inventory_product_id", 128);
    boundedText(batch.name, "inventory_name", 256);
    boundedText(batch.product_type, "inventory_product_type", 64);
    boundedText(batch.unit, "inventory_unit", 64);
    boundedText(batch.location, "inventory_location", 128);
    if (batch.quantity_balance !== undefined) {
      if (typeof batch.quantity_balance !== "object" || batch.quantity_balance === null ||
          Array.isArray(batch.quantity_balance)) return invalidOutcome("inventory_quantity_balance");
      const balance = batch.quantity_balance as Record<string, unknown>;
      if (Object.keys(balance).sort().join("\0") !==
          "base_unit\0package_milliunits\0package_unit\0remainder_base_microunits\0remaining_base_microunits\0revision\0whole_packages" ||
          !Number.isSafeInteger(balance.package_milliunits) || Number(balance.package_milliunits) < 0 ||
          !Number.isSafeInteger(balance.whole_packages) || Number(balance.whole_packages) < 0 ||
          !Number.isSafeInteger(balance.revision) || Number(balance.revision) < 1 ||
          (balance.base_unit === null) !== (balance.remaining_base_microunits === null) ||
          (balance.base_unit === null) !== (balance.remainder_base_microunits === null) ||
          balance.remaining_base_microunits !== null &&
            (!Number.isSafeInteger(balance.remaining_base_microunits) || Number(balance.remaining_base_microunits) < 0) ||
          balance.remainder_base_microunits !== null &&
            (!Number.isSafeInteger(balance.remainder_base_microunits) || Number(balance.remainder_base_microunits) < 0)) {
        return invalidOutcome("inventory_quantity_balance");
      }
      boundedText(balance.package_unit, "inventory_package_unit", 64);
      if (balance.base_unit !== null) boundedText(balance.base_unit, "inventory_base_unit", 64);
    }
  }
}

function assertCorrection(value: unknown): asserts value is CorrectionOutcomeView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidOutcome("correction");
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join("\0") !==
      "compensation_transaction_id\0correction_id\0current_active\0operation\0revision\0target_event_id") {
    return invalidOutcome("correction");
  }
  boundedText(candidate.correction_id, "correction_id", 128);
  boundedText(candidate.target_event_id, "correction_target_event_id", 128);
  if (!Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 1) {
    return invalidOutcome("correction_revision");
  }
  if (!["void_event", "change_amount", "change_time", "change_water_classification", "restore_event"]
    .includes(candidate.operation as string)) {
    return invalidOutcome("correction_operation");
  }
  if (typeof candidate.current_active !== "boolean") return invalidOutcome("correction_active");
  if (candidate.compensation_transaction_id !== null) {
    boundedText(candidate.compensation_transaction_id, "correction_compensation", 128);
  }
}

export function assertDietManagerOutcome(value: unknown): DietManagerOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidOutcome("shape");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.action !== "string" ||
    !dietManagerActions.includes(candidate.action as DietManagerAction)
  ) {
    return invalidOutcome("action");
  }
  if (
    typeof candidate.status !== "string" ||
    !dietManagerStatuses.includes(candidate.status as DietManagerStatus)
  ) {
    return invalidOutcome("status");
  }
  if (typeof candidate.committed !== "boolean") {
    return invalidOutcome("committed");
  }

  const hasCommittedStatus =
    candidate.status === "committed" ||
    candidate.status === "committed_with_issues";
  if (candidate.committed !== hasCommittedStatus) {
    return invalidOutcome("commit_status");
  }
  if (!candidate.committed && candidate.record_id !== undefined) {
    return invalidOutcome("failed_record_id");
  }
  if (
    (candidate.status === "needs_clarification" ||
      candidate.status === "ignored") &&
    (typeof candidate.reason_code !== "string" ||
      candidate.reason_code.trim().length === 0)
  ) {
    return invalidOutcome("reason_code");
  }
  if (
    candidate.status === "failed" &&
    (typeof candidate.error_code !== "string" ||
      candidate.error_code.trim().length === 0)
  ) {
    return invalidOutcome("error_code");
  }
  if (
    hasCommittedStatus &&
    (typeof candidate.operation_id !== "string" ||
      candidate.operation_id.trim().length === 0 ||
      typeof candidate.record_id !== "string" ||
      candidate.record_id.trim().length === 0)
  ) {
    return invalidOutcome("committed_identity");
  }
  if (candidate.status === "failed") {
    exactOutcomeKeys(candidate, ["action", "status", "committed", "error_code"], ["operation_id"]);
  } else if (candidate.status === "needs_clarification" || candidate.status === "ignored") {
    exactOutcomeKeys(candidate, ["action", "status", "committed", "reason_code"],
      ["operation_id", "question", "missing_items", "clarification", "daily_progress", "meal_history", "inventory_view", "correction", "pending_candidate"]);
  } else {
    exactOutcomeKeys(candidate, ["action", "status", "committed", "operation_id", "record_id"], ["record_ids", "nutrition_items", "receipt", "correction"]);
  }
  if (candidate.clarification !== undefined) {
    if (candidate.status !== "needs_clarification") return invalidOutcome("clarification_status");
    assertClarification(candidate.clarification);
  }
  if (candidate.question !== undefined) {
    if (candidate.status !== "needs_clarification") return invalidOutcome("question_status");
    boundedText(candidate.question, "question", 512);
  }
  if (candidate.pending_candidate !== undefined) {
    if (candidate.status !== "needs_clarification" ||
        typeof candidate.pending_candidate !== "object" || candidate.pending_candidate === null ||
        Array.isArray(candidate.pending_candidate)) return invalidOutcome("pending_candidate");
    const pending = candidate.pending_candidate as Record<string, unknown>;
    if (Object.keys(pending).sort().join("\0") !== "expires_at\0missing_field\0revision" ||
        typeof pending.missing_field !== "string" || pending.missing_field.length < 1 ||
        pending.missing_field.length > 128 || /[\u0000-\u001F\u007F]/u.test(pending.missing_field) ||
        typeof pending.expires_at !== "string" || !Number.isFinite(Date.parse(pending.expires_at)) ||
        !Number.isSafeInteger(pending.revision) || Number(pending.revision) < 1) {
      return invalidOutcome("pending_candidate");
    }
  }
  if (candidate.missing_items !== undefined) {
    if (candidate.action !== "add_inventory" ||
        candidate.status !== "needs_clarification" ||
        candidate.reason_code !== "amount_ambiguous") {
      return invalidOutcome("missing_items_status");
    }
    if (!Array.isArray(candidate.missing_items) ||
        candidate.missing_items.length < 1 ||
        candidate.missing_items.length > 16 ||
        new Set(candidate.missing_items).size !== candidate.missing_items.length ||
        candidate.missing_items.some((item) =>
          typeof item !== "string" || item.length === 0 || item.length > 64 ||
          /[\u0000-\u001F\u007F]/u.test(item))) {
      return invalidOutcome("missing_items");
    }
  }
  if (candidate.record_ids !== undefined) {
    if (!hasCommittedStatus || !Array.isArray(candidate.record_ids) || candidate.record_ids.length < 2 ||
        candidate.record_ids.length > 64 || candidate.record_ids[0] !== candidate.record_id ||
        new Set(candidate.record_ids).size !== candidate.record_ids.length ||
        candidate.record_ids.some((id) => typeof id !== "string" || id.length === 0)) {
      return invalidOutcome("record_ids");
    }
  }
  if (candidate.nutrition_items !== undefined) {
    if (!hasCommittedStatus || !Array.isArray(candidate.nutrition_items) || candidate.nutrition_items.length < 1 ||
        candidate.nutrition_items.length > 64) return invalidOutcome("nutrition_items");
    for (const item of candidate.nutrition_items) assertNutritionItem(item);
    if (new Set(candidate.nutrition_items.map((item) => (item as NutritionOutcomeItem).item_id)).size !== candidate.nutrition_items.length) {
      return invalidOutcome("nutrition_items_duplicate");
    }
  }
  if (candidate.receipt !== undefined) {
    if (!hasCommittedStatus || candidate.action !== "record_meal") return invalidOutcome("receipt_status");
    assertMealReceipt(candidate.receipt);
  }
  if (candidate.daily_progress !== undefined) {
    if (candidate.action !== "query_daily_summary" || candidate.status !== "ignored" ||
        candidate.reason_code !== "read_only_result") return invalidOutcome("daily_progress_status");
    assertDailyProgress(candidate.daily_progress);
  }
  if (candidate.meal_history !== undefined) {
    if (candidate.action !== "query_meals" || candidate.status !== "ignored" ||
        candidate.reason_code !== "read_only_result" || candidate.inventory_view !== undefined ||
        candidate.daily_progress !== undefined) return invalidOutcome("meal_history_status");
    assertMealHistory(candidate.meal_history);
  }
  if (candidate.inventory_view !== undefined) {
    if (candidate.action !== "query_inventory" || candidate.status !== "ignored" ||
        candidate.reason_code !== "read_only_result" || candidate.meal_history !== undefined ||
        candidate.daily_progress !== undefined) return invalidOutcome("inventory_view_status");
    assertInventoryView(candidate.inventory_view);
  }

  if (candidate.correction !== undefined) {
    if (candidate.action !== "correct_record" && candidate.action !== "undo_record" &&
        candidate.action !== "restore_record") {
      return invalidOutcome("correction_action");
    }
    assertCorrection(candidate.correction);
  }

  return candidate as unknown as DietManagerOutcome;
}
