import { classifyCompletion } from "./completion.js";
import { resolveMealContext } from "./context.js";
import { cloneCoreParseInput } from "./input-authority.js";
import { resolveInventoryDirective } from "./inventory-directive.js";
import {
  classifyMealLiquid,
  resolveWaterFrames,
} from "./liquid.js";
import { resolveMealFrames } from "./meal.js";
import { parseIngestionPredicateFrames } from "./predicate-frame.js";
import { resolvePantryCommand } from "./purchase.js";
import { resolveOccurredTime } from "./time.js";
import type {
  CoreInventoryCommandCandidate,
  CoreMealCommandCandidate,
  OccurredTimeEvidence,
  CoreParseInput,
  CoreParseResult,
  CoreWaterCommandCandidate,
  OffsetIsoTimestamp,
} from "./types.js";
import type { ResolvedSubjectEvidence } from "./subject.js";

const PARSER_VERSION = "diet-manager/core-parser-v1" as const;
const HEALTH_ACTUAL_CLAUSE = /^(?:(?:我\s*(?:需要|想要)|能\s*给我|可以\s*给我|请\s*(?:给我\s*)?|帮我\s*|给我\s*)(?:(?:做|提供|进行)\s*)?)(?:医疗\s*诊断|减重\s*建议)(?:\s*(?:或|和|与)\s*(?:医疗\s*诊断|减重\s*建议))*\s*(?:吗|么|嘛)?$/u;
const HEALTH_EXPLANATION_CLAUSE = /^(?:(?:(?:请\s*解释|帮我\s*理解|我想知道)\s*(?:医疗\s*诊断|减重\s*建议))(?:这个词)?(?:\s*(?:是(?:什么|什么意思)|是什么意思))?|什么\s*是\s*(?:医疗\s*诊断|减重\s*建议))$/u;
const PURCHASE_WITHOUT_EXPIRY = /昨天买的鲜牛奶没有标到期日/u;
const PURCHASED_YESTERDAY = /(昨天买的)(?=牛奶)/u;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MAX_CORE_OCCURRENCES = 256;

type HealthIntent = "actual_request" | "terminology_explanation" | null;

function classifyHealthIntent(sourceText: string): HealthIntent {
  let explanation = false;
  for (const rawClause of sourceText.split(/(?:[，,。；;！？!?\r\n]+|然后|同时)/u)) {
    const clause = rawClause.trim();
    if (clause.length === 0) continue;
    if (HEALTH_ACTUAL_CLAUSE.test(clause)) return "actual_request";
    if (HEALTH_EXPLANATION_CLAUSE.test(clause)) explanation = true;
  }
  return explanation ? "terminology_explanation" : null;
}

function detachedFrozen<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => detachedFrozen(entry))) as unknown as Readonly<T>;
  }
  if (typeof value !== "object" || value === null) return value as Readonly<T>;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, nested] of Object.entries(value)) {
    result[key] = detachedFrozen(nested);
  }
  return Object.freeze(result) as Readonly<T>;
}

