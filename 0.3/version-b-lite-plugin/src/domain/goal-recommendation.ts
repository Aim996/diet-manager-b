import {
  deriveSixGoals,
  type GoalField,
  type PersonalProfile,
  type PersonalProfileGoalState,
} from "./goal-derivation.js";

export const REQUIRED_RECOMMENDATION_FIELDS = [
  "energy_kcal",
  "protein_g",
  "fat_g",
  "carbohydrate_g",
  "fiber_g",
] as const;

export type RequiredRecommendationField = (typeof REQUIRED_RECOMMENDATION_FIELDS)[number];
export type GoalRecommendationValues = Readonly<
  Record<RequiredRecommendationField, number | null> & Partial<Record<"water_ml", number>>
>;

export interface GoalRecommendationBasis {
  readonly authority_kind: "diet-manager/goal-recommendation-basis/v1";
  readonly formula_version: "diet-manager/goal-recommendation-v1";
  readonly profile: Readonly<Required<PersonalProfile>>;
  readonly unavailable_reasons: Readonly<Partial<Record<GoalField, string>>>;
}

export interface GoalRecommendationDraft {
  readonly status: "pending";
  readonly goals: GoalRecommendationValues;
  readonly basis: Readonly<GoalRecommendationBasis>;
}

function invalid(reason: string): never {
  throw new TypeError(`GOAL_RECOMMENDATION_INVALID:${reason}`);
}

function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) return invalid(field);
  return value;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function normalizedProfile(profile: PersonalProfile): Readonly<Required<PersonalProfile>> {
  const height = positiveFinite(profile.height_cm, "height_cm");
  const weight = positiveFinite(profile.weight_kg, "weight_kg");
  const sex = profile.sex ?? null;
  if (sex !== null && sex !== "male" && sex !== "female") return invalid("sex");
  const age = profile.age ?? null;
  if (age !== null && (!Number.isInteger(age) || age <= 0)) return invalid("age");
  const state = profile.goal_state ?? null;
  if (state !== null && state !== "cut" && state !== "maintain" && state !== "bulk") {
    return invalid("goal_state");
  }
  return Object.freeze({
    height_cm: height,
    weight_kg: weight,
    sex,
    age,
    goal_state: state,
  });
}

function unavailableEnergyReason(profile: Readonly<Required<PersonalProfile>>): string {
  const missing = [
    ...(profile.age === null ? ["age"] : []),
    ...(profile.sex === null ? ["sex"] : []),
    ...(profile.goal_state === null ? ["goal_state"] : []),
  ];
  return `missing_${missing.join("_")}`;
}

function proteinFor(weightKg: number, state: PersonalProfileGoalState): number {
  return roundHalfUp(weightKg * (state === "maintain" ? 1.6 : 2));
}

/**
 * 生成尚未生效的目标建议。热量相关字段只在公式所需资料完整时计算；
 * 缺资料时保留五个必备槽位并冻结原因，不使用旧版年龄/性别默认值。
 */
export function deriveGoalRecommendation(profile: PersonalProfile): GoalRecommendationDraft {
  const normalized = normalizedProfile(profile);
  const complete = normalized.sex !== null && normalized.age !== null && normalized.goal_state !== null;
  const unavailable: Partial<Record<GoalField, string>> = {};
  let goals: GoalRecommendationValues;

  if (complete) {
    goals = deriveSixGoals(normalized);
  } else {
    const protein = normalized.goal_state === null
      ? null
      : proteinFor(normalized.weight_kg, normalized.goal_state);
    unavailable.energy_kcal = unavailableEnergyReason(normalized);
    if (protein === null) unavailable.protein_g = "missing_goal_state";
    unavailable.carbohydrate_g = "energy_recommendation_unavailable";
    unavailable.fiber_g = "energy_recommendation_unavailable";
    unavailable.water_ml = "profile_information_insufficient";
    goals = Object.freeze({
      energy_kcal: null,
      protein_g: protein,
      fat_g: roundHalfUp(normalized.weight_kg),
      carbohydrate_g: null,
      fiber_g: null,
    });
  }

  return Object.freeze({
    status: "pending",
    goals,
    basis: Object.freeze({
      authority_kind: "diet-manager/goal-recommendation-basis/v1",
      formula_version: "diet-manager/goal-recommendation-v1",
      profile: normalized,
      unavailable_reasons: Object.freeze({ ...unavailable }),
    }),
  });
}
