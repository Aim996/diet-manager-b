import type {
  CommittedOutcome,
  CorrectionOutcomeView,
  DietManagerAction,
  DailyProgressView,
  InventoryView,
  MealHistoryView,
  FailedOutcome,
  NonWritingOutcome,
  ProductIdentityClarification,
  MealReceipt,
  NutritionOutcomeItem,
} from "../contracts.js";

function freezeNutritionItem(item: Readonly<NutritionOutcomeItem>): NutritionOutcomeItem {
  return Object.freeze({
    item_id: item.item_id,
    name: item.name,
    adopted_amount: item.adopted_amount,
    adopted_unit: item.adopted_unit,
    amount_range: item.amount_range === null ? null : Object.freeze({ ...item.amount_range }),
    quantity_evidence: item.quantity_evidence,
    source_label: item.source_label,
    coverage_status: item.coverage_status,
    known_fields: Object.freeze([...item.known_fields]),
    missing_fields: Object.freeze([...item.missing_fields]),
    estimated_fields: Object.freeze([...item.estimated_fields]),
  });
}

export function failedOutcome(
  action: DietManagerAction,
  operationId: string | undefined,
  errorCode: string,
): FailedOutcome {
  return Object.freeze({
    action,
    status: "failed" as const,
    committed: false as const,
    ...(operationId === undefined ? {} : { operation_id: operationId }),
    error_code: errorCode,
  });
}

export function nonWritingOutcome(
  action: DietManagerAction,
  operationId: string,
  status: "ignored" | "needs_clarification",
  reasonCode: string,
  clarification?: Readonly<ProductIdentityClarification>,
  dailyProgress?: Readonly<DailyProgressView>,
  mealHistory?: Readonly<MealHistoryView>,
  inventoryView?: Readonly<InventoryView>,
  question?: string,
  missingItems?: readonly string[],
): NonWritingOutcome {
  return Object.freeze({
    action,
    status,
    committed: false as const,
    operation_id: operationId,
    reason_code: reasonCode,
    ...(question === undefined ? {} : { question }),
    ...(missingItems === undefined ? {} : { missing_items: Object.freeze([...missingItems]) }),
    ...(clarification === undefined ? {} : { clarification }),
    ...(dailyProgress === undefined ? {} : { daily_progress: Object.freeze({
      date: dailyProgress.date,
      timezone: dailyProgress.timezone,
      meals: Object.freeze({ ...dailyProgress.meals }),
      water: Object.freeze({ ...dailyProgress.water }),
      nutrition: Object.freeze({
        coverage_status: dailyProgress.nutrition.coverage_status,
        nutrients: Object.freeze({ ...dailyProgress.nutrition.nutrients }),
      }),
      inventory: Object.freeze({ ...dailyProgress.inventory }),
      purchases: Object.freeze({ ...dailyProgress.purchases }),
      corrections: Object.freeze({ ...dailyProgress.corrections }),
      ...(dailyProgress.configured_goals === undefined ? {} : { configured_goals: Object.freeze({ ...dailyProgress.configured_goals }) }),
      ...(dailyProgress.progress === undefined ? {} : { progress: Object.freeze({ ...dailyProgress.progress }) }),
    }) }),
    ...(mealHistory === undefined ? {} : { meal_history: Object.freeze({
      date: mealHistory.date,
      timezone: mealHistory.timezone,
      meals: Object.freeze(mealHistory.meals.map((meal) => Object.freeze({
        occurred_at: meal.occurred_at,
        meal_slot: meal.meal_slot,
        location: meal.location,
        audit_ref: Object.freeze({ ...meal.audit_ref }),
        items: Object.freeze(meal.items.map((item) => Object.freeze({ ...item }))),
      }))),
    }) }),
    ...(inventoryView === undefined ? {} : { inventory_view: Object.freeze({
      batches: Object.freeze(inventoryView.batches.map((batch) => Object.freeze({ ...batch }))),
    }) }),
  });
}

export function committedOutcome(
  action: DietManagerAction,
  operationId: string,
  status: "committed" | "committed_with_issues",
  recordId: string,
  recordIds?: readonly string[],
  nutritionItems?: readonly Readonly<NutritionOutcomeItem>[],
  receipt?: Readonly<MealReceipt>,
  correction?: Readonly<CorrectionOutcomeView>,
): CommittedOutcome {
  return Object.freeze({
    action,
    status,
    committed: true as const,
    operation_id: operationId,
    record_id: recordId,
    ...(recordIds === undefined ? {} : { record_ids: Object.freeze([...recordIds]) }),
    ...(nutritionItems === undefined ? {} : { nutrition_items: Object.freeze(nutritionItems.map(freezeNutritionItem)) }),
    ...(receipt === undefined ? {} : { receipt: Object.freeze({
      raw_text: receipt.raw_text,
      items: Object.freeze(receipt.items.map((item) => Object.freeze({
        item_id: item.item_id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        derived: item.derived,
        nutrition: Object.freeze({ ...item.nutrition }),
        inventory: Object.freeze({ ...item.inventory }),
      }))),
    }) }),
    ...(correction === undefined ? {} : { correction: Object.freeze({
      correction_id: correction.correction_id,
      target_event_id: correction.target_event_id,
      revision: correction.revision,
      operation: correction.operation,
      current_active: correction.current_active,
      compensation_transaction_id: correction.compensation_transaction_id,
    }) }),
  });
}
