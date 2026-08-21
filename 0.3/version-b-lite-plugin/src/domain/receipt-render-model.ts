import type {
  DietManagerOutcome,
  FrozenDateProgressV1,
  FrozenProgressMetricV1,
  MealReceiptItem,
  NutritionOutcomeItem,
} from "../contracts.js";
import { assertDietManagerOutcome } from "../contracts.js";
import {
  receiptDisplayName,
  receiptDisplayUnit,
  receiptInventorySubject,
  receiptMealSlotLabel,
} from "./receipt.js";

export type NutritionSourceRenderLabel =
  | "包装营养表"
  | "本地通用营养库"
  | "互联网来源"
  | "估算数据"
  | "未知";

export interface ReceiptNutritionSourceLabel {
  readonly item_id: string;
  readonly name: string;
  readonly label: NutritionSourceRenderLabel;
}

export interface ReceiptRenderModel {
  readonly authority_kind: "diet-manager/receipt-render-model/v1";
  readonly body: string;
  readonly nutrition_source_labels: readonly ReceiptNutritionSourceLabel[];
  readonly progress_blocks: readonly string[];
  readonly text: string;
}

const MODEL_CACHE = new WeakMap<object, ReceiptRenderModel>();

const METRIC_EMOJI: Readonly<Record<FrozenProgressMetricV1["key"], string>> = Object.freeze({
  energy_kcal: "🔥",
  protein_g: "🥩",
  fat_g: "🧈",
  carbohydrate_g: "🌾",
  fiber_g: "🥬",
  water_ml: "💧",
});

function decimal(value: number): string {
  return String(value);
}

function itemAmount(item: Readonly<MealReceiptItem>, rawText: string): string {
  const name = receiptDisplayName(item.name, rawText);
  if (item.quantity === null) return `${name}（数量未知）`;
  return `${name} ${decimal(item.quantity)} ${receiptDisplayUnit(item.unit)}`;
}

function inventoryNote(item: Readonly<MealReceiptItem>, rawText: string): string | null {
  const name = receiptInventorySubject(receiptDisplayName(item.name, rawText));
  const inventory = item.inventory;
  if (inventory.status === "matched") {
    const amount = `${decimal(inventory.deducted_quantity)} ${receiptDisplayUnit(inventory.deducted_unit)}`;
    if (inventory.shortage_quantity !== null && inventory.shortage_quantity > 0) {
      return `${name}库存仅 ${amount}，已扣减，当前库存 0`;
    }
    return inventory.deducted_quantity > 0 ? `${name}库存已扣减 ${amount}` : null;
  }
  if (inventory.status === "skipped_insufficient") return `${name}未匹配有效库存`;
  if (inventory.status === "skipped_unit_incompatible") return `${name}库存单位无法可靠换算`;
  if (inventory.status === "skipped_ambiguous") return `${name}存在多个库存候选，未自动扣减`;
  if (inventory.status === "skipped_outside") return `${name}未联动家庭库存`;
  if (inventory.status === "skipped_by_user") return `${name}已按要求不扣库存`;
  return `${name}数量不明确，未扣库存`;
}

function mealBody(outcome: Extract<DietManagerOutcome, { committed: true }>): string | null {
  if (outcome.action !== "record_meal" || outcome.receipt === undefined) return null;
  const receipt = outcome.receipt;
  const summary = receipt.items.map((item) => itemAmount(item, receipt.raw_text)).join("、");
  const notes = receipt.items
    .map((item) => inventoryNote(item, receipt.raw_text))
    .filter((note): note is string => note !== null);
  const inventory = notes.length === 0 ? "" : `${notes.join("；")}。`;
  return `已记录${receiptMealSlotLabel(receipt.meal_slot)}：${summary}。${inventory}`;
}

function committedBody(outcome: Extract<DietManagerOutcome, { committed: true }>): string {
  const meal = mealBody(outcome);
  if (meal !== null) return meal;
  if (outcome.action === "record_water") return "已记录饮水。";
  if (outcome.action === "add_inventory") return "库存更新已提交。";
  if (outcome.action === "correct_record") return "更正已提交。";
  if (outcome.action === "undo_record") return "撤销已提交。";
  if (outcome.action === "restore_record") return "恢复已提交。";
  if (outcome.action === "set_profile") return "资料更新已提交。";
  if (outcome.action === "set_goal") return "目标更新已提交。";
  return outcome.status === "committed_with_issues" ? "操作已提交，但存在已确认问题。" : "操作已提交。";
}

function nonCommittedBody(outcome: Extract<DietManagerOutcome, { committed: false }>): string {
  if (outcome.status === "failed") return `未记录：处理失败（${outcome.error_code}）。`;
  if (outcome.status === "needs_clarification") {
    return outcome.question === undefined ? `尚未记录。需要补充信息（${outcome.reason_code}）。` : `尚未记录。${outcome.question}`;
  }
  if (outcome.reason_code === "read_only_result") return "查询完成。";
  return `未记录：${outcome.reason_code}。`;
}

