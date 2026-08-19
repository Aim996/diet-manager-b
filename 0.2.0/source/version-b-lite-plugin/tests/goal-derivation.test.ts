import { describe, expect, it } from "vitest";

import {
  deriveSixGoals,
  type PersonalProfile,
} from "../src/domain/goal-derivation.js";

// DEC-030 §4 六项参考目标派生公式（Mifflin-St Jeor + 状态系数）。
// 约定：中间量（BMR / energy_raw / protein_raw / fat_raw / carbs_raw / fiber_raw）
// 一律不取整，只有六个最终目标值各自 round_half_up 到整数。
describe("DEC-030 six-goal derivation", () => {
  it("derives maintain goals for a 170cm 70kg male", () => {
    expect(
      deriveSixGoals({
        height_cm: 170,
        weight_kg: 70,
        sex: "male",
        age: 30,
        goal_state: "maintain",
      }),
    ).toEqual({
      energy_kcal: 1941,
      protein_g: 112,
      fat_g: 70,
      carbohydrate_g: 216,
      fiber_g: 27,
      water_ml: 2450,
    });
  });

  it("derives cut goals with the 0.85 energy coefficient and 2.0 g/kg protein", () => {
    expect(
      deriveSixGoals({
        height_cm: 165,
        weight_kg: 60,
        sex: "female",
        age: 28,
        goal_state: "cut",
      }),
    ).toEqual({
      energy_kcal: 1357,
      protein_g: 120,
      fat_g: 60,
      carbohydrate_g: 84,
      fiber_g: 19,
      water_ml: 2100,
    });
  });

  it("derives bulk goals with the 1.10 energy coefficient and 2.0 g/kg protein", () => {
    expect(
      deriveSixGoals({
        height_cm: 180,
        weight_kg: 80,
        sex: "male",
        age: 25,
        goal_state: "bulk",
      }),
    ).toEqual({
      energy_kcal: 2383,
      protein_g: 160,
      fat_g: 80,
      carbohydrate_g: 256,
      fiber_g: 33,
      water_ml: 2800,
    });
  });

  it("defaults unset sex, age and state to −78 term, age 30 and maintain", () => {
    expect(
      deriveSixGoals({
        height_cm: 175,
        weight_kg: 68,
      }),
    ).toEqual({
      energy_kcal: 1855,
      protein_g: 109,
      fat_g: 68,
      carbohydrate_g: 202,
      fiber_g: 26,
      water_ml: 2380,
    });
  });

  it("treats explicit null sex, age and state the same as absent", () => {
    expect(
      deriveSixGoals({
        height_cm: 175,
        weight_kg: 68,
        sex: null,
        age: null,
        goal_state: null,
      }),
    ).toEqual({
      energy_kcal: 1855,
      protein_g: 109,
      fat_g: 68,
      carbohydrate_g: 202,
      fiber_g: 26,
      water_ml: 2380,
    });
  });

  it("rejects a missing or non-positive height or weight", () => {
    expect(() => deriveSixGoals({ height_cm: 0, weight_kg: 70 })).toThrow(
      "GOAL_DERIVATION_INVALID:height_cm",
    );
    expect(() => deriveSixGoals({ height_cm: -5, weight_kg: 70 })).toThrow(
      "GOAL_DERIVATION_INVALID:height_cm",
    );
    expect(() => deriveSixGoals({ height_cm: 170, weight_kg: 0 })).toThrow(
      "GOAL_DERIVATION_INVALID:weight_kg",
    );
    expect(() => deriveSixGoals({ height_cm: 170, weight_kg: -2 })).toThrow(
      "GOAL_DERIVATION_INVALID:weight_kg",
    );
  });

  it("rejects non-finite height, weight or age", () => {
    expect(() =>
      deriveSixGoals({ height_cm: Number.NaN, weight_kg: 70 }),
    ).toThrow("GOAL_DERIVATION_INVALID:height_cm");
    expect(() =>
      deriveSixGoals({ height_cm: 170, weight_kg: Number.POSITIVE_INFINITY }),
    ).toThrow("GOAL_DERIVATION_INVALID:weight_kg");
    expect(() =>
      deriveSixGoals({ height_cm: 170, weight_kg: 70, age: 0 }),
    ).toThrow("GOAL_DERIVATION_INVALID:age");
    expect(() =>
      deriveSixGoals({ height_cm: 170, weight_kg: 70, age: -3 }),
    ).toThrow("GOAL_DERIVATION_INVALID:age");
  });

  it("rejects an unrecognized sex or goal_state value", () => {
    expect(() =>
      deriveSixGoals({ height_cm: 170, weight_kg: 70, sex: "alien" as never }),
    ).toThrow("GOAL_DERIVATION_INVALID:sex");
    expect(() =>
      deriveSixGoals({
        height_cm: 170,
        weight_kg: 70,
        goal_state: "hibernate" as never,
      }),
    ).toThrow("GOAL_DERIVATION_INVALID:goal_state");
  });

  it("freezes the returned goal values", () => {
    const profile: PersonalProfile = {
      height_cm: 170,
      weight_kg: 70,
      sex: "male",
      age: 30,
      goal_state: "maintain",
    };
    const goals = deriveSixGoals(profile);
    expect(Object.isFrozen(goals)).toBe(true);
  });
});
