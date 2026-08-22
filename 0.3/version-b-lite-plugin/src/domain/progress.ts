import type { FrozenDateProgressV1, FrozenProgressMetricV1, ProgressQuantityV1 } from "../contracts/progress-receipt-v1.js";
import type { ConfiguredGoals, GoalField } from "./goal-derivation.js";
import {
  canonicalDecimalFromNumber,
  canonicalDecimalFromScaledInteger,
  isDecimalRatioBelow,
  isPositiveCanonicalDecimal,
  roundDecimalRatio,
} from "./decimal.js";

const GOAL_NOTICE = "目标未配置，进度条不可用。" as const;

const METRICS = Object.freeze([
  Object.freeze({ key: "energy_kcal" as const, display_name: "热量" as const, unit: "kcal" as const }),
  Object.freeze({ key: "protein_g" as const, display_name: "蛋白" as const, unit: "g" as const }),
  Object.freeze({ key: "fat_g" as const, display_name: "脂肪" as const, unit: "g" as const }),
  Object.freeze({ key: "carbohydrate_g" as const, display_name: "碳水" as const, unit: "g" as const }),
  Object.freeze({ key: "fiber_g" as const, display_name: "纤维" as const, unit: "g" as const }),
  Object.freeze({ key: "water_ml" as const, display_name: "饮水" as const, unit: "ml" as const }),
]);

export interface ProgressMetricState {
  known_milli: number;
  unknown_sources: readonly string[];
  unknown_count?: number;
}

export type ProgressMetricStateMap = Record<GoalField, ProgressMetricState>;

export interface StoredProgressStateV1 {
  readonly authority_kind: "diet-manager/progress-state/v1";
  readonly metrics: Readonly<ProgressMetricStateMap>;
}

export type ProgressNutrientValues = Readonly<{
  energy_kcal_milli: number | null;
  protein_mg: number | null;
  fat_mg: number | null;
  carbohydrate_mg: number | null;
  fiber_mg: number | null;
  water_ml_milli: number | null;
}>;

export interface FreezeDateProgressInput {
  readonly date: string;
  readonly timezone: "Asia/Shanghai";
  readonly goal_version_id: string | null;
  readonly goals: Readonly<ConfiguredGoals>;
  readonly current: Readonly<ProgressMetricStateMap>;
  readonly increment: Readonly<ProgressMetricStateMap> | null;
  readonly generated_at: string;
  readonly idempotency_key: string;
}

export interface RatioProgress {
  readonly percentage: number;
  readonly filled_cells: number;
  readonly bar_text: string;
}

function invalid(reason: string): never {
  throw new TypeError(`PROGRESS_INVALID:${reason}`);
}

export function emptyProgressMetricState(): ProgressMetricStateMap {
  return {
    energy_kcal: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
    protein_g: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
    fat_g: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
    carbohydrate_g: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
    fiber_g: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
    water_ml: { known_milli: 0, unknown_sources: [], unknown_count: 0 },
  };
}

const NUTRIENT_KEYS = Object.freeze({
  energy_kcal: "energy_kcal_milli",
  protein_g: "protein_mg",
  fat_g: "fat_mg",
  carbohydrate_g: "carbohydrate_mg",
  fiber_g: "fiber_mg",
  water_ml: "water_ml_milli",
} as const satisfies Record<GoalField, keyof ProgressNutrientValues>);

export function progressStateFromNutrients(
  nutrients: ProgressNutrientValues,
  unknownSourcePrefix: string,
): ProgressMetricStateMap {
  const state = emptyProgressMetricState();
  for (const { key } of METRICS) {
    const nutrient = nutrients[NUTRIENT_KEYS[key]];
    if (nutrient !== null && (!Number.isSafeInteger(nutrient) || nutrient < 0)) {
      return invalid("nutrient");
    }
    state[key] = nutrient === null
      ? { known_milli: 0, unknown_sources: [`${unknownSourcePrefix}:${key}`], unknown_count: 1 }
      : { known_milli: nutrient, unknown_sources: [], unknown_count: 0 };
  }
  return state;
}

export function addProgressMetricStates(
  left: Readonly<ProgressMetricStateMap>,
  right: Readonly<ProgressMetricStateMap>,
): ProgressMetricStateMap {
  const result = emptyProgressMetricState();
  for (const { key } of METRICS) {
    const leftSources = frozenSources(left[key]);
    const rightSources = frozenSources(right[key]);
    const known = left[key].known_milli + right[key].known_milli;
    if (!Number.isSafeInteger(known)) return invalid("known_sum");
    const count = unknownCount(left[key]) + unknownCount(right[key]);
    if (!Number.isSafeInteger(count)) return invalid("unknown_count");
    result[key] = {
      known_milli: known,
      unknown_sources: boundedSources(leftSources, rightSources),
      unknown_count: count,
    };
  }
  return result;
}

