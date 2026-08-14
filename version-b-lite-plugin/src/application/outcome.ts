import type {
  CommittedOutcome,
  DietManagerAction,
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
): NonWritingOutcome {
  return Object.freeze({
    action,
    status,
    committed: false as const,
    operation_id: operationId,
    reason_code: reasonCode,
    ...(clarification === undefined ? {} : { clarification }),
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
  });
}
