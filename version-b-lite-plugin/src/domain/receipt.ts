import { canonicalJson } from "../authority/canonical-json.js";
import type {
  DailyProgressResult,
  MealItemExecutionResult,
} from "./effect-bundle.js";
import { deriveDomainId } from "./identity.js";
import type { PantryPurchaseEvidence } from "./types.js";

const FREE_TEXT_LINE = "也可以直接说明实际情况，不必选择以上选项。";

export type QuickPromptIssueCode =
  | "inventory_multiple_candidates"
  | "inventory_insufficient"
  | "inventory_unit_incompatible"
  | "inventory_amount_unknown";

export interface BuildQuickPromptInput {
  readonly issue_id: string;
  readonly issue_code: QuickPromptIssueCode;
  readonly revision: number;
  readonly generated_at: string;
  readonly expires_at: string;
}

export interface QuickPromptOption {
  readonly option_id: "keep_original" | "defer" | "free_text";
  readonly kind: "safe_exit" | "defer" | "free_text";
  readonly label: string;
}

export interface QuickPrompt {
  readonly authority_kind: "diet-manager/quick-prompt/v1";
  readonly prompt_id: string;
  readonly issue_id: string;
  readonly issue_code: QuickPromptIssueCode;
  readonly option_ids: readonly ["keep_original", "defer", "free_text"];
  readonly options: readonly [QuickPromptOption, QuickPromptOption, QuickPromptOption];
  readonly generated_from_revision: number;
  readonly generated_at: string;
  readonly expires_at: string;
  readonly safe_exit_required: true;
  readonly accepts_combinations: true;
  readonly accepts_natural_language: true;
  readonly free_text_line: typeof FREE_TEXT_LINE;
}

export interface BuildReceiptDataInput {
  readonly status: "committed" | "committed_with_issues" | "effects_pending";
  readonly date: string;
  readonly meal_slot: string;
  readonly items: readonly MealItemExecutionResult[];
  readonly quick_prompts: readonly QuickPrompt[];
  readonly daily_progress: DailyProgressResult | null;
}

export interface ReceiptTitleBlock {
  readonly kind: "title";
  readonly date: string;
  readonly meal_slot: string;
}

export interface ReceiptItemBlock {
  readonly kind: "item";
  readonly item_order: number;
  readonly name: string;
  readonly amount: Readonly<{
    observed_microunits: number | null;
    unit: string;
    evidence: "explicit" | "estimated" | "unknown";
  }>;
  readonly estimated_fields: readonly string[];
  readonly inventory_effect: Readonly<{
    status: MealItemExecutionResult["inventory_match"];
  }>;
  readonly issue_codes: readonly string[];
}

export interface ReceiptIssueBlock {
  readonly kind: "issues";
  readonly prompts: readonly Readonly<{
    issue_code: QuickPromptIssueCode;
    options: readonly QuickPromptOption[];
    accepts_combinations: true;
    accepts_natural_language: true;
    free_text_line: typeof FREE_TEXT_LINE;
  }>[];
}

export interface ReceiptProgressBlock {
  readonly kind: "progress";
  readonly daily_progress: DailyProgressResult;
}

export interface ReceiptPendingBlock {
  readonly kind: "pending";
  readonly code: "effects_pending";
}

export type ReceiptBlock =
  | ReceiptTitleBlock
  | ReceiptItemBlock
  | ReceiptIssueBlock
  | ReceiptProgressBlock
  | ReceiptPendingBlock;

export interface ReceiptData {
  readonly authority_kind: "diet-manager/receipt-data/v1";
  readonly status: "success" | "pending";
  readonly blocks: readonly ReceiptBlock[];
}

export interface PantryPurchaseReceiptItem {
  readonly product_id: string;
  readonly batch_id: string;
  readonly name: string;
  readonly stocked_at: string;
  readonly location: Readonly<{
    readonly value: PantryPurchaseEvidence["location"]["value"];
    readonly evidence_kind: PantryPurchaseEvidence["location"]["evidence_kind"];
  }>;
  readonly opening: PantryPurchaseEvidence["opening"];
  readonly expiration: PantryPurchaseEvidence["expiration"];
  readonly inferred_fields: readonly ("location" | "opening" | "expiration")[];
}