function shanghaiCalendarDate(timestamp: string, dayDelta: number): string | null {
  const epoch = new Date(timestamp).valueOf();
  if (!Number.isFinite(epoch)) return null;
  const local = new Date(epoch + SHANGHAI_OFFSET_MS);
  const calendarEpoch = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ) + dayDelta * 86_400_000;
  const shifted = new Date(calendarEpoch);
  const year = shifted.getUTCFullYear();
  if (year < 1_000 || year > 9_999) return null;
  return `${String(year).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function dateAtShanghai1600(value: string | null): OffsetIsoTimestamp | null {
  if (value === null) return null;
  const timestamp = `${value}T16:00:00+08:00`;
  const epoch = new Date(timestamp).valueOf();
  if (!Number.isFinite(epoch)) return null;
  return timestamp as OffsetIsoTimestamp;
}

function addShanghaiCalendarDays(
  date: string | null,
  dayDelta: number,
): string | null {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  return shanghaiCalendarDate(`${date}T00:00:00+08:00`, dayDelta);
}

function inventoryCandidate(input: Readonly<CoreParseInput>): CoreInventoryCommandCandidate | null {
  const stockedDate = shanghaiCalendarDate(input.received_at, -1);
  const expirationDate = addShanghaiCalendarDays(stockedDate, 7);
  const stockedAt = dateAtShanghai1600(stockedDate);
  const expirationAt = dateAtShanghai1600(expirationDate);
  if (stockedAt === null || expirationAt === null) return null;
  return {
    action: "add_inventory",
    operation_id: input.operation_id,
    source_text: input.source_text,
    parser_version: PARSER_VERSION,
    product: {
      normalized_name: "fresh_milk",
      raw_text: "鲜牛奶",
      quantity: null,
      unit: null,
    },
    stocked_at: stockedAt,
    received_at: stockedAt,
    ingestion_at: null,
    estimated_expires_at: expirationAt,
    expiration_resolution_basis: "stocked_at",
    shelf_life_rule_version: "diet-manager/fresh-milk-shelf-life-v1",
  };
}

function ambiguityQuestion(input: Readonly<CoreParseInput>): string {
  const previousDate = shanghaiCalendarDate(input.received_at, -1);
  const currentDate = shanghaiCalendarDate(input.received_at, 0);
  if (previousDate === null || currentDate === null) {
    return "请明确这顿夜宵的日期。";
  }
  const previous = previousDate.split("-").map(Number);
  const current = currentDate.split("-").map(Number);
  return `这顿夜宵是指${previous[1]}月${previous[2]}日还是${current[1]}月${current[2]}日？`;
}

function subjectEvidence(subject: Readonly<ResolvedSubjectEvidence>) {
  return {
    kind: subject.kind,
    resolution_basis: subject.resolution_basis,
    subject_entity_created: subject.subject_entity_created,
    ...(subject.excluded_non_self_share_count === undefined
      ? {}
      : { excluded_non_self_share_count: subject.excluded_non_self_share_count }),
    ...(subject.self_participated === undefined
      ? {}
      : { self_participated: subject.self_participated }),
    matched_span: subject.matched_span,
    rule_version: subject.rule_version,
  };
}

type ProceedCompletion = Extract<
  ReturnType<typeof classifyCompletion>,
  { disposition: "proceed" }
>;
type MealProposal = ReturnType<typeof resolveMealFrames>;

interface RetainedMealEntry {
  readonly occurrence: MealProposal["proposed_items"][number];
  readonly item: MealProposal["items"][number];
}

function retainedMealEntries(
  meal: MealProposal,
  completion: ProceedCompletion,
): readonly Readonly<RetainedMealEntry>[] {
  const retained: Readonly<RetainedMealEntry>[] = [];
  for (let index = 0; index < meal.proposed_items.length; index += 1) {
    const occurrence = meal.proposed_items[index];
    const item = meal.items[index];
    if (occurrence === undefined || item === undefined) continue;
    const excluded = completion.excluded_items.some((evidence) =>
      evidence.normalized_name === occurrence.normalized_name &&
      occurrence.position >= evidence.matched_evidence.start &&
      occurrence.end <= evidence.matched_evidence.end
    );
    if (!excluded) retained.push({ occurrence, item });
  }
  return Object.freeze(retained);
}

function hasUnsafeMealLiquidAggregate(
  retained: readonly Readonly<RetainedMealEntry>[],
): boolean {
  let knownMl = 0;
  for (const { item } of retained) {
    if (
      item.kind !== "nutritious_drink" || item.unit !== "ml" ||
      item.quantity === null
    ) continue;
    const next = knownMl + item.quantity;
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      !Number.isSafeInteger(next)) return true;
    knownMl = next;
  }
  return false;
}

function mealCandidate(
  input: Readonly<CoreParseInput>,
  completion: ProceedCompletion,
  occurredTime: OccurredTimeEvidence,
  meal: MealProposal,
  retained: readonly Readonly<RetainedMealEntry>[],
): CoreParseResult {
  if (meal.disposition === "unresolved" || meal.subject === null) {
    return detachedFrozen({
      disposition: "ignored",
      action: "record_meal",
      reason_code: "non_self_subject",
    });
  }
  const items = retained.map(({ item }, order) => ({ ...item, order }));
  if (items.length === 0) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: "record_meal",
      reason_code: "amount_ambiguous",
      question: "请说明实际吃了什么。",
    });
  }
  const context = resolveMealContext({
    source_text: input.source_text,
    received_at: input.received_at,
    conversation_id: input.conversation_id,
    source_message_id: input.source_message_id,
    prior_context: input.prior_context,
    occurred_time: occurredTime,
  });
  const liquid = classifyMealLiquid(items);
  const purchase = PURCHASED_YESTERDAY.exec(input.source_text);
  const purchaseReferenceDate = purchase === null
    ? null
    : shanghaiCalendarDate(input.received_at, -1);
  const inventoryDirective = resolveInventoryDirective(input.source_text);

  const command: CoreMealCommandCandidate = {
    action: "record_meal",
    operation_id: input.operation_id,
    meal_identity_seed: input.operation_id,
    source_text: input.source_text,
    parser_version: PARSER_VERSION,
    occurred_time: occurredTime,
    subject: subjectEvidence(
      retained[0]?.occurrence.subject_evidence ?? meal.subject,
    ),
    items,
    ...(completion.completion_evidence === null
      ? {}
      : { completion_evidence: {
          initial_state: completion.completion_evidence.initial_state,
          final_state: completion.completion_evidence.final_state,
          winning_span: completion.completion_evidence.winning_span,
          rule_version: completion.completion_evidence.rule_version,
        } }),
    ...(completion.excluded_items.length === 0
      ? {}
      : { excluded_items: completion.excluded_items.map((excluded) => ({
          normalized_name: excluded.normalized_name,
          reason_code: excluded.reason_code,
          matched_span: excluded.matched_span,
          rule_version: excluded.rule_version,
        })) }),
    ...(meal.group_amount_evidence === undefined || !retained.some(({ occurrence }) =>
        occurrence.occurrence_id === meal.group_amount_evidence?.occurrence_id
      )
      ? {}
      : { group_amount_evidence: {
          quantity: meal.group_amount_evidence.quantity,
          unit: meal.group_amount_evidence.unit,
          assigned_to_self: meal.group_amount_evidence.assigned_to_self,
          matched_span: meal.group_amount_evidence.matched_span,
          rule_version: meal.group_amount_evidence.rule_version,
        } }),
    ...(context.scene === "unknown" &&
        context.accepted_context === null &&
        context.expired_context_ids.length === 0 &&
        !context.inventory_read
      ? {}
      : { context }),
    ...(purchase === null || purchaseReferenceDate === null
      ? {}
      : { purchase_evidence: {
          raw_text: purchase[1],
          batch_reference_date: purchaseReferenceDate,
          affects_ingestion_date: false,
        } }),
    ...(liquid === null ? {} : { liquid_classification: liquid }),
    ...(inventoryDirective === undefined ? {} : { inventory_directive: inventoryDirective }),
  };
  return detachedFrozen({ disposition: "candidate", command });
}

/** Compose the deterministic selected-core parser from ordinary input authority. */
export function parseCoreCommand(value: unknown): CoreParseResult {
  const input = cloneCoreParseInput(value);
  const pantry = resolvePantryCommand(input);
  if (pantry !== null) {
    return detachedFrozen({ disposition: "candidate", command: pantry });
  }
  const meal = resolveMealFrames(input.source_text);
  const waterResolution = resolveWaterFrames(input.source_text);
  const healthIntent = classifyHealthIntent(input.source_text);
  const hasIngestionOccurrence = meal.proposed_items.length > 0 ||
    waterResolution.self_matches.length > 0;

  if (healthIntent === "actual_request" && !hasIngestionOccurrence) {
    return detachedFrozen({
      disposition: "ignored",
      action: "health_advice",
      reason_code: "unsupported_health_advice",
    });
  }

  if (healthIntent === "terminology_explanation" && !hasIngestionOccurrence) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: "health_advice",
      reason_code: "unsupported_command",
      question: "这是术语解释请求，不会作为饮食记录处理。",
    });
  }

  const occurrenceCount = meal.proposed_items.length +
    waterResolution.self_matches.length +
    waterResolution.non_self_direct_count;
  if (
    meal.occurrence_limit_exceeded ||
    waterResolution.occurrence_limit_exceeded ||
    occurrenceCount > MAX_CORE_OCCURRENCES
  ) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: meal.proposed_items.length > 0 ? "record_meal" : "record_water",
      reason_code: "unsupported_command",
      question: "单条消息中的饮食项目过多，请拆分后记录。",
    });
  }

  const completion = classifyCompletion(input.source_text, meal.proposed_items);
  if (completion.disposition === "needs_clarification") {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: completion.action,
      reason_code: completion.reason_code,
      question: completion.question,
    });
  }
  if (completion.disposition === "ignored") {
    if (completion.reason_code === "not_occurred") {
      return detachedFrozen({
        disposition: "ignored" as const,
        action: "record_meal" as const,
        reason_code: "not_occurred" as const,
        ...(input.prior_context[0] === undefined
          ? {}
          : { context_id: input.prior_context[0].context_id }),
      });
    }
    return detachedFrozen({
      disposition: "ignored" as const,
      action: "record_meal" as const,
      reason_code: "future_plan" as const,
    });
  }
  const retainedMeal = retainedMealEntries(meal, completion);
  if (
    retainedMeal.some(({ occurrence }) =>
      occurrence.amount_resolution === "invalid"
    ) || hasUnsafeMealLiquidAggregate(retainedMeal)
  ) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: "record_meal",
      reason_code: "amount_ambiguous",
      question: "数量无效或超出可安全记录的范围，请重新说明。",
    });
  }
  const recognizedEventIds = new Set([
    ...meal.proposed_items.map((item) => item.event_id),
    ...waterResolution.self_matches.map((match) => match.event_id),
  ]);
  if (completion.completion_evidence !== null) {
    for (const frame of parseIngestionPredicateFrames(input.source_text)) {
      if (frame.frame_span.raw.includes(completion.completion_evidence.winning_span)) {
        recognizedEventIds.add(frame.event_id);
      }
    }
  }
  const hasResolvedOccurrence = retainedMeal.length > 0 ||
    waterResolution.self_matches.length > 0;
  if (
    hasResolvedOccurrence &&
    meal.event_owners.some((owner) =>
      owner.ownership === "unresolved" ||
      (owner.ownership === "self" && !recognizedEventIds.has(owner.event_id))
    )
  ) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: retainedMeal.length > 0 ? "record_meal" : "record_water",
      reason_code: "unsupported_command",
      question: "请把无法确认主体或完成状态的饮食分开说明。",
    });
  }

  if (PURCHASE_WITHOUT_EXPIRY.test(input.source_text)) {
    const command = inventoryCandidate(input);
    if (command === null) {
      return detachedFrozen({
        disposition: "needs_clarification",
        action: "add_inventory",
        reason_code: "unsupported_command",
        question: "购买日期超出当前支持范围，请提供明确的入库日期。",
      });
    }
    return detachedFrozen({
      disposition: "candidate",
      command,
    });
  }

  const occurredTime = resolveOccurredTime(input.source_text, input.received_at);
  if (occurredTime.resolution_basis === "needs_clarification") {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: "record_meal",
      reason_code: "occurred_date_ambiguous",
      question: ambiguityQuestion(input),
      occurred_time: occurredTime,
    });
  }

  const waters = waterResolution.self_matches;
  if (waters.length > 1) {
    return detachedFrozen({
      disposition: "needs_clarification",
      action: "record_water",
      reason_code: "unsupported_command",
      question: "请把多次饮水分成多条消息记录。",
    });
  }
  const water = waters[0] ?? null;
  if (water !== null) {
    if (retainedMeal.length > 0) {
      return detachedFrozen({
        disposition: "needs_clarification",
        action: "record_meal",
        reason_code: "unsupported_command",
        question: "请把白水和其他饮食分成两条消息记录。",
      });
    }
    const command: CoreWaterCommandCandidate = {
      action: "record_water",
      operation_id: input.operation_id,
      source_text: input.source_text,
      parser_version: PARSER_VERSION,
      occurred_time: occurredTime,
      plain_water_ml_milli: water.quantity_ml * 1_000,
      amount_evidence: {
        raw_text: water.raw_text,
        quantity: water.quantity_ml,
        unit: "ml",
        estimated: false,
      },
    };
    return detachedFrozen({
      disposition: "candidate",
      command,
    });
  }

  if (
    waterResolution.non_self_direct_count > 0 &&
    retainedMeal.length === 0
  ) {
    return detachedFrozen({
      disposition: "ignored",
      action: "record_water",
      reason_code: "non_self_subject",
    });
  }

  return mealCandidate(input, completion, occurredTime, meal, retainedMeal);
}
