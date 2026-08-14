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
  clarification?: ProductIdentityClarification;
  record_id?: never;
  record_ids?: never;
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

export interface CommittedOutcome {
  action: DietManagerAction;
  status: "committed" | "committed_with_issues";
  committed: true;
  operation_id: string;
  record_id: string;
  record_ids?: readonly string[];
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
    exactOutcomeKeys(candidate, ["action", "status", "committed", "reason_code"], ["operation_id", "clarification"]);
  } else {
    exactOutcomeKeys(candidate, ["action", "status", "committed", "operation_id", "record_id"], ["record_ids"]);
  }
  if (candidate.clarification !== undefined) {
    if (candidate.status !== "needs_clarification") return invalidOutcome("clarification_status");
    assertClarification(candidate.clarification);
  }
  if (candidate.record_ids !== undefined) {
    if (!hasCommittedStatus || !Array.isArray(candidate.record_ids) || candidate.record_ids.length < 2 ||
        candidate.record_ids.length > 64 || candidate.record_ids[0] !== candidate.record_id ||
        new Set(candidate.record_ids).size !== candidate.record_ids.length ||
        candidate.record_ids.some((id) => typeof id !== "string" || id.length === 0)) {
      return invalidOutcome("record_ids");
    }
  }

  return candidate as unknown as DietManagerOutcome;
}
