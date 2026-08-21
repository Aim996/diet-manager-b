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
  PendingCandidateOutcomeView,
  ProfileSavedOutcomeView,
  GoalRecommendationOutcomeView,
  GoalUpdateOutcomeView,
  FrozenDateProgressV1,
} from "../contracts.js";

function freezeProgress(progress: readonly Readonly<FrozenDateProgressV1>[]): readonly FrozenDateProgressV1[] {
  return Object.freeze(progress.map((date) => Object.freeze({
    schema_version: date.schema_version,
    date: date.date,
    timezone: date.timezone,
    goal_version_id: date.goal_version_id,
    goal_notice: date.goal_notice,
    metrics: Object.freeze(date.metrics.map((metric) => Object.freeze({
      ...metric,
      current: Object.freeze({ ...metric.current }),
      delta: Object.freeze({ ...metric.delta }),
      unknown_sources: Object.freeze([...metric.unknown_sources]),
    }))),
    generated_at: date.generated_at,
    idempotency_key: date.idempotency_key,
  }))) as unknown as readonly FrozenDateProgressV1[];
}

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
  pendingCandidate?: Readonly<PendingCandidateOutcomeView>,
  progress?: readonly Readonly<FrozenDateProgressV1>[],
): NonWritingOutcome {
  return Object.freeze({
    action,
    status,
    committed: false as const,
    operation_id: operationId,
    reason_code: reasonCode,
    ...(question === undefined ? {} : { question }),
    ...(missingItems === undefined ? {} : { missing_items: Object.freeze([...missingItems]) }),
    ...(pendingCandidate === undefined ? {} : { pending_candidate: Object.freeze({ ...pendingCandidate }) }),
    ...(progress === undefined ? {} : { progress: freezeProgress(progress) }),
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
        items: Object.freeze(meal.items.map((item) => Object.freeze({
          ...item,
          ...(item.nutrition_source === undefined
            ? {}
            : { nutrition_source: Object.freeze({ ...item.nutrition_source }) }),
        }))),
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
  progress?: readonly Readonly<FrozenDateProgressV1>[],
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
      ...(receipt.meal_slot === undefined ? {} : { meal_slot: receipt.meal_slot }),
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
    ...(progress === undefined ? {} : { progress: freezeProgress(progress) }),
  });
}

export function committedGoalDetailsOutcome(
  action: "set_profile" | "set_goal",
  operationId: string,
  status: "committed" | "committed_with_issues",
  recordId: string,
  details: Readonly<{
    profile_saved?: Readonly<ProfileSavedOutcomeView>;
    goal_recommendation?: Readonly<GoalRecommendationOutcomeView>;
    goal_update?: Readonly<GoalUpdateOutcomeView>;
  }>,
): CommittedOutcome {
  const base = committedOutcome(action, operationId, status, recordId);
  return Object.freeze({
    ...base,
    ...(details.profile_saved === undefined ? {} : {
      profile_saved: Object.freeze({ ...details.profile_saved }),
    }),
    ...(details.goal_recommendation === undefined ? {} : {
      goal_recommendation: Object.freeze({
        recommendation_id: details.goal_recommendation.recommendation_id,
        status: details.goal_recommendation.status,
        goals: Object.freeze({ ...details.goal_recommendation.goals }),
        unavailable_reasons: Object.freeze({ ...details.goal_recommendation.unavailable_reasons }),
      }),
    }),
    ...(details.goal_update === undefined ? {} : {
      goal_update: Object.freeze({
        goal_version_id: details.goal_update.goal_version_id,
        effective_from: details.goal_update.effective_from,
        previous_goals: Object.freeze({ ...details.goal_update.previous_goals }),
        goals: Object.freeze({ ...details.goal_update.goals }),
        confirmed_recommendation_id: details.goal_update.confirmed_recommendation_id,
      }),
    }),
  });
}
