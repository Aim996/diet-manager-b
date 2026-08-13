export const dietManagerContract = Object.freeze({
  id: "diet-manager/contract-v2",
  version: 2,
  sha256: "632B2BBF8D0E6C655F4C0A47958828A86C67B3240065984CCC78A808E6F7072E",
} as const);

export const dietManagerActions = [
  "record_meal",
  "record_water",
  "add_inventory",
  "query_inventory",
  "query_meals",
  "query_daily_summary",
  "correct_record",
  "undo_record",
] as const;

export type DietManagerAction = (typeof dietManagerActions)[number];

export const dietManagerStatuses = [
  "committed",
  "committed_with_issues",
  "needs_clarification",
  "ignored",
  "failed",
] as const;

export type DietManagerStatus = (typeof dietManagerStatuses)[number];

export interface CoreApplicationRequest {
  readonly action: DietManagerAction;
  readonly source_text: string;
  readonly received_at: string;
  readonly timezone: "Asia/Shanghai";
  readonly operation_id: string;
  readonly source_message_id: string;
  readonly conversation_id: string;
  readonly prior_context: readonly import("./parser/types.js").CoreContextEntry[];
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
  record_id?: never;
}

export interface CommittedOutcome {
  action: DietManagerAction;
  status: "committed" | "committed_with_issues";
  committed: true;
  operation_id: string;
  record_id: string;
}

export type DietManagerOutcome =
  | FailedOutcome
  | NonWritingOutcome
  | CommittedOutcome;

function invalidOutcome(reason: string): never {
  throw new TypeError(`DIET_MANAGER_OUTCOME_INVALID:${reason}`);
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

  return candidate as unknown as DietManagerOutcome;
}
