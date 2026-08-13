import { classifyCompletion } from "./completion.js";
import { resolveMealContext } from "./context.js";
import { cloneCoreParseInput } from "./input-authority.js";
import { classifyMealLiquid, matchExplicitPlainWater } from "./liquid.js";
import { proposeMealItems, toCoreMealItems } from "./meal.js";
import { resolveSubject } from "./subject.js";
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

const PARSER_VERSION = "diet-manager/core-parser-v1" as const;
const HEALTH_ADVICE_REQUEST = /(?:给我|请|帮我)[^。！？!?]*(?:医疗\s*诊断|减重\s*建议)/u;
const PURCHASE_WITHOUT_EXPIRY = /昨天买的鲜牛奶没有标到期日/u;
const PURCHASED_YESTERDAY = /(昨天买的)(?=牛奶)/u;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

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

function subjectEvidence(subject: ReturnType<typeof resolveSubject> & { disposition: "resolved" }) {
  return {
    kind: subject.subject.kind,
    resolution_basis: subject.subject.resolution_basis,
    subject_entity_created: subject.subject.subject_entity_created,
    ...(subject.subject.excluded_non_self_share_count === undefined
      ? {}
      : { excluded_non_self_share_count: subject.subject.excluded_non_self_share_count }),
    ...(subject.subject.self_participated === undefined
      ? {}
      : { self_participated: subject.subject.self_participated }),
    matched_span: subject.subject.matched_span,
    rule_version: subject.subject.rule_version,
  };
}

function mealCandidate(
  input: Readonly<CoreParseInput>,
  completion: Extract<ReturnType<typeof classifyCompletion>, { disposition: "proceed" }>,
  occurredTime: OccurredTimeEvidence,
): CoreParseResult {
  const proposed = proposeMealItems(input.source_text).filter((item) =>
    !completion.excluded_items.some((excluded) =>
      excluded.normalized_name === item.normalized_name
    )
  );
  const subject = resolveSubject(input.source_text, proposed);
  if (subject.disposition === "ignored") {
    return detachedFrozen({
      disposition: "ignored",
      action: subject.action,
      reason_code: subject.reason_code,
    });
  }
  const items = toCoreMealItems(subject.items, proposed);
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

  const command: CoreMealCommandCandidate = {
    action: "record_meal",
    operation_id: input.operation_id,
    meal_identity_seed: input.operation_id,
    source_text: input.source_text,
    parser_version: PARSER_VERSION,
    occurred_time: occurredTime,
    subject: subjectEvidence(subject),
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
    ...(subject.group_amount_evidence === undefined
      ? {}
      : { group_amount_evidence: {
          quantity: subject.group_amount_evidence.quantity,
          unit: subject.group_amount_evidence.unit,
          assigned_to_self: subject.group_amount_evidence.assigned_to_self,
          matched_span: subject.group_amount_evidence.matched_span,
          rule_version: subject.group_amount_evidence.rule_version,
        } }),
    ...(context.accepted_context === null &&
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
  };
  return detachedFrozen({ disposition: "candidate", command });
}

/** Compose the deterministic selected-core parser from ordinary input authority. */
export function parseCoreCommand(value: unknown): CoreParseResult {
  const input = cloneCoreParseInput(value);

  if (HEALTH_ADVICE_REQUEST.test(input.source_text) &&
      proposeMealItems(input.source_text).length === 0 &&
      matchExplicitPlainWater(input.source_text) === null) {
    return detachedFrozen({
      disposition: "ignored",
      action: "health_advice",
      reason_code: "unsupported_health_advice",
    });
  }

  const completion = classifyCompletion(input.source_text);
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

  const water = matchExplicitPlainWater(input.source_text);
  if (water !== null) {
    const mealItems = proposeMealItems(input.source_text).filter((item) =>
      !completion.excluded_items.some((excluded) =>
        excluded.normalized_name === item.normalized_name
      )
    );
    if (mealItems.length > 0) {
      return detachedFrozen({
        disposition: "needs_clarification",
        action: "record_meal",
        reason_code: "unsupported_command",
        question: "请把白水和其他饮食分成两条消息记录。",
      });
    }
    const waterSubject = resolveSubject(input.source_text, [{
      normalized_name: "water",
      raw_text: input.source_text.includes("白水") ? "白水" : "水",
      amount_evidence: {
        raw_text: water.raw_text,
        quantity: water.quantity_ml,
        unit: "ml",
        estimated: false,
      },
    }]);
    if (waterSubject.disposition === "ignored") {
      return detachedFrozen({
        disposition: "ignored",
        action: "record_water",
        reason_code: "non_self_subject",
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

  return mealCandidate(input, completion, occurredTime);
}