function invalid(reason: string): never {
  throw new TypeError(`RECEIPT_DATA_INVALID:${reason}`);
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalid(field);
  }
  return value;
}

function safeText(value: string, field: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) return invalid(field);
  return value;
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  reason: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(reason);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\u0000") !== [...fields].sort().join("\u0000")) {
    return invalid(reason);
  }
  return record;
}

function freezeProgress(value: DailyProgressResult): DailyProgressResult {
  return Object.freeze({
    date: value.date,
    timezone: value.timezone,
    coverage_status: value.coverage_status,
    nutrients: Object.freeze({ ...value.nutrients }),
  });
}

export function buildPantryPurchaseReceiptItem(input: Readonly<{
  readonly product_id: string;
  readonly batch_id: string;
  readonly name: string;
  readonly stocked_at: string;
  readonly evidence: Readonly<PantryPurchaseEvidence>;
}>): Readonly<PantryPurchaseReceiptItem> {
  const productId = safeText(input.product_id, "pantry_product_id", 256);
  const batchId = safeText(input.batch_id, "pantry_batch_id", 256);
  const name = safeText(input.name, "pantry_name", 256);
  const stockedAt = safeText(input.stocked_at, "pantry_stocked_at", 64);
  if (!Number.isFinite(Date.parse(stockedAt))) return invalid("pantry_stocked_at");
  const inferred: ("location" | "opening" | "expiration")[] = [];
  if (input.evidence.location.evidence_kind !== "explicit") inferred.push("location");
  if (input.evidence.opening?.evidence_kind === "rule") inferred.push("opening");
  if (input.evidence.expiration.basis === "rule") inferred.push("expiration");
  return Object.freeze({
    product_id: productId,
    batch_id: batchId,
    name,
    stocked_at: stockedAt,
    location: Object.freeze({
      value: input.evidence.location.value,
      evidence_kind: input.evidence.location.evidence_kind,
    }),
    opening: input.evidence.opening,
    expiration: input.evidence.expiration,
    inferred_fields: Object.freeze(inferred),
  });
}

export function buildQuickPrompt(input: BuildQuickPromptInput): QuickPrompt {
  const issueId = safeText(input.issue_id, "issue_id", 128);
  if (!/^issue-[a-f0-9]{32}$/.test(issueId)) return invalid("issue_id");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) return invalid("revision");
  const generatedAt = timestamp(input.generated_at, "generated_at");
  const expiresAt = timestamp(input.expires_at, "expires_at");
  if (Date.parse(expiresAt) <= Date.parse(generatedAt)) return invalid("expires_at");
  const allowedCodes = new Set<QuickPromptIssueCode>([
    "inventory_multiple_candidates",
    "inventory_insufficient",
    "inventory_unit_incompatible",
    "inventory_amount_unknown",
  ]);
  if (!allowedCodes.has(input.issue_code)) return invalid("issue_code");

  const options = Object.freeze([
    Object.freeze({
      option_id: "keep_original" as const,
      kind: "safe_exit" as const,
      label: "保持当前记录，不修改库存",
    }),
    Object.freeze({
      option_id: "defer" as const,
      kind: "defer" as const,
      label: "稍后处理",
    }),
    Object.freeze({
      option_id: "free_text" as const,
      kind: "free_text" as const,
      label: FREE_TEXT_LINE,
    }),
  ]) as readonly [QuickPromptOption, QuickPromptOption, QuickPromptOption];

  return Object.freeze({
    authority_kind: "diet-manager/quick-prompt/v1" as const,
    prompt_id: deriveDomainId("prompt", issueId, input.revision),
    issue_id: issueId,
    issue_code: input.issue_code,
    option_ids: Object.freeze([
      "keep_original", "defer", "free_text",
    ]) as readonly ["keep_original", "defer", "free_text"],
    options,
    generated_from_revision: input.revision,
    generated_at: generatedAt,
    expires_at: expiresAt,
    safe_exit_required: true as const,
    accepts_combinations: true as const,
    accepts_natural_language: true as const,
    free_text_line: FREE_TEXT_LINE,
  });
}