function nutritionLabel(source: NutritionOutcomeItem["source_label"]): NutritionSourceRenderLabel {
  if (source === "explicit" || source === "confirmed_history") return "包装营养表";
  if (source === "public_reference") return "互联网来源";
  if (source === "estimate") return "估算数据";
  if (source === "unknown") return "未知";
  return "本地通用营养库";
}

function nutritionLabels(outcome: DietManagerOutcome): readonly ReceiptNutritionSourceLabel[] {
  if (!outcome.committed || outcome.nutrition_items === undefined) return Object.freeze([]);
  const rawText = outcome.receipt?.raw_text ?? "";
  return Object.freeze(outcome.nutrition_items.map((item) => Object.freeze({
    item_id: item.item_id,
    name: receiptDisplayName(item.name, rawText),
    label: nutritionLabel(item.source_label),
  })));
}

function quantityText(value: FrozenProgressMetricV1["current"], unit: string): string {
  if (value.kind === "unknown" || value.kind === "none") return "未知";
  const suffix = unit === "ml" ? unit : ` ${unit}`;
  return value.kind === "lower_bound" ? `已知至少 ${value.value}${suffix}` : `${value.value}${suffix}`;
}

function deltaText(metric: FrozenProgressMetricV1): string {
  if (metric.delta.kind === "unknown" || metric.delta.kind === "none") return "";
  const suffix = metric.unit === "ml" ? metric.unit : ` ${metric.unit}`;
  const prefix = metric.delta.kind === "lower_bound" ? "≥" : "";
  const percent = metric.increment_percent_text === null ? "" : ` ${metric.increment_percent_text}`;
  return `｜+${prefix}${metric.delta.value}${suffix}${percent}`;
}

function metricLines(metric: FrozenProgressMetricV1, allGoalsUnconfigured: boolean): readonly string[] {
  const prefix = `${METRIC_EMOJI[metric.key]} ${metric.display_name}`;
  const current = quantityText(metric.current, metric.unit);
  if (metric.target === null) {
    const currentText = metric.current.kind === "lower_bound"
      ? `≥${metric.current.value}${metric.unit === "ml" ? "ml" : ` ${metric.unit}`}`
      : current;
    return allGoalsUnconfigured
      ? Object.freeze([`${prefix} ${currentText}`])
      : Object.freeze([`${prefix} 目标未配置`, `${METRIC_EMOJI[metric.key]} 当前 ${currentText}`]);
  }
  const target = `${metric.target}${metric.unit === "ml" ? "ml" : ` ${metric.unit}`}`;
  if (metric.current.kind === "unknown" || metric.current.kind === "none") {
    return Object.freeze([
      `${prefix} ░░░░░░░░░░ 未知`,
      `${METRIC_EMOJI[metric.key]} 未知 / ${target}`,
    ]);
  }
  const percent = metric.percent === null
    ? "未知"
    : `${metric.coverage_status === "known_min" ? "≥" : ""}${metric.percent}%`;
  const bar = metric.bar_text ?? "░░░░░░░░░░";
  return Object.freeze([
    `${prefix} ${bar} ${percent}`,
    `${METRIC_EMOJI[metric.key]} ${current} / ${target}${deltaText(metric)}`,
  ]);
}

function renderDateProgress(progress: FrozenDateProgressV1, includeDate: boolean): string {
  const groups = progress.metrics.map((metric) =>
    metricLines(metric, progress.goal_notice !== null).join("\n"));
  const content = progress.goal_notice === null
    ? groups.join("\n\n")
    : [progress.goal_notice, ...groups].join("\n");
  return includeDate ? `${progress.date}\n${content}` : content;
}

function progressBlocks(outcome: DietManagerOutcome): readonly string[] {
  if (!outcome.committed || outcome.progress === undefined) return Object.freeze([]);
  const multiple = outcome.progress.length > 1;
  return Object.freeze(outcome.progress.map((progress) => renderDateProgress(progress, multiple)));
}

export function buildReceiptRenderModel(value: DietManagerOutcome): ReceiptRenderModel {
  const outcome = assertDietManagerOutcome(value);
  const cached = MODEL_CACHE.get(outcome as object);
  if (cached !== undefined) return cached;
  const body = outcome.committed ? committedBody(outcome) : nonCommittedBody(outcome);
  const progress = progressBlocks(outcome);
  const text = progress.length === 0 ? body : `${body}\n\n${progress.join("\n\n")}`;
  const model = Object.freeze({
    authority_kind: "diet-manager/receipt-render-model/v1" as const,
    body,
    nutrition_source_labels: nutritionLabels(outcome),
    progress_blocks: progress,
    text,
  });
  MODEL_CACHE.set(outcome as object, model);
  return model;
}
