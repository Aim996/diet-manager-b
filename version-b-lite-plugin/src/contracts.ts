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
    "public_reference" | "field_inference" | "unknown";
  readonly coverage_status: "complete" | "partial" | "unknown";
  readonly known_fields: readonly string[];
  readonly missing_fields: readonly string[];
  readonly estimated_fields: readonly string[];
}

export interface CommittedOutcome {
  action: DietManagerAction;
  status: "committed" | "committed_with_issues";
  committed: true;
  operation_id: string;
  record_id: string;
  record_ids?: readonly string[];
  nutrition_items?: readonly NutritionOutcomeItem[];
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
      !["explicit", "confirmed_history", "personal_template", "public_reference", "field_inference", "unknown"].includes(item.source_label as string) ||
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
    exactOutcomeKeys(candidate, ["action", "status", "committed", "operation_id", "record_id"], ["record_ids", "nutrition_items"]);
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
  if (candidate.nutrition_items !== undefined) {
    if (!hasCommittedStatus || !Array.isArray(candidate.nutrition_items) || candidate.nutrition_items.length < 1 ||
        candidate.nutrition_items.length > 64) return invalidOutcome("nutrition_items");
    for (const item of candidate.nutrition_items) assertNutritionItem(item);
    if (new Set(candidate.nutrition_items.map((item) => (item as NutritionOutcomeItem).item_id)).size !== candidate.nutrition_items.length) {
      return invalidOutcome("nutrition_items_duplicate");
    }
  }

  return candidate as unknown as DietManagerOutcome;
}
