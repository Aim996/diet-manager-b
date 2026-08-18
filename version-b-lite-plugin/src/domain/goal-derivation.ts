// DEC-030 §4 六项参考目标派生（Mifflin-St Jeor + 状态系数）。
// 中间量一律不取整，只有六个最终目标值各自 round_half_up 到整数。

export type PersonalProfileSex = "male" | "female";
export type PersonalProfileGoalState = "cut" | "maintain" | "bulk";

export interface PersonalProfile {
  readonly height_cm: number;
  readonly weight_kg: number;
  readonly sex?: PersonalProfileSex | null;
  readonly age?: number | null;
  readonly goal_state?: PersonalProfileGoalState | null;
}

export interface SixGoalValues {
  readonly energy_kcal: number;
  readonly protein_g: number;
  readonly fat_g: number;
  readonly carbohydrate_g: number;
  readonly fiber_g: number;
  readonly water_ml: number;
}

// DEC-030 C-3：六项目标的「已配置」形态（每项 number | null，null = 未配置）。
// set_profile 派生结果恒为 SixGoalValues（全非空）；set_goal 合并后可出现 null。
export const GOAL_FIELDS = [
  "energy_kcal",
  "protein_g",
  "fat_g",
  "carbohydrate_g",
  "fiber_g",
  "water_ml",
] as const;

export type GoalField = (typeof GOAL_FIELDS)[number];

export interface ConfiguredGoals {
  readonly energy_kcal: number | null;
  readonly protein_g: number | null;
  readonly fat_g: number | null;
  readonly carbohydrate_g: number | null;
  readonly fiber_g: number | null;
  readonly water_ml: number | null;
}

// set_goal 的任意子集覆盖：每项可选，null 清除该维度。
export interface GoalOverrides {
  readonly energy_kcal?: number | null;
  readonly protein_g?: number | null;
  readonly fat_g?: number | null;
  readonly carbohydrate_g?: number | null;
  readonly fiber_g?: number | null;
  readonly water_ml?: number | null;
}

export function emptyConfiguredGoals(): ConfiguredGoals {
  return Object.freeze({
    energy_kcal: null,
    protein_g: null,
    fat_g: null,
    carbohydrate_g: null,
    fiber_g: null,
    water_ml: null,
  });
}

// 纯合并：当前已配置目标叠加任意子集覆盖（null 清除）。入参已由上层校验为非负有限值。
export function mergeGoalOverrides(
  current: Readonly<ConfiguredGoals>,
  overrides: Readonly<GoalOverrides>,
): ConfiguredGoals {
  const merged: Record<GoalField, number | null> = { ...current };
  for (const field of GOAL_FIELDS) {
    if (Object.hasOwn(overrides, field)) merged[field] = overrides[field] as number | null;
  }
  return Object.freeze(merged);
}

function invalid(reason: string): never {
  throw new TypeError(`GOAL_DERIVATION_INVALID:${reason}`);
}

function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) return invalid(field);
  return value;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

const SEX_TERM: Readonly<Record<PersonalProfileSex, number>> = {
  male: 5,
  female: -161,
};
const UNSET_SEX_TERM = -78;
const DEFAULT_AGE = 30;

const STATE_COEFFICIENT: Readonly<Record<PersonalProfileGoalState, number>> = {
  cut: 0.85,
  maintain: 1.0,
  bulk: 1.1,
};

const STATE_PROTEIN_PER_KG: Readonly<Record<PersonalProfileGoalState, number>> = {
  cut: 2.0,
  maintain: 1.6,
  bulk: 2.0,
};

export function deriveSixGoals(profile: PersonalProfile): SixGoalValues {
  const height = positiveFinite(profile.height_cm, "height_cm");
  const weight = positiveFinite(profile.weight_kg, "weight_kg");

  const age =
    profile.age === null || profile.age === undefined
      ? DEFAULT_AGE
      : positiveFinite(profile.age, "age");

  const sex = profile.sex ?? null;
  if (sex !== null && sex !== "male" && sex !== "female") return invalid("sex");
  const sexTerm = sex === null ? UNSET_SEX_TERM : SEX_TERM[sex];

  const state = profile.goal_state ?? null;
  if (state !== null && state !== "cut" && state !== "maintain" && state !== "bulk") {
    return invalid("goal_state");
  }
  const goalState: PersonalProfileGoalState = state === null ? "maintain" : state;

  const bmr = 10 * weight + 6.25 * height - 5 * age + sexTerm;
  const energyRaw = bmr * 1.2 * STATE_COEFFICIENT[goalState];
  const proteinRaw = STATE_PROTEIN_PER_KG[goalState] * weight;
  const fatRaw = weight;
  const carbohydrateRaw = Math.max(0, (energyRaw - proteinRaw * 4 - fatRaw * 9) / 4);
  const fiberRaw = (energyRaw / 1000) * 14;
  const waterRaw = 35 * weight;

  return Object.freeze({
    energy_kcal: roundHalfUp(energyRaw),
    protein_g: roundHalfUp(proteinRaw),
    fat_g: roundHalfUp(fatRaw),
    carbohydrate_g: roundHalfUp(carbohydrateRaw),
    fiber_g: roundHalfUp(fiberRaw),
    water_ml: roundHalfUp(waterRaw),
  });
}

// DEC-030 §17.6 进度条渲染规则（唯一权威）：percentage = round_half_up(current/target×100)、
// filled_cells = clamp(round_half_up(current/target×10), 0, 10)、bar_text = █×filled + ░×(10−filled)、
// 超出目标显示真实百分比（可 >100），进度条满格。

export interface GoalProgressBar {
  readonly current: number;
  readonly target: number;
  readonly percentage: number;
  readonly filled_cells: number;
  readonly bar_text: string;
}

export function goalProgressBar(current: number, target: number): GoalProgressBar {
  if (!Number.isFinite(current) || current < 0) return invalid("progress_current");
  if (!Number.isFinite(target) || target <= 0) return invalid("progress_target");
  const ratio = current / target;
  const percentage = roundHalfUp(ratio * 100);
  const filledCells = Math.min(10, Math.max(0, roundHalfUp(ratio * 10)));
  return Object.freeze({
    current,
    target,
    percentage,
    filled_cells: filledCells,
    bar_text: "█".repeat(filledCells) + "░".repeat(10 - filledCells),
  });
}

// 各维度的「当前量」，单位为与目标一致的自然单位（kcal / g / ml），null 由调用方折算为 0。
export type GoalCurrentValues = Readonly<Record<GoalField, number>>;

// 仅对「已配置（目标非 null）」的维度生成进度条；未配置维度不出现。
export function computeGoalProgressBars(
  configured: Readonly<ConfiguredGoals>,
  current: Readonly<GoalCurrentValues>,
): Readonly<Partial<Record<GoalField, GoalProgressBar>>> {
  const bars: Record<string, GoalProgressBar> = Object.create(null);
  for (const field of GOAL_FIELDS) {
    const target = configured[field];
    if (target !== null) bars[field] = goalProgressBar(current[field], target);
  }
  return Object.freeze(bars) as Readonly<Partial<Record<GoalField, GoalProgressBar>>>;
}