export function replaceProgressMetricState(
  current: Readonly<ProgressMetricStateMap>,
  before: Readonly<ProgressMetricStateMap>,
  after: Readonly<ProgressMetricStateMap>,
): ProgressMetricStateMap {
  const result = emptyProgressMetricState();
  for (const { key } of METRICS) {
    const currentSources = [...frozenSources(current[key])];
    const beforeSources = [...frozenSources(before[key])];
    const afterSources = [...frozenSources(after[key])];
    const known = current[key].known_milli - before[key].known_milli + after[key].known_milli;
    if (!Number.isSafeInteger(known) || known < 0) return invalid("known_delta");
    const currentCount = unknownCount(current[key]);
    const beforeCount = unknownCount(before[key]);
    const afterCount = unknownCount(after[key]);
    const count = currentCount - beforeCount + afterCount;
    if (!Number.isSafeInteger(count) || count < 0) return invalid("unknown_delta");
    for (const source of beforeSources) {
      const exactIndex = currentSources.indexOf(source);
      if (exactIndex >= 0) currentSources.splice(exactIndex, 1);
      else if (currentCount === currentSources.length) return invalid("unknown_source_delta");
    }
    result[key] = {
      known_milli: known,
      unknown_sources: boundedSources(currentSources, afterSources),
      unknown_count: count,
    };
  }
  return result;
}

export function positiveProgressMetricDelta(
  before: Readonly<ProgressMetricStateMap>,
  after: Readonly<ProgressMetricStateMap>,
): ProgressMetricStateMap {
  const result = emptyProgressMetricState();
  for (const { key } of METRICS) {
    const beforeSources = frozenSources(before[key]);
    const afterSources = frozenSources(after[key]);
    if (beforeSources.length === 0 && afterSources.length === 0) {
      result[key] = {
        known_milli: Math.max(0, after[key].known_milli - before[key].known_milli),
        unknown_sources: [],
        unknown_count: 0,
      };
      continue;
    }
    result[key] = {
      known_milli: Math.max(0, after[key].known_milli - before[key].known_milli),
      unknown_sources: afterSources,
      unknown_count: unknownCount(after[key]),
    };
  }
  return result;
}

export function freezeStoredProgressState(value: unknown): StoredProgressStateV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid("stored_state");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== "authority_kind\0metrics" ||
      record.authority_kind !== "diet-manager/progress-state/v1" ||
      typeof record.metrics !== "object" || record.metrics === null || Array.isArray(record.metrics)) {
    return invalid("stored_state");
  }
  const rawMetrics = record.metrics as Record<string, unknown>;
  if (Object.keys(rawMetrics).sort().join("\0") !== METRICS.map(({ key }) => key).sort().join("\0")) {
    return invalid("stored_state");
  }
  const metrics = emptyProgressMetricState();
  for (const { key } of METRICS) {
    const candidate = rawMetrics[key];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return invalid("stored_state");
    }
    const metricState = candidate as Record<string, unknown>;
    const stateKeys = Object.keys(metricState).sort().join("\0");
    if ((stateKeys !== "known_milli\0unknown_count\0unknown_sources" &&
         stateKeys !== "known_milli\0unknown_sources") ||
        !Number.isSafeInteger(metricState.known_milli) || Number(metricState.known_milli) < 0 ||
        (metricState.unknown_count !== undefined && !Number.isSafeInteger(metricState.unknown_count)) ||
        !Array.isArray(metricState.unknown_sources)) return invalid("stored_state");
    const frozen = frozenSources({
      known_milli: Number(metricState.known_milli),
      unknown_sources: metricState.unknown_sources as string[],
      ...(metricState.unknown_count === undefined ? {} : { unknown_count: Number(metricState.unknown_count) }),
    });
    metrics[key] = Object.freeze({
      known_milli: Number(metricState.known_milli),
      unknown_sources: frozen,
      unknown_count: metricState.unknown_count === undefined
        ? frozen.length
        : unknownCount({
            known_milli: Number(metricState.known_milli),
            unknown_sources: frozen,
            unknown_count: Number(metricState.unknown_count),
          }),
    });
  }
  return Object.freeze({
    authority_kind: "diet-manager/progress-state/v1" as const,
    metrics: Object.freeze(metrics),
  });
}

export function storedProgressState(value: Readonly<ProgressMetricStateMap>): StoredProgressStateV1 {
  const metrics = emptyProgressMetricState();
  for (const { key } of METRICS) {
    metrics[key] = Object.freeze({
      known_milli: value[key].known_milli,
      unknown_sources: frozenSources(value[key]),
      unknown_count: unknownCount(value[key]),
    });
  }
  return Object.freeze({
    authority_kind: "diet-manager/progress-state/v1" as const,
    metrics: Object.freeze(metrics),
  });
}

export function ratioProgress(current: string, target: string): RatioProgress {
  let percentage: number;
  let filled: number;
  try {
    percentage = roundDecimalRatio(current, target, 100n);
    filled = roundDecimalRatio(current, target, 10n);
  } catch (error) {
    const reason = error instanceof Error && error.message.endsWith(":target") ? "target" : "current";
    return invalid(reason);
  }
  const filledCells = Math.min(10, Math.max(0, filled));
  return Object.freeze({
    percentage,
    filled_cells: filledCells,
    bar_text: "█".repeat(filledCells) + "░".repeat(10 - filledCells),
  });
}