export function freezeQuickPrompt(value: unknown): QuickPrompt {
  const record = exactRecord(value, [
    "accepts_combinations",
    "accepts_natural_language",
    "authority_kind",
    "expires_at",
    "free_text_line",
    "generated_at",
    "generated_from_revision",
    "issue_code",
    "issue_id",
    "option_ids",
    "options",
    "prompt_id",
    "safe_exit_required",
  ], "quick_prompt");
  const expected = buildQuickPrompt({
    issue_id: String(record.issue_id),
    issue_code: record.issue_code as QuickPromptIssueCode,
    revision: Number(record.generated_from_revision),
    generated_at: String(record.generated_at),
    expires_at: String(record.expires_at),
  });
  if (canonicalJson(record) !== canonicalJson(expected)) return invalid("quick_prompt");
  return expected;
}

export function buildReceiptData(input: BuildReceiptDataInput): ReceiptData {
  const date = safeText(input.date, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("date");
  const mealSlot = safeText(input.meal_slot, "meal_slot", 64);
  if (input.status === "effects_pending") {
    return Object.freeze({
      authority_kind: "diet-manager/receipt-data/v1" as const,
      status: "pending" as const,
      blocks: Object.freeze([
        Object.freeze({ kind: "pending" as const, code: "effects_pending" as const }),
      ]),
    });
  }
  if (input.daily_progress === null) return invalid("daily_progress");
  if (input.items.length === 0 || input.items.length > 256) return invalid("items");

  const blocks: ReceiptBlock[] = [Object.freeze({
    kind: "title" as const,
    date,
    meal_slot: mealSlot,
  })];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    if (item.item_order !== index) return invalid("item_order");
    if (
      item.observed_microunits !== null &&
      (!Number.isSafeInteger(item.observed_microunits) || item.observed_microunits < 0)
    ) {
      return invalid("observed_microunits");
    }
    if ((item.observed_microunits === null) !== (item.amount_evidence === "unknown")) {
      return invalid("amount_evidence");
    }
    const estimatedFields = Object.freeze([...item.estimated_fields]);
    blocks.push(Object.freeze({
      kind: "item" as const,
      item_order: item.item_order,
      name: safeText(item.normalized_name, "normalized_name", 256),
      amount: Object.freeze({
        observed_microunits: item.observed_microunits,
        unit: safeText(item.unit, "unit", 32),
        evidence: item.amount_evidence === "unknown"
          ? "unknown" as const
          : estimatedFields.includes("observed_microunits")
          ? "estimated" as const
          : "explicit" as const,
      }),
      estimated_fields: estimatedFields,
      inventory_effect: Object.freeze({ status: item.inventory_match }),
      issue_codes: Object.freeze([...item.issue_codes]),
    }));
  }
  if (input.quick_prompts.length > 0) {
    blocks.push(Object.freeze({
      kind: "issues" as const,
      prompts: Object.freeze(input.quick_prompts.map((prompt) => Object.freeze({
        issue_code: prompt.issue_code,
        options: Object.freeze(prompt.options.map((option) => Object.freeze({ ...option }))),
        accepts_combinations: true as const,
        accepts_natural_language: true as const,
        free_text_line: FREE_TEXT_LINE,
      }))),
    }));
  }
  blocks.push(Object.freeze({
    kind: "progress" as const,
    daily_progress: freezeProgress(input.daily_progress),
  }));
  return Object.freeze({
    authority_kind: "diet-manager/receipt-data/v1" as const,
    status: "success" as const,
    blocks: Object.freeze(blocks),
  });
}

export function rebaseReceiptProgress(
  receipt: ReceiptData,
  dailyProgress: DailyProgressResult,
): ReceiptData {
  if (
    receipt.authority_kind !== "diet-manager/receipt-data/v1" ||
    receipt.status !== "success" ||
    receipt.blocks.length < 2 ||
    receipt.blocks.at(-1)?.kind !== "progress" ||
    receipt.blocks.slice(0, -1).some((block) => block.kind === "progress")
  ) return invalid("progress_block");
  return Object.freeze({
    authority_kind: "diet-manager/receipt-data/v1" as const,
    status: "success" as const,
    blocks: Object.freeze([
      ...receipt.blocks.slice(0, -1),
      Object.freeze({
        kind: "progress" as const,
        daily_progress: freezeProgress(dailyProgress),
      }),
    ]),
  });
}
