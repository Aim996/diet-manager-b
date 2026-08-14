import type {
  CommittedOutcome,
  DietManagerAction,
  FailedOutcome,
  NonWritingOutcome,
  ProductIdentityClarification,
} from "../contracts.js";

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
): CommittedOutcome {
  return Object.freeze({
    action,
    status,
    committed: true as const,
    operation_id: operationId,
    record_id: recordId,
    ...(recordIds === undefined ? {} : { record_ids: Object.freeze([...recordIds]) }),
  });
}