function frozenSources(value: ProgressMetricState): readonly string[] {
  if (!Number.isSafeInteger(value.known_milli) || value.known_milli < 0) return invalid("known_milli");
  if (!Array.isArray(value.unknown_sources) || value.unknown_sources.length > 64) {
    return invalid("unknown_sources");
  }
  const sources = [...new Set(value.unknown_sources)];
  if (sources.some((source) =>
    typeof source !== "string" || source.length === 0 || source.length > 128 || /[\u0000-\u001F\u007F]/u.test(source))) {
    return invalid("unknown_sources");
  }
  sources.sort();
  return Object.freeze(sources);
}

function unknownCount(value: ProgressMetricState): number {
  const count = value.unknown_count ?? value.unknown_sources.length;
  if (!Number.isSafeInteger(count) || count < value.unknown_sources.length || count < 0) {
    return invalid("unknown_count");
  }
  return count;
}

function boundedSources(...groups: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(groups.flat())].sort().slice(0, 64));
}

function quantity(value: ProgressMetricState, none: boolean): ProgressQuantityV1 {
  if (none) return Object.freeze({ kind: "none" as const });
  const sources = frozenSources(value);
  const count = unknownCount(value);
  if (count === 0) {
    return Object.freeze({
      kind: "exact" as const,
      value: canonicalDecimalFromScaledInteger(value.known_milli, 1_000),
    });
  }
  if (value.known_milli === 0) return Object.freeze({ kind: "unknown" as const });
  return Object.freeze({
    kind: "lower_bound" as const,
    value: canonicalDecimalFromScaledInteger(value.known_milli, 1_000),
  });
}

function metric(
  specification: (typeof METRICS)[number],
  goal: number | null,
  currentState: ProgressMetricState,
  incrementState: ProgressMetricState | null,
): FrozenProgressMetricV1 {
  const sources = frozenSources(currentState);
  const current = quantity(currentState, false);
  const target = goal === null ? null : canonicalDecimalFromNumber(goal);
  const currentValue = "value" in current ? current.value : null;
  const ratio = target === null || currentValue === null ? null : ratioProgress(currentValue, target);
  let delta = quantity(incrementState ?? { known_milli: 0, unknown_sources: [] }, incrementState === null);
  if (delta.kind === "exact" && !isPositiveCanonicalDecimal(delta.value)) {
    delta = Object.freeze({ kind: "none" as const });
  }
  const deltaValue = "value" in delta ? delta.value : null;
  const incrementPercent = target === null || deltaValue === null || !isPositiveCanonicalDecimal(deltaValue)
    ? null
    : ratioProgress(deltaValue, target).percentage;
  const incrementPercentText = target === null || deltaValue === null || incrementPercent === null
    ? null
    : isDecimalRatioBelow(deltaValue, target, 100n)
      ? "+<1%"
      : `+${incrementPercent}%`;
  const count = unknownCount(currentState);
  const coverage = count === 0
    ? "known" as const
    : currentState.known_milli === 0
      ? "unknown" as const
      : "known_min" as const;
  return Object.freeze({
    key: specification.key,
    display_name: specification.display_name,
    unit: specification.unit,
    current,
    target,
    delta,
    percent: ratio?.percentage ?? null,
    filled_cells: ratio?.filled_cells ?? null,
    bar_text: ratio?.bar_text ?? null,
    increment_percent: incrementPercent,
    increment_percent_text: incrementPercentText,
    coverage_status: coverage,
    unknown_sources: sources,
    unknown_source_count: count,
  }) as unknown as FrozenProgressMetricV1;
}

export function freezeDateProgress(input: FreezeDateProgressInput): FrozenDateProgressV1 {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.date)) return invalid("date");
  if (input.timezone !== "Asia/Shanghai") return invalid("timezone");
  if (input.goal_version_id !== null &&
      (typeof input.goal_version_id !== "string" || input.goal_version_id.length === 0 || input.goal_version_id.length > 128)) {
    return invalid("goal_version_id");
  }
  if (!Number.isFinite(Date.parse(input.generated_at))) return invalid("generated_at");
  if (typeof input.idempotency_key !== "string" || input.idempotency_key.length === 0 || input.idempotency_key.length > 128) {
    return invalid("idempotency_key");
  }
  const noGoals = METRICS.every(({ key }) => input.goals[key] === null);
  const metrics = Object.freeze(METRICS.map((specification) => metric(
    specification,
    input.goals[specification.key],
    input.current[specification.key],
    input.increment?.[specification.key] ?? null,
  ))) as unknown as FrozenDateProgressV1["metrics"];
  return Object.freeze({
    schema_version: "diet-manager/frozen-date-progress/v1" as const,
    date: input.date,
    timezone: "Asia/Shanghai" as const,
    goal_version_id: input.goal_version_id,
    goal_notice: noGoals ? GOAL_NOTICE : null,
    metrics,
    generated_at: input.generated_at,
    idempotency_key: input.idempotency_key,
  });
}
